import React, { useState } from "react";
import { isRed } from "../cards";
import { bidLabel } from "../gameOptions";
import "./BiddingInterface.css";

const LEVELS = [6, 7, 8, 9, 10];
const SUITS = ["♠", "♣", "♦", "♥", "NT"];

// The four-player auction. Two stages, like the two-player panel: pick a
// contract to select it, then commit — a misclick shouldn't be a bid. Which
// bids exist at all depends on the table's house rules, and which of those are
// legal right now comes from the server as `legalBids`, so this panel never has
// to reason about the rules itself.
function BiddingInterface4({
  seats,
  mySeat,
  auction,
  availableBids = [],
  legalBids,
  options,
  onPlaceBid,
}) {
  const [selected, setSelected] = useState(null);
  const myTurn = auction && auction.turnSeat === mySeat;
  const allowed = legalBids ? new Set(legalBids) : null;
  const highBid = auction?.highBid;

  const nameOf = (seat) =>
    seat === mySeat ? "You" : seats.find((s) => s.seat === seat)?.name || "They";

  const renderBid = (bid) => {
    if (!bid || bid === "Pass") return "Pass";
    if (bid.includes("Misere") || bid === "Double Nullo" || bid === "Hi-Lo") {
      return bidLabel(bid, options);
    }
    const [level, suit] = bid.split(" ");
    return (
      <>
        {level} <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
      </>
    );
  };

  const history = auction?.history?.length > 0 && (
    <ol className="bid-history">
      {auction.history.map((entry, index) => (
        <li key={index}>
          <span className="bid-history-who">{nameOf(entry.seat)}</span>
          <span className="bid-history-what">
            {renderBid(entry.bid)}
            {entry.bid !== "Pass" && <span className="bid-history-pts"> · {entry.points}</span>}
          </span>
        </li>
      ))}
    </ol>
  );

  const standing = (
    <div className="bid-to-beat">
      <p className="panel-heading">{highBid ? `${nameOf(highBid.seat)} bid` : "Bid to beat"}</p>
      <p className="bid-to-beat-value serif">{highBid ? renderBid(highBid.bid) : "Open"}</p>
      {highBid && <p className="bid-to-beat-pts">{highBid.points} points</p>}
    </div>
  );

  if (!myTurn) {
    const barred = auction?.barredSeats?.includes(mySeat);
    return (
      <div className="bid-panel bid-panel-waiting">
        <p className="panel-heading">Bidding</p>
        <p className="bid-outcome serif">
          Waiting for {nameOf(auction?.turnSeat)} to bid
        </p>
        {barred && <p className="side-note">You&apos;re sitting this auction out.</p>}
        {highBid && (
          <p className="side-note">
            {nameOf(highBid.seat)} bid {renderBid(highBid.bid)} for {highBid.points}
          </p>
        )}
        {history}
      </div>
    );
  }

  const specials = availableBids.filter((b) => b.special);

  const commit = () => {
    if (!selected) return;
    onPlaceBid(selected.bid);
    setSelected(null);
  };

  return (
    <div className="bid-panel">
      <div className="bid-head">
        <div>
          <p className="panel-heading">Your bid</p>
          <p className="bid-selected serif">{selected ? renderBid(selected.bid) : "—"}</p>
          <p className="bid-selected-pts">
            {selected ? `${selected.points} points` : "Pick a contract"}
          </p>
        </div>
        {standing}
      </div>

      <div className="bid-grid">
        {LEVELS.map((level) =>
          SUITS.map((suit) => {
            const bid = `${level} ${suit}`;
            const info = availableBids.find((b) => b.bid === bid);
            const disabled = !allowed?.has(bid);
            const isSelected = selected?.bid === bid;
            return (
              <button
                key={bid}
                type="button"
                className={`bid-cell${isSelected ? " selected" : ""}`}
                disabled={disabled}
                onClick={() => setSelected({ bid, points: info?.points })}
                aria-label={`${level} ${suit === "NT" ? "no trumps" : suit}, ${info?.points} points`}
                aria-pressed={isSelected}
              >
                <span className="bid-cell-label">
                  <span className="bid-cell-level">{level}</span>
                  <span
                    className={`bid-cell-suit${suit === "NT" ? " nt" : ""}${
                      isRed(suit) ? " red-suit" : ""
                    }`}
                  >
                    {suit}
                  </span>
                </span>
                <span className="bid-cell-pts">{info?.points}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="bid-misere-row bid-misere-row-wide">
        {specials.map((special) => {
          const disabled = !allowed?.has(special.bid);
          const isSelected = selected?.bid === special.bid;
          return (
            <button
              key={special.bid}
              type="button"
              className={`bid-misere${isSelected ? " selected" : ""}`}
              disabled={disabled}
              onClick={() => setSelected({ bid: special.bid, points: special.points })}
              aria-pressed={isSelected}
            >
              <span>
                <span className="bid-misere-label">{bidLabel(special.bid, options)}</span>
                <span className="bid-misere-note">{SPECIAL_NOTES[special.bid]}</span>
              </span>
              <span className="bid-misere-pts serif">{special.points}</span>
            </button>
          );
        })}
      </div>

      <div className="bid-actions">
        <button className="btn-primary bid-commit" onClick={commit} disabled={!selected}>
          {selected ? <>Bid {renderBid(selected.bid)}</> : "Bid"}
        </button>
        <button className="btn-ghost bid-pass" onClick={() => onPlaceBid("Pass")}>
          Pass
        </button>
      </div>

      {history}
    </div>
  );
}

const SPECIAL_NOTES = {
  Misere: "win no tricks, partner folds",
  "Open Misere": "win none, hand face up",
  "Blind Misere": "win none, called blind",
  "Hi-Lo": "win exactly five",
  "Double Nullo": "neither partner wins one",
};

export default BiddingInterface4;
