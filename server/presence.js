const db = require("./db");

// Who's about, and which public tables are looking for players. Entirely
// in-memory and derived from live sockets — nothing here is worth persisting,
// and a server restart should show an empty house rather than a stale one.
//
// Everything funnels through touch(), which coalesces bursts (four people
// joining a table in the same second) into one broadcast.
class Presence {
  constructor(io) {
    this.io = io;
    this.roomManager = null;
    // socketId -> { userId, name, gameId }
    this.sockets = new Map();
    this.pending = null;
  }

  add(socket) {
    this.sockets.set(socket.id, { userId: socket.userId, name: socket.userName, gameId: null });
    this.touch();
  }

  remove(socket) {
    this.sockets.delete(socket.id);
    this.touch();
  }

  setGame(socket, gameId) {
    const entry = this.sockets.get(socket.id);
    if (entry) entry.gameId = gameId;
    this.touch();
  }

  // A game is "under way" once it has been dealt; before that it's a table
  // waiting for players, which is a different thing to report.
  gameIsUnderWay(gameId) {
    const room = this.roomManager?.rooms.get(gameId);
    return Boolean(room && room.status === "active");
  }

  stats() {
    const users = new Map();
    for (const entry of this.sockets.values()) {
      // One person on two tabs is one person; the tab that's at a table wins.
      const existing = users.get(entry.userId);
      if (!existing || (!existing.gameId && entry.gameId)) users.set(entry.userId, entry);
    }

    let playing = 0;
    const activeGames = new Set();
    for (const entry of users.values()) {
      if (entry.gameId && this.gameIsUnderWay(entry.gameId)) {
        playing += 1;
        activeGames.add(entry.gameId);
      }
    }

    return {
      online: users.size,
      playing,
      waiting: users.size - playing,
      games: activeGames.size,
    };
  }

  // Public tables that haven't started yet, with the seats they still need.
  // Only tables somebody is actually sitting at: a game created and then
  // abandoned before its page even connected would otherwise sit in the lobby
  // forever advertising a host who isn't there. The freshly-created ones get a
  // grace window so a host's own table doesn't flicker out from under them
  // between the create call and the socket joining.
  async openTables() {
    const docs = await db.listPublicWaitingGames();
    const now = Date.now();
    return docs
      .map((doc) => {
        const room = this.roomManager?.rooms.get(doc._id);
        const slots = room ? room.slots : doc.playerSlots || [];
        const filled = slots.filter(Boolean);
        return {
          id: doc._id,
          mode: doc.mode === 4 ? 4 : 2,
          hostName: (filled[0] || {}).name || "Someone",
          players: filled.map((s) => ({ name: s.name, isBot: Boolean(s.isBot) })),
          seatsTaken: filled.length,
          seats: doc.mode === 4 ? 4 : 2,
          options: doc.options || null,
          createdAt: doc.createdAt,
          present: room ? room.connectedHumans() > 0 : false,
          fresh: now - (doc.createdAt || 0) < 90_000,
        };
      })
      .filter((table) => table.seatsTaken < table.seats && (table.present || table.fresh));
  }

  // Anyone watching the home page gets the counts and the open tables. Sent to
  // a room rather than everyone, so people at a table aren't paying for it.
  touch() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.broadcast().catch((err) => console.error("lobby broadcast failed", err));
    }, 120);
  }

  async broadcast() {
    const payload = { presence: this.stats(), tables: await this.openTables() };
    this.io.to("lobby").emit("lobbyState", payload);
  }

  async sendTo(socket) {
    socket.emit("lobbyState", { presence: this.stats(), tables: await this.openTables() });
  }
}

module.exports = Presence;
