import { cloneFrame, describeFrame, pduKind, type Frame, type PduKind } from './packets';

export type DeviceKind = 'pc' | 'laptop' | 'server' | 'switch' | 'router';
export type CableType = 'straight' | 'cross' | 'auto';

export interface Iface {
  name: string;
  mac: string;
  adminUp: boolean;
  physical: boolean;
  speed: number; // Mbps
  ip?: number;
  mask?: number;
  description?: string;
  // switchport
  swMode?: 'access' | 'trunk';
  swModeSet?: boolean;
  accessVlan?: number;
  nativeVlan?: number;
  allowedVlans?: number[] | null;
  // router sub-interface
  parent?: string;
  dot1q?: number;
  dot1qNative?: boolean;
  // switch virtual interface
  sviVlan?: number;
  helper?: number;
  linkId?: string;
}

export interface LinkEnd {
  dev: string;
  iface: string;
}

export interface Link {
  id: string;
  a: LinkEnd;
  b: LinkEnd;
  cable: CableType;
}

export interface PduEvent {
  id: number;
  t: number;
  from: string; // device id
  to: string; // device id
  linkId?: string;
  frame: Frame;
  kind: PduKind;
  info: string;
  status: 'transit' | 'drop';
}

interface QEvent {
  t: number;
  seq: number;
  fn: () => void;
  pdu?: PduEvent;
  cancelled?: boolean;
}

export const LINK_DELAY = 1; // ms of virtual time per hop

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export abstract class Device {
  id: string;
  abstract kind: DeviceKind;
  abstract model: string;
  hostname: string;
  x = 0;
  y = 0;
  ifaces = new Map<string, Iface>();
  engine!: Engine;
  private lineCache = new Map<string, boolean>();
  consoleSink: ((text: string) => void) | null = null;
  consoleBacklog: string[] = [];

  constructor(id: string, hostname: string) {
    this.id = id;
    this.hostname = hostname;
  }

  abstract receive(ifName: string, frame: Frame): void;
  abstract toJSON(): Record<string, unknown>;
  /** Called when a line-protocol state changes. */
  protected onLineChange(_ifName: string, _up: boolean): void {}

  physicalIfaces(): Iface[] {
    return [...this.ifaces.values()].filter((i) => i.physical);
  }

  lineUp(name: string): boolean {
    const i = this.ifaces.get(name);
    if (!i || !i.adminUp) return false;
    if (i.parent) return this.lineUp(i.parent);
    if (i.sviVlan !== undefined) return this.sviUp(i);
    return this.engine ? this.engine.physUp(this, i) : false;
  }

  protected sviUp(_i: Iface): boolean {
    return false;
  }

  sendFrame(ifName: string, frame: Frame) {
    this.engine.transmit(this, ifName, frame);
  }

  console(text: string) {
    if (this.consoleSink) this.consoleSink(text);
    else {
      this.consoleBacklog.push(text);
      if (this.consoleBacklog.length > 200) this.consoleBacklog.shift();
    }
  }

  /** Re-evaluate every interface's line state; fire change hooks. */
  refreshLines(initial = false) {
    for (const i of this.ifaces.values()) {
      const up = this.lineUp(i.name);
      const prev = this.lineCache.get(i.name);
      this.lineCache.set(i.name, up);
      if (prev === undefined) {
        if (initial || !up) continue;
      }
      if (prev !== up) this.onLineChange(i.name, up);
    }
  }

  drop(frame: Frame, reason: string) {
    this.engine?.noteDrop(this, frame, reason);
  }
}

export function deviceGroup(kind: DeviceKind): 'X' | 'N' {
  return kind === 'switch' ? 'X' : 'N';
}

export class Engine {
  devices = new Map<string, Device>();
  links = new Map<string, Link>();
  now = 0;
  version = 0;
  mode: 'realtime' | 'simulation' = 'realtime';
  log: PduEvent[] = [];
  private q: QEvent[] = [];
  private seq = 0;
  private pduSeq = 0;
  lastStep: PduEvent[] = [];
  maxLog = 800;

  bump() {
    this.version++;
  }

  // ---------- topology ----------
  addDevice(d: Device) {
    d.engine = this;
    this.devices.set(d.id, d);
    d.refreshLines(true);
    this.bump();
  }

  removeDevice(id: string) {
    const d = this.devices.get(id);
    if (!d) return;
    for (const l of [...this.links.values()]) if (l.a.dev === id || l.b.dev === id) this.disconnect(l.id);
    this.devices.delete(id);
    this.bump();
  }

  connect(a: LinkEnd, b: LinkEnd, cable: CableType, id = uid('l')): Link | string {
    const da = this.devices.get(a.dev);
    const db = this.devices.get(b.dev);
    if (!da || !db) return 'Device not found';
    if (a.dev === b.dev) return 'A device cannot be cabled to itself';
    const ia = da.ifaces.get(a.iface);
    const ib = db.ifaces.get(b.iface);
    if (!ia || !ib) return 'Port not found';
    if (ia.linkId || ib.linkId) return 'That port is already in use';
    const link: Link = { id, a, b, cable };
    ia.linkId = id;
    ib.linkId = id;
    this.links.set(id, link);
    this.refreshAll();
    this.bump();
    return link;
  }

  disconnect(linkId: string) {
    const l = this.links.get(linkId);
    if (!l) return;
    for (const end of [l.a, l.b]) {
      const i = this.devices.get(end.dev)?.ifaces.get(end.iface);
      if (i) i.linkId = undefined;
    }
    this.links.delete(linkId);
    this.refreshAll();
    this.bump();
  }

  cableOk(l: Link): boolean {
    if (l.cable === 'auto') return true;
    const ka = this.devices.get(l.a.dev)!.kind;
    const kb = this.devices.get(l.b.dev)!.kind;
    const same = deviceGroup(ka) === deviceGroup(kb);
    return l.cable === 'cross' ? same : !same;
  }

  physUp(d: Device, i: Iface): boolean {
    if (!i.linkId) return false;
    const l = this.links.get(i.linkId);
    if (!l || !this.cableOk(l)) return false;
    const other = l.a.dev === d.id && l.a.iface === i.name ? l.b : l.a;
    const oi = this.devices.get(other.dev)?.ifaces.get(other.iface);
    return !!oi && oi.adminUp;
  }

  peer(devId: string, ifName: string): LinkEnd | null {
    const i = this.devices.get(devId)?.ifaces.get(ifName);
    if (!i?.linkId) return null;
    const l = this.links.get(i.linkId)!;
    return l.a.dev === devId && l.a.iface === ifName ? l.b : l.a;
  }

  /** Light state of one end of a link for drawing. */
  endState(devId: string, ifName: string): 'up' | 'down' {
    const d = this.devices.get(devId);
    if (!d) return 'down';
    return d.lineUp(ifName) ? 'up' : 'down';
  }

  refreshAll() {
    for (const d of this.devices.values()) d.refreshLines();
  }

  // ---------- scheduling ----------
  schedule(delay: number, fn: () => void, pdu?: PduEvent): QEvent {
    const ev: QEvent = { t: this.now + Math.max(0, delay), seq: this.seq++, fn, pdu };
    // binary insert keeping (t, seq) order
    let lo = 0;
    let hi = this.q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.q[mid];
      if (m.t < ev.t || (m.t === ev.t && m.seq < ev.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.q.splice(lo, 0, ev);
    return ev;
  }

  cancel(ev: QEvent | null | undefined) {
    if (ev) ev.cancelled = true;
  }

  pendingCount(): number {
    return this.q.filter((e) => !e.cancelled).length;
  }

  /** Packets currently on a wire (for realtime/sim drawing). */
  inFlight(): PduEvent[] {
    return this.q.filter((e) => !e.cancelled && e.pdu).map((e) => e.pdu!);
  }

  transmit(d: Device, ifName: string, frame: Frame) {
    const i = d.ifaces.get(ifName);
    if (!i || !i.physical || !d.lineUp(ifName)) return;
    const l = this.links.get(i.linkId!);
    if (!l) return;
    const other = l.a.dev === d.id && l.a.iface === ifName ? l.b : l.a;
    const f = cloneFrame(frame);
    const pdu: PduEvent = {
      id: ++this.pduSeq,
      t: this.now,
      from: d.id,
      to: other.dev,
      linkId: l.id,
      frame: f,
      kind: pduKind(f),
      info: describeFrame(f),
      status: 'transit',
    };
    this.schedule(
      LINK_DELAY,
      () => {
        const target = this.devices.get(other.dev);
        if (!target) return;
        if (!target.lineUp(other.iface)) return;
        target.receive(other.iface, cloneFrame(f));
      },
      pdu,
    );
  }

  noteDrop(d: Device, frame: Frame, reason: string) {
    if (this.mode !== 'simulation') return;
    this.pushLog({
      id: ++this.pduSeq,
      t: this.now,
      from: d.id,
      to: d.id,
      frame: cloneFrame(frame),
      kind: pduKind(frame),
      info: `${d.hostname} dropped: ${reason}`,
      status: 'drop',
    });
  }

  private pushLog(p: PduEvent) {
    this.log.push(p);
    if (this.log.length > this.maxLog) this.log.splice(0, this.log.length - this.maxLog);
    this.lastStep.push(p);
  }

  private runEvent(ev: QEvent) {
    if (ev.cancelled) return;
    this.now = Math.max(this.now, ev.t);
    if (ev.pdu && this.mode === 'simulation') {
      ev.pdu.t = ev.t;
      this.pushLog(ev.pdu);
    }
    ev.fn();
  }

  /** Realtime: advance virtual clock by dt ms, processing everything due. */
  tick(dt: number, maxEvents = 20000) {
    const until = this.now + dt;
    let n = 0;
    while (this.q.length && this.q[0].t <= until && n < maxEvents) {
      const ev = this.q.shift()!;
      this.runEvent(ev);
      n++;
    }
    if (n >= maxEvents) {
      // runaway (e.g. broadcast storm in a loop): throw away the backlog
      this.q = this.q.filter((e) => !e.pdu);
    }
    this.now = Math.max(this.now, until);
    if (n) this.bump();
  }

  /** Simulation: jump to the next instant that has events and run all of them. */
  stepNext(): PduEvent[] {
    this.lastStep = [];
    // skip cancelled heads
    while (this.q.length && this.q[0].cancelled) this.q.shift();
    if (!this.q.length) return [];
    const t = this.q[0].t;
    let guard = 0;
    while (this.q.length && this.q[0].t === t && guard < 5000) {
      this.runEvent(this.q.shift()!);
      guard++;
    }
    this.bump();
    return this.lastStep;
  }

  /** Simulation: keep stepping until a step produces a PDU (skips pure timer steps). */
  stepVisible(maxSteps = 50): PduEvent[] {
    for (let i = 0; i < maxSteps; i++) {
      if (!this.q.some((e) => !e.cancelled)) return [];
      const r = this.stepNext();
      if (r.length) return r;
    }
    return [];
  }

  /** Run until idle or limit (used in tests and for config replays). */
  runFor(ms: number) {
    const end = this.now + ms;
    while (this.q.length && this.q[0].t <= end) this.runEvent(this.q.shift()!);
    this.now = end;
    this.bump();
  }

  clearLog() {
    this.log = [];
    this.lastStep = [];
    this.bump();
  }

  resetTraffic() {
    this.q = [];
    this.log = [];
    this.lastStep = [];
    this.bump();
  }
}
