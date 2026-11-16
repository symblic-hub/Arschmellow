import { createGame, applyAction, viewFor, skipPlayer, RuleError, CONFIG } from './rules.js';
import { makeCode, normalizeCode, openHostPeer, openClientPeer, peerIdFor, describePeerError } from './net.js';
import * as ui from './ui.js';

// ---------------------------------------------------------------- Speicher (fehlertolerant)

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const local = {
  get: (k) => safe(() => localStorage.getItem(k)),
  set: (k, v) => safe(() => localStorage.setItem(k, v)),
  del: (k) => safe(() => localStorage.removeItem(k)),
};
const session = {
  get: (k) => safe(() => sessionStorage.getItem(k)),
  set: (k, v) => safe(() => sessionStorage.setItem(k, v)),
};

function myPid() {
  let id = session.get('mm-pid');
  if (!id) {
    id = 'p' + Math.random().toString(36).slice(2, 10);
    session.set('mm-pid', id);
  }
  return id;
}

const newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const secretKey = (code) => `mm-secret-${code}`;
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Mallow';
const HOST_KEY = 'mm-host-room';
const HOST_MAX_AGE = 12 * 3600 * 1000;

function setUrlCode(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('join', code); else u.searchParams.delete('join');
  history.replaceState(null, '', u);
}

// ---------------------------------------------------------------- Host

class HostSession {
  constructor({ code, hostId, hostName, room, game }) {
    this.code = code;
    this.hostId = hostId;
    this.room = room ?? {
      players: [{ id: hostId, name: hostName }],
      options: { short: false, rounds: CONFIG.rounds },
    };
    this.game = game ?? null;
    this.conns = new Map(); // pid -> DataConnection
  }

  async start(isResume) {
    ui.setBusy(isResume ? 'Raum wird wiederhergestellt …' : 'Raum wird erstellt …');
    this.peer = await openHostPeer(this.code, { retries: isResume ? 12 : 0, delayMs: 2500 });
    ui.setBusy('');
    this.peer.on('connection', (c) => this.accept(c));
    this.peer.on('disconnected', () => {
      ui.setStatus('Verbindung zum Vermittlungsserver verloren – verbinde neu …', 'warn');
      setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on('open', () => ui.setStatus(''));
    this.peer.on('error', (err) => {
      if (err.type !== 'peer-unavailable') ui.toast(describePeerError(err), 'error');
    });
    setUrlCode(this.code);
    this.persist();
    this.broadcast();
  }

  accept(conn) {
    conn.on('data', (msg) => this.onMessage(conn, msg));
    conn.on('close', () => this.dropConn(conn));
    conn.on('error', () => this.dropConn(conn));
    // Verbindungsabbrüche früh erkennen (das 'close'-Ereignis kommt oft erst nach ~30 s)
    conn.on('iceStateChanged', (state) => {
      if (state === 'disconnected' || state === 'failed' || state === 'closed') this.dropConn(conn);
      else if ((state === 'connected' || state === 'completed') && conn.pid && !this.conns.has(conn.pid)) {
        this.conns.set(conn.pid, conn);
        this.broadcast();
      }
    });
  }

  dropConn(conn) {
    if (conn.pid && this.conns.get(conn.pid) === conn) {
      this.conns.delete(conn.pid);
      const p = this.room.players.find((x) => x.id === conn.pid);
      if (p) ui.toast(`${p.name} hat die Verbindung verloren.`);
      this.broadcast();
    }
  }

  isConnected(pid) {
    return pid === this.hostId || !!this.conns.get(pid)?.open;
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (msg.t === 'action' && conn.pid) return this.dispatch(conn.pid, msg.action);
  }

  hello(conn, msg) {
    const reject = (text) => { conn.send({ t: 'fatal', msg: text }); setTimeout(() => conn.close(), 500); };
    let pid = String(msg.pid || '').slice(0, 40);
    const name = cleanName(msg.name);
    const secret = String(msg.secret || '').slice(0, 64);
    if (!pid || pid === this.hostId) return reject('Ungültige Spieler-ID.');
    let p = this.room.players.find((x) => x.id === pid);
    if (p && p.secret && p.secret !== secret) return reject('Dieser Platz gehört jemand anderem.');
    if (p && !p.secret) p.secret = newSecret(); // Räume aus älteren Versionen
    if (!p) {
      // Wiedereinstieg mit neuer Tab-ID: nur mit dem geheimen Schlüssel des Platzes
      const seat = secret && this.room.players.find((x) => x.secret === secret && !this.isConnected(x.id));
      if (seat) {
        p = seat;
        pid = seat.id;
      } else if (this.game) {
        return reject('Das Spiel läuft schon. Nur Spieler, die vorher dabei waren, können wieder einsteigen (mit demselben Browser).');
      } else if (this.room.players.length >= CONFIG.maxPlayers) {
        return reject('Der Raum ist voll (max. 6 Spieler).');
      } else {
        let unique = name;
        for (let i = 2; this.room.players.some((x) => x.name.toLowerCase() === unique.toLowerCase()); i++) unique = `${name} ${i}`;
        p = { id: pid, name: unique, secret: newSecret() };
        this.room.players.push(p);
      }
    }
    const old = this.conns.get(pid);
    if (old && old !== conn) { old.pid = null; safe(() => old.close()); }
    conn.pid = pid;
    this.conns.set(pid, conn);
    conn.send({ t: 'welcome', pid, secret: p.secret });
    ui.toast(`${p.name} ist da! 👋`);
    this.persist();
    this.broadcast();
  }

  act(action) { this.dispatch(this.hostId, action); }

  dispatch(pid, action) {
    try {
      const type = action?.type;
      const hostOnly = () => { if (pid !== this.hostId) throw new RuleError('Das darf nur der Host.'); };
      if (type === 'start') {
        hostOnly();
        if (this.game) throw new RuleError('Das Spiel läuft schon.');
        this.game = createGame(this.room.players, this.room.options);
      } else if (type === 'options') {
        hostOnly();
        if (this.game) throw new RuleError('Einstellungen nur in der Lobby.');
        const o = action.options || {};
        this.room.options = { short: !!o.short, rounds: Math.max(1, Math.min(10, Number(o.rounds) || CONFIG.rounds)) };
      } else if (type === 'kick') {
        hostOnly();
        if (this.game) throw new RuleError('Während des Spiels kann niemand entfernt werden.');
        this.room.players = this.room.players.filter((p) => p.id !== action.pid || p.id === this.hostId);
        const c = this.conns.get(action.pid);
        if (c) { c.send({ t: 'fatal', msg: 'Du wurdest vom Host aus dem Raum entfernt.' }); setTimeout(() => c.close(), 300); this.conns.delete(action.pid); }
      } else if (type === 'skip') {
        hostOnly();
        if (!this.game) throw new RuleError('Das Spiel hat noch nicht begonnen.');
        if (this.isConnected(action.pid)) throw new RuleError('Dieser Spieler ist online – nur Offline-Spieler können übersprungen werden.');
        skipPlayer(this.game, action.pid);
      } else if (type === 'newGame') {
        hostOnly();
        this.game = null;
      } else {
        if (!this.game) throw new RuleError('Das Spiel hat noch nicht begonnen.');
        applyAction(this.game, pid, action);
      }
    } catch (e) {
      if (!(e instanceof RuleError)) console.error(e);
      this.sendError(pid, e instanceof RuleError ? e.message : 'Interner Fehler: ' + e.message);
      return;
    }
    this.persist();
    this.broadcast();
  }

  sendError(pid, msg) {
    if (pid === this.hostId) ui.toast(msg, 'error');
    else this.conns.get(pid)?.send({ t: 'error', msg });
  }

  viewFor(pid) {
    return {
      room: {
        code: this.code,
        me: pid,
        hostId: this.hostId,
        isHost: pid === this.hostId,
        options: this.room.options,
        players: this.room.players.map((p) => ({ id: p.id, name: p.name, connected: this.isConnected(p.id) })),
      },
      game: this.game ? viewFor(this.game, pid) : null,
    };
  }

  broadcast() {
    for (const p of this.room.players) {
      const view = this.viewFor(p.id);
      if (p.id === this.hostId) ui.render(view);
      else {
        const c = this.conns.get(p.id);
        if (c?.open) safe(() => c.send({ t: 'state', view }));
      }
    }
  }

  persist() {
    local.set(HOST_KEY, JSON.stringify({ code: this.code, hostId: this.hostId, room: this.room, game: this.game, savedAt: Date.now() }));
  }

  leave() {
    local.del(HOST_KEY);
    for (const c of this.conns.values()) safe(() => c.send({ t: 'fatal', msg: 'Der Host hat den Raum geschlossen.' }));
    setTimeout(() => this.peer?.destroy(), 300);
  }
}

// ---------------------------------------------------------------- Client

class ClientSession {
  constructor({ code, name }) {
    this.code = code;
    this.name = name;
    this.everConnected = false;
    this.closed = false;
    this.retryTimer = null;
  }

  async start() {
    ui.setBusy(`Verbinde mit Raum ${this.code} …`);
    this.peer = await openClientPeer();
    this.peer.on('error', (err) => this.onPeerError(err));
    this.peer.on('disconnected', () => !this.closed && setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500));
    this.connect();
  }

  connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    conn.on('open', () => {
      const secret = session.get(secretKey(this.code)) || local.get(secretKey(this.code)) || '';
      conn.send({ t: 'hello', pid: myPid(), name: this.name, secret });
    });
    conn.on('data', (msg) => this.onMessage(msg));
    conn.on('close', () => {
      if (this.conn !== conn || this.closed) return;
      ui.setStatus('Verbindung zum Host verloren – versuche neu zu verbinden …', 'warn');
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 3000);
  }

  onPeerError(err) {
    if (err.type === 'peer-unavailable') {
      if (!this.everConnected) {
        ui.setBusy('');
        this.stop();
        ui.showScreen('home');
        ui.toast(describePeerError(err), 'error');
        setUrlCode(null);
        return;
      }
      ui.setStatus('Host nicht erreichbar – versuche es weiter …', 'warn');
      this.scheduleRetry();
      return;
    }
    ui.toast(describePeerError(err), 'error');
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      this.everConnected = true;
      session.set('mm-pid', msg.pid);
      if (msg.secret) {
        session.set(secretKey(this.code), msg.secret);
        local.set(secretKey(this.code), msg.secret);
      }
      ui.setBusy('');
      ui.setStatus('');
      setUrlCode(this.code);
    } else if (msg.t === 'state') {
      ui.render(msg.view);
    } else if (msg.t === 'error') {
      ui.toast(msg.msg, 'error');
    } else if (msg.t === 'fatal') {
      this.stop();
      ui.setBusy('');
      ui.setStatus('');
      ui.showScreen('home');
      ui.toast(msg.msg, 'error');
      setUrlCode(null);
    }
  }

  act(action) {
    if (this.conn?.open) this.conn.send({ t: 'action', action });
    else ui.toast('Keine Verbindung zum Host.', 'error');
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    setTimeout(() => this.peer?.destroy(), 200);
  }

  leave() { this.stop(); }
}

// ---------------------------------------------------------------- Start

let current = null;

function savedHostRoom() {
  const raw = local.get(HOST_KEY);
  if (!raw) return null;
  const data = safe(() => JSON.parse(raw));
  if (!data || Date.now() - data.savedAt > HOST_MAX_AGE) { local.del(HOST_KEY); return null; }
  return data;
}

async function run(sessionObj, isResume = false) {
  current = sessionObj;
  try {
    await sessionObj.start(isResume);
  } catch (err) {
    ui.setBusy('');
    current = null;
    ui.showScreen('home');
    ui.toast(describePeerError(err), 'error');
  }
}

async function createRoom(name) {
  local.set('mm-name', name);
  local.del(HOST_KEY);
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = new HostSession({ code: makeCode(), hostId: myPid(), hostName: cleanName(name) });
    current = s;
    try {
      await s.start(false);
      return;
    } catch (err) {
      if (err?.type === 'unavailable-id') continue; // Code zufällig belegt – neuer Versuch
      ui.setBusy('');
      current = null;
      ui.toast(describePeerError(err), 'error');
      return;
    }
  }
}

function resumeRoom() {
  const data = savedHostRoom();
  if (!data) return ui.toast('Kein gespeicherter Raum gefunden.', 'error');
  session.set('mm-pid', data.hostId);
  run(new HostSession(data), true);
}

function joinRoom(codeInput, name) {
  const code = normalizeCode(codeInput);
  if (code.length < 4 || code.length > 8) return ui.toast('Der Raumcode hat 6 Zeichen.', 'error');
  local.set('mm-name', name);
  const saved = savedHostRoom();
  if (saved && saved.code === code) return resumeRoom();
  run(new ClientSession({ code, name: cleanName(name) }));
}

function leave() {
  current?.leave();
  current = null;
  setUrlCode(null);
  ui.setStatus('');
  ui.showScreen('home');
}

const params = new URLSearchParams(location.search);
const joinCode = normalizeCode(params.get('join'));
const savedName = local.get('mm-name') || '';
const saved = savedHostRoom();

ui.init({
  savedName,
  prefillCode: joinCode,
  resumeCode: saved?.code ?? null,
  create: createRoom,
  join: joinRoom,
  resume: resumeRoom,
  leave,
  act: (action) => current?.act(action),
});

if (!window.Peer) {
  ui.toast('PeerJS konnte nicht geladen werden.', 'error');
} else if (joinCode && saved && saved.code === joinCode) {
  resumeRoom();
} else if (joinCode && savedName) {
  joinRoom(joinCode, savedName);
} else {
  ui.showScreen('home');
}

// Für Tests/Debugging
window.mm = {
  get view() { return ui.getView(); },
  act: (a) => current?.act(a),
};
