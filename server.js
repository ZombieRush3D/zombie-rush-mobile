const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DATABASE_PATH || "zombie-rush.db");

app.use(cors());
app.use(express.json({ limit: "32kb" }));
db.pragma("foreign_keys = ON");

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

db.prepare(`
  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

const defaultProfile = {
  credits: 800,
  weapons: [true, false, false, false, false, false, false, false, false],
  equipped: 0,
  upgrades: { vitality: 0, damage: 0, mobility: 0 }
};
const sessions = new Map();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (stored.startsWith("scrypt$")) {
    const [, salt, expectedHex] = stored.split("$");
    const expected = Buffer.from(expectedHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  // Upgrade accounts created by the earlier SHA-256 implementation after successful login.
  const legacy = Buffer.from(crypto.createHash("sha256").update(password).digest("hex"), "hex");
  const expected = Buffer.from(stored, "hex");
  return expected.length === legacy.length && crypto.timingSafeEqual(expected, legacy);
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const userId = token && sessions.get(token);
  if (!userId) return null;
  return db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId) || null;
}

function requireUser(req, res, next) {
  req.user = getUser(req);
  if (!req.user) return res.status(401).json({ error: "Bitte erneut einloggen." });
  next();
}

function ensureProfile(userId) {
  db.prepare("INSERT OR IGNORE INTO profiles (user_id, data) VALUES (?, ?)")
    .run(userId, JSON.stringify(defaultProfile));
}

function publicProfile(userId) {
  ensureProfile(userId);
  const row = db.prepare("SELECT data FROM profiles WHERE user_id = ?").get(userId);
  try {
    return { ...defaultProfile, ...JSON.parse(row.data) };
  } catch {
    return { ...defaultProfile };
  }
}

app.use(express.static("www"));
app.get("/api/health", (_req, res) => res.json({ game: "Zombie Rush 3D", online: true }));

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 3 || username.length > 16) {
    return res.status(400).json({ error: "Der Name muss 3 bis 16 Zeichen haben." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Das Passwort muss mindestens 8 Zeichen haben." });
  }
  try {
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(username, hashPassword(password));
    ensureProfile(result.lastInsertRowid);
    const token = createToken();
    sessions.set(token, Number(result.lastInsertRowid));
    return res.status(201).json({ token, username });
  } catch (error) {
    if (String(error.code).includes("CONSTRAINT")) {
      return res.status(409).json({ error: "Dieser Spielername ist bereits vergeben." });
    }
    console.error("Registration failed:", error);
    return res.status(500).json({ error: "Registrierung fehlgeschlagen." });
  }
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Name oder Passwort ist falsch." });
  }
  if (!user.password_hash.startsWith("scrypt$")) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
  }
  ensureProfile(user.id);
  const token = createToken();
  sessions.set(token, user.id);
  return res.json({ token, username: user.username });
});

app.get("/api/leaderboard", (_req, res) => {
  const rows = db.prepare(`
    SELECT users.username, MAX(scores.score) AS score
    FROM scores JOIN users ON users.id = scores.user_id
    GROUP BY users.id, users.username
    ORDER BY score DESC
    LIMIT 20
  `).all();
  return res.json(rows);
});

app.post("/api/scores", requireUser, (req, res) => {
  const score = Math.floor(Number(req.body.score));
  const wave = Math.floor(Number(req.body.wave));
  const level = Math.floor(Number(req.body.level));
  if (![score, wave, level].every(Number.isFinite) || score < 0 || wave < 1 || level < 1) {
    return res.status(400).json({ error: "Ungültiger Score." });
  }
  db.prepare("INSERT INTO scores (user_id, score, wave, level) VALUES (?, ?, ?, ?)")
    .run(req.user.id, score, wave, level);
  return res.status(201).json({ saved: true });
});

app.get("/api/profile", requireUser, (req, res) => res.json(publicProfile(req.user.id)));

app.put("/api/profile", requireUser, (req, res) => {
  const input = req.body || {};
  const upgrades = input.upgrades || {};
  const profile = {
    credits: Math.max(0, Math.min(1000000000, Math.floor(Number(input.credits) || 0))),
    weapons: Array.isArray(input.weapons) ? input.weapons.slice(0, 32).map(Boolean) : defaultProfile.weapons,
    equipped: Math.max(0, Math.min(31, Math.floor(Number(input.equipped) || 0))),
    upgrades: {
      vitality: Math.max(0, Math.min(10, Math.floor(Number(upgrades.vitality) || 0))),
      damage: Math.max(0, Math.min(10, Math.floor(Number(upgrades.damage) || 0))),
      mobility: Math.max(0, Math.min(10, Math.floor(Number(upgrades.mobility) || 0)))
    }
  };
  profile.weapons[0] = true;
  if (!profile.weapons[profile.equipped]) profile.equipped = 0;
  db.prepare(`
    INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, JSON.stringify(profile));
  return res.json({ saved: true });
});

app.listen(PORT, () => console.log(`Zombie Rush server listening on ${PORT}`));
