import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import ThemePicker from "../components/ThemePicker";
import EuchreTable from "../components/EuchreTable";
import EuchreLastTrick from "../components/EuchreLastTrick";
import EuchreReviewModal from "../components/EuchreReviewModal";
import Confetti from "../components/Confetti";
import EuchreHelp from "../components/EuchreHelp";
import EuchreRulesModal from "../components/EuchreRulesModal";
import HouseRules from "../components/HouseRules";
import { definitionsFor, getVariant, variantSummary } from "../euchreOptions";
import { resolveDeckId, resolveLocationId } from "../theme";
import "./EuchreRoomPage.css";

// A finished trick sits on the table for a beat, then flies to the winner.
const TRICK_LINGER_MS = 1500;
const TRICK_FLY_MS = 550;

const SUIT_CLASS = (suit) => (suit === "♥" || suit === "♦" ? "red-suit" : "");
const Suit = ({ suit }) => <span className={SUIT_CLASS(suit)}>{suit}</span>;

// One Euchre table. Everything on screen comes from a single euchre:state
// payload — including which actions this seat may take — so this page decides
// how to draw a position but never what the rules of it are.
function EuchreRoomPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [alone, setAlone] = useState(false);
  const [showRules, setShowRules] = useState(false);
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
    socket.on("euchre:state", setState);
    socket.on("euchre:error", ({ message }) => setError(message));
    socket.on("euchre:joinRejected", ({ message }) => setError(message));
    socket.on("euchre:trickResolved", (trick) => {
      const token = ++trickTokenRef.current;
      liveTokenRef.current = token;
      setPendingTrick(trick);
      setFlyToSeat(null);
      setTimeout(() => {
        if (liveTokenRef.current !== token) return;
        setFlyToSeat(trick.winnerSeat);
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
      socket.off("euchre:state", setState);
      socket.off("euchre:error");
      socket.off("euchre:joinRejected");
      socket.off("euchre:trickResolved");
    };
  }, [socket, session, id]);

  // A new hand is a fresh decision about going alone.
  useEffect(() => {
    setAlone(false);
  }, [state?.roundNumber]);

  if (!session) return null;
  if (!state) {
    return (
      <ThemedTable locationId="falls" deckId="classic" feltId="faded" plain>
        <div className="waiting-panel panel">
          <p>{error || "Taking your seat…"}</p>
          {error && (
            <Link className="btn-ghost" to="/euchre">
              Back to Euchre
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
  const names = [
    session?.user?.name,
    ...state.slots.filter(Boolean).map((slot) => slot.name),
  ];
  const deckId = resolveDeckId(theme.deck, names);
  const locationId = resolveLocationId(theme.location, names);
  const shell = { locationId, deckId, feltId: theme.felt };
  const spec = getVariant(state.variant);
  const game = state.game;

  const header = (
    <header className="eu-bar">
      <div>
        <p className="overline">Euchre</p>
        <h1 className="serif">{spec.label}</h1>
      </div>
      <div className="eu-bar-right">
        <ThemePicker
          locationId={locationId}
          deckId={deckId}
          feltId={theme.felt}
          playerNames={names}
          compact
          onChange={(next) => emit("euchre:setGameSettings", next)}
        />
        <Link className="btn-ghost" to="/euchre">
          Leave
        </Link>
      </div>
    </header>
  );

  if (!game) {
    const seated = state.slots.filter(Boolean).length;
    return (
      <ThemedTable {...shell} plain scrolling>
        <div className="euchre-room">
          {header}
          {error && <p className="auth-error">{error}</p>}
          <section className="waiting-panel panel eu-waiting">
            <h2 className="serif">Waiting for {state.mode - seated} more</h2>
            <p>{variantSummary(state.variant, state.options)}</p>
            <p>Send them this link:</p>
            <input
              className="share-link"
              readOnly
              value={window.location.href}
              onClick={(e) => e.target.select()}
            />
            <ul className="eu-seat-list">
              {state.slots.map((slot, seat) => (
                <li key={seat}>{slot ? slot.name : <i>open seat</i>}</li>
              ))}
            </ul>
            {state.isHost && (
              <>
                <button className="btn-primary eu-wide" onClick={() => emit("euchre:addBots")}>
                  Fill the empty seats with robots
                </button>
                <div className="eu-segments">
                  {["private", "public"].map((option) => (
                    <button
                      key={option}
                      className={`ng-segment${state.visibility === option ? " on" : ""}`}
                      onClick={() => emit("euchre:setVisibility", { visibility: option })}
                    >
                      {option === "private" ? "Private" : "Public"}
                    </button>
                  ))}
                </div>
                <label className="eu-check eu-wide-check">
                  <input
                    type="checkbox"
                    checked={state.friendly}
                    onChange={(e) => emit("euchre:setFriendly", { friendly: e.target.checked })}
                  />
                  Friendly game — nobody&apos;s rating moves
                </label>
              </>
            )}
            <div className="eu-help-buttons eu-waiting-help">
              <button className="btn-ghost eu-help-button" onClick={() => setShowHowTo(true)}>
                How to play
              </button>
              <button className="btn-ghost eu-help-button" onClick={() => setShowRules((open) => !open)}>
                {showRules ? "Hide house rules" : "House rules"}
              </button>
            </div>
            {showRules && (
              <div className="eu-rules-readout">
                <HouseRules options={state.options} onChange={() => {}} readOnly definitions={definitionsFor(state.variant)} />
              </div>
            )}
            {showHowTo && (
              <EuchreRulesModal
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

  return (
    <ThemedTable {...shell} scrolling={false}>
      <div className="euchre-room euchre-room-live">
        {header}
        <div className="eu-state-row">
          <RoundBar state={state} />
          <EuchreHelp
            variant={state.variant}
            mode={state.mode}
            options={state.options}
            trumpSuit={game.trumpSuit}
            noTrump={game.noTrump}
            history={state.history}
            slots={state.slots}
            sides={sides}
            yourSeat={state.you.seat}
          />
        </div>
        {error && <p className="auth-error eu-error">{error}</p>}

        <EuchreTable
          state={state}
          deckId={deckId}
          onPlay={(card) => emit("euchre:play", { card })}
          onDiscard={(card) => emit("euchre:discard", { card })}
          statusText={statusText(state, yourTurn, waitingFor)}
          pendingTrick={pendingTrick}
          flyToSeat={flyToSeat}
          lastTrick={
            <EuchreLastTrick
              lastTrick={state.lastTrick}
              players={game.players}
              mySeat={state.you.seat}
              deckId={deckId}
              trumpSuit={game.trumpSuit}
            />
          }
        />

        <ActionPanel state={state} emit={emit} alone={alone} setAlone={setAlone} />

        {state.replaying && (
          <div className="eu-replay-bar">
            <span>Replaying the hand — nothing counts.</span>
            <button className="btn-ghost" onClick={() => emit("euchre:endReplay")}>
              Stop the replay
            </button>
          </div>
        )}

        {state.review && (
          <EuchreReviewModal
            review={state.review}
            deckId={deckId}
            mySeat={state.you.seat}
            slots={state.slots}
            onStep={(step) => emit("euchre:reviewStep", { step })}
            onDone={() => emit("euchre:reviewDone")}
          />
        )}

        {!state.review && !state.replaying && state.phase === "roundEnd" && (
          <RoundEnd
            state={state}
            sides={sides}
            onNext={() => emit("euchre:next")}
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
// rule set — a target to reach or a score to run down, and the contract in play.
function RoundBar({ state }) {
  const game = state.game;
  const contract = () => {
    if (!game.trumpSuit && !game.noTrump) return "trump not made yet";
    const called = game.bidState?.highBid ? `${game.bidState.highBid} tricks ` : "";
    const suit = game.noTrump ? (game.lowNoTrump ? "low no trump" : "no trump") : null;
    const maker = game.players[game.callerSeat];
    const who = maker ? `${maker.seat === state.you.seat ? "you" : maker.name}` : "";
    return (
      <>
        {called}
        {suit || <Suit suit={game.trumpSuit} />} · {who}
        {game.alone && " alone"}
        {game.blindLoner && ", blind"}
        {game.declaredMarch && ", declared"}
      </>
    );
  };

  // Who dealt earns its place here rather than only as a badge on the seat: it
  // is what you weigh when deciding whether to order up, since ordering up
  // hands the dealer the turned card.
  const dealer = game.players[game.dealerSeat];
  const dealt = dealer && (dealer.seat === state.you.seat ? "you dealt" : `${dealer.name} dealt`);

  return (
    <div className="eu-round-bar">
      <span>Hand {state.roundNumber}</span>
      {dealt && <span>{dealt}</span>}
      <span>{game.countdown ? "first to nothing wins" : `game is ${game.target}`}</span>
      <span className="eu-contract">{contract()}</span>
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
  if (state.phase === "calling") {
    return game.stuck
      ? `${waitingFor} is stuck with it`
      : game.callRound === 1
      ? "Order it up, or pass"
      : "Name a suit, or pass";
  }
  if (state.phase === "discard") return "The dealer is discarding";
  if (state.phase === "bidding") return "Bidding";
  if (state.phase === "chooseTrump") return "The high bidder is naming trump";
  if (state.phase === "declaring") return "Waiting on declarations";
  return null;
}

// Whatever this seat is being asked for. The server tells the page which
// actions are legal, so each block here is only about how to offer it.
function ActionPanel({ state, emit, alone, setAlone }) {
  const game = state.game;
  const mine = game.currentSeat === state.you.seat;

  if (state.phase === "blind" && game.handHidden) {
    return (
      <Panel title="A jack is turned. You may stake a lone hand before you look.">
        <button className="btn-primary" onClick={() => emit("euchre:blind", { blind: true })}>
          Blind lone hand in <Suit suit={game.upcard.suit} />
        </button>
        <button className="btn-ghost" onClick={() => emit("euchre:blind", { blind: false })}>
          Look at my cards
        </button>
      </Panel>
    );
  }

  if (state.phase === "calling" && game.relief) {
    return (
      <Panel
        title={
          game.relief === "farmer"
            ? "Nothing but nines and tens — declare a farmer's hand?"
            : "An ace and no picture card — declare it?"
        }
      >
        <button className="btn-primary" onClick={() => emit("euchre:relief", { action: "under" })}>
          Go under (swap three with the kitty)
        </button>
        <button className="btn-ghost" onClick={() => emit("euchre:relief", { action: "redeal" })}>
          Throw the hand in
        </button>
      </Panel>
    );
  }

  if (state.phase === "calling" && mine) {
    const ordering = game.callRound === 1 && game.upcard && !game.upcard.ordered;
    return (
      <Panel title={ordering ? "Order up the turned suit, or pass" : "Name a trump suit, or pass"}>
        <div className="eu-suit-row">
          {game.callableSuits.map((suit) => (
            <button key={suit} className="btn-primary" onClick={() => emit("euchre:call", { suit, alone })}>
              {ordering ? "Order up " : "Call "}
              <Suit suit={suit} />
            </button>
          ))}
        </div>
        {game.aloneRule === "may" && (
          <label className="eu-check">
            <input type="checkbox" checked={alone} onChange={(e) => setAlone(e.target.checked)} /> Go alone
          </label>
        )}
        {game.aloneRule === "forced" && <p className="ng-note">Taking this deal means playing it alone.</p>}
        {!game.stuck && (
          <button className="btn-ghost" onClick={() => emit("euchre:pass")}>
            Pass
          </button>
        )}
      </Panel>
    );
  }

  if (state.phase === "discard" && game.dealerSeat === state.you.seat) {
    return <Panel title="You have taken the turned card up — choose one to discard." />;
  }

  if (state.phase === "bidding" && game.bidState?.currentSeat === state.you.seat) {
    const standing = game.bidState.highBid || 0;
    return (
      <Panel title={standing ? `Bid above ${standing}, or pass` : "Bid the tricks you will take, or pass"}>
        <div className="eu-suit-row">
          {Array.from({ length: game.maxBid }, (_, i) => i + 1)
            .filter((amount) => amount > standing)
            .map((amount) => (
              <button key={amount} className="btn-ghost eu-num" onClick={() => emit("euchre:bid", { amount })}>
                {amount}
              </button>
            ))}
          <button className="btn-ghost" onClick={() => emit("euchre:bid", { amount: 0 })}>
            Pass
          </button>
        </div>
      </Panel>
    );
  }

  if (state.phase === "chooseTrump" && game.bidState?.highBidder === state.you.seat) {
    return (
      <Panel title={`You bought it for ${game.bidState.highBid} — name the contract`}>
        <div className="eu-suit-row">
          {state.suits.map((suit) => (
            <button key={suit} className="btn-primary eu-num" onClick={() => emit("euchre:chooseTrump", { suit })}>
              <Suit suit={suit} />
            </button>
          ))}
          {state.options.noTrumpBids && (
            <>
              <button className="btn-ghost" onClick={() => emit("euchre:chooseTrump", { noTrump: true })}>
                No trump
              </button>
              <button
                className="btn-ghost"
                onClick={() => emit("euchre:chooseTrump", { noTrump: true, lowNoTrump: true })}
              >
                Low no trump
              </button>
            </>
          )}
        </div>
      </Panel>
    );
  }

  if (state.phase === "declaring" && game.declarations.length) {
    const labels = {
      defendAlone: "Defend alone",
      declare: "Declare for every trick",
      fold: "Throw the hand in",
    };
    return (
      <Panel title="Before the first card is led">
        <div className="eu-suit-row">
          {game.declarations.map((action) => (
            <button key={action} className="btn-ghost" onClick={() => emit("euchre:declare", { action })}>
              {labels[action]}
            </button>
          ))}
          <button className="btn-primary" onClick={() => emit("euchre:declare", { action: "stay" })}>
            Play on
          </button>
        </div>
      </Panel>
    );
  }

  return null;
}

function Panel({ title, children }) {
  return (
    <section className="eu-action">
      {title && <p className="eu-action-title">{title}</p>}
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
        <div className="eu-after-hand">
          <p className="ng-note">
            {proposal.fromName} would like to {what}.
          </p>
          <button className="btn-primary" onClick={() => emit("euchre:respondToProposal", { accept: true })}>
            Go on then
          </button>
          <button className="btn-ghost" onClick={() => emit("euchre:respondToProposal", { accept: false })}>
            Get on with it
          </button>
        </div>
      );
    }
    return (
      <p className="ng-note eu-after-hand">
        {proposal.mine ? "Waiting for the table to agree…" : `${proposal.fromName} would like to ${what}.`}
      </p>
    );
  }
  return (
    <div className="eu-after-hand">
      <button className="btn-ghost" onClick={() => emit("euchre:propose", { type: "review" })}>
        Review the hand
      </button>
      <button className="btn-ghost" onClick={() => emit("euchre:propose", { type: "replay" })}>
        Replay it
      </button>
    </div>
  );
}

function RoundEnd({ state, sides, onNext, emit, userId }) {
  const result = state.lastResult;
  const game = state.game;
  const maker = game.players[result.callerSeat];
  const mine = maker?.seat === state.you.seat;
  const waiting = state.readyUserIds.includes(userId);
  return (
    <div className="eu-modal-wash">
      <section className="panel eu-result">
        <p className="overline">Hand {state.roundNumber}</p>
        <h2 className="serif">
          {result.made
            ? result.marched
              ? "A march"
              : "Made it"
            : "Euchred"}
        </h2>
        <p>
          {mine ? "You" : maker?.name} took {result.tricks} of the {result.needed} needed
          {result.alone && " playing alone"}.
        </p>
        <ul className="eu-result-scores">
          {sides.map((seats) => (
            <li key={seats.join("-")}>
              <span>{sideName(seats, state)}</span>
              <b>{result.scores[seats[0]]}</b>
              <em>{signed(result.delta[seats[0]])}</em>
            </li>
          ))}
        </ul>
        {state.replayResult && (
          <p className="eu-replay-result">
            Replayed: {result.callerSeat === state.you.seat ? "you" : maker?.name} took{" "}
            {state.replayResult.tricks} that time
            {state.replayResult.made === result.made ? " — the same outcome" : ", and it would have gone the other way"}.
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

function GameOver({ state, sides, emit, userId }) {
  const won = state.winner?.playerIds?.includes(userId);
  return (
    <div className="eu-modal-wash">
      {won && <Confetti />}
      <section className="panel eu-result">
        <p className="overline">
          {state.roundNumber} {state.roundNumber === 1 ? "hand" : "hands"} · game over
        </p>
        <h2 className="serif">{won ? "You win" : `${state.winner?.name} wins`}</h2>
        <ul className="eu-result-scores">
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
            : "Your Euchre rating has been updated."}
        </p>
        <Link className="btn-primary" to="/euchre">
          Back to Euchre
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

export default EuchreRoomPage;
