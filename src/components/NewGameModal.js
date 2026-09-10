import React, { useEffect, useState } from "react";
import HouseRules, { HouseRulesToggle } from "./HouseRules";
import OptionInfo from "./OptionInfo";
import { defaultOptions, withDefaults, definitions as fiveHundredRules } from "../gameOptions";
import {
  VARIANTS,
  getVariant,
  defaultOptions as euchreDefaults,
  withDefaults as withEuchreDefaults,
  definitionsFor,
} from "../euchreOptions";
import "./NewGameModal.css";

const SEAT_LABEL = { 2: "Two", 3: "Three", 4: "Four" };

// Starting a game: which rule set for Euchre, how many at the table, who can
// see it, and — where the game has them — how partners are picked and which
// house rules are in force.
//
// The rules default to whatever this player last chose at this size of table,
// fetched by the caller and handed in as `remembered`; a table's rules are
// something people settle once and then keep, so making them re-tick eleven
// boxes every game would be the wrong default.
function NewGameModal({ gameType = "500", remembered, loadingDefaults, onStart, onCancel, error }) {
  const euchre = gameType === "euchre";
  const [mode, setMode] = useState(4);
  const [variant, setVariant] = useState("northAmerican");
  const [visibility, setVisibility] = useState("private");
  const [partnerMode, setPartnerMode] = useState("choose");
  const [fillWithBots, setFillWithBots] = useState(false);
  const [friendly, setFriendly] = useState(false);
  const [options, setOptions] = useState(euchre ? euchreDefaults : defaultOptions);
  const [showRules, setShowRules] = useState(false);
  const [starting, setStarting] = useState(false);

  const spec = getVariant(variant);
  const seats = euchre ? spec.modes : [2, 4];

  // `remembered` arrives per mode, so switching table size re-reads what was
  // last used at that size — including, for Euchre, the rule set itself.
  const settings = remembered?.[mode];
  useEffect(() => {
    if (!settings) return;
    if (settings.options) setOptions(euchre ? withEuchreDefaults(settings.options) : withDefaults(settings.options));
    if (settings.visibility) setVisibility(settings.visibility);
    if (settings.partnerMode) setPartnerMode(settings.partnerMode);
    setFriendly(Boolean(settings.friendly));
  }, [settings, euchre]);

  // A robot at the table makes the game friendly regardless of this checkbox
  // — see isFriendlyGame on the server — so ticking "start against robots"
  // shows it checked and locked, rather than let the two disagree.
  const forcedFriendly = fillWithBots;

  // Not every rule set seats the same numbers, so changing one can invalidate
  // the table size; the nearest size it does offer takes over.
  const chooseVariant = (next) => {
    setVariant(next);
    const allowed = getVariant(next).modes;
    if (!allowed.includes(mode)) setMode(allowed[allowed.length - 1]);
  };

  const start = () => {
    setStarting(true);
    onStart({
      gameType,
      variant: euchre ? variant : undefined,
      mode,
      visibility,
      partnerMode,
      fillWithBots,
      friendly: friendly || forcedFriendly,
      options,
    });
  };

  const rules = euchre ? definitionsFor(variant) : fiveHundredRules;
  const showHouseRules = euchre || mode === 4;
  const robotCount = mode - 1;

  return (
    // Choosing house rules takes real thought, and a stray click on the wash
    // around the modal shouldn't throw all of that away — only Cancel does.
    <div className="new-game-overlay">
      <div className="new-game-modal">
        <h2 className="serif">{euchre ? "Start a game of Euchre" : "Start a game"}</h2>

        {euchre && (
          <fieldset className="ng-field">
            <legend className="overline">Rule set</legend>
            <div className="ng-choices">
              {VARIANTS.map((option) => (
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
                label={SEAT_LABEL[count]}
                note={seatNote(gameType, spec, count)}
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

        {!euchre && mode === 4 && (
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

function seatNote(gameType, spec, count) {
  if (gameType !== "euchre") {
    return count === 2 ? "Two-handed, each playing a dummy" : "Two partnerships, the standard game";
  }
  if (count === 4 && spec.teams) return "Two partnerships sitting opposite";
  return "Everyone for themselves, one score each";
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
