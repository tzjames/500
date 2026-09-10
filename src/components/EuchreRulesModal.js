import React, { useState } from "react";
import { createPortal } from "react-dom";
import { isRed } from "../cards";
import { VARIANTS, getVariant, changedOptionLabels, optionLabelsFor } from "../euchreOptions";
import {
  dealLine,
  kittyLine,
  callingLines,
  scoringLines,
  winningLine,
  trumpOrderState,
} from "../euchreRules";
import "./RulesModal.css";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");

// The rules of the Euchre actually in front of you: the right pack, the way this
// rule set reaches trump, its own scoring, and the house rules the table was
// started with. Written to be skimmed mid-hand rather than read end to end.
//
// `mode` and `options` are the live table's when a game is open. Off the home
// page there is no table, so `choosable` lets the reader switch rule sets and
// everything below re-reads from the one they picked.
function EuchreRulesModal({
  variant = "northAmerican",
  mode,
  options,
  trumpSuit,
  noTrump = false,
  choosable = false,
  onClose,
}) {
  const [shown, setShown] = useState(variant);
  const id = choosable ? shown : variant;
  const spec = getVariant(id);
  const seats = mode && !choosable ? mode : spec.modes[spec.modes.length - 1];
  const houseChanges = changedOptionLabels(options, id);
  const trumps = trumpOrderState(trumpSuit, id, options, noTrump);
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
        aria-label="How to play Euchre"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="overline">How to play</p>
        <h2 className="serif rules-title">
          {choosable ? "Euchre" : `Euchre — ${spec.label}`}
        </h2>

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

        {kittyLine(id, seats, options) && (
          <section className="rules-section">
            <h3>The kitty</h3>
            <p>{kittyLine(id, seats, options)}</p>
          </section>
        )}

        <section className="rules-section">
          <h3>Making trump</h3>
          {callingLines(id, options).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>

        <section className="rules-section">
          <h3>The order of trumps</h3>
          <p>
            This is the part that trips people up. Above the ace of trumps sit
            two cards: the <strong>right bower</strong>, the jack of the trump
            suit, and the <strong>left bower</strong>, the jack of the{" "}
            <em>other suit of the same colour</em>, which stops being its own
            suit and becomes a trump for the hand.
          </p>
          {trumps.mode === "blocked" ? (
            <p className="rules-aside">{trumps.reason}</p>
          ) : (
            <>
              <p className="rules-aside">
                {trumps.mode === "example"
                  ? `Nothing is trump yet — with ${trumps.suit} it would run:`
                  : "This hand:"}
              </p>
              <p className={trumps.mode === "live" ? "rules-live" : "rules-order-line"}>
                {trumps.order.map((entry, i) => (
                  <React.Fragment key={entry.label}>
                    {i > 0 && <span className="rules-arrow"> › </span>}
                    <span className={suitClass(entry.card.suit)}>{entry.label}</span>
                  </React.Fragment>
                ))}
              </p>
              <p className="rules-aside">
                Note the ten: it sits directly under the queen, because the jack
                has been promoted out of the sequence.
              </p>
            </>
          )}
        </section>

        <section className="rules-section">
          <h3>Playing a trick</h3>
          <p>
            The player to the dealer&apos;s left leads the first trick — or the
            next one round, if that seat is sitting the hand out. Follow the suit
            that was led if you can. Both bowers count as trumps rather than
            their printed suit, so holding the left bower does not let you follow
            its own colour — and does not excuse you from following trump.
            Highest card takes the trick and leads the next.
          </p>
        </section>

        <section className="rules-section">
          <h3>Scoring</h3>
          <ul className="rules-list">
            {scoringLines(id, options).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="rules-section">
          <h3>Winning</h3>
          <p>{winningLine(id, options)}</p>
        </section>

        <section className="rules-section">
          <h3>{choosable ? "House rules" : "This table's house rules"}</h3>
          {choosable ? (
            <>
              <p>
                {ruleNames.length} of the variations the rules have picked up down
                the years apply to {spec.label}. Whoever starts the table picks
                them, and they are listed on the table itself.
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

export default EuchreRulesModal;
