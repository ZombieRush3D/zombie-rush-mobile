const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL fehlt.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10
});

app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: "32kb" }));

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

async function createSession(userId) {
  const token = createToken();
  await pool.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS)]
  );
  return token;
}

async function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const session = await pool.query(
    `SELECT u.id, u.username
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  return session.rows[0] || null;
}

async function requireUser(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "Nicht eingeloggt." });
    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Authentifizierung fehlgeschlagen." });
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, game: "Zombie Rush 3D", version: "1.2.0" });
  } catch (error) {
    console.error(error);
    res.status(503).json({ ok: false, error: "Datenbank nicht erreichbar." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, s.score, s.wave, s.level, s.created_at
       FROM scores s JOIN users u ON u.id = s.user_id
       ORDER BY s.score DESC, s.id ASC LIMIT 20`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Rangliste konnte nicht geladen werden." });
  }
});

app.post("/api/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!/^[A-Za-z0-9_ -]{3,16}$/.test(username)) {
    return res.status(400).json({ error: "Der Name muss 3 bis 16 Zeichen haben." });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "Das Passwort muss 6 bis 128 Zeichen haben." });
  }

  try {
    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, hashPassword(password)]
    );
    res.status(201).json({
      token: await createSession(result.rows[0].id),
      username: result.rows[0].username
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Dieser Spielername ist bereits vergeben." });
    }
    console.error(error);
    res.status(500).json({ error: "Registrierung fehlgeschlagen." });
  }
});

app.post("/api/login", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username]
    );
    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Spielername oder Passwort ist falsch." });
    }

    res.json({
      token: await createSession(user.id),
      username: user.username
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Anmeldung fehlgeschlagen." });
  }
});

app.post("/api/logout", requireUser, async (req, res) => {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "").trim();
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token = $1", [hashToken(token)]);
  }
  res.json({ ok: true });
});

app.post("/api/scores", requireUser, async (req, res) => {
  const score = Math.floor(Number(req.body.score));
  const wave = Math.floor(Number(req.body.wave));
  const level = Math.floor(Number(req.body.level));

  if (!Number.isFinite(score) || !Number.isFinite(wave) || !Number.isFinite(level) ||
      score < 0 || score > 1000000000 || wave < 1 || wave > 100000 ||
      level < 1 || level > 100000) {
    return res.status(400).json({ error: "Ungültiger Score." });
  }

  try {
    const result = await pool.query(
      "INSERT INTO scores (user_id, score, wave, level) VALUES ($1, $2, $3, $4) RETURNING id",
      [req.user.id, score, wave, level]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Score konnte nicht gespeichert werden." });
  }
});

app.use(express.static(__dirname));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

setInterval(() => {
  pool.query("DELETE FROM sessions WHERE expires_at <= NOW()").catch(console.error);
}, 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log("Zombie Rush 3D server läuft auf Port " + PORT);
});
