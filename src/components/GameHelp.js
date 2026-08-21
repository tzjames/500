import React, { useState } from "react";
import Card from "./Card";
import RulesModal from "./RulesModal";
import { getDeck } from "../theme";
import { cardColor } from "../cards";
import { trumpOrderState } from "../rules";
import "./GameHelp.css";

// The two help controls, sitting under the last trick. Rules opens a modal;
// Trump order expands a box in place, because the order of trumps is the thing
// people get wrong mid-trick and a modal would cover the table they're trying
// to read it against.
function GameHelp({ variant, trumpSuit, bid, options, deckId }) {
  const [showRules, setShowRules] = useState(false);
  const [showTrumps, setShowTrumps] = useState(false);

  const trumps = trumpOrderState(trumpSuit, bid, variant);
  const blocked = trumps.mode === "blocked";
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
          disabled={blocked}
          // Greyed out with no explanation reads as a bug, so the reason rides
          // along as the tooltip.
          title={
            trumps.reason ||
            (trumps.mode === "example"
              ? `Nothing is trumps yet — shows ${trumps.suit} as an example`
              : "Show the trump suit in order, highest first")
          }
          aria-expanded={showTrumps}
        >
          Trump order
        </button>
      </div>

      {blocked && <p className="game-help-note">{trumps.reason}</p>}

      {showTrumps && trumps.order.length > 0 && (
        <div className="trump-order">
          {/* Said plainly, so an example during the auction can't be mistaken
              for the suit having been settled. */}
          {trumps.mode === "example" ? (
            <p className="trump-order-example">
              Nothing is trumps yet. If{" "}
              <span className={cardColor(trumps.suit)}>{trumps.suit}</span> were,
              the order would run:
            </p>
          ) : (
            <p className="trump-order-cap">Highest</p>
          )}
          <ol className="trump-order-list">
            {trumps.order.map((entry) => (
              <li key={entry.label} className="trump-order-row">
                <Card
                  card={entry.card}
                  deck={deck}
                  trumpSuit={trumps.suit}
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
          {trumps.mode === "example" && (
            <p className="trump-order-example trump-order-example-foot">
              Whichever suit wins the auction, the shape is the same.
            </p>
          )}
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
