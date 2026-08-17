import React from "react";
import { isRed } from "../cards";
import "./SidePanel.css";

// Left panel: the standing contract, the score, and how the round is going.
// Replaces the old "Game Status" list — the trick counts it used to carry now
// live on the felt as physical piles, so this panel keeps only what a pile
// can't say.
function ContractPanel({
  currentBid,
  bidderName,
  playerIsBidder,
  playerScore,
  opponentScore,
  opponentName,
  playerTricksWon,
  roundNumber,
  redealCount,
  gamePhase,
  dealerIsYou,
  trumpSuit,
  onShowScoreHistory,
  canClaimRest,
  waitingForClaimResponse,
  claimStatusMessage,
  onClaimRest,
  canResign,
  canRedeal,
  offerPending,
  onOfferResign,
  onOfferRedeal,
}) {
  const bidLabel = currentBid?.bid;
  const [level, suit] = bidLabel ? bidLabel.split(" ") : [];
  const isMisere = bidLabel && bidLabel.includes("Misere");

  // Misère contracts are made by winning nothing, so "tricks still needed" is
  // meaningless for them — the bidder's target is zero and any trick kills it.
  const tricksNeeded =
    currentBid && !isMisere && playerIsBidder
      ? Math.max(0, Number(level) - playerTricksWon)
      : null;

  // Only shown while the round is live: it's a note about this round's
  // bidding, not something to carry onto the round-end screen.
  const showRedeal =
    redealCount > 0 && ["bidding", "kitty", "playing"].includes(gamePhase);

  return (
    <aside className="side-panel">
      <div className="side-panel-head">
        <span className="overline">Round {roundNumber}</span>
        <button
          className="icon-button"
          onClick={onShowScoreHistory}
          title="View score history"
          aria-label="View score history"
        >
          📈
        </button>
      </div>
      {showRedeal && <p className="side-note">Redeal ×{redealCount}</p>}

      {currentBid ? (
        <div className="contract">
          {isMisere ? (
            <span className="contract-bid serif contract-misere">{bidLabel}</span>
          ) : (
            <span className="contract-bid serif">
              {level}{" "}
              <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
            </span>
          )}
          <span className="contract-points">{currentBid.points} pts</span>
        </div>
      ) : (
        <p className="side-note">No contract yet</p>
      )}
      {currentBid && (
        <p className="side-note">
          {playerIsBidder ? "You" : bidderName} to make it
          {trumpSuit && (
            <>
              {" · "}
              <span className={isRed(trumpSuit) ? "red-suit" : ""}>
                {trumpSuit}
              </span>{" "}
              trumps
            </>
          )}
        </p>
      )}

      <div className="panel-divider" />

      <div className="score-row">
        <span>You</span>
        <span className="serif score-value">{playerScore}</span>
      </div>
      <div className="score-row">
        <span>{opponentName}</span>
        <span className="serif score-value">{opponentScore}</span>
      </div>
      <p className="side-note">
        First to 500 · {dealerIsYou ? "you deal" : `${opponentName} deals`}
      </p>

      {tricksNeeded !== null && gamePhase === "playing" && (
        <>
          <div className="panel-divider" />
          <p className="side-note">
            {tricksNeeded === 0
              ? "Contract made — every extra trick is gravy."
              : `${tricksNeeded} more trick${
                  tricksNeeded === 1 ? "" : "s"
                } to make the contract.`}
          </p>
        </>
      )}

      {canClaimRest && (
        <button
          className="btn-ghost claim-button"
          onClick={onClaimRest}
          disabled={waitingForClaimResponse}
        >
          I&apos;ve got the rest
        </button>
      )}
      {waitingForClaimResponse && (
        <p className="side-note">Waiting for {opponentName} to respond…</p>
      )}
      {claimStatusMessage && <p className="side-note">{claimStatusMessage}</p>}

      {/* Both need the other player to agree, so they read as offers. Resign
          settles the hand against you; a redeal throws it away unscored. */}
      {(canResign || canRedeal) && (
        <>
          <div className="panel-divider" />
          <div className="concede-buttons">
            {canResign && (
              <button
                className="btn-ghost concede-button"
                onClick={onOfferResign}
                disabled={offerPending}
                title="Give up this hand — the contract is settled against you"
              >
                Offer to resign
              </button>
            )}
            {canRedeal && (
              <button
                className="btn-ghost concede-button"
                onClick={onOfferRedeal}
                disabled={offerPending}
                title="Throw this hand in and deal again, scoring nothing"
              >
                Offer a redeal
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

export default ContractPanel;
