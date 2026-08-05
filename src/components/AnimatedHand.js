import React from "react";
import "./AnimatedHand.css";
import CardFace from "./CardFace";

function AnimatedHand({ hand, selectedCards, onCardClick, trumpSuit }) {
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
      return getTrumpValue(a) - getTrumpValue(b);
    }
    if (aIsTrump) return -1;
    if (bIsTrump) return 1;
    if (a.suit === b.suit) {
      return valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value);
    }
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });

  const groupedHand = suitOrder
    .map((suit) => {
      if (suit === trumpSuit) {
        return sortedHand.filter(
          (card) =>
            card.suit === trumpSuit ||
            isLeftBower(card, trumpSuit) ||
            card.suit === "Joker"
        );
      } else {
        return sortedHand.filter(
          (card) => card.suit === suit && !isLeftBower(card, trumpSuit)
        );
      }
    })
    .filter((group) => group.length > 0);

  return (
    <div className="animated-hand">
      {groupedHand.map((suitGroup, groupIndex) => (
        <div key={groupIndex} className="suit-group">
          {suitGroup.map((card, index) => {
            const cardIndex = hand.findIndex(
              (c) => c.suit === card.suit && c.value === card.value
            );
            return (
              <div
                key={`${groupIndex}-${index}`}
                className={`card ${getCardColor(card.suit)} ${
                  selectedCards.includes(cardIndex) ? "selected" : ""
                } ${card.isKitty ? "kitty" : ""}`}
                onClick={() => onCardClick(cardIndex)}
              >
                <CardFace card={card} />
                {card.isKitty && <div className="kitty-indicator">Kitty</div>}
                {isLeftBower(card, trumpSuit) && (
                  <div className="left-bower-indicator">LB</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default AnimatedHand;
