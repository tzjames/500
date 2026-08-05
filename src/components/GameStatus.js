import React from "react";
import "./GameStatus.css";

function GameStatus({
  players,
  playerId,
  currentTurnPlayerId,
  currentTurnIsDummy,
  dealerId,
  currentBid,
  gamePhase,
  trumpSuit,
  currentBidder,
  roundNumber,
  onShowScoreHistory,
}) {
  const currentPlayerData = players.find((p) => p.id === playerId);
  const otherPlayerData = players.find((p) => p.id !== playerId);
  const dealerName = players.find((p) => p.id === dealerId)?.name;

  const renderGamePhaseMessage = () => {
    switch (gamePhase) {
      case "bidding":
        if (currentBidder) {
          if (currentBidder === playerId) {
            return "It's your turn to bid";
          } else {
            const biddingPlayer = players.find((p) => p.id === currentBidder);
            return `Waiting for ${
              biddingPlayer.id === playerId ? "you" : biddingPlayer.name
            } to bid`;
          }
        } else {
          return "Bidding complete";
        }
      case "kitty":
        const winningBidder = players.find((p) => p.id === currentBid?.player);
        if (winningBidder) {
          return `Waiting for ${
            winningBidder.id === playerId ? "you" : winningBidder.name
          } to discard to Kitty`;
        } else {
          return "Preparing kitty phase";
        }
      case "playing": {
        const whoseHand = currentTurnIsDummy ? "dummy hand" : "hand";
        if (currentTurnPlayerId === playerId) {
          return `Your turn to play from your ${whoseHand}`;
        }
        const turnPlayerName = players.find((p) => p.id === currentTurnPlayerId)?.name;
        return `${turnPlayerName}'s turn to play from their ${whoseHand}`;
      }
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
        <h3>Round</h3>
        <p className="round-row">
          {roundNumber}
          <button
            className="graph-icon-button"
            onClick={onShowScoreHistory}
            title="View score history"
            aria-label="View score history"
          >
            📈
          </button>
        </p>
      </div>
      <div className="status-item">
        <h3>Current Score</h3>
        <p>You: {currentPlayerData.score}</p>
        <p>Opponent: {otherPlayerData.score}</p>
      </div>
      <div className="status-item">
        <h3>Current Dealer</h3>
        <p>{dealerId === playerId ? "You" : dealerName}</p>
      </div>
      <div className="status-item">
        <h3>Game Phase</h3>
        <p>{renderGamePhaseMessage()}</p>
      </div>
      {currentBid && (
        <div className="status-item">
          <h3>Current Bid</h3>
          <p>
            {currentBid.player === playerId
              ? "You"
              : players.find((p) => p.id === currentBid.player)?.name}
            : {renderBidWithColoredSuit(currentBid.bid)}
          </p>
        </div>
      )}
      {gamePhase === "playing" && (
        <div className="status-item">
          <h3>Current Tricks</h3>
          <p>You: {currentPlayerData.tricksWon || 0}</p>
          <p>Opponent: {otherPlayerData.tricksWon || 0}</p>
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
