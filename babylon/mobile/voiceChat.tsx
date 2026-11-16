import { useEffect, useRef, useState } from 'react';
import { Ecs } from '@/ecs/current';
import type { Entity } from '@/ecs/world';
import { sessionNonce } from '@/controllers/net/sessionNonce';
import { addNotification } from '@/modules/chat/notify';

/**
 * BarrioMU: voz por proximidad en el celular (y en la web).
 *
 * - Un boton en la linea de arriba: un toque lo prende, mantenerlo apretado
 *   habla (push to talk), otro toque corto lo apaga. La tecla K hace lo mismo
 *   con teclado.
 * - Solo se abre conexion con los jugadores que el juego tiene dibujados al
 *   lado (los que llegan en la lista de objetos del mapa): la voz no atraviesa
 *   paredes ni mapas. El volumen baja con la distancia hasta desaparecer.
 * - Quien eres no lo decide este archivo: el `nonce` de la sesion de juego se
 *   cambia en la tablet por un ticket firmado (ver babylon/api/voice.ts). El
 *   audio va directo de un navegador al otro; la tablet solo senala.
 * - Si el navegador no da el microfono (o no hay HTTPS), no se rompe nada: el
 *   boton queda apagado y avisa una vez.
 */

const API = 'https://mu-api.makeseo.app';
/** Jugadores a la vez: mas de esto en la tablet gasta bateria sin ganancia. */
const MAX_PEERS = 6;
/** Distancia (en tiles) a la que se empieza a oir. */
const RANGE = 18;
/** Hasta aca se mantiene la conexion ya abierta (evita cortar al caminar). */
const KEEP = 26;
const POLL_MS = 700;
const PING_MS = 25_000;
const TAP_MS = 250;
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

type PeerInfo = { id: string; name: string };

type Link = {
  info: PeerInfo;
  pc: RTCPeerConnection;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  /** Para soltar un enlace que nunca paso de "new" (se perdio la oferta). */
  createdAt: number;
};

export type VoiceUi = { mode: 'off' | 'on'; talking: boolean; nearby: number; error: string };

/** El personaje con ese nombre, si el juego lo tiene cerca y en este mapa. */
function entityOf(name: string): Entity | null {
  const world = Ecs.world;
  if (!world) return null;
  const key = name.trim().toLowerCase();
  for (const entity of world.netObjsQuery.entities) {
    if (entity.localPlayer || !entity.transform) continue;
    const own = (entity.objectNameInWorld ?? '').trim().toLowerCase();
    if (!own || own !== key) continue;
    if (entity.worldIndex !== undefined && entity.worldIndex !== world.mapIndex) continue;
    return entity;
  }
  return null;
}

function heroDistance(entity: Entity): number | null {
  const hero = Ecs.world?.playerEntity;
  if (!hero || !hero.transform || !entity.transform) return null;
  return Math.hypot(entity.transform.pos.x - hero.transform.pos.x, entity.transform.pos.z - hero.transform.pos.z);
}

class VoiceEngine {
  mode: 'off' | 'on' = 'off';
  talking = false;
  error = '';
  private nearby = 0;
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private peers: PeerInfo[] = [];
  private links = new Map<string, Link>();
  private myName = '';
  private myId = '';
  private poll = 0;
  private ping = 0;
  private retry = 0;
  private listeners = new Set<(ui: VoiceUi) => void>();

  ui(): VoiceUi {
    return { mode: this.mode, talking: this.talking, nearby: this.nearby, error: this.error };
  }

  subscribe(fn: (ui: VoiceUi) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const ui = this.ui();
    for (const fn of this.listeners) fn(ui);
  }

  async toggle(): Promise<void> {
    if (this.mode === 'on') this.disable();
    else await this.enable();
  }

  async enable(): Promise<void> {
    if (this.mode === 'on') return;
    this.mode = 'on';
    this.error = '';
    this.emit();
    try {
      await this.openMic();
    } catch {
      this.error = 'sin microfono';
      this.mode = 'off';
      this.emit();
      addNotification('Voz: el navegador no dio el microfono (hace falta HTTPS y permiso)', 'info');
      return;
    }
    this.startLoops();
    await this.connect();
  }

  disable(): void {
    this.mode = 'off';
    this.talking = false;
    this.stopLoops();
    for (const id of [...this.links.keys()]) this.drop(id);
    this.peers = [];
    this.nearby = 0;
    try {
      this.ws?.close();
    } catch {
      /* ya cerrado */
    }
    this.ws = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.emit();
  }

  startTalk(): void {
    if (this.mode !== 'on') {
      void this.enable();
      return;
    }
    void this.ctx?.resume().catch(() => undefined);
    if (this.talking) return;
    this.talking = true;
    this.stream?.getAudioTracks().forEach(track => (track.enabled = true));
    this.signal({ t: 'talk', on: true });
    this.emit();
  }

  stopTalk(): void {
    if (!this.talking) return;
    this.talking = false;
    this.stream?.getAudioTracks().forEach(track => (track.enabled = false));
    this.signal({ t: 'talk', on: false });
    this.emit();
  }

  private async openMic(): Promise<void> {
    // El AudioContext tiene que nacer DENTRO del toque (antes del await del
    // permiso): si nace despues, Android lo deja suspendido y el audio de los
    // demas no suena hasta que el jugador aprieta para hablar.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    void ctx.resume().catch(() => undefined);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      this.ctx = null;
      void ctx.close().catch(() => undefined);
      throw error;
    }
    if (this.ctx !== ctx) {
      // Se apago mientras se esperaba el permiso.
      stream.getTracks().forEach(track => track.stop());
      void ctx.close().catch(() => undefined);
      throw new Error('voz apagada');
    }
    this.stream = stream;
    stream.getAudioTracks().forEach(track => (track.enabled = false));
  }

  private startLoops(): void {
    this.stopLoops();
    this.poll = window.setInterval(() => this.sync(), POLL_MS);
    this.ping = window.setInterval(() => this.signal({ t: 'ping' }), PING_MS);
  }

  private stopLoops(): void {
    if (this.poll) window.clearInterval(this.poll);
    if (this.ping) window.clearInterval(this.ping);
    this.poll = 0;
    this.ping = 0;
    if (this.retry) window.clearTimeout(this.retry);
    this.retry = 0;
  }

  private async connect(): Promise<void> {
    if (this.mode !== 'on') return;
    const world = Ecs.world;
    const name = (world?.playerEntity?.objectNameInWorld ?? '').trim();
    if (!name) {
      this.scheduleReconnect();
      return;
    }
    this.myName = name;

    let ticket = '';
    try {
      const res = await fetch(`${API}/voice/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: sessionNonce(), name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        this.error = body.error ?? `ticket ${res.status}`;
        this.emit();
        if (res.status >= 400 && res.status < 500) {
          // No es un corte pasajero: sin sesion de juego no hay voz. Se apaga.
          addNotification(`Voz: ${this.error}`, 'info');
          this.disable();
          return;
        }
        this.scheduleReconnect();
        return;
      }
      ticket = ((await res.json()) as { ticket?: string }).ticket ?? '';
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (!ticket || this.mode !== 'on') return;

    const url = `${API.replace('https://', 'wss://')}/voice?ticket=${encodeURIComponent(ticket)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      try {
        this.dispatch(JSON.parse(ev.data) as Record<string, unknown>);
      } catch {
        /* mensaje raro: se ignora */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const id of [...this.links.keys()]) this.drop(id);
      this.peers = [];
      this.nearby = 0;
      this.emit();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.mode !== 'on' || this.retry) return;
    this.retry = window.setTimeout(() => {
      this.retry = 0;
      void this.connect();
    }, 3000);
  }

  private dispatch(msg: Record<string, unknown>): void {
    const type = msg.t;
    if (type === 'welcome') {
      if (typeof msg.id === 'string') this.myId = msg.id;
      if (typeof msg.name === 'string') this.myName = msg.name;
      return;
    }
    if (type === 'peers') {
      const list = Array.isArray(msg.peers) ? (msg.peers as unknown[]) : [];
      this.peers = list
        .map(item => item as { id?: unknown; name?: unknown })
        .filter(item => typeof item.id === 'string' && typeof item.name === 'string')
        .map(item => ({ id: item.id as string, name: item.name as string }));
      this.sync();
      return;
    }
    if (type === 'signal') {
      const from = typeof msg.from === 'string' ? msg.from : '';
      const peer = this.peers.find(item => item.id === from);
      if (!peer) return;
      void this.onSignal(peer, msg.data as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit });
      return;
    }
  }

  private signal(body: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(body));
  }

  /** Sincroniza conexiones con quien esta cerca. Se llama varias veces por segundo. */
  private sync(): void {
    const world = Ecs.world;
    const hero = world?.playerEntity;
    if (!world || !hero) return;

    const mine = this.myName.trim().toLowerCase();
    const found: { peer: PeerInfo; distance: number }[] = [];
    for (const peer of this.peers) {
      if (peer.name.trim().toLowerCase() === mine) continue;
      const entity = entityOf(peer.name);
      if (!entity) continue;
      const distance = heroDistance(entity);
      if (distance === null || distance > KEEP) continue;
      found.push({ peer, distance });
    }
    found.sort((a, b) => a.distance - b.distance);

    const candidates = found.slice(0, MAX_PEERS);
    for (const candidate of candidates) {
      if (candidate.distance > RANGE) continue;
      if (this.links.has(candidate.peer.id)) continue;
      // El nombre menor de los dos ofrece; asi los dos no se ofrecen a la vez.
      const offerer = mine < candidate.peer.name.trim().toLowerCase();
      void this.createLink(candidate.peer, offerer);
    }

    for (const [id, link] of [...this.links]) {
      const still = found.find(item => item.peer.id === id);
      if (!still) {
        this.drop(id);
        continue;
      }
      // Si la oferta se perdio, el enlace se queda en "new" para siempre.
      if (link.pc.connectionState === 'new' && performance.now() - link.createdAt > 8000) {
        this.drop(id);
        continue;
      }
      this.setGain(link, still.distance);
    }

    const audible = candidates.filter(item => item.distance <= RANGE).length;
    if (this.nearby !== audible) {
      this.nearby = audible;
      this.emit();
    }
  }

  private async createLink(peer: PeerInfo, offerer: boolean): Promise<void> {
    if (this.links.has(peer.id)) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
    const link: Link = { info: peer, pc, gain: null, source: null, createdAt: performance.now() };
    this.links.set(peer.id, link);

    pc.onicecandidate = ev => {
      if (ev.candidate) this.signal({ t: 'signal', to: peer.id, data: { ice: ev.candidate.toJSON() } });
    };
    pc.ontrack = ev => {
      const ctx = this.ctx;
      if (!ctx) return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      try {
        link.source = ctx.createMediaStreamSource(stream);
        link.gain = ctx.createGain();
        link.gain.gain.value = 0;
        link.source.connect(link.gain).connect(ctx.destination);
      } catch {
        /* el navegador no dejo armar el audio: se oye sin volumen por distancia */
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(peer.id);
    };

    const track = this.stream?.getAudioTracks()[0];
    if (track && this.stream) pc.addTrack(track, this.stream);

    if (!offerer) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ t: 'signal', to: peer.id, data: { sdp: pc.localDescription } });
    } catch {
      this.drop(peer.id);
    }
  }

  private async onSignal(peer: PeerInfo, data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }): Promise<void> {
    let link = this.links.get(peer.id);
    if (!link) {
      await this.createLink(peer, false);
      link = this.links.get(peer.id);
      if (!link) return;
    }
    try {
      if (data.sdp) {
        await link.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await link.pc.createAnswer();
          await link.pc.setLocalDescription(answer);
          this.signal({ t: 'signal', to: peer.id, data: { sdp: link.pc.localDescription } });
        }
      } else if (data.ice) {
        await link.pc.addIceCandidate(data.ice);
      }
    } catch {
      /* una oferta vieja o fuera de orden: la proxima vuelve a intentar */
    }
  }

  private setGain(link: Link, distance: number): void {
    const ctx = this.ctx;
    if (!ctx || !link.gain) return;
    const near = Math.max(0, Math.min(1, 1 - distance / RANGE));
    link.gain.gain.setTargetAtTime(Math.pow(near, 1.6), ctx.currentTime, 0.2);
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    try {
      link.source?.disconnect();
      link.gain?.disconnect();
    } catch {
      /* ya desconectado */
    }
    try {
      link.pc.close();
    } catch {
      /* ya cerrado */
    }
  }
}

const engine = new VoiceEngine();

/** Boton de voz: toque = prender/apagar, mantener = hablar. */
export const VoiceChat = () => {
  const [ui, setUi] = useState<VoiceUi>(engine.ui());
  const pressedAt = useRef(0);
  const wasTalking = useRef(false);

  useEffect(() => engine.subscribe(setUi), []);

  // Al salir del mundo (muerte, cambio de mapa del HUD) no se queda el microfono abierto.
  useEffect(() => () => engine.disable(), []);

  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.code !== 'KeyK' || ev.repeat || typing(ev.target) || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      engine.startTalk();
    };
    const up = (ev: KeyboardEvent) => {
      if (ev.code !== 'KeyK') return;
      engine.stopTalk();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const label = ui.mode === 'off' ? '🎙' : ui.talking ? '🔴' : '🎙';
  const title =
    ui.mode === 'off'
      ? 'Voz: toca para prender'
      : `Voz prendida (${ui.nearby} cerca): mantén para hablar`;
  const classes = ['barrio-voice'];
  if (ui.mode === 'on') classes.push('is-on');
  if (ui.talking) classes.push('is-talking');

  return (
    <div
      className={classes.join(' ')}
      title={ui.error ? `Voz: ${ui.error}` : title}
      onContextMenu={ev => ev.preventDefault()}
      onPointerDown={ev => {
        ev.stopPropagation();
        ev.preventDefault();
        try {
          (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
        } catch {
          /* algun navegador no deja capturar: el puntero sigue funcionando */
        }
        pressedAt.current = performance.now();
        wasTalking.current = ui.mode === 'on';
        engine.startTalk();
      }}
      onPointerUp={ev => {
        ev.stopPropagation();
        engine.stopTalk();
        // Toque corto con la voz prendida = apagarla.
        if (wasTalking.current && performance.now() - pressedAt.current < TAP_MS) engine.disable();
        wasTalking.current = false;
      }}
      onPointerCancel={() => {
        engine.stopTalk();
        wasTalking.current = false;
      }}
    >
      <span className="barrio-voice-icon">{label}</span>
      {ui.mode === 'on' && ui.nearby > 0 && <span className="barrio-voice-count">{ui.nearby}</span>}
    </div>
  );
};
