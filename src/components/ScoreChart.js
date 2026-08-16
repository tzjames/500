import React, { useState } from "react";
import "./ScoreChart.css";

// Score by round, drawn on the dark panel palette. Shared by the round-end
// result card (compact, no interaction) and the score-history modal (larger,
// with hover readouts) so both always agree on scale and colour.
//
// The first player's series is the amber one; the opponent is white at 50%.
const SERIES_COLORS = ["rgba(255,235,200,.95)", "rgba(255,255,255,.5)"];

function ScoreChart({
  scoreHistory,
  players,
  width = 680,
  height = 196,
  interactive = false,
}) {
  const [hoveredRound, setHoveredRound] = useState(null);

  const padding = { left: 46, right: 12, top: 12, bottom: 28 };
  const maxRound = Math.max(1, ...scoreHistory.map((h) => h.round));
  const allScores = scoreHistory.flatMap((h) => h.scores.map((s) => s.score));

  // Range rounded out to whole hundreds so the ticks land evenly. 500 is the
  // target score, so the axis always shows at least 0–500 — the distance left
  // to win is the thing you actually want to read off this chart.
  const minScore = Math.floor(Math.min(0, ...allScores) / 100) * 100;
  const maxScore = Math.max(500, Math.ceil(Math.max(0, ...allScores) / 100) * 100);
  const span = maxScore - minScore || 100;

  const xScale = (round) =>
    padding.left +
    ((round - 1) / Math.max(1, maxRound - 1)) *
      (width - padding.left - padding.right);
  const yScale = (score) =>
    height -
    padding.bottom -
    ((score - minScore) / span) * (height - padding.top - padding.bottom);

  // Gridlines at the ends and the midpoint — enough to read against without
  // ruling the whole panel.
  const yTicks = [minScore, Math.round((minScore + maxScore) / 2), maxScore];

  const seriesFor = (name) =>
    scoreHistory
      .map((h) => {
        const entry = h.scores.find((s) => s.name === name);
        return entry ? { round: h.round, score: entry.score } : null;
      })
      .filter(Boolean);

  const hovered = scoreHistory.find((h) => h.round === hoveredRound);

  return (
    <div className="score-chart">
      <div className="score-chart-head">
        <span className="overline">Score by round · first to 500</span>
        <span className="score-chart-legend">
          {players.map((p, i) => (
            <span key={p.name} className="score-chart-legend-item">
              <span
                className="score-chart-swatch"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {p.name}
            </span>
          ))}
        </span>
      </div>

      <div className="score-chart-plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label="Score by round"
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={padding.left}
                y1={yScale(v)}
                x2={width - padding.right}
                y2={yScale(v)}
                stroke="rgba(255,255,255,.13)"
              />
              <text
                x={padding.left - 10}
                y={yScale(v) + 4}
                textAnchor="end"
                fontSize="11"
                fill="rgba(244,241,234,.55)"
              >
                {v}
              </text>
            </g>
          ))}

          {scoreHistory.map((h) => (
            <text
              key={h.round}
              x={xScale(h.round)}
              y={height - padding.bottom + 17}
              textAnchor="middle"
              fontSize="10.5"
              fill="rgba(244,241,234,.5)"
            >
              {h.round}
            </text>
          ))}

          {players.map((player, i) => {
            const points = seriesFor(player.name);
            const d = points
              .map(
                (p, index) =>
                  `${index === 0 ? "M" : "L"} ${xScale(p.round)} ${yScale(p.score)}`
              )
              .join(" ");
            const color = SERIES_COLORS[i % SERIES_COLORS.length];
            return (
              <g key={player.name}>
                {points.length > 1 && (
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={i === 0 ? 3 : 2.5}
                    strokeLinejoin="round"
                  />
                )}
                {points.map((p) => (
                  <circle
                    key={p.round}
                    cx={xScale(p.round)}
                    cy={yScale(p.score)}
                    r={hoveredRound === p.round ? 5.5 : i === 0 ? 4 : 3.5}
                    fill={color}
                    onMouseEnter={
                      interactive ? () => setHoveredRound(p.round) : undefined
                    }
                    onMouseLeave={
                      interactive ? () => setHoveredRound(null) : undefined
                    }
                  />
                ))}
              </g>
            );
          })}
        </svg>

        {interactive && hovered && (
          <div
            className="score-chart-tooltip"
            style={{
              left: `${(xScale(hovered.round) / width) * 100}%`,
              top: Math.min(...hovered.scores.map((s) => yScale(s.score))),
            }}
          >
            <strong>Round {hovered.round}</strong>
            {hovered.scores.map((s) => (
              <div key={s.name}>
                {s.name}: {s.score}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScoreChart;
