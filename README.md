# 🍬 Marshmellow Mayhem

Ein Online-Merk- und Tauschkartenspiel für **2–6 Spieler** direkt im Browser – ohne Installation, ohne Anmeldung, ohne Server.
Weniger Punkte sind besser!

## Online mit Freunden spielen

1. Seite öffnen (GitHub-Pages-Link, siehe unten).
2. Namen eingeben → **Neuen Raum erstellen**.
3. Den **Einladungslink** (oder den 6-stelligen Code) an deine Freunde schicken.
4. Wenn alle in der Lobby sind: **Spiel starten**.

Alle Spieler verbinden sich mit einem kleinen **Spielserver auf Cloudflare** (Worker + Durable Object).
Der Server hält den Spielstand und schickt jedem nur das, was er sehen darf – das funktioniert in jedem Netz.

- **Neu laden / Verbindung weg?** Einfach denselben Link im selben Browser wieder öffnen – du landest auf deinem Platz.
  Bei kurzen Abbrüchen verbindet sich das Spiel automatisch neu.
- **Host weg?** Das Spiel läuft auf dem Server weiter. Solange der Host offline ist, dürfen alle anderen verwalten
  (z. B. nächste Runde, Offline-Spieler überspringen).
- Räume ohne Aktivität werden nach 24 Stunden automatisch gelöscht.

## Datenschutz & Sicherheit

- Keine Konten. Im Browser gespeichert werden nur dein Name und ein geheimer Schlüssel für deinen Platz im Raum.
- Der Spielserver sieht die Spieldaten (Namen, Karten) – sie werden nur für die Dauer des Raums gespeichert.
- Mitspieler sehen weder deine IP-Adresse noch deine verdeckten Karten. Fremde können den Platz eines
  Offline-Spielers nicht übernehmen.
- Der Server nimmt nur Verbindungen von der Spielseite an (`ALLOWED_ORIGINS` in `wrangler.toml`).

## Regeln (Kurzfassung)

Nach der Original-Spielanleitung von „Arschmallows“ – unter eigenem Namen und mit eigenen Karten.

- Jeder hat **6 verdeckte Karten** (Kindermodus: 4) und darf sich zu Rundenbeginn **2 davon einmal ansehen**.
- **Dein Zug:** Karte vom Nachziehstapel ziehen *oder* die oberste Ablagekarte nehmen, dann:
  1. **Tauschen** – verdeckt gegen eine eigene verdeckte Karte, die alte kommt offen auf die Ablage. Zug vorbei.
  2. **Ablehnen** – Karte (auch eine von der Ablage) zurück auf die Ablage legen und dafür eine eigene verdeckte Karte **aufdecken**; sie ist dann **gesperrt**.
  3. **Aktion** (nur Aktionskarten vom Stapel) – danach ist der Zug vorbei (kein Tauschen, kein Aufdecken).
- **Aktionskarten** (zählen am Ende ihren Wert!):
  👀 *Spicken* (9) – beliebige verdeckte Karte ansehen ·
  🔄 *Tauschen* (10) – eigene verdeckte Karte mit der verdeckten Karte eines Mitspielers tauschen ·
  ⏩ *Nochmal!* (11) – zwei weitere Züge.
- **Karten loswerden:** 3+ gleiche Zahlenkarten oder 2 gleiche Aktionskarten (verdeckt) alle gegen die aufgenommene Karte
  tauschen. Liegst du falsch, bleiben sie liegen und die neue Karte kommt als **Strafkarte** dazu.
- **Rundenende:** Jemand ruft zu Beginn seines Zuges **„MAYHEM!“** – oder hat nur noch offene Karten.
  Danach hat **jeder andere noch einen letzten Zug**. Hat der Rufer nicht die niedrigste Summe (Gleichstand zählt für ihn),
  werden seine Punkte **verdoppelt**.
- Nach **6 Runden** gewinnt die niedrigste Gesamtsumme. Wer in einer Runde die meisten Punkte hatte, beginnt die nächste.
- Ist der Nachziehstapel leer, wird die Ablage gemischt und die oberste Karte neu aufgedeckt.

**Deck (62 Karten):** Zahlen 0–8 je 5×, *Goldener Mallow* (−2) 1×, *Mallow-König* (−4) 1×, je 5 Aktionskarten (Spicken 9, Tauschen 10, Nochmal! 11).
Die Werte stammen von den Originalkarten; wie oft die Zahlen- und Aktionskarten vorkommen, ist angenommen.
Alle Werte lassen sich in `src/rules.js` → `CONFIG` anpassen.

## Veröffentlichen

### Spielseite (GitHub Pages)

1. Im Repo: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
2. Workflow **„Deploy to GitHub Pages“** läuft bei jedem Push automatisch.
3. Link: `https://symblic-hub.github.io/Arschmellow/`

### Spielserver (Cloudflare Workers, kostenlos)

Einmalig:
1. Cloudflare-Dashboard → oben rechts Profil → **My Profile → API Tokens → Create Token** →
   Vorlage **„Edit Cloudflare Workers“** → Token erstellen und kopieren.
2. **Account ID** kopieren (Workers-Übersicht, rechte Seitenleiste).
3. GitHub-Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` anlegen.
4. Tab **Actions → „Deploy game server“ → Run workflow**.

Danach wird der Server bei Änderungen an `server/`, `src/rules.js` oder `wrangler.toml` automatisch neu veröffentlicht.
Die Server-Adresse steht in `src/net.js` (`DEFAULT_SERVER`).

## Lokal entwickeln

```bash
npm install
npm test              # Regel- und Server-Tests (node --test)
npm run dev:server    # Spielserver lokal auf http://127.0.0.1:8787
npm run serve         # Spielseite auf http://localhost:8080/?server=ws://127.0.0.1:8787
npm run e2e           # Browser-Test: 3 Spieler gegen den lokalen Server (Playwright)
```

### Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/rules.js` | Komplette Spiellogik + gefilterte Sicht pro Spieler (läuft auf dem Server) |
| `server/roomcore.js` | Raumlogik: Beitreten, Host-Rechte, Wiedereinstieg, Sichten verschicken |
| `server/worker.js` | Cloudflare Worker + Durable Object (ein Raum = ein Objekt), WebSockets |
| `src/net.js` | WebSocket-Verbindung zum Server, Raumcodes |
| `src/main.js` | Raum-Sitzung im Browser: Verbinden, Zeitlimit, automatisches Neuverbinden |
| `src/ui.js` | Darstellung, Karten-Grafiken, Klick-Abläufe |
| `assets/` | Pixel-Art-Icons (`make_icon.py` erzeugt sie) |
