import React from "react";

// Live counts along the top: who's about and what they're doing. Site-wide
// rather than per game, so the chooser and the game pages show the same row.
function PresenceStrip({ presence }) {
  const stats = presence || { online: 0, playing: 0, waiting: 0, games: 0 };
  const entries = [
    { label: "logged in", value: stats.online },
    { label: "playing", value: stats.playing },
    { label: "free", value: stats.waiting },
    { label: stats.games === 1 ? "game running" : "games running", value: stats.games },
  ];
  return (
    <ul className="presence-strip">
      {entries.map((entry) => (
        <li key={entry.label}>
          <b className="serif">{entry.value}</b>
          <span>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default PresenceStrip;
