// End-to-End-Test: lokaler PeerServer + statischer Server + 3 Browser (Host + 2 Gäste).
// Aufruf: node tests/e2e.mjs [screenshot-ordner]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ExpressPeerServer } from 'peer';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const express = require('express');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = path.resolve(process.argv[2] || path.join(root, 'tests', 'screenshots'));
fs.mkdirSync(shotDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const web = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(8123, '127.0.0.1', r));
const peerApp = express();
const peerHttp = peerApp.listen(9123, '127.0.0.1');
peerApp.use('/', ExpressPeerServer(peerHttp, { path: '/' }));
const peerServer = peerHttp;
await new Promise((r) => setTimeout(r, 500));

const BASE = 'http://127.0.0.1:8123/?peerHost=127.0.0.1&peerPort=9123';
const browser = await chromium.launch();
const errors = [];
const pages = [];
async function newPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  page.label = label;
  pages.push(page);
  return page;
}

function check(cond, msg) {
  if (!cond) throw new Error('CHECK FAILED: ' + msg);
  console.log('  ✔', msg);
}

const view = (p) => p.evaluate(() => window.mm.view);
const act = (p, a) => p.evaluate((a) => window.mm.act(a), a);
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

try {
  console.log('Host erstellt Raum …');
  const host = await newPlayer('Anna');
  await host.goto(BASE);
  await host.fill('#name', 'Anna');
  await host.click('#create-form button');
  await host.waitForSelector('#lobby:not([hidden]) .code-big');
  const code = (await host.textContent('.code-big')).trim();
  check(/^[A-Z0-9]{4}$/.test(code), `Raumcode ${code}`);

  for (const name of ['Ben', 'Cem']) {
    const p = await newPlayer(name);
    await p.goto(`${BASE}&join=${code}`);
    await p.fill('#name', name);
    await p.click('#join-form button');
    await p.waitForSelector('#lobby:not([hidden]) .players li');
  }
  await host.waitForFunction(() => document.querySelectorAll('.players li').length === 3);
  check(true, '3 Spieler in der Lobby');
  await host.screenshot({ path: path.join(shotDir, '1-lobby.png') });

  await host.click('[data-act=start]');
  for (const p of pages) await p.waitForSelector('#game:not([hidden])');
  check(true, 'Spiel gestartet bei allen');

  // Ansehen-Phase per Klick
  for (const p of pages) {
    await p.click('#myhand .slot.clickable >> nth=0');
    await settle(150);
    await p.click('#myhand .slot.clickable:not(.peeking) >> nth=0');
    await settle(150);
  }
  await pages[1].screenshot({ path: path.join(shotDir, '2-peek.png') });
  const vPeek = await view(pages[1]);
  check(vPeek.game.players.find((x) => x.id === vPeek.game.me).hand.filter((s) => s.card).length === 2, 'Ben sieht genau 2 eigene Karten');
  for (const p of pages) await p.click('[data-act=ready]');
  await host.waitForFunction(() => window.mm.view?.game?.phase === 'turn');
  check(true, 'Alle bereit, Zugphase');

  // Keine fremden verdeckten Karten sichtbar
  for (const p of pages) {
    const v = await view(p);
    const leak = v.game.players.some((pl) => pl.id !== v.game.me && pl.hand.some((s) => !s.up && s.card));
    check(!leak, `${p.label} sieht keine fremden verdeckten Karten`);
  }

  // Erster Zug komplett per UI-Klicks
  const byId = async () => {
    const m = {};
    for (const p of pages) m[(await view(p)).game.me] = p;
    return m;
  };
  const pageOf = await byId();
  let v = await view(host);
  let cur = pageOf[v.game.turn.player];
  console.log(`Erster Zug: ${cur.label}`);
  await cur.click('[data-pile=deck]');
  await cur.waitForSelector('.pile.drawn');
  await cur.screenshot({ path: path.join(shotDir, '3-drawn.png') });
  await cur.click('#myhand .slot.clickable >> nth=0'); // ersetzen
  await cur.waitForFunction(() => window.mm.view.game.turn.step === 'reveal');
  await cur.click('#myhand .slot.clickable >> nth=0'); // aufdecken
  await host.waitForFunction((pid) => window.mm.view.game.turn?.player !== pid, v.game.turn.player);
  check(true, 'Zug per Klick: ziehen → tauschen → aufdecken');

  // Restliche Züge automatisch, bis Rundenende
  let guard = 0;
  while (guard++ < 200) {
    v = await view(host);
    if (v.game.phase !== 'turn') break;
    const t = v.game.turn;
    const p = pageOf[t.player];
    const pv = await view(p);
    const mine = pv.game.players.find((x) => x.id === pv.game.me);
    const hidden = mine.hand.findIndex((s) => !s.up);
    if (t.step === 'start' || t.step === 'draw') await act(p, { type: 'draw', from: 'deck' });
    else if (t.step === 'decide') {
      if (pv.game.turn.drawn.kind === 'action' && pv.game.turn.drawn.action === 'spy') await act(p, { type: 'useAction' });
      else await act(p, { type: 'reject' });
    } else if (t.step === 'spy') {
      const other = pv.game.players.find((x) => x.id !== pv.game.me);
      const oi = other.hand.findIndex((s) => !s.up);
      await act(p, { type: 'spy', target: other.id, index: oi });
      await p.waitForSelector('.modal:not([hidden]) [data-act=ack]');
      await p.screenshot({ path: path.join(shotDir, '4-spy.png') });
      await p.click('[data-act=ack]');
    } else if (t.step === 'reveal') await act(p, { type: 'reveal', index: hidden });
    else throw new Error('Unerwarteter Schritt ' + t.step);
    await settle(120);
  }
  await host.waitForSelector('.modal:not([hidden]) .results');
  v = await view(host);
  check(v.game.phase === 'roundEnd', 'Runde 1 beendet');
  check(v.game.players.every((pl) => pl.hand.every((s) => s.card)), 'Am Rundenende alles aufgedeckt');
  await host.screenshot({ path: path.join(shotDir, '5-round-end.png') });

  await pages[2].click('[data-act=nextRound]');
  await host.waitForFunction(() => window.mm.view.game.round === 2 && window.mm.view.game.phase === 'peek');
  check(true, 'Runde 2 gestartet');

  // Wiederverbinden: Ben lädt neu und ist wieder drin
  await pages[1].reload();
  await pages[1].waitForSelector('#game:not([hidden])');
  const vb = await view(pages[1]);
  check(vb.game.round === 2, 'Ben nach Neuladen wieder im Spiel');

  // Mayhem-Ruf in Runde 2
  for (const p of pages) {
    await act(p, { type: 'peek', index: 0 });
    await act(p, { type: 'peek', index: 1 });
    await act(p, { type: 'ready' });
    await settle(100);
  }
  await host.waitForFunction(() => window.mm.view.game.phase === 'turn');
  v = await view(host);
  const caller = (await byId())[v.game.turn.player];
  caller.on('dialog', (d) => d.accept());
  await caller.click('[data-act=call]');
  await host.waitForFunction(() => window.mm.view.game.phase === 'roundEnd');
  v = await view(host);
  check(v.game.roundResult.caller === (await view(caller)).game.me, 'Mayhem-Ruf beendet Runde 2');
  await caller.screenshot({ path: path.join(shotDir, '6-mayhem.png') });

  // Handy-Ansicht
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mob.newPage();
  await mp.goto(BASE);
  await mp.screenshot({ path: path.join(shotDir, '7-mobile-home.png') });

  check(errors.length === 0, 'Keine JS-Fehler' + (errors.length ? ':\n' + errors.join('\n') : ''));
  console.log('\nE2E OK – Screenshots in', shotDir);
} catch (e) {
  console.error(e);
  console.error('Fehler im Browser:', errors);
  for (const p of pages) await p.screenshot({ path: path.join(shotDir, `fail-${p.label}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  web.close();
  peerServer.close?.();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
