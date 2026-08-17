// Card ordering shared by every hand view. PlayerHand, DummyHand and the
// kitty-discard hand each used to carry their own byte-identical copy of this;
// they all call in here now so a change to sort order lands everywhere at once.

export const SUIT_ORDER = ["♠", "♣", "♥", "♦"];
export const VALUE_ORDER = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

export const isRed = (suit) => suit === "♥" || suit === "♦";
export const cardColor = (suit) => (isRed(suit) ? "red" : "black");

export const leftBowerSuitOf = (trumpSuit) => LEFT_BOWER_SUIT[trumpSuit];

export function isLeftBower(card, trumpSuit) {
  return card.suit === LEFT_BOWER_SUIT[trumpSuit] && card.value === "J";
}

// Whether a card counts as trump for sorting: the trump suit itself, the left
// bower (which changes suit when trump is set), and the Joker.
export function isTrumpCard(card, trumpSuit) {
  return (
    card.suit === trumpSuit ||
    isLeftBower(card, trumpSuit) ||
    card.suit === "Joker"
  );
}

// Rank within the trump group. Plain trumps top out at A (index 12), leaving
// room above for the two bowers and the Joker.
function trumpRank(card, trumpSuit) {
  if (card.suit === "Joker") return 22;
  if (card.suit === trumpSuit && card.value === "J") return 21;
  if (isLeftBower(card, trumpSuit)) return 20;
  return VALUE_ORDER.indexOf(card.value);
}

export function sortHand(hand, trumpSuit) {
  return [...hand].sort((a, b) => {
    const aTrump = isTrumpCard(a, trumpSuit);
    const bTrump = isTrumpCard(b, trumpSuit);
    if (aTrump && bTrump) return trumpRank(a, trumpSuit) - trumpRank(b, trumpSuit);
    if (aTrump) return -1;
    if (bTrump) return 1;
    if (a.suit === b.suit) {
      return VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value);
    }
    return SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
  });
}

// Hand split into suit runs for display, trump first. Before trump is set no
// group matches the trump branch, so the Joker would fall through both and
// vanish from the hand — it gets its own leading group in that case.
export function groupHand(hand, trumpSuit) {
  const sorted = sortHand(hand, trumpSuit);
  const groups = SUIT_ORDER.map((suit) =>
    suit === trumpSuit
      ? sorted.filter((card) => isTrumpCard(card, trumpSuit))
      : sorted.filter(
          (card) => card.suit === suit && !isLeftBower(card, trumpSuit)
        )
  ).filter((group) => group.length > 0);

  if (!trumpSuit) {
    const jokers = sorted.filter((card) => card.suit === "Joker");
    if (jokers.length > 0) groups.unshift(jokers);
  }
  return groups;
}

// Plain suit order with no trump — used for the Open Misère reveal and the
// declined-claim reveal, where there is no trump suit to rank against.
export function groupHandBySuit(hand) {
  return SUIT_ORDER.map((suit) =>
    hand
      .filter((c) => c.suit === suit)
      .sort((a, b) => VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value))
  )
    .concat([hand.filter((c) => c.suit === "Joker")])
    .filter((row) => row.length > 0);
}

// Index of a card in the *unsorted* hand. The kitty-discard screen tracks
// selections by original index, but renders from the sorted grouping.
export function indexInHand(hand, card) {
  return hand.findIndex((c) => c.suit === card.suit && c.value === card.value);
}
