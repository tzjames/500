import React from "react";
import OptionInfo from "./OptionInfo";
import { OPTION_GROUPS, optionsByGroup, defaultOptions, changedOptionLabels } from "../gameOptions";
import "./NewGameModal.css";

// The house-rule editor, shared by the new-game screen and the waiting room —
// the host can still change the rules while the table fills up, and it should be
// the same list of switches in both places. `readOnly` renders it for everyone
// else, who can see what they're sitting down to but not change it.
function HouseRules({ options, onChange, readOnly = false }) {
  const set = (id, value) => onChange({ ...options, [id]: value });

  return (
    <div className="ng-rules">
      {OPTION_GROUPS.map((group) => (
        <div key={group.id} className="ng-rules-group">
          <p className="overline">{group.label}</p>
          {optionsByGroup(group.id).map((option) =>
            option.type === "choice" ? (
              <div key={option.id} className="ng-rule ng-rule-choice">
                <span className="ng-rule-label">
                  {option.label}
                  <OptionInfo label={option.label} detail={option.detail} />
                </span>
                <div className="ng-rule-segments">
                  {option.choices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      className={`ng-segment${options[option.id] === choice.value ? " on" : ""}`}
                      disabled={readOnly}
                      onClick={() => set(option.id, choice.value)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <span className="ng-note">{option.help}</span>
              </div>
            ) : (
              <label key={option.id} className="ng-rule">
                <input
                  type="checkbox"
                  checked={Boolean(options[option.id])}
                  disabled={readOnly}
                  onChange={(e) => set(option.id, e.target.checked)}
                />
                <span>
                  <span className="ng-rule-label">
                    {option.label}
                    <OptionInfo label={option.label} detail={option.detail} />
                  </span>
                  <span className="ng-note">{option.help}</span>
                </span>
              </label>
            )
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="auth-toggle" onClick={() => onChange(defaultOptions())}>
          Back to the standard rules
        </button>
      )}
    </div>
  );
}

// The button that opens the list, with a word on how far the table has strayed
// from the standard rules.
export function HouseRulesToggle({ options, open, onToggle, loading = false }) {
  const changed = changedOptionLabels(options).length;
  return (
    <button type="button" className="ng-rules-toggle" onClick={onToggle} aria-expanded={open}>
      House rules
      <span className="ng-rules-count">
        {loading ? "loading…" : changed === 0 ? "standard" : `${changed} changed`}
      </span>
    </button>
  );
}

export default HouseRules;
