# Zombie Rush Mobile

Zombie Rush Mobile ist ein mobiles 3D-Zombie-Survival-Spiel mit Login, SQLite-Profilen, Rangliste und dauerhaftem Waffen-Loadout.

## Server starten

1. Node.js installieren und im Repository `npm install` ausführen.
2. `npm start` startet den Express-Server. Er liefert das Spiel aus `www/` aus und stellt Login-, Ranglisten- und Profil-Endpunkte bereit.
3. In Render als Web Service deployen und als Start Command `npm start` verwenden.
4. Für dauerhafte SQLite-Daten in Render einen Persistent Disk mounten, zum Beispiel unter `/var/data`, und die Umgebungsvariable `DATABASE_PATH=/var/data/zombie-rush.db` setzen. Ohne persistenten Datenträger können Konten und Spielstände bei einem neuen Deploy oder Neustart verloren gehen.

Die browserbasierte Version nutzt automatisch dieselbe Domain für API und Spiel. Für eine Capacitor-App muss die Serverdomain vor dem Laden der Spielseite als `window.ZOMBIE_RUSH_API_URL` gesetzt werden.

## Konten und Fortschritt

Registrierung und Login verwenden den SQLite-Server. Passwörter werden mit scrypt und individuellem Salt gespeichert; vorhandene SHA-256-Konten werden nach erfolgreichem Login auf scrypt umgestellt. Guthaben, freigeschaltete Waffen und Upgrades werden pro Konto in der `profiles`-Tabelle gespeichert.
