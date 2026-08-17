import React from "react";
import { isRed } from "../cards";
import { bidLabel, changedOptionLabels } from "../gameOptions";
import "./SidePanel.css";

// Left panel of the four-player board: the contract, both partnership scores,
// how the hand is going, and the house rules in force. Trick counts aren't here
// — they're piles on the felt, one per seat.
function ContractPanel4({
  state,
  onShowScoreHistory,
  canClaimRest,
  claimPending,
  onClaimRest,
}) {
  const {
    currentBid,
    noContract,
    trumpSuit,
    contract,
    seats = [],
    teamNames = [],
    teamScores = [0, 0],
    roundNumber,
    redealCount,
    dealerSeat,
    options,
    phase,
    you,
    friendly,
  } = state;

  const bidderSeat = currentBid?.seat;
  const bidder = seats.find((s) => s.seat === bidderSeat);
  const biddingTeam = bidder ? bidder.team : null;
  const label = currentBid?.bid;
  const isSpecial = label && !/^\d/.test(label);
  const [level, suit] = isSpecial || !label ? [] : label.split(" ");

  const biddingTricks = seats
    .filter((s) => s.team === biddingTeam)
    .reduce((sum, s) => sum + s.tricksWon, 0);
  const tricksNeeded =
    currentBid && !isSpecial ? Math.max(0, Number(level) - biddingTricks) : null;

  const rules = changedOptionLabels(options);
  const dealerName = seats.find((s) => s.seat === dealerSeat)?.name;

  return (
    <aside className="side-panel">
      <div className="side-panel-head">
        <span className="side-panel-head-title">
          <span className="overline">Round {roundNumber}</span>
          {friendly && (
            <span className="friendly-pill" title="This game doesn't affect anyone's Elo rating">
              Friendly
            </span>
          )}
        </span>
        <button
          className="icon-button"
          onClick={onShowScoreHistory}
          title="View score history"
          aria-label="View score history"
        >
          📈
        </button>
      </div>
      {redealCount > 0 && phase !== "roundEnd" && (
        <p className="side-note">Redeal ×{redealCount}</p>
      )}

      {noContract ? (
        <p className="side-note">No contract — ten a trick at no trumps.</p>
      ) : currentBid ? (
        <>
          <div className="contract">
            {isSpecial ? (
              <span className="contract-bid serif contract-misere">
                {bidLabel(label, options)}
              </span>
            ) : (
              <span className="contract-bid serif">
                {level} <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
              </span>
            )}
            <span className="contract-points">{currentBid.points} pts</span>
          </div>
          <p className="side-note">
            {bidderSeat === you?.seat ? "You" : bidder?.name} to make it
            {trumpSuit && (
              <>
                {" · "}
                <span className={isRed(trumpSuit) ? "red-suit" : ""}>{trumpSuit}</span> trumps
              </>
            )}
            {!trumpSuit && !isSpecial && " · no trumps"}
          </p>
        </>
      ) : (
        <p className="side-note">No contract yet</p>
      )}

      <div className="panel-divider" />

      {[0, 1].map((team) => (
        <div className="team-block" key={team}>
          <div className="score-row">
            <span>
              {team === you?.team ? "Your side" : "Them"}
              {biddingTeam === team && <span className="contract-points"> · bid</span>}
            </span>
            <span className="serif score-value">{teamScores[team]}</span>
          </div>
          <p className="side-note team-names">{teamNames[team]}</p>
        </div>
      ))}
      <p className="side-note">
        First to 500 · {dealerSeat === you?.seat ? "you deal" : `${dealerName} deals`}
      </p>

      {tricksNeeded !== null && phase === "playing" && (
        <>
          <div className="panel-divider" />
          <p className="side-note">
            {tricksNeeded === 0
              ? "Contract made — every extra trick is gravy."
              : `${tricksNeeded} more trick${tricksNeeded === 1 ? "" : "s"} for the contract.`}
          </p>
        </>
      )}

      {contract?.exact && phase === "playing" && (
        <p className="side-note">Hi-Lo — exactly five, no more.</p>
      )}
      {contract?.target === 0 && phase === "playing" && (
        <p className="side-note">
          {bidderSeat === you?.seat ? "You must" : `${bidder?.name} must`} take no tricks
          at all.
        </p>
      )}

      {/* Only from the lead, and both opponents have to agree — it hands your
          side every trick that's left. */}
      {canClaimRest && (
        <button className="btn-ghost claim-button" onClick={onClaimRest} disabled={claimPending}>
          I&apos;ve got the rest
        </button>
      )}
      {claimPending && <p className="side-note">Waiting for both opponents to agree…</p>}

      {rules.length > 0 && (
        <>
          <div className="panel-divider" />
          <p className="panel-heading">House rules</p>
          <p className="side-note">{rules.join(" · ")}</p>
        </>
      )}
    </aside>
  );
}

export default ContractPanel4;
