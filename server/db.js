const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://root:password@localhost:27017/?authSource=admin";
// Overridable so a throwaway database can be pointed at for a smoke test
// without touching the real one.
const DB_NAME = process.env.MONGO_DB || "card-game-500";

let users = null;
let games = null;
let rounds = null;

async function connect() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection("users");
  games = db.collection("games");
  // One row per scored round, written as it happens. The stats page is built
  // from these rather than by walking every game's event log, which is what
  // makes "how often do you make a 7♥" a query rather than a replay.
  rounds = db.collection("rounds");
  await users.createIndex({ nameLower: 1 }, { unique: true });
  await rounds.createIndex({ bidderUserId: 1, mode: 1 });
  console.log(`Connected to MongoDB (${DB_NAME})`);
}

async function createUser({ id, name, passwordHash }) {
  const user = { _id: id, name, nameLower: name.toLowerCase(), passwordHash, createdAt: Date.now() };
  await users.insertOne(user);
  return user;
}

async function findUserByName(name) {
  return users.findOne({ nameLower: name.toLowerCase() });
}

async function findUserById(id) {
  return users.findOne({ _id: id });
}

async function createGame(game) {
  await games.insertOne(game);
  return game;
}

async function getGame(id) {
  return games.findOne({ _id: id });
}

async function saveGame(id, patch) {
  await games.updateOne({ _id: id }, { $set: { ...patch, updatedAt: Date.now() } });
}

async function listGamesForUser(userId) {
  return games
    .find({ "playerSlots.userId": userId })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();
}

async function deleteGame(id) {
  await games.deleteOne({ _id: id });
}

// The lobby: tables anyone may sit down at. Only ever open, public tables —
// whether they still have a free seat is settled against live room state by the
// caller, since a seat taken a second ago isn't in the document yet.
async function listPublicWaitingGames() {
  return games
    .find({ visibility: "public", status: "waiting" })
    .sort({ createdAt: -1 })
    .limit(40)
    .toArray();
}

// The house rules and table theme this player last used at this size of game,
// so the new-game screen opens on what they chose last time rather than on the
// defaults every time. Any game counts, finished or not.
async function lastSettingsForUser(userId, mode) {
  const modeQuery = mode === 4 ? { mode: 4 } : { mode: { $ne: 4 } };
  const doc = await games.findOne(
    { "playerSlots.userId": userId, ...modeQuery },
    { sort: { createdAt: -1 }, projection: { options: 1, visibility: 1, partnerMode: 1, friendly: 1, snapshot: 1 } }
  );
  if (!doc) return null;
  return {
    options: doc.options || null,
    visibility: doc.visibility || null,
    partnerMode: doc.partnerMode || null,
    // Whatever was true of the last game at the moment it was created — which,
    // if that one had robots at it, was forced on regardless of what was
    // ticked. A stale "friendly" default after a one-off practice game is a
    // minor annoyance next to the alternative of not remembering the setting
    // at all.
    friendly: Boolean(doc.friendly),
    gameSettings: doc.snapshot?.gameSettings || null,
  };
}

// Head-to-head records are derived from finished games rather than kept as a
// running tally, so they're always consistent with the games themselves and
// nothing needs backfilling. Only games that actually reached 500 or the back
// door count — one abandoned half way through is neither a win nor a loss.

// Every opponent this player has finished a game against, most-played first.
// Two-player games only: a head-to-head record has no meaning across a table of
// four, and games saved before the four-player one existed have no mode field.
async function recordsForUser(userId) {
  const finished = await games
    .find({ status: "finished", "playerSlots.userId": userId, mode: { $ne: 4 } })
    .project({ playerSlots: 1, winner: 1 })
    .toArray();

  const byOpponent = new Map();
  for (const game of finished) {
    const opponent = (game.playerSlots || []).find((s) => s && s.userId !== userId);
    if (!opponent) continue;
    if (!byOpponent.has(opponent.userId)) {
      byOpponent.set(opponent.userId, {
        opponentId: opponent.userId,
        opponentName: opponent.name,
        wins: 0,
        losses: 0,
      });
    }
    const record = byOpponent.get(opponent.userId);
    // A game can only be finished by someone winning, so anything that isn't a
    // win for this player is a loss.
    if (game.winner?.id === userId) record.wins += 1;
    else record.losses += 1;
    // Names can change; the most recent game wins.
    record.opponentName = opponent.name;
  }

  return [...byOpponent.values()].sort(
    (a, b) => b.wins + b.losses - (a.wins + a.losses)
  );
}

// ---- rounds and ratings ----

async function recordRound(round) {
  await rounds.insertOne({ _id: crypto.randomUUID(), ...round });
}

// Every round this player bought the contract for, at this size of table.
async function roundsBidBy(userId, mode) {
  const modeQuery = mode === 4 ? { mode: 4 } : { mode: { $ne: 4 } };
  return rounds.find({ bidderUserId: userId, ...modeQuery }).toArray();
}

// Elo, one rating per size of table. Winners take from losers in proportion to
// how surprising the result was; a partnership is rated by its average, and both
// partners move by the same amount.
//
// Games against robots don't count — beating a robot says nothing about how you
// stack up against people, and the robot has no rating to take it from.
const K_FACTOR = 24;
const STARTING_ELO = 1200;

const eloOf = (user, mode) => user?.elo?.[String(mode)] ?? STARTING_ELO;

async function applyElo(mode, winnerIds, loserIds, gameId) {
  const everyone = [...winnerIds, ...loserIds];
  if (everyone.some((id) => String(id).startsWith("bot:"))) return null;

  // Guards against a game being rated twice — a server restart replaying the
  // tail of a finished game, say.
  const claimed = await games.updateOne(
    { _id: gameId, eloApplied: { $ne: true } },
    { $set: { eloApplied: true } }
  );
  if (claimed.matchedCount === 0) return null;

  const docs = await users.find({ _id: { $in: everyone } }).toArray();
  const byId = new Map(docs.map((u) => [u._id, u]));
  if (everyone.some((id) => !byId.has(id))) return null;

  const average = (ids) => ids.reduce((sum, id) => sum + eloOf(byId.get(id), mode), 0) / ids.length;
  const winnerRating = average(winnerIds);
  const loserRating = average(loserIds);
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  const delta = Math.round(K_FACTOR * (1 - expected));

  const field = `elo.${mode}`;
  await Promise.all([
    ...winnerIds.map((id) =>
      users.updateOne({ _id: id }, { $set: { [field]: eloOf(byId.get(id), mode) + delta } })
    ),
    ...loserIds.map((id) =>
      users.updateOne({ _id: id }, { $set: { [field]: eloOf(byId.get(id), mode) - delta } })
    ),
  ]);
  return delta;
}

async function eloForUser(userId) {
  const user = await users.findOne({ _id: userId }, { projection: { elo: 1 } });
  return { 2: eloOf(user, 2), 4: eloOf(user, 4) };
}

// Every finished game this player was in, at this size of table — the raw
// material for win rates and records, assembled into shape by the caller.
async function finishedGamesForUser(userId, mode) {
  const modeQuery = mode === 4 ? { mode: 4 } : { mode: { $ne: 4 } };
  return games
    .find({ status: "finished", "playerSlots.userId": userId, ...modeQuery })
    .project({ playerSlots: 1, winner: 1, snapshot: 1, mode: 1, updatedAt: 1 })
    .toArray();
}

// Just the two players, for the game-over screen.
async function headToHead(userIdA, userIdB) {
  const finished = await games
    .find({
      status: "finished",
      "playerSlots.userId": { $all: [userIdA, userIdB] },
      mode: { $ne: 4 },
    })
    .project({ winner: 1 })
    .toArray();

  const wins = { [userIdA]: 0, [userIdB]: 0 };
  for (const game of finished) {
    if (game.winner && wins[game.winner.id] !== undefined) wins[game.winner.id] += 1;
  }
  return { wins, played: finished.length };
}

module.exports = {
  connect,
  createUser,
  findUserByName,
  findUserById,
  createGame,
  getGame,
  saveGame,
  deleteGame,
  listGamesForUser,
  listPublicWaitingGames,
  lastSettingsForUser,
  recordsForUser,
  headToHead,
  recordRound,
  roundsBidBy,
  applyElo,
  eloForUser,
  finishedGamesForUser,
};
