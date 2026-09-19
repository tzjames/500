import {
  LOCATIONS,
  locationsFor,
  locationAllowed,
  resolveLocationId,
  randomLocationId,
  DEFAULT_LOCATION,
} from "./theme";

const ids = (names) => locationsFor(names).map((l) => l.id);

test("the Mzumbe backdrops are hidden from a table without James or Graham", () => {
  expect(ids(["Bob", "Sue"]).some((id) => id.startsWith("mzumbe-"))).toBe(false);
  expect(ids(["Bob", "James"]).filter((id) => id.startsWith("mzumbe-"))).toHaveLength(6);
});

test("either owner is enough on their own", () => {
  expect(locationAllowed("mzumbe-road", ["graham"])).toBe(true);
  expect(locationAllowed("mzumbe-road", ["James"])).toBe(true);
  expect(locationAllowed("mzumbe-road", ["Bob"])).toBe(false);
});

test("hiding the private backdrops leaves every public one in place", () => {
  const publicCount = LOCATIONS.length - 6;
  expect(ids(["Bob"])).toHaveLength(publicCount);
  expect(ids([])).not.toContain("mzumbe-quad");
  expect(ids([])).toContain("falls");
});

// Every Mzumbe entry needs a photograph; they have no plain-colour twin, so a
// missing one would leave a wash with nothing behind it.
test("each Mzumbe location points at a backdrop and sits in its own group", () => {
  const mzumbe = LOCATIONS.filter((l) => l.id.startsWith("mzumbe-"));
  expect(mzumbe).toHaveLength(6);
  for (const place of mzumbe) {
    expect(place.photo).toMatch(/^\/backdrops\/.+\.jpg$/);
    expect(place.group).toBe("Mzumbe");
  }
});

test("a game set to a private backdrop falls back once its owner leaves", () => {
  expect(resolveLocationId("mzumbe-valley", ["James"])).toBe("mzumbe-valley");
  expect(resolveLocationId("mzumbe-valley", ["Bob"])).toBe(DEFAULT_LOCATION);
  expect(resolveLocationId("canyon", ["Bob"])).toBe("canyon");
});

test("surprise me never deals out a backdrop the room can't see", () => {
  for (let i = 0; i < 60; i += 1) {
    expect(randomLocationId("falls", ["Bob"]).startsWith("mzumbe-")).toBe(false);
  }
});

test("surprise me still always moves off the current table", () => {
  for (let i = 0; i < 60; i += 1) {
    expect(randomLocationId("falls", ["James"])).not.toBe("falls");
  }
});
