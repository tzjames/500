import React from "react";
import { createPortal } from "react-dom";
import Card from "./Card";
import { getDeck } from "../theme";
import { sortHand } from "../cards";
import { penaltyValue } from "../heartsRules";
import "./RulesModal.css";
import "./ReviewModal.css";

const key = (card) => `${card.suit}:${card.value}`;

// The hand that was just played, walked through trick by trick with everyone's
// cards face up. Step 0 is the deal; each step after it is the trick that went
// next. Only the seat that asked for the review drives it, and everyone at the
// table sees the same step — it is a shared post-mortem, not a private one.
//
// What a Hearts review is for is different from Euchre's: not who could have
// taken the trick, but who could have got out of taking it. So what each seat
// is running is what it has cost them so far.
function HeartsReviewModal({ review, variant, options, deckId, mySeat, slots = [], onStep, onDone }) {
  const deck = getDeck(deckId);
  const { tricks, hands, step, yours, widow = [], stock = [], penaltySuit, passDirection } = review;
  const nameOf = (seat) => (seat === mySeat ? "You" : slots[seat]?.name || `Seat ${seat + 1}`);

  // What each seat still held at this point: the deal, less every card they
  // have played in the tricks stepped past.
  const played = new Set(
    tricks.slice(0, step).flatMap((trick) => trick.cards.map((play) => key(play.card)))
  );
  const remaining = hands.map((hand) => hand.filter((card) => !played.has(key(card))));
  const trick = step > 0 ? tricks[step - 1] : null;
  // What this seat's tricks have cost them by this point, which is the only
  // number a Hearts post-mortem is really about.
  const costSoFar = (seat) =>
    tricks
      .slice(0, step)
      .filter((t) => t.winnerSeat === seat)
      .flatMap((t) => [...t.cards.map((play) => play.card), ...(t.widow || [])])
      .reduce((sum, card) => sum + penaltyValue(card, variant, options, penaltySuit), 0);

  return createPortal(
    <div className="rules-overlay">
      <div className="rules-modal review" role="dialog" aria-label="Review the hand">
        <p className="overline">Review</p>
        <h2 className="serif rules-title">
          {passDirection && passDirection !== "none" ? `Passed ${passDirection}` : "Nothing passed"}
          {penaltySuit && ` — ${penaltySuit} was the penalty suit`}
        </h2>

        <div className="review-step">
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

        {(widow.length > 0 || stock.length > 0) && (
          <section className="rules-section">
            <h3>{widow.length ? "The widow" : "Left in the stock"}</h3>
            <ul className="review-trick review-dead">
              {[...widow, ...stock].map((card, i) => (
                <li key={`${key(card)}-${i}`}>
                  <Card card={card} deck={deck} width={null} disabled />
                  <span>{widow.length ? "went with the first trick" : "never drawn"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {trick && (
          <section className="rules-section">
            <h3>
              This trick — {trick.winnerSeat === null ? "nobody took it" : `${nameOf(trick.winnerSeat)} took it`}
            </h3>
            <ul className="review-trick">
              {trick.cards.map((play) => (
                <li
                  key={`${play.seat}-${key(play.card)}`}
                  className={play.seat === trick.winnerSeat ? "won" : undefined}
                >
                  <Card card={play.card} deck={deck} width={null} disabled />
                  <span>{nameOf(play.seat)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rules-section">
          <h3>{step === 0 ? "The hands as dealt" : "What was left after it"}</h3>
          <div className="review-hands">
            {remaining.map((hand, seat) => (
              <div key={seat} className="review-hand">
                <span className="review-who">
                  {nameOf(seat)}
                  {step > 0 && <b>{costSoFar(seat)}</b>}
                </span>
                <span className="review-cards">
                  {hand.length === 0 ? (
                    <i>out of cards</i>
                  ) : (
                    sortHand(hand, null).map((card, i) => (
                      <Card key={`${key(card)}-${i}`} card={card} deck={deck} width={null} disabled />
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

export default HeartsReviewModal;
