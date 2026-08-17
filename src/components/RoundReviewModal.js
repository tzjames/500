import React, { useMemo } from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { SUIT_ORDER as suitOrder, VALUE_ORDER as valueOrder, cardColor } from "../cards";
import "./RoundReviewModal.css";

// Shared by both sizes of game: the four-player room logs the same shapes,
// keyed by userId, so the only entries here it never emits are the two-player
// ones (dummyDealt, retract) and the only one the two-player room never emits
// is the four-player Double Nullo exchange (pass).
const STEP_TYPES = [
  "kittyDealt",
  "discard",
  "dummyDealt",
  "pass",
  "play",
  "retract",
  "trick",
  "claimRestAccepted",
  "result",
];

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
    hands: { ...(dealEntry?.hands || {}) },
    dummyHands: {},
    kitty: [],
    discarded: null,
    passed: null,
    trick: [],
    tricksWon: {},
    lastTrickWinner: null,
    claimedBy: null,
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
      // Double Nullo's exchange: five cards each way between the partners. Both
      // hands are logged as they ended up, so this is a straight replacement.
      case "pass":
        frame.passed = e.sent;
        frame.hands = { ...frame.hands, ...e.handsAfter };
        frame.discarded = null;
        break;
      case "claimRestAccepted":
        frame.claimedBy = e.claimerId;
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
      // A card played and then taken back. Undo it exactly: off the trick,
      // back into the hand it came from. Without this the review would show a
      // card as played that the player retrieved.
      case "retract": {
        const key = e.isDummy ? "dummyHands" : "hands";
        frame[key] = {
          ...frame[key],
          [e.userId]: [...(frame[key][e.userId] || []), e.card],
        };
        frame.trick = frame.trick.slice(0, -1);
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
function RoundReviewModal({ round, log, players, stepIndex, isController, controllerName, onStep, onDone, deckId }) {
  const deck = getDeck(deckId);
  // A round can contain several deals — every all-pass redeal logs another one
  // under the same round number — and only the last is the one actually played.
  const dealEntry = useMemo(() => [...log].reverse().find((e) => e.type === "deal"), [log]);
  const bidWonEntry = useMemo(() => log.find((e) => e.type === "bidWon"), [log]);
  const steps = useMemo(() => log.filter((e) => STEP_TYPES.includes(e.type)), [log]);
  const clampedIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const frame = useMemo(() => buildFrame(dealEntry, steps, clampedIndex), [dealEntry, steps, clampedIndex]);
  // The trick area is height-reserved for the whole rest of the round once play
  // has started, so the modal doesn't resize each time a trick resolves and it
  // briefly goes empty. The two-player game reaches that point when the dummy
  // hands are dealt; the four-player game has no dummies, so it needs the
  // first card played as the signal instead.
  const playStarted = useMemo(
    () => steps.slice(0, clampedIndex + 1).some((e) => e.type === "play"),
    [steps, clampedIndex]
  );

  const nameOf = (userId) => players.find((p) => p.id === userId)?.name || "Unknown";

  const renderHand = (cards) => (
    <div className="review-hand">
      {sortCards(cards).map((card, i) => (
        <Card
          key={i}
          card={card}
          deck={deck}
          width={null}
          disabled
          className={`review-card ${cardColor(card.suit)}`}
        />
      ))}
    </div>
  );

  // A hand nobody bid on has no bidWon entry but is still worth walking
  // through when it was played out, so only the deal is required.
  if (!dealEntry) {
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
        <div className="review-scroll-area">
          <h2>Reviewing Round {round}</h2>
          <p className="review-bid-line">
            {bidWonEntry ? (
              <>
                {nameOf(bidWonEntry.userId)} bid {bidWonEntry.bid} ({bidWonEntry.points} pts) — Trump:{" "}
                {bidWonEntry.trumpSuit || "None"}
              </>
            ) : (
              "Nobody bid — played out at no trumps"
            )}
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
          {frame.discarded && bidWonEntry && (
            <div className="review-kitty">
              <p className="review-hand-label">{nameOf(bidWonEntry.userId)} discarded</p>
              {renderHand(frame.discarded)}
            </div>
          )}
          {frame.passed &&
            Object.entries(frame.passed).map(([userId, cards]) => (
              <div key={userId} className="review-kitty">
                <p className="review-hand-label">{nameOf(userId)} passed across</p>
                {renderHand(cards)}
              </div>
            ))}

          {(Object.keys(frame.dummyHands).length > 0 || playStarted) && (
            // Rendered (and height-reserved, via CSS) for the whole rest of the
            // round once play has started — not just while a trick happens to
            // have cards on it — so the modal doesn't resize every time a trick
            // resolves and this briefly goes empty between tricks.
            <div className="review-trick">
              <p className="review-hand-label">Current trick</p>
              {frame.trick.length > 0 ? (
                frame.trick.map((play, i) => (
                  <div key={i} className="review-trick-card">
                    <Card
                      card={play.card}
                      deck={deck}
                      width={null}
                      disabled
                      className={`review-trick-face ${cardColor(play.card.suit)}`}
                    />
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

          {frame.claimedBy && (
            <p className="review-result">
              {nameOf(frame.claimedBy)} claimed the rest and it was agreed.
            </p>
          )}
          {frame.result && frame.result.bidderId && (
            <p className="review-result">
              {nameOf(frame.result.bidderId)} {frame.result.bidderMadeBid ? "made" : "missed"} the bid.
            </p>
          )}
        </div>

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
