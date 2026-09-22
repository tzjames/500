import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import ThemePicker from "../components/ThemePicker";
import HeartsTable, { cardKey } from "../components/HeartsTable";
import LastTrickStack from "../components/LastTrickStack";
import HeartsReviewModal from "../components/HeartsReviewModal";
import Confetti from "../components/Confetti";
import HeartsHelp from "../components/HeartsHelp";
import HeartsRulesModal from "../components/HeartsRulesModal";
import HouseRules from "../components/HouseRules";
import { definitionsFor, getVariant, variantSummary } from "../heartsOptions";
import { resolveDeckId, resolveLocationId } from "../theme";
import "./HeartsRoomPage.css";

// A finished trick sits on the table for a beat, then flies to the winner.
const TRICK_LINGER_MS = 1400;
const TRICK_FLY_MS = 550;

const SUIT_CLASS = (suit) => (suit === "♥" || suit === "♦" ? "red-suit" : "");
const Suit = ({ suit }) => <span className={SUIT_CLASS(suit)}>{suit}</span>;

const PASS_WORD = {
  left: "to your left",
  right: "to your right",
  across: "across the table",
};

// One Hearts table. Everything on screen comes from a single hearts:state
// payload — including which cards this seat may play — so this page decides how
// to draw a position but never what the rules of it are.
function HeartsRoomPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [showRules, setShowRules] = useState(false);
  // The three cards picked to pass, held here until they are sent: passing is
  // simultaneous, so nobody else's screen has anything to say about them.
  const [picked, setPicked] = useState([]);
  // The server clears the trick the moment it resolves, so the finished one is
  // held here to be shown and then flown out. Tokenised because a background
  // tab can throttle these timers enough for a second trick to resolve before
  // the first one's clear-up fires.
  const [pendingTrick, setPendingTrick] = useState(null);
  const [flyToSeat, setFlyToSeat] = useState(null);
  const trickTokenRef = useRef(0);
  const liveTokenRef = useRef(null);
  const [showHowTo, setShowHowTo] = useState(false);
  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  // Logging in happens on the chooser, which sends you back to the table.
  useEffect(() => {
    if (!session) navigate("/", { replace: true, state: { from: `/game/${id}` } });
  }, [session, navigate, id]);

  useEffect(() => {
    if (!socket || !session) return undefined;
    const join = () => socket.emit("joinRoom", { gameId: id });
    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("hearts:state", setState);
    socket.on("hearts:error", ({ message }) => setError(message));
    socket.on("hearts:joinRejected", ({ message }) => setError(message));
    socket.on("hearts:trickResolved", (trick) => {
      const token = ++trickTokenRef.current;
      liveTokenRef.current = token;
      setPendingTrick(trick);
      setFlyToSeat(null);
      setTimeout(() => {
        if (liveTokenRef.current !== token) return;
        // A cancelled-out trick nobody won stays put and rides on the next one,
        // so there is nowhere to fly it to.
        if (trick.winnerSeat !== null) setFlyToSeat(trick.winnerSeat);
        setTimeout(() => {
          if (liveTokenRef.current !== token) return;
          liveTokenRef.current = null;
          setPendingTrick(null);
          setFlyToSeat(null);
        }, TRICK_FLY_MS);
      }, TRICK_LINGER_MS);
    });
    return () => {
      liveTokenRef.current = null;
      socket.emit("leaveRoom");
      socket.off("connect", join);
      socket.off("hearts:state", setState);
      socket.off("hearts:error");
      socket.off("hearts:joinRejected");
      socket.off("hearts:trickResolved");
    };
  }, [socket, session, id]);

  // A new hand is a fresh three cards to choose.
  useEffect(() => {
    setPicked([]);
  }, [state?.roundNumber]);

  if (!session) return null;
  if (!state) {
    return (
      <ThemedTable locationId="falls" deckId="classic" feltId="faded" plain>
        <div className="waiting-panel panel">
          <p>{error || "Taking your seat…"}</p>
          {error && (
            <Link className="btn-ghost" to="/hearts">
              Back to Hearts
            </Link>
          )}
        </div>
      </ThemedTable>
    );
  }

  const emit = (event, payload) => {
    setError("");
    socket.emit(event, payload);
  };
  const theme = state.gameSettings || {};
  // You count as being in your own room, seated or not yet — see GameRoomPage.
  const names = [session?.user?.name, ...state.slots.filter(Boolean).map((slot) => slot.name)];
  const deckId = resolveDeckId(theme.deck, names);
  const locationId = resolveLocationId(theme.location, names);
  const shell = { locationId, deckId, feltId: theme.felt };
  const spec = getVariant(state.variant);
  const game = state.game;

  const header = (
    <header className="he-bar">
      <div>
        <p className="overline">Hearts</p>
        <h1 className="serif">{spec.label}</h1>
      </div>
      <div className="he-bar-right">
        <ThemePicker
          locationId={locationId}
          deckId={deckId}
          feltId={theme.felt}
          playerNames={names}
          compact
          onChange={(next) => emit("hearts:setGameSettings", next)}
        />
        <Link className="btn-ghost" to="/hearts">
          Leave
        </Link>
      </div>
    </header>
  );

  if (!game) {
    const seated = state.slots.filter(Boolean).length;
    return (
      <ThemedTable {...shell} plain scrolling>
        <div className="hearts-room">
          {header}
          {error && <p className="auth-error">{error}</p>}
          <section className="waiting-panel panel he-waiting">
            <h2 className="serif">Waiting for {state.mode - seated} more</h2>
            <p>{variantSummary(state.variant, state.options)}</p>
            <p>Send them this link:</p>
            <input
              className="share-link"
              readOnly
              value={window.location.href}
              onClick={(e) => e.target.select()}
            />
            <ul className="he-seat-list">
              {state.slots.map((slot, seat) => (
                <li key={seat}>{slot ? slot.name : <i>open seat</i>}</li>
              ))}
            </ul>
            {state.isHost && (
              <>
                <button className="btn-primary he-wide" onClick={() => emit("hearts:addBots")}>
                  Fill the empty seats with robots
                </button>
                <div className="he-segments">
                  {["private", "public"].map((option) => (
                    <button
                      key={option}
                      className={`ng-segment${state.visibility === option ? " on" : ""}`}
                      onClick={() => emit("hearts:setVisibility", { visibility: option })}
                    >
                      {option === "private" ? "Private" : "Public"}
                    </button>
                  ))}
                </div>
                <label className="he-check he-wide-check">
                  <input
                    type="checkbox"
                    checked={state.friendly}
                    onChange={(e) => emit("hearts:setFriendly", { friendly: e.target.checked })}
                  />
                  Friendly game — nobody&apos;s rating moves
                </label>
              </>
            )}
            <div className="help-bar-buttons he-waiting-help">
              <button className="btn-ghost help-bar-button" onClick={() => setShowHowTo(true)}>
                How to play
              </button>
              <button className="btn-ghost help-bar-button" onClick={() => setShowRules((open) => !open)}>
                {showRules ? "Hide house rules" : "House rules"}
              </button>
            </div>
            {showRules && (
              <div className="he-rules-readout">
                <HouseRules
                  options={state.options}
                  onChange={() => {}}
                  readOnly
                  definitions={definitionsFor(state.variant)}
                />
              </div>
            )}
            {showHowTo && (
              <HeartsRulesModal
                variant={state.variant}
                mode={state.mode}
                options={state.options}
                onClose={() => setShowHowTo(false)}
              />
            )}
          </section>
        </div>
      </ThemedTable>
    );
  }

  const yourTurn = game.currentSeat === state.you.seat;
  const waitingFor = game.players[game.currentSeat]?.name;
  // Partners keep one score between them, so anywhere a score is reported it is
  // reported per side rather than per seat.
  const sides = game.partnerships
    ? [0, 1].map((team) => game.players.filter((p) => p.team === team).map((p) => p.seat))
    : game.players.map((player) => [player.seat]);

  // Picking three to pass, or playing one. Both are a click on a card, so the
  // board hands them both here and this decides which it was.
  const onCard = (card) => {
    if (state.phase === "playing") return emit("hearts:play", { card });
    const key = cardKey(card);
    setPicked((current) =>
      current.some((c) => cardKey(c) === key)
        ? current.filter((c) => cardKey(c) !== key)
        : current.length >= 3
        ? current
        : [...current, card]
    );
  };

  return (
    <ThemedTable {...shell} scrolling={false}>
      <div className="hearts-room hearts-room-live">
        {header}
        <div className="he-state-row">
          <RoundBar state={state} />
          <HeartsHelp
            variant={state.variant}
            mode={state.mode}
            options={state.options}
            history={state.history}
            slots={state.slots}
            sides={sides}
            yourSeat={state.you.seat}
          />
        </div>
        {error && <p className="auth-error he-error">{error}</p>}

        <HeartsTable
          state={state}
          deckId={deckId}
          onCard={onCard}
          selected={picked}
          statusText={statusText(state, yourTurn, waitingFor)}
          pendingTrick={pendingTrick}
          flyToSeat={flyToSeat}
          lastTrick={
            <LastTrickStack
              lastTrick={state.lastTrick}
              players={game.players}
              mySeat={state.you.seat}
              deckId={deckId}
            />
          }
        />

        <ActionPanel state={state} emit={emit} picked={picked} setPicked={setPicked} />

        {state.replaying && (
          <div className="he-replay-bar">
            <span>Replaying the hand — nothing counts.</span>
            <button className="btn-ghost" onClick={() => emit("hearts:endReplay")}>
              Stop the replay
            </button>
          </div>
        )}

        {state.review && (
          <HeartsReviewModal
            review={state.review}
            variant={state.variant}
            options={state.options}
            deckId={deckId}
            mySeat={state.you.seat}
            slots={state.slots}
            onStep={(step) => emit("hearts:reviewStep", { step })}
            onDone={() => emit("hearts:reviewDone")}
          />
        )}

        {!state.review && !state.replaying && state.phase === "roundEnd" && (
          <RoundEnd
            state={state}
            sides={sides}
            onNext={() => emit("hearts:next")}
            emit={emit}
            userId={session.user.id}
          />
        )}
        {!state.review && !state.replaying && state.phase === "gameOver" && (
          <GameOver state={state} sides={sides} emit={emit} userId={session.user.id} />
        )}
      </div>
    </ThemedTable>
  );
}

// The line under the header: where the game stands, in a form that fits every
// rule set — the target, which way the cards went and who dealt.
function RoundBar({ state }) {
  const game = state.game;
  const dealer = game.players[game.dealerSeat];
  const dealt = dealer && (dealer.seat === state.you.seat ? "you dealt" : `${dealer.name} dealt`);
  const pass = PASS_WORD[game.passDirection];
  return (
    <div className="he-round-bar">
      <span>Hand {state.roundNumber}</span>
      {dealt && <span>{dealt}</span>}
      <span>game ends at {game.target}</span>
      <span className="he-contract">
        {game.penaltySuit ? (
          <>
            <Suit suit={game.penaltySuit} /> costs
          </>
        ) : pass ? (
          `passed ${pass}`
        ) : (
          "no passing"
        )}
      </span>
      <span>{state.friendly ? "Friendly" : "Rated"}</span>
    </div>
  );
}

function statusText(state, yourTurn, waitingFor) {
  const game = state.game;
  if (state.phase === "playing") {
    if (game.currentTrick.length === 0) return yourTurn ? "Your lead" : `${waitingFor} to lead`;
    return yourTurn ? "Your turn" : `Waiting for ${waitingFor}`;
  }
  if (state.phase === "passing") {
    const left = game.players.filter((p) => !p.passedOn).length;
    return game.passedCards ? `Waiting on ${left} more` : "Choose three to pass";
  }
  if (state.phase === "bidding") return "Bidding for the penalty suit";
  if (state.phase === "chooseSuit") return "The high bidder is naming the suit";
  return null;
}

// Whatever this seat is being asked for. The server tells the page which
// actions are legal, so each block here is only about how to offer it.
function ActionPanel({ state, emit, picked, setPicked }) {
  const game = state.game;

  if (state.phase === "passing") {
    if (game.passedCards) {
      return (
        <Panel title="Passed. Waiting for everybody else.">
          <p className="ng-note">
            You sent {game.passedCards.map((c) => `${c.value}${c.suit}`).join(", ")} to{" "}
            {game.players[game.passTo]?.name || "nobody"}.
          </p>
        </Panel>
      );
    }
    const to = game.players[game.passTo]?.name;
    return (
      <Panel
        title={`Choose three cards to pass ${
          PASS_WORD[game.passDirection] || "on"
        }${to ? ` — to ${to}` : ""}`}
      >
        <button
          className="btn-primary"
          disabled={picked.length !== 3}
          onClick={() => emit("hearts:pass", { cards: picked })}
        >
          {picked.length === 3 ? "Pass these three" : `Pick ${3 - picked.length} more`}
        </button>
        {picked.length > 0 && (
          <button className="btn-ghost" onClick={() => setPicked([])}>
            Start again
          </button>
        )}
      </Panel>
    );
  }

  if (state.phase === "bidding" && game.bidState?.currentSeat === state.you.seat) {
    const standing = game.bidState.highBid || 0;
    return (
      <Panel
        title={
          standing
            ? `Bid above ${standing} for the right to name the penalty suit, or pass`
            : "Bid for the right to name the penalty suit, or pass"
        }
      >
        <div className="he-suit-row">
          {[1, 2, 3, 4, 5, 6, 7, 8]
            .filter((amount) => amount > standing)
            .map((amount) => (
              <button key={amount} className="btn-ghost he-num" onClick={() => emit("hearts:bid", { amount })}>
                {amount}
              </button>
            ))}
          <button className="btn-ghost" onClick={() => emit("hearts:bid", { amount: 0 })}>
            Pass
          </button>
        </div>
        <p className="ng-note">Whatever you bid goes straight onto your own score.</p>
      </Panel>
    );
  }

  if (state.phase === "chooseSuit" && game.bidState?.highBidder === state.you.seat) {
    return (
      <Panel title={`You bought it for ${game.bidState.highBid} — name the suit nobody wants`}>
        <div className="he-suit-row">
          {state.suits.map((suit) => (
            <button
              key={suit}
              className="btn-primary he-num"
              onClick={() => emit("hearts:chooseSuit", { suit })}
            >
              <Suit suit={suit} />
            </button>
          ))}
        </div>
      </Panel>
    );
  }

  return null;
}

function Panel({ title, children }) {
  return (
    <section className="he-action">
      {title && <p className="he-action-title">{title}</p>}
      {children}
    </section>
  );
}

// Review and replay: offered from the round-end and game-over screens, and
// everyone still at the table has to agree before either starts.
function AfterHand({ state, emit }) {
  const proposal = state.proposal;
  if (proposal) {
    const what = proposal.type === "review" ? "review the hand" : "replay the hand";
    if (proposal.awaitingYou) {
      return (
        <div className="he-after-hand">
          <p className="ng-note">
            {proposal.fromName} would like to {what}.
          </p>
          <button className="btn-primary" onClick={() => emit("hearts:respondToProposal", { accept: true })}>
            Go on then
          </button>
          <button className="btn-ghost" onClick={() => emit("hearts:respondToProposal", { accept: false })}>
            Get on with it
          </button>
        </div>
      );
    }
    return (
      <p className="ng-note he-after-hand">
        {proposal.mine ? "Waiting for the table to agree…" : `${proposal.fromName} would like to ${what}.`}
      </p>
    );
  }
  return (
    <div className="he-after-hand">
      <button className="btn-ghost" onClick={() => emit("hearts:propose", { type: "review" })}>
        Review the hand
      </button>
      <button className="btn-ghost" onClick={() => emit("hearts:propose", { type: "replay" })}>
        Replay it
      </button>
    </div>
  );
}

function RoundEnd({ state, sides, onNext, emit, userId }) {
  const result = state.lastResult;
  const waiting = state.readyUserIds.includes(userId);
  const moon = result.moon;
  const mine = moon && moon.seats.includes(state.you.seat);
  return (
    <div className="he-modal-wash">
      <section className="panel he-result">
        <p className="overline">Hand {state.roundNumber}</p>
        <h2 className="serif">
          {moon ? (mine ? "You shot the moon" : `${sideName(moon.seats, state)} shot the moon`) : "Hand over"}
        </h2>
        <p>
          {moon
            ? `${moon.value} ${moon.mode === "subtract" ? "off their own score" : "on everybody else"}.`
            : lowestLine(result, sides, state)}
        </p>
        <ul className="he-result-scores">
          {sides.map((seats) => (
            <li key={seats.join("-")}>
              <span>{sideName(seats, state)}</span>
              <b>{result.scores[seats[0]]}</b>
              <em>{signed(result.delta[seats[0]])}</em>
            </li>
          ))}
        </ul>
        {state.replayResult && (
          <p className="he-replay-result">
            Replayed:{" "}
            {sides
              .map((seats) => `${sideName(seats, state)} ${state.replayResult.points[seats[0]]}`)
              .join(" · ")}
          </p>
        )}
        <button className="btn-primary" onClick={onNext} disabled={waiting}>
          {waiting ? "Waiting for the table…" : "Deal the next hand"}
        </button>
        <AfterHand state={state} emit={emit} />
      </section>
    </div>
  );
}

// Who got away with it, which is the bit worth saying out loud in a game where
// the lowest score wins.
function lowestLine(result, sides, state) {
  const clean = sides.filter((seats) => (result.points[seats[0]] || 0) === 0);
  if (clean.length === sides.length) return "Nobody took a thing.";
  if (clean.length) return `${clean.map((seats) => sideName(seats, state)).join(", ")} got away clean.`;
  return "Everybody took something.";
}

function GameOver({ state, sides, emit, userId }) {
  const won = state.winner?.playerIds?.includes(userId);
  return (
    <div className="he-modal-wash">
      {won && <Confetti />}
      <section className="panel he-result">
        <p className="overline">
          {state.roundNumber} {state.roundNumber === 1 ? "hand" : "hands"} · game over
        </p>
        <h2 className="serif">{won ? "You win" : `${state.winner?.name} wins`}</h2>
        <p>Lowest score takes it.</p>
        <ul className="he-result-scores">
          {sides.map((seats) => (
            <li key={seats.join("-")}>
              <span>{sideName(seats, state)}</span>
              <b>{state.game.players[seats[0]].score}</b>
              <em />
            </li>
          ))}
        </ul>
        <p>
          {state.friendly
            ? "A friendly game — nobody's rating moved."
            : "Your Hearts rating has been updated."}
        </p>
        <Link className="btn-primary" to="/hearts">
          Back to Hearts
        </Link>
        <AfterHand state={state} emit={emit} />
      </section>
    </div>
  );
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// "You & Dijkstra", or just a name where everyone plays for themselves.
export const sideName = (seats, state) =>
  seats
    .map((seat) => (seat === state.you.seat ? "You" : state.game.players[seat]?.name))
    .join(" & ");

export default HeartsRoomPage;
