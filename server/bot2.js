// A robot for the *two-player* game (gameLogic.js). server/bot.js is the
// four-player one; the two games are separate engines with separate decks, so
// they get separate robots.
//
// Three things make this a different problem from the four-player robot:
//
//   * You play two seats. Your own hand and your dummy both belong to you, and
//     the rotation alternates between the sides — so "cover your partner" turns
//     into "don't spend a card beating your own other hand", and the robot has
//     to know which of its two hands it is currently playing from.
//   * There is far more hidden here than in the four-player game, not less. You
//     never see the opponent's dummy — only how many cards are left in it — and
//     you don't even see your *own* until you've played your first card
//     (src/components/GameTable.js gates it on that). At the auction you have
//     nothing but your ten cards; at the first lead, forty of the fifty-three
//     are still unknown to you.
//   * Ten cards are never dealt. Deck 53, less two hands of ten, two dummies of
//     ten and a three-card kitty, leaves ten cards that sit in the deck all hand.
//     So a card the robot can't place is only about even money to be in a hand
//     that will ever play it — this treats every unseen card as live, which errs
//     towards caution, the same trade bot.js makes with the buried kitty.
//
// The robot is held to exactly the human's information. It would be very easy to
// let it read game.players[other].dummyHand, which is sitting right there in the
// engine, and it would play visibly better for it — and be cheating.
const {
  VALUES,
  REAL_SUITS,
  getEffectiveSuit,
  getCardRank,
  availableBids,
  bidLegality,
  bidInfo,
} = require("./gameLogic");

const rankOf = (card) => VALUES.indexOf(card.value);
const isJoker = (card) => card.suit === "Joker";
const key = (card) => `${card.value}${card.suit}`;
const sameCard = (a, b) => a.suit === b.suit && a.value === b.value;

const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

const countsAsTrump = (card, trump) =>
  isJoker(card) || card.suit === trump || (card.value === "J" && card.suit === LEFT_BOWER_SUIT[trump]);

// ---- bidding ----

// Roughly how many of the ten tricks this holding takes with a given suit as
// trumps. Whole tricks for the certainties, fractions for the cards that usually
// come home.
function expectedTricks(hand, trump) {
  const trumps = hand.filter((card) => countsAsTrump(card, trump));
  let tricks = 0;

  if (trumps.some(isJoker)) tricks += 1;
  if (trumps.some((card) => card.value === "J" && card.suit === trump)) tricks += 1;
  if (trumps.some((card) => card.value === "J" && card.suit === LEFT_BOWER_SUIT[trump])) tricks += 0.9;
  if (trumps.some((card) => card.value === "A" && card.suit === trump)) tricks += 0.9;
  if (trumps.some((card) => card.value === "K" && card.suit === trump)) tricks += 0.6;
  if (trumps.some((card) => card.value === "Q" && card.suit === trump)) tricks += 0.35;
  tricks += Math.max(0, trumps.length - 4) * 0.6;

  for (const suit of REAL_SUITS) {
    if (suit === trump) continue;
    const cards = hand.filter((card) => card.suit === suit && !countsAsTrump(card, trump));
    if (cards.some((card) => card.value === "A")) tricks += 0.8;
    if (cards.some((card) => card.value === "K") && cards.length >= 2) tricks += 0.35;
    if (cards.length <= 1 && trumps.length >= 5) tricks += 0.3;
  }

  return tricks;
}

// No trumps has no bowers and no ruffs — it lives on aces and long guarded suits.
function expectedTricksNoTrumps(hand) {
  let tricks = hand.some(isJoker) ? 1 : 0;
  for (const suit of REAL_SUITS) {
    const cards = hand.filter((card) => card.suit === suit);
    if (cards.some((card) => card.value === "A")) tricks += 0.85;
    if (cards.some((card) => card.value === "K") && cards.length >= 2) tricks += 0.4;
    if (cards.some((card) => card.value === "Q") && cards.length >= 3) tricks += 0.2;
    tricks += Math.max(0, cards.length - 4) * 0.4;
  }
  return tricks;
}

// How likely this hand is to be forced to take a trick. Low is good.
function misereRisk(hand) {
  let risk = hand.some(isJoker) ? 6 : 0;
  for (const suit of REAL_SUITS) {
    const cards = hand.filter((card) => card.suit === suit).sort((a, b) => rankOf(a) - rankOf(b));
    if (cards.length === 0) continue;
    risk += cards.filter((card) => ["J", "Q", "K", "A"].includes(card.value)).length * 2;
    risk += cards.filter((card) => card.value === "10").length;
    risk += cards.filter((card) => card.value === "9").length * 0.5;
    if (rankOf(cards[0]) >= VALUES.indexOf("8")) risk += 1;
    if (cards.length >= 4 && rankOf(cards[0]) >= VALUES.indexOf("7")) risk += 1;
  }
  return risk;
}

// What the cards you haven't seen yet are worth.
//
// At the auction you hold ten cards and know nothing else: the kitty goes to the
// winner and the dummies aren't dealt until after it. But you will be playing
// two of the four seats, so the contract is carried by your hand *and* a dummy
// you haven't seen, plus three kitty cards improving the hand you have.
//
// Measured over 600 self-played hands rather than guessed at, because the whole
// difference between a robot that bids and one that redeals all night is in this
// one number:
//
//     help   passed out   contract made
//     3.5          48%             76%   under-bids, sits on level six
//     4.5          15%             58%   ← here
//     5.0           3%             51%
//     5.5           1%             40%   bids everything and goes off
//
// Around 60% made is what competitive bidding looks like: high enough that the
// contracts are real, low enough that it isn't leaving points on the table.
const DUMMY_HELP = 4.0;
const KITTY_HELP = 0.5;

// The robot's call. `floorPoints` is the standing bid's value — this game's
// auction lives in room.js, so it has to be passed in.
function chooseBid(game, playerId, floorPoints = 0) {
  const player = game.players.find((p) => p.id === playerId);
  const hand = player.hand;
  const legal = availableBids().filter((bid) => bidLegality(bid.bid, floorPoints).ok);
  if (legal.length === 0) return "Pass";

  const help = DUMMY_HELP + KITTY_HELP;
  const estimates = {};
  for (const suit of ["♠", "♣", "♦", "♥", "NT"]) {
    estimates[suit] =
      (suit === "NT" ? expectedTricksNoTrumps(hand) : expectedTricks(hand, suit)) + help;
  }

  const risk = misereRisk(hand);
  const suitBids = [];
  const specialBids = [];

  for (const bid of legal) {
    if (bid.special) {
      // A Misère is played from your own hand alone — no dummy to be thrown the
      // lead in, which is why a rubbish hand is worth more here than it looks.
      if (bid.bid === "Misere" && risk <= 3) specialBids.push(bid);
      if (bid.bid === "Open Misere" && risk === 0) specialBids.push(bid);
      continue;
    }
    if (bid.level + 0.5 <= estimates[bid.suit]) suitBids.push(bid);
  }

  const bestSuit = suitBids.sort((a, b) => b.points - a.points)[0];
  const bestSpecial = specialBids.sort((a, b) => a.points - b.points)[0];

  if (!bestSuit && !bestSpecial) return "Pass";
  if (!bestSuit) return bestSpecial.bid;
  if (!bestSpecial) return bestSuit.bid;
  return bestSpecial.points > bestSuit.points ? bestSpecial.bid : bestSuit.bid;
}

// ---- the kitty ----

// The ten to keep out of hand-plus-kitty. Same shape as the four-player robot's:
// keep every trump and every ace and shed the shortest side suits, or on a
// Misère throw the top cards. The dummy hasn't been dealt yet, so there's
// nothing to co-ordinate with.
function chooseDiscard(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  const combined = [...player.hand, ...(game.kitty || [])];
  const trump = game.trumpSuit;
  const avoiding = Boolean(game.currentBid && game.currentBid.bid.includes("Misere"));

  const lengths = Object.fromEntries(
    REAL_SUITS.map((suit) => [suit, combined.filter((card) => card.suit === suit).length])
  );

  const sorted = [...combined].sort((a, b) => {
    if (avoiding) {
      if (isJoker(a) !== isJoker(b)) return isJoker(a) ? -1 : 1;
      return rankOf(b) - rankOf(a);
    }
    const aKeep = countsAsTrump(a, trump) || a.value === "A";
    const bKeep = countsAsTrump(b, trump) || b.value === "A";
    if (aKeep !== bKeep) return aKeep ? 1 : -1;
    if (lengths[a.suit] !== lengths[b.suit]) return lengths[a.suit] - lengths[b.suit];
    return rankOf(a) - rankOf(b);
  });

  const thrown = sorted.slice(0, 3);
  return combined.filter((card) => !thrown.some((t) => sameCard(t, card)));
}

// ---- play ----

// Whether this player has been let in on their own dummy yet. You don't see it
// until you've played your first card from your own hand, which the interface
// works out the same way — the hand is still ten, so nothing has gone yet.
const seesOwnDummy = (player) => player.hand.length < 10;

// Cards that could still be played against this player: everything this player
// can't account for. That is the opponent's hand, the opponent's dummy — whose
// cards are never shown, only counted — the ten that were never dealt, and, until
// the first card goes, this player's own dummy as well.
//
// Only what the player can actually see is subtracted, which is the whole point:
// the opponent's dummy is deliberately *not* read out of the engine here.
function liveAgainstMe(game, playerId) {
  const me = game.players.find((p) => p.id === playerId);

  const accounted = new Set([
    ...me.hand.map(key),
    ...(seesOwnDummy(me) ? me.dummyHand.map(key) : []),
    ...game.playedCards.map((play) => key(play.card)),
    // game.kitty holds the three cards that were dealt to the kitty, which the
    // bidder saw. Wherever they ended up — kept or thrown — the bidder knows
    // they aren't in the opponent's hand. The three it buried from its *own*
    // hand aren't recorded anywhere, so those stay counted as still out.
    ...(game.currentBid && game.currentBid.player === playerId ? (game.kitty || []).map(key) : []),
  ]);

  const live = [];
  for (const suit of REAL_SUITS) {
    for (const value of VALUES) {
      if (!accounted.has(`${value}${suit}`)) live.push({ suit, value });
    }
  }
  if (!accounted.has("JokerJoker")) live.push({ suit: "Joker", value: "Joker" });
  return live;
}

// Would anything still out there beat this card, on a trick led in its own suit?
function isTopRemaining(game, playerId, card) {
  const leadSuit = getEffectiveSuit(card, game.trumpSuit) || card.suit;
  const mine = getCardRank(card, game.trumpSuit, leadSuit);
  return !liveAgainstMe(game, playerId).some(
    (other) => getCardRank(other, game.trumpSuit, leadSuit) > mine
  );
}

function trickLeader(game) {
  if (game.currentTrick.length === 0) return null;
  const leadSuit = game.getLeadSuit(game.currentTrick[0]);
  let best = game.currentTrick[0];
  let bestRank = getCardRank(best.card, game.trumpSuit, leadSuit);
  for (const play of game.currentTrick.slice(1)) {
    const rank = getCardRank(play.card, game.trumpSuit, leadSuit);
    if (rank > bestRank) {
      bestRank = rank;
      best = play;
    }
  }
  return { play: best, rank: bestRank, leadSuit };
}

// A Misère bidder wants no tricks at all — and plays only their own hand, so
// there's no dummy of theirs to worry about either.
const isAvoidingTricks = (game, playerId) =>
  Boolean(game.currentBid && game.currentBid.bid.includes("Misere") && game.currentBid.player === playerId);

const lowest = (cards, game) =>
  [...cards].sort((a, b) => getCardRank(a, game.trumpSuit, a.suit) - getCardRank(b, game.trumpSuit, b.suit))[0];

const highest = (cards, game) =>
  [...cards].sort((a, b) => getCardRank(b, game.trumpSuit, b.suit) - getCardRank(a, game.trumpSuit, a.suit))[0];

function nominateSuit(hand) {
  const counts = REAL_SUITS.map((suit) => ({
    suit,
    count: hand.filter((card) => card.suit === suit).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].suit;
}

function chooseLead(game, playerId, hand, legal) {
  if (isAvoidingTricks(game, playerId)) return { card: lowest(legal, game) };

  const trump = game.trumpSuit;
  const onContract = game.currentBid && game.currentBid.player === playerId;

  // Declaring with trumps: pull the opponent's trumps while you still hold the
  // top of the suit. Both of your hands can draw, so this applies from either.
  if (onContract && trump) {
    const trumps = legal.filter((card) => countsAsTrump(card, trump));
    const theyHoldTrumps = liveAgainstMe(game, playerId).some((card) => countsAsTrump(card, trump));
    if (theyHoldTrumps && trumps.length > 0) {
      const top = highest(trumps, game);
      if (trumps.length >= 4 || isTopRemaining(game, playerId, top)) return { card: top };
    }
  }

  const winners = legal.filter((card) => !isJoker(card) && isTopRemaining(game, playerId, card));
  if (winners.length > 0) return { card: highest(winners, game) };

  const sideSuits = legal.filter((card) => !isJoker(card) && !countsAsTrump(card, trump));
  const pool = sideSuits.length > 0 ? sideSuits : legal;
  const byLength = {};
  for (const card of pool) byLength[card.suit] = (byLength[card.suit] || 0) + 1;
  const longest = Object.keys(byLength).sort((a, b) => byLength[b] - byLength[a])[0];
  const fromLongest = pool.filter((card) => card.suit === longest);
  return { card: lowest(fromLongest.length > 0 ? fromLongest : pool, game) };
}

function chooseFollow(game, playerId, hand, legal) {
  const leader = trickLeader(game);
  const beats = legal.filter(
    (card) => getCardRank(card, game.trumpSuit, leader.leadSuit) > leader.rank
  );

  if (isAvoidingTricks(game, playerId)) {
    // Get as high as possible without taking it; if everything wins, lose as
    // little as possible.
    const losers = legal.filter((card) => !beats.includes(card));
    return { card: losers.length > 0 ? highest(losers, game) : lowest(legal, game) };
  }

  // The trick is already yours — on your other hand. Don't beat yourself.
  if (leader.play.playerId === playerId) return { card: lowest(legal, game) };

  const isLast = game.currentTrick.length === (game.seats ? game.seats.length - 1 : 3);
  if (beats.length > 0) {
    const cheapest = lowest(beats, game);
    if (isLast || beats.length === legal.length || !isJoker(cheapest)) return { card: cheapest };
  }
  return { card: lowest(legal, game) };
}

// The robot's card, as { card, nominatedSuit? }. `isDummy` says which of this
// player's two hands is on turn. Always one of legalPlays, so playCard has no
// cause to reject it.
function choosePlay(game, playerId, isDummy) {
  const legal = game.legalPlays(playerId, isDummy);
  if (legal.length === 0) return null;

  const player = game.players.find((p) => p.id === playerId);
  const hand = isDummy ? player.dummyHand : player.hand;

  const choice =
    legal.length === 1
      ? { card: legal[0] }
      : game.currentTrick.length === 0
        ? chooseLead(game, playerId, hand, legal)
        : chooseFollow(game, playerId, hand, legal);

  // A Joker led with no trump suit is rejected outright without a nomination.
  if (isJoker(choice.card) && !game.trumpSuit && game.currentTrick.length === 0) {
    choice.nominatedSuit = nominateSuit(hand);
  }
  return choice;
}

// Does the robot believe an opponent who says they've got the rest? It asks the
// only question that matters: across either of its two hands, does it hold a card
// that nothing still out there can beat? The claimer's own cards are among what's
// still out there, so a card that survives this really is a trick — and if there
// isn't one, there's nothing to be gained by making them play it out.
function acceptsClaim(game, playerId) {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) return true;
  const mine = [...me.hand, ...(seesOwnDummy(me) ? me.dummyHand : [])];
  return !mine.some((card) => isTopRemaining(game, playerId, card));
}

module.exports = {
  chooseBid,
  chooseDiscard,
  choosePlay,
  acceptsClaim,
  expectedTricks,
  expectedTricksNoTrumps,
  misereRisk,
  isTopRemaining,
  liveAgainstMe,
  DUMMY_HELP,
};
