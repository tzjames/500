import React from "react";
import "./RoundEndModal.css";

function formatDelta(delta) {
  return delta >= 0 ? `+${delta}` : `${delta}`;
}

function RoundEndModal({ result, roundEndInfo, playerId, onReady, onPropose, onRespond }) {
  const { bid, bidderName, bidderMadeBid, bidderDelta, otherName, otherDelta } = result;
  const iAmReady = roundEndInfo.readyUserIds.includes(playerId);
  const proposal = roundEndInfo.proposal;
  const proposalIsMine = proposal?.fromUserId === playerId;
  const proposalIsIncoming = proposal && !proposalIsMine;

  return (
    <div className="round-result-overlay">
      <div className="round-result-modal">
        <h2>Round Complete</h2>
        <p>
          {bidderName} bid {bid} and {bidderMadeBid ? "made it!" : "missed it."}
        </p>
        <ul className="round-result-scores">
          <li className={bidderDelta >= 0 ? "positive" : "negative"}>
            {bidderName}: {formatDelta(bidderDelta)} pts
          </li>
          <li className={otherDelta >= 0 ? "positive" : "negative"}>
            {otherName}: {formatDelta(otherDelta)} pts
          </li>
        </ul>

        {proposalIsIncoming ? (
          <div className="round-end-proposal">
            <p>
              {proposal.fromName} wants to {proposal.type === "review" ? "review" : "replay"} the
              previous round. Do you agree?
            </p>
            <div className="round-end-proposal-buttons">
              <button onClick={() => onRespond(true)}>Yes</button>
              <button onClick={() => onRespond(false)}>No</button>
            </div>
          </div>
        ) : proposalIsMine ? (
          <p className="round-end-waiting">Waiting for a response to your invite...</p>
        ) : (
          <div className="round-end-buttons">
            <button disabled={iAmReady} onClick={() => onPropose("review")}>
              Invite Review of Previous Round
            </button>
            <button disabled={iAmReady} onClick={() => onPropose("replay")}>
              Invite Replay of Previous Round
            </button>
            <p className="round-end-helper-text">
              Replaying will not affect the outcome of the current round. It is just there to satisfy
              your curiosity of what could have been if you played differently.
            </p>
            <button disabled={iAmReady} onClick={onReady}>
              Ready for next round
            </button>
            {iAmReady && <p className="round-end-waiting">Waiting for the other player...</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default RoundEndModal;
