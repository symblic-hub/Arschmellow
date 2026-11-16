// Marshmellow Mayhem – reine Spiellogik (kein DOM, kein Netzwerk).
// Der Host hält den vollständigen Zustand und ruft applyAction() auf;
// jeder Spieler bekommt per viewFor() nur das zu sehen, was er sehen darf.

export const CONFIG = {
  handSize: 6,
  shortHandSize: 4,
  rounds: 6,
  peekCount: 2,
  minPlayers: 2,
  maxPlayers: 6,
  // Zahlenkarten: Wert -> Anzahl
  numbers: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
  // Minuskarten (zählen als Zahlenkarten)
  specials: [
    { value: -3, name: 'Goldener Mallow', count: 1 },
    { value: -5, name: 'Mallow-König', count: 1 },
  ],
  // Aktionskarten
  actions: [
    { action: 'spy', value: 9, name: 'Spicken', count: 5 },
    { action: 'swap', value: 10, name: 'Tauschen', count: 5 },
    { action: 'again', value: 11, name: 'Nochmal!', count: 5 },
  ],
  setMinNumbers: 3,
  setMinActions: 2,
  extraTurnsForAgain: 2,
  logLimit: 60,
};

export const ROAST_NAMES = [
  'Fluffig', 'Zart', 'Angewärmt', 'Goldig', 'Gebräunt',
  'Knusprig', 'Angekokelt', 'Verkohlt', 'Brikett',
];

export class RuleError extends Error {}

const fail = (msg) => { throw new RuleError(msg); };

/** Nur echte Spieler-IDs – keine geerbten Objekt-Schlüssel wie "__proto__". */
const hasPlayer = (state, id) => typeof id === 'string' && Object.hasOwn(state.hands, id);

// ---------------------------------------------------------------- Deck

export function buildDeck(config = CONFIG) {
  const deck = [];
  let id = 0;
  for (const [v, count] of Object.entries(config.numbers)) {
    const value = Number(v);
    for (let i = 0; i < count; i++) {
      deck.push({ id: id++, kind: 'number', value, name: ROAST_NAMES[value] ?? `Mallow ${value}` });
    }
  }
  for (const s of config.specials) {
    for (let i = 0; i < s.count; i++) deck.push({ id: id++, kind: 'number', value: s.value, name: s.name, special: true });
  }
  for (const a of config.actions) {
    for (let i = 0; i < a.count; i++) deck.push({ id: id++, kind: 'action', action: a.action, value: a.value, name: a.name });
  }
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- Setup

/**
 * players: [{ id, name }]
 * options: { short?: boolean, rounds?: number }
 */
export function createGame(players, options = {}, rng = Math.random) {
  if (players.length < CONFIG.minPlayers) fail(`Mindestens ${CONFIG.minPlayers} Spieler nötig.`);
  if (players.length > CONFIG.maxPlayers) fail(`Höchstens ${CONFIG.maxPlayers} Spieler möglich.`);
  const state = {
    options: {
      handSize: options.short ? CONFIG.shortHandSize : CONFIG.handSize,
      rounds: clampInt(options.rounds ?? CONFIG.rounds, 1, 20),
    },
    players: players.map((p) => ({ id: p.id, name: p.name })),
    totals: Object.fromEntries(players.map((p) => [p.id, 0])),
    history: [], // [{ round, scores: {pid: n}, raw: {pid: n}, caller, callerFailed }]
    round: 0,
    starter: null,
    log: [],
    seq: 0,
  };
  const first = players[Math.floor(rng() * players.length)].id;
  startRound(state, first, rng);
  return state;
}

function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

function startRound(state, starter, rng) {
  state.round += 1;
  state.starter = starter;
  state.deck = shuffle(buildDeck(), rng);
  state.discard = [];
  state.hands = {};
  for (const p of state.players) {
    state.hands[p.id] = [];
    for (let i = 0; i < state.options.handSize; i++) state.hands[p.id].push({ card: state.deck.pop(), up: false });
  }
  state.discard.push(state.deck.pop());
  state.phase = 'peek';
  state.peek = Object.fromEntries(state.players.map((p) => [p.id, { seen: [], ready: false }]));
  state.turn = null;
  state.private = {}; // pid -> { spy: {...} }
  state.roundResult = null;
  state.caller = null;
  log(state, `Runde ${state.round} beginnt. Schaut euch je ${CONFIG.peekCount} eurer Karten an!`);
}

function log(state, text) {
  state.log.push({ n: ++state.seq, text });
  if (state.log.length > CONFIG.logLimit) state.log.splice(0, state.log.length - CONFIG.logLimit);
}

function nameOf(state, pid) {
  return state.players.find((p) => p.id === pid)?.name ?? '???';
}

function cardLabel(card) {
  return `${card.name} (${card.value})`;
}

function newTurn(state, pid, extraTurns = 0) {
  state.turn = { player: pid, step: 'start', drawn: null, drawnFrom: null, extraTurns, setUsed: false };
}

function nextPlayerId(state, pid) {
  const i = state.players.findIndex((p) => p.id === pid);
  return state.players[(i + 1) % state.players.length].id;
}

function drawFromDeck(state, rng) {
  if (state.deck.length === 0) {
    if (state.discard.length <= 1) return null;
    const top = state.discard.pop();
    state.deck = shuffle(state.discard, rng);
    state.discard = [top];
    log(state, 'Der Nachziehstapel ist leer – die Ablage wird neu gemischt.');
  }
  return state.deck.pop();
}

function hiddenIndex(hand, index, what = 'Karte') {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= hand.length) fail(`Ungültige ${what}.`);
  if (hand[i].up) fail('Diese Karte liegt schon offen.');
  return i;
}

// ---------------------------------------------------------------- Actions

/**
 * Wendet eine Aktion an (mutiert state). Wirft RuleError bei ungültigen Zügen.
 * action: { type, ... }
 */
export function applyAction(state, pid, action, rng = Math.random) {
  if (!hasPlayer(state, pid)) fail('Du spielst in dieser Partie nicht mit.');
  const type = action?.type;

  // --- Ansehen-Phase
  if (state.phase === 'peek') {
    const pk = state.peek[pid];
    if (type === 'peek') {
      if (pk.ready) fail('Du hast dir deine Karten schon gemerkt.');
      const i = hiddenIndex(state.hands[pid], action.index);
      if (pk.seen.includes(i)) return state;
      if (pk.seen.length >= CONFIG.peekCount) fail(`Du darfst nur ${CONFIG.peekCount} Karten ansehen.`);
      pk.seen.push(i);
      return state;
    }
    if (type === 'ready') {
      const need = Math.min(CONFIG.peekCount, state.hands[pid].length);
      if (pk.seen.length < need) fail(`Sieh dir zuerst ${need} Karten an.`);
      pk.ready = true;
      if (Object.values(state.peek).every((p) => p.ready)) {
        state.phase = 'turn';
        newTurn(state, state.starter);
        log(state, `Alle bereit! ${nameOf(state, state.starter)} beginnt.`);
      }
      return state;
    }
    fail('Warte, bis alle ihre Karten angesehen haben.');
  }

  // --- Rundenende / Spielende
  if (state.phase === 'roundEnd') {
    if (type !== 'nextRound') fail('Die Runde ist vorbei.');
    const last = state.history[state.history.length - 1];
    // Wer die meisten Punkte in der Runde hatte, beginnt.
    let starter = state.players[0].id;
    let max = -Infinity;
    for (const p of state.players) {
      if (last.scores[p.id] > max) { max = last.scores[p.id]; starter = p.id; }
    }
    startRound(state, starter, rng);
    return state;
  }
  if (state.phase === 'gameOver') fail('Das Spiel ist vorbei.');

  // --- Zugphase
  const t = state.turn;
  if (t.player !== pid) fail('Du bist nicht am Zug.');
  const hand = state.hands[pid];
  const me = nameOf(state, pid);

  switch (t.step) {
    case 'start':
    case 'draw': {
      if (type === 'call') {
        if (t.step !== 'start') fail('Rufen geht nur zu Beginn deines Zuges.');
        state.caller = pid;
        log(state, `🔥 ${me} ruft „MAYHEM!“`);
        endRound(state);
        return state;
      }
      if (type === 'set') {
        if (t.step !== 'start' || t.setUsed) fail('Gleiche Karten kannst du nur zu Beginn deines Zuges abwerfen.');
        const idx = [...new Set((action.indices ?? []).map(Number))];
        idx.forEach((i) => hiddenIndex(hand, i));
        const cards = idx.map((i) => hand[i].card);
        const allActions = cards.every((c) => c.kind === 'action');
        const allNumbers = cards.every((c) => c.kind === 'number');
        if (idx.length < Math.min(CONFIG.setMinActions, CONFIG.setMinNumbers)) fail('Wähle mindestens 2 Karten aus.');
        const drawn = drawFromDeck(state, rng);
        if (!drawn) fail('Es gibt keine Karten mehr zum Ziehen.');
        const valid =
          (allActions && idx.length >= CONFIG.setMinActions) ||
          (allNumbers && idx.length >= CONFIG.setMinNumbers && cards.every((c) => c.value === cards[0].value));
        const shown = cards.map(cardLabel).join(', ');
        if (valid) {
          // Karten entfernen (absteigend, damit Indizes stimmen)
          [...idx].sort((a, b) => b - a).forEach((i) => hand.splice(i, 1));
          cards.forEach((c) => state.discard.push(c));
          hand.push({ card: drawn, up: false });
          log(state, `✨ ${me} wirft ${idx.length} gleiche Karten ab: ${shown}. Eine neue Karte kommt verdeckt dazu.`);
        } else {
          hand.push({ card: drawn, up: false });
          log(state, `😬 ${me} wollte abwerfen, aber die Karten passen nicht: ${shown}. Strafe: eine Karte mehr!`);
        }
        t.setUsed = true;
        t.step = 'draw';
        return state;
      }
      if (type === 'draw') {
        if (action.from === 'discard') {
          if (state.discard.length === 0) fail('Die Ablage ist leer.');
          t.drawn = state.discard.pop();
          t.drawnFrom = 'discard';
          log(state, `${me} nimmt ${cardLabel(t.drawn)} von der Ablage.`);
        } else {
          const c = drawFromDeck(state, rng);
          if (!c) {
            log(state, 'Keine Karten mehr – die Runde endet.');
            endRound(state);
            return state;
          }
          t.drawn = c;
          t.drawnFrom = 'deck';
          log(state, `${me} zieht eine Karte vom Stapel.`);
        }
        t.step = 'decide';
        return state;
      }
      fail('Zieh zuerst eine Karte.');
    }

    case 'decide': {
      if (type === 'replace') {
        const i = hiddenIndex(hand, action.index);
        const old = hand[i].card;
        hand[i] = { card: t.drawn, up: false };
        state.discard.push(old);
        log(state, `${me} tauscht Karte ${i + 1} aus – weg ist ${cardLabel(old)}.`);
        t.drawn = null;
        t.step = 'reveal';
        return state;
      }
      if (type === 'reject') {
        if (t.drawnFrom === 'discard') fail('Eine Karte von der Ablage musst du gegen eine eigene tauschen.');
        state.discard.push(t.drawn);
        log(state, `${me} legt ${cardLabel(t.drawn)} ab.`);
        t.drawn = null;
        t.step = 'reveal';
        return state;
      }
      if (type === 'useAction') {
        if (t.drawn.kind !== 'action') fail('Das ist keine Aktionskarte.');
        if (t.drawnFrom !== 'deck') fail('Aktionen gibt es nur für Karten vom Nachziehstapel.');
        const a = t.drawn.action;
        if (a === 'spy') {
          t.step = 'spy';
          log(state, `👀 ${me} spielt „Spicken“.`);
        } else if (a === 'swap') {
          const others = state.players.filter((p) => p.id !== pid && state.hands[p.id].some((s) => !s.up));
          if (others.length === 0) fail('Niemand hat noch verdeckte Karten zum Tauschen.');
          t.step = 'swap';
          log(state, `🔄 ${me} spielt „Tauschen“.`);
        } else if (a === 'again') {
          t.extraTurns += CONFIG.extraTurnsForAgain;
          state.discard.push(t.drawn);
          t.drawn = null;
          t.step = 'reveal';
          log(state, `⏩ ${me} spielt „Nochmal!“ und bekommt ${CONFIG.extraTurnsForAgain} Extra-Züge.`);
        }
        return state;
      }
      fail('Tausche die Karte, lege sie ab oder nutze die Aktion.');
    }

    case 'spy': {
      if (type !== 'spy') fail('Wähle eine verdeckte Karte zum Ansehen.');
      const target = action.target;
      if (!hasPlayer(state, target)) fail('Unbekannter Spieler.');
      const i = hiddenIndex(state.hands[target], action.index);
      state.private[pid] = { spy: { target, index: i, card: state.hands[target][i].card } };
      state.discard.push(t.drawn);
      t.drawn = null;
      t.step = 'spyResult';
      log(state, target === pid
        ? `${me} spickt bei der eigenen Karte ${i + 1}.`
        : `${me} spickt bei ${nameOf(state, target)} (Karte ${i + 1}).`);
      return state;
    }

    case 'spyResult': {
      if (type !== 'ack') fail('Bestätige zuerst, dass du die Karte gesehen hast.');
      delete state.private[pid];
      t.step = 'reveal';
      return state;
    }

    case 'swap': {
      if (type !== 'swap') fail('Wähle eine eigene und eine fremde verdeckte Karte.');
      const target = action.target;
      if (target === pid || !hasPlayer(state, target)) fail('Wähle einen Mitspieler.');
      const mi = hiddenIndex(hand, action.myIndex, 'eigene Karte');
      const ti = hiddenIndex(state.hands[target], action.theirIndex, 'fremde Karte');
      const theirs = state.hands[target][ti];
      state.hands[target][ti] = hand[mi];
      hand[mi] = theirs;
      state.discard.push(t.drawn);
      t.drawn = null;
      t.step = 'reveal';
      log(state, `${me} tauscht die eigene Karte ${mi + 1} mit Karte ${ti + 1} von ${nameOf(state, target)}.`);
      return state;
    }

    case 'reveal': {
      if (type !== 'reveal') fail('Decke jetzt eine deiner verdeckten Karten auf.');
      const i = hiddenIndex(hand, action.index);
      hand[i].up = true;
      log(state, `${me} deckt ${cardLabel(hand[i].card)} auf.`);
      advance(state);
      return state;
    }
  }
  fail('Unbekannte Aktion.');
}

function advance(state) {
  const t = state.turn;
  const done = state.players.find((p) => state.hands[p.id].every((s) => s.up));
  if (done) {
    log(state, `${nameOf(state, done.id)} hat nur noch offene Karten – Rundenende!`);
    endRound(state);
    return;
  }
  if (t.extraTurns > 0) {
    newTurn(state, t.player, t.extraTurns - 1);
    log(state, `${nameOf(state, t.player)} ist nochmal dran (Extra-Zug).`);
  } else {
    newTurn(state, nextPlayerId(state, t.player));
  }
}

/** Host-Notfall: Zug eines (offline) Spielers überspringen bzw. ihn in der Ansehen-Phase auf „bereit“ setzen. */
export function skipPlayer(state, pid) {
  if (!hasPlayer(state, pid)) fail('Unbekannter Spieler.');
  if (state.phase === 'peek') {
    const pk = state.peek[pid];
    if (!pk || pk.ready) fail('Dieser Spieler ist schon bereit.');
    pk.ready = true;
    log(state, `${nameOf(state, pid)} wird übersprungen (offline).`);
    if (Object.values(state.peek).every((p) => p.ready)) {
      state.phase = 'turn';
      newTurn(state, state.starter);
      log(state, `Alle bereit! ${nameOf(state, state.starter)} beginnt.`);
    }
    return state;
  }
  if (state.phase !== 'turn' || state.turn.player !== pid) fail('Dieser Spieler ist gerade nicht am Zug.');
  const t = state.turn;
  if (t.drawn) { state.discard.push(t.drawn); t.drawn = null; }
  delete state.private[pid];
  log(state, `Der Zug von ${nameOf(state, pid)} wird übersprungen (offline).`);
  newTurn(state, nextPlayerId(state, pid));
  return state;
}

export function handSum(hand) {
  return hand.reduce((s, slot) => s + slot.card.value, 0);
}

function endRound(state) {
  // Eine gezogene, noch nicht abgelegte Karte wandert auf die Ablage.
  if (state.turn?.drawn) { state.discard.push(state.turn.drawn); state.turn.drawn = null; }
  const raw = {};
  for (const p of state.players) raw[p.id] = handSum(state.hands[p.id]);
  const scores = { ...raw };
  let callerFailed = false;
  if (state.caller) {
    const others = state.players.filter((p) => p.id !== state.caller).map((p) => raw[p.id]);
    // Annahme: Gleichstand zählt als Erfolg; nur wer echt weniger hat, schlägt den Rufer.
    if (others.some((v) => v < raw[state.caller])) {
      callerFailed = true;
      if (scores[state.caller] > 0) scores[state.caller] *= 2;
    }
  }
  for (const p of state.players) state.totals[p.id] += scores[p.id];
  const result = { round: state.round, raw, scores, caller: state.caller, callerFailed };
  state.history.push(result);
  state.roundResult = result;
  state.turn = null;
  state.private = {};
  for (const p of state.players) state.hands[p.id].forEach((s) => { s.revealedAtEnd = !s.up; });

  if (state.caller) {
    log(state, callerFailed
      ? `💥 ${nameOf(state, state.caller)} lag daneben – Punkte verdoppelt (${raw[state.caller]} → ${scores[state.caller]})!`
      : `🏆 ${nameOf(state, state.caller)} hatte recht – niemand hat weniger Punkte!`);
  }
  const summary = state.players.map((p) => `${p.name}: ${scores[p.id]}`).join(' · ');
  log(state, `Runde ${state.round} – ${summary}`);

  if (state.round >= state.options.rounds) {
    state.phase = 'gameOver';
    const best = Math.min(...Object.values(state.totals));
    const winners = state.players.filter((p) => state.totals[p.id] === best).map((p) => p.name);
    state.winners = winners;
    log(state, `🎉 Spielende! Gewonnen: ${winners.join(' & ')} mit ${best} Punkten.`);
  } else {
    state.phase = 'roundEnd';
  }
}

// ---------------------------------------------------------------- Sicht pro Spieler

/** Liefert die Sicht, die Spieler `pid` sehen darf (JSON-serialisierbar). */
export function viewFor(state, pid) {
  const showAll = state.phase === 'roundEnd' || state.phase === 'gameOver';
  const t = state.turn;
  const players = state.players.map((p) => {
    const peek = state.phase === 'peek' && p.id === pid ? state.peek[pid] : null;
    const hand = state.hands[p.id].map((s, i) => {
      const peeking = peek && !peek.ready && peek.seen.includes(i);
      const visible = s.up || showAll || peeking;
      return { up: s.up, card: visible ? s.card : null, peeking: !!peeking, revealedAtEnd: showAll && !!s.revealedAtEnd };
    });
    return {
      id: p.id,
      name: p.name,
      total: state.totals[p.id],
      hand,
      openSum: state.hands[p.id].filter((s) => s.up).reduce((a, s) => a + s.card.value, 0),
      ready: state.phase === 'peek' ? state.peek[p.id].ready : undefined,
    };
  });
  let turn = null;
  if (t) {
    const isMe = t.player === pid;
    turn = {
      player: t.player,
      step: t.step,
      extraTurns: t.extraTurns,
      setUsed: t.setUsed,
      drawnFrom: t.drawnFrom,
      hasDrawn: !!t.drawn,
      // Karte vom Nachziehstapel sieht nur der Ziehende; Ablagekarte war ohnehin öffentlich.
      drawn: t.drawn && (isMe || t.drawnFrom === 'discard') ? t.drawn : null,
    };
  }
  const myPeek = state.phase === 'peek' ? state.peek[pid] : null;
  return {
    me: pid,
    phase: state.phase,
    round: state.round,
    rounds: state.options.rounds,
    handSize: state.options.handSize,
    players,
    turn,
    deckCount: state.deck.length,
    discardTop: state.discard[state.discard.length - 1] ?? null,
    discardCount: state.discard.length,
    peek: myPeek ? { seen: myPeek.seen.length, ready: myPeek.ready, need: CONFIG.peekCount } : null,
    spy: state.private[pid]?.spy ?? null,
    roundResult: state.roundResult,
    history: state.history,
    caller: state.caller,
    winners: state.winners ?? null,
    log: state.log.slice(-30),
  };
}
