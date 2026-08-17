import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { groupHand, cardColor } from "../cards";
import "./PlayerHand.css";

// Your own hand, along the bottom edge: a shallow arc of overlapping cards,
// fanned from a pivot below them so the outer cards tilt and lift. Grouped by
// suit with trump (plus both bowers and the Joker) first — see groupHand.
function PlayerHand({
  hand,
  onPlayCard,
  trumpSuit,
  isCurrentPlayer,
  deckId,
  // Set while a fresh hand is being dealt: cards fly in from the middle of the
  // table one after another, then turn over together. `deal` is null at every
  // other time, which is what keeps the cards one-sided and un-animated.
  deal = null,
}) {
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
            // Cards are dealt left to right, so the stagger follows position in
            // the fan rather than the order they happen to sort into. --deal-dx
            // is how far back toward the middle of the table this card starts;
            // the deck sits above the centre of the hand, so it's just the
            // card's own offset from centre, reversed.
            const dealVars = deal
              ? {
                  "--deal-dx": `${-offset * 46}px`,
                  "--deal-delay": `${flatIndex * 60}ms`,
                  "--reveal-delay": `${flatIndex * 35}ms`,
                }
              : {};
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
                revealed={deal ? deal.revealed : null}
                style={dealVars}
                className={`hand-card ${cardColor(card.suit)}${
                  deal ? " dealing" : ""
                }`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default PlayerHand;
