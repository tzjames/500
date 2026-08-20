const test = require("node:test");
const assert = require("node:assert/strict");

// Room talks to Mongo and to socket.io. Both are replaced here before the room
// is loaded, so a whole game can be played out in process.
const db = require("./db");
const recorded = { rounds: [], elo: [], created: [] };
db.saveGame = async () => {};
db.deleteGame = async () => {};
db.getGame = async () => null;
db.listPublicWaitingGames = async () => [];
db.headToHead = async () => ({});
db.recordRound = async (round) => recorded.rounds.push(round);
db.applyElo = async (...args) => recorded.elo.push(args);
db.createGame = async (game) => {
  recorded.created.push(game);
  return game;
};

const { Room } = require("./room");
const { isFriendlyGame } = require("./friendly");

function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to: (to) => ({ emit: (event, payload) => emitted.push({ to, event, payload }) }),
  };
}

function fakeSocket(userId, name) {
  const received = [];
  return {
    id: `sock-${userId}`,
    userId,
    userName: name,
    received,
    join() {},
    leave() {},
    emit: (event, payload) => received.push({ event, payload }),
  };
}

// A room with one human sitting at it, waiting for someone.
function newRoom() {
  const io = fakeIo();
  const room = new Room("game-1", io, {
    playerSlots: [null, null],
    status: "waiting",
    visibility: "private",
    snapshot: {},
    log: [],
  });
  const human = fakeSocket("u0", "Player 0");
  room.handleJoin(human);
  return { room, io, human };
}

test("a robot takes the empty chair and the game starts", () => {
  const { room } = newRoom();
  assert.equal(room.game, null, "nothing dealt while a chair is empty");

  room.addBot(fakeSocket("u0", "Player 0"));

  assert.ok(room.slots.every(Boolean), "both chairs are taken");
  assert.equal(room.botSlot().isBot, true);
  assert.match(room.botSlot().name, /robot/, "the robot is named as one");
  assert.ok(room.game, "the hand is dealt once the table is full");
  assert.equal(room.gamePhase, "bidding");
  // Ten cards each, as usual.
  assert.equal(room.game.players[0].hand.length, 10);
  assert.equal(room.game.players[1].hand.length, 10);
  room.dispose();
});

test("a table with a robot at it is never rated", () => {
  const { room } = newRoom();
  room.addBot(fakeSocket("u0", "Player 0"));
  assert.equal(room.isFriendly(), true);
  // And it stays that way through persistence, which is what the lobby and the
  // stats page read.
  assert.equal(isFriendlyGame({ friendly: false, playerSlots: room.slots }), true);
  room.dispose();
});

test("a robot doesn't count as somebody being at the table", () => {
  const { room, human } = newRoom();
  room.addBot(fakeSocket("u0", "Player 0"));
  assert.equal(room.connectedHumans(), 1);
  room.handleDisconnect(human);
  assert.equal(room.connectedHumans(), 0, "a robot alone is an empty table");
  room.dispose();
});

test("the empty chair can't be given away once the cards are out", () => {
  const { room } = newRoom();
  room.addBot(fakeSocket("u0", "Player 0"));
  const before = room.slots.map((s) => s.userId);
  // Both chairs are taken and a hand is in progress: nothing to add.
  room.addBot(fakeSocket("u0", "Player 0"));
  assert.deepEqual(room.slots.map((s) => s.userId), before);
  room.dispose();
});

test("only someone sitting at the table may seat a robot", () => {
  const { room } = newRoom();
  room.addBot(fakeSocket("someone-else", "Passer-by"));
  assert.equal(room.botSlot(), null, "a stranger can't seat a robot here");
  assert.equal(room.game, null);
});

// The real test of the wiring. The robot's turn can begin after a bid, a
// discard, a card, a trick resolving, a round ending or an offer being answered,
// and the watcher has to notice every one of them. Nothing here tells it what
// happened — it is only ever asked "is there anything for you to do?", exactly as
// the timer does in production.
function playWithRobot(t, { maxTicks = 6000 } = {}) {
  // The watcher arms real timers, and a self-re-arming chain of them would keep
  // the event loop alive past the end of the test. Mock timers that are never
  // ticked let it arm all it likes without anything firing behind our back —
  // this loop does the asking itself.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { room, human } = newRoom();
  room.addBot(fakeSocket("u0", "Player 0"));
  const humanId = "u0";
  const botId = room.botSlot().userId;

  let ticks = 0;
  let humanMoves = 0;

  const humanTurn = () => {
    const game = room.game;
    if (!game) return false;

    if ((room.gamePhase === "roundEnd" || room.gamePhase === "gameOver") && room.roundEnd) {
      if (!room.roundEnd.readyUserIds.has(humanId)) {
        room.roundEndReady(human);
        return true;
      }
      return false;
    }
    if (room.gamePhase === "bidding" && room.currentBidder === humanId) {
      // The human always passes, so the robot buys every contract it wants.
      room.placeBid(human, { bid: "Pass", points: 0 });
      return true;
    }
    if (room.gamePhase === "kitty" && game.currentBid?.player === humanId) {
      room.kittyDone(human, { newHand: [...game.players.find((p) => p.id === humanId).hand].slice(0, 10) });
      return true;
    }
    if (room.gamePhase === "playing") {
      const seat = game.getCurrentSeat();
      if (seat && seat.playerId === humanId) {
        const legal = game.legalPlays(seat.playerId, seat.isDummy);
        const card = legal[Math.floor(Math.random() * legal.length)];
        room.playCard(human, {
          card,
          isDummy: seat.isDummy,
          nominatedSuit: card.suit === "Joker" && !game.trumpSuit ? "♥" : undefined,
        });
        return true;
      }
    }
    return false;
  };

  while (room.gamePhase !== "gameOver" && ticks < maxTicks) {
    ticks += 1;
    // Exactly the question the timer asks, and nothing else — the watcher is
    // never told what just happened.
    const actor = room.botActor();
    if (actor) room.runBotTurn(actor);
    const moved = humanTurn();
    if (moved) humanMoves += 1;
    // If neither side has anything it can do, the table has stopped dead — which
    // is the failure a missed scheduling hook would have caused.
    assert.ok(
      actor || moved,
      `the table is stuck in phase "${room.gamePhase}" with nobody able to move`
    );
  }

  room.dispose();
  return { room, ticks, humanMoves, botId, humanId };
}

test("a robot plays a whole game through to a winner", (t) => {
  const { room, ticks, humanMoves } = playWithRobot(t);

  assert.equal(room.gamePhase, "gameOver", `game didn't finish (${ticks} ticks)`);
  assert.ok(room.winner, "somebody has to have won");
  assert.ok(humanMoves > 20, `the human only moved ${humanMoves} times`);
  // The human passed on every hand, so the robot bought and played all of them.
  assert.ok(room.scoreHistory.length > 0, "rounds should have been recorded");
  // Nobody's Elo moved, because a robot was at the table.
  assert.equal(recorded.elo.length, 0, "a game against a robot must not be rated");
});

test("the robot answers a claim rather than leaving the human hanging", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { room, human } = newRoom();
  room.addBot(fakeSocket("u0", "Player 0"));

  // Get to a point where the human is on lead in the play phase.
  for (let i = 0; i < 400 && room.gamePhase !== "playing"; i++) {
    const actor = room.botActor();
    if (actor) room.runBotTurn(actor);
    if (room.gamePhase === "bidding" && room.currentBidder === "u0") {
      room.placeBid(human, { bid: "Pass", points: 0 });
    } else if (room.gamePhase === "kitty" && room.game.currentBid?.player === "u0") {
      room.kittyDone(human, { newHand: room.game.players.find((p) => p.id === "u0").hand.slice(0, 10) });
    }
  }
  assert.equal(room.gamePhase, "playing");

  // Claim the rest from whichever of the human's seats is on lead.
  const seat = room.game.getCurrentSeat();
  if (seat.playerId !== "u0") return; // the robot leads this hand; nothing to claim
  room.claimRest(human);
  assert.ok(room.pendingClaim, "the claim is outstanding");

  // Answering a claim is what the watcher looks for before anything else, since
  // there's no other way for the table to move on.
  const actor = room.botActor();
  assert.equal(actor?.kind, "claim");
  room.runBotTurn(actor);
  assert.equal(room.pendingClaim, null, "the robot has to answer a claim");
  room.dispose();
});

// The watcher is a timer that re-arms itself, so what matters is that it keeps
// going without being told anything, and that it stops when it should.
test("the watcher re-arms itself and stops when the humans leave", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { room, human } = newRoom();
    room.addBot(fakeSocket("u0", "Player 0"));
    assert.ok(room.botTimer, "seating a robot starts the watcher");

    // Who bids first depends on a randomly chosen dealer, so put the robot on
    // turn deliberately — this is testing the timer, not the auction.
    room.currentBidder = room.botSlot().userId;
    t.mock.timers.tick(1000);
    assert.equal(room.biddingHistory.length, 1, "the timer should have made the robot call");
    assert.ok(room.botTimer, "and the watcher re-armed without being told to");

    // With nobody there to play against, it stops rather than ticking forever.
    room.handleDisconnect(human);
    t.mock.timers.tick(1000);
    assert.equal(room.botTimer, null, "the watcher should stop at an empty table");

    // And a reconnect starts it again.
    room.handleJoin(fakeSocket("u0", "Player 0"));
    assert.ok(room.botTimer, "rejoining restarts the watcher");
    room.dispose();
    assert.equal(room.botTimer, null, "dispose clears the timer");
  } finally {
    t.mock.timers.reset();
  }
});
