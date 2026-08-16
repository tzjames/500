import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { groupHand, cardColor } from "../cards";
import "./PlayerHand.css";

// Your own hand, along the bottom edge: a shallow arc of overlapping cards,
// fanned from a pivot below them so the outer cards tilt and lift. Grouped by
// suit with trump (plus both bowers and the Joker) first — see groupHand.
function PlayerHand({ hand, onPlayCard, trumpSuit, isCurrentPlayer, deckId }) {
  const deck = getDeck(deckId);
  const groups = groupHand(hand, trumpSuit);
  const cards = groups.flat();
  const total = cards.length;

  return (
    <div className="player-hand">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="hand-suit-group">
          {group.map((card, indexInGroup) => {
            // Arc position is measured across the whole hand, not per group, so
            // the fan stays a single continuous curve across suit boundaries.
            const flatIndex = cards.indexOf(card);
            const offset = flatIndex - (total - 1) / 2;
            return (
              <Card
                key={`${card.suit}-${card.value}-${indexInGroup}`}
                card={card}
                deck={deck}
                trumpSuit={trumpSuit}
                width={null}
                rotate={offset * 2.1}
                lift={-Math.abs(offset) * 4}
                disabled={!isCurrentPlayer}
                onClick={isCurrentPlayer ? onPlayCard : undefined}
                className={`hand-card ${cardColor(card.suit)}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default PlayerHand;
