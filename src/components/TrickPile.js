import React from "react";
import "./TrickPile.css";

// Won tricks as physical bundles rather than a number. Each trick is a squared
// -up block of cards; consecutive tricks alternate crosswise and step up a few
// pixels, so the count reads off the staggered edges the way it would on a real
// table. The caption chip stays under the stack in both states — counting
// bundles at a glance gets unreliable past about six, and an empty pile needs
// to say whose it is rather than float there as a bare zero.
function TrickPile({ count = 0, owner, className = "" }) {
  const label = `${owner}: ${count} trick${count === 1 ? "" : "s"}`;

  return (
    <div className={`trick-pile ${className}`} role="img" aria-label={label}>
      <span className={`trick-stack${count === 0 ? " empty" : ""}`}>
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className={`trick-block${i % 2 === 1 ? " crosswise" : ""}`}
            style={{ "--step": i }}
          />
        ))}
      </span>
      <span className="trick-pile-count" aria-hidden="true">
        {owner} <b>{count}</b>
      </span>
    </div>
  );
}

export default TrickPile;
