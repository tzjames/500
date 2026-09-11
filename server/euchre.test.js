const test = require("node:test");
const assert = require("node:assert/strict");
const { EuchreGame, buildDeck, effectiveSuit, cardRank } = require("./euchre");

const card = (value, suit) => ({ value, suit });
const BENNY = card("Joker", "Joker");

// A dealt round with the hands and the turn-up replaced, so a test can state
// exactly the position it is about rather than fish for one.
function dealt({ variant = "northAmerican", mode = 4, options = {}, hands, upcard } = {}) {
  const game = new EuchreGame({ variant, mode, options });
  const phase = game.resetRound(0);
  if (hands) hands.forEach((hand, seat) => (game.players[seat].hand = hand.map((c) => ({ ...c }))));
  if (upcard) {
    game.upcard = { ...upcard };
    game.kitty[0] = { ...upcard };
  }
  return { game, phase };
}

// Some rules turn on the card that comes up, which is decided by the deal
// itself — so those tests deal for real until the turn-up is the one they want.
function dealUntil(predicate, config = {}) {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const out = dealt(config);
    if (predicate(out.game.upcard)) return out;
  }
  throw new Error("never dealt that turn-up");
}

// Hands that between them hold no jack, so a test about something else can't
// trip over the bare-bower rule or a farmer's hand.
const plainHand = (suit) => [card("A", suit), card("K", suit), card("Q", suit), card("9", suit), card("10", suit)];

// ---- the pack ----

test("each rule set deals its own pack, hands and kitty", () => {
  const shapes = [
    ["northAmerican", 4, 5, 4],
    ["northAmerican", 2, 5, 14],
    ["british", 4, 5, 5],
    ["earliest", 4, 5, 12],
    ["threeHanded", 3, 7, 3],
    ["setback", 4, 5, 12],
  ];
  for (const [variant, mode, cards, kitty] of shapes) {
    const { game } = dealt({ variant, mode });
    assert.deepEqual(
      game.players.map((p) => p.hand.length),
      Array(mode).fill(cards),
      `${variant} hands`
    );
    assert.equal(game.kitty.length, kitty, `${variant} kitty`);
  }
});

test("Bid Euchre deals the whole pack out, and the pack sets the top bid", () => {
  for (const [mode, extraCards, cards] of [
    [4, "none", 6],
    [3, "none", 8],
    [4, "eights", 7],
    [3, "sevens", 10],
  ]) {
    const { game, phase } = dealt({ variant: "bid", mode, options: { extraCards } });
    assert.equal(phase, "bidding");
    assert.equal(game.cardsPerPlayer(), cards);
    assert.equal(game.kitty.length, 0);
    assert.equal(game.placeBid(1, cards + 1).ok, false, "can't bid more tricks than there are");
  }
});

test("the extra-cards option widens the pack and the Benny adds a joker", () => {
  assert.equal(buildDeck({ ranks: 6 }).length, 24);
  assert.equal(buildDeck({ ranks: 7 }).length, 28);
  assert.equal(buildDeck({ ranks: 8 }).length, 32);
  assert.equal(buildDeck({ ranks: 6, benny: true }).length, 25);
  assert.ok(buildDeck({ ranks: 6 }).every((c) => c.value !== "8" && c.value !== "7"));

  const { game } = dealt({ options: { extraCards: "eights", benny: true } });
  assert.equal(game.players.reduce((n, p) => n + p.hand.length, 0) + game.kitty.length, 29);
});

// ---- ranking ----

test("the bowers and the Benny sit on top of the trump suit", () => {
  const order = [
    BENNY,
    card("J", "♠"),
    card("J", "♣"),
    card("A", "♠"),
    card("K", "♠"),
    card("A", "♥"),
    card("9", "♥"),
  ];
  const ranks = order.map((c) => cardRank(c, "♠", "♥"));
  for (let i = 1; i < ranks.length; i += 1) assert.ok(ranks[i - 1] > ranks[i], `${i} out of order`);

  assert.equal(effectiveSuit(card("J", "♣"), "♠"), "♠", "left bower is a trump");
  assert.equal(effectiveSuit(card("J", "♦"), "♠"), "♦", "an off-colour jack is not");
  assert.equal(effectiveSuit(BENNY, "♥"), "♥");
  assert.equal(cardRank(card("A", "♦"), "♠", "♥"), -1, "a card in neither suit takes nothing");
});

test("low no trump turns the ranking upside down", () => {
  assert.ok(cardRank(card("9", "♥"), null, "♥", true) > cardRank(card("A", "♥"), null, "♥", true));
  assert.ok(cardRank(card("A", "♥"), null, "♥", false) > cardRank(card("9", "♥"), null, "♥", false));
});

test("the left bower has to be followed as a trump, not as its own suit", () => {
  const { game } = dealt({
    hands: [
      [card("J", "♣"), card("A", "♣"), card("9", "♥")],
      plainHand("♦"),
      plainHand("♦"),
      plainHand("♦"),
    ],
    upcard: card("9", "♠"),
  });
  game.fixTrump(0, "♠", false);
  game.currentSeat = 1;
  game.currentTrick = [{ seat: 3, card: card("K", "♠") }];
  game.currentSeat = 0;
  assert.deepEqual(game.legalCards(0), [card("J", "♣")], "only the left bower follows spades");
});

// ---- making trump from the turn-up ----

test("the first round of calling is the turned suit only, the second anything else", () => {
  const { game } = dealt({ upcard: card("9", "♠") });
  assert.equal(game.currentSeat, 1);
  assert.equal(game.canCall(1, "♠"), true);
  assert.equal(game.canCall(1, "♥"), false);
  assert.equal(game.canCall(2, "♠"), false, "not your turn");

  for (const seat of [1, 2, 3, 0]) assert.equal(game.passCall(seat).ok, true);
  assert.equal(game.callRound, 2);
  assert.equal(game.canCall(1, "♠"), false, "the turned suit has been turned down");
  assert.equal(game.canCall(1, "♥"), true);
});

test("ordering up gives the dealer the turned card; naming a suit later does not", () => {
  const ordered = dealt({ upcard: card("9", "♠") }).game;
  assert.equal(ordered.callTrump(1, "♠").phase, "discard");
  assert.equal(ordered.players[0].hand.length, 6);
  assert.equal(ordered.discard(0, ordered.players[0].hand[0]).phase, "playing");
  assert.equal(ordered.players[0].hand.length, 5);
  assert.equal(ordered.currentSeat, 1, "eldest leads");

  const later = dealt({ upcard: card("9", "♠") }).game;
  for (const seat of [1, 2, 3, 0]) later.passCall(seat);
  assert.equal(later.callTrump(1, "♥").phase, "playing");
  assert.equal(later.players[0].hand.length, 5, "the turn-up stays where it is");
});

test("all four passing twice throws the hand in, unless the dealer is stuck with it", () => {
  const loose = dealt({ upcard: card("9", "♠") }).game;
  for (const seat of [1, 2, 3, 0, 1, 2, 3]) loose.passCall(seat);
  assert.equal(loose.passCall(0).redeal, true);

  const stuck = dealt({ options: { stickTheDealer: true }, upcard: card("9", "♠") }).game;
  for (const seat of [1, 2, 3, 0, 1, 2, 3]) stuck.passCall(seat);
  const forced = stuck.passCall(0);
  assert.equal(forced.stuck, true);
  assert.equal(stuck.currentSeat, 0);
  assert.equal(stuck.isStuck(), true);
  assert.equal(stuck.passCall(0).ok, false, "the dealer may not pass again");
  assert.equal(stuck.canCall(0, "♥"), true);
});

test("no calling on a bare bower, except when the dealer is stuck with the hand", () => {
  const options = { trumpNeedsMore: true };
  const bare = dealt({
    options,
    hands: [plainHand("♦"), [card("J", "♠"), ...plainHand("♦").slice(1)], plainHand("♦"), plainHand("♦")],
    upcard: card("9", "♠"),
  }).game;
  assert.equal(bare.canCall(1, "♠"), false, "the lone right bower isn't enough");

  const backed = dealt({
    options,
    hands: [plainHand("♦"), [card("J", "♠"), card("9", "♠"), card("A", "♦"), card("K", "♦"), card("Q", "♦")], plainHand("♦"), plainHand("♦")],
    upcard: card("9", "♠"),
  }).game;
  assert.equal(backed.canCall(1, "♠"), true);
});

test("the Benny turned up leaves the trump suit to the dealer", () => {
  const { game, phase } = dealUntil((up) => up.suit === "Joker", { options: { benny: true } });
  assert.equal(phase, "calling");
  assert.equal(game.currentSeat, game.dealerSeat);
  assert.equal(game.passCall(0).ok, false);
  assert.equal(game.canCall(1, "♠"), false, "nobody but the dealer");
  assert.equal(game.canCall(0, "♥"), true);
  assert.equal(game.callTrump(0, "♥").phase, "playing", "there is no suit to order up");
});

test("the dealer's partner may be made to go alone to take the deal", () => {
  const free = dealt({ upcard: card("9", "♠") }).game;
  free.passCall(1);
  free.callTrump(2, "♠");
  assert.equal(free.alone, false, "American tables let the partner assist");

  const forced = dealt({ options: { partnerMustGoAlone: true }, upcard: card("9", "♠") }).game;
  assert.equal(forced.aloneRule(2), "forced");
  assert.equal(forced.aloneRule(1), "may");
  forced.passCall(1);
  forced.callTrump(2, "♠");
  assert.equal(forced.alone, true);
  assert.equal(forced.players[0].active, false, "the dealer is out of the hand");
  assert.deepEqual(forced.activeSeats(), [1, 2, 3]);
});

test("partner's best trades the lone hand's worst card for the partner's best", () => {
  const { game } = dealt({
    options: { partnersBest: true },
    hands: [
      [card("J", "♠"), card("9", "♦"), card("9", "♣"), card("10", "♣"), card("Q", "♣")],
      plainHand("♥"),
      [card("9", "♠"), card("10", "♠"), card("9", "♥"), card("10", "♥"), card("Q", "♥")],
      plainHand("♦"),
    ],
    upcard: card("K", "♠"),
  });
  game.fixTrump(2, "♠", true);
  const lone = game.players[2].hand;
  const partner = game.players[0].hand;
  assert.ok(lone.some((c) => c.value === "J" && c.suit === "♠"), "took the partner's right bower");
  assert.ok(!partner.some((c) => c.value === "J" && c.suit === "♠"));
  assert.equal(lone.length, 5);
  assert.equal(partner.length, 5);
});

// ---- the escape hatches ----

test("a farmer's hand can be thrown in or swapped under the turn-up", () => {
  const nines = [card("9", "♠"), card("10", "♠"), card("9", "♥"), card("10", "♥"), card("9", "♦")];
  const options = { farmersHand: true };

  const scrapped = dealt({ options, hands: [plainHand("♣"), nines, plainHand("♦"), plainHand("♥")] }).game;
  assert.equal(scrapped.reliefKind(1), "farmer");
  assert.equal(scrapped.reliefKind(0), null);
  assert.equal(scrapped.claimRelief(1, "redeal").redeal, true);

  const under = dealt({ options, hands: [plainHand("♣"), nines, plainHand("♦"), plainHand("♥")] }).game;
  const taken = under.kitty.slice(1, 4);
  assert.equal(under.claimRelief(1, "under").ok, true);
  assert.equal(under.players[1].hand.length, 5);
  for (const swapped of taken) {
    assert.ok(under.players[1].hand.some((c) => c.suit === swapped.suit && c.value === swapped.value));
  }
  assert.equal(under.reliefKind(1), null, "only once a hand");
});

test("going under keeps the best of the hand and throws the three lowest", () => {
  const hand = [card("A", "♠"), card("9", "♠"), card("10", "♥"), card("9", "♦"), card("10", "♦")];
  const game = dealt({ options: { aceNoFace: true }, hands: [hand, hand, hand, hand] }).game;
  assert.equal(game.claimRelief(0, "under").ok, true);
  assert.ok(
    game.players[0].hand.some((c) => c.value === "A" && c.suit === "♠"),
    "the ace is the whole reason to swap"
  );
  for (const thrown of [card("9", "♠"), card("9", "♦"), card("10", "♥")]) {
    assert.ok(
      game.kitty.some((c) => c.suit === thrown.suit && c.value === thrown.value),
      `${thrown.value}${thrown.suit} should have gone under`
    );
  }
});

test("ace, no face gets the same escape, and only with an ace and no picture", () => {
  const options = { aceNoFace: true };
  const qualifies = [card("A", "♠"), card("9", "♠"), card("10", "♥"), card("9", "♦"), card("10", "♦")];
  const withKing = [card("A", "♠"), card("K", "♠"), card("10", "♥"), card("9", "♦"), card("10", "♦")];
  assert.equal(dealt({ options, hands: [qualifies, qualifies, qualifies, qualifies] }).game.reliefKind(0), "aceNoFace");
  assert.equal(dealt({ options, hands: [withKing, withKing, withKing, withKing] }).game.reliefKind(0), null);
  assert.equal(dealt({ hands: [qualifies, qualifies, qualifies, qualifies] }).game.reliefKind(0), null, "off by default");
});

// ---- standard scoring ----

// Scoring only reads the tricks each seat won, so a test can name the finished
// position directly instead of playing five tricks to arrive at it.
function scored({ variant = "northAmerican", mode = 4, options = {}, caller = 1, tricks, alone = false, setUp } = {}) {
  const game = new EuchreGame({ variant, mode, options });
  game.resetRound(0);
  if (game.bidState) game.bidState.highBidder = caller;
  game.callerSeat = caller;
  game.makerTeam = game.teamOf(caller);
  game.trumpSuit = "♠";
  game.alone = alone;
  if (alone) game.players[(caller + 2) % mode].active = false;
  tricks.forEach((won, seat) => (game.players[seat].tricksWon = won));
  setUp?.(game);
  return { game, result: game.scoreRound() };
}

test("the standard game scores one for the contract, two for a march, four alone", () => {
  assert.deepEqual(scored({ tricks: [1, 2, 1, 1] }).result.delta, [0, 1, 0, 1], "three tricks is a point");
  assert.deepEqual(scored({ tricks: [1, 3, 1, 0] }).result.delta, [0, 1, 0, 1]);
  assert.deepEqual(scored({ tricks: [0, 3, 0, 2] }).result.delta, [0, 2, 0, 2], "a march is two");
  assert.deepEqual(
    scored({ tricks: [0, 5, 0, 0], alone: true }).result.delta,
    [0, 4, 0, 4],
    "a lone march is four"
  );
  assert.deepEqual(
    scored({ tricks: [1, 3, 1, 0], alone: true }).result.delta,
    [0, 1, 0, 1],
    "a lone hand that only makes it is still one"
  );
  assert.deepEqual(scored({ tricks: [2, 1, 1, 1] }).result.delta, [2, 0, 2, 0], "a euchre pays two");
});

test("a defender who answers a lone hand alone is playing for four", () => {
  const { result } = scored({
    options: { defendAlone: true },
    tricks: [0, 2, 3, 0],
    alone: true,
    setUp: (game) => {
      game.aloneDefenderSeat = 2;
      game.players[0].active = false;
    },
  });
  assert.deepEqual(result.delta, [4, 0, 4, 0]);
});

test("Robson rules take a march off the other side, and pay five for a blind lone hand", () => {
  const options = { robson: true };
  const deducted = scored({
    options,
    tricks: [0, 5, 0, 0],
    setUp: (game) => game.players.forEach((p) => (p.score = 8)),
  });
  assert.deepEqual(deducted.result.delta, [-2, 0, -2, 0], "taken off the defenders");

  const added = scored({ options, tricks: [0, 5, 0, 0] });
  assert.deepEqual(added.result.delta, [0, 2, 0, 2], "nothing there to take, so it is added");

  const blindMade = scored({
    options,
    caller: 0,
    alone: true,
    tricks: [5, 0, 0, 0],
    setUp: (game) => (game.blindLoner = true),
  });
  assert.deepEqual(blindMade.result.delta, [5, 0, 5, 0]);

  const blindFailed = scored({
    options,
    caller: 0,
    alone: true,
    tricks: [1, 2, 0, 2],
    setUp: (game) => (game.blindLoner = true),
  });
  assert.deepEqual(blindFailed.result.delta, [0, 1, 0, 1], "the defenders get one, not two");
});

test("a turned jack offers the dealer a blind lone hand under Robson rules", () => {
  const jack = (up) => up.value === "J";
  const { game, phase } = dealUntil(jack, { options: { robson: true } });
  assert.equal(phase, "blind");
  assert.equal(game.blindSeat, 0);
  assert.equal(game.takeBlind(1, true).ok, false, "not your offer");
  const suit = game.upcard.suit;
  assert.equal(game.takeBlind(0, true).phase, "discard");
  assert.equal(game.blindLoner, true);
  assert.equal(game.alone, true);
  assert.equal(game.trumpSuit, suit);

  const declined = dealUntil(jack, { options: { robson: true } }).game;
  assert.equal(declined.takeBlind(0, false).phase, "calling");
  assert.equal(declined.blindLoner, false);

  const off = dealUntil(jack).game;
  assert.equal(off.blindSeat, null, "no offer without Robson rules");
});

test("point on partner pays a bonus and keeps the deal where it is", () => {
  const options = { pointOnPartner: true };
  const made = scored({ options, caller: 2, tricks: [1, 1, 3, 0] });
  assert.deepEqual(made.result.delta, [2, 0, 2, 0], "one for the hand and one for the steal");
  assert.equal(made.result.keepDeal, true);

  const euchred = scored({ options, caller: 2, tricks: [1, 2, 1, 1] });
  assert.deepEqual(euchred.result.delta, [0, 2, 0, 2]);
  assert.equal(euchred.result.keepDeal, false);
});

test("with no partnerships, the euchre goes to whoever stopped it", () => {
  const clear = scored({ mode: 3, tricks: [1, 1, 3] });
  assert.deepEqual(clear.result.delta, [0, 0, 2]);
  const tied = scored({ mode: 3, tricks: [2, 1, 2] });
  assert.deepEqual(tied.result.delta, [1, 0, 1], "a tie is one each");
});

test("the game-length option overrides what the rule set says", () => {
  assert.equal(new EuchreGame({ variant: "northAmerican" }).target, 10);
  assert.equal(new EuchreGame({ variant: "british" }).target, 11);
  assert.equal(new EuchreGame({ variant: "earliest" }).target, 5);
  assert.equal(new EuchreGame({ variant: "northAmerican", options: { target: "11" } }).target, 11);
  assert.equal(new EuchreGame({ variant: "british", options: { target: "7" } }).target, 7);
});

// ---- three-handed ----

test("three-handed scores four, six and seven tricks differently", () => {
  const three = (tricks) => scored({ variant: "threeHanded", mode: 3, caller: 0, tricks }).result;
  assert.equal(three([4, 2, 1]).delta[0], 1);
  assert.equal(three([5, 1, 1]).delta[0], 1);
  assert.equal(three([6, 1, 0]).delta[0], 2);
  assert.equal(three([7, 0, 0]).delta[0], 4);
  assert.deepEqual(three([3, 3, 1]).delta, [0, 2, 0], "euchred: the best defender takes two");
  assert.deepEqual(three([3, 2, 2]).delta, [0, 1, 1], "or one each when they tie");
});

// ---- Bid Euchre ----

test("the auction runs once round the table and only accepts a higher bid", () => {
  const { game } = dealt({ variant: "bid", mode: 4 });
  assert.equal(game.bidState.currentSeat, 1);
  assert.equal(game.placeBid(2, 3).ok, false, "out of turn");
  assert.equal(game.placeBid(1, 3).ok, true);
  assert.equal(game.placeBid(2, 3).ok, false, "not above the standing bid");
  assert.equal(game.placeBid(2, 0).ok, true);
  assert.equal(game.placeBid(3, 4).ok, true);
  assert.equal(game.placeBid(0, 0).phase, "chooseTrump");
  assert.equal(game.bidState.highBidder, 3);
  assert.equal(game.tricksNeeded(), 4);
});

test("nobody bidding throws the hand in, or sticks the dealer with one trick", () => {
  const loose = dealt({ variant: "bid", mode: 4 }).game;
  for (const seat of [1, 2, 3]) loose.placeBid(seat, 0);
  assert.equal(loose.placeBid(0, 0).redeal, true);

  const stuck = dealt({ variant: "bid", mode: 4, options: { stickTheDealer: true } }).game;
  for (const seat of [1, 2, 3]) stuck.placeBid(seat, 0);
  assert.equal(stuck.placeBid(0, 0).phase, "chooseTrump");
  assert.equal(stuck.bidState.highBidder, 0);
  assert.equal(stuck.bidState.highBid, 1);
});

test("the high bidder names a suit, or no trump played high or low", () => {
  const named = dealt({ variant: "bid", mode: 4, options: { folding: false } }).game;
  named.bidState.highBidder = 1;
  assert.equal(named.chooseBidTrump(2, "♠").ok, false, "not the bidder");
  assert.equal(named.chooseBidTrump(1, "♠").phase, "playing");
  assert.equal(named.trumpSuit, "♠");

  const low = dealt({ variant: "bid", mode: 4, options: { folding: false } }).game;
  low.bidState.highBidder = 1;
  assert.equal(low.chooseBidTrump(1, undefined, true, true).ok, true);
  assert.equal(low.trumpSuit, null);
  assert.equal(low.lowNoTrump, true);

  const suitsOnly = dealt({ variant: "bid", mode: 4, options: { noTrumpBids: false, folding: false } }).game;
  suitsOnly.bidState.highBidder = 1;
  assert.equal(suitsOnly.chooseBidTrump(1, undefined, true).ok, false);
});

test("Bid Euchre comes down by tricks, up five for a missed bid or a blank hand", () => {
  const options = { folding: false };
  const made = scored({ variant: "bid", mode: 4, options, caller: 1, tricks: [1, 3, 2, 0], setUp: (g) => (g.bidState.highBid = 3) });
  assert.deepEqual(made.result.delta, [-1, -3, -2, 5], "the blank hand is set five");
  assert.deepEqual(made.game.players.map((p) => p.score), [20, 18, 19, 26]);

  const missed = scored({ variant: "bid", mode: 4, options, caller: 1, tricks: [2, 2, 1, 1], setUp: (g) => (g.bidState.highBid = 4) });
  assert.deepEqual(missed.result.delta, [-2, 3, -1, -1], "five for the set, less the two tricks");

  const folded = scored({
    variant: "bid",
    mode: 4,
    caller: 1,
    tricks: [0, 4, 2, 0],
    setUp: (game) => {
      game.bidState.highBid = 4;
      game.players[3].folded = true;
    },
  });
  assert.deepEqual(folded.result.delta, [5, -4, -2, 0], "folding scores nothing and risks nothing");
});

test("Bid Euchre in partnerships pools a side's tricks and keeps one score", () => {
  const { game, result } = scored({
    variant: "bid",
    mode: 4,
    options: { bidPartners: true },
    caller: 1,
    tricks: [0, 3, 2, 1],
    setUp: (g) => (g.bidState.highBid = 4),
  });
  assert.equal(game.partnerships(), true);
  assert.deepEqual(result.delta, [-2, -4, -2, -4], "each side takes its own total");
  assert.deepEqual(game.players.map((p) => p.score), [19, 17, 19, 17]);
});

test("everyone folding hands the bidder the tricks and nobody else a penalty", () => {
  const { game } = dealt({ variant: "bid", mode: 4, options: { folding: true } });
  game.bidState.highBid = 3;
  game.bidState.highBidder = 1;
  assert.equal(game.chooseBidTrump(1, "♠").phase, "declaring");
  assert.deepEqual(game.pending, [0, 2, 3]);
  assert.equal(game.declare(1, "fold").ok, false, "the bidder may never fold");
  game.declare(0, "fold");
  game.declare(2, "fold");
  assert.equal(game.declare(3, "fold").phase, "walkover");
});

// ---- Set-Back ----

test("Set-Back comes down by tricks, up one for a blank hand and two for a euchre", () => {
  const options = { folding: false };
  const made = scored({ variant: "setback", mode: 4, options, caller: 1, tricks: [1, 3, 1, 0] });
  assert.deepEqual(made.result.delta, [-1, -3, -1, 1]);
  assert.deepEqual(made.game.players.map((p) => p.score), [4, 2, 4, 6]);

  const set = scored({ variant: "setback", mode: 4, options, caller: 1, tricks: [2, 2, 1, 0] });
  assert.deepEqual(set.result.delta, [-2, 0, -1, 1], "two for the set against two tricks");

  const paying = scored({
    variant: "setback",
    mode: 4,
    options: { folding: false, defendersDeduct: true },
    caller: 1,
    tricks: [2, 2, 1, 0],
  });
  assert.deepEqual(paying.result.delta, [-4, 0, -3, -1], "the defenders take two off as well");
});

test("declaring for the march in Set-Back wins outright or doubles the declarer", () => {
  const options = { declare: true, folding: false };
  const swept = scored({
    variant: "setback",
    mode: 4,
    options,
    caller: 1,
    tricks: [0, 5, 0, 0],
    setUp: (game) => (game.declaredMarch = true),
  });
  assert.equal(swept.game.outrightWinner, 1);
  assert.deepEqual(swept.game.winners(), [1]);

  const dropped = scored({
    variant: "setback",
    mode: 4,
    options,
    caller: 1,
    tricks: [1, 4, 0, 0],
    setUp: (game) => (game.declaredMarch = true),
  });
  assert.equal(dropped.game.players[1].score, 10, "five doubled");
  assert.equal(dropped.game.outrightWinner, null);
});

// ---- winning ----

test("a target game is won by reaching it and a countdown by getting to zero", () => {
  const up = new EuchreGame({ variant: "northAmerican", mode: 4 });
  assert.deepEqual(up.winners(), []);
  up.players[0].score = 9;
  up.players[2].score = 9;
  assert.deepEqual(up.winners(), []);
  up.players[1].score = 10;
  up.players[3].score = 10;
  assert.deepEqual(up.winners(), [1, 3]);

  const down = new EuchreGame({ variant: "setback", mode: 4 });
  assert.deepEqual(down.winners(), []);
  down.players[2].score = 0;
  assert.deepEqual(down.winners(), [2]);
  down.players[3].score = -2;
  assert.deepEqual(down.winners(), [3], "the further past the line wins the race");
});

// ---- play ----

test("you must follow suit while you can, and may play anything once void", () => {
  const { game } = dealt({
    hands: [
      [card("A", "♥"), card("9", "♥"), card("A", "♦")],
      [card("K", "♥"), card("A", "♣"), card("9", "♦")],
      [card("A", "♠"), card("K", "♠"), card("Q", "♠")],
      [card("9", "♠"), card("10", "♠"), card("J", "♦")],
    ],
    upcard: card("K", "♣"),
  });
  game.fixTrump(1, "♣", false);
  game.currentSeat = 0;
  assert.equal(game.playCard(1, card("A", "♣")).ok, false, "not your turn");
  assert.equal(game.playCard(0, card("A", "♥")).ok, true);
  assert.deepEqual(game.legalCards(1), [card("K", "♥")]);
  assert.equal(game.playCard(1, card("A", "♣")).ok, false, "you hold a heart");
  game.playCard(1, card("K", "♥"));
  assert.equal(game.legalCards(2).length, 3, "void in hearts, so anything goes");
  game.playCard(2, card("A", "♠"));
  const last = game.playCard(3, card("9", "♠"));
  assert.equal(last.trickDone, true);
  assert.equal(last.resolved.winnerSeat, 0, "the ace of hearts held it");
  assert.deepEqual(last.resolved.winningCard, card("A", "♥"), "and is the card that took it");
  assert.equal(game.players[0].tricksWon, 1);
  assert.equal(game.currentSeat, 0, "the winner leads");
});

test("a lone hand is played out by three, and the sitting partner takes no turn", () => {
  const { game } = dealt({ upcard: card("9", "♠") });
  game.callTrump(1, "♠", true);
  game.discard(0, game.players[0].hand[0]);
  assert.deepEqual(game.activeSeats(), [0, 1, 2], "the maker's partner sits out");
  assert.equal(game.currentSeat, 1, "eldest is the maker here, and leads");
  const trick = [];
  for (const seat of [1, 2, 0]) trick.push(game.playCard(seat, game.legalCards(seat)[0]));
  assert.equal(trick[2].trickDone, true, "three cards complete the trick");
});

// ---- the bot ----

test("the bot throws its lowest card away, not the first one in its hand", () => {
  const euchreBot = require("./euchreBot");
  const { game } = dealt({
    hands: [
      [card("A", "♣"), card("K", "♣"), card("Q", "♣"), card("9", "♣"), card("10", "♣")],
      [card("A", "♠"), card("9", "♥"), card("10", "♦"), card("Q", "♦"), card("K", "♦")],
      plainHand("♠"),
      plainHand("♥"),
    ],
    upcard: card("J", "♣"),
  });
  game.fixTrump(0, "♣", false);
  game.currentSeat = 0;
  game.playCard(0, card("A", "♣"));
  assert.deepEqual(euchreBot.choosePlay(game, 1), card("9", "♥"), "the nine, keeping the ace");
});
