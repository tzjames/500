import React from "react";
import { LOCATIONS, DECKS, getLocation, randomLocationId } from "../theme";
import "./ThemePicker.css";

const SURPRISE = "__surprise__";

// Location and deck pickers. Both settings are room-wide: picking either one
// emits through the same server-synced `gameSettings` channel the offer-pass
// toggles already use, so the change lands on both players' tables at once.
function ThemePicker({ locationId, deckId, onChange, compact = false }) {
  const location = getLocation(locationId);

  const handleLocation = (e) => {
    const value = e.target.value;
    onChange({
      location: value === SURPRISE ? randomLocationId(locationId) : value,
    });
  };

  return (
    <div className={`theme-picker${compact ? " compact" : ""}`}>
      <label className="theme-select-wrap">
        <span className="theme-dot" style={{ background: location.dot }} />
        <select
          className="theme-select"
          value={locationId}
          onChange={handleLocation}
          aria-label="Table location"
        >
          {LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={SURPRISE}>Surprise me — random table</option>
        </select>
        <span className="theme-caret" />
      </label>

      <label className="theme-select-wrap">
        <select
          className="theme-select deck-select"
          value={deckId}
          onChange={(e) => onChange({ deck: e.target.value })}
          aria-label="Card deck"
        >
          {DECKS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.blurb}
            </option>
          ))}
        </select>
        <span className="theme-caret" />
      </label>
    </div>
  );
}

export default ThemePicker;
