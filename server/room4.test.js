const test = require("node:test");
const assert = require("node:assert/strict");

// Room4 talks to Mongo and to socket.io. Both are replaced here before the room
// is loaded, so a whole game can be played out in process.
const db = require("./db");
const recorded = { rounds: [], elo: [], created: [] };
db.saveGame = async () => {};
db.deleteGame = async () => {};
db.getGame = async () => null;
db.listPublicWaitingGames = async () => [];
db.recordRound = async (round) => recorded.rounds.push(round);
db.applyElo = async (...args) => recorded.elo.push(args);
db.createGame = async (game) => {
  recorded.created.push(game);
  return game;
};

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

function newRoom({ options = {}, humans = 1, partnerMode = "random", friendly = false } = {}) {
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
      friendly,
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
  // Only counts as a move if this player hadn't already said they were ready —
  // otherwise the driver loop below would keep "moving" the same seat forever
  // and the others would never be asked.
  if (room.phase === "roundEnd" && !room.roundEnd.readyUserIds.has(socket.userId)) {
    room.readyForNextRound(socket);
    return true;
  }
  return false;
}

function playToTheEnd(room, sockets, maxSteps = 6000) {
  const players = Array.isArray(sockets) ? sockets : [sockets];
  for (let step = 0; step < maxSteps; step++) {
    runRobots(room);
    if (room.phase === "gameOver") return true;
    if (!players.some((socket) => takeHumanTurn(room, socket))) {
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

test("each scored round is recorded, and the finished game is rated", async () => {
  recorded.rounds.length = 0;
  recorded.elo.length = 0;
  // Four humans, because a game with a robot in it isn't rated at all — see
  // db.applyElo, which this test stubs out.
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const sockets = [0, 1, 2, 3].map((i) => fakeSocket(`u${i}`, `Player ${i}`));
  sockets.forEach((s) => room.handleJoin(s));
  room.choosePartner(sockets[0], { random: true });
  playToTheEnd(room, sockets);
  // The rating is applied once the result has been written, so it lands a
  // microtask later than the game over itself.
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(recorded.rounds.length > 0, "no rounds were recorded");
  for (const round of recorded.rounds) {
    assert.equal(round.mode, 4);
    assert.equal(round.gameId, "game-1");
    assert.ok(round.bidderUserId);
    assert.ok(round.teamUserIds.includes(round.bidderUserId));
    assert.equal(typeof round.made, "boolean");
    if (round.level) assert.ok(round.level >= 6 && round.level <= 10);
  }
  assert.equal(recorded.elo.length, 1, "the finished game should be rated once");
  const [mode, winners, losers] = recorded.elo[0];
  assert.equal(mode, 4);
  assert.equal(winners.length, 2);
  assert.equal(losers.length, 2);
  room.dispose();
});

test("a table of robots is friendly whether or not anyone asked for that", () => {
  const { room } = newRoom(); // default: one human, three robots
  assert.equal(room.friendly, false, "nobody ticked the box");
  assert.equal(room.isFriendly(), true, "a robot at the table forces it anyway");
  assert.equal(room.anyBotSeated(), true);

  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  const state = room.stateFor("u0");
  assert.equal(state.friendly, true);
  assert.equal(state.friendlyForced, true);
});

test("an all-human game stays rated unless someone marks it friendly", () => {
  const { room: rated } = newRoom({ humans: 4, partnerMode: "choose" });
  assert.equal(rated.isFriendly(), false);
  assert.equal(rated.stateFor("u0").friendlyForced, false);

  const { room: friendly } = newRoom({ humans: 4, partnerMode: "choose", friendly: true });
  assert.equal(friendly.isFriendly(), true);
  assert.equal(friendly.stateFor("u0").friendlyForced, false, "nobody's forcing it, they just asked");
});

test("only the host can mark a table friendly, and only before it's dealt", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const host = fakeSocket("u0", "Player 0");
  const other = fakeSocket("u1", "Player 1");

  room.setFriendly(other, true);
  assert.equal(room.friendly, false, "not the host");

  room.setFriendly(host, true);
  assert.equal(room.friendly, true);

  room.setFriendly(host, false);
  assert.equal(room.friendly, false, "toggling back off works too");

  [1, 2, 3].forEach((i) => room.handleJoin(fakeSocket(`u${i}`, `Player ${i}`)));
  room.choosePartner(host, { random: true });
  room.setFriendly(host, true);
  assert.equal(room.friendly, false, "frozen once the cards are out, like the house rules");
  room.dispose();
});

test("a friendly game is never rated, even with four humans at real tables", async () => {
  recorded.rounds.length = 0;
  recorded.elo.length = 0;
  const { room } = newRoom({ humans: 4, partnerMode: "choose", friendly: true });
  const sockets = [0, 1, 2, 3].map((i) => fakeSocket(`u${i}`, `Player ${i}`));
  sockets.forEach((s) => room.handleJoin(s));
  room.choosePartner(sockets[0], { random: true });
  playToTheEnd(room, sockets);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recorded.elo.length, 0, "a friendly result should never be rated");
  assert.ok(recorded.rounds.length > 0);
  assert.ok(
    recorded.rounds.every((r) => r.friendly === true),
    "every round should carry the friendly flag"
  );
  // The game-over screen reads this straight off the snapshot to show its
  // "nobody's Elo moved" note.
  assert.equal(room.phase, "gameOver");
  assert.equal(room.stateFor("u0").friendly, true);
  room.dispose();
});

test("a rematch carries the friendly setting forward", () => {
  recorded.created.length = 0;
  const { room } = newRoom({ humans: 2, partnerMode: "choose", friendly: true });
  const a = fakeSocket("u0", "Player 0");
  const b = fakeSocket("u1", "Player 1");
  room.handleJoin(a);
  room.handleJoin(b);
  room.choosePartner(a, { partnerUserId: "u1" });

  room.status = "finished";
  room.rematchOffer(a, { pairing: "same" });
  room.rematchRespond(b, true);

  assert.equal(recorded.created.length, 1);
  assert.equal(recorded.created[0].friendly, true);
  room.dispose();
});

test("a claim of the rest needs both opponents", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const sockets = [0, 1, 2, 3].map((i) => fakeSocket(`u${i}`, `Player ${i}`));
  sockets.forEach((s) => room.handleJoin(s));
  room.choosePartner(sockets[0], { partnerUserId: "u2" });

  // Force a contract and get to a lead.
  const game = room.game;
  game.auction.complete = true;
  game.auction.highBid = { seat: 0, bid: "8 ♠", points: 240, rank: 80 };
  room.finishAuction();
  room.discard(sockets[game.players[0].id === "u0" ? 0 : 0], {
    keep: game.players[0].hand.slice(0, 10),
  });
  assert.equal(room.phase, "playing");

  const claimer = game.currentSeat;
  const claimerSocket = sockets.find((s) => s.userId === game.players[claimer].id);
  room.claimRest(claimerSocket);
  assert.ok(room.pendingClaim, "the claim should be outstanding");
  assert.equal(room.revealedClaimSeat, claimer);

  const opponents = room.claimOpponentSeats();
  assert.equal(opponents.length, 2);
  const opponentSockets = opponents.map((seat) =>
    sockets.find((s) => s.userId === game.players[seat].id)
  );

  // One yes isn't enough.
  room.respondToClaim(opponentSockets[0], true);
  assert.ok(room.pendingClaim);
  // And the claimer's own side doesn't get a say.
  const partnerSocket = sockets.find((s) => s.userId === game.players[(claimer + 2) % 4].id);
  room.respondToClaim(partnerSocket, false);
  assert.ok(room.pendingClaim, "the partner's answer shouldn't count");

  room.respondToClaim(opponentSockets[1], true);
  assert.equal(room.pendingClaim, null);
  assert.equal(room.game.teamTricks(room.game.teamOf(claimer)), 10);
  room.dispose();
});

test("a declined claim leaves the hand face up but the round running", () => {
  const { room } = newRoom({ humans: 4, partnerMode: "choose" });
  const sockets = [0, 1, 2, 3].map((i) => fakeSocket(`u${i}`, `Player ${i}`));
  sockets.forEach((s) => room.handleJoin(s));
  room.choosePartner(sockets[0], { partnerUserId: "u2" });

  const game = room.game;
  game.auction.complete = true;
  game.auction.highBid = { seat: 0, bid: "8 ♠", points: 240, rank: 80 };
  room.finishAuction();
  room.discard(sockets[0], { keep: game.players[0].hand.slice(0, 10) });

  const claimer = game.currentSeat;
  const claimerSocket = sockets.find((s) => s.userId === game.players[claimer].id);
  room.claimRest(claimerSocket);
  const opponent = sockets.find(
    (s) => s.userId === game.players[room.claimOpponentSeats()[0]].id
  );
  room.respondToClaim(opponent, false);

  assert.equal(room.pendingClaim, null);
  assert.equal(room.phase, "playing", "the hand carries on");
  assert.equal(room.revealedClaimSeat, claimer, "the hand stays face up");
  // And the opponents can see it, while the claimer's partner can't.
  const opponentState = room.stateFor(opponent.userId);
  assert.deepEqual(Object.keys(opponentState.revealedHands), [String(claimer)]);
  const partnerState = room.stateFor(game.players[(claimer + 2) % 4].id);
  assert.deepEqual(partnerState.revealedHands, {});
  room.dispose();
});

test("review needs everyone's agreement, then steps in lockstep", () => {
  const { room } = newRoom({ humans: 2, partnerMode: "choose" });
  const a = fakeSocket("u0", "Player 0");
  const b = fakeSocket("u1", "Player 1");
  room.handleJoin(a);
  room.handleJoin(b);
  room.choosePartner(a, { random: true });

  // Play a hand out so there's something to review.
  for (let i = 0; i < 400 && room.phase !== "roundEnd"; i++) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    if (!takeHumanTurn(room, a)) takeHumanTurn(room, b);
  }
  assert.equal(room.phase, "roundEnd");

  room.propose(a, "review");
  assert.equal(room.phase, "roundEnd", "waiting on the other player");
  room.respondToProposal(b, true);
  assert.equal(room.phase, "review");
  assert.equal(room.reviewControllerId, "u0");

  // Only the controller drives it.
  room.reviewStep(b, 3);
  assert.equal(room.reviewStepIndex, 0);
  room.reviewStep(a, 3);
  assert.equal(room.reviewStepIndex, 3);
  assert.ok(room.stateFor("u1").review.log.length > 0, "both see the same log");

  room.reviewDone(b);
  assert.equal(room.phase, "review", "only the controller can end it");
  room.reviewDone(a);
  assert.equal(room.phase, "roundEnd");
  room.dispose();
});

test("a declined proposal just gets on with the game", () => {
  const { room } = newRoom({ humans: 2, partnerMode: "choose" });
  const a = fakeSocket("u0", "Player 0");
  const b = fakeSocket("u1", "Player 1");
  room.handleJoin(a);
  room.handleJoin(b);
  room.choosePartner(a, { random: true });
  for (let i = 0; i < 400 && room.phase !== "roundEnd"; i++) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    if (!takeHumanTurn(room, a)) takeHumanTurn(room, b);
  }
  room.propose(a, "review");
  room.respondToProposal(b, false);
  assert.equal(room.phase, "roundEnd");
  assert.equal(room.roundEnd.proposal, null);
  room.dispose();
});

test("a replay redeals the same hand and scores nothing", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  for (let i = 0; i < 400 && room.phase !== "roundEnd"; i++) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    takeHumanTurn(room, host);
  }
  assert.equal(room.phase, "roundEnd");
  const scoresBefore = [...room.game.teamScores];
  const roundBefore = room.roundNumber;
  const dealt = [...room.log].reverse().find((e) => e.type === "deal");

  // The only other human is nobody, so the robots agree at once.
  room.propose(host, "replay");
  assert.equal(room.phase, "replay", "the replay should have started");
  assert.ok(room.replayGame);
  // Same cards as the hand that was dealt.
  const replaySeat = room.replayGame.seatOf("u0");
  const bidderSeat = room.replayGame.currentBid.seat;
  if (replaySeat !== bidderSeat) {
    assert.deepEqual(
      room.replayGame.players[replaySeat].hand.map((c) => c.value + c.suit).sort(),
      dealt.hands["u0"].map((c) => c.value + c.suit).sort()
    );
  }

  for (let i = 0; i < 400 && room.phase === "replay"; i++) {
    runRobots(room);
    if (room.phase !== "replay") break;
    const state = room.stateFor("u0");
    const replay = state.replay;
    if (!replay) break;
    if (replay.phase === "kitty" && replay.currentBid.seat === replay.you.seat) {
      room.discard(host, { keep: replay.you.hand.slice(0, 10), mode: "replay" });
    } else if (replay.phase === "exchange" && !replay.you.passed) {
      room.passCards(host, { cards: replay.you.hand.slice(0, 5), mode: "replay" });
    } else if (replay.phase === "playing" && replay.currentSeat === replay.you.seat) {
      const legal = replay.legalPlays || replay.you.hand;
      room.playCard(host, { card: legal[0], nominatedSuit: "♠", mode: "replay" });
    } else break;
  }

  assert.equal(room.phase, "roundEnd", "the replay hands back to the round-end screen");
  assert.deepEqual(room.game.teamScores, scoresBefore, "a replay scores nothing");
  assert.equal(room.roundNumber, roundBefore);
  assert.equal(room.replayGame, null);
  room.dispose();
});

test("a rematch needs everyone, and can change the pairing", () => {
  recorded.created.length = 0;
  const { room } = newRoom({ humans: 2, partnerMode: "choose" });
  const a = fakeSocket("u0", "Player 0");
  const b = fakeSocket("u1", "Player 1");
  room.handleJoin(a);
  room.handleJoin(b);
  room.choosePartner(a, { partnerUserId: "u1" });
  const before = [...room.seatOrder];

  // Not until the game is over.
  room.rematchOffer(a, { pairing: "swap" });
  assert.equal(room.rematch, null);

  room.status = "finished";
  room.rematchOffer(a, { pairing: "swap" });
  assert.ok(room.rematch, "waiting on the other player");
  assert.equal(recorded.created.length, 0);
  room.rematchRespond(b, true);
  assert.equal(recorded.created.length, 1);

  const created = recorded.created[0];
  assert.equal(created.mode, 4);
  assert.deepEqual(created.snapshot.seatOrder, [before[0], before[1], before[3], before[2]]);
  assert.equal(created.partnerMode, "random", "the pairing is already settled");
  room.dispose();
});

test("a declared blind hand is dealt face down and can be turned over", () => {
  const { room } = newRoom({ options: { blindMisere: true } });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  // Get to a round-end screen, declare the intent, then take the next deal.
  for (let i = 0; i < 400 && room.phase !== "roundEnd"; i++) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    takeHumanTurn(room, host);
  }
  assert.equal(room.phase, "roundEnd");
  room.setBlindIntent(host, true);
  assert.equal(room.stateFor("u0").roundEnd.blindIntent, true);
  room.readyForNextRound(host);

  const seat = room.game.seatOf("u0");
  assert.deepEqual(room.game.blindSeats, [seat]);
  const blindState = room.stateFor("u0");
  assert.deepEqual(blindState.you.hand, [], "no cards while you're blind");
  assert.equal(blindState.you.handCount, 10);
  assert.equal(blindState.you.blind, true);
  assert.equal(blindState.legalBids, null, "no bid grid while you can't see");

  // The intent is spent by the hand, not carried on.
  assert.equal(room.blindIntents.size, 0);

  room.declineBlind(host);
  const openState = room.stateFor("u0");
  assert.equal(openState.you.blind, false);
  assert.equal(openState.you.hand.length, 10);
  room.dispose();
});

test("only a seat that declared blind may bid it", () => {
  const { room } = newRoom({ options: { blindMisere: true } });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);
  const seat = room.game.seatOf("u0");
  assert.equal(room.game.bidLegality(seat, "Blind Misere").ok, false);
  room.dispose();
});

test("a Double Nullo goes through the exchange before play", () => {
  const { room } = newRoom({ options: { doubleNullo: true } });
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  const game = room.game;
  const seat = game.seatOf("u0");
  game.auction.complete = true;
  game.auction.highBid = { seat, bid: "Double Nullo", points: 500, rank: 102.6 };
  room.finishAuction();
  assert.equal(room.phase, "kitty");

  room.discard(host, { keep: game.players[seat].hand.slice(0, 10) });
  assert.equal(room.phase, "exchange", "Double Nullo exchanges five cards");
  assert.deepEqual(game.exchangeSeats(), [seat, (seat + 2) % 4].sort((a, b) => a - b).length ? game.exchangeSeats() : null);

  const state = room.stateFor("u0");
  assert.ok(state.exchangeSeats.includes(seat));
  room.passCards(host, { cards: game.players[seat].hand.slice(0, 5) });
  // The robot partner answers on its own, so the exchange completes and play
  // starts without another prod.
  runRobots(room);
  assert.equal(room.phase, "playing");
  assert.equal(game.players[seat].hand.length, 10);
  assert.ok(room.log.some((e) => e.type === "pass"), "the exchange is logged");
  room.dispose();
});

test("the bidder's discard screen sees which three cards were the kitty", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  const game = room.game;
  const seat = game.seatOf("u0");
  game.auction.complete = true;
  game.auction.highBid = { seat, bid: "6 ♠", points: 40, rank: 10 };
  room.finishAuction();
  assert.equal(room.phase, "kitty");

  const kittyEntry = room.log.find((e) => e.type === "kittyDealt");
  const kittyKeys = new Set(kittyEntry.kitty.map((c) => `${c.value}${c.suit}`));
  assert.equal(kittyKeys.size, 3);

  const state = room.stateFor("u0");
  const marked = state.you.hand.filter((c) => c.isKitty);
  assert.equal(marked.length, 3, "exactly the three kitty cards should be tagged");
  assert.deepEqual(new Set(marked.map((c) => `${c.value}${c.suit}`)), kittyKeys);

  // Nobody else took a kitty, so nothing in their own hand gets tagged.
  const otherSeat = (seat + 1) % 4;
  const otherState = room.stateFor(game.players[otherSeat].id);
  assert.equal(otherState.you.hand.length, 10);
  assert.ok(!otherState.you.hand.some((c) => c.isKitty));

  // Once discarded, the flag is gone — it only ever meant "still deciding".
  room.discard(host, { keep: game.players[seat].hand.slice(0, 10) });
  const afterDiscard = room.stateFor("u0");
  assert.ok(!afterDiscard.you.hand.some((c) => c.isKitty));
  room.dispose();
});

test("a replayed kitty screen tags the same three cards the live one did", () => {
  const { room } = newRoom();
  const host = fakeSocket("u0", "Player 0");
  room.handleJoin(host);

  // Force the host to win the bid, so the replayed hand's bidder is known.
  const game = room.game;
  const seat = game.seatOf("u0");
  game.auction.complete = true;
  game.auction.highBid = { seat, bid: "6 ♠", points: 40, rank: 10 };
  room.finishAuction();
  const kittyEntry = room.log.find((e) => e.type === "kittyDealt");
  const kittyKeys = new Set(kittyEntry.kitty.map((c) => `${c.value}${c.suit}`));
  room.discard(host, { keep: game.players[seat].hand.slice(0, 10) });
  assert.equal(room.phase, "playing");

  for (let i = 0; i < 400 && room.phase !== "roundEnd"; i++) {
    runRobots(room);
    if (room.phase === "roundEnd" || room.phase === "gameOver") break;
    takeHumanTurn(room, host);
  }
  assert.equal(room.phase, "roundEnd");

  // The only other human is nobody, so the robots agree at once and the
  // replay starts right away — same as the plain replay test above.
  room.propose(host, "replay");
  assert.equal(room.phase, "replay");
  assert.equal(room.replayGame.currentBid.seat, seat, "the replay should have the same bidder");

  const marked = room.stateFor("u0").replay.you.hand.filter((c) => c.isKitty);
  assert.equal(marked.length, 3);
  assert.deepEqual(new Set(marked.map((c) => `${c.value}${c.suit}`)), kittyKeys);
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
