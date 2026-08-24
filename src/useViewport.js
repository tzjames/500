import { useEffect, useState } from "react";

// Two breakpoints, and the same two numbers the stylesheets use.
//
// `narrow` is where the side panels stop fitting beside the felt and get hidden
// (see .board-row in App.css). Everything they carried — the contract, both
// scores, the tricks still needed, the claim and concede buttons, the help —
// went with them, so this is the width at which something has to take over.
//
// `phone` is the design's 402×874 target, where the layout stops being a
// squeezed desktop and starts being its own thing: bigger touch targets and a
// tap-then-confirm play.
export const NARROW_MAX = 1280;
export const PHONE_MAX = 620;

// matchMedia rather than a resize listener: it fires on the transition itself
// rather than on every pixel of a drag, it covers orientation changes and zoom
// without extra cases, and asking the same question the stylesheet asks is what
// keeps the two from disagreeing about where a breakpoint is.
const QUERIES = {
  narrow: `(max-width: ${NARROW_MAX}px)`,
  phone: `(max-width: ${PHONE_MAX}px)`,
};

const matches = (query) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

const read = () => ({ narrow: matches(QUERIES.narrow), phone: matches(QUERIES.phone) });

export function useViewport() {
  const [state, setState] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
    const onChange = () => setState(read);
    lists.forEach((list) => {
      // addListener is the deprecated spelling, kept for older Safari.
      if (list.addEventListener) list.addEventListener("change", onChange);
      else list.addListener(onChange);
    });
    // A breakpoint can have been crossed between first render and this effect.
    onChange();
    return () => {
      lists.forEach((list) => {
        if (list.removeEventListener) list.removeEventListener("change", onChange);
        else list.removeListener(onChange);
      });
    };
  }, []);

  return state;
}
