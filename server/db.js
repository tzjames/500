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

module.exports = {
  connect,
  createUser,
  findUserByName,
  findUserById,
  createGame,
  getGame,
  saveGame,
  listGamesForUser,
};
