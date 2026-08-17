const express = require("express");
const http = require("http");
const crypto = require("crypto");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const auth = require("./auth");
const { RoomManager } = require("./room");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/register", async (req, res) => {
  const { name, password } = req.body || {};
  if (!name?.trim() || !password) return res.status(400).json({ error: "Name and password are required." });
  if (await db.findUserByName(name.trim())) {
    return res.status(409).json({ error: "That name is already taken." });
  }
  const user = await db.createUser({
    id: crypto.randomUUID(),
    name: name.trim(),
    passwordHash: await auth.hashPassword(password),
  });
  res.json({ token: auth.signToken(user), user: { id: user._id, name: user.name } });
});

app.post("/api/login", async (req, res) => {
  const { name, password } = req.body || {};
  const user = name && (await db.findUserByName(name.trim()));
  if (!user || !(await auth.comparePassword(password || "", user.passwordHash))) {
    return res.status(401).json({ error: "Invalid name or password." });
  }
  res.json({ token: auth.signToken(user), user: { id: user._id, name: user.name } });
});

app.get("/api/games", auth.requireAuth, async (req, res) => {
  const games = await db.listGamesForUser(req.user.userId);
  res.json(
    games.map((g) => ({
      id: g._id,
      status: g.status,
      playerSlots: g.playerSlots,
      roundNumber: g.roundNumber,
      winner: g.winner,
      updatedAt: g.updatedAt,
    }))
  );
});

// Win/loss against each opponent, derived from finished games. Not capped the
// way /api/games is — a record that only counted your last twenty games would
// be worse than none.
app.get("/api/record", auth.requireAuth, async (req, res) => {
  res.json(await db.recordsForUser(req.user.userId));
});

app.post("/api/games", auth.requireAuth, async (req, res) => {
  const game = await db.createGame({
    _id: crypto.randomUUID(),
    status: "waiting",
    playerSlots: [{ userId: req.user.userId, name: req.user.name }, null],
    roundNumber: 1,
    scoreHistory: [],
    winner: null,
    log: [],
    snapshot: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  res.json({ id: game._id });
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../build")));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true,
  },
});
io.use(auth.socketAuth);

const roomManager = new RoomManager(io);

const PORT = process.env.PORT || 5001;

io.on("connection", (socket) => {
  let room = null;

  socket.on("joinRoom", async ({ gameId }) => {
    try {
      room = await roomManager.getOrCreate(gameId);
    } catch (err) {
      socket.emit("joinRejected", { message: "That game doesn't exist." });
      return;
    }
    room.handleJoin(socket);
  });

  // Navigating away from a room (without disconnecting the socket, e.g. back
  // to the home page) shouldn't leave this player looking "connected" there.
  socket.on("leaveRoom", () => {
    if (!room) return;
    socket.leave(room.id);
    room.handleDisconnect(socket);
    room = null;
  });

  socket.on("placeBid", (payload) => room?.placeBid(socket, payload));
  socket.on("setGameSettings", (settings) => room?.setGameSettings(socket, settings));
  socket.on("offerPass", () => room?.offerPass(socket));
  socket.on("offerRetroactivePass", () => room?.offerRetroactivePass(socket));
  socket.on("respondToOffer", ({ accept }) => room?.respondToOffer(socket, accept));
  socket.on("offerResign", () => room?.offerResign(socket));
  socket.on("offerRedeal", () => room?.offerRedeal(socket));
  socket.on("kittyDone", (payload) => room?.kittyDone(socket, payload));
  socket.on("playCard", (payload) => room?.playCard(socket, payload));
  socket.on("retractCard", () => room?.retractCard(socket));
  socket.on("roundEndReady", () => room?.roundEndReady(socket));
  socket.on("roundEndPropose", ({ type }) => room?.roundEndPropose(socket, type));
  socket.on("roundEndRespond", ({ accept }) => room?.roundEndRespond(socket, accept));
  socket.on("reviewStep", ({ index }) => room?.reviewStep(socket, index));
  socket.on("reviewDone", () => room?.reviewDone(socket));
  socket.on("rematchOffer", () => room?.rematchOffer(socket));
  socket.on("rematchRespond", ({ accept }) => room?.rematchRespond(socket, accept));
  socket.on("claimRest", () => room?.claimRest(socket));
  socket.on("respondToClaim", ({ accept }) => room?.respondToClaim(socket, accept));

  socket.on("disconnect", () => room?.handleDisconnect(socket));
});

async function init() {
  await db.connect();
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

init();
