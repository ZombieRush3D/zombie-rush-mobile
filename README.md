# Zombie Rush 3D

Mobile Web-/Capacitor-App mit Login, Online-Rangliste und SQLite-Server.

## Web/Server

```bash
npm install
npm start
```

Danach ist die App unter `http://localhost:3000` erreichbar.

## Android

```bash
npm install
npm run prepare:web
npx cap add android
npx cap sync android
npx cap open android
```

## iOS

```bash
npm install
npm run prepare:web
npx cap add ios
npx cap sync ios
npx cap open ios
```

## API-Adresse

Für eine veröffentlichte mobile App kann die API-Adresse vor dem Spielstart gesetzt werden:

```js
window.ZOMBIE_RUSH_API_URL = "https://dein-server.example";
```

Ohne diese Variable nutzt die App die aktuelle Domain.

## Infrastruktur

- Login/Registrierung
- scrypt-Passwort-Hashing
- persistente Sessions mit Ablaufzeit
- SQLite-Datenbank
- Online-Rangliste
- Score-Upload
- Health-Endpoint
- Capacitor-Vorbereitung
- responsive Mobile-Oberfläche
