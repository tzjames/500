const suits = ["♠", "♥", "♦", "♣"];
const values = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

const leftBowerSuit = { "♠": "♣", "♣": "♠", "♥": "♦", "♦": "♥" };

function isRightBower(card, trumpSuit) {
  return trumpSuit && card.suit === trumpSuit && card.value === "J";
}

function isLeftBower(card, trumpSuit) {
  return trumpSuit && card.suit === leftBowerSuit[trumpSuit] && card.value === "J";
}

// Whether the bidder made their contract, without mutating any score — used
// both by scoreRound() and by an unscored replay to show the same outcome.
function checkBidMade(bid, bidderTricksWon) {
  if (bid.bid.includes("Misere")) return bidderTricksWon === 0;
  return bidderTricksWon >= parseInt(bid.bid, 10);
}

// The suit a card counts as for follow-suit purposes: the Joker and both
// bowers always count as trump, regardless of their printed suit.
function getEffectiveSuit(card, trumpSuit) {
  if (card.suit === "Joker") return trumpSuit;
  if (isRightBower(card, trumpSuit) || isLeftBower(card, trumpSuit)) return trumpSuit;
  return card.suit;
}

// Trick-taking strength of a card once a trump suit and a led suit are known.
// Off-suit, non-trump cards can never win a trick.
function getCardRank(card, trumpSuit, leadSuit) {
  if (card.suit === "Joker") return 200;
  if (isRightBower(card, trumpSuit)) return 190;
  if (isLeftBower(card, trumpSuit)) return 180;
  if (trumpSuit && card.suit === trumpSuit) return 100 + values.indexOf(card.value);
  if (card.suit === leadSuit) return values.indexOf(card.value);
  return -1;
}

class Game500 {
  constructor() {
    this.suits = suits; // Add this line
    this.deck = this.createDeck();
    this.players = [
      { id: 1, hand: [], dummyHand: [], score: 0, isDealer: false, tricksWon: 0 },
      { id: 2, hand: [], dummyHand: [], score: 0, isDealer: false, tricksWon: 0 },
    ];
    this.currentBid = null;
    this.trumpSuit = null;
    this.currentTrick = [];
    this.playedCards = [];
    // The 4-seat rotation for a trick: bidder's hand, other's hand, bidder's
    // dummy, other's dummy. A trick's winning seat leads the next one, and
    // the rotation continues from there in this same fixed order.
    this.seats = null;
    this.currentSeatIndex = 0;
  }

  // In Misère/Open Misère the bidder plays only their own hand — no dummy —
  // so the trick rotation there is 3 seats instead of 4.
  setupSeats(bidderId, bidderPlaysNoDummy) {
    const otherId = this.players.find((p) => p.id !== bidderId).id;
    this.seats = bidderPlaysNoDummy
      ? [
          { playerId: bidderId, isDummy: false },
          { playerId: otherId, isDummy: false },
          { playerId: otherId, isDummy: true },
        ]
      : [
          { playerId: bidderId, isDummy: false },
          { playerId: otherId, isDummy: false },
          { playerId: bidderId, isDummy: true },
          { playerId: otherId, isDummy: true },
        ];
    this.currentSeatIndex = 0;
  }

  getCurrentSeat() {
    return this.seats ? this.seats[this.currentSeatIndex] : null;
  }

  advanceSeat() {
    if (this.seats) {
      this.currentSeatIndex = (this.currentSeatIndex + 1) % this.seats.length;
    }
  }

  createDeck() {
    let deck = [];
    for (let suit of suits) {
      for (let value of values) {
        deck.push({ suit, value });
      }
    }
    deck.push({ suit: "Joker", value: "Joker" });
    return this.shuffleDeck(deck);
  }

  shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  dealCards() {
    for (let i = 0; i < 10; i++) {
      for (let player of this.players) {
        player.hand.push(this.deck.pop());
      }
    }
  }

  // recipientIds limits who gets a dummy — the Misère/Open Misère bidder
  // doesn't play one at all.
  dealDummyHands(recipientIds) {
    const recipients = recipientIds
      ? this.players.filter((p) => recipientIds.includes(p.id))
      : this.players;
    for (let i = 0; i < 10; i++) {
      for (let player of recipients) {
        player.dummyHand.push(this.deck.pop());
      }
    }
  }

  startGame() {
    this.dealCards();
    const dealerIndex = Math.floor(Math.random() * 2);
    this.players[dealerIndex].isDealer = true;
    return {
      players: this.players.map((p) => ({
        id: p.id,
        hand: p.hand, // Send the full hand data instead of just the size
        isDealer: p.isDealer,
        score: p.score,
        tricksWon: p.tricksWon,
      })),
      currentBid: this.currentBid,
      trumpSuit: this.trumpSuit,
      dealerId: this.players[dealerIndex].id,
    };
  }

  // Redeal after everyone passes: fresh cards and a clean auction, but the
  // same dealer and everything else about the players (score, id, name).
  redeal(dealerIndex) {
    this.deck = this.createDeck();
    this.players.forEach((p, i) => {
      p.hand = [];
      p.dummyHand = [];
      p.tricksWon = 0;
      p.isDealer = i === dealerIndex;
    });
    this.currentBid = null;
    this.trumpSuit = null;
    this.currentTrick = [];
    this.playedCards = [];
    this.kitty = null;
    this.seats = null;
    this.currentSeatIndex = 0;
    this.dealCards();
    return {
      players: this.players.map((p) => ({
        id: p.id,
        hand: p.hand,
        isDealer: p.isDealer,
        score: p.score,
        tricksWon: p.tricksWon,
      })),
      currentBid: null,
      trumpSuit: null,
      dealerId: this.players[dealerIndex].id,
    };
  }

  // The suit a trick's lead card set for others to follow. Normally that's
  // just the led card's effective suit, but a Joker led with no trump suit
  // at all (No Trumps / Misère / Open Misère) has no suit of its own — the
  // leader nominates one on the spot, and that's what everyone must follow.
  getLeadSuit(leadPlay) {
    if (leadPlay.card.suit === "Joker" && leadPlay.nominatedSuit) {
      return leadPlay.nominatedSuit;
    }
    return getEffectiveSuit(leadPlay.card, this.trumpSuit);
  }

  playCard(playerId, card, isDummy, nominatedSuit) {
    const player = this.players.find((p) => p.id === playerId);
    const hand = isDummy ? player.dummyHand : player.hand;
    const cardIndex = hand.findIndex(
      (c) => c.suit === card.suit && c.value === card.value
    );

    if (cardIndex === -1) {
      return { success: false, reason: "That card isn't in your hand." };
    }

    const isLeading = this.currentTrick.length === 0;
    const realSuits = ["♠", "♣", "♥", "♦"];

    if (isLeading) {
      // Leading a Joker with no trump suit at all requires nominating a
      // suit right now; everyone else must follow it for this trick.
      if (card.suit === "Joker" && !this.trumpSuit && !realSuits.includes(nominatedSuit)) {
        return { success: false, reason: "Nominate a suit to lead the Joker." };
      }
    } else {
      const leadSuit = this.getLeadSuit(this.currentTrick[0]);
      const cardSuit = getEffectiveSuit(card, this.trumpSuit);
      if (cardSuit !== leadSuit) {
        const hasLeadSuit = hand.some(
          (c) => getEffectiveSuit(c, this.trumpSuit) === leadSuit
        );
        if (hasLeadSuit) {
          return {
            success: false,
            reason: `You must follow suit (${leadSuit}).`,
          };
        }

        // Void in the led suit. With no trump suit at all, the Joker is
        // "unattached" — you may only ever play it here, when void. Misère
        // contracts go further: you can't hold it back, you must play it.
        const isMisere = this.currentBid && this.currentBid.bid.includes("Misere");
        if (isMisere && card.suit !== "Joker") {
          const holdsJoker = hand.some((c) => c.suit === "Joker");
          if (holdsJoker) {
            return { success: false, reason: "You must play the Joker." };
          }
        }
      }
    }

    const playedCard = hand.splice(cardIndex, 1)[0];
    const play = { playerId, card: playedCard, isDummy };
    if (isLeading && playedCard.suit === "Joker" && !this.trumpSuit) {
      play.nominatedSuit = nominatedSuit;
    }
    this.currentTrick.push(play);
    this.playedCards.push(play);
    return { success: true };
  }

  resolveTrick() {
    const leadSuit = this.getLeadSuit(this.currentTrick[0]);
    let winningPlay = this.currentTrick[0];
    let winningRank = getCardRank(winningPlay.card, this.trumpSuit, leadSuit);

    for (let i = 1; i < this.currentTrick.length; i++) {
      const play = this.currentTrick[i];
      const rank = getCardRank(play.card, this.trumpSuit, leadSuit);
      if (rank > winningRank) {
        winningRank = rank;
        winningPlay = play;
      }
    }

    const winner = this.players.find((p) => p.id === winningPlay.playerId);
    if (winner) winner.tricksWon = (winner.tricksWon || 0) + 1;

    // The winning seat leads the next trick.
    if (this.seats) {
      const winningSeatIndex = this.seats.findIndex(
        (s) => s.playerId === winningPlay.playerId && s.isDummy === winningPlay.isDummy
      );
      if (winningSeatIndex !== -1) this.currentSeatIndex = winningSeatIndex;
    }

    this.currentTrick = [];
    return { playerId: winningPlay.playerId, isDummy: winningPlay.isDummy };
  }

  isRoundOver() {
    return this.players.every((p) => p.hand.length === 0 && p.dummyHand.length === 0);
  }

  // True once the round's outcome is settled: either everyone's out of
  // cards, or — Misère/Open Misère only — the bidder has already won a
  // trick and is guaranteed to fail regardless of what's left to play.
  isRoundDecided() {
    if (this.isRoundOver()) return true;
    if (this.currentBid && this.currentBid.bid.includes("Misere")) {
      const bidder = this.players.find((p) => p.id === this.currentBid.player);
      return Boolean(bidder && bidder.tricksWon > 0);
    }
    return false;
  }

  // Standard 500 scoring: the bidder needs at least as many combined
  // hand+dummy tricks as their bid promised (0 for Misere/Open Misere) to
  // score the full bid value; otherwise they lose that value. The other
  // player always scores 10 points per trick, win or lose.
  scoreRound() {
    const bid = this.currentBid;
    const bidder = this.players.find((p) => p.id === bid.player);
    const other = this.players.find((p) => p.id !== bid.player);

    const isMisere = bid.bid.includes("Misere");
    const bidderMadeBid = checkBidMade(bid, bidder.tricksWon);

    const bidderDelta = bidderMadeBid ? bid.points : -bid.points;
    const otherDelta = isMisere ? 0 : other.tricksWon * 10;
    // In Misère/Open Misère the opponent doesn't score for tricks at all —
    // only the bidder's success or failure is worth anything.
    bidder.score += bidderDelta;
    other.score += otherDelta;

    return {
      bidderMadeBid,
      bidderId: bidder.id,
      otherId: other.id,
      bidderDelta,
      otherDelta,
    };
  }

  dealKitty() {
    this.kitty = this.deck.splice(0, 3);
    return this.kitty;
  }

  swapCard(playerId, handCardIndex, kittyCardIndex) {
    const player = this.players.find((p) => p.id === playerId);
    const temp = player.hand[handCardIndex];
    player.hand[handCardIndex] = this.kitty[kittyCardIndex];
    this.kitty[kittyCardIndex] = temp;
  }
}

module.exports = Game500;
module.exports.getEffectiveSuit = getEffectiveSuit;
module.exports.checkBidMade = checkBidMade;
