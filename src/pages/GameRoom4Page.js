import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import ThemePicker from "../components/ThemePicker";
import GameTable4 from "../components/GameTable4";
import BiddingInterface4 from "../components/BiddingInterface4";
import ContractPanel4 from "../components/ContractPanel4";
import LastTrickPanel4 from "../components/LastTrickPanel4";
import RoundEnd4Modal from "../components/RoundEnd4Modal";
import ScoreHistoryModal from "../components/ScoreHistoryModal";
import AnimatedHand from "../components/AnimatedHand";
import Confetti from "../components/Confetti";
import HouseRules, { HouseRulesToggle } from "../components/HouseRules";
import { changedOptionLabels, bidLabel } from "../gameOptions";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";
import "../App.css";
import "./GameRoom4Page.css";

// The four-player room. The server sends a whole personalised snapshot after
// every change (`g4:state`), so this page renders from one object rather than
// stitching together patches. The only local state is the things that are about
// timing rather than truth: the deal, the beat a finished trick spends on the
// table, and what you've selected but not yet committed.
function GameRoom4Page() {
  const { id: gameId } = useParams();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  const [state, setState] = useState(null);
  const [rejected, setRejected] = useState(null);
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState("");
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selectedDiscards, setSelectedDiscards] = useState([]);
  const [pendingJokerLead, setPendingJokerLead] = useState(null);

  // A finished trick stays on the table for a beat, then flies out to whoever
  // won it. Held here because the server has already cleared the trick by the
  // time we hear about it — and tokenised, because a background tab can throttle
  // these timers enough for a second trick to resolve before the first one's
  // clear-up fires.
  const [pendingTrick, setPendingTrick] = useState(null);
  const [flyToSeat, setFlyToSeat] = useState(null);
  const trickTokenRef = useRef(0);
  const liveTokenRef = useRef(null);

  // The deal: `{ revealed }` while the cards fly in and turn over, null the rest
  // of the time. Keyed on the round and redeal count so a redeal re-runs it.
  const [deal, setDeal] = useState(null);
  const dealTimersRef = useRef([]);
  const dealKeyRef = useRef(null);

  useEffect(() => () => dealTimersRef.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!socket) return;

    const join = () => socket.emit("joinRoom", { gameId });
    if (socket.connected) join();
    socket.on("connect", join);

    socket.on("g4:state", setState);
    socket.on("g4:joinRejected", ({ message }) => setRejected(message));
    socket.on("joinRejected", ({ message }) => setRejected(message));
    socket.on("g4:invalidPlay", ({ message }) => setInvalid(message));
    socket.on("g4:notice", ({ text }) => setNotice(text));

    socket.on("g4:trickResolved", (trick) => {
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
        }, 600);
      }, 1900);
    });

    return () => {
      socket.emit("leaveRoom", { gameId });
      socket.off("connect", join);
      ["g4:state", "g4:joinRejected", "joinRejected", "g4:invalidPlay", "g4:notice", "g4:trickResolved"].forEach(
        (event) => socket.off(event)
      );
    };
  }, [socket, gameId]);

  // Run the deal animation whenever a fresh hand arrives. A redeal of the same
  // round counts as a fresh hand, hence both halves of the key.
  const dealKey = state?.seats ? `${state.roundNumber}-${state.redealCount}` : null;
  useEffect(() => {
    if (!state || state.phase !== "bidding" || !dealKey) return;
    if (dealKeyRef.current === dealKey) return;
    dealKeyRef.current = dealKey;
    setSelectedDiscards([]);
    setInvalid("");
    dealTimersRef.current.forEach(clearTimeout);
    // Skipped outright for reduced motion — suppressing just the animation
    // would leave the cards face down for a second doing nothing.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDeal(null);
      return;
    }
    const count = state.you?.hand?.length || 10;
    const flightEnds = Math.max(0, count - 1) * 60 + 420;
    setDeal({ revealed: false });
    dealTimersRef.current = [
      setTimeout(() => setDeal({ revealed: true }), flightEnds + 120),
      setTimeout(() => setDeal(null), flightEnds + 120 + (count - 1) * 35 + 480),
    ];
  }, [state, dealKey]);

  // ---- handlers ----

  const emit = (event, payload) => socket?.emit(event, payload || {});
  const handleSetGameSettings = (partial) =>
    emit("setGameSettings", { ...(state?.gameSettings || {}), ...partial });

  const playCard = (card) => {
    setInvalid("");
    if (
      state.currentTrick.length === 0 &&
      card.suit === "Joker" &&
      !state.trumpSuit
    ) {
      setPendingJokerLead(card);
      return;
    }
    emit("g4:play", { card });
  };

  const nominateSuit = (suit) => {
    emit("g4:play", { card: pendingJokerLead, nominatedSuit: suit });
    setPendingJokerLead(null);
  };

  const toggleDiscard = (index) =>
    setSelectedDiscards((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : prev.length < 3
        ? [...prev, index]
        : prev
    );

  const finishDiscard = () => {
    if (selectedDiscards.length !== 3) return;
    emit("g4:discard", {
      keep: state.you.hand.filter((_, index) => !selectedDiscards.includes(index)),
    });
    setSelectedDiscards([]);
  };

  const locationId = state?.gameSettings?.location || DEFAULT_LOCATION;
  const deckId = state?.gameSettings?.deck || DEFAULT_DECK;
  const feltId = state?.gameSettings?.felt || DEFAULT_FELT;

  if (!session) return null;

  if (rejected) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} plain>
        <div className="room-full">
          <p>{rejected}</p>
          <p>
            <Link to="/">Back to home</Link>
          </p>
        </div>
      </ThemedTable>
    );
  }

  if (!state) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} plain>
        <div className="waiting-panel">
          <p>Taking your seat…</p>
        </div>
      </ThemedTable>
    );
  }

  const topBar = (subtitle) => (
    <div className="table-topbar">
      <div>
        <h1 className="table-title">
          <Link to="/" className="table-home-link" title="Back to your games">
            500
          </Link>
        </h1>
        {subtitle && <p className="table-subtitle">{subtitle}</p>}
      </div>
      <ThemePicker
        locationId={locationId}
        deckId={deckId}
        feltId={feltId}
        onChange={handleSetGameSettings}
        compact
      />
    </div>
  );

  // ---- waiting for the table to fill ----

  if (state.phase === "waiting") {
    const seated = state.slots.filter(Boolean);
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId}>
        {topBar("Four players")}
        <div className="waiting-panel panel g4-waiting">
          <h2>Waiting for {4 - seated.length} more</h2>
          <p>Send them this link:</p>
          <input
            className="share-link"
            readOnly
            value={window.location.href}
            onClick={(e) => e.target.select()}
          />

          <ul className="g4-seat-list">
            {state.slots.map((slot, index) => (
              <li key={index} className={slot ? "taken" : "empty"}>
                {slot ? (
                  <>
                    <b>{slot.name}</b>
                    {slot.isBot && <span className="g4-tag">robot</span>}
                    {slot.userId === state.hostUserId && <span className="g4-tag">host</span>}
                    {!slot.isBot && !slot.connected && <span className="g4-tag">away</span>}
                  </>
                ) : (
                  <span className="g4-empty-seat">Empty seat</span>
                )}
              </li>
            ))}
          </ul>

          {state.isHost && (
            <>
              <button className="btn-primary g4-full-width" onClick={() => emit("g4:addBots")}>
                Fill the empty seats with robots
              </button>
              <div className="g4-visibility">
                <span className="overline">Who can join</span>
                <div className="g4-segments">
                  {["private", "public"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`g4-segment${state.visibility === option ? " on" : ""}`}
                      onClick={() => emit("g4:setVisibility", { visibility: option })}
                    >
                      {option === "private" ? "Private" : "Listed in the lobby"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="g4-rules">
                <HouseRulesToggle
                  options={state.options}
                  open={showRules}
                  onToggle={() => setShowRules((open) => !open)}
                />
                {showRules && (
                  <HouseRules
                    options={state.options}
                    onChange={(next) => emit("g4:setOptions", { options: next })}
                  />
                )}
              </div>
            </>
          )}
          {!state.isHost && <RulesSummary options={state.options} />}
        </div>
      </ThemedTable>
    );
  }

  // ---- picking partners ----

  if (state.phase === "seating") {
    const others = state.slots.filter((s) => s && s.userId !== state.hostUserId);
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId}>
        {topBar("Four players")}
        <div className="waiting-panel panel g4-waiting">
          <h2>Everyone&apos;s here</h2>
          {state.isHost ? (
            <>
              <p>Who&apos;s your partner? They&apos;ll sit opposite you.</p>
              <div className="g4-partner-choices">
                {others.map((slot) => (
                  <button
                    key={slot.userId}
                    className="btn-ghost"
                    onClick={() => emit("g4:choosePartner", { partnerUserId: slot.userId })}
                  >
                    {slot.name}
                    {slot.isBot && <span className="g4-tag">robot</span>}
                  </button>
                ))}
              </div>
              <button
                className="btn-primary g4-full-width"
                onClick={() => emit("g4:choosePartner", { random: true })}
              >
                Draw for partners instead
              </button>
            </>
          ) : (
            <p>
              Waiting for{" "}
              {state.slots.find((s) => s?.userId === state.hostUserId)?.name} to pick
              partners.
            </p>
          )}
          <RulesSummary options={state.options} />
        </div>
      </ThemedTable>
    );
  }

  // ---- the kitty ----

  const iAmBidder = state.currentBid?.seat === state.you.seat;
  if (state.phase === "kitty" && iAmBidder) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} dimmed>
        {topBar()}
        <div className="kitty-screen">
          <div>
            <h2 className="kitty-heading">
              You won the bid with {bidLabel(state.currentBid.bid, state.options)} for{" "}
              {state.currentBid.points}
            </h2>
            <p className="kitty-subheading">
              The kitty is yours — take these three, then throw any three back.
            </p>
          </div>
          <div className="kitty-hand-wrap">
            <AnimatedHand
              hand={state.you.hand}
              selectedCards={selectedDiscards}
              onCardClick={toggleDiscard}
              trumpSuit={state.trumpSuit}
              deckId={deckId}
            />
          </div>
          <div className="kitty-actions">
            <span className="pill">{selectedDiscards.length} of 3 chosen</span>
            <button
              className="btn-primary"
              onClick={finishDiscard}
              disabled={selectedDiscards.length !== 3}
            >
              Throw three &amp; play
            </button>
          </div>
        </div>
        {invalid && <div className="floating-message"><p className="invalid-play-message">{invalid}</p></div>}
      </ThemedTable>
    );
  }

  // ---- game over ----

  if (state.phase === "gameOver" && state.winner) {
    const iWon = state.winner.playerIds?.includes(playerId);
    const reasonText =
      state.winner.reason === "backDoor"
        ? "out the back door at −500"
        : state.winner.reason === "pointSpread"
        ? "on the point spread"
        : `with ${state.winner.score} points`;
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} dimmed>
        {iWon && <Confetti />}
        <div className="game-over-card">
          <p className="overline">Game over</p>
          <h1>{iWon ? "You win" : "Better luck next time"}</h1>
          <p className="game-over-subtext">
            {state.winner.name} {reasonText}
          </p>
          <ul className="game-over-scores">
            {[0, 1].map((team) => (
              <li key={team}>
                <span>{state.teamNames?.[team]}</span>
                <b>{state.teamScores?.[team]}</b>
              </li>
            ))}
          </ul>
          <div className="game-over-buttons">
            <button className="btn-ghost" onClick={() => setShowScoreHistory(true)}>
              Score history
            </button>
            <Link to="/" className="btn-ghost">
              Back to home
            </Link>
          </div>
        </div>
        {showScoreHistory && (
          <ScoreHistoryModal
            scoreHistory={state.scoreHistory}
            players={(state.teamNames || []).map((name) => ({ name }))}
            onClose={() => setShowScoreHistory(false)}
          />
        )}
      </ThemedTable>
    );
  }

  // ---- the board ----

  const onCall = state.seats?.find((s) => s.seat === state.currentSeat);
  const yourTurn = state.phase === "playing" && state.currentSeat === state.you.seat;
  const statusText = (() => {
    if (state.phase !== "playing") return null;
    const trumpNote = state.trumpSuit
      ? ` — ${state.trumpSuit} are trumps`
      : " — no trumps";
    return yourTurn ? `Your turn${trumpNote}` : `${onCall?.name}'s turn${trumpNote}`;
  })();

  const playedCards = pendingTrick
    ? pendingTrick.plays.map((play) => ({ seat: play.seat, card: play.card }))
    : state.currentTrick || [];

  return (
    <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId}>
      {topBar(state.teamNames ? `${state.teamNames[0]} vs ${state.teamNames[1]}` : null)}

      <div className="board-row">
        <ContractPanel4 state={state} onShowScoreHistory={() => setShowScoreHistory(true)} />

        <div className="board-center">
          <GameTable4
            seats={state.seats || []}
            mySeat={state.you.seat}
            hand={state.you.hand || []}
            playable={state.legalPlays}
            onPlayCard={playCard}
            currentSeat={state.currentSeat}
            trumpSuit={state.trumpSuit}
            deckId={deckId}
            playedCards={playedCards}
            flyToSeat={flyToSeat}
            revealedHands={state.revealedHands || {}}
            statusText={statusText}
            isYourTurn={yourTurn}
            deal={deal}
          />

          {state.phase === "bidding" && !deal && (
            <div className="centered-panel">
              <BiddingInterface4
                seats={state.seats || []}
                mySeat={state.you.seat}
                auction={state.auction}
                availableBids={state.availableBids}
                legalBids={state.legalBids}
                options={state.options}
                onPlaceBid={(bid) => emit("g4:bid", { bid })}
              />
            </div>
          )}

          {state.phase === "kitty" && !iAmBidder && (
            <div className="centered-panel">
              <div className="panel waiting-panel">
                <p>
                  Waiting for {state.seats?.find((s) => s.seat === state.currentBid?.seat)?.name}{" "}
                  to take the kitty and discard.
                </p>
              </div>
            </div>
          )}

          {(notice || invalid) && (
            <div className="floating-message">
              {notice && <p className="invalid-play-message">{notice}</p>}
              {invalid && <p className="invalid-play-message">{invalid}</p>}
            </div>
          )}
        </div>

        <LastTrickPanel4
          lastTrick={state.lastTrick}
          seats={state.seats || []}
          mySeat={state.you.seat}
          deckId={deckId}
        />
      </div>

      {pendingJokerLead && (
        <div className="offer-modal-overlay">
          <div className="offer-modal">
            <p>Nominate a suit for the Joker:</p>
            <div className="offer-modal-buttons">
              {["♠", "♣", "♥", "♦"].map((suit) => (
                <button key={suit} onClick={() => nominateSuit(suit)}>
                  {suit}
                </button>
              ))}
            </div>
            <div className="offer-modal-buttons" style={{ marginTop: 10 }}>
              <button onClick={() => setPendingJokerLead(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showScoreHistory && (
        <ScoreHistoryModal
          scoreHistory={state.scoreHistory}
          players={(state.teamNames || []).map((name) => ({ name }))}
          onClose={() => setShowScoreHistory(false)}
        />
      )}

      {state.phase === "roundEnd" && state.roundResult && (
        <RoundEnd4Modal
          result={state.roundResult}
          roundEnd={state.roundEnd}
          you={state.you}
          options={state.options}
          scoreHistory={state.scoreHistory}
          roundNumber={state.roundNumber}
          onReady={() => emit("g4:ready")}
        />
      )}
    </ThemedTable>
  );
}

function RulesSummary({ options }) {
  const rules = changedOptionLabels(options);
  return (
    <p className="side-note g4-rules-summary">
      {rules.length === 0 ? "Standard rules." : `House rules: ${rules.join(" · ")}`}
    </p>
  );
}

export default GameRoom4Page;
