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

class Game500 {
  constructor() {
    this.suits = suits; // Add this line
    this.deck = this.createDeck();
    this.players = [
      { id: 1, hand: [], dummyHand: [], score: 0, isDealer: false },
      { id: 2, hand: [], dummyHand: [], score: 0, isDealer: false },
    ];
    this.currentBid = null;
    this.trumpSuit = null;
    this.currentTrick = [];
    this.playedCards = [];
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

  dealDummyHands() {
    for (let i = 0; i < 10; i++) {
      for (let player of this.players) {
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
      })),
      currentBid: this.currentBid,
      trumpSuit: this.trumpSuit,
      dealerId: this.players[dealerIndex].id,
    };
  }

  playCard(playerId, card, isDummy) {
    const player = this.players.find((p) => p.id === playerId);
    const hand = isDummy ? player.dummyHand : player.hand;
    const cardIndex = hand.findIndex(
      (c) => c.suit === card.suit && c.value === card.value
    );

    if (cardIndex !== -1) {
      const playedCard = hand.splice(cardIndex, 1)[0];
      this.currentTrick.push({ playerId, card: playedCard, isDummy });
      this.playedCards.push({ playerId, card: playedCard, isDummy });

      if (this.currentTrick.length === 4) {
        this.resolveTrick();
      }
    }
  }

  resolveTrick() {
    // Implement trick resolution logic here
    // ...
    this.currentTrick = [];
  }

  endRound() {
    // Implement round end logic here
    console.log("Round ended");
    console.log("Player 1 score:", this.players[0].score);
    console.log("Player 2 score:", this.players[1].score);
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
