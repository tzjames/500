import React from "react";
import { createPortal } from "react-dom";
import Card from "./Card";
import { getDeck } from "../theme";
import { isRed, sortHand } from "../cards";
import "./RulesModal.css";
import "./EuchreReviewModal.css";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");
const key = (card) => `${card.suit}:${card.value}`;

// The hand that was just played, walked through trick by trick with everyone's
// cards face up. Step 0 is the deal; each step after it is the trick that went
// next. Only the seat that asked for the review drives it, and everyone at the
// table sees the same step — it is a shared post-mortem, not a private one.
function EuchreReviewModal({ review, deckId, mySeat, slots = [], onStep, onDone }) {
  const deck = getDeck(deckId);
  const { tricks, hands, trumpSuit, callerSeat, out = [], step, yours } = review;
  const nameOf = (seat) => (seat === mySeat ? "You" : slots[seat]?.name || `Seat ${seat + 1}`);

  // What each seat still held at this point: the deal, less every card they
  // have played in the tricks stepped past.
  const played = new Set(
    tricks.slice(0, step).flatMap((trick) => trick.cards.map((play) => key(play.card)))
  );
  const remaining = hands.map((hand) => hand.filter((card) => !played.has(key(card))));
  const trick = step > 0 ? tricks[step - 1] : null;
  const tricksSoFar = (seat) =>
    tricks.slice(0, step).filter((t) => t.winnerSeat === seat).length;

  return createPortal(
    <div className="rules-overlay">
      <div className="rules-modal eu-review" role="dialog" aria-label="Review the hand">
        <p className="overline">Review</p>
        <h2 className="serif rules-title">
          {nameOf(callerSeat)} called{" "}
          {review.noTrump ? "no trump" : <span className={suitClass(trumpSuit)}>{trumpSuit}</span>}
          {review.bid ? ` for ${review.bid}` : ""}
          {review.alone && " — alone"}
        </h2>

        <div className="eu-review-step">
          <button
            type="button"
            className="btn-ghost"
            disabled={!yours || step === 0}
            onClick={() => onStep(step - 1)}
          >
            ‹ Back
          </button>
          <span>{step === 0 ? "As dealt" : `Trick ${step} of ${tricks.length}`}</span>
          <button
            type="button"
            className="btn-ghost"
            disabled={!yours || step >= tricks.length}
            onClick={() => onStep(step + 1)}
          >
            Next ›
          </button>
        </div>

        {!yours && <p className="rules-aside">Whoever asked for the review is turning the pages.</p>}

        {trick && (
          <section className="rules-section">
            <h3>
              This trick — {nameOf(trick.winnerSeat)} took it
            </h3>
            <ul className="eu-review-trick">
              {trick.cards.map((play) => (
                <li
                  key={`${play.seat}-${key(play.card)}`}
                  className={play.seat === trick.winnerSeat ? "won" : undefined}
                >
                  <Card card={play.card} deck={deck} width={null} trumpSuit={trumpSuit} disabled />
                  <span>{nameOf(play.seat)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rules-section">
          <h3>{step === 0 ? "The hands as dealt" : "What was left after it"}</h3>
          <div className="eu-review-hands">
            {remaining.map((hand, seat) => (
              <div key={seat} className={`eu-review-hand${out.includes(seat) ? " out" : ""}`}>
                <span className="eu-review-who">
                  {nameOf(seat)}
                  {seat === callerSeat && <em>maker</em>}
                  {out.includes(seat) && <em>sat out</em>}
                  {step > 0 && !out.includes(seat) && <b>{tricksSoFar(seat)}</b>}
                </span>
                <span className="eu-review-cards">
                  {out.includes(seat) ? (
                    <i>cards face down</i>
                  ) : hand.length === 0 ? (
                    <i>out of cards</i>
                  ) : (
                    sortHand(hand, trumpSuit).map((card) => (
                      <Card key={key(card)} card={card} deck={deck} width={null} trumpSuit={trumpSuit} disabled />
                    ))
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        <button onClick={onDone} className="btn-ghost rules-close" disabled={!yours}>
          {yours ? "Done" : "Waiting for them to finish"}
        </button>
      </div>
    </div>,
    document.body
  );
}

export default EuchreReviewModal;
