import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import NewGameModal from "../components/NewGameModal";
import BrandMark from "../components/BrandMark";
import PresenceStrip from "../components/PresenceStrip";
import AuthForm from "../components/AuthForm";
import RulesModal from "../components/RulesModal";
import EuchreRulesModal from "../components/EuchreRulesModal";
import HeartsRulesModal from "../components/HeartsRulesModal";
import { getGame, seatsLabel } from "../games";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";
import "./HomePage.css";

// Which game's rules panel to open. The panels differ enough — 500 has a bid
// schedule, Euchre has six rule sets and Hearts sixteen with a different set of
// cards costing in each — that they are separate components, so this is the one
// place a new game needs adding.
const RULES = {
  "500": (props) => <RulesModal choosable {...props} />,
  euchre: (props) => <EuchreRulesModal choosable {...props} />,
  hearts: (props) => <HeartsRulesModal choosable {...props} />,
};

function statusLabel(game, userId) {
  if (game.status === "finished") {
    const won =
      game.winner?.id === userId || game.winner?.playerIds?.includes(userId);
    return `Finished — ${won ? "you" : game.winner?.name} won with ${game.winner?.score}`;
  }
  if (game.status === "waiting") {
    const taken = (game.playerSlots || []).filter(Boolean).length;
    const seats = game.mode;
    return `Waiting — ${taken} of ${seats} seated`;
  }
  return `In progress — round ${game.roundNumber}`;
}

function tableLabel(game, userId) {
  const others = (game.playerSlots || [])
    .filter((s) => s && s.userId !== userId)
    .map((s) => s.name);
  if (others.length === 0) return game.mode === 2 ? "No opponent yet" : `${seatsLabel(game.mode)} table`;
  return `${game.mode === 2 ? "vs" : "with"} ${others.join(", ")}`;
}

// This game's own heading. The brand mark above it is the way back to the
// chooser; the wordmark itself is the game's, not the site's.
function Hero({ game, tagline }) {
  return (
    <header className="home-header">
      <div className="home-brand">
        <BrandMark title="All games" />
      </div>
      <p className="overline game-kicker">{game.kicker}</p>
      <h1 className="serif game-title">{game.name}</h1>
      <p className="home-tagline">{tagline}</p>
    </header>
  );
}

// Whether a table counts towards Elo — friendly covers both one marked that
// way and one with a robot seated, so there's nothing more to say than that.
function RatedBadge({ friendly }) {
  return friendly ? (
    <span className="badge-friendly">Friendly</span>
  ) : (
    <span className="badge-rated">Rated</span>
  );
}

function HomePage({ gameType = "500" }) {
  const game = getGame(gameType);
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [lobby, setLobby] = useState({ presence: null, tables: [] });
  const [showNewGame, setShowNewGame] = useState(false);
  const [remembered, setRemembered] = useState({});
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // Chosen once when the page mounts, not per render — otherwise it would
  // shuffle every time the games list or the record came back.
  const [tagline] = useState(
    () => game.taglines[Math.floor(Math.random() * game.taglines.length)]
  );

  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  const loadGames = useCallback(() => {
    if (!session) return;
    api
      .listGames(session.token, gameType)
      .then(setGames)
      .catch((err) => setError(err.message));
  }, [session, gameType]);

  const loadRecord = useCallback(() => {
    if (!session) return;
    // The record is a nicety — if it fails, the page is still usable, so it
    // doesn't get to set the page-level error.
    api
      .getRecord(session.token, gameType)
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [session, gameType]);

  useEffect(() => {
    loadGames();
    loadRecord();
  }, [loadGames, loadRecord]);

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
    Promise.all(game.modes.map((mode) => api.getGameDefaults(session.token, mode, gameType).catch(() => ({}))))
      .then((byMode) => setRemembered(Object.fromEntries(game.modes.map((mode, i) => [mode, byMode[i]]))))
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

  const openTables = lobby.tables.filter((table) => table.gameType === gameType);
  const Rules = RULES[gameType];

  // The home screen is a document rather than a fixed board, so the shell
  // scrolls and skips the tilted felt — just the backdrop wash behind it.
  return (
    <ThemedTable locationId={DEFAULT_LOCATION} deckId={DEFAULT_DECK} feltId={DEFAULT_FELT} plain scrolling>
      <div className="home-page">
        <Hero game={game} tagline={tagline} />

        {/* What the game is, for anyone who hasn't played it — and the way into
            the full rules, which is the same panel the table itself opens. */}
        <section className="home-about">
          {game.about.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <button className="btn-ghost home-rules-button" onClick={() => setShowRules(true)}>
            How to play {game.name}
          </button>
        </section>

        {!session ? (
          <AuthForm />
        ) : (
        <>
        <div className="home-welcome">
          <span>
            Welcome, <b>{session.user.name}</b>
          </span>
          <span className="home-welcome-links">
            <Link to={game.statsPath} className="auth-toggle">
              Your record
            </Link>
            <Link to="/" className="auth-toggle">
              All games
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
            {openTables.length === 0 ? (
              <p className="home-empty">
                No public tables waiting. Start one and set it to public, and it
                will show up here for anyone to join.
              </p>
            ) : (
              <ul className="lobby-list">
                {openTables.map((table) => {
                  const rules = game.tableRules(table);
                  const mine = table.players.some((p) => p.name === session.user.name);
                  return (
                    <li key={table.id}>
                      <div className="lobby-main">
                        <span className="lobby-title">
                          {seatsLabel(table.mode)} · {table.hostName}&apos;s table
                        </span>
                        <span className="lobby-players">
                          {table.players.map((p) => p.name).join(", ")}
                        </span>
                        {table.variant && (
                          <span className="lobby-rules">{game.rules.variantLabel(table.variant)}</span>
                        )}
                        {rules.length > 0 && <span className="lobby-rules">{rules.join(" · ")}</span>}
                      </div>
                      <div className="lobby-side">
                        <RatedBadge friendly={table.friendly} />
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
              <p className="home-empty">{game.emptyGames}</p>
            ) : (
              <ul className="game-list">
                {games.map((row) => {
                  const joinable = row.status !== "finished";
                  return (
                    <li
                      key={row.id}
                      className={joinable ? "joinable" : ""}
                      onClick={() => joinable && navigate(`/game/${row.id}`)}
                    >
                      <span className="game-opponent">
                        <span className="game-badge">{row.mode}</span>
                        {row.variant && (
                          <span className="game-variant">{game.rules.variantLabel(row.variant)}</span>
                        )}
                        {tableLabel(row, session.user.id)}
                      </span>
                      <span className="game-status">
                        <RatedBadge friendly={row.friendly} /> {statusLabel(row, session.user.id)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
        </>
        )}
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}

      {showNewGame && (
        <NewGameModal
          gameType={gameType}
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
