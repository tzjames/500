import React, { useState, useEffect } from "react";
import AnimatedHand from "./AnimatedHand";
import "./Kitty.css";

function Kitty({ kittyCards, playerHand, onDone, trumpSuit }) {
  const [combinedHand, setCombinedHand] = useState([...playerHand]);
  const [selectedCards, setSelectedCards] = useState([]);
  const [isKittyAdded, setIsKittyAdded] = useState(false);

  useEffect(() => {
    if (!isKittyAdded) {
      setTimeout(() => {
        setCombinedHand([
          ...playerHand,
          ...kittyCards.map((card) => ({ ...card, isKitty: true })),
        ]);
        setIsKittyAdded(true);
      }, 1000); // Delay to allow for animation
    }
  }, [isKittyAdded, kittyCards, playerHand]);

  const handleCardClick = (index) => {
    if (selectedCards.includes(index)) {
      setSelectedCards(selectedCards.filter((i) => i !== index));
    } else if (selectedCards.length < 3) {
      setSelectedCards([...selectedCards, index]);
    }
  };

  const handleDoneDiscarding = () => {
    if (selectedCards.length === 3) {
      const newHand = combinedHand.filter(
        (_, index) => !selectedCards.includes(index)
      );
      onDone(newHand.map((card) => ({ ...card, isKitty: false })));
    }
  };

  return (
    <div className="kitty">
      <h2>Select 3 cards to discard</h2>
      <AnimatedHand
        hand={combinedHand}
        selectedCards={selectedCards}
        onCardClick={handleCardClick}
        trumpSuit={trumpSuit}
      />
      <button
        onClick={handleDoneDiscarding}
        disabled={selectedCards.length !== 3}
        className="done-button"
      >
        Done discarding
      </button>
    </div>
  );
}

export default Kitty;
