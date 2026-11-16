// Marshmellow Mayhem – Spielserver (Cloudflare Worker + Durable Object pro Raum).
// Die Spieler verbinden sich per WebSocket: wss://<worker>/ws?code=ABC123

import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './roomcore.js';

const MAX_MESSAGE = 8 * 1024;
const ROOM_TTL = 24 * 3600 * 1000; // Räume ohne Aktivität werden nach 24 h gelöscht
const CODE_RE = /^[A-Z0-9]{4,8}$/;

function originAllowed(origin, allowed) {
  if (!origin) return false;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  if (list.includes('localhost') && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('Marshmellow Mayhem Spielserver läuft 🍬', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname !== '/ws') return new Response('Nicht gefunden', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return new Response('Herkunft nicht erlaubt', { status: 403 });
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code)) return new Response('Ungültiger Raumcode', { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Pings beantworten, ohne den Raum aus dem Ruhezustand zu wecken
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      const data = (await ctx.storage.get('room')) ?? null;
      this.core = new RoomCore(data, this.transport());
    });
  }

  transport() {
    const ctx = this.ctx;
    return {
      sockets: () => ctx.getWebSockets()
        .filter((ws) => ws.readyState === WebSocket.OPEN)
        .map((ws) => ({ sock: ws, pid: ws.deserializeAttachment()?.pid ?? null })),
      send: (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* Verbindung schon weg */ } },
      setPid: (ws, pid) => ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), pid }),
      close: (ws, code, reason) => { try { ws.close(code, reason); } catch { /* egal */ } },
    };
  }

  async fetch(request) {
    const code = String(new URL(request.url).searchParams.get('code') || '').toUpperCase();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: null, code });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) { ws.close(1009, 'zu groß'); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const changed = this.core.handle(ws, msg, att.pid, att.code);
    if (changed) await this.persist();
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment() || {};
    this.core.onClose(ws, att.pid);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async persist() {
    if (!this.core.data) return;
    await this.ctx.storage.put('room', this.core.data);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
  }

  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.core = new RoomCore(null, this.transport());
  }
}
