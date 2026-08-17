const crypto = require("crypto");
const db = require("./db");
const { Game500Four, availableBids, isNoTricksBid } = require("./game4");
const { sanitizeOptions } = require("./gameOptions");
const bot = require("./bot");

// Mirrors of the client's theme registry (src/theme.js) — see room.js, which
// keeps the same list for the two-player game.
const LOCATION_IDS = [
  "falls", "zanzibar", "samana", "canyon", "sierras", "serengeti",
  "plain-falls", "plain-zanzibar", "plain-samana", "plain-canyon",
  "plain-sierras", "plain-serengeti",
];
const DECK_IDS = ["traveller", "classic"];
const FELT_IDS = ["solid", "faded", "hidden"];

// How long a robot pauses before acting, so a table of them is watchable. The
// longer wait is for the beat after a trick, which the client spends showing
// the finished trick and flying it out to the winner.
const BOT_PAUSE = 1100;
const BOT_PAUSE_AFTER_TRICK = 2900;

// One Room4 per four-player game. Unlike the two-player Room, which sends fine
// -grained events, this broadcasts a whole personalised snapshot after every
// change: with four hands and a partnership the incremental patches stop being
// obviously correct, and a snapshot is small enough that there's nothing to
// gain by being clever. Animations still get their own transient events, since
// those are about timing rather than state.
class Room4 {
  constructor(id, io, doc, presence) {
    this.id = id;
    this.io = io;
    this.presence = presence;
    this.mode = 4;
    this.visibility = doc.visibility === "public" ? "public" : "private";
    this.options = sanitizeOptions(doc.options);
    this.partnerMode = doc.partnerMode === "random" ? "random" : "choose";
    this.hostUserId = doc.hostUserId || doc.playerSlots?.[0]?.userId || null;

    this.slots = (doc.playerSlots || [null, null, null, null]).map((s) =>
      s ? { ...s, socketId: s.isBot ? "bot" : null } : null
    );
    while (this.slots.length < 4) this.slots.push(null);

    this.status = doc.status || "waiting";
    this.phase = doc.snapshot?.phase || "waiting";
    this.roundNumber = doc.roundNumber || 1;
    this.scoreHistory = doc.scoreHistory || [];
    this.winner = doc.winner || null;

    const snap = doc.snapshot || {};
    this.gameSettings = {
      location: "falls",
      deck: "traveller",
      felt: "faded",
      ...(snap.gameSettings || {}),
    };
    this.seatOrder = snap.seatOrder || null;
    this.redealCount = snap.redealCount || 0;
    this.lastTrick = snap.lastTrick || null;
    this.lastRoundResult = snap.lastRoundResult || null;
    this.ralphedSeat = snap.ralphedSeat ?? null;
    this.roundEnd = snap.roundEnd ? { readyUserIds: new Set(snap.roundEnd.readyUserIds) } : null;
    this.game = snap.game ? this.hydrateGame(snap.game) : null;

    this.botTimer = null;
  }

  // ---- persistence ----

  hydrateGame(snap) {
    const game = new Game500Four(this.options);
    game.players = snap.players;
    game.teamScores = snap.teamScores;
    game.deck = snap.deck || [];
    game.kitty = snap.kitty || null;
    game.dealerSeat = snap.dealerSeat || 0;
    game.currentBid = snap.currentBid || null;
    game.trumpSuit = snap.trumpSuit || null;
    game.noContract = Boolean(snap.noContract);
    game.currentTrick = snap.currentTrick || [];
    game.playedCards = snap.playedCards || [];
    game.currentSeat = snap.currentSeat || 0;
    game.auction = snap.auction || null;
    return game;
  }

  serializeGame() {
    const g = this.game;
    if (!g) return null;
    return {
      players: g.players,
      teamScores: g.teamScores,
      deck: g.deck,
      kitty: g.kitty,
      dealerSeat: g.dealerSeat,
      currentBid: g.currentBid,
      trumpSuit: g.trumpSuit,
      noContract: g.noContract,
      currentTrick: g.currentTrick,
      playedCards: g.playedCards,
      currentSeat: g.currentSeat,
      auction: g.auction,
    };
  }

  persist() {
    return db.saveGame(this.id, {
      status: this.status,
      mode: 4,
      visibility: this.visibility,
      options: this.options,
      partnerMode: this.partnerMode,
      hostUserId: this.hostUserId,
      playerSlots: this.slots.map((s) =>
        s ? { userId: s.userId, name: s.name, isBot: Boolean(s.isBot) } : null
      ),
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      snapshot: {
        phase: this.phase,
        gameSettings: this.gameSettings,
        seatOrder: this.seatOrder,
        redealCount: this.redealCount,
        lastTrick: this.lastTrick,
        lastRoundResult: this.lastRoundResult,
        ralphedSeat: this.ralphedSeat,
        roundEnd: this.roundEnd ? { readyUserIds: [...this.roundEnd.readyUserIds] } : null,
        game: this.serializeGame(),
      },
    });
  }

  // ---- helpers ----

  slotOf(userId) {
    return this.slots.find((s) => s && s.userId === userId) || null;
  }

  humanSlots() {
    return this.slots.filter((s) => s && !s.isBot);
  }

  connectedHumans() {
    return this.humanSlots().filter((s) => s.socketId).length;
  }

  isBotSeat(seat) {
    return Boolean(this.game?.players[seat]?.isBot);
  }

  teamName(team) {
    if (!this.game) return team === 0 ? "Team 1" : "Team 2";
    return this.game.players
      .filter((p) => this.game.teamOf(p.seat) === team)
      .map((p) => p.name)
      .join(" & ");
  }

  // ---- joining ----

  handleJoin(socket) {
    const { userId, userName: name } = socket;
    let slot = this.slotOf(userId);

    if (!slot) {
      if (this.game) {
        socket.emit("g4:joinRejected", { message: "That game is already under way." });
        return;
      }
      const index = this.slots.findIndex((s) => s === null);
      if (index === -1) {
        socket.emit("g4:joinRejected", { message: "That table is full." });
        return;
      }
      slot = { userId, name, socketId: socket.id, isBot: false };
      this.slots[index] = slot;
      if (!this.hostUserId) this.hostUserId = userId;
    } else {
      slot.socketId = socket.id;
      slot.name = name;
    }

    socket.join(this.id);
    this.settleWaitingPhase();
    this.persist();
    this.broadcast();
    this.presence?.touch();
    // A game reloaded from the database after a restart has no robot turn
    // pending, so somebody arriving is also the cue to get them moving again.
    this.scheduleBotTurn();
  }

  handleDisconnect(socket) {
    const slot = this.slots.find((s) => s && s.socketId === socket.id);
    if (slot) slot.socketId = null;
    this.broadcast();
    this.presence?.touch();
  }

  // Sitting on four players with nothing dealt: either the pairing is up to the
  // host or, when they asked for random partners, it just happens.
  settleWaitingPhase() {
    if (this.game) return;
    if (this.slots.every(Boolean)) {
      if (this.partnerMode === "random") {
        this.startGame(this.randomPairing());
      } else if (this.phase !== "seating") {
        this.phase = "seating";
      }
    } else {
      this.phase = "waiting";
    }
  }

  addBots(socket) {
    if (this.game || socket.userId !== this.hostUserId) return;
    const taken = this.slots.filter(Boolean).map((s) => s.name);
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) continue;
      const name = bot.botName(i, taken);
      taken.push(name);
      this.slots[i] = { userId: `bot:${crypto.randomUUID()}`, name, socketId: "bot", isBot: true };
    }
    this.settleWaitingPhase();
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  // ---- seating ----

  // Seat order is [host, an opponent, the host's partner, the other opponent],
  // which puts partners across the table from each other on seats 0/2 and 1/3.
  pairingWith(partnerUserId) {
    const host = this.slotOf(this.hostUserId);
    const partner = this.slotOf(partnerUserId);
    if (!host || !partner || partner === host) return null;
    const others = this.slots.filter((s) => s !== host && s !== partner);
    return [host.userId, others[0].userId, partner.userId, others[1].userId];
  }

  randomPairing() {
    const shuffled = [...this.slots];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.map((s) => s.userId);
  }

  choosePartner(socket, { partnerUserId, random }) {
    if (this.game || this.phase !== "seating") return;
    if (socket.userId !== this.hostUserId) return;
    const order = random ? this.randomPairing() : this.pairingWith(partnerUserId);
    if (!order) return;
    this.startGame(order);
  }

  // ---- starting and dealing ----

  startGame(seatOrder) {
    this.seatOrder = seatOrder;
    this.game = new Game500Four(this.options);
    seatOrder.forEach((userId, seat) => {
      const slot = this.slotOf(userId);
      Object.assign(this.game.players[seat], {
        id: userId,
        name: slot.name,
        isBot: Boolean(slot.isBot),
      });
    });

    this.status = "active";
    this.roundNumber = 1;
    this.scoreHistory = [];
    this.winner = null;
    this.redealCount = 0;
    this.ralphedSeat = null;
    this.lastTrick = null;
    this.lastRoundResult = null;
    this.roundEnd = null;
    this.deal(Math.floor(Math.random() * 4));
  }

  deal(dealerSeat) {
    this.game.deal(dealerSeat);
    if (this.ralphedSeat !== null && this.options.ralphing) {
      this.game.barFromBidding([this.ralphedSeat]);
      this.ralphedSeat = null;
    }
    this.phase = "bidding";
    this.lastTrick = null;
    this.lastRoundResult = null;
    this.roundEnd = null;
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  dealNextRound() {
    this.roundNumber += 1;
    this.redealCount = 0;
    this.deal((this.game.dealerSeat + 1) % 4);
  }

  redealSameDealer() {
    this.redealCount += 1;
    this.deal(this.game.dealerSeat);
  }

  // ---- bidding ----

  placeBid(socket, { bid }) {
    if (this.phase !== "bidding" || !this.game?.auction) return;
    const seat = this.game.seatOf(socket.userId);
    if (seat === -1) return;
    const result = this.game.bid(seat, bid);
    if (!result.ok) {
      socket.emit("g4:invalidPlay", { message: result.reason });
      return;
    }
    if (result.complete) this.finishAuction();
    else {
      this.persist();
      this.broadcast();
      this.scheduleBotTurn();
    }
  }

  finishAuction() {
    const contract = this.game.completeBidding();

    if (!contract) {
      // Nobody bid. Either the hand is thrown in, or the table plays it out at
      // no trumps for trick points.
      if (this.options.allPassNoTrump) {
        this.phase = "playing";
        this.io.to(this.id).emit("g4:notice", {
          text: "Everyone passed — playing it out at no trumps, ten a trick.",
        });
        this.persist();
        this.broadcast();
        this.scheduleBotTurn();
      } else {
        this.io.to(this.id).emit("g4:notice", { text: "Everyone passed — redealing." });
        this.redealSameDealer();
      }
      return;
    }

    this.phase = "kitty";
    this.game.takeKitty(contract.seat);
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  // ---- the kitty ----

  discard(socket, { keep }) {
    if (this.phase !== "kitty" || !this.game) return;
    const seat = this.game.seatOf(socket.userId);
    if (seat !== this.game.currentBid.seat) return;
    const result = this.game.discard(seat, keep);
    if (!result.success) {
      socket.emit("g4:invalidPlay", { message: result.reason });
      return;
    }
    this.beginPlay();
  }

  beginPlay() {
    this.phase = "playing";
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  // ---- play ----

  playCard(socket, { card, nominatedSuit }) {
    if (this.phase !== "playing" || !this.game) return;
    const seat = this.game.seatOf(socket.userId);
    if (seat === -1 || seat !== this.game.currentSeat) return;
    this.applyPlay(seat, card, nominatedSuit, socket);
  }

  applyPlay(seat, card, nominatedSuit, socket) {
    const result = this.game.playCard(seat, card, nominatedSuit);
    if (!result.success) {
      socket?.emit("g4:invalidPlay", { message: result.reason });
      return;
    }

    if (!this.game.trickIsComplete()) {
      this.game.currentSeat = this.game.nextActiveSeat(seat);
      this.persist();
      this.broadcast();
      this.scheduleBotTurn();
      return;
    }

    const trick = this.game.resolveTrick();
    this.lastTrick = {
      plays: trick.plays,
      winnerSeat: trick.seat,
      winnerName: this.game.players[trick.seat].name,
      winningCard: trick.winningCard,
      leadSuit: trick.leadSuit,
    };
    // Sent before the snapshot that clears the table, so the client can hold
    // the finished trick on screen and fly it out to the winner.
    this.io.to(this.id).emit("g4:trickResolved", this.lastTrick);

    if (this.game.isRoundDecided()) {
      this.finishRound();
      return;
    }
    this.persist();
    this.broadcast();
    this.scheduleBotTurn(true);
  }

  // ---- round end ----

  finishRound() {
    const game = this.game;
    const bidLabel = game.currentBid?.bid || null;
    const result = game.scoreRound();

    if (result.ralphedSeat !== null && result.ralphedSeat !== undefined) {
      this.ralphedSeat = result.ralphedSeat;
    }

    this.lastRoundResult = {
      bid: bidLabel,
      noContract: Boolean(result.noContract),
      made: result.made,
      slam: Boolean(result.slam),
      bidderName: game.currentBid ? game.players[game.currentBid.seat].name : null,
      biddingTeam: result.biddingTeam,
      ralphedName:
        this.ralphedSeat !== null && this.ralphedSeat !== undefined
          ? game.players[this.ralphedSeat].name
          : null,
      teams: [0, 1].map((team) => ({
        name: this.teamName(team),
        delta: result.deltas[team],
        score: game.teamScores[team],
        tricks: game.teamTricks(team),
      })),
    };

    this.scoreHistory.push({
      round: this.roundNumber,
      scores: [0, 1].map((team) => ({ name: this.teamName(team), score: game.teamScores[team] })),
    });

    const madeBidTeam = result.made ? result.biddingTeam : null;
    const over = game.checkGameOver(madeBidTeam);

    this.io.to(this.id).emit("g4:roundResult", this.lastRoundResult);

    if (over) {
      this.phase = "gameOver";
      this.status = "finished";
      this.winner = {
        team: over.team,
        name: this.teamName(over.team),
        score: game.teamScores[over.team],
        reason: over.reason,
        playerIds: game.players
          .filter((p) => game.teamOf(p.seat) === over.team)
          .map((p) => p.id),
      };
      this.roundEnd = null;
      this.persist();
      this.broadcast();
      this.presence?.touch();
      return;
    }

    this.phase = "roundEnd";
    this.roundEnd = { readyUserIds: new Set() };
    this.persist();
    this.broadcast();
  }

  readyForNextRound(socket) {
    if (this.phase !== "roundEnd" || !this.roundEnd) return;
    this.roundEnd.readyUserIds.add(socket.userId);
    // Robots never keep anyone waiting.
    const waiting = this.humanSlots().filter((s) => !this.roundEnd.readyUserIds.has(s.userId));
    if (waiting.length === 0) this.dealNextRound();
    else {
      this.persist();
      this.broadcast();
    }
  }

  // ---- settings ----

  setGameSettings(socket, settings) {
    if (!this.slotOf(socket.userId)) return;
    const next = { ...this.gameSettings };
    if (LOCATION_IDS.includes(settings.location)) next.location = settings.location;
    if (DECK_IDS.includes(settings.deck)) next.deck = settings.deck;
    if (FELT_IDS.includes(settings.felt)) next.felt = settings.felt;
    this.gameSettings = next;
    this.persist();
    this.broadcast();
  }

  // Only before the cards are out — the rules can't change mid-game.
  setOptions(socket, options) {
    if (this.game || socket.userId !== this.hostUserId) return;
    this.options = sanitizeOptions(options);
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  setVisibility(socket, visibility) {
    if (this.game || socket.userId !== this.hostUserId) return;
    this.visibility = visibility === "public" ? "public" : "private";
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  // ---- robots ----

  // Whose turn it is, if that seat is a robot's.
  botActorSeat() {
    const game = this.game;
    if (!game) return null;
    let seat = null;
    if (this.phase === "bidding" && game.auction && !game.auction.complete) seat = game.auction.turnSeat;
    else if (this.phase === "kitty") seat = game.currentBid.seat;
    else if (this.phase === "playing") seat = game.currentSeat;
    if (seat === null || seat === undefined) return null;
    return this.isBotSeat(seat) ? seat : null;
  }

  scheduleBotTurn(afterTrick = false) {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const seat = this.botActorSeat();
    if (seat === null) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        this.runBotTurn(seat);
      } catch (err) {
        console.error(`robot at seat ${seat} in game ${this.id} failed`, err);
      }
    }, afterTrick ? BOT_PAUSE_AFTER_TRICK : BOT_PAUSE);
  }

  runBotTurn(seat) {
    // The world may have moved on while the robot was thinking.
    if (this.botActorSeat() !== seat) return;

    if (this.phase === "bidding") {
      const call = bot.chooseBid(this.game, seat);
      const result = this.game.bid(seat, call);
      if (!result.ok) {
        // Should be unreachable — chooseBid only ever offers legal calls — but
        // a robot that can't move must not wedge the table, so it passes.
        this.game.bid(seat, "Pass");
      }
      if (this.game.auction.complete) this.finishAuction();
      else {
        this.persist();
        this.broadcast();
        this.scheduleBotTurn();
      }
      return;
    }

    if (this.phase === "kitty") {
      const keep = bot.chooseDiscard(this.game, seat);
      this.game.discard(seat, keep);
      this.beginPlay();
      return;
    }

    if (this.phase === "playing") {
      const choice = bot.choosePlay(this.game, seat);
      if (choice) this.applyPlay(seat, choice.card, choice.nominatedSuit, null);
    }
  }

  // ---- state broadcast ----

  // Everything one player is entitled to see. Other people's cards are counts,
  // never cards, except where a contract puts a hand face up.
  stateFor(userId) {
    const game = this.game;
    const slot = this.slotOf(userId);

    const base = {
      gameId: this.id,
      mode: 4,
      phase: this.phase,
      status: this.status,
      visibility: this.visibility,
      options: this.options,
      partnerMode: this.partnerMode,
      hostUserId: this.hostUserId,
      isHost: userId === this.hostUserId,
      gameSettings: this.gameSettings,
      slots: this.slots.map((s) =>
        s
          ? { userId: s.userId, name: s.name, isBot: Boolean(s.isBot), connected: Boolean(s.socketId) }
          : null
      ),
      you: { userId, seated: Boolean(slot) },
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      roundResult: this.lastRoundResult,
    };

    if (!game) return base;

    const seat = game.seatOf(userId);
    const spec = game.contractSpec();
    // Open Misère: the bidder's hand goes face up to everyone else once the
    // first trick has been played.
    const openSeat =
      spec?.open && game.playedCards.length >= game.activeSeats().length
        ? game.currentBid.seat
        : null;

    const revealedHands = {};
    if (openSeat !== null && openSeat !== seat) {
      revealedHands[openSeat] = game.players[openSeat].hand;
    }

    return {
      ...base,
      you: {
        userId,
        seated: Boolean(slot),
        seat,
        team: seat === -1 ? null : game.teamOf(seat),
        hand: seat === -1 ? [] : game.players[seat].hand,
      },
      seats: game.players.map((p) => ({
        seat: p.seat,
        userId: p.id,
        name: p.name,
        isBot: p.isBot,
        team: game.teamOf(p.seat),
        handCount: p.hand.length,
        tricksWon: p.tricksWon,
        folded: p.folded,
        connected: Boolean(this.slotOf(p.id)?.socketId),
        isDealer: p.seat === game.dealerSeat,
      })),
      teamNames: [this.teamName(0), this.teamName(1)],
      teamScores: game.teamScores,
      dealerSeat: game.dealerSeat,
      redealCount: this.redealCount,
      currentBid: game.currentBid,
      trumpSuit: game.trumpSuit,
      noContract: game.noContract,
      contract: spec
        ? { open: Boolean(spec.open), target: spec.target, exact: Boolean(spec.exact) }
        : null,
      currentSeat: this.phase === "playing" ? game.currentSeat : null,
      currentTrick: game.currentTrick.map((play) => ({
        seat: play.seat,
        card: play.card,
        nominatedSuit: play.nominatedSuit,
      })),
      lastTrick: this.lastTrick,
      revealedHands,
      auction: game.auction
        ? {
            turnSeat: game.auction.turnSeat,
            highBid: game.auction.highBid,
            history: game.auction.history,
            barredSeats: game.auction.barredSeats,
            complete: game.auction.complete,
          }
        : null,
      availableBids: availableBids(this.options).map((b) => ({
        bid: b.bid,
        points: b.points,
        rank: b.rank,
        level: b.level ?? null,
        suit: b.suit ?? null,
        special: Boolean(b.special),
      })),
      // Only computed for whoever is on call, which is also the only person who
      // can act on it.
      legalBids:
        this.phase === "bidding" && game.auction?.turnSeat === seat
          ? availableBids(this.options)
              .filter((b) => game.bidLegality(seat, b.bid).ok)
              .map((b) => b.bid)
          : null,
      legalPlays:
        this.phase === "playing" && game.currentSeat === seat && seat !== -1
          ? game.legalPlays(seat)
          : null,
      roundEnd: this.roundEnd ? { readyUserIds: [...this.roundEnd.readyUserIds] } : null,
    };
  }

  broadcast() {
    for (const slot of this.slots) {
      if (!slot || slot.isBot || !slot.socketId) continue;
      this.io.to(slot.socketId).emit("g4:state", this.stateFor(slot.userId));
    }
  }

  sendStateTo(socket) {
    socket.emit("g4:state", this.stateFor(socket.userId));
  }

  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

module.exports = { Room4, isNoTricksBid };
