import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { getSocket } from "../socket";
import ThemedTable from "../components/ThemedTable";
import ThemePicker from "../components/ThemePicker";
import ContractPanel from "../components/ContractPanel";
import LastTrickPanel from "../components/LastTrickPanel";
import BiddingInterface from "../components/BiddingInterface";
import GameTable from "../components/GameTable";
import AnimatedHand from "../components/AnimatedHand";
import ScoreHistoryModal from "../components/ScoreHistoryModal";
import OfferModal from "../components/OfferModal";
import RoundEndModal from "../components/RoundEndModal";
import RoundReviewModal from "../components/RoundReviewModal";
import Confetti from "../components/Confetti";
import { DEFAULT_LOCATION, DEFAULT_DECK } from "../theme";
import "../App.css";

function GameRoomPage() {
  const { id: gameId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const socket = useMemo(() => (session ? getSocket(session.token) : null), [session]);

  // Following an invite link without an account sends you to the home page to
  // log in or sign up — carry where you were headed, so signing up lands you
  // in the game you were invited to instead of dumping you on the home page
  // with the link lost. `replace` so the back button doesn't bounce you
  // straight back out again.
  useEffect(() => {
    if (!session) {
      navigate("/", { replace: true, state: { from: location.pathname + location.search } });
    }
  }, [session, navigate, location.pathname, location.search]);

  const [gameState, setGameState] = useState(null);
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [joinRejected, setJoinRejected] = useState(null);
  const [gameSettings, setGameSettings] = useState({
    showOfferPassButton: true,
    showOfferRetroactivePassButton: true,
    location: DEFAULT_LOCATION,
    deck: DEFAULT_DECK,
  });
  const [offerPassDeclined, setOfferPassDeclined] = useState(false);
  const [offerRetroactivePassDeclined, setOfferRetroactivePassDeclined] = useState(false);
  const [pendingOfferReceived, setPendingOfferReceived] = useState(null);
  const [offerStatusMessage, setOfferStatusMessage] = useState("");
  const [waitingForOfferResponse, setWaitingForOfferResponse] = useState(false);
  const [pendingClaimReceived, setPendingClaimReceived] = useState(null);
  const [waitingForClaimResponse, setWaitingForClaimResponse] = useState(false);
  const [claimStatusMessage, setClaimStatusMessage] = useState("");
  const [revealedClaimerId, setRevealedClaimerId] = useState(null);
  const [currentBidder, setCurrentBidder] = useState(null);
  const [biddingHistory, setBiddingHistory] = useState([]);
  const [isKittyPhase, setIsKittyPhase] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [currentTurnIsDummy, setCurrentTurnIsDummy] = useState(false);
  const [gamePhase, setGamePhase] = useState("waiting");
  const [roundNumber, setRoundNumber] = useState(1);
  const [redealCount, setRedealCount] = useState(0);
  const [scoreHistory, setScoreHistory] = useState([]);
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  const [gameOverInfo, setGameOverInfo] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const [roundEndInfo, setRoundEndInfo] = useState(null);
  const [reviewData, setReviewData] = useState(null);
  const [replay, setReplay] = useState(null);
  const [lastTrick, setLastTrick] = useState(null);
  const [pendingJokerLead, setPendingJokerLead] = useState(null);
  const [incomingRematchOffer, setIncomingRematchOffer] = useState(null);
  const [waitingForRematchResponse, setWaitingForRematchResponse] = useState(false);
  const [rematchStatusMessage, setRematchStatusMessage] = useState("");

  const [combinedHand, setCombinedHand] = useState([]);
  const [selectedCards, setSelectedCards] = useState([]);

  const [playedCards, setPlayedCards] = useState([]);
  const [invalidPlayMessage, setInvalidPlayMessage] = useState("");
  // A finished trick lingers on the table for 2s, then flies out, before
  // clearing. If the next trick's first card arrives before that finishes, it
  // means we've moved on already — start the new trick fresh instead of
  // appending onto the old (about-to-vanish) one. Each pending-clear cycle
  // gets its own token rather than a plain boolean: a background tab can
  // throttle these timeouts arbitrarily, so a *second* trick can resolve (and
  // start its own cycle) before the first cycle's delayed timeout finally
  // fires — a boolean can't tell that stale timeout apart from the current
  // one, so it ends up firing the wrong trick's fly/clear against whatever's
  // on the table by then. A token that must match exactly fixes that.
  const trickTokenCounterRef = useRef(0);
  const pendingClearTokenRef = useRef(null);
  const replayTrickTokenCounterRef = useRef(0);
  const replayPendingClearTokenRef = useRef(null);
  const [flyingWinner, setFlyingWinner] = useState(null);
  // Tracks the server's log seq of the last "cardPlayed" we actually saw, so
  // a dropped broadcast (a connectivity blip that doesn't fully disconnect)
  // shows up as a gap instead of silently leaving stale face-down cards in
  // the opponent's hand/dummy until someone happens to refresh the page.
  const lastPlaySeqRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    const join = () => socket.emit("joinRoom", { gameId });
    if (socket.connected) join();
    socket.on("connect", join);

    socket.on("joinRejected", ({ message } = {}) =>
      setJoinRejected(message || "This game already has two players.")
    );

    socket.on("gameSettingsUpdated", (settings) => setGameSettings(settings));
    socket.on("offerReceived", ({ type, fromName }) => setPendingOfferReceived({ type, fromName }));
    socket.on("offerDeclined", ({ byName }) => {
      setWaitingForOfferResponse(false);
      setOfferStatusMessage(`${byName} declined your offer.`);
    });
    socket.on("offerFlagsUpdate", ({ offerPassDeclined: p, offerRetroactivePassDeclined: rp }) => {
      setOfferPassDeclined(p);
      setOfferRetroactivePassDeclined(rp);
    });
    socket.on("playersUpdate", ({ count }) => setConnectedPlayers(count));

    socket.on("claimReceived", ({ fromName, claimerId }) => {
      setPendingClaimReceived({ fromName });
      setRevealedClaimerId(claimerId);
    });
    socket.on("claimResolved", ({ accepted, claimerId, revealedClaimerId: newRevealedId, byName, players }) => {
      setPendingClaimReceived(null);
      setWaitingForClaimResponse(false);
      if (accepted) {
        setClaimStatusMessage("");
        setGameState((prevState) => ({
          ...prevState,
          players: prevState.players.map((p) => {
            const updated = players.find((u) => u.id === p.id);
            return updated ? { ...p, hand: updated.hand, dummyHand: updated.dummyHand, tricksWon: updated.tricksWon } : p;
          }),
        }));
        setPlayedCards([]);
      } else {
        setRevealedClaimerId(newRevealedId);
        setClaimStatusMessage(
          claimerId === playerId ? `${byName} didn't agree — your hands stay visible for the rest of the round.` : ""
        );
      }
    });

    socket.on("gameStart", (initialState) => {
      setGameState(initialState);
      setCurrentBidder(initialState.currentBidder);
      setBiddingHistory([]);
      setGamePhase("bidding");
      setIsKittyPhase(false);
      setCombinedHand([]);
      setSelectedCards([]);
      setPlayedCards([]);
      pendingClearTokenRef.current = null;
      lastPlaySeqRef.current = null;
      setFlyingWinner(null);
      setLastTrick(null);
      setCurrentPlayer(null);
      setCurrentTurnIsDummy(false);
      setInvalidPlayMessage("");
      setRoundNumber(initialState.roundNumber || 1);
      setRedealCount(initialState.redealCount || 0);
      setScoreHistory(initialState.scoreHistory || []);
      setGameOverInfo(null);
      setRoundResult(null);
      setRoundEndInfo(null);
      setReviewData(null);
      setReplay(null);
      setIncomingRematchOffer(null);
      setWaitingForRematchResponse(false);
      setRematchStatusMessage("");
      if (initialState.gameSettings) setGameSettings(initialState.gameSettings);
      setOfferPassDeclined(initialState.offerPassDeclined || false);
      setOfferRetroactivePassDeclined(initialState.offerRetroactivePassDeclined || false);
      setPendingOfferReceived(null);
      setOfferStatusMessage("");
      setWaitingForOfferResponse(false);
      setPendingJokerLead(null);
      setPendingClaimReceived(null);
      setWaitingForClaimResponse(false);
      setClaimStatusMessage("");
      setRevealedClaimerId(null);
    });

    socket.on("updateGame", (newState) => {
      setGameState((prevState) => ({ ...prevState, ...newState }));
      if (newState.currentBidder) setCurrentBidder(newState.currentBidder);
      if (newState.biddingHistory) setBiddingHistory(newState.biddingHistory);
    });

    socket.on("biddingComplete", (finalBid, history, trumpSuit) => {
      setGameState((prevState) => ({ ...prevState, currentBid: finalBid, trumpSuit, biddingComplete: true }));
      setCurrentBidder(null);
      setBiddingHistory(history);
      setGamePhase("kitty");
    });

    socket.on("showKitty", (kittyCards) => {
      setIsKittyPhase(true);
      setGameState((prevState) => {
        if (!prevState) return prevState;
        const currentPlayerHand = prevState.players.find((p) => p.id === playerId)?.hand || [];
        const newCombinedHand = [...currentPlayerHand, ...kittyCards.map((card) => ({ ...card, isKitty: true }))];
        setCombinedHand(newCombinedHand);
        return {
          ...prevState,
          players: prevState.players.map((p) => (p.id === playerId ? { ...p, hand: newCombinedHand } : p)),
        };
      });
    });

    socket.on("kittyPhaseComplete", ({ currentPlayer: startingPlayer, currentIsDummy, players: dummyDeal }) => {
      setIsKittyPhase(false);
      setGamePhase("playing");
      setCurrentPlayer(startingPlayer);
      setCurrentTurnIsDummy(currentIsDummy || false);
      setGameState((prevState) => ({
        ...prevState,
        players: prevState.players.map((p) => {
          const dealt = dummyDeal?.find((d) => d.id === p.id);
          return dealt ? { ...p, dummyHand: dealt.dummyHand, tricksWon: dealt.tricksWon } : p;
        }),
      }));
    });

    socket.on("cardPlayed", ({ playerId: cardPlayerId, card, isDummy, seq }) => {
      if (seq !== undefined) {
        if (lastPlaySeqRef.current !== null && seq !== lastPlaySeqRef.current + 1) {
          socket.emit("joinRoom", { gameId });
        }
        lastPlaySeqRef.current = seq;
      }
      const isFreshTrick = pendingClearTokenRef.current !== null;
      pendingClearTokenRef.current = null;
      setPlayedCards((prev) => {
        const base = isFreshTrick ? [] : prev;
        return [...base, { playerId: cardPlayerId, card, isDummy }];
      });
      if (isFreshTrick) setFlyingWinner(null);
      setGameState((prevState) => {
        if (!prevState) return prevState;
        return {
          ...prevState,
          players: prevState.players.map((p) => {
            if (p.id !== cardPlayerId) return p;
            const key = isDummy ? "dummyHand" : "hand";
            return { ...p, [key]: (p[key] || []).filter((c) => !(c.suit === card.suit && c.value === card.value)) };
          }),
        };
      });
      if (cardPlayerId === playerId) setInvalidPlayMessage("");
    });

    socket.on("invalidPlay", ({ message }) => setInvalidPlayMessage(message));

    socket.on("gameResumed", (state) => {
      setGameState({
        players: state.players,
        dealerId: state.dealerId,
        currentBid: state.currentBid,
        trumpSuit: state.trumpSuit,
        biddingComplete: state.gamePhase !== "bidding",
      });
      setCurrentBidder(state.currentBidder);
      setBiddingHistory(state.biddingHistory || []);
      setGamePhase(state.gamePhase);
      setCurrentPlayer(state.currentPlayer);
      setCurrentTurnIsDummy(state.currentIsDummy || false);
      setPlayedCards(state.playedCards || []);
      pendingClearTokenRef.current = null;
      lastPlaySeqRef.current = null;
      setFlyingWinner(null);
      setLastTrick(state.lastTrick || null);
      setIsKittyPhase(state.gamePhase === "kitty");
      setRoundNumber(state.roundNumber || 1);
      setRedealCount(state.redealCount || 0);
      setScoreHistory(state.scoreHistory || []);
      setGameOverInfo(null);
      setRoundResult(state.roundResult || null);
      setRoundEndInfo(null);
      setReviewData(null);
      setReplay(null);
      setIncomingRematchOffer(null);
      setWaitingForRematchResponse(false);
      setRematchStatusMessage("");
      if (state.gameSettings) setGameSettings(state.gameSettings);
      setOfferPassDeclined(state.offerPassDeclined || false);
      setOfferRetroactivePassDeclined(state.offerRetroactivePassDeclined || false);
      setPendingOfferReceived(null);
      setOfferStatusMessage("");
      setWaitingForOfferResponse(false);
      setClaimStatusMessage("");
      setRevealedClaimerId(state.revealedClaimerId || null);
      const claim = state.pendingClaim;
      setPendingClaimReceived(claim && claim.fromPlayerId !== playerId ? { fromName: claim.fromName } : null);
      setWaitingForClaimResponse(Boolean(claim && claim.fromPlayerId === playerId));
    });

    socket.on("gameOver", (info) => {
      setGameOverInfo(info);
      setScoreHistory(info.scoreHistory || []);
    });

    socket.on("roundResult", (result) => setRoundResult(result));
    // Broadcast room-wide whenever the game (re-)enters roundEnd/gameOver —
    // including right after the review controller clicks "Back to round" —
    // so this also clears reviewData for the other player, who otherwise had
    // no signal that review had ended and would stay stuck looking at it.
    socket.on("roundEndState", (info) => {
      setRoundEndInfo(info);
      if (info.scoreHistory) setScoreHistory(info.scoreHistory);
      setReviewData(null);
    });
    socket.on("reviewStart", (data) => setReviewData(data));
    socket.on("reviewStepChanged", ({ index }) => setReviewData((d) => (d ? { ...d, stepIndex: index } : d)));

    socket.on("rematchOffered", ({ fromName }) => setIncomingRematchOffer({ fromName }));
    socket.on("rematchDeclined", ({ byName }) => {
      setWaitingForRematchResponse(false);
      setRematchStatusMessage(`${byName} declined your rematch offer.`);
    });
    socket.on("rematchStarted", ({ gameId: newGameId }) => navigate(`/game/${newGameId}`));

    socket.on("trickResolved", ({ winner, winnerIsDummy, newScores, lastTrick: resolved }) => {
      setGameState((prev) => ({
        ...prev,
        players: prev.players.map((p) => {
          const updated = newScores.find((s) => s.id === p.id);
          return updated ? { ...p, score: updated.score, tricksWon: updated.tricksWon } : p;
        }),
      }));
      if (resolved) setLastTrick(resolved);
      const token = ++trickTokenCounterRef.current;
      pendingClearTokenRef.current = token;
      setTimeout(() => {
        if (pendingClearTokenRef.current !== token) return;
        setFlyingWinner({ winnerId: winner, winnerIsDummy: winnerIsDummy || false });
        setTimeout(() => {
          if (pendingClearTokenRef.current === token) {
            pendingClearTokenRef.current = null;
            setPlayedCards([]);
            setFlyingWinner(null);
          }
        }, 600);
      }, 2000);
    });

    socket.on("updateCurrentPlayer", ({ playerId: newCurrentPlayer, isDummy }) => {
      setCurrentPlayer(newCurrentPlayer);
      setCurrentTurnIsDummy(isDummy || false);
    });

    socket.on("allPlayersPassed", () => {
      setGameState((prevState) => ({ ...prevState, biddingComplete: true, currentBid: null }));
      setCurrentBidder(null);
    });

    socket.on("updateHand", (newHand) => {
      setGameState((prevState) => ({
        ...prevState,
        players: prevState.players.map((p) => (p.id === playerId ? { ...p, hand: newHand } : p)),
      }));
    });

    socket.on("updateGamePhase", (phase) => setGamePhase(phase));

    // ---- replay: mirrors the live listeners above, but into `replay` state ----

    socket.on("replayStart", (data) => {
      replayPendingClearTokenRef.current = null;
      setReplay({
        players: data.players,
        currentBid: data.currentBid,
        trumpSuit: data.trumpSuit,
        playedCards: [],
        currentPlayer: null,
        currentTurnIsDummy: false,
        isKittyPhase: false,
        kitty: null,
        combinedHand: [],
        selectedCards: [],
        invalidPlayMessage: "",
        pendingJokerLead: null,
        result: null,
        flyingWinner: null,
      });
    });

    socket.on("replayShowKitty", (kittyCards) => {
      setReplay((r) => {
        if (!r) return r;
        const mine = r.players.find((p) => p.id === playerId)?.hand || [];
        const combined = [...mine, ...kittyCards.map((c) => ({ ...c, isKitty: true }))];
        return { ...r, kitty: kittyCards, isKittyPhase: true, combinedHand: combined };
      });
    });

    socket.on("replayKittyPhaseComplete", ({ currentPlayer: sp, currentIsDummy, players: dummyDeal, playedCards: pc }) => {
      setReplay((r) => {
        if (!r) return r;
        return {
          ...r,
          isKittyPhase: false,
          kitty: null,
          currentPlayer: sp,
          currentTurnIsDummy: currentIsDummy || false,
          playedCards: pc || [],
          players: r.players.map((p) => {
            const dealt = dummyDeal?.find((d) => d.id === p.id);
            return dealt ? { ...p, dummyHand: dealt.dummyHand, tricksWon: dealt.tricksWon } : p;
          }),
        };
      });
    });

    socket.on("replayCardPlayed", ({ playerId: cardPlayerId, card, isDummy }) => {
      setReplay((r) => {
        if (!r) return r;
        const base = replayPendingClearTokenRef.current !== null ? [] : r.playedCards;
        replayPendingClearTokenRef.current = null;
        return {
          ...r,
          invalidPlayMessage: cardPlayerId === playerId ? "" : r.invalidPlayMessage,
          flyingWinner: null,
          playedCards: [...base, { playerId: cardPlayerId, card, isDummy }],
          players: r.players.map((p) => {
            if (p.id !== cardPlayerId) return p;
            const key = isDummy ? "dummyHand" : "hand";
            return { ...p, [key]: (p[key] || []).filter((c) => !(c.suit === card.suit && c.value === card.value)) };
          }),
        };
      });
    });

    socket.on("replayTrickResolved", ({ winner, winnerIsDummy, newScores }) => {
      setReplay((r) => {
        if (!r) return r;
        return {
          ...r,
          players: r.players.map((p) => {
            const updated = newScores.find((s) => s.id === p.id);
            return updated ? { ...p, tricksWon: updated.tricksWon } : p;
          }),
        };
      });
      const token = ++replayTrickTokenCounterRef.current;
      replayPendingClearTokenRef.current = token;
      setTimeout(() => {
        if (replayPendingClearTokenRef.current !== token) return;
        setReplay((r) => (r ? { ...r, flyingWinner: { winnerId: winner, winnerIsDummy: winnerIsDummy || false } } : r));
        setTimeout(() => {
          if (replayPendingClearTokenRef.current === token) {
            replayPendingClearTokenRef.current = null;
            setReplay((r) => (r ? { ...r, playedCards: [], flyingWinner: null } : r));
          }
        }, 600);
      }, 2000);
    });

    socket.on("replayUpdateCurrentPlayer", ({ playerId: p, isDummy }) =>
      setReplay((r) => (r ? { ...r, currentPlayer: p, currentTurnIsDummy: isDummy || false } : r))
    );
    socket.on("replayInvalidPlay", ({ message }) =>
      setReplay((r) => (r ? { ...r, invalidPlayMessage: message } : r))
    );
    socket.on("replayResult", (result) => setReplay((r) => (r ? { ...r, result } : r)));

    return () => {
      socket.emit("leaveRoom", { gameId });
      socket.off("connect", join);
      [
        "joinRejected",
        "gameSettingsUpdated",
        "offerReceived",
        "offerDeclined",
        "offerFlagsUpdate",
        "playersUpdate",
        "claimReceived",
        "claimResolved",
        "gameStart",
        "updateGame",
        "biddingComplete",
        "showKitty",
        "kittyPhaseComplete",
        "cardPlayed",
        "invalidPlay",
        "gameResumed",
        "gameOver",
        "roundResult",
        "roundEndState",
        "reviewStart",
        "reviewStepChanged",
        "trickResolved",
        "updateCurrentPlayer",
        "allPlayersPassed",
        "updateHand",
        "updateGamePhase",
        "replayStart",
        "replayShowKitty",
        "replayKittyPhaseComplete",
        "replayCardPlayed",
        "replayTrickResolved",
        "replayUpdateCurrentPlayer",
        "replayInvalidPlay",
        "replayResult",
        "rematchOffered",
        "rematchDeclined",
        "rematchStarted",
      ].forEach((event) => socket.off(event));
    };
  }, [socket, gameId, playerId, navigate]);

  // ---- live handlers ----

  const playCard = (card, isDummy = false) => {
    if (playerId === currentPlayer && isDummy === currentTurnIsDummy) {
      const isLeading = playedCards.length === 0;
      if (isLeading && card.suit === "Joker" && !gameState.trumpSuit) {
        setPendingJokerLead({ card, isDummy });
        return;
      }
      socket.emit("playCard", { card, isDummy });
    }
  };

  const handleNominateSuit = (suit) => {
    socket.emit("playCard", { card: pendingJokerLead.card, isDummy: pendingJokerLead.isDummy, nominatedSuit: suit });
    setPendingJokerLead(null);
  };

  const handlePlaceBid = (bidOption) => {
    socket.emit("placeBid", { bid: bidOption.bid, points: bidOption.points });
  };

  const handleSetGameSettings = (partialSettings) => {
    setGameSettings((prev) => {
      const updated = { ...prev, ...partialSettings };
      socket.emit("setGameSettings", updated);
      return updated;
    });
  };

  const handleOfferPass = () => {
    socket.emit("offerPass");
    setOfferStatusMessage("");
    setWaitingForOfferResponse(true);
  };

  const handleOfferRetroactivePass = () => {
    socket.emit("offerRetroactivePass");
    setOfferStatusMessage("");
    setWaitingForOfferResponse(true);
  };

  const handleRespondToOffer = (accept) => {
    socket.emit("respondToOffer", { accept });
    setPendingOfferReceived(null);
  };

  const handleClaimRest = () => {
    socket.emit("claimRest");
    setClaimStatusMessage("");
    setWaitingForClaimResponse(true);
  };

  const handleRespondToClaim = (accept) => {
    socket.emit("respondToClaim", { accept });
    setPendingClaimReceived(null);
  };

  const handleCardClick = (index) => {
    if (selectedCards.includes(index)) setSelectedCards(selectedCards.filter((i) => i !== index));
    else if (selectedCards.length < 3) setSelectedCards([...selectedCards, index]);
  };

  const handleKittyDone = () => {
    if (selectedCards.length !== 3) return;
    const newHand = combinedHand
      .filter((_, index) => !selectedCards.includes(index))
      .map((card) => ({ ...card, isKitty: false }));
    setGameState((prevState) => ({
      ...prevState,
      players: prevState.players.map((p) => (p.id === playerId ? { ...p, hand: newHand } : p)),
    }));
    socket.emit("kittyDone", { newHand });
    setIsKittyPhase(false);
    setSelectedCards([]);
    setCombinedHand(newHand);
  };

  // ---- round-end negotiation handlers ----

  const handleReady = () => socket.emit("roundEndReady");
  const handlePropose = (type) => socket.emit("roundEndPropose", { type });
  const handleRespondRoundEnd = (accept) => socket.emit("roundEndRespond", { accept });
  const handleReviewStep = (index) => socket.emit("reviewStep", { index });
  const handleReviewDone = () => {
    socket.emit("reviewDone");
    setReviewData(null);
  };

  const handleRematchOffer = () => {
    socket.emit("rematchOffer");
    setRematchStatusMessage("");
    setWaitingForRematchResponse(true);
  };
  const handleRespondRematch = (accept) => {
    socket.emit("rematchRespond", { accept });
    setIncomingRematchOffer(null);
  };

  // ---- replay handlers (mirror the live ones, tagged mode: "replay") ----

  const handleReplayCardClick = (index) => {
    setReplay((r) => {
      if (!r) return r;
      const sel = r.selectedCards.includes(index)
        ? r.selectedCards.filter((i) => i !== index)
        : r.selectedCards.length < 3
        ? [...r.selectedCards, index]
        : r.selectedCards;
      return { ...r, selectedCards: sel };
    });
  };

  const handleReplayKittyDone = () => {
    setReplay((r) => {
      if (!r || r.selectedCards.length !== 3) return r;
      const newHand = r.combinedHand
        .filter((_, i) => !r.selectedCards.includes(i))
        .map((c) => ({ ...c, isKitty: false }));
      socket.emit("kittyDone", { newHand, mode: "replay" });
      return { ...r, isKittyPhase: false, selectedCards: [], combinedHand: newHand };
    });
  };

  const handleReplayPlayCard = (card, isDummy = false) => {
    setReplay((r) => {
      if (!r || playerId !== r.currentPlayer || isDummy !== r.currentTurnIsDummy) return r;
      const isLeading = r.playedCards.length === 0;
      if (isLeading && card.suit === "Joker" && !r.trumpSuit) return { ...r, pendingJokerLead: { card, isDummy } };
      socket.emit("playCard", { card, isDummy, mode: "replay" });
      return r;
    });
  };

  const handleReplayNominateSuit = (suit) => {
    setReplay((r) => {
      if (!r || !r.pendingJokerLead) return r;
      socket.emit("playCard", {
        card: r.pendingJokerLead.card,
        isDummy: r.pendingJokerLead.isDummy,
        nominatedSuit: suit,
        mode: "replay",
      });
      return { ...r, pendingJokerLead: null };
    });
  };

  const handleReplayReturn = () => setReplay(null);

  const locationId = gameSettings.location || DEFAULT_LOCATION;
  const deckId = gameSettings.deck || DEFAULT_DECK;

  if (!session) return null;

  if (joinRejected) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} plain>
        <div className="room-full">
          <p>{joinRejected}</p>
          <p>
            <Link to="/">Back to home</Link>
          </p>
        </div>
      </ThemedTable>
    );
  }

  if (!gameState || !gameState.players) {
    if (connectedPlayers <= 1) {
      return (
        <ThemedTable locationId={locationId} deckId={deckId}>
          <div className="table-topbar">
            <h1 className="table-title">500</h1>
            <ThemePicker
              locationId={locationId}
              deckId={deckId}
              onChange={handleSetGameSettings}
            />
          </div>
          <div className="waiting-panel panel">
            <h2>Waiting for your opponent</h2>
            <p>Send them this link:</p>
            <input
              className="share-link"
              readOnly
              value={window.location.href}
              onClick={(e) => e.target.select()}
            />
            <div className="settings-list">
              <label>
                <input
                  type="checkbox"
                  checked={gameSettings.showOfferPassButton}
                  onChange={(e) => handleSetGameSettings({ showOfferPassButton: e.target.checked })}
                />
                Show &quot;Offer a pass&quot; button
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={gameSettings.showOfferRetroactivePassButton}
                  onChange={(e) =>
                    handleSetGameSettings({ showOfferRetroactivePassButton: e.target.checked })
                  }
                />
                Show &quot;Offer a retroactive pass&quot; button
              </label>
            </div>
          </div>
        </ThemedTable>
      );
    }
    return (
      <ThemedTable locationId={locationId} deckId={deckId}>
        <div className="waiting-panel">
          <p>Loading game state…</p>
        </div>
      </ThemedTable>
    );
  }

  const currentPlayerData = gameState.players.find((p) => p.id === playerId);
  const otherPlayerData = gameState.players.find((p) => p.id !== playerId);

  if (!currentPlayerData) {
    return (
      <ThemedTable locationId={locationId} deckId={deckId} plain>
        <div className="room-full">Error: player not found in game state</div>
      </ThemedTable>
    );
  }

  const opponentName = otherPlayerData?.name || "Opponent";

  // Open Misère: the bidder's hand is exposed to the opponent once the
  // bidder has lost their first trick. Winning a trick ends the round
  // instantly for a Misère bidder (see isRoundDecided), so their tricksWon
  // can never reach 1 while the round is still live — the reveal condition
  // has to be "at least one trick has been played, and the bidder still
  // hasn't won one," not "the bidder has won one."
  const viewingOpenMisereBidder =
    gameState.currentBid?.bid === "Open Misere" && gameState.currentBid.player !== playerId;
  const tricksPlayedSoFar = (currentPlayerData?.tricksWon || 0) + (otherPlayerData?.tricksWon || 0);
  const revealedBidderHand =
    viewingOpenMisereBidder && tricksPlayedSoFar >= 1 && (otherPlayerData?.tricksWon || 0) === 0
      ? otherPlayerData?.hand
      : null;

  // A declined "I've got the rest" claim leaves the claimer's hand and dummy
  // visible to the other player for the rest of the round.
  const revealedOpponentHand = revealedClaimerId === otherPlayerData?.id ? otherPlayerData.hand : null;
  const revealedOpponentDummyHand = revealedClaimerId === otherPlayerData?.id ? otherPlayerData.dummyHand : null;

  const replayCurrentPlayerData = replay?.players.find((p) => p.id === playerId);
  const replayOtherPlayerData = replay?.players.find((p) => p.id !== playerId);

  // Same Open Misère reveal rule as the live game (see viewingOpenMisereBidder
  // above), just evaluated against the replay's own bid/tricks instead.
  const viewingOpenMisereBidderInReplay =
    replay?.currentBid?.bid === "Open Misere" && replay.currentBid.player !== playerId;
  const replayTricksPlayedSoFar =
    (replayCurrentPlayerData?.tricksWon || 0) + (replayOtherPlayerData?.tricksWon || 0);
  const replayRevealedBidderHand =
    viewingOpenMisereBidderInReplay &&
    replayTricksPlayedSoFar >= 1 &&
    (replayOtherPlayerData?.tricksWon || 0) === 0
      ? replayOtherPlayerData?.hand
      : null;

  // One line under the table saying whose move it is and what's trumps.
  const statusText = (() => {
    if (gamePhase !== "playing") return null;
    const trumpNote = gameState.trumpSuit
      ? ` — ${gameState.trumpSuit} are trumps`
      : gameState.currentBid?.bid?.includes("Misere")
      ? " — no trumps"
      : "";
    if (playerId === currentPlayer) {
      return `Your turn, from your ${currentTurnIsDummy ? "dummy" : "hand"}${trumpNote}`;
    }
    return `${opponentName}'s turn, from their ${
      currentTurnIsDummy ? "dummy" : "hand"
    }${trumpNote}`;
  })();

  const suitNominator = (onPick, onCancel) => (
    <div className="offer-modal-overlay">
      <div className="offer-modal">
        <p>Nominate a suit for the Joker:</p>
        <div className="offer-modal-buttons">
          {["♠", "♣", "♥", "♦"].map((suit) => (
            <button key={suit} onClick={() => onPick(suit)}>
              {suit}
            </button>
          ))}
        </div>
        {onCancel && (
          <div className="offer-modal-buttons" style={{ marginTop: 10 }}>
            <button onClick={onCancel}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );

  // Shared between the game-over screen and the normal in-game screen: the
  // score-history graph, and the review/replay overlays (both work exactly
  // the same way once a hand is over, whether or not the game itself is).
  const commonOverlays = (
    <>
      {showScoreHistory && (
        <ScoreHistoryModal
          scoreHistory={scoreHistory}
          players={gameState.players}
          onClose={() => setShowScoreHistory(false)}
        />
      )}
      {reviewData && (
        <RoundReviewModal
          round={reviewData.round}
          log={reviewData.log}
          players={gameState.players}
          stepIndex={reviewData.stepIndex || 0}
          isController={reviewData.controllerId === playerId}
          controllerName={
            gameState.players.find((p) => p.id === reviewData.controllerId)?.name || "The other player"
          }
          onStep={handleReviewStep}
          onDone={handleReviewDone}
          deckId={deckId}
        />
      )}
      {!reviewData && replay && (
        <div className="replay-overlay">
          <div className="replay-panel">
            <p className="replay-banner">Replay — this won&apos;t count towards your game</p>
            {replay.result ? (
              <div className="replay-result-box">
                <p>
                  {replay.result.bidderName} bid {replay.result.bid} and{" "}
                  {replay.result.bidderMadeBid ? "made it!" : "missed it."}
                </p>
                <button className="btn-primary" onClick={handleReplayReturn}>
                  Return to round
                </button>
              </div>
            ) : replay.isKittyPhase && replay.currentBid?.player === playerId ? (
              <div className="replay-kitty">
                <h2>Select 3 cards to discard</h2>
                <AnimatedHand
                  hand={replay.combinedHand}
                  selectedCards={replay.selectedCards}
                  onCardClick={handleReplayCardClick}
                  trumpSuit={replay.trumpSuit}
                  deckId={deckId}
                />
                <button
                  className="btn-primary"
                  onClick={handleReplayKittyDone}
                  disabled={replay.selectedCards.length !== 3}
                >
                  Throw three &amp; play
                </button>
              </div>
            ) : replay.isKittyPhase ? (
              <p className="replay-result-box">
                Waiting for {replayOtherPlayerData?.name} to discard to the kitty.
              </p>
            ) : (
              <>
                <div className="replay-status">
                  <span>
                    Tricks — You: {replayCurrentPlayerData?.tricksWon || 0}, {replayOtherPlayerData?.name}:{" "}
                    {replayOtherPlayerData?.tricksWon || 0}
                  </span>
                  <span>
                    {playerId === replay.currentPlayer
                      ? `Your turn to play from your ${replay.currentTurnIsDummy ? "dummy hand" : "hand"}`
                      : `${replayOtherPlayerData?.name}'s turn to play from their ${
                          replay.currentTurnIsDummy ? "dummy hand" : "hand"
                        }`}
                  </span>
                </div>
                <GameTable
                  playedCards={replay.playedCards}
                  opponentHandSize={replayOtherPlayerData?.hand?.length || 0}
                  opponentDummyHandSize={replayOtherPlayerData?.dummyHand?.length || 0}
                  playerHand={replayCurrentPlayerData?.hand || []}
                  playerDummyHand={replayCurrentPlayerData?.dummyHand || []}
                  onPlayCard={(card, isDummy) => handleReplayPlayCard(card, isDummy)}
                  isCurrentPlayerHandTurn={playerId === replay.currentPlayer && !replay.currentTurnIsDummy}
                  isCurrentPlayerDummyTurn={playerId === replay.currentPlayer && replay.currentTurnIsDummy}
                  trumpSuit={replay.trumpSuit}
                  winningBidder={replay.currentBid?.player}
                  playerId={playerId}
                  revealedBidderHand={replayRevealedBidderHand}
                  flyingWinner={replay.flyingWinner}
                  deckId={deckId}
                  opponentName={replayOtherPlayerData?.name || "Opponent"}
                  playerTricksWon={replayCurrentPlayerData?.tricksWon || 0}
                  opponentTricksWon={replayOtherPlayerData?.tricksWon || 0}
                  compact
                />
              </>
            )}
            {replay.invalidPlayMessage && (
              <p className="invalid-play-message">{replay.invalidPlayMessage}</p>
            )}
            {replay.pendingJokerLead && suitNominator(handleReplayNominateSuit)}
          </div>
        </div>
      )}
    </>
  );

  if (gameOverInfo) {
    const didIWin = gameOverInfo.winner.id === playerId;
    const loser = gameOverInfo.players.find((p) => p.id !== gameOverInfo.winner.id);
    // "Going out the back door": losing by dropping to -500 or below, rather
    // than the other player reaching 500 — mutually exclusive outcomes (see
    // finishRound), so the loser's score alone tells us which one happened.
    const wentOutBackDoor = (loser?.score ?? 0) <= -500;
    const subtext = wentOutBackDoor
      ? `${loser.id === playerId ? "You" : loser.name} went out the back door`
      : `${didIWin ? "You" : gameOverInfo.winner.name} won with ${gameOverInfo.winner.score} points`;

    const proposal = roundEndInfo?.proposal;
    const proposalIsMine = proposal?.fromUserId === playerId;
    const proposalIsIncoming = proposal && !proposalIsMine;

    return (
      <ThemedTable locationId={locationId} deckId={deckId} dimmed>
        {didIWin && <Confetti />}
        <div className="game-over-card">
          <p className="overline">Game over</p>
          <h1>{didIWin ? "You win" : "Better luck next time"}</h1>
          <p className="game-over-subtext">{subtext}</p>

          <ul className="game-over-scores">
            {gameOverInfo.players.map((p) => (
              <li key={p.id}>
                <span>{p.id === playerId ? "You" : p.name}</span>
                <b>{p.score}</b>
              </li>
            ))}
          </ul>

          {proposalIsIncoming ? (
            <div className="round-end-proposal">
              <p>
                {proposal.fromName} wants to {proposal.type === "review" ? "review" : "replay"} the
                last hand. Do you agree?
              </p>
              <div className="round-end-proposal-buttons">
                <button className="btn-primary" onClick={() => handleRespondRoundEnd(true)}>
                  Yes
                </button>
                <button className="btn-ghost" onClick={() => handleRespondRoundEnd(false)}>
                  No
                </button>
              </div>
            </div>
          ) : proposalIsMine ? (
            <p className="round-end-waiting">Waiting for a response to your invite…</p>
          ) : waitingForRematchResponse ? (
            <p className="round-end-waiting">Waiting for a response to your rematch offer…</p>
          ) : (
            <div className="game-over-buttons">
              <button className="btn-primary" onClick={handleRematchOffer}>
                Offer a rematch
              </button>
              <button className="btn-ghost" onClick={() => handlePropose("review")}>
                Review last hand
              </button>
              <button className="btn-ghost" onClick={() => handlePropose("replay")}>
                Replay last hand
              </button>
              <button className="btn-ghost" onClick={() => setShowScoreHistory(true)}>
                Score history
              </button>
              <Link to="/" className="btn-ghost">
                Back to home
              </Link>
            </div>
          )}
          {rematchStatusMessage && <p className="invalid-play-message">{rematchStatusMessage}</p>}
        </div>

        {commonOverlays}
        {incomingRematchOffer && (
          <OfferModal
            type="rematch"
            fromName={incomingRematchOffer.fromName}
            onRespond={handleRespondRematch}
          />
        )}
      </ThemedTable>
    );
  }

  const isDiscarding = isKittyPhase && playerId === gameState.currentBid?.player;

  return (
    <ThemedTable locationId={locationId} deckId={deckId} dimmed={isDiscarding}>
      <div className="table-topbar">
        <div>
          <h1 className="table-title">500</h1>
          <p className="table-subtitle">
            {currentPlayerData.name} vs {opponentName}
          </p>
        </div>
        <ThemePicker
          locationId={locationId}
          deckId={deckId}
          onChange={handleSetGameSettings}
          compact
        />
      </div>

      {isDiscarding ? (
        <div className="kitty-screen">
          <div>
            <h2 className="kitty-heading">
              You won the bid with {gameState.currentBid?.bid} for {gameState.currentBid?.points}
            </h2>
            <p className="kitty-subheading">
              The kitty is yours — take these three, then throw any three back.
            </p>
          </div>
          <div className="kitty-hand-wrap">
            <AnimatedHand
              hand={combinedHand}
              selectedCards={selectedCards}
              onCardClick={handleCardClick}
              trumpSuit={gameState.trumpSuit}
              deckId={deckId}
            />
          </div>
          <div className="kitty-actions">
            <span className="pill">{selectedCards.length} of 3 chosen</span>
            <button
              className="btn-primary"
              onClick={handleKittyDone}
              disabled={selectedCards.length !== 3}
            >
              Throw three &amp; play
            </button>
          </div>
        </div>
      ) : (
        <div className="board-row">
          <ContractPanel
            currentBid={gameState.currentBid}
            bidderName={
              gameState.players.find((p) => p.id === gameState.currentBid?.player)?.name
            }
            playerIsBidder={gameState.currentBid?.player === playerId}
            playerScore={currentPlayerData.score}
            opponentScore={otherPlayerData?.score ?? 0}
            opponentName={opponentName}
            playerTricksWon={currentPlayerData.tricksWon || 0}
            roundNumber={roundNumber}
            redealCount={redealCount}
            gamePhase={gamePhase}
            dealerIsYou={gameState.dealerId === playerId}
            trumpSuit={gameState.trumpSuit}
            onShowScoreHistory={() => setShowScoreHistory(true)}
            canClaimRest={
              gamePhase === "playing" && playerId === currentPlayer && playedCards.length === 0
            }
            waitingForClaimResponse={waitingForClaimResponse}
            claimStatusMessage={claimStatusMessage}
            onClaimRest={handleClaimRest}
          />

          <div className="board-center">
            <GameTable
              playedCards={playedCards}
              opponentHandSize={otherPlayerData?.hand?.length || 0}
              opponentDummyHandSize={gamePhase === "playing" ? otherPlayerData?.dummyHand?.length || 0 : 10}
              playerHand={currentPlayerData.hand || []}
              playerDummyHand={currentPlayerData.dummyHand || []}
              onPlayCard={(card, isDummy) => playCard(card, isDummy)}
              isCurrentPlayerHandTurn={playerId === currentPlayer && !currentTurnIsDummy}
              isCurrentPlayerDummyTurn={playerId === currentPlayer && currentTurnIsDummy}
              trumpSuit={gameState.trumpSuit}
              winningBidder={gameState.currentBid?.player}
              playerId={playerId}
              revealedBidderHand={revealedBidderHand}
              revealedOpponentHand={revealedOpponentHand}
              revealedOpponentDummyHand={revealedOpponentDummyHand}
              flyingWinner={flyingWinner}
              deckId={deckId}
              opponentName={opponentName}
              playerTricksWon={currentPlayerData.tricksWon || 0}
              opponentTricksWon={otherPlayerData?.tricksWon || 0}
              statusText={statusText}
            />

            {gamePhase === "bidding" && (
              <div className="centered-panel">
                <BiddingInterface
                  currentBid={gameState.currentBid}
                  players={gameState.players}
                  playerId={playerId}
                  currentBidder={currentBidder}
                  onPlaceBid={handlePlaceBid}
                  biddingComplete={gameState.biddingComplete}
                  biddingHistory={biddingHistory}
                  gameSettings={gameSettings}
                  offerPassDeclined={offerPassDeclined}
                  offerRetroactivePassDeclined={offerRetroactivePassDeclined}
                  waitingForOfferResponse={waitingForOfferResponse}
                  onOfferPass={handleOfferPass}
                  onOfferRetroactivePass={handleOfferRetroactivePass}
                  playerScore={currentPlayerData.score}
                  opponentScore={otherPlayerData?.score ?? 0}
                  opponentName={opponentName}
                />
              </div>
            )}

            {isKittyPhase && !isDiscarding && (
              <div className="centered-panel">
                <div className="panel waiting-panel">
                  <p>Waiting for {opponentName} to take the kitty and discard.</p>
                </div>
              </div>
            )}

            {pendingClaimReceived && (
              <OfferModal
                type="claimRest"
                fromName={pendingClaimReceived.fromName}
                onRespond={handleRespondToClaim}
                scoped
              />
            )}

            {(offerStatusMessage || invalidPlayMessage) && (
              <div className="floating-message">
                {offerStatusMessage && <p className="invalid-play-message">{offerStatusMessage}</p>}
                {invalidPlayMessage && <p className="invalid-play-message">{invalidPlayMessage}</p>}
              </div>
            )}
          </div>

          <LastTrickPanel
            lastTrick={lastTrick}
            playerId={playerId}
            deckId={deckId}
            opponentName={opponentName}
          />
        </div>
      )}

      {pendingOfferReceived && (
        <OfferModal
          type={pendingOfferReceived.type}
          fromName={pendingOfferReceived.fromName}
          onRespond={handleRespondToOffer}
        />
      )}
      {pendingJokerLead && suitNominator(handleNominateSuit, () => setPendingJokerLead(null))}

      {commonOverlays}

      {!reviewData && !replay && roundResult && roundEndInfo && (
        <RoundEndModal
          result={roundResult}
          roundEndInfo={roundEndInfo}
          playerId={playerId}
          onReady={handleReady}
          onPropose={handlePropose}
          onRespond={handleRespondRoundEnd}
          scoreHistory={scoreHistory}
          players={gameState.players}
          roundNumber={roundNumber}
        />
      )}
    </ThemedTable>
  );
}

export default GameRoomPage;
