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
// the shape of the game so far.
function RoundEnd4Modal({ result, roundEnd, you, options, scoreHistory = [], roundNumber, onReady }) {
  const ready = roundEnd?.readyUserIds?.includes(you?.userId);
  const headline = result.noContract
    ? "Nobody bid — ten a trick"
    : `${result.bidderName} bid ${result.bid} and ${result.made ? "made it" : "missed it"}`;

  return (
    <div className="round-result-overlay">
      <div className="round-result-modal">
        <p className="overline">
          Round {roundNumber} ·{" "}
          {result.noContract ? "no contract" : `contract ${result.made ? "made" : "missed"}`}
        </p>
        <h2 className="round-result-headline serif">
          {result.noContract ? (
            headline
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
            {result.ralphedName} went down by more than three, so they sit out the next
            auction.
          </p>
        )}

        <div className="round-result-boxes">
          {result.teams.map((team, index) => (
            <div
              key={index}
              className={`round-result-box${team.delta >= 0 ? " up" : " down"}`}
            >
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

        <div className="round-end-buttons">
          <button className="btn-primary" disabled={ready} onClick={onReady}>
            Ready for next round
          </button>
          {ready && <p className="round-end-waiting">Waiting for the others…</p>}
        </div>
      </div>
    </div>
  );
}

export default RoundEnd4Modal;
