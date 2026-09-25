const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "zombie-rush.db");

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  level INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_SCORE = 100_000_000;
const MAX_WAVE = 10000;
const MAX_LEVEL = 10000;
const SCORE_COOLDOWN_MS = 1500;
const lastScoreAt = new Map();

function normalizeUsername(value) { return String(value ?? "").trim(); }

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(":");
    if (parts[0] === "scrypt") {
      const [, saltHex, hashHex] = parts;
      if (!saltHex || !hashHex) return false;
      const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), 64);
      const expected = Buffer.from(hashHex, "hex");
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
    // Backward compatibility for accounts created by the previous server.
    const legacy = crypto.createHash("sha256").update(String(password)).digest("hex");
    return legacy === String(stored);
  } catch { return false; }
}

function createToken() { return crypto.randomBytes(32).toString("hex"); }
function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

function createSession(userId) {
  const token = createToken();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function getUserFromRequest(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), Date.now());
  return row ? { id: row.id, username: row.username, tokenHash: row.token_hash } : null;
}

function auth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Nicht eingeloggt." });
  req.user = user;
  next();
}

function validateGameStats(score, wave, level) {
  return Number.isSafeInteger(score) && score >= 0 && score <= MAX_SCORE
    && Number.isSafeInteger(wave) && wave >= 1 && wave <= MAX_WAVE
    && Number.isSafeInteger(level) && level >= 1 && level <= MAX_LEVEL;
}

app.get("/", (req, res) => res.json({ game: "Zombie Rush 3D", online: true, api: 1 }));
app.get("/api/health", (req, res) => res.json({ ok: true, game: "Zombie Rush 3D", time: new Date().toISOString() }));

app.post("/api/register", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? "");
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return res.status(400).json({ error: "Der Name muss 3 bis 16 Zeichen haben und darf nur Buchstaben, Zahlen und _ enthalten." });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "Das Passwort muss 6 bis 128 Zeichen haben." });
  }
  try {
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
    res.status(201).json({ token: createSession(result.lastInsertRowid), username });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "Dieser Name ist bereits vergeben." });
    console.error(error);
    res.status(500).json({ error: "Registrierung fehlgeschlagen." });
  }
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? "");
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: "Benutzername oder Passwort falsch." });
  if (!String(user.password_hash).startsWith("scrypt:")) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
  }
  res.json({ token: createSession(user.id), username: user.username });
});

app.post("/api/logout", auth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.user.tokenHash);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => res.json({ id: req.user.id, username: req.user.username }));

app.get("/api/leaderboard", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 100);
  const rows = db.prepare(`
    SELECT s.user_id, u.username, s.score, s.wave, s.level, s.created_at
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM scores s2
      WHERE s2.user_id = s.user_id
      AND (s2.score > s.score OR
        (s2.score = s.score AND s2.wave > s.wave) OR
        (s2.score = s.score AND s2.wave = s.wave AND s2.level > s.level) OR
        (s2.score = s.score AND s2.wave = s.wave AND s2.level = s.level AND s2.id < s.id))
    )
    ORDER BY s.score DESC, s.wave DESC, s.level DESC, s.id ASC
    LIMIT ?
  `).all(limit).map((row, index) => ({
    rank: index + 1, username: row.username, score: Number(row.score),
    wave: Number(row.wave), level: Number(row.level), createdAt: row.created_at
  }));
  res.json(rows);
});

app.get("/api/leaderboard/me", auth, (req, res) => {
  const best = db.prepare(`SELECT score FROM scores WHERE user_id = ? ORDER BY score DESC, wave DESC, level DESC, id ASC LIMIT 1`).get(req.user.id);
  if (!best) return res.json({ rank: null, bestScore: 0, username: req.user.username });
  const better = db.prepare(`SELECT COUNT(*) AS count FROM (SELECT user_id, MAX(score) AS best_score FROM scores GROUP BY user_id) WHERE best_score > ?`).get(best.score);
  res.json({ rank: Number(better.count) + 1, bestScore: Number(best.score), username: req.user.username });
});

app.post("/api/scores", auth, (req, res) => {
  const score = Number(req.body?.score);
  const wave = Number(req.body?.wave);
  const level = Number(req.body?.level);
  if (!validateGameStats(score, wave, level)) return res.status(400).json({ error: "Ungültige Spielwerte." });
  const previous = lastScoreAt.get(req.user.id) || 0;
  if (Date.now() - previous < SCORE_COOLDOWN_MS) return res.status(429).json({ error: "Bitte kurz warten." });
  lastScoreAt.set(req.user.id, Date.now());
  if (score > (wave * 250000) + (level * 50000)) return res.status(400).json({ error: "Score ist für Wave/Level nicht plausibel." });
  const result = db.prepare("INSERT INTO scores (user_id, score, wave, level) VALUES (?, ?, ?, ?)").run(req.user.id, score, wave, level);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

app.use(express.static(__dirname));
const server = app.listen(PORT, "0.0.0.0", () => console.log(`Zombie Rush server listening on port ${PORT}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
