const test = require("node:test");
const assert = require("node:assert/strict");

// Room4 talks to Mongo and to socket.io. Both are replaced here before the room
// is loaded, so a whole game can be played out in process.
const db = require("./db");
db.saveGame = async () => {};
db.deleteGame = async () => {};
db.getGame = async () => null;
db.listPublicWaitingGames = async () => [];

const { Room4 } = require("./room4");
const bot = require("./bot");

function fakeIo() {
  const emitted = [];
  const target = (to) => ({
    emit: (event, payload) => emitted.push({ to, event, payload }),
  });
  return { emitted, to: target };
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

function newRoom({ options = {}, humans = 1, partnerMode = "random" } = {}) {
  const io = fakeIo();
  const slots = [];
  for (let i = 0; i < humans; i++) slots.push({ userId: `u${i}`, name: `Player ${i}` });
  for (let i = humans; i < 4; i++) {
    slots.push({ userId: `bot${i}`, name: bot.botName(i), isBot: true });
  }
  const room = new Room4(
    "game-1",
    io,
    {
      mode: 4,
      visibility: "public",
      options,
      partnerMode,
      hostUserId: "u0",
      playerSlots: slots,
      status: "waiting",
      roundNumber: 1,
      scoreHistory: [],
      snapshot: {},
    },
    null
  );
  return { room, io };
}

// Robots act on a timer so a table of them is watchable; a test wants them to
// act now, so their pending turn is pulled forward until it's a human's move.
function runRobots(room) {
  for (let guard = 0; guard < 500; guard++) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    const seat = room.botActorSeat();
    if (seat === null) return;
    room.runBotTurn(seat);
  }
  throw new Error("the robots never stopped");
}

// Takes whichever turn is the human's, using the same judgement the robots use.
function takeHumanTurn(room, socket) {
  const game = room.game;
  const seat = game.seatOf(socket.userId);
  if (room.phase === "bidding" && game.auction?.turnSeat === seat) {
    room.placeBid(socket, { bid: bot.chooseBid(game, seat) });
    return true;
  }
  if (room.phase === "kitty" && game.currentBid?.seat === seat) {
    room.discard(socket, { keep: bot.chooseDiscard(game, seat) });
    return true;
  }
  if (room.phase === "playing" && game.currentSeat === seat) {
    const choice = bot.choosePlay(game, seat);
    room.playCard(socket, { card: choice.card, nominatedSuit: choice.nominatedSuit });
    return true;
  }
  if (room.phase === "roundEnd") {
    room.readyForNextRound(socket);
    return true;
  }
  return false;
}

function playToTheEnd(room, socket, maxSteps = 4000) {
  for (let step = 0; step < maxSteps; step++) {
    runRobots(room);
    if (room.phase === "gameOver") return true;
    if (!takeHumanTurn(room, socket)) {
      throw new Error(`nobody can move: phase ${room.phase}`);
    }
  }
  return false;
}

test("a table of robots deals itself the moment the host sits down", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  assert.equal(room.phase, "bidding");
  assert.equal(room.status, "active");
  assert.ok(room.game);
  assert.deepEqual(
    room.game.players.map((p) => p.hand.length),
    [10, 10, 10, 10]
  );
  room.dispose();
});

test("a game with robots plays through to a winner", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  assert.equal(playToTheEnd(room, host), true, "the game never finished");
  assert.equal(room.status, "finished");
  assert.ok(room.winner, "somebody should have won");
  assert.ok(
    room.winner.score >= 500 || room.game.teamScores.some((s) => s <= -500),
    `won at ${room.winner.score}`
  );
  assert.ok(room.roundNumber > 1);
  assert.equal(room.scoreHistory.length, room.roundNumber);
  room.dispose();
});

test("it plays through on every house rule too", () => {
  const rulesets = [
    { misereAnytime: true, hiLo: true, doubleNullo: true, blindMisere: true, splitTheColours: true },
    { allPassNoTrump: true, trickPoints: false, slamBonus: false, ralphing: true, j5: true },
    { mustBidToWin: true, pointSpread: true, backDoor: false, jokerLeadAnytime: false },
  ];
  for (const options of rulesets) {
    const { room } = newRoom({ options });
    const host = fakeSocket("u0", "Player 0");
    room.handleJoin(host);
    assert.equal(playToTheEnd(room, host), true, `unfinished under ${JSON.stringify(options)}`);
    room.dispose();
  }
});

test("a player only ever sees their own cards", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  runRobots(room);

  const state = room.stateFor("u0");
  const seat = state.you.seat;
  assert.equal(state.you.hand.length + (room.phase === "kitty" ? 0 : 0), state.seats[seat].handCount);
  for (const other of state.seats) {
    if (other.seat === seat) continue;
    assert.equal(other.cards, undefined, "other seats carry counts, not cards");
  }
  // Nothing is face up unless a contract says so.
  assert.deepEqual(state.revealedHands, {});
  room.dispose();
});

test("an Open Misère bidder's hand goes face up after the first trick", () => {
  const { room } = newRoom({ options: { openMisere: true } });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  // Force the contract rather than waiting for one to be bid.
  const game = room.game;
  const bidderSeat = (game.seatOf("u0") + 1) % 4;
  game.auction.complete = true;
  game.auction.highBid = { seat: bidderSeat, bid: "Open Misere", points: 500, rank: 102.5 };
  room.finishAuction();
  runRobots(room);

  assert.equal(room.game.currentBid.bid, "Open Misere");
  const before = room.stateFor("u0");
  if (room.game.playedCards.length < 3) {
    assert.deepEqual(before.revealedHands, {}, "nothing shows before the first trick");
  }

  // Play the first trick out.
  for (let i = 0; i < 8 && room.game.playedCards.length < 3; i++) {
    runRobots(room);
    if (room.phase !== "playing") break;
    takeHumanTurn(room, host);
  }
  if (room.phase === "playing") {
    const after = room.stateFor("u0");
    assert.deepEqual(Object.keys(after.revealedHands), [String(bidderSeat)]);
  }
  room.dispose();
});

test("the host chooses the pairing when they didn't ask for random", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const sockets = [0, 1, 2, 3].map((i) => fakeSocket(`u${i}`, `Player ${i}`));
  sockets.forEach((socket) => room.handleJoin(socket));

  assert.equal(room.phase, "seating");
  assert.equal(room.game, null);

  // Only the host may set it.
  room.choosePartner(sockets[1], { partnerUserId: "u0" });
  assert.equal(room.game, null);

  room.choosePartner(sockets[0], { partnerUserId: "u2" });
  assert.ok(room.game);
  const seatOf = (id) => room.game.seatOf(id);
  assert.equal(room.game.teamOf(seatOf("u0")), room.game.teamOf(seatOf("u2")));
  assert.notEqual(room.game.teamOf(seatOf("u0")), room.game.teamOf(seatOf("u1")));
  room.dispose();
});

test("a full table turns away a fifth player, and a dealt game turns away everyone", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  [0, 1, 2, 3].forEach((i) => room.handleJoin(fakeSocket(`u${i}`, `Player ${i}`)));

  const late = fakeSocket("u9", "Latecomer");
  room.handleJoin(late);
  assert.match(late.received.at(-1).payload.message, /full/);

  room.choosePartner(fakeSocket("u0", "Player 0"), { random: true });
  const later = fakeSocket("u8", "Even later");
  room.handleJoin(later);
  assert.match(later.received.at(-1).payload.message, /under way/);
  room.dispose();
});

test("the rules are fixed once the cards are out", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  [1, 2, 3].forEach((i) => room.handleJoin(fakeSocket(`u${i}`, `Player ${i}`)));

  room.setOptions(host, { hiLo: true });
  assert.equal(room.options.hiLo, true);
  room.choosePartner(host, { random: true });
  room.setOptions(host, { hiLo: false });
  assert.equal(room.options.hiLo, true, "options are frozen once dealt");
  room.dispose();
});

test("a Ralphed bidder sits out the next auction", () => {
  const { room } = newRoom({ options: { ralphing: true } });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  const game = room.game;
  const seat = 0;
  game.auction.complete = true;
  game.auction.highBid = { seat, bid: "10 ♥", points: 500, rank: 103 };
  game.completeBidding();
  game.players.forEach((p) => {
    p.hand = [];
    p.tricksWon = 0;
  });
  game.players[1].tricksWon = 6;
  game.players[3].tricksWon = 4;
  room.phase = "playing";
  room.finishRound();

  assert.equal(room.ralphedSeat, seat);
  if (room.phase === "roundEnd") {
    room.readyForNextRound(host);
    assert.ok(room.game.auction.barredSeats.includes(seat));
    assert.equal(room.game.bidLegality(seat, "6 ♠").ok, false);
  }
  room.dispose();
});
