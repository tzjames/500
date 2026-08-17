import React from "react";
import ScoreChart from "./ScoreChart";
import { isRed } from "../cards";
import { bidLabel } from "../gameOptions";
import "./RoundEndModal.css";

const formatDelta = (delta) => (delta >= 0 ? `+${delta}` : `${delta}`);

function renderBid(bid, options) {
  if (!bid) return null;
  if (!/^\d/.test(bid)) return bidLabel(bid, options);
  const [level, suit] = bid.split(" ");
  return (
    <>
      {level} <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
    </>
  );
}

// End of hand: what the contract did, where both partnerships now stand, and
// the shape of the game so far. Also where the table decides whether to look
// back at the hand before moving on, and — where the house plays it — where you
// commit to going blind on the next one, which has to happen before you see it.
function RoundEnd4Modal({
  result,
  roundEnd,
  you,
  options,
  scoreHistory = [],
  roundNumber,
  onReady,
  onPropose,
  onRespondToProposal,
  onSetBlindIntent,
}) {
  const ready = roundEnd?.readyUserIds?.includes(you?.userId);
  const proposal = roundEnd?.proposal;

  if (proposal?.awaitingYou) {
    return (
      <Shell>
        <div className="round-end-proposal">
          <p>
            {proposal.fromName} wants to{" "}
            {proposal.type === "review" ? "review" : "replay"} the hand that just went.
            Do you agree?
          </p>
          <div className="round-end-proposal-buttons">
            <button className="btn-primary" onClick={() => onRespondToProposal(true)}>
              Yes
            </button>
            <button className="btn-ghost" onClick={() => onRespondToProposal(false)}>
              No
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="overline">
        Round {roundNumber} ·{" "}
        {result.noContract ? "no contract" : `contract ${result.made ? "made" : "missed"}`}
      </p>
      <h2 className="round-result-headline serif">
        {result.noContract ? (
          "Nobody bid — ten a trick"
        ) : (
          <>
            {result.bidderName} bid {renderBid(result.bid, options)} and{" "}
            {result.made ? "made it" : "missed it"}
          </>
        )}
      </h2>
      {result.slam && <p className="round-end-helper-text">All ten tricks — that&apos;s a slam.</p>}
      {result.ralphedName && (
        <p className="round-end-helper-text">
          {result.ralphedName} went down by more than three, so they sit out the next auction.
        </p>
      )}

      <div className="round-result-boxes">
        {result.teams.map((team, index) => (
          <div key={index} className={`round-result-box${team.delta >= 0 ? " up" : " down"}`}>
            <span className="round-result-name">
              {index === you?.team ? "Your side" : "Them"} · {team.name}
            </span>
            <span className="round-result-figures">
              <b className="round-result-total serif">{team.score}</b>
              <span className="round-result-delta serif">({formatDelta(team.delta)})</span>
            </span>
          </div>
        ))}
      </div>

      {scoreHistory.length > 0 && (
        <div className="round-result-chart">
          <ScoreChart
            scoreHistory={scoreHistory}
            players={result.teams.map((t) => ({ name: t.name }))}
            width={620}
            height={168}
          />
        </div>
      )}

      {options?.blindMisere && !ready && (
        <label className="round-end-blind">
          <input
            type="checkbox"
            checked={Boolean(roundEnd?.blindIntent)}
            onChange={(e) => onSetBlindIntent(e.target.checked)}
          />
          <span>
            <b>I plan to bid Blind {options.misereName === "nullo" ? "Nullo" : "Misère"}</b>
            <span className="round-end-blind-note">
              Your next hand is dealt face down. When the auction reaches you, you&apos;ll be
              asked whether you still want it — say no and you get to see your cards.
            </span>
          </span>
        </label>
      )}

      {proposal?.mine ? (
        <p className="round-end-waiting">
          Waiting on {proposal.waitingOn} {proposal.waitingOn === 1 ? "player" : "players"} to
          agree to your invite…
        </p>
      ) : (
        <div className="round-end-buttons">
          <button className="btn-primary" disabled={ready} onClick={onReady}>
            Ready for next round
          </button>
          <button className="btn-ghost" disabled={ready} onClick={() => onPropose("review")}>
            Review this round
          </button>
          <button className="btn-ghost" disabled={ready} onClick={() => onPropose("replay")}>
            Replay this round
          </button>
          <p className="round-end-helper-text">
            Everyone still at the table has to agree. Replaying won&apos;t affect the
            outcome — it&apos;s just there to satisfy your curiosity about what might have
            been.
          </p>
          {ready && <p className="round-end-waiting">Waiting for the others…</p>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="round-result-overlay">
      <div className="round-result-modal">{children}</div>
    </div>
  );
}

export default RoundEnd4Modal;
