import React, { useState } from "react";
import Card from "./Card";
import RulesModal from "./RulesModal";
import { getDeck } from "../theme";
import { cardColor } from "../cards";
import { trumpOrder, noTrumpReason } from "../rules";
import "./GameHelp.css";

// The two help controls, sitting under the last trick. Rules opens a modal;
// Trump order expands a box in place, because the order of trumps is the thing
// people get wrong mid-trick and a modal would cover the table they're trying
// to read it against.
function GameHelp({ variant, trumpSuit, bid, options, deckId }) {
  const [showRules, setShowRules] = useState(false);
  const [showTrumps, setShowTrumps] = useState(false);

  const blocked = noTrumpReason(trumpSuit, bid);
  const order = blocked ? [] : trumpOrder(trumpSuit, variant);
  const deck = getDeck(deckId);

  return (
    <div className="game-help">
      <div className="game-help-buttons">
        <button
          type="button"
          className="btn-ghost game-help-button"
          onClick={() => setShowRules(true)}
        >
          Rules
        </button>
        <button
          type="button"
          className="btn-ghost game-help-button"
          onClick={() => setShowTrumps((open) => !open)}
          disabled={Boolean(blocked)}
          // Greyed out with no explanation reads as a bug, so the reason rides
          // along as the tooltip.
          title={blocked || "Show the trump suit in order, highest first"}
          aria-expanded={showTrumps}
        >
          Trump order
        </button>
      </div>

      {blocked && <p className="game-help-note">{blocked}</p>}

      {showTrumps && order.length > 0 && (
        <div className="trump-order">
          <p className="trump-order-cap">Highest</p>
          <ol className="trump-order-list">
            {order.map((entry) => (
              <li key={entry.label} className="trump-order-row">
                <Card
                  card={entry.card}
                  deck={deck}
                  trumpSuit={trumpSuit}
                  width={null}
                  disabled
                  className={cardColor(entry.card.suit)}
                />
                <span className="trump-order-text">
                  <span className={`trump-order-name ${cardColor(entry.card.suit)}`}>
                    {entry.label}
                  </span>
                  {entry.note && <span className="trump-order-note">{entry.note}</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="trump-order-cap">Lowest</p>
        </div>
      )}

      {showRules && (
        <RulesModal
          variant={variant}
          trumpSuit={trumpSuit}
          bid={bid}
          options={options}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}

export default GameHelp;
