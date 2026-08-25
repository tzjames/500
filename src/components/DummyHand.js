import React from "react";
import Card from "./Card";
import { useTapToConfirm, PlayConfirm } from "./PlayConfirm";
import { getDeck } from "../theme";
import { groupHand, cardColor } from "../cards";
import "./DummyHand.css";

// Your dummy hand, along the top edge. Face up and playable once you've led
// your first card from your own hand; before that GameTable shows a fan of
// backs here instead. Smaller than your hand — it's read, not fanned.
function DummyHand({
  hand,
  onPlayCard,
  trumpSuit,
  isCurrentPlayer,
  deckId,
  // Phones play a card in two taps — see useTapToConfirm.
  confirmTaps = false,
}) {
  const deck = getDeck(deckId);
  const tap = useTapToConfirm({
    enabled: confirmTaps && isCurrentPlayer,
    onPlay: onPlayCard,
    hand,
  });

  return (
    <div className={`dummy-hand${isCurrentPlayer ? " active" : ""}`}>
      {groupHand(hand, trumpSuit).map((group, groupIndex) => (
        <div key={groupIndex} className="dummy-suit-group">
          {group.map((card, indexInGroup) => (
            <Card
              key={`${card.suit}-${card.value}-${indexInGroup}`}
              card={card}
              deck={deck}
              trumpSuit={trumpSuit}
              width={null}
              disabled={!isCurrentPlayer}
              onClick={isCurrentPlayer ? tap.click : undefined}
              className={`dummy-card ${cardColor(card.suit)}${
                tap.isPending(card) ? " picked" : ""
              }`}
            />
          ))}
        </div>
      ))}
      <PlayConfirm card={tap.pending} onConfirm={tap.confirm} onCancel={tap.cancel} />
    </div>
  );
}

export default DummyHand;
