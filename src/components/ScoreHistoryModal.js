import React, { useState } from "react";
import "./ScoreHistoryModal.css";

const COLORS = ["#1f77b4", "#d62728"];

function ScoreHistoryModal({ scoreHistory, players, onClose }) {
  const [hoveredRound, setHoveredRound] = useState(null);

  const width = 480;
  const height = 280;
  const padding = 40;

  const rounds = scoreHistory.map((h) => h.round);
  const maxRound = Math.max(1, ...rounds);
  const allScores = scoreHistory.flatMap((h) => h.scores.map((s) => s.score));
  // Round the range out to whole hundreds so the 100-point ticks land evenly.
  const minScore = Math.floor(Math.min(0, ...allScores) / 100) * 100;
  const maxScore = Math.max(100, Math.ceil(Math.max(0, ...allScores) / 100) * 100);
  const scoreSpan = maxScore - minScore || 100;

  const xScale = (round) =>
    padding + ((round - 1) / Math.max(1, maxRound - 1)) * (width - 2 * padding);
  const yScale = (score) =>
    height - padding - ((score - minScore) / scoreSpan) * (height - 2 * padding);

  const yTicks = [];
  for (let v = minScore; v <= maxScore; v += 100) yTicks.push(v);
  const xTicks = [];
  for (let r = 1; r <= maxRound; r++) xTicks.push(r);

  const seriesFor = (playerName) =>
    scoreHistory
      .map((h) => {
        const entry = h.scores.find((s) => s.name === playerName);
        return entry ? { round: h.round, score: entry.score } : null;
      })
      .filter(Boolean);

  const hoveredEntry = scoreHistory.find((h) => h.round === hoveredRound);

  return (
    <div className="score-history-overlay" onClick={onClose}>
      <div className="score-history-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Score History</h2>
        <div className="score-history-chart-wrapper">
          <svg width={width} height={height}>
            {yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={padding}
                  y1={yScale(v)}
                  x2={width - padding}
                  y2={yScale(v)}
                  stroke={v === 0 ? "#ccc" : "#eee"}
                />
                <text x={padding - 8} y={yScale(v) + 4} textAnchor="end" fontSize="10" fill="#666">
                  {v}
                </text>
              </g>
            ))}
            {xTicks.map((r) => (
              <g key={r}>
                <line
                  x1={xScale(r)}
                  y1={height - padding}
                  x2={xScale(r)}
                  y2={height - padding + 4}
                  stroke="#999"
                />
                <text
                  x={xScale(r)}
                  y={height - padding + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#666"
                >
                  {r}
                </text>
              </g>
            ))}
            <line
              x1={padding}
              y1={height - padding}
              x2={width - padding}
              y2={height - padding}
              stroke="#999"
            />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#999" />
            <text x={width / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#333">
              Round
            </text>
            <text
              x={12}
              y={height / 2}
              textAnchor="middle"
              fontSize="11"
              fill="#333"
              transform={`rotate(-90, 12, ${height / 2})`}
            >
              Score
            </text>
            {players.map((player, playerIndex) => {
              const points = seriesFor(player.name);
              const pathD = points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.round)} ${yScale(p.score)}`)
                .join(" ");
              const color = COLORS[playerIndex % COLORS.length];
              return (
                <g key={player.name}>
                  {points.length > 1 && (
                    <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
                  )}
                  {points.map((p) => (
                    <circle
                      key={p.round}
                      cx={xScale(p.round)}
                      cy={yScale(p.score)}
                      r={hoveredRound === p.round ? 7 : 5}
                      fill={color}
                      className="score-history-point"
                      onMouseEnter={() => setHoveredRound(p.round)}
                      onMouseLeave={() => setHoveredRound(null)}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
          {hoveredEntry && (
            <div
              className="score-history-tooltip"
              style={{
                left: xScale(hoveredEntry.round),
                top: Math.min(...hoveredEntry.scores.map((s) => yScale(s.score))),
              }}
            >
              <strong>Round {hoveredEntry.round}</strong>
              {hoveredEntry.scores.map((s) => (
                <div key={s.name}>
                  {s.name}: {s.score}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="score-history-legend">
          {players.map((player, i) => (
            <span key={player.name} className="score-history-legend-item">
              <span
                className="score-history-swatch"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              {player.name}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="score-history-close">
          Close
        </button>
      </div>
    </div>
  );
}

export default ScoreHistoryModal;
