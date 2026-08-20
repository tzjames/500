const test = require("node:test");
const assert = require("node:assert/strict");

const { Game500Four, isNoTricksBid } = require("./game4");
const { Episode } = require("./episode");
const { ACTION_COUNT, bidAction, decodeAction } = require("./obs");

const legalActions = (mask) => mask.reduce((out, m, i) => (m ? [...out, i] : out), []);
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

// Plays a hand out by choosing uniformly among whatever the mask offers. Every
// step goes through Episode, which throws the moment an action the engine won't
// accept comes back — so this is the test that the mask never offers one.
function playRandomHand(options, dealerSeat) {
  const episode = new Episode(options, dealerSeat);
  const kinds = new Set();
  while (!episode.done) {
    const view = episode.observation();
    kinds.add(view.kind);
    const legal = legalActions(view.mask);
    assert.ok(legal.length > 0, `no legal action at a ${view.kind} decision`);
    assert.ok(
      legal.every((action) => action >= 0 && action < ACTION_COUNT),
      "an action fell outside the space"
    );
    episode.step(pickRandom(legal));
  }
  return { episode, kinds };
}

test("random legal play finishes a hand on any house rules", () => {
  const rulesets = [
    {},
    { misereAnytime: true, hiLo: true, doubleNullo: true, blindMisere: true },
    { j5: true, jokerLeadAnytime: false, splitTheColours: true },
    { allPassNoTrump: true, trickPoints: false, slamBonus: false, ralphing: true },
    { bidAfterPass: true, openMisere: true, misereAnytime: true },
  ];

  for (const options of rulesets) {
    for (let round = 0; round < 30; round++) {
      const { episode } = playRandomHand(options, round % 4);
      const game = episode.game;

      assert.equal(episode.done, true);
      assert.ok(
        episode.rewards.every((r) => Number.isFinite(r)),
        "every seat needs a finite reward"
      );

      if (episode.info.passedOut) {
        assert.equal(game.currentBid, null);
        continue;
      }

      // The same invariant bot.test.js holds the heuristic bot to: either all ten
      // tricks went, or a no-tricks contract fell over and the hand stopped short.
      const played = game.players.reduce((sum, p) => sum + p.tricksWon, 0);
      const cardsLeft = game.players.reduce((sum, p) => sum + p.hand.length, 0);
      if (cardsLeft === 0) {
        assert.equal(played, 10, `expected ten tricks, counted ${played}`);
      } else {
        assert.ok(
          game.noContract === false && isNoTricksBid(game.currentBid?.bid),
          "a hand only stops short when a no-tricks contract has already gone"
        );
      }
    }
  }
});

test("partners are rewarded as a partnership, and a hand is zero-sum", () => {
  for (let round = 0; round < 40; round++) {
    const { episode } = playRandomHand({ trickPoints: true }, round % 4);
    assert.equal(episode.rewards[0], episode.rewards[2]);
    assert.equal(episode.rewards[1], episode.rewards[3]);
    // What one side gains the other loses, so there's nothing to win except by
    // beating the other partnership.
    assert.equal(episode.rewards[0], -episode.rewards[1]);
    if (episode.info.passedOut) continue;
    const [a, b] = episode.info.deltas;
    assert.equal(episode.rewards[0], (a - b) / 500);
  }
});

// The trap this guards against: scoreRound hands the defenders ten a trick
// whatever happens, so their own delta is positive even in a thrashing. Reward
// the raw delta and defending becomes risk-free while bidding is the only way to
// lose points — and the policy stops bidding.
test("defenders are punished for a contract made against them", () => {
  const game = new Game500Four({ trickPoints: true });
  game.deal(0);
  game.currentBid = { seat: 0, player: "u0", bid: "8 ♠", points: 340 };
  game.trumpSuit = "♠";
  game.players[0].tricksWon = 8;
  game.players[1].tricksWon = 2;
  game.players.forEach((player) => (player.hand = []));

  const episode = Object.create(Episode.prototype);
  episode.game = game;
  episode.finish({});

  assert.deepEqual(episode.info.deltas, [340, 20], "the defenders still bank their tricks");
  assert.ok(episode.rewards[0] > 0, "the bidders come out ahead");
  assert.ok(episode.rewards[1] < 0, "the defenders must come out behind, not merely less ahead");
  assert.equal(episode.rewards[1], -episode.rewards[0]);
});

// Random bidding lands a Double Nullo too rarely to rely on, so this bids it
// deliberately and passes with every other seat. Passing matters: a Double Nullo
// ranks 102.6, which sits between 10♦ and 10♥, so a seat bidding on at random
// would take the contract straight back off it.
test("all four kinds of decision get asked, the Double Nullo exchange included", () => {
  const doubleNullo = bidAction("Double Nullo");
  const pass = bidAction("Pass");
  const seen = new Set();
  let exchanges = 0;

  for (let round = 0; round < 12; round++) {
    const episode = new Episode({ doubleNullo: true }, round % 4);
    let exchanged = false;
    while (!episode.done) {
      const view = episode.observation();
      seen.add(view.kind);
      if (view.kind === "pass") exchanged = true;
      const action =
        view.kind === "bid"
          ? (view.mask[doubleNullo] ? doubleNullo : pass)
          : pickRandom(legalActions(view.mask));
      episode.step(action);
    }

    assert.equal(episode.game.currentBid.bid, "Double Nullo");
    if (exchanged) exchanges += 1;
    // Both partners are still in it — a Double Nullo folds nobody — and the swap
    // left them with ten cards each, with none created or lost.
    const [a, b] = episode.game.exchangeSeats();
    assert.equal(episode.game.players[a].folded, false);
    assert.equal(episode.game.players[b].folded, false);
  }

  assert.equal(exchanges, 12, "every hand should have reached the exchange");
  assert.deepEqual([...seen].sort(), ["bid", "discard", "pass", "play"]);
});

test("the kitty discard leaves the bidder with ten cards", () => {
  let checked = 0;
  for (let round = 0; round < 40; round++) {
    const episode = new Episode({}, round % 4);
    while (!episode.done) {
      const view = episode.observation();
      const wasDiscard = view.kind === "discard";
      const seat = view.seat;
      episode.step(pickRandom(legalActions(view.mask)));
      // The last of the three discards takes the hand back down to ten.
      if (wasDiscard && episode.state !== "discard") {
        assert.equal(episode.game.players[seat].hand.length, 10);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 10, `only saw ${checked} discards`);
});

test("an action the mask didn't offer is refused rather than played", () => {
  const episode = new Episode({}, 0);
  const view = episode.observation();
  assert.equal(view.kind, "bid");
  // Bidding is the one phase where a card is never a legal action.
  const card = view.mask.findIndex((m, i) => !m && decodeAction(i).kind === "card");
  assert.throws(() => episode.step(card));
});

test("a hand nobody bid is thrown in, and pays nothing either way", () => {
  const episode = new Episode({}, 0);
  while (!episode.done && episode.state === "bid") {
    episode.step(0); // Pass
  }
  assert.equal(episode.done, true);
  assert.equal(episode.info.passedOut, true);
  assert.deepEqual(episode.rewards, [0, 0, 0, 0]);
});

test("the pass-out penalty is what discourages a table that never bids", () => {
  const episode = new Episode({}, 0, { passOutPenalty: 0.1 });
  while (!episode.done && episode.state === "bid") episode.step(0);
  assert.deepEqual(episode.rewards, [-0.1, -0.1, -0.1, -0.1]);
});
