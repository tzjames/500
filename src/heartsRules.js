// What the Hearts help panel needs to know about the table in front of you.
// Sixteen rule sets deal different packs, pass differently and — above all —
// disagree about which cards cost, so everything here takes a variant and that
// table's options rather than describing one game and hedging about the rest.
//
// The pack and the penalty values are worked out the same way the engine works
// them out (see dealtDeck and penaltyOf in server/hearts.js), off the same
// option definitions, so what this describes is what is really being dealt.
import { getVariant, resolveRules, targetOf } from "./heartsOptions";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
// Mirrors STRIP_ORDER in server/hearts.js: three players lose the 2♣, five the
// 2♣ and 2♦, six those plus the 2♠ and the 3♣.
const STRIP_ORDER = RANKS.slice(0, 11).flatMap((value) => ["♣", "♦", "♠"].map((suit) => `${value}${suit}`));

const SCALES = {
  spots: "the pip cards their face value, jack 11, queen 12, king 13 and ace 14",
  low: "the pip cards their face value, jack 2, queen 3, king 4 and ace 5",
  greek: "the pip cards their face value, the court cards 10 each and the ace 15",
};

const seatWord = { 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven" };

// The pack this table deals: how big it is, what came out of it to make it go
// round evenly, and how many cards that leaves each player.
export function packOf(variant, mode, options) {
  const spec = getVariant(variant);
  const rules = resolveRules(options, variant);
  const packs = spec.deck === 104 ? 2 : 1;
  const jokers = spec.deck === "jokers" || rules.jokers ? 2 : 0;
  const stripped = [...(spec.strip || [])];
  let size = packs * 52 + jokers - stripped.length * packs;
  const widow = spec.widow || 0;
  if (!spec.stock) {
    for (const id of STRIP_ORDER) {
      if ((size - widow) % mode === 0) break;
      stripped.push(id);
      size -= packs;
    }
  }
  const cards = spec.cards || Math.floor((size - widow) / mode);
  return { packs, jokers, stripped, size, widow, cards, stock: spec.stock ? size - cards * mode : 0 };
}

// How many cards go where, said as a sentence.
export function dealLine(variant, mode, options) {
  const pack = packOf(variant, mode, options);
  const packs = pack.packs === 2 ? "two packs shuffled together, " : "";
  const jokers = pack.jokers ? " plus two jokers" : "";
  const out = pack.stripped.length
    ? ` The ${listOf(pack.stripped)} ${pack.stripped.length === 1 ? "comes" : "come"} out so the pack goes round evenly.`
    : "";
  const rest = pack.stock
    ? `, and the other ${pack.stock} face down as a stock`
    : pack.widow
    ? `, and the last ${pack.widow} face down as a widow`
    : "";
  return `${seatWord[mode] || mode} players, ${packs}${pack.size} cards${jokers} — ${pack.cards} each${rest}.${out}`;
}

// Which cards cost, and how much. This is the part that actually differs
// between the rule sets, so it is a list rather than prose.
export function penaltyLines(variant, mode, options) {
  const spec = getVariant(variant);
  const rules = resolveRules(options, variant);
  const lines = spec.penalties.map((p) => {
    if (p.kind === "scale") return `Hearts: ${SCALES[p.scale]}`;
    if (p.kind === "bidSuit") return "Every card of the suit the high bidder names — 1 each";
    return p.label;
  });
  // The 1887 rules printed two alternatives to a chip a heart, and both of them
  // replace whatever the heart line above says.
  if (rules.heartChips && rules.heartChips !== "plain") {
    lines[0] = `Hearts: ${SCALES[rules.heartChips]}`;
  }
  if (spec.specials?.includes("royalQueens")) {
    lines.push("The queen of hearts doubles every heart the same player took");
    lines.push("The queen of clubs cancels the queen of spades for whoever takes her");
  }
  return lines;
}

// What one card costs whoever takes it. Mirrors penaltyOf in server/hearts.js,
// which is the authority — this is here so a screen can price a card without
// asking the server about every one of them.
export function penaltyValue(card, variant, options, penaltySuit = null) {
  if (!card || card.suit === "Joker") return 0;
  const spec = getVariant(variant);
  const rules = resolveRules(options, variant);
  const named = spec.penalties.find((p) => p.kind === "card" && p.value === card.value && p.suit === card.suit);
  if (named) return named.points;
  const ranked = spec.penalties.find((p) => p.kind === "value" && p.value === card.value);
  if (ranked) return ranked.points;
  if (card.suit === "♥" && rules.heartChips && rules.heartChips !== "plain") {
    return scaled(card.value, rules.heartChips);
  }
  for (const p of spec.penalties) {
    if (p.kind === "suit" && p.suit === card.suit) return p.points;
    if (p.kind === "scale" && p.suit === card.suit) return scaled(card.value, p.scale);
    if (p.kind === "bidSuit" && penaltySuit && card.suit === penaltySuit) return p.points;
  }
  return 0;
}

// Everything that can be on the table in a deal, which is what a moon has to
// take all of. Counted off the real pack so a stripped card can't be counted.
// The auction names its suit after the deal, so hearts stand in for it — one
// suit is one suit whichever it turns out to be.
export function totalPoints(variant, mode, options) {
  const pack = packOf(variant, mode, options);
  let total = 0;
  for (const suit of ["♠", "♥", "♦", "♣"]) {
    for (const rank of RANKS) {
      if (pack.stripped.includes(`${rank}${suit}`)) continue;
      total += Math.max(0, penaltyValue({ suit, value: rank }, variant, options, "♥")) * pack.packs;
    }
  }
  return total;
}

const SCALE_TABLES = {
  spots: { A: 14, K: 13, Q: 12, J: 11 },
  low: { A: 5, K: 4, Q: 3, J: 2 },
  greek: { A: 15, K: 10, Q: 10, J: 10 },
};
const scaled = (value, scale) => SCALE_TABLES[scale][value] ?? Number(value);

// How the three cards move, and what happens when they don't.
export function passingLine(variant, mode, options) {
  const direction = resolveRules(options, variant).passing;
  if (direction === "none") return "Nothing is passed — you play the hand you were dealt.";
  const cycle =
    mode === 4
      ? "left on the first deal, right on the second, across on the third, and nobody passes on the fourth"
      : "left on the first deal, right on the second, and nobody passes on the third";
  if (direction === "cycle") {
    return `Before a card is led, everyone chooses three cards and passes them on, receiving three back: ${cycle}, then round again. You pick your three before you see what is coming the other way.`;
  }
  const where = { left: "to the player on your left", right: "to the player on your right", across: "to the player opposite", hold: "nowhere — the hand stands as dealt" };
  return `Before a card is led, everyone chooses three cards and passes them ${where[direction] || where.left}, receiving three back. You pick your three before you see what is coming the other way.`;
}

// How the first trick opens, and what may be thrown to it.
export function playLines(variant, mode, options) {
  const spec = getVariant(variant);
  const rules = resolveRules(options, variant);
  const lines = [];
  if (spec.auction) {
    lines.push(
      "Each player in turn bids for the right to name the penalty suit, eldest hand first, and each bid must beat the one standing. The high bidder pays their bid onto their own score, names the suit, and leads to the first trick."
    );
  } else if (rules.lead === "twoOfClubs") {
    lines.push("Whoever holds the two of clubs leads it to the first trick — or the lowest club left in the pack, where the table size has taken the two out.");
  } else {
    lines.push("The eldest hand — to the dealer's left — leads to the first trick, with whatever they like.");
  }
  lines.push(
    spec.stock
      ? "Follow suit if you can. If you cannot, you do not discard: you draw from the stock, one card at a time, until you can follow, and only then play. Once the stock is empty an unfollowable trick is discarded to as usual."
      : "Follow suit if you can; otherwise play anything. The highest card of the suit led takes the trick and leads the next — there is no trump suit and nothing beats the suit that was led."
  );
  if (spec.cancel) {
    lines.push(
      "Two packs are in play, so the same card can be played twice to one trick — and when it is, both copies are out of the running. If every card of the led suit cancels, nobody wins the trick: it stays on the table and goes to whoever takes the next one."
    );
  }
  if (spec.deck === "jokers" || rules.jokers) {
    lines.push("A joker may be played at any time, whether or not you could follow suit. It never wins a trick and it never costs anything.");
  }
  if (rules.breakHearts) {
    lines.push("Hearts may not be led until one has been played off-suit — until they are broken — unless the hand on lead has nothing else left.");
  }
  if (rules.noPointsFirstTrick) {
    lines.push("Nothing that costs may be played to the first trick, so the opening trick is always free. The restriction lifts for a hand that holds nothing else.");
  }
  if (spec.widow) {
    lines.push(`Whoever wins the first trick also takes the ${spec.widow}-card widow, and whatever it is holding goes on their score with the rest.`);
  }
  if (rules.misdealOnAllPenalties) {
    lines.push("A hand made up entirely of cards that cost is thrown in and the whole deal dealt again.");
  }
  return lines;
}

// What a moon is worth here, and which way it goes.
export function moonLine(variant, mode, options) {
  const spec = getVariant(variant);
  const rules = resolveRules(options, variant);
  if (!rules.shootTheMoon) {
    return "Shooting the moon is off at this table: take every card that costs and it simply all goes on your score.";
  }
  const value = spec.moonScore ?? totalPoints(variant, mode, options);
  const counters = spec.moonNeedsBonus ? " — and the bonus card with them" : "";
  const how =
    spec.moonMode === "add"
      ? `every other player takes ${value}`
      : rules.moonChoice === "add"
      ? `every other player takes ${value}`
      : rules.moonChoice === "subtract"
      ? `${value} comes off your own score`
      : `you either take ${value} off your own score or put it on everybody else's, whichever helps you more`;
  return `Take every card that costs${counters} and you have shot the moon: ${how}.`;
}

export function winningLine(variant, mode, options) {
  const rules = resolveRules(options, variant);
  const deals = rules.endAfterDeals && rules.endAfterDeals !== "none" ? `, or after ${rules.endAfterDeals} deals` : "";
  return `Play stops as soon as somebody reaches ${targetOf(variant, options)}${deals}, and the lowest score at that moment wins — which is usually not the player who got there.`;
}

// A plain list, as a person would say it.
function listOf(ids) {
  if (ids.length <= 2) return ids.join(" and ");
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

// The one paragraph that says what makes this rule set itself.
export const aboutVariant = (variant) => getVariant(variant).detail;
