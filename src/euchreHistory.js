// Euchre's calling record, turned into the shape HandHistoryModal lays out.
// The panel is shared with 500; what a log entry means is not.
import React from "react";
import { isRed } from "./cards";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");
const Suit = ({ suit }) => <span className={suitClass(suit)}>{suit}</span>;

const cardLabel = (card) =>
  !card ? null : card.suit === "Joker" ? (
    "the Benny"
  ) : (
    <span className={suitClass(card.suit)}>
      {card.value}
      {card.suit}
    </span>
  );

// What one seat did, in a line.
function callNode(entry, name, upcard) {
  switch (entry.type) {
    case "pass":
      return entry.callRound === 1 && upcard ? (
        <>
          <b>{name}</b> passed on <Suit suit={upcard.suit} />
        </>
      ) : (
        <>
          <b>{name}</b> passed
        </>
      );
    case "call":
      return (
        <>
          <b>{name}</b> {entry.callRound === 1 ? "ordered up" : "called"} <Suit suit={entry.suit} />
          {entry.callRound === 2 && " instead"}
          {entry.alone && " — alone"}
        </>
      );
    case "bid":
      return entry.amount ? (
        <>
          <b>{name}</b> bid {entry.amount}
        </>
      ) : (
        <>
          <b>{name}</b> passed
        </>
      );
    case "relief":
      return (
        <>
          <b>{name}</b>{" "}
          {entry.action === "redeal"
            ? "threw an unplayable hand in"
            : "went under, swapping three with the kitty"}
        </>
      );
    case "blind":
      return (
        <>
          <b>{name}</b> looked at their hand
        </>
      );
    case "throwIn":
      return <i>Everybody passed twice — the hand was thrown in</i>;
    default:
      return null;
  }
}

// Where the second round of calling starts, so the turn-down reads as the moment
// it was rather than as one more pass in a list.
const turnedDownAt = (calls, i) =>
  i > 0 && calls[i].callRound === 2 && calls[i - 1].callRound === 1;

export function euchreHands({ history = [], slots = [], sides, yourSeat }) {
  const nameOf = (seat) => (seat === yourSeat ? "You" : slots[seat]?.name || `Seat ${seat + 1}`);
  const perSide = sides || slots.map((_, seat) => [seat]);
  const sideLabel = (seats) => seats.map(nameOf).join(" & ");

  return history.map((hand) => {
    const lines = [];
    hand.calls.forEach((entry, i) => {
      if (turnedDownAt(hand.calls, i)) {
        lines.push({
          id: `down-${i}`,
          aside: true,
          node: (
            <i>
              {hand.upcard ? (
                <>
                  <Suit suit={hand.upcard.suit} /> was turned down — anyone may now name a different
                  suit
                </>
              ) : (
                "Turned down — anyone may now name a different suit"
              )}
            </i>
          ),
        });
      }
      lines.push({
        id: `${entry.type}-${entry.seat}-${i}`,
        aside: entry.type === "throwIn",
        node: callNode(entry, nameOf(entry.seat), hand.upcard),
      });
    });

    const r = hand.result;
    return {
      id: `${hand.round}-${hand.thrownIn ? "out" : "played"}-${hand.dealerSeat}`,
      round: hand.round,
      thrownIn: hand.thrownIn,
      dealer: hand.dealerSeat === null ? null : nameOf(hand.dealerSeat),
      note: hand.upcard && <>{cardLabel(hand.upcard)} turned up</>,
      lines,
      result: r
        ? {
            headline: `${nameOf(r.callerSeat)} took ${r.tricks} of the ${r.needed} needed — ${
              r.made ? (r.marched ? "a march" : "made it") : "euchred"
            }.`,
            // Partners keep one score between them, so this is per side.
            scores: (r.scores || []).length
              ? perSide.map((seats) => ({ label: sideLabel(seats), score: r.scores[seats[0]] }))
              : [],
          }
        : null,
    };
  });
}
