import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import NewGameModal from "../components/NewGameModal";
import { changedOptionLabels } from "../gameOptions";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";
import "./HomePage.css";

function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") await login(name.trim(), password);
      else await register(name.trim(), password);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-form panel">
      <h2 className="serif">{mode === "login" ? "Log in" : "Create an account"}</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="btn-primary">
          {mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      <button
        className="auth-toggle"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
      </button>
    </div>
  );
}

// The game has never settled on a name. One is picked per visit.
const TAGLINES = [
  "Two-handed, with dummies",
  "Five-handed, four-player, two-person, two-handed, five hundred",
  "Two players, two dummies",
  "Two-player, two-handed, four-player, five-handed",
  "Four players, two partnerships, one kitty",
];

function statusLabel(game, userId) {
  if (game.status === "finished") {
    const won =
      game.winner?.id === userId || game.winner?.playerIds?.includes(userId);
    return `Finished — ${won ? "you" : game.winner?.name} won with ${game.winner?.score}`;
  }
  if (game.status === "waiting") {
    const taken = (game.playerSlots || []).filter(Boolean).length;
    const seats = game.mode === 4 ? 4 : 2;
    return `Waiting — ${taken} of ${seats} seated`;
  }
  return `In progress — round ${game.roundNumber}`;
}

function tableLabel(game, userId) {
  const others = (game.playerSlots || [])
    .filter((s) => s && s.userId !== userId)
    .map((s) => s.name);
  if (others.length === 0) return game.mode === 4 ? "Four-player table" : "No opponent yet";
  return `${game.mode === 4 ? "with" : "vs"} ${others.join(", ")}`;
}

// Live counts along the top: who's about and what they're doing.
function PresenceStrip({ presence }) {
  const stats = presence || { online: 0, playing: 0, waiting: 0, games: 0 };
  const entries = [
    { label: "logged in", value: stats.online },
    { label: "playing", value: stats.playing },
    { label: "free", value: stats.waiting },
    { label: stats.games === 1 ? "game running" : "games running", value: stats.games },
  ];
  return (
    <ul className="presence-strip">
      {entries.map((entry) => (
        <li key={entry.label}>
          <b className="serif">{entry.value}</b>
          <span>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

function HomePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [games, setGames] = useState([]);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [lobby, setLobby] = useState({ presence: null, tables: [] });
  const [showNewGame, setShowNewGame] = useState(false);
  const [remembered, setRemembered] = useState({});
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  // Chosen once when the page mounts, not per render — otherwise it would
  // shuffle every time the games list or the record came back.
  const [tagline] = useState(
    () => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]
  );

  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  // Set when a protected route sent us here to authenticate (see
  // GameRoomPage) — typically an invite link opened by someone without an
  // account yet. Logging in or signing up hands them straight on to it.
  const redirectTo = location.state?.from;

  useEffect(() => {
    if (session && redirectTo) navigate(redirectTo, { replace: true });
  }, [session, redirectTo, navigate]);

  const loadGames = useCallback(() => {
    if (!session) return;
    api
      .listGames(session.token)
      .then(setGames)
      .catch((err) => setError(err.message));
  }, [session]);

  useEffect(() => {
    loadGames();
    if (!session) return;
    // The record is a nicety — if it fails, the page is still usable, so it
    // doesn't get to set the page-level error.
    api
      .getRecord(session.token)
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [session, loadGames]);

  // The lobby is pushed rather than polled: the server broadcasts to everyone
  // watching whenever somebody connects, sits down or starts a table.
  useEffect(() => {
    if (!socket) return;
    const subscribe = () => socket.emit("lobby:subscribe");
    if (socket.connected) subscribe();
    socket.on("connect", subscribe);
    socket.on("lobbyState", setLobby);
    return () => {
      socket.emit("lobby:unsubscribe");
      socket.off("connect", subscribe);
      socket.off("lobbyState", setLobby);
    };
  }, [socket]);

  // The house rules and visibility this player used last time, per table size,
  // so the new-game screen opens on their settings rather than the defaults.
  const openNewGame = () => {
    setShowNewGame(true);
    setError("");
    setLoadingDefaults(true);
    Promise.all([
      api.getGameDefaults(session.token, 2).catch(() => ({})),
      api.getGameDefaults(session.token, 4).catch(() => ({})),
    ])
      .then(([two, four]) => setRemembered({ 2: two, 4: four }))
      .finally(() => setLoadingDefaults(false));
  };

  const handleStart = async (setup) => {
    try {
      const { id } = await api.createGame(session.token, setup);
      navigate(`/game/${id}`);
    } catch (err) {
      setError(err.message);
      setShowNewGame(false);
    }
  };

  // The home screen is a document rather than a fixed board, so the shell
  // scrolls and skips the tilted felt — just the backdrop wash behind it.
  return (
    <ThemedTable locationId={DEFAULT_LOCATION} deckId={DEFAULT_DECK} feltId={DEFAULT_FELT} plain scrolling>
      <div className="home-page">
        <header className="home-header">
          <h1 className="serif">500</h1>
          <p className="home-tagline">{tagline}</p>
        </header>

        {!session ? (
          <>
            {redirectTo?.startsWith("/game/") && (
              <p className="home-invite-note">
                You&apos;ve been invited to a game. Log in or sign up and
                we&apos;ll take you straight there.
              </p>
            )}
            <AuthForm />
          </>
        ) : (
          <>
            <div className="home-welcome">
              <span>
                Welcome, <b>{session.user.name}</b>
              </span>
              <span className="home-welcome-links">
                <Link to="/stats" className="auth-toggle">
                  Your record
                </Link>
                <button className="auth-toggle" onClick={logout}>
                  Log out
                </button>
              </span>
            </div>

            <PresenceStrip presence={lobby.presence} />

            <button className="btn-primary new-game-button" onClick={openNewGame}>
              Start a new game
            </button>
            {error && <p className="auth-error">{error}</p>}

            <h2 className="home-section overline">Open tables</h2>
            {lobby.tables.length === 0 ? (
              <p className="home-empty">
                No public tables waiting. Start one and set it to public, and it
                will show up here for anyone to join.
              </p>
            ) : (
              <ul className="lobby-list">
                {lobby.tables.map((table) => {
                  const rules = changedOptionLabels(table.options);
                  const mine = table.players.some((p) => p.name === session.user.name);
                  return (
                    <li key={table.id}>
                      <div className="lobby-main">
                        <span className="lobby-title">
                          {table.mode === 4 ? "Four players" : "Two players"} ·{" "}
                          {table.hostName}&apos;s table
                        </span>
                        <span className="lobby-players">
                          {table.players.map((p) => p.name).join(", ")}
                        </span>
                        {table.mode === 4 && rules.length > 0 && (
                          <span className="lobby-rules">{rules.join(" · ")}</span>
                        )}
                      </div>
                      <div className="lobby-side">
                        <span className="lobby-seats">
                          {table.seatsTaken}/{table.seats}
                        </span>
                        <button
                          className="btn-ghost lobby-join"
                          onClick={() => navigate(`/game/${table.id}`)}
                        >
                          {mine ? "Back to it" : "Sit down"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {records.length > 0 && (
              <>
                <h2 className="home-section overline">Record</h2>
                <ul className="record-list">
                  {records.map((r) => (
                    <li key={r.opponentId}>
                      <span className="record-opponent">vs {r.opponentName}</span>
                      <span className="record-tally">
                        <b>{r.wins}</b>
                        <span className="record-dash">–</span>
                        <b>{r.losses}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="home-section overline">Your games</h2>
            {games.length === 0 ? (
              <p className="home-empty">No games yet — start one above.</p>
            ) : (
              <ul className="game-list">
                {games.map((game) => {
                  const joinable = game.status !== "finished";
                  return (
                    <li
                      key={game.id}
                      className={joinable ? "joinable" : ""}
                      onClick={() => joinable && navigate(`/game/${game.id}`)}
                    >
                      <span className="game-opponent">
                        {game.mode === 4 && <span className="game-badge">4</span>}
                        {tableLabel(game, session.user.id)}
                      </span>
                      <span className="game-status">
                        {statusLabel(game, session.user.id)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {showNewGame && (
        <NewGameModal
          remembered={remembered}
          loadingDefaults={loadingDefaults}
          onStart={handleStart}
          onCancel={() => setShowNewGame(false)}
          error={error}
        />
      )}
    </ThemedTable>
  );
}

export default HomePage;
