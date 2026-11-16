import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../server/roomcore.js';

// Fake-Transport: Sockets sind einfache Objekte, gesendete Nachrichten landen in sock.inbox.
function setup(data = null) {
  const socks = new Set();
  const t = {
    sockets: () => [...socks].filter((s) => s.open).map((s) => ({ sock: s, pid: s.pid })),
    send: (s, msg) => s.inbox.push(msg),
    setPid: (s, pid) => { s.pid = pid; },
    close: (s, code) => { s.open = false; s.closeCode = code; },
  };
  const core = new RoomCore(data, t);
  const sock = () => { const s = { open: true, pid: null, inbox: [] }; socks.add(s); return s; };
  const last = (s, type) => [...s.inbox].reverse().find((m) => m.t === type);
  const hello = (s, extra) => core.handle(s, { t: 'hello', ...extra }, s.pid, 'ABC123');
  const act = (s, action) => core.handle(s, { t: 'action', action }, s.pid, 'ABC123');
  return { core, sock, last, hello, act };
}

function threePlayers() {
  const env = setup();
  const a = env.sock(); env.hello(a, { pid: 'anna01', name: 'Anna', create: true });
  const b = env.sock(); env.hello(b, { pid: 'ben001', name: 'Ben' });
  const c = env.sock(); env.hello(c, { pid: 'cem001', name: 'Cem' });
  return { ...env, a, b, c };
}

test('Raum erstellen und beitreten', () => {
  const { core, a, b, last } = threePlayers();
  assert.equal(core.data.hostId, 'anna01');
  assert.equal(last(a, 'welcome').pid, 'anna01');
  assert.ok(last(b, 'welcome').secret.length >= 32);
  const v = last(b, 'state').view;
  assert.equal(v.room.players.length, 3);
  assert.equal(v.room.isHost, false);
  assert.equal(last(a, 'state').view.room.isHost, true);
});

test('Unbekannter Raum → nicht gefunden; Code belegt → taken', () => {
  const env = setup();
  const s = env.sock();
  env.hello(s, { pid: 'ben001', name: 'Ben' });
  assert.equal(env.last(s, 'fatal').code, 'notfound');
  const a = env.sock(); env.hello(a, { pid: 'anna01', name: 'Anna', create: true });
  const x = env.sock(); env.hello(x, { pid: 'xavi01', name: 'X', create: true });
  assert.equal(env.last(x, 'fatal').code, 'taken');
});

test('Wiedereinstieg nur mit passendem Geheimnis', () => {
  const { b, c, sock, hello, last, core } = threePlayers();
  const secret = last(b, 'welcome').secret;
  b.open = false; // Ben weg
  core.onClose(b, 'ben001');
  // Fremder mit Bens pid aber ohne Geheimnis
  const evil = sock(); hello(evil, { pid: 'ben001', name: 'Ben' });
  assert.equal(last(evil, 'fatal').code, 'secret');
  // Fremder mit neuer pid und gleichem Namen
  const evil2 = sock(); hello(evil2, { pid: 'evil02', name: 'Ben' });
  assert.equal(last(evil2, 'welcome').pid, 'evil02', 'in der Lobby wird man einfach neuer Spieler');
  assert.equal(core.data.players.find((p) => p.id === 'evil02').name, 'Ben 2');
  // Ben mit neuem Tab (neue pid) + Geheimnis bekommt seinen Platz zurück
  const back = sock(); hello(back, { pid: 'newtab1', name: 'Ben', secret });
  assert.equal(last(back, 'welcome').pid, 'ben001');
  assert.ok(c.inbox.length > 0);
});

test('Spiel läuft: Fremde kommen nicht rein, Sichten verraten nichts', () => {
  const { a, b, c, sock, hello, act, last } = threePlayers();
  act(a, { type: 'start' });
  const outsider = sock(); hello(outsider, { pid: 'zzz001', name: 'Zoe' });
  assert.equal(last(outsider, 'fatal').code, 'running');
  for (const s of [a, b, c]) {
    const v = last(s, 'state').view;
    assert.equal(v.game.phase, 'peek');
    const leak = v.game.players.some((p) => p.id !== v.game.me && p.hand.some((x) => x.card));
    assert.equal(leak, false);
  }
});

test('Host-Rechte: nur Host – außer der Host ist offline', () => {
  const { a, b, act, last, core } = threePlayers();
  act(b, { type: 'start' });
  assert.match(last(b, 'error').msg, /nur der Host/);
  assert.equal(core.data.game, null);
  a.open = false;
  core.onClose(a, 'anna01');
  assert.equal(last(b, 'state').view.room.isHost, true, 'Host offline → andere dürfen verwalten');
  act(b, { type: 'start' });
  assert.ok(core.data.game);
});

test('Ungültige Züge erzeugen nur eine Fehlermeldung beim Verursacher', () => {
  const { a, b, act, last } = threePlayers();
  act(a, { type: 'start' });
  const before = b.inbox.length;
  const changed = act(b, { type: 'draw', from: 'deck' });
  assert.equal(changed, false);
  assert.ok(last(b, 'error'));
  assert.equal(a.inbox.filter((m) => m.t === 'error').length, 0);
  assert.equal(b.inbox.length, before + 1);
});

test('Neue Verbindung desselben Spielers ersetzt die alte', () => {
  const { b, sock, hello, last } = threePlayers();
  const secret = last(b, 'welcome').secret;
  const b2 = sock(); hello(b2, { pid: 'ben001', name: 'Ben', secret });
  assert.equal(b.open, false);
  assert.equal(b.closeCode, 4001);
  assert.equal(last(b2, 'welcome').pid, 'ben001');
});
