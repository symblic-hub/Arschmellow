// Marshmellow Mayhem – Darstellung & Interaktion.
// render(view) zeichnet alles neu; Klicks gehen über handlers.act(action).

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let handlers = {};
let current = null; // letzte Sicht
const animated = new Set();
/** true nur beim ersten Aufruf mit diesem Schlüssel – damit Animationen nicht bei jedem Update neu starten. */
function once(key) {
  if (animated.has(key)) return false;
  animated.add(key);
  if (animated.size > 500) animated.clear();
  return true;
}
const sel = { key: '', mode: null, set: [], swapMine: null, swapTheirs: null };

// ---------------------------------------------------------------- Karten-Grafik

const ROAST = ['#fffdf8', '#fff1dc', '#ffe2b3', '#f6c985', '#e6a65a', '#cc8442', '#a0612d', '#6b3f20', '#3b2313'];
const ACTION_META = {
  spy: { icon: '👀', color: '#7c6cf2', hint: 'Sieh dir eine beliebige verdeckte Karte an' },
  swap: { icon: '🔄', color: '#20a39e', hint: 'Tausche blind eine eigene mit einer fremden Karte' },
  again: { icon: '⏩', color: '#f28b30', hint: 'Du bekommst zwei weitere Züge' },
};

function mallowSVG(v) {
  const special = v < 0;
  const body = special ? (v <= -5 ? '#ffd23f' : '#ffe58f') : ROAST[Math.max(0, Math.min(8, v))];
  const dark = v >= 7;
  const ink = dark ? '#fff4e6' : '#3a2416';
  let mouth;
  if (v <= 2) mouth = `<path d="M22 37 Q30 46 38 37" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  else if (v <= 4) mouth = `<path d="M23 39 Q30 43.5 37 39" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  else if (v === 5) mouth = `<path d="M24 40.5 L36 40.5" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  else if (v === 6) mouth = `<path d="M23 43 Q30 37.5 37 43" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  else mouth = `<ellipse cx="30" cy="41" rx="3.6" ry="4.4" fill="${ink}"/>`;
  const cheeks = v <= 3 ? `<circle cx="18.5" cy="36" r="3.4" fill="#ff9fb2" opacity=".7"/><circle cx="41.5" cy="36" r="3.4" fill="#ff9fb2" opacity=".7"/>` : '';
  const smoke = v >= 7 ? `<path d="M20 9 q-3 -3 0 -6 M30 8 q-3 -3 0 -6 M40 9 q-3 -3 0 -6" fill="none" stroke="#9a8f8a" stroke-width="2" stroke-linecap="round" opacity=".8"/>` : '';
  const crown = v <= -5 ? `<path d="M18 13 L22 3 L27 10 L30 1 L33 10 L38 3 L42 13 Z" fill="#ffb300" stroke="#b77900" stroke-width="1.5" stroke-linejoin="round"/>` : '';
  const sparkle = v === -3 ? `<path d="M48 8 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z M11 12 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1z" fill="#fff6c4" stroke="#d9a400" stroke-width=".8"/>` : '';
  const eyes = v >= 6 && v < 7
    ? `<path d="M20.5 29 l5 3 M39.5 29 l-5 3" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`
    : `<circle cx="23" cy="31" r="2.7" fill="${ink}"/><circle cx="37" cy="31" r="2.7" fill="${ink}"/><circle cx="24" cy="30" r=".9" fill="#fff"/><circle cx="38" cy="30" r=".9" fill="#fff"/>`;
  return `<svg viewBox="0 0 60 60" aria-hidden="true">
    ${smoke}
    <rect x="8" y="13" width="44" height="40" rx="15" fill="${body}" stroke="rgba(60,30,10,.35)" stroke-width="1.6"/>
    <ellipse cx="30" cy="18" rx="19" ry="5.5" fill="#fff" opacity="${dark ? 0.12 : 0.55}"/>
    ${crown}${sparkle}${cheeks}${eyes}${mouth}
  </svg>`;
}

export function cardFace(card) {
  if (card.kind === 'action') {
    const m = ACTION_META[card.action] ?? { icon: '❓', color: '#888', hint: '' };
    return `<div class="card front action" style="--accent:${m.color}" title="${esc(m.hint)}">
      <span class="corner tl">${card.value}</span>
      <div class="art action-art"><span>${m.icon}</span></div>
      <div class="cname">${esc(card.name)}</div>
    </div>`;
  }
  const cls = card.value < 0 ? 'special' : card.value >= 7 ? 'burnt' : '';
  return `<div class="card front number ${cls}" style="--roast:${ROAST[Math.max(0, Math.min(8, card.value))]}">
    <span class="corner tl">${card.value}</span>
    <div class="art">${mallowSVG(card.value)}</div>
    <div class="cname">${esc(card.name)}</div>
  </div>`;
}

export function cardBack() {
  return `<div class="card back"><div class="back-art"><span>M</span><span>M</span></div></div>`;
}

function slotHTML(slot, { pid, index, clickable, selected, size = '', animKey = '' }) {
  const inner = slot.card ? cardFace(slot.card) : cardBack();
  const anim = slot.card && animKey && once(`${animKey}:${pid}:${index}:${slot.card.id}:${slot.up}`) ? 'anim' : '';
  const classes = ['slot', size, clickable ? 'clickable' : '', selected ? 'selected' : '', slot.peeking ? 'peeking' : '',
    slot.up ? 'is-up' : '', slot.revealedAtEnd ? 'end-reveal' : '', anim].filter(Boolean).join(' ');
  const tag = clickable ? 'button' : 'div';
  return `<${tag} class="${classes}" ${clickable ? `data-card="${esc(pid)}:${index}"` : ''} aria-label="Karte ${index + 1}">${inner}</${tag}>`;
}

// ---------------------------------------------------------------- Setup

export function init(h) {
  handlers = h;
  document.addEventListener('click', onClick);
  $('#name').value = h.savedName || '';
  $('#join-code').value = h.prefillCode || '';
  $('#create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return toast('Gib zuerst deinen Namen ein.', 'error');
    handlers.create(name);
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#name').value.trim();
    const code = $('#join-code').value.trim();
    if (!name) return toast('Gib zuerst deinen Namen ein.', 'error');
    if (!code) return toast('Gib den Raumcode ein.', 'error');
    handlers.join(code, name);
  });
  if (h.resumeCode) {
    const box = $('#resume');
    box.hidden = false;
    $('#resume-code').textContent = h.resumeCode;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

export function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
}

export function setBusy(text) {
  const el = $('#busy');
  el.hidden = !text;
  el.textContent = text || '';
}

export function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text || '';
  el.className = `status ${kind}`;
  el.hidden = !text;
}

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3800);
}

function openModal(html, cls = '') {
  const m = $('#modal');
  m.className = `modal ${cls}`;
  $('#modal-body').innerHTML = html;
  m.hidden = false;
}
function closeModal() {
  const m = $('#modal');
  if (m.dataset.locked === '1') return;
  m.hidden = true;
}

// ---------------------------------------------------------------- Klicks

function act(action) { handlers.act(action); }

function onClick(e) {
  const btn = e.target.closest('[data-act],[data-card],[data-pile],[data-ui]');
  if (!btn || btn.disabled) return;
  const v = current;
  if (btn.dataset.ui) return uiAction(btn.dataset.ui, btn);
  if (btn.dataset.act) {
    const a = btn.dataset.act;
    if (a === 'set-confirm') { act({ type: 'set', indices: sel.set }); sel.mode = null; sel.set = []; return; }
    if (a === 'options') {
      return act({ type: 'options', options: { short: $('#opt-short').checked, rounds: Number($('#opt-rounds').value) } });
    }
    if (a === 'kick') return act({ type: 'kick', pid: btn.dataset.pid });
    if (a === 'skip') return act({ type: 'skip', pid: btn.dataset.pid });
    if (a === 'call' && !confirm('Wirklich „MAYHEM!“ rufen? Wenn jemand weniger Punkte hat, werden deine verdoppelt!')) return;
    return act({ type: a });
  }
  if (btn.dataset.pile) return act({ type: 'draw', from: btn.dataset.pile });
  if (btn.dataset.card && v?.game) return onCard(v, ...splitCard(btn.dataset.card));
}

function splitCard(s) {
  const i = s.lastIndexOf(':');
  return [s.slice(0, i), Number(s.slice(i + 1))];
}

function onCard(v, pid, index) {
  const g = v.game;
  const me = g.me;
  if (g.phase === 'peek') return act({ type: 'peek', index });
  const step = g.turn?.step;
  if (sel.mode === 'set' && pid === me) {
    sel.set = sel.set.includes(index) ? sel.set.filter((i) => i !== index) : [...sel.set, index];
    return rerender();
  }
  if (step === 'decide' && pid === me) return act({ type: 'replace', index });
  if (step === 'spy') return act({ type: 'spy', target: pid, index });
  if (step === 'reveal' && pid === me) return act({ type: 'reveal', index });
  if (step === 'swap') {
    if (pid === me) sel.swapMine = sel.swapMine === index ? null : index;
    else sel.swapTheirs = sel.swapTheirs && sel.swapTheirs.pid === pid && sel.swapTheirs.index === index ? null : { pid, index };
    if (sel.swapMine !== null && sel.swapTheirs) {
      act({ type: 'swap', myIndex: sel.swapMine, target: sel.swapTheirs.pid, theirIndex: sel.swapTheirs.index });
      sel.swapMine = null; sel.swapTheirs = null;
      return;
    }
    return rerender();
  }
}

function uiAction(what, btn) {
  if (what === 'set-mode') { sel.mode = 'set'; sel.set = []; return rerender(); }
  if (what === 'set-cancel') { sel.mode = null; sel.set = []; return rerender(); }
  if (what === 'rules') return openModal(RULES_HTML, 'wide');
  if (what === 'close-modal') return closeModal();
  if (what === 'copy-link') {
    const link = btn.dataset.link;
    navigator.clipboard?.writeText(link).then(() => toast('Einladungslink kopiert! 📋'), () => prompt('Link kopieren:', link));
    return;
  }
  if (what === 'resume') return handlers.resume();
  if (what === 'leave') {
    if (confirm('Raum wirklich verlassen?')) handlers.leave();
  }
}

function rerender() { if (current) render(current); }

export const getView = () => current;

// ---------------------------------------------------------------- Render

export function render(view) {
  current = view;
  if (!view.room) return;
  $('#room-code').textContent = view.room.code;
  if (!view.game) {
    showScreen('lobby');
    renderLobby(view);
    return;
  }
  showScreen('game');
  renderGame(view);
}

function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  const q = new URLSearchParams(location.search);
  for (const k of ['peerHost', 'peerPort', 'peerPath', 'peerSecure']) if (q.get(k)) u.searchParams.set(k, q.get(k));
  u.searchParams.set('join', code);
  return u.toString();
}

function renderLobby(view) {
  const r = view.room;
  const link = inviteLink(r.code);
  const players = r.players.map((p) => `
    <li class="${p.connected ? '' : 'offline'}">
      <span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
      <span class="pname">${esc(p.name)}${p.id === r.me ? ' <em>(du)</em>' : ''}</span>
      ${p.id === r.hostId ? '<span class="badge host">👑 Host</span>' : ''}
      ${p.connected ? '' : '<span class="badge off">offline</span>'}
      ${r.isHost && p.id !== r.hostId ? `<button class="mini ghost" data-act="kick" data-pid="${esc(p.id)}" title="Entfernen">✕</button>` : ''}
    </li>`).join('');
  const canStart = r.players.length >= 2;
  $('#lobby-body').innerHTML = `
    <div class="lobby-grid">
      <section class="panel">
        <h2>Freunde einladen</h2>
        <p class="muted">Schick diesen Link an deine Freunde – oder sie geben den Code auf der Startseite ein.</p>
        <div class="code-big">${esc(r.code)}</div>
        <div class="linkrow"><input readonly value="${esc(link)}" onclick="this.select()"><button data-ui="copy-link" data-link="${esc(link)}">Kopieren</button></div>
      </section>
      <section class="panel">
        <h2>Spieler (${r.players.length}/6)</h2>
        <ul class="players">${players}</ul>
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        <label class="opt"><input type="checkbox" id="opt-short" ${r.options.short ? 'checked' : ''} ${r.isHost ? '' : 'disabled'} data-act="options"> Kurzes Spiel (4 statt 6 Karten)</label>
        <label class="opt">Runden:
          <select id="opt-rounds" ${r.isHost ? '' : 'disabled'}>
            ${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option ${n === r.options.rounds ? 'selected' : ''}>${n}</option>`).join('')}
          </select></label>
        ${r.isHost
          ? `<button class="big primary" data-act="start" ${canStart ? '' : 'disabled'}>Spiel starten 🔥</button>
             ${canStart ? '' : '<p class="muted">Mindestens 2 Spieler nötig.</p>'}`
          : '<p class="muted">Warte, bis der Host das Spiel startet …</p>'}
      </section>
    </div>`;
  const sel = $('#opt-rounds');
  if (sel && r.isHost) sel.onchange = () => act({ type: 'options', options: { short: $('#opt-short').checked, rounds: Number(sel.value) } });
}

function stepText(g, p) {
  const t = g.turn;
  const n = esc(p?.name);
  switch (t.step) {
    case 'start': return `${n} ist am Zug.`;
    case 'draw': return `${n} zieht eine Karte.`;
    case 'decide': return t.drawnFrom === 'discard' ? `${n} hat die Ablagekarte genommen …` : `${n} überlegt, was mit der gezogenen Karte passiert …`;
    case 'spy': return `${n} sucht sich eine Karte zum Spicken aus …`;
    case 'spyResult': return `${n} spickt …`;
    case 'swap': return `${n} sucht zwei Karten zum Tauschen aus …`;
    case 'reveal': return `${n} muss eine Karte aufdecken.`;
    default: return '';
  }
}

function renderGame(view) {
  const g = view.game;
  const r = view.room;
  const me = g.players.find((p) => p.id === g.me);
  const t = g.turn;
  const myTurn = t && t.player === g.me;
  const stepKey = `${g.round}|${g.phase}|${t?.player}|${t?.step}|${t?.extraTurns}`;
  if (stepKey !== sel.key) { sel.key = stepKey; sel.mode = null; sel.set = []; sel.swapMine = null; sel.swapTheirs = null; }
  const step = myTurn ? t.step : null;
  const connected = Object.fromEntries(r.players.map((p) => [p.id, p.connected]));

  // Wer darf was anklicken?
  const myClickable = (slot) => {
    if (slot.up) return false;
    if (g.phase === 'peek') return !g.peek.ready && (g.peek.seen < g.peek.need || slot.peeking);
    if (sel.mode === 'set') return true;
    return ['decide', 'spy', 'reveal', 'swap'].includes(step);
  };
  const oppClickable = (slot) => !slot.up && (step === 'spy' || step === 'swap');

  // Mitspieler
  const others = rotateFrom(g.players, g.me).filter((p) => p.id !== g.me);
  $('#opponents').innerHTML = others.map((p) => {
    const cols = Math.min(3, Math.ceil(p.hand.length / 2)) || 1;
    const active = t?.player === p.id;
    return `<div class="opp ${active ? 'active' : ''} ${connected[p.id] === false ? 'offline' : ''}">
      <div class="opp-head">
        <span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="pname">${esc(p.name)}</span>
        ${active ? '<span class="badge turn">am Zug</span>' : ''}
        ${g.phase === 'peek' ? (p.ready ? '<span class="badge ok">bereit</span>' : '<span class="badge">merkt sich …</span>') : ''}
        ${connected[p.id] === false ? '<span class="badge off">offline</span>' : ''}
        ${r.isHost && connected[p.id] === false && (active || (g.phase === 'peek' && !p.ready))
          ? `<button class="mini" data-act="skip" data-pid="${esc(p.id)}" title="Spieler ist offline">Überspringen</button>` : ''}
      </div>
      <div class="hand sm" style="--cols:${cols}">
        ${p.hand.map((s, i) => slotHTML(s, { pid: p.id, index: i, size: 'sm', clickable: oppClickable(s), animKey: `r${g.round}`,
          selected: sel.swapTheirs && sel.swapTheirs.pid === p.id && sel.swapTheirs.index === i })).join('')}
      </div>
      <div class="opp-foot">Gesamt: <b>${p.total}</b> · offen: ${p.openSum}</div>
    </div>`;
  }).join('');

  // Mitte: Stapel
  const canDraw = myTurn && (step === 'start' || step === 'draw') && sel.mode !== 'set';
  const deckEl = `<${canDraw ? 'button' : 'div'} class="pile deck ${canDraw ? 'clickable' : ''}" ${canDraw ? 'data-pile="deck"' : ''}>
      ${cardBack()}<span class="pile-label">Stapel · ${g.deckCount}</span></${canDraw ? 'button' : 'div'}>`;
  const canDiscard = canDraw && g.discardTop;
  const discardEl = `<${canDiscard ? 'button' : 'div'} class="pile discard ${canDiscard ? 'clickable' : ''}" ${canDiscard ? 'data-pile="discard"' : ''}>
      ${g.discardTop ? cardFace(g.discardTop) : '<div class="card empty"></div>'}<span class="pile-label">Ablage</span></${canDiscard ? 'button' : 'div'}>`;
  let drawnEl = '';
  if (t?.hasDrawn) {
    const fresh = once(`drawn:${g.round}:${t.player}:${t.step === 'decide' ? 'd' : t.step}:${t.drawn?.id ?? 'x'}:${g.deckCount}`);
    drawnEl = `<div class="pile drawn"><div class="drawn-glow ${fresh ? 'anim' : ''}">${t.drawn ? cardFace(t.drawn) : cardBack()}</div>
      <span class="pile-label">${myTurn ? 'Deine Karte' : 'gezogen'}</span></div>`;
  }
  $('#piles').innerHTML = deckEl + discardEl + drawnEl;

  // Hinweis + Knöpfe
  const curPlayer = g.players.find((p) => p.id === t?.player);
  let prompt = '';
  let buttons = '';
  if (g.phase === 'peek') {
    if (g.peek.ready) prompt = 'Gemerkt! Warte auf die anderen …';
    else {
      prompt = g.peek.seen < g.peek.need
        ? `Klicke ${g.peek.need - g.peek.seen} deiner Karten an, um sie dir anzusehen. Merk sie dir gut!`
        : 'Präg sie dir ein – danach werden sie wieder umgedreht.';
      buttons = `<button class="primary" data-act="ready" ${g.peek.seen < g.peek.need ? 'disabled' : ''}>Gemerkt! ✔</button>`;
    }
  } else if (g.phase === 'turn') {
    if (!myTurn) {
      prompt = stepText(g, curPlayer);
    } else if (sel.mode === 'set') {
      prompt = 'Markiere deine <b>verdeckten</b> Karten: mind. 3 gleiche Zahlen oder mind. 2 Aktionskarten. Liegst du falsch, bekommst du eine Strafkarte!';
      buttons = `<button class="primary" data-act="set-confirm" ${sel.set.length >= 2 ? '' : 'disabled'}>Abwerfen (${sel.set.length})</button>
        <button class="ghost" data-ui="set-cancel">Abbrechen</button>`;
    } else if (step === 'start' || step === 'draw') {
      prompt = step === 'start'
        ? `<b>Du bist dran${t.extraTurns ? ` (noch ${t.extraTurns} Extra-Zug${t.extraTurns > 1 ? 'züge' : ''} danach)` : ''}!</b> Zieh vom Stapel oder nimm die Ablagekarte.`
        : 'Zieh jetzt eine Karte vom Stapel oder nimm die Ablagekarte.';
      if (step === 'start') {
        buttons = `<button class="mayhem" data-act="call">🔥 MAYHEM! rufen</button>
          ${t.setUsed ? '' : '<button class="ghost" data-ui="set-mode">Gleiche abwerfen …</button>'}`;
      }
    } else if (step === 'decide') {
      const d = t.drawn;
      const canAction = d && d.kind === 'action' && t.drawnFrom === 'deck';
      prompt = t.drawnFrom === 'discard'
        ? 'Klicke eine deiner <b>verdeckten</b> Karten an, um sie (blind) zu ersetzen.'
        : 'Klicke eine deiner <b>verdeckten</b> Karten zum Tauschen an – oder lege die Karte ab.';
      if (canAction) prompt += ` Oder nutze die Aktion: <i>${esc(ACTION_META[d.action]?.hint)}</i>.`;
      buttons = `${canAction ? `<button class="primary" data-act="useAction">${ACTION_META[d.action].icon} ${esc(d.name)} ausführen</button>` : ''}
        ${t.drawnFrom === 'deck' ? '<button class="ghost" data-act="reject">Ablegen</button>' : ''}`;
    } else if (step === 'spy') {
      prompt = '👀 Klicke eine <b>beliebige verdeckte</b> Karte an (deine oder die eines Mitspielers).';
    } else if (step === 'swap') {
      prompt = `🔄 Wähle eine deiner verdeckten Karten ${sel.swapMine !== null ? '✔' : ''} und eine verdeckte Karte eines Mitspielers ${sel.swapTheirs ? '✔' : ''}.`;
    } else if (step === 'spyResult') {
      prompt = 'Merk dir die Karte!';
    } else if (step === 'reveal') {
      prompt = '<b>Zum Schluss:</b> Decke eine deiner verdeckten Karten auf.';
    }
  }
  $('#prompt').innerHTML = `<div class="prompt-text">${prompt}</div><div class="prompt-buttons">${buttons}</div>`;
  $('#prompt').classList.toggle('mine', !!myTurn || (g.phase === 'peek' && !g.peek.ready));

  // Letzte Aktion
  const last = g.log[g.log.length - 1];
  $('#lastlog').textContent = last ? last.text : '';

  // Eigene Hand
  const cols = Math.min(3, Math.ceil(me.hand.length / 2)) || 1;
  $('#myhand').innerHTML = `<div class="hand" style="--cols:${cols}">
    ${me.hand.map((s, i) => slotHTML(s, { pid: g.me, index: i, clickable: myClickable(s), animKey: `r${g.round}${s.peeking ? 'p' : ''}`,
      selected: (sel.mode === 'set' && sel.set.includes(i)) || sel.swapMine === i })).join('')}
  </div>`;
  $('#myinfo').innerHTML = `<span class="avatar">${esc(me.name.slice(0, 1).toUpperCase())}</span>
    <span class="pname">${esc(me.name)}</span> ${myTurn ? '<span class="badge turn">am Zug</span>' : ''}
    <span class="muted">Gesamt: <b>${me.total}</b> · offen: ${me.openSum}</span>`;
  $('#mine').classList.toggle('active', !!myTurn);

  // Kopfzeile
  $('#round-info').textContent = `Runde ${g.round} / ${g.rounds}`;

  // Seitenleiste
  renderScores(g);
  $('#log').innerHTML = g.log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('');

  // Overlays
  const m = $('#modal');
  if (g.spy && step === 'spyResult') {
    const owner = g.players.find((p) => p.id === g.spy.target);
    m.dataset.locked = '1';
    openModal(`<h2>👀 Gespickt!</h2>
      <p>${g.spy.target === g.me ? `Deine Karte ${g.spy.index + 1}` : `Karte ${g.spy.index + 1} von <b>${esc(owner?.name)}</b>`}:</p>
      <div class="modal-card">${cardFace(g.spy.card)}</div>
      <p class="muted">Merk sie dir – sie wird gleich wieder verdeckt.</p>
      <button class="primary big" data-act="ack">Gemerkt!</button>`, 'spy');
  } else if (g.phase === 'roundEnd' || g.phase === 'gameOver') {
    m.dataset.locked = '1';
    openModal(roundEndHTML(view), 'wide');
  } else if (m.dataset.locked === '1') {
    m.dataset.locked = '0';
    m.hidden = true;
  }
}

function rotateFrom(players, pid) {
  const i = players.findIndex((p) => p.id === pid);
  return i < 0 ? players : [...players.slice(i), ...players.slice(0, i)];
}

function renderScores(g) {
  const head = g.players.map((p) => `<th>${esc(p.name)}</th>`).join('');
  const rows = g.history.map((h) => `<tr><td>${h.round}</td>${g.players.map((p) => {
    const doubled = h.caller === p.id && h.callerFailed;
    const called = h.caller === p.id && !h.callerFailed;
    return `<td class="${doubled ? 'bad' : called ? 'good' : ''}">${h.scores[p.id]}${doubled ? ' ×2' : called ? ' 🔥' : ''}</td>`;
  }).join('')}</tr>`).join('');
  const totals = g.players.map((p) => `<td><b>${p.total}</b></td>`).join('');
  $('#scores').innerHTML = `<table><thead><tr><th>#</th>${head}</tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Σ</td>${totals}</tr></tfoot></table>`;
}

function roundEndHTML(view) {
  const g = view.game;
  const res = g.roundResult;
  const over = g.phase === 'gameOver';
  const sorted = [...g.players].sort((a, b) => res.scores[a.id] - res.scores[b.id]);
  const best = Math.min(...g.players.map((p) => res.scores[p.id]));
  const rows = sorted.map((p) => {
    const doubled = res.caller === p.id && res.callerFailed;
    return `<div class="result-row ${res.scores[p.id] === best ? 'best' : ''}">
      <div class="result-name">${esc(p.name)} ${res.caller === p.id ? '<span class="badge turn">🔥 rief Mayhem</span>' : ''}</div>
      <div class="hand xs" style="--cols:${p.hand.length}">${p.hand.map((s, i) => slotHTML(s, { pid: p.id, index: i, size: 'xs', animKey: `end${g.round}` })).join('')}</div>
      <div class="result-score">${doubled ? `<s>${res.raw[p.id]}</s> → <b class="bad">${res.scores[p.id]}</b>` : `<b>${res.scores[p.id]}</b>`}
        <span class="muted">Gesamt ${p.total}</span></div>
    </div>`;
  }).join('');
  let callerText = '';
  if (res.caller) {
    const c = g.players.find((p) => p.id === res.caller);
    callerText = res.callerFailed
      ? `<p class="callout bad">💥 ${esc(c.name)} hat sich verschätzt – Punkte verdoppelt!</p>`
      : `<p class="callout good">🏆 ${esc(c.name)} hatte recht mit „MAYHEM!“</p>`;
  }
  let footer;
  if (over) {
    const ranking = [...g.players].sort((a, b) => a.total - b.total)
      .map((p, i) => `<li><span class="rank">${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span> ${esc(p.name)} <b>${p.total}</b></li>`).join('');
    footer = `<h3>🎉 Gewonnen: ${esc(g.winners.join(' & '))}</h3><ol class="ranking">${ranking}</ol>
      ${view.room.isHost ? '<button class="primary big" data-act="newGame">Neues Spiel (zurück zur Lobby)</button>' : '<p class="muted">Der Host kann ein neues Spiel starten.</p>'}`;
  } else {
    footer = `<button class="primary big" data-act="nextRound">Nächste Runde ▶</button>
      <p class="muted">Wer diese Runde die meisten Punkte hatte, beginnt.</p>`;
  }
  return `<h2>${over ? 'Spielende' : `Runde ${g.round} vorbei`}</h2>${callerText}<div class="results">${rows}</div>${footer}`;
}

// ---------------------------------------------------------------- Regeln

const RULES_HTML = `
<h2>So wird gespielt</h2>
<p><b>Ziel:</b> Möglichst <b>wenige Punkte</b> sammeln. Nach allen Runden gewinnt die niedrigste Gesamtsumme.</p>
<h3>Aufbau</h3>
<p>Jeder bekommt 6 verdeckte Karten (kurzes Spiel: 4). Zu Beginn jeder Runde darfst du dir <b>2 davon einmal ansehen</b> – merk sie dir!</p>
<h3>Dein Zug</h3>
<ol>
  <li><b>Karte nehmen:</b> vom Stapel ziehen (nur du siehst sie) oder die oberste Ablagekarte nehmen.</li>
  <li><b>Entscheiden:</b>
    <ul>
      <li><b>Tauschen:</b> Die Karte ersetzt <i>blind</i> eine deiner verdeckten Karten. Die alte Karte kommt offen auf die Ablage.</li>
      <li><b>Ablegen:</b> Karte auf die Ablage (nur bei Karten vom Stapel).</li>
      <li><b>Aktion:</b> Nur wenn du eine Aktionskarte <i>vom Stapel</i> gezogen hast.</li>
    </ul></li>
  <li><b>Aufdecken:</b> Zum Schluss musst du immer eine deiner verdeckten Karten umdrehen. Offene Karten bleiben liegen und können nicht mehr getauscht werden.</li>
</ol>
<h3>Aktionskarten</h3>
<ul>
  <li>👀 <b>Spicken (9):</b> Sieh dir eine beliebige verdeckte Karte an – auch eine eigene.</li>
  <li>🔄 <b>Tauschen (10):</b> Tausche blind eine deiner verdeckten Karten mit einer verdeckten Karte eines Mitspielers.</li>
  <li>⏩ <b>Nochmal! (11):</b> Du machst danach zwei weitere Züge.</li>
</ul>
<p>Aktionskarten, die am Ende vor dir liegen, zählen ihren Wert!</p>
<h3>Gleiche abwerfen</h3>
<p>Zu Beginn deines Zuges darfst du <b>3+ gleiche Zahlenkarten</b> oder <b>2+ Aktionskarten</b> aus deinen <i>verdeckten</i> Karten abwerfen. Du ziehst dafür eine Karte und legst sie verdeckt zu dir. Passen die Karten nicht zusammen, behältst du sie <b>und</b> die neue Karte.</p>
<h3>Rundenende</h3>
<p>Die Runde endet, wenn jemand nur noch offene Karten hat – oder wenn jemand zu Beginn seines Zuges <b>„MAYHEM!“</b> ruft. Dann wird alles aufgedeckt und gezählt. Hat der Rufer nicht die niedrigste Summe (Gleichstand zählt für ihn), werden seine Punkte <b>verdoppelt</b>.</p>
<h3>Karten</h3>
<p>Zahlenkarten 0–8 (je 5×), zwei Minuskarten: <b>Goldener Mallow (−3)</b> und <b>Mallow-König (−5)</b>, sowie je 5 Aktionskarten.</p>
<button class="primary" data-ui="close-modal">Los geht's!</button>`;
