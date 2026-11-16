import { makeCode, normalizeCode, connect } from './net.js';
import * as ui from './ui.js';

// ---------------------------------------------------------------- Speicher (fehlertolerant)

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const local = {
  get: (k) => safe(() => localStorage.getItem(k)),
  set: (k, v) => safe(() => localStorage.setItem(k, v)),
};
const session = {
  get: (k) => safe(() => sessionStorage.getItem(k)),
  set: (k, v) => safe(() => sessionStorage.setItem(k, v)),
};

function myPid() {
  let id = session.get('mm-pid');
  if (!id) {
    id = 'p' + Math.random().toString(36).slice(2, 12);
    session.set('mm-pid', id);
  }
  return id;
}

const secretKey = (code) => `mm-secret-${code}`;

// ---------------------------------------------------------------- Bildschirm an lassen (Handy)

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* nicht unterstützt oder abgelehnt – egal */ }
}
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Mallow';
const CONNECT_TIMEOUT = 10000;

function setUrlCode(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('join', code); else u.searchParams.delete('join');
  history.replaceState(null, '', u);
}

// ---------------------------------------------------------------- Raum-Verbindung

class RoomSession {
  constructor({ code, name, create = false, options = null }) {
    this.code = code;
    this.name = name;
    this.create = create;
    this.options = options;
    this.welcomed = false; // schon einmal erfolgreich im Raum?
    this.closed = false;
    this.attempt = 0;
    this.createTries = 0;
  }

  start() {
    ui.setBusy(this.create ? 'Raum wird erstellt …' : `Verbinde mit Raum ${this.code} …`);
    this.open();
  }

  open() {
    if (this.closed) return;
    clearTimeout(this.timer);
    let gotWelcome = false;
    const conn = connect(this.code, {
      onOpen: () => {
        const secret = session.get(secretKey(this.code)) || local.get(secretKey(this.code)) || '';
        conn.send({
          t: 'hello', pid: myPid(), name: this.name, secret,
          create: this.create && !this.welcomed, options: this.options,
        });
      },
      onMessage: (msg) => {
        if (msg.t === 'welcome') gotWelcome = true;
        this.onMessage(msg);
      },
      onClose: (e) => {
        clearTimeout(this.timer);
        if (this.conn !== conn || this.closed) return;
        if (e.code === 4000 || e.code === 4001) return; // Server hat mit "fatal" abgelehnt
        if (!this.welcomed) {
          this.giveUp('Keine Verbindung zum Spielserver. Prüf deine Internetverbindung und versuch es nochmal.');
          return;
        }
        ui.setStatus('Verbindung verloren – verbinde neu …', 'warn');
        this.scheduleReconnect();
      },
    });
    this.conn = conn;
    // Zeitlimit: kein "welcome" in 10 s → klare Fehlermeldung statt endlosem Warten
    this.timer = setTimeout(() => {
      if (gotWelcome || this.closed || this.conn !== conn) return;
      if (!this.welcomed) {
        this.giveUp('Der Spielserver antwortet nicht. Bitte versuch es gleich nochmal.');
      } else {
        conn.close();
      }
    }, CONNECT_TIMEOUT);
  }

  scheduleReconnect() {
    clearTimeout(this.retry);
    const delay = Math.min(10000, 1000 * 2 ** Math.min(this.attempt++, 4));
    this.retry = setTimeout(() => this.open(), delay);
  }

  /** Bei Rückkehr in den Tab sofort neu verbinden, falls nötig. */
  wake() {
    if (this.welcomed && !this.closed && !this.conn?.open) {
      clearTimeout(this.retry);
      this.open();
    }
  }

  onMessage(msg) {
    if (msg.t === 'welcome') {
      this.welcomed = true;
      this.attempt = 0;
      this.code = msg.code || this.code;
      session.set('mm-pid', msg.pid);
      if (msg.secret) {
        session.set(secretKey(this.code), msg.secret);
        local.set(secretKey(this.code), msg.secret);
      }
      ui.setBusy('');
      ui.setStatus('');
      setUrlCode(this.code);
      keepAwake(true);
    } else if (msg.t === 'state') {
      ui.render(msg.view);
      if (msg.notice) ui.toast(msg.notice);
    } else if (msg.t === 'error') {
      ui.toast(msg.msg, 'error');
    } else if (msg.t === 'fatal') {
      if (msg.code === 'taken' && this.create && !this.welcomed && this.createTries++ < 3) {
        // Raumcode zufällig schon vergeben → neuer Code
        this.code = makeCode();
        this.open();
        return;
      }
      this.giveUp(msg.msg);
    }
  }

  giveUp(text) {
    this.stop();
    keepAwake(false);
    ui.setBusy('');
    ui.setStatus('');
    ui.showScreen('home');
    ui.toast(text, 'error');
    setUrlCode(null);
    if (current === this) current = null;
  }

  act(action) {
    if (this.conn?.open) this.conn.send({ t: 'action', action });
    else ui.toast('Keine Verbindung zum Spielserver – einen Moment …', 'error');
  }

  stop() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    this.conn?.close();
  }

  leave() { this.stop(); }
}

// ---------------------------------------------------------------- Start

let current = null;

function run(s) {
  current?.stop();
  current = s;
  s.start();
}

function createRoom(name) {
  local.set('mm-name', name);
  run(new RoomSession({ code: makeCode(), name: cleanName(name), create: true, options: { short: false, rounds: 6 } }));
}

function joinRoom(codeInput, name) {
  const code = normalizeCode(codeInput);
  if (code.length < 4 || code.length > 8) return ui.toast('Der Raumcode hat 6 Zeichen.', 'error');
  local.set('mm-name', name);
  run(new RoomSession({ code, name: cleanName(name) }));
}

function leave() {
  keepAwake(false);
  current?.leave();
  current = null;
  setUrlCode(null);
  ui.setStatus('');
  ui.showScreen('home');
}

const params = new URLSearchParams(location.search);
const joinCode = normalizeCode(params.get('join'));
const savedName = local.get('mm-name') || '';

ui.init({
  savedName,
  prefillCode: joinCode,
  create: createRoom,
  join: joinRoom,
  leave,
  act: (action) => current?.act(action),
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current) {
    current.wake();
    keepAwake(true); // Sperre geht beim Wechsel in eine andere App verloren
  }
});
window.addEventListener('online', () => current?.wake());

if (joinCode && savedName) joinRoom(joinCode, savedName);
else ui.showScreen('home');

// Für Tests/Debugging
window.mm = {
  get view() { return ui.getView(); },
  act: (a) => current?.act(a),
};
