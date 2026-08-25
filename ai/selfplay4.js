#!/usr/bin/env node
// Head-to-head self-play for the *four-player* robot, the companion to
// selfplay2.js. Same reason for existing: Room4 drives one bot module for every
// robot seat, so it can't play a candidate against the incumbent, and a change
// to bot.js otherwise ships on an argument rather than a measurement.
//
// The two bots are assigned to *teams*, not seats — partners sit across from
// each other (seats 0/2 against 1/3), so the meaningful comparison is one
// partnership against the other. Team assignment swaps every game and games run
// in mirrored pairs off a shared seed, which cancels deal luck and gives the
// same self-test selfplay2 has: two identical bots must score exactly 50%.
//
// Usage:
//   node ai/selfplay4.js --games 400 --a server/bot.js --b server/bot-baseline.js
const path = require("node:path");
const { Game500Four } = require("../server/game4");

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

// Plays one hand to its score. Returns "scored", or "passed" when nobody bid and
// the table isn't playing it out. Mirrors room4: finishAuction → kitty →
// exchange (Double Nullo only) → play.
function playHand(game, bots, dealerSeat) {
  game.deal(dealerSeat);

  for (let guard = 0; guard < 64 && !game.auction.complete; guard++) {
    const seat = game.auction.turnSeat;
    const call = bots[seat].chooseBid(game, seat);
    // chooseBid should only ever offer legal calls; a robot that can't move
    // must not wedge the hand, exactly as runBotTurn guards it.
    if (!game.bid(seat, call).ok) game.bid(seat, "Pass");
  }

  const contract = game.completeBidding();
  if (!contract) {
    if (!game.options.allPassNoTrump) return null;
  } else {
    game.takeKitty(contract.seat);
    const keep = bots[contract.seat].chooseDiscard(game, contract.seat);
    const discarded = game.discard(contract.seat, keep);
    if (!discarded.success) throw new Error(`bad discard: ${discarded.reason}`);

    const exchanging = game.exchangeSeats();
    if (exchanging) {
      for (const seat of exchanging) {
        const sent = game.setPass(seat, bots[seat].choosePass(game, seat));
        if (!sent.success) throw new Error(`bad pass: ${sent.reason}`);
      }
      game.completeExchange();
    }
  }

  while (!game.isRoundDecided()) {
    const seat = game.currentSeat;
    const choice = bots[seat].choosePlay(game, seat);
    if (!choice) break;
    const played = game.playCard(seat, choice.card, choice.nominatedSuit);
    if (!played.success) throw new Error(`illegal play by seat ${seat}: ${played.reason}`);
    if (game.trickIsComplete()) game.resolveTrick();
    else game.currentSeat = game.nextActiveSeat(seat);
  }

  // scoreRound is the only honest source for whether the contract came home:
  // asking contractMade() afterwards reads state the scoring has already moved
  // on from, which reported a 0.6% make rate against the 60% the game actually
  // produces.
  return game.scoreRound();
}

// A full game. Returns the winning team, or null if it never finished.
function playGame(bots, maxHands = 200, startScore = 0) {
  const game = new Game500Four({});
  if (startScore) game.teamScores = [startScore, startScore];
  let dealerSeat = 0;
  const stats = { hands: 0, passed: 0, made: 0, contracts: 0 };

  for (let hand = 0; hand < maxHands; hand++) {
    const result = playHand(game, bots, dealerSeat);
    stats.hands += 1;
    if (!result) {
      stats.passed += 1;
      // An all-pass redeals to the same dealer (room4 redealSameDealer).
      continue;
    }

    stats.contracts += 1;
    const madeTeam = result.made ? result.biddingTeam : null;
    if (result.made) stats.made += 1;

    const over = game.checkGameOver(madeTeam);
    if (over) return { winner: over.team, stats, scores: [...game.teamScores] };
    dealerSeat = (dealerSeat + 1) % 4;
  }
  return { winner: null, stats, scores: [...game.teamScores] };
}

// ---- runner ----

function parseArgs(argv) {
  const args = { games: 200, a: "server/bot.js", b: "server/bot.js", seed: 1, start: 0 };
  const numeric = ["games", "seed", "start"];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i].replace(/^--/, "");
    if (flag in args) args[flag] = numeric.includes(flag) ? Number(argv[i + 1]) : argv[i + 1];
  }
  return args;
}

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

  for (let g = 0; g < args.games; g++) {
    seedRandom(args.seed + Math.floor(g / 2));
    // Team 0 is seats 0 and 2, team 1 is seats 1 and 3.
    const aIsTeamZero = g % 2 === 0;
    const bots = [0, 1, 2, 3].map((seat) =>
      (seat % 2 === 0) === aIsTeamZero ? botA : botB
    );
    const { winner, stats } = playGame(bots, 200, args.start);
    for (const k of Object.keys(totals)) totals[k] += stats[k];

    const aTeam = aIsTeamZero ? 0 : 1;
    if (winner === null) draws += 1;
    else if (winner === aTeam) aWins += 1;
    else bWins += 1;
  }

  const ci = winRateCI(aWins, aWins + bWins || 1);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;

  console.log(`A = ${args.a}`);
  console.log(`B = ${args.b}`);
  console.log(`games ${args.games}  seed ${args.seed}  start score ${args.start}`);
  console.log(`A wins ${aWins}   B wins ${bWins}   unfinished ${draws}`);
  console.log(`A win rate ${pct(ci.p)}  95% CI [${pct(ci.lo)}, ${pct(ci.hi)}]`);
  console.log(
    `hands ${totals.hands}  passed out ${pct(totals.passed / totals.hands)}  contracts made ${pct(
      totals.made / (totals.contracts || 1)
    )}`
  );
}

if (require.main === module) main();

module.exports = { playGame, playHand, seedRandom };
