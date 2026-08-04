import React from "react";
import "./DummyHand.css";

function DummyHand({ hand, onPlayCard, isCurrentPlayer }) {
  const getCardColor = (suit) => {
    return suit === "♥" || suit === "♦" ? "red" : "black";
  };

  return (
    <div className="dummy-hand">
      <h2>Dummy Hand</h2>
      <div className="dummy-cards">
        {hand.map((card, index) => (
          <div
            key={index}
            className={`dummy-card ${getCardColor(card.suit)}`}
            onClick={() => isCurrentPlayer && onPlayCard(card)}
            disabled={!isCurrentPlayer}
          >
            <div className="dummy-card-value">{card.value}</div>
            <div className="dummy-card-suit">{card.suit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DummyHand;
