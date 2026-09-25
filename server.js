const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";

app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "32kb" }));

const db = new Database(path.join(__dirname, "zombie-rush.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  level INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeUsername(value) {
  return String(value || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + derived;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const actual = crypto.scryptSync(String(password), parts[1], 64);
  const expected = Buffer.from(parts[2], "hex");
  return expected.length === actual.length &&
    crypto.timingSafeEqual(actual, expected);
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(userId) {
  const token = createToken();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const session = db.prepare(`
    SELECT user_id FROM sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(hashToken(token), Date.now());

  if (!session) return null;
  return db.prepare("SELECT id, username FROM users WHERE id = ?")
    .get(session.user_id) || null;
}

function requireUser(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Nicht eingeloggt." });
  req.user = user;
  next();
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, game: "Zombie Rush 3D", version: "1.1.0" });
});

app.get("/api/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, s.score, s.wave, s.level, s.created_at
    FROM scores s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.score DESC, s.id ASC
    LIMIT 20
  `).all();
  res.json(rows);
});

app.post("/api/register", (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!/^[A-Za-z0-9_ -]{3,16}$/.test(username)) {
    return res.status(400).json({
      error: "Der Name muss 3 bis 16 Zeichen haben."
    });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({
      error: "Das Passwort muss 6 bis 128 Zeichen haben."
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash) VALUES (?, ?)
    `).run(username, hashPassword(password));

    res.status(201).json({
      token: createSession(result.lastInsertRowid),
      username
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({
        error: "Dieser Spielername ist bereits vergeben."
      });
    }
    console.error(error);
    res.status(500).json({ error: "Registrierung fehlgeschlagen." });
  }
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  const user = db.prepare(`
    SELECT id, username, password_hash FROM users WHERE username = ?
  `).get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({
      error: "Spielername oder Passwort ist falsch."
    });
  }

  res.json({
    token: createSession(user.id),
    username: user.username
  });
});

app.post("/api/logout", requireUser, (req, res) => {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "").trim();
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }
  res.json({ ok: true });
});

app.post("/api/scores", requireUser, (req, res) => {
  const score = Math.floor(Number(req.body.score));
  const wave = Math.floor(Number(req.body.wave));
  const level = Math.floor(Number(req.body.level));

  if (
    !Number.isFinite(score) || !Number.isFinite(wave) || !Number.isFinite(level) ||
    score < 0 || score > 1000000000 ||
    wave < 1 || wave > 100000 ||
    level < 1 || level > 100000
  ) {
    return res.status(400).json({ error: "Ungültiger Score." });
  }

  const result = db.prepare(`
    INSERT INTO scores (user_id, score, wave, level)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, score, wave, level);

  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

app.use(express.static(__dirname));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}, 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log("Zombie Rush 3D server läuft auf Port " + PORT);
});
