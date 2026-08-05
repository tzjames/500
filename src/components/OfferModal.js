import React from "react";
import "./OfferModal.css";

function OfferModal({ type, fromName, onRespond }) {
  const message =
    type === "pass"
      ? `${fromName} has offered that you both pass. Do you accept?`
      : type === "retroactivePass"
      ? `${fromName} has offered you a retroactive pass. Do you accept?`
      : `${fromName} wants a rematch! Accept?`;

  return (
    <div className="offer-modal-overlay">
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
