// Sound effects. Each event has a set of takes and fires one at random, so a
// repeated action — a card hitting the table, most of all — doesn't turn into
// the same click over and over.
//
// Deliberately best-effort: browsers refuse audio until the page has been
// interacted with, and a blocked or missing sound must never break a hand, so
// every failure here is swallowed.

const SETS = {
  shuffle: ["/sounds/shuffle-1.m4a", "/sounds/shuffle-2.m4a"],
  play: ["/sounds/play-1.m4a", "/sounds/play-2.m4a"],
  won: ["/sounds/won-1.m4a", "/sounds/won-2.m4a"],
  loss: ["/sounds/loss-1.mp3"],
};

// Per event, because the takes aren't matched for loudness: the win and loss
// stings are mastered much hotter than the card sounds, and a card being
// played happens forty times a hand.
const LEVELS = { shuffle: 0.55, play: 0.4, won: 0.7, loss: 0.7 };

const STORAGE_KEY = "soundOn";

export const soundEnabled = () => localStorage.getItem(STORAGE_KEY) !== "off";

export function setSoundEnabled(on) {
  localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
}

// One Audio per file, reused. Cloning on each play is what allows the same
// sound to overlap itself — two cards landing in quick succession shouldn't
// cut each other off.
const cache = new Map();

// The take each event used last, so the next one differs. Picking uniformly at
// random repeated a take back-to-back about half the time with only two of
// them, and two copies of the same short waveform landing together sound like
// one slightly louder sound rather than two — which reads as a missed sound
// when what you're listening for is a second card.
const lastTake = new Map();

function pick(kind, set) {
  if (set.length === 1) return set[0];
  const previous = lastTake.get(kind);
  const choices = set.filter((src) => src !== previous);
  const src = choices[Math.floor(Math.random() * choices.length)];
  lastTake.set(kind, src);
  return src;
}

function element(src) {
  if (!cache.has(src)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    cache.set(src, audio);
  }
  return cache.get(src);
}

// Warms the cache so the first card of a hand isn't silent while it downloads.
export function preloadSounds() {
  try {
    Object.values(SETS).flat().forEach((src) => element(src).load());
  } catch {
    /* no audio support; nothing to warm */
  }
}

export function playSound(kind) {
  if (!soundEnabled()) return;
  const set = SETS[kind];
  if (!set || set.length === 0) return;
  try {
    const take = element(pick(kind, set)).cloneNode();
    take.volume = LEVELS[kind] ?? 0.6;
    // Rejects when the browser hasn't seen an interaction yet, which is normal
    // and not worth surfacing.
    const started = take.play();
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    /* never let a sound break the game */
  }
}
