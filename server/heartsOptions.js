// Hearts' rule sets and house rules, validated. The definitions live in
// src/heartsOptions.json so the picker on the Hearts home page and this
// validator read the same list; everything here is about turning whatever a
// client sends into a setup the engine can trust.
const definitions = require("../src/heartsOptions.json");

const VARIANTS = definitions.variants;
const OPTIONS = definitions.options;
const byId = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

const appliesTo = (option, variant) => option.applies.includes(variant);

function defaultHeartsOptions() {
  return Object.fromEntries(OPTIONS.map((o) => [o.id, o.default]));
}

// Anything unrecognised is dropped rather than corrected, and anything the
// chosen rule set has no use for is pinned to its default.
function sanitizeHeartsOptions(raw, variant = "blackLady") {
  const out = defaultHeartsOptions();
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

// Every rule this table is actually playing, as concrete values — see
// resolveRules in src/heartsOptions.js, which this mirrors. A rule left on
// Standard, or one the rule set doesn't offer at all, resolves to whatever the
// rule set itself says, so nothing downstream has to re-derive that.
function resolveRules(options, variant = "blackLady") {
  const spec = byId[variant] || byId.blackLady;
  const merged = sanitizeHeartsOptions(options, spec.id);
  const out = { ...spec.rules, target: spec.target };
  for (const option of OPTIONS) {
    if (!appliesTo(option, spec.id) || merged[option.id] === "variant") continue;
    out[option.id] = merged[option.id];
  }
  return out;
}

// Every option this table has moved off its default, as short phrases for the
// lobby — "Pass right · Game ends at 50" says more in a line than a count.
function describeHeartsOptions(options, variant = "blackLady") {
  const merged = sanitizeHeartsOptions(options, variant);
  return OPTIONS.filter((o) => appliesTo(o, variant) && merged[o.id] !== o.default).map((o) => {
    if (o.type === "choice") {
      const choice = o.choices.find((c) => c.value === merged[o.id]);
      return choice ? `${o.label} ${choice.label.toLowerCase()}` : o.label;
    }
    return merged[o.id] ? o.label : o.offLabel || `No ${o.label.toLowerCase()}`;
  });
}

// A variant and a table size that actually go together, whatever was asked for.
function validHeartsSetup({ variant, mode } = {}) {
  const spec = byId[variant] || byId.blackLady;
  const requested = Number(mode);
  const seats = spec.modes.includes(requested) ? requested : spec.modes[0];
  return { variant: spec.id, mode: seats, seats };
}

module.exports = {
  VARIANTS,
  OPTIONS,
  variantById: byId,
  defaultHeartsOptions,
  sanitizeHeartsOptions,
  resolveRules,
  describeHeartsOptions,
  validHeartsSetup,
};
