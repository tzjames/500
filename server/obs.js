// The bridge between a Game500Four and a neural network: a fixed-width vector
// of what one seat can legally see, a fixed action space for everything a seat
// can be asked to decide, and a mask saying which of those actions the rules
// allow right now.
//
// Training and the live server both go through this file, which is the point of
// it — a policy learnt in Python is fed exactly the same numbers when it sits
// down at a real table, so the two can't drift apart into a bot that plays
// worse in production than it did in the trainer.
//
// Two rules this file must never break:
//   1. Nothing goes into an observation that the seat couldn't see at a table.
//      No other hand, no undealt kitty, no peeking at what's left in the deck.
//   2. Every action offered by the mask is one the engine will accept, so the
//      network can never produce an illegal call or play.
const {
  Game500Four,
  RANKS,
  REAL_SUITS,
  BID_SUITS,
  SPECIAL_BIDS,
  isNoTricksBid,
  getCardRank,
  getEffectiveSuit,
} = require("./game4");
const { OPTIONS } = require("./gameOptions");

// ---- cards as indices ----

// Suit-major with a full eleven rank slots each, so the index of a card is
// arithmetic rather than a lookup. The two slots for the black fours are simply
// never set — a couple of dead inputs is a cheaper price than an index scheme
// that has to know which cards the 500 pack leaves out.
const RANK_COUNT = RANKS.length;
const JOKER_INDEX = REAL_SUITS.length * RANK_COUNT;
const CARD_COUNT = JOKER_INDEX + 1;

function cardIndex(card) {
  if (card.suit === "Joker") return JOKER_INDEX;
  return REAL_SUITS.indexOf(card.suit) * RANK_COUNT + RANKS.indexOf(card.value);
}

function cardFromIndex(index) {
  if (index === JOKER_INDEX) return { suit: "Joker", value: "Joker" };
  return {
    suit: REAL_SUITS[Math.floor(index / RANK_COUNT)],
    value: RANKS[index % RANK_COUNT],
  };
}

// Which indices are actually in the pack, taken from the engine's own deck so
// there is one definition of what 500 is played with.
const DECK_INDICES = new Game500Four()
  .createDeck()
  .map(cardIndex)
  .sort((a, b) => a - b);

// ---- the action space ----

// One flat space covering all four things a seat gets asked. It is a fixed
// superset of every house rule: contracts this table doesn't play are simply
// masked off, so the same network can sit at any table without its output
// layer changing shape.
//
// "Pass" is first and the specials come last so that adding a new contract to
// SPECIAL_BIDS appends to the end and leaves every existing index — and so
// every trained model — still meaning what it meant.
const BID_ACTIONS = ["Pass"];
for (let level = 6; level <= 10; level++) {
  for (const suit of BID_SUITS) BID_ACTIONS.push(`${level} ${suit}`);
}
for (const bid of Object.keys(SPECIAL_BIDS)) BID_ACTIONS.push(bid);

// Picking a card covers playing one, throwing one to the kitty and sending one
// across the table on a Double Nullo; which of those it means is in the
// observation's phase block, so the three share a block of indices.
const CARD_OFFSET = BID_ACTIONS.length;
// Leading the Joker at no trumps names a suit, so those four leads are their
// own actions rather than a second decision the caller has to remember to ask.
const NOMINATE_OFFSET = CARD_OFFSET + CARD_COUNT;
const ACTION_COUNT = NOMINATE_OFFSET + REAL_SUITS.length;

const bidAction = (bid) => BID_ACTIONS.indexOf(bid);
const cardActionOf = (card) => CARD_OFFSET + cardIndex(card);

// A Joker led with no trump suit has no suit of its own, so the rules make the
// leader name one — that's true whether or not the strict-lead option is on.
const needsNomination = (game, card) =>
  card.suit === "Joker" && !game.trumpSuit && game.currentTrick.length === 0;

function decodeAction(action) {
  if (action < CARD_OFFSET) return { kind: "bid", bid: BID_ACTIONS[action] };
  if (action < NOMINATE_OFFSET) {
    return { kind: "card", card: cardFromIndex(action - CARD_OFFSET) };
  }
  return {
    kind: "card",
    card: { suit: "Joker", value: "Joker" },
    nominatedSuit: REAL_SUITS[action - NOMINATE_OFFSET],
  };
}

// Every action the rules allow this seat right now. `ctx.kind` says which
// decision is on the table; discard and pass carry the cards still available to
// pick from, since those are made one card at a time.
function legalActionMask(game, seat, ctx) {
  const mask = new Array(ACTION_COUNT).fill(0);

  if (ctx.kind === "bid") {
    BID_ACTIONS.forEach((bid, i) => {
      if (game.bidLegality(seat, bid).ok) mask[i] = 1;
    });
    return mask;
  }

  if (ctx.kind === "discard" || ctx.kind === "pass") {
    for (const card of ctx.pool) mask[cardActionOf(card)] = 1;
    return mask;
  }

  for (const card of game.legalPlays(seat)) {
    if (needsNomination(game, card)) {
      for (let s = 0; s < REAL_SUITS.length; s++) mask[NOMINATE_OFFSET + s] = 1;
    } else {
      mask[cardActionOf(card)] = 1;
    }
  }
  return mask;
}

// ---- the observation ----

const DECISION_KINDS = ["bid", "discard", "pass", "play"];

// Sorted so that reordering src/gameOptions.json can't quietly permute the
// inputs a trained model was fitted to.
const OPTION_IDS = OPTIONS.filter((o) => o.type === "bool")
  .map((o) => o.id)
  .sort();

// Is this seat trying to take no tricks? True for a Misère bidder, for both
// partners on a Double Nullo, and for a Hi-Lo bidder who already has their
// five. Mirrors the same judgement bot.js makes, as a feature rather than a
// decision — it's the single most useful thing to hand the network, since it
// flips the meaning of every card in the hand.
function isAvoidingTricks(game, seat) {
  const spec = game.contractSpec();
  if (!spec) return false;
  const bidderSeat = game.currentBid.seat;
  const onContract =
    seat === bidderSeat || (spec.bothPartners && seat === game.partnerOf(bidderSeat));
  if (!onContract) return false;
  if (spec.exact) return game.players[bidderSeat].tricksWon >= spec.target;
  return true;
}

// How many of `sortedDescending` are strictly greater than `value`. The lists
// below are built once per observation and walked once per card in hand, so this
// is a binary search rather than a scan.
function countAbove(sortedDescending, value) {
  let low = 0;
  let high = sortedDescending.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedDescending[mid] > value) low = mid + 1;
    else high = mid;
  }
  return low;
}

// ---- what the hand is worth, rather than what it contains ----
//
// Everything above is raw: which cards are where, as one-hot vectors. A network
// given only that has to learn the whole of 500's ranking from scratch — that
// the Joker beats the right bower beats the left bower beats the trump ace, that
// an off-suit card can't win at all — and then do set arithmetic over the unseen
// cards on top of it, all from a single reward at the end of the hand.
//
// bot.js learns none of that. It calls isTopRemaining() and gets an answer. The
// first attempt at training left the network to infer the same thing from the
// one-hot blocks, and its card play stalled about 22 points a hand behind the
// heuristics while its bidding drew level — so these are the heuristic's own
// quantities, handed over instead of inferred.
function handFeatures(game, seat, hand, unseen) {
  const trump = game.trumpSuit;
  const options = game.options;

  // Every unseen card's rank under each possible led suit, high to low. Built
  // once here so "what still out there beats this card" is one lookup per card
  // rather than a pass over the whole pack.
  const unseenRanks = {};
  for (const suit of REAL_SUITS) {
    unseenRanks[suit] = unseen
      .map((index) => getCardRank(cardFromIndex(index), trump, suit, options))
      .sort((a, b) => b - a);
  }

  // What's currently winning the trick, and in what suit.
  const leadSuit = game.currentTrick.length > 0 ? game.getLeadSuit(game.currentTrick[0]) : null;
  let bestInTrick = -Infinity;
  for (const play of game.currentTrick) {
    const rank = getCardRank(play.card, trump, leadSuit, options);
    if (rank > bestInTrick) bestInTrick = rank;
  }

  const topRemaining = new Array(CARD_COUNT).fill(0);
  const beatersOut = new Array(CARD_COUNT).fill(0);
  const beatsTrick = new Array(CARD_COUNT).fill(0);
  const isTrump = new Array(CARD_COUNT).fill(0);
  let trumpsHeld = 0;

  for (const card of hand) {
    const index = cardIndex(card);
    // The suit this card would be led in — its own, as the rules see it.
    const ownSuit = getEffectiveSuit(card, trump) || card.suit;
    const ranks = unseenRanks[ownSuit] || [];
    const above = countAbove(ranks, getCardRank(card, trump, ownSuit, options));
    beatersOut[index] = Math.min(above, 12) / 12;
    topRemaining[index] = above === 0 ? 1 : 0;

    if (leadSuit && getCardRank(card, trump, leadSuit, options) > bestInTrick) beatsTrick[index] = 1;
    if (trump && (card.suit === "Joker" || getEffectiveSuit(card, trump) === trump)) {
      isTrump[index] = 1;
      trumpsHeld += 1;
    }
  }

  // Trumps still unaccounted for — the whole of "draw trumps while you hold the
  // top of them" turns on this and on trumpsHeld.
  const trumpsOut = trump
    ? unseen.filter((index) => {
        const card = cardFromIndex(index);
        return card.suit === "Joker" || getEffectiveSuit(card, trump) === trump;
      }).length
    : 0;

  const held = (suit) => hand.filter((card) => getEffectiveSuit(card, trump) === suit).length;

  return [
    ...topRemaining,
    ...beatersOut,
    ...beatsTrick,
    ...isTrump,
    trumpsHeld / 13,
    trumpsOut / 15,
    // Void in each suit as the rules count it, which is what says whether this
    // seat can be thrown the lead or can ruff.
    ...REAL_SUITS.map((suit) => (held(suit) === 0 ? 1 : 0)),
    // Where in the trick this seat is sitting. Playing last is worth knowing:
    // it's the difference between covering cheaply and guessing.
    game.currentTrick.length / 4,
    Math.max(0, game.activeSeats().length - 1 - game.currentTrick.length) / 3,
    game.currentTrick.length === 0 ? 1 : 0,
    leadSuit && held(leadSuit) > 0 ? 1 : 0,
  ];
}

// Everything the acting seat can see, as one flat vector of floats.
//
// Seats are encoded *relative* to whoever is acting — slot 0 is me, 1 is the
// player on my left, 2 is my partner, 3 is on my right — so a single network
// plays all four seats and doesn't have to learn the same partnership four
// times over.
function encodeObservation(game, seat, ctx) {
  const auction = game.auction || {};
  const hand = game.players[seat].hand;
  const spec = game.contractSpec();

  const cardSet = (cards) => {
    const v = new Array(CARD_COUNT).fill(0);
    for (const card of cards) v[cardIndex(card)] = 1;
    return v;
  };
  const oneHot = (size, index) => {
    const v = new Array(size).fill(0);
    if (index >= 0 && index < size) v[index] = 1;
    return v;
  };
  const suitHot = (suit) => oneHot(REAL_SUITS.length + 1, suit ? REAL_SUITS.indexOf(suit) : REAL_SUITS.length);
  const relSeat = (other) => (other - seat + 4) % 4;
  // One number per seat, ordered from the acting seat around the table.
  const byRelSeat = (fn) => [0, 1, 2, 3].map((r) => fn((seat + r) % 4));
  const seatHot = (other) =>
    oneHot(5, other === null || other === undefined ? 4 : relSeat(other));

  const playedCards = game.playedCards.map((p) => p.card);
  const seen = new Set([...hand, ...playedCards].map(cardIndex));
  const unseen = DECK_INDICES.filter((i) => !seen.has(i));

  const leadSuit =
    game.currentTrick.length > 0 ? game.getLeadSuit(game.currentTrick[0]) : null;
  const myTeam = game.teamOf(seat);
  const contractSeat = game.currentBid ? game.currentBid.seat : null;

  return [
    // What I hold, and what has already hit the table.
    ...cardSet(hand),
    ...cardSet(playedCards),
    // The trick in progress, by who played what.
    ...byRelSeat((s) => {
      const play = game.currentTrick.find((p) => p.seat === s);
      return cardSet(play ? [play.card] : []);
    }).flat(),
    // What's still out there. Derivable from the two blocks above, but it's the
    // quantity every decision actually turns on, so it's handed over directly.
    ...unseen.reduce((v, i) => { v[i] = 1; return v; }, new Array(CARD_COUNT).fill(0)),
    // Cards I've already committed to this discard or pass.
    ...cardSet(ctx.chosen || []),

    ...suitHot(game.trumpSuit),
    ...suitHot(leadSuit),
    ...oneHot(DECISION_KINDS.length, DECISION_KINDS.indexOf(ctx.kind)),

    // The contract, and where I stand in relation to it.
    ...oneHot(BID_ACTIONS.length, game.currentBid ? bidAction(game.currentBid.bid) : -1),
    ...seatHot(contractSeat),
    game.noContract ? 1 : 0,
    contractSeat !== null && game.teamOf(contractSeat) === myTeam ? 1 : 0,
    contractSeat === seat ? 1 : 0,
    isAvoidingTricks(game, seat) ? 1 : 0,
    game.isOpenContract() ? 1 : 0,
    spec?.exact ? 1 : 0,
    spec?.bothPartners ? 1 : 0,
    isNoTricksBid(game.currentBid?.bid) ? 1 : 0,

    // How the hand is going.
    ...byRelSeat((s) => game.players[s].tricksWon / 10),
    ...byRelSeat((s) => (game.players[s].folded ? 1 : 0)),
    ...byRelSeat((s) => game.players[s].hand.length / 13),
    game.teamScores[myTeam] / 500,
    game.teamScores[1 - myTeam] / 500,

    // The auction so far.
    ...oneHot(BID_ACTIONS.length, auction.highBid ? bidAction(auction.highBid.bid) : -1),
    ...seatHot(auction.highBid ? auction.highBid.seat : null),
    ...byRelSeat((s) => ((auction.passedEver || []).includes(s) ? 1 : 0)),
    ...byRelSeat((s) => ((auction.passedSinceBid || []).includes(s) ? 1 : 0)),
    ...byRelSeat((s) => ((auction.barredSeats || []).includes(s) ? 1 : 0)),
    ...byRelSeat((s) => (s === game.dealerSeat ? 1 : 0)),
    auction.complete ? 1 : 0,
    (auction.history || []).length / 12,

    // How many cards this decision still has to pick, for the sequential ones.
    (ctx.picksRemaining || 0) / 5,

    // The heuristic's own reading of the hand — see handFeatures.
    ...handFeatures(game, seat, hand, unseen),

    // The house rules, since they change what a hand is worth.
    ...OPTION_IDS.map((id) => (game.options[id] ? 1 : 0)),
  ];
}

// Measured rather than declared, so the blocks above can be edited without a
// hand-maintained total falling out of step with them.
const OBS_SIZE = encodeObservation(new Game500Four(), 0, { kind: "bid" }).length;

module.exports = {
  CARD_COUNT,
  JOKER_INDEX,
  DECK_INDICES,
  BID_ACTIONS,
  CARD_OFFSET,
  NOMINATE_OFFSET,
  ACTION_COUNT,
  OBS_SIZE,
  DECISION_KINDS,
  OPTION_IDS,
  cardIndex,
  cardFromIndex,
  bidAction,
  cardActionOf,
  needsNomination,
  decodeAction,
  legalActionMask,
  encodeObservation,
  isAvoidingTricks,
  handFeatures,
};
