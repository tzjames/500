import React from "react";
import "./BiddingInterface.css";

const biddingOptions = [
  { bid: "6 ♠", points: 40 },
  { bid: "6 ♣", points: 60 },
  { bid: "6 ♦", points: 80 },
  { bid: "6 ♥", points: 100 },
  { bid: "6 NT", points: 120 },
  { bid: "7 ♠", points: 140 },
  { bid: "7 ♣", points: 160 },
  { bid: "7 ♦", points: 180 },
  { bid: "7 ♥", points: 200 },
  { bid: "7 NT", points: 220 },
  { bid: "8 ♠", points: 240 },
  { bid: "8 ♣", points: 260 },
  { bid: "8 ♦", points: 280 },
  { bid: "8 ♥", points: 300 },
  { bid: "8 NT", points: 320 },
  { bid: "9 ♠", points: 340 },
  { bid: "9 ♣", points: 360 },
  { bid: "9 ♦", points: 380 },
  { bid: "9 ♥", points: 400 },
  { bid: "9 NT", points: 420 },
  { bid: "10 ♠", points: 440 },
  { bid: "10 ♣", points: 460 },
  { bid: "10 ♦", points: 480 },
  { bid: "10 ♥", points: 500 },
  { bid: "10 NT", points: 520 },
];

function BiddingInterface({
  currentBid,
  players,
  playerId,
  dealerId,
  currentBidder,
  onPlaceBid,
  biddingComplete,
  biddingHistory,
}) {
  const isCurrentBidder = playerId === currentBidder;

  const renderBidButton = (option) => {
    const [number, suit] = option.bid.split(" ");
    const isDisabled = currentBid && option.points <= currentBid.points;
    return (
      <button
        key={option.bid}
        onClick={() => onPlaceBid(option)}
        disabled={isDisabled || !isCurrentBidder}
      >
        {number}{" "}
        <span className={suit === "♦" || suit === "♥" ? "red-suit" : ""}>
          {suit}
        </span>
        <br />({option.points} pts)
      </button>
    );
  };

  const renderBidButtons = () => (
    <div className="bidding-options">
      {[6, 7, 8, 9, 10].map((number) => (
        <div key={number} className="bid-row">
          {["♠", "♣", "♦", "♥", "NT"].map((suit) => {
            const option = biddingOptions.find(
              (opt) => opt.bid === `${number} ${suit}`
            );
            return renderBidButton(option);
          })}
        </div>
      ))}
      <div className="special-bids">
        <button
          className="pass-button"
          onClick={() => onPlaceBid({ bid: "Pass", points: 0 })}
          disabled={!isCurrentBidder}
        >
          Pass
        </button>
        <button
          className="misere-button"
          onClick={() => onPlaceBid({ bid: "Misere", points: 250 })}
          disabled={
            !isCurrentBidder || (currentBid && currentBid.points >= 250)
          }
        >
          Misere
          <br />
          (250 pts)
        </button>
        <button
          className="open-misere-button"
          onClick={() => onPlaceBid({ bid: "Open Misere", points: 500 })}
          disabled={
            !isCurrentBidder || (currentBid && currentBid.points >= 500)
          }
        >
          Open Misere
          <br />
          (500 pts)
        </button>
      </div>
    </div>
  );

  const renderBidWithColoredSuit = (bid) => {
    if (bid === "Pass") return "Pass";
    const [number, suit] = bid.split(" ");
    return (
      <>
        {number}{" "}
        <span className={suit === "♦" || suit === "♥" ? "red-suit" : ""}>
          {suit}
        </span>
      </>
    );
  };

  if (biddingComplete) {
    if (currentBid) {
      const winningBidder = players.find((p) => p.id === currentBid.player);
      return (
        <div className="bidding-interface">
          <h2>Bidding Complete</h2>
          <p>
            Winning Bid:{" "}
            {winningBidder.id === playerId ? "You" : winningBidder.name} -{" "}
            {renderBidWithColoredSuit(currentBid.bid)} ({currentBid.points} pts)
          </p>
          <h3>Bidding History</h3>
          <ul className="bidding-history">
            {biddingHistory.map((bid, index) => (
              <li key={index}>
                {bid.player === playerId
                  ? "You"
                  : players.find((p) => p.id === bid.player).name}
                : {renderBidWithColoredSuit(bid.bid)}
                {bid.bid !== "Pass" && ` (${bid.points} pts)`}
              </li>
            ))}
          </ul>
        </div>
      );
    } else {
      return (
        <div className="bidding-interface">
          <h2>Bidding Complete</h2>
          <p>All players passed. The game will be restarted.</p>
          <h3>Bidding History</h3>
          <ul className="bidding-history">
            {biddingHistory.map((bid, index) => (
              <li key={index}>
                {bid.player === playerId
                  ? "You"
                  : players.find((p) => p.id === bid.player).name}
                : {renderBidWithColoredSuit(bid.bid)}
                {bid.bid !== "Pass" && ` (${bid.points} pts)`}
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }

  return (
    <div className="bidding-interface">
      <h2>Bidding</h2>
      {biddingHistory.length > 0 && (
        <div>
          <h3>Bidding History</h3>
          <ul className="bidding-history">
            {biddingHistory.map((bid, index) => (
              <li key={index}>
                {bid.player === playerId
                  ? "You"
                  : players.find((p) => p.id === bid.player).name}
                : {renderBidWithColoredSuit(bid.bid)}
                {bid.bid !== "Pass" && ` (${bid.points} pts)`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isCurrentBidder ? (
        <div>
          <p>It's your turn to bid or pass</p>
          {renderBidButtons()}
        </div>
      ) : (
        <p>
          Waiting for {players.find((p) => p.id === currentBidder).name} to bid
        </p>
      )}
    </div>
  );
}

export default BiddingInterface;
