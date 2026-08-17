const { MongoClient } = require("mongodb");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://root:password@localhost:27017/?authSource=admin";
const DB_NAME = "card-game-500";

let users = null;
let games = null;

async function connect() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection("users");
  games = db.collection("games");
  await users.createIndex({ nameLower: 1 }, { unique: true });
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

// Head-to-head records are derived from finished games rather than kept as a
// running tally, so they're always consistent with the games themselves and
// nothing needs backfilling. Only games that actually reached 500 or the back
// door count — one abandoned half way through is neither a win nor a loss.

// Every opponent this player has finished a game against, most-played first.
async function recordsForUser(userId) {
  const finished = await games
    .find({ status: "finished", "playerSlots.userId": userId })
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

// Just the two players, for the game-over screen.
async function headToHead(userIdA, userIdB) {
  const finished = await games
    .find({ status: "finished", "playerSlots.userId": { $all: [userIdA, userIdB] } })
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
  listGamesForUser,
  recordsForUser,
  headToHead,
};
