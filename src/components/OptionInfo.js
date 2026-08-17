import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./OptionInfo.css";

// Clearance kept between the popover and the edge of the browser window.
const GUTTER = 10;

// The ⓘ beside a house rule. The one-line `help` is always on screen; this is
// for the paragraph explaining what the rule actually does to the game, which
// is the difference between recognising an option's name and knowing whether
// you want it.
function OptionInfo({ label, detail }) {
  const [open, setOpen] = useState(false);
  // Where the portaled popover sits, in viewport coordinates — null until the
  // first layout pass has measured it, which is what keeps it from flashing
  // at the top-left corner for a frame.
  const [position, setPosition] = useState(null);
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);

  // Placed under the button and nudged back onto the screen if it would run
  // past the edge — of the window, but also of whatever scrollable panel the
  // button happens to sit in (the house-rules list scrolls its own overflow,
  // both here and in the four-player waiting room). A plain absolutely
  // positioned child gets clipped by that panel's overflow the moment the
  // button is close enough to its left or right edge; rendering into a portal
  // on <body> and placing it with fixed coordinates is what avoids that,
  // since nothing then sits between it and the viewport to clip it.
  useLayoutEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const button = anchorRef.current;
      const popover = popoverRef.current;
      if (!button || !popover) return;
      const buttonRect = button.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;

      let left = buttonRect.left + buttonRect.width / 2 - width / 2;
      left = Math.max(GUTTER, Math.min(left, window.innerWidth - width - GUTTER));

      let top = buttonRect.bottom + 7;
      // Flip above the button when there's no room below — it's usually the
      // last row of the list that runs into this.
      if (top + height > window.innerHeight - GUTTER) {
        top = buttonRect.top - 7 - height;
      }
      setPosition({ top, left });
    };

    place();
    // A resize or a scroll anywhere (including inside the rules list's own
    // scroll container, which doesn't bubble a plain 'scroll' listener except
    // in the capture phase) leaves the popover pointing at empty space rather
    // than the button, so it's simplest to just close it — the same as
    // clicking away.
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Click-away and Escape, so the pop-over never has to be dismissed by
  // hunting for the same small button again.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!detail) return null;

  return (
    <span className="option-info" ref={anchorRef}>
      <button
        type="button"
        className={`option-info-button${open ? " on" : ""}`}
        onClick={(e) => {
          // These sit inside <label>s, where a click would otherwise toggle the
          // checkbox the label is for.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label={`What does "${label}" mean?`}
        title={`What does "${label}" mean?`}
      >
        i
      </button>
      {open &&
        createPortal(
          <span
            ref={popoverRef}
            className="option-info-popover"
            role="note"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
          >
            <b>{label}</b>
            {detail}
          </span>,
          document.body
        )}
    </span>
  );
}

export default OptionInfo;
