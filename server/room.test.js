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

test("the other player's dummy cards are never sent, all round", () => {
  const { room, io, sockets } = newRoom();
  bidAndTakeKitty(room, sockets);

  // Snapshotted at the deal, then each card struck off as it's played for
  // real: from that moment on it's public and may appear in a payload.
  const secrets = new Map(
    sockets.map((s) => {
      const other = room.game.players.find((p) => p.id !== s.userId);
      return [s.userId, new Set(other.dummyHand.map(cardKey))];
    })
  );

  const check = () => {
    for (const socket of sockets) {
      const secret = secrets.get(socket.userId);
      for (const { event, payload } of seenBy(room, io, socket)) {
        for (const card of cardsIn(payload)) {
          assert.ok(
            !secret.has(cardKey(card)),
            `${socket.userId} was sent ${cardKey(card)} from the other dummy in "${event}"`
          );
        }
      }
    }
  };

  check();
  for (let i = 0; i < 40 && !room.game.isRoundDecided(); i++) {
    const play = playOneCard(room, sockets);
    if (play.isDummy) secrets.forEach((secret) => secret.delete(cardKey(play.card)));
    check();
  }
  assert.equal(room.gamePhase === "roundEnd" || room.gamePhase === "gameOver", true);
});

test("reconnecting mid-round resends your own dummy and their count", () => {
  const { room, io, sockets } = newRoom();
  bidAndTakeKitty(room, sockets);
  playOneCard(room, sockets);

  for (const socket of sockets) {
    socket.received.length = 0;
    room.handleJoin(socket);
    const { players } = findFor(room, io, socket, "gameResumed");
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.ok(mine.dummyHand.length >= 9);
    assert.equal(theirs.dummyHand, undefined);
    assert.equal(typeof theirs.dummyHandSize, "number");
  }
});

test("a claim reveals the claimer's dummy, and keeps it revealed", () => {
  const { room, io, sockets } = newRoom();
  const claimer = bidAndTakeKitty(room, sockets);
  const responder = sockets.find((s) => s !== claimer);
  const claimerDummy = room.game.players.find((p) => p.id === claimer.userId).dummyHand;

  room.claimRest(claimer);
  const claim = findFor(room, io, responder, "claimReceived");
  assert.deepEqual(claim.claimerDummyHand.map(cardKey), claimerDummy.map(cardKey));

  // Declining keeps it face up for the rest of the round, including across a
  // reconnect — and still doesn't hand the claimer the responder's dummy.
  room.respondToClaim(responder, false);
  responder.received.length = 0;
  room.handleJoin(responder);
  const resumed = findFor(room, io, responder, "gameResumed");
  assert.deepEqual(
    resumed.players.find((p) => p.id === claimer.userId).dummyHand.map(cardKey),
    claimerDummy.map(cardKey)
  );

  claimer.received.length = 0;
  room.handleJoin(claimer);
  const claimerView = findFor(room, io, claimer, "gameResumed");
  const responderEntry = claimerView.players.find((p) => p.id === responder.userId);
  assert.equal(responderEntry.dummyHand, undefined);
  assert.equal(responderEntry.dummyHandSize, 10);
});

test("a replay hides the other dummy too, freshly and on reconnect", () => {
  const { room, io, sockets } = newRoom();
  const bidder = bidAndTakeKitty(room, sockets);
  playOutRound(room, sockets);

  room.roundEndPropose(sockets[0], "replay");
  room.roundEndRespond(sockets[1], true);
  assert.equal(room.gamePhase, "replay");

  const replayHand = room.replayGame.players.find((p) => p.id === bidder.userId).hand;
  room.kittyDone(bidder, { newHand: [...replayHand, ...room.replayGame.kitty].slice(0, 10), mode: "replay" });

  const assertHidden = (socket, event) => {
    const { players } = findFor(room, io, socket, event);
    const mine = players.find((p) => p.id === socket.userId);
    const theirs = players.find((p) => p.id !== socket.userId);
    assert.ok(Array.isArray(mine.dummyHand), `${socket.userId} should see their own dummy in ${event}`);
    assert.equal(theirs.dummyHand, undefined, `${event} leaked the other dummy to ${socket.userId}`);
    assert.equal(typeof theirs.dummyHandSize, "number");
  };

  sockets.forEach((s) => assertHidden(s, "replayKittyPhaseComplete"));

  for (const socket of sockets) {
    socket.received.length = 0;
    room.handleJoin(socket);
    assertHidden(socket, "replayStart");
    assertHidden(socket, "replayKittyPhaseComplete");
  }
});
