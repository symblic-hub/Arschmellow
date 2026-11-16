// End-to-End-Test: lokaler Spielserver (wrangler dev) + statischer Server + 3 Browser.
// Aufruf: node tests/e2e.mjs [screenshot-ordner]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

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
// Spielserver lokal starten (gleiche Laufzeit wie bei Cloudflare)
const SERVER_PORT = 8788;
const gameServer = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(SERVER_PORT), '--persist-to', path.join(shotDir, '.wrangler-state')], {
  cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let serverLog = '';
gameServer.stdout.on('data', (d) => { serverLog += d; });
gameServer.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${SERVER_PORT}/`)).ok) break; } catch { /* startet noch */ }
  if (i > 60) { console.error(serverLog); throw new Error('Spielserver startet nicht'); }
  await new Promise((r) => setTimeout(r, 1000));
}

const BASE = `http://127.0.0.1:8123/?server=ws://127.0.0.1:${SERVER_PORT}`;
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


let spyShot = false;
async function playUntilRoundEnd(host, pageOf) {
  let guard = 0;
  while (guard++ < 300) {
    const v = await view(host);
    if (v.game.phase !== 'turn') return;
    const t = v.game.turn;
    const p = pageOf[t.player];
    const pv = await view(p);
    const mine = pv.game.players.find((x) => x.id === pv.game.me);
    const hidden = mine.hand.findIndex((s) => !s.up);
    if (t.step === 'start') await act(p, { type: 'draw', from: 'deck' });
    else if (t.step === 'decide') {
      const d = pv.game.turn.drawn;
      if (d.kind === 'action' && d.action === 'spy') await act(p, { type: 'useAction' });
      else await act(p, { type: 'reject' });
    } else if (t.step === 'spy') {
      const other = pv.game.players.find((x) => x.id !== pv.game.me && x.hand.some((s) => !s.up));
      if (!other) { await act(p, { type: 'spy', target: pv.game.me, index: hidden }); }
      else await act(p, { type: 'spy', target: other.id, index: other.hand.findIndex((s) => !s.up) });
      await p.waitForSelector('.modal:not([hidden]) [data-act=ack]');
      if (!spyShot) { spyShot = true; await p.screenshot({ path: path.join(shotDir, '4-spy.png') }); }
      await p.click('[data-act=ack]');
    } else if (t.step === 'reveal') await act(p, { type: 'reveal', index: hidden });
    else throw new Error('Unerwarteter Schritt ' + t.step);
    await settle(120);
  }
  throw new Error('Runde endet nicht');
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
  check(/^[A-Z0-9]{6}$/.test(code), `Raumcode ${code}`);

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
  await cur.click('#myhand .slot.clickable >> nth=0'); // tauschen → Zug vorbei
  await host.waitForFunction((pid) => window.mm.view.game.turn?.player !== pid, v.game.turn.player);
  check((await view(cur)).game.players.find((x) => x.id === v.game.turn.player).hand.every((s) => !s.up),
    'Zug per Klick: ziehen → tauschen → nächster Spieler (ohne Aufdecken)');

  // Zweiter Zug per Klick: ablehnen → aufdecken
  v = await view(host);
  cur = pageOf[v.game.turn.player];
  await cur.click('[data-pile=deck]');
  await cur.waitForSelector('[data-act=reject]');
  await cur.click('[data-act=reject]');
  await cur.waitForFunction(() => window.mm.view.game.turn.step === 'reveal');
  await cur.click('#myhand .slot.clickable >> nth=0');
  await host.waitForFunction((pid) => window.mm.view.game.turn?.player !== pid, v.game.turn.player);
  check(true, 'Zug per Klick: ziehen → ablehnen → aufdecken');

  // Restliche Züge automatisch, bis Rundenende
  await playUntilRoundEnd(host, pageOf);
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
  await host.waitForFunction(() => window.mm.view.game.final);
  await pages[0].waitForSelector('.final-banner');
  await host.screenshot({ path: path.join(shotDir, '6a-final-turns.png') });
  check(true, 'Nach MAYHEM laufen die letzten Züge');
  await playUntilRoundEnd(host, await byId());
  await host.waitForFunction(() => window.mm.view.game.phase === 'roundEnd');
  v = await view(host);
  check(v.game.roundResult.caller === (await view(caller)).game.me, 'Mayhem-Ruf beendet Runde 2');
  await caller.screenshot({ path: path.join(shotDir, '6-mayhem.png') });

  // Fremder mit gleichem Namen darf den Platz eines Offline-Spielers NICHT übernehmen
  await pages[1].context().close();
  await host.waitForFunction(() => window.mm.view.room.players.some((p) => !p.connected));
  const intruder = await newPlayer('Fake-Ben');
  await intruder.goto(`${BASE}&join=${code}`);
  await intruder.fill('#name', 'Ben');
  await intruder.click('#join-form button');
  await intruder.waitForSelector('.toast.error');
  check(await intruder.isVisible('#home'), 'Fremder mit gleichem Namen wird abgewiesen');
  pages.splice(pages.indexOf(intruder), 1);

  // Host schließt den Tab – das Spiel läuft auf dem Server weiter, Cem darf jetzt verwalten
  await host.context().close();
  const cem = pages[2];
  await cem.waitForFunction(() => window.mm.view.room.isHost === true);
  await cem.click('[data-act=nextRound]');
  await cem.waitForFunction(() => window.mm.view.game.round === 3);
  check(true, 'Host weg: Spiel läuft weiter, Cem startet Runde 3');

  // Unbekannter Raum → klare Fehlermeldung statt endlosem Warten
  const lost = await newPlayer('Lost');
  await lost.goto(`${BASE}&join=ZZZZ99`);
  await lost.fill('#name', 'Lost');
  await lost.click('#join-form button');
  await lost.waitForSelector('.toast.error');
  check((await lost.textContent('.toast.error')).includes('nicht gefunden'), 'Falscher Code: „Raum nicht gefunden“');
  pages.splice(pages.indexOf(lost), 1);

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
  try { process.kill(-gameServer.pid, 'SIGTERM'); } catch { /* schon beendet */ }
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
