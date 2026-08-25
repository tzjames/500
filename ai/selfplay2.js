#!/usr/bin/env node
// Head-to-head self-play for the *two-player* robot, so a change to bot2.js can
// be shown to be an improvement rather than asserted to be one.
//
// Room can't host this. It finds the robot with `botSlot()`, which returns the
// first bot seat and only ever that one, and `runBotTurn` reaches straight for
// the bot2 module — so a table can hold one robot, of one implementation. To
// play a candidate against the incumbent we need two implementations at once,
// so the auction, the kitty and the play rotation are driven here instead,
// mirroring room.js: non-dealer opens, the dealer alternates each hand, an
// all-pass redeals to the same dealer, and a pass with a bid standing ends the
// auction on the spot.
//
// Usage:
//   node ai/selfplay2.js --games 400 --a server/bot2.js --b /tmp/bot2-old.js
//
// `--a` and `--b` are module paths. Seats are swapped every game so a bot plays
// each side equally often, and the deal RNG is seeded so a run repeats.
const path = require("node:path");
const Game500 = require("../server/gameLogic");
const { bidInfo } = Game500;

// The engine shuffles with Math.random directly, so seeding it means replacing
// that. Deliberately global and never restored: this process exists to play
// hands and then report.
function seedRandom(seed) {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const otherId = (id) => (id === 1 ? 2 : 1);

// One auction. Returns the winning bid, or null if it passed out.
function runAuction(game, bots, dealerId) {
  let bidder = otherId(dealerId);
  const history = [];

  // A passed-out auction is the caller's to redeal, and a hand where both sides
  // keep bidding is bounded by the bid ladder, so this can't spin.
  for (let guard = 0; guard < 64; guard++) {
    const floor = game.currentBid ? game.currentBid.points : 0;
    const call = bots[bidder].chooseBid(game, bidder, floor, {
      myScore: game.players.find((p) => p.id === bidder).score,
      opponentScore: game.players.find((p) => p.id !== bidder).score,
      biddingHistory: history,
      // Nothing here can accept an offered pass, so a robot that would rather
      // redeal than bid is told the offer is unavailable and must choose
      // between passing and bidding for real.
      canOfferPass: false,
    });

    if (call === "Pass") {
      history.push({ player: bidder, bid: "Pass", points: 0 });
      const standing = history.filter((b) => b.bid !== "Pass").pop();
      if (standing) return standing;
      if (history.length < 2) {
        bidder = otherId(bidder);
        continue;
      }
      return null;
    }

    const newBid = { player: bidder, bid: call, points: bidInfo(call).points };
    history.push(newBid);
    const opponentPassed = history.some((b) => b.player === otherId(bidder) && b.bid === "Pass");
    if (opponentPassed) return newBid;
    game.currentBid = newBid;
    bidder = otherId(bidder);
  }
  return game.currentBid;
}

// Plays one hand to its score. Returns "scored" or "passed".
function playHand(game, bots, dealerId) {
  game.currentBid = null;
  const winningBid = runAuction(game, bots, dealerId);
  if (!winningBid) return "passed";

  game.currentBid = winningBid;
  const suit = winningBid.bid.split(" ")[1];
  game.trumpSuit = ["♠", "♣", "♥", "♦"].includes(suit) ? suit : null;
  game.dealKitty();

  const bidderId = winningBid.player;
  const isMisere = winningBid.bid.includes("Misere");
  const bidder = game.players.find((p) => p.id === bidderId);
  bidder.hand = bots[bidderId].chooseDiscard(game, bidderId);

  game.dealDummyHands(isMisere ? [otherId(bidderId)] : undefined);
  game.setupSeats(bidderId, isMisere);

  while (!game.isRoundDecided()) {
    const seat = game.getCurrentSeat();
    const choice = bots[seat.playerId].choosePlay(game, seat.playerId, seat.isDummy);
    if (!choice) break;
    const played = game.playCard(seat.playerId, choice.card, seat.isDummy, choice.nominatedSuit);
    if (played && played.success === false) {
      throw new Error(`illegal play by ${seat.playerId}: ${played.reason}`);
    }
    if (game.currentTrick.length === game.seats.length) game.resolveTrick();
    else game.advanceSeat();
  }

  game.scoreRound();
  return "scored";
}

// A full game to 500, or to -500 through the back door. Returns the winning
// player id, plus what happened on the way.
function playGame(bots, maxHands = 200, startScore = 0) {
  const game = new Game500();
  game.startGame();
  // Endgame rules — anything that turns on how close a side is to 500 — fire on
  // a small fraction of hands from 0–0, so a whole-game measurement mostly
  // averages over games where they never came up. Dealing both sides in near
  // home makes the situation the common case and the comparison sensitive to it.
  if (startScore) game.players.forEach((p) => (p.score = startScore));
  let dealerId = game.players.find((p) => p.isDealer).id;
  const stats = { hands: 0, passed: 0, made: 0, contracts: 0 };

  for (let hand = 0; hand < maxHands; hand++) {
    const outcome = playHand(game, bots, dealerId);
    stats.hands += 1;

    if (outcome === "passed") {
      stats.passed += 1;
      // An all-pass keeps the dealer, exactly as redealAllPassed does.
      game.redeal(game.players.findIndex((p) => p.id === dealerId));
      continue;
    }

    stats.contracts += 1;
    const bid = game.currentBid;
    const bidderPlayer = game.players.find((p) => p.id === bid.player);
    const other = game.players.find((p) => p.id !== bid.player);

    // room.js:1127 — only a bidder ends it, either way, and both bounds are
    // inclusive.
    const made = Game500.checkBidMade(bid, bidderPlayer.tricksWon);
    if (made) stats.made += 1;
    if (made && bidderPlayer.score >= 500 && bidderPlayer.score > other.score) {
      return { winner: bidderPlayer.id, stats, scores: scoresOf(game) };
    }
    if (!made && bidderPlayer.score <= -500) {
      return { winner: other.id, stats, scores: scoresOf(game) };
    }

    dealerId = otherId(dealerId);
    game.redeal(game.players.findIndex((p) => p.id === dealerId));
  }

  // A game that never ends is a draw rather than a crash; the caller reports
  // how often it happened, which is itself a signal about the bidding.
  return { winner: null, stats, scores: scoresOf(game) };
}

const scoresOf = (game) => Object.fromEntries(game.players.map((p) => [p.id, p.score]));

// ---- runner ----

function parseArgs(argv) {
  const args = { games: 200, a: "../server/bot2.js", b: "../server/bot2.js", seed: 1, start: 0 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i].replace(/^--/, "");
    const numeric = ["games", "seed", "start"];
    if (flag in args) args[flag] = numeric.includes(flag) ? Number(argv[i + 1]) : argv[i + 1];
  }
  return args;
}

// Wald interval on the win rate. Without it a 52% over 200 games reads as a
// result when it is noise, which is the whole failure mode this harness exists
// to prevent.
function winRateCI(wins, n) {
  const p = wins / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  return { p, lo: p - 1.96 * se, hi: p + 1.96 * se };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const load = (p) => require(p.startsWith(".") || p.startsWith("/") ? p : path.resolve(p));
  const botA = load(args.a);
  const botB = load(args.b);

  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  const totals = { hands: 0, passed: 0, made: 0, contracts: 0 };
  let aPoints = 0;
  let bPoints = 0;

  for (let g = 0; g < args.games; g++) {
    // Games are run in mirrored pairs: the same seed, so the same opening deal,
    // played once with each bot in each seat. Deal luck then cancels within the
    // pair instead of having to average out across the run, and it gives the
    // harness a hard self-test — two identical bots must score exactly 50%,
    // because each pair is a mirror image of itself and splits one win each way.
    seedRandom(args.seed + Math.floor(g / 2));
    const aIsOne = g % 2 === 0;
    const bots = aIsOne ? { 1: botA, 2: botB } : { 1: botB, 2: botA };
    const { winner, stats, scores } = playGame(bots, 200, args.start);

    for (const k of Object.keys(totals)) totals[k] += stats[k];
    const aSeat = aIsOne ? 1 : 2;
    aPoints += scores[aSeat];
    bPoints += scores[otherId(aSeat)];

    if (winner === null) draws += 1;
    else if (winner === aSeat) aWins += 1;
    else bWins += 1;
  }

  const decided = aWins + bWins;
  const ci = winRateCI(aWins, decided || 1);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;

  console.log(`A = ${args.a}`);
  console.log(`B = ${args.b}`);
  console.log(`games ${args.games}  seed ${args.seed}  start score ${args.start}`);
  console.log(`A wins ${aWins}   B wins ${bWins}   unfinished ${draws}`);
  console.log(`A win rate ${pct(ci.p)}  95% CI [${pct(ci.lo)}, ${pct(ci.hi)}]`);
  console.log(`mean final score  A ${(aPoints / args.games).toFixed(0)}  B ${(bPoints / args.games).toFixed(0)}`);
  console.log(
    `hands ${totals.hands}  passed out ${pct(totals.passed / totals.hands)}  contracts made ${pct(
      totals.made / (totals.contracts || 1)
    )}`
  );
}

if (require.main === module) main();

module.exports = { playGame, playHand, runAuction, seedRandom };
