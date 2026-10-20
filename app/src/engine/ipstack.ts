import { BCAST_IP, BCAST_MAC, broadcastOf, network, sameSubnet } from './addr';
import type { Device } from './engine';
import type { Frame, IcmpPacket, IpPacket } from './packets';

export interface L3If {
  name: string;
  ip?: number;
  mask?: number;
  mac: string;
  up: boolean;
  /** Point-to-point (serial): no ARP, frames go straight to the other end. */
  p2p?: boolean;
}

export interface StackHost {
  dev: Device;
  l3ifs(): L3If[];
  l2send(ifName: string, frame: Frame): void;
}

export type RouteCode = 'C' | 'L' | 'S' | 'S*';

export interface Route {
  code: RouteCode;
  net: number;
  mask: number;
  nextHop?: number;
  ifName?: string;
  ad: number;
  metric: number;
}

export interface StaticRoute {
  net: number;
  mask: number;
  nextHop?: number;
  ifName?: string;
  ad: number;
}

interface ArpEntry {
  mac: string;
  ifName: string;
  t: number;
}

interface Pending {
  ip: number;
  ifName: string;
  pkt: IpPacket;
  t: number;
}

export interface PingResult {
  seq: number;
  kind: 'reply' | 'timeout' | 'unreachable' | 'ttl-expired' | 'no-route';
  from?: number;
  rtt?: number;
  ttl?: number;
}

export interface PingOpts {
  count?: number;
  timeout?: number;
  ttl?: number;
  gap?: number;
  src?: number;
}

export const ARP_TIMEOUT = 1000;
const ARP_AGE = 4 * 60 * 60 * 1000;

let echoIdSeq = 100;

export class IpStack {
  arp = new Map<number, ArpEntry>();
  pending: Pending[] = [];
  private arpInFlight = new Map<number, number>();
  staticRoutes: StaticRoute[] = [];
  defaultGateway?: number;
  forwarding: boolean;
  ttlDefault: number;
  icmpListeners = new Map<number, (pkt: IpPacket) => void>();
  udpHandlers = new Map<number, (pkt: IpPacket, ifName: string) => void>();
  host: StackHost;

  constructor(host: StackHost, opts: { forwarding: boolean; ttl: number }) {
    this.host = host;
    this.forwarding = opts.forwarding;
    this.ttlDefault = opts.ttl;
  }

  private get engine() {
    return this.host.dev.engine;
  }

  ifs(): L3If[] {
    return this.host.l3ifs();
  }

  ifByName(n: string): L3If | undefined {
    return this.ifs().find((i) => i.name === n);
  }

  isMine(ip: number): boolean {
    return this.ifs().some((i) => i.ip === ip && i.up);
  }

  /** Any configured address, up or not (IOS answers pings to its own down interfaces locally). */
  ownsIp(ip: number): boolean {
    return this.ifs().some((i) => i.ip === ip);
  }

  flushIface(ifName: string) {
    for (const [ip, e] of this.arp) if (e.ifName === ifName) this.arp.delete(ip);
    this.pending = this.pending.filter((p) => p.ifName !== ifName);
  }

  // ---------- routing ----------
  routingTable(): Route[] {
    const out: Route[] = [];
    for (const i of this.ifs()) {
      if (!i.up || i.ip === undefined || i.mask === undefined) continue;
      out.push({ code: 'C', net: network(i.ip, i.mask), mask: i.mask, ifName: i.name, ad: 0, metric: 0 });
      if (this.forwarding) out.push({ code: 'L', net: i.ip, mask: 0xffffffff, ifName: i.name, ad: 0, metric: 0 });
    }
    const connected = [...out];
    for (const s of this.staticRoutes) {
      // install only when resolvable
      if (s.ifName) {
        if (!this.ifByName(s.ifName)?.up) continue;
      } else if (s.nextHop !== undefined) {
        if (!this.resolvable(s.nextHop, connected, 0)) continue;
      }
      // prefer lowest AD for the same prefix
      const dup = out.find((r) => r.net === s.net && r.mask === s.mask && r.code.startsWith('S'));
      if (dup && dup.ad < s.ad) continue;
      if (dup && dup.ad > s.ad) out.splice(out.indexOf(dup), 1);
      out.push({
        code: s.net === 0 && s.mask === 0 ? 'S*' : 'S',
        net: s.net,
        mask: s.mask,
        nextHop: s.nextHop,
        ifName: s.ifName,
        ad: s.ad,
        metric: 0,
      });
    }
    if (!this.forwarding && this.defaultGateway !== undefined) {
      const ok = connected.some((r) => r.code === 'C' && sameSubnet(r.net, this.defaultGateway!, r.mask));
      if (ok) out.push({ code: 'S*', net: 0, mask: 0, nextHop: this.defaultGateway, ad: 1, metric: 0 });
    }
    return out;
  }

  private resolvable(ip: number, connected: Route[], _depth: number): boolean {
    return connected.some((r) => r.code === 'C' && network(ip, r.mask) === r.net);
  }

  lookup(dst: number, table = this.routingTable()): Route | null {
    let best: Route | null = null;
    for (const r of table) {
      if (r.code === 'L') continue;
      if (network(dst, r.mask) !== r.net) continue;
      if (!best || r.mask >>> 0 > best.mask >>> 0 || (r.mask === best.mask && r.ad < best.ad)) best = r;
    }
    return best;
  }

  /** Resolve egress interface + next-hop IP for a destination. */
  resolve(dst: number): { ifName: string; nh: number } | null {
    const table = this.routingTable();
    let target = dst;
    for (let depth = 0; depth < 5; depth++) {
      const r = this.lookup(target, table);
      if (!r) return null;
      if (r.code === 'C') return { ifName: r.ifName!, nh: target };
      if (r.ifName && r.nextHop === undefined) return { ifName: r.ifName, nh: target === dst ? dst : target };
      if (r.ifName && r.nextHop !== undefined) return { ifName: r.ifName, nh: r.nextHop };
      target = r.nextHop!;
    }
    return null;
  }

  sourceFor(dst: number): number | undefined {
    if (this.isMine(dst)) return dst;
    const r = this.resolve(dst);
    if (!r) return undefined;
    return this.ifByName(r.ifName)?.ip;
  }

  // ---------- receive ----------
  receiveFrame(ifName: string, frame: Frame) {
    if (frame.arp) this.handleArp(ifName, frame);
    else if (frame.ip) this.handleIp(ifName, frame.ip, frame);
  }

  private learn(ip: number, mac: string, ifName: string) {
    this.arp.set(ip, { mac, ifName, t: this.engine.now });
    this.arpInFlight.delete(ip);
    const ready = this.pending.filter((p) => p.ip === ip);
    this.pending = this.pending.filter((p) => p.ip !== ip);
    for (const p of ready) this.emit(p.ifName, mac, p.pkt);
  }

  private handleArp(ifName: string, frame: Frame) {
    const a = frame.arp!;
    const l3 = this.ifByName(ifName);
    if (!l3 || l3.ip === undefined) return;
    if (a.op === 'request') {
      if (a.targetIp === l3.ip) {
        this.learn(a.senderIp, a.senderMac, ifName);
        this.host.l2send(ifName, {
          src: l3.mac,
          dst: a.senderMac,
          type: 'arp',
          arp: { op: 'reply', senderMac: l3.mac, senderIp: l3.ip, targetMac: a.senderMac, targetIp: a.senderIp },
        });
      } else {
        if (this.arp.has(a.senderIp)) this.learn(a.senderIp, a.senderMac, ifName);
        this.host.dev.drop(frame, `ARP for ${ipStr(a.targetIp)} is not for this interface`);
      }
    } else if (a.targetIp === l3.ip) {
      this.learn(a.senderIp, a.senderMac, ifName);
    }
  }

  private handleIp(ifName: string, pkt: IpPacket, frame: Frame) {
    const l3 = this.ifByName(ifName);
    if (!l3) return;
    const subnetBcast = l3.ip !== undefined && l3.mask !== undefined && pkt.dst === broadcastOf(l3.ip, l3.mask);
    const local = pkt.dst === BCAST_IP || subnetBcast || this.ownsIp(pkt.dst);
    if (local) {
      this.deliverLocal(ifName, pkt);
      return;
    }
    if (!this.forwarding) {
      this.host.dev.drop(frame, 'packet is not addressed to this host');
      return;
    }
    this.forward(ifName, pkt, frame);
  }

  private deliverLocal(ifName: string, pkt: IpPacket) {
    if (pkt.icmp) {
      const ic = pkt.icmp;
      if (ic.type === 'echo-request') {
        if (pkt.dst === BCAST_IP) return;
        const l3 = this.ifByName(ifName);
        const src = this.ownsIp(pkt.dst) ? pkt.dst : l3?.ip;
        if (src === undefined) return;
        this.sendIp({
          src,
          dst: pkt.src,
          ttl: this.ttlDefault,
          proto: 'icmp',
          icmp: { type: 'echo-reply', id: ic.id, seq: ic.seq },
        });
      } else {
        const key = ic.type === 'echo-reply' ? ic.id : ic.origId;
        if (key !== undefined) this.icmpListeners.get(key)?.(pkt);
      }
      return;
    }
    if (pkt.udp) {
      const h = this.udpHandlers.get(pkt.udp.dstPort);
      if (h) h(pkt, ifName);
    }
  }

  private forward(inIf: string, pkt: IpPacket, frame: Frame) {
    const ttl = pkt.ttl - 1;
    if (ttl <= 0) {
      this.host.dev.drop(frame, 'TTL expired in transit');
      this.icmpError(pkt, 'time-exceeded', inIf);
      return;
    }
    const r = this.resolve(pkt.dst);
    if (!r) {
      this.host.dev.drop(frame, `no route to ${ipStr(pkt.dst)}`);
      this.icmpError(pkt, 'unreachable', inIf);
      return;
    }
    this.out(r.ifName, r.nh, { ...pkt, ttl });
  }

  icmpError(orig: IpPacket, type: 'time-exceeded' | 'unreachable', inIf: string) {
    if (orig.icmp && orig.icmp.type !== 'echo-request' && orig.icmp.type !== 'echo-reply') return;
    if (orig.proto !== 'icmp') return;
    const src = this.ifByName(inIf)?.ip;
    if (src === undefined) return;
    const icmp: IcmpPacket = { type, id: 0, seq: 0, origId: orig.icmp?.id, origSeq: orig.icmp?.seq };
    this.sendIp({ src, dst: orig.src, ttl: this.ttlDefault, proto: 'icmp', icmp });
  }

  // ---------- send ----------
  /** Returns false if there was no route. */
  sendIp(pkt: IpPacket, opts: { broadcastOn?: string } = {}): boolean {
    if (opts.broadcastOn) {
      const l3 = this.ifByName(opts.broadcastOn);
      if (!l3 || !l3.up) return false;
      this.host.l2send(opts.broadcastOn, { src: l3.mac, dst: BCAST_MAC, type: 'ipv4', ip: pkt });
      return true;
    }
    if (this.ownsIp(pkt.dst)) {
      // loopback
      this.engine.schedule(0, () => this.deliverLocal(this.ifs().find((i) => i.ip === pkt.dst)!.name, pkt));
      return true;
    }
    const r = this.resolve(pkt.dst);
    if (!r) return false;
    this.out(r.ifName, r.nh, pkt);
    return true;
  }

  private out(ifName: string, nh: number, pkt: IpPacket) {
    const l3 = this.ifByName(ifName);
    if (!l3 || !l3.up) return;
    if (l3.ip !== undefined && l3.mask !== undefined && nh === broadcastOf(l3.ip, l3.mask)) {
      this.host.l2send(ifName, { src: l3.mac, dst: BCAST_MAC, type: 'ipv4', ip: pkt });
      return;
    }
    if (l3.p2p) {
      this.host.l2send(ifName, { src: l3.mac, dst: BCAST_MAC, type: 'ipv4', ip: pkt });
      return;
    }
    const e = this.arp.get(nh);
    if (e && this.engine.now - e.t < ARP_AGE) {
      this.emit(ifName, e.mac, pkt);
      return;
    }
    if (!this.forwarding) {
      this.pending.push({ ip: nh, ifName, pkt, t: this.engine.now });
    } else {
      this.host.dev.drop({ src: l3.mac, dst: BCAST_MAC, type: 'ipv4', ip: pkt }, `waiting for ARP of ${ipStr(nh)}, packet discarded`);
    }
    this.arpRequest(ifName, nh);
  }

  private emit(ifName: string, mac: string, pkt: IpPacket) {
    const l3 = this.ifByName(ifName);
    if (!l3) return;
    this.host.l2send(ifName, { src: l3.mac, dst: mac, type: 'ipv4', ip: pkt });
  }

  private arpRequest(ifName: string, ip: number) {
    const l3 = this.ifByName(ifName);
    if (!l3 || l3.ip === undefined) return;
    const inflight = this.arpInFlight.get(ip);
    if (inflight !== undefined && this.engine.now - inflight < ARP_TIMEOUT) return;
    this.arpInFlight.set(ip, this.engine.now);
    this.host.l2send(ifName, {
      src: l3.mac,
      dst: BCAST_MAC,
      type: 'arp',
      arp: { op: 'request', senderMac: l3.mac, senderIp: l3.ip, targetMac: '000000000000', targetIp: ip },
    });
    this.engine.schedule(ARP_TIMEOUT, () => {
      if (this.arpInFlight.get(ip) !== undefined && this.engine.now - this.arpInFlight.get(ip)! >= ARP_TIMEOUT) {
        this.arpInFlight.delete(ip);
      }
      this.pending = this.pending.filter((p) => !(p.ip === ip && this.engine.now - p.t >= ARP_TIMEOUT));
    });
  }

  // ---------- applications ----------
  ping(
    dst: number,
    opts: PingOpts,
    onResult: (r: PingResult) => void,
    onDone: (all: PingResult[]) => void,
  ): () => void {
    const count = opts.count ?? 5;
    const timeout = opts.timeout ?? 2000;
    const gap = opts.gap ?? 20;
    const id = ++echoIdSeq;
    let seq = 0;
    let timer: ReturnType<IpStack['engine']['schedule']> | null = null;
    let sentAt = 0;
    let stopped = false;
    const results: PingResult[] = [];
    const eng = this.engine;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      this.icmpListeners.delete(id);
      onDone(results);
    };
    const record = (r: PingResult) => {
      results.push(r);
      onResult(r);
      if (seq >= count) eng.schedule(gap, finish);
      else eng.schedule(r.kind === 'reply' ? gap * 10 : gap, sendNext);
    };
    const sendNext = () => {
      if (stopped) return;
      seq++;
      const mySeq = seq;
      const src = opts.src ?? this.sourceFor(dst);
      if (src === undefined) {
        record({ seq: mySeq, kind: 'no-route' });
        return;
      }
      sentAt = eng.now;
      const ok = this.sendIp({ src, dst, ttl: opts.ttl ?? this.ttlDefault, proto: 'icmp', icmp: { type: 'echo-request', id, seq: mySeq } });
      if (!ok) {
        record({ seq: mySeq, kind: 'no-route' });
        return;
      }
      timer = eng.schedule(timeout, () => {
        if (seq === mySeq) record({ seq: mySeq, kind: 'timeout' });
      });
    };
    this.icmpListeners.set(id, (p) => {
      const ic = p.icmp!;
      const s = ic.type === 'echo-reply' ? ic.seq : ic.origSeq;
      if (s !== seq || stopped) return;
      eng.cancel(timer);
      timer = null;
      const kind = ic.type === 'echo-reply' ? 'reply' : ic.type === 'time-exceeded' ? 'ttl-expired' : 'unreachable';
      record({ seq: s, kind, from: p.src, rtt: Math.max(0, eng.now - sentAt), ttl: p.ttl });
      // stale seq protection: bump so the cancelled timeout can't fire twice
    });
    sendNext();
    return () => {
      eng.cancel(timer);
      finish();
    };
  }

  traceroute(
    dst: number,
    opts: { maxHops?: number; probes?: number; timeout?: number },
    onHop: (ttl: number, probes: PingResult[]) => void,
    onDone: () => void,
  ): () => void {
    const maxHops = opts.maxHops ?? 30;
    const probes = opts.probes ?? 3;
    let ttl = 0;
    let cancel: (() => void) | null = null;
    let stopped = false;
    const next = () => {
      if (stopped) return;
      ttl++;
      if (ttl > maxHops) {
        onDone();
        return;
      }
      const myTtl = ttl;
      cancel = this.ping(
        dst,
        { count: probes, ttl: myTtl, timeout: opts.timeout ?? 1500, gap: 5 },
        () => {},
        (all) => {
          onHop(myTtl, all);
          const reached = all.some((r) => r.kind === 'reply' || r.kind === 'unreachable' || r.kind === 'no-route');
          if (reached) onDone();
          else next();
        },
      );
    };
    next();
    return () => {
      stopped = true;
      cancel?.();
    };
  }
}

function ipStr(n: number) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
