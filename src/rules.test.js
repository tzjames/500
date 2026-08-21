import { trumpOrder, noTrumpReason, bidValue } from "./rules";

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
test("there is no trump order to show without a trump suit", () => {
  expect(noTrumpReason("♠", "6 ♠")).toBeNull();
  expect(noTrumpReason(null, null)).toMatch(/No contract yet/);
  expect(noTrumpReason(null, "Misere")).toMatch(/no-tricks contract/i);
  expect(noTrumpReason(null, "Open Misere")).toMatch(/no-tricks contract/i);
  expect(noTrumpReason(null, "7 NT")).toMatch(/No-trumps/);
  expect(trumpOrder(null, "four")).toEqual([]);
});

test("a table that calls it Nullo is still recognised as a no-tricks contract", () => {
  expect(noTrumpReason(null, "Nullo")).toMatch(/no-tricks contract/i);
});

// The Avondale schedule, which is what the modal's grid is drawn from.
test("the bid table follows the Avondale schedule", () => {
  expect(bidValue(6, "♠")).toBe(40);
  expect(bidValue(6, "NT")).toBe(120);
  expect(bidValue(7, "♠")).toBe(140);
  expect(bidValue(10, "NT")).toBe(520);
});
