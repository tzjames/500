import React, { useEffect, useState } from "react";
import HouseRules, { HouseRulesToggle } from "./HouseRules";
import OptionInfo from "./OptionInfo";
import { getGame, seatLabel } from "../games";
import "./NewGameModal.css";

// Starting a game: which rule set where the game has them, how many at the
// table, who can see it, and — where the game has them — how partners are
// picked and which house rules are in force.
//
// Everything game-specific is read off the entry in games.js, so a new game
// arrives on this screen with its own rule sets and table sizes without this
// component learning its name.
//
// The rules default to whatever this player last chose at this size of table,
// fetched by the caller and handed in as `remembered`; a table's rules are
// something people settle once and then keep, so making them re-tick eleven
// boxes every game would be the wrong default.
// Four is the size most of these games are really about, so it is where the
// screen opens wherever the rule set offers it.
const preferredMode = (modes) => (modes.includes(4) ? 4 : modes[0]);

function NewGameModal({ gameType = "500", remembered, loadingDefaults, onStart, onCancel, error }) {
  const game = getGame(gameType);
  const { variants, getVariant, defaultOptions, withDefaults, definitionsFor, housed, seatNote } = game.rules;
  const [variant, setVariant] = useState(variants ? variants[0].id : null);
  const [mode, setMode] = useState(variants ? preferredMode(variants[0].modes) : 4);
  const [visibility, setVisibility] = useState("private");
  const [partnerMode, setPartnerMode] = useState("choose");
  const [fillWithBots, setFillWithBots] = useState(false);
  const [friendly, setFriendly] = useState(false);
  const [options, setOptions] = useState(defaultOptions);
  const [showRules, setShowRules] = useState(false);
  const [starting, setStarting] = useState(false);

  const spec = variants ? getVariant(variant) : null;
  const seats = variants ? spec.modes : game.modes;

  // `remembered` arrives per mode, so switching table size re-reads what was
  // last used at that size — including, for Euchre, the rule set itself.
  const settings = remembered?.[mode];
  useEffect(() => {
    if (!settings) return;
    if (settings.options) setOptions(withDefaults(settings.options));
    if (settings.visibility) setVisibility(settings.visibility);
    if (settings.partnerMode) setPartnerMode(settings.partnerMode);
    setFriendly(Boolean(settings.friendly));
  }, [settings, withDefaults]);

  // A robot at the table makes the game friendly regardless of this checkbox
  // — see isFriendlyGame on the server — so ticking "start against robots"
  // shows it checked and locked, rather than let the two disagree.
  const forcedFriendly = fillWithBots;

  // Not every rule set seats the same numbers, so changing one can invalidate
  // the table size; the nearest size it does offer takes over.
  const chooseVariant = (next) => {
    setVariant(next);
    const allowed = getVariant(next).modes;
    if (!allowed.includes(mode)) setMode(preferredMode(allowed));
  };

  const start = () => {
    setStarting(true);
    onStart({
      gameType,
      variant: variant || undefined,
      mode,
      visibility,
      partnerMode,
      fillWithBots,
      friendly: friendly || forcedFriendly,
      options,
    });
  };

  const rules = definitionsFor(variant);
  const showHouseRules = housed(mode);
  const robotCount = mode - 1;

  return (
    // Choosing house rules takes real thought, and a stray click on the wash
    // around the modal shouldn't throw all of that away — only Cancel does.
    <div className="new-game-overlay">
      <div className="new-game-modal">
        <h2 className="serif">{variants ? `Start a game of ${game.name}` : "Start a game"}</h2>

        {variants && (
          <fieldset className="ng-field">
            <legend className="overline">Rule set</legend>
            <div className="ng-choices">
              {variants.map((option) => (
                <Choice
                  key={option.id}
                  checked={variant === option.id}
                  onSelect={() => chooseVariant(option.id)}
                  label={option.label}
                  note={option.note}
                  detail={option.detail}
                />
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="ng-field">
          <legend className="overline">Players</legend>
          <div className="ng-choices">
            {seats.map((count) => (
              <Choice
                key={count}
                checked={mode === count}
                onSelect={() => setMode(count)}
                label={seatLabel(count)}
                note={seatNote(spec, count)}
              />
            ))}
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

        <label className="ng-check">
          <input
            type="checkbox"
            checked={fillWithBots}
            onChange={(e) => setFillWithBots(e.target.checked)}
          />
          <span>
            <b>{robotCount === 1 ? "Start now against a robot" : "Start now against robots"}</b>
            <span className="ng-note">
              {robotCount === 1
                ? "The other seat is filled with a robot and the hand is dealt straight away."
                : `The other ${robotCount} seats are filled with robots and the hand is dealt straight away.`}
            </span>
          </span>
        </label>

        <label className="ng-check">
          <input
            type="checkbox"
            checked={friendly || forcedFriendly}
            disabled={forcedFriendly}
            onChange={(e) => setFriendly(e.target.checked)}
          />
          <span>
            <b>Friendly game</b>
            <span className="ng-note">
              {forcedFriendly
                ? `Playing against ${robotCount === 1 ? "a robot" : "robots"} always makes it friendly — nobody's Elo rating moves.`
                : "Doesn't affect anyone's Elo rating, win or lose."}
            </span>
          </span>
        </label>

        {!variants && mode === 4 && (
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
        )}

        {showHouseRules && (
          <>
            <HouseRulesToggle
              options={options}
              open={showRules}
              loading={loadingDefaults}
              onToggle={() => setShowRules((open) => !open)}
              definitions={rules}
            />
            {showRules && <HouseRules options={options} onChange={setOptions} definitions={rules} />}
          </>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="ng-actions">
          <button className="btn-primary" onClick={start} disabled={starting}>
            {fillWithBots ? (robotCount === 1 ? "Deal against a robot" : "Deal against robots") : "Start"}
          </button>
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({ checked, onSelect, label, note, detail }) {
  return (
    <div className={`ng-choice${checked ? " on" : ""}`}>
      <button type="button" className="ng-choice-hit" onClick={onSelect} aria-pressed={checked}>
        <b>{label}</b>
        <span className="ng-note">{note}</span>
      </button>
      {detail && <OptionInfo label={label} detail={detail} />}
    </div>
  );
}

export default NewGameModal;
