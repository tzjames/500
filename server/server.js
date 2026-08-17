const express = require("express");
const http = require("http");
const crypto = require("crypto");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const auth = require("./auth");
const { RoomManager } = require("./room");
const Presence = require("./presence");
const { sanitizeOptions } = require("./gameOptions");
const bot = require("./bot");

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
      mode: g.mode === 4 ? 4 : 2,
      status: g.status,
      visibility: g.visibility || "private",
      playerSlots: g.playerSlots,
      roundNumber: g.roundNumber,
      winner: g.winner,
      updatedAt: g.updatedAt,
    }))
  );
});

// Just enough to know which room screen to render — the game itself arrives
// over the socket once that screen has joined.
app.get("/api/games/:id/meta", auth.requireAuth, async (req, res) => {
  const game = await db.getGame(req.params.id);
  if (!game) return res.status(404).json({ error: "That game doesn't exist." });
  res.json({ id: game._id, mode: game.mode === 4 ? 4 : 2, status: game.status });
});

// What this player chose last time at this size of table, so the new-game
// screen opens on their house rules rather than the defaults.
app.get("/api/game-defaults", auth.requireAuth, async (req, res) => {
  const mode = Number(req.query.mode) === 4 ? 4 : 2;
  res.json((await db.lastSettingsForUser(req.user.userId, mode)) || {});
});

// Win/loss against each opponent, derived from finished games. Not capped the
// way /api/games is — a record that only counted your last twenty games would
// be worse than none.
app.get("/api/record", auth.requireAuth, async (req, res) => {
  res.json(await db.recordsForUser(req.user.userId));
});

app.post("/api/games", auth.requireAuth, async (req, res) => {
  const { mode: rawMode, visibility, options, partnerMode, fillWithBots } = req.body || {};
  const mode = Number(rawMode) === 4 ? 4 : 2;
  const host = { userId: req.user.userId, name: req.user.name };
  const seats = mode === 4 ? 4 : 2;
  const playerSlots = [host, ...Array(seats - 1).fill(null)];

  // Starting against robots fills the empty seats now, so the table is complete
  // the moment the host walks in and the game deals itself.
  if (mode === 4 && fillWithBots) {
    const taken = [host.name];
    for (let seat = 1; seat < seats; seat++) {
      const name = bot.botName(seat, taken);
      taken.push(name);
      playerSlots[seat] = { userId: `bot:${crypto.randomUUID()}`, name, isBot: true };
    }
  }

  const game = await db.createGame({
    _id: crypto.randomUUID(),
    mode,
    visibility: visibility === "public" ? "public" : "private",
    hostUserId: host.userId,
    ...(mode === 4
      ? { options: sanitizeOptions(options), partnerMode: partnerMode === "random" ? "random" : "choose" }
      : {}),
    status: "waiting",
    playerSlots,
    roundNumber: 1,
    scoreHistory: [],
    winner: null,
    log: [],
    snapshot: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  presence.touch();
  res.json({ id: game._id, mode });
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

const presence = new Presence(io);
const roomManager = new RoomManager(io, presence);
presence.roomManager = roomManager;

const PORT = process.env.PORT || 5001;

io.on("connection", (socket) => {
  let room = null;
  presence.add(socket);

  // Leaving a room, whether by navigating away or by dropping the connection.
  const leave = () => {
    if (!room) return;
    const left = room;
    socket.leave(left.id);
    left.handleDisconnect(socket);
    roomManager.scheduleCleanupIfAbandoned(left);
    room = null;
    presence.setGame(socket, null);
  };

  socket.on("joinRoom", async ({ gameId }) => {
    try {
      room = await roomManager.getOrCreate(gameId);
    } catch (err) {
      socket.emit("joinRejected", { message: "That game doesn't exist." });
      socket.emit("g4:joinRejected", { message: "That game doesn't exist." });
      return;
    }
    room.handleJoin(socket);
    presence.setGame(socket, gameId);
  });

  // Navigating away from a room (without disconnecting the socket, e.g. back
  // to the home page) shouldn't leave this player looking "connected" there.
  socket.on("leaveRoom", leave);

  // The home page watches the lobby: who's about, and which public tables are
  // short of players.
  socket.on("lobby:subscribe", () => {
    socket.join("lobby");
    presence.sendTo(socket).catch((err) => console.error("lobby send failed", err));
  });
  socket.on("lobby:unsubscribe", () => socket.leave("lobby"));

  // ---- four-player game ----

  socket.on("g4:addBots", () => room?.addBots?.(socket));
  socket.on("g4:choosePartner", (payload) => room?.choosePartner?.(socket, payload || {}));
  socket.on("g4:bid", (payload) => room?.placeBid?.(socket, payload || {}));
  socket.on("g4:discard", (payload) => room?.discard?.(socket, payload || {}));
  socket.on("g4:play", (payload) => room?.playCard?.(socket, payload || {}));
  socket.on("g4:ready", () => room?.readyForNextRound?.(socket));
  socket.on("g4:setOptions", ({ options }) => room?.setOptions?.(socket, options));
  socket.on("g4:setVisibility", ({ visibility }) => room?.setVisibility?.(socket, visibility));

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

  socket.on("disconnect", () => {
    leave();
    presence.remove(socket);
  });
});

async function init() {
  await db.connect();
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

init();
