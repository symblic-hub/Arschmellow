// Marshmellow Mayhem – Soundeffekte, live mit der Web Audio API erzeugt (keine Audiodateien).

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('mm-muted') === '1'; } catch { /* egal */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Browser erlauben Ton erst nach einer Nutzeraktion – beim ersten Klick freischalten. */
export function unlock() {
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  loadSamples();
}

/** Für Tests: Wie viele Aufnahmen sind geladen? */
export async function samplesReady() {
  await loadSamples();
  return Object.fromEntries(Object.entries(buffers).map(([k, v]) => [k, v.length]));
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('mm-muted', muted ? '1' : '0'); } catch { /* egal */ }
}

// ---------------------------------------------------------------- Bausteine

function tone({ freq = 440, to = null, type = 'sine', at = 0, dur = 0.15, vol = 0.3, attack = 0.005, pan = 0 }) {
  const c = audio();
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = g;
  if (pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    node = p;
  }
  osc.connect(g);
  node.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

let noiseBuf = null;
function noise({ at = 0, dur = 0.12, vol = 0.25, freq = 2000, q = 0.8, sweepTo = null, type = 'bandpass', pan = 0 }) {
  const c = audio();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = g;
  if (pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    node = p;
  }
  src.connect(f).connect(g);
  node.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI-Note → Hz

// ---------------------------------------------------------------- Echte Kartengeräusche
// Aufnahmen: Kenney „Casino Audio“ (CC0) – siehe assets/sounds/LICENSE.txt

const range = (prefix, n) => Array.from({ length: n }, (_, k) => `${prefix}-${k + 1}`);
const SAMPLE_FILES = {
  slide: range('card-slide', 8),
  place: range('card-place', 4),
  shove: range('card-shove', 4),
  fan: range('card-fan', 2),
  shuffle: ['card-shuffle'],
  takeout: ['cards-pack-take-out-1'],
};
const buffers = {};
let loading = null;

function loadSamples() {
  if (loading) return loading;
  const c = audio();
  if (!c) return Promise.resolve();
  const base = new URL('../assets/sounds/', import.meta.url);
  loading = Promise.all(Object.entries(SAMPLE_FILES).flatMap(([group, names]) => names.map(async (name) => {
    try {
      const res = await fetch(new URL(`${name}.mp3`, base));
      if (!res.ok) return;
      const buf = await c.decodeAudioData(await res.arrayBuffer());
      (buffers[group] ||= []).push(buf);
    } catch { /* dann eben der Synth-Ersatz */ }
  })));
  return loading;
}

/** Spielt eine zufällige Aufnahme der Gruppe (leicht variierte Tonhöhe). false = noch nicht geladen. */
function sample(group, { vol = 0.5, rate = 1, at = 0, pan = 0, jitter = 0.06 } = {}) {
  const list = buffers[group];
  if (!list?.length) return false;
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g);
  let node = g;
  if (pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    node = p;
  }
  node.connect(master);
  src.start(c.currentTime + at);
  return true;
}

/** Lautstärken der Kartengeräusche – hier zentral anpassbar. */
const VOL = { slide: 0.6, place: 0.7, shove: 0.5, flip: 0.4, fan: 0.6, shuffle: 0.55, takeout: 0.5 };

// ---------------------------------------------------------------- Effekte

const SOUNDS = {
  draw: () => sample('slide', { vol: VOL.slide }) || noise({ dur: 0.16, vol: 0.22, freq: 1200, sweepTo: 4200, q: 0.7 }),
  place: () => sample('place', { vol: VOL.place }) || (
    tone({ freq: 160, to: 70, type: 'sine', dur: 0.12, vol: 0.45 }), noise({ dur: 0.05, vol: 0.12, freq: 3000, q: 1.2 })),
  flip: () => sample('place', { vol: VOL.flip, rate: 1.3 }) || (
    noise({ dur: 0.07, vol: 0.18, freq: 5000, q: 2 }), tone({ freq: 880, to: 1320, type: 'triangle', dur: 0.09, vol: 0.12 })),
  discard: () => sample('shove', { vol: VOL.shove }) || noise({ dur: 0.2, vol: 0.2, freq: 2600, sweepTo: 700, q: 0.6 }),
  swap: () => {
    const real = sample('slide', { vol: VOL.slide, pan: -0.7 }) && sample('slide', { vol: VOL.slide, pan: 0.7, at: 0.18 });
    if (!real) {
      noise({ dur: 0.22, vol: 0.25, freq: 900, sweepTo: 4000, pan: -0.7 });
      noise({ at: 0.14, dur: 0.22, vol: 0.25, freq: 4000, sweepTo: 900, pan: 0.7 });
    }
    [64, 67, 71, 76].forEach((n, k) => tone({ freq: NOTE(n), type: 'triangle', at: 0.2 + k * 0.06, dur: 0.18, vol: 0.08 }));
  },
  shuffle: () => sample('shuffle', { vol: VOL.shuffle, jitter: 0 }) || noise({ dur: 0.6, vol: 0.15, freq: 3000, q: 0.5 }),
  deal: () => {
    if (!sample('takeout', { vol: VOL.takeout })) return;
    [0.3, 0.45, 0.6, 0.75].forEach((at) => sample('slide', { vol: VOL.slide * 0.7, at, rate: 1.1 }));
  },
  spy: () => [84, 88, 91, 96].forEach((n, k) => tone({ freq: NOTE(n), type: 'sine', at: k * 0.05, dur: 0.35, vol: 0.08 })),
  again: () => [60, 64, 67, 72].forEach((n, k) => tone({ freq: NOTE(n), type: 'square', at: k * 0.07, dur: 0.12, vol: 0.06 })),
  setOk: () => {
    sample('fan', { vol: VOL.fan });
    [72, 76, 79, 84, 88].forEach((n, k) => tone({ freq: NOTE(n), type: 'triangle', at: 0.1 + k * 0.06, dur: 0.4, vol: 0.1 }));
    noise({ at: 0.05, dur: 0.4, vol: 0.06, freq: 8000, q: 3 });
  },
  setFail: () => {
    sample('shove', { vol: VOL.shove });
    tone({ freq: 196, to: 98, type: 'sawtooth', dur: 0.45, vol: 0.14 });
    tone({ freq: 207, to: 103, type: 'square', dur: 0.45, vol: 0.06 });
  },
  yourTurn: () => {
    tone({ freq: NOTE(79), type: 'sine', dur: 0.6, vol: 0.22 });
    tone({ freq: NOTE(84), type: 'sine', at: 0.12, dur: 0.8, vol: 0.2 });
    tone({ freq: NOTE(91), type: 'sine', at: 0.12, dur: 0.5, vol: 0.05 });
  },
  call: () => {
    noise({ dur: 0.5, vol: 0.4, freq: 400, q: 0.5, type: 'lowpass' });
    tone({ freq: 110, to: 55, type: 'sawtooth', dur: 0.7, vol: 0.25 });
    [55, 62, 67].forEach((n) => tone({ freq: NOTE(n), type: 'sawtooth', at: 0.08, dur: 0.6, vol: 0.08 }));
  },
  final: () => [76, 72].forEach((n, k) => tone({ freq: NOTE(n), type: 'triangle', at: k * 0.18, dur: 0.3, vol: 0.14 })),
  roundEnd: () => [67, 71, 74, 79].forEach((n, k) => tone({ freq: NOTE(n), type: 'triangle', at: k * 0.11, dur: 0.3, vol: 0.15 })),
  gameOver: () => {
    [60, 64, 67, 72].forEach((n, k) => tone({ freq: NOTE(n), type: 'square', at: k * 0.13, dur: 0.22, vol: 0.08 }));
    [72, 76, 79].forEach((n) => tone({ freq: NOTE(n), type: 'triangle', at: 0.55, dur: 0.9, vol: 0.12 }));
  },
  error: () => tone({ freq: 330, to: 220, type: 'triangle', dur: 0.18, vol: 0.12 }),
  join: () => tone({ freq: 600, to: 1200, type: 'sine', dur: 0.12, vol: 0.15 }),
  click: () => tone({ freq: 1200, type: 'sine', dur: 0.04, vol: 0.05 }),
};

export function play(name) {
  if (muted || !SOUNDS[name]) return;
  try {
    if (!audio()) return;
    SOUNDS[name]();
  } catch { /* Ton ist nie kritisch */ }
}
