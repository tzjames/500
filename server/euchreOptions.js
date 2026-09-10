// Euchre's rule sets and house rules, validated. The definitions live in
// src/euchreOptions.json so the picker on the Euchre home page and this
// validator read the same list; everything here is about turning whatever a
// client sends into a setup the engine can trust.
const definitions = require("../src/euchreOptions.json");

const VARIANTS = definitions.variants;
const OPTIONS = definitions.options;
const byId = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

const appliesTo = (option, variant) => option.applies.includes(variant);

function defaultEuchreOptions() {
  return Object.fromEntries(OPTIONS.map((o) => [o.id, o.default]));
}

// Anything unrecognised is dropped rather than corrected, and anything the
// chosen rule set has no use for is pinned to its default.
function sanitizeEuchreOptions(raw, variant = "northAmerican") {
  const out = defaultEuchreOptions();
  if (!raw || typeof raw !== "object") return out;
  for (const option of OPTIONS) {
    if (!appliesTo(option, variant)) continue;
    const value = raw[option.id];
    if (option.type === "bool") {
      if (typeof value === "boolean") out[option.id] = value;
    } else if (option.choices.some((c) => c.value === value)) {
      out[option.id] = value;
    }
  }
  return out;
}

// Every option this table has moved off its default, as short phrases for the
// lobby — "Stick the dealer · Game is 11" says more in a line than a count.
function describeEuchreOptions(options, variant = "northAmerican") {
  const merged = sanitizeEuchreOptions(options, variant);
  return OPTIONS.filter((o) => appliesTo(o, variant) && merged[o.id] !== o.default).map((o) => {
    if (o.type === "choice") {
      const choice = o.choices.find((c) => c.value === merged[o.id]);
      return choice ? `${o.label} ${choice.label}` : o.label;
    }
    return merged[o.id] ? o.label : o.offLabel || `No ${o.label.toLowerCase()}`;
  });
}

// A variant and a table size that actually go together, whatever was asked for.
function validEuchreSetup({ variant, mode } = {}) {
  const spec = byId[variant] || byId.northAmerican;
  const requested = Number(mode);
  const seats = spec.modes.includes(requested) ? requested : spec.modes[spec.modes.length - 1];
  return { variant: spec.id, mode: seats, seats };
}

module.exports = {
  VARIANTS,
  OPTIONS,
  variantById: byId,
  defaultEuchreOptions,
  sanitizeEuchreOptions,
  describeEuchreOptions,
  validEuchreSetup,
};
