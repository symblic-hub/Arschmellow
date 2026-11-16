// Marshmellow Mayhem – Raumlogik des Spielservers (unabhängig vom Transport).
// Läuft im Cloudflare Durable Object (server/worker.js) und in den Node-Tests.
// Der Server ist maßgeblich: Er hält den Spielzustand und schickt jedem nur seine Sicht.

import { createGame, applyAction, viewFor, skipPlayer, RuleError, CONFIG } from '../src/rules.js';

export const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Mallow';

export function newSecret() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function sanitizeOptions(o = {}) {
  return { short: !!o.short, rounds: Math.max(1, Math.min(10, Math.round(Number(o.rounds)) || CONFIG.rounds)) };
}

/**
 * transport: {
 *   sockets(): [{ sock, pid }]   – alle offenen Verbindungen
 *   send(sock, msg)              – Nachricht (Objekt) senden
 *   setPid(sock, pid)            – Spieler-ID an die Verbindung hängen
 *   close(sock, code, reason)    – Verbindung schließen
 * }
 */
export class RoomCore {
  constructor(data, transport) {
    this.data = data ?? null; // { code, hostId, players: [{id, name, secret}], options, game, createdAt }
    this.t = transport;
  }

  isConnected(pid, except = null) {
    return this.t.sockets().some((s) => s.pid === pid && s.sock !== except);
  }

  /** Darf pid Host-Aktionen ausführen? Der Host – oder jeder, solange der Host offline ist. */
  canManage(pid) {
    return pid === this.data.hostId || !this.isConnected(this.data.hostId);
  }

  fatal(sock, msg, code = 'fatal') {
    this.t.send(sock, { t: 'fatal', msg, code });
    this.t.close(sock, 4000, code);
  }

  /** Verarbeitet eine Nachricht. Rückgabe true = Zustand geändert (speichern). */
  handle(sock, msg, pidOfSock, roomCode) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.t === 'hello') return this.hello(sock, msg, roomCode);
    if (msg.t === 'action') {
      if (!pidOfSock || !this.data) return false;
      return this.dispatch(pidOfSock, msg.action);
    }
    return false;
  }

  hello(sock, msg, roomCode) {
    const pid = String(msg.pid || '').slice(0, 40);
    const name = cleanName(msg.name);
    const secret = String(msg.secret || '').slice(0, 64);
    if (!/^[a-z0-9]{4,40}$/i.test(pid)) { this.fatal(sock, 'Ungültige Spieler-ID.'); return false; }

    let created = false;
    if (msg.create) {
      if (this.data) {
        // Gleicher Ersteller verbindet sich neu (z. B. doppelter Klick) → normal beitreten
        const me = this.data.players.find((p) => p.id === pid);
        if (!(me && me.secret === secret && pid === this.data.hostId)) { this.fatal(sock, 'Dieser Raumcode ist schon belegt.', 'taken'); return false; }
      } else {
        this.data = {
          code: roomCode,
          hostId: pid,
          players: [{ id: pid, name, secret: newSecret() }],
          options: sanitizeOptions(msg.options),
          game: null,
          createdAt: Date.now(),
        };
        created = true;
      }
    }
    if (!this.data) { this.fatal(sock, 'Raum nicht gefunden. Stimmt der Code?', 'notfound'); return false; }

    let p = this.data.players.find((x) => x.id === pid);
    // Bekannte Spieler-ID: Das Geheimnis muss passen (beim Erstellen wird es erst mit "welcome" ausgeliefert).
    if (p && !created && p.secret !== secret) { this.fatal(sock, 'Dieser Platz gehört jemand anderem.', 'secret'); return false; }
    if (!p) {
      // Wiedereinstieg mit neuer Tab-ID: nur mit dem geheimen Schlüssel eines Offline-Platzes
      const seat = secret && this.data.players.find((x) => x.secret === secret && !this.isConnected(x.id));
      if (seat) {
        p = seat;
      } else if (this.data.game) {
        this.fatal(sock, 'Das Spiel läuft schon. Nur Spieler, die vorher dabei waren, können wieder einsteigen (mit demselben Browser).', 'running');
        return false;
      } else if (this.data.players.length >= CONFIG.maxPlayers) {
        this.fatal(sock, 'Der Raum ist voll (max. 6 Spieler).', 'full');
        return false;
      } else {
        let unique = name;
        for (let i = 2; this.data.players.some((x) => x.name.toLowerCase() === unique.toLowerCase()); i++) unique = `${name} ${i}`;
        p = { id: pid, name: unique, secret: newSecret() };
        this.data.players.push(p);
      }
    }
    // Ältere Verbindung desselben Spielers ersetzen
    for (const s of this.t.sockets()) {
      if (s.pid === p.id && s.sock !== sock) {
        this.t.send(s.sock, { t: 'fatal', msg: 'Du hast das Spiel in einem anderen Fenster geöffnet.', code: 'replaced' });
        this.t.close(s.sock, 4001, 'replaced');
      }
    }
    this.t.setPid(sock, p.id);
    this.t.send(sock, { t: 'welcome', pid: p.id, secret: p.secret, code: this.data.code });
    this.broadcast(`${p.name} ist da! 👋`, p.id);
    return true;
  }

  dispatch(pid, action) {
    const d = this.data;
    try {
      const type = action?.type;
      const manage = () => { if (!this.canManage(pid)) throw new RuleError('Das darf nur der Host.'); };
      if (type === 'start') {
        manage();
        if (d.game) throw new RuleError('Das Spiel läuft schon.');
        d.game = createGame(d.players, d.options);
      } else if (type === 'options') {
        manage();
        if (d.game) throw new RuleError('Einstellungen nur in der Lobby.');
        d.options = sanitizeOptions(action.options);
      } else if (type === 'kick') {
        manage();
        if (d.game) throw new RuleError('Während des Spiels kann niemand entfernt werden.');
        if (action.pid === d.hostId) throw new RuleError('Der Host kann nicht entfernt werden.');
        d.players = d.players.filter((p) => p.id !== action.pid);
        for (const s of this.t.sockets()) {
          if (s.pid === action.pid) this.fatal(s.sock, 'Du wurdest vom Host aus dem Raum entfernt.', 'kicked');
        }
      } else if (type === 'skip') {
        manage();
        if (!d.game) throw new RuleError('Das Spiel hat noch nicht begonnen.');
        if (this.isConnected(action.pid)) throw new RuleError('Dieser Spieler ist online – nur Offline-Spieler können übersprungen werden.');
        skipPlayer(d.game, action.pid);
      } else if (type === 'newGame') {
        manage();
        d.game = null;
      } else {
        if (!d.game) throw new RuleError('Das Spiel hat noch nicht begonnen.');
        applyAction(d.game, pid, action);
      }
    } catch (e) {
      const msg = e instanceof RuleError ? e.message : 'Interner Fehler.';
      if (!(e instanceof RuleError)) console.error(e);
      for (const s of this.t.sockets()) if (s.pid === pid) this.t.send(s.sock, { t: 'error', msg });
      return false;
    }
    this.broadcast();
    return true;
  }

  onClose(sock, pid) {
    if (!this.data || !pid || this.isConnected(pid, sock)) return;
    const p = this.data.players.find((x) => x.id === pid);
    this.broadcast(p ? `${p.name} hat die Verbindung verloren.` : null, null, sock);
  }

  viewFor(pid, except = null) {
    const d = this.data;
    return {
      room: {
        code: d.code,
        me: pid,
        hostId: d.hostId,
        isHost: pid === d.hostId || !this.isConnected(d.hostId, except),
        options: d.options,
        players: d.players.map((p) => ({ id: p.id, name: p.name, connected: this.isConnected(p.id, except) })),
      },
      game: d.game ? viewFor(d.game, pid) : null,
    };
  }

  /** Schickt jedem verbundenen Spieler seine Sicht (optional mit Hinweis). */
  broadcast(notice = null, noticeExcept = null, except = null) {
    if (!this.data) return;
    for (const s of this.t.sockets()) {
      if (!s.pid || s.sock === except) continue;
      if (!this.data.players.some((p) => p.id === s.pid)) continue;
      const msg = { t: 'state', view: this.viewFor(s.pid, except) };
      if (notice && s.pid !== noticeExcept) msg.notice = notice;
      this.t.send(s.sock, msg);
    }
  }
}
