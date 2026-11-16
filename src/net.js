// Verbindung zum Spielserver (Cloudflare Worker) per WebSocket.

// Der Spielserver. Für lokale Tests: ?server=ws://127.0.0.1:8787 (nur localhost erlaubt).
const DEFAULT_SERVER = 'wss://marshmellow-mayhem.nicolasfortune13.workers.dev';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(q)) return q.replace(/\/$/, '');
  return DEFAULT_SERVER;
}

export function makeCode(len = 6) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (const n of buf) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/^MALLOW-/, '').replace(/[^A-Z0-9]/g, '');
}

/**
 * Öffnet eine WebSocket-Verbindung für einen Raum.
 * handlers: { onMessage(msg), onClose(event) }
 * Liefert { send(msg), close() }.
 */
export function connect(code, handlers) {
  const ws = new WebSocket(`${serverUrl()}/ws?code=${encodeURIComponent(code)}`);
  let ping = null;
  ws.addEventListener('open', () => {
    // Hält die Verbindung wach (der Server beantwortet Pings automatisch).
    ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}'); }, 25000);
    handlers.onOpen?.();
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg?.t === 'pong') return;
    handlers.onMessage(msg);
  });
  ws.addEventListener('close', (e) => {
    clearInterval(ping);
    handlers.onClose(e);
  });
  return {
    get open() { return ws.readyState === WebSocket.OPEN; },
    send(msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    close() { try { ws.close(1000, 'bye'); } catch { /* egal */ } },
  };
}
