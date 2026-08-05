import io from "socket.io-client";

const SOCKET_URL = process.env.REACT_APP_API_URL || "http://localhost:5001";

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
  });
  return socket;
}
