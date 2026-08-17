const crypto = require("crypto");
const db = require("./db");
const { Game500Four, availableBids, bidInfo } = require("./game4");
const { sanitizeOptions } = require("./gameOptions");
const { isFriendlyGame } = require("./friendly");
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
    // The host's own choice. A robot seated at the table makes the game
    // friendly regardless — see isFriendly() — so this can go on being false
    // even after that's happened; nothing reads this field directly except
    // the toggle control itself.
    this.friendly = Boolean(doc.friendly);
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
    this.log = doc.log || [];

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
    // Who has said they mean to go blind on the next hand, declared on the
    // round-end screen before the cards come out.
    this.blindIntents = new Set(snap.blindIntents || []);
    this.roundEnd = snap.roundEnd
      ? {
          readyUserIds: new Set(snap.roundEnd.readyUserIds),
          proposal: snap.roundEnd.proposal
            ? { ...snap.roundEnd.proposal, agreed: new Set(snap.roundEnd.proposal.agreed) }
            : null,
        }
      : null;
    // "I've got the rest": the claimer's hand goes face up to both opponents
    // the moment they claim, and stays up for the rest of the round whatever
    // they answer.
    this.pendingClaim = snap.pendingClaim
      ? { seat: snap.pendingClaim.seat, agreed: new Set(snap.pendingClaim.agreed) }
      : null;
    this.revealedClaimSeat = snap.revealedClaimSeat ?? null;
    this.reviewControllerId = snap.reviewControllerId || null;
    this.reviewStepIndex = snap.reviewStepIndex || 0;
    this.game = snap.game ? this.hydrateGame(snap.game) : null;

    // A replay is a live, unscored redo of the round — in memory only, so a
    // server restart mid-replay simply abandons it and everyone lands back on
    // the round-end screen. Same for a rematch under negotiation: a finished
    // game's room is a dead end either way once it's abandoned.
    this.replayGame = null;
    this.replayPhase = null;
    this.rematch = null;
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
    game.blindSeats = snap.blindSeats || [];
    game.pendingPass = snap.pendingPass || {};
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
      blindSeats: g.blindSeats,
      pendingPass: g.pendingPass,
    };
  }

  persist() {
    return db.saveGame(this.id, {
      status: this.status,
      mode: 4,
      visibility: this.visibility,
      friendly: this.friendly,
      options: this.options,
      partnerMode: this.partnerMode,
      hostUserId: this.hostUserId,
      playerSlots: this.slots.map((s) =>
        s ? { userId: s.userId, name: s.name, isBot: Boolean(s.isBot) } : null
      ),
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      log: this.log,
      snapshot: {
        phase: this.phase,
        gameSettings: this.gameSettings,
        seatOrder: this.seatOrder,
        redealCount: this.redealCount,
        lastTrick: this.lastTrick,
        lastRoundResult: this.lastRoundResult,
        ralphedSeat: this.ralphedSeat,
        blindIntents: [...this.blindIntents],
        reviewControllerId: this.reviewControllerId,
        reviewStepIndex: this.reviewStepIndex,
        pendingClaim: this.pendingClaim
          ? { seat: this.pendingClaim.seat, agreed: [...this.pendingClaim.agreed] }
          : null,
        revealedClaimSeat: this.revealedClaimSeat,
        roundEnd: this.roundEnd
          ? {
              readyUserIds: [...this.roundEnd.readyUserIds],
              proposal: this.roundEnd.proposal
                ? { ...this.roundEnd.proposal, agreed: [...this.roundEnd.proposal.agreed] }
                : null,
            }
          : null,
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

  isBotSeat(seat, game = this.game) {
    return Boolean(game?.players[seat]?.isBot);
  }

  anyBotSeated() {
    return this.slots.some((s) => s && s.isBot);
  }

  isFriendly() {
    return isFriendlyGame({ friendly: this.friendly, playerSlots: this.slots });
  }

  teamName(team) {
    if (!this.game) return team === 0 ? "Team 1" : "Team 2";
    return this.game.players
      .filter((p) => this.game.teamOf(p.seat) === team)
      .map((p) => p.name)
      .join(" & ");
  }

  logEvent(type, payload) {
    const entry = { seq: this.log.length, round: this.roundNumber, type, ts: Date.now(), ...payload };
    this.log.push(entry);
    return entry;
  }

  notice(text) {
    this.io.to(this.id).emit("g4:notice", { text });
  }

  // Everyone who still has to say yes to a table-wide proposal. Robots always
  // agree, and so does anyone who has dropped their connection — otherwise one
  // absent seat would veto review, replay and rematch for the other three.
  outstandingAgreement(proposal) {
    return this.humanSlots()
      .filter((s) => s.socketId && s.userId !== proposal.fromUserId)
      .filter((s) => !proposal.agreed.has(s.userId))
      .map((s) => s.userId);
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
    this.log = [];
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
    // Blind declarations were made on the last round-end screen; they apply to
    // this hand and are spent by it either way.
    if (this.options.blindMisere && this.blindIntents.size > 0) {
      this.game.blindSeats = this.game.players
        .filter((p) => this.blindIntents.has(p.id))
        .map((p) => p.seat);
    }
    this.blindIntents = new Set();

    this.phase = "bidding";
    this.lastTrick = null;
    this.lastRoundResult = null;
    this.roundEnd = null;
    this.pendingClaim = null;
    this.revealedClaimSeat = null;

    this.logEvent("deal", {
      dealerId: this.game.players[dealerSeat].id,
      hands: Object.fromEntries(this.game.players.map((p) => [p.id, [...p.hand]])),
    });
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
    // A blind seat that has now spoken is no longer holding cards it hasn't
    // seen — whatever it called, the hand is open to it from here.
    this.game.blindSeats = this.game.blindSeats.filter((s) => s !== seat);
    this.logEvent("bid", { userId: socket.userId, bid, points: bidInfo(bid, this.options)?.points || 0 });

    if (result.complete) this.finishAuction();
    else {
      this.persist();
      this.broadcast();
      this.scheduleBotTurn();
    }
  }

  // "No, show me my cards after all." Turns the hand face up and leaves them to
  // bid like everyone else — having told the table they were thinking about it.
  declineBlind(socket) {
    if (this.phase !== "bidding" || !this.game) return;
    const seat = this.game.seatOf(socket.userId);
    if (seat === -1 || !this.game.blindSeats.includes(seat)) return;
    this.game.blindSeats = this.game.blindSeats.filter((s) => s !== seat);
    this.notice(`${this.game.players[seat].name} looked at their hand instead.`);
    this.persist();
    this.broadcast();
  }

  finishAuction() {
    const contract = this.game.completeBidding();
    this.game.blindSeats = [];

    if (!contract) {
      // Nobody bid. Either the hand is thrown in, or the table plays it out at
      // no trumps for trick points.
      if (this.options.allPassNoTrump) {
        this.phase = "playing";
        this.notice("Everyone passed — playing it out at no trumps, ten a trick.");
        this.persist();
        this.broadcast();
        this.scheduleBotTurn();
      } else {
        this.notice("Everyone passed — redealing.");
        this.redealSameDealer();
      }
      return;
    }

    this.logEvent("bidWon", {
      userId: this.game.players[contract.seat].id,
      bid: contract.bid,
      points: contract.points,
      trumpSuit: this.game.trumpSuit,
    });
    this.logEvent("kittyDealt", { kitty: [...this.game.kitty] });

    this.phase = "kitty";
    this.game.takeKitty(contract.seat);
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  // ---- the kitty, and Double Nullo's exchange ----

  discard(socket, { keep, mode }) {
    const game = this.gameFor(mode);
    if (!game || this.phaseFor(mode) !== "kitty") return;
    const seat = game.seatOf(socket.userId);
    if (seat !== game.currentBid.seat) return;
    const result = game.discard(seat, keep);
    if (!result.success) {
      socket.emit("g4:invalidPlay", { message: result.reason });
      return;
    }
    if (mode !== "replay") {
      this.logEvent("discard", { userId: socket.userId, discarded: result.discarded, handAfter: [...keep] });
    }
    this.afterKitty(mode);
  }

  // Double Nullo needs a five-card exchange between the partners before play;
  // every other contract goes straight to the first lead.
  afterKitty(mode) {
    const game = this.gameFor(mode);
    const next = game.exchangeSeats() ? "exchange" : "playing";
    this.setPhase(mode, next);
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  passCards(socket, { cards, mode }) {
    const game = this.gameFor(mode);
    if (!game || this.phaseFor(mode) !== "exchange") return;
    const seat = game.seatOf(socket.userId);
    if (seat === -1) return;
    const result = game.setPass(seat, cards);
    if (!result.success) {
      socket.emit("g4:invalidPlay", { message: result.reason });
      return;
    }
    if (game.exchangeReady()) this.completeExchange(mode);
    else {
      this.persist();
      this.broadcast();
      this.scheduleBotTurn();
    }
  }

  completeExchange(mode) {
    const game = this.gameFor(mode);
    const sent = game.completeExchange();
    if (mode !== "replay") {
      this.logEvent("pass", {
        // Keyed by the player who sent them, and the hands they were left with.
        sent: Object.fromEntries(
          Object.entries(sent).map(([seat, cards]) => [game.players[seat].id, cards])
        ),
        handsAfter: Object.fromEntries(game.players.map((p) => [p.id, [...p.hand]])),
      });
    }
    this.setPhase(mode, "playing");
    this.notice("The partners have changed five cards each.");
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  // ---- play ----

  playCard(socket, { card, nominatedSuit, mode }) {
    const game = this.gameFor(mode);
    if (!game || this.phaseFor(mode) !== "playing") return;
    const seat = game.seatOf(socket.userId);
    if (seat === -1 || seat !== game.currentSeat) return;
    this.applyPlay(seat, card, nominatedSuit, socket, mode);
  }

  applyPlay(seat, card, nominatedSuit, socket, mode) {
    const game = this.gameFor(mode);
    const result = game.playCard(seat, card, nominatedSuit);
    if (!result.success) {
      socket?.emit("g4:invalidPlay", { message: result.reason });
      return;
    }
    if (mode !== "replay") {
      this.logEvent("play", { userId: game.players[seat].id, card, nominatedSuit: result.play.nominatedSuit });
    }

    if (!game.trickIsComplete()) {
      game.currentSeat = game.nextActiveSeat(seat);
      this.persist();
      this.broadcast();
      this.scheduleBotTurn();
      return;
    }

    const trick = game.resolveTrick();
    const resolved = {
      plays: trick.plays,
      winnerSeat: trick.seat,
      winnerName: game.players[trick.seat].name,
      winningCard: trick.winningCard,
      leadSuit: trick.leadSuit,
      mode: mode === "replay" ? "replay" : "live",
    };
    if (mode !== "replay") {
      this.lastTrick = resolved;
      this.logEvent("trick", {
        winnerId: game.players[trick.seat].id,
        tricksWon: Object.fromEntries(game.players.map((p) => [p.id, p.tricksWon])),
      });
    }
    // Sent before the snapshot that clears the table, so the client can hold
    // the finished trick on screen and fly it out to the winner.
    this.io.to(this.id).emit("g4:trickResolved", resolved);

    if (game.isRoundDecided()) {
      if (mode === "replay") this.finishReplay();
      else this.finishRound();
      return;
    }
    this.persist();
    this.broadcast();
    this.scheduleBotTurn(true);
  }

  // ---- "I've got the rest" ----

  // Only from the lead, so there's no half-played trick to untangle, and only
  // with both opponents agreeing — it hands the claiming side every remaining
  // trick. The claimer's hand goes face up to the opponents the moment they
  // claim, since they have to see the cards to judge it, and stays up for the
  // rest of the round whatever they decide.
  claimRest(socket) {
    if (this.phase !== "playing" || !this.game || this.pendingClaim) return;
    const seat = this.game.seatOf(socket.userId);
    if (seat === -1 || seat !== this.game.currentSeat) return;
    if (this.game.currentTrick.length > 0) return;

    this.pendingClaim = { seat, agreed: new Set() };
    this.revealedClaimSeat = seat;
    this.persist();
    this.broadcast();
    this.resolveClaimIfSettled();
  }

  claimOpponentSeats() {
    if (!this.pendingClaim) return [];
    const team = this.game.teamOf(this.pendingClaim.seat);
    return this.game.players.filter((p) => this.game.teamOf(p.seat) !== team).map((p) => p.seat);
  }

  respondToClaim(socket, accept) {
    if (!this.pendingClaim || !this.game) return;
    const seat = this.game.seatOf(socket.userId);
    if (!this.claimOpponentSeats().includes(seat)) return;

    if (!accept) {
      this.declineClaim(this.game.players[seat].name);
      return;
    }
    this.pendingClaim.agreed.add(seat);
    this.resolveClaimIfSettled();
  }

  // Both opponents have to agree. Robots answer for themselves as soon as
  // they're asked; a human who has dropped out holds it up, but so does the
  // hand itself, since it's their turn to play sooner or later.
  resolveClaimIfSettled() {
    if (!this.pendingClaim) return;
    const opponents = this.claimOpponentSeats();
    for (const seat of opponents) {
      if (this.pendingClaim.agreed.has(seat)) continue;
      if (!this.isBotSeat(seat)) continue;
      if (bot.acceptsClaim(this.game, seat)) this.pendingClaim.agreed.add(seat);
      else {
        this.declineClaim(this.game.players[seat].name);
        return;
      }
    }
    if (!opponents.every((seat) => this.pendingClaim.agreed.has(seat))) {
      this.persist();
      this.broadcast();
      return;
    }

    // Agreed: the claiming side takes every trick that's left.
    const claimSeat = this.pendingClaim.seat;
    const claimTeam = this.game.teamOf(claimSeat);
    const remaining = this.game.players[claimSeat].hand.length;
    this.game.players[claimSeat].tricksWon += remaining;
    this.game.players.forEach((p) => {
      p.hand = [];
    });
    this.game.currentTrick = [];
    this.pendingClaim = null;
    this.logEvent("claimRestAccepted", { claimerId: this.game.players[claimSeat].id, tricks: remaining });
    this.notice(`${this.game.players[claimSeat].name} had the rest — ${remaining} more to ${this.teamName(claimTeam)}.`);
    this.finishRound();
  }

  declineClaim(byName) {
    const claimSeat = this.pendingClaim.seat;
    this.pendingClaim = null;
    this.notice(
      `${byName} didn't agree — ${this.game.players[claimSeat].name}'s hand stays face up for the rest of the round.`
    );
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
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

    this.logEvent("result", {
      bidderId: game.currentBid ? game.players[game.currentBid.seat].id : null,
      bidderMadeBid: result.made,
      deltas: result.deltas,
      scores: [...game.teamScores],
    });

    this.scoreHistory.push({
      round: this.roundNumber,
      scores: [0, 1].map((team) => ({ name: this.teamName(team), score: game.teamScores[team] })),
    });

    this.recordRound(result).catch((err) => console.error("failed to record round", err));

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
        playerIds: game.players.filter((p) => game.teamOf(p.seat) === over.team).map((p) => p.id),
      };
      // The game-over screen offers review, replay and a rematch, all of which
      // go through the same proposal slot the round-end screen uses.
      this.roundEnd = { readyUserIds: new Set(), proposal: null };
      this.persist()
        .then(() => this.settleFinishedGame())
        .catch((err) => console.error("failed to settle finished game", err));
      this.broadcast();
      this.presence?.touch();
      return;
    }

    this.phase = "roundEnd";
    this.roundEnd = { readyUserIds: new Set(), proposal: null };
    this.persist();
    this.broadcast();
  }

  // One row per scored round, for the stats page. Best-effort: a game shouldn't
  // fall over because the statistics write did.
  async recordRound(result) {
    const game = this.game;
    if (result.noContract || !game.currentBid) return;
    const level = /^\d/.test(game.currentBid.bid) ? Number(game.currentBid.bid.split(" ")[0]) : null;
    const biddingTeam = result.biddingTeam;
    await db.recordRound({
      gameId: this.id,
      mode: 4,
      roundNumber: this.roundNumber,
      at: Date.now(),
      bidderUserId: game.players[game.currentBid.seat].id,
      partnerUserId: game.players[game.partnerOf(game.currentBid.seat)].id,
      teamUserIds: game.players.filter((p) => game.teamOf(p.seat) === biddingTeam).map((p) => p.id),
      bid: game.currentBid.bid,
      points: game.currentBid.points,
      level,
      tricks: result.biddingTricks,
      made: result.made,
      // A friendly hand — whether marked that way or played with a robot — is
      // practice; the stats page keeps it out of the record for the same
      // reason it isn't rated.
      friendly: this.isFriendly(),
    });
  }

  // Ratings and the head-to-head record, once the result is in the database.
  async settleFinishedGame() {
    if (!this.winner) return;
    if (!this.isFriendly()) {
      const winners = this.winner.playerIds;
      const losers = this.game.players.filter((p) => !winners.includes(p.id)).map((p) => p.id);
      await db.applyElo(4, winners, losers, this.id);
    }
    this.broadcast();
  }

  readyForNextRound(socket) {
    if (this.phase !== "roundEnd" || !this.roundEnd) return;
    this.roundEnd.readyUserIds.add(socket.userId);
    // Robots never keep anyone waiting, and nor does an empty chair.
    const waiting = this.humanSlots().filter(
      (s) => s.socketId && !this.roundEnd.readyUserIds.has(s.userId)
    );
    if (waiting.length === 0) this.dealNextRound();
    else {
      this.persist();
      this.broadcast();
    }
  }

  setBlindIntent(socket, on) {
    if (!this.options.blindMisere) return;
    if (this.phase !== "roundEnd") return;
    if (on) this.blindIntents.add(socket.userId);
    else this.blindIntents.delete(socket.userId);
    this.persist();
    this.broadcast();
  }

  // ---- review and replay: proposed from the round-end or game-over screen,
  // and everyone else has to agree ----

  propose(socket, type) {
    if (!this.roundEnd || this.roundEnd.proposal) return;
    if (!["review", "replay"].includes(type)) return;
    if (this.roundEnd.readyUserIds.has(socket.userId)) return;
    this.roundEnd.proposal = { type, fromUserId: socket.userId, agreed: new Set() };
    this.persist();
    this.broadcast();
    this.settleProposal();
  }

  respondToProposal(socket, accept) {
    const proposal = this.roundEnd?.proposal;
    if (!proposal || socket.userId === proposal.fromUserId) return;
    if (!accept) {
      this.roundEnd.proposal = null;
      this.notice(`${this.slotOf(socket.userId)?.name} would rather get on with it.`);
      this.persist();
      this.broadcast();
      return;
    }
    proposal.agreed.add(socket.userId);
    this.settleProposal();
  }

  settleProposal() {
    const proposal = this.roundEnd?.proposal;
    if (!proposal) return;
    if (this.outstandingAgreement(proposal).length > 0) {
      this.persist();
      this.broadcast();
      return;
    }
    this.roundEnd.proposal = null;
    if (proposal.type === "review") this.startReview(proposal.fromUserId);
    else this.startReplay();
  }

  startReview(controllerId) {
    this.phase = "review";
    this.reviewControllerId = controllerId;
    this.reviewStepIndex = 0;
    this.persist();
    this.broadcast();
  }

  reviewStep(socket, index) {
    if (this.phase !== "review" || socket.userId !== this.reviewControllerId) return;
    if (typeof index !== "number" || index < 0) return;
    this.reviewStepIndex = index;
    this.persist();
    this.broadcast();
  }

  reviewDone(socket) {
    if (this.phase !== "review" || socket.userId !== this.reviewControllerId) return;
    this.reviewControllerId = null;
    this.reviewStepIndex = 0;
    this.backToRoundEnd();
  }

  backToRoundEnd() {
    this.phase = this.status === "finished" ? "gameOver" : "roundEnd";
    this.roundEnd = { readyUserIds: new Set(), proposal: null };
    this.persist();
    this.broadcast();
  }

  // A live, unscored redo of the round from the kitty stage, with the same
  // hands. Rebuilt from the round's own log so it needs nothing kept aside.
  startReplay() {
    const roundLog = this.log.filter((e) => e.round === this.roundNumber);
    // Last deal, not first: an all-pass redeal logs another deal under the same
    // round number, and only the final one is the hand that was played.
    const dealEntry = [...roundLog].reverse().find((e) => e.type === "deal");
    const kittyEntry = roundLog.find((e) => e.type === "kittyDealt");
    const bidWonEntry = roundLog.find((e) => e.type === "bidWon");
    if (!dealEntry || !kittyEntry || !bidWonEntry) {
      this.notice("There's nothing to replay in this hand.");
      this.backToRoundEnd();
      return;
    }

    const replay = new Game500Four(this.options);
    this.game.players.forEach((p) => {
      Object.assign(replay.players[p.seat], {
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        hand: [...(dealEntry.hands[p.id] || [])],
        tricksWon: 0,
        folded: false,
      });
    });
    replay.dealerSeat = this.game.dealerSeat;
    replay.kitty = [...kittyEntry.kitty];
    const bidderSeat = replay.seatOf(bidWonEntry.userId);
    replay.auction = { highBid: { seat: bidderSeat, bid: bidWonEntry.bid, points: bidWonEntry.points }, complete: true, history: [], passedSinceBid: [], passedEver: [], barredSeats: [], turnSeat: null, allPassed: false };
    replay.completeBidding();
    replay.takeKitty(bidderSeat);

    this.replayGame = replay;
    this.replayPhase = "kitty";
    this.phase = "replay";
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  finishReplay() {
    const replay = this.replayGame;
    const made = replay.contractSpec()
      ? replay.contractMade()
      : replay.teamTricks(replay.teamOf(replay.currentBid.seat)) >=
        Number(replay.currentBid.bid.split(" ")[0]);

    this.io.to(this.id).emit("g4:replayResult", {
      bid: replay.currentBid.bid,
      bidderName: replay.players[replay.currentBid.seat].name,
      made,
      tricks: replay.teamTricks(replay.teamOf(replay.currentBid.seat)),
    });
    this.endReplay();
  }

  endReplay(socket) {
    if (socket && this.phase !== "replay") return;
    this.replayGame = null;
    this.replayPhase = null;
    this.backToRoundEnd();
  }

  // ---- rematch ----

  // Only once the game is over, and everyone still at the table has to want it.
  // `pairing` decides who partners whom next time: the same again, swapped, or
  // drawn out of a hat.
  rematchOffer(socket, { pairing }) {
    if (this.status !== "finished" || this.rematch) return;
    if (!this.slotOf(socket.userId)) return;
    this.rematch = {
      fromUserId: socket.userId,
      pairing: ["same", "swap", "random"].includes(pairing) ? pairing : "same",
      agreed: new Set(),
    };
    this.broadcast();
    this.settleRematch().catch((err) => console.error("rematch failed", err));
  }

  rematchRespond(socket, accept) {
    if (!this.rematch || socket.userId === this.rematch.fromUserId) return;
    if (!accept) {
      const byName = this.slotOf(socket.userId)?.name;
      this.rematch = null;
      this.notice(`${byName} passed on a rematch.`);
      this.broadcast();
      return;
    }
    this.rematch.agreed.add(socket.userId);
    this.settleRematch().catch((err) => console.error("rematch failed", err));
  }

  async settleRematch() {
    if (!this.rematch) return;
    if (this.outstandingAgreement(this.rematch).length > 0) {
      this.broadcast();
      return;
    }
    const { pairing } = this.rematch;
    this.rematch = null;

    const order = this.rematchOrder(pairing);
    const slotByUser = new Map(this.slots.filter(Boolean).map((s) => [s.userId, s]));
    const newGame = await db.createGame({
      _id: crypto.randomUUID(),
      mode: 4,
      visibility: "private",
      // Carried over rather than reset: a friendly rematch should stay
      // friendly, and one with a robot in it (still in playerSlots below) is
      // caught by isFriendlyGame regardless of what this says.
      friendly: this.friendly,
      options: this.options,
      // The pairing is settled already, so the new table doesn't stop to ask.
      partnerMode: "random",
      hostUserId: this.hostUserId,
      status: "waiting",
      playerSlots: order.map((userId) => {
        const slot = slotByUser.get(userId);
        return { userId, name: slot.name, isBot: Boolean(slot.isBot) };
      }),
      roundNumber: 1,
      scoreHistory: [],
      winner: null,
      log: [],
      snapshot: { seatOrder: order },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.io.to(this.id).emit("g4:rematchStarted", { gameId: newGame._id });
  }

  // Partners sit on seats 0/2 and 1/3, so swapping the last two seats is the
  // smallest change that gives everybody a different partner.
  rematchOrder(pairing) {
    const order = this.seatOrder || this.slots.filter(Boolean).map((s) => s.userId);
    if (pairing === "swap") return [order[0], order[1], order[3], order[2]];
    if (pairing === "random") {
      const shuffled = [...order];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    return order;
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

  // Only before the cards are out, and only the host — like visibility. A
  // robot at the table overrides this to friendly regardless (see
  // isFriendly()); the client disables its own control in that case rather
  // than let the host flip a switch that does nothing.
  setFriendly(socket, friendly) {
    if (this.game || socket.userId !== this.hostUserId) return;
    this.friendly = Boolean(friendly);
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  // ---- live game or replay ----

  gameFor(mode) {
    return mode === "replay" ? this.replayGame : this.game;
  }

  phaseFor(mode) {
    return mode === "replay" ? this.replayPhase : this.phase;
  }

  setPhase(mode, phase) {
    if (mode === "replay") this.replayPhase = phase;
    else this.phase = phase;
  }

  // ---- robots ----

  // Whose turn it is, if that seat is a robot's — in the replay as readily as
  // in the live game, since a replay with three empty chairs is no use.
  botActorSeat() {
    const mode = this.phase === "replay" ? "replay" : undefined;
    const game = this.gameFor(mode);
    const phase = this.phaseFor(mode);
    if (!game) return null;

    let seat = null;
    if (phase === "bidding" && game.auction && !game.auction.complete) seat = game.auction.turnSeat;
    else if (phase === "kitty") seat = game.currentBid?.seat;
    else if (phase === "exchange") {
      seat = (game.exchangeSeats() || []).find(
        (s) => !game.pendingPass[s] && this.isBotSeat(s, game)
      );
      return seat === undefined || seat === null ? null : { seat, mode };
    } else if (phase === "playing") seat = game.currentSeat;

    if (seat === null || seat === undefined) return null;
    return this.isBotSeat(seat, game) ? { seat, mode } : null;
  }

  scheduleBotTurn(afterTrick = false) {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const actor = this.botActorSeat();
    if (!actor) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        this.runBotTurn(actor);
      } catch (err) {
        console.error(`robot at seat ${actor.seat} in game ${this.id} failed`, err);
      }
    }, afterTrick ? BOT_PAUSE_AFTER_TRICK : BOT_PAUSE);
  }

  runBotTurn(actor) {
    // The world may have moved on while the robot was thinking.
    const current = this.botActorSeat();
    if (!current || current.seat !== actor.seat || current.mode !== actor.mode) return;

    const mode = actor.mode;
    const game = this.gameFor(mode);
    const seat = actor.seat;
    const phase = this.phaseFor(mode);
    const socket = { userId: game.players[seat].id, emit: () => {} };

    if (phase === "bidding") {
      const call = bot.chooseBid(game, seat);
      const result = game.bid(seat, call);
      // Should be unreachable — chooseBid only ever offers legal calls — but a
      // robot that can't move must not wedge the table, so it passes.
      if (!result.ok) game.bid(seat, "Pass");
      this.logEvent("bid", { userId: game.players[seat].id, bid: call, points: bidInfo(call, this.options)?.points || 0 });
      if (game.auction.complete) this.finishAuction();
      else {
        this.persist();
        this.broadcast();
        this.scheduleBotTurn();
      }
      return;
    }

    if (phase === "kitty") {
      this.discard(socket, { keep: bot.chooseDiscard(game, seat), mode });
      return;
    }

    if (phase === "exchange") {
      this.passCards(socket, { cards: bot.choosePass(game, seat), mode });
      return;
    }

    if (phase === "playing") {
      const choice = bot.choosePlay(game, seat);
      if (choice) this.applyPlay(seat, choice.card, choice.nominatedSuit, null, mode);
    }
  }

  // ---- state broadcast ----

  // The part of a snapshot that describes a board — used for the live game and,
  // during a replay, for the replay's own board as well.
  boardFor(userId, game, phase) {
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
    // A claim under negotiation, or one that was declined, leaves the claimer's
    // hand face up to the other side for the rest of the round.
    if (
      this.revealedClaimSeat !== null &&
      this.revealedClaimSeat !== seat &&
      game === this.game &&
      game.teamOf(this.revealedClaimSeat) !== game.teamOf(seat)
    ) {
      revealedHands[this.revealedClaimSeat] = game.players[this.revealedClaimSeat].hand;
    }

    // A blind bidder hasn't looked at their own cards, so neither has the page.
    const blind = game.blindSeats.includes(seat);

    return {
      phase,
      you: {
        userId,
        seated: true,
        seat,
        team: seat === -1 ? null : game.teamOf(seat),
        hand: seat === -1 || blind ? [] : game.players[seat].hand,
        handCount: seat === -1 ? 0 : game.players[seat].hand.length,
        blind,
        // Asked when the auction reaches a seat that declared it was going blind.
        blindPrompt: blind && phase === "bidding" && game.auction?.turnSeat === seat,
        blindPoints: bidInfo("Blind Misere", this.options)?.points || 1000,
        passed: seat === -1 ? null : game.pendingPass[seat] || null,
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
        blind: game.blindSeats.includes(p.seat),
      })),
      teamNames: [0, 1].map((team) =>
        game.players
          .filter((p) => game.teamOf(p.seat) === team)
          .map((p) => p.name)
          .join(" & ")
      ),
      teamScores: game.teamScores,
      dealerSeat: game.dealerSeat,
      currentBid: game.currentBid,
      trumpSuit: game.trumpSuit,
      noContract: game.noContract,
      contract: spec
        ? { open: Boolean(spec.open), target: spec.target, exact: Boolean(spec.exact), bothPartners: Boolean(spec.bothPartners) }
        : null,
      exchangeSeats: game.exchangeSeats(),
      exchangeDone: (game.exchangeSeats() || []).filter((s) => game.pendingPass[s]),
      currentSeat: phase === "playing" ? game.currentSeat : null,
      currentTrick: game.currentTrick.map((play) => ({
        seat: play.seat,
        card: play.card,
        nominatedSuit: play.nominatedSuit,
      })),
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
      // Only computed for whoever is on call, which is also the only person who
      // can act on it.
      legalBids:
        phase === "bidding" && game.auction?.turnSeat === seat && !blind
          ? availableBids(this.options)
              .filter((b) => game.bidLegality(seat, b.bid).ok)
              .map((b) => b.bid)
          : null,
      legalPlays:
        phase === "playing" && game.currentSeat === seat && seat !== -1
          ? game.legalPlays(seat)
          : null,
    };
  }

  // Everything one player is entitled to see. Other people's cards are counts,
  // never cards, except where a contract or a claim puts a hand face up.
  stateFor(userId) {
    const game = this.game;
    const slot = this.slotOf(userId);

    const base = {
      gameId: this.id,
      mode: 4,
      phase: this.phase,
      status: this.status,
      visibility: this.visibility,
      friendly: this.isFriendly(),
      friendlyForced: this.anyBotSeated(),
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

    const board = this.boardFor(userId, game, this.phase);
    const proposal = this.roundEnd?.proposal;

    return {
      ...base,
      ...board,
      availableBids: availableBids(this.options).map((b) => ({
        bid: b.bid,
        points: b.points,
        rank: b.rank,
        level: b.level ?? null,
        suit: b.suit ?? null,
        special: Boolean(b.special),
      })),
      lastTrick: this.lastTrick,
      redealCount: this.redealCount,
      roundEnd: this.roundEnd
        ? {
            readyUserIds: [...this.roundEnd.readyUserIds],
            blindIntent: this.blindIntents.has(userId),
            proposal: proposal
              ? {
                  type: proposal.type,
                  fromUserId: proposal.fromUserId,
                  fromName: this.slotOf(proposal.fromUserId)?.name,
                  mine: proposal.fromUserId === userId,
                  awaitingYou: this.outstandingAgreement(proposal).includes(userId),
                  waitingOn: this.outstandingAgreement(proposal).length,
                }
              : null,
          }
        : null,
      claim: this.pendingClaim
        ? {
            seat: this.pendingClaim.seat,
            name: game.players[this.pendingClaim.seat].name,
            mine: this.pendingClaim.seat === board.you.seat,
            awaitingYou:
              this.claimOpponentSeats().includes(board.you.seat) &&
              !this.pendingClaim.agreed.has(board.you.seat),
          }
        : null,
      canClaimRest:
        this.phase === "playing" &&
        board.you.seat === game.currentSeat &&
        game.currentTrick.length === 0 &&
        !this.pendingClaim,
      review:
        this.phase === "review"
          ? {
              round: this.roundNumber,
              log: this.log.filter((e) => e.round === this.roundNumber),
              controllerId: this.reviewControllerId,
              stepIndex: this.reviewStepIndex,
            }
          : null,
      replay:
        this.phase === "replay" && this.replayGame
          ? this.boardFor(userId, this.replayGame, this.replayPhase)
          : null,
      rematch: this.rematch
        ? {
            fromUserId: this.rematch.fromUserId,
            fromName: this.slotOf(this.rematch.fromUserId)?.name,
            pairing: this.rematch.pairing,
            mine: this.rematch.fromUserId === userId,
            awaitingYou: this.outstandingAgreement(this.rematch).includes(userId),
            waitingOn: this.outstandingAgreement(this.rematch).length,
          }
        : null,
    };
  }

  broadcast() {
    for (const slot of this.slots) {
      if (!slot || slot.isBot || !slot.socketId) continue;
      this.io.to(slot.socketId).emit("g4:state", this.stateFor(slot.userId));
    }
  }

  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

module.exports = { Room4 };
