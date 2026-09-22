// Hearts' rule sets and house rules, read from the same JSON the server
// validates against so a label or a default can only ever be defined in one
// place. Which options a table can even set depends on the rule set it is
// playing, so almost everything here is scoped by variant.
import definitions from "./heartsOptions.json";

export const VARIANTS = definitions.variants;
export const OPTION_GROUPS = definitions.groups;
export const OPTIONS = definitions.options;

export const getVariant = (id) => VARIANTS.find((v) => v.id === id) || VARIANTS[0];

export const defaultOptions = () => Object.fromEntries(OPTIONS.map((o) => [o.id, o.default]));

// Fills in anything a remembered set is missing — an option added since the
// last game was created won't be in there.
export const withDefaults = (options) => ({ ...defaultOptions(), ...(options || {}) });

const appliesTo = (option, variant) => option.applies.includes(variant);

// The options a rule set actually uses, with everything else pinned back to its
// default — the same thing sanitizeHeartsOptions does on the server, so what the
// help panel describes is what the table is really dealing.
export function scopedOptions(options, variant) {
  const merged = withDefaults(options);
  return Object.fromEntries(
    OPTIONS.map((o) => [o.id, appliesTo(o, variant) ? merged[o.id] : o.default])
  );
}

// Every rule this table is actually playing, as concrete values. An option the
// rule set doesn't offer, or one left on Standard, resolves to what the rule set
// itself says — so the engine, the robot and the help panel all read one answer
// rather than each re-deriving "unless the variant says otherwise".
export function resolveRules(options, variant) {
  const spec = getVariant(variant);
  const scoped = scopedOptions(options, variant);
  const out = { ...spec.rules, target: spec.target };
  for (const option of OPTIONS) {
    if (!appliesTo(option, variant)) continue;
    const value = scoped[option.id];
    if (value === "variant") continue;
    out[option.id] = value;
  }
  return out;
}

export const optionsByGroup = (groupId, variant) =>
  OPTIONS.filter((o) => o.group === groupId && appliesTo(o, variant));

// Every house rule this rule set offers, by name — what the help panel lists
// when there is no table in front of it to read the settings off.
export const optionLabelsFor = (variant) =>
  OPTIONS.filter((o) => appliesTo(o, variant)).map((o) => o.label);

export const groupsFor = (variant) =>
  OPTION_GROUPS.filter((group) => optionsByGroup(group.id, variant).length > 0);

// Everything this table has moved off its default, for a one-line summary. An
// option the rule set doesn't use never counts, however it was left set.
export function changedOptionLabels(options, variant = "blackLady") {
  const merged = scopedOptions(options, variant);
  return OPTIONS.filter((o) => merged[o.id] !== o.default).map((o) => {
    if (o.type === "choice") {
      const choice = o.choices.find((c) => c.value === merged[o.id]);
      return choice ? `${o.label} ${choice.label.toLowerCase()}` : o.label;
    }
    return merged[o.id] ? o.label : o.offLabel || `No ${o.label.toLowerCase()}`;
  });
}

// What the game ends at, which both the table header and the rules panel want.
export function targetOf(variant, options) {
  const rules = resolveRules(options, variant);
  return Number(rules.target ?? getVariant(variant).target);
}

// What a variant is called and how long its game runs, for the table header.
export function variantSummary(variant, options) {
  const spec = getVariant(variant);
  const deals = resolveRules(options, variant).endAfterDeals;
  const stop = deals && deals !== "none" ? `, or ${deals} deals` : "";
  return `${spec.label} — lowest score when somebody hits ${targetOf(variant, options)}${stop}`;
}

export const definitionsFor = (variant) => ({
  groups: groupsFor(variant),
  optionsByGroup: (groupId) => optionsByGroup(groupId, variant),
  defaultOptions,
  changedOptionLabels: (options) => changedOptionLabels(options, variant),
});
