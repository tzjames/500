import React from "react";
import {
  LOCATIONS,
  DECKS,
  getLocation,
  getFeltMode,
  nextFeltMode,
  randomLocationId,
} from "../theme";
import "./ThemePicker.css";

const SURPRISE = "__surprise__";

// Locations and plain colours, in declaration order, as [group, options] pairs
// for the dropdown's optgroups.
const GROUPS = LOCATIONS.reduce((acc, location) => {
  const entry = acc.find(([group]) => group === location.group);
  if (entry) entry[1].push(location);
  else acc.push([location.group, [location]]);
  return acc;
}, []);

// Location and deck pickers. Both settings are room-wide: picking either one
// emits through the same server-synced `gameSettings` channel the offer-pass
// toggles already use, so the change lands on both players' tables at once.
function ThemePicker({ locationId, deckId, feltId, onChange, compact = false }) {
  const location = getLocation(locationId);
  const felt = getFeltMode(feltId);

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
          aria-label="Table"
        >
          {GROUPS.map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
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
            <option key={d.id} value={d.id} title={d.blurb}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="theme-caret" />
      </label>

      {/* Cycles shown -> faded -> hidden. The icon is the table itself, so its
          own fill tells you which state you're in without a label. */}
      <button
        type="button"
        className="felt-toggle"
        onClick={() => onChange({ felt: nextFeltMode(felt.id) })}
        title={`${felt.label} — click to change`}
        aria-label={`${felt.label}. Click to cycle table visibility.`}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <ellipse
            cx="12"
            cy="12"
            rx="9.5"
            ry="6.5"
            fill="currentColor"
            fillOpacity={felt.opacity}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray={felt.id === "hidden" ? "2.5 2.5" : "none"}
          />
        </svg>
      </button>
    </div>
  );
}

export default ThemePicker;
