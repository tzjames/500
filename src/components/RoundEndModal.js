import React from "react";
import { Link } from "react-router-dom";
import ScoreChart from "./ScoreChart";
import { isRed } from "../cards";
import "./RoundEndModal.css";

const formatDelta = (delta) => (delta >= 0 ? `+${delta}` : `${delta}`);

function renderBid(bid) {
  if (!bid) return null;
  if (bid.includes("Misere")) return bid.replace("Misere", "Misère");
  const [level, suit] = bid.split(" ");
  return (
    <>
      {level} <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
    </>
  );
}

// Where a player now stands, and what this hand did to get them there —
// "Ada 340 (+100)". Rounds finished before totals were recorded have no
// `total`, so those fall back to showing the swing on its own.
function ResultBox({ name, total, delta }) {
  return (
    <div className={`round-result-box${delta >= 0 ? " up" : " down"}`}>
      <span className="round-result-name">{name}</span>
      <span className="round-result-figures">
        {total !== undefined && <b className="round-result-total serif">{total}</b>}
        <span className="round-result-delta serif">
          {total !== undefined ? `(${formatDelta(delta)})` : formatDelta(delta)}
        </span>
      </span>
    </div>
  );
}

// End of hand: the result, the two score swings, and where that leaves the
// game. The score chart is inline here rather than only behind the 📈 button —
// the moment you most want to see the shape of the game is right after a swing.
function RoundEndModal({
  result,
  roundEndInfo,
  playerId,
  onReady,
  onPropose,
  onRespond,
  scoreHistory = [],
  players = [],
  roundNumber,
}) {
  const {
    bid,
    bidderName,
    bidderMadeBid,
    bidderDelta,
    bidderScore,
    otherName,
    otherDelta,
    otherScore,
  } = result;
  const iAmReady = roundEndInfo.readyUserIds.includes(playerId);
  const proposal = roundEndInfo.proposal;
  const proposalIsMine = proposal?.fromUserId === playerId;
  const proposalIsIncoming = proposal && !proposalIsMine;

  return (
    <div className="round-result-overlay">
      <div className="round-result-modal">
        <p className="overline">
          Round {roundNumber} · contract {bidderMadeBid ? "made" : "missed"}
        </p>
        <h2 className="round-result-headline serif">
          {bidderName} bid {renderBid(bid)} and{" "}
          {bidderMadeBid ? "made it" : "missed it"}
        </h2>

        <div className="round-result-boxes">
          <ResultBox name={bidderName} total={bidderScore} delta={bidderDelta} />
          <ResultBox name={otherName} total={otherScore} delta={otherDelta} />
        </div>

        {scoreHistory.length > 0 && players.length > 0 && (
          <div className="round-result-chart">
            <ScoreChart
              scoreHistory={scoreHistory}
              players={players}
              width={620}
              height={168}
            />
          </div>
        )}

        {proposalIsIncoming ? (
          <div className="round-end-proposal">
            <p>
              {proposal.fromName} wants to{" "}
              {proposal.type === "review" ? "review" : "replay"} the previous
              round. Do you agree?
            </p>
            <div className="round-end-proposal-buttons">
              <button className="btn-primary" onClick={() => onRespond(true)}>
                Yes
              </button>
              <button className="btn-ghost" onClick={() => onRespond(false)}>
                No
              </button>
            </div>
          </div>
        ) : proposalIsMine ? (
          <p className="round-end-waiting">
            Waiting for a response to your invite…
          </p>
        ) : (
          <div className="round-end-buttons">
            <button className="btn-primary" disabled={iAmReady} onClick={onReady}>
              Ready for next round
            </button>
            <button
              className="btn-ghost"
              disabled={iAmReady}
              onClick={() => onPropose("review")}
            >
              Review this round
            </button>
            <button
              className="btn-ghost"
              disabled={iAmReady}
              onClick={() => onPropose("replay")}
            >
              Replay this round
            </button>
            <p className="round-end-helper-text">
              Replaying won&apos;t affect the outcome — it&apos;s just there to
              satisfy your curiosity about what might have been.
            </p>
            {iAmReady && (
              <p className="round-end-waiting">Waiting for the other player…</p>
            )}
            {/* This screen covers the top bar, so without its own way out the
                only route home was the browser's back button. The game keeps
                its place — you rejoin from the list. */}
            <Link to="/" className="round-end-leave">
              Leave for now
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoundEndModal;
