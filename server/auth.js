const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign({ userId: user._id, name: user.name }, JWT_SECRET, { expiresIn: "365d" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware: requires "Authorization: Bearer <token>", attaches req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  req.user = payload;
  next();
}

// socket.io connection middleware: verifies the handshake auth token.
function socketAuth(socket, next) {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload) return next(new Error("Unauthorized"));
  socket.userId = payload.userId;
  socket.userName = payload.name;
  next();
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken, requireAuth, socketAuth };
