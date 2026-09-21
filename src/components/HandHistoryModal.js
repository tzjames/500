import React from "react";
import { createPortal } from "react-dom";
import "./RulesModal.css";
import "./HandHistoryModal.css";

// Every hand's auction, newest first. Opened from the table, where the bidding
// has usually already scrolled past by the time anyone wants to check it —
// against robots it goes by in a couple of seconds.
//
// Purely presentational. The two games log different things and call the auction
// different names, so each one adapts its own record into the shape below and
// this only lays it out:
//
//   { round, thrownIn, dealer, note, lines: [{ id, node, aside }], result }
//   result: { headline, scores: [{ label, score }] }
function HandHistoryModal({ hands = [], title, label, empty = "Nothing dealt yet.", onClose }) {
  return createPortal(
    <div className="rules-overlay" onClick={onClose}>
      <div
        className="rules-modal"
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="overline">This game</p>
        <h2 className="serif rules-title">{title}</h2>

        {hands.length === 0 ? (
          <p className="rules-aside">{empty}</p>
        ) : (
          hands.map((hand) => <Hand key={hand.id} hand={hand} />)
        )}

        <button onClick={onClose} className="btn-ghost rules-close">
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

function Hand({ hand }) {
  return (
    <section className="rules-section">
      <h3>
        Hand {hand.round}
        {hand.thrownIn && " · thrown in"}
        {hand.dealer && ` · ${hand.dealer} dealt`}
        {hand.note && <> · {hand.note}</>}
      </h3>

      {hand.lines.length === 0 ? (
        <p className="rules-aside">Nothing bid yet.</p>
      ) : (
        <ol className="hh-calls">
          {hand.lines.map((line) => (
            // A note is something that happened to the table rather than a
            // thing a player did, so it steps out of the numbering.
            <li key={line.id} className={line.aside ? "hh-note" : undefined}>
              {line.node}
            </li>
          ))}
        </ol>
      )}

      {hand.result && (
        <p className="hh-result">
          {hand.result.headline}
          {hand.result.scores?.length > 0 && (
            <>
              {" "}
              {hand.result.scores.map((side) => `${side.label} ${side.score}`).join(" · ")}
            </>
          )}
        </p>
      )}
    </section>
  );
}

export default HandHistoryModal;
