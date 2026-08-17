import React, { useState } from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { cardColor } from "../cards";
import "./SidePanel.css";

// Right panel: the trick that just went. Collapsed it's a small stack; hovering
// or focusing fans it open so you can see who played what. The live trick is
// cleared the moment it resolves, so this comes from the room's own record of
// the last one.
function LastTrickPanel4({ lastTrick, seats = [], mySeat, deckId }) {
  const [open, setOpen] = useState(false);
  const deck = getDeck(deckId);

  if (!lastTrick?.plays?.length) {
    return (
      <aside className="side-panel side-panel-right">
        <p className="panel-heading">Last trick</p>
        <p className="side-note">Nothing played yet this round.</p>
      </aside>
    );
  }

  const nameOf = (seat) =>
    seat === mySeat ? "You" : seats.find((s) => s.seat === seat)?.name || "—";

  const winnerLabel = nameOf(lastTrick.winnerSeat);
  const wc = lastTrick.winningCard;
  const winningCardLabel =
    wc && (wc.suit === "Joker" ? "the Joker" : `the ${wc.value} ${wc.suit}`);

  return (
    <aside
      className="side-panel side-panel-right"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <p className="panel-heading">Last trick</p>
      <button
        type="button"
        className={`last-trick${open ? " open" : ""}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Last trick, won by ${winnerLabel}. Activate to fan open.`}
      >
        {lastTrick.plays.map((play, i) => (
          <span
            key={i}
            className={`last-trick-slot${play.seat === lastTrick.winnerSeat ? " winner" : ""}`}
            style={{ "--i": i }}
          >
            <Card
              card={play.card}
              deck={deck}
              width={44}
              disabled
              className={cardColor(play.card.suit)}
            />
            <span className="last-trick-who">{nameOf(play.seat)}</span>
          </span>
        ))}
      </button>
      <p className="side-note">
        Won by {winnerLabel}
        {winningCardLabel ? ` with ${winningCardLabel}.` : "."}
      </p>
    </aside>
  );
}

export default LastTrickPanel4;
