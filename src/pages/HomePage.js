import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
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
    <div className="auth-form">
      <h2>{mode === "login" ? "Log in" : "Create an account"}</h2>
      <form onSubmit={handleSubmit}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">{mode === "login" ? "Log in" : "Sign up"}</button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      <button className="auth-toggle" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
      </button>
    </div>
  );
}

function statusLabel(game, userId) {
  if (game.status === "finished") {
    const won = game.winner?.id === userId;
    return `Finished — ${won ? "You" : game.winner?.name} won (${game.winner?.score} pts)`;
  }
  if (game.status === "waiting") return "Waiting for opponent";
  return `In progress — round ${game.roundNumber}`;
}

function opponentName(game, userId) {
  const other = game.playerSlots.find((s) => s && s.userId !== userId);
  return other ? other.name : "—";
}

function HomePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    api
      .listGames(session.token)
      .then(setGames)
      .catch((err) => setError(err.message));
  }, [session]);

  if (!session) {
    return (
      <div className="home-page">
        <h1>500 Card Game</h1>
        <AuthForm />
      </div>
    );
  }

  const handleNewGame = async () => {
    const { id } = await api.createGame(session.token);
    navigate(`/game/${id}`);
  };

  return (
    <div className="home-page">
      <h1>500 Card Game</h1>
      <p>
        Welcome, {session.user.name}! <button onClick={logout}>Log out</button>
      </p>
      <button className="new-game-button" onClick={handleNewGame}>
        New Game
      </button>
      {error && <p className="auth-error">{error}</p>}
      <h2>Your Games</h2>
      <ul className="game-list">
        {games.length === 0 && <p>No games yet — start one above.</p>}
        {games.map((game) => {
          const joinable = game.status !== "finished";
          return (
            <li
              key={game.id}
              className={joinable ? "joinable" : ""}
              onClick={() => joinable && navigate(`/game/${game.id}`)}
            >
              <span className="game-opponent">vs {opponentName(game, session.user.id)}</span>
              <span className="game-status">{statusLabel(game, session.user.id)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default HomePage;
