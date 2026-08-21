import { trumpOrder, noTrumpReason, trumpOrderState, bidValue, EXAMPLE_SUIT } from "./rules";

const labels = (trumpSuit, variant) => trumpOrder(trumpSuit, variant).map((e) => e.label);

// The order of trumps is the thing players get wrong, so it's the thing most
// worth pinning down: the jack is promoted out of its suit, which puts the ten
// directly under the queen, and the other jack of the same colour joins in.
test("a trump suit runs Joker, both bowers, then the suit from the ace down", () => {
  expect(labels("♠", "four")).toEqual([
    "Joker", "J♠", "J♣", "A♠", "K♠", "Q♠", "10♠", "9♠", "8♠", "7♠", "6♠", "5♠",
  ]);
});

test("the left bower is the other suit of the same colour", () => {
  expect(labels("♥", "four")[2]).toBe("J♦");
  expect(labels("♦", "four")[2]).toBe("J♥");
  expect(labels("♣", "four")[2]).toBe("J♠");
});

test("no jack of the trump suit appears among the plain trumps", () => {
  for (const suit of ["♠", "♣", "♥", "♦"]) {
    const plains = labels(suit, "four").slice(3);
    expect(plains).not.toContain(`J${suit}`);
  }
});

// The two games deal different packs, and the panel would be lying if it showed
// a card that isn't in the one being played with.
test("the four-player pack has no black four, and no twos or threes", () => {
  expect(labels("♠", "four")).not.toContain("4♠");
  expect(labels("♠", "four")).toContain("5♠");
  expect(labels("♥", "four")).toContain("4♥");
  expect(labels("♥", "four")).not.toContain("3♥");
});

test("the two-player game deals a full pack, so its suits run down to the two", () => {
  expect(labels("♠", "two").slice(-3)).toEqual(["4♠", "3♠", "2♠"]);
  expect(labels("♠", "two")).toHaveLength(15);
  expect(labels("♠", "four")).toHaveLength(12);
});

// Why the Trump order button is greyed out. Each of these is a different reason
// and the button says which, rather than just going dim.
test("a contract with no trump suit has no order to show", () => {
  expect(noTrumpReason("♠", "6 ♠")).toBeNull();
  expect(noTrumpReason(null, "Misere")).toMatch(/no-tricks contract/i);
  expect(noTrumpReason(null, "Open Misere")).toMatch(/no-tricks contract/i);
  expect(noTrumpReason(null, "7 NT")).toMatch(/No-trumps/);
  expect(trumpOrder(null, "four")).toEqual([]);
});

test("a table that calls it Nullo is still recognised as a no-tricks contract", () => {
  expect(noTrumpReason(null, "Nullo")).toMatch(/no-tricks contract/i);
});

// During the auction nothing is trumps, but the shape of the order is the same
// whichever suit wins — and that's exactly when someone is trying to work out
// what a bid is worth, so the panel shows a worked example instead of refusing.
test("the auction gets an example suit rather than a locked button", () => {
  const bidding = trumpOrderState(null, null, "four");
  expect(bidding.mode).toBe("example");
  expect(bidding.suit).toBe(EXAMPLE_SUIT);
  expect(bidding.order.map((e) => e.label).slice(0, 4)).toEqual([
    "Joker", "J♠", "J♣", "A♠",
  ]);
  expect(bidding.reason).toBeNull();
});

test("a settled trump suit is shown for real, not as an example", () => {
  const live = trumpOrderState("♥", "7 ♥", "four");
  expect(live.mode).toBe("live");
  expect(live.suit).toBe("♥");
  expect(live.order[1].label).toBe("J♥");
});

test("a no-trumps or no-tricks contract still blocks the panel", () => {
  for (const bid of ["7 NT", "Misere", "Open Misere", "Nullo"]) {
    const state = trumpOrderState(null, bid, "four");
    expect(state.mode).toBe("blocked");
    expect(state.order).toEqual([]);
    expect(state.reason).toBeTruthy();
  }
});

// The Avondale schedule, which is what the modal's grid is drawn from.
test("the bid table follows the Avondale schedule", () => {
  expect(bidValue(6, "♠")).toBe(40);
  expect(bidValue(6, "NT")).toBe(120);
  expect(bidValue(7, "♠")).toBe(140);
  expect(bidValue(10, "NT")).toBe(520);
});
