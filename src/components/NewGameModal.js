import React, { useEffect, useState } from "react";
import HouseRules, { HouseRulesToggle } from "./HouseRules";
import { defaultOptions, withDefaults } from "../gameOptions";
import "./NewGameModal.css";

// Starting a game: how many at the table, who can see it, and — for four — how
// partners are picked and which house rules are in force.
//
// The rules default to whatever this player last chose at this size of table,
// fetched by the caller and handed in as `remembered`; a table's rules are
// something people settle once and then keep, so making them re-tick eleven
// boxes every game would be the wrong default.
function NewGameModal({ remembered, loadingDefaults, onStart, onCancel, error }) {
  const [mode, setMode] = useState(4);
  const [visibility, setVisibility] = useState("private");
  const [partnerMode, setPartnerMode] = useState("choose");
  const [fillWithBots, setFillWithBots] = useState(false);
  const [options, setOptions] = useState(defaultOptions);
  const [showRules, setShowRules] = useState(false);
  const [starting, setStarting] = useState(false);

  // `remembered` arrives per mode, so switching between two and four players
  // re-reads what was last used at that size.
  const settings = remembered?.[mode];
  useEffect(() => {
    if (!settings) return;
    if (settings.options) setOptions(withDefaults(settings.options));
    if (settings.visibility) setVisibility(settings.visibility);
    if (settings.partnerMode) setPartnerMode(settings.partnerMode);
  }, [settings]);

  const start = () => {
    setStarting(true);
    onStart({ mode, visibility, partnerMode, fillWithBots, options });
  };

  return (
    <div className="new-game-overlay" onClick={onCancel}>
      <div className="new-game-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="serif">Start a game</h2>

        <fieldset className="ng-field">
          <legend className="overline">Players</legend>
          <div className="ng-choices">
            <Choice
              checked={mode === 2}
              onSelect={() => setMode(2)}
              label="Two"
              note="Two-handed, each playing a dummy"
            />
            <Choice
              checked={mode === 4}
              onSelect={() => setMode(4)}
              label="Four"
              note="Two partnerships, the standard game"
            />
          </div>
        </fieldset>

        <fieldset className="ng-field">
          <legend className="overline">Who can join</legend>
          <div className="ng-choices">
            <Choice
              checked={visibility === "private"}
              onSelect={() => setVisibility("private")}
              label="Private"
              note="Only people you send the link to"
            />
            <Choice
              checked={visibility === "public"}
              onSelect={() => setVisibility("public")}
              label="Public"
              note="Listed in the lobby for anyone to sit down at"
            />
          </div>
        </fieldset>

        {mode === 4 && (
          <>
            <fieldset className="ng-field">
              <legend className="overline">Partners</legend>
              <div className="ng-choices">
                <Choice
                  checked={partnerMode === "choose"}
                  onSelect={() => setPartnerMode("choose")}
                  label="You choose"
                  note="Pick your partner once everyone's here"
                />
                <Choice
                  checked={partnerMode === "random"}
                  onSelect={() => setPartnerMode("random")}
                  label="Draw for it"
                  note="Partners are drawn as the table fills"
                />
              </div>
            </fieldset>

            <label className="ng-check">
              <input
                type="checkbox"
                checked={fillWithBots}
                onChange={(e) => setFillWithBots(e.target.checked)}
              />
              <span>
                <b>Start now against robots</b>
                <span className="ng-note">
                  The other three seats are filled with robots and the hand is dealt
                  straight away.
                </span>
              </span>
            </label>

            <HouseRulesToggle
              options={options}
              open={showRules}
              loading={loadingDefaults}
              onToggle={() => setShowRules((open) => !open)}
            />
            {showRules && <HouseRules options={options} onChange={setOptions} />}
          </>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="ng-actions">
          <button className="btn-primary" onClick={start} disabled={starting}>
            {mode === 4 && fillWithBots ? "Deal against robots" : "Start"}
          </button>
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({ checked, onSelect, label, note }) {
  return (
    <button
      type="button"
      className={`ng-choice${checked ? " on" : ""}`}
      onClick={onSelect}
      aria-pressed={checked}
    >
      <b>{label}</b>
      <span className="ng-note">{note}</span>
    </button>
  );
}

export default NewGameModal;
