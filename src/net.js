// Dünner Wrapper um PeerJS (window.Peer aus vendor/peerjs.min.js).
// Standard: öffentlicher PeerJS-Broker (0.peerjs.com). Für lokale Tests:
//   ?peerHost=localhost&peerPort=9000[&peerPath=/][&peerSecure=0]

const PREFIX = 'mmayhem-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const peerIdFor = (code) => PREFIX + code.toUpperCase();

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

export function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: Number(q.get('peerDebug') || 0) };
  if (q.get('peerHost')) {
    opts.host = q.get('peerHost');
    opts.port = Number(q.get('peerPort') || 9000);
    opts.path = q.get('peerPath') || '/';
    opts.secure = q.get('peerSecure') === '1';
    opts.config = { iceServers: [] };
  }
  return opts;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
    const onError = (err) => { cleanup(); peer.destroy(); reject(err); };
    const onOpen = () => { cleanup(); resolve(peer); };
    const cleanup = () => { peer.off('open', onOpen); peer.off('error', onError); };
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

/** Öffnet den Host-Peer. Ist die ID noch belegt (z. B. nach Neuladen), wird mehrmals erneut versucht. */
export async function openHostPeer(code, { retries = 0, delayMs = 3000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openPeer(peerIdFor(code));
    } catch (err) {
      if (err?.type === 'unavailable-id' && attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export function openClientPeer() {
  return openPeer(null);
}

export function describePeerError(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'Raum nicht gefunden. Stimmt der Code? Ist der Host noch online?';
    case 'unavailable-id': return 'Dieser Raumcode ist gerade belegt.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Keine Verbindung zum Vermittlungsserver. Internet prüfen und neu laden.';
    case 'browser-incompatible': return 'Dein Browser unterstützt WebRTC nicht. Nimm Chrome, Firefox oder Edge.';
    case 'webrtc': return 'Direkte Verbindung fehlgeschlagen (WebRTC). Evtl. blockiert ein Firmen-/Schulnetz.';
    default: return `Verbindungsfehler: ${err?.message || err}`;
  }
}
