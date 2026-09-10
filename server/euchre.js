// Euchre. One engine covers every rule set described at
// https://en.wikipedia.org/wiki/Euchre — the North American standard, the
// British game, the 1844 rules, three-handed, Bid Euchre and Set-Back — because
// they differ in the pack, the auction and the arithmetic but share a trick.
// The house rules the article lists as regional variations ride in as options.
//
// Kept independent of the 500 engines on purpose: the bowers are shared
// vocabulary, but nothing else about the deal or the scoring is.
const definitions = require("../src/euchreOptions.json");
const { sanitizeEuchreOptions } = require("./euchreOptions");

const SUITS = ["♠", "♥", "♦", "♣"];
// Widest pack any variant uses, low to high. A smaller pack is the top slice.
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };
const FACES = ["J", "Q", "K"];

const VARIANTS = Object.fromEntries(definitions.variants.map((v) => [v.id, v]));
const VARIANT_IDS = definitions.variants.map((v) => v.id);

const sameCard = (a, b) => a && b && a.suit === b.suit && a.value === b.value;
const isBenny = (card) => Boolean(card) && card.suit === "Joker";

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Nine to ace by default; the extra-cards option adds the eights and sevens
// below them, and the Benny is a lone joker that is trump in every hand.
function buildDeck({ ranks, benny }) {
  const values = RANKS.slice(RANKS.length - ranks);
  const deck = SUITS.flatMap((suit) => values.map((value) => ({ suit, value })));
  if (benny) deck.push({ suit: "Joker", value: "Joker" });
  return shuffle(deck);
}

const isRightBower = (card, trumpSuit) =>
  Boolean(trumpSuit) && card.suit === trumpSuit && card.value === "J";

const isLeftBower = (card, trumpSuit) =>
  Boolean(trumpSuit) && card.suit === LEFT_BOWER_SUIT[trumpSuit] && card.value === "J";

// What a card counts as for following suit: both bowers and the Benny are
// trump, everything else is the suit printed on it.
function effectiveSuit(card, trumpSuit) {
  if (isBenny(card)) return trumpSuit || "Joker";
  return isRightBower(card, trumpSuit) || isLeftBower(card, trumpSuit) ? trumpSuit : card.suit;
}

// Comparable within one trick only. `lowNoTrump` inverts the plain ranking,
// which is the whole of Bid Euchre's low no-trump contract.
function cardRank(card, trumpSuit, leadSuit, lowNoTrump = false) {
  if (isBenny(card)) return trumpSuit ? 300 : leadSuit === "Joker" ? 300 : -1;
  const effective = effectiveSuit(card, trumpSuit);
  if (trumpSuit && effective === trumpSuit) {
    if (isRightBower(card, trumpSuit)) return 200;
    if (isLeftBower(card, trumpSuit)) return 190;
    return 100 + RANKS.indexOf(card.value);
  }
  if (effective !== leadSuit) return -1;
  const rank = RANKS.indexOf(card.value);
  return lowNoTrump ? RANKS.length - rank : rank;
}

class EuchreGame {
  constructor({ variant = "northAmerican", mode = 4, options } = {}) {
    this.variant = VARIANTS[variant] ? variant : "northAmerican";
    const spec = VARIANTS[this.variant];
    this.mode = spec.modes.includes(Number(mode)) ? Number(mode) : spec.modes[spec.modes.length - 1];
    this.options = sanitizeEuchreOptions(options, this.variant);
    this.teams = Boolean(spec.teams) && this.mode === 4;
    this.countdown = Boolean(spec.countdown);
    this.target = this.countdown
      ? 0
      : this.options.target === "variant"
      ? spec.target
      : Number(this.options.target);

    const start = this.countdown ? spec.start : 0;
    this.players = Array.from({ length: this.mode }, (_, seat) => ({
      seat,
      hand: [],
      tricksWon: 0,
      score: start,
      team: this.partnerships() ? seat % 2 : null,
      active: true,
      folded: false,
    }));
    this.dealerSeat = 0;
    this.outrightWinner = null;
    this.resetRoundState();
  }

  // Whether this table is scored in pairs. Bid Euchre is individual unless the
  // partnership option is on; the rest follow their rule set at four seats.
  partnerships() {
    if (this.variant === "bid") return this.mode === 4 && Boolean(this.options.bidPartners);
    return Boolean(VARIANTS[this.variant].teams) && this.mode === 4;
  }

  deckSpec() {
    const spec = VARIANTS[this.variant];
    const extra = { none: 0, eights: 1, sevens: 2 }[this.options.extraCards] || 0;
    const ranks = spec.deck === 32 ? 8 : 6 + extra;
    return { ranks, benny: spec.deck === 25 || Boolean(this.options.benny) };
  }

  // Bid Euchre deals the whole pack out and has no kitty, so the hand size —
  // and with it the top bid — follows from the pack.
  cardsPerPlayer() {
    const spec = VARIANTS[this.variant];
    if (spec.cards) return spec.cards;
    const { ranks, benny } = this.deckSpec();
    return Math.floor((ranks * 4 + (benny ? 1 : 0)) / this.mode);
  }

  resetRoundState() {
    this.deck = [];
    this.kitty = [];
    this.upcard = null;
    this.trumpSuit = null;
    this.noTrump = false;
    this.lowNoTrump = false;
    this.callerSeat = null;
    this.makerTeam = null;
    this.alone = false;
    this.aloneDefenderSeat = null;
    this.blindLoner = false;
    this.declaredMarch = false;
    this.callRound = 1;
    this.passes = 0;
    this.stuck = false;
    this.currentSeat = null;
    this.currentTrick = [];
    this.bidState = null;
    this.blindSeat = null;
    this.reliefUsed = [];
    this.pending = [];
    for (const player of this.players) {
      player.hand = [];
      player.tricksWon = 0;
      player.active = true;
      player.folded = false;
    }
  }

  // Deals and returns the phase the table opens on.
  resetRound(dealerSeat = (this.dealerSeat + 1) % this.mode) {
    this.dealerSeat = dealerSeat;
    this.resetRoundState();
    this.deck = buildDeck(this.deckSpec());
    const cards = this.cardsPerPlayer();
    // Packets of two and three, as the article describes, rather than one at a
    // time — it changes nothing but it is how the game is dealt.
    for (const size of [2, 3]) {
      for (const player of this.players) {
        for (let n = 0; n < size && cards > player.hand.length; n += 1) player.hand.push(this.deck.pop());
      }
    }
    for (const player of this.players) {
      while (player.hand.length < cards) player.hand.push(this.deck.pop());
    }

    if (VARIANTS[this.variant].auction) {
      this.bidState = { currentSeat: (this.dealerSeat + 1) % this.mode, calls: [], highBid: null, highBidder: null };
      return "bidding";
    }

    this.kitty = this.deck.splice(0);
    this.upcard = this.kitty[0] || null;
    // Robson rules: a turned jack lets the dealer stake a lone hand blind, so
    // their cards stay face down until they choose.
    if (this.options.robson && this.upcard?.value === "J") this.blindSeat = this.dealerSeat;
    // The Benny can't be ordered up as a suit, so the dealer names one.
    this.currentSeat = isBenny(this.upcard) ? this.dealerSeat : (this.dealerSeat + 1) % this.mode;
    return this.blindSeat === null ? "calling" : "blind";
  }

  // ---- seats and sides ----

  teamOf(seat) {
    return this.players[seat]?.team;
  }

  makerSeats() {
    if (this.callerSeat === null) return [];
    if (!this.partnerships()) return [this.callerSeat];
    return this.players.filter((p) => p.team === this.makerTeam).map((p) => p.seat);
  }

  defenderSeats() {
    const makers = this.makerSeats();
    return this.players.filter((p) => !makers.includes(p.seat)).map((p) => p.seat);
  }

  activeSeats() {
    return this.players.filter((p) => p.active && !p.folded).map((p) => p.seat);
  }

  nextActiveSeat(fromSeat) {
    for (let offset = 1; offset <= this.mode; offset += 1) {
      const seat = (fromSeat + offset) % this.mode;
      if (this.players[seat].active && !this.players[seat].folded) return seat;
    }
    return null;
  }

  // ---- the escape hatches for an unplayable hand ----

  reliefKind(seat) {
    if (this.trumpSuit || this.reliefUsed.includes(seat)) return null;
    const hand = this.players[seat]?.hand || [];
    if (!hand.length) return null;
    if (this.options.farmersHand && hand.every((card) => card.value === "9" || card.value === "10")) {
      return "farmer";
    }
    if (
      this.options.aceNoFace &&
      hand.some((card) => card.value === "A") &&
      !hand.some((card) => FACES.includes(card.value) || isBenny(card))
    ) {
      return "aceNoFace";
    }
    return null;
  }

  // "Going under": the three lowest away, the three beneath the turned card
  // back — which three go is nobody's choice anywhere this is played.
  claimRelief(seat, action) {
    const kind = this.reliefKind(seat);
    if (!kind) return { ok: false, reason: "Your hand doesn't qualify." };
    if (action === "redeal") {
      this.reliefUsed.push(seat);
      return { ok: true, redeal: true };
    }
    const under = this.kitty.slice(1, 4);
    if (under.length < 3) return { ok: false, reason: "There aren't three cards under the turn-up." };
    this.reliefUsed.push(seat);
    const hand = this.players[seat].hand;
    const weakest = [...hand]
      .sort((a, b) => RANKS.indexOf(a.value) - RANKS.indexOf(b.value))
      .slice(0, 3);
    for (const card of weakest) hand.splice(hand.findIndex((c) => sameCard(c, card)), 1);
    hand.push(...under);
    this.kitty.splice(1, 3, ...weakest);
    return { ok: true, kind };
  }

  // ---- making trump from the turned card ----

  // Whether this seat holds enough of a suit to be allowed to name it, for
  // tables that forbid calling on a bare bower.
  holdsEnoughTrump(seat, suit) {
    if (!this.options.trumpNeedsMore || this.isStuck()) return true;
    const hand = [...this.players[seat].hand];
    if (seat === this.dealerSeat && this.callRound === 1 && this.upcard) hand.push(this.upcard);
    const trumps = hand.filter((card) => effectiveSuit(card, suit) === suit);
    return trumps.length > 1 || !trumps.every((card) => card.value === "J");
  }

  canCall(seat, suit) {
    if (seat !== this.currentSeat || !SUITS.includes(suit)) return false;
    // With the Benny turned there is no suit to order up, so the dealer names one.
    if (isBenny(this.upcard)) return seat === this.dealerSeat && this.holdsEnoughTrump(seat, suit);
    // The first round of calling is the turned suit and nothing else; once it
    // has been turned down, the second round is anything but.
    const matchesTurnUp = suit === this.upcard?.suit;
    if (this.callRound === 1 ? !matchesTurnUp : matchesTurnUp) return false;
    return this.holdsEnoughTrump(seat, suit);
  }

  // Whether this seat may sit their partner down. The dealer's partner is made
  // to, at tables that play it that way, and the same seat can't decline.
  aloneRule(seat) {
    if (!VARIANTS[this.variant].alone || !this.partnerships()) return "no";
    const forced =
      (VARIANTS[this.variant].partnerMustGoAlone || this.options.partnerMustGoAlone) &&
      seat === (this.dealerSeat + 2) % this.mode;
    return forced ? "forced" : "may";
  }

  callTrump(seat, suit, alone = false) {
    if (!this.canCall(seat, suit)) {
      return { ok: false, reason: "That suit isn't available to you in this round of calling." };
    }
    const rule = this.aloneRule(seat);
    this.fixTrump(seat, suit, rule === "forced" || (rule === "may" && Boolean(alone)));
    // The turned card is only taken into hand when it is the suit being made;
    // named in the second round it has been turned down and stays put.
    const ordered = this.callRound === 1 && !isBenny(this.upcard);
    if (ordered && this.upcard) {
      this.players[this.dealerSeat].hand.push(this.upcard);
      this.kitty.shift();
      this.upcard = { ...this.upcard, ordered: true };
      return { ok: true, phase: "discard" };
    }
    return { ok: true, phase: this.afterTrumpPhase() };
  }

  fixTrump(seat, suit, alone) {
    this.callerSeat = seat;
    this.makerTeam = this.teamOf(seat);
    this.trumpSuit = suit;
    this.alone = Boolean(alone);
    if (this.alone) {
      const partner = this.players.find((p) => p.team === this.makerTeam && p.seat !== seat);
      if (partner) {
        if (this.options.partnersBest) this.swapWithPartner(seat, partner.seat);
        partner.active = false;
      }
    }
  }

  // Partner's best: the lone hand's worst card for the partner's best, judged
  // against the trump that has just been fixed.
  swapWithPartner(seat, partnerSeat) {
    const byStrength = (hand) =>
      [...hand].sort((a, b) => cardRank(a, this.trumpSuit, null) - cardRank(b, this.trumpSuit, null));
    const worst = byStrength(this.players[seat].hand).find((card) => cardRank(card, this.trumpSuit, null) < 0)
      || byStrength(this.players[seat].hand)[0];
    const best = byStrength(this.players[partnerSeat].hand).pop();
    if (!worst || !best) return;
    const mine = this.players[seat].hand;
    const theirs = this.players[partnerSeat].hand;
    mine.splice(mine.findIndex((c) => sameCard(c, worst)), 1, best);
    theirs.splice(theirs.findIndex((c) => sameCard(c, best)), 1, worst);
  }

  passCall(seat) {
    if (seat !== this.currentSeat) return { ok: false, reason: "It isn't your turn to call." };
    if (isBenny(this.upcard)) return { ok: false, reason: "The Benny is turned — you must name a suit." };
    if (this.isStuck()) return { ok: false, reason: "You're stuck with it — name a suit." };
    this.passes += 1;
    if (this.passes < this.mode) {
      this.currentSeat = (seat + 1) % this.mode;
      return { ok: true, phase: "calling" };
    }
    if (this.callRound === 1) {
      this.callRound = 2;
      this.passes = 0;
      this.currentSeat = (this.dealerSeat + 1) % this.mode;
      return { ok: true, phase: "calling" };
    }
    if (this.options.stickTheDealer) {
      this.currentSeat = this.dealerSeat;
      this.stuck = true;
      return { ok: true, phase: "calling", stuck: true };
    }
    return { ok: true, redeal: true };
  }

  // Set once the auction has come back round to a dealer who may not pass.
  isStuck() {
    return this.stuck;
  }

  discard(seat, card) {
    if (seat !== this.dealerSeat) return { ok: false, reason: "Only the dealer discards." };
    const hand = this.players[seat].hand;
    const index = hand.findIndex((candidate) => sameCard(candidate, card));
    if (index < 0) return { ok: false, reason: "That card isn't in your hand." };
    this.kitty.push(hand.splice(index, 1)[0]);
    return { ok: true, phase: this.afterTrumpPhase() };
  }

  // Robson rules: a lone hand staked on the turned jack, sight unseen.
  takeBlind(seat, blind) {
    if (seat !== this.blindSeat) return { ok: false, reason: "That offer isn't yours." };
    this.blindSeat = null;
    if (!blind) return { ok: true, phase: "calling" };
    this.blindLoner = true;
    this.fixTrump(seat, this.upcard.suit, this.partnerships());
    this.players[this.dealerSeat].hand.push(this.upcard);
    this.kitty.shift();
    this.upcard = { ...this.upcard, ordered: true };
    return { ok: true, phase: "discard" };
  }

  // ---- Bid Euchre's auction ----

  placeBid(seat, amount) {
    if (!this.bidState || seat !== this.bidState.currentSeat) {
      return { ok: false, reason: "It isn't your turn to bid." };
    }
    const bid = Number(amount);
    const max = this.cardsPerPlayer();
    const standing = this.bidState.highBid || 0;
    if (bid !== 0 && (!Number.isInteger(bid) || bid < 1 || bid > max || bid <= standing)) {
      return { ok: false, reason: `Bid a whole number from ${standing + 1} to ${max}, or pass.` };
    }
    this.bidState.calls.push({ seat, bid });
    if (bid > 0) {
      this.bidState.highBid = bid;
      this.bidState.highBidder = seat;
    }
    if (this.bidState.calls.length < this.mode) {
      this.bidState.currentSeat = (seat + 1) % this.mode;
      return { ok: true, phase: "bidding" };
    }
    // Nobody wanted it. The dealer is stuck with the lowest bid where the
    // table plays that way, and otherwise the hand is thrown in.
    if (!this.bidState.highBid) {
      if (!this.options.stickTheDealer) return { ok: true, redeal: true };
      this.bidState.highBid = 1;
      this.bidState.highBidder = this.dealerSeat;
    }
    return { ok: true, phase: "chooseTrump" };
  }

  chooseBidTrump(seat, suit, noTrump = false, lowNoTrump = false) {
    if (!this.bidState || seat !== this.bidState.highBidder) {
      return { ok: false, reason: "The contract isn't yours to name." };
    }
    const wantsNoTrump = Boolean(noTrump) && this.options.noTrumpBids;
    if (!wantsNoTrump && !SUITS.includes(suit)) return { ok: false, reason: "Name a suit." };
    this.callerSeat = seat;
    this.makerTeam = this.teamOf(seat);
    this.trumpSuit = wantsNoTrump ? null : suit;
    this.noTrump = wantsNoTrump;
    this.lowNoTrump = wantsNoTrump && Boolean(lowNoTrump);
    return { ok: true, phase: this.afterTrumpPhase() };
  }

  // ---- the declarations trump leaves open, then play ----

  // Everything a seat may still have to say before the first lead: defending a
  // lone hand alone, declaring for every trick, throwing the hand in.
  pendingActions(seat) {
    const actions = [];
    if (this.alone && this.options.defendAlone && this.partnerships() && this.defenderSeats().includes(seat)) {
      actions.push("defendAlone");
    }
    if (this.variant === "setback" && this.options.declare && seat === this.callerSeat) actions.push("declare");
    if (this.options.folding && ["bid", "setback"].includes(this.variant) && seat !== this.callerSeat) {
      actions.push("fold");
    }
    return actions;
  }

  afterTrumpPhase() {
    this.pending = this.activeSeats().filter((seat) => this.pendingActions(seat).length);
    if (this.pending.length) return "declaring";
    this.currentSeat = this.nextActiveSeat(this.dealerSeat);
    return "playing";
  }

  declare(seat, action) {
    if (!this.pending.includes(seat)) return { ok: false, reason: "There's nothing for you to declare." };
    if (action !== "stay" && !this.pendingActions(seat).includes(action)) {
      return { ok: false, reason: "You can't do that here." };
    }
    if (action === "fold") this.players[seat].folded = true;
    if (action === "declare") this.declaredMarch = true;
    if (action === "defendAlone" && this.aloneDefenderSeat === null) {
      this.aloneDefenderSeat = seat;
      const partner = this.players.find((p) => p.team === this.players[seat].team && p.seat !== seat);
      if (partner) partner.active = false;
      this.pending = this.pending.filter((pendingSeat) => pendingSeat !== partner?.seat);
    }
    this.pending = this.pending.filter((pendingSeat) => pendingSeat !== seat);
    if (this.pending.length) return { ok: true, phase: "declaring" };
    // Everyone folding out from under the bidder leaves nothing to play.
    if (this.activeSeats().length < 2) return { ok: true, phase: "walkover" };
    this.currentSeat = this.nextActiveSeat(this.dealerSeat);
    return { ok: true, phase: "playing" };
  }

  legalCards(seat) {
    if (seat !== this.currentSeat) return [];
    const hand = this.players[seat]?.hand || [];
    if (this.currentTrick.length === 0) return hand;
    const leadSuit = effectiveSuit(this.currentTrick[0].card, this.trumpSuit);
    const followers = hand.filter((card) => effectiveSuit(card, this.trumpSuit) === leadSuit);
    return followers.length ? followers : hand;
  }

  playCard(seat, card) {
    if (seat !== this.currentSeat) return { ok: false, reason: "It isn't your turn." };
    if (!this.legalCards(seat).some((candidate) => sameCard(candidate, card))) {
      return { ok: false, reason: "You have to follow suit when you can." };
    }
    const hand = this.players[seat].hand;
    hand.splice(hand.findIndex((candidate) => sameCard(candidate, card)), 1);
    this.currentTrick.push({ seat, card });
    if (this.currentTrick.length < this.activeSeats().length) {
      this.currentSeat = this.nextActiveSeat(seat);
      return { ok: true, trickDone: false };
    }
    const leadSuit = effectiveSuit(this.currentTrick[0].card, this.trumpSuit);
    const rank = (play) => cardRank(play.card, this.trumpSuit, leadSuit, this.lowNoTrump);
    const winner = this.currentTrick.reduce((best, play) => (rank(play) > rank(best) ? play : best));
    this.players[winner.seat].tricksWon += 1;
    const resolved = {
      cards: [...this.currentTrick],
      winnerSeat: winner.seat,
      winningCard: winner.card,
      trumpSuit: this.trumpSuit,
    };
    this.currentTrick = [];
    this.currentSeat = winner.seat;
    const finished = this.activeSeats().every((s) => this.players[s].hand.length === 0);
    return { ok: true, trickDone: true, resolved, finished };
  }

  // ---- scoring ----

  tricksNeeded() {
    if (this.variant === "bid") return this.bidState?.highBid || 0;
    if (this.variant === "threeHanded") return 4;
    return Math.ceil(this.cardsPerPlayer() / 2);
  }

  makerTricks() {
    return this.makerSeats().reduce((sum, seat) => sum + this.players[seat].tricksWon, 0);
  }

  scoreRound() {
    const delta = this.players.map(() => 0);
    const tricks = this.makerTricks();
    const needed = this.tricksNeeded();
    const made = tricks >= needed;
    let keepDeal = false;

    if (this.variant === "bid") this.scoreBid(delta, made);
    else if (this.variant === "setback") this.scoreSetback(delta, made, tricks);
    else if (this.variant === "threeHanded") this.scoreThreeHanded(delta, made, tricks);
    else keepDeal = this.scoreStandard(delta, made, tricks);

    for (const player of this.players) player.score += delta[player.seat];
    return { delta, tricks, needed, made, keepDeal, alone: this.alone, marched: tricks === this.cardsPerPlayer() };
  }

  // The North American, British and 1844 games: one point for the contract,
  // two for a march, four for a lone march, two to the defenders for a euchre.
  scoreStandard(delta, made, tricks) {
    const marched = tricks === this.cardsPerPlayer();
    const makers = this.makerSeats();
    const defenders = this.defenderSeats();
    let keepDeal = false;

    if (made) {
      let points = marched ? (this.alone ? (this.blindLoner ? 5 : 4) : 2) : 1;
      if (this.options.pointOnPartner && this.callerSeat === (this.dealerSeat + 2) % this.mode && this.partnerships()) {
        points += 1;
        keepDeal = true;
      }
      // Robson rules: take a march off the other side instead, where they have
      // the points to lose — worth more than adding them when they're close.
      if (this.options.robson && marched && defenders.every((seat) => this.players[seat].score >= points)) {
        for (const seat of defenders) delta[seat] -= points;
      } else {
        for (const seat of makers) delta[seat] += points;
      }
      return keepDeal;
    }

    if (this.blindLoner) {
      for (const seat of defenders) delta[seat] += 1;
      return keepDeal;
    }
    const euchre = this.aloneDefenderSeat !== null ? 4 : 2;
    if (this.partnerships()) {
      for (const seat of defenders) delta[seat] += euchre;
    } else {
      // Individual play: the euchre goes to whoever actually stopped it.
      const most = Math.max(...defenders.map((seat) => this.players[seat].tricksWon));
      const best = defenders.filter((seat) => this.players[seat].tricksWon === most);
      for (const seat of best) delta[seat] += best.length > 1 ? 1 : euchre;
    }
    return keepDeal;
  }

  // Three-handed: four tricks for a point, six for two, all seven for four.
  scoreThreeHanded(delta, made, tricks) {
    if (made) {
      delta[this.callerSeat] += tricks === 7 ? 4 : tricks >= 6 ? 2 : 1;
      return;
    }
    const defenders = this.defenderSeats();
    const most = Math.max(...defenders.map((seat) => this.players[seat].tricksWon));
    const best = defenders.filter((seat) => this.players[seat].tricksWon === most);
    for (const seat of best) delta[seat] += best.length > 1 ? 1 : 2;
  }

  // Bid Euchre: everyone comes down by their tricks, a missed bid goes up five,
  // and so does anyone who stayed in and took nothing.
  scoreBid(delta, made) {
    const sides = this.partnerships()
      ? [0, 1].map((team) => this.players.filter((p) => p.team === team).map((p) => p.seat))
      : this.players.map((p) => [p.seat]);
    for (const side of sides) {
      if (side.every((seat) => this.players[seat].folded)) continue;
      const won = side.reduce((sum, seat) => sum + this.players[seat].tricksWon, 0);
      const isMaker = side.includes(this.callerSeat);
      const points = -won + (won === 0 && !isMaker ? 5 : 0) + (isMaker && !made ? 5 : 0);
      for (const seat of side) delta[seat] += points;
    }
  }

  // Set-Back: tricks come off, a blank hand goes up one, a euchred maker two.
  scoreSetback(delta, made, tricks) {
    if (this.declaredMarch && this.callerSeat !== null) {
      if (tricks === this.cardsPerPlayer()) this.outrightWinner = this.callerSeat;
      else delta[this.callerSeat] += this.players[this.callerSeat].score;
    }
    for (const player of this.players) {
      if (player.folded) continue;
      if (player.seat === this.callerSeat && this.declaredMarch) continue;
      delta[player.seat] -= player.tricksWon;
      if (player.tricksWon === 0 && player.seat !== this.callerSeat) delta[player.seat] += 1;
    }
    if (!made && this.callerSeat !== null && !this.declaredMarch) {
      delta[this.callerSeat] += 2;
      if (this.options.defendersDeduct) {
        for (const seat of this.defenderSeats()) delta[seat] -= 2;
      }
    }
  }

  // ---- who has won ----

  sides() {
    if (!this.partnerships()) return this.players.map((p) => [p.seat]);
    return [0, 1].map((team) => this.players.filter((p) => p.team === team).map((p) => p.seat));
  }

  winners() {
    if (this.outrightWinner !== null) return this.makerSeats();
    const scoreOf = (side) => this.players[side[0]].score;
    const home = this.sides().filter((side) =>
      this.countdown ? scoreOf(side) <= 0 : scoreOf(side) >= this.target
    );
    if (!home.length) return [];
    // Two sides crossing the line together goes to the further-past one.
    const best = home.reduce((a, b) =>
      (this.countdown ? scoreOf(b) < scoreOf(a) : scoreOf(b) > scoreOf(a)) ? b : a
    );
    return best;
  }
}

module.exports = {
  SUITS,
  RANKS,
  VARIANTS,
  VARIANT_IDS,
  EuchreGame,
  buildDeck,
  sameCard,
  isBenny,
  effectiveSuit,
  cardRank,
  isLeftBower,
  isRightBower,
};
