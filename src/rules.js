// What the help panel needs to know about the game being played. The two sizes
// of game are genuinely different — different pack, different way of reaching a
// Misère, and only the four-player table has house rules — so everything here
// takes a variant of "two" or "four" rather than assuming one.

const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

// The plain trumps, highest first, with the jack left out: it isn't a plain
// trump in its own suit, it's the right bower, and it comes in above the ace.
//
// The four-player game deals the 43-card 500 pack — no twos or threes, and no
// black four. The two-player game deals from a full pack plus the Joker, so its
// suits run all the way down to the two.
const PLAIN_TRUMPS = {
  four: ["A", "K", "Q", "10", "9", "8", "7", "6", "5", "4"],
  two: ["A", "K", "Q", "10", "9", "8", "7", "6", "5", "4", "3", "2"],
};

export const isBlackSuit = (suit) => suit === "♠" || suit === "♣";

// Every trump in order, highest first: the Joker, the two bowers, then the suit
// itself from the ace down. `note` is set on the three cards whose position
// isn't self-evident from the face.
export function trumpOrder(trumpSuit, variant = "four") {
  if (!trumpSuit || !LEFT_BOWER_SUIT[trumpSuit]) return [];
  const leftSuit = LEFT_BOWER_SUIT[trumpSuit];
  const plains = (PLAIN_TRUMPS[variant] || PLAIN_TRUMPS.four).filter(
    // The 43-card pack has no black four, so a spade or club contract stops at
    // the five.
    (value) => !(value === "4" && variant === "four" && isBlackSuit(trumpSuit))
  );

  return [
    {
      card: { suit: "Joker", value: "Joker" },
      label: "Joker",
      note: "highest",
    },
    {
      card: { suit: trumpSuit, value: "J" },
      label: `J${trumpSuit}`,
      note: "right bower",
    },
    {
      card: { suit: leftSuit, value: "J" },
      label: `J${leftSuit}`,
      note: "left bower",
    },
    ...plains.map((value) => ({
      card: { suit: trumpSuit, value },
      label: `${value}${trumpSuit}`,
    })),
  ];
}

// Why the trump order can't be shown, or null when it can. The auction, a
// no-trump contract and a Misère all end up with no trump suit, and saying
// which one it is beats greying out a button for no stated reason.
export function noTrumpReason(trumpSuit, bid) {
  if (trumpSuit) return null;
  if (!bid) return "No contract yet — nothing is trumps until the auction ends.";
  if (bid.includes("Misere") || bid.includes("Nullo")) {
    return "A no-tricks contract is played without trumps.";
  }
  if (bid.includes("NT")) return "No-trumps: the Joker is the only card above an ace.";
  return "This contract has no trump suit.";
}

// The Avondale schedule, which both sizes of game use.
export const BID_TABLE = {
  suits: ["♠", "♣", "♦", "♥", "NT"],
  base: { "♠": 40, "♣": 60, "♦": 80, "♥": 100, NT: 120 },
  levels: [6, 7, 8, 9, 10],
};

export const bidValue = (level, suit) => BID_TABLE.base[suit] + (level - 6) * 100;

// The facts that differ between the two games, so the help text can state them
// rather than hedge.
export const VARIANTS = {
  two: {
    name: "Two-handed 500, with dummies",
    seats:
      "Two players, each with a dummy hand that plays as a second seat. A trick is four cards: your hand, your opponent's hand, then each dummy.",
    pack:
      "A full pack plus the Joker. Forty-three cards are dealt — two hands of ten, two dummies of ten and a kitty of three — so ten cards sit out every hand.",
    misere:
      "Misère is worth 250 and Open Misère 500, and bids are ranked purely on points: 250 outbids 8♠ but not 8♣. A Misère bidder plays no dummy.",
    specials: ["Misère — 250", "Open Misère — 500"],
  },
  four: {
    name: "Four-player 500",
    seats:
      "Four players in two partnerships, sitting opposite their partner. A trick is one card from each of the four seats.",
    pack:
      "The 43-card 500 pack: ace down to five in the black suits, down to four in the red ones, plus the Joker. Ten cards each and a kitty of three.",
    misere:
      "Misère can only be called once the auction has reached the seven level. The bidder plays alone — their partner sits the hand out.",
    specials: null, // taken from the table's own house rules
  },
};
