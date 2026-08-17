import React from "react";
import Card from "./Card";
import PlayerHand from "./PlayerHand";
import DummyHand from "./DummyHand";
import TrickPile from "./TrickPile";
import { getDeck } from "../theme";
import { cardColor, groupHandBySuit } from "../cards";
import "./GameTable.css";

// The mockup seats four players around the felt; this game has two, each with a
// dummy hand, which is also four positions — so the seat geometry carries over
// unchanged and only the labels differ:
//
//        north = your dummy hand
//   west  ...  the trick  ...  east      <- opponent's hand and dummy
//        south = your own hand
//
// Which of west/east holds the opponent's *hand* (rather than their dummy)
// follows who won the bid, so the bidder's side of the table stays put across
// the round — and is chosen so that play runs clockwise, as 500 is dealt and
// played. See opponentSide below.
function GameTable({
  playedCards,
  opponentHandSize,
  opponentDummyHandSize,
  playerHand,
  playerDummyHand,
  onPlayCard,
  isCurrentPlayerHandTurn,
  isCurrentPlayerDummyTurn,
  trumpSuit,
  winningBidder,
  playerId,
  revealedBidderHand,
  revealedOpponentHand,
  revealedOpponentDummyHand,
  flyingWinner,
  deckId,
  opponentName = "Opponent",
  opponentId,
  playerTricksWon = 0,
  opponentTricksWon = 0,
  statusText,
  isYourTurn = false,
  exposed = {},
  onRetract,
  deal = null,
  compact = false,
}) {
  const deck = getDeck(deckId);

  // Your dummy is revealed once you've played your first hand card, and stays
  // revealed for the rest of the round. Derived from hand size (starts at 10
  // post-kitty) rather than local state, so it survives reconnects.
  const hasPlayedFirstCard = playerHand.length < 10;

  const playerWonBid = winningBidder === playerId;
  // The turn rotation is fixed by the server: bidder's hand, opponent's hand,
  // bidder's dummy, opponent's dummy (see setupSeats). Putting the opponent's
  // hand on *this* side is what makes that sequence run clockwise round the
  // table — south → west → north → east — rather than backwards. Mirror it and
  // the game plays anti-clockwise.
  const opponentSide = playerWonBid ? "left" : "right";

  // Each played card sits at the edge of the trick well nearest the hand it
  // came from, so it lands "in front of" whoever played it.
  const getPlayedCardPosition = (play) => {
    const isSelf = play.playerId === playerId;
    if (isSelf) return play.isDummy ? "top" : "bottom";
    if (play.isDummy) return opponentSide === "right" ? "left" : "right";
    return opponentSide;
  };

  // Once a trick is decided, every played card flies to the same anchor —
  // wherever the winner's own cards would sit — and fades out together.
  const winnerPosition = flyingWinner
    ? getPlayedCardPosition({
        playerId: flyingWinner.winnerId,
        isDummy: flyingWinner.winnerIsDummy,
      })
    : null;

  // A revealed opponent hand/dummy (Open Misère, or a declined "I've got the
  // rest" claim) replaces that side's face-down fan with face-up cards.
  const revealedHand = revealedBidderHand || revealedOpponentHand;

  // Opponent cards they played and took back. They're already public, so they
  // stay face up in their fan until played for real.
  const exposedFor = (isDummy) =>
    (opponentId && exposed[`${opponentId}|${isDummy ? "dummy" : "hand"}`]) || [];

  const renderSideSeat = (side) => {
    const holdsOpponentHand = side === opponentSide;
    const revealed = holdsOpponentHand ? revealedHand : revealedOpponentDummyHand;
    const count = holdsOpponentHand ? opponentHandSize : opponentDummyHandSize;
    const label = holdsOpponentHand ? opponentName : `${opponentName}'s dummy`;
    const shown = exposedFor(!holdsOpponentHand);

    return (
      <div className={`seat seat-${side}${revealed ? " seat-revealed" : ""}`}>
        <div className="seat-id">
          <span className="seat-avatar">{label.charAt(0).toUpperCase()}</span>
          <span className="seat-name">{label}</span>
        </div>
        {revealed ? (
          <RevealedHand hand={revealed} deck={deck} />
        ) : (
          <Fan count={count} side={side} exposed={shown} deck={deck} />
        )}
        {/* The opponent's won tricks sit in flow beneath their fan rather than
            floating at fixed coordinates — that's what kept it colliding with
            their name pill once the seat grew or the window changed shape. */}
        {holdsOpponentHand && (
          <TrickPile className="pile-seated" count={opponentTricksWon} owner={opponentName} />
        )}
      </div>
    );
  };

  return (
    <div className={`game-table${compact ? " compact" : ""}`}>
      <TrickPile className="pile-floating pile-mine" count={playerTricksWon} owner="You" />

      <div className="seat seat-north">
        <div className="seat-id">
          <span className="seat-avatar">D</span>
          <span className="seat-name">Your dummy</span>
        </div>
        {hasPlayedFirstCard ? (
          <DummyHand
            hand={playerDummyHand}
            onPlayCard={(card) => onPlayCard(card, true)}
            trumpSuit={trumpSuit}
            isCurrentPlayer={isCurrentPlayerDummyTurn}
            deckId={deckId}
          />
        ) : (
          <Fan count={10} side="north" deck={deck} />
        )}
      </div>

      {renderSideSeat("left")}
      {renderSideSeat("right")}

      <div className="trick-well">
        {playedCards.map((play, index) => {
          // Only your own most recent card can come back, and only while the
          // trick is still running — once it resolves the cards are flying out
          // and there's nothing to undo. The server re-checks all of this.
          const canRetract =
            Boolean(onRetract) &&
            !winnerPosition &&
            index === playedCards.length - 1 &&
            play.playerId === playerId;

          return (
            <div
              key={index}
              className={`played-card played-card-${
                winnerPosition || getPlayedCardPosition(play)
              } ${play.isDummy ? "from-dummy" : ""} ${winnerPosition ? "flying" : ""}${
                canRetract ? " retractable" : ""
              }`}
            >
              <Card
                card={play.card}
                deck={deck}
                trumpSuit={trumpSuit}
                width={88}
                onClick={canRetract ? onRetract : undefined}
                className={cardColor(play.card.suit)}
              />
              {canRetract && <span className="retract-hint">Click to take back</span>}
            </div>
          );
        })}
      </div>

      {statusText && (
        <div className={`table-status pill${isYourTurn ? " your-turn" : ""}`}>
          {statusText}
        </div>
      )}

      <div className="seat seat-south">
        <PlayerHand
          hand={playerHand}
          onPlayCard={(card) => onPlayCard(card, false)}
          trumpSuit={trumpSuit}
          isCurrentPlayer={isCurrentPlayerHandTurn}
          deckId={deckId}
          deal={deal}
        />
      </div>
    </div>
  );
}

// A held hand seen from the outside: card backs splayed from a pivot below the
// cards, so the fan widens at the top. Any cards in `exposed` — played and
// then taken back — are drawn face up at the end of the fan, since the holder
// has already shown them.
function Fan({ count, side, exposed = [], deck }) {
  const width = side === "north" ? 40 : 46;
  const total = Math.max(0, count);
  const shown = exposed.slice(0, total);
  const backs = Math.max(0, total - shown.length);

  return (
    <div className={`fan fan-${side}`}>
      {Array.from({ length: backs }).map((_, i) => {
        const offset = i - (total - 1) / 2;
        return (
          <Card key={`back-${i}`} faceDown width={width} rotate={offset * 9} className="fan-card" />
        );
      })}
      {shown.map((card, i) => {
        const offset = backs + i - (total - 1) / 2;
        return (
          <Card
            key={`shown-${card.suit}-${card.value}`}
            card={card}
            deck={deck}
            width={width}
            rotate={offset * 9}
            disabled
            className="fan-card fan-card-exposed"
          />
        );
      })}
    </div>
  );
}

// Open Misère, or a declined "I've got the rest" claim: the whole hand is
// exposed in plain suit order — there's no trump to rank it against.
function RevealedHand({ hand, deck }) {
  return (
    <div className="revealed-hand">
      {groupHandBySuit(hand).map((row, rowIndex) => (
        <div key={rowIndex} className="revealed-hand-row">
          {row.map((card, cardIndex) => (
            <Card
              key={cardIndex}
              card={card}
              deck={deck}
              width={38}
              disabled
              className={cardColor(card.suit)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default GameTable;
