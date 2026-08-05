import React, { useMemo } from "react";
import CardFace from "./CardFace";
import "./RoundReviewModal.css";

const STEP_TYPES = ["kittyDealt", "discard", "dummyDealt", "play", "trick", "result"];
const suitOrder = ["♠", "♣", "♥", "♦"];
const valueOrder = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function sameCard(a, b) {
  return a.suit === b.suit && a.value === b.value;
}

function sortCards(cards) {
  return [...(cards || [])].sort((a, b) => {
    if (a.suit === "Joker" || b.suit === "Joker") return a.suit === b.suit ? 0 : a.suit === "Joker" ? 1 : -1;
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    return suitDiff !== 0 ? suitDiff : valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value);
  });
}

// Folds this round's log entries up to `index` into "what the table looked
// like at this point" — a pure reducer so forward/back is just moving an
// index, no server round-trip needed.
function buildFrame(dealEntry, steps, index) {
  const frame = {
    hands: { ...dealEntry.hands },
    dummyHands: {},
    kitty: [],
    discarded: null,
    trick: [],
    tricksWon: {},
    lastTrickWinner: null,
    result: null,
  };
  for (let i = 0; i <= index; i++) {
    const e = steps[i];
    switch (e.type) {
      case "kittyDealt":
        frame.kitty = e.kitty;
        break;
      case "discard":
        frame.discarded = e.discarded;
        frame.hands[e.userId] = e.handAfter;
        frame.kitty = [];
        break;
      case "dummyDealt":
        frame.dummyHands = { ...frame.dummyHands, ...e.hands };
        // The discard pile is only interesting for the one step right after
        // it happens — dummy hands are dealt immediately afterward, so that's
        // the natural point to stop showing it for the rest of the round.
        frame.discarded = null;
        break;
      case "play": {
        const key = e.isDummy ? "dummyHands" : "hands";
        frame[key] = {
          ...frame[key],
          [e.userId]: (frame[key][e.userId] || []).filter((c) => !sameCard(c, e.card)),
        };
        frame.trick = [...frame.trick, { userId: e.userId, card: e.card, isDummy: e.isDummy }];
        break;
      }
      case "trick":
        frame.tricksWon = e.tricksWon;
        frame.lastTrickWinner = e.winnerId;
        frame.trick = [];
        break;
      case "result":
        frame.result = e;
        break;
      default:
        break;
    }
  }
  return frame;
}

// Navigation is driven by whichever player proposed the review — the server
// is the source of truth for `stepIndex` so both clients stay in lockstep;
// the other player just watches (see the isController-gated nav below).
function RoundReviewModal({ round, log, players, stepIndex, isController, controllerName, onStep, onDone }) {
  const dealEntry = useMemo(() => log.find((e) => e.type === "deal"), [log]);
  const bidWonEntry = useMemo(() => log.find((e) => e.type === "bidWon"), [log]);
  const steps = useMemo(() => log.filter((e) => STEP_TYPES.includes(e.type)), [log]);
  const clampedIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const frame = useMemo(() => buildFrame(dealEntry, steps, clampedIndex), [dealEntry, steps, clampedIndex]);

  const nameOf = (userId) => players.find((p) => p.id === userId)?.name || "Unknown";

  const renderHand = (cards) => (
    <div className="review-hand">
      {sortCards(cards).map((card, i) => (
        <div key={i} className={`card ${card.suit === "♥" || card.suit === "♦" ? "red" : "black"} review-card`}>
          <CardFace card={card} />
        </div>
      ))}
    </div>
  );

  if (!dealEntry || !bidWonEntry) {
    return (
      <div className="round-review-overlay">
        <div className="round-review-modal">
          <p>Nothing to review for this round.</p>
          <button onClick={onDone}>Back to round</button>
        </div>
      </div>
    );
  }

  return (
    <div className="round-review-overlay">
      <div className="round-review-modal">
        <h2>Reviewing Round {round}</h2>
        <p className="review-bid-line">
          {nameOf(bidWonEntry.userId)} bid {bidWonEntry.bid} ({bidWonEntry.points} pts) — Trump:{" "}
          {bidWonEntry.trumpSuit || "None"}
        </p>

        <div className="review-players">
          {Object.keys(dealEntry.hands).map((userId) => (
            <div key={userId} className="review-player-column">
              <h3>
                {nameOf(userId)}
                {frame.tricksWon[userId] !== undefined && ` — ${frame.tricksWon[userId]} tricks`}
              </h3>
              <p className="review-hand-label">Hand</p>
              {renderHand(frame.hands[userId])}
              {frame.dummyHands[userId] && (
                <>
                  <p className="review-hand-label">Dummy</p>
                  {renderHand(frame.dummyHands[userId])}
                </>
              )}
            </div>
          ))}
        </div>

        {frame.kitty.length > 0 && (
          <div className="review-kitty">
            <p className="review-hand-label">Kitty</p>
            {renderHand(frame.kitty)}
          </div>
        )}
        {frame.discarded && (
          <div className="review-kitty">
            <p className="review-hand-label">{nameOf(bidWonEntry.userId)} discarded</p>
            {renderHand(frame.discarded)}
          </div>
        )}

        {Object.keys(frame.dummyHands).length > 0 && (
          // Rendered (and height-reserved, via CSS) for the whole rest of the
          // round once play has started — not just while a trick happens to
          // have cards on it — so the modal doesn't resize every time a trick
          // resolves and this briefly goes empty between tricks.
          <div className="review-trick">
            <p className="review-hand-label">Current trick</p>
            {frame.trick.length > 0 ? (
              frame.trick.map((play, i) => (
                <div key={i} className="review-trick-card">
                  <div className={`card ${play.card.suit === "♥" || play.card.suit === "♦" ? "red" : "black"}`}>
                    <CardFace card={play.card} />
                  </div>
                  <span>
                    {nameOf(play.userId)}
                    {play.isDummy ? " (dummy)" : ""}
                  </span>
                </div>
              ))
            ) : (
              <p className="review-trick-empty">—</p>
            )}
          </div>
        )}

        {frame.result && (
          <p className="review-result">
            {nameOf(frame.result.bidderId)} {frame.result.bidderMadeBid ? "made" : "missed"} the bid.
          </p>
        )}

        {isController ? (
          <>
            <div className="review-nav">
              <button disabled={clampedIndex === 0} onClick={() => onStep(clampedIndex - 1)}>
                ← Back
              </button>
              <span>
                Step {clampedIndex + 1} / {steps.length}
              </span>
              <button disabled={clampedIndex === steps.length - 1} onClick={() => onStep(clampedIndex + 1)}>
                Forward →
              </button>
            </div>
            <button className="review-done-button" onClick={onDone}>
              Back to round
            </button>
          </>
        ) : (
          <div className="review-nav">
            <span>
              Step {clampedIndex + 1} / {steps.length} — {controllerName} is controlling the review
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoundReviewModal;
