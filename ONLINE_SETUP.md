# Zombie Rush 3D – Online-Server

Der Branch `feature/online-leaderboard` enthält Login, Registrierung, Sessions, SQLite und Leaderboard-API.

## Server online stellen

1. Bei Render anmelden.
2. **New + → Web Service** wählen.
3. Dieses GitHub-Repository verbinden.
4. Branch `feature/online-leaderboard` auswählen.
5. Render erkennt `render.yaml` oder verwendet:
   - Build: `npm install --no-audit --no-fund`
   - Start: `npm start`
6. Nach dem Deploy `https://DEIN-RENDER-NAME.onrender.com/api/health` öffnen.
7. Wenn `ok: true` erscheint, läuft die API.

## API

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/leaderboard`
- `GET /api/leaderboard/me`
- `POST /api/scores`

## Wichtig für Android

Die Android-App braucht die öffentliche URL dieses Servers als `SERVER_URL` in `index.html`. Die aktuelle Datei enthält noch den Platzhalter `DEINE-SERVER-ADRESSE`.

Nach dem Render-Deploy die URL dort eintragen und anschließend den Android-Workflow erneut ausführen.

Für dauerhaft gespeicherte Ranglisten-Daten braucht der Server einen persistenten Speicher oder eine externe Datenbank. Das kostenlose Render-Dateisystem ist nicht als dauerhafte SQLite-Speicherung gedacht.
