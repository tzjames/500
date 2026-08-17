// The four-player house rules, read from the same JSON the server validates
// against so a label or a default can only ever be defined in one place.
import definitions from "./gameOptions.json";

export const OPTION_GROUPS = definitions.groups;
export const OPTIONS = definitions.options;

export const defaultOptions = () =>
  Object.fromEntries(OPTIONS.map((o) => [o.id, o.default]));

// Fills in anything a remembered set is missing — an option added since the
// last game was created won't be in there.
export const withDefaults = (options) => ({ ...defaultOptions(), ...(options || {}) });

export const optionsByGroup = (groupId) => OPTIONS.filter((o) => o.group === groupId);

// What a naming option decided to call the no-tricks bid, applied to a bid
// string. "Misere" is what the server stores whatever the table calls it.
export function bidLabel(bid, options) {
  if (!bid) return "";
  if (!bid.includes("Misere")) return bid;
  const name = options?.misereName === "nullo" ? "Nullo" : "Misère";
  return bid.replace("Misere", name);
}

// Everything that isn't at its default, for a one-line summary of a table. A
// switch that's normally on and has been turned off needs saying the other way
// round — listing "Ten points a trick" on a table that has just switched trick
// points off would read as exactly the opposite of the truth.
export function changedOptionLabels(options) {
  const merged = withDefaults(options);
  return OPTIONS.filter((o) => merged[o.id] !== o.default).map((o) => {
    if (o.type === "choice") {
      return o.choices.find((c) => c.value === merged[o.id])?.label || o.label;
    }
    return merged[o.id] ? o.label : o.offLabel || `No ${o.label.toLowerCase()}`;
  });
}
