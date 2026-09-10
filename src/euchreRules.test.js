import {
  kittyLine,
  packOf,
  trumpOrder,
  trumpOrderState,
  dealLine,
  callingLines,
  scoringLines,
  winningLine,
  EXAMPLE_SUIT,
} from "./euchreRules";

const labels = (suit, variant, options) => trumpOrder(suit, variant, options).map((e) => e.label);

// The order of trumps is the thing players get wrong, so it's the thing most
// worth pinning down: the jack is promoted out of its suit, which puts the ten
// directly under the queen, and the other jack of the same colour joins in.
test("a trump suit runs both bowers, then the suit from the ace down", () => {
  expect(labels("♠", "northAmerican")).toEqual(["J♠", "J♣", "A♠", "K♠", "Q♠", "10♠", "9♠"]);
});

test("the left bower is the other suit of the same colour", () => {
  expect(labels("♥", "northAmerican")[1]).toBe("J♦");
  expect(labels("♦", "northAmerican")[1]).toBe("J♥");
  expect(labels("♣", "northAmerican")[1]).toBe("J♠");
});

test("no jack of the trump suit appears among the plain trumps", () => {
  for (const suit of ["♠", "♣", "♥", "♦"]) {
    expect(labels(suit, "northAmerican").slice(2)).not.toContain(`J${suit}`);
  }
});

// The panel would be lying if it showed a card that isn't in the pack being
// dealt, so the order follows the rule set and its extra-cards setting.
test("the order shows only the cards this table's pack holds", () => {
  expect(labels("♠", "northAmerican")).not.toContain("8♠");
  expect(labels("♠", "northAmerican", { extraCards: "eights" })).toContain("8♠");
  expect(labels("♠", "northAmerican", { extraCards: "eights" })).not.toContain("7♠");
  expect(labels("♠", "northAmerican", { extraCards: "sevens" })).toContain("7♠");
  // The 1844 rules and Set-Back are 32-card games whatever the option says.
  expect(labels("♠", "earliest")).toContain("7♠");
  expect(labels("♠", "setback")).toContain("7♠");
  // Three-handed offers extra cards; the British game is fixed at 25.
  expect(labels("♠", "threeHanded", { extraCards: "sevens" })).toContain("7♠");
  expect(labels("♠", "british")).not.toContain("8♠");
});

test("the Benny sits above both bowers, and only where the pack has one", () => {
  expect(labels("♠", "british")[0]).toBe("Benny");
  expect(labels("♥", "british")[0]).toBe("Benny");
  expect(labels("♠", "northAmerican")).not.toContain("Benny");
  expect(labels("♠", "northAmerican", { benny: true })[0]).toBe("Benny");
  // Bid Euchre has no Benny to turn on, so the option can't add one.
  expect(labels("♠", "bid", { benny: true })).not.toContain("Benny");
});

test("an option the rule set doesn't use can't change the pack it shows", () => {
  expect(packOf("earliest", { extraCards: "none" })).toMatchObject({ ranks: 8, size: 32 });
  expect(packOf("setback", { extraCards: "eights" })).toMatchObject({ ranks: 8, size: 32 });
  expect(packOf("british", { benny: false })).toMatchObject({ benny: true, size: 25 });
});

test("the pack names its own lowest card", () => {
  expect(packOf("northAmerican", {}).low).toBe("9");
  expect(packOf("northAmerican", { extraCards: "eights" }).low).toBe("8");
  expect(packOf("northAmerican", { extraCards: "sevens" }).low).toBe("7");
  expect(packOf("earliest", {}).low).toBe("7");
});

// ---- the trump-order panel's own state ----

test("before trump is made the panel shows a suit as an example", () => {
  const state = trumpOrderState(null, "northAmerican", {});
  expect(state.mode).toBe("example");
  expect(state.suit).toBe(EXAMPLE_SUIT);
  expect(state.order.length).toBeGreaterThan(0);
});

test("once trump is made the panel shows that suit", () => {
  const state = trumpOrderState("♥", "northAmerican", {});
  expect(state.mode).toBe("live");
  expect(state.suit).toBe("♥");
  expect(state.order[0].label).toBe("J♥");
});

test("a no-trump contract has no order to show, and says why", () => {
  const state = trumpOrderState(null, "bid", {}, true);
  expect(state.mode).toBe("blocked");
  expect(state.order).toEqual([]);
  expect(state.reason).toMatch(/no bowers/i);
});

// ---- the written rules ----

test("the deal is described in the pack and hand sizes actually used", () => {
  expect(dealLine("northAmerican", 4, {})).toMatch(
    /24-card pack — 9 up to ace — 5 cards each, and the other 4 a kitty/
  );
  expect(dealLine("threeHanded", 3, {})).toMatch(/7 cards each/);
  expect(dealLine("british", 4, {})).toMatch(/25-card pack — 9 up to ace, plus the Benny/);
  expect(dealLine("setback", 4, {})).toMatch(/32-card pack — 7 up to ace/);
  // Bid Euchre deals the pack out; 24 between three is exactly eight each.
  expect(dealLine("bid", 3, {})).toMatch(/8 cards each, the whole pack dealt out and no kitty/);
  expect(dealLine("bid", 3, { extraCards: "sevens" })).toMatch(/10 cards each, and 2 cards left out/);
});

// Anyone coming from 500 will assume the kitty is won by the auction. It isn't,
// and the panel has to say so rather than leave it to be discovered.
test("the kitty is described as buried, and counts what stays down", () => {
  expect(kittyLine("northAmerican", 4, {})).toMatch(/Nobody wins the kitty/);
  expect(kittyLine("northAmerican", 4, {})).toMatch(/3 of them here/);
  expect(kittyLine("british", 4, {})).toMatch(/4 of them here/);
  expect(kittyLine("threeHanded", 3, {})).toMatch(/2 of them here/);
  // Set-Back deals five each off a 32-card pack, so most of it never appears.
  expect(kittyLine("setback", 4, {})).toMatch(/11 of them here/);
  // Bid Euchre has no kitty to describe.
  expect(kittyLine("bid", 4, {})).toBe(null);
});

test("the auction rule sets describe an auction, and the rest a turned card", () => {
  expect(callingLines("bid", {})[0]).toMatch(/no turned card/i);
  expect(callingLines("northAmerican", {})[0]).toMatch(/order up the turned suit/i);
});

test("the house rules a table turned on are described, and the others are not", () => {
  const plain = callingLines("northAmerican", {}).join(" ");
  expect(plain).toMatch(/thrown in and dealt again/i);
  expect(plain).not.toMatch(/lone jack/i);

  const fussy = callingLines("northAmerican", { stickTheDealer: true, trumpNeedsMore: true }).join(" ");
  expect(fussy).toMatch(/may not pass on that second round/i);
  expect(fussy).toMatch(/lone jack/i);
  expect(fussy).not.toMatch(/thrown in and dealt again/i);
});

test("each rule set scores by its own table", () => {
  expect(scoringLines("northAmerican", {}).join(" ")).toMatch(/march/i);
  expect(scoringLines("threeHanded", {}).join(" ")).toMatch(/four of the seven/i);
  expect(scoringLines("bid", {}).join(" ")).toMatch(/go up 5/);
  expect(scoringLines("setback", {}).join(" ")).toMatch(/go up 1/);
  expect(scoringLines("northAmerican", { robson: true }).join(" ")).toMatch(/blind lone hand/i);
  expect(scoringLines("northAmerican", {}).join(" ")).not.toMatch(/blind lone hand/i);
});

test("winning is stated as the target, or as the race down to nothing", () => {
  expect(winningLine("northAmerican", {})).toMatch(/First to 10 points/);
  expect(winningLine("british", {})).toMatch(/First to 11 points/);
  expect(winningLine("earliest", {})).toMatch(/First to 5 points/);
  expect(winningLine("northAmerican", { target: "7" })).toMatch(/First to 7 points/);
  expect(winningLine("setback", {})).toMatch(/starts at 5 and comes down/);
  expect(winningLine("bid", {})).toMatch(/starts at 21 and comes down/);
});
