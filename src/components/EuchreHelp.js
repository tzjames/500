import React, { useState } from "react";
import EuchreRulesModal from "./EuchreRulesModal";
import HandHistoryModal from "./HandHistoryModal";
import { euchreHands } from "../euchreHistory";
import { trumpOrderState } from "../euchreRules";
import { isRed } from "../cards";
import "./EuchreHelp.css";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");

// The help controls on a Euchre table. Rules and Calling open modals; Trumps
// lays the order out in a single line in place, because the bowers are the
// thing people get wrong mid-trick and a modal would cover the table they are
// reading it against. One line rather than the column of cards the 500 board
// uses — a Euchre trump suit is at most eleven cards and the board has no room
// to spare.
function EuchreHelp({ variant, mode, options, trumpSuit, noTrump, history, slots, sides, yourSeat }) {
  const [showRules, setShowRules] = useState(false);
  const [showTrumps, setShowTrumps] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const trumps = trumpOrderState(trumpSuit, variant, options, noTrump);
  const blocked = trumps.mode === "blocked";

  return (
    <div className="eu-help">
      <div className="eu-help-buttons">
        <button type="button" className="btn-ghost eu-help-button" onClick={() => setShowRules(true)}>
          Rules
        </button>
        <button
          type="button"
          className="btn-ghost eu-help-button"
          onClick={() => setShowHistory(true)}
          title="Who passed, who called and what was turned up, hand by hand"
        >
          Calling
        </button>
        <button
          type="button"
          className="btn-ghost eu-help-button"
          onClick={() => setShowTrumps((open) => !open)}
          disabled={blocked}
          // Greyed out with no explanation reads as a bug, so the reason rides
          // along as the tooltip.
          title={
            trumps.reason ||
            (trumps.mode === "example"
              ? `Nothing is trump yet — shows ${trumps.suit} as an example`
              : "Show the trump suit in order, highest first")
          }
          aria-expanded={showTrumps}
        >
          Trumps
        </button>
      </div>

      {showTrumps && !blocked && (
        <p className={`eu-trump-line${trumps.mode === "live" ? " live" : ""}`}>
          <span className="eu-trump-cap">
            {trumps.mode === "example" ? (
              <>
                if <span className={suitClass(trumps.suit)}>{trumps.suit}</span> were trump
              </>
            ) : (
              "highest"
            )}
          </span>
          {trumps.order.map((entry, i) => (
            <React.Fragment key={entry.label}>
              {i > 0 && <span className="rules-arrow"> › </span>}
              <span className={suitClass(entry.card.suit)} title={entry.note || undefined}>
                {entry.label}
              </span>
            </React.Fragment>
          ))}
        </p>
      )}

      {showHistory && (
        <HandHistoryModal
          hands={euchreHands({ history, slots, sides, yourSeat })}
          title="How each hand was called"
          label="Calling history"
          onClose={() => setShowHistory(false)}
        />
      )}

      {showRules && (
        <EuchreRulesModal
          variant={variant}
          mode={mode}
          options={options}
          trumpSuit={trumpSuit}
          noTrump={noTrump}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}

export default EuchreHelp;
