# 🍬 Marshmellow Mayhem

Ein Online-Merk- und Tauschkartenspiel für **2–6 Spieler** direkt im Browser – ohne Installation, ohne Anmeldung, ohne Server.
Weniger Punkte sind besser!

## Online mit Freunden spielen

1. Seite öffnen (GitHub-Pages-Link, siehe unten).
2. Namen eingeben → **Neuen Raum erstellen**.
3. Den **Einladungslink** (oder den 6-stelligen Code) an deine Freunde schicken.
4. Wenn alle in der Lobby sind: **Spiel starten**.

Die Browser verbinden sich direkt miteinander (WebRTC über [PeerJS](https://peerjs.com)).
Wer den Raum erstellt, ist **Host**: Bei ihm läuft das Spiel. Lässt er den Tab offen, können alle weiterspielen.

- **Neu laden / Verbindung weg?** Einfach denselben Link im selben Browser wieder öffnen – du landest auf deinem Platz.
- **Host lädt neu?** Der Raum wird aus dem Browser-Speicher wiederhergestellt, die anderen verbinden sich automatisch neu.
- Funktioniert in Chrome, Edge, Firefox und Safari. In manchen Firmen- oder Schulnetzen ist WebRTC blockiert.

## Datenschutz & Sicherheit

- Es gibt keinen eigenen Server und keine Konten. Gespeichert wird nur lokal im Browser (Name, Raum des Hosts).
- Der öffentliche [PeerJS-Vermittlungsserver](https://peerjs.com) (0.peerjs.com) bringt die Browser nur zusammen;
  die Spieldaten laufen danach direkt zwischen den Spielern.
- Wie bei jeder direkten WebRTC-Verbindung können Mitspieler technisch die **IP-Adresse** der anderen sehen –
  also nur mit Leuten spielen, die man kennt.
- Das Spiel läuft im Browser des **Hosts**: Wer sich mit Entwicklertools auskennt, könnte dort alle Karten sehen.
  Alle anderen bekommen nur ihre eigene Sicht. Jeder Platz ist durch einen geheimen Schlüssel geschützt,
  Fremde können also nicht einfach den Platz eines Offline-Spielers übernehmen.

## Regeln (Kurzfassung)

- Jeder hat **6 verdeckte Karten** (kurzes Spiel: 4) und darf sich zu Rundenbeginn **2 davon einmal ansehen**.
- **Dein Zug:** Karte vom Stapel ziehen *oder* die oberste Ablagekarte nehmen →
  **tauschen** (blind gegen eine eigene verdeckte Karte), **ablegen** (nur Stapelkarten) oder **Aktion nutzen** (nur Aktionskarten vom Stapel) →
  zum Schluss **immer eine eigene verdeckte Karte aufdecken**. Offene Karten bleiben fix.
- **Aktionskarten** (zählen am Ende ihren Wert!):
  👀 *Spicken* (9) – beliebige verdeckte Karte ansehen ·
  🔄 *Tauschen* (10) – eigene verdeckte Karte blind mit der eines Mitspielers tauschen ·
  ⏩ *Nochmal!* (11) – zwei weitere Züge.
- **Gleiche abwerfen:** Zu Beginn deines Zuges 3+ gleiche Zahlenkarten oder 2+ Aktionskarten (verdeckt) abwerfen;
  du ziehst dafür eine Karte verdeckt nach. Passen sie nicht: Karten bleiben liegen **plus** Strafkarte.
- **Rundenende:** Jemand hat nur noch offene Karten – oder jemand ruft zu Beginn seines Zuges **„MAYHEM!“**.
  Hat der Rufer nicht die niedrigste Summe (Gleichstand zählt für ihn), werden seine Punkte **verdoppelt**.
- Nach **6 Runden** gewinnt die niedrigste Gesamtsumme. Wer in einer Runde die meisten Punkte hatte, beginnt die nächste.

**Deck (62 Karten):** Zahlen 0–8 je 5×, *Goldener Mallow* (−3) 1×, *Mallow-König* (−5) 1×, je 5 Aktionskarten.
Alle Werte lassen sich in `src/rules.js` → `CONFIG` anpassen.

## Veröffentlichen (GitHub Pages)

1. Im Repo: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
2. Den Workflow **„Deploy to GitHub Pages“** (Tab *Actions*) laufen lassen – oder einfach etwas pushen.
3. Der Link steht danach unter *Settings → Pages*, z. B. `https://<name>.github.io/Arschmellow/`.

Hinweis: GitHub Pages ist für **private** Repos nur mit bezahltem GitHub-Plan verfügbar – sonst Repo auf *public* stellen.

## Lokal entwickeln

```bash
npm install          # nur für Tests / lokalen PeerServer nötig
npm test             # Regel-Tests (node --test)
npm run e2e          # Browser-Test: 3 Spieler gegen lokalen PeerServer (Playwright)
npm run serve        # http://localhost:8080
```

Für einen eigenen PeerServer: `?peerHost=…&peerPort=…&peerSecure=1` an die URL hängen.

### Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/rules.js` | Komplette Spiellogik + gefilterte Sicht pro Spieler (kein DOM) |
| `src/net.js` | PeerJS-Hilfen (Raumcodes, Verbindung, Fehlertexte) |
| `src/main.js` | Host (autoritativ, hält den Zustand) und Client |
| `src/ui.js` | Darstellung, Karten-Grafiken, Klick-Abläufe |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 |

Der Host schickt jedem Spieler nur, was er sehen darf – fremde verdeckte Karten und gezogene Stapelkarten bleiben geheim.
