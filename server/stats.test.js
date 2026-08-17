const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("./db");
const { isFriendlyGame } = require("./friendly");

// ---- isFriendlyGame ----

test("isFriendlyGame: an ordinary human table is rated", () => {
  const doc = { playerSlots: [{ userId: "u0" }, { userId: "u1" }] };
  assert.equal(isFriendlyGame(doc), false);
});

test("isFriendlyGame: the friendly flag alone is enough", () => {
  const doc = { friendly: true, playerSlots: [{ userId: "u0" }, { userId: "u1" }] };
  assert.equal(isFriendlyGame(doc), true);
});

test("isFriendlyGame: a robot at the table forces it, flag or no flag", () => {
  const doc = {
    friendly: false,
    playerSlots: [{ userId: "u0" }, { userId: "bot:1", isBot: true }],
  };
  assert.equal(isFriendlyGame(doc), true);
});

test("isFriendlyGame: tolerates a missing or empty slot list", () => {
  assert.equal(isFriendlyGame({}), false);
  assert.equal(isFriendlyGame({ playerSlots: null }), false);
  assert.equal(isFriendlyGame({ playerSlots: [null, undefined] }), false);
});

// ---- statsFor ----

// db.finishedGamesForUser / roundsBidBy / eloForUser are the only things
// statsFor reads from Mongo; stubbing them turns the whole module into a pure
// function of this fixture data.
const gameA = {
  status: "finished",
  mode: 4,
  playerSlots: [
    { userId: "u0", name: "Ann" },
    { userId: "u1", name: "Bo" },
    { userId: "u2", name: "Cy" },
    { userId: "u3", name: "Di" },
  ],
  winner: { playerIds: ["u0", "u2"] },
  snapshot: { seatOrder: ["u0", "u1", "u2", "u3"] },
};

// Friendly because a robot is seated — never marked as such explicitly.
const gameB = {
  status: "finished",
  mode: 4,
  playerSlots: [
    { userId: "u0", name: "Ann" },
    { userId: "bot:1", name: "R1", isBot: true },
    { userId: "u2", name: "Cy" },
    { userId: "bot:2", name: "R2", isBot: true },
  ],
  winner: { playerIds: ["bot:1", "bot:2"] },
  snapshot: { seatOrder: ["u0", "bot:1", "u2", "bot:2"] },
};

// Friendly because it was marked that way — an all-human table.
const gameC = {
  status: "finished",
  mode: 4,
  friendly: true,
  playerSlots: [
    { userId: "u0", name: "Ann" },
    { userId: "u1", name: "Bo" },
    { userId: "u4", name: "Ed" },
    { userId: "u5", name: "Fi" },
  ],
  winner: { playerIds: ["u0", "u4"] },
  snapshot: { seatOrder: ["u0", "u1", "u4", "u5"] },
};

const roundRated1 = { bidderUserId: "u0", bid: "7 ♥", level: 7, tricks: 7, made: true };
const roundRated2 = { bidderUserId: "u0", bid: "Misere", level: null, tricks: 0, made: true };
// Friendly the old way, from before this field existed.
const roundOldFriendly = {
  bidderUserId: "u0",
  bid: "6 ♠",
  level: 6,
  tricks: 6,
  made: true,
  withBots: true,
};
// Friendly the current way.
const roundFriendly = {
  bidderUserId: "u0",
  bid: "8 ♦",
  level: 8,
  tricks: 7,
  made: false,
  friendly: true,
};

function withStubs(fn) {
  const originals = {
    finishedGamesForUser: db.finishedGamesForUser,
    roundsBidBy: db.roundsBidBy,
    eloForUser: db.eloForUser,
  };
  db.finishedGamesForUser = async () => [gameA, gameB, gameC];
  db.roundsBidBy = async () => [roundRated1, roundRated2, roundOldFriendly, roundFriendly];
  db.eloForUser = async () => ({ 2: 1180, 4: 1265 });
  // Re-require fresh each call isn't necessary — stats.js reads db.* at call
  // time, not at require time, so overwriting the exports is enough.
  const stats = require("./stats");
  return fn(stats).finally(() => Object.assign(db, originals));
}

test("statsFor excludes friendly games and rounds by default", () =>
  withStubs(async (stats) => {
    const result = await stats.statsFor("u0", 4);

    assert.equal(result.includeFriendly, false);
    assert.equal(result.elo, 1265, "reads the rating for the requested table size");
    assert.equal(result.games, 1, "only the rated game counts");
    assert.equal(result.wins, 1);
    assert.equal(result.losses, 0);
    assert.equal(result.practiceGames, 2, "both friendly games are still counted, just separately");
    assert.equal(result.practiceRounds, 2);

    assert.equal(result.contracts.total, 2);
    assert.equal(result.contracts.numeric, 1);
    assert.equal(result.contracts.special, 1);
    assert.equal(result.contracts.specialMade, 1);
    assert.equal(result.contracts.made, 2);
    assert.deepEqual(result.contracts.accuracy, [{ diff: 0, count: 1 }]);

    const sevenHearts = result.bids.find((b) => b.bid === "7 ♥");
    assert.deepEqual(sevenHearts, { bid: "7 ♥", points: 200, special: false, level: 7, suit: "♥", attempts: 1, made: 1 });
    const sixSpades = result.bids.find((b) => b.bid === "6 ♠");
    assert.equal(sixSpades.attempts, 0, "the friendly round for this bid is excluded");

    assert.equal(result.tables.length, 1);
    assert.equal(result.tables[0].label, "with Cy v Bo & Di");
    assert.equal(result.tables[0].wins, 1);
    assert.equal(result.partners.length, 1);
    assert.equal(result.partners[0].label, "Cy");
  }));

test("statsFor folds friendly games and rounds back in when asked", () =>
  withStubs(async (stats) => {
    const result = await stats.statsFor("u0", 4, true);

    assert.equal(result.includeFriendly, true);
    assert.equal(result.games, 3);
    assert.equal(result.wins, 2, "gameA and gameC; gameB's robots won that one");
    assert.equal(result.losses, 1);
    // Still reported, even though they're folded into the headline figures now.
    assert.equal(result.practiceGames, 2);
    assert.equal(result.practiceRounds, 2);

    assert.equal(result.contracts.total, 4);
    assert.equal(result.contracts.made, 3, "three of the four rounds were made");
    assert.deepEqual(result.contracts.accuracy, [
      { diff: -1, count: 1 },
      { diff: 0, count: 2 },
    ]);

    const eightDiamonds = result.bids.find((b) => b.bid === "8 ♦");
    assert.deepEqual(eightDiamonds.attempts, 1);
    assert.equal(eightDiamonds.made, 0);

    // The partner Cy shows up in both a win (gameA) and a loss (gameB) —
    // partner record is meant to aggregate across different opponents.
    const cy = result.partners.find((p) => p.label === "Cy");
    assert.deepEqual({ wins: cy.wins, losses: cy.losses }, { wins: 1, losses: 1 });
    assert.equal(result.tables.length, 3);
  }));

test("statsFor never rates a game just because it's being counted", () =>
  withStubs(async (stats) => {
    // Elo is read straight off the user document, never recomputed here —
    // asking to include friendly games can't retroactively rate one.
    const excluded = await stats.statsFor("u0", 4, false);
    const included = await stats.statsFor("u0", 4, true);
    assert.equal(excluded.elo, included.elo);
  }));
