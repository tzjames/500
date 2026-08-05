import React from "react";
import jokerImage from "../assets/joker.png";

// Renders a card's face the same way everywhere: value + suit, or for the
// Joker, value + its picture instead of a suit symbol.
function CardFace({ card }) {
  return (
    <>
      <div className="card-value">{card.value}</div>
      {card.suit === "Joker" ? (
        <img src={jokerImage} alt="Joker" className="joker-image" />
      ) : (
        <div className="card-suit">{card.suit}</div>
      )}
    </>
  );
}

export default CardFace;
