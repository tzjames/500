import React from "react";
import "./PlayerHand.css"; // We'll create this CSS file next
import CardFace from "./CardFace";

function PlayerHand({ hand, onPlayCard, trumpSuit, isCurrentPlayer }) {
  const getCardColor = (suit) => {
    return suit === "♥" || suit === "♦" ? "red" : "black";
  };

  const suitOrder = ["♠", "♣", "♥", "♦"];
  const valueOrder = [
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

  const getLeftBowerSuit = (trumpSuit) => {
    const leftBowerMap = {
      "♠": "♣",
      "♣": "♠",
      "♥": "♦",
      "♦": "♥",
    };
    return leftBowerMap[trumpSuit];
  };

  const isLeftBower = (card, trumpSuit) => {
    return card.suit === getLeftBowerSuit(trumpSuit) && card.value === "J";
  };

  const getTrumpValue = (card) => {
    if (card.suit === "Joker") return 22; // Highest
    if (card.suit === trumpSuit && card.value === "J") return 21; // Right bower
    if (isLeftBower(card, trumpSuit)) return 20; // Left bower
    // Plain trump cards top out at "A" (index 12), well below the bowers.
    return valueOrder.indexOf(card.value);
  };

  const sortedHand = [...hand].sort((a, b) => {
    const aIsTrump =
      a.suit === trumpSuit || isLeftBower(a, trumpSuit) || a.suit === "Joker";
    const bIsTrump =
      b.suit === trumpSuit || isLeftBower(b, trumpSuit) || b.suit === "Joker";

    if (aIsTrump && bIsTrump) {
      return getTrumpValue(a) - getTrumpValue(b); // Changed to ascending order for trump
    }
    if (aIsTrump) return -1;
    if (bIsTrump) return 1;
    if (a.suit === b.suit) {
      return valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value); // Changed to ascending order
    }
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });

  const groupedHand = suitOrder
    .map((suit) =>
      sortedHand.filter(
        (card) =>
          (suit === trumpSuit &&
            (card.suit === trumpSuit ||
              isLeftBower(card, trumpSuit) ||
              card.suit === "Joker")) ||
          (suit !== trumpSuit &&
            card.suit === suit &&
            !isLeftBower(card, trumpSuit))
      )
    )
    .filter((group) => group.length > 0);

  // Before a trump suit is chosen (e.g. during bidding), no suit group above
  // ever matches suit === trumpSuit, so the Joker falls through both branches
  // and vanishes from the hand entirely. Give it its own group in that case.
  if (!trumpSuit) {
    const jokerGroup = sortedHand.filter((card) => card.suit === "Joker");
    if (jokerGroup.length > 0) groupedHand.unshift(jokerGroup);
  }

  return (
    <div className="player-hand">
      <div className="cards">
        {groupedHand.map((suitGroup, groupIndex) => (
          <div key={groupIndex} className="suit-group">
            {suitGroup.map((card, index) => (
              <button
                key={`${groupIndex}-${index}`}
                onClick={() => onPlayCard(card)}
                className={`card ${getCardColor(card.suit)} ${
                  card.suit === "Joker" ? "joker" : ""
                }`}
                disabled={!isCurrentPlayer}
              >
                <CardFace card={card} />
                {isLeftBower(card, trumpSuit) && (
                  <div className="left-bower-indicator">LB</div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PlayerHand;
