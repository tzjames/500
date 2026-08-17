import React, { useEffect, useRef, useState } from "react";
import "./OptionInfo.css";

// The ⓘ beside a house rule. The one-line `help` is always on screen; this is
// for the paragraph explaining what the rule actually does to the game, which
// is the difference between recognising an option's name and knowing whether
// you want it.
function OptionInfo({ label, detail }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Click-away and Escape, so the pop-over never has to be dismissed by
  // hunting for the same small button again.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
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
    <span className="option-info" ref={ref}>
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
      {open && (
        <span className="option-info-popover" role="note">
          <b>{label}</b>
          {detail}
        </span>
      )}
    </span>
  );
}

export default OptionInfo;
