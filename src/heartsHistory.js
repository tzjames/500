// Hearts' passing record, turned into the shape HandHistoryModal lays out.
// The panel is shared with 500 and Euchre; what a log entry means is not.
//
// A pass is somebody's hand, so the room only sends this seat its own until the
// deal has been scored — the missing cards arrive as null and are shown as a
// count rather than as nothing at all.
import React from "react";
import { isRed } from "./cards";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");
const Suit = ({ suit }) => <span className={suitClass(suit)}>{suit}</span>;

const cardLabel = (card) =>
  card.suit === "Joker" ? (
    "the joker"
  ) : (
    <span className={suitClass(card.suit)}>
      {card.value}
      {card.suit}
    </span>
  );

const cardList = (cards) =>
  cards.map((card, i) => (
    <React.Fragment key={`${card.suit}-${card.value}-${i}`}>
      {i > 0 && ", "}
      {cardLabel(card)}
    </React.Fragment>
  ));

const DIRECTION = {
  left: "passed to the left",
  right: "passed to the right",
  across: "passed across the table",
  hold: "a hold hand — nothing passed",
};

// What one seat did, in a line.
function callNode(entry, name, toName) {
  switch (entry.type) {
    case "pass":
      return entry.cards ? (
        <>
          <b>{name}</b> passed {cardList(entry.cards)} to {toName}
        </>
      ) : (
        <>
          <b>{name}</b> passed three cards to {toName}
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
    case "suit":
      return (
        <>
          <b>{name}</b> named <Suit suit={entry.suit} /> as the penalty suit
        </>
      );
    case "misdeal":
      return <i>Nothing but cards that cost — the hand was thrown in</i>;
    default:
      return null;
  }
}

export function heartsHands({ history = [], slots = [], sides, yourSeat }) {
  const nameOf = (seat) => (seat === yourSeat ? "You" : slots[seat]?.name || `Seat ${seat + 1}`);
  const perSide = sides || slots.map((_, seat) => [seat]);
  const sideLabel = (seats) => seats.map(nameOf).join(" & ");

  return history.map((hand) => {
    const lines = hand.calls
      .map((entry, i) => ({
        id: `${entry.type}-${entry.seat}-${i}`,
        aside: entry.type === "misdeal",
        node: callNode(entry, nameOf(entry.seat), entry.to === undefined ? null : nameOf(entry.to)),
      }))
      .filter((line) => line.node);

    const r = hand.result;
    return {
      id: `${hand.round}-${hand.thrownIn ? "out" : "played"}-${hand.dealerSeat}`,
      round: hand.round,
      thrownIn: hand.thrownIn,
      dealer: hand.dealerSeat === null ? null : nameOf(hand.dealerSeat),
      // Where the turn-up goes in the other games, which is the right place
      // for it: which way the cards went is the one fact about the deal you
      // need before anything below it makes sense.
      note: DIRECTION[hand.passDirection] || null,
      lines,
      result: r
        ? {
            headline: r.moon
              ? `${sideLabel(r.moon.seats)} shot the moon — ${r.moon.value} ${
                  r.moon.mode === "subtract" ? "off their own score" : "on everybody else"
                }.`
              : `${describeTaken(r, perSide, sideLabel)}.`,
            scores: (r.scores || []).length
              ? perSide.map((seats) => ({ label: sideLabel(seats), score: r.scores[seats[0]] }))
              : [],
          }
        : null,
    };
  });
}

// Who ate what, shortest way round: the seat that took most, or nobody at all.
function describeTaken(result, perSide, sideLabel) {
  const points = perSide.map((seats) => ({ seats, points: seats.reduce((sum, seat) => sum + (result.points?.[seat] || 0), 0) }));
  const worst = points.reduce((most, row) => (row.points > most.points ? row : most), points[0]);
  if (!worst || worst.points <= 0) return "Nobody took a thing";
  return `${sideLabel(worst.seats)} took the most at ${worst.points}`;
}
