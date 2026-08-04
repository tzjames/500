import React, { useState } from "react";
import PlayerHand from "./PlayerHand";
import DummyHand from "./DummyHand";
import "./GameTable.css";

function GameTable({
  playedCards,
  opponentHandSize,
  opponentDummyHandSize,
  playerHand,
  playerDummyHand,
  onPlayCard,
  isCurrentPlayer,
  trumpSuit,
  winningBidder,
  playerId,
}) {
  const [firstCardPlayed, setFirstCardPlayed] = useState(false);

  console.log("GameTable - playerHand:", playerHand);
  console.log("GameTable - playerDummyHand:", playerDummyHand);

  const renderFaceDownCards = (count, className) => {
    return Array(count)
      .fill()
      .map((_, i) => <div key={i} className={`card back ${className}`} />);
  };

  const handlePlayCard = (card, isDummy) => {
    if (!firstCardPlayed && !isDummy) {
      setFirstCardPlayed(true);
    }
    onPlayCard(card, isDummy);
  };

  const playerWonBid = winningBidder === playerId;

  return (
    <div className="game-table">
      <div className="grid-row top">
        <div className="grid-cell"></div>
        <div className="grid-cell player-dummy-hand">
          {firstCardPlayed ? (
            <DummyHand
              hand={playerDummyHand}
              onPlayCard={(card) => handlePlayCard(card, true)}
              isCurrentPlayer={isCurrentPlayer}
            />
          ) : (
            renderFaceDownCards(10, "horizontal")
          )}
        </div>
        <div className="grid-cell"></div>
      </div>
      <div className="grid-row middle">
        <div
          className={`grid-cell ${
            playerWonBid ? "opponent-dummy-hand" : "opponent-hand"
          }`}
        >
          {renderFaceDownCards(
            playerWonBid ? opponentDummyHandSize : opponentHandSize,
            "vertical"
          )}
        </div>
        <div className="grid-cell table">
          <div className="played-cards">
            {playedCards.map((play, index) => (
              <div
                key={index}
                className={`card ${play.isDummy ? "dummy" : ""} ${
                  play.playerId === "opponent" ? "opponent" : "player"
                }`}
              >
                {play.card.value} of {play.card.suit}
              </div>
            ))}
          </div>
        </div>
        <div
          className={`grid-cell ${
            playerWonBid ? "opponent-hand" : "opponent-dummy-hand"
          }`}
        >
          {renderFaceDownCards(
            playerWonBid ? opponentHandSize : opponentDummyHandSize,
            "vertical"
          )}
        </div>
      </div>
      <div className="grid-row bottom">
        <div className="grid-cell"></div>
        <div className="grid-cell player-hand-container">
          <PlayerHand
            hand={playerHand}
            onPlayCard={(card) => handlePlayCard(card, false)}
            trumpSuit={trumpSuit}
            isCurrentPlayer={isCurrentPlayer}
          />
        </div>
        <div className="grid-cell"></div>
      </div>
    </div>
  );
}

export default GameTable;
