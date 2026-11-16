// Marshmellow Mayhem – Animationen: fliegende Karten, Umdrehen, Hervorhebungen.
// Ablauf: vor dem Neuzeichnen snapshot() → nach dem Neuzeichnen play(neueEreignisse, snapshot, …).

import { play as sound, vibrate } from './sound.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const slotSel = (pid, i) => `[data-slot="${CSS.escape(`${pid}:${i}`)}"]`;
const el = (sel) => document.querySelector(sel);

/** Positionen aller Karten und Stapel merken. */
export function snapshot() {
  const map = new Map();
  for (const n of document.querySelectorAll('[data-slot]')) map.set(n.dataset.slot, n.getBoundingClientRect());
  for (const id of ['pile-deck', 'pile-discard', 'pile-drawn']) {
    const n = document.getElementById(id);
    if (n) map.set(id, n.querySelector('.card')?.getBoundingClientRect() ?? n.getBoundingClientRect());
  }
  return map;
}

function rectOf(node) {
  if (!node) return null;
  return (node.querySelector?.('.card') ?? node).getBoundingClientRect();
}

const visible = (r) => r && r.width > 0 && r.height > 0;

/**
 * Lässt eine Karte von from nach to fliegen (beides DOMRects).
 * hide: Element, das bis zur Landung unsichtbar bleibt (damit nichts „springt“).
 */
function fly(html, from, to, { hide = null, duration = 560, arc = 60, spin = 0, delay = 0 } = {}) {
  if (!visible(from) || !visible(to)) return Promise.resolve();
  if (hide) hide.style.visibility = 'hidden';
  const node = document.createElement('div');
  node.className = 'fly-card';
  node.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;--card-w:${from.width}px;--card-h:${from.height}px`;
  node.innerHTML = html;
  document.body.append(node);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const mid = (1 + sx) / 2 * 1.12;
  const frames = reduced()
    ? [{ opacity: 0, transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { opacity: 1, transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }]
    : [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', boxShadow: '0 4px 10px rgba(0,0,0,.3)' },
      { transform: `translate(${dx / 2}px,${dy / 2 - arc}px) scale(${mid}) rotate(${spin}deg)`, boxShadow: '0 22px 40px rgba(0,0,0,.45)', offset: 0.5 },
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(0deg)`, boxShadow: '0 4px 10px rgba(0,0,0,.3)' },
    ];
  const anim = node.animate(frames, { duration: reduced() ? 200 : duration, delay, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
  return anim.finished.catch(() => {}).then(() => {
    node.remove();
    if (hide) hide.style.visibility = '';
  });
}

/** CSS-Klasse kurz setzen (für Puls, Wackeln, Umdrehen …). */
function flash(node, cls, ms = 900) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth; // Animation neu starten
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms);
}

/** Schwebender Text (z. B. „+2 Züge“) über einem Element. */
function floatText(node, text, cls = '') {
  const r = rectOf(node);
  if (!visible(r)) return;
  const t = document.createElement('div');
  t.className = `float-text ${cls}`;
  t.textContent = text;
  t.style.left = `${r.left + r.width / 2}px`;
  t.style.top = `${r.top}px`;
  document.body.append(t);
  setTimeout(() => t.remove(), 1600);
}

/** Großer Stempel quer über den Bildschirm (MAYHEM-Ruf). */
function stamp(title, sub) {
  const s = document.createElement('div');
  s.className = 'stamp';
  s.innerHTML = `<div class="stamp-inner"><div class="stamp-title"></div><div class="stamp-sub"></div></div>`;
  s.querySelector('.stamp-title').textContent = title;
  s.querySelector('.stamp-sub').textContent = sub;
  document.body.append(s);
  setTimeout(() => s.classList.add('out'), 1500);
  setTimeout(() => s.remove(), 2000);
}

/**
 * Spielt neue Ereignisse ab.
 * ctx: { me, nameOf(pid), cardFace(card), cardBack(), toast(text) }
 */
export async function play(events, prev, view, ctx) {
  for (const ev of events) {
    try {
      await playOne(ev, prev, view, ctx);
    } catch { /* Animationen sind nie kritisch */ }
  }
}

async function playOne(ev, prev, view, ctx) {
  const g = view.game;
  const discard = el('#pile-discard');
  const drawnPile = el('#pile-drawn');
  const back = ctx.cardBack();

  switch (ev.type) {
    case 'draw': {
      sound('draw');
      const from = ev.from === 'discard' ? prev.get('pile-discard') : rectOf(el('#pile-deck'));
      const html = ev.from === 'discard' && ev.card ? ctx.cardFace(ev.card) : back;
      // Eigene Stapelkarte dreht sich beim Ankommen um
      await fly(html, from, rectOf(drawnPile), { hide: drawnPile, duration: 480, arc: 30 });
      if (drawnPile && ev.p === ctx.me) flash(drawnPile.querySelector('.card'), 'flip-in', 500);
      return;
    }
    case 'replace': {
      const slot = el(slotSel(ev.p, ev.i));
      const from = prev.get('pile-drawn') ?? rectOf(el('#pile-deck'));
      const outFrom = prev.get(`${ev.p}:${ev.i}`) ?? rectOf(slot);
      sound('place');
      setTimeout(() => sound('discard'), 380); // alte Karte landet auf der Ablage
      await Promise.all([
        fly(back, from, rectOf(slot), { hide: slot, duration: 520 }),
        fly(ctx.cardFace(ev.out), outFrom, rectOf(discard), { hide: discard, delay: 160, duration: 560, arc: 80, spin: -8 }),
      ]);
      flash(slot, 'pulse-new', 1200);
      return;
    }
    case 'reject': {
      sound('discard');
      await fly(ctx.cardFace(ev.card), prev.get('pile-drawn'), rectOf(discard), { hide: discard, duration: 480, arc: 40, spin: 10 });
      return;
    }
    case 'reveal': {
      const slot = el(slotSel(ev.p, ev.i));
      sound('flip');
      flash(slot, 'flip-in', 700);
      flash(slot, 'pulse-reveal', 1200);
      await wait(350);
      return;
    }
    case 'set': {
      const target = el(slotSel(ev.p, ev.newIndex));
      const fromDrawn = prev.get('pile-drawn');
      if (ev.ok) {
        // Die gleichen Karten zeigen sich kurz und fliegen auf die Ablage …
        await Promise.all(ev.idx.map((oldIdx, k) => fly(ctx.cardFace(ev.cards[k]), prev.get(`${ev.p}:${oldIdx}`), rectOf(discard),
          { hide: k === ev.idx.length - 1 ? discard : null, delay: k * 120, duration: 600, arc: 90, spin: (k - 1) * 12 })));
        sound('setOk');
      } else {
        sound('setFail');
        for (const i of ev.idx) flash(el(slotSel(ev.p, i)), 'shake-bad', 900);
        await wait(500);
      }
      // … die neue Karte fliegt sichtbar auf ihren neuen Platz
      sound('place');
      await fly(back, fromDrawn, rectOf(target), { hide: target, duration: 650, arc: 70 });
      flash(target, ev.ok ? 'pulse-new' : 'pulse-bad', 2200);
      floatText(target, ev.ok ? '✨ Neue Karte' : '⚠ Strafkarte', ev.ok ? 'good' : 'bad');
      return;
    }
    case 'action': {
      if (ev.action === 'spy') sound('spy');
      if (ev.action === 'swap') sound('click');
      return;
    }
    case 'spy': {
      const slot = el(slotSel(ev.target, ev.i));
      fly(ctx.cardFace(ev.card), prev.get('pile-drawn'), rectOf(discard), { hide: discard, duration: 450, arc: 30 });
      sound('spy');
      flash(slot, 'spied', 1800);
      floatText(slot, '👀', 'eye');
      await wait(400);
      return;
    }
    case 'swap': {
      const a = el(slotSel(ev.p, ev.i));
      const b = el(slotSel(ev.target, ev.j));
      const ra = prev.get(`${ev.p}:${ev.i}`) ?? rectOf(a);
      const rb = prev.get(`${ev.target}:${ev.j}`) ?? rectOf(b);
      fly(ctx.cardFace(ev.card), prev.get('pile-drawn'), rectOf(discard), { hide: discard, duration: 400, arc: 30 });
      sound('swap');
      await Promise.all([
        fly(back, ra, rectOf(b), { hide: b, duration: 900, arc: 120, spin: 14 }),
        fly(back, rb, rectOf(a), { hide: a, duration: 900, arc: -120, spin: -14 }),
      ]);
      flash(a, 'pulse-swap', 2600);
      flash(b, 'pulse-swap', 2600);
      floatText(b, '🔄 getauscht!', 'swap');
      if (ev.target === ctx.me) ctx.toast(`🔄 ${ctx.nameOf(ev.p)} hat deine Karte ${ev.j + 1} getauscht!`);
      return;
    }
    case 'again': {
      sound('again');
      await fly(ctx.cardFace(ev.card), prev.get('pile-drawn'), rectOf(discard), { hide: discard, duration: 420, arc: 30 });
      floatText(el(`[data-player="${CSS.escape(ev.p)}"]`) ?? discard, '⏩ +2 Züge', 'good');
      return;
    }
    case 'call': {
      sound('call');
      stamp('MAYHEM!', `${ctx.nameOf(ev.p)} beendet die Runde`);
      await wait(900);
      return;
    }
    case 'final': {
      if (!ev.caller) sound('final');
      return;
    }
    case 'reshuffle': {
      sound('shuffle');
      flash(el('#pile-deck'), 'shuffle', 800);
      return;
    }
    case 'turn': {
      const area = el(`[data-player="${CSS.escape(ev.p)}"]`);
      flash(area, 'turn-start', 1200);
      if (ev.p === ctx.me) { sound('yourTurn'); vibrate([60, 60, 120]); }
      return;
    }
    case 'round': {
      sound('deal');
      return;
    }
    case 'roundEnd': {
      sound(g.phase === 'gameOver' ? 'gameOver' : 'roundEnd');
      return;
    }
    default:
  }
}
