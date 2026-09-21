// 500's bidding record, turned into the shape HandHistoryModal lays out. The
// panel is shared with Euchre; what a log entry means is not.
//
// 500's log names players by id rather than by seat, because a four-player
// table's seating is drawn after the deal — so this takes a lookup rather than
// indexing a slot list.
import React from "react";
import { isRed } from "./cards";
import { bidLabel } from "./gameOptions";

// A bid is written "7♥", "10 NT", "Misere" — colour the suit where there is one.
function bidNode(bid, options) {
  const label = bidLabel(bid, options);
  const suit = ["♠", "♣", "♦", "♥"].find((s) => label.includes(s));
  if (!suit) return label;
  const [before, after] = label.split(suit);
  return (
    <>
      {before}
      <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
      {after}
    </>
  );
}

function callNode(entry, name, options) {
  switch (entry.type) {
    case "bid":
      return entry.bid === "Pass" ? (
        <>
          <b>{name}</b> passed
        </>
      ) : (
        <>
          <b>{name}</b> bid {bidNode(entry.bid, options)}
          {entry.points ? ` — ${entry.points}` : ""}
        </>
      );
    case "bidWon":
      return (
        <>
          <b>{name}</b> bought it for {bidNode(entry.bid, options)}
          {entry.points ? ` — ${entry.points}` : ""}
        </>
      );
    case "redeal":
    case "throwIn":
      return <i>Everybody passed — the hand was thrown in</i>;
    default:
      return null;
  }
}

// The four-player game scores by side and keeps an array in team order; the
// two-player game scores by person and keys them by id. Both arrive here.
function scoreLines(scores, sides, nameFor) {
  if (!scores) return [];
  if (Array.isArray(scores)) {
    return scores.map((score, i) => ({ label: sides[i] || `Side ${i + 1}`, score }));
  }
  return Object.entries(scores).map(([userId, score]) => ({ label: nameFor(userId), score }));
}

export function fiveHundredHands({ record = [], nameFor, sides = [], options }) {
  return record.map((hand) => {
    const lines = hand.calls
      .map((entry, i) => ({
        id: `${entry.type}-${entry.userId || "table"}-${i}`,
        aside: entry.type === "redeal" || entry.type === "throwIn",
        node: callNode(entry, nameFor(entry.userId), options),
      }))
      .filter((line) => line.node);

    const r = hand.result;
    return {
      id: `${hand.round}-${hand.thrownIn ? "out" : "played"}-${hand.dealerId || "x"}`,
      round: hand.round,
      thrownIn: hand.thrownIn,
      dealer: hand.dealerId ? nameFor(hand.dealerId) : null,
      // 500 has no turned card — the kitty goes to whoever wins the auction.
      note: null,
      lines,
      result: r
        ? {
            headline: `${nameFor(r.bidderId)} ${r.bidderMadeBid ? "made it" : "went down"}.`,
            scores: scoreLines(r.scores, sides, nameFor),
          }
        : null,
    };
  });
}
