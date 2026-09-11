// A robot to fill an empty Euchre seat. Rules of thumb, not search: count the
// tricks your hand looks like taking, call when that beats what passing is
// worth, lead your top trump when you're the maker and your ace when you're
// not. It only has to avoid embarrassing itself, and it must never attempt an
// illegal call or play.
const { SUITS, RANKS, cardRank, effectiveSuit, isBenny } = require("./euchre");

// Roughly how many tricks a hand takes with this suit as trump. Whole tricks
// for the certainties, fractions for the cards that usually come home.
function expectedTricks(hand, trumpSuit, seats) {
  const trumps = hand.filter((card) => effectiveSuit(card, trumpSuit) === trumpSuit);
  let tricks = 0;
  if (trumps.some(isBenny)) tricks += 1;
  if (trumps.some((c) => c.value === "J" && c.suit === trumpSuit)) tricks += 1;
  if (trumps.some((c) => c.value === "J" && c.suit !== trumpSuit && !isBenny(c))) tricks += 0.85;
  if (trumps.some((c) => c.value === "A")) tricks += 0.8;
  if (trumps.some((c) => c.value === "K")) tricks += 0.5;
  if (trumps.some((c) => c.value === "Q")) tricks += 0.25;
  tricks += Math.max(0, trumps.length - 3) * 0.5;

  for (const suit of SUITS) {
    if (suit === trumpSuit) continue;
    const cards = hand.filter((card) => effectiveSuit(card, trumpSuit) === suit);
    if (cards.some((c) => c.value === "A")) tricks += seats > 2 ? 0.6 : 0.75;
    if (cards.some((c) => c.value === "K") && cards.length >= 2) tricks += 0.25;
    // A void or singleton is a ruffing chance, but only with trumps to ruff.
    if (cards.length === 0 && trumps.length >= 2) tricks += 0.4;
  }
  return tricks;
}

function expectedTricksNoTrump(hand, low) {
  let tricks = 0;
  for (const suit of SUITS) {
    const cards = hand
      .filter((card) => card.suit === suit)
      .sort((a, b) => RANKS.indexOf(a.value) - RANKS.indexOf(b.value));
    if (!cards.length) continue;
    const top = low ? cards[0] : cards[cards.length - 1];
    if (low ? RANKS.indexOf(top.value) <= 1 : top.value === "A") tricks += 0.8;
    else if (low ? RANKS.indexOf(top.value) <= 2 : top.value === "K") tricks += 0.4;
    tricks += Math.max(0, cards.length - 3) * 0.3;
  }
  return tricks;
}

// The suit this hand would most like to make trump, and what it's worth.
function bestSuit(game, seat, allowed = SUITS) {
  const hand = [...game.players[seat].hand];
  if (seat === game.dealerSeat && game.callRound === 1 && game.upcard) hand.push(game.upcard);
  let best = null;
  for (const suit of allowed) {
    const value = expectedTricks(hand, suit, game.mode);
    if (!best || value > best.value) best = { suit, value };
  }
  return best;
}

// ---- making trump from the turned card ----

function chooseCall(game, seat) {
  const needed = game.tricksNeeded();
  const legal = SUITS.filter((suit) => game.canCall(seat, suit));
  if (!legal.length) return { action: "pass" };

  const best = bestSuit(game, seat, legal);
  // Ordering up hands the dealer's side the turned card, so it wants more.
  const dealerIsPartner = game.partnerships() && (seat + 2) % game.mode === game.dealerSeat;
  const margin = game.callRound === 1 && game.dealerSeat !== seat && !dealerIsPartner ? 0.6 : 0.2;
  // Stuck with the deal, or holding the turned Benny: passing isn't on offer.
  const mustCall = game.isStuck() || isBenny(game.upcard);
  if (!mustCall && best.value < needed + margin) return { action: "pass" };

  const rule = game.aloneRule(seat);
  const alone = rule === "forced" || (rule === "may" && best.value >= game.cardsPerPlayer() - 0.4);
  return { action: "call", suit: best.suit, alone };
}

// The dealer's throw-away after taking the turned card up: the lowest card of
// the shortest side suit, so a void to ruff into is worth keeping.
function chooseDiscard(game, seat) {
  const hand = game.players[seat].hand;
  const offTrump = hand.filter((card) => effectiveSuit(card, game.trumpSuit) !== game.trumpSuit);
  if (!offTrump.length) return hand.reduce((low, card) => (rankIn(game, card) < rankIn(game, low) ? card : low));
  const lengths = {};
  for (const card of offTrump) lengths[card.suit] = (lengths[card.suit] || 0) + 1;
  return offTrump.reduce((worst, card) => {
    const score = lengths[card.suit] * 20 + RANKS.indexOf(card.value);
    const bestScore = lengths[worst.suit] * 20 + RANKS.indexOf(worst.value);
    return score < bestScore ? card : worst;
  });
}

const rankIn = (game, card) => cardRank(card, game.trumpSuit, effectiveSuit(card, game.trumpSuit), game.lowNoTrump);

// ---- Bid Euchre's auction ----

function chooseBid(game, seat) {
  const hand = game.players[seat].hand;
  const suit = bestSuit(game, seat).value;
  const noTrump = game.options.noTrumpBids
    ? Math.max(expectedTricksNoTrump(hand, false), expectedTricksNoTrump(hand, true))
    : 0;
  const worth = Math.floor(Math.max(suit, noTrump));
  const standing = game.bidState.highBid || 0;
  return worth > standing && worth >= 2 ? worth : 0;
}

function chooseBidTrump(game, seat) {
  const hand = game.players[seat].hand;
  const suited = bestSuit(game, seat);
  if (game.options.noTrumpBids) {
    const high = expectedTricksNoTrump(hand, false);
    const low = expectedTricksNoTrump(hand, true);
    if (Math.max(high, low) > suited.value) return { noTrump: true, lowNoTrump: low > high };
  }
  return { suit: suited.suit };
}

// ---- the declarations before the first lead ----

function chooseDeclaration(game, seat) {
  const actions = game.pendingActions(seat);
  if (actions.includes("fold")) {
    const value = game.trumpSuit
      ? expectedTricks(game.players[seat].hand, game.trumpSuit, game.mode)
      : expectedTricksNoTrump(game.players[seat].hand, game.lowNoTrump);
    // Staying in costs the set penalty if the hand takes nothing, so the bar
    // for folding is far higher in Bid Euchre, where being set is worth five.
    const penalty = game.variant === "bid" ? 5 : 1;
    if (value < 0.15 + 0.35 * penalty) return "fold";
  }
  if (actions.includes("declare")) {
    const value = expectedTricks(game.players[seat].hand, game.trumpSuit, game.mode);
    if (value >= game.cardsPerPlayer() - 0.2) return "declare";
  }
  return "stay";
}

// ---- play ----

function choosePlay(game, seat) {
  const legal = game.legalCards(seat);
  if (!legal.length) return null;
  const strength = (card) => rankIn(game, card);
  const highest = () => legal.reduce((best, card) => (strength(card) > strength(best) ? card : best));
  const lowest = () => legal.reduce((best, card) => (strength(card) < strength(best) ? card : best));

  const trick = game.currentTrick;
  const maker = game.makerSeats().includes(seat);

  if (!trick.length) {
    // Leading: the maker draws trumps, everyone else cashes a side-suit ace.
    if (maker) {
      const trumps = legal.filter((card) => effectiveSuit(card, game.trumpSuit) === game.trumpSuit);
      if (trumps.length) return trumps.reduce((best, card) => (strength(card) > strength(best) ? card : best));
    }
    const ace = legal.find(
      (card) => card.value === "A" && effectiveSuit(card, game.trumpSuit) !== game.trumpSuit
    );
    return ace || lowest();
  }

  const leadSuit = effectiveSuit(trick[0].card, game.trumpSuit);
  const rankOf = (card) => cardRank(card, game.trumpSuit, leadSuit, game.lowNoTrump);
  const bestSoFar = Math.max(...trick.map((play) => rankOf(play.card)));
  const partnerWinning =
    game.partnerships() &&
    trick.some(
      (play) =>
        rankOf(play.card) === bestSoFar && game.players[play.seat].team === game.players[seat].team
    );
  // Every card that can't win the trick ranks the same, so break that tie on
  // the card's own strength rather than shedding whatever the hand holds first.
  const cheaper = (a, b) =>
    rankOf(a) !== rankOf(b) ? rankOf(a) < rankOf(b) : strength(a) < strength(b);
  const cheapest = (cards) => cards.reduce((best, card) => (cheaper(card, best) ? card : best));
  const winners = legal.filter((card) => rankOf(card) > bestSoFar);

  // Nothing to gain by overtaking your own partner, and nothing to gain by
  // throwing a winner at a trick you can't take.
  if (partnerWinning || !winners.length) return cheapest(legal);
  const last = trick.length === game.activeSeats().length - 1;
  return last ? cheapest(winners) : highest();
}

module.exports = {
  chooseCall,
  chooseDiscard,
  chooseBid,
  chooseBidTrump,
  chooseDeclaration,
  choosePlay,
  expectedTricks,
  expectedTricksNoTrump,
};
