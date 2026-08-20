// One hand of four-player 500, driven a decision at a time.
//
// Room4 walks a hand by way of sockets, timers and broadcasts; a trainer needs
// the same walk with none of that — deal, ask a seat for a number, apply it,
// repeat, and hand back a score at the end. This is that walk, and it is
// deliberately the only place outside room4.js that knows the order of a hand,
// so the sequence a policy is trained on is the sequence it will meet.
//
// The two multi-card decisions (the kitty discard, Double Nullo's exchange) are
// broken into one decision per card. Choosing three of thirteen as a single
// action would be a 286-way choice that shares nothing between its options;
// three choices of one card reuse the same card-picking head the play phase
// already needs.
const { Game500Four } = require("./game4");
const { decodeAction, encodeObservation, legalActionMask } = require("./obs");

const sameCard = (a, b) => a.suit === b.suit && a.value === b.value;

// A hand can't take many more decisions than this: ten tricks of four cards,
// three discards, ten passed cards and an auction. Well past that and something
// has gone wrong, and a trainer that silently spins is worse than one that stops.
const MAX_STEPS = 200;

class Episode {
  // `passOutPenalty` is the reward for a hand nobody bid, which the rules throw
  // in and redeal. Zero is the honest value — passing costs a real table
  // nothing — but if self-play collapses into a table that never bids, a small
  // penalty here is the lever that breaks it.
  // `teamScores` and `barredSeats` exist so a trainer can vary them. Both are
  // in the observation and both are real at a live table — a game is at 460–390
  // by the end, and the Ralphing rule bars a seat that went down badly — so
  // leaving them fixed at nothing here would train weights that only ever see
  // zero and then meet something else in production.
  constructor(
    options = {},
    dealerSeat = 0,
    { passOutPenalty = 0, teamScores = [0, 0], barredSeats = [] } = {}
  ) {
    this.game = new Game500Four(options);
    this.game.players.forEach((player, seat) => {
      player.id = `seat${seat}`;
      player.name = `Seat ${seat}`;
      player.isBot = true;
    });
    // Negated once here so that the default of no penalty is a plain zero
    // rather than the -0 that negating it would otherwise produce.
    this.passOutReward = passOutPenalty === 0 ? 0 : -passOutPenalty;
    this.done = false;
    this.rewards = [0, 0, 0, 0];
    this.info = {};
    this.steps = 0;
    // The sequential pick in progress, if any: whose it is, what's left to pick
    // from and what they've taken so far.
    this.pick = null;
    this.exchangeQueue = [];

    // Set before the deal so the auction sees them. The score only reaches the
    // observation — scoreRound works in deltas, so the reward for a hand is the
    // same whatever the game stood at when it started.
    this.game.teamScores = [...teamScores];
    this.game.deal(dealerSeat);
    this.state = "bid";
    if (barredSeats.length > 0) {
      this.game.barFromBidding(barredSeats);
      // Barring everyone who could speak ends the auction before it starts.
      if (this.game.auction.complete) this.settleAuction();
    }
  }

  // ---- what's being asked ----

  decision() {
    if (this.done) return null;
    if (this.state === "bid") return { seat: this.game.auction.turnSeat, kind: "bid" };
    if (this.state === "play") return { seat: this.game.currentSeat, kind: "play" };
    return { seat: this.pick.seat, kind: this.pick.kind };
  }

  context() {
    const decision = this.decision();
    if (!decision) return null;
    if (!this.pick) return { kind: decision.kind };
    return {
      kind: this.pick.kind,
      pool: this.pick.pool,
      chosen: this.pick.chosen,
      picksRemaining: this.pick.needed - this.pick.chosen.length,
    };
  }

  // The seat to act, what it can see and what it may do — everything a policy
  // needs and nothing it shouldn't have.
  observation() {
    const decision = this.decision();
    if (!decision) return null;
    const context = this.context();
    return {
      seat: decision.seat,
      kind: decision.kind,
      obs: encodeObservation(this.game, decision.seat, context),
      mask: legalActionMask(this.game, decision.seat, context),
    };
  }

  // ---- applying a decision ----

  // An action outside the mask is a bug in the encoder or the caller, and it
  // throws rather than falling back to something legal: a trainer quietly
  // playing a different card than the one it chose would poison every gradient
  // after it.
  step(action) {
    const decision = this.decision();
    if (!decision) throw new Error("the hand is already over");
    if (++this.steps > MAX_STEPS) throw new Error("the hand never finished");

    const choice = decodeAction(action);
    if (this.state === "bid") this.applyBid(decision.seat, choice);
    else if (this.state === "play") this.applyPlay(decision.seat, choice);
    else this.applyPick(choice);

    return this.observation();
  }

  applyBid(seat, choice) {
    const result = this.game.bid(seat, choice.bid);
    if (!result.ok) throw new Error(`illegal call ${choice.bid}: ${result.reason}`);
    if (this.game.auction.complete) this.settleAuction();
  }

  settleAuction() {
    const contract = this.game.completeBidding();
    this.game.blindSeats = [];

    if (!contract) {
      // Nobody bid: the table either plays it out at no trumps for trick points
      // or throws the hand in.
      if (this.game.options.allPassNoTrump) this.state = "play";
      else this.finish({ passedOut: true });
      return;
    }

    this.game.takeKitty(contract.seat);
    this.beginPick(contract.seat, "discard", 3);
  }

  beginPick(seat, kind, needed) {
    this.pick = { seat, kind, pool: [...this.game.players[seat].hand], chosen: [], needed };
    this.state = kind;
  }

  applyPick(choice) {
    const index = this.pick.pool.findIndex((card) => sameCard(card, choice.card));
    if (index === -1) {
      throw new Error(`${choice.card.value}${choice.card.suit} isn't available to pick`);
    }
    this.pick.chosen.push(this.pick.pool.splice(index, 1)[0]);
    if (this.pick.chosen.length < this.pick.needed) return;
    if (this.pick.kind === "discard") this.finishDiscard();
    else this.finishPass();
  }

  // What's left in the pool is what the bidder keeps.
  finishDiscard() {
    const { seat, pool } = this.pick;
    const result = this.game.discard(seat, pool);
    if (!result.success) throw new Error(`discard rejected: ${result.reason}`);
    this.pick = null;

    const seats = this.game.exchangeSeats();
    if (!seats) {
      this.state = "play";
      return;
    }
    // Both partners choose before either sees the other's five, so they're
    // asked one after the other and the swap happens once both have.
    this.exchangeQueue = [...seats];
    this.nextPass();
  }

  nextPass() {
    this.beginPick(this.exchangeQueue.shift(), "pass", 5);
  }

  finishPass() {
    const { seat, chosen } = this.pick;
    const result = this.game.setPass(seat, chosen);
    if (!result.success) throw new Error(`pass rejected: ${result.reason}`);
    this.pick = null;
    if (this.exchangeQueue.length > 0) {
      this.nextPass();
      return;
    }
    this.game.completeExchange();
    this.state = "play";
  }

  applyPlay(seat, choice) {
    const played = this.game.playCard(seat, choice.card, choice.nominatedSuit);
    if (!played.success) throw new Error(`play rejected: ${played.reason}`);

    if (this.game.trickIsComplete()) this.game.resolveTrick();
    else this.game.currentSeat = this.game.nextActiveSeat(seat);

    if (this.game.isRoundDecided()) this.finish({});
  }

  // ---- the score ----

  // Reward is how far your side got *ahead* over the hand — your points less
  // theirs — in units of the 500 it takes to win.
  //
  // The difference matters, and not taking it is a trap: scoreRound gives the
  // defenders ten a trick whatever happens, so a team's own delta is never
  // negative when the other side is bidding. Rewarding that directly pays a
  // defender +0.04 for watching the opponents make 8♠, which makes defending
  // risk-free and bidding the only way to lose — and a policy trained on it
  // learns, entirely correctly, never to bid at all.
  //
  // Taking the difference also makes a hand zero-sum, so partners score alike,
  // opponents score exactly opposite, and there is no way to profit except by
  // beating the other partnership.
  finish({ passedOut = false }) {
    this.done = true;
    if (passedOut) {
      this.rewards = [0, 1, 2, 3].map(() => this.passOutReward);
      this.info = { passedOut: true, deltas: [0, 0] };
      return;
    }
    const result = this.game.scoreRound();
    this.rewards = [0, 1, 2, 3].map((seat) => {
      const team = this.game.teamOf(seat);
      return (result.deltas[team] - result.deltas[1 - team]) / 500;
    });
    this.info = { ...result, passedOut: false };
  }
}

module.exports = { Episode, MAX_STEPS };
