import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, createGame, applyAction, viewFor, skipPlayer, RuleError, CONFIG, handSum } from '../src/rules.js';

// Deterministischer Zufall
function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const P = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cem' }];

function readyAll(g) {
  for (const p of g.players) {
    applyAction(g, p.id, { type: 'peek', index: 0 });
    applyAction(g, p.id, { type: 'peek', index: 1 });
    applyAction(g, p.id, { type: 'ready' });
  }
}

function card(value, kind = 'number', action) {
  return { id: Math.random(), kind, value, action, name: `K${value}` };
}

function setHand(g, pid, values) {
  g.hands[pid] = values.map((v) => ({ card: typeof v === 'object' ? v : card(v), up: false }));
}

test('Deck hat 62 Karten mit richtiger Verteilung', () => {
  const d = buildDeck();
  assert.equal(d.length, 62);
  assert.equal(d.filter((c) => c.kind === 'action').length, 15);
  assert.deepEqual(d.filter((c) => c.value < 0).map((c) => c.value).sort((a, b) => a - b), [-4, -2]);
  assert.equal(new Set(d.map((c) => c.id)).size, 62);
});

test('Aufbau: 6 Karten pro Spieler, Ablage offen, Ansehen-Phase', () => {
  const g = createGame(P, {}, seeded());
  for (const p of P) assert.equal(g.hands[p.id].length, 6);
  assert.equal(g.discard.length, 1);
  assert.equal(g.deck.length, 62 - 18 - 1);
  assert.equal(g.phase, 'peek');
});

test('Kurzes Spiel: 4 Karten', () => {
  const g = createGame(P, { short: true }, seeded());
  assert.equal(g.hands.a.length, 4);
});

test('Ansehen: nur 2 Karten, nur für einen selbst sichtbar, danach weg', () => {
  const g = createGame(P, {}, seeded());
  applyAction(g, 'a', { type: 'peek', index: 2 });
  applyAction(g, 'a', { type: 'peek', index: 4 });
  assert.throws(() => applyAction(g, 'a', { type: 'peek', index: 5 }), RuleError);
  let va = viewFor(g, 'a');
  assert.ok(va.players[0].hand[2].card);
  assert.equal(va.players[0].hand[0].card, null);
  const vb = viewFor(g, 'b');
  assert.equal(vb.players[0].hand[2].card, null, 'Mitspieler sieht nichts');
  applyAction(g, 'a', { type: 'ready' });
  va = viewFor(g, 'a');
  assert.equal(va.players[0].hand[2].card, null, 'nach Bereit wieder verdeckt');
  assert.throws(() => applyAction(g, 'b', { type: 'ready' }), RuleError, 'erst 2 ansehen');
});

test('Zug: ziehen, tauschen, aufdecken, nächster Spieler', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  assert.throws(() => applyAction(g, cur === 'a' ? 'b' : 'a', { type: 'draw' }), RuleError);
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  const drawn = g.turn.drawn;
  const old = g.hands[cur][0].card;
  applyAction(g, cur, { type: 'replace', index: 0 });
  assert.equal(g.hands[cur][0].card, drawn);
  assert.equal(g.hands[cur][0].up, false);
  assert.equal(g.discard.at(-1), old);
  assert.notEqual(g.turn.player, cur, 'Tauschen beendet den Zug – kein Aufdecken');
  assert.ok(g.hands[cur].every((s) => !s.up));
  assert.throws(() => applyAction(g, g.turn.player, { type: 'replace', index: 0 }), RuleError);
});

test('Ablehnen: Karte ablegen, dann eine Karte aufdecken (sperren)', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'reject' });
  assert.equal(g.turn.step, 'reveal');
  assert.throws(() => applyAction(g, cur, { type: 'replace', index: 0 }), RuleError);
  applyAction(g, cur, { type: 'reveal', index: 2 });
  assert.equal(g.hands[cur][2].up, true);
  assert.notEqual(g.turn.player, cur);
});

test('Gezogene Stapelkarte sehen nur der Ziehende', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  const other = P.find((p) => p.id !== cur).id;
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  assert.ok(viewFor(g, cur).turn.drawn);
  assert.equal(viewFor(g, other).turn.drawn, null);
});

test('Ablagekarte darf nicht abgelehnt werden; offene Karten nicht tauschbar', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  g.hands[cur][0].up = true;
  applyAction(g, cur, { type: 'draw', from: 'discard' });
  assert.throws(() => applyAction(g, cur, { type: 'reject' }), RuleError);
  assert.throws(() => applyAction(g, cur, { type: 'replace', index: 0 }), RuleError);
  applyAction(g, cur, { type: 'replace', index: 1 });
});

test('Aktion nur von Stapel; Spicken zeigt Karte nur dem Spicker', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  const other = P.find((p) => p.id !== cur).id;
  g.deck.push(card(9, 'action', 'spy'));
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'useAction' });
  applyAction(g, cur, { type: 'spy', target: other, index: 3 });
  assert.equal(viewFor(g, cur).spy.card, g.hands[other][3].card);
  assert.equal(viewFor(g, other).spy, null);
  applyAction(g, cur, { type: 'ack' });
  assert.equal(viewFor(g, cur).spy, null);
  assert.notEqual(g.turn.player, cur, 'nach einer Aktion endet der Zug ohne Aufdecken');
  assert.ok(g.hands[cur].every((s) => !s.up));

  // Aktionskarte von der Ablage: keine Aktion
  const g2 = createGame(P, {}, seeded(7));
  readyAll(g2);
  g2.discard.push(card(9, 'action', 'spy'));
  applyAction(g2, g2.turn.player, { type: 'draw', from: 'discard' });
  assert.throws(() => applyAction(g2, g2.turn.player, { type: 'useAction' }), RuleError);
});

test('Tauschen: blind mit Mitspieler', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  const other = P.find((p) => p.id !== cur).id;
  g.deck.push(card(10, 'action', 'swap'));
  const mine = g.hands[cur][1].card;
  const theirs = g.hands[other][2].card;
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'useAction' });
  assert.throws(() => applyAction(g, cur, { type: 'swap', target: cur, myIndex: 0, theirIndex: 1 }), RuleError);
  applyAction(g, cur, { type: 'swap', target: other, myIndex: 1, theirIndex: 2 });
  assert.equal(g.hands[cur][1].card, theirs);
  assert.equal(g.hands[other][2].card, mine);
});

test('Nochmal!: zwei Extra-Züge', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  g.deck.push(card(11, 'action', 'again'));
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'useAction' });
  assert.equal(g.turn.player, cur);
  assert.equal(g.turn.step, 'start');
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'replace', index: 0 });
  assert.equal(g.turn.player, cur);
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'reject' });
  applyAction(g, cur, { type: 'reveal', index: 2 });
  assert.notEqual(g.turn.player, cur);
});

test('Karten loswerden mit der aufgenommenen Karte', () => {
  // gültig: 3 gleiche Zahlen
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  setHand(g, cur, [4, 4, 7, 4, 2, 1]);
  assert.throws(() => applyAction(g, cur, { type: 'set', indices: [0, 1, 3] }), RuleError, 'erst Karte nehmen');
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  const drawn = g.turn.drawn;
  applyAction(g, cur, { type: 'set', indices: [0, 1, 3] });
  assert.equal(g.hands[cur].length, 4);
  assert.deepEqual(g.hands[cur].map((s) => s.card.value).slice(0, 3), [7, 2, 1]);
  assert.equal(g.hands[cur][3].card, drawn);
  assert.equal(g.hands[cur][3].up, false);
  assert.equal(g.discard.slice(-3).every((c) => c.value === 4), true);
  assert.notEqual(g.turn.player, cur, 'Zug endet');

  // ungültig: Strafkarte, alles bleibt verdeckt
  const g2 = createGame(P, {}, seeded(3));
  readyAll(g2);
  const c2 = g2.turn.player;
  setHand(g2, c2, [4, 5, 4, 3, 3, 3]);
  applyAction(g2, c2, { type: 'draw', from: 'discard' });
  applyAction(g2, c2, { type: 'set', indices: [0, 1, 2] });
  assert.equal(g2.hands[c2].length, 7);
  assert.ok(g2.hands[c2].every((s) => !s.up));

  // 2 gleiche Aktionskarten gültig, 2 verschiedene nicht
  const g3 = createGame(P, {}, seeded(5));
  readyAll(g3);
  const c3 = g3.turn.player;
  setHand(g3, c3, [card(9, 'action', 'spy'), card(9, 'action', 'spy'), card(11, 'action', 'again'), 2, 3, 4]);
  applyAction(g3, c3, { type: 'draw', from: 'deck' });
  applyAction(g3, c3, { type: 'set', indices: [0, 1] });
  assert.equal(g3.hands[c3].length, 5);

  const g4 = createGame(P, {}, seeded(6));
  readyAll(g4);
  const c4 = g4.turn.player;
  setHand(g4, c4, [card(9, 'action', 'spy'), card(11, 'action', 'again'), 1, 2, 3, 4]);
  applyAction(g4, c4, { type: 'draw', from: 'deck' });
  applyAction(g4, c4, { type: 'set', indices: [0, 1] });
  assert.equal(g4.hands[c4].length, 7, 'verschiedene Aktionskarten = Strafkarte');
});

function passTurn(g) {
  const pid = g.turn.player;
  applyAction(g, pid, { type: 'draw', from: 'deck' });
  applyAction(g, pid, { type: 'replace', index: g.hands[pid].findIndex((s) => !s.up) });
}

test('Rufen: alle anderen haben noch einen letzten Zug', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  applyAction(g, cur, { type: 'call' });
  assert.equal(g.phase, 'turn');
  assert.deepEqual(viewFor(g, 'a').final, { ender: cur, caller: cur });
  const seen = [];
  while (g.phase === 'turn') {
    assert.notEqual(g.turn.player, cur, 'Rufer ist nicht mehr dran');
    assert.throws(() => applyAction(g, g.turn.player, { type: 'call' }), RuleError, 'kein zweiter Ruf');
    seen.push(g.turn.player);
    passTurn(g);
  }
  assert.equal(seen.length, P.length - 1);
  assert.equal(g.phase, 'roundEnd');
});

test('Rufen: richtig (Gleichstand zählt) / falsch (Punkte verdoppelt)', () => {
  // 2 Spieler: Rufer ruft, Gegner macht den letzten Zug; Hände direkt vor dem Ende festlegen
  const g2 = createGame(P.slice(0, 2), {}, seeded());
  readyAll(g2);
  const c2 = g2.turn.player;
  const o2 = P.slice(0, 2).find((p) => p.id !== c2).id;
  applyAction(g2, c2, { type: 'call' });
  applyAction(g2, o2, { type: 'draw', from: 'deck' });
  setHand(g2, c2, [2, 2, 2, 2, 2, 2]);
  setHand(g2, o2, [1, 1, 1, 1, 1, 1]);
  g2.turn.drawn = card(8);
  applyAction(g2, o2, { type: 'reject' });
  applyAction(g2, o2, { type: 'reveal', index: 0 });
  assert.equal(g2.phase, 'roundEnd');
  assert.equal(g2.roundResult.callerFailed, true);
  assert.equal(g2.totals[c2], 24);
  assert.equal(g2.totals[o2], 6);
  assert.ok(viewFor(g2, o2).players.every((p) => p.hand.every((s) => s.card)), 'am Ende sieht jeder alles');
  applyAction(g2, c2, { type: 'nextRound' });
  assert.equal(g2.round, 2);
  assert.equal(g2.starter, c2, 'meiste Punkte der Runde beginnt');

  const g3 = createGame(P.slice(0, 2), {}, seeded(9));
  readyAll(g3);
  const c3 = g3.turn.player;
  const o3 = P.slice(0, 2).find((p) => p.id !== c3).id;
  applyAction(g3, c3, { type: 'call' });
  applyAction(g3, o3, { type: 'draw', from: 'deck' });
  setHand(g3, c3, [1, 1, 1, 1, 1, 1]);
  setHand(g3, o3, [1, 1, 1, 1, 1, 1]);
  g3.turn.drawn = card(8);
  applyAction(g3, o3, { type: 'reject' });
  applyAction(g3, o3, { type: 'reveal', index: 0 });
  assert.equal(g3.roundResult.callerFailed, false, 'Gleichstand zählt als Erfolg');
});

test('Nur noch offene Karten: letzte Züge für alle anderen, dann Rundenende', () => {
  const g = createGame(P, { short: true }, seeded());
  readyAll(g);
  const cur = g.turn.player;
  g.hands[cur].forEach((s, i) => { s.up = i > 0; });
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'reject' });
  applyAction(g, cur, { type: 'reveal', index: 0 });
  assert.equal(g.phase, 'turn');
  assert.deepEqual(g.final, { ender: cur, caller: null });
  passTurn(g);
  passTurn(g);
  assert.equal(g.phase, 'roundEnd');
  assert.equal(g.roundResult.callerFailed, false);
});

test('Ablehnen ohne verdeckte Karten beendet den Zug direkt', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  applyAction(g, cur, { type: 'call' });
  const p = g.turn.player;
  g.hands[p].forEach((s) => { s.up = true; });
  applyAction(g, p, { type: 'draw', from: 'deck' });
  assert.throws(() => applyAction(g, p, { type: 'replace', index: 0 }), RuleError);
  applyAction(g, p, { type: 'reject' });
  assert.notEqual(g.turn?.player, p);
});

test('Rundenende wenn ein Spieler nur offene Karten hat; Spielende nach N Runden', () => {
  const g = createGame(P.slice(0, 2), { rounds: 1, short: true }, seeded());
  readyAll(g);
  let guard = 0;
  while (g.phase === 'turn' && guard++ < 200) {
    const pid = g.turn.player;
    applyAction(g, pid, { type: 'draw', from: 'deck' });
    applyAction(g, pid, { type: 'reject' });
    const i = g.hands[pid].findIndex((s) => !s.up);
    applyAction(g, pid, { type: 'reveal', index: i });
  }
  assert.equal(g.phase, 'gameOver');
  assert.ok(g.winners.length >= 1);
  const sums = Object.fromEntries(g.players.map((p) => [p.id, handSum(g.hands[p.id])]));
  assert.deepEqual(g.totals, sums);
});

test('Leerer Stapel wird aus der Ablage neu gemischt', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  g.discard.push(...g.deck.splice(0));
  const total = g.discard.length;
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  assert.ok(g.turn.drawn);
  assert.equal(g.discard.length, 1, 'neue oberste Karte offen');
  assert.equal(g.deck.length, total - 2);
});

test('Sicht ist JSON-serialisierbar und verrät keine fremden verdeckten Karten', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const v = JSON.parse(JSON.stringify(viewFor(g, 'a')));
  for (const p of v.players) for (const s of p.hand) if (!s.up) assert.equal(s.card, null);
  assert.equal(CONFIG.peekCount, v.peek === null ? 2 : v.peek.need);
});

test('Ungültige Spieler-IDs (z. B. __proto__) werden sauber abgelehnt', () => {
  const g = createGame(P, {}, seeded());
  readyAll(g);
  const cur = g.turn.player;
  g.deck.push(card(9, 'action', 'spy'));
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  applyAction(g, cur, { type: 'useAction' });
  for (const target of ['__proto__', 'constructor', 'toString', 42, null]) {
    assert.throws(() => applyAction(g, cur, { type: 'spy', target, index: 0 }), RuleError);
  }
  assert.throws(() => applyAction(g, '__proto__', { type: 'draw' }), RuleError);
  assert.throws(() => skipPlayer(g, '__proto__'), RuleError);
});

test('Host kann Offline-Spieler überspringen', () => {
  const g = createGame(P, {}, seeded());
  for (const p of P.slice(0, 2)) {
    applyAction(g, p.id, { type: 'peek', index: 0 });
    applyAction(g, p.id, { type: 'peek', index: 1 });
    applyAction(g, p.id, { type: 'ready' });
  }
  skipPlayer(g, 'c');
  assert.equal(g.phase, 'turn');
  const cur = g.turn.player;
  applyAction(g, cur, { type: 'draw', from: 'deck' });
  const before = g.discard.length;
  skipPlayer(g, cur);
  assert.equal(g.discard.length, before + 1);
  assert.notEqual(g.turn.player, cur);
  assert.throws(() => skipPlayer(g, cur), RuleError);
});
