import React from "react";
import "./GameBoard.css"; // Create this CSS file with styles similar to PlayerHand.css

function GameBoard({ currentTrick, trumpSuit, players }) {
  const getCardColor = (suit) => {
    return suit === "♥" || suit === "♦" ? "red" : "black";
  };

  return (
    <div className="game-board">
      <h2>Game Board</h2>
      <p>
        Trump Suit:{" "}
        <span className={`trump ${getCardColor(trumpSuit)}`}>
          {trumpSuit || "Not set"}
        </span>
      </p>
      <div className="current-trick">
        <h3>Current Trick</h3>
        {currentTrick && currentTrick.length > 0 ? (
          <div className="played-cards">
            {currentTrick.map((play, index) => (
              <div
                key={index}
                className={`card ${getCardColor(play.card.suit)}`}
              >
                <div className="card-value">{play.card.value}</div>
                <div className="card-suit">{play.card.suit}</div>
                <div className="player-id">
                  {players.find((p) => p.id === play.playerId).name}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No cards played yet</p>
        )}
      </div>
    </div>
  );
}

export default GameBoard;
