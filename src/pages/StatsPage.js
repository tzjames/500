import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import ThemedTable from "../components/ThemedTable";
import BidRecordChart from "../components/BidRecordChart";
import AccuracyChart from "../components/AccuracyChart";
import { defaultOptions } from "../gameOptions";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";
import "./StatsPage.css";

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

function Figure({ label, value, note }) {
  return (
    <li className="stat-figure">
      <b className="serif">{value}</b>
      <span className="stat-figure-label">{label}</span>
      {note && <span className="stat-figure-note">{note}</span>}
    </li>
  );
}

function RecordList({ rows, empty }) {
  if (rows.length === 0) return <p className="stats-empty">{empty}</p>;
  return (
    <ul className="record-list">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="record-opponent">{row.label}</span>
          <span className="record-tally">
            <b>{row.wins}</b>
            <span className="record-dash">–</span>
            <b>{row.losses}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Your record, one tab per size of table. Everything is derived from finished
// games and the rounds behind them, so nothing here can drift out of step with
// the games themselves.
function StatsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(4);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) navigate("/", { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    setStats(null);
    setError("");
    api
      .getStats(session.token, mode)
      .then((data) => live && setStats(data))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [session, mode]);

  if (!session) return null;

  // The naming option is per-table, so a stats page spanning many tables just
  // uses the standard names.
  const options = defaultOptions();

  return (
    <ThemedTable
      locationId={DEFAULT_LOCATION}
      deckId={DEFAULT_DECK}
      feltId={DEFAULT_FELT}
      plain
      scrolling
    >
      <div className="stats-page">
        <header className="stats-header">
          <div>
            <h1 className="serif">Your record</h1>
            <p className="stats-subtitle">{session.user.name}</p>
          </div>
          <Link to="/" className="btn-ghost stats-back">
            Back to home
          </Link>
        </header>

        <div className="stats-tabs" role="tablist">
          {[
            { id: 4, label: "Four players" },
            { id: 2, label: "Two players" },
          ].map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mode === tab.id}
              className={`stats-tab${mode === tab.id ? " on" : ""}`}
              onClick={() => setMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && <p className="auth-error">{error}</p>}
        {!stats && !error && <p className="stats-empty">Adding it all up…</p>}

        {stats && (
          <>
            <ul className="stat-figures">
              <Figure
                label="Elo"
                value={stats.elo}
                note={mode === 4 ? "your side against theirs" : "head to head"}
              />
              <Figure label="Games" value={stats.games} note={`${stats.wins} won`} />
              <Figure label="Win rate" value={percent(stats.wins, stats.games)} />
              <Figure
                label="Contracts made"
                value={percent(stats.contracts.made, stats.contracts.total)}
                note={`${stats.contracts.made} of ${stats.contracts.total} you bought`}
              />
            </ul>
            <p className="stats-note stats-elo-note">
              Elo starts everyone at 1200 and moves with each finished game — by how
              surprising the result was, and, at a table of four, against the average of the
              two sides.
              {stats.practiceGames > 0 || stats.practiceRounds > 0 ? (
                <>
                  {" "}
                  Nothing on this page counts your {stats.practiceGames} game
                  {stats.practiceGames === 1 ? "" : "s"} against robots
                  {stats.practiceRounds > 0 && ` (${stats.practiceRounds} contracts)`}: a
                  record padded by beating robots wouldn&apos;t tell you anything.
                </>
              ) : (
                " Games with a robot in them aren't counted anywhere on this page."
              )}
            </p>

            <h2 className="home-section overline">How close your contracts came</h2>
            <div className="stats-panel">
              <AccuracyChart
                accuracy={stats.contracts.accuracy}
                total={stats.contracts.numeric}
              />
              {stats.contracts.special > 0 && (
                <p className="stats-note">
                  Not counted here: {stats.contracts.special} no-tricks contract
                  {stats.contracts.special === 1 ? "" : "s"}, of which you made{" "}
                  {stats.contracts.specialMade}. They have no near miss — they&apos;re clean
                  or they&apos;re broken.
                </p>
              )}
            </div>

            <h2 className="home-section overline">Every bid, and how often you made it</h2>
            <div className="stats-panel">
              <BidRecordChart bids={stats.bids} options={options} />
            </div>

            {mode === 4 ? (
              <>
                <h2 className="home-section overline">With each partner</h2>
                <div className="stats-panel">
                  <RecordList
                    rows={stats.partners}
                    empty="No finished games with a partner yet."
                  />
                </div>

                <h2 className="home-section overline">Each table you&apos;ve sat at</h2>
                <div className="stats-panel">
                  <RecordList
                    rows={stats.tables}
                    empty="No finished four-player games yet."
                  />
                </div>
              </>
            ) : (
              <>
                <h2 className="home-section overline">Against each opponent</h2>
                <div className="stats-panel">
                  <RecordList rows={stats.tables} empty="No finished two-player games yet." />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ThemedTable>
  );
}

export default StatsPage;
