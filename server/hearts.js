// Hearts. One engine covers every rule set described at
// https://en.wikipedia.org/wiki/Hearts_(card_game) — the 1887 original, plain
// Hearts, Black Lady, Black Maria, Omnibus, Spot, Black Jack, Greek, Chasse
// Coeur, Joker, Royal, Partnership, Heartsette, Auction, Domino and
// Cancellation — because they differ in which cards cost and in how the deal is
// put together, and share a trick where the highest card of the suit led wins.
// The rule variations the article lists ride in as options.
//
// Kept independent of the 500 and Euchre engines: there is no trump here, no
// bower, and the object is to lose rather than to win, so nothing about their
// vocabulary transfers.
const definitions = require("../src/heartsOptions.json");
const { sanitizeHeartsOptions, resolveRules } = require("./heartsOptions");

const SUITS = ["♠", "♥", "♦", "♣"];
// Low to high, which is the order every comparison here wants.
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const VARIANTS = Object.fromEntries(definitions.variants.map((v) => [v.id, v]));
const VARIANT_IDS = definitions.variants.map((v) => v.id);

const isJoker = (card) => Boolean(card) && card.suit === "Joker";
const cardId = (card) => (isJoker(card) ? "Joker" : `${card.value}${card.suit}`);
const sameCard = (a, b) => a && b && a.suit === b.suit && a.value === b.value;
const rankOf = (card) => RANKS.indexOf(card.value);

// The order cards come out of the pack to make it divide evenly among however
// many are sitting down. Three players lose the 2♣, five the 2♣ and 2♦, six
// those plus the 2♠ and the 3♣ — which is what the article prescribes, and
// what taking this list in order produces. Hearts are never on it: they are
// what the game is about.
const STRIP_ORDER = RANKS.slice(0, 11).flatMap((value) =>
  ["♣", "♦", "♠"].map((suit) => `${value}${suit}`)
);

// Hearts graded rather than counted, which is Spot Hearts and both of the
// alternatives the 1887 rules printed alongside a chip a heart.
const SCALES = {
  spots: { A: 14, K: 13, Q: 12, J: 11 },
  low: { A: 5, K: 4, Q: 3, J: 2 },
  greek: { A: 15, K: 10, Q: 10, J: 10 },
};

function scaleValue(value, scale) {
  const table = SCALES[scale] || SCALES.spots;
  return table[value] ?? Number(value);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function buildDeck({ packs = 1, jokers = 0, strip = [] } = {}) {
  const deck = [];
  for (let pack = 0; pack < packs; pack += 1) {
    for (const suit of SUITS) for (const value of RANKS) deck.push({ suit, value });
    for (let n = 0; n < jokers; n += 1) deck.push({ suit: "Joker", value: "Joker" });
  }
  return deck.filter((card) => !strip.includes(cardId(card)));
}

class HeartsGame {
  constructor({ variant = "blackLady", mode = 4, options } = {}) {
    this.variant = VARIANTS[variant] ? variant : "blackLady";
    const spec = VARIANTS[this.variant];
    this.mode = spec.modes.includes(Number(mode)) ? Number(mode) : spec.modes[0];
    this.options = sanitizeHeartsOptions(options, this.variant);
    this.rules = resolveRules(this.options, this.variant);
    this.teams = this.partnerships();
    this.target = Number(this.rules.target);
    this.dealNumber = 0;

    this.players = Array.from({ length: this.mode }, (_, seat) => ({
      seat,
      hand: [],
      taken: [],
      tricksWon: 0,
      roundPoints: 0,
      score: 0,
      team: this.partnerships() ? seat % 2 : null,
    }));
    this.dealerSeat = 0;
    this.resetRoundState();
  }

  spec() {
    return VARIANTS[this.variant];
  }

  // Only Partnership Hearts pairs people off, and only where the table has
  // agreed to keep one score between them.
  partnerships() {
    const spec = VARIANTS[this.variant];
    return Boolean(spec.teams) && this.mode === 4 && this.options.partnerStyle !== "individual";
  }

  // ---- the pack ----

  deckSpec() {
    const spec = this.spec();
    return {
      packs: spec.deck === 104 ? 2 : 1,
      jokers: spec.deck === "jokers" || this.rules.jokers ? 2 : 0,
      strip: spec.strip || [],
    };
  }

  // The pack this table deals, cut down until it goes round evenly. Domino
  // Hearts leaves everything over as a stock, so it never strips anything.
  dealtDeck() {
    const spec = this.spec();
    const shape = this.deckSpec();
    const strip = [...shape.strip];
    let deck = buildDeck({ ...shape, strip });
    if (spec.stock) return { deck, strip };
    const widow = spec.widow || 0;
    for (const id of STRIP_ORDER) {
      if ((deck.length - widow) % this.mode === 0) break;
      strip.push(id);
      deck = deck.filter((card) => cardId(card) !== id);
    }
    return { deck, strip };
  }

  cardsPerPlayer() {
    const spec = this.spec();
    if (spec.cards) return spec.cards;
    const { deck } = this.dealtDeck();
    return Math.floor((deck.length - (spec.widow || 0)) / this.mode);
  }

  // ---- what a card costs ----

  // Most specific match wins: one named card beats a rank beats a whole suit.
  // Negative points are the bonus cards — Omnibus' ten of diamonds and Royal
  // Hearts' queen of diamonds — which come off rather than on.
  penaltyOf(card) {
    if (isJoker(card)) return 0;
    const penalties = this.spec().penalties;
    const named = penalties.find((p) => p.kind === "card" && p.value === card.value && p.suit === card.suit);
    if (named) return named.points;
    const ranked = penalties.find((p) => p.kind === "value" && p.value === card.value);
    if (ranked) return ranked.points;
    if (card.suit === "♥" && this.rules.heartChips && this.rules.heartChips !== "plain") {
      return scaleValue(card.value, this.rules.heartChips);
    }
    for (const p of penalties) {
      if (p.kind === "suit" && p.suit === card.suit) return p.points;
      if (p.kind === "scale" && p.suit === card.suit) return scaleValue(card.value, p.scale);
      if (p.kind === "bidSuit" && this.penaltySuit && card.suit === this.penaltySuit) return p.points;
    }
    return 0;
  }

  isPenalty(card) {
    return this.penaltyOf(card) > 0;
  }

  isBonus(card) {
    return this.penaltyOf(card) < 0;
  }

  // ---- dealing ----

  resetRoundState() {
    this.deck = [];
    this.stripped = [];
    this.widow = [];
    this.stock = [];
    this.held = [];
    this.currentSeat = null;
    this.currentTrick = [];
    this.trickSeats = [];
    this.trickNumber = 0;
    this.heartsBroken = false;
    this.passDirection = "none";
    this.passed = {};
    this.bidState = null;
    this.penaltySuit = null;
    this.leadCard = null;
    this.moon = null;
    for (const player of this.players) {
      player.hand = [];
      player.taken = [];
      player.tricksWon = 0;
      player.roundPoints = 0;
    }
  }

  // Which way the three cards go this deal. The rotating cycle is left, right,
  // across and then a hold; a table that isn't four has no "across", so it
  // rotates through the three it does have.
  directionFor(dealNumber) {
    const setting = this.rules.passing;
    if (setting === "none") return "none";
    const cycle = this.mode === 4 ? ["left", "right", "across", "hold"] : ["left", "right", "hold"];
    if (setting === "cycle") return cycle[(dealNumber - 1) % cycle.length];
    if (setting === "across" && this.mode !== 4) return "left";
    return setting;
  }

  passTarget(seat) {
    if (this.passDirection === "left") return (seat + 1) % this.mode;
    if (this.passDirection === "right") return (seat - 1 + this.mode) % this.mode;
    if (this.passDirection === "across") return (seat + this.mode / 2) % this.mode;
    return null;
  }

  // Deals and returns the phase the table opens on.
  // A redeal is the same deal again: it keeps the deal number, so the passing
  // cycle and any agreed limit on deals aren't spent by a hand nobody played.
  resetRound(dealerSeat = (this.dealerSeat + 1) % this.mode, redeal = false) {
    this.dealerSeat = dealerSeat;
    if (!redeal) this.dealNumber += 1;
    this.resetRoundState();
    const spec = this.spec();
    const { deck, strip } = this.dealtDeck();
    this.stripped = strip;
    this.deck = shuffle(deck);
    const cards = spec.cards || Math.floor((this.deck.length - (spec.widow || 0)) / this.mode);
    for (const player of this.players) player.hand = this.deck.splice(0, cards);
    if (spec.widow) this.widow = this.deck.splice(0, spec.widow);
    if (spec.stock) this.stock = this.deck.splice(0);

    if (spec.auction) {
      this.bidState = { currentSeat: (this.dealerSeat + 1) % this.mode, calls: [], highBid: null, highBidder: null };
      return "bidding";
    }
    this.passDirection = this.directionFor(this.dealNumber);
    if (this.passTarget(0) !== null) return "passing";
    return this.startPlay();
  }

  // A hand of nothing but cards that cost can't obey the rule about the first
  // trick, so some tables throw it in.
  misdealSeat() {
    if (!this.rules.misdealOnAllPenalties) return null;
    const stuck = this.players.find((p) => p.hand.length && p.hand.every((card) => this.isPenalty(card)));
    return stuck ? stuck.seat : null;
  }

  // ---- passing ----

  choosePass(seat, cards) {
    if (this.passed[seat]) return { ok: false, reason: "You have already passed." };
    const want = Array.isArray(cards) ? cards : [];
    if (want.length !== 3) return { ok: false, reason: "Pass exactly three cards." };
    const hand = this.players[seat].hand;
    const picked = [];
    for (const card of want) {
      const match = hand.find((c) => sameCard(c, card) && !picked.includes(c));
      if (!match) return { ok: false, reason: "Those cards aren't all in your hand." };
      picked.push(match);
    }
    this.passed[seat] = picked.map((card) => ({ ...card }));
    if (Object.keys(this.passed).length < this.mode) return { ok: true, phase: "passing" };
    this.applyPasses();
    return { ok: true, phase: this.startPlay() };
  }

  applyPasses() {
    const incoming = this.players.map(() => []);
    for (const player of this.players) {
      const going = this.passed[player.seat];
      for (const card of going) {
        player.hand.splice(player.hand.findIndex((c) => sameCard(c, card)), 1);
      }
      incoming[this.passTarget(player.seat)].push(...going);
    }
    this.players.forEach((player, seat) => player.hand.push(...incoming[seat]));
  }

  // ---- Auction Hearts ----

  placeBid(seat, amount) {
    if (!this.bidState || seat !== this.bidState.currentSeat) {
      return { ok: false, reason: "It isn't your turn to bid." };
    }
    const bid = Number(amount);
    const standing = this.bidState.highBid || 0;
    if (bid !== 0 && (!Number.isInteger(bid) || bid < 1 || bid > 20 || bid <= standing)) {
      return { ok: false, reason: `Bid a whole number from ${standing + 1} to 20, or pass.` };
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
    // Nobody wanted it, so the eldest hand takes it for a single chip rather
    // than the deal being wasted.
    if (!this.bidState.highBid) {
      this.bidState.highBid = 1;
      this.bidState.highBidder = (this.dealerSeat + 1) % this.mode;
    }
    return { ok: true, phase: "chooseSuit" };
  }

  chooseSuit(seat, suit) {
    if (!this.bidState || seat !== this.bidState.highBidder) {
      return { ok: false, reason: "The suit isn't yours to name." };
    }
    if (!SUITS.includes(suit)) return { ok: false, reason: "Name a suit." };
    this.penaltySuit = suit;
    return { ok: true, phase: this.startPlay() };
  }

  // ---- play ----

  // Who leads the first trick, and with what. The modern game fixes both by
  // naming the two of clubs; where the table size has stripped that card out,
  // the lowest club still in the pack stands in for it.
  openingLead() {
    const spec = this.spec();
    if (spec.auction) return { seat: this.bidState.highBidder, card: null };
    if (this.rules.lead !== "twoOfClubs") return { seat: (this.dealerSeat + 1) % this.mode, card: null };
    for (const value of RANKS) {
      const holder = this.players.find((p) => p.hand.some((c) => c.suit === "♣" && c.value === value));
      if (holder) return { seat: holder.seat, card: { suit: "♣", value } };
    }
    return { seat: (this.dealerSeat + 1) % this.mode, card: null };
  }

  startPlay() {
    const opening = this.openingLead();
    this.currentSeat = opening.seat;
    this.leadCard = opening.card;
    this.openTrick();
    return "playing";
  }

  // Who is still in the deal. Everywhere but Domino Hearts that is everybody
  // until the hands run out together; there, hands grow and shrink at different
  // rates and a player who has run out simply sits the rest of it out.
  seatsHolding() {
    return this.players.filter((p) => p.hand.length).map((p) => p.seat);
  }

  // The seats that will play to the trick about to be led, in order from the
  // leader — fixed at the lead, so somebody running out part way through it
  // doesn't change how many cards the trick is waiting for.
  openTrick() {
    const holding = this.seatsHolding();
    this.trickSeats = Array.from({ length: this.mode }, (_, i) => (this.currentSeat + i) % this.mode).filter(
      (seat) => holding.includes(seat)
    );
  }

  // Clockwise from a seat to the next one still holding cards.
  nextHolding(from) {
    for (let offset = 1; offset <= this.mode; offset += 1) {
      const seat = (from + offset) % this.mode;
      if (this.players[seat].hand.length) return seat;
    }
    return null;
  }

  // Domino Hearts: a player who cannot follow draws from the stock, one card at
  // a time, until they can. Done as the turn arrives rather than when a card is
  // chosen, so everyone watches the hand grow before it is played from.
  drawIfStuck() {
    const spec = this.spec();
    if (!spec.stock || !this.currentTrick.length) return [];
    const suit = this.leadSuit();
    const hand = this.players[this.currentSeat].hand;
    const drawn = [];
    while (this.stock.length && !hand.some((card) => card.suit === suit)) {
      const card = this.stock.pop();
      hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  leadSuit() {
    const led = this.currentTrick.find((play) => !isJoker(play.card));
    return led ? led.card.suit : null;
  }

  legalCards(seat) {
    if (seat !== this.currentSeat) return [];
    const hand = this.players[seat]?.hand || [];
    if (!hand.length) return [];
    // The opening lead is a named card wherever the table plays it that way.
    if (this.leadCard && !this.trickNumber && !this.currentTrick.length) {
      return hand.filter((card) => sameCard(card, this.leadCard));
    }
    const jokers = hand.filter(isJoker);
    if (this.currentTrick.length) {
      const suit = this.leadSuit();
      const following = hand.filter((card) => card.suit === suit);
      const free = following.length ? [] : hand.filter((card) => !isJoker(card));
      const playable = [...following, ...free, ...jokers];
      return this.firstTrickFilter(playable);
    }
    // Leading. Hearts stay down until they are broken, unless there is nothing
    // else left to lead.
    let playable = hand;
    if (this.rules.breakHearts && !this.heartsBroken) {
      const others = hand.filter((card) => card.suit !== "♥");
      if (others.length) playable = others;
    }
    return this.firstTrickFilter(playable);
  }

  // Nothing that costs on the first trick, where the table plays it that way —
  // and the restriction lifts for a hand that holds nothing else.
  firstTrickFilter(playable) {
    if (this.trickNumber !== 0 || !this.rules.noPointsFirstTrick) return playable;
    // Lifts for a hand that holds nothing else, which is the alternative the
    // rules offer to calling a misdeal.
    const safe = playable.filter((card) => !this.isPenalty(card));
    return safe.length ? safe : playable;
  }

  playCard(seat, card) {
    if (seat !== this.currentSeat) return { ok: false, reason: "It isn't your turn." };
    if (!this.legalCards(seat).some((candidate) => sameCard(candidate, card))) {
      return { ok: false, reason: "You can't play that card to this trick." };
    }
    const hand = this.players[seat].hand;
    const played = hand.splice(hand.findIndex((candidate) => sameCard(candidate, card)), 1)[0];
    this.currentTrick.push({ seat, card: played });
    if (played.suit === "♥") this.heartsBroken = true;

    if (this.currentTrick.length < this.trickSeats.length) {
      this.currentSeat = this.trickSeats[this.currentTrick.length];
      const drawn = this.drawIfStuck();
      return { ok: true, trickDone: false, drawn };
    }
    return this.resolveTrick();
  }

  // The highest card of the suit led takes it. Jokers never win one, and in
  // Cancellation Hearts a card played twice knocks both copies out — cancel
  // every candidate and nobody wins it, so the cards ride on the next trick.
  resolveTrick() {
    const suit = this.leadSuit();
    const counts = {};
    for (const play of this.currentTrick) counts[cardId(play.card)] = (counts[cardId(play.card)] || 0) + 1;
    const cancelled = this.spec().cancel
      ? this.currentTrick.filter((play) => counts[cardId(play.card)] > 1)
      : [];
    const contenders = this.currentTrick.filter(
      (play) => !isJoker(play.card) && play.card.suit === suit && !cancelled.includes(play)
    );
    const cards = [...this.currentTrick];
    this.currentTrick = [];
    this.trickNumber += 1;

    if (!contenders.length) {
      // Held over: the same seat leads again and whoever takes that trick takes
      // this one with it. Nothing left to lead and it falls to whoever led it.
      this.held.push(...cards);
      this.currentSeat = cards[0].seat;
      const finished = this.seatsHolding().length < 2;
      if (finished) {
        this.players[cards[0].seat].taken.push(...this.held.map((play) => play.card));
        this.held = [];
      } else this.openTrick();
      return {
        ok: true,
        trickDone: true,
        resolved: { cards, winnerSeat: null, winningCard: null, cancelled: cancelled.map((p) => p.card) },
        finished,
      };
    }

    const winner = contenders.reduce((best, play) => (rankOf(play.card) > rankOf(best.card) ? play : best));
    const taken = [...cards, ...this.held];
    // Heartsette: the widow goes to whoever wins the first trick, hearts and
    // all, and nobody has seen what is in it.
    const widow = this.trickNumber === 1 && this.widow.length ? this.widow.splice(0) : [];
    this.players[winner.seat].taken.push(...taken.map((play) => play.card), ...widow);
    this.players[winner.seat].tricksWon += 1;
    this.held = [];
    // The winner leads the next trick — or, where they have run out, the next
    // seat round that hasn't.
    this.currentSeat = this.players[winner.seat].hand.length ? winner.seat : this.nextHolding(winner.seat);
    const finished = this.seatsHolding().length < 2;
    if (!finished) this.openTrick();
    return {
      ok: true,
      trickDone: true,
      resolved: {
        cards,
        winnerSeat: winner.seat,
        winningCard: winner.card,
        cancelled: cancelled.map((p) => p.card),
        widow,
      },
      finished,
    };
  }

  // ---- scoring ----

  sides() {
    if (!this.partnerships()) return this.players.map((p) => [p.seat]);
    return [0, 1].map((team) => this.players.filter((p) => p.team === team).map((p) => p.seat));
  }

  // What one seat's tricks cost them, before any moon is taken into account.
  pointsTakenBy(seat) {
    const taken = this.players[seat].taken;
    let points = taken.reduce((sum, card) => sum + this.penaltyOf(card), 0);
    if (this.spec().specials?.includes("royalQueens")) {
      const has = (value, suit) => taken.some((card) => card.value === value && card.suit === suit);
      // The queen of hearts doubles every heart the same player took — herself
      // included — and the queen of clubs cancels the lady outright.
      if (has("Q", "♥")) points += taken.reduce((sum, card) => sum + (card.suit === "♥" ? this.penaltyOf(card) : 0), 0);
      if (has("Q", "♣") && has("Q", "♠")) points -= this.penaltyOf({ value: "Q", suit: "♠" });
    }
    return points;
  }

  // Every point that was actually captured this deal — the bar a moon has to
  // clear. Domino Hearts can leave cards in the stock, so this counts what was
  // taken rather than what the pack holds.
  pointsInPlay() {
    return this.players.reduce(
      (sum, player) => sum + player.taken.reduce((n, card) => n + Math.max(0, this.penaltyOf(card)), 0),
      0
    );
  }

  // Whoever took the lot. In a partnership that is the side rather than the
  // player, since the points are the side's.
  moonSide() {
    if (!this.rules.shootTheMoon) return null;
    const total = this.pointsInPlay();
    if (total <= 0) return null;
    for (const side of this.sides()) {
      const cards = side.flatMap((seat) => this.players[seat].taken);
      const took = cards.reduce((sum, card) => sum + Math.max(0, this.penaltyOf(card)), 0);
      if (took !== total) continue;
      // Omnibus: all fifteen counters, so the ten of diamonds has to be in it.
      if (this.spec().moonNeedsBonus) {
        const bonusOut = this.players.some((p) => p.taken.some((card) => this.isBonus(card)));
        const bonusMine = cards.some((card) => this.isBonus(card));
        if (bonusOut && !bonusMine) return null;
      }
      return side;
    }
    return null;
  }

  // Whether to load the others or clear your own. Left on "whichever helps",
  // loading everybody else wins where it ends the game with the shooter lowest,
  // and otherwise the shooter takes off as much of their own score as they can.
  moonMode(side, value) {
    const set = this.spec().moonMode || this.rules.moonChoice || "best";
    if (set !== "best") return set;
    const mine = this.players[side[0]].score;
    const others = this.sides().filter((other) => other[0] !== side[0]);
    const ends = others.some((other) => this.players[other[0]].score + value >= this.target);
    if (ends && others.every((other) => this.players[other[0]].score + value > mine)) return "add";
    return mine > 0 ? "subtract" : "add";
  }

  scoreRound() {
    const delta = this.players.map(() => 0);
    for (const player of this.players) player.roundPoints = this.pointsTakenBy(player.seat);
    const side = this.moonSide();
    let moon = null;

    if (side) {
      const value = this.spec().moonScore ?? this.pointsInPlay();
      const mode = this.moonMode(side, value);
      // Landed on the side once, not on each of its seats: partners' deltas are
      // pooled below, and charging both of them would double it.
      if (mode === "subtract") delta[side[0]] -= value;
      else {
        for (const other of this.sides()) {
          if (other[0] !== side[0]) delta[other[0]] += value;
        }
      }
      // A bonus card still pays even on a moon, which is the only way Omnibus'
      // ten of diamonds and Royal Hearts' queen of diamonds can go unrewarded.
      for (const player of this.players) {
        const bonus = player.taken.reduce((sum, card) => sum + Math.min(0, this.penaltyOf(card)), 0);
        if (!side.includes(player.seat)) delta[player.seat] += bonus;
      }
      moon = { seats: side, value, mode };
    } else {
      for (const player of this.players) delta[player.seat] += player.roundPoints;
    }

    if (this.partnerships()) {
      // Partners keep one score, so each side's points land on both of them.
      for (const pair of this.sides()) {
        const total = pair.reduce((sum, seat) => sum + delta[seat], 0);
        for (const seat of pair) delta[seat] = total;
      }
    }
    // Auction Hearts: the winning bid is paid into the pool, which here means
    // straight onto the bidder's own score.
    if (this.bidState?.highBid) delta[this.bidState.highBidder] += this.bidState.highBid;

    for (const player of this.players) player.score += delta[player.seat];
    this.moon = moon;
    return {
      delta,
      moon,
      points: this.players.map((p) => p.roundPoints),
      tricksBySeat: this.players.map((p) => p.tricksWon),
      scores: this.players.map((p) => p.score),
    };
  }

  // ---- who has won ----

  // The game stops when somebody reaches the target, or when the agreed number
  // of deals has been played — and then the lowest score wins, which is the
  // whole point of the game and the opposite of every other one here.
  isOver() {
    const limit = Number(this.rules.endAfterDeals);
    if (Number.isInteger(limit) && limit > 0 && this.dealNumber >= limit) return true;
    return this.sides().some((side) => this.players[side[0]].score >= this.target);
  }

  winners() {
    if (!this.isOver()) return [];
    const scoreOf = (side) => this.players[side[0]].score;
    const lowest = Math.min(...this.sides().map(scoreOf));
    return this.sides().filter((side) => scoreOf(side) === lowest).flat();
  }
}

module.exports = {
  SUITS,
  RANKS,
  VARIANTS,
  VARIANT_IDS,
  HeartsGame,
  buildDeck,
  sameCard,
  cardId,
  isJoker,
  rankOf,
  scaleValue,
  STRIP_ORDER,
};
