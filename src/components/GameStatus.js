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
  redealCount,
  onShowScoreHistory,
  canClaimRest,
  waitingForClaimResponse,
  claimStatusMessage,
  onClaimRest,
  otherPlayerName,
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
      case "roundEnd":
        return "Round complete";
      case "review":
        return "Reviewing last round";
      case "gameOver":
        return "Game over";
      default:
        return "Waiting for game to start";
    }
  };

  const ordinal = (n) => {
    const suffixes = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
  };

  // Hidden once the round actually ends — it's just a transient note about
  // this round's bidding, not something worth carrying onto the round-end
  // screen or into the next round.
  const showRedealMessage = redealCount > 0 && ["bidding", "kitty", "playing"].includes(gamePhase);

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
          {showRedealMessage && <span className="redeal-message">{ordinal(redealCount)} Redeal</span>}
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
          {canClaimRest && (
            <button className="claim-rest-button" onClick={onClaimRest} disabled={waitingForClaimResponse}>
              I&apos;ve got the rest!
            </button>
          )}
          {waitingForClaimResponse && <p>Waiting for {otherPlayerName} to respond to your claim...</p>}
          {claimStatusMessage && <p>{claimStatusMessage}</p>}
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
