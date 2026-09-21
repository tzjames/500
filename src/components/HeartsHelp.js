import React, { useState } from "react";
import HeartsRulesModal from "./HeartsRulesModal";
import HandHistoryModal from "./HandHistoryModal";
import { heartsHands } from "../heartsHistory";
import { penaltyLines } from "../heartsRules";
import "./HelpBar.css";

// The help controls on a Hearts table. Rules and Passing open modals; Costs
// lays out what each card is worth in a single line in place, because which
// cards cost is the thing people get wrong mid-trick and a modal would cover
// the table they are reading it against.
//
// Sixteen rule sets price the cards sixteen ways, so this is far more than a
// nicety here: at a Royal Hearts table the queen of clubs is worth hunting and
// at a Greek one the lady is worth fifty, and neither is guessable.
function HeartsHelp({ variant, mode, options, history, slots, sides, yourSeat }) {
  const [showRules, setShowRules] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const costs = penaltyLines(variant, mode, options);

  return (
    <div className="help-bar">
      <div className="help-bar-buttons">
        <button type="button" className="btn-ghost help-bar-button" onClick={() => setShowRules(true)}>
          Rules
        </button>
        <button
          type="button"
          className="btn-ghost help-bar-button"
          onClick={() => setShowHistory(true)}
          title="Which way the cards went and what each seat sent, hand by hand"
        >
          Passing
        </button>
        <button
          type="button"
          className="btn-ghost help-bar-button"
          onClick={() => setShowCosts((open) => !open)}
          title="What each card costs whoever takes it"
          aria-expanded={showCosts}
        >
          Costs
        </button>
      </div>

      {showCosts && (
        <p className="help-line live">
          <span className="help-line-cap">costs</span>
          {costs.map((line, i) => (
            <React.Fragment key={line}>
              {i > 0 && <span className="rules-arrow"> · </span>}
              <span>{line}</span>
            </React.Fragment>
          ))}
        </p>
      )}

      {showHistory && (
        <HandHistoryModal
          hands={heartsHands({ history, slots, sides, yourSeat })}
          title="How each hand was passed"
          label="Passing history"
          onClose={() => setShowHistory(false)}
        />
      )}

      {showRules && (
        <HeartsRulesModal
          variant={variant}
          mode={mode}
          options={options}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}

export default HeartsHelp;
