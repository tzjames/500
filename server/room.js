const crypto = require("crypto");
const Game500 = require("./gameLogic");
const { checkBidMade, bidInfo } = Game500;
const db = require("./db");
const { Room4 } = require("./room4");
const { isFriendlyGame } = require("./friendly");
const bot2 = require("./bot2");
// The robot names are the same list either game draws from; only the play is
// game-specific.
const { botName } = require("./bot");

// How long a robot appears to think, and how often the watcher below looks to
// see whether it owes the table a move.
const BOT_PAUSE = 800;

const REAL_SUITS = ["♠", "♣", "♥", "♦"];

// Mirrors of the client's theme registry (src/theme.js), kept here only to
// reject junk before it reaches the shared, persisted gameSettings.
const LOCATION_IDS = [
  "falls",
  "zanzibar",
  "samana",
  "canyon",
  "sierras",
  "serengeti",
  // The same palettes without their backdrop photograph.
  "plain-falls",
  "plain-zanzibar",
  "plain-samana",
  "plain-canyon",
  "plain-sierras",
  "plain-serengeti",
];
const DECK_IDS = ["traveller", "classic"];
const FELT_IDS = ["solid", "faded", "hidden"];

// One Room per game document. Player identity is the account's userId (stable
// forever), never a socket id — reconnecting is just "does this userId already
// own a slot here," so there's no name-matching or pending-restore guesswork.
class Room {
  constructor(id, io, doc) {
    this.id = id;
    this.io = io;
    this.mode = 2;
    // Only read, never written here: the lobby and the abandoned-table sweep
    // need to know whether this game was advertised publicly. persist() sets a
    // fixed list of fields, so the document's own value survives untouched.
    this.visibility = doc.visibility === "public" ? "public" : "private";
    // Set once at creation and never changed after, like visibility above. It
    // isn't the whole answer though: isFriendly() below also forces a table with
    // a robot at it to be unrated, so nobody's Elo moves for beating one.
    this.friendly = Boolean(doc.friendly);
    this.slots = (doc.playerSlots || [null, null]).map((s) => (s ? { ...s, socketId: null } : null));
    this.status = doc.status || "waiting";
    this.roundNumber = doc.roundNumber || 1;
    this.scoreHistory = doc.scoreHistory || [];
    this.winner = doc.winner || null;
    this.log = doc.log || [];

    const snap = doc.snapshot || {};
    this.gamePhase = snap.gamePhase || "waiting";
    this.currentBidder = snap.currentBidder || null;
    this.biddingHistory = snap.biddingHistory || [];
    // Room-wide, not per-user: both players always look at the same table, so
    // the location/deck theme rides along with the existing offer-button
    // settings on the same broadcast-and-persist path. Games saved before
    // theming existed have no location/deck keys, so default them here rather
    // than only in the `||` branch above.
    this.gameSettings = {
      showOfferPassButton: true,
      showOfferRetroactivePassButton: true,
      location: "falls",
      deck: "traveller",
      felt: "faded",
      ...(snap.gameSettings || {}),
    };
    this.offerPassDeclined = snap.offerPassDeclined || false;
    this.offerRetroactivePassDeclined = snap.offerRetroactivePassDeclined || false;
    this.pendingOffer = snap.pendingOffer || null;
    // "I've got the rest": pendingClaim is the ephemeral yes/no negotiation
    // (like pendingOffer, not resent on reconnect); revealedClaimerId is the
    // persistent consolation prize when it's declined — the claimer's hand
    // and dummy stay visible to the other player for the rest of the round.
    this.pendingClaim = snap.pendingClaim || null;
    this.revealedClaimerId = snap.revealedClaimerId || null;
    this.reviewControllerId = snap.reviewControllerId || null;
    this.reviewStepIndex = snap.reviewStepIndex || 0;
    // The "roundResult" event (bid made/missed, points swing) is otherwise a
    // one-off broadcast fired once from finishRound() — persisted here too so
    // a reconnect while sitting on the round-end screen can resend it; without
    // it the Round Complete modal's data never comes back after a refresh.
    this.lastRoundResult = snap.lastRoundResult || null;
    // The most recently resolved trick — cards, who played each, who won —
    // kept for the "Last trick" panel. resolveTrick() clears the live trick,
    // so without stashing it here there'd be nothing left to show. Persisted
    // so the panel survives a reconnect mid-round.
    this.lastTrick = snap.lastTrick || null;
    // How many times everyone has passed and redealt within the current
    // round number — reset once real dealing (a new round or a new game)
    // happens, not by the redeal itself, so it climbs across repeats.
    this.redealCount = snap.redealCount || 0;
    this.roundEnd = snap.roundEnd
      ? { readyUserIds: new Set(snap.roundEnd.readyUserIds), proposal: snap.roundEnd.proposal }
      : null;
    // Games finished before "Review/Replay last hand" existed were persisted
    // without a roundEnd slot at all — backfill it so those old games gain
    // the same review/replay proposal ability on next load.
    if (!this.roundEnd && this.gamePhase === "gameOver") {
      this.roundEnd = { readyUserIds: new Set(), proposal: null };
    }
    this.game = snap.game ? this.hydrateGame(snap.game) : null;

    // Same backfill idea as roundEnd above, one level deeper: a game already
    // sitting in roundEnd/gameOver from before lastRoundResult started being
    // persisted has no way to get it back except reconstructing it from the
    // round's own "result" log entry plus the bid still sitting on the game.
    if (!this.lastRoundResult && (this.gamePhase === "roundEnd" || this.gamePhase === "gameOver") && this.game) {
      const resultEntry = [...this.log].reverse().find((e) => e.type === "result" && e.round === this.roundNumber);
      if (resultEntry && this.game.currentBid) {
        const otherId = this.game.players.find((p) => p.id !== resultEntry.bidderId)?.id;
        this.lastRoundResult = {
          bid: this.game.currentBid.bid,
          bidderName: this.nameOf(resultEntry.bidderId),
          bidderMadeBid: resultEntry.bidderMadeBid,
          bidderDelta: resultEntry.bidderDelta,
          otherName: this.nameOf(otherId),
          otherDelta: resultEntry.otherDelta,
        };
      }
    }

    // A replay is a live, in-memory-only side game — never persisted, so a
    // server restart mid-replay simply abandons it (players land back on the
    // round-end screen next time they load the room).
    this.replayGame = null;
    this.replayDummyHands = null;
    // Post-game-over rematch negotiation — ephemeral, like a replay, since a
    // finished game's room is a dead end either way once it's abandoned.
    this.rematchProposal = null;
  }

  // ---- persistence ----

  hydrateGame(snap) {
    const g = new Game500();
    g.players = snap.players;
    g.currentBid = snap.currentBid;
    g.trumpSuit = snap.trumpSuit;
    g.currentTrick = snap.currentTrick || [];
    g.playedCards = snap.playedCards || [];
    g.kitty = snap.kitty || null;
    g.deck = snap.deck || [];
    g.seats = snap.seats || null;
    g.currentSeatIndex = snap.currentSeatIndex || 0;
    g.currentPlayer = snap.currentPlayer || null;
    g.exposed = snap.exposed || {};
    return g;
  }

  serializeGame() {
    if (!this.game) return null;
    const g = this.game;
    return {
      players: g.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        dummyHand: p.dummyHand,
        score: p.score,
        isDealer: p.isDealer,
        tricksWon: p.tricksWon,
      })),
      currentBid: g.currentBid,
      trumpSuit: g.trumpSuit,
      currentTrick: g.currentTrick,
      playedCards: g.playedCards,
      kitty: g.kitty,
      deck: g.deck,
      seats: g.seats,
      currentSeatIndex: g.currentSeatIndex,
      currentPlayer: g.currentPlayer,
      exposed: g.exposed,
    };
  }

  persist() {
    const snapshot = {
      gamePhase: this.gamePhase,
      currentBidder: this.currentBidder,
      biddingHistory: this.biddingHistory,
      gameSettings: this.gameSettings,
      offerPassDeclined: this.offerPassDeclined,
      offerRetroactivePassDeclined: this.offerRetroactivePassDeclined,
      pendingOffer: this.pendingOffer,
      pendingClaim: this.pendingClaim,
      revealedClaimerId: this.revealedClaimerId,
      reviewControllerId: this.reviewControllerId,
      reviewStepIndex: this.reviewStepIndex,
      lastRoundResult: this.lastRoundResult,
      lastTrick: this.lastTrick,
      redealCount: this.redealCount,
      roundEnd: this.roundEnd
        ? { readyUserIds: [...this.roundEnd.readyUserIds], proposal: this.roundEnd.proposal }
        : null,
      game: this.serializeGame(),
    };
    // Returned so callers that need the write to have landed can wait on it —
    // the head-to-head after a game over has to include the game just won.
    return db.saveGame(this.id, {
      status: this.status,
      // isBot rides along because friendly.js reads it straight off the
      // persisted slots to decide the game isn't rated, and because a reload
      // has to find the robot still sitting there.
      playerSlots: this.slots.map((s) =>
        s ? { userId: s.userId, name: s.name, isBot: Boolean(s.isBot) } : null
      ),
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      log: this.log,
      snapshot,
    });
  }

  // ---- small helpers ----

  // Wins each way between these two players across every finished game,
  // including the one just decided. Best-effort: a failure here costs the
  // game-over screen a line, and shouldn't take the room down with it.
  async emitMatchRecord() {
    const [a, b] = this.slots;
    if (!a || !b) return;
    try {
      const { wins, played } = await db.headToHead(a.userId, b.userId);
      this.io.to(this.id).emit("matchRecord", {
        played,
        players: [
          { id: a.userId, name: a.name, wins: wins[a.userId] || 0 },
          { id: b.userId, name: b.name, wins: wins[b.userId] || 0 },
        ],
      });
    } catch (err) {
      console.error("head-to-head lookup failed", err);
    }
  }

  nameOf(userId) {
    return (
      this.slots.find((s) => s && s.userId === userId)?.name ||
      this.game?.players.find((p) => p.id === userId)?.name ||
      "Unknown"
    );
  }

  otherPlayerId(userId) {
    return this.game.players.find((p) => p.id !== userId)?.id;
  }

  emitToUser(userId, event, payload) {
    const slot = this.slots.find((s) => s && s.userId === userId);
    if (slot?.socketId) this.io.to(slot.socketId).emit(event, payload);
  }

  logEvent(type, payload) {
    const entry = { seq: this.log.length, round: this.roundNumber, type, ts: Date.now(), ...payload };
    this.log.push(entry);
    return entry;
  }

  // Robots don't count: a table sitting there with nobody but a robot at it is
  // an empty table, for the lobby's presence dot and for the abandoned-table
  // cleanup alike.
  connectedHumans() {
    return this.humanSlots().filter((s) => s.socketId).length;
  }

  isFriendly() {
    return isFriendlyGame({ friendly: this.friendly, playerSlots: this.slots });
  }

  broadcastPlayersUpdate() {
    const connected = this.connectedHumans();
    this.io.to(this.id).emit("playersUpdate", {
      count: connected,
      players: this.slots.filter(Boolean).map((s) => ({ name: s.name })),
    });
  }

  gameStartPayload(dealData) {
    return {
      players: this.game.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        isDealer: p.isDealer,
        score: p.score,
        tricksWon: p.tricksWon,
      })),
      currentBid: null,
      trumpSuit: null,
      dealerId: dealData.dealerId,
      currentBidder: this.currentBidder,
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      gameSettings: this.gameSettings,
      offerPassDeclined: this.offerPassDeclined,
      offerRetroactivePassDeclined: this.offerRetroactivePassDeclined,
      redealCount: this.redealCount,
      friendly: this.isFriendly(),
    };
  }

  // Copies each hand array rather than referencing it — the log entry must
  // stay a frozen snapshot even after this same array is later spliced by
  // card plays (the non-bidder's hand array, in particular, is never
  // reassigned during the round, so without a copy this "historical" record
  // would silently shrink in lockstep with their live hand).
  dealHandsLogPayload(dealerId) {
    return { dealerId, hands: Object.fromEntries(this.game.players.map((p) => [p.id, [...p.hand]])) };
  }

  // ---- joining / reconnecting ----

  handleJoin(socket) {
    const userId = socket.userId;
    const name = socket.userName;
    let slotIndex = this.slots.findIndex((s) => s && s.userId === userId);
    const isReconnect = slotIndex !== -1;

    if (!isReconnect) {
      slotIndex = this.slots.findIndex((s) => s === null);
      if (slotIndex === -1) {
        socket.emit("joinRejected", { message: "This game already has two players." });
        return;
      }
      this.slots[slotIndex] = { userId, name, socketId: socket.id };
    } else {
      this.slots[slotIndex].socketId = socket.id;
      this.slots[slotIndex].name = name;
    }

    socket.join(this.id);
    this.status = this.slots.every(Boolean) ? (this.status === "finished" ? "finished" : "active") : "waiting";
    this.broadcastPlayersUpdate();
    this.persist();

    // Not gated on `!isReconnect`: a rematch game is created with both slots
    // already claimed (we already know both userIds), so the *first* of the
    // two to actually connect looks like a "reconnect" by this same check —
    // `!this.game` is what actually distinguishes "never dealt yet" here.
    if (this.slots.every(Boolean) && !this.game) {
      this.startGame();
      return;
    }

    if (this.game) this.sendResumedState(socket);
    // A reconnect has to restart the watcher: it stops itself when the last
    // human leaves, so without this a reload would leave the robot frozen.
    this.scheduleBotTurn();
  }

  handleDisconnect(socket) {
    const slot = this.slots.find((s) => s && s.socketId === socket.id);
    if (slot) slot.socketId = null;
    this.broadcastPlayersUpdate();
  }

  sendResumedState(socket) {
    const currentSeat = this.game.getCurrentSeat();
    socket.emit("gameResumed", {
      players: this.game.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        dummyHand: p.dummyHand,
        isDealer: p.isDealer,
        score: p.score,
        tricksWon: p.tricksWon,
      })),
      dealerId: this.game.players.find((p) => p.isDealer)?.id || null,
      currentBid: this.game.currentBid,
      trumpSuit: this.game.trumpSuit,
      currentBidder: this.currentBidder,
      biddingHistory: this.biddingHistory,
      gamePhase: this.gamePhase,
      currentPlayer: this.game.currentPlayer,
      currentIsDummy: currentSeat ? currentSeat.isDummy : false,
      playedCards: this.game.currentTrick,
      lastTrick: this.lastTrick,
      exposed: this.game.exposed || {},
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      gameSettings: this.gameSettings,
      offerPassDeclined: this.offerPassDeclined,
      offerRetroactivePassDeclined: this.offerRetroactivePassDeclined,
      revealedClaimerId: this.revealedClaimerId,
      pendingClaim: this.pendingClaim
        ? { fromPlayerId: this.pendingClaim.fromPlayerId, fromName: this.nameOf(this.pendingClaim.fromPlayerId) }
        : null,
      // Resent on reconnect, like the claim above. It used to be dropped here,
      // which meant a recipient who reloaded lost the prompt for good while the
      // server went on believing an offer was outstanding.
      pendingOffer: this.pendingOffer
        ? {
            type: this.pendingOffer.type,
            fromPlayerId: this.pendingOffer.fromPlayerId,
            fromName: this.nameOf(this.pendingOffer.fromPlayerId),
          }
        : null,
      roundResult: this.lastRoundResult,
      redealCount: this.redealCount,
      friendly: this.isFriendly(),
    });

    if (this.gamePhase === "kitty" && this.game.currentBid?.player === socket.userId) {
      socket.emit("showKitty", this.game.kitty);
    }
    if ((this.gamePhase === "roundEnd" || this.gamePhase === "gameOver") && this.roundEnd) {
      socket.emit("roundEndState", this.roundEndStatePayload());
    }
    if (this.gamePhase === "review") {
      socket.emit("reviewStart", {
        round: this.roundNumber,
        log: this.log.filter((e) => e.round === this.roundNumber),
        controllerId: this.reviewControllerId,
        stepIndex: this.reviewStepIndex,
      });
    }
    if (this.gamePhase === "replay" && this.replayGame) {
      this.sendReplayResumedState(socket);
    }
    if (this.gamePhase === "gameOver" && this.winner) {
      socket.emit("gameOver", {
        winner: this.winner,
        players: this.game.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
        scoreHistory: this.scoreHistory,
      });
    }
  }

  sendReplayResumedState(socket) {
    const rg = this.replayGame;
    const seat = rg.getCurrentSeat();
    socket.emit("replayStart", {
      players: rg.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        dummyHand: p.dummyHand,
        isDealer: false,
        score: 0,
        tricksWon: p.tricksWon,
      })),
      currentBid: rg.currentBid,
      trumpSuit: rg.trumpSuit,
    });
    if (rg.seats) {
      socket.emit("replayKittyPhaseComplete", {
        winningBidder: rg.currentBid.player,
        currentPlayer: rg.currentPlayer,
        currentIsDummy: seat?.isDummy || false,
        players: rg.players.map((p) => ({ id: p.id, dummyHand: p.dummyHand, tricksWon: p.tricksWon })),
        playedCards: rg.currentTrick,
      });
    } else if (rg.currentBid.player === socket.userId) {
      socket.emit("replayShowKitty", rg.kitty);
    }
  }

  // ---- starting / dealing ----

  startGame() {
    this.game = new Game500();
    const [a, b] = this.slots;
    this.game.players[0].id = a.userId;
    this.game.players[0].name = a.name;
    this.game.players[1].id = b.userId;
    this.game.players[1].name = b.name;

    const dealData = this.game.startGame();
    this.roundNumber = 1;
    this.scoreHistory = [];
    this.currentBidder = this.game.players.find((p) => p.id !== dealData.dealerId).id;
    this.biddingHistory = [];
    this.offerPassDeclined = false;
    this.offerRetroactivePassDeclined = false;
    this.pendingClaim = null;
    this.pendingOffer = null;
    this.revealedClaimerId = null;
    this.lastRoundResult = null;
    this.lastTrick = null;
    this.redealCount = 0;
    this.gamePhase = "bidding";
    this.scheduleBotTurn();

    this.logEvent("deal", this.dealHandsLogPayload(dealData.dealerId));
    this.io.to(this.id).emit("gameStart", this.gameStartPayload(dealData));
    this.io.to(this.id).emit("updateGamePhase", "bidding");
    this.persist();
  }

  dealNextRound() {
    this.roundEnd = null;
    const previousDealerIndex = this.game.players.findIndex((p) => p.isDealer);
    const nextDealerIndex = previousDealerIndex === 0 ? 1 : 0;
    this.roundNumber += 1;

    const dealData = this.game.redeal(nextDealerIndex);
    this.currentBidder = this.game.players.find((p) => p.id !== dealData.dealerId).id;
    this.biddingHistory = [];
    this.offerPassDeclined = false;
    this.offerRetroactivePassDeclined = false;
    this.pendingClaim = null;
    this.pendingOffer = null;
    this.revealedClaimerId = null;
    this.lastRoundResult = null;
    this.lastTrick = null;
    this.redealCount = 0;
    this.gamePhase = "bidding";
    this.scheduleBotTurn();

    this.logEvent("deal", this.dealHandsLogPayload(dealData.dealerId));
    this.io.to(this.id).emit("gameStart", this.gameStartPayload(dealData));
    this.io.to(this.id).emit("updateGamePhase", "bidding");
    this.persist();
  }

  // Deal the same round again with the same dealer, because it never counted:
  // either everyone passed, or both players agreed to abandon it. `logType`
  // records which, so the review can tell them apart.
  redealAllPassed(logType = "allPassed") {
    const dealerIndex = this.game.players.findIndex((p) => p.isDealer);
    const dealData = this.game.redeal(dealerIndex);
    this.currentBidder = this.game.players.find((p) => p.id !== dealData.dealerId).id;
    this.biddingHistory = [];
    this.offerPassDeclined = false;
    this.offerRetroactivePassDeclined = false;
    this.pendingClaim = null;
    this.pendingOffer = null;
    this.revealedClaimerId = null;
    this.lastRoundResult = null;
    this.lastTrick = null;
    this.redealCount += 1;
    this.gamePhase = "bidding";
    this.scheduleBotTurn();

    this.logEvent(logType, {});
    this.logEvent("deal", this.dealHandsLogPayload(dealData.dealerId));
    this.io.to(this.id).emit("gameStart", this.gameStartPayload(dealData));
    this.io.to(this.id).emit("updateGamePhase", "bidding");
    this.persist();
  }

  // ---- bidding ----

  placeBid(socket, { bid, points }) {
    if (!this.game || socket.userId !== this.currentBidder) return;
    const newBid = { player: socket.userId, bid, points };
    this.biddingHistory.push(newBid);
    this.logEvent("bid", { userId: socket.userId, bid, points });

    if (bid === "Pass") {
      const winningBid = this.biddingHistory.filter((b) => b.bid !== "Pass").pop();
      if (winningBid) {
        this.completeBidding(winningBid);
      } else if (this.biddingHistory.length < this.game.players.length) {
        this.currentBidder = this.otherPlayerId(socket.userId);
        this.io.to(this.id).emit("updateGame", {
          currentBid: null,
          currentBidder: this.currentBidder,
          biddingHistory: this.biddingHistory,
        });
        this.persist();
      } else {
        this.io.to(this.id).emit("allPlayersPassed");
        this.redealAllPassed();
      }
    } else {
      const otherId = this.otherPlayerId(socket.userId);
      const otherHasPassed = this.biddingHistory.some((b) => b.player === otherId && b.bid === "Pass");
      if (otherHasPassed) {
        this.completeBidding(newBid);
      } else {
        this.game.currentBid = newBid;
        this.currentBidder = otherId;
        this.io.to(this.id).emit("updateGame", {
          currentBid: this.game.currentBid,
          currentBidder: this.currentBidder,
          biddingHistory: this.biddingHistory,
        });
        this.persist();
      }
    }
  }

  completeBidding(winningBid) {
    this.game.currentBid = winningBid;
    const suit = winningBid.bid.split(" ")[1];
    this.game.trumpSuit = REAL_SUITS.includes(suit) ? suit : null;
    this.gamePhase = "kitty";
    const kitty = this.game.dealKitty();

    this.logEvent("bidWon", {
      userId: winningBid.player,
      bid: winningBid.bid,
      points: winningBid.points,
      trumpSuit: this.game.trumpSuit,
    });
    this.logEvent("kittyDealt", { kitty: [...kitty] });

    this.io.to(this.id).emit("biddingComplete", winningBid, this.biddingHistory, this.game.trumpSuit);
    this.emitToUser(winningBid.player, "showKitty", kitty);
    this.persist();
  }

  setGameSettings(socket, settings) {
    const next = { ...this.gameSettings };
    if (typeof settings.showOfferPassButton === "boolean") {
      next.showOfferPassButton = settings.showOfferPassButton;
    }
    if (typeof settings.showOfferRetroactivePassButton === "boolean") {
      next.showOfferRetroactivePassButton = settings.showOfferRetroactivePassButton;
    }
    // Themes are picked from a fixed list on the client, so anything else is
    // either a stale client or hand-crafted — drop it rather than persist a
    // value that would render as an unstyled table for both players.
    if (LOCATION_IDS.includes(settings.location)) next.location = settings.location;
    if (DECK_IDS.includes(settings.deck)) next.deck = settings.deck;
    if (FELT_IDS.includes(settings.felt)) next.felt = settings.felt;

    this.gameSettings = next;
    this.io.to(this.id).emit("gameSettingsUpdated", this.gameSettings);
    // Theme changes can happen long after the last move, so this settle needs
    // its own save — nothing else is going to persist it.
    this.persist();
  }

  offerPass(socket) {
    if (!this.game || socket.userId !== this.currentBidder || this.biddingHistory.length !== 0) return;
    if (!this.gameSettings.showOfferPassButton || this.offerPassDeclined) return;
    const recipientId = this.otherPlayerId(socket.userId);
    this.pendingOffer = { type: "pass", fromPlayerId: socket.userId };
    this.emitToUser(recipientId, "offerReceived", { type: "pass", fromName: this.nameOf(socket.userId) });
  }

  offerRetroactivePass(socket) {
    if (!this.game || socket.userId !== this.currentBidder || this.biddingHistory.length === 0) return;
    if (!this.gameSettings.showOfferRetroactivePassButton || this.offerRetroactivePassDeclined) return;
    const recipientId = this.otherPlayerId(socket.userId);
    this.pendingOffer = { type: "retroactivePass", fromPlayerId: socket.userId };
    this.emitToUser(recipientId, "offerReceived", {
      type: "retroactivePass",
      fromName: this.nameOf(socket.userId),
    });
  }

  // Give up the hand. Offered from the play screen by either player: the
  // bidder conceding they can't make it, or the other player conceding they
  // can't stop it. Needs the opponent to agree, like every other offer here.
  offerResign(socket) {
    if (!this.game || this.gamePhase !== "playing" || !this.game.currentBid) return;
    if (this.pendingClaim) return;
    this.pendingOffer = { type: "resign", fromPlayerId: socket.userId };
    this.emitToUser(this.otherPlayerId(socket.userId), "offerReceived", {
      type: "resign",
      fromName: this.nameOf(socket.userId),
    });
  }

  // Throw the hand in and deal it again, scoring nothing. Play only: during
  // bidding there's already "offer a pass", which redeals by the route the
  // auction expects, and two ways to do nearly the same thing on one screen
  // was more confusing than useful.
  offerRedeal(socket) {
    if (!this.game || this.gamePhase !== "playing") return;
    if (this.pendingClaim) return;
    this.pendingOffer = { type: "redeal", fromPlayerId: socket.userId };
    this.emitToUser(this.otherPlayerId(socket.userId), "offerReceived", {
      type: "redeal",
      fromName: this.nameOf(socket.userId),
    });
  }

  // The contract is settled against whoever gave up: the bidder resigning
  // fails it, the other player resigning concedes it. Trick counts are left
  // as they stand, so the non-bidder's ten-a-trick still reflects what they
  // actually won. Deciding it this way rather than by awarding the remaining
  // tricks is what makes it work for Misère too, where the bidder wants none.
  resignRound(resignerId) {
    const bidderId = this.game.currentBid.player;
    this.game.players.forEach((p) => {
      p.hand = [];
      p.dummyHand = [];
    });
    this.game.currentTrick = [];
    this.logEvent("resign", { userId: resignerId });
    this.io.to(this.id).emit("roundResigned", {
      byName: this.nameOf(resignerId),
      byId: resignerId,
    });
    this.finishRound(resignerId !== bidderId);
  }

  respondToOffer(socket, accept) {
    if (!this.game || !this.pendingOffer || socket.userId === this.pendingOffer.fromPlayerId) return;
    const offer = this.pendingOffer;
    this.pendingOffer = null;

    if (accept) {
      if (offer.type === "resign") {
        this.resignRound(offer.fromPlayerId);
        return;
      }
      if (offer.type === "redeal") {
        this.redealAllPassed("redealAgreed");
        return;
      }
      this.io.to(this.id).emit("allPlayersPassed");
      this.redealAllPassed();
      return;
    }

    // Only the two bidding offers get a "don't ask again" flag; resign and
    // redeal can be offered as often as you like.
    if (offer.type === "resign" || offer.type === "redeal") {
      this.emitToUser(offer.fromPlayerId, "offerDeclined", {
        byName: this.nameOf(socket.userId),
        offerType: offer.type,
      });
      return;
    }

    if (offer.type === "pass") this.offerPassDeclined = true;
    else this.offerRetroactivePassDeclined = true;
    this.emitToUser(offer.fromPlayerId, "offerDeclined", {
      byName: this.nameOf(socket.userId),
      offerType: offer.type,
    });
    this.io.to(this.id).emit("offerFlagsUpdate", {
      offerPassDeclined: this.offerPassDeclined,
      offerRetroactivePassDeclined: this.offerRetroactivePassDeclined,
    });
    this.persist();
  }

  // ---- kitty / play (shared by live play and replay via `mode`) ----

  kittyDone(socket, { newHand, mode }) {
    const activeGame = mode === "replay" ? this.replayGame : this.game;
    if (!activeGame) return;
    const winningPlayer = activeGame.players.find((p) => p.id === socket.userId);
    if (!winningPlayer) return;

    if (mode !== "replay") {
      const combined = [...winningPlayer.hand, ...activeGame.kitty];
      // Validate: the new hand must be exactly the combined hand minus 3 cards.
      if (combined.length !== 13 || newHand.length !== 10) {
        console.error("kittyDone: invalid hand sizes", { startHand: winningPlayer.hand.length, kitty: activeGame.kitty.length, newHand: newHand.length });
        return;
      }
      const discarded = combined.filter((c) => !newHand.some((h) => h.suit === c.suit && h.value === c.value));
      if (discarded.length !== 3) {
        console.error("kittyDone: discard count mismatch", { expected: 3, got: discarded.length, combined: combined.map(c => c.value+c.suit).join(","), newHand: newHand.map(c => c.value+c.suit).join(",") });
        return;
      }
      this.logEvent("discard", { userId: socket.userId, discarded, handAfter: [...newHand] });
    }
    winningPlayer.hand = newHand;

    const isMisere = activeGame.currentBid && activeGame.currentBid.bid.includes("Misere");
    const otherPlayer = activeGame.players.find((p) => p.id !== socket.userId);

    if (mode === "replay") {
      activeGame.players.forEach((p) => {
        p.dummyHand = isMisere && p.id === socket.userId ? [] : [...(this.replayDummyHands[p.id] || [])];
      });
    } else {
      activeGame.dealDummyHands(isMisere ? [otherPlayer.id] : undefined);
      this.logEvent("dummyDealt", {
        hands: Object.fromEntries(
          activeGame.players.filter((p) => p.dummyHand.length).map((p) => [p.id, [...p.dummyHand]])
        ),
      });
    }

    activeGame.setupSeats(socket.userId, isMisere);
    activeGame.currentPlayer = socket.userId;
    if (mode !== "replay") this.gamePhase = "playing";

    this.io.to(this.id).emit(mode === "replay" ? "replayKittyPhaseComplete" : "kittyPhaseComplete", {
      winningBidder: socket.userId,
      currentPlayer: socket.userId,
      currentIsDummy: false,
      players: activeGame.players.map((p) => ({ id: p.id, dummyHand: p.dummyHand, tricksWon: p.tricksWon })),
    });
    if (mode !== "replay") this.persist();
  }

  playCard(socket, { card, isDummy, nominatedSuit, mode }) {
    const activeGame = mode === "replay" ? this.replayGame : this.game;
    if (!activeGame) return;
    const seat = activeGame.getCurrentSeat();
    if (!seat || socket.userId !== seat.playerId || isDummy !== seat.isDummy) return;

    const result = activeGame.playCard(socket.userId, card, isDummy, nominatedSuit);
    if (!result.success) {
      socket.emit(mode === "replay" ? "replayInvalidPlay" : "invalidPlay", { message: result.reason });
      return;
    }

    const justPlayed = activeGame.currentTrick[activeGame.currentTrick.length - 1];
    // seq lets the client notice a dropped "cardPlayed" broadcast (e.g. a brief
    // connectivity blip that doesn't trigger a full reconnect) — a gap in the
    // sequence means its local hand/dummy counts have silently drifted from
    // the server's, with no other signal to catch it short of a page refresh.
    const seq =
      mode !== "replay"
        ? this.logEvent("play", { userId: socket.userId, card, isDummy, nominatedSuit: justPlayed.nominatedSuit }).seq
        : undefined;
    this.io.to(this.id).emit(mode === "replay" ? "replayCardPlayed" : "cardPlayed", {
      playerId: socket.userId,
      card,
      isDummy,
      nominatedSuit: justPlayed.nominatedSuit,
      // Playing a card for real ends any exposure it was carrying, so the
      // other player's view of that hand has to be refreshed here too — not
      // just on retract.
      exposed: activeGame.exposed,
      seq,
    });

    if (activeGame.currentTrick.length === activeGame.seats.length) {
      const trickWinner = activeGame.resolveTrick();
      // A replay is a side game that never touches persisted room state, so it
      // reports its trick inline without disturbing the live game's lastTrick.
      const trick = {
        plays: trickWinner.plays,
        winnerId: trickWinner.playerId,
        winnerIsDummy: trickWinner.isDummy,
        winnerName: this.nameOf(trickWinner.playerId),
        winningCard: trickWinner.winningCard,
        leadSuit: trickWinner.leadSuit,
      };
      if (mode !== "replay") this.lastTrick = trick;
      this.io.to(this.id).emit(mode === "replay" ? "replayTrickResolved" : "trickResolved", {
        winner: trickWinner.playerId,
        winnerIsDummy: trickWinner.isDummy,
        newScores: activeGame.players.map((p) => ({ id: p.id, score: p.score, tricksWon: p.tricksWon })),
        lastTrick: trick,
      });
      if (mode !== "replay") {
        this.logEvent("trick", {
          winnerId: trickWinner.playerId,
          tricksWon: Object.fromEntries(activeGame.players.map((p) => [p.id, p.tricksWon])),
        });
      }

      if (activeGame.isRoundDecided()) {
        if (mode === "replay") this.finishReplay();
        else this.finishRound();
        return;
      }
    } else {
      activeGame.advanceSeat();
    }

    const nextSeat = activeGame.getCurrentSeat();
    activeGame.currentPlayer = nextSeat.playerId;
    this.io.to(this.id).emit(mode === "replay" ? "replayUpdateCurrentPlayer" : "updateCurrentPlayer", {
      playerId: nextSeat.playerId,
      isDummy: nextSeat.isDummy,
    });
    if (mode !== "replay") this.persist();
  }

  // Take back the card you just played, if nobody has played after you. The
  // card returns to your hand but stays exposed — the other player has seen
  // it, and goes on seeing it until you play it for real.
  //
  // The last card of a trick can't be taken back: the trick resolves the
  // instant it lands, so there's no longer a play to undo.
  // Live game only — the replay overlay doesn't offer take-backs, so there's
  // no replay branch here to keep in step.
  retractCard(socket) {
    if (!this.game || this.gamePhase !== "playing") return;

    const last = this.game.currentTrick[this.game.currentTrick.length - 1];
    if (!last || last.playerId !== socket.userId) return;

    const undone = this.game.retractLastPlay(socket.userId, last.isDummy);
    if (!undone) return;

    const seq = this.logEvent("retract", {
      userId: socket.userId,
      card: undone.card,
      isDummy: undone.isDummy,
    }).seq;

    this.io.to(this.id).emit("cardRetracted", {
      playerId: socket.userId,
      card: undone.card,
      isDummy: undone.isDummy,
      exposed: this.game.exposed,
      seq,
    });
    this.io.to(this.id).emit("updateCurrentPlayer", {
      playerId: undone.playerId,
      isDummy: undone.isDummy,
    });
    this.persist();
  }

  // ---- "I've got the rest": a player claims all remaining tricks. Only
  // allowed when they're on lead (no cards down yet this trick), so there's
  // no partial trick to untangle. The claimer's hand and dummy are revealed
  // to the other player the moment the claim is made — they need to see the
  // cards to judge it — and that reveal persists for the rest of the round
  // regardless of their answer. If they agree, the round ends immediately in
  // the claimer's favor. ----

  claimRest(socket) {
    if (!this.game || this.gamePhase !== "playing" || this.pendingClaim) return;
    const seat = this.game.getCurrentSeat();
    if (!seat || seat.playerId !== socket.userId || this.game.currentTrick.length !== 0) return;
    this.pendingClaim = { fromPlayerId: socket.userId };
    this.revealedClaimerId = socket.userId;
    this.emitToUser(this.otherPlayerId(socket.userId), "claimReceived", {
      fromName: this.nameOf(socket.userId),
      claimerId: socket.userId,
    });
    this.persist();
  }

  respondToClaim(socket, accept) {
    if (!this.game || !this.pendingClaim || socket.userId === this.pendingClaim.fromPlayerId) return;
    const claimerId = this.pendingClaim.fromPlayerId;
    this.pendingClaim = null;

    if (accept) {
      const claimer = this.game.players.find((p) => p.id === claimerId);
      claimer.tricksWon += claimer.hand.length;
      this.game.players.forEach((p) => {
        p.hand = [];
        p.dummyHand = [];
      });
      this.logEvent("claimRestAccepted", { claimerId });
      this.io.to(this.id).emit("claimResolved", {
        accepted: true,
        claimerId,
        players: this.game.players.map((p) => ({ id: p.id, hand: p.hand, dummyHand: p.dummyHand, tricksWon: p.tricksWon })),
      });
      this.finishRound();
      return;
    }

    this.logEvent("claimDeclined", { claimerId });
    this.io.to(this.id).emit("claimResolved", {
      accepted: false,
      claimerId,
      revealedClaimerId: this.revealedClaimerId,
      byName: this.nameOf(socket.userId),
    });
    this.persist();
  }

  // ---- round end: result, then ready / review / replay negotiation ----

  // `forcedBidderMadeBid` is set only when the hand ended by agreement rather
  // than by being played out — see resignRound.
  finishRound(forcedBidderMadeBid = null) {
    const bidDescription = this.game.currentBid.bid;
    const { bidderMadeBid, bidderId, otherId, bidderDelta, otherDelta } =
      this.game.scoreRound(forcedBidderMadeBid);
    const bidderPlayer = this.game.players.find((p) => p.id === bidderId);
    const otherPlayer = this.game.players.find((p) => p.id === otherId);

    this.logEvent("result", {
      bidderId,
      bidderMadeBid,
      bidderDelta,
      otherDelta,
      scores: Object.fromEntries(this.game.players.map((p) => [p.id, p.score])),
    });
    // Totals as well as the swing: scoreRound has already applied the deltas,
    // so these are where each player stands after the hand. The round-end
    // screen would otherwise have only the change to show, and the running
    // totals it can see elsewhere are a round out of date by then.
    this.lastRoundResult = {
      bid: bidDescription,
      bidderName: bidderPlayer.name,
      bidderMadeBid,
      bidderDelta,
      bidderScore: bidderPlayer.score,
      otherName: otherPlayer.name,
      otherDelta,
      otherScore: otherPlayer.score,
    };
    this.io.to(this.id).emit("roundResult", this.lastRoundResult);
    this.scoreHistory.push({
      round: this.roundNumber,
      scores: this.game.players.map((p) => ({ name: p.name, score: p.score })),
    });

    // One row per scored round, for the stats page. Best-effort: the hand is
    // over either way, and a statistics write shouldn't be able to break it.
    db.recordRound({
      gameId: this.id,
      mode: 2,
      roundNumber: this.roundNumber,
      at: Date.now(),
      bidderUserId: bidderId,
      partnerUserId: null,
      teamUserIds: [bidderId],
      bid: bidDescription,
      points: this.game.currentBid.points,
      level: /^\d/.test(bidDescription) ? Number(bidDescription.split(" ")[0]) : null,
      tricks: bidderPlayer.tricksWon,
      made: bidderMadeBid,
      friendly: this.isFriendly(),
    }).catch((err) => console.error("failed to record round", err));

    // Both bounds are inclusive: the game is to 500, so landing exactly on it
    // wins, and exactly -500 goes out the back door. They used to be strict,
    // which meant an exact ±500 carried on playing — and disagreed with the
    // game-over screen, which has always called -500 or worse a back door.
    // Only a bidder can end it either way: the other player never loses points.
    const bidderWonGame =
      bidderMadeBid && bidderPlayer.score >= 500 && bidderPlayer.score > otherPlayer.score;
    const bidderLostGame = !bidderMadeBid && bidderPlayer.score <= -500;

    if (bidderWonGame || bidderLostGame) {
      const winner = bidderWonGame ? bidderPlayer : otherPlayer;
      this.gamePhase = "gameOver";
      this.status = "finished";
      this.winner = { id: winner.id, name: winner.name, score: winner.score };
      this.io.to(this.id).emit("gameOver", {
        winner: this.winner,
        players: this.game.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
        scoreHistory: this.scoreHistory,
      });
      // Arm the same review/replay proposal slot the mid-game round-end
      // screen uses, so "Review last hand" / "Replay last hand" work from
      // the game-over screen too — there's just no "ready" concept here.
      this.roundEnd = { readyUserIds: new Set(), proposal: null };
      // The record is read back out of the database, so it can only be sent
      // once this game's own result is in there — hence waiting on persist
      // rather than emitting it alongside gameOver.
      const loser = this.game.players.find((p) => p.id !== winner.id);
      const rate = this.isFriendly() ? () => null : () => db.applyElo(2, [winner.id], [loser.id], this.id);
      this.persist()
        .then(rate)
        .then(() => this.emitMatchRecord())
        .catch((err) => console.error("failed to settle finished game", err));
      return;
    }

    this.gamePhase = "roundEnd";
    this.roundEnd = { readyUserIds: new Set(), proposal: null };
    this.emitRoundEndState();
    this.persist();
  }

  roundEndStatePayload() {
    return {
      readyUserIds: [...this.roundEnd.readyUserIds],
      proposal: this.roundEnd.proposal
        ? { ...this.roundEnd.proposal, fromName: this.nameOf(this.roundEnd.proposal.fromUserId) }
        : null,
      // The round-end screen charts score by round, and the round that just
      // finished is the interesting one. Clients otherwise only receive
      // scoreHistory at gameStart/gameResumed/gameOver, so without this the
      // chart would sit one whole round behind — and be empty after round 1.
      scoreHistory: this.scoreHistory,
    };
  }

  emitRoundEndState() {
    this.io.to(this.id).emit("roundEndState", this.roundEndStatePayload());
  }

  roundEndReady(socket) {
    if (!this.roundEnd) return;
    this.roundEnd.readyUserIds.add(socket.userId);
    if (this.slots.every((s) => s && this.roundEnd.readyUserIds.has(s.userId))) {
      this.dealNextRound();
    } else {
      this.emitRoundEndState();
      this.persist();
    }
  }

  roundEndPropose(socket, type) {
    if (!this.roundEnd || this.roundEnd.proposal) return;
    if (type !== "review" && type !== "replay") return;
    this.roundEnd.proposal = { type, fromUserId: socket.userId };
    this.emitRoundEndState();
    this.persist();
  }

  roundEndRespond(socket, accept) {
    if (!this.roundEnd || !this.roundEnd.proposal) return;
    if (socket.userId === this.roundEnd.proposal.fromUserId) return;
    const { type, fromUserId } = this.roundEnd.proposal;

    if (!accept) {
      // A finished game has no next round to deal — just clear the proposal
      // and land back on the same round-end/game-over screen.
      if (this.status === "finished") {
        this.roundEnd = { readyUserIds: new Set(), proposal: null };
        this.emitRoundEndState();
        this.persist();
      } else {
        this.roundEnd = null;
        this.dealNextRound();
      }
      return;
    }
    this.roundEnd = null;
    // Whoever proposed the review drives it — the other player just watches
    // in sync. Replay doesn't need this: turns already alternate naturally.
    if (type === "review") this.startReview(fromUserId);
    else this.startReplay();
  }

  // ---- review: a snapshot of this round's log, scrubbed in lockstep by
  // whoever proposed it — the other player just watches the same step. ----

  startReview(controllerId) {
    this.gamePhase = "review";
    this.reviewControllerId = controllerId;
    this.reviewStepIndex = 0;
    this.io.to(this.id).emit("reviewStart", {
      round: this.roundNumber,
      log: this.log.filter((e) => e.round === this.roundNumber),
      controllerId,
      stepIndex: 0,
    });
    this.persist();
  }

  reviewStep(socket, index) {
    if (this.gamePhase !== "review" || socket.userId !== this.reviewControllerId) return;
    if (typeof index !== "number" || index < 0) return;
    this.reviewStepIndex = index;
    this.io.to(this.id).emit("reviewStepChanged", { index });
    this.persist();
  }

  reviewDone(socket) {
    if (this.gamePhase !== "review" || socket.userId !== this.reviewControllerId) return;
    this.gamePhase = this.status === "finished" ? "gameOver" : "roundEnd";
    this.roundEnd = { readyUserIds: new Set(), proposal: null };
    this.reviewControllerId = null;
    this.reviewStepIndex = 0;
    this.emitRoundEndState();
    this.persist();
  }

  // ---- replay: a live, unscored redo of the round from the kitty stage ----

  startReplay() {
    const round = this.roundNumber;
    const roundLog = this.log.filter((e) => e.round === round);
    // Last deal, not first: an all-pass redeal logs another deal for this same
    // round number, and only the final one is the deal that was actually played.
    const dealEntry = [...roundLog].reverse().find((e) => e.type === "deal");
    const kittyEntry = roundLog.find((e) => e.type === "kittyDealt");
    const dummyEntry = roundLog.find((e) => e.type === "dummyDealt");
    const bidWonEntry = roundLog.find((e) => e.type === "bidWon");
    if (!dealEntry || !kittyEntry || !bidWonEntry) return;

    const bidderId = bidWonEntry.userId;
    const otherId = Object.keys(dealEntry.hands).find((id) => id !== bidderId);

    this.gamePhase = "replay";
    this.replayGame = new Game500();
    this.replayGame.players = [bidderId, otherId].map((id) => ({
      id,
      name: this.nameOf(id),
      hand: [...dealEntry.hands[id]],
      dummyHand: [],
      score: 0,
      isDealer: false,
      tricksWon: 0,
    }));
    this.replayGame.kitty = [...kittyEntry.kitty];
    this.replayGame.currentBid = { player: bidderId, bid: bidWonEntry.bid, points: bidWonEntry.points };
    this.replayGame.trumpSuit = bidWonEntry.trumpSuit;
    this.replayDummyHands = dummyEntry ? dummyEntry.hands : {};

    this.io.to(this.id).emit("replayStart", {
      players: this.replayGame.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        isDealer: false,
        score: 0,
        tricksWon: 0,
      })),
      currentBid: this.replayGame.currentBid,
      trumpSuit: this.replayGame.trumpSuit,
    });
    this.emitToUser(bidderId, "replayShowKitty", this.replayGame.kitty);
  }

  finishReplay() {
    const bid = this.replayGame.currentBid;
    const bidder = this.replayGame.players.find((p) => p.id === bid.player);
    const other = this.replayGame.players.find((p) => p.id !== bid.player);
    const bidderMadeBid = checkBidMade(bid, bidder.tricksWon);

    this.io.to(this.id).emit("replayResult", {
      bid: bid.bid,
      bidderName: bidder.name,
      bidderMadeBid,
      otherName: other.name,
    });

    this.replayGame = null;
    this.replayDummyHands = null;
    this.gamePhase = this.status === "finished" ? "gameOver" : "roundEnd";
    this.roundEnd = { readyUserIds: new Set(), proposal: null };
    this.emitRoundEndState();
    this.persist();
  }

  // ---- rematch: only reachable once the game is over ----

  rematchOffer(socket) {
    if (this.status !== "finished" || this.rematchProposal) return;
    const recipientId = this.otherPlayerId(socket.userId);
    this.rematchProposal = { fromUserId: socket.userId };
    this.emitToUser(recipientId, "rematchOffered", { fromName: this.nameOf(socket.userId) });
  }

  async rematchRespond(socket, accept) {
    if (!this.rematchProposal || socket.userId === this.rematchProposal.fromUserId) return;
    const offer = this.rematchProposal;
    this.rematchProposal = null;

    if (!accept) {
      this.emitToUser(offer.fromUserId, "rematchDeclined", { byName: this.nameOf(socket.userId) });
      return;
    }

    const newGame = await db.createGame({
      _id: crypto.randomUUID(),
      status: "waiting",
      // Carried over rather than reset: a friendly rematch should stay
      // friendly.
      friendly: this.friendly,
      // A rematch against a robot is still against that robot.
      playerSlots: this.slots.map((s) => ({ userId: s.userId, name: s.name, isBot: Boolean(s.isBot) })),
      roundNumber: 1,
      scoreHistory: [],
      winner: null,
      log: [],
      snapshot: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.io.to(this.id).emit("rematchStarted", { gameId: newGame._id });
  }

  // ---- robots ----

  // This game had no robots at all until now. The shape is room4.js's: a robot
  // fills the empty chair, and every decision it makes goes through the same
  // method a human's socket would have called — placeBid, kittyDone, playCard —
  // with a stand-in socket. So there is no second path through the rules to keep
  // in step, and anything the robot tries that the rules forbid is rejected
  // exactly as a human's would be.
  humanSlots() {
    return this.slots.filter((s) => s && !s.isBot);
  }

  isBotUser(userId) {
    return this.slots.some((s) => s && s.isBot && s.userId === userId);
  }

  botSlot() {
    return this.slots.find((s) => s && s.isBot) || null;
  }

  // A robot has no socket, so this is what it emits into.
  botSocket(userId) {
    return { userId, emit: () => {} };
  }

  // Fill the empty chair with a robot. Only before the deal — there's no way to
  // hand a half-played hand over to one — and only for someone already sitting
  // at the table.
  addBot(socket) {
    if (this.game) return;
    const index = this.slots.findIndex((s) => s === null);
    if (index === -1) return;
    if (!this.slots.some((s) => s && s.userId === socket.userId)) return;

    const taken = this.slots.filter(Boolean).map((s) => s.name);
    this.slots[index] = {
      userId: `bot:${crypto.randomUUID()}`,
      name: botName(index, taken),
      socketId: null,
      isBot: true,
    };
    // A table with a robot at it is never rated — see friendly.js, which reads
    // the isBot flag straight off the persisted slots.
    this.status = "active";
    this.broadcastPlayersUpdate();
    this.persist();
    if (this.slots.every(Boolean) && !this.game) this.startGame();
  }

  // What the robot owes the table right now, if anything.
  //
  // Questions come before turns: a human sitting on "do you accept?" is stuck
  // until the robot answers, and unlike a turn there's no other way for the game
  // to move on.
  botActor() {
    const bot = this.botSlot();
    if (!bot || !this.game) return null;
    const id = bot.userId;

    if (this.pendingClaim && this.otherPlayerId(this.pendingClaim.fromPlayerId) === id) {
      return { kind: "claim", userId: id };
    }
    if (this.pendingOffer && this.otherPlayerId(this.pendingOffer.fromPlayerId) === id) {
      return { kind: "offer", userId: id };
    }
    if ((this.gamePhase === "roundEnd" || this.gamePhase === "gameOver") && this.roundEnd) {
      // The next hand waits on both players saying they're ready.
      return this.roundEnd.readyUserIds.has(id) ? null : { kind: "ready", userId: id };
    }
    if (this.gamePhase === "bidding" && this.currentBidder === id) {
      return { kind: "bid", userId: id };
    }
    if (this.gamePhase === "kitty" && this.game.currentBid?.player === id) {
      return { kind: "kitty", userId: id };
    }
    if (this.gamePhase === "playing") {
      const seat = this.game.getCurrentSeat();
      // Both of the robot's seats are its own to play: its hand and its dummy.
      if (seat && seat.playerId === id) return { kind: "play", userId: id, isDummy: seat.isDummy };
    }
    return null;
  }

  // A robot's turn can begin after any of a dozen things — a bid, a discard, a
  // card, a trick resolving, a round ending, an offer being answered — and
  // room4.js handles that by calling into the scheduler from each of them. Doing
  // the same here would mean a dozen insertions into this file, and *missing*
  // one wouldn't be a robot that moves late, it would be a hand that stops dead
  // with nobody able to play.
  //
  // So this watches instead of being told. While there's a live game with a
  // robot at it, the timer re-arms itself and checks each time whether the robot
  // owes the table anything. One timer per table, a check that's a few
  // comparisons, and no way for a new transition added later to be forgotten.
  // The cost is up to one pause of latency, which is what the pause is for.
  scheduleBotTurn() {
    if (this.botTimer || !this.botSlot()) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.tickBot();
    }, BOT_PAUSE);
    // A chain of timers that re-arms itself would otherwise hold the event loop
    // open on its own — the server has a listening socket keeping it alive
    // regardless, so nothing is lost by letting this one not count.
    this.botTimer.unref?.();
  }

  tickBot() {
    const actor = this.botActor();
    if (actor) {
      try {
        this.runBotTurn(actor);
      } catch (err) {
        console.error(`robot in game ${this.id} failed on ${actor.kind}`, err);
      }
    }
    // Keep watching, unless there's nothing left to watch: a finished game, or a
    // table the human has walked away from — a robot playing on alone would keep
    // this timer alive for as long as the process.
    if (this.game && this.botSlot() && this.connectedHumans() > 0) this.scheduleBotTurn();
  }

  runBotTurn(actor) {
    // Replay is the human's own review of a hand already played; nothing in it
    // is the robot's to move.
    if (this.gamePhase === "replay") return;
    // The table may have moved on while the robot was thinking.
    const current = this.botActor();
    if (!current || current.kind !== actor.kind || current.userId !== actor.userId) return;

    const socket = this.botSocket(actor.userId);
    const game = this.game;

    if (actor.kind === "claim") {
      this.respondToClaim(socket, bot2.acceptsClaim(game, actor.userId));
      return;
    }

    if (actor.kind === "offer") {
      // A "let's both pass" is worth taking if the robot was going to pass
      // anyway. A resignation and a redeal are the opponent's to ask for, and
      // this game isn't rated, so they're simply granted.
      const accept =
        this.pendingOffer.type === "pass"
          ? bot2.chooseBid(game, actor.userId, 0) === "Pass"
          : true;
      this.respondToOffer(socket, accept);
      return;
    }

    if (actor.kind === "ready") {
      this.roundEndReady(socket);
      return;
    }

    if (actor.kind === "bid") {
      const floor = game.currentBid ? game.currentBid.points : 0;
      const call = bot2.chooseBid(game, actor.userId, floor);
      const points = call === "Pass" ? 0 : bidInfo(call).points;
      this.placeBid(socket, { bid: call, points });
      return;
    }

    if (actor.kind === "kitty") {
      this.kittyDone(socket, { newHand: bot2.chooseDiscard(game, actor.userId) });
      return;
    }

    if (actor.kind === "play") {
      const choice = bot2.choosePlay(game, actor.userId, actor.isDummy);
      if (choice) {
        this.playCard(socket, {
          card: choice.card,
          isDummy: actor.isDummy,
          nominatedSuit: choice.nominatedSuit,
        });
      }
    }
  }

  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

// A public table nobody is sitting at gets this long to come back — enough for
// a page reload not to bin the game the host just made.
const ABANDONED_TABLE_GRACE = 60_000;

class RoomManager {
  constructor(io, presence) {
    this.io = io;
    this.presence = presence;
    this.rooms = new Map();
    this.cleanupTimers = new Map();
  }

  async getOrCreate(gameId) {
    if (this.rooms.has(gameId)) return this.rooms.get(gameId);
    const doc = await db.getGame(gameId);
    if (!doc) throw new Error("Game not found");
    const room =
      doc.mode === 4
        ? new Room4(gameId, this.io, doc, this.presence)
        : new Room(gameId, this.io, doc);
    this.rooms.set(gameId, room);
    return room;
  }

  // A table advertised in the lobby that everyone has walked away from before a
  // card was dealt is just clutter, so it's deleted. Private games are left
  // alone whatever happens: their whole point is an invite link that still
  // works when the other player gets round to opening it.
  scheduleCleanupIfAbandoned(room) {
    const abandoned =
      room.visibility === "public" &&
      room.status === "waiting" &&
      !room.game &&
      room.connectedHumans() === 0;
    if (!abandoned) {
      const timer = this.cleanupTimers.get(room.id);
      if (timer) {
        clearTimeout(timer);
        this.cleanupTimers.delete(room.id);
      }
      return;
    }
    if (this.cleanupTimers.has(room.id)) return;
    this.cleanupTimers.set(
      room.id,
      setTimeout(() => this.deleteIfStillAbandoned(room), ABANDONED_TABLE_GRACE)
    );
  }

  async deleteIfStillAbandoned(room) {
    this.cleanupTimers.delete(room.id);
    if (room.game || room.connectedHumans() > 0 || room.status !== "waiting") return;
    room.dispose?.();
    this.rooms.delete(room.id);
    try {
      await db.deleteGame(room.id);
    } catch (err) {
      console.error("failed to delete abandoned game", room.id, err);
    }
    this.presence?.touch();
  }
}

module.exports = { Room, RoomManager };
