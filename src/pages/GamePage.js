import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import ThemedTable from "../components/ThemedTable";
import GameRoomPage from "./GameRoomPage";
import GameRoom4Page from "./GameRoom4Page";
import EuchreRoomPage from "./EuchreRoomPage";
import HeartsRoomPage from "./HeartsRoomPage";
import { DEFAULT_LOCATION, DEFAULT_DECK, DEFAULT_FELT } from "../theme";

// Every game lives at /game/:id, so this asks which one it is before handing
// over. It's a separate round trip rather than something carried in the URL
// because the link people share has to keep working whatever it points at.
function GamePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");

  // Following an invite link without an account sends you to the home page to
  // log in or sign up, carrying where you were headed.
  useEffect(() => {
    if (!session) {
      navigate("/", { replace: true, state: { from: location.pathname + location.search } });
    }
  }, [session, navigate, location.pathname, location.search]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    api
      .getGameMeta(session.token, id)
      .then((nextMeta) => live && setMeta(nextMeta))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [session, id]);

  if (!session) return null;

  if (error) {
    return (
      <ThemedTable locationId={DEFAULT_LOCATION} deckId={DEFAULT_DECK} feltId={DEFAULT_FELT} plain>
        <div className="room-full">
          <p>{error}</p>
          <p>
            <Link to="/">Back to all games</Link>
          </p>
        </div>
      </ThemedTable>
    );
  }

  if (meta === null) {
    return (
      <ThemedTable locationId={DEFAULT_LOCATION} deckId={DEFAULT_DECK} feltId={DEFAULT_FELT} plain>
        <div className="waiting-panel">
          <p>Finding your table…</p>
        </div>
      </ThemedTable>
    );
  }

  if (meta.gameType === "euchre") return <EuchreRoomPage />;
  if (meta.gameType === "hearts") return <HeartsRoomPage />;
  return meta.mode === 4 ? <GameRoom4Page /> : <GameRoomPage />;
}

export default GamePage;
