// A robot to fill an empty Hearts seat. Rules of thumb, not search: shed the
// cards that cost and the cards that can be forced to take what costs, duck
// every trick you don't want, and throw the worst thing you hold the moment you
// are void. It only has to avoid embarrassing itself, and it must never attempt
// an illegal pass or play.
//
// It never tries to shoot the moon. Doing that well needs to read the other
// hands, and doing it badly hands the table twenty-six points.
const { SUITS, RANKS, isJoker, rankOf } = require("./hearts");

const highCards = (cards) => cards.filter((card) => rankOf(card) >= RANKS.indexOf("Q")).length;

// How much this robot would rather not be holding a card. Its own cost comes
// first, then how exposed it is: a high card in a short suit is the one that
// ends up taking the trick nobody wanted.
function danger(game, seat, card) {
  if (isJoker(card)) return -5;
  const hand = game.players[seat].hand;
  const suit = hand.filter((c) => c.suit === card.suit);
  const cost = game.penaltyOf(card);
  // The cards that cost are worth shedding roughly in proportion to what they
  // cost, but a bonus card is worth keeping hold of.
  let score = cost * 2;
  // A high card is only dangerous if there aren't enough low ones beneath it to
  // get under the lead with.
  const below = suit.filter((c) => rankOf(c) < rankOf(card)).length;
  score += Math.max(0, rankOf(card) - 6) * (below >= 2 ? 0.4 : 1.2);
  // Anything above a penalty card in the same suit will be made to eat it.
  const guarding = suit.filter((c) => game.penaltyOf(c) > 0 && rankOf(c) < rankOf(card)).length;
  score += guarding * 4;
  return score;
}

// ---- passing ----

function choosePass(game, seat) {
  const hand = [...game.players[seat].hand];
  // Emptying a short suit is worth more than shedding one big card, so a suit
  // of one or two gets a bonus spread across its cards.
  const lengths = Object.fromEntries(SUITS.map((suit) => [suit, hand.filter((c) => c.suit === suit).length]));
  const worth = (card) =>
    danger(game, seat, card) + (card.suit !== "♥" && lengths[card.suit] <= 2 ? 3 : 0);
  return hand.sort((a, b) => worth(b) - worth(a)).slice(0, 3);
}

// ---- Auction Hearts ----

// The suit this hand would least mind being the penalty suit: the shortest it
// holds, and the lowest where two are the same length.
function safestSuit(game, seat) {
  const hand = game.players[seat].hand;
  let best = null;
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.suit === suit);
    const exposure = cards.length + highCards(cards) * 1.5;
    if (!best || exposure < best.exposure) best = { suit, exposure, cards };
  }
  return best;
}

function chooseBid(game, seat) {
  const standing = game.bidState.highBid || 0;
  const best = safestSuit(game, seat);
  // Worth paying for only where the suit really is nothing: a void or a couple
  // of small ones. The bid is paid straight onto the score, so it is a real cost.
  const worth = Math.max(0, 6 - Math.round(best.exposure));
  return worth > standing ? worth : 0;
}

const chooseSuit = (game, seat) => safestSuit(game, seat).suit;

// ---- play ----

function choosePlay(game, seat) {
  const legal = game.legalCards(seat);
  if (!legal.length) return null;
  const trick = game.currentTrick;
  const lowest = (cards) => cards.reduce((best, card) => (rankOf(card) < rankOf(best) ? card : best));

  if (!trick.length) return chooseLead(game, seat, legal);

  const suit = game.leadSuit();
  const following = legal.filter((card) => card.suit === suit && !isJoker(card));
  if (!following.length) return chooseDiscard(game, seat, legal);

  const beating = Math.max(...trick.filter((p) => p.card.suit === suit).map((p) => rankOf(p.card)));
  const under = following.filter((card) => rankOf(card) < beating);
  const last = trick.length === game.mode - 1;
  const cost = trick.reduce((sum, p) => sum + game.penaltyOf(p.card), 0);
  // Last to play at a trick that costs nothing, and taking it is free — worth
  // having, because the lead is how you get off a suit you don't want.
  if (last && cost <= 0 && !under.length) return lowest(following);
  if (under.length) return under.reduce((best, card) => (rankOf(card) > rankOf(best) ? card : best));
  // Nothing low enough to duck with. A joker is playable whether or not you can
  // follow and never wins, which is exactly what a trick full of points wants.
  const joker = legal.find(isJoker);
  if (joker && cost > 0) return joker;
  return lowest(following);
}

// Leading: the lowest card of the suit this hand is safest in, never opening a
// suit whose penalty card is still out there above what it holds.
function chooseLead(game, seat, legal) {
  const hand = game.players[seat].hand;
  const score = (card) => {
    const suit = hand.filter((c) => c.suit === card.suit);
    const penaltyAbove = suit.some((c) => game.penaltyOf(c) > 0 && rankOf(c) > rankOf(card));
    return (
      rankOf(card) +
      game.penaltyOf(card) * 3 +
      (penaltyAbove ? 6 : 0) +
      (card.suit === "♥" ? 2 : 0) +
      (isJoker(card) ? 20 : 0)
    );
  };
  return legal.reduce((best, card) => (score(card) < score(best) ? card : best));
}

// Void in the led suit, so this is the free throw the whole hand has been
// waiting for: the most dangerous thing still held.
function chooseDiscard(game, seat, legal) {
  const joker = legal.find(isJoker);
  const real = legal.filter((card) => !isJoker(card));
  if (!real.length) return joker;
  return real.reduce((worst, card) =>
    danger(game, seat, card) > danger(game, seat, worst) ? card : worst
  );
}

module.exports = { choosePass, chooseBid, chooseSuit, choosePlay, danger, safestSuit };
