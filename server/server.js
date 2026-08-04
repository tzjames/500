const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const Game500 = require("./gameLogic");

const app = express();
app.use(cors());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../build")));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5001;

let game = null;
let players = new Map(); // Change Set to Map to store player names
let currentBidder = null;
let biddingHistory = [];

io.on("connection", (socket) => {
  console.log("New client connected", socket.id);

  if (players.size < 2) {
    players.set(socket.id, { name: null }); // Store player with null name initially
    console.log("Player added. Total players:", players.size);

    io.emit("playerCount", players.size);

    if (players.size === 2) {
      io.emit("readyForNames"); // Emit event to prompt for names
    }
  } else {
    console.log("Room is full. Rejecting connection.");
    socket.emit("roomFull");
    socket.disconnect(true);
    return;
  }

  socket.on("setPlayerName", (name, callback) => {
    if (players.has(socket.id)) {
      players.get(socket.id).name = name;
      console.log(`Player ${socket.id} set name to ${name}`);

      // Check if both players have joined and set their names
      if (players.size === 2 && [...players.values()].every((player) => player.name)) {
        startGame();
      } else {
        // Notify all clients about the updated player count and names
        io.emit("playersUpdate", {
          count: players.size,
          players: Array.from(players.values()).map((p) => ({
            id: p.id,
            name: p.name,
          })),
        });
      }
    }
    if (callback) callback();
  });

  socket.on("ping", (callback) => {
    console.log("Received ping from", socket.id);
    callback({
      status: "ok",
      playerCount: players.size,
    });
  });

  socket.on("playCard", ({ playerId, card, isDummy }) => {
    if (game && playerId === game.currentPlayer) {
      game.playCard(playerId, card, isDummy);
      io.emit("cardPlayed", { playerId, card, isDummy });

      if (game.currentTrick.length === 4) {
        const trickWinner = game.resolveTrick();
        io.emit("trickResolved", {
          winner: trickWinner,
          newScores: game.players.map((p) => ({ id: p.id, score: p.score })),
        });
      }

      game.currentPlayer = game.players.find((p) => p.id !== playerId).id;
      io.emit("updateCurrentPlayer", game.currentPlayer);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected", socket.id);
    players.delete(socket.id);
    console.log("Player removed. Total players:", players.size);
    io.emit("playerCount", players.size);
    if (players.size === 0) {
      game = null;
    }
  });

  socket.on("placeBid", ({ playerId, bid, points }) => {
    console.log("Received bid:", { playerId, bid, points });
    if (game && playerId === currentBidder) {
      const newBid = { player: playerId, bid, points };

      biddingHistory.push(newBid);

      if (bid === "Pass") {
        const winningBid = biddingHistory.filter((b) => b.bid !== "Pass").pop();
        if (winningBid) {
          game.currentBid = winningBid;
          const kitty = game.dealKitty();
          io.emit("biddingComplete", winningBid, biddingHistory);
          io.to(winningBid.player).emit("showKitty", kitty);
        } else {
          io.emit("allPlayersPassed");
        }
      } else {
        game.currentBid = newBid;
        // Switch to the other player for bidding
        currentBidder = game.players.find((p) => p.id !== playerId).id;
        io.emit("updateGame", {
          currentBid: game.currentBid,
          currentBidder,
          biddingHistory,
        });
      }
    } else {
      console.log(
        "Invalid bid:",
        game ? "Not current bidder" : "Game not initialized"
      );
    }
  });

  // Remove or comment out this event listener as it's now handled in placeBid
  // socket.on("biddingComplete", (finalBid) => {
  //   console.log("Bidding complete:", finalBid);
  //   game.currentBid = finalBid;
  //   const kitty = game.dealKitty();
  //   io.to(finalBid.player).emit("showKitty", kitty);
  // });

  socket.on("swapCard", ({ playerId, handCardIndex, kittyCardIndex }) => {
    game.swapCard(playerId, handCardIndex, kittyCardIndex);
    const updatedHand = game.players.find((p) => p.id === playerId).hand;
    io.to(playerId).emit("updateHand", updatedHand);
  });

  socket.on("kittyDone", (playerId, newHand) => {
    const winningPlayer = game.players.find((p) => p.id === playerId);
    winningPlayer.hand = newHand;
    game.dealDummyHands();
    game.currentPlayer = playerId;

    io.emit("kittyPhaseComplete", {
      winningBidder: playerId,
      currentPlayer: playerId,
    });
  });
});

function startGame() {
  console.log("Starting game...");
  game = new Game500();
  console.log("Game instance created");

  const playerIds = Array.from(players.keys());
  const playerNames = Array.from(players.values()).map((p) => p.name);

  // Assign the correct player IDs
  game.players[0].id = playerIds[0];
  game.players[1].id = playerIds[1];

  const gameStartData = game.startGame();

  gameStartData.players = gameStartData.players.map((player, index) => ({
    ...player,
    name: playerNames[index],
  }));

  // Set the initial bidder (non-dealer)
  currentBidder = playerIds.find((id) => id !== gameStartData.dealerId);

  console.log("Game start data:", JSON.stringify(gameStartData, null, 2));
  io.emit("gameStart", { ...gameStartData, currentBidder });
  console.log("gameStart event emitted");

  biddingHistory = []; // Reset bidding history for new game

  // Set the initial game phase
  io.emit("updateGamePhase", "bidding");
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
