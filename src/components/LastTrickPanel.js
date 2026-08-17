import React, { useState } from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { cardColor } from "../cards";
import "./SidePanel.css";

// Right panel: the trick that just went. Collapsed it's a small stack; hovering
// or focusing fans it open so you can see all four cards and who played what.
// The data comes from `lastTrick` on the server, which stashes each trick as it
// resolves — the live trick is cleared the moment it's won.
function LastTrickPanel({ lastTrick, playerId, deckId, opponentName }) {
  const [open, setOpen] = useState(false);
  const deck = getDeck(deckId);

  if (!lastTrick || !lastTrick.plays?.length) {
    return (
      <aside className="side-panel side-panel-right">
        <p className="panel-heading">Last trick</p>
        <p className="side-note">Nothing played yet this round.</p>
      </aside>
    );
  }

  const whoPlayed = (play) => {
    const mine = play.playerId === playerId;
    if (mine) return play.isDummy ? "Your dummy" : "You";
    return play.isDummy ? `${opponentName}'s dummy` : opponentName;
  };

  const winnerLabel = whoPlayed({
    playerId: lastTrick.winnerId,
    isDummy: lastTrick.winnerIsDummy,
  });
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
        {lastTrick.plays.map((play, i) => {
          const isWinner =
            play.playerId === lastTrick.winnerId &&
            play.isDummy === lastTrick.winnerIsDummy;
          return (
            <span
              key={i}
              className={`last-trick-slot${isWinner ? " winner" : ""}`}
              style={{ "--i": i }}
            >
              <Card
                card={play.card}
                deck={deck}
                width={44}
                disabled
                className={cardColor(play.card.suit)}
              />
              <span className="last-trick-who">{whoPlayed(play)}</span>
            </span>
          );
        })}
      </button>
      <p className="side-note">
        Won by {winnerLabel}
        {winningCardLabel ? ` with ${winningCardLabel}.` : "."}
      </p>
    </aside>
  );
}

export default LastTrickPanel;
