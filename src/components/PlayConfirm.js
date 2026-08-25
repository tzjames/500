import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cardColor } from "../cards";
import "./PlayConfirm.css";

const sameCard = (a, b) => a && b && a.suit === b.suit && a.value === b.value;
const label = (card) =>
  card.suit === "Joker" ? "the Joker" : `${card.value}${card.suit}`;

// Two taps to play a card, on phones only.
//
// A finger on a 68px card in an overlapping fan is nothing like a mouse on it:
// the first tap is as likely to be a mis-hit as a decision, and a card played
// can't be taken back once the next player moves. So a tap selects and lifts,
// and a second tap — on the card again, or on the confirm pill — plays it.
//
// `enabled` is false on anything bigger than a phone, where a click has always
// played immediately and there's no reason to add a step.
export function useTapToConfirm({ enabled, onPlay, hand }) {
  const [pending, setPending] = useState(null);

  // Let go of the selection the moment it stops being actionable — the turn
  // moved on, the card was played from elsewhere, or the hand was redealt.
  useEffect(() => {
    if (!enabled) {
      setPending(null);
      return;
    }
    setPending((current) =>
      current && hand?.some((c) => sameCard(c, current)) ? current : null
    );
  }, [enabled, hand]);

  const click = useCallback(
    (card) => {
      if (!enabled) {
        onPlay(card);
        return;
      }
      if (sameCard(pending, card)) {
        setPending(null);
        onPlay(card);
        return;
      }
      setPending(card);
    },
    [enabled, onPlay, pending]
  );

  const confirm = useCallback(() => {
    if (!pending) return;
    const card = pending;
    setPending(null);
    onPlay(card);
  }, [onPlay, pending]);

  const cancel = useCallback(() => setPending(null), []);
  const isPending = useCallback((card) => sameCard(pending, card), [pending]);

  return { pending, isPending, click, confirm, cancel };
}

// The confirm itself. Portalled and fixed near the bottom edge: it wants to be
// under the thumb rather than wherever the card happens to be, and the board's
// 3D card fans would paint over anything left inside them.
export function PlayConfirm({ card, onConfirm, onCancel }) {
  if (!card) return null;
  return createPortal(
    <div className="play-confirm">
      <button type="button" className="play-confirm-go" onClick={onConfirm}>
        Play <span className={cardColor(card.suit)}>{label(card)}</span>
      </button>
      <button
        type="button"
        className="play-confirm-cancel"
        onClick={onCancel}
        aria-label="Put the card back"
      >
        Cancel
      </button>
    </div>,
    document.body
  );
}
