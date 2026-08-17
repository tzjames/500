import React from "react";
import { themeVars, getLocation } from "../theme";
import "./ThemedTable.css";

// The shell every themed screen sits in: backdrop stack at the back, the
// perspective-tilted felt in the middle, and an untilted overlay on top that
// holds all the actual UI. Callers render into `children` and never have to
// think about the layers below.
//
// `dimmed` darkens the vignette for screens whose content has to win against
// the felt (the kitty discard, the round-end result card).
function ThemedTable({
  locationId,
  deckId,
  feltId,
  dimmed = false,
  plain = false,
  scrolling = false,
  children,
}) {
  const location = getLocation(locationId);

  return (
    <div
      className={`themed-table${scrolling ? " scrolling" : ""}`}
      style={themeVars(locationId, deckId, feltId)}
    >
      <div className={`backdrop${dimmed ? " dimmed" : ""}`}>
        <div className="backdrop-wash" />
        {location.photo && (
          <div
            className="backdrop-photo"
            style={{ backgroundImage: `url(${location.photo})` }}
          />
        )}
        <div className="backdrop-tint" />
        <div className="backdrop-vignette" />
      </div>

      {!plain && (
        <div className="table-plane">
          <div className="table-felt" />
        </div>
      )}

      <div className="table-overlay">{children}</div>
    </div>
  );
}

export default ThemedTable;
