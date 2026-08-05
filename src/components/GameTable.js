import React from "react";
import PlayerHand from "./PlayerHand";
import DummyHand from "./DummyHand";
import CardFace from "./CardFace";
import "./GameTable.css";

const suitOrder = ["♠", "♣", "♥", "♦"];
const valueOrder = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function GameTable({
  playedCards,
  opponentHandSize,
  opponentDummyHandSize,
  playerHand,
  playerDummyHand,
  onPlayCard,
  isCurrentPlayerHandTurn,
  isCurrentPlayerDummyTurn,
  trumpSuit,
  winningBidder,
  playerId,
  revealedBidderHand,
  flyingWinner,
}) {
  // Your dummy is revealed once you've played your first hand card, and
  // stays revealed for the rest of the round. Derived from hand size (starts
  // at 10 post-kitty) rather than local state, so it survives reconnects.
  const hasPlayedFirstCard = playerHand.length < 10;

  const getCardColor = (suit) => (suit === "♥" || suit === "♦" ? "red" : "black");

  const renderFaceDownCards = (count, className) => {
    return Array(count)
      .fill()
      .map((_, i) => <div key={i} className={`card back ${className}`} />);
  };

  // Open Misère: once the bidder loses their first trick, their whole hand
  // is exposed — plain suit order, no trump, since there's no trump suit.
  const renderRevealedHand = (hand) => {
    const rows = suitOrder
      .map((suit) =>
        [...hand]
          .filter((c) => c.suit === suit)
          .sort((a, b) => valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value))
      )
      .concat([hand.filter((c) => c.suit === "Joker")])
      .filter((row) => row.length > 0);

    return (
      <div className="revealed-hand">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="revealed-hand-row">
            {row.map((card, cardIndex) => (
              <div
                key={cardIndex}
                className={`card ${getCardColor(card.suit)} revealed-card`}
              >
                <CardFace card={card} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const playerWonBid = winningBidder === playerId;
  // Each played card sits at the edge of the table nearest the hand it came
  // from, so it lands "in front of" whoever played it.
  const opponentSide = playerWonBid ? "right" : "left";
  const getPlayedCardPosition = (play) => {
    const isSelf = play.playerId === playerId;
    if (isSelf) return play.isDummy ? "top" : "bottom";
    if (play.isDummy) return opponentSide === "right" ? "left" : "right";
    return opponentSide;
  };
  // Once a trick is decided, every played card flies to the same anchor —
  // wherever the winner's own cards would sit — and fades out together.
  const winnerPosition = flyingWinner
    ? getPlayedCardPosition({ playerId: flyingWinner.winnerId, isDummy: flyingWinner.winnerIsDummy })
    : null;

  return (
    <div className="game-table">
      <div className="grid-row top">
        <div className="grid-cell"></div>
        <div className="grid-cell player-dummy-hand">
          {hasPlayedFirstCard ? (
            <DummyHand
              hand={playerDummyHand}
              onPlayCard={(card) => onPlayCard(card, true)}
              trumpSuit={trumpSuit}
              isCurrentPlayer={isCurrentPlayerDummyTurn}
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
          } ${revealedBidderHand ? "revealed-hand-cell" : ""}`}
        >
          {revealedBidderHand
            ? renderRevealedHand(revealedBidderHand)
            : renderFaceDownCards(
                playerWonBid ? opponentDummyHandSize : opponentHandSize,
                "vertical"
              )}
        </div>
        <div className={`grid-cell table ${revealedBidderHand ? "table-shifted" : ""}`}>
          {playedCards.map((play, index) => (
            <div
              key={index}
              className={`played-card played-card-${winnerPosition || getPlayedCardPosition(play)} card ${getCardColor(
                play.card.suit
              )} ${play.isDummy ? "dummy" : ""} ${winnerPosition ? "flying" : ""}`}
            >
              <CardFace card={play.card} />
            </div>
          ))}
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
            onPlayCard={(card) => onPlayCard(card, false)}
            trumpSuit={trumpSuit}
            isCurrentPlayer={isCurrentPlayerHandTurn}
          />
        </div>
        <div className="grid-cell"></div>
      </div>
    </div>
  );
}

export default GameTable;
