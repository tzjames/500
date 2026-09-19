const test = require("node:test");
const assert = require("node:assert/strict");

const { deckAllowed, DEFAULT_DECK } = require("./decks");

test("a public pack needs nobody in particular", () => {
  assert.equal(deckAllowed("scientists", []), true);
  assert.equal(deckAllowed("classic", ["Bob"]), true);
});

// The rule used to demand the room be exactly Graham and James. It now matches
// the private backdrops: any one owner, alongside whoever else.
test("the Travelers pack needs James or Graham, and nobody more", () => {
  assert.equal(deckAllowed("traveller", ["James"]), true);
  assert.equal(deckAllowed("traveller", ["Bob", "Graham"]), true);
  assert.equal(deckAllowed("traveller", ["Graham", "James"]), true);
  assert.equal(deckAllowed("traveller", ["Bob", "Sue"]), false);
  assert.equal(deckAllowed("traveller", []), false);
});

test("names match regardless of case or stray spacing", () => {
  assert.equal(deckAllowed("traveller", ["  jAmEs "]), true);
  assert.equal(deckAllowed("traveller", [null, undefined, "GRAHAM"]), true);
});

test("the fallback pack is one anybody can use", () => {
  assert.equal(deckAllowed(DEFAULT_DECK, []), true);
  assert.notEqual(DEFAULT_DECK, "traveller");
});
