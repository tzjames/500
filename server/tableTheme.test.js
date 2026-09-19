const test = require("node:test");
const assert = require("node:assert/strict");

const { applyTableTheme, locationAllowed } = require("./tableTheme");

const set = (location, names) =>
  applyTableTheme({ location: "falls" }, { location }, names).location;

// ---- locationAllowed ----

test("a public backdrop needs nobody in particular", () => {
  assert.equal(locationAllowed("canyon", []), true);
  assert.equal(locationAllowed("plain-canyon", ["Bob"]), true);
});

test("a Mzumbe backdrop needs James or Graham at the table", () => {
  assert.equal(locationAllowed("mzumbe-road", ["James", "Bob"]), true);
  assert.equal(locationAllowed("mzumbe-road", ["Bob", "Graham"]), true);
  assert.equal(locationAllowed("mzumbe-road", ["Bob", "Sue"]), false);
  assert.equal(locationAllowed("mzumbe-road", []), false);
});

// Either one is enough on their own, with anybody else alongside.
test("one owner is enough, and the rest of the table can be anyone", () => {
  assert.equal(locationAllowed("mzumbe-quad", ["James"]), true);
  assert.equal(locationAllowed("mzumbe-quad", ["Graham", "Bob", "Sue", "Ann"]), true);
});

test("names match regardless of case or stray spacing", () => {
  assert.equal(locationAllowed("mzumbe-ridge", ["  jAmEs "]), true);
  assert.equal(locationAllowed("mzumbe-ridge", [null, undefined, "GRAHAM"]), true);
});

// ---- applyTableTheme ----

test("the server refuses a Mzumbe backdrop the room isn't entitled to", () => {
  assert.equal(set("mzumbe-peaks", ["James"]), "mzumbe-peaks");
  assert.equal(set("mzumbe-peaks", ["Bob", "Sue"]), "falls");
});

test("a backdrop off the list is still rejected outright", () => {
  assert.equal(set("../../etc/passwd", ["James"]), "falls");
  assert.equal(set(undefined, ["James"]), "falls");
});
