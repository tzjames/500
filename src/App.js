import React, { useState, useEffect } from "react";
import io from "socket.io-client";
import GameStatus from "./components/GameStatus";
import BiddingInterface from "./components/BiddingInterface";
import GameTable from "./components/GameTable";
import AnimatedHand from "./components/AnimatedHand";
import "./App.css";

const socket = io("http://localhost:5001", {
  transports: ["websocket", "polling"],
});

function App() {
  const [gameState, setGameState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [playerName, setPlayerName] = useState(() => {
    // First, try to get the name from sessionStorage
    const sessionName = sessionStorage.getItem("playerName");
    if (sessionName) return sessionName;

    // If not in sessionStorage, try localStorage
    const localName = localStorage.getItem("playerName");
    if (localName) {
      // Store in sessionStorage for this tab
      sessionStorage.setItem("playerName", localName);
      return localName;
    }

    // If no name is found, return an empty string
    return "";
  });
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [roomFull, setRoomFull] = useState(false);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [dealerId, setDealerId] = useState(null);
  const [currentBidder, setCurrentBidder] = useState(null);
  const [biddingHistory, setBiddingHistory] = useState([]);
  const [kitty, setKitty] = useState(null);
  const [isKittyPhase, setIsKittyPhase] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [winningBidder, setWinningBidder] = useState(null);
  const [gamePhase, setGamePhase] = useState("waiting");
  const [tricks, setTricks] = useState({});

  const [combinedHand, setCombinedHand] = useState([]);
  const [selectedCards, setSelectedCards] = useState([]);
  const [isKittyAdded, setIsKittyAdded] = useState(false);

  const [dummyHand, setDummyHand] = useState([]);
  const [opponentHandSize, setOpponentHandSize] = useState(10);
  const [opponentDummyHandSize, setOpponentDummyHandSize] = useState(10);
  const [playedCards, setPlayedCards] = useState([]);

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Connected to server, socket id:", socket.id);
      setPlayerId(socket.id);

      const savedName = sessionStorage.getItem("playerName");
      if (savedName) {
        setPlayerName(savedName);
        socket.emit("setPlayerName", savedName, () => setNameSubmitted(true));
      }
    });

    socket.on("playersUpdate", ({ count, players }) => {
      setConnectedPlayers(count);
      console.log("Players updated:", players);
    });

    socket.on("gameStart", (initialState) => {
      console.log("Game started:", JSON.stringify(initialState, null, 2));
      setGameState(initialState);
      setDealerId(initialState.dealerId);
      setCurrentBidder(initialState.currentBidder);
      setGamePhase("bidding");
    });

    socket.on("updateGame", (newState) => {
      console.log("Game updated:", newState);
      setGameState((prevState) => ({ ...prevState, ...newState }));
      if (newState.currentBidder) {
        setCurrentBidder(newState.currentBidder);
      }
      if (newState.currentBid) {
        setBiddingHistory((prevHistory) => [
          ...prevHistory,
          newState.currentBid,
        ]);
      }
    });

    socket.on("biddingComplete", (finalBid, history) => {
      console.log("Bidding complete:", finalBid);
      setGameState((prevState) => ({
        ...prevState,
        currentBid: finalBid,
        biddingComplete: true,
      }));
      setCurrentBidder(null);
      setBiddingHistory(history);
      setGamePhase("kitty"); // Add this line to transition to the kitty phase
    });

    socket.on("showKitty", (kittyCards) => {
      console.log("Received kitty:", kittyCards);
      setKitty(kittyCards);
      setIsKittyPhase(true);
      setWinningBidder(playerId);

      setGameState((prevState) => {
        if (!prevState) {
          console.error("Game state is null when receiving kitty");
          return prevState;
        }

        const currentPlayerHand =
          prevState.players.find((p) => p.id === playerId)?.hand || [];
        const newCombinedHand = [
          ...currentPlayerHand,
          ...kittyCards.map((card) => ({ ...card, isKitty: true })),
        ];

        setCombinedHand(newCombinedHand);
        setIsKittyAdded(true);

        return {
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId ? { ...p, hand: newCombinedHand } : p
          ),
        };
      });
    });

    socket.on("kittyPhaseComplete", ({ currentPlayer: startingPlayer }) => {
      setIsKittyPhase(false);
      setKitty(null);
      setGamePhase("playing");
      setCurrentPlayer(startingPlayer);

      setGameState((prevState) => ({
        ...prevState,
        phase: "playing",
      }));
    });

    socket.on("cardPlayed", ({ playerId: cardPlayerId, card, isDummy }) => {
      if (cardPlayerId !== playerId) {
        setPlayedCards([{ playerId: cardPlayerId, card, isDummy }]);
        if (isDummy) {
          setOpponentDummyHandSize((prev) => prev - 1);
        } else {
          setOpponentHandSize((prev) => prev - 1);
        }
      }
    });

    socket.on("trickResolved", ({ winner, newScores }) => {
      setPlayedCards([]);
      setGameState((prev) => ({
        ...prev,
        players: prev.players.map((p) => {
          const newScore = newScores.find((s) => s.id === p.id)?.score;
          return { ...p, score: newScore !== undefined ? newScore : p.score };
        }),
      }));
    });

    socket.on("updateCurrentPlayer", (newCurrentPlayer) => {
      setCurrentPlayer(newCurrentPlayer);
    });

    socket.on("allPlayersPassed", () => {
      console.log("All players passed");
      // Handle this case (e.g., restart the bidding or the game)
      setGameState((prevState) => ({
        ...prevState,
        biddingComplete: true,
        currentBid: null,
      }));
      setCurrentBidder(null);
      // You might want to add some UI to indicate that all players passed
    });

    socket.on("roomFull", () => {
      console.log("Room is full");
      setRoomFull(true);
    });

    socket.on("updateHand", (newHand) => {
      setGameState((prevState) => ({
        ...prevState,
        players: prevState.players.map((p) =>
          p.id === playerId ? { ...p, hand: newHand } : p
        ),
      }));
    });

    socket.on("gameplayStart", (gameplayData) => {
      setGameState((prevState) => ({
        ...prevState,
        trumpSuit: gameplayData.trumpSuit,
        currentPlayer: gameplayData.startingPlayer,
      }));
      setIsKittyPhase(false);
      setKitty(null);
    });

    socket.on("updateGamePhase", (phase) => {
      setGamePhase(phase);
    });

    socket.on("updateTricks", (newTricks) => {
      setTricks(newTricks);
    });

    return () => {
      socket.off("connect");
      socket.off("playersUpdate");
      socket.off("gameStart");
      socket.off("updateGame");
      socket.off("biddingComplete");
      socket.off("showKitty");
      socket.off("kittyPhaseComplete");
      socket.off("cardPlayed");
      socket.off("trickResolved");
      socket.off("updateCurrentPlayer");
      socket.off("allPlayersPassed");
      socket.off("roomFull");
      socket.off("updateHand");
      socket.off("gameplayStart");
      socket.off("updateGamePhase");
      socket.off("updateTricks");
    };
  }, [playerId]); // Add playerId to the dependency array

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (playerName.trim()) {
      localStorage.setItem("playerName", playerName.trim());
      sessionStorage.setItem("playerName", playerName.trim());
      socket.emit("setPlayerName", playerName.trim(), () => setNameSubmitted(true));
    }
  };

  const playCard = (card, isDummy = false) => {
    if (playerId === currentPlayer) {
      socket.emit("playCard", { playerId, card, isDummy });

      // Remove the played card from the appropriate hand
      if (isDummy) {
        setDummyHand((prevHand) =>
          prevHand.filter((c) => c.suit !== card.suit || c.value !== card.value)
        );
      } else {
        setGameState((prevState) => ({
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId
              ? {
                  ...p,
                  hand: p.hand.filter(
                    (c) => c.suit !== card.suit || c.value !== card.value
                  ),
                }
              : p
          ),
        }));
      }

      // Set the played card (replacing any existing played cards)
      setPlayedCards([{ playerId, card, isDummy }]);
    }
  };

  const handlePlaceBid = (bidOption) => {
    console.log("Placing bid:", bidOption);
    socket.emit("placeBid", {
      playerId,
      bid: bidOption.bid,
      points: bidOption.points,
    });
  };

  const handleCardClick = (index) => {
    if (selectedCards.includes(index)) {
      setSelectedCards(selectedCards.filter((i) => i !== index));
    } else if (selectedCards.length < 3) {
      setSelectedCards([...selectedCards, index]);
    }
  };

  const handleKittyDone = () => {
    if (selectedCards.length === 3) {
      const newHand = combinedHand.filter(
        (_, index) => !selectedCards.includes(index)
      );
      setGameState((prevState) => {
        if (!prevState) return prevState;
        return {
          ...prevState,
          players: prevState.players.map((p) =>
            p.id === playerId
              ? {
                  ...p,
                  hand: newHand.map((card) => ({ ...card, isKitty: false })),
                }
              : p
          ),
        };
      });
      socket.emit(
        "kittyDone",
        playerId,
        newHand.map((card) => ({ ...card, isKitty: false }))
      );
      setIsKittyPhase(false);
      setSelectedCards([]);
      setCombinedHand(newHand);
    }
  };

  // Add this function to log the current game state
  const logGameState = () => {
    console.log("Current game state:", gameState);
    console.log("Current player ID:", playerId);
    console.log("Current player data:", currentPlayerData);
    console.log("Dummy hand:", dummyHand);
  };

  if (roomFull) {
    return (
      <div className="room-full">
        The game room is full. Please try again later.
      </div>
    );
  }

  if (!nameSubmitted) {
    return (
      <div className="name-entry">
        <h2>Enter your name</h2>
        <form onSubmit={handleNameSubmit}>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Your name"
            required
          />
          <button type="submit">Submit</button>
        </form>
      </div>
    );
  }

  if (!gameState || !gameState.players) {
    return <div>Loading game state...</div>;
  }

  const currentPlayerData = gameState.players.find((p) => p.id === playerId);

  if (!currentPlayerData) {
    console.error("Current player not found in game state");
    return <div>Error: Player not found in game state</div>;
  }

  // Log the game state before rendering
  logGameState();

  return (
    <div className="App">
      <div className="game-container">
        <div className="game-info">
          <h1>500 Card Game</h1>
          <p>Welcome, {currentPlayerData.name}!</p>
          <GameStatus
            players={gameState.players}
            currentPlayer={playerId}
            dealerId={gameState.dealerId}
            currentBid={gameState.currentBid}
            gamePhase={gamePhase}
            tricks={tricks}
            trumpSuit={gameState.trumpSuit}
            currentBidder={currentBidder}
          />
          {gamePhase === "bidding" && (
            <BiddingInterface
              currentBid={gameState.currentBid}
              players={gameState.players}
              playerId={playerId}
              dealerId={gameState.dealerId}
              currentBidder={currentBidder}
              onPlaceBid={handlePlaceBid}
              biddingComplete={gameState.biddingComplete}
              biddingHistory={biddingHistory}
            />
          )}
        </div>
        <div className="game-table-container">
          {isKittyPhase && playerId === winningBidder ? (
            <div>
              <h2>Select 3 cards to discard</h2>
              <AnimatedHand
                hand={combinedHand}
                selectedCards={selectedCards}
                onCardClick={handleCardClick}
                trumpSuit={gameState.currentBid?.bid?.split(" ")[1]}
              />
              <button
                onClick={handleKittyDone}
                disabled={selectedCards.length !== 3}
                className="done-button"
              >
                Done discarding
              </button>
            </div>
          ) : (
            <GameTable
              playedCards={playedCards}
              opponentHandSize={opponentHandSize}
              opponentDummyHandSize={opponentDummyHandSize}
              playerHand={currentPlayerData.hand || []}
              playerDummyHand={dummyHand}
              onPlayCard={(card, isDummy) => playCard(card, isDummy)}
              isCurrentPlayer={playerId === currentPlayer}
              trumpSuit={gameState.trumpSuit}
              winningBidder={winningBidder}
              playerId={playerId}
            />
          )}
        </div>
      </div>
      {playerId !== currentPlayer &&
        currentPlayer &&
        gamePhase === "playing" && (
          <p className="waiting-message">
            Waiting for{" "}
            {gameState.players.find((p) => p.id === currentPlayer)?.name ||
              "the other player"}{" "}
            to play a card.
          </p>
        )}
    </div>
  );
}

export default App;
