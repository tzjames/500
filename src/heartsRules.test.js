import {
  packOf,
  dealLine,
  penaltyLines,
  penaltyValue,
  totalPoints,
  passingLine,
  playLines,
  moonLine,
  winningLine,
} from "./heartsRules";
import { resolveRules, changedOptionLabels, targetOf } from "./heartsOptions";

const card = (value, suit) => ({ value, suit });

// The pack is the thing the panel would be lying about first, and it has to
// match what server/hearts.js deals — three players lose the 2♣, five the 2♣
// and 2♦, six those plus the 2♠ and the 3♣.
test("the pack it describes is the pack the rules strip for the table size", () => {
  expect(packOf("blackLady", 3).stripped).toEqual(["2♣"]);
  expect(packOf("blackLady", 4).stripped).toEqual([]);
  expect(packOf("blackLady", 5).stripped).toEqual(["2♣", "2♦"]);
  expect(packOf("blackLady", 6).stripped).toEqual(["2♣", "2♦", "2♠", "3♣"]);
});

test("and everybody gets the same number of cards out of it", () => {
  for (const mode of [3, 4, 5, 6]) {
    const pack = packOf("blackLady", mode);
    expect(pack.cards * mode).toBe(pack.size);
  }
});

test("a rule set with a widow or a stock keeps them out of the deal", () => {
  expect(packOf("heartsette", 4)).toMatchObject({ size: 51, widow: 3, cards: 12 });
  expect(packOf("domino", 4)).toMatchObject({ cards: 6, stock: 28 });
  expect(packOf("cancellation", 8)).toMatchObject({ packs: 2, size: 104, cards: 13 });
  expect(packOf("joker", 3)).toMatchObject({ jokers: 2, size: 54, cards: 18 });
});

test("the deal reads as a sentence about this table and no other", () => {
  expect(dealLine("blackLady", 4)).toMatch(/Four players, 52 cards — 13 each/);
  expect(dealLine("blackLady", 5)).toMatch(/2♣ and 2♦ come out/);
  expect(dealLine("heartsette", 4)).toMatch(/last 3 face down as a widow/);
  expect(dealLine("domino", 4)).toMatch(/28 face down as a stock/);
});

// ---- what costs ----

test("a card is priced by the most specific rule that matches it", () => {
  // Chasse Coeur prices every queen at 13 and the hearts at 1, and the queen of
  // hearts is a queen rather than a heart.
  expect(penaltyValue(card("Q", "♥"), "chasseCoeur")).toBe(13);
  expect(penaltyValue(card("K", "♥"), "chasseCoeur")).toBe(1);
});

test("each rule set prices its own cards, and the panel says so", () => {
  expect(penaltyValue(card("Q", "♠"), "blackLady")).toBe(13);
  expect(penaltyValue(card("Q", "♠"), "blackJack")).toBe(0);
  expect(penaltyValue(card("J", "♠"), "blackJack")).toBe(10);
  expect(penaltyValue(card("A", "♠"), "blackMaria")).toBe(10);
  expect(penaltyValue(card("A", "♥"), "spot")).toBe(14);
  expect(penaltyValue(card("10", "♦"), "omnibus")).toBe(-10);
  expect(penaltyLines("blackMaria", 4).join(" ")).toMatch(/king of spades — 7/);
  expect(penaltyLines("royal", 4).join(" ")).toMatch(/queen of clubs cancels/);
});

test("the total on the table is what a moon has to take, and it follows the pack", () => {
  expect(totalPoints("blackLady", 4)).toBe(26);
  expect(totalPoints("modern", 4)).toBe(13);
  expect(totalPoints("spot", 4)).toBe(104);
  expect(totalPoints("chasseCoeur", 4)).toBe(64);
  // A joker is in the pack and costs nothing, so it changes no total.
  expect(totalPoints("joker", 4)).toBe(26);
});

// ---- the rules a table is really playing ----

test("a rule left on Standard resolves to whatever the rule set says", () => {
  expect(resolveRules({}, "blackLady").passing).toBe("cycle");
  expect(resolveRules({}, "blackMaria").passing).toBe("right");
  expect(resolveRules({}, "earliest").passing).toBe("none");
  expect(resolveRules({ passing: "across" }, "blackLady").passing).toBe("across");
});

test("a rule the rule set doesn't offer stays the rule set's own, however it was left", () => {
  // Breaking hearts is not a rule of the 1887 game, so setting it changes
  // nothing there.
  expect(resolveRules({ breakHearts: true }, "earliest").breakHearts).toBe(false);
  expect(resolveRules({ breakHearts: false }, "blackLady").breakHearts).toBe(false);
});

test("the target follows the rule set until the table moves it", () => {
  expect(targetOf("blackLady", {})).toBe(100);
  expect(targetOf("domino", {})).toBe(31);
  expect(targetOf("earliest", {})).toBe(50);
  expect(targetOf("blackLady", { target: "50" })).toBe(50);
});

test("only the switches this rule set uses can count as changed", () => {
  expect(changedOptionLabels({}, "blackLady")).toEqual([]);
  expect(changedOptionLabels({ passing: "right" }, "blackLady")).toEqual(["Pass right"]);
  // Jokers are not on offer in the British game, so setting them says nothing.
  expect(changedOptionLabels({ jokers: true }, "blackMaria")).toEqual([]);
});

// ---- the prose ----

test("the passing line says which way the cards actually go", () => {
  expect(passingLine("blackLady", 4)).toMatch(/left on the first deal, right on the second, across/);
  expect(passingLine("blackLady", 3)).not.toMatch(/across/);
  expect(passingLine("blackMaria", 4)).toMatch(/on your right/);
  expect(passingLine("earliest", 4)).toMatch(/Nothing is passed/);
});

test("the play lines describe this table's first trick and nobody else's", () => {
  const modern = playLines("blackLady", 4).join(" ");
  expect(modern).toMatch(/two of clubs leads/);
  expect(modern).toMatch(/Hearts may not be led/);
  expect(modern).toMatch(/Nothing that costs may be played to the first trick/);

  const old = playLines("earliest", 4).join(" ");
  expect(old).toMatch(/eldest hand/);
  expect(old).not.toMatch(/may not be led/);
});

test("the oddities each get a line of their own where they apply", () => {
  expect(playLines("cancellation", 6).join(" ")).toMatch(/both copies are out of the running/);
  expect(playLines("domino", 4).join(" ")).toMatch(/draw from the stock/);
  expect(playLines("joker", 4).join(" ")).toMatch(/joker may be played at any time/);
  expect(playLines("heartsette", 4).join(" ")).toMatch(/3-card widow/);
  expect(playLines("auction", 4).join(" ")).toMatch(/bids for the right to name the penalty suit/);
});

test("the moon line says what it is worth here and which way it goes", () => {
  expect(moonLine("blackLady", 4)).toMatch(/either take 26 off your own score or put it on everybody/);
  expect(moonLine("blackLady", 4, { moonChoice: "add" })).toMatch(/every other player takes 26/);
  expect(moonLine("omnibus", 4)).toMatch(/bonus card with them/);
  expect(moonLine("partnership", 4)).toMatch(/every other player takes 52/);
  expect(moonLine("greek", 4)).toMatch(/takes 150/);
  expect(moonLine("blackLady", 4, { shootTheMoon: false })).toMatch(/is off at this table/);
});

test("the winning line says the lowest score takes it", () => {
  expect(winningLine("blackLady", 4)).toMatch(/reaches 100.*lowest score/s);
  expect(winningLine("blackLady", 4, { endAfterDeals: "8" })).toMatch(/after 8 deals/);
});
