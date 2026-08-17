import React from "react";
import ScoreChart from "./ScoreChart";
import "./ScoreHistoryModal.css";

// The 📈 button's full-size view. Same chart the round-end card shows, just
// bigger and with hover readouts turned on.
function ScoreHistoryModal({ scoreHistory, players, onClose }) {
  return (
    <div className="score-history-overlay" onClick={onClose}>
      <div className="score-history-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="serif">Score history</h2>
        {scoreHistory.length === 0 ? (
          <p className="score-history-empty">
            No rounds finished yet — this fills in as you play.
          </p>
        ) : (
          <ScoreChart
            scoreHistory={scoreHistory}
            players={players}
            width={680}
            height={260}
            interactive
          />
        )}
        <button onClick={onClose} className="btn-ghost score-history-close">
          Close
        </button>
      </div>
    </div>
  );
}

export default ScoreHistoryModal;
