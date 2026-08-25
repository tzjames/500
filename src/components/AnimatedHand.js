import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { groupHand, cardColor, indexInHand } from "../cards";
import { useViewport } from "../useViewport";
import "./AnimatedHand.css";

// The kitty-discard hand: your ten plus the three from the kitty, thirteen in
// all. The kitty three ride higher and wear a KITTY badge; clicking any card
// marks it for discard, turning its badge red. Selections are tracked by the
// card's index in the *unsorted* hand — that's what the discard handler
// filters on — while the display order comes from the usual suit grouping.
function AnimatedHand({ hand, selectedCards, onCardClick, trumpSuit, deckId, selectedBadge = "Discard" }) {
  const deck = getDeck(deckId);
  const { phone } = useViewport();
  // On a phone each card shows only its leftmost 44px, and "Discard" is wider
  // than that however tightly it's set — three marked cards ran their badges
  // into each other. "Throw" fits, and says the same thing. A caller that named
  // its own badge keeps it.
  const badgeLabel = phone && selectedBadge === "Discard" ? "Throw" : selectedBadge;

  return (
    <div className="animated-hand">
      {groupHand(hand, trumpSuit).map((group, groupIndex) => (
        <div key={groupIndex} className="kitty-suit-group">
          {group.map((card, indexInGroup) => {
            const cardIndex = indexInHand(hand, card);
            const isDiscard = selectedCards.includes(cardIndex);
            const badge = isDiscard ? badgeLabel : card.isKitty ? "Kitty" : null;
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
                  isDiscard ? " marked" : ""
                }`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default AnimatedHand;
