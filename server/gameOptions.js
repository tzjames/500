// The four-player game's house rules. The definitions themselves live in
// src/gameOptions.json so the picker on the home page and this validator read
// the same list; everything here is about turning whatever a client sends into
// a trustworthy option set.
const definitions = require("../src/gameOptions.json");

const OPTIONS = definitions.options;

function defaultOptions() {
  return Object.fromEntries(OPTIONS.map((o) => [o.id, o.default]));
}

// Anything unrecognised is dropped rather than corrected: these ride along in
// the persisted game document and drive scoring, so a stale or hand-rolled
// client shouldn't be able to put a value in there that the rules don't know.
function sanitizeOptions(raw) {
  const out = defaultOptions();
  if (!raw || typeof raw !== "object") return out;
  for (const option of OPTIONS) {
    const value = raw[option.id];
    if (option.type === "bool") {
      if (typeof value === "boolean") out[option.id] = value;
    } else if (option.type === "choice") {
      if (option.choices.some((c) => c.value === value)) out[option.id] = value;
    }
  }
  return out;
}

// Every option that isn't at its default, as short phrases — the lobby lists
// tables by their house rules, and "Nullo · Hi-Lo · Ralphing" says more in a
// line than a count of toggles would.
function describeOptions(options) {
  return OPTIONS.filter((o) => options[o.id] !== o.default).map((o) =>
    o.type === "choice"
      ? o.choices.find((c) => c.value === options[o.id])?.label || o.label
      : o.label
  );
}

module.exports = { OPTIONS, defaultOptions, sanitizeOptions, describeOptions };
