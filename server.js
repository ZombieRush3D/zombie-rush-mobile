const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const db = new Database("zombie-rush.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    wave INTEGER NOT NULL,
    level INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

const sessions = new Map();

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getUserFromRequest(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) return null;

  const userId = sessions.get(token);

  if (!userId) return null;

  return db
    .prepare("SELECT id, username FROM users WHERE id = ?")
    .get(userId);
}

app.get("/", (req, res) => {
  res.json({
    game: "Zombie Rush 3D",
    online: true
  });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username.length < 3 || username.length > 16) {
    return res.status(400).json({
      error: "Der Name muss 3 bis 16 Zeichen haben."
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: "Das Passwort muss mindestens 6 Zeichen haben."
    });
  }

  const passwordHash = hashPassword(password);

  try {
    const result = db
      .prepare(`
        INSERT INTO users (username, password_hash)
        VALUES (?, ?)
      `)
      .run(username, passwordHash);

    const token = createToken();

    sessions.set(token, result.last