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
db.applyElo = async () => {};
db.headToHead = async () => ({ wins: {}, played: 0 });

const { Room } = require("./room");

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
