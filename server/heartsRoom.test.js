const test = require("node:test");
const assert = require("node:assert/strict");

// The room talks to Mongo and to socket.io. Both are replaced here before it is
// loaded, so whole games can be played out in process.
const db = require("./db");
const recorded = { rounds: [], elo: [] };
db.saveGame = async () => {};
db.getGame = async () => null;
db.listPublicWaitingGames = async () => [];
db.recordRound = async (round) => recorded.rounds.push(round);
db.applyElo = async (...args) => recorded.elo.push(args);

const { HeartsRoom } = require("./heartsRoom");
const heartsBot = require("./heartsBot");

function fakeIo() {
  const emitted = [];
  return { emitted, to: (to) => ({ emit: (event, payload) => emitted.push({ to, event, payload }) }) };
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

function newRoom({ variant = "blackLady", mode = 4, options = {}, humans = 1, bots = true, friendly = false } = {}) {
  const io = fakeIo();
  const slots = Array.from({ length: mode }, (_, seat) => {
    if (seat < humans) return { userId: `u${seat}`, name: `Player ${seat}` };
    return bots ? { userId: `bot:${seat}`, name: `Robot ${seat}`, isBot: true } : null;
  });
  const room = new HeartsRoom(
    "game-1",
    io,
    {
      gameType: "hearts",
      variant,
      mode,
      options,
      friendly,
      visibility: "public",
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

// A room dealt and under way, with the robots' timers taken out of it so a test
// drives every seat itself.
function dealtRoom(config = {}) {
  const { room, io } = newRoom(config);
  room.scheduleBotTurn = () => {};
  room.startRound(true);
  return { room, io };
}

const socketFor = (room, seat) => fakeSocket(room.slots[seat].userId, room.slots[seat].name);

// Everybody passes whatever the robot would have picked, which is three cards
// and therefore always legal.
function passAll(room) {
  for (let seat = 0; seat < room.mode; seat += 1) {
    room.pass(socketFor(room, seat), { cards: heartsBot.choosePass(room.game, seat) });
  }
}

// Plays the deal out with the robot's own choices, whoever is sitting there.
function playOut(room, limit = 3000) {
  let guard = 0;
  while (room.phase === "playing" && guard++ < limit) {
    const seat = room.game.currentSeat;
    const card = heartsBot.choosePlay(room.game, seat);
    room.play(socketFor(room, seat), { card });
  }
  return room.phase;
}

// ---- seating and dealing ----

test("a full table deals itself, and a rotating cycle opens on a pass", () => {
  const { room } = dealtRoom();
  assert.equal(room.phase, "passing");
  assert.equal(room.game.passDirection, "left");
  assert.equal(room.status, "active");
});

test("a rule set that doesn't pass is dealt straight into play", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  assert.equal(room.phase, "playing");
});

test("nobody can act out of phase", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  const socket = socketFor(room, 0);
  room.pass(socket, { cards: [] });
  assert.match(socket.received.at(-1).payload.message, /isn't what the table is waiting for/);
});

test("somebody who isn't at the table can't play at it", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  const stranger = fakeSocket("nobody", "Nobody");
  room.play(stranger, { card: { value: "2", suit: "♣" } });
  assert.match(stranger.received.at(-1).payload.message, /Sit at the table/);
});

// ---- passing ----

test("the table waits for all three-card passes before a card is led", () => {
  const { room } = dealtRoom();
  room.pass(socketFor(room, 0), { cards: heartsBot.choosePass(room.game, 0) });
  assert.equal(room.phase, "passing");
  passAll(room);
  assert.equal(room.phase, "playing");
});

test("a pass is nobody else's business until the deal has been scored", () => {
  const { room } = dealtRoom();
  passAll(room);
  const mine = room.stateFor("u0").history[0].calls.filter((c) => c.type === "pass");
  assert.equal(mine.filter((c) => c.cards).length, 1, "only your own cards are in there");
  assert.equal(mine.find((c) => c.seat === 0).cards.length, 3);
  playOut(room);
  assert.equal(room.phase, "roundEnd");
  const after = room.stateFor("u0").history.find((h) => h.round === 1).calls.filter((c) => c.type === "pass");
  assert.equal(after.filter((c) => c.cards).length, 4, "and everybody's once it is over");
});

test("your own three stay in front of you until the hand is led", () => {
  const { room } = dealtRoom();
  const chosen = heartsBot.choosePass(room.game, 0);
  room.pass(socketFor(room, 0), { cards: chosen });
  const state = room.stateFor("u0");
  assert.equal(state.game.passedCards.length, 3);
  assert.equal(state.game.players[0].passedOn, true);
  assert.equal(state.game.players[1].passedOn, false);
});

// ---- play ----

test("a deal plays out and lands on the round end with the points shared out", () => {
  const { room } = dealtRoom();
  passAll(room);
  assert.equal(playOut(room), "roundEnd");
  const total = room.lastResult.points.reduce((sum, n) => sum + n, 0);
  assert.ok(total === 26 || room.lastResult.moon, `26 points went somewhere, got ${total}`);
});

test("the table can't be made to play a card it isn't holding", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  const seat = room.game.currentSeat;
  const socket = socketFor(room, seat);
  // Everything but clubs, so the queen of spades is certainly not in there.
  room.game.players[seat].hand = [
    { value: "2", suit: "♣" },
    { value: "3", suit: "♣" },
  ];
  room.play(socket, { card: { value: "Q", suit: "♠" } });
  assert.match(socket.received.at(-1).payload.message, /can't play that card/);
});

test("a finished trick is announced before the board is cleared", () => {
  const { room, io } = dealtRoom({ variant: "earliest" });
  playOut(room, 8);
  assert.ok(io.emitted.some((e) => e.event === "hearts:trickResolved"));
});

// ---- scoring across deals ----

test("the lowest score wins, and the player who reached the target usually doesn't", () => {
  const { room } = dealtRoom({ variant: "earliest", options: { target: "5" } });
  let guard = 0;
  while (room.phase !== "gameOver" && guard++ < 60) {
    if (room.phase === "passing") passAll(room);
    if (room.phase === "playing") playOut(room);
    if (room.phase === "roundEnd") {
      room.roundNumber += 1;
      room.startRound();
    }
  }
  assert.equal(room.phase, "gameOver");
  const scores = room.game.players.map((p) => p.score);
  const lowest = Math.min(...scores);
  for (const seat of room.game.winners()) assert.equal(scores[seat], lowest);
});

test("a deal writes one row per player, so the record is of your own hands", () => {
  recorded.rounds.length = 0;
  const { room } = dealtRoom({ variant: "earliest" });
  playOut(room);
  assert.equal(recorded.rounds.length, 4);
  assert.deepEqual(
    recorded.rounds.map((r) => r.bidderUserId).sort(),
    ["bot:1", "bot:2", "bot:3", "u0"]
  );
  assert.ok(recorded.rounds.every((r) => r.gameType === "hearts" && r.variant === "earliest"));
  assert.ok(recorded.rounds.every((r) => typeof r.clean === "boolean"));
});

test("a table with a robot at it is friendly, and never moves anybody's rating", () => {
  recorded.elo.length = 0;
  const { room } = dealtRoom({ variant: "earliest", options: { target: "5" } });
  assert.equal(room.isFriendly(), true);
  let guard = 0;
  while (room.phase !== "gameOver" && guard++ < 60) {
    if (room.phase === "playing") playOut(room);
    if (room.phase === "roundEnd") {
      room.roundNumber += 1;
      room.startRound();
    }
  }
  assert.equal(recorded.elo.length, 0);
});

// ---- review and replay ----

test("a hand can be reconstructed from its own log, and replays the same way", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  playOut(room);
  const review = room.roundReview();
  assert.ok(review, "there is a review to look at");
  assert.equal(review.hands.length, 4);
  assert.equal(
    review.tricks.length,
    13,
    "every trick of the hand is in it"
  );
  assert.deepEqual(review.points, room.lastResult.points);
});

test("review needs the table to agree, and a lone human is the whole table", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  playOut(room);
  room.propose(socketFor(room, 0), { type: "review" });
  assert.ok(room.review, "nobody else to ask");
  assert.equal(room.stateFor("u0").review.yours, true);
});

test("a replay is unscored and puts the real hand back when it ends", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  playOut(room);
  const scores = room.game.players.map((p) => p.score);
  room.propose(socketFor(room, 0), { type: "replay" });
  assert.equal(room.replaying, true);
  assert.equal(room.phase, "playing");
  playOut(room);
  assert.equal(room.replaying, false);
  assert.equal(room.phase, "roundEnd");
  assert.deepEqual(room.game.players.map((p) => p.score), scores, "nothing counted");
  assert.equal(room.replayResult.points.length, 4);
});

// ---- what the client is told ----

test("a seat is only ever sent its own cards", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  const state = room.stateFor("u0");
  assert.equal(state.game.hand.length, 13);
  assert.ok(state.game.players.every((p) => p.handSize === 13));
  const others = state.game.players.filter((p) => p.seat !== 0);
  assert.ok(others.every((p) => !p.hand), "nobody else's cards are in the payload");
  // Nor anywhere else in it: a card someone else is holding should not appear.
  const theirs = room.game.players[1].hand[0];
  assert.ok(!JSON.stringify(state).includes(`"${theirs.value}","suit":"${theirs.suit}"`));
});

test("the payload says what each card in your hand would cost", () => {
  const { room } = dealtRoom({ variant: "earliest" });
  const state = room.stateFor("u0");
  assert.equal(state.game.penalties.length, state.game.hand.length);
  state.game.hand.forEach((card, i) => {
    assert.equal(state.game.penalties[i], card.suit === "♥" ? 1 : 0);
  });
});

test("a table of eleven is a table of eleven", () => {
  const { room } = dealtRoom({ variant: "cancellation", mode: 11 });
  assert.equal(room.stateFor("u0").game.players.length, 11);
  assert.equal(room.game.cardsPerPlayer(), 8);
});
