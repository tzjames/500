import React, { useState } from "react";
import { isRed } from "../cards";
import "./BiddingInterface.css";

const LEVELS = [6, 7, 8, 9, 10];
const SUITS = ["♠", "♣", "♦", "♥", "NT"];

// Suit sets the base (♠40 ♣60 ♦80 ♥100 NT120), each level above six adds 100.
const SUIT_BASE = { "♠": 40, "♣": 60, "♦": 80, "♥": 100, NT: 120 };
const pointsFor = (level, suit) => SUIT_BASE[suit] + (level - 6) * 100;

const MISERE = [
  { bid: "Misere", label: "Misère", note: "win no tricks", points: 250 },
  {
    bid: "Open Misere",
    label: "Open Misère",
    note: "win none, hand face up",
    points: 500,
  },
];

// The auction. Two-stage now, matching the mockup: pick a cell to select it,
// then commit with the Bid button — the old one-click-per-cell interface made
// a misclick an irrevocable bid. Pass is unchanged and still immediate.
function BiddingInterface({
  currentBid,
  players,
  playerId,
  currentBidder,
  onPlaceBid,
  biddingComplete,
  biddingHistory,
  gameSettings,
  offerPassDeclined,
  offerRetroactivePassDeclined,
  waitingForOfferResponse,
  onOfferPass,
  onOfferRetroactivePass,
  playerScore,
  opponentScore,
  opponentName,
}) {
  const [selected, setSelected] = useState(null);
  const isCurrentBidder = playerId === currentBidder;
  const floor = currentBid ? currentBid.points : 0;

  const nameFor = (id) =>
    id === playerId ? "You" : players.find((p) => p.id === id)?.name || "They";

  const renderBid = (bid) => {
    if (!bid || bid === "Pass") return "Pass";
    if (bid.includes("Misere")) return bid.replace("Misere", "Misère");
    const [level, suit] = bid.split(" ");
    return (
      <>
        {level} <span className={isRed(suit) ? "red-suit" : ""}>{suit}</span>
      </>
    );
  };

  const history = biddingHistory.length > 0 && (
    <ol className="bid-history">
      {biddingHistory.map((entry, index) => (
        <li key={index}>
          <span className="bid-history-who">{nameFor(entry.player)}</span>
          <span className="bid-history-what">
            {renderBid(entry.bid)}
            {entry.bid !== "Pass" && (
              <span className="bid-history-pts"> · {entry.points}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );

  if (biddingComplete) {
    return (
      <div className="bid-panel bid-panel-result">
        <p className="panel-heading">Bidding complete</p>
        {currentBid ? (
          <p className="bid-outcome serif">
            {nameFor(currentBid.player)} won it with {renderBid(currentBid.bid)}{" "}
            for {currentBid.points}
          </p>
        ) : (
          <p className="bid-outcome serif">Everyone passed — redealing.</p>
        )}
        {history}
      </div>
    );
  }

  if (!isCurrentBidder) {
    return (
      <div className="bid-panel bid-panel-waiting">
        <p className="panel-heading">Bidding</p>
        <p className="bid-outcome serif">
          Waiting for {players.find((p) => p.id === currentBidder)?.name} to bid
        </p>
        {currentBid && (
          <p className="side-note">
            Bid to beat: {renderBid(currentBid.bid)} · {currentBid.points}
          </p>
        )}
        {history}
      </div>
    );
  }

  const commit = () => {
    if (!selected) return;
    onPlaceBid({ bid: selected.bid, points: selected.points });
    setSelected(null);
  };

  return (
    <div className="bid-panel">
      <div className="bid-head">
        <div>
          <p className="panel-heading">Your bid</p>
          <p className="bid-selected serif">
            {selected ? renderBid(selected.bid) : "—"}
          </p>
          <p className="bid-selected-pts">
            {selected ? `${selected.points} points` : "Pick a contract"}
          </p>
        </div>
        <div className="bid-to-beat">
          <p className="panel-heading">Bid to beat</p>
          <p className="bid-to-beat-value">
            {currentBid ? (
              <>
                {renderBid(currentBid.bid)} · {currentBid.points}
              </>
            ) : (
              "Open"
            )}
          </p>
        </div>
      </div>

      <div className="bid-grid">
        {LEVELS.map((level) =>
          SUITS.map((suit) => {
            const points = pointsFor(level, suit);
            const bid = `${level} ${suit}`;
            const disabled = points <= floor;
            const isSelected = selected?.bid === bid;
            return (
              <button
                key={bid}
                type="button"
                className={`bid-cell${isSelected ? " selected" : ""}`}
                disabled={disabled}
                onClick={() => setSelected({ bid, points })}
                aria-label={`${level} ${suit === "NT" ? "no trumps" : suit}, ${points} points`}
                aria-pressed={isSelected}
              >
                <span className="bid-cell-label">
                  <span className="bid-cell-level">{level}</span>
                  <span
                    className={`bid-cell-suit${
                      suit === "NT" ? " nt" : ""
                    }${isRed(suit) ? " red-suit" : ""}`}
                  >
                    {suit}
                  </span>
                </span>
                <span className="bid-cell-pts">{points}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="bid-misere-row">
        {MISERE.map((m) => {
          const disabled = m.points <= floor;
          const isSelected = selected?.bid === m.bid;
          return (
            <button
              key={m.bid}
              type="button"
              className={`bid-misere${isSelected ? " selected" : ""}`}
              disabled={disabled}
              onClick={() => setSelected({ bid: m.bid, points: m.points })}
              aria-label={`${m.label}, ${m.note}, ${m.points} points`}
              aria-pressed={isSelected}
            >
              <span>
                <span className="bid-misere-label">{m.label}</span>
                <span className="bid-misere-note">{m.note}</span>
              </span>
              <span className="bid-misere-pts serif">{m.points}</span>
            </button>
          );
        })}
      </div>

      <div className="bid-score-strip">
        <span>
          You <b className="serif">{playerScore}</b>
        </span>
        <span className="overline">First to 500</span>
        <span>
          <b className="serif">{opponentScore}</b> {opponentName}
        </span>
      </div>

      <div className="bid-actions">
        <button className="btn-primary bid-commit" onClick={commit} disabled={!selected}>
          {selected ? <>Bid {renderBid(selected.bid)}</> : "Bid"}
        </button>
        <button
          className="btn-ghost bid-pass"
          onClick={() => onPlaceBid({ bid: "Pass", points: 0 })}
        >
          Pass
        </button>
      </div>

      {/* House rules that predate the redesign and have no slot in the mockup:
          before anyone has bid you can offer a mutual pass, and once bidding is
          under way you can ask to take it back. Both need the other player to
          agree, so they read as offers rather than actions. */}
      {biddingHistory.length === 0 && gameSettings?.showOfferPassButton && (
        <button
          className="bid-offer"
          onClick={onOfferPass}
          disabled={offerPassDeclined || waitingForOfferResponse}
        >
          Offer a pass
        </button>
      )}
      {biddingHistory.length > 0 && gameSettings?.showOfferRetroactivePassButton && (
        <button
          className="bid-offer"
          onClick={onOfferRetroactivePass}
          disabled={offerRetroactivePassDeclined || waitingForOfferResponse}
        >
          Offer a retroactive pass
        </button>
      )}
      {waitingForOfferResponse && (
        <p className="side-note">Waiting for a response to your offer…</p>
      )}

      {history}
    </div>
  );
}

export default BiddingInterface;
