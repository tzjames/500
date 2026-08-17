import React from "react";
import { isRed } from "../cards";
import { bidLabel } from "../gameOptions";
import "./StatsCharts.css";

// Every contract the game can offer, laid out as the bidding grid is, shaded by
// how often you brought it home. Dark green is all of them, dark red is none,
// and an even split is left unshaded — so the colour is about which way you lean
// rather than about the raw rate, and a cell you've never bid is simply empty.
//
// A single attempt would otherwise paint a cell fully saturated, so the shade is
// damped by how much evidence there is: five contracts at a bid gets you the
// full colour, one gets you a fifth of it.
const CONFIDENCE_AT = 5;

function shadeFor(made, attempts) {
  if (!attempts) return null;
  const rate = made / attempts;
  // −1 (never) through 0 (half) to +1 (always).
  const lean = (rate - 0.5) * 2;
  const confidence = Math.min(1, attempts / CONFIDENCE_AT);
  const strength = Math.abs(lean) * confidence;
  if (strength < 0.02) return null;
  const [r, g, b] = lean > 0 ? [46, 160, 90] : [200, 60, 55];
  return `rgba(${r}, ${g}, ${b}, ${(0.14 + strength * 0.72).toFixed(3)})`;
}

const LEVELS = [6, 7, 8, 9, 10];
const SUITS = ["♠", "♣", "♦", "♥", "NT"];

function Cell({ row, options }) {
  const { attempts, made } = row;
  const shade = shadeFor(made, attempts);
  const rate = attempts ? Math.round((made / attempts) * 100) : null;
  const label = row.special
    ? bidLabel(row.bid, options)
    : `${row.level} ${row.suit === "NT" ? "no trumps" : row.suit}`;

  return (
    <div
      className={`bidrec-cell${attempts ? "" : " empty"}${row.special ? " special" : ""}`}
      style={shade ? { background: shade } : undefined}
      title={
        attempts
          ? `${label}: made ${made} of ${attempts} (${rate}%)`
          : `${label}: never bid`
      }
    >
      <span className="bidrec-bid">
        {row.special ? (
          bidLabel(row.bid, options)
        ) : (
          <>
            {row.level}{" "}
            <span className={isRed(row.suit) ? "red-suit" : ""}>{row.suit}</span>
          </>
        )}
      </span>
      <span className="bidrec-rate">{attempts ? `${rate}%` : "—"}</span>
      <span className="bidrec-count">{attempts ? `${made}/${attempts}` : "not bid"}</span>
    </div>
  );
}

function BidRecordChart({ bids, options }) {
  const find = (bid) => bids.find((b) => b.bid === bid);
  const specials = bids.filter((b) => b.special);
  const anyAttempts = bids.some((b) => b.attempts > 0);

  return (
    <div className="bidrec">
      {!anyAttempts && (
        <p className="stats-empty">
          Nothing here yet — this fills in as you win contracts.
        </p>
      )}
      <div className="bidrec-grid">
        {LEVELS.map((level) =>
          SUITS.map((suit) => {
            const row = find(`${level} ${suit}`);
            return row ? <Cell key={row.bid} row={row} options={options} /> : null;
          })
        )}
      </div>
      {specials.length > 0 && (
        <div className="bidrec-specials">
          {specials.map((row) => (
            <Cell key={row.bid} row={row} options={options} />
          ))}
        </div>
      )}
      <div className="bidrec-legend">
        <span>never made</span>
        <span className="bidrec-scale" aria-hidden="true" />
        <span>always made</span>
      </div>
    </div>
  );
}

export default BidRecordChart;
