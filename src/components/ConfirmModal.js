import React from "react";
import "./OfferModal.css";

// A check with yourself before an offer goes out. Both of these end the hand
// if the other player agrees, and both sit one click away in the round panel,
// so neither should be reachable by a stray click.
const COPY = {
  resign: {
    title: "Give up this hand?",
    detail:
      "The contract is settled against you and the round is scored straight away.",
    confirm: "Offer to resign",
  },
  redeal: {
    title: "Throw this hand in?",
    detail: "Nothing is scored and the same round is dealt again.",
    confirm: "Offer a redeal",
  },
};

function ConfirmModal({ type, opponentName, onConfirm, onCancel }) {
  const copy = COPY[type];
  if (!copy) return null;

  return (
    <div className="offer-modal-overlay">
      <div className="offer-modal confirm-modal">
        <p className="confirm-title">{copy.title}</p>
        <p className="confirm-detail">
          {copy.detail} {opponentName} has to agree before anything happens.
        </p>
        <div className="offer-modal-buttons">
          <button onClick={onConfirm} className="offer-yes">
            {copy.confirm}
          </button>
          <button onClick={onCancel} className="offer-no">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
