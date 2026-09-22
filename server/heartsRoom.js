const crypto = require("crypto");
const db = require("./db");
const bot = require("./bot");
const heartsBot = require("./heartsBot");
const { isFriendlyGame } = require("./friendly");
const { HeartsGame, SUITS } = require("./hearts");
const { DEFAULT_TABLE_THEME, applyTableTheme } = require("./tableTheme");
const { handsFromLog, attachResults, newestFirst } = require("./handHistory");
const {
  variantById,
  sanitizeHeartsOptions,
  describeHeartsOptions,
  validHeartsSetup,
} = require("./heartsOptions");

// How long a robot pauses before acting, so a table of them is watchable.
const BOT_PAUSE = 650;
const BOT_PAUSE_AFTER_TRICK = 1000;
// Passing is simultaneous, so a table of robots would otherwise all move at
// once and the screen would jump from a deal to a played trick.
const BOT_PAUSE_PASS = 350;

// A Hearts room, built on the same small protocol the Euchre one uses: every
// action goes through act(), and everything the client needs to draw a screen
// arrives in one hearts:state payload.
//
// The one thing that is genuinely different here is secrecy. Passing is
// simultaneous and hidden, so what a seat is told about a pass depends on whose
// seat it is — see stateFor and passHistory.
class HeartsRoom {
  constructor(id, io, doc, presence) {
    this.id = id;
    this.io = io;
    this.presence = presence;
    const setup = validHeartsSetup({ variant: doc.variant, mode: doc.mode });
    this.variant = setup.variant;
    this.mode = setup.mode;
    this.options = sanitizeHeartsOptions(doc.options, this.variant);
    this.visibility = doc.visibility === "public" ? "public" : "private";
    this.friendly = Boolean(doc.friendly);
    this.hostUserId = doc.hostUserId;
    this.status = doc.status || "waiting";
    this.roundNumber = doc.roundNumber || 1;
    this.winner = doc.winner || null;
    this.scoreHistory = doc.scoreHistory || [];
    this.log = doc.log || [];
    this.botTimer = null;
    this.slots = Array.from({ length: this.mode }, (_, seat) => {
      const slot = (doc.playerSlots || [])[seat];
      return slot ? { ...slot, socketId: slot.isBot ? "bot" : null } : null;
    });

    const snap = doc.snapshot || {};
    this.gameSettings = { ...DEFAULT_TABLE_THEME, ...(snap.gameSettings || {}) };
    this.phase = snap.phase || "waiting";
    this.readyUserIds = new Set(snap.readyUserIds || []);
    this.lastTrick = snap.lastTrick || null;
    this.lastResult = snap.lastResult || null;
    this.game = snap.game ? this.hydrate(snap.game) : null;
    // Review and replay live only as long as the table is up: a reload drops
    // everyone back to the round end they were proposed from.
    this.proposal = null;
    this.review = null;
    this.replaying = false;
    this.held = null;
    this.replayResult = null;
  }

  hydrate(snap) {
    const game = new HeartsGame({ variant: this.variant, mode: this.mode, options: this.options });
    Object.assign(game, snap);
    return game;
  }

  spec() {
    return variantById[this.variant];
  }

  persist() {
    const real = this.held ? this.held : this;
    return db.saveGame(this.id, {
      status: this.status,
      playerSlots: this.slots.map((slot) =>
        slot ? { userId: slot.userId, name: slot.name, isBot: Boolean(slot.isBot) } : null
      ),
      visibility: this.visibility,
      friendly: this.friendly,
      options: this.options,
      roundNumber: this.roundNumber,
      scoreHistory: this.scoreHistory,
      winner: this.winner,
      log: this.log,
      snapshot: {
        gameSettings: this.gameSettings,
        phase: real.phase,
        readyUserIds: [...this.readyUserIds],
        lastTrick: real.lastTrick,
        lastResult: this.lastResult,
        game: real.game ? JSON.parse(JSON.stringify(real.game)) : null,
      },
    });
  }

  isFriendly() {
    return isFriendlyGame({ friendly: this.friendly, playerSlots: this.slots });
  }

  humans() {
    return this.slots.filter((slot) => slot && !slot.isBot);
  }

  connectedHumans() {
    return this.humans().filter((slot) => slot.socketId).length;
  }

  seatOf(userId) {
    return this.slots.findIndex((slot) => slot?.userId === userId);
  }

  isBotSeat(seat) {
    return Boolean(this.slots[seat]?.isBot);
  }

  broadcastPlayersUpdate() {
    this.io.to(this.id).emit("playersUpdate", {
      count: this.connectedHumans(),
      players: this.slots.filter(Boolean).map((slot) => ({ name: slot.name })),
    });
  }

  // ---- seating ----

  handleJoin(socket) {
    let seat = this.seatOf(socket.userId);
    if (seat < 0) {
      seat = this.slots.findIndex((slot) => slot === null);
      if (seat < 0) return socket.emit("hearts:joinRejected", { message: "This table is full." });
      this.slots[seat] = { userId: socket.userId, name: socket.userName, socketId: socket.id };
    } else {
      this.slots[seat].socketId = socket.id;
      this.slots[seat].name = socket.userName;
    }
    socket.join(this.id);
    if (this.slots.every(Boolean) && !this.game) this.startRound(true);
    else {
      this.persist();
      this.broadcastPlayersUpdate();
      this.broadcast();
      this.scheduleBotTurn();
    }
    this.presence?.touch();
  }

  // Matched on the socket, not the player: a reload's old connection drops
  // after the new one has sat down, and would otherwise clear its own seat.
  handleDisconnect(socket) {
    const slot = this.slots.find((seat) => seat && seat.socketId === socket.id);
    if (!slot) return;
    slot.socketId = null;
    this.persist();
    this.broadcastPlayersUpdate();
    this.broadcast();
    this.presence?.touch();
  }

  addBots(socket) {
    if (socket.userId !== this.hostUserId) return this.reject(socket, "Only the host can seat robots.");
    if (this.game) return this.reject(socket, "The hand has already been dealt.");
    const taken = this.slots.filter(Boolean).map((slot) => slot.name);
    for (let seat = 0; seat < this.mode; seat += 1) {
      if (this.slots[seat]) continue;
      const name = bot.botName(seat, taken);
      taken.push(name);
      this.slots[seat] = { userId: `bot:${crypto.randomUUID()}`, name, socketId: "bot", isBot: true };
    }
    // A robot at the table makes the game unrated, and there is no undoing it.
    this.friendly = true;
    this.startRound(true);
    this.presence?.touch();
  }

  // The location, pack and felt are table-wide, so a change lands on everyone.
  setGameSettings(socket, settings) {
    if (this.seatOf(socket.userId) < 0) return;
    this.gameSettings = applyTableTheme(this.gameSettings, settings || {}, this.playerNames());
    this.persist();
    this.broadcast();
  }

  playerNames() {
    return this.slots.filter(Boolean).map((slot) => slot.name);
  }

  setVisibility(socket, visibility) {
    if (socket.userId !== this.hostUserId) return;
    this.visibility = visibility === "public" ? "public" : "private";
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  setFriendly(socket, friendly) {
    if (socket.userId !== this.hostUserId || this.game) return;
    this.friendly = Boolean(friendly);
    this.persist();
    this.broadcast();
    this.presence?.touch();
  }

  // ---- the round ----

  startRound(first = false, redeal = false) {
    if (!this.game) {
      this.game = new HeartsGame({ variant: this.variant, mode: this.mode, options: this.options });
    }
    this.phase = this.game.resetRound(first || redeal ? this.game.dealerSeat : undefined, redeal);
    this.readyUserIds.clear();
    this.lastTrick = null;
    this.lastResult = null;
    this.replayResult = null;
    this.status = "active";
    this.log.push({
      type: "deal",
      round: this.roundNumber,
      dealerSeat: this.game.dealerSeat,
      passDirection: this.game.passDirection,
      ts: Date.now(),
    });
    // A hand of nothing but cards that cost, where the table throws those in.
    const misdeal = this.game.misdealSeat();
    if (misdeal !== null) {
      this.log.push({ type: "misdeal", round: this.roundNumber, seat: misdeal, ts: Date.now() });
      return this.startRound(false, true);
    }
    if (this.phase === "playing") this.logOpeningPosition();
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  reject(socket, message) {
    socket?.emit("hearts:error", { message });
  }

  // Every action goes through here: check the seat and the phase, apply, then
  // let one place decide whether the round or the game has ended.
  act(socket, phases, apply) {
    const seat = this.seatOf(socket.userId);
    if (seat < 0) return this.reject(socket, "Sit at the table before playing.");
    if (!phases.includes(this.phase)) return this.reject(socket, "That isn't what the table is waiting for.");
    const result = apply(seat) || {};
    if (result.ok === false) return this.reject(socket, result.reason);
    this.settle(result);
  }

  settle(result) {
    const wasPlaying = this.phase === "playing";
    if (result.phase) this.phase = result.phase;
    // The position at the first lead, which is everything review and replay
    // need: taking it after the passing means neither has to model the pass.
    if (this.phase === "playing" && !wasPlaying && !this.replaying) this.logOpeningPosition();
    if (result.finished) return this.finishRound();
    this.persist();
    this.broadcast();
    this.scheduleBotTurn(result.trickDone);
  }

  logOpeningPosition() {
    const game = this.game;
    this.log.push({
      type: "opening",
      round: this.roundNumber,
      hands: game.players.map((player) => [...player.hand]),
      widow: [...game.widow],
      stock: [...game.stock],
      penaltySuit: game.penaltySuit,
      bid: game.bidState?.highBid ?? null,
      bidderSeat: game.bidState?.highBidder ?? null,
      leadSeat: game.currentSeat,
      leadCard: game.leadCard,
      ts: Date.now(),
    });
  }

  // ---- the actions themselves ----

  pass(socket, { cards } = {}) {
    this.act(socket, ["passing"], (seat) => {
      const result = this.game.choosePass(seat, cards);
      if (result.ok) {
        this.log.push({
          type: "pass",
          round: this.roundNumber,
          seat,
          to: this.game.passTarget(seat),
          cards: this.game.passed[seat],
          ts: Date.now(),
        });
      }
      return result;
    });
  }

  bid(socket, { amount } = {}) {
    this.act(socket, ["bidding"], (seat) => {
      const result = this.game.placeBid(seat, amount);
      if (result.ok) {
        this.log.push({ type: "bid", round: this.roundNumber, seat, amount: Number(amount) || 0, ts: Date.now() });
      }
      return result;
    });
  }

  chooseSuit(socket, { suit } = {}) {
    this.act(socket, ["chooseSuit"], (seat) => {
      const result = this.game.chooseSuit(seat, suit);
      if (result.ok) this.log.push({ type: "suit", round: this.roundNumber, seat, suit, ts: Date.now() });
      return result;
    });
  }

  play(socket, { card } = {}) {
    this.act(socket, ["playing"], (seat) => {
      const result = this.game.playCard(seat, card);
      if (result.ok) {
        this.log.push({ type: "play", round: this.roundNumber, seat, card, ts: Date.now() });
        if (result.trickDone) {
          this.lastTrick = result.resolved;
          // Sent before the snapshot that clears the table, so the client can
          // hold the finished trick on screen and fly it out to the winner.
          this.io.to(this.id).emit("hearts:trickResolved", this.lastTrick);
        }
      }
      return result;
    });
  }

  nextRound(socket) {
    const seat = this.seatOf(socket.userId);
    if (seat < 0 || this.phase !== "roundEnd") return;
    this.readyUserIds.add(socket.userId);
    if (this.humans().every((slot) => this.readyUserIds.has(slot.userId))) {
      this.roundNumber += 1;
      this.startRound();
    } else {
      this.persist();
      this.broadcast();
    }
  }

  // ---- end of round ----

  finishRound() {
    if (this.replaying) return this.endReplay();
    const game = this.game;
    const result = game.scoreRound();
    this.lastResult = {
      ...result,
      penaltySuit: game.penaltySuit,
      bid: game.bidState?.highBid || null,
      bidderSeat: game.bidState?.highBidder ?? null,
    };
    this.scoreHistory.push({
      round: this.roundNumber,
      result: this.lastResult,
      scores: game.players.map((player) => ({ name: this.slots[player.seat]?.name, score: player.score })),
    });
    this.recordRound(result).catch((err) => console.error("failed to record round", err));

    const winners = game.winners();
    if (winners.length) {
      const winnerIds = winners.map((seat) => this.slots[seat]?.userId).filter(Boolean);
      const loserIds = game.players
        .filter((player) => !winners.includes(player.seat))
        .map((player) => this.slots[player.seat]?.userId)
        .filter(Boolean);
      this.winner = {
        playerIds: winnerIds,
        id: winnerIds.length === 1 ? winnerIds[0] : null,
        name: winners.map((seat) => this.slots[seat]?.name).join(" & "),
        score: game.players[winners[0]].score,
      };
      this.status = "finished";
      this.phase = "gameOver";
      this.persist()
        .then(() => (this.isFriendly() ? null : db.applyElo("hearts", this.mode, winnerIds, loserIds, this.id)))
        .catch((err) => console.error("failed to settle finished game", err));
    } else {
      this.phase = "roundEnd";
      this.readyUserIds.clear();
      this.persist();
    }
    this.broadcast();
    this.presence?.touch();
  }

  // One row per player per deal, for the stats page — Hearts has no bidder, so
  // what there is to keep is how each seat's own deal went. Best-effort: a game
  // shouldn't fall over because the statistics write did.
  async recordRound(result) {
    const game = this.game;
    const moonSeats = result.moon?.seats || [];
    await Promise.all(
      game.players.map((player) => {
        const slot = this.slots[player.seat];
        if (!slot) return null;
        return db.recordRound({
          gameId: this.id,
          gameType: "hearts",
          variant: this.variant,
          mode: this.mode,
          roundNumber: this.roundNumber,
          at: Date.now(),
          bidderUserId: slot.userId,
          points: result.delta[player.seat],
          taken: player.roundPoints,
          tricks: player.tricksWon,
          moon: moonSeats.includes(player.seat),
          moonAgainst: moonSeats.length > 0 && !moonSeats.includes(player.seat),
          clean: player.roundPoints === 0,
          friendly: this.isFriendly(),
        });
      })
    );
  }

  // The passing, hand by hand: which way the cards went, what each seat sent
  // and how the hand finished. Plays are left out — the tricks are on the board
  // as they happen, whereas a pass is invisible unless it is written down.
  //
  // A pass is somebody's hand, so a hand still being played only ever shows
  // this seat's own; once the deal has been scored there is nothing left to
  // hide and the whole table's is shown.
  passHistory(userId) {
    const yourSeat = this.seatOf(userId);
    const results = new Map(this.scoreHistory.map((entry) => [entry.round, entry.result]));
    const hands = handsFromLog(this.log, {
      keep: (type) => !["play", "opening"].includes(type),
      marks: ["misdeal"],
    });
    attachResults(hands, (round) => results.get(round));
    return newestFirst(hands).map((hand) => ({
      round: hand.round,
      thrownIn: hand.thrownIn,
      dealerSeat: hand.deal.dealerSeat,
      passDirection: hand.deal.passDirection,
      result: hand.result || null,
      calls: hand.calls.map(({ type, seat, to, cards, suit, amount }) => ({
        type,
        seat,
        to,
        suit,
        amount,
        cards: hand.result || seat === yourSeat ? cards : null,
      })),
    }));
  }

  // ---- review and replay ----

  // The hand this round actually played, rebuilt from its own log: the cards
  // everyone held at the first lead and the plays in order. One routine serves
  // both review (step through what happened) and replay (play it again from the
  // same position), so neither can disagree with the engine about a trick.
  reconstruct(round = this.roundNumber) {
    const entries = this.log.filter((entry) => entry.round === round);
    const opening = [...entries].reverse().find((entry) => entry.type === "opening");
    if (!opening) return null;
    // Plays after the last opening: an earlier deal in this round was a misdeal.
    const from = entries.lastIndexOf(opening);
    const plays = entries.slice(from).filter((entry) => entry.type === "play");

    const game = new HeartsGame({ variant: this.variant, mode: this.mode, options: this.options });
    game.resetRound(this.dealerFor(round) ?? game.dealerSeat);
    game.players.forEach((player, seat) => {
      player.hand = (opening.hands[seat] || []).map((card) => ({ ...card }));
      player.taken = [];
      player.tricksWon = 0;
      player.roundPoints = 0;
      player.score = 0;
    });
    Object.assign(game, {
      widow: (opening.widow || []).map((card) => ({ ...card })),
      stock: (opening.stock || []).map((card) => ({ ...card })),
      penaltySuit: opening.penaltySuit || null,
      leadCard: opening.leadCard || null,
      currentTrick: [],
      trickNumber: 0,
      heartsBroken: false,
      held: [],
      passed: {},
    });
    if (opening.bid && game.bidState) {
      game.bidState.highBid = opening.bid;
      game.bidState.highBidder = opening.bidderSeat;
    }
    game.currentSeat = opening.leadSeat;
    return { game, plays, opening };
  }

  // The last of its kind in a round: an earlier deal in the round was thrown in.
  lastEntry(round, type) {
    return [...this.log].reverse().find((e) => e.type === type && e.round === round) || null;
  }

  dealerFor(round) {
    return this.lastEntry(round, "deal")?.dealerSeat ?? null;
  }

  // The hand trick by trick, for the review screen. Built by running the logged
  // plays back through a rebuilt game, so the winners are the engine's.
  roundReview(round = this.roundNumber) {
    const start = this.reconstruct(round);
    if (!start) return null;
    const { game, plays, opening } = start;
    const hands = game.players.map((player) => player.hand.map((card) => ({ ...card })));
    const tricks = [];
    for (const entry of plays) {
      const result = game.playCard(entry.seat, entry.card);
      if (!result.ok) break;
      if (result.trickDone) tricks.push(result.resolved);
    }
    return {
      round,
      dealerSeat: game.dealerSeat,
      passDirection: this.lastEntry(round, "deal")?.passDirection || "none",
      penaltySuit: opening.penaltySuit || null,
      // The cards nobody was dealt: Heartsette's widow, and whatever was left
      // in a Domino stock when the hands ran out.
      widow: opening.widow || [],
      stock: game.stock,
      points: game.players.map((player) => game.pointsTakenBy(player.seat)),
      hands,
      tricks,
    };
  }

  // Everyone still to say yes. Robots always agree, and so does an empty chair.
  outstandingAgreement(proposal) {
    return this.humans()
      .filter((slot) => slot.socketId && slot.userId !== proposal.fromUserId)
      .filter((slot) => !proposal.agreed.includes(slot.userId))
      .map((slot) => slot.userId);
  }

  propose(socket, { type } = {}) {
    if (!["roundEnd", "gameOver"].includes(this.phase) || this.proposal) return;
    if (!["review", "replay"].includes(type)) return;
    if (!this.reconstruct()) return this.reject(socket, "There's nothing to look at in this hand.");
    this.proposal = { type, fromUserId: socket.userId, agreed: [] };
    this.settleProposal();
  }

  respondToProposal(socket, { accept } = {}) {
    if (!this.proposal || socket.userId === this.proposal.fromUserId) return;
    if (!accept) {
      this.proposal = null;
      this.persist();
      this.broadcast();
      return;
    }
    if (!this.proposal.agreed.includes(socket.userId)) this.proposal.agreed.push(socket.userId);
    this.settleProposal();
  }

  settleProposal() {
    if (!this.proposal) return;
    if (this.outstandingAgreement(this.proposal).length > 0) {
      this.persist();
      this.broadcast();
      return;
    }
    const { type, fromUserId } = this.proposal;
    this.proposal = null;
    if (type === "review") this.startReview(fromUserId);
    else this.startReplay();
  }

  startReview(controllerId) {
    this.review = { controllerId, step: 0 };
    this.persist();
    this.broadcast();
  }

  reviewStep(socket, { step } = {}) {
    if (!this.review || socket.userId !== this.review.controllerId) return;
    if (!Number.isInteger(step) || step < 0) return;
    this.review.step = step;
    this.persist();
    this.broadcast();
  }

  reviewDone(socket) {
    if (!this.review || socket.userId !== this.review.controllerId) return;
    this.review = null;
    this.persist();
    this.broadcast();
  }

  // A live, unscored redo of the hand from the first lead. The replay game is
  // swapped in for the real one, so every action works on it unchanged; the
  // real game is held aside and put back when the replay ends.
  startReplay() {
    const start = this.reconstruct();
    if (!start) return;
    this.held = { game: this.game, phase: this.phase, lastTrick: this.lastTrick };
    this.game = start.game;
    this.replaying = true;
    this.lastTrick = null;
    this.phase = "playing";
    this.persist();
    this.broadcast();
    this.scheduleBotTurn();
  }

  // Called by the room when the replayed hand runs out, or by a player who has
  // seen enough.
  endReplay() {
    if (!this.replaying) return;
    const replay = this.game;
    this.replayResult = { points: replay.players.map((p) => replay.pointsTakenBy(p.seat)) };
    this.game = this.held.game;
    this.phase = this.held.phase;
    this.lastTrick = this.held.lastTrick;
    this.held = null;
    this.replaying = false;
    this.persist();
    this.broadcast();
  }

  // ---- robots ----

  botActorSeat() {
    const game = this.game;
    if (!game) return null;
    let seat = null;
    // Passing is simultaneous, so the robots go one at a time in seat order and
    // this reports whichever still owes the table three cards.
    if (this.phase === "passing") {
      seat = game.players.findIndex((p) => this.isBotSeat(p.seat) && !game.passed[p.seat]);
      if (seat < 0) seat = null;
    } else if (this.phase === "bidding") seat = game.bidState?.currentSeat;
    else if (this.phase === "chooseSuit") seat = game.bidState?.highBidder;
    else if (this.phase === "playing") seat = game.currentSeat;
    if (seat === null || seat === undefined) return null;
    return this.isBotSeat(seat) ? seat : null;
  }

  scheduleBotTurn(afterTrick = false) {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const seat = this.botActorSeat();
    if (seat === null) return;
    const wait = this.phase === "passing" ? BOT_PAUSE_PASS : afterTrick ? BOT_PAUSE_AFTER_TRICK : BOT_PAUSE;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        this.runBotTurn(seat);
      } catch (err) {
        console.error(`robot at seat ${seat} in game ${this.id} failed`, err);
      }
    }, wait);
  }

  runBotTurn(seat) {
    // The world may have moved on while the robot was thinking.
    if (this.botActorSeat() !== seat) return;
    const socket = { userId: this.slots[seat].userId, emit: () => {} };
    const game = this.game;

    if (this.phase === "passing") return this.pass(socket, { cards: heartsBot.choosePass(game, seat) });
    if (this.phase === "bidding") return this.bid(socket, { amount: heartsBot.chooseBid(game, seat) });
    if (this.phase === "chooseSuit") return this.chooseSuit(socket, { suit: heartsBot.chooseSuit(game, seat) });
    if (this.phase === "playing") {
      const card = heartsBot.choosePlay(game, seat);
      if (card) this.play(socket, { card });
    }
  }

  // ---- what the client sees ----

  stateFor(userId) {
    const yourSeat = this.seatOf(userId);
    const game = this.game;
    const spec = this.spec();
    const base = {
      gameId: this.id,
      gameType: "hearts",
      variant: this.variant,
      title: spec.label,
      note: spec.note,
      mode: this.mode,
      options: this.options,
      rules: describeHeartsOptions(this.options, this.variant),
      phase: this.phase,
      status: this.status,
      visibility: this.visibility,
      friendly: this.isFriendly(),
      isHost: userId === this.hostUserId,
      gameSettings: this.gameSettings,
      slots: this.slots.map((slot) =>
        slot
          ? { name: slot.name, isBot: Boolean(slot.isBot), connected: Boolean(slot.socketId) }
          : null
      ),
      you: { seat: yourSeat },
      roundNumber: this.roundNumber,
      winner: this.winner,
      lastTrick: this.lastTrick,
      lastResult: this.lastResult,
      history: this.passHistory(userId),
      readyUserIds: [...this.readyUserIds],
      replaying: this.replaying,
      replayResult: this.replayResult || null,
      proposal: this.proposal && {
        type: this.proposal.type,
        fromName: this.slots[this.seatOf(this.proposal.fromUserId)]?.name,
        mine: this.proposal.fromUserId === userId,
        awaitingYou: this.outstandingAgreement(this.proposal).includes(userId),
        waitingOn: this.outstandingAgreement(this.proposal).length,
      },
      // Only while it is open: it carries every hand, which is fine once the
      // hand is over but is not something to broadcast the rest of the time.
      review: this.review && {
        ...this.roundReview(),
        step: this.review.step,
        yours: this.review.controllerId === userId,
      },
      suits: SUITS,
    };
    if (!game) return base;

    return {
      ...base,
      game: {
        players: game.players.map((player) => ({
          seat: player.seat,
          name: this.slots[player.seat]?.name || `Seat ${player.seat + 1}`,
          handSize: player.hand.length,
          score: player.score,
          tricksWon: player.tricksWon,
          team: player.team,
          // What their tricks have cost them so far, which is the one number
          // everybody at a Hearts table is watching.
          taken: game.pointsTakenBy(player.seat),
          passedOn: Boolean(game.passed[player.seat]),
        })),
        target: game.target,
        partnerships: game.partnerships(),
        cardsPerPlayer: game.cardsPerPlayer(),
        dealNumber: game.dealNumber,
        dealerSeat: game.dealerSeat,
        passDirection: game.passDirection,
        passTo: game.passTarget(yourSeat),
        passFrom: game.players.findIndex((p) => game.passTarget(p.seat) === yourSeat),
        heartsBroken: game.heartsBroken,
        trickNumber: game.trickNumber,
        penaltySuit: game.penaltySuit,
        currentSeat: game.currentSeat,
        currentTrick: game.currentTrick,
        bidState: game.bidState,
        stockSize: game.stock.length,
        widowSize: game.widow.length,
        stripped: game.stripped,
        // Everything this seat may do right now, so the client never has to
        // re-derive a rule to decide whether to draw a button.
        hand: game.players[yourSeat]?.hand || [],
        // The cards this seat sent on, kept in front of them until the hand is
        // led — passing three and then forgetting which three is a real way to
        // misplay the first trick.
        passedCards: game.passed[yourSeat] || null,
        legalCards: this.phase === "playing" && game.currentSeat === yourSeat ? game.legalCards(yourSeat) : [],
        penalties: (game.players[yourSeat]?.hand || []).map((card) => game.penaltyOf(card)),
      },
    };
  }

  broadcast() {
    for (const slot of this.slots) {
      if (slot?.socketId && !slot.isBot) this.io.to(slot.socketId).emit("hearts:state", this.stateFor(slot.userId));
    }
  }

  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

module.exports = { HeartsRoom, validHeartsSetup };
