import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import ThemedTable from "../components/ThemedTable";
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

function statusLabel(game, userId) {
  if (game.status === "finished") {
    const won = game.winner?.id === userId;
    return `Finished — ${won ? "you" : game.winner?.name} won with ${game.winner?.score}`;
  }
  if (game.status === "waiting") return "Waiting for an opponent";
  return `In progress — round ${game.roundNumber}`;
}

function opponentName(game, userId) {
  const other = game.playerSlots.find((s) => s && s.userId !== userId);
  return other ? other.name : "—";
}

function HomePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [games, setGames] = useState([]);
  const [error, setError] = useState("");

  // Set when a protected route sent us here to authenticate (see
  // GameRoomPage) — typically an invite link opened by someone without an
  // account yet. Logging in or signing up hands them straight on to it.
  const redirectTo = location.state?.from;

  useEffect(() => {
    if (session && redirectTo) navigate(redirectTo, { replace: true });
  }, [session, redirectTo, navigate]);

  useEffect(() => {
    if (!session) return;
    api
      .listGames(session.token)
      .then(setGames)
      .catch((err) => setError(err.message));
  }, [session]);

  const handleNewGame = async () => {
    const { id } = await api.createGame(session.token);
    navigate(`/game/${id}`);
  };

  // The home screen is a document rather than a fixed board, so the shell
  // scrolls and skips the tilted felt — just the backdrop wash behind it.
  return (
    <ThemedTable locationId={DEFAULT_LOCATION} deckId={DEFAULT_DECK} feltId={DEFAULT_FELT} plain scrolling>
      <div className="home-page">
        <header className="home-header">
          <h1 className="serif">500</h1>
          <p className="home-tagline">Two-handed, with dummies.</p>
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
              <button className="auth-toggle" onClick={logout}>
                Log out
              </button>
            </div>

            <button className="btn-primary new-game-button" onClick={handleNewGame}>
              Start a new game
            </button>
            {error && <p className="auth-error">{error}</p>}

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
                        vs {opponentName(game, session.user.id)}
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
    </ThemedTable>
  );
}

export default HomePage;
