// Marshmellow Mayhem – Hintergrundmusik „Lagerfeuer“ (eigene Komposition, siehe assets/music/compose.py).
// Zwei synchrone Spuren: Hauptspur + „Spannung“ (Klatschen/Tamburin) für die letzten Züge.
// Nahtlos per AudioBufferSourceNode.loop zwischen PAD und PAD + LOOP (die Datei ist dort exakt periodisch).

import { getContext } from './sound.js';

const BASE = new URL('../assets/music/', import.meta.url);
const FALLBACK_META = { loopSeconds: 106.66666666666667, pad: 1 };
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

let enabled = read('mm-music', '1') !== '0';
let volume = Math.min(1, Math.max(0, Number(read('mm-music-vol', '0.6'))));
let wanted = false;
let loading = null;
let data = null;      // { meta, main, tension }
let nodes = null;     // { out, tensionGain, srcs }
let tensionOn = false;

const level = () => volume * 0.7; // Musik bleibt unter den Kartengeräuschen

function load() {
  if (loading) return loading;
  const ctx = getContext();
  if (!ctx) return Promise.resolve(null);
  loading = (async () => {
    const meta = await fetch(new URL('music.json', BASE)).then((r) => r.json()).catch(() => FALLBACK_META);
    const get = async (name) => ctx.decodeAudioData(await (await fetch(new URL(name, BASE))).arrayBuffer());
    const [main, tension] = await Promise.all([get('campfire.mp3'), get('campfire-tension.mp3').catch(() => null)]);
    data = { meta, main, tension };
    return data;
  })().catch(() => { loading = null; return null; });
  return loading;
}

function ramp(param, value, seconds) {
  const ctx = getContext();
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

async function play() {
  if (nodes || !enabled || !wanted) return;
  const d = await load();
  if (!d || nodes || !enabled || !wanted) return;
  const ctx = getContext();
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  const tensionGain = ctx.createGain();
  tensionGain.gain.value = tensionOn ? 1 : 0;
  tensionGain.connect(out);
  const { loopSeconds, pad } = d.meta;
  const t0 = ctx.currentTime + 0.05;
  const srcs = [];
  for (const [buf, dest] of [[d.main, out], [d.tension, tensionGain]]) {
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = pad;
    src.loopEnd = pad + loopSeconds;
    src.connect(dest);
    src.start(t0, pad); // beide Spuren starten am selben Punkt → bleiben synchron
    srcs.push(src);
  }
  nodes = { out, tensionGain, srcs };
  ramp(out.gain, level(), 3); // sanft einblenden
}

function stopNow(fade = 1.2) {
  if (!nodes) return;
  const { out, srcs } = nodes;
  nodes = null;
  const ctx = getContext();
  ramp(out.gain, 0, fade);
  for (const s of srcs) { try { s.stop(ctx.currentTime + fade + 0.05); } catch { /* schon gestoppt */ } }
  setTimeout(() => out.disconnect(), (fade + 0.2) * 1000);
}

/** Musik soll laufen (Lobby/Spiel). Startet, sobald der Browser Ton erlaubt. */
export function start() {
  wanted = true;
  play();
}

/** Musik aus (Startseite / Raum verlassen). */
export function stop() {
  wanted = false;
  stopNow();
}

/** Letzte Züge: Klatschen & Tamburin dazu. */
export function setTension(on) {
  on = !!on;
  if (on === tensionOn) return;
  tensionOn = on;
  if (nodes) ramp(nodes.tensionGain.gain, on ? 1 : 0, on ? 1.5 : 2.5);
}

/** Kurz leiser für große Momente (MAYHEM-Stempel, Rundenende). */
export function duck(ms = 2000) {
  if (!nodes) return;
  const g = nodes.out.gain;
  ramp(g, level() * 0.3, 0.15);
  setTimeout(() => { if (nodes && nodes.out.gain === g) ramp(g, level(), 1.2); }, ms);
}

export const isEnabled = () => enabled;
export const getVolume = () => volume;

export function setEnabled(on) {
  enabled = !!on;
  write('mm-music', enabled ? '1' : '0');
  if (enabled) play(); else stopNow(0.6);
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  write('mm-music-vol', String(volume));
  if (nodes) ramp(nodes.out.gain, level(), 0.15);
}

// App im Hintergrund (Handy): Musik pausieren, beim Zurückkommen weiter
document.addEventListener('visibilitychange', () => {
  const ctx = getContext();
  if (!ctx) return;
  if (document.visibilityState === 'hidden') ctx.suspend?.().catch(() => {});
  else ctx.resume?.().catch(() => {});
});

/** Für Tests. */
export const debug = () => ({ playing: !!nodes, loaded: !!data, tension: tensionOn, gain: nodes?.out.gain.value ?? 0,
  loop: nodes ? [nodes.srcs[0].loopStart, nodes.srcs[0].loopEnd] : null, sources: nodes?.srcs.length ?? 0 });
