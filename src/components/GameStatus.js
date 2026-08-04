import React from "react";
import "./GameStatus.css";

function GameStatus({
  players,
  currentPlayer,
  dealerId,
  currentBid,
  gamePhase,
  tricks,
  trumpSuit,
  currentBidder,
}) {
  const currentPlayerData = players.find((p) => p.id === currentPlayer);
  const otherPlayerData = players.find((p) => p.id !== currentPlayer);
  const dealerName = players.find((p) => p.id === dealerId)?.name;

  const renderGamePhaseMessage = () => {
    switch (gamePhase) {
      case "bidding":
        if (currentBidder) {
          if (currentBidder === currentPlayer) {
            return "It's your turn to bid";
          } else {
            const biddingPlayer = players.find((p) => p.id === currentBidder);
            return `Waiting for ${
              biddingPlayer.id === currentPlayer ? "you" : biddingPlayer.name
            } to bid`;
          }
        } else {
          return "Bidding complete";
        }
      case "kitty":
        const winningBidder = players.find((p) => p.id === currentBid?.player);
        if (winningBidder) {
          return `Waiting for ${
            winningBidder.id === currentPlayer ? "you" : winningBidder.name
          } to discard to Kitty`;
        } else {
          return "Preparing kitty phase";
        }
      case "playing":
        return `${
          currentPlayer === currentPlayerData.id
            ? "Your"
            : `${currentPlayerData.name}'s`
        } turn to play a card`;
      default:
        return "Waiting for game to start";
    }
  };

  const renderBidWithColoredSuit = (bid) => {
    if (!bid) return null;
    const [number, suit] = bid.split(" ");
    return (
      <>
        {number}{" "}
        <span className={suit === "♥" || suit === "♦" ? "red-suit" : ""}>
          {suit}
        </span>
      </>
    );
  };

  return (
    <div className="game-status">
      <h2>Game Status</h2>
      <div className="status-item">
        <h3>Current Score</h3>
        <p>You: {currentPlayerData.score}</p>
        <p>Opponent: {otherPlayerData.score}</p>
      </div>
      <div className="status-item">
        <h3>Current Dealer</h3>
        <p>{dealerId === currentPlayer ? "You" : dealerName}</p>
      </div>
      <div className="status-item">
        <h3>Game Phase</h3>
        <p>{renderGamePhaseMessage()}</p>
      </div>
      {currentBid && (
        <div className="status-item">
          <h3>Current Bid</h3>
          <p>
            {currentBid.player === currentPlayer
              ? "You"
              : players.find((p) => p.id === currentBid.player)?.name}
            : {renderBidWithColoredSuit(currentBid.bid)}
          </p>
        </div>
      )}
      {gamePhase === "playing" && (
        <div className="status-item">
          <h3>Current Tricks</h3>
          <p>You: {tricks[currentPlayer]}</p>
          <p>Opponent: {tricks[otherPlayerData.id]}</p>
        </div>
      )}
      {trumpSuit && (
        <div className="status-item">
          <h3>Trump Suit</h3>
          <p
            className={trumpSuit === "♥" || trumpSuit === "♦" ? "red-suit" : ""}
          >
            {trumpSuit}
          </p>
        </div>
      )}
    </div>
  );
}

export default GameStatus;
