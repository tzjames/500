import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import ThemePicker from "../components/ThemePicker";
import GameTable4 from "../components/GameTable4";
import BiddingInterface4 from "../components/BiddingInterface4";
import ContractPanel4 from "../components/ContractPanel4";
import LastTrickPanel4 from "../components/LastTrickPanel4";
import GameHelp from "../components/GameHelp";
import RoundEnd4Modal from "../components/RoundEnd4Modal";
import RoundReviewModal from "../components/RoundReviewModal";
import ScoreHistoryModal from "../components/ScoreHistoryModal";
import AnimatedHand from "../components/AnimatedHand";
import Confetti from "../components/Confetti";
import HouseRules, { HouseRulesToggle } from "../components/HouseRules";
import { changedOptionLabels, bidLabel } from "../gameOptions";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT, resolveDeckId } from "../theme";
import { playSound, preloadSounds } from "../sounds";
import "../App.css";
import "./GameRoom4Page.css";

const SUITS = ["♠", "♣", "♥", "♦"];

// The four-player room. The server sends a whole personalised snapshot after
// every change (`g4:state`), so this page renders from one object rather than
// stitching together patches. The only local state is the things that are about
// timing or intent rather than truth: the deal, the beat a finished trick spends
// on the table, and what you've picked up but not yet committed to.
// A finished trick sits on the table for a beat, then flies to the winner.
const TRICK_LINGER_MS = 1900;
const TRICK_FLY_MS = 600;

function GameRoom4Page() {
  const { id: gameId } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  const [state, setState] = useState(null);
  const [rejected, setRejected] = useState(null);
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState("");
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selected, setSelected] = useState([]);
  const [pendingJokerLead, setPendingJokerLead] = useState(null);
  const [replayResult, setReplayResult] = useState(null);
  const [rematchPairing, setRematchPairing] = useState("same");

  // A finished trick stays on the table for a beat, then flies out to whoever
  // won it. Held here because the server has already cleared the trick by the
  // time we hear about it — and tokenised, because a background tab can throttle
  // these timers enough for a second trick to resolve before the first one's
  // clear-up fires.
  const [pendingTrick, setPendingTrick] = useState(null);
  const [flyToSeat, setFlyToSeat] = useState(null);
  const trickTokenRef = useRef(0);
  const liveTokenRef = useRef(null);
  // A one-off line from the server ("Everyone passed — redealing.", "X had
  // the rest…") — true news the moment it arrives, stale a few seconds later.
  // Cleared by the next deal too, so a message about the auction that just
  // ended can't outlive it and read as news about the hand you're now bidding.
  const noticeTimerRef = useRef(null);
  // True while the hand-deciding trick is still playing out. This page renders
  // from one pushed state object, so the hold gates the end screens rather than
  // the state itself — the table stays up, showing the trick that decided it.
  const [endHeld, setEndHeld] = useState(false);
  const endHoldTimerRef = useRef(null);

  // The deal: `{ revealed }` while the cards fly in and turn over, null the rest
  // of the time. Keyed on the round and redeal count so a redeal re-runs it.
  const [deal, setDeal] = useState(null);
  const dealTimersRef = useRef([]);
  const dealKeyRef = useRef(null);

  // This page has no per-card broadcast to hang a sound on — it re-renders from
  // a whole pushed snapshot — so the card and result sounds are derived from
  // what changed between snapshots instead. Both refs hold "what we last made a
  // noise about", so a re-render with no real change stays quiet.
  const cardsPlayedRef = useRef(null);
  const soundedResultRef = useRef(null);
  const playTimersRef = useRef([]);

  useEffect(
    () => () => {
      dealTimersRef.current.forEach(clearTimeout);
      playTimersRef.current.forEach(clearTimeout);
    },
    []
  );

  useEffect(preloadSounds, []);

  useEffect(() => {
    if (!socket) return;

    const join = () => socket.emit("joinRoom", { gameId });
    if (socket.connected) join();
    socket.on("connect", join);

    socket.on("g4:state", (next) => {
      const ending = next.phase === "roundEnd" || next.phase === "gameOver";
      if (ending && liveTokenRef.current !== null) {
        clearTimeout(endHoldTimerRef.current);
        setEndHeld(true);
        endHoldTimerRef.current = setTimeout(
          () => setEndHeld(false),
          TRICK_LINGER_MS + TRICK_FLY_MS
        );
      } else if (!ending) {
        clearTimeout(endHoldTimerRef.current);
        setEndHeld(false);
      }
      setState(next);
    });
    socket.on("g4:joinRejected", ({ message }) => setRejected(message));
    socket.on("joinRejected", ({ message }) => setRejected(message));
    socket.on("g4:invalidPlay", ({ message }) => setInvalid(message));
    socket.on("g4:notice", ({ text }) => {
      clearTimeout(noticeTimerRef.current);
      setNotice(text);
      noticeTimerRef.current = setTimeout(() => setNotice(""), 5000);
    });
    socket.on("g4:replayResult", (result) => setReplayResult(result));
    socket.on("g4:rematchStarted", ({ gameId: next }) => navigate(`/game/${next}`));

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
        }, TRICK_FLY_MS);
      }, TRICK_LINGER_MS);
    });

    return () => {
      clearTimeout(endHoldTimerRef.current);
      socket.emit("leaveRoom", { gameId });
      socket.off("connect", join);
      clearTimeout(noticeTimerRef.current);
      [
        "g4:state",
        "g4:joinRejected",
        "joinRejected",
        "g4:invalidPlay",
        "g4:notice",
        "g4:trickResolved",
        "g4:replayResult",
        "g4:rematchStarted",
      ].forEach((event) => socket.off(event));
    };
  }, [socket, gameId, navigate]);

  // Run the deal animation whenever a fresh hand arrives. A redeal of the same
  // round counts as a fresh hand, hence both halves of the key.
  // The game id is part of the key because a rematch starts counting rounds
  // again from one, on the same mounted component — without it, round one of
  // the new match looks like one already dealt and is skipped.
  const dealKey = state?.seats
    ? `${gameId}-${state.roundNumber}-${state.redealCount}`
    : null;
  useEffect(() => {
    if (!state || state.phase !== "bidding" || !dealKey) return;
    if (dealKeyRef.current === dealKey) return;
    dealKeyRef.current = dealKey;
    playSound("shuffle");
    setSelected([]);
    setInvalid("");
    setReplayResult(null);
    dealTimersRef.current.forEach(clearTimeout);
    // Skipped outright for reduced motion, and for a hand you can't see — the
    // cards are face down either way, so there's nothing to reveal.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || state.you.blind) {
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

  // A card hitting the table. Counted as cards played in the whole hand rather
  // than the length of the live trick: two snapshots can arrive in one render,
  // and at a trick boundary the live trick then appears to *shrink* — 4 cards
  // to 2 — while two cards were in fact played. Watching the trick length
  // missed both of them. A hand's running total only ever climbs, so a rise of
  // n means n cards however the snapshots were batched.
  const tricksDone = (state?.seats || []).reduce((n, s) => n + (s.tricksWon || 0), 0);
  const cardsPlayed = tricksDone * 4 + (state?.currentTrick?.length ?? 0);
  useEffect(() => {
    const prev = cardsPlayedRef.current;
    cardsPlayedRef.current = cardsPlayed;
    // First look at a hand, or the count restarting for a new one.
    if (prev === null || cardsPlayed <= prev) return;
    const fresh = cardsPlayed - prev;
    // More than a trick's worth means we weren't watching — joining a hand in
    // progress, or a reconnect — and the backlog shouldn't be replayed.
    if (fresh > 4) return;
    // Staggered, so cards batched into one render still sound like two cards
    // rather than one louder one.
    for (let i = 0; i < fresh; i++) {
      const timer = setTimeout(() => playSound("play"), i * 80);
      playTimersRef.current.push(timer);
    }
  }, [cardsPlayed]);

  // How the hand went, from your side. Keyed on the round so re-renders and
  // reconnects — which re-deliver the same finished result — only sound once,
  // and held back until the deciding trick has finished playing out. Hands
  // where nobody bid have no outcome to report.
  //
  // As in the two-player room: the loss sting is for your own side's contract
  // going down, not for every hand that didn't go your way. The other team
  // making their bid passes without comment.
  const result = state?.roundResult;
  const showingResult =
    (state?.phase === "roundEnd" || state?.phase === "gameOver") && !endHeld;
  useEffect(() => {
    if (!showingResult || !result || result.noContract) return;
    const key = `${gameId}-${state.roundNumber}`;
    if (soundedResultRef.current === key) return;
    soundedResultRef.current = key;
    const myTeam = state.you?.team;
    if (myTeam === null || myTeam === undefined) return;
    const weBid = result.biddingTeam === myTeam;
    const wentOurWay = weBid ? result.made : !result.made;
    if (wentOurWay) playSound("won");
    else if (weBid) playSound("loss");
  }, [showingResult, result, gameId, state?.roundNumber, state?.you?.team]);

  // ---- handlers ----

  const emit = (event, payload) => socket?.emit(event, payload || {});
  const handleSetGameSettings = (partial) =>
    emit("setGameSettings", { ...(state?.gameSettings || {}), ...partial });

  const playCard = (card, mode) => {
    setInvalid("");
    const board = mode === "replay" ? state.replay : state;
    if (board.currentTrick.length === 0 && card.suit === "Joker" && !board.trumpSuit) {
      setPendingJokerLead({ card, mode });
      return;
    }
    emit("g4:play", { card, mode });
  };

  const nominateSuit = (suit) => {
    emit("g4:play", {
      card: pendingJokerLead.card,
      nominatedSuit: suit,
      mode: pendingJokerLead.mode,
    });
    setPendingJokerLead(null);
  };

  const toggleSelected = (index, cap) =>
    setSelected((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : prev.length < cap
        ? [...prev, index]
        : prev
    );

  const submitDiscard = (board, mode) => {
    if (selected.length !== 3) return;
    emit("g4:discard", { keep: board.you.hand.filter((_, i) => !selected.includes(i)), mode });
    setSelected([]);
  };

  const submitPass = (board, mode) => {
    if (selected.length !== 5) return;
    emit("g4:pass", { cards: board.you.hand.filter((_, i) => selected.includes(i)), mode });
    setSelected([]);
  };

  const locationId = state?.gameSettings?.location || DEFAULT_LOCATION;
  const feltId = state?.gameSettings?.felt || DEFAULT_FELT;
  const playerNames = (state?.seats || []).filter(Boolean).map((s) => s.name);
  const deckId = resolveDeckId(state?.gameSettings?.deck || DEFAULT_DECK, playerNames);

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
        playerNames={playerNames}
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

          <SeatList slots={state.slots} hostUserId={state.hostUserId} />

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
              <label className="ng-check">
                <input
                  type="checkbox"
                  checked={state.friendly}
                  disabled={state.friendlyForced}
                  onChange={(e) => emit("g4:setFriendly", { friendly: e.target.checked })}
                />
                <span>
                  <b>Friendly game</b>
                  <span className="ng-note">
                    {state.friendlyForced
                      ? "A robot's seated, which always makes it friendly — nobody's Elo moves."
                      : "Doesn't affect anyone's Elo rating, win or lose."}
                  </span>
                </span>
              </label>
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
          {!state.isHost && (
            <>
              {state.friendly && <p className="side-note">This is a friendly game — nobody's Elo moves.</p>}
              <RulesSummary options={state.options} />
            </>
          )}
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
              Waiting for {state.slots.find((s) => s?.userId === state.hostUserId)?.name} to
              pick partners.
            </p>
          )}
          {state.friendly && <p className="side-note">This is a friendly game — nobody's Elo moves.</p>}
          <RulesSummary options={state.options} />
        </div>
      </ThemedTable>
    );
  }

  // ---- game over ----

  if (state.phase === "gameOver" && state.winner && !endHeld) {
    const iWon = state.winner.playerIds?.includes(playerId);
    // Going out the back door is the LOSING side's fate, not the winner's — it
    // needs the other team's name (or, if you're the one who went out, your
    // partner's name and "you", rather than the bare team-name string, which
    // would otherwise repeat your own name back at you).
    const loserTeam = 1 - state.winner.team;
    const partner = state.seats?.find((s) => s.team === state.you?.team && s.userId !== playerId);
    const subtext =
      state.winner.reason === "backDoor"
        ? iWon
          ? `${state.teamNames?.[loserTeam]} went out the back door`
          : `${partner ? `${partner.name} and you` : "Your side"} went out the back door`
        : state.winner.reason === "pointSpread"
        ? `${state.winner.name} won on the point spread`
        : `${state.winner.name} won with ${state.winner.score} points`;
    const proposal = state.roundEnd?.proposal;

    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} dimmed>
        {iWon && <Confetti />}
        <div className="game-over-card">
          <p className="overline">Game over</p>
          <h1>{iWon ? "You win" : "Better luck next time"}</h1>
          <p className="game-over-subtext">{subtext}</p>
          {state.friendly && (
            <p className="friendly-pill game-over-friendly">Friendly — nobody's Elo moved</p>
          )}
          <ul className="game-over-scores">
            {[0, 1].map((team) => (
              <li key={team}>
                <span>{state.teamNames?.[team]}</span>
                <b>{state.teamScores?.[team]}</b>
              </li>
            ))}
          </ul>

          {state.rematch?.awaitingYou ? (
            <div className="round-end-proposal">
              <p>
                {state.rematch.fromName} wants a rematch —{" "}
                {state.rematch.pairing === "same"
                  ? "same partners"
                  : state.rematch.pairing === "swap"
                  ? "swapping partners"
                  : "drawing for partners"}
                . Are you in?
              </p>
              <div className="round-end-proposal-buttons">
                <button className="btn-primary" onClick={() => emit("g4:rematchRespond", { accept: true })}>
                  Yes
                </button>
                <button className="btn-ghost" onClick={() => emit("g4:rematchRespond", { accept: false })}>
                  No
                </button>
              </div>
            </div>
          ) : state.rematch?.mine ? (
            <p className="round-end-waiting">
              Waiting on {state.rematch.waitingOn}{" "}
              {state.rematch.waitingOn === 1 ? "player" : "players"} to agree to a rematch…
            </p>
          ) : proposal?.awaitingYou ? (
            <div className="round-end-proposal">
              <p>
                {proposal.fromName} wants to{" "}
                {proposal.type === "review" ? "review" : "replay"} the last hand. Do you agree?
              </p>
              <div className="round-end-proposal-buttons">
                <button className="btn-primary" onClick={() => emit("g4:respondToProposal", { accept: true })}>
                  Yes
                </button>
                <button className="btn-ghost" onClick={() => emit("g4:respondToProposal", { accept: false })}>
                  No
                </button>
              </div>
            </div>
          ) : proposal?.mine ? (
            <p className="round-end-waiting">Waiting for the others to agree to your invite…</p>
          ) : (
            <>
              <div className="g4-visibility g4-rematch-pairing">
                <span className="overline">Rematch partners</span>
                <div className="g4-segments">
                  {[
                    { id: "same", label: "Same" },
                    { id: "swap", label: "Swap" },
                    { id: "random", label: "Draw" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`g4-segment${rematchPairing === option.id ? " on" : ""}`}
                      onClick={() => setRematchPairing(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="game-over-buttons">
                <button
                  className="btn-primary"
                  onClick={() => emit("g4:rematchOffer", { pairing: rematchPairing })}
                >
                  Offer a rematch
                </button>
                <button className="btn-ghost" onClick={() => emit("g4:propose", { type: "review" })}>
                  Review last hand
                </button>
                <button className="btn-ghost" onClick={() => emit("g4:propose", { type: "replay" })}>
                  Replay last hand
                </button>
                <button className="btn-ghost" onClick={() => setShowScoreHistory(true)}>
                  Score history
                </button>
                <Link to="/" className="btn-ghost">
                  Back to home
                </Link>
              </div>
            </>
          )}
          {notice && <p className="g4-notice">{notice}</p>}
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

  // ---- the kitty and the exchange, whichever board they belong to ----

  const kittyScreen = (board, mode) => (
    <div className="kitty-screen">
      <div>
        <h2 className="kitty-heading">
          You won the bid with {bidLabel(board.currentBid.bid, state.options)} for{" "}
          {board.currentBid.points}
        </h2>
        <p className="kitty-subheading">
          The kitty is yours — take these three, then throw any three back.
        </p>
      </div>
      <div className="kitty-hand-wrap">
        <AnimatedHand
          hand={board.you.hand}
          selectedCards={selected}
          onCardClick={(index) => toggleSelected(index, 3)}
          trumpSuit={board.trumpSuit}
          deckId={deckId}
        />
      </div>
      <div className="kitty-actions">
        <span className="pill">{selected.length} of 3 chosen</span>
        <button
          className="btn-primary"
          onClick={() => submitDiscard(board, mode)}
          disabled={selected.length !== 3}
        >
          Throw three &amp; play
        </button>
      </div>
    </div>
  );

  const exchangeScreen = (board, mode) => (
    <div className="g4-exchange">
      <div>
        <h2 className="kitty-heading">Pass five across</h2>
        <p className="kitty-subheading">
          You and your partner both have to take no tricks at all, so you each send five
          cards over at the same time. Choose what you send — you can&apos;t choose what
          arrives.
        </p>
      </div>
      <div className="kitty-hand-wrap">
        <AnimatedHand
          hand={board.you.hand}
          selectedCards={selected}
          onCardClick={(index) => toggleSelected(index, 5)}
          trumpSuit={board.trumpSuit}
          deckId={deckId}
          selectedBadge="Pass"
        />
      </div>
      <div className="kitty-actions">
        <span className="pill">{selected.length} of 5 chosen</span>
        <button
          className="btn-primary"
          onClick={() => submitPass(board, mode)}
          disabled={selected.length !== 5}
        >
          Send them over
        </button>
      </div>
    </div>
  );

  const iAmBidder = state.currentBid?.seat === state.you.seat;
  const inExchange = (state.exchangeSeats || []).includes(state.you.seat);

  if (state.phase === "kitty" && iAmBidder) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} dimmed>
        {topBar()}
        {kittyScreen(state)}
        {invalid && (
          <div className="floating-message">
            <p className="invalid-play-message">{invalid}</p>
          </div>
        )}
      </ThemedTable>
    );
  }

  if (state.phase === "exchange" && inExchange && !state.you.passed) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId} dimmed>
        {topBar()}
        {exchangeScreen(state)}
        {invalid && (
          <div className="floating-message">
            <p className="invalid-play-message">{invalid}</p>
          </div>
        )}
      </ThemedTable>
    );
  }

  // ---- the board ----

  const board = (b, { mode, compact }) => {
    const yourTurn = b.phase === "playing" && b.currentSeat === b.you.seat;
    const onCall = b.seats?.find((s) => s.seat === b.currentSeat);
    const mine = pendingTrick && pendingTrick.mode === (mode === "replay" ? "replay" : "live");
    const cards = mine
      ? pendingTrick.plays.map((play) => ({ seat: play.seat, card: play.card }))
      : b.currentTrick || [];
    const trumpNote = b.trumpSuit ? ` — ${b.trumpSuit} are trumps` : " — no trumps";
    const statusText =
      b.phase !== "playing"
        ? null
        : yourTurn
        ? `Your turn${trumpNote}`
        : `${onCall?.name}'s turn${trumpNote}`;

    return (
      <GameTable4
        seats={b.seats || []}
        mySeat={b.you.seat}
        hand={b.you.hand || []}
        blindCount={b.you.blind ? b.you.handCount : 0}
        playable={b.legalPlays}
        onPlayCard={(card) => playCard(card, mode)}
        currentSeat={b.currentSeat}
        trumpSuit={b.trumpSuit}
        deckId={deckId}
        bidderSeat={b.currentBid?.seat ?? null}
        teamNames={state.teamNames || []}
        playedCards={cards}
        flyToSeat={mine ? flyToSeat : null}
        revealedHands={b.revealedHands || {}}
        statusText={statusText}
        isYourTurn={yourTurn}
        deal={mode === "replay" ? null : deal}
        compact={compact}
      />
    );
  };

  const claim = state.claim;

  return (
    <ThemedTable locationId={locationId} deckId={deckId} feltId={feltId}>
      {topBar(state.teamNames ? `${state.teamNames[0]} vs ${state.teamNames[1]}` : null)}

      <div className="board-row">
        <ContractPanel4
          state={state}
          onShowScoreHistory={() => setShowScoreHistory(true)}
          canClaimRest={state.canClaimRest}
          claimPending={Boolean(claim?.mine)}
          onClaimRest={() => emit("g4:claimRest")}
        />

        <div className="board-center">
          {board(state, {})}

          {state.phase === "bidding" && !deal && !state.you.blindPrompt && (
            <div className="centered-panel">
              {state.you.blind ? (
                <div className="panel waiting-panel">
                  <p>
                    Your cards are face down — you said you&apos;d bid blind. You&apos;ll be
                    asked when the auction reaches you.
                  </p>
                </div>
              ) : (
                <BiddingInterface4
                  seats={state.seats || []}
                  mySeat={state.you.seat}
                  auction={state.auction}
                  availableBids={state.availableBids}
                  legalBids={state.legalBids}
                  options={state.options}
                  onPlaceBid={(bid) => emit("g4:bid", { bid })}
                />
              )}
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

          {state.phase === "exchange" && (
            <div className="centered-panel">
              <div className="panel waiting-panel">
                <p>
                  {inExchange
                    ? "Waiting for your partner to choose their five."
                    : "The partners are passing five cards each across the table."}
                </p>
              </div>
            </div>
          )}

          {(notice || invalid) && (
            <div className="floating-message">
              {notice && <p className="g4-notice">{notice}</p>}
              {invalid && <p className="invalid-play-message">{invalid}</p>}
            </div>
          )}
        </div>

        <div className="side-column">
          <LastTrickPanel4
            lastTrick={state.lastTrick}
            seats={state.seats || []}
            mySeat={state.you.seat}
            deckId={deckId}
          />
          <GameHelp
            variant="four"
            trumpSuit={state.trumpSuit}
            bid={state.currentBid?.bid}
            options={state.options}
            deckId={deckId}
          />
        </div>
      </div>

      {/* Blind bidding: asked once, when the auction reaches you, before you've
          seen a card. Saying no turns the hand over. */}
      {state.you.blindPrompt && (
        <div className="offer-modal-overlay">
          <div className="offer-modal">
            <p>
              You said you&apos;d go blind. Do you still want to bid Blind{" "}
              {state.options.misereName === "nullo" ? "Nullo" : "Misère"} for{" "}
              {state.you.blindPoints} points, without looking?
            </p>
            <div className="offer-modal-buttons">
              <button className="offer-yes" onClick={() => emit("g4:bid", { bid: "Blind Misere" })}>
                Yes — bid it blind
              </button>
              <button className="offer-no" onClick={() => emit("g4:declineBlind")}>
                No — show me my cards
              </button>
            </div>
          </div>
        </div>
      )}

      {claim?.awaitingYou && (
        <div className="offer-modal-overlay">
          <div className="offer-modal">
            <p>
              {claim.name} says they&apos;ve got the rest of the tricks — their hand is face
              up for you to check. Both of you have to agree. Do you?
            </p>
            <div className="offer-modal-buttons">
              <button className="offer-yes" onClick={() => emit("g4:respondToClaim", { accept: true })}>
                Yes
              </button>
              <button className="offer-no" onClick={() => emit("g4:respondToClaim", { accept: false })}>
                No, play it out
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingJokerLead && (
        <div className="offer-modal-overlay">
          <div className="offer-modal">
            <p>Nominate a suit for the Joker:</p>
            <div className="offer-modal-buttons">
              {SUITS.map((suit) => (
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

      {state.review && (
        <RoundReviewModal
          round={state.review.round}
          log={state.review.log}
          players={(state.seats || []).map((s) => ({ id: s.userId, name: s.name }))}
          stepIndex={state.review.stepIndex || 0}
          isController={state.review.controllerId === playerId}
          controllerName={
            state.seats?.find((s) => s.userId === state.review.controllerId)?.name || "Someone"
          }
          onStep={(index) => emit("g4:reviewStep", { index })}
          onDone={() => emit("g4:reviewDone")}
          deckId={deckId}
        />
      )}

      {state.replay && (
        <div className="replay-overlay">
          <div className="g4-replay-panel">
            <div className="g4-replay-head">
              <p className="g4-replay-banner">Replay — this won&apos;t count</p>
              <button className="btn-ghost g4-replay-leave" onClick={() => emit("g4:endReplay")}>
                Leave the replay
              </button>
            </div>
            {replayResult ? (
              <div className="replay-result-box">
                <p>
                  {replayResult.bidderName} bid {bidLabel(replayResult.bid, state.options)} and{" "}
                  {replayResult.made ? "made it" : "missed it"} — {replayResult.tricks} tricks.
                </p>
                <button className="btn-primary" onClick={() => emit("g4:endReplay")}>
                  Return to the round
                </button>
              </div>
            ) : state.replay.phase === "kitty" &&
              state.replay.currentBid?.seat === state.replay.you.seat ? (
              kittyScreen(state.replay, "replay")
            ) : state.replay.phase === "exchange" &&
              (state.replay.exchangeSeats || []).includes(state.replay.you.seat) &&
              !state.replay.you.passed ? (
              exchangeScreen(state.replay, "replay")
            ) : state.replay.phase === "kitty" ? (
              <p className="replay-result-box">
                Waiting for{" "}
                {state.replay.seats?.find((s) => s.seat === state.replay.currentBid?.seat)?.name} to
                discard.
              </p>
            ) : state.replay.phase === "exchange" ? (
              <p className="replay-result-box">The partners are changing five cards each.</p>
            ) : (
              board(state.replay, { mode: "replay", compact: true })
            )}
          </div>
        </div>
      )}

      {state.phase === "roundEnd" && state.roundResult && !endHeld && (
        <RoundEnd4Modal
          result={state.roundResult}
          roundEnd={state.roundEnd}
          you={state.you}
          options={state.options}
          scoreHistory={state.scoreHistory}
          roundNumber={state.roundNumber}
          onReady={() => emit("g4:ready")}
          onPropose={(type) => emit("g4:propose", { type })}
          onRespondToProposal={(accept) => emit("g4:respondToProposal", { accept })}
          onSetBlindIntent={(on) => emit("g4:setBlindIntent", { on })}
        />
      )}
    </ThemedTable>
  );
}

function SeatList({ slots, hostUserId }) {
  return (
    <ul className="g4-seat-list">
      {slots.map((slot, index) => (
        <li key={index} className={slot ? "taken" : "empty"}>
          {slot ? (
            <>
              <b>{slot.name}</b>
              {slot.isBot && <span className="g4-tag">robot</span>}
              {slot.userId === hostUserId && <span className="g4-tag">host</span>}
              {!slot.isBot && !slot.connected && <span className="g4-tag">away</span>}
            </>
          ) : (
            <span className="g4-empty-seat">Empty seat</span>
          )}
        </li>
      ))}
    </ul>
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
