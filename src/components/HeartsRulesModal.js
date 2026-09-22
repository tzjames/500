import React, { useState } from "react";
import { createPortal } from "react-dom";
import { VARIANTS, getVariant, changedOptionLabels, optionLabelsFor } from "../heartsOptions";
import {
  dealLine,
  passingLine,
  playLines,
  penaltyLines,
  moonLine,
  winningLine,
  totalPoints,
} from "../heartsRules";
import "./RulesModal.css";

// The rules of the Hearts actually in front of you: the right pack, which cards
// cost at this table, how the passing goes, and the house rules the table was
// started with. Written to be skimmed mid-hand rather than read end to end.
//
// `mode` and `options` are the live table's when a game is open. Off the home
// page there is no table, so `choosable` lets the reader switch rule sets and
// everything below re-reads from the one they picked.
function HeartsRulesModal({
  variant = "blackLady",
  mode,
  options,
  choosable = false,
  onClose,
}) {
  const [shown, setShown] = useState(variant);
  const id = choosable ? shown : variant;
  const spec = getVariant(id);
  const seats = mode && !choosable && spec.modes.includes(mode) ? mode : spec.modes.includes(4) ? 4 : spec.modes[0];
  const houseChanges = changedOptionLabels(options, id);
  const ruleNames = optionLabelsFor(id);

  // Portalled to the body rather than rendered where it sits in the tree — see
  // RulesModal, which does the same for the same reason: the table's card fans
  // are 3D-transformed, and an overlay nested inside one loses to the cards
  // however high its z-index goes.
  return createPortal(
    <div className="rules-overlay" onClick={onClose}>
      <div
        className="rules-modal"
        role="dialog"
        aria-label="How to play Hearts"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="overline">How to play</p>
        <h2 className="serif rules-title">{choosable ? "Hearts" : `Hearts — ${spec.label}`}</h2>

        {choosable && (
          <div className="rules-switch" role="tablist" aria-label="Rule set">
            {VARIANTS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={id === option.id}
                className={`rules-switch-tab${id === option.id ? " on" : ""}`}
                onClick={() => setShown(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <section className="rules-section">
          <h3>{spec.label}</h3>
          <p>{spec.detail}</p>
          <p className="rules-aside">{dealLine(id, seats, options)}</p>
        </section>

        <section className="rules-section">
          <h3>The object</h3>
          <p>
            Hearts is played backwards. Every other trick-taking game here is
            about winning tricks; this one is about not winning the ones that
            have something in them. There is <strong>no trump suit</strong> —
            the highest card of the suit led takes the trick, and taking it is
            how you end up with the cards that cost.
          </p>
          <p className="rules-aside">
            {totalPoints(id, seats, options)} points are dealt out every hand at
            this table, and the lowest score at the end wins.
          </p>
        </section>

        <section className="rules-section">
          <h3>What costs, and how much</h3>
          <ul className="rules-list">
            {penaltyLines(id, seats, options).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="rules-section">
          <h3>Passing</h3>
          <p>{passingLine(id, seats, options)}</p>
        </section>

        <section className="rules-section">
          <h3>Playing a trick</h3>
          {playLines(id, seats, options).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>

        <section className="rules-section">
          <h3>Shooting the moon</h3>
          <p>{moonLine(id, seats, options)}</p>
        </section>

        <section className="rules-section">
          <h3>Winning</h3>
          <p>{winningLine(id, seats, options)}</p>
        </section>

        <section className="rules-section">
          <h3>{choosable ? "House rules" : "This table's house rules"}</h3>
          {choosable ? (
            <>
              <p>
                {ruleNames.length} of the variations the rules have picked up
                down the years apply to {spec.label}. Whoever starts the table
                picks them, and they are listed on the table itself.
              </p>
              <ul className="rules-list">
                {ruleNames.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </>
          ) : houseChanges.length === 0 ? (
            <p>Everything is at its default — {ruleNames.length} switches, none of them touched.</p>
          ) : (
            <ul className="rules-list">
              {houseChanges.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
        </section>

        <button onClick={onClose} className="btn-ghost rules-close">
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

export default HeartsRulesModal;
