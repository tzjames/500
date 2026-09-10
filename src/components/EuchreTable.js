import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { sortHand } from "../cards";
import "./EuchreTable.css";

// The Euchre board, for two, three or four seats. You always sit at the bottom
// and the rest of the table is placed relative to you, so at four the player
// after you is on your left and your partner is opposite.
//
//                north = your partner
//   west  ...       the trick       ...  east
//                  south = you
//
// A seat sitting out — a lone hand's partner, or somebody who folded — keeps
// its place but has its cards laid face down.
const POSITIONS = {
  2: ["bottom", "top"],
  3: ["bottom", "left", "right"],
  4: ["bottom", "left", "top", "right"],
};

function EuchreTable({ state, deckId, onPlay, onDiscard, statusText, pendingTrick, flyToSeat, lastTrick }) {
  const game = state.game;
  const deck = getDeck(deckId);
  const mode = state.mode;
  const mySeat = state.you.seat < 0 ? 0 : state.you.seat;
  const positionOf = (seat) => POSITIONS[mode][(seat - mySeat + mode) % mode];

  const legal = new Set((game.legalCards || []).map(cardKey));
  const discarding = state.phase === "discard" && game.dealerSeat === mySeat;
  const hand = sortHand(game.hand || [], game.trumpSuit);
  // A finished trick is held here by the page for a beat after the server has
  // cleared it, then flown out to whoever won it.
  const trick = pendingTrick ? pendingTrick.cards : game.currentTrick;
  const flyingTo = flyToSeat === null || flyToSeat === undefined ? null : positionOf(flyToSeat);

  return (
    <div className="eu-table">
      {game.players.map((player) => (
        <Seat
          key={player.seat}
          player={player}
          position={positionOf(player.seat)}
          state={state}
          deck={deck}
        />
      ))}

      <Turnup game={game} phase={state.phase} deck={deck} />

      <div className="eu-trick">
        {trick.map(({ seat, card }) => (
          <div
            key={`${seat}-${cardKey(card)}`}
            // Once it is flying, every card takes the winner's place, so the
            // trick gathers to that seat's edge as it fades.
            className={`eu-played eu-played-${flyingTo || positionOf(seat)}${flyingTo ? " flying" : ""}`}
          >
            <Card card={card} deck={deck} width={null} trumpSuit={game.trumpSuit} />
          </div>
        ))}
      </div>

      {statusText && <p className="eu-status">{statusText}</p>}

      {lastTrick}

      {/* The count drives how wide a card may be, so a ten-card Bid Euchre hand
          still fits the width of the board. */}
      <div className="eu-hand-wrap" style={{ "--hand-count": Math.max(hand.length, game.cardsPerPlayer) }}>
        <div className="eu-hand">
          {hand.map((card) => {
            const playable = state.phase === "playing" && legal.has(cardKey(card));
            const active = playable || discarding;
            return (
              <Card
                key={cardKey(card)}
                card={card}
                deck={deck}
                width={null}
                trumpSuit={game.trumpSuit}
                disabled={!active}
                onClick={active ? () => (playable ? onPlay(card) : onDiscard(card)) : undefined}
              />
            );
          })}
          {game.handHidden &&
            Array.from({ length: game.cardsPerPlayer }, (_, n) => (
              <Card key={n} deck={deck} width={null} faceDown />
            ))}
        </div>
      </div>
    </div>
  );
}

// The turned card, and the kitty it came off. Once trump is fixed in the first
// round of calling the dealer has taken it into hand, so it stops being shown.
function Turnup({ game, phase, deck }) {
  if (!game.upcard || game.upcard.ordered) return null;
  return (
    <div className="eu-turnup">
      <span className="overline">Turned up</span>
      <Card card={game.upcard} deck={deck} width={null} trumpSuit={phase === "playing" ? game.trumpSuit : null} />
    </div>
  );
}

function Seat({ player, position, state, deck }) {
  const you = player.seat === state.you.seat;
  const game = state.game;
  const partner =
    game.partnerships && player.team !== null
      ? game.players.find((p) => p.team === player.team && p.seat !== player.seat)
      : null;
  const classes = [
    "eu-seat",
    `eu-seat-${position}`,
    player.seat === game.currentSeat ? "on-turn" : "",
    player.out ? "sitting-out" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="eu-seat-plate">
        <span className="eu-seat-name">
          {you ? "You" : player.name}
          {player.seat === game.dealerSeat && <em title="Dealer">D</em>}
          {player.seat === game.callerSeat && <em className="maker" title="Made trump">M</em>}
        </span>
        <b className="serif">{player.score}</b>
        <span className="eu-seat-note">
          {player.folded
            ? "threw the hand in"
            : player.out
            ? "sitting out"
            : `${player.tricksWon} ${player.tricksWon === 1 ? "trick" : "tricks"}`}
          {partner && !you && ` · with ${partner.seat === state.you.seat ? "you" : partner.name}`}
        </span>
      </div>
      {!you && (
        <div className="eu-fan">
          {Array.from({ length: player.handSize }, (_, n) => (
            <Card key={n} deck={deck} width={null} faceDown />
          ))}
        </div>
      )}
    </div>
  );
}

export const cardKey = (card) => `${card.suit}:${card.value}`;

export default EuchreTable;
