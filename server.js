const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const scores = [];

// Punktzahl speichern
app.post("/score", (req, res) => {
    const username = String(req.body.username || "Spieler").slice(0, 20);
    const score = Number(req.body.score || 0);

    if (!Number.isFinite(score) || score < 0) {
        return res.status(400).json({ error: "Ungültige Punktzahl" });
    }

    scores.push({
        username,
        score,
        date: new Date().toISOString()
    });

    scores.sort((a, b) => b.score - a.score);

    // Nur die besten 100 behalten
    scores.splice(100);

    res.json({ success: true });
});

// Rangliste abrufen
app.get("/scores", (req, res) => {
    res.json(scores);
});

app.get("/", (req, res) => {
    res.send("Zombie Rush 3D Server läuft!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});