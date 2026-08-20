const test = require("node:test");
const assert = require("node:assert/strict");

const { Game500Four, REAL_SUITS } = require("./game4");
const { Episode } = require("./episode");
const obs = require("./obs");

const key = (card) => `${card.value}${card.suit}`;

test("every card in the pack has its own index, and comes back unchanged", () => {
  const deck = new Game500Four().createDeck();
  assert.equal(deck.length, 43);

  const indices = new Set();
  for (const card of deck) {
    const index = obs.cardIndex(card);
    assert.ok(!indices.has(index), `two cards share index ${index}`);
    indices.add(index);
    assert.equal(key(obs.cardFromIndex(index)), key(card));
  }
  assert.equal(obs.DECK_INDICES.length, 43);
});

test("the action space partitions into bids, cards and Joker nominations", () => {
  assert.equal(obs.BID_ACTIONS[0], "Pass");
  // Five levels of five suits, plus Pass and the specials.
  assert.ok(obs.BID_ACTIONS.length >= 31);
  assert.equal(obs.CARD_OFFSET, obs.BID_ACTIONS.length);
  assert.equal(obs.NOMINATE_OFFSET, obs.CARD_OFFSET + obs.CARD_COUNT);
  assert.equal(obs.ACTION_COUNT, obs.NOMINATE_OFFSET + REAL_SUITS.length);

  assert.equal(obs.decodeAction(0).bid, "Pass");
  assert.equal(obs.decodeAction(obs.bidAction("8 ♥")).bid, "8 ♥");
  const jack = { suit: "♠", value: "J" };
  assert.equal(key(obs.decodeAction(obs.cardActionOf(jack)).card), key(jack));

  // A nomination action is the Joker plus the suit it names.
  const nominated = obs.decodeAction(obs.NOMINATE_OFFSET + 2);
  assert.equal(nominated.card.suit, "Joker");
  assert.equal(nominated.nominatedSuit, REAL_SUITS[2]);
});

test("the observation is the same width at every decision in a hand", () => {
  const rulesets = [{}, { hiLo: true, doubleNullo: true, misereAnytime: true }, { j5: true }];
  let decisions = 0;

  for (const options of rulesets) {
    for (let round = 0; round < 15; round++) {
      const episode = new Episode(options, round % 4);
      while (!episode.done) {
        const view = episode.observation();
        assert.equal(view.obs.length, obs.OBS_SIZE);
        assert.equal(view.mask.length, obs.ACTION_COUNT);
        assert.ok(
          view.obs.every((x) => Number.isFinite(x)),
          "every input has to be a real number"
        );
        const legal = view.mask.reduce((n, m, i) => (m ? [...n, i] : n), []);
        assert.ok(legal.length > 0, `nothing legal at a ${view.kind} decision`);
        decisions += 1;
        episode.step(legal[Math.floor(Math.random() * legal.length)]);
      }
    }
  }
  assert.ok(decisions > 500, `only exercised ${decisions} decisions`);
});

// The observation must contain nothing the seat couldn't see at a real table.
// Swapping the other two hands over changes what they hold without changing how
// many cards anyone has, so a seat's own view has to come out identical — if any
// of it leaked in, this is where it shows up.
test("a seat's observation doesn't depend on the hands it can't see", () => {
  for (let round = 0; round < 25; round++) {
    const episode = new Episode({}, round % 4);
    // Get past the auction so there's a contract, a trick and a played card in
    // view rather than just an opening hand.
    while (!episode.done && episode.state !== "play") {
      const view = episode.observation();
      const legal = view.mask.reduce((n, m, i) => (m ? [...n, i] : n), []);
      episode.step(legal[Math.floor(Math.random() * legal.length)]);
    }
    if (episode.done) continue;

    const seat = episode.game.currentSeat;
    const before = episode.observation().obs;

    const others = [1, 2, 3].map((step) => (seat + step) % 4).filter((s) => {
      return !episode.game.players[s].folded && s !== seat;
    });
    if (others.length < 2) continue;
    const [a, b] = others;
    const handA = episode.game.players[a].hand;
    const handB = episode.game.players[b].hand;
    if (handA.length !== handB.length) continue;
    episode.game.players[a].hand = handB;
    episode.game.players[b].hand = handA;

    assert.deepEqual(episode.observation().obs, before);
  }
});

test("the trump and phase blocks say what's actually going on", () => {
  const game = new Game500Four();
  game.deal(0);
  game.trumpSuit = "♥";
  game.currentBid = { seat: 1, player: "seat1", bid: "8 ♥", points: 340 };

  const asBidder = obs.encodeObservation(game, 1, { kind: "play" });
  const asDefender = obs.encodeObservation(game, 0, { kind: "play" });
  assert.notDeepEqual(asBidder, asDefender, "the bidder and a defender see different hands");

  // A Hi-Lo bidder is chasing tricks until it has five, and ducking after.
  const hiLo = new Game500Four({ hiLo: true });
  hiLo.deal(0);
  hiLo.currentBid = { seat: 2, player: "seat2", bid: "Hi-Lo", points: 350 };
  assert.equal(obs.isAvoidingTricks(hiLo, 2), false);
  hiLo.players[2].tricksWon = 5;
  assert.equal(obs.isAvoidingTricks(hiLo, 2), true);
  // Its partner is folded out of a solo contract and isn't on it either way.
  assert.equal(obs.isAvoidingTricks(hiLo, 0), false);
});

test("the mask reaches exactly the cards the rules allow", () => {
  for (let round = 0; round < 40; round++) {
    const episode = new Episode({ jokerLeadAnytime: true }, round % 4);
    while (!episode.done) {
      const view = episode.observation();
      if (view.kind === "play") {
        const allowed = new Set(episode.game.legalPlays(view.seat).map(key));
        const reachable = new Set(
          view.mask
            .reduce((n, m, i) => (m ? [...n, i] : n), [])
            .map((action) => key(obs.decodeAction(action).card))
        );
        assert.deepEqual(reachable, allowed, "the mask and legalPlays disagree");
      }
      const legal = view.mask.reduce((n, m, i) => (m ? [...n, i] : n), []);
      episode.step(legal[Math.floor(Math.random() * legal.length)]);
    }
  }
});
