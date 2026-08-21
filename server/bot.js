// A robot to fill an empty seat. It plays by rules of thumb rather than search:
// count your winners before bidding, draw trumps when you're declarer, lead
// aces and cover your partner when you're defending, duck everything when
// you're on a Misère — and when you're defending one, do the opposite of all
// of it. Nothing here learns anything — it just shouldn't embarrass itself, and
// it must never try an illegal call or play.
const {
  RANKS,
  REAL_SUITS,
  BID_SUITS,
  LEFT_BOWER_SUIT,
  availableBids,
  bidInfo,
  getCardRank,
  getEffectiveSuit,
  isNoTricksBid,
} = require("./game4");

const rankOf = (card) => RANKS.indexOf(card.value);
const isJoker = (card) => card.suit === "Joker";
const key = (card) => `${card.value}${card.suit}`;

const countsAsTrump = (card, trump) =>
  isJoker(card) || card.suit === trump || (card.value === "J" && card.suit === LEFT_BOWER_SUIT[trump]);

// ---- bidding ----

// Roughly how many tricks this hand takes with a given suit as trumps. Whole
// tricks for the certainties, fractions for the cards that usually come home —
// it only has to be good enough to pick a level and a suit.
function expectedTricks(hand, trump) {
  const trumps = hand.filter((card) => countsAsTrump(card, trump));
  let tricks = 0;

  if (trumps.some(isJoker)) tricks += 1;
  if (trumps.some((card) => card.value === "J" && card.suit === trump)) tricks += 1;
  if (trumps.some((card) => card.value === "J" && card.suit === LEFT_BOWER_SUIT[trump])) tricks += 0.9;
  if (trumps.some((card) => card.value === "A" && card.suit === trump)) tricks += 0.9;
  if (trumps.some((card) => card.value === "K" && card.suit === trump)) tricks += 0.6;
  if (trumps.some((card) => card.value === "Q" && card.suit === trump)) tricks += 0.35;
  // Length itself wins tricks once the other hands are out of trumps.
  tricks += Math.max(0, trumps.length - 4) * 0.6;

  for (const suit of REAL_SUITS) {
    if (suit === trump) continue;
    const cards = hand.filter((card) => card.suit === suit && !countsAsTrump(card, trump));
    if (cards.some((card) => card.value === "A")) tricks += 0.8;
    if (cards.some((card) => card.value === "K") && cards.length >= 2) tricks += 0.35;
    // Short side suits are ruffing chances, but only with trumps to ruff with.
    if (cards.length <= 1 && trumps.length >= 5) tricks += 0.3;
  }

  return tricks;
}

// No trumps has no bowers and no ruffs — it lives on aces and long guarded
// suits, so it's counted separately rather than squeezed into the above.
function expectedTricksNoTrumps(hand, options) {
  let tricks = hand.some(isJoker) ? 1 : 0;
  for (const suit of REAL_SUITS) {
    const cards = hand.filter((card) => card.suit === suit).sort((a, b) => rankOf(b) - rankOf(a));
    // Under J5 the jack is the suit's top card, so it's the one that counts.
    const top = options.j5 ? "J" : "A";
    if (cards.some((card) => card.value === top)) tricks += 0.85;
    if (cards.some((card) => card.value === "K") && cards.length >= 2) tricks += 0.4;
    if (cards.some((card) => card.value === "Q") && cards.length >= 3) tricks += 0.2;
    tricks += Math.max(0, cards.length - 4) * 0.4;
  }
  return tricks;
}

// How likely this hand is to be forced to take a trick. Low is good: a Misère
// hand wants no Joker, no high cards, and a low card in every suit it holds.
function misereRisk(hand) {
  let risk = hand.some(isJoker) ? 6 : 0;
  for (const suit of REAL_SUITS) {
    const cards = hand.filter((card) => card.suit === suit).sort((a, b) => rankOf(a) - rankOf(b));
    if (cards.length === 0) continue;
    risk += cards.filter((card) => ["J", "Q", "K", "A"].includes(card.value)).length * 2;
    risk += cards.filter((card) => card.value === "10").length;
    risk += cards.filter((card) => card.value === "9").length * 0.5;
    // A suit whose lowest card is high is the one you get thrown in on.
    if (rankOf(cards[0]) >= RANKS.indexOf("8")) risk += 1;
    // Length without low cards is dangerous; length with them is a hiding place.
    if (cards.length >= 4 && rankOf(cards[0]) >= RANKS.indexOf("7")) risk += 1;
  }
  return risk;
}

// The robot's call. Returns a bid string, or "Pass".
function chooseBid(game, seat) {
  const hand = game.players[seat].hand;
  const options = game.options;
  const auction = game.auction;
  const floor = auction.highBid ? auction.highBid.rank : 0;
  const legal = availableBids(options).filter(
    (bid) => game.bidLegality(seat, bid.bid).ok && bid.rank > floor
  );
  if (legal.length === 0) return "Pass";

  // A bid is for the partnership's tricks, so the count has to allow for the
  // hand across the table. An unseen hand is worth about two and a half tricks
  // on average — pitch this much lower and the robot passes on almost
  // everything, which leaves a table of them redealing all night.
  const PARTNER_HELP = 3.2;
  const estimates = {};
  for (const suit of BID_SUITS) {
    estimates[suit] =
      (suit === "NT" ? expectedTricksNoTrumps(hand, options) : expectedTricks(hand, suit)) +
      PARTNER_HELP;
  }

  const risk = misereRisk(hand);
  const suitBids = [];
  const specialBids = [];

  for (const bid of legal) {
    if (bid.special) {
      // Only the plain no-tricks contracts are worth attempting on a rule of
      // thumb; the exotic ones need judgement the robot hasn't got.
      if (bid.bid === "Misere" && risk <= 3) specialBids.push(bid);
      if (bid.bid === "Open Misere" && risk === 0) specialBids.push(bid);
      continue;
    }
    // Half a trick of margin, because the count above is optimistic about
    // kings and length and this is the difference between 400 and −400.
    if (bid.level + 0.5 <= estimates[bid.suit]) suitBids.push(bid);
  }

  // The best trick contract is the most valuable one the hand supports; the
  // best no-tricks contract is the cheapest, since going higher there buys no
  // extra safety. Between the two, take the points.
  const bestSuit = suitBids.sort((a, b) => b.points - a.points || a.rank - b.rank)[0];
  const bestSpecial = specialBids.sort((a, b) => a.rank - b.rank)[0];

  if (!bestSuit && !bestSpecial) return "Pass";
  if (!bestSuit) return bestSpecial.bid;
  if (!bestSpecial) return bestSuit.bid;
  return bestSpecial.points > bestSuit.points ? bestSpecial.bid : bestSuit.bid;
}

// ---- the kitty ----

// The three to throw back. With a trump contract that means keeping every
// trump and every ace and shedding the shortest side suits, so a void is left
// behind to ruff into; on a no-tricks contract it means throwing the top cards.
function chooseDiscard(game, seat) {
  const hand = [...game.players[seat].hand];
  const trump = game.trumpSuit;
  const avoiding = isNoTricksBid(game.currentBid?.bid);

  const lengths = Object.fromEntries(
    REAL_SUITS.map((suit) => [suit, hand.filter((card) => card.suit === suit).length])
  );

  const sorted = [...hand].sort((a, b) => {
    if (avoiding) {
      // Highest first: the Joker, then aces down.
      if (isJoker(a) !== isJoker(b)) return isJoker(a) ? -1 : 1;
      return rankOf(b) - rankOf(a);
    }
    const aKeep = countsAsTrump(a, trump) || a.value === "A";
    const bKeep = countsAsTrump(b, trump) || b.value === "A";
    if (aKeep !== bKeep) return aKeep ? 1 : -1;
    // Then out of the shortest suit, lowest card first.
    if (lengths[a.suit] !== lengths[b.suit]) return lengths[a.suit] - lengths[b.suit];
    return rankOf(a) - rankOf(b);
  });

  const discarded = sorted.slice(0, 3);
  return hand.filter((card) => !discarded.some((d) => key(d) === key(card)));
}

// Double Nullo's five cards to send across the table. Both partners have to
// take no tricks, so shifting a high card to your partner doesn't make it safe —
// what helps is voiding a suit, since a suit you can't follow is a suit you
// can't be thrown the lead in. Shortest suits go first, highest card first
// within them.
function choosePass(game, seat) {
  const hand = [...game.players[seat].hand];
  const lengths = Object.fromEntries(
    REAL_SUITS.map((suit) => [suit, hand.filter((card) => card.suit === suit).length])
  );
  return [...hand]
    .sort((a, b) => {
      if (isJoker(a) !== isJoker(b)) return isJoker(a) ? -1 : 1;
      if (lengths[a.suit] !== lengths[b.suit]) return lengths[a.suit] - lengths[b.suit];
      return rankOf(b) - rankOf(a);
    })
    .slice(0, 5);
}

// ---- play ----

// Cards that are still unaccounted for from this seat's point of view: the
// whole pack, less what it holds and what has hit the table. The three cards
// the bidder buried are counted as still out, which only ever makes the robot
// a shade more cautious than it needs to be.
function unseenCards(game, seat) {
  const seen = new Set([
    ...game.players[seat].hand.map(key),
    ...game.playedCards.map((play) => key(play.card)),
    ...game.currentTrick.map((play) => key(play.card)),
  ]);
  const deck = [];
  for (const suit of REAL_SUITS) {
    for (const value of RANKS) {
      if ((suit === "♠" || suit === "♣") && value === "4") continue;
      if (!seen.has(`${value}${suit}`)) deck.push({ suit, value });
    }
  }
  if (!seen.has("JokerJoker")) deck.push({ suit: "Joker", value: "Joker" });
  return deck;
}

// Would anything still out there beat this card, on a trick led in its own suit?
function isTopRemaining(game, seat, card) {
  const leadSuit = getEffectiveSuit(card, game.trumpSuit) || card.suit;
  const mine = getCardRank(card, game.trumpSuit, leadSuit, game.options);
  return !unseenCards(game, seat).some(
    (other) => getCardRank(other, game.trumpSuit, leadSuit, game.options) > mine
  );
}

// Which suits each seat has shown out of. A seat that couldn't follow a lead
// holds none of that suit, and a hand only ever gets shorter, so that holds for
// the rest of the deal. Every trick is the same length — a solo partner folds
// before a card is played — so the plays chunk straight into tricks.
function shownVoids(game) {
  const size = game.activeSeats().length;
  const voids = new Map();
  for (let i = 0; i < game.playedCards.length; i += size) {
    const trick = game.playedCards.slice(i, i + size);
    const leadSuit = game.getLeadSuit(trick[0]);
    for (const play of trick.slice(1)) {
      if (getEffectiveSuit(play.card, game.trumpSuit) === leadSuit) continue;
      if (!voids.has(play.seat)) voids.set(play.seat, new Set());
      voids.get(play.seat).add(leadSuit);
    }
  }
  return voids;
}

// Is there an opponent trump left to draw? Unseen trumps aren't the question —
// they might all be sitting in your own partner's hand, and once both opponents
// have shown out, a trump lead only makes your partner follow with one of
// theirs: two of your side's trumps spent on a trick the defence couldn't have
// taken either way. Play a side suit instead — losing one to them is how you or
// your partner comes by a void, and a ruff back into control.
function opponentsHoldTrumps(game, seat) {
  const trump = game.trumpSuit;
  if (!unseenCards(game, seat).some((card) => countsAsTrump(card, trump))) return false;
  const voids = shownVoids(game);
  return game
    .activeSeats()
    .filter((other) => game.teamOf(other) !== game.teamOf(seat))
    .some((other) => !voids.get(other)?.has(trump));
}

// Who is winning the trick as it stands, and by how much.
function trickLeader(game) {
  if (game.currentTrick.length === 0) return null;
  const leadSuit = game.getLeadSuit(game.currentTrick[0]);
  let best = game.currentTrick[0];
  let bestRank = getCardRank(best.card, game.trumpSuit, leadSuit, game.options);
  for (const play of game.currentTrick.slice(1)) {
    const rank = getCardRank(play.card, game.trumpSuit, leadSuit, game.options);
    if (rank > bestRank) {
      bestRank = rank;
      best = play;
    }
  }
  return { play: best, rank: bestRank, leadSuit };
}

// Is this seat trying to avoid tricks altogether? True for the Misère bidder
// and for both partners on a Double Nullo, and for a Hi-Lo bidder who has
// already banked their five.
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

// The seats currently trying to avoid tricks — usually just the Misère bidder.
function avoidingSeats(game) {
  if (!game.currentBid) return [];
  const spec = game.contractSpec();
  if (!spec) return [];
  const bidderSeat = game.currentBid.seat;
  const seats = spec.bothPartners
    ? [bidderSeat, game.partnerOf(bidderSeat)]
    : [bidderSeat];
  return seats.filter(
    (seat) => !game.players[seat].folded && isAvoidingTricks(game, seat)
  );
}

// Playing against someone who mustn't take a trick. This inverts every ordinary
// instinct, which is why it needs saying out loud: the only thing that beats the
// contract is making them take a trick, so a trick won by a defender is a trick
// wasted, cashing an ace throws one away, and overtaking the declarer when they
// were about to be caught hands them the contract.
function defendingAvoider(game, seat) {
  const avoiders = avoidingSeats(game);
  return avoiders.length > 0 && !avoiders.includes(seat);
}

// The declarer's hand on an Open Misère — but only once it has genuinely gone
// face up. The test is the server's own (see revealedHands in room4), so the
// robot never sees a card a defender in the same seat couldn't.
function openAvoiderHand(game, seat) {
  const spec = game.contractSpec();
  if (!spec?.open || !game.currentBid) return null;
  if (game.playedCards.length < game.activeSeats().length) return null;
  const bidderSeat = game.currentBid.seat;
  if (bidderSeat === seat) return null;
  return game.players[bidderSeat].hand;
}

const lowest = (cards, game) =>
  [...cards].sort(
    (a, b) =>
      getCardRank(a, game.trumpSuit, a.suit, game.options) -
      getCardRank(b, game.trumpSuit, b.suit, game.options)
  )[0];

const highest = (cards, game) =>
  [...cards].sort(
    (a, b) =>
      getCardRank(b, game.trumpSuit, b.suit, game.options) -
      getCardRank(a, game.trumpSuit, a.suit, game.options)
  )[0];

// A lead the avoider can't duck: they hold the suit, and every card they hold
// in it beats ours, so following suit takes the trick. Only knowable when their
// hand is face up. A suit they're void in is no use — they'd discard and escape.
function forcingLead(game, legal, avoiderHand) {
  const forcing = legal.filter((card) => {
    if (isJoker(card)) return false;
    const theirs = avoiderHand.filter((other) => other.suit === card.suit);
    if (theirs.length === 0) return false;
    const mine = getCardRank(card, game.trumpSuit, card.suit, game.options);
    return theirs.every(
      (other) => getCardRank(other, game.trumpSuit, card.suit, game.options) > mine
    );
  });
  return forcing.length > 0 ? lowest(forcing, game) : null;
}

// Lead low out of the longest suit and keep the honours back. Against a
// no-tricks contract this is the forcing lead as well: coming at the same long
// suit over and over burns through whatever low cards the declarer is hiding
// behind, until all they have left in it is the card that takes the trick.
function lowLeadFromLength(game, legal) {
  const trump = game.trumpSuit;
  const sideSuits = legal.filter((card) => !isJoker(card) && !countsAsTrump(card, trump));
  const pool = sideSuits.length > 0 ? sideSuits : legal;
  const byLength = {};
  for (const card of pool) byLength[card.suit] = (byLength[card.suit] || 0) + 1;
  const longest = Object.keys(byLength).sort((a, b) => byLength[b] - byLength[a])[0];
  const fromLongest = pool.filter((card) => card.suit === longest);
  return lowest(fromLongest.length > 0 ? fromLongest : pool, game);
}

// The lead once nothing the opponents hold can ruff. Every trump left in hand is
// a trick whenever you care to take it, so the lead stops being about trumps and
// starts being about the rest of the hand.
function leadNothingToRuffWith(game, seat, legal) {
  const trump = game.trumpSuit;
  const trumps = legal.filter((card) => countsAsTrump(card, trump));
  const side = legal.filter((card) => !countsAsTrump(card, trump));

  // Cash a side winner ahead of a trump. It takes the trick just the same, and
  // it makes the opponents follow suit rather than handing them a free discard
  // to throw a loser on.
  const sideWinners = side.filter((card) => isTopRemaining(game, seat, card));
  if (sideWinners.length > 0) return { card: highest(sideWinners, game) };

  // Trumps and one odd card: run the trumps and keep the odd one for last. They
  // have to find a discard every round, not knowing which suit to keep guarded,
  // and the card they throw is often the one that was holding yours off.
  if (side.length === 1 && trumps.length > 0) return { card: highest(trumps, game) };

  // Nothing to cash: lead low from a side suit and leave the trumps where they
  // are, since no card out there can take one off you later.
  if (side.length > 0) return { card: lowLeadFromLength(game, side) };
  return { card: highest(trumps, game) };
}

function chooseLead(game, seat, legal) {
  const avoiding = isAvoidingTricks(game, seat);
  if (avoiding) return { card: lowest(legal, game) };

  // Defending a no-tricks contract. Cashing a winner here is the standard
  // blunder: you win the trick yourself, which the declarer is delighted by —
  // it costs them nothing and lets them throw a card they were worried about.
  if (defendingAvoider(game, seat)) {
    const open = openAvoiderHand(game, seat);
    const forced = open ? forcingLead(game, legal, open) : null;
    return { card: forced || lowLeadFromLength(game, legal) };
  }

  const trump = game.trumpSuit;
  const onContract =
    game.currentBid && game.teamOf(seat) === game.teamOf(game.currentBid.seat);

  if (trump && !opponentsHoldTrumps(game, seat)) {
    return leadNothingToRuffWith(game, seat, legal);
  }

  // Declaring side with trumps: pull the opponents' trumps out while you still
  // hold the top of the suit, which is the whole of basic 500 declarer play.
  if (onContract && trump) {
    const trumps = legal.filter((card) => countsAsTrump(card, trump));
    // Worth doing off the top of the suit, or off length — a losing trump lead
    // from five still strips the defenders and clears the way for the rest.
    if (trumps.length > 0) {
      const top = highest(trumps, game);
      if (trumps.length >= 4 || isTopRemaining(game, seat, top)) return { card: top };
    }
  }

  // Otherwise cash anything that can't be beaten.
  const winners = legal.filter((card) => !isJoker(card) && isTopRemaining(game, seat, card));
  if (winners.length > 0) return { card: highest(winners, game) };

  // Nothing to cash: lead low out of the longest side suit and keep the honours
  // for later.
  const card = lowLeadFromLength(game, legal);

  // Leading the Joker at no trumps means naming a suit; name the one it's
  // longest in so the lead stays useful.
  if (isJoker(card)) return { card, nominatedSuit: nominateSuit(game, seat) };
  return { card };
}

function nominateSuit(game, seat) {
  const hand = game.players[seat].hand;
  const counts = REAL_SUITS.map((suit) => ({
    suit,
    count: hand.filter((card) => card.suit === suit).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].suit;
}

function chooseFollow(game, seat, legal) {
  const leader = trickLeader(game);
  const avoiding = isAvoidingTricks(game, seat);
  const beats = legal.filter(
    (card) => getCardRank(card, game.trumpSuit, leader.leadSuit, game.options) > leader.rank
  );

  const isLast = game.currentTrick.length === game.activeSeats().length - 1;

  if (avoiding) {
    // Duck as high as you can: the trick is safe and a big card is gone.
    const losers = legal.filter((card) => !beats.includes(card));
    if (losers.length > 0) return { card: highest(losers, game) };
    // Everything wins. Playing last that settles it, so spend the biggest card
    // — the low ones are what duck the tricks still to come. With players yet
    // to act, scrape over as low as possible instead and hope one of them
    // takes it off you.
    return { card: isLast ? highest(legal, game) : lowest(legal, game) };
  }

  if (defendingAvoider(game, seat)) {
    const avoiders = avoidingSeats(game);
    if (avoiders.includes(leader.play.seat)) {
      // They're winning it. That trick is the contract — leave it alone, and
      // use the moment to shed the highest card that doesn't snatch it back.
      const ducks = legal.filter((card) => !beats.includes(card));
      return { card: ducks.length > 0 ? highest(ducks, game) : highest(legal, game) };
    }
    // Either they've yet to play, or a defender already holds the trick. Keep
    // the bar low so they have to climb over it, and keep hold of the low cards
    // that make them.
    return { card: lowest(legal, game) };
  }

  const partnerSeat = game.partnerOf(seat);
  const partnerWinning =
    !game.players[partnerSeat].folded && leader.play.seat === partnerSeat;

  // Partner has it: don't spend a card beating your own side.
  if (partnerWinning) return { card: lowest(legal, game) };

  if (beats.length > 0) {
    // Take it with the cheapest card that does the job. Playing last, that's
    // simply the cheapest winner; earlier, the same card also keeps the
    // honours back for the tricks still to come.
    const cheapest = lowest(beats, game);
    const worthIt = isLast || beats.length === legal.length || !isJoker(cheapest);
    if (worthIt) return { card: cheapest };
  }

  return { card: lowest(legal, game) };
}

// Does the robot believe an opponent who says they've got the rest? It asks the
// only question that matters: do I hold a card that nothing still out there can
// beat? The claimer's own hand is among what's still out there, so a card that
// survives this test really is a trick — and if there isn't one, there's nothing
// to be gained by making them play it out.
function acceptsClaim(game, seat) {
  return !game.players[seat].hand.some((card) => isTopRemaining(game, seat, card));
}

// The robot's card, as { card, nominatedSuit? }. Always one of legalPlays, so
// the server's own validation never has cause to reject it.
function choosePlay(game, seat) {
  const legal = game.legalPlays(seat);
  if (legal.length === 0) return null;
  if (legal.length === 1) {
    const card = legal[0];
    return isJoker(card) && !game.trumpSuit && game.currentTrick.length === 0
      ? { card, nominatedSuit: nominateSuit(game, seat) }
      : { card };
  }

  const choice =
    game.currentTrick.length === 0
      ? chooseLead(game, seat, legal)
      : chooseFollow(game, seat, legal);

  // Belt and braces: a lead of the Joker at no trumps is rejected outright
  // without a nomination, so never hand one back missing it.
  if (
    isJoker(choice.card) &&
    !game.trumpSuit &&
    game.currentTrick.length === 0 &&
    !choice.nominatedSuit
  ) {
    choice.nominatedSuit = nominateSuit(game, seat);
  }
  return choice;
}

// Bot names, so a table of robots doesn't read as four blanks.
const BOT_NAMES = [
  "Ada (robot)",
  "Boole (robot)",
  "Curie (robot)",
  "Dijkstra (robot)",
  "Euler (robot)",
  "Fermat (robot)",
];

function botName(index, taken = []) {
  const free = BOT_NAMES.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : BOT_NAMES;
  return pool[index % pool.length];
}

module.exports = {
  chooseBid,
  chooseDiscard,
  choosePass,
  choosePlay,
  acceptsClaim,
  expectedTricks,
  expectedTricksNoTrumps,
  misereRisk,
  botName,
  BOT_NAMES,
  bidInfo,
};
