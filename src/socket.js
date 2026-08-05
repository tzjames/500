import io from "socket.io-client";

// On Render the server serves this same build, so omitting the URL entirely
// (undefined) makes socket.io-client connect back to the page's own origin.
// The localhost fallback only matters for local dev, where the API runs on
// a separate port.
const SOCKET_URL =
  process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production" ? undefined : "http://localhost:5001");

let socket = null;
let socketToken = null;

// One connection per logged-in token; reused across page navigations so
// leaving and returning to a room doesn't churn the connection.
export function getSocket(token) {
  if (socket && socketToken === token) return socket;
  if (socket) socket.disconnect();
  socketToken = token;
  socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    auth: { token },
    // Same ngrok free-tier interstitial as api.js's fetch calls — this only
    // reaches the polling transport's plain HTTP requests (browsers won't let
    // JS attach custom headers to a raw WebSocket upgrade), but that's enough
    // to get the handshake through; a failed websocket upgrade just falls
    // back to polling, which is fine for this game.
    extraHeaders: { "ngrok-skip-browser-warning": "true" },
  });
  return socket;
}
