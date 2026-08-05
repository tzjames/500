const crypto = require("crypto");
const Game500 = require("./gameLogic");
const { checkBidMade } = Game500;
const db = require("./db");

const REAL_SUITS = ["♠", "♣", "♥", "♦"];

// One Room per game document. Player identity is the account's userId (stable
// forever), never a socket id — reconnecting is just "does this userId already
// own a slot here," so there's no name-matching or pending-restore guesswork.
class Room {
  constructor(id, io, doc) {
    this.id = id;
    this.io = io;
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
    this.gameSettings = snap.gameSettings || {
      showOfferPassButton: true,
      showOfferRetroactivePassButton: true,
    };
    this.offerPassDeclined = snap.offerPassDeclined || false;
    this.offerRetroactivePassDeclined = snap.offerRetroactivePassDeclined || false;
    this.pendingOffer = snap.pendingOffer || null;
    this.reviewControllerId = snap.reviewControllerId || null;
    this.reviewStepIndex = snap.reviewStepIndex || 0;
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
      reviewControllerId: this.reviewControllerId,
      reviewStepIndex: this.reviewStepIndex,
      roundEnd: this.roundEnd
        ? { readyUserIds: [...this.roundEnd.readyUserIds], proposal: this.roundEnd.proposal }
        : null,
      game: this.serializeGame(),
    };
    db.saveGame(this.id, {
      status: this.status,
      playerSlots: this.slots.map((s) => (s ? { userId: s.userId, name: s.name } : null)),
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      log: this.log,
      snapshot,
    });
  }

  // ---- small helpers ----

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
    this.log.push({ seq: this.log.length, round: this.roundNumber, type, ts: Date.now(), ...payload });
  }

  broadcastPlayersUpdate() {
    const connected = this.slots.filter((s) => s && s.socketId).length;
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
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      gameSettings: this.gameSettings,
      offerPassDeclined: this.offerPassDeclined,
      offerRetroactivePassDeclined: this.offerRetroactivePassDeclined,
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
    this.gamePhase = "bidding";

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
    this.gamePhase = "bidding";

    this.logEvent("deal", this.dealHandsLogPayload(dealData.dealerId));
    this.io.to(this.id).emit("gameStart", this.gameStartPayload(dealData));
    this.io.to(this.id).emit("updateGamePhase", "bidding");
    this.persist();
  }

  redealAllPassed() {
    const dealerIndex = this.game.players.findIndex((p) => p.isDealer);
    const dealData = this.game.redeal(dealerIndex);
    this.currentBidder = this.game.players.find((p) => p.id !== dealData.dealerId).id;
    this.biddingHistory = [];
    this.offerPassDeclined = false;
    this.offerRetroactivePassDeclined = false;
    this.gamePhase = "bidding";

    this.logEvent("allPassed", {});
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
    this.gameSettings = { ...this.gameSettings, ...settings };
    this.io.to(this.id).emit("gameSettingsUpdated", this.gameSettings);
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

  respondToOffer(socket, accept) {
    if (!this.game || !this.pendingOffer || socket.userId === this.pendingOffer.fromPlayerId) return;
    const offer = this.pendingOffer;
    this.pendingOffer = null;

    if (accept) {
      this.io.to(this.id).emit("allPlayersPassed");
      this.redealAllPassed();
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
      const discarded = combined.filter((c) => !newHand.some((h) => h.suit === c.suit && h.value === c.value));
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
    this.io.to(this.id).emit(mode === "replay" ? "replayCardPlayed" : "cardPlayed", {
      playerId: socket.userId,
      card,
      isDummy,
      nominatedSuit: justPlayed.nominatedSuit,
    });
    if (mode !== "replay") {
      this.logEvent("play", { userId: socket.userId, card, isDummy, nominatedSuit: justPlayed.nominatedSuit });
    }

    if (activeGame.currentTrick.length === activeGame.seats.length) {
      const trickWinner = activeGame.resolveTrick();
      this.io.to(this.id).emit(mode === "replay" ? "replayTrickResolved" : "trickResolved", {
        winner: trickWinner.playerId,
        winnerIsDummy: trickWinner.isDummy,
        newScores: activeGame.players.map((p) => ({ id: p.id, score: p.score, tricksWon: p.tricksWon })),
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

  // ---- round end: result, then ready / review / replay negotiation ----

  finishRound() {
    const bidDescription = this.game.currentBid.bid;
    const { bidderMadeBid, bidderId, otherId, bidderDelta, otherDelta } = this.game.scoreRound();
    const bidderPlayer = this.game.players.find((p) => p.id === bidderId);
    const otherPlayer = this.game.players.find((p) => p.id === otherId);

    this.logEvent("result", {
      bidderId,
      bidderMadeBid,
      bidderDelta,
      otherDelta,
      scores: Object.fromEntries(this.game.players.map((p) => [p.id, p.score])),
    });
    this.io.to(this.id).emit("roundResult", {
      bid: bidDescription,
      bidderName: bidderPlayer.name,
      bidderMadeBid,
      bidderDelta,
      otherName: otherPlayer.name,
      otherDelta,
    });
    this.scoreHistory.push({
      round: this.roundNumber,
      scores: this.game.players.map((p) => ({ name: p.name, score: p.score })),
    });

    const bidderWonGame = bidderMadeBid && bidderPlayer.score > 500 && bidderPlayer.score > otherPlayer.score;
    const bidderLostGame = !bidderMadeBid && bidderPlayer.score < -500;

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
      this.persist();
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
    const dealEntry = roundLog.find((e) => e.type === "deal");
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
      playerSlots: this.slots.map((s) => ({ userId: s.userId, name: s.name })),
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
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  async getOrCreate(gameId) {
    if (this.rooms.has(gameId)) return this.rooms.get(gameId);
    const doc = await db.getGame(gameId);
    if (!doc) throw new Error("Game not found");
    const room = new Room(gameId, this.io, doc);
    this.rooms.set(gameId, room);
    return room;
  }
}

module.exports = { Room, RoomManager };
