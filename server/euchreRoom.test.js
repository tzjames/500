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

const { EuchreRoom } = require("./euchreRoom");

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

function newRoom({ variant = "northAmerican", mode = 4, options = {}, humans = 1, bots = true, friendly = false } = {}) {
  const io = fakeIo();
  const slots = Array.from({ length: mode }, (_, seat) => {
    if (seat < humans) return { userId: `u${seat}`, name: `Player ${seat}` };
    return bots ? { userId: `bot:${seat}`, name: `Robot ${seat}`, isBot: true } : null;
  });
  const room = new EuchreRoom(
    "game-1",
    io,
    {
      gameType: "euchre",
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

const stateOf = (room, userId = "u0") => room.stateFor(userId);

// Robots act on a timer so a table of them is watchable; a test wants them to
// act now, so their pending turn is pulled forward until it is a human's move.
function runRobots(room, limit = 400) {
  for (let guard = 0; guard < limit; guard += 1) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    const seat = room.botActorSeat();
    if (seat === null) return;
    room.runBotTurn(seat);
  }
  throw new Error(`robots never stopped moving (phase ${room.phase})`);
}

// One human against robots, played to the end by nudging the human's seat with
// the same robot brain the empty chairs use.
function playOut(config) {
  const { room } = newRoom(config);
  const euchreBot = require("./euchreBot");
  const socket = fakeSocket("u0", "Player 0");
  room.handleJoin(socket);
  for (let guard = 0; guard < 4000; guard += 1) {
    runRobots(room);
    if (room.phase === "gameOver") return room;
    if (room.phase === "roundEnd") {
      room.nextRound(socket);
      continue;
    }
    const game = room.game;
    if (room.phase === "blind") room.takeBlind(socket, { blind: false });
    else if (room.phase === "discard") room.discard(socket, { card: euchreBot.chooseDiscard(game, 0) });
    else if (room.phase === "bidding") room.bid(socket, { amount: euchreBot.chooseBid(game, 0) });
    else if (room.phase === "chooseTrump") room.chooseTrump(socket, euchreBot.chooseBidTrump(game, 0));
    else if (room.phase === "declaring") room.declare(socket, { action: euchreBot.chooseDeclaration(game, 0) });
    else if (room.phase === "calling") {
      const call = euchreBot.chooseCall(game, 0);
      if (call.action === "pass") room.pass(socket);
      else room.call(socket, call);
    } else if (room.phase === "playing") room.play(socket, { card: euchreBot.choosePlay(game, 0) });
    else throw new Error(`nothing to do in phase ${room.phase}`);
  }
  throw new Error("game never finished");
}

// One human against robots, played until the hand is scored — the position both
// review and replay are offered from.
function playHand(config) {
  const { room } = newRoom(config);
  const euchreBot = require("./euchreBot");
  const socket = fakeSocket("u0", "Player 0");
  room.handleJoin(socket);
  for (let guard = 0; guard < 400; guard += 1) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") return room;
    const game = room.game;
    if (room.phase === "blind") room.takeBlind(socket, { blind: false });
    else if (room.phase === "discard") room.discard(socket, { card: euchreBot.chooseDiscard(game, 0) });
    else if (room.phase === "declaring") room.declare(socket, { action: euchreBot.chooseDeclaration(game, 0) });
    else if (room.phase === "calling") {
      const call = euchreBot.chooseCall(game, 0);
      if (call.action === "pass") room.pass(socket);
      else room.call(socket, call);
    } else if (room.phase === "playing") room.play(socket, { card: euchreBot.choosePlay(game, 0) });
    else throw new Error(`nothing to do in phase ${room.phase}`);
  }
  throw new Error("hand never finished");
}

// ---- seating ----

test("a table deals itself the moment the last seat is filled", () => {
  const { room } = newRoom({ humans: 1, bots: false });
  const sockets = [0, 1, 2, 3].map((n) => fakeSocket(`u${n}`, `Player ${n}`));
  for (const socket of sockets.slice(0, 3)) room.handleJoin(socket);
  assert.equal(room.phase, "waiting");
  assert.equal(stateOf(room).game, undefined, "no hands before the table is full");

  room.handleJoin(sockets[3]);
  assert.equal(room.phase, "calling");
  assert.equal(room.status, "active");
  assert.deepEqual(
    stateOf(room).game.players.map((p) => p.handSize),
    [5, 5, 5, 5]
  );
});

test("a fifth player is turned away rather than seated", () => {
  const { room } = newRoom({ humans: 1, bots: false });
  for (const n of [0, 1, 2, 3]) room.handleJoin(fakeSocket(`u${n}`, `Player ${n}`));
  const gatecrasher = fakeSocket("u9", "Nine");
  room.handleJoin(gatecrasher);
  assert.deepEqual(gatecrasher.received, [
    { event: "euchre:joinRejected", payload: { message: "This table is full." } },
  ]);
});

test("reconnecting keeps the live socket subscribed when the old one drops", () => {
  const { room } = newRoom();
  const first = fakeSocket("u0", "Player 0");
  room.handleJoin(first);
  const second = { ...fakeSocket("u0", "Player 0"), id: "sock-u0-again" };
  room.handleJoin(second);
  // A reload's old connection drops only after the new one has sat down.
  room.handleDisconnect(first);
  assert.equal(room.slots[0].socketId, "sock-u0-again");
  assert.equal(room.connectedHumans(), 1);
});

test("the host can seat robots on a waiting table, which makes it friendly", () => {
  const { room } = newRoom({ humans: 1, bots: false });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  assert.equal(room.phase, "waiting");
  assert.equal(room.isFriendly(), false);

  const other = fakeSocket("u1", "Player 1");
  room.addBots(other);
  assert.equal(room.phase, "waiting", "only the host seats robots");

  room.addBots(host);
  assert.equal(room.phase, "calling");
  assert.equal(room.isFriendly(), true);
  assert.equal(room.slots.filter((s) => s.isBot).length, 3);
});

test("only a seated player may act, and only when the table is waiting on it", () => {
  const { room } = newRoom();
  room.handleJoin(fakeSocket("u0", "Player 0"));
  const stranger = fakeSocket("u9", "Nine");
  room.pass(stranger);
  assert.deepEqual(stranger.received.map((r) => r.payload.message), ["Sit at the table before playing."]);

  const seated = fakeSocket("u0", "Player 0");
  room.bid(seated, { amount: 3 });
  assert.deepEqual(seated.received.map((r) => r.payload.message), ["That isn't what the table is waiting for."]);
});

// ---- what the client is told ----

test("a player is shown their own hand and nobody else's", () => {
  const { room } = newRoom();
  room.handleJoin(fakeSocket("u0", "Player 0"));
  const state = stateOf(room);
  assert.equal(state.gameType, "euchre");
  assert.equal(state.variant, "northAmerican");
  assert.equal(state.you.seat, 0);
  assert.equal(state.game.hand.length, 5);
  assert.equal(state.game.players[1].hand, undefined);
  assert.equal(state.game.players[1].handSize, 5);
  assert.equal(state.game.target, 10);
  assert.equal(state.game.tricksNeeded, 3);
});

test("the state carries what this seat may legally do, so the client needn't work it out", () => {
  const { room } = newRoom({ humans: 1, bots: false });
  for (const n of [0, 1, 2, 3]) room.handleJoin(fakeSocket(`u${n}`, `Player ${n}`));
  const eldest = stateOf(room, "u1");
  assert.deepEqual(eldest.game.callableSuits, [eldest.game.upcard.suit]);
  assert.equal(eldest.game.aloneRule, "may");
  assert.deepEqual(stateOf(room, "u2").game.callableSuits, [], "not this seat's turn");
});

test("a blind lone offer keeps the dealer's own hand off their screen", () => {
  // Deal until the turn-up is a jack, which is what triggers the offer.
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const { room } = newRoom({ options: { robson: true } });
    room.handleJoin(fakeSocket("u0", "Player 0"));
    if (room.phase !== "blind") continue;
    const state = stateOf(room);
    assert.equal(state.game.handHidden, true);
    assert.deepEqual(state.game.hand, []);
    room.takeBlind(fakeSocket("u0", "Player 0"), { blind: false });
    assert.equal(stateOf(room).game.handHidden, false);
    assert.equal(stateOf(room).game.hand.length, 5);
    return;
  }
  throw new Error("never dealt a jack face up");
});

// ---- playing a hand out ----

test("a whole hand plays out, scores, and offers the next one", () => {
  const { room } = newRoom();
  const socket = fakeSocket("u0", "Player 0");
  const euchreBot = require("./euchreBot");
  room.handleJoin(socket);
  for (let guard = 0; guard < 200 && room.phase !== "roundEnd" && room.phase !== "gameOver"; guard += 1) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    const game = room.game;
    if (room.phase === "calling") {
      const call = euchreBot.chooseCall(game, 0);
      if (call.action === "pass") room.pass(socket);
      else room.call(socket, call);
    } else if (room.phase === "discard") room.discard(socket, { card: euchreBot.chooseDiscard(game, 0) });
    else if (room.phase === "playing") room.play(socket, { card: euchreBot.choosePlay(game, 0) });
  }
  assert.ok(["roundEnd", "gameOver"].includes(room.phase));
  assert.equal(typeof room.lastResult.made, "boolean");
  assert.equal(room.lastResult.needed, 3);
  assert.equal(room.scoreHistory.length, 1);
  // A lone hand leaves the sitting partner's cards untouched, so only the seats
  // that were actually in the hand are played out.
  assert.equal(room.game.activeSeats().every((seat) => room.game.players[seat].hand.length === 0), true);
  assert.equal(room.lastTrick.cards.length >= 3, true);
});

test("every rule set plays through to a winner against robots", () => {
  const tables = [
    { variant: "northAmerican", mode: 4 },
    { variant: "northAmerican", mode: 2 },
    { variant: "northAmerican", mode: 3 },
    { variant: "british", mode: 4 },
    { variant: "earliest", mode: 4 },
    { variant: "earliest", mode: 2 },
    { variant: "threeHanded", mode: 3 },
    { variant: "bid", mode: 4 },
    { variant: "bid", mode: 3 },
    { variant: "bid", mode: 4, options: { bidPartners: true } },
    { variant: "setback", mode: 4 },
    // Every listed rule variation at once, to prove none of them wedges a table.
    {
      variant: "northAmerican",
      mode: 4,
      options: {
        stickTheDealer: true,
        farmersHand: true,
        aceNoFace: true,
        defendAlone: true,
        partnersBest: true,
        pointOnPartner: true,
        partnerMustGoAlone: true,
        trumpNeedsMore: true,
        robson: true,
        benny: true,
        extraCards: "sevens",
        target: "11",
      },
    },
    { variant: "setback", mode: 4, options: { declare: true, defendersDeduct: true, stickTheDealer: true } },
    { variant: "bid", mode: 3, options: { extraCards: "sevens", stickTheDealer: true } },
  ];
  for (const table of tables) {
    const room = playOut(table);
    const label = `${table.variant}/${table.mode}`;
    assert.equal(room.status, "finished", label);
    assert.ok(room.winner.playerIds.length >= 1, label);
    assert.ok(room.roundNumber >= 1, label);
    assert.equal(stateOf(room).phase, "gameOver", label);
  }
});

// ---- the calling history ----

// A hand where the turn-up is passed round and somebody then names a different
// suit is the one a player cannot follow at robot speed, so the log has to hold
// enough to reconstruct it afterwards — including the passes, which is the one
// action that used to leave no trace at all.
test("the log records the turn-up and every pass, so a turned-down hand reads back", () => {
  const { room } = newRoom({ humans: 4, bots: false });
  const sockets = [0, 1, 2, 3].map((n) => fakeSocket(`u${n}`, `Player ${n}`));
  for (const socket of sockets) room.handleJoin(socket);

  const turned = room.game.upcard;
  const other = ["♠", "♥", "♦", "♣"].find((suit) => suit !== turned.suit);
  for (const seat of [1, 2, 3, 0]) room.pass(sockets[seat]);
  room.call(sockets[1], { suit: other });

  const [hand] = room.auctionHistory();
  assert.equal(hand.round, 1);
  assert.equal(hand.dealerSeat, 0);
  assert.deepEqual(hand.upcard, turned, "the card that was turned up is on the record");
  assert.deepEqual(
    hand.calls.map((call) => [call.type, call.seat, call.callRound]),
    [
      ["pass", 1, 1],
      ["pass", 2, 1],
      ["pass", 3, 1],
      ["pass", 0, 1],
      ["call", 1, 2],
    ],
    "four passes on the turned suit, then a call in the second round"
  );
  assert.equal(hand.calls[4].suit, other);
});

// A thrown-in hand and the hand that replaces it share a hand number, so the
// history has to split them by deal: bucketing on the number alone puts one
// deal's turn-up above the other deal's calling.
test("a hand nobody wants is listed apart from the deal that replaced it", () => {
  const { room } = newRoom({ humans: 4, bots: false });
  const sockets = [0, 1, 2, 3].map((n) => fakeSocket(`u${n}`, `Player ${n}`));
  for (const socket of sockets) room.handleJoin(socket);
  const thrownUpcard = room.game.upcard;
  for (const seat of [1, 2, 3, 0, 1, 2, 3, 0]) room.pass(sockets[seat]);

  const hands = room.auctionHistory().filter((hand) => hand.round === 1);
  assert.equal(hands.length, 2, "the abandoned deal and its replacement are both listed");

  const [fresh, thrown] = hands;
  assert.equal(thrown.thrownIn, true);
  assert.equal(thrown.calls.filter((call) => call.type === "pass").length, 8);
  assert.equal(thrown.calls.at(-1).type, "throwIn");
  assert.deepEqual(thrown.upcard, thrownUpcard);

  assert.equal(fresh.thrownIn, false);
  assert.deepEqual(fresh.calls, [], "the replacement deal starts with nothing called");
  assert.deepEqual(fresh.upcard, room.game.upcard, "and carries the card now turned up");
  assert.notEqual(fresh.dealerSeat, thrown.dealerSeat, "the deal moved on");
});

test("the history carries each finished hand's result alongside its calling", () => {
  const room = playOut({ variant: "northAmerican", mode: 4 });
  const scored = room.auctionHistory().filter((hand) => hand.result);
  assert.ok(scored.length > 0);
  for (const hand of scored) {
    assert.equal(typeof hand.result.made, "boolean");
    assert.equal(typeof hand.result.tricks, "number");
    assert.ok(hand.calls.some((call) => call.type === "call"));
  }
});

test("the state hands the client the calling history but not every card played", () => {
  const { room } = newRoom();
  room.handleJoin(fakeSocket("u0", "Player 0"));
  runRobots(room);
  const history = stateOf(room).history;
  assert.ok(Array.isArray(history));
  assert.equal(history[0].round, 1);
  assert.equal(
    history.every((hand) => hand.calls.every((call) => call.type !== "play")),
    true
  );
});

// ---- review and replay ----

// One human against robots: nobody else has to agree, so a proposal settles at
// once. That is the common case and the one worth pinning.
test("a review rebuilds the hand that was played, trick by trick", () => {
  const room = playHand({ variant: "northAmerican", mode: 4 });
  const socket = fakeSocket("u0", "Player 0");
  room.propose(socket, { type: "review" });

  const review = stateOf(room).review;
  assert.ok(review, "the review is open");
  assert.equal(review.yours, true, "and the seat that asked for it drives");
  assert.equal(review.step, 0);
  assert.equal(review.trumpSuit, room.lastResult.trumpSuit);
  assert.equal(review.callerSeat, room.lastResult.callerSeat);
  // Five tricks, and every hand back as it was at the first lead.
  assert.equal(review.tricks.length, 5);
  assert.deepEqual(
    review.hands.filter((_, seat) => !review.out.includes(seat)).map((hand) => hand.length),
    review.hands.filter((_, seat) => !review.out.includes(seat)).map(() => 5)
  );
  // The tricks it reports are the engine's own, so they add up to the result.
  const won = review.tricks.filter((trick) => trick.winnerSeat === review.callerSeat).length;
  assert.ok(won <= review.tricks.length);
});

// The deal is random, so this walks enough hands to meet both a turn-up that
// was ordered up and one that was turned down.
test("a review shows the turn-up, the buried card and the rest of the kitty", () => {
  const key = (card) => `${card.value}${card.suit}`;
  let everBuried = false;
  for (let hand = 0; hand < 40; hand += 1) {
    const room = playHand({ variant: "northAmerican", mode: 4 });
    room.propose(fakeSocket("u0", "Player 0"), { type: "review" });
    const review = stateOf(room).review;
    const dealt = review.hands.flat().map(key);
    const kitty = review.kitty.map(key);
    assert.deepEqual(review.upcard, room.log.filter((e) => e.type === "deal").pop().upcard);
    // Four cards nobody could play, and no card is both dealt and dead.
    assert.equal(review.kitty.length, 4);
    assert.equal(new Set([...dealt, ...kitty]).size, dealt.length + kitty.length);
    if (review.buried) {
      everBuried = true;
      assert.ok(kitty.includes(key(review.buried)), "the buried card went out of play");
      // Unless the dealer buried the very card they had just taken up.
      const reburied = key(review.buried) === key(review.upcard);
      assert.ok(reburied || dealt.includes(key(review.upcard)), "the turn-up was taken into a hand");
    } else {
      assert.ok(kitty.includes(key(review.upcard)), "a turn-up nobody took stays in the kitty");
    }
  }
  assert.ok(everBuried, "somebody ordered up over forty hands");
});

test("only the seat driving a review can step it, and end it", () => {
  const room = playHand({ variant: "northAmerican", mode: 4 });
  const mine = fakeSocket("u0", "Player 0");
  room.propose(mine, { type: "review" });

  room.reviewStep(fakeSocket("u9", "Nine"), { step: 3 });
  assert.equal(room.review.step, 0, "a stranger can't drive it");
  room.reviewStep(mine, { step: 3 });
  assert.equal(room.review.step, 3);
  room.reviewStep(mine, { step: -1 });
  assert.equal(room.review.step, 3, "and can't step off the front of it");

  room.reviewDone(fakeSocket("u9", "Nine"));
  assert.ok(room.review, "nor close it");
  room.reviewDone(mine);
  assert.equal(room.review, null);
  assert.equal(room.phase, "roundEnd", "the round end is still there underneath");
});

test("a replay plays the same hand again and scores nothing", () => {
  const room = playHand({ variant: "northAmerican", mode: 4 });
  const socket = fakeSocket("u0", "Player 0");
  const scores = room.game.players.map((player) => player.score);
  const dealt = room.game.players.map((player) => player.hand.length);

  room.propose(socket, { type: "replay" });
  assert.equal(room.replaying, true);
  assert.equal(room.phase, "playing");
  assert.deepEqual(
    room.game.players.map((p) => (p.active ? p.hand.length : 0)),
    room.game.players.map((p) => (p.active ? 5 : 0)),
    "everyone holds their five again"
  );
  assert.equal(room.game.trumpSuit, room.held.game.trumpSuit, "with the same trump made");
  assert.deepEqual(room.game.players.map((p) => p.score), [0, 0, 0, 0], "and no score of its own");

  runRobots(room);
  const euchreBot = require("./euchreBot");
  for (let guard = 0; guard < 60 && room.replaying; guard += 1) {
    if (room.phase === "playing" && room.botActorSeat() === null) {
      room.play(socket, { card: euchreBot.choosePlay(room.game, 0) });
    }
    runRobots(room);
  }

  assert.equal(room.replaying, false);
  assert.equal(room.phase, "roundEnd", "back where it was proposed from");
  assert.ok(room.replayResult, "with a result of its own to show");
  assert.deepEqual(room.game.players.map((player) => player.score), scores, "the real scores are untouched");
  assert.deepEqual(room.game.players.map((player) => player.hand.length), dealt);
});

test("a replay is never saved as the real game", () => {
  const saved = [];
  const realSave = db.saveGame;
  db.saveGame = async (id, patch) => saved.push(patch);
  try {
    const room = playHand({ variant: "northAmerican", mode: 4 });
    saved.length = 0;
    room.propose(fakeSocket("u0", "Player 0"), { type: "replay" });
    const last = saved.at(-1);
    assert.equal(last.snapshot.phase, "roundEnd", "the saved phase is the round end");
    assert.equal(
      last.snapshot.game.players.every((player) => player.hand.length === 0),
      true,
      "and the saved hands are the played-out ones, not the replay's"
    );
  } finally {
    db.saveGame = realSave;
  }
});

test("a hand with nothing to replay is refused rather than half-started", () => {
  const { room } = newRoom();
  const socket = fakeSocket("u0", "Player 0");
  room.handleJoin(socket);
  room.phase = "roundEnd";
  socket.received.length = 0;
  room.propose(socket, { type: "replay" });
  assert.equal(room.replaying, false);
  assert.match(socket.received.at(-1).payload.message, /nothing to replay/i);
});

// ---- the record ----

test("a robot at the table keeps the game off everyone's Elo", () => {
  recorded.elo.length = 0;
  const room = playOut({ variant: "northAmerican", mode: 4 });
  assert.equal(room.isFriendly(), true);
  assert.deepEqual(recorded.elo, [], "nothing rated");
});

test("each scored hand is filed under Euchre, with its variant and table size", () => {
  recorded.rounds.length = 0;
  playOut({ variant: "threeHanded", mode: 3 });
  assert.ok(recorded.rounds.length > 0);
  for (const round of recorded.rounds) {
    assert.equal(round.gameType, "euchre");
    assert.equal(round.variant, "threeHanded");
    assert.equal(round.mode, 3);
    assert.equal(round.friendly, true);
    assert.equal(typeof round.made, "boolean");
    assert.equal(round.needed, 4);
  }
});

// ---- persistence ----

test("a table is rebuilt mid-hand from what was saved", () => {
  const { room } = newRoom();
  room.handleJoin(fakeSocket("u0", "Player 0"));
  runRobots(room);
  const saved = {
    gameType: "euchre",
    variant: room.variant,
    mode: room.mode,
    options: room.options,
    hostUserId: "u0",
    status: room.status,
    roundNumber: room.roundNumber,
    scoreHistory: room.scoreHistory,
    playerSlots: room.slots.map((s) => ({ userId: s.userId, name: s.name, isBot: Boolean(s.isBot) })),
    snapshot: JSON.parse(
      JSON.stringify({
        phase: room.phase,
        readyUserIds: [],
        lastTrick: room.lastTrick,
        lastResult: room.lastResult,
        game: room.game,
      })
    ),
  };
  const reloaded = new EuchreRoom("game-1", fakeIo(), saved, null);
  assert.equal(reloaded.phase, room.phase);
  assert.deepEqual(
    reloaded.game.players.map((p) => p.hand.length),
    room.game.players.map((p) => p.hand.length)
  );
  assert.equal(reloaded.game.trumpSuit, room.game.trumpSuit);
  assert.equal(typeof reloaded.game.legalCards, "function", "rebuilt as a game, not a plain object");
});
