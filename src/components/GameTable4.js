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
// Won tricks are kept one pile per partnership, not one per player — see
// pileFor below.
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
  // Which seat holds the contract, and the two partnerships' names — both only
  // needed to place and label the trick piles.
  bidderSeat = null,
  teamNames = [],
  playedCards,
  flyToSeat,
  revealedHands = {},
  statusText,
  isYourTurn = false,
  deal = null,
  // A hand you've undertaken to bid blind on: dealt to you face down, and shown
  // that way until you either make the call or ask to see it.
  blindCount = 0,
  // The replay overlay, which has no side panels competing for the width.
  compact = false,
}) {
  const deck = getDeck(deckId);
  const reference = mySeat === -1 ? 0 : mySeat;
  const positionOf = (seat) => POSITIONS[(seat - reference + 4) % 4];
  const seatAt = (position) => seats.find((s) => positionOf(s.seat) === position);

  const me = seatAt("bottom");
  const winnerPosition = flyToSeat === null || flyToSeat === undefined ? null : positionOf(flyToSeat);

  // Partners keep their won tricks together in a single pile in front of one of
  // them, so there are two piles on the table rather than four. The bidding
  // side's sits in front of the bidder; the defenders' in front of the defender
  // on the bidder's left, who is next to play. Seats alternate between the two
  // teams, so the seat after the bidder always belongs to the other pair.
  //
  // That is also how the two-player table arranges it — opponentSide in
  // GameTable.js resolves to the seat immediately clockwise of the bidder
  // whichever side bid — so the two boards agree.
  //
  // Until the auction settles there's no bidder to anchor to and your own seat
  // stands in; both piles are empty placeholders at that point anyway.
  const pileAnchor =
    bidderSeat === null || bidderSeat === undefined ? reference : bidderSeat;
  const pileSeats = [pileAnchor, (pileAnchor + 1) % 4];
  const teamTricks = (team) =>
    seats.reduce((total, s) => (s.team === team ? total + (s.tricksWon || 0) : total), 0);
  // Named the way the contract panel names the two sides. The pill clips at
  // 15ch, which a partnership's full name — two names joined by an ampersand —
  // blows straight past; "Your side" also says more at a glance than half of
  // "Fermat & Boole" would. A spectator has no side, so they get the names.
  const myTeam = mySeat === -1 ? null : me?.team;
  const sideName = (team) =>
    myTeam === null || myTeam === undefined
      ? teamNames[team] || `Side ${team + 1}`
      : team === myTeam
      ? "Your side"
      : "Them";
  // The pile this seat carries, or null when their partner is holding it.
  const pileFor = (seat) =>
    pileSeats.includes(seat.seat)
      ? { count: teamTricks(seat.team), owner: sideName(seat.team) }
      : null;
  const myPile = me ? pileFor(me) : null;

  const renderSeat = (position) => {
    const seat = seatAt(position);
    if (!seat) return null;
    const revealed = revealedHands[seat.seat];
    const onCall = seat.seat === currentSeat;
    const seatPile = pileFor(seat);

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
        {seatPile && (
          <TrickPile
            className="pile4-seated"
            count={seatPile.count}
            owner={seatPile.owner}
          />
        )}
      </div>
    );
  };

  return (
    <div className={`table4${compact ? " compact" : ""}`}>
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

      {myPile && (
        <TrickPile className="pile4-mine" count={myPile.count} owner={myPile.owner} />
      )}

      <div className="seat4 seat4-bottom">
        {blindCount > 0 ? (
          <div className="g4-blind-hand" aria-label="Your hand, face down">
            {Array.from({ length: blindCount }).map((_, i) => (
              <Card key={i} faceDown width={null} />
            ))}
          </div>
        ) : (
          <PlayerHand
            hand={hand}
            onPlayCard={(card) => onPlayCard(card)}
            trumpSuit={trumpSuit}
            isCurrentPlayer={isYourTurn}
            playable={playable}
            deckId={deckId}
            deal={deal}
          />
        )}
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
