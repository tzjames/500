import React from "react";
import "./OfferModal.css";

function OfferModal({ type, fromName, onRespond, scoped }) {
  const message =
    type === "pass"
      ? `${fromName} has offered that you both pass. Do you accept?`
      : type === "retroactivePass"
      ? `${fromName} has offered you a retroactive pass. Do you accept?`
      : type === "claimRest"
      ? `${fromName} claims they've got the rest of the tricks. Do you agree?`
      : `${fromName} wants a rematch! Accept?`;

  return (
    <div className={`offer-modal-overlay ${scoped ? "offer-modal-overlay-scoped" : ""}`}>
      <div className="offer-modal">
        <p>{message}</p>
        <div className="offer-modal-buttons">
          <button onClick={() => onRespond(true)} className="offer-yes">
            Yes
          </button>
          <button onClick={() => onRespond(false)} className="offer-no">
            No
          </button>
        </div>
      </div>
    </div>
  );
}

export default OfferModal;
