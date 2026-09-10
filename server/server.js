const express = require("express");
const http = require("http");
const crypto = require("crypto");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const auth = require("./auth");
const { RoomManager } = require("./room");
const { validEuchreSetup, sanitizeEuchreOptions } = require("./euchreOptions");
const { gameTypeOf, DEFAULT_GAME_TYPE } = require("./gameTypes");
const Presence = require("./presence");
const stats = require("./stats");
const { sanitizeOptions } = require("./gameOptions");
const { isFriendlyGame } = require("./friendly");
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

// 500 only ever seats two or four; the games added since name their own sizes.
const tableSize = (gameType, raw) =>
  gameType === DEFAULT_GAME_TYPE ? (Number(raw) === 4 ? 4 : 2) : Number(raw);

app.get("/api/games", auth.requireAuth, async (req, res) => {
  const gameType = gameTypeOf(req.query.game);
  const games = await db.listGamesForUser(req.user.userId, gameType);
  res.json(
    games.map((g) => ({
      id: g._id,
      gameType: gameTypeOf(g.gameType),
      variant: g.variant || null,
      mode: Number(g.mode) || 2,
      status: g.status,
      visibility: g.visibility || "private",
      friendly: isFriendlyGame(g),
      playerSlots: g.playerSlots || [],
      roundNumber: g.roundNumber,
      winner: g.winner,
      updatedAt: g.updatedAt,
    }))
  );
});

// What the chooser on the front page needs: how many games this player has on
// the go in each of them.
app.get("/api/game-summary", auth.requireAuth, async (req, res) => {
  res.json({ active: await db.activeGameCounts(req.user.userId) });
});

// Just enough to know which room screen to render — the game itself arrives
// over the socket once that screen has joined.
app.get("/api/games/:id/meta", auth.requireAuth, async (req, res) => {
  const game = await db.getGame(req.params.id);
  if (!game) return res.status(404).json({ error: "That game doesn't exist." });
  res.json({
    id: game._id,
    gameType: gameTypeOf(game.gameType),
    variant: game.variant || null,
    mode: Number(game.mode) || 2,
    status: game.status,
  });
});

// What this player chose last time at this size of table, so the new-game
// screen opens on their house rules rather than the defaults.
app.get("/api/game-defaults", auth.requireAuth, async (req, res) => {
  const gameType = gameTypeOf(req.query.game);
  const mode = tableSize(gameType, req.query.mode);
  res.json((await db.lastSettingsForUser(req.user.userId, mode, gameType)) || {});
});

app.get("/api/stats", auth.requireAuth, async (req, res) => {
  const gameType = gameTypeOf(req.query.game);
  const mode = tableSize(gameType, req.query.mode);
  const includeFriendly = req.query.includeFriendly === "1" || req.query.includeFriendly === "true";
  res.json(await stats.statsFor(req.user.userId, mode, includeFriendly, gameType));
});

// Win/loss against each opponent, derived from finished games. Not capped the
// way /api/games is — a record that only counted your last twenty games would
// be worse than none.
app.get("/api/record", auth.requireAuth, async (req, res) => {
  res.json(await db.recordsForUser(req.user.userId, gameTypeOf(req.query.game)));
});

app.post("/api/games", auth.requireAuth, async (req, res) => {
  const { mode: rawMode, visibility, options, partnerMode, fillWithBots, friendly, variant } = req.body || {};
  const gameType = gameTypeOf(req.body?.gameType);
  const euchre = gameType === "euchre" ? validEuchreSetup({ variant, mode: rawMode }) : null;
  // Both games seat robots the same way; Euchre just has no partner screen.
  const mode = euchre ? euchre.mode : Number(rawMode) === 4 ? 4 : 2;
  const host = { userId: req.user.userId, name: req.user.name };
  const seats = euchre ? euchre.seats : mode === 4 ? 4 : 2;
  const playerSlots = [host, ...Array(seats - 1).fill(null)];

  // Starting against robots fills the empty seats now, so the table is complete
  // the moment the host walks in and the game deals itself. This applies at
  // both table sizes — a two-player game gets one robot opponent, a
  // four-player game gets three. Partners are drawn rather than chosen in the
  // four-player case: picking between three identical robots isn't a
  // decision worth a screen.
  const seating = fillWithBots ? "random" : partnerMode === "random" ? "random" : "choose";
  const withBots = Boolean(fillWithBots);

  if (withBots) {
    const taken = [host.name];
    for (let seat = 1; seat < seats; seat++) {
      const name = bot.botName(seat, taken);
      taken.push(name);
      playerSlots[seat] = { userId: `bot:${crypto.randomUUID()}`, name, isBot: true };
    }
  }

  const game = await db.createGame({
    _id: crypto.randomUUID(),
    gameType,
    ...(euchre ? { variant: euchre.variant } : {}),
    mode,
    visibility: visibility === "public" ? "public" : "private",
    hostUserId: host.userId,
    // A robot at the table makes it friendly whatever was ticked — see
    // isFriendlyGame, which every reader of a game document re-derives this
    // same way rather than trusting a value that could go stale.
    friendly: Boolean(friendly) || withBots,
    ...(euchre
      ? { options: sanitizeEuchreOptions(options, euchre.variant) }
      : mode === 4
      ? { options: sanitizeOptions(options), partnerMode: seating }
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
  res.json({ id: game._id, gameType, variant: euchre?.variant || null, mode });
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../build")));

// The "catchall" handler: for any request that doesn't match one above, send
// back React's index.html file. Anything with a file extension got past the
// static middleware, so it is genuinely missing and gets a 404 — answering it
// with HTML and a 200 turns a browser holding a stale index.html into an
// unreadable script error instead of a plain missing-file.
app.get("*", (req, res) => {
  if (path.extname(req.path)) return res.sendStatus(404);
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
      socket.emit("euchre:joinRejected", { message: "That game doesn't exist." });
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
  socket.on("g4:declineBlind", () => room?.declineBlind?.(socket));
  socket.on("g4:discard", (payload) => room?.discard?.(socket, payload || {}));
  socket.on("g4:pass", (payload) => room?.passCards?.(socket, payload || {}));
  socket.on("g4:play", (payload) => room?.playCard?.(socket, payload || {}));
  socket.on("g4:claimRest", () => room?.claimRest?.(socket));
  socket.on("g4:respondToClaim", ({ accept }) => room?.respondToClaim?.(socket, accept));
  socket.on("g4:ready", () => room?.readyForNextRound?.(socket));
  socket.on("g4:setBlindIntent", ({ on }) => room?.setBlindIntent?.(socket, on));
  socket.on("g4:propose", ({ type }) => room?.propose?.(socket, type));
  socket.on("g4:respondToProposal", ({ accept }) => room?.respondToProposal?.(socket, accept));
  socket.on("g4:reviewStep", ({ index }) => room?.reviewStep?.(socket, index));
  socket.on("g4:reviewDone", () => room?.reviewDone?.(socket));
  socket.on("g4:endReplay", () => room?.endReplay?.(socket));
  socket.on("g4:rematchOffer", (payload) => room?.rematchOffer?.(socket, payload || {}));
  socket.on("g4:rematchRespond", ({ accept }) => room?.rematchRespond?.(socket, accept));
  socket.on("g4:setOptions", ({ options }) => room?.setOptions?.(socket, options));
  socket.on("g4:setVisibility", ({ visibility }) => room?.setVisibility?.(socket, visibility));
  socket.on("g4:setFriendly", ({ friendly }) => room?.setFriendly?.(socket, friendly));

  // ---- Euchre ----
  socket.on("euchre:blind", (payload) => room?.takeBlind?.(socket, payload || {}));
  socket.on("euchre:relief", (payload) => room?.claimRelief?.(socket, payload || {}));
  socket.on("euchre:pass", () => room?.pass?.(socket));
  socket.on("euchre:call", (payload) => room?.call?.(socket, payload || {}));
  socket.on("euchre:discard", (payload) => room?.discard?.(socket, payload || {}));
  socket.on("euchre:bid", (payload) => room?.bid?.(socket, payload || {}));
  socket.on("euchre:chooseTrump", (payload) => room?.chooseTrump?.(socket, payload || {}));
  socket.on("euchre:declare", (payload) => room?.declare?.(socket, payload || {}));
  socket.on("euchre:play", (payload) => room?.play?.(socket, payload || {}));
  socket.on("euchre:next", () => room?.nextRound?.(socket));
  socket.on("euchre:addBots", () => room?.addBots?.(socket));
  socket.on("euchre:setVisibility", ({ visibility }) => room?.setVisibility?.(socket, visibility));
  socket.on("euchre:setFriendly", ({ friendly }) => room?.setFriendly?.(socket, friendly));
  socket.on("euchre:setGameSettings", (settings) => room?.setGameSettings?.(socket, settings || {}));
  socket.on("euchre:propose", (payload) => room?.propose?.(socket, payload || {}));
  socket.on("euchre:respondToProposal", (payload) => room?.respondToProposal?.(socket, payload || {}));
  socket.on("euchre:reviewStep", (payload) => room?.reviewStep?.(socket, payload || {}));
  socket.on("euchre:reviewDone", () => room?.reviewDone?.(socket));
  socket.on("euchre:endReplay", () => room?.endReplay?.());

  socket.on("addBot", () => room?.addBot?.(socket));
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
