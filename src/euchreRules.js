// What the Euchre help panel needs to know about the table in front of you.
// Six rule sets deal different packs, reach trump differently and score
// differently, so everything here takes a variant and that table's options
// rather than describing one game and hedging about the rest.
//
// The pack is worked out the same way the engine works it out (see deckSpec in
// server/euchre.js), off the same option definitions, so the order this shows is
// the order that is really being dealt.
import { getVariant, scopedOptions } from "./euchreOptions";

const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

// Plain trumps highest first, with the jack left out: it isn't a plain trump in
// its own suit, it's the right bower, and it comes in above the ace. Note the
// ten sitting directly under the queen, as in 500.
const PLAIN_TRUMPS = ["A", "K", "Q", "10", "9", "8", "7"];

const EXTRA_RANKS = { none: 0, eights: 1, sevens: 2 };

// The pack this table deals: how many plain ranks each suit runs to, and whether
// there is a Benny on top of them.
export function packOf(variant, options) {
  const spec = getVariant(variant);
  const merged = scopedOptions(options, variant);
  const ranks = spec.deck === 32 ? 8 : 6 + (EXTRA_RANKS[merged.extraCards] || 0);
  const benny = spec.deck === 25 || Boolean(merged.benny);
  // PLAIN_TRUMPS runs A down to 7 with the jack left out, so the lowest card of
  // a `ranks`-deep suit sits one place further in than the ranks it counts.
  return { ranks, benny, size: ranks * 4 + (benny ? 1 : 0), low: PLAIN_TRUMPS[ranks - 2] };
}

// Every trump in order, highest first: the Benny if the pack has one, the two
// bowers, then the suit itself from the ace down. `note` is set on the cards
// whose position isn't self-evident from the face.
export function trumpOrder(trumpSuit, variant, options) {
  if (!trumpSuit || !LEFT_BOWER_SUIT[trumpSuit]) return [];
  const { ranks, benny } = packOf(variant, options);
  const leftSuit = LEFT_BOWER_SUIT[trumpSuit];
  return [
    ...(benny
      ? [{ card: { suit: "Joker", value: "Joker" }, label: "Benny", note: "trump in every hand" }]
      : []),
    { card: { suit: trumpSuit, value: "J" }, label: `J${trumpSuit}`, note: "right bower" },
    { card: { suit: leftSuit, value: "J" }, label: `J${leftSuit}`, note: "left bower" },
    ...PLAIN_TRUMPS.slice(0, ranks - 1).map((value) => ({
      card: { suit: trumpSuit, value },
      label: `${value}${trumpSuit}`,
    })),
  ];
}

// Spades is the first suit everywhere else in the app, so it is the least
// surprising stand-in before trump has been made.
export const EXAMPLE_SUIT = "♠";

// What the trump-order panel should show. Once a suit is trump, that suit.
// Before that the shape is the same whichever suit is called, and calling is
// exactly when someone is working out what a hand is worth, so it shows one suit
// as an example rather than refusing. A no-trump contract really has no order.
export function trumpOrderState(trumpSuit, variant, options, noTrump = false) {
  if (noTrump) {
    return {
      mode: "blocked",
      reason: "A no-trump contract has no bowers — every trick goes to the highest card of the suit led.",
      suit: null,
      order: [],
    };
  }
  const suit = trumpSuit || EXAMPLE_SUIT;
  return {
    mode: trumpSuit ? "live" : "example",
    reason: null,
    suit,
    order: trumpOrder(suit, variant, options),
  };
}

const seatWord = { 2: "Two", 3: "Three", 4: "Four" };

// How many cards go where, said as a sentence.
export function dealLine(variant, mode, options) {
  const spec = getVariant(variant);
  const pack = packOf(variant, options);
  const cards = spec.cards || Math.floor(pack.size / mode);
  const dead = pack.size - cards * mode;
  const rest = !spec.auction
    ? `and the other ${dead} a kitty with its top card turned up for trump`
    : dead > 0
    ? `and ${dead} card${dead === 1 ? "" : "s"} left out of the deal`
    : "the whole pack dealt out and no kitty";
  const seats = seatWord[mode] || mode;
  const benny = pack.benny ? ", plus the Benny" : "";
  return `${seats} players, a ${pack.size}-card pack — ${pack.low} up to ace${benny} — ${cards} cards each, ${rest}.`;
}

// What becomes of the cards nobody was dealt. Worth saying outright, because
// anyone arriving from 500 will reasonably assume the kitty is the prize for
// winning the auction, and in Euchre it is nothing of the kind.
export function kittyLine(variant, mode, options) {
  const spec = getVariant(variant);
  if (spec.auction) return null;
  const pack = packOf(variant, options);
  const buried = pack.size - (spec.cards || 0) * mode - 1;
  return `Nobody wins the kitty. The turned card comes into play only if trump is made in the first round of calling, when the dealer takes it into hand and puts one card back face down. Every other card in the kitty — ${buried} of them here — stays buried, unseen by anybody all hand.`;
}

// How trump gets made, which is the biggest difference between the rule sets.
export function callingLines(variant, options) {
  const spec = getVariant(variant);
  const merged = scopedOptions(options, variant);
  if (spec.auction) {
    const lines = [
      "There is no turned card. Starting to the dealer's left, each player in turn bids the number of tricks they will take or passes, and each bid must beat the one standing.",
      merged.noTrumpBids
        ? "The high bidder then names a trump suit, or no trump — played high, or low, where the nines are the best cards in the pack and the aces the worst."
        : "The high bidder then names the trump suit.",
    ];
    if (merged.stickTheDealer) lines.push("If nobody bids, the dealer is stuck with a bid of one trick.");
    else lines.push("If nobody bids, the hand is thrown in and dealt again.");
    return lines;
  }

  const lines = [
    "The eldest hand — to the dealer's left — may order up the turned suit or pass. Order it up and the dealer takes that card into hand and discards one.",
    "If it goes round and everybody passes, the card is turned down and a second round lets anyone name a different suit instead.",
  ];
  if (merged.stickTheDealer) {
    lines.push("The dealer may not pass on that second round: whatever the hand looks like, they have to name a suit.");
  } else {
    lines.push("If everybody passes twice as well, the hand is thrown in and dealt again.");
  }
  if (spec.alone) {
    lines.push(
      merged.partnerMustGoAlone || spec.partnerMustGoAlone
        ? "Whoever makes trump may play the hand alone, their partner's cards face down beside them — and the dealer's partner must, if they want the deal."
        : "Whoever makes trump may play the hand alone, their partner's cards face down beside them."
    );
  }
  if (merged.trumpNeedsMore) lines.push("You may not name a suit if a lone jack is all the trump you would hold.");
  if (merged.benny && spec.deck !== 25) lines.push("If the Benny is the card turned up, the dealer names the suit outright.");
  return lines;
}

// What a hand is worth. Kept as short lines rather than prose: this is the part
// people look up mid-game.
export function scoringLines(variant, options) {
  const spec = getVariant(variant);
  const merged = scopedOptions(options, variant);
  if (variant === "threeHanded") {
    return [
      "Maker takes four of the seven tricks — 1",
      "Maker takes six — 2",
      "Maker takes all seven — 4",
      "Maker takes fewer than four — the defender with the most tricks scores 2, or one each if they tie",
    ];
  }
  if (spec.auction) {
    const lines = [
      "Every trick you take comes off your score",
      "Miss your bid and you go up 5",
      "Stay in the hand and take no trick at all and you go up 5",
    ];
    if (merged.folding) lines.push("Fold before the first lead and you score nothing either way");
    if (merged.bidPartners) lines.push("Partners pool their tricks and keep one score between them");
    return lines;
  }
  if (variant === "setback") {
    const lines = [
      "Every trick you take comes off your score",
      "Take no trick at all and you go up 1",
      "Maker fails to take three — the maker goes up 2",
    ];
    if (merged.defendersDeduct) lines.push("…and every defender takes 2 off as well");
    if (merged.declare) lines.push("Declare for every trick: win the game outright, or have your score doubled");
    if (merged.folding) lines.push("Throw the hand in before the first lead and you score nothing either way");
    return lines;
  }

  const lines = [
    "Makers take three or four tricks — 1",
    "Makers take all five, a march — 2",
    "A lone hand takes all five — 4",
    "Makers take fewer than three, euchred — 2 to the other side",
  ];
  if (merged.defendAlone) lines.push("A defender who went alone and takes three — 4");
  if (merged.pointOnPartner) {
    lines.push("The dealer's partner making trump and bringing it home — 1 extra, and the deal stays put");
  }
  if (merged.robson) {
    lines.push("A march may come off the other side's score instead, where they have the points to lose");
    lines.push("A blind lone hand on a turned jack — 5 if it sweeps, and 1 to the defenders if it fails");
  }
  return lines;
}

export function winningLine(variant, options) {
  const spec = getVariant(variant);
  const merged = scopedOptions(options, variant);
  if (spec.countdown) {
    return `Everyone starts at ${spec.start} and comes down. First to nothing wins.`;
  }
  const target = merged.target === "variant" ? spec.target : Number(merged.target);
  return `First to ${target} points wins.`;
}

// The one paragraph that says what makes this rule set itself.
export const aboutVariant = (variant) => getVariant(variant).detail;
