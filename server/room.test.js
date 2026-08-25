const test = require("node:test");
const assert = require("node:assert/strict");

// Room talks to Mongo and to socket.io. Both are replaced here before the room
// is loaded, so a whole hand can be played out in process.
const db = require("./db");
db.saveGame = async () => {};
db.deleteGame = async () => {};
db.getGame = async () => null;
db.createGame = async (game) => game;
db.recordRound = async () => {};
const eloCalls = [];
db.applyElo = async (...args) => eloCalls.push(args);
db.headToHead = async () => ({ wins: {}, played: 0 });

const { Room } = require("./room");
const { isFriendlyGame } = require("./friendly");

// Everything the server sends, in order, tagged with who it went to: a socket
// id for a per-user emit, the room id for a broadcast.
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
    emit: (event, payload) => received.push({ to: `sock-${userId}`, event, payload }),
  };
}

function newRoom() {
  const io = fakeIo();
  const room = new Room("game-1", io, {
    visibility: "private",
    playerSlots: [null, null],
    status: "waiting",
    roundNumber: 1,
    scoreHistory: [],
    snapshot: {},
  });
  const sockets = [fakeSocket("u0", "Alice"), fakeSocket("u1", "Bob")];
  sockets.forEach((s) => room.handleJoin(s));
  return { room, io, sockets };
}

// The same table with only one player at it, so the other chair is free for a
// robot to take.
function newSoloRoom() {
  const io = fakeIo();
  const room = new Room("game-1", io, {
    visibility: "private",
    playerSlots: [null, null],
    status: "waiting",
    roundNumber: 1,
    scoreHistory: [],
    snapshot: {},
  });
  const human = fakeSocket("u0", "Alice");
  room.handleJoin(human);
  return { room, io, human };
}

// Every payload this player could read off their own socket: their own
// per-user emits plus everything broadcast room-wide.
function seenBy(room, io, socket) {
  return [...io.emitted.filter((e) => e.to === room.id || e.to === socket.id), ...socket.received];
}

function findFor(room, io, socket, event) {
  const hits = seenBy(room, io, socket).filter((e) => e.event === event);
  assert.ok(hits.length, `${socket.userId} never received ${event}`);
  return hits[hits.length - 1].payload;
}

const cardKey = (c) => `${c.value}${c.suit}`;

// Every card anywhere in a payload, however deeply nested.
function cardsIn(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((v) => cardsIn(v, found));
    return found;
  }
  if (typeof value.suit === "string" && value.value !== undefined) found.push(value);
  Object.values(value).forEach((v) => cardsIn(v, found));
  return found;
}

// The auction, then the bidder's discard. Returns the winning bidder's socket.
function bidAndTakeKitty(room, sockets, bid = "7 ♠") {
  const bidder = sockets.find((s) => s.userId === room.currentBidder);
  const other = sockets.find((s) => s !== bidder);
  room.placeBid(bidder, { bid, points: 140 });
  room.placeBid(other, { bid: "Pass" });
  const hand = room.game.players.find((p) => p.id === bidder.userId).hand;
  room.kittyDone(bidder, { newHand: [...hand, ...room.game.kitty].slice(0, 10) });
  return bidder;
}

// Plays whichever card the seat on turn is allowed to play, by trying them
// until one is accepted — the two-player game has no bot to ask.
function playOneCard(room, sockets, mode) {
  const game = mode === "replay" ? room.replayGame : room.game;
  const seat = game.getCurrentSeat();
  const socket = sockets.find((s) => s.userId === seat.playerId);
  const player = game.players.find((p) => p.id === seat.playerId);
  const before = game.currentTrick.length;
  for (const card of [...(seat.isDummy ? player.dummyHand : player.hand)]) {
    room.playCard(socket, { card, isDummy: seat.isDummy, nominatedSuit: "♠", mode });
    if (game.currentTrick.length !== before) return { card, isDummy: seat.isDummy, playerId: seat.playerId };
  }
  throw new Error(`no legal card for ${seat.playerId}`);
}

function playOutRound(room, sockets, mode) {
  const played = [];
  for (let i = 0; i < 40; i++) {
    const game = mode === "replay" ? room.replayGame : room.game;
    if (!game || game.isRoundDecided()) break;
    played.push(playOneCard(room, sockets, mode));
  }
  return played;
}

test("each player is dealt their own cards and the other's count", () => {
  const { room, io, sockets } = newRoom();

  for (const socket of sockets) {
    const { players } = findFor(room, io, socket, "gameStart");
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.equal(mine.hand.length, 10);
    assert.equal(mine.handSize, undefined);
    assert.equal(theirs.hand, undefined, "the other player's cards must not be sent");
    assert.equal(theirs.handSize, 10);
  }
  // Nobody's hand rides along on a room-wide broadcast.
  assert.equal(io.emitted.filter((e) => e.to === room.id && e.event === "gameStart").length, 0);
});

test("each player is dealt their own dummy's cards and the other's count", () => {
  const { room, io, sockets } = newRoom();
  const bidder = bidAndTakeKitty(room, sockets);

  for (const socket of sockets) {
    const { players } = findFor(room, io, socket, "kittyPhaseComplete");
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.equal(mine.dummyHand.length, 10);
    assert.equal(mine.dummyHandSize, undefined);
    assert.equal(theirs.dummyHand, undefined, "the other dummy's cards must not be sent");
    assert.equal(theirs.dummyHandSize, 10);
  }
  // Nobody's dummy rides along on a room-wide broadcast.
  assert.equal(
    io.emitted.filter((e) => e.to === room.id && e.event === "kittyPhaseComplete").length,
    0
  );
  assert.ok(bidder);
});

test("none of the other player's cards are ever sent, all round", () => {
  const { room, io, sockets } = newRoom();

  // Everything the other player is holding, recorded as it's dealt to them and
  // struck off again as it's played for real — from that moment on it's public
  // and may appear in a payload. Snapshotted rather than read live off the
  // game, because a card that leaves their hand any other way (the bidder's
  // discard to the kitty) is still theirs alone until the round is over.
  const secrets = new Map(sockets.map((s) => [s.userId, new Set()]));
  const hide = () => {
    for (const socket of sockets) {
      const other = room.game.players.find((p) => p.id !== socket.userId);
      [...other.hand, ...other.dummyHand].forEach((c) => secrets.get(socket.userId).add(cardKey(c)));
    }
  };

  const check = () => {
    for (const socket of sockets) {
      const secret = secrets.get(socket.userId);
      for (const { event, payload } of seenBy(room, io, socket)) {
        for (const card of cardsIn(payload)) {
          assert.ok(
            !secret.has(cardKey(card)),
            `${socket.userId} was sent the other player's ${cardKey(card)} in "${event}"`
          );
        }
      }
    }
  };

  hide();
  check();
  // The bidder's hand is a different ten cards after the kitty, and neither
  // dummy exists until then.
  bidAndTakeKitty(room, sockets);
  hide();
  check();

  for (let i = 0; i < 40 && !room.game.isRoundDecided(); i++) {
    const play = playOneCard(room, sockets);
    secrets.forEach((secret) => secret.delete(cardKey(play.card)));
    check();
  }
  assert.equal(room.gamePhase === "roundEnd" || room.gamePhase === "gameOver", true);
});

test("reconnecting mid-round resends your own cards and their counts", () => {
  const { room, io, sockets } = newRoom();
  bidAndTakeKitty(room, sockets);
  playOneCard(room, sockets);

  for (const socket of sockets) {
    socket.received.length = 0;
    room.handleJoin(socket);
    const { players } = findFor(room, io, socket, "gameResumed");
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.ok(mine.hand.length >= 9);
    assert.ok(mine.dummyHand.length >= 9);
    assert.equal(theirs.hand, undefined);
    assert.equal(typeof theirs.handSize, "number");
    assert.equal(theirs.dummyHand, undefined);
    assert.equal(typeof theirs.dummyHandSize, "number");
  }
});

test("an Open Misère bidder's hand goes face up once they've lost a trick", () => {
  const { room, io, sockets } = newRoom();
  const bidder = bidAndTakeKitty(room, sockets, "Open Misere");
  const other = sockets.find((s) => s !== bidder);
  const bidderPlayer = room.game.players.find((p) => p.id === bidder.userId);
  const otherPlayer = room.game.players.find((p) => p.id === other.userId);

  // Rigged so the first trick is certain to go against the bidder: they lead
  // the four of spades and the other player's hand takes it with the king.
  // Left with a card each afterwards, so the round is still running.
  bidderPlayer.hand = [
    { suit: "♠", value: "4" },
    { suit: "♠", value: "5" },
  ];
  otherPlayer.hand = [
    { suit: "♠", value: "K" },
    { suit: "♠", value: "Q" },
  ];
  otherPlayer.dummyHand = [
    { suit: "♠", value: "6" },
    { suit: "♠", value: "7" },
  ];

  // Nothing has been revealed yet, so the deal's count is all there is.
  assert.equal(findFor(room, io, other, "gameStart").players.find((p) => p.id === bidder.userId).hand, undefined);

  for (let i = 0; i < 3; i++) playOneCard(room, sockets);
  assert.equal(bidderPlayer.tricksWon, 0);
  assert.equal(otherPlayer.tricksWon, 1);
  assert.equal(room.gamePhase, "playing");

  assert.deepEqual(findFor(room, io, other, "handsRevealed"), {
    players: [{ id: bidder.userId, hand: bidderPlayer.hand }],
  });
  // One-way: the bidder is owed nothing in return.
  assert.equal(
    seenBy(room, io, bidder).filter((e) => e.event === "handsRevealed").length,
    0,
    "the bidder must not be sent the other player's hand"
  );

  // And it's still face up after a reconnect, still only one way round.
  for (const socket of [other, bidder]) socket.received.length = 0;
  room.handleJoin(other);
  assert.deepEqual(
    findFor(room, io, other, "gameResumed").players.find((p) => p.id === bidder.userId).hand.map(cardKey),
    bidderPlayer.hand.map(cardKey)
  );
  room.handleJoin(bidder);
  const otherEntry = findFor(room, io, bidder, "gameResumed").players.find((p) => p.id === other.userId);
  assert.equal(otherEntry.hand, undefined);
  assert.equal(otherEntry.handSize, otherPlayer.hand.length);
});

test("a claim reveals the claimer's hand and dummy, and keeps them revealed", () => {
  const { room, io, sockets } = newRoom();
  const claimer = bidAndTakeKitty(room, sockets);
  const responder = sockets.find((s) => s !== claimer);
  const claimerPlayer = room.game.players.find((p) => p.id === claimer.userId);
  const claimerHand = claimerPlayer.hand;
  const claimerDummy = claimerPlayer.dummyHand;

  room.claimRest(claimer);
  const claim = findFor(room, io, responder, "claimReceived");
  assert.deepEqual(claim.claimerHand.map(cardKey), claimerHand.map(cardKey));
  assert.deepEqual(claim.claimerDummyHand.map(cardKey), claimerDummy.map(cardKey));

  // Declining keeps them face up for the rest of the round, including across a
  // reconnect — and still doesn't hand the claimer the responder's cards.
  room.respondToClaim(responder, false);
  responder.received.length = 0;
  room.handleJoin(responder);
  const resumed = findFor(room, io, responder, "gameResumed").players.find((p) => p.id === claimer.userId);
  assert.deepEqual(resumed.hand.map(cardKey), claimerHand.map(cardKey));
  assert.deepEqual(resumed.dummyHand.map(cardKey), claimerDummy.map(cardKey));

  claimer.received.length = 0;
  room.handleJoin(claimer);
  const claimerView = findFor(room, io, claimer, "gameResumed");
  const responderEntry = claimerView.players.find((p) => p.id === responder.userId);
  assert.equal(responderEntry.hand, undefined);
  assert.equal(responderEntry.handSize, 10);
  assert.equal(responderEntry.dummyHand, undefined);
  assert.equal(responderEntry.dummyHandSize, 10);
});

test("a replay hides the other player's cards too, freshly and on reconnect", () => {
  const { room, io, sockets } = newRoom();
  const bidder = bidAndTakeKitty(room, sockets);
  playOutRound(room, sockets);

  room.roundEndPropose(sockets[0], "replay");
  room.roundEndRespond(sockets[1], true);
  assert.equal(room.gamePhase, "replay");

  const replayHand = room.replayGame.players.find((p) => p.id === bidder.userId).hand;
  room.kittyDone(bidder, { newHand: [...replayHand, ...room.replayGame.kitty].slice(0, 10), mode: "replay" });

  const assertHidden = (socket, event, key = "dummyHand") => {
    const { players } = findFor(room, io, socket, event);
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.ok(Array.isArray(mine[key]), `${socket.userId} should see their own ${key} in ${event}`);
    assert.equal(theirs[key], undefined, `${event} leaked the other ${key} to ${socket.userId}`);
    assert.equal(typeof theirs[`${key}Size`], "number");
  };

  // The replay's own deal, then its dummy deal.
  sockets.forEach((s) => assertHidden(s, "replayStart", "hand"));
  sockets.forEach((s) => assertHidden(s, "replayKittyPhaseComplete"));
  assert.equal(io.emitted.filter((e) => e.to === room.id && e.event === "replayStart").length, 0);

  for (const socket of sockets) {
    socket.received.length = 0;
    room.handleJoin(socket);
    assertHidden(socket, "replayStart", "hand");
    assertHidden(socket, "replayStart");
    assertHidden(socket, "replayKittyPhaseComplete");
  }
});

// ---- robots ----

// This game had no robot until recently, and the wiring is what these cover:
// seating one, keeping it out of the human head-count, and — the one that
// matters — that a whole game can be played against it without the table ever
// stopping dead waiting for a move nobody is going to make.

test("a robot takes the empty chair and the game starts", () => {
  const { room } = newSoloRoom();
  assert.equal(room.game, null, "nothing dealt while a chair is empty");

  room.addBot(fakeSocket("u0", "Alice"));

  assert.ok(room.slots.every(Boolean), "both chairs are taken");
  assert.equal(room.botSlot().isBot, true);
  assert.match(room.botSlot().name, /robot/, "the robot is named as one");
  assert.ok(room.game, "the hand is dealt once the table is full");
  assert.equal(room.gamePhase, "bidding");
  assert.equal(room.game.players[0].hand.length, 10);
  assert.equal(room.game.players[1].hand.length, 10);
  room.dispose();
});

test("a table with a robot at it is never rated", () => {
  const { room } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));
  assert.equal(room.isFriendly(), true);
  // And it survives persistence, which is what the lobby and stats read.
  assert.equal(isFriendlyGame({ friendly: false, playerSlots: room.slots }), true);
  room.dispose();
});

test("a robot doesn't count as somebody being at the table", () => {
  const { room, human } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));
  assert.equal(room.connectedHumans(), 1);
  room.handleDisconnect(human);
  assert.equal(room.connectedHumans(), 0, "a robot alone is an empty table");
  room.dispose();
});

test("the empty chair can't be given away once the cards are out", () => {
  const { room } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));
  const before = room.slots.map((s) => s.userId);
  room.addBot(fakeSocket("u0", "Alice"));
  assert.deepEqual(room.slots.map((s) => s.userId), before);
  room.dispose();
});

test("only someone sitting at the table may seat a robot", () => {
  const { room } = newSoloRoom();
  room.addBot(fakeSocket("someone-else", "Passer-by"));
  assert.equal(room.botSlot(), null, "a stranger can't seat a robot here");
  assert.equal(room.game, null);
});

// /api/games seats a robot in the second chair up front (rather than through
// addBot) when a two-player game is started with "against a robot" ticked.
// The game document it hands to Room already has both slots filled, so this
// is what the host's very first join sees — addBot is never called.
test("a two-player game created with its robot seat pre-filled deals as soon as the host joins", () => {
  const io = fakeIo();
  const room = new Room("game-1", io, {
    visibility: "private",
    friendly: true,
    playerSlots: [null, { userId: "bot:1", name: "Ada (robot)", isBot: true }],
    status: "waiting",
    roundNumber: 1,
    scoreHistory: [],
    snapshot: {},
  });

  room.handleJoin(fakeSocket("u0", "Alice"));

  assert.ok(room.slots.every(Boolean), "both chairs are taken");
  assert.equal(room.botSlot().isBot, true);
  assert.equal(room.slots.length, 2, "still a two-player table, not four");
  assert.ok(room.game, "the hand is dealt as soon as the only human sits down");
  assert.equal(room.gamePhase, "bidding");
  room.dispose();
});

// The real test of the wiring. A robot's turn can begin after a bid, a discard,
// a card, a trick resolving, a round ending or an offer being answered. Nothing
// here tells the watcher what happened — it is only ever asked "is there
// anything for you to do?", exactly as the timer does in production, so a
// transition it fails to notice shows up as a table that has stopped dead.
function playWithRobot(t, { maxTicks = 6000 } = {}) {
  // The watcher arms real timers and re-arms itself, which would outlive the
  // test. Mock timers that are never ticked let it arm all it likes without
  // anything firing behind our back — this loop does the asking itself.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { room, human } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));
  const humanId = "u0";

  let ticks = 0;
  let humanMoves = 0;

  const humanTurn = () => {
    const game = room.game;
    if (!game) return false;

    // The robot can start an offer of its own now, and it will sit and wait for
    // the answer. A real client puts that in front of the player as a modal they
    // have to deal with; without the same here the table hangs, which is a
    // property of this fake human rather than of the room.
    if (room.pendingOffer && room.pendingOffer.fromPlayerId !== humanId) {
      room.respondToOffer(human, false);
      return true;
    }

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
      const hand = game.players.find((p) => p.id === humanId).hand;
      room.kittyDone(human, { newHand: [...hand].slice(0, 10) });
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
    const actor = room.botActor();
    if (actor) room.runBotTurn(actor);
    const moved = humanTurn();
    if (moved) humanMoves += 1;
    assert.ok(
      actor || moved,
      `the table is stuck in phase "${room.gamePhase}" with nobody able to move`
    );
  }

  room.dispose();
  return { room, ticks, humanMoves };
}

test("a robot plays a whole game through to a winner", (t) => {
  const before = eloCalls.length;
  const { room, ticks, humanMoves } = playWithRobot(t);

  assert.equal(room.gamePhase, "gameOver", `the game didn't finish (${ticks} ticks)`);
  assert.ok(room.winner, "somebody has to have won");
  assert.ok(humanMoves > 20, `the human only moved ${humanMoves} times`);
  assert.ok(room.scoreHistory.length > 0, "rounds should have been recorded");
  assert.equal(eloCalls.length, before, "a game against a robot must not be rated");
});

test("the robot answers a claim rather than leaving the human hanging", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { room, human } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));

  for (let i = 0; i < 400 && room.gamePhase !== "playing"; i++) {
    const actor = room.botActor();
    if (actor) room.runBotTurn(actor);
    if (room.gamePhase === "bidding" && room.currentBidder === "u0") {
      room.placeBid(human, { bid: "Pass", points: 0 });
    } else if (room.gamePhase === "kitty" && room.game.currentBid?.player === "u0") {
      const hand = room.game.players.find((p) => p.id === "u0").hand;
      room.kittyDone(human, { newHand: [...hand].slice(0, 10) });
    }
  }
  assert.equal(room.gamePhase, "playing");

  const seat = room.game.getCurrentSeat();
  if (seat.playerId !== "u0") {
    room.dispose();
    return; // the robot leads this hand; nothing for the human to claim
  }
  room.claimRest(human);
  assert.ok(room.pendingClaim, "the claim is outstanding");

  // Answering is what the watcher looks for before anything else, since there's
  // no other way for the table to move on.
  const actor = room.botActor();
  assert.equal(actor?.kind, "claim");
  room.runBotTurn(actor);
  assert.equal(room.pendingClaim, null, "the robot has to answer a claim");
  room.dispose();
});

test("the watcher re-arms itself and stops when the humans leave", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { room, human } = newSoloRoom();
    room.addBot(fakeSocket("u0", "Alice"));
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
    room.handleJoin(fakeSocket("u0", "Alice"));
    assert.ok(room.botTimer, "rejoining restarts the watcher");
    room.dispose();
    assert.equal(room.botTimer, null, "dispose clears the timer");
  } finally {
    t.mock.timers.reset();
  }
});

// ---- offering a pass ----

// The robot on lead with a hand it doesn't fancy and the game nearly gone.
// Rigging the hand rather than dealing for it: chooseBid has to want to pass, or
// the offer never comes up.
function tableWithBotOnLead(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { room, human } = newSoloRoom();
  room.addBot(fakeSocket("u0", "Alice"));
  const botId = room.botSlot().userId;

  // Honours without length: too much in it to duck out on a Misère, not enough
  // to bid on. Same shape bot2.test.js uses for a hand worth nothing.
  room.game.players.find((p) => p.id === botId).hand = [
    { value: "Q", suit: "♠" }, { value: "9", suit: "♠" }, { value: "J", suit: "♥" },
    { value: "8", suit: "♥" }, { value: "Q", suit: "♦" }, { value: "7", suit: "♦" },
    { value: "J", suit: "♣" }, { value: "6", suit: "♣" }, { value: "5", suit: "♣" },
    { value: "4", suit: "♣" },
  ];
  room.gamePhase = "bidding";
  room.currentBidder = botId;
  room.biddingHistory = [];
  return { room, human, botId };
}

test("the robot offers a pass rather than opening one with the game nearly gone", (t) => {
  const { room, human, botId } = tableWithBotOnLead(t);
  room.game.players.find((p) => p.id !== botId).score = 460;

  const actor = room.botActor();
  assert.equal(actor?.kind, "offerPass");
  room.runBotTurn(actor);
  assert.equal(room.pendingOffer?.type, "pass");
  assert.equal(room.pendingOffer.fromPlayerId, botId);

  // Its own offer is outstanding, so it must sit still — placeBid only checks
  // whose turn it is, and answering your own question by bidding is not an
  // auction anyone can follow.
  assert.equal(room.botActor(), null, "nothing to do until the offer is answered");

  // Declined, it goes back to bidding and never asks twice.
  room.respondToOffer(human, false);
  assert.equal(room.offerPassDeclined, true);
  assert.equal(room.botActor()?.kind, "bid");
  room.dispose();
});

test("the robot opens normally when the score isn't close", (t) => {
  const { room, botId } = tableWithBotOnLead(t);
  room.game.players.find((p) => p.id !== botId).score = 40;
  assert.equal(room.botActor()?.kind, "bid", "nothing at stake — just call");
  room.dispose();
});

// The button is a table setting, and the robot is held to the same one.
test("the robot won't offer a pass the table has switched off", (t) => {
  const { room, botId } = tableWithBotOnLead(t);
  room.game.players.find((p) => p.id !== botId).score = 460;
  room.gameSettings.showOfferPassButton = false;
  assert.equal(room.botActor()?.kind, "bid");
  room.dispose();
});

// offerPass is an opening-call thing: once a bid is in, a pass ends the auction
// instead of redealing, so the offer would mean something quite different.
test("the robot doesn't offer a pass once the auction has started", (t) => {
  const { room, botId } = tableWithBotOnLead(t);
  room.game.players.find((p) => p.id !== botId).score = 460;
  room.biddingHistory = [{ player: "u0", bid: "6 ♠", points: 40 }];
  assert.equal(room.botActor()?.kind, "bid");
  room.dispose();
});
