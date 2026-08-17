import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { groupHand, cardColor, indexInHand } from "../cards";
import "./AnimatedHand.css";

// The kitty-discard hand: your ten plus the three from the kitty, thirteen in
// all. The kitty three ride higher and wear a KITTY badge; clicking any card
// marks it for discard, turning its badge red. Selections are tracked by the
// card's index in the *unsorted* hand — that's what the discard handler
// filters on — while the display order comes from the usual suit grouping.
function AnimatedHand({ hand, selectedCards, onCardClick, trumpSuit, deckId, selectedBadge = "Discard" }) {
  const deck = getDeck(deckId);

  return (
    <div className="animated-hand">
      {groupHand(hand, trumpSuit).map((group, groupIndex) => (
        <div key={groupIndex} className="kitty-suit-group">
          {group.map((card, indexInGroup) => {
            const cardIndex = indexInHand(hand, card);
            const isDiscard = selectedCards.includes(cardIndex);
            const badge = isDiscard ? selectedBadge : card.isKitty ? "Kitty" : null;
            return (
              <Card
                key={`${card.suit}-${card.value}-${indexInGroup}`}
                card={card}
                deck={deck}
                trumpSuit={trumpSuit}
                width={null}
                onClick={() => onCardClick(cardIndex)}
                badge={badge}
                badgeTone={isDiscard ? "discard" : "kitty"}
                className={`kitty-card ${cardColor(card.suit)}${
                  card.isKitty ? " from-kitty" : ""
                }${isDiscard ? " marked" : ""}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default AnimatedHand;
