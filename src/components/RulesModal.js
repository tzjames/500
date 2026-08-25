import React from "react";
import { createPortal } from "react-dom";
import { isRed } from "../cards";
import { VARIANTS, BID_TABLE, bidValue, trumpOrder } from "../rules";
import { OPTIONS, withDefaults, changedOptionLabels } from "../gameOptions";
import "./RulesModal.css";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");

// The bid schedule as a grid, which is the one part of 500 that's genuinely
// easier to read as a table than as a sentence.
function BidTable() {
  return (
    <div className="rules-bid-table" role="table" aria-label="Bid values">
      <div className="rules-bid-row rules-bid-head" role="row">
        <span role="columnheader">Tricks</span>
        {BID_TABLE.suits.map((suit) => (
          <span key={suit} role="columnheader" className={suitClass(suit)}>
            {suit}
          </span>
        ))}
      </div>
      {BID_TABLE.levels.map((level) => (
        <div key={level} className="rules-bid-row" role="row">
          <span role="rowheader">{level}</span>
          {BID_TABLE.suits.map((suit) => (
            <span key={suit} role="cell">
              {bidValue(level, suit)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// The extra contracts this four-player table has switched on, by their own
// names. Two-player tables have a fixed pair, listed in VARIANTS.
function specialsFor(variant, options) {
  if (variant !== "four") return VARIANTS.two.specials;
  const merged = withDefaults(options);
  const nullo = merged.misereName === "nullo";
  const names = [nullo ? "Nullo — 250" : "Misère — 250"];
  const extras = [
    ["openMisere", nullo ? "Open Nullo — 500" : "Open Misère — 500"],
    ["blindMisere", nullo ? "Blind Nullo — 1000" : "Blind Misère — 1000"],
    ["hiLo", "Hi-Lo — 350, for exactly five tricks"],
    ["doubleNullo", "Double Nullo — 500, both partners taking none"],
  ];
  for (const [id, label] of extras) if (merged[id]) names.push(label);
  return names;
}

// The rules of the game actually in front of you: the right pack, the right way
// to reach a Misère, and for a four-player table the house rules it was started
// with. Written to be skimmed mid-hand rather than read end to end.
function RulesModal({ variant = "four", trumpSuit, bid, options, onClose }) {
  const v = VARIANTS[variant] || VARIANTS.four;
  const specials = specialsFor(variant, options);
  const houseChanges = variant === "four" ? changedOptionLabels(options) : [];
  const live = trumpSuit ? trumpOrder(trumpSuit, variant) : [];

  // Portalled to the body rather than rendered where it sits in the tree. The
  // help buttons live inside the table, whose card fans are 3D-transformed under
  // transform-style: preserve-3d — and a 3D rendering context paints its
  // children by depth, not by z-index, so an overlay nested inside it loses to
  // the cards however high its z-index goes. Out here it stacks normally.
  return createPortal(
    <div className="rules-overlay" onClick={onClose}>
      <div
        className="rules-modal"
        role="dialog"
        aria-label="How to play"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="overline">How to play</p>
        <h2 className="serif rules-title">{v.name}</h2>

        <section className="rules-section">
          <h3>The table</h3>
          <p>{v.seats}</p>
          <p>{v.pack}</p>
        </section>

        <section className="rules-section">
          <h3>Bidding</h3>
          <p>
            Each bid names a number of tricks and a suit, and must be worth more
            than the standing bid. Win the auction and you take the kitty, throw
            three back, and name trumps; make your bid and you score it, miss it
            and you lose it.
          </p>
          <BidTable />
        </section>

        <section className="rules-section">
          <h3>The order of trumps</h3>
          <p>
            This is the part that trips people up. Above the ace of trumps sit
            three cards: the <strong>Joker</strong>, highest of all; the{" "}
            <strong>right bower</strong>, the jack of the trump suit; and the{" "}
            <strong>left bower</strong>, the jack of the <em>other suit of the
            same colour</em>, which stops being its own suit and becomes a trump
            for the hand.
          </p>
          <p className="rules-order-line">
            Joker <span className="rules-arrow">›</span> right bower{" "}
            <span className="rules-arrow">›</span> left bower{" "}
            <span className="rules-arrow">›</span> A{" "}
            <span className="rules-arrow">›</span> K{" "}
            <span className="rules-arrow">›</span> Q{" "}
            <span className="rules-arrow">›</span> 10{" "}
            <span className="rules-arrow">›</span> 9 <span className="rules-arrow">›</span> down
          </p>
          <p className="rules-aside">
            Note the ten: in 500 it sits directly under the queen, because the
            jack has been promoted out of the sequence.
          </p>
          {live.length > 0 && (
            <p className="rules-live">
              This hand, with{" "}
              <span className={suitClass(trumpSuit)}>{trumpSuit}</span> as trumps:{" "}
              {live.map((entry, i) => (
                <React.Fragment key={entry.label}>
                  {i > 0 && <span className="rules-arrow"> › </span>}
                  <span className={suitClass(entry.card.suit)}>{entry.label}</span>
                </React.Fragment>
              ))}
            </p>
          )}
        </section>

        <section className="rules-section">
          <h3>Playing a trick</h3>
          <p>
            Follow the suit that was led if you can. The bowers and the Joker
            count as trumps rather than their printed suit, so holding the left
            bower does not let you follow its own colour. Highest card takes the
            trick and leads the next.
          </p>
          <p>
            At no trumps the Joker still wins, and whoever leads it names the
            suit the trick is played in.
          </p>
        </section>

        <section className="rules-section">
          <h3>No-tricks contracts</h3>
          <p>{v.misere}</p>
          <ul className="rules-list">
            {specials.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="rules-aside">
            A no-tricks contract is played without trumps, and the bidder must
            win no tricks at all. An open one is played with the bidder's hand
            face up.
          </p>
        </section>

        <section className="rules-section">
          <h3>Winning</h3>
          <p>
            First side to 500 takes the game, and landing exactly on it counts.
            Fall to −500 and you have gone out the back door and lost.
          </p>
        </section>

        {variant === "four" && (
          <section className="rules-section">
            <h3>This table&apos;s house rules</h3>
            {houseChanges.length === 0 ? (
              <p>
                Everything is at its default — {OPTIONS.length} switches, none of
                them touched.
              </p>
            ) : (
              <ul className="rules-list">
                {houseChanges.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <button onClick={onClose} className="btn-ghost rules-close">
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

export default RulesModal;
