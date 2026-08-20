import React, { useState } from "react";
import {
  LOCATIONS,
  decksFor,
  getLocation,
  getFeltMode,
  nextFeltMode,
  randomLocationId,
} from "../theme";
import { soundEnabled, setSoundEnabled, playSound } from "../sounds";
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
function ThemePicker({
  locationId,
  deckId,
  feltId,
  onChange,
  // Who's seated. Some packs belong to particular people and are only
  // offered when the room is exactly them — see deckAllowed in theme.js.
  playerNames = [],
  compact = false,
}) {
  const location = getLocation(locationId);
  const felt = getFeltMode(feltId);
  // Local, unlike everything else here: the table and the deck are shared so
  // both players see the same game, but one player reaching for silence
  // shouldn't silence the other.
  const [sound, setSound] = useState(soundEnabled);

  // Flipped against what's stored rather than against the rendered value, so
  // the button can't get out of step with the setting it controls.
  const toggleSound = () => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    setSound(next);
    // Turning it on is itself the interaction that lets the browser play
    // audio, so confirm it out loud rather than leaving you to wonder.
    if (next) playSound("play");
  };

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
          {decksFor(playerNames).map((d) => (
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

      {/* Personal, not room-wide — see `sound` above. */}
      <button
        type="button"
        className="felt-toggle"
        onClick={toggleSound}
        title={sound ? "Sound on — click to mute" : "Muted — click to unmute"}
        aria-label={sound ? "Sound on. Click to mute." : "Muted. Click to unmute."}
        aria-pressed={sound}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M4 9.5h3L11 6v12l-4-3.5H4z"
            fill="currentColor"
            fillOpacity={sound ? 0.9 : 0.35}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {sound ? (
            <>
              <path
                d="M14.5 9a4 4 0 0 1 0 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M17.5 6.5a7.5 7.5 0 0 1 0 11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </>
          ) : (
            <path
              d="M15 9.5l5 5m0-5l-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
    </div>
  );
}

export default ThemePicker;
