import React, { useState } from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { cardColor } from "../cards";
import "./SidePanel.css";
import "./EuchreLastTrick.css";

// The trick that just went, kept on the board until the hand ends. Collapsed
// it's a small stack in the corner; hovering, focusing or tapping fans it open
// so you can see who played what.
//
// The Euchre board has no side column to give this — the 500 boards put the
// same panel in one — so it takes a corner of the felt instead, and borrows the
// fanning from SidePanel.css so the two games' stacks behave the same.
function EuchreLastTrick({ lastTrick, players = [], mySeat, deckId, trumpSuit }) {
  const [open, setOpen] = useState(false);
  const deck = getDeck(deckId);

  if (!lastTrick?.cards?.length) return null;

  const nameOf = (seat) =>
    seat === mySeat ? "You" : players.find((p) => p.seat === seat)?.name || "—";

  const winner = nameOf(lastTrick.winnerSeat);
  const wc = lastTrick.winningCard;
  const withCard = wc && (wc.suit === "Joker" ? "the Benny" : `the ${wc.value}${wc.suit}`);

  return (
    <aside
      className={`eu-last-trick${open ? " open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <p className="overline">Last trick</p>
      <button
        type="button"
        className={`last-trick${open ? " open" : ""}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Last trick, won by ${winner}. Activate to fan open.`}
      >
        {lastTrick.cards.map((play, i) => (
          <span
            key={`${play.seat}-${play.card.suit}-${play.card.value}`}
            className={`last-trick-slot${play.seat === lastTrick.winnerSeat ? " winner" : ""}`}
            style={{ "--i": i }}
          >
            <Card
              card={play.card}
              deck={deck}
              width={null}
              disabled
              trumpSuit={trumpSuit}
              className={cardColor(play.card.suit)}
            />
            <span className="last-trick-who">{nameOf(play.seat)}</span>
          </span>
        ))}
      </button>
      <p className="eu-last-trick-note">
        {winner}
        {withCard ? `, with ${withCard}` : ""}
      </p>
    </aside>
  );
}

export default EuchreLastTrick;
