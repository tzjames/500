import React from "react";
import Card from "./Card";
import { getDeck } from "../theme";
import { sortHand } from "../cards";
import { resolveRules } from "../heartsOptions";
import "./HeartsTable.css";

// The Hearts board, for anything from three seats to the eleven Cancellation
// Hearts will sit down. You are always at the bottom and everyone else is
// placed round an ellipse from there, the player after you first and so on
// clockwise — so the seat on your left is the one you are about to feed.
//
// A fixed table of positions is what the Euchre board uses, but it only ever
// has to place four; here the count is a variable, so the geometry is worked
// out rather than looked up.
const RX = 43;
const RY = 39;

// Clockwise from your own seat at the bottom, in radians from the top.
const angleOf = (offset, seats) => ((180 + (offset * 360) / seats) % 360) * (Math.PI / 180);

const pointOf = (offset, seats, rx = RX, ry = RY) => {
  const a = angleOf(offset, seats);
  return { x: 50 + rx * Math.sin(a), y: 50 - ry * Math.cos(a), a };
};

export const cardKey = (card) => `${card.suit}:${card.value}`;

function HeartsTable({
  state,
  deckId,
  onCard,
  selected = [],
  statusText,
  pendingTrick,
  flyToSeat,
  lastTrick,
}) {
  const game = state.game;
  const deck = getDeck(deckId);
  const seats = state.mode;
  const mySeat = state.you.seat < 0 ? 0 : state.you.seat;
  const offsetOf = (seat) => (seat - mySeat + seats) % seats;

  const legal = new Set((game.legalCards || []).map(cardKey));
  const chosen = new Set(selected.map(cardKey));
  const passing = state.phase === "passing" && !game.passedCards;
  const hand = sortHand(game.hand || [], null);
  // A finished trick is held here by the page for a beat after the server has
  // cleared it, then flown out to whoever won it.
  const trick = pendingTrick ? pendingTrick.cards : game.currentTrick;
  const flying = flyToSeat === null || flyToSeat === undefined ? null : pointOf(offsetOf(flyToSeat), seats);
  const cancelled = new Set((pendingTrick?.cancelled || []).map(cardKey));

  return (
    <div className="he-table" style={{ "--seats": seats }}>
      {game.players.map((player) => (
        <Seat
          key={player.seat}
          player={player}
          offset={offsetOf(player.seat)}
          seats={seats}
          state={state}
          deck={deck}
        />
      ))}

      <Middle game={game} phase={state.phase} rules={resolveRules(state.options, state.variant)} />

      <div className="he-trick">
        {trick.map(({ seat, card }) => {
          const at = flying || pointOf(offsetOf(seat), seats);
          return (
            <div
              key={`${seat}-${cardKey(card)}`}
              className={`he-played${flying ? " flying" : ""}${cancelled.has(cardKey(card)) ? " cancelled" : ""}`}
              // Every card takes the winner's place once it is flying, so the
              // trick gathers to that seat's edge as it fades.
              style={{
                "--tx": `${Math.round(Math.sin(at.a) * 90)}%`,
                "--ty": `${Math.round(-Math.cos(at.a) * 62)}%`,
              }}
            >
              <Card card={card} deck={deck} width={null} />
            </div>
          );
        })}
      </div>

      {statusText && <p className="he-status">{statusText}</p>}

      {lastTrick}

      {/* The count drives how wide a card may be, so a seventeen-card
          three-handed hand still fits the width of the board. */}
      <div className="he-hand-wrap" style={{ "--hand-count": Math.max(hand.length, game.cardsPerPlayer) }}>
        <div className="he-hand">
          {hand.map((card, i) => {
            const playable = state.phase === "playing" && legal.has(cardKey(card));
            const active = playable || passing;
            const cost = game.penalties?.[game.hand.findIndex((c) => cardKey(c) === cardKey(card))] || 0;
            return (
              <Card
                key={`${cardKey(card)}-${i}`}
                card={card}
                deck={deck}
                width={null}
                selected={chosen.has(cardKey(card))}
                disabled={!active}
                // What this card would cost whoever ends up taking it. Worth
                // showing outright: half the rule sets here price the cards
                // differently, and nobody should have to remember which.
                badge={cost ? String(cost) : null}
                badgeTone={cost > 0 ? "cost" : "kitty"}
                onClick={active ? () => onCard(card) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// A watermark under the trick: what is left in a Domino stock, a Heartsette
// widow nobody has taken yet, and whether hearts have been broken — which is
// only worth saying at a table that plays that rule.
function Middle({ game, phase, rules }) {
  if (phase !== "playing") return null;
  const bits = [];
  if (game.stockSize) bits.push(`${game.stockSize} in the stock`);
  if (game.widowSize) bits.push(`${game.widowSize}-card widow`);
  if (game.penaltySuit) bits.push(`${game.penaltySuit} is the penalty suit`);
  if (rules.breakHearts) bits.push(game.heartsBroken ? "hearts broken" : "hearts not broken");
  if (!bits.length) return null;
  return <p className="he-middle">{bits.join(" · ")}</p>;
}

function Seat({ player, offset, seats, state, deck }) {
  const you = player.seat === state.you.seat;
  const game = state.game;
  const partner =
    game.partnerships && player.team !== null
      ? game.players.find((p) => p.team === player.team && p.seat !== player.seat)
      : null;
  const point = pointOf(offset, seats);
  const classes = [
    "he-seat",
    you ? "he-seat-you" : "",
    player.seat === game.currentSeat ? "on-turn" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Your own seat is only the name plate — your cards are the fan along the
  // bottom — so it goes in the corner beside them rather than on the ellipse.
  const style = you ? undefined : { left: `${point.x}%`, top: `${point.y}%` };

  return (
    <div className={classes} style={style}>
      <div className="he-seat-plate">
        <span className="he-seat-name">
          {you ? "You" : player.name}
          {player.seat === game.dealerSeat && <em title="Dealer">D</em>}
        </span>
        {/* The running score, and what this deal has cost them so far — the two
            numbers everybody at a Hearts table is actually watching. */}
        <b className="serif">{player.score}</b>
        <span className="he-seat-note">
          {state.phase === "passing"
            ? player.passedOn
              ? "has passed"
              : "choosing three"
            : `${player.taken} this hand · ${player.tricksWon} ${player.tricksWon === 1 ? "trick" : "tricks"}`}
          {partner && !you && ` · with ${partner.seat === state.you.seat ? "you" : partner.name}`}
        </span>
      </div>
      {!you && (
        <div className="he-fan">
          {Array.from({ length: Math.min(player.handSize, 8) }, (_, n) => (
            <Card key={n} deck={deck} width={null} faceDown />
          ))}
        </div>
      )}
    </div>
  );
}

export default HeartsTable;
