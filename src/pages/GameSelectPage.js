import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import AuthForm from "../components/AuthForm";
import PresenceStrip from "../components/PresenceStrip";
import { GAMES, SITE_TAGLINES } from "../games";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";
import "./HomePage.css";
import "./GameSelectPage.css";

// The front of the site: the brand, and a card per game. Each game's own page
// lives under it and holds that game's lobby, record and games. Everything on
// this page is driven by the list in games.js, so a new game arrives here on its
// own once it has an entry.
//
// It is also the only place anyone logs in — the game pages bounce you here and
// remember where you were headed.
function GameSelectPage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [lobby, setLobby] = useState({ presence: null, tables: [] });
  const [active, setActive] = useState({});
  const [tagline] = useState(() => SITE_TAGLINES[Math.floor(Math.random() * SITE_TAGLINES.length)]);

  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  // Where a protected route sent us from: a game page opened without a session,
  // or an invite link opened by somebody without an account yet. Logging in or
  // signing up hands them straight on to it.
  const redirectTo = location.state?.from;

  useEffect(() => {
    if (session && redirectTo) navigate(redirectTo, { replace: true });
  }, [session, redirectTo, navigate]);

  useEffect(() => {
    if (!session) return;
    api
      .getGameSummary(session.token)
      .then((summary) => setActive(summary.active || {}))
      .catch(() => setActive({}));
  }, [session]);

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

  const openTables = (id) => lobby.tables.filter((table) => table.gameType === id).length;

  return (
    <ThemedTable
      locationId={DEFAULT_LOCATION}
      deckId={DEFAULT_DECK}
      feltId={DEFAULT_FELT}
      plain
      scrolling
    >
      <div className="home-page select-page">
        <header className="home-header">
          <img
            className="home-logo"
            src="/brand/logo-dark-bg.png"
            alt="Tricky Games"
            width="810"
            height="301"
          />
          <p className="home-tagline">{tagline}</p>
        </header>

        {!session ? (
          <>
            {redirectTo && <RedirectNote to={redirectTo} />}
            <AuthForm />
          </>
        ) : (
          <div className="home-welcome">
            <span>
              Welcome, <b>{session.user.name}</b>
            </span>
            <span className="home-welcome-links">
              <button className="auth-toggle" onClick={logout}>
                Log out
              </button>
            </span>
          </div>
        )}

        {session && <PresenceStrip presence={lobby.presence} />}

        <h2 className="home-section overline">Pick a game</h2>
        <ul className="game-picker">
          {GAMES.map((game) => (
            <li key={game.id}>
              <Link to={game.path} className="game-card">
                <p className="overline game-card-kicker">{game.kicker}</p>
                <h3 className="serif">{game.name}</h3>
                <p className="game-card-blurb">{game.blurb}</p>
                <span className="game-card-facts">
                  {session ? (
                    <>
                      <b>{active[game.id] || 0}</b> on the go
                      <i />
                      <b>{openTables(game.id)}</b> open {openTables(game.id) === 1 ? "table" : "tables"}
                    </>
                  ) : (
                    <>{game.modes.join(", ")} players</>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="home-empty game-picker-note">
          More games to come. Your record and rating are kept separately for each
          one, so the games never mix.
        </p>
      </div>
    </ThemedTable>
  );
}

// Why you were sent here, in the words of wherever you were going.
function RedirectNote({ to }) {
  if (to.startsWith("/game/")) {
    return (
      <p className="home-invite-note">
        You&apos;ve been invited to a game. Log in or sign up and we&apos;ll take
        you straight there.
      </p>
    );
  }
  const game = GAMES.find((entry) => to === entry.path || to.startsWith(`${entry.path}/`));
  return (
    <p className="home-invite-note">
      Log in or sign up and we&apos;ll take you to {game ? game.name : "where you were headed"}.
    </p>
  );
}

export default GameSelectPage;
