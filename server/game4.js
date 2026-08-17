// Four-player 500: two partnerships, the standard 43-card deck, one hand each
// and a three-card kitty. Deliberately a separate module from the two-player
// gameLogic.js rather than a generalisation of it — that game is played and its
// rules are settled, and the card ranking here has to answer to house-rule
// options (J5, the Joker at no trumps) that it doesn't have.
const { defaultOptions } = require("./gameOptions");

// Bidding seniority, lowest first. Also the deal's suit order, for what it's
// worth — nothing depends on that.
const BID_SUITS = ["♠", "♣", "♦", "♥", "NT"];
const REAL_SUITS = ["♠", "♣", "♦", "♥"];

// The 500 deck: the 2s, 3s and the two black 4s come out of a standard pack,
// and one Joker goes in. 11 + 11 + 10 + 10 + 1 = 43, which is 10 each and a
// three-card kitty.
const RANKS = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUIT_LOW_RANK = { "♥": "4", "♦": "4", "♠": "5", "♣": "5" };

const LEFT_BOWER_SUIT = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

// Suit sets the base (♠40 ♣60 ♦80 ♥100 NT120) and each level above six adds a
// hundred — the Avondale schedule, same as the two-player game uses.
const SUIT_BASE = { "♠": 40, "♣": 60, "♦": 80, "♥": 100, NT: 120 };

// The contracts that aren't "take N tricks". `rank` is where the bid sits in
// the auction, which is not the same thing as what it scores: Open Misère is
// worth 500 but is bid between 10♦ and 10♥. `splitRank` is where it sits under
// the split-the-colours house rule, above its level's black suits but below the
// red ones. `solo` folds the bidder's partner out of the hand.
//
// Ranks are level*10 + index in BID_SUITS, so 7♣ is 71 and anything between 71
// and 72 outbids 7♣ but not 7♦.
const SPECIAL_BIDS = {
  Misere: { points: 250, rank: 80.5, splitRank: 71.5, solo: true, target: 0 },
  "Open Misere": {
    points: 500,
    rank: 102.5,
    splitRank: 81.5,
    solo: true,
    target: 0,
    open: true,
    option: "openMisere",
  },
  "Blind Misere": {
    points: 1000,
    rank: 200,
    splitRank: 200,
    solo: true,
    target: 0,
    firstCallOnly: true,
    option: "blindMisere",
  },
  "Hi-Lo": {
    points: 350,
    rank: 90.5,
    splitRank: 91.5,
    solo: true,
    target: 5,
    exact: true,
    option: "hiLo",
  },
  "Double Nullo": {
    points: 500,
    rank: 102.6,
    splitRank: 101.5,
    solo: false,
    target: 0,
    bothPartners: true,
    option: "doubleNullo",
  },
};

const isSpecialBid = (bid) => Object.prototype.hasOwnProperty.call(SPECIAL_BIDS, bid);

// A no-tricks contract of any flavour: nobody scores for tricks, and the
// contract is settled on whether the bidding side kept its hands clean.
const isNoTricksBid = (bid) => isSpecialBid(bid) && SPECIAL_BIDS[bid].target === 0;

function parseSuitBid(bid) {
  const [level, suit] = String(bid).split(" ");
  const n = Number(level);
  if (!Number.isInteger(n) || n < 6 || n > 10 || !BID_SUITS.includes(suit)) return null;
  return { level: n, suit };
}

// What a bid is worth if it's made, and where it sits in the auction. Returns
// null for anything that isn't a bid at all.
function bidInfo(bid, options = {}) {
  if (!bid || bid === "Pass") return null;
  if (isSpecialBid(bid)) {
    const spec = SPECIAL_BIDS[bid];
    return {
      bid,
      points: spec.points,
      rank: options.splitTheColours ? spec.splitRank : spec.rank,
      special: spec,
    };
  }
  const parsed = parseSuitBid(bid);
  if (!parsed) return null;
  return {
    bid,
    points: SUIT_BASE[parsed.suit] + (parsed.level - 6) * 100,
    rank: parsed.level * 10 + BID_SUITS.indexOf(parsed.suit),
    level: parsed.level,
    suit: parsed.suit,
    special: null,
  };
}

// Every bid this table allows, in auction order. The caller decides which are
// currently too low; `requiresSeven` marks the ones a standard auction holds
// back until someone has bid at the seven level, and `firstCallOnly` the Blind
// Misère, which can only be your opening call.
function availableBids(rawOptions = {}) {
  // Merged rather than read straight: a caller with a partial option set (the
  // robot's tests, an old persisted game) should see the standard table, not
  // one with every optional contract silently switched off.
  const options = { ...defaultOptions(), ...rawOptions };
  const bids = [];
  for (let level = 6; level <= 10; level++) {
    for (const suit of BID_SUITS) bids.push(bidInfo(`${level} ${suit}`, options));
  }
  for (const [bid, spec] of Object.entries(SPECIAL_BIDS)) {
    if (spec.option && !options[spec.option]) continue;
    bids.push({
      ...bidInfo(bid, options),
      // Only plain Misère is gated on the auction reaching seven; the others
      // are bid at any time wherever they're played at all.
      requiresSeven: bid === "Misere" && !options.misereAnytime,
      firstCallOnly: Boolean(spec.firstCallOnly),
    });
  }
  return bids.sort((a, b) => a.rank - b.rank);
}

// ---- card ranking ----

const isRightBower = (card, trumpSuit) =>
  Boolean(trumpSuit) && card.suit === trumpSuit && card.value === "J";

const isLeftBower = (card, trumpSuit) =>
  Boolean(trumpSuit) && card.suit === LEFT_BOWER_SUIT[trumpSuit] && card.value === "J";

// The suit a card counts as when following suit: the Joker and both bowers
// count as trump whatever their printed suit says.
function getEffectiveSuit(card, trumpSuit) {
  if (card.suit === "Joker") return trumpSuit;
  if (isRightBower(card, trumpSuit) || isLeftBower(card, trumpSuit)) return trumpSuit;
  return card.suit;
}

// Rank within a suit. Under J5 — a no-trump variant — each jack climbs above
// the ace of its own suit, so it needs to sit one step past the top of RANKS.
function valueRank(card, trumpSuit, options) {
  if (!trumpSuit && options.j5 && card.value === "J") return RANKS.length;
  return RANKS.indexOf(card.value);
}

// Trick-taking strength once trump and the led suit are known. Anything that
// is neither trump nor the led suit can't win, so it ranks below everything.
function getCardRank(card, trumpSuit, leadSuit, options = {}) {
  if (card.suit === "Joker") return 300;
  if (isRightBower(card, trumpSuit)) return 290;
  if (isLeftBower(card, trumpSuit)) return 280;
  if (trumpSuit && card.suit === trumpSuit) return 200 + RANKS.indexOf(card.value);
  if (card.suit === leadSuit) return 100 + valueRank(card, trumpSuit, options);
  return -1;
}

// ---- the game ----

class Game500Four {
  constructor(options) {
    this.options = { ...defaultOptions(), ...(options || {}) };
    // Seats run clockwise; partners sit across from each other, so seats 0 and
    // 2 are team 0 and seats 1 and 3 are team 1.
    this.players = [0, 1, 2, 3].map((seat) => ({
      seat,
      id: null,
      name: null,
      isBot: false,
      hand: [],
      tricksWon: 0,
      folded: false,
    }));
    this.teamScores = [0, 0];
    this.deck = [];
    this.kitty = null;
    this.dealerSeat = 0;
    this.currentBid = null;
    this.trumpSuit = null;
    // Set when everyone passed and the table plays the hand out at no trumps
    // for trick points rather than redealing.
    this.noContract = false;
    this.currentTrick = [];
    // Every card played this round, in order. The robot reads it to work out
    // what's still out there, and it's what the round review is built from.
    this.playedCards = [];
    this.currentSeat = 0;
    this.auction = null;
    // Seats that declared before the deal that they mean to go blind. Only
    // those seats may call a Blind Misère, and only they hold cards they
    // haven't looked at.
    this.blindSeats = [];
    // Double Nullo's five-card exchange: what each partner has chosen to send,
    // held until both have chosen so neither sees the other's pick first.
    this.pendingPass = {};
  }

  // ---- seats and teams ----

  teamOf(seat) {
    return seat % 2;
  }

  partnerOf(seat) {
    return (seat + 2) % 4;
  }

  playerAt(seat) {
    return this.players[seat];
  }

  seatOf(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    return player ? player.seat : -1;
  }

  activeSeats() {
    return this.players.filter((p) => !p.folded).map((p) => p.seat);
  }

  nextActiveSeat(seat) {
    for (let step = 1; step <= 4; step++) {
      const next = (seat + step) % 4;
      if (!this.players[next].folded) return next;
    }
    return seat;
  }

  teamTricks(team) {
    return this.players
      .filter((p) => this.teamOf(p.seat) === team)
      .reduce((sum, p) => sum + p.tricksWon, 0);
  }

  // ---- dealing ----

  createDeck() {
    const deck = [];
    for (const suit of REAL_SUITS) {
      const from = RANKS.indexOf(SUIT_LOW_RANK[suit]);
      for (const value of RANKS.slice(from)) deck.push({ suit, value });
    }
    deck.push({ suit: "Joker", value: "Joker" });
    return this.shuffle(deck);
  }

  shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // Dealt the way it's dealt at a table: three each and one to the kitty, four
  // each and one to the kitty, three each and one to the kitty.
  deal(dealerSeat) {
    this.dealerSeat = dealerSeat;
    this.deck = this.createDeck();
    this.kitty = [];
    this.currentBid = null;
    this.trumpSuit = null;
    this.noContract = false;
    this.currentTrick = [];
    this.playedCards = [];
    this.blindSeats = [];
    this.pendingPass = {};
    this.players.forEach((p) => {
      p.hand = [];
      p.tricksWon = 0;
      p.folded = false;
    });

    for (const packet of [3, 4, 3]) {
      for (let step = 1; step <= 4; step++) {
        const seat = (dealerSeat + step) % 4;
        for (let i = 0; i < packet; i++) this.players[seat].hand.push(this.deck.pop());
      }
      this.kitty.push(this.deck.pop());
    }

    this.startAuction((dealerSeat + 1) % 4);
  }

  // ---- the auction ----

  startAuction(firstSeat) {
    this.auction = {
      turnSeat: firstSeat,
      highBid: null,
      // Everyone who has passed since the last bid. Cleared by each new bid,
      // which is what lets a player back in under the bid-after-pass rule.
      passedSinceBid: [],
      // Everyone who has passed at all. Under standard rules that's who is out
      // of the auction for good; bid-after-pass ignores it.
      passedEver: [],
      history: [],
      complete: false,
      allPassed: false,
      // Seats barred from bidding this hand by the Ralphing rule.
      barredSeats: [],
    };
    this.advanceToNextBidder(firstSeat, true);
  }

  barFromBidding(seats) {
    if (this.auction) {
      this.auction.barredSeats = [...seats];
      this.advanceToNextBidder(this.auction.turnSeat, true);
    }
  }

  canBidderSpeak(seat) {
    const a = this.auction;
    if (a.barredSeats.includes(seat)) return false;
    if (a.passedSinceBid.includes(seat)) return false;
    if (!this.options.bidAfterPass && a.passedEver.includes(seat)) return false;
    // Once everyone else has fallen away the high bidder has won it; they don't
    // get asked to raise themselves.
    return !(a.highBid && a.highBid.seat === seat);
  }

  // Hands the turn to the next seat that still has a say, or ends the auction
  // when nobody has. `inclusive` starts the search at `from` rather than after.
  advanceToNextBidder(from, inclusive = false) {
    const a = this.auction;
    for (let step = inclusive ? 0 : 1; step < (inclusive ? 4 : 5); step++) {
      const seat = (from + step) % 4;
      if (this.canBidderSpeak(seat)) {
        a.turnSeat = seat;
        return;
      }
    }
    a.complete = true;
    a.allPassed = !a.highBid;
    a.turnSeat = null;
  }

  // Is this bid legal for this seat right now? Separate from bid() so the
  // client's grid and the robot can ask the same question.
  bidLegality(seat, bid) {
    const a = this.auction;
    if (!a || a.complete) return { ok: false, reason: "The auction is over." };
    if (a.turnSeat !== seat) return { ok: false, reason: "It isn't your turn to bid." };
    if (bid === "Pass") return { ok: true };

    const available = availableBids(this.options).find((b) => b.bid === bid);
    if (!available) return { ok: false, reason: "That bid isn't in play at this table." };
    if (a.highBid && available.rank <= a.highBid.rank) {
      return { ok: false, reason: "That doesn't beat the standing bid." };
    }
    if (available.requiresSeven && !(a.highBid && a.highBid.rank >= 70)) {
      return { ok: false, reason: "Misère needs the auction to reach seven first." };
    }
    if (available.firstCallOnly && a.history.some((h) => h.seat === seat)) {
      return { ok: false, reason: "That can only be your opening call." };
    }
    // A blind bid is only blind if it was declared before the cards came out.
    if (bid === "Blind Misere" && !this.blindSeats.includes(seat)) {
      return { ok: false, reason: "Blind Misère has to be declared before the deal." };
    }
    return { ok: true };
  }

  bid(seat, bidString) {
    const legality = this.bidLegality(seat, bidString);
    if (!legality.ok) return { ...legality, complete: false };
    const a = this.auction;

    if (bidString === "Pass") {
      a.history.push({ seat, bid: "Pass", points: 0 });
      a.passedSinceBid.push(seat);
      if (!a.passedEver.includes(seat)) a.passedEver.push(seat);
    } else {
      const info = bidInfo(bidString, this.options);
      a.highBid = { seat, bid: bidString, points: info.points, rank: info.rank };
      a.history.push({ seat, bid: bidString, points: info.points });
      a.passedSinceBid = [];
    }

    this.advanceToNextBidder(seat);
    return { ok: true, complete: a.complete, allPassed: a.allPassed };
  }

  // Settle the auction: the winning bid becomes the contract, the partner of a
  // solo bidder folds, and the kitty goes to the bidder.
  completeBidding() {
    const high = this.auction.highBid;
    if (!high) {
      // Everyone passed. Either the hand is thrown in (the caller redeals) or,
      // under the all-pass rule, it's played at no trumps for trick points.
      this.noContract = true;
      this.currentBid = null;
      this.trumpSuit = null;
      this.currentSeat = (this.dealerSeat + 1) % 4;
      return null;
    }

    this.currentBid = {
      player: this.players[high.seat].id,
      seat: high.seat,
      bid: high.bid,
      points: high.points,
    };
    const suit = parseSuitBid(high.bid)?.suit;
    this.trumpSuit = REAL_SUITS.includes(suit) ? suit : null;

    const spec = SPECIAL_BIDS[high.bid];
    if (spec?.solo) this.players[this.partnerOf(high.seat)].folded = true;

    return this.currentBid;
  }

  contractSpec() {
    return this.currentBid ? SPECIAL_BIDS[this.currentBid.bid] || null : null;
  }

  // The bidder's hand goes face up to the defenders after the first trick.
  isOpenContract() {
    return Boolean(this.contractSpec()?.open);
  }

  // ---- kitty ----

  // The three kitty cards join the bidder's hand; they hand back ten.
  takeKitty(seat) {
    const player = this.players[seat];
    const kitty = this.kitty || [];
    this.kitty = [];
    player.hand = [...player.hand, ...kitty];
    return kitty;
  }

  // `newHand` is the ten cards the bidder is keeping. Validated against what
  // they actually hold, since it arrives from a client.
  discard(seat, newHand) {
    const player = this.players[seat];
    if (!Array.isArray(newHand) || newHand.length !== 10) {
      return { success: false, reason: "Keep exactly ten cards." };
    }
    const pool = [...player.hand];
    const kept = [];
    for (const card of newHand) {
      const i = pool.findIndex((c) => c.suit === card.suit && c.value === card.value);
      if (i === -1) return { success: false, reason: "That isn't a card you hold." };
      kept.push(pool.splice(i, 1)[0]);
    }
    player.hand = kept;
    this.currentSeat = seat;
    return { success: true, discarded: pool };
  }

  // ---- Double Nullo's five-card exchange ----

  // Both partners have to keep a clean hand, so they get to help each other:
  // each chooses five cards to send across the table and they change hands at
  // the same moment. You choose what you send, never what you receive, which is
  // what makes it about voiding your own dangerous suits.
  exchangeSeats() {
    if (!this.contractSpec()?.bothPartners) return null;
    const seat = this.currentBid.seat;
    return [seat, this.partnerOf(seat)];
  }

  setPass(seat, cards) {
    const seats = this.exchangeSeats();
    if (!seats || !seats.includes(seat)) {
      return { success: false, reason: "You're not part of this exchange." };
    }
    if (!Array.isArray(cards) || cards.length !== 5) {
      return { success: false, reason: "Choose exactly five cards to pass." };
    }
    const pool = [...this.players[seat].hand];
    const chosen = [];
    for (const card of cards) {
      const i = pool.findIndex((c) => c.suit === card.suit && c.value === card.value);
      if (i === -1) return { success: false, reason: "That isn't a card you hold." };
      chosen.push(pool.splice(i, 1)[0]);
    }
    this.pendingPass[seat] = chosen;
    return { success: true };
  }

  exchangeReady() {
    const seats = this.exchangeSeats();
    return Boolean(seats && seats.every((seat) => this.pendingPass[seat]));
  }

  completeExchange() {
    const [a, b] = this.exchangeSeats();
    const fromA = this.pendingPass[a];
    const fromB = this.pendingPass[b];
    const without = (seat, sent) =>
      this.players[seat].hand.filter(
        (card) => !sent.some((s) => s.suit === card.suit && s.value === card.value)
      );
    const keptA = without(a, fromA);
    const keptB = without(b, fromB);
    this.players[a].hand = [...keptA, ...fromB];
    this.players[b].hand = [...keptB, ...fromA];
    this.pendingPass = {};
    return { [a]: fromA, [b]: fromB };
  }

  // ---- play ----

  // The suit others must follow. Normally the led card's effective suit, but a
  // Joker led with no trump suit at all has none of its own — the leader
  // nominates one, and that's what everyone follows.
  getLeadSuit(leadPlay) {
    if (leadPlay.card.suit === "Joker" && leadPlay.nominatedSuit) return leadPlay.nominatedSuit;
    return getEffectiveSuit(leadPlay.card, this.trumpSuit);
  }

  // Every card this seat is allowed to play right now. The same rules playCard
  // enforces, expressed as a list rather than a verdict — the robot picks from
  // it, so the two can't drift apart into a robot that makes illegal plays.
  legalPlays(seat) {
    const player = this.players[seat];
    if (this.currentTrick.length === 0) {
      const strictJoker = !this.trumpSuit && !this.options.jokerLeadAnytime;
      return player.hand.filter(
        (card) => !(strictJoker && card.suit === "Joker" && player.hand.length > 1)
      );
    }

    const leadSuit = this.getLeadSuit(this.currentTrick[0]);
    const following = player.hand.filter(
      (card) => getEffectiveSuit(card, this.trumpSuit) === leadSuit
    );
    if (following.length > 0) return following;

    if (!this.trumpSuit && isNoTricksBid(this.currentBid?.bid)) {
      const joker = player.hand.find((card) => card.suit === "Joker");
      if (joker) return [joker];
    }
    return [...player.hand];
  }

  playCard(seat, card, nominatedSuit) {
    const player = this.players[seat];
    const index = player.hand.findIndex((c) => c.suit === card.suit && c.value === card.value);
    if (index === -1) return { success: false, reason: "That card isn't in your hand." };

    const isLeading = this.currentTrick.length === 0;
    const noTrumps = !this.trumpSuit;

    if (isLeading) {
      if (card.suit === "Joker" && noTrumps) {
        // Under the strict rule the Joker is held back for a suit you're void
        // in, so it can't open a trick — unless it's all you have left.
        if (!this.options.jokerLeadAnytime && player.hand.length > 1) {
          return { success: false, reason: "The Joker can only be thrown when you're void." };
        }
        if (!REAL_SUITS.includes(nominatedSuit)) {
          return { success: false, reason: "Nominate a suit to lead the Joker." };
        }
      }
    } else {
      const leadSuit = this.getLeadSuit(this.currentTrick[0]);
      const playedSuit = getEffectiveSuit(card, this.trumpSuit);
      if (playedSuit !== leadSuit) {
        const canFollow = player.hand.some(
          (c) => getEffectiveSuit(c, this.trumpSuit) === leadSuit
        );
        if (canFollow) return { success: false, reason: `You must follow suit (${leadSuit}).` };

        // Void, with no trump suit to soak it up: a no-tricks contract can't be
        // played by sitting on the Joker, so it has to go now.
        if (noTrumps && isNoTricksBid(this.currentBid?.bid) && card.suit !== "Joker") {
          if (player.hand.some((c) => c.suit === "Joker")) {
            return { success: false, reason: "You must play the Joker." };
          }
        }
      }
    }

    const played = player.hand.splice(index, 1)[0];
    const play = { seat, playerId: player.id, card: played };
    if (isLeading && played.suit === "Joker" && noTrumps) play.nominatedSuit = nominatedSuit;
    this.currentTrick.push(play);
    this.playedCards.push(play);
    return { success: true, play };
  }

  trickIsComplete() {
    return this.currentTrick.length === this.activeSeats().length;
  }

  resolveTrick() {
    const leadSuit = this.getLeadSuit(this.currentTrick[0]);
    let winning = this.currentTrick[0];
    let best = getCardRank(winning.card, this.trumpSuit, leadSuit, this.options);

    for (const play of this.currentTrick.slice(1)) {
      const rank = getCardRank(play.card, this.trumpSuit, leadSuit, this.options);
      if (rank > best) {
        best = rank;
        winning = play;
      }
    }

    this.players[winning.seat].tricksWon += 1;
    const plays = this.currentTrick.map((p) => ({
      seat: p.seat,
      playerId: p.playerId,
      card: p.card,
    }));
    this.currentTrick = [];
    this.currentSeat = winning.seat;

    return {
      seat: winning.seat,
      playerId: winning.playerId,
      winningCard: winning.card,
      leadSuit,
      plays,
    };
  }

  isRoundOver() {
    return this.players.every((p) => p.folded || p.hand.length === 0);
  }

  // True once the outcome can't change: everyone's out of cards, or a no-tricks
  // contract has already been broken, or a Hi-Lo can no longer land on five.
  isRoundDecided() {
    if (this.isRoundOver()) return true;
    const spec = this.contractSpec();
    if (!spec || this.currentTrick.length > 0) return false;

    const bidderSeat = this.currentBid.seat;
    const seats = spec.bothPartners ? [bidderSeat, this.partnerOf(bidderSeat)] : [bidderSeat];
    if (spec.exact) {
      const won = this.players[bidderSeat].tricksWon;
      const left = this.players[bidderSeat].hand.length;
      return won > spec.target || won + left < spec.target;
    }
    return seats.some((seat) => this.players[seat].tricksWon > spec.target);
  }

  // ---- scoring ----

  // Did the contract come home? Split out so an abandoned hand can be settled
  // without counting tricks, the way the two-player game does on a resign.
  contractMade() {
    const spec = this.contractSpec();
    if (!spec) return null;
    const bidderSeat = this.currentBid.seat;
    if (spec.exact) return this.players[bidderSeat].tricksWon === spec.target;
    const seats = spec.bothPartners ? [bidderSeat, this.partnerOf(bidderSeat)] : [bidderSeat];
    return seats.every((seat) => this.players[seat].tricksWon === spec.target);
  }

  // The bidding team scores its contract, made or lost; the defenders take ten
  // a trick unless the house plays without trick points or the contract was a
  // no-tricks one. `forcedMade` settles a hand that ended by agreement.
  scoreRound(forcedMade = null) {
    if (this.noContract) {
      // Nobody's contract: every trick is worth ten to the team that took it.
      const deltas = [this.teamTricks(0) * 10, this.teamTricks(1) * 10];
      this.teamScores[0] += deltas[0];
      this.teamScores[1] += deltas[1];
      return { noContract: true, deltas, made: null, biddingTeam: null };
    }

    const spec = this.contractSpec();
    const biddingTeam = this.teamOf(this.currentBid.seat);
    const defendingTeam = 1 - biddingTeam;
    const biddingTricks = this.teamTricks(biddingTeam);
    const level = parseSuitBid(this.currentBid.bid)?.level;

    const made =
      forcedMade === null
        ? spec
          ? this.contractMade()
          : biddingTricks >= level
        : forcedMade;

    // A slam pays 250 even on a cheap contract — but only for a plain trick
    // contract; taking all ten is what a Misère bidder least wants.
    let value = this.currentBid.points;
    if (made && !spec && this.options.slamBonus && biddingTricks === 10) {
      value = Math.max(value, 250);
    }

    const deltas = [0, 0];
    deltas[biddingTeam] = made ? value : -value;
    if (this.options.trickPoints && !spec) {
      deltas[defendingTeam] = this.teamTricks(defendingTeam) * 10;
    }
    this.teamScores[0] += deltas[0];
    this.teamScores[1] += deltas[1];

    // Ralphing: down by more than three tricks and the bidder sits out the next
    // auction. A no-tricks contract is "set" at three tricks however deep it
    // actually went, so more than three is the same test either way.
    const shortfall = spec
      ? this.players[this.currentBid.seat].tricksWon
      : Math.max(0, level - biddingTricks);
    const ralphed = this.options.ralphing && !made && shortfall > 3;

    return {
      made,
      biddingTeam,
      defendingTeam,
      biddingTricks,
      defendingTricks: this.teamTricks(defendingTeam),
      value,
      deltas,
      slam: made && !spec && biddingTricks === 10,
      ralphedSeat: ralphed ? this.currentBid.seat : null,
    };
  }

  // Who, if anyone, has won the game — checked after each hand is scored.
  // `madeBidTeam` is the team that just brought a contract home, which is what
  // settles a hand where both teams cross 500 and what the must-bid-to-win
  // house rule turns on.
  checkGameOver(madeBidTeam = null) {
    const [a, b] = this.teamScores;

    const reached = [0, 1].filter((team) => {
      if (this.teamScores[team] < 500) return false;
      return !this.options.mustBidToWin || madeBidTeam === team;
    });
    if (reached.length > 1) {
      // Both there at once: the team that made its bid takes it.
      return { team: madeBidTeam !== null ? madeBidTeam : reached[0], reason: "target" };
    }
    if (reached.length === 1) return { team: reached[0], reason: "target" };

    if (this.options.backDoor) {
      if (a <= -500) return { team: 1, reason: "backDoor" };
      if (b <= -500) return { team: 0, reason: "backDoor" };
    }

    if (this.options.pointSpread && Math.abs(a - b) >= 500 && Math.min(a, b) < 0) {
      return { team: a > b ? 0 : 1, reason: "pointSpread" };
    }

    return null;
  }
}

module.exports = {
  Game500Four,
  BID_SUITS,
  REAL_SUITS,
  RANKS,
  SUIT_BASE,
  SPECIAL_BIDS,
  LEFT_BOWER_SUIT,
  isSpecialBid,
  isNoTricksBid,
  bidInfo,
  availableBids,
  getEffectiveSuit,
  getCardRank,
  isLeftBower,
  isRightBower,
};
