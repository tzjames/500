import React from "react";
import Card from "./Card";
import PlayerHand from "./PlayerHand";
import TrickPile from "./TrickPile";
import { getDeck } from "../theme";
import { cardColor, groupHandBySuit } from "../cards";
import "./GameTable4.css";

// The four-player board. You always sit south, and the rest of the table is
// placed relative to you: play runs clockwise, which on a table drawn from
// above means south → west → north → east, so the player after you is on your
// left and your partner is opposite.
//
//              north = your partner
//   west  ...      the trick      ...  east
//              south = you
//
// Every seat has its own pile of won tricks, sitting beside that seat's cards.
const POSITIONS = ["bottom", "left", "top", "right"];

function GameTable4({
  seats,
  mySeat,
  hand,
  playable,
  onPlayCard,
  currentSeat,
  trumpSuit,
  deckId,
  playedCards,
  flyToSeat,
  revealedHands = {},
  statusText,
  isYourTurn = false,
  deal = null,
}) {
  const deck = getDeck(deckId);
  const reference = mySeat === -1 ? 0 : mySeat;
  const positionOf = (seat) => POSITIONS[(seat - reference + 4) % 4];
  const seatAt = (position) => seats.find((s) => positionOf(s.seat) === position);

  const me = seatAt("bottom");
  const winnerPosition = flyToSeat === null || flyToSeat === undefined ? null : positionOf(flyToSeat);

  const renderSeat = (position) => {
    const seat = seatAt(position);
    if (!seat) return null;
    const revealed = revealedHands[seat.seat];
    const onCall = seat.seat === currentSeat;

    return (
      <div
        className={`seat4 seat4-${position}${revealed ? " seat4-revealed" : ""}${
          onCall ? " seat4-active" : ""
        }`}
      >
        <div className="seat4-id">
          <span className="seat4-avatar">{(seat.name || "?").charAt(0).toUpperCase()}</span>
          <span className="seat4-name">
            {seat.name}
            {seat.isDealer && <span className="seat4-tag">deals</span>}
            {seat.folded && <span className="seat4-tag">folded</span>}
          </span>
        </div>
        {seat.folded ? (
          <p className="seat4-folded">Sitting this hand out</p>
        ) : revealed ? (
          <RevealedHand hand={revealed} deck={deck} />
        ) : (
          <Fan count={seat.handCount} position={position} deck={deck} />
        )}
        <TrickPile className="pile4-seated" count={seat.tricksWon} owner={seat.name} />
      </div>
    );
  };

  return (
    <div className="table4">
      {renderSeat("left")}
      {renderSeat("top")}
      {renderSeat("right")}

      <div className="trick4-well">
        {playedCards.map((play, index) => (
          <div
            key={`${play.seat}-${play.card.suit}-${play.card.value}-${index}`}
            className={`played4 played4-${winnerPosition || positionOf(play.seat)}${
              winnerPosition ? " flying" : ""
            }`}
          >
            <Card
              card={play.card}
              deck={deck}
              trumpSuit={trumpSuit}
              width={88}
              disabled
              className={cardColor(play.card.suit)}
            />
            {play.nominatedSuit && (
              <span className="played4-nominated">called {play.nominatedSuit}</span>
            )}
          </div>
        ))}
      </div>

      {statusText && (
        <div className={`table4-status pill${isYourTurn ? " your-turn" : ""}`}>{statusText}</div>
      )}

      <TrickPile className="pile4-mine" count={me?.tricksWon || 0} owner="You" />

      <div className="seat4 seat4-bottom">
        <PlayerHand
          hand={hand}
          onPlayCard={(card) => onPlayCard(card)}
          trumpSuit={trumpSuit}
          isCurrentPlayer={isYourTurn}
          playable={playable}
          deckId={deckId}
          deal={deal}
        />
      </div>
    </div>
  );
}

// A held hand seen from the outside: card backs splayed from a pivot below the
// cards, so the fan widens at the top.
function Fan({ count, position, deck }) {
  const total = Math.max(0, count);
  return (
    <div className={`fan4 fan4-${position}`}>
      {Array.from({ length: total }).map((_, i) => {
        const offset = i - (total - 1) / 2;
        return <Card key={i} faceDown width={null} rotate={offset * 9} className="fan4-card" />;
      })}
    </div>
  );
}

// Open Misère: the bidder's hand is on the table for everyone else to read.
function RevealedHand({ hand, deck }) {
  return (
    <div className="revealed4">
      {groupHandBySuit(hand).map((row, rowIndex) => (
        <div key={rowIndex} className="revealed4-row">
          {row.map((card, cardIndex) => (
            <Card
              key={cardIndex}
              card={card}
              deck={deck}
              width={36}
              disabled
              className={cardColor(card.suit)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default GameTable4;
