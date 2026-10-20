import { BCAST_IP, broadcastOf, network } from './addr';
import type { IpStack } from './ipstack';
import type { DhcpMsg, IpPacket } from './packets';

export interface DhcpPool {
  name: string;
  net?: number;
  mask?: number;
  router?: number;
  dns?: number;
  /** Server-device pools: first address handed out and max users. */
  start?: number;
  max?: number;
}

export interface DhcpBinding {
  ip: number;
  mac: string;
  pool: string;
  t: number;
}

/** DHCP server + relay. Used by routers (IOS pools) and the Server device. */
export class DhcpServer {
  pools: DhcpPool[] = [];
  excluded: { lo: number; hi: number }[] = [];
  bindings = new Map<string, DhcpBinding>();
  enabled = true;
  stack: IpStack;
  /** helper-address lookup for relaying: iface name -> server IP */
  helperFor: (ifName: string) => number | undefined = () => undefined;

  constructor(stack: IpStack) {
    this.stack = stack;
    stack.udpHandlers.set(67, (pkt, ifName) => this.onPacket(pkt, ifName));
  }

  private poolFor(subnetIp: number): DhcpPool | undefined {
    return this.pools.find((p) => p.net !== undefined && p.mask !== undefined && network(subnetIp, p.mask) === p.net);
  }

  private isExcluded(ip: number) {
    return this.excluded.some((e) => ip >= e.lo && ip <= e.hi);
  }

  private allocate(pool: DhcpPool, mac: string): number | undefined {
    const existing = this.bindings.get(mac);
    if (existing && existing.pool === pool.name) return existing.ip;
    const used = new Set([...this.bindings.values()].map((b) => b.ip));
    const ownIps = new Set(this.stack.ifs().map((i) => i.ip).filter((x): x is number => x !== undefined));
    let lo = network(pool.net!, pool.mask!) + 1;
    let hi = broadcastOf(pool.net!, pool.mask!) - 1;
    if (pool.start !== undefined) {
      lo = Math.max(lo, pool.start);
      if (pool.max !== undefined) hi = Math.min(hi, pool.start + pool.max - 1);
    }
    for (let ip = lo; ip <= hi; ip++) {
      if (used.has(ip) || ownIps.has(ip) || ip === pool.router || this.isExcluded(ip)) continue;
      return ip;
    }
    return undefined;
  }

  private onPacket(pkt: IpPacket, ifName: string) {
    const msg = pkt.udp?.dhcp;
    if (!msg) return;
    const inIf = this.stack.ifByName(ifName);
    if (!inIf) return;

    // Relay agent receiving a server reply addressed to it: forward to the client segment.
    if ((msg.op === 'offer' || msg.op === 'ack' || msg.op === 'nak') && msg.giaddr !== undefined) {
      const cIf = this.stack.ifs().find((i) => i.ip === msg.giaddr);
      if (cIf) {
        this.stack.sendIp(
          { src: msg.giaddr, dst: BCAST_IP, ttl: 255, proto: 'udp', udp: { srcPort: 67, dstPort: 68, dhcp: { ...msg } } },
          { broadcastOn: cIf.name },
        );
      }
      return;
    }
    if (msg.op !== 'discover' && msg.op !== 'request') return;

    const subnetIp = msg.giaddr ?? inIf.ip;
    const pool = this.enabled && subnetIp !== undefined ? this.poolFor(subnetIp) : undefined;
    if (!pool) {
      // relay?
      const helper = msg.giaddr === undefined ? this.helperFor(ifName) : undefined;
      if (helper !== undefined && inIf.ip !== undefined) {
        this.stack.sendIp({
          src: inIf.ip,
          dst: helper,
          ttl: 255,
          proto: 'udp',
          udp: { srcPort: 67, dstPort: 67, dhcp: { ...msg, giaddr: inIf.ip } },
        });
      }
      return;
    }
    const serverIp = inIf.ip!;
    if (msg.op === 'request' && msg.serverId !== undefined && msg.serverId !== serverIp && !this.stack.ownsIp(msg.serverId)) {
      return; // client picked another server
    }
    const ip = msg.op === 'request' && msg.requested !== undefined ? this.claim(pool, msg) : this.allocate(pool, msg.chaddr);
    const reply: DhcpMsg = {
      op: ip === undefined ? (msg.op === 'request' ? 'nak' : 'nak') : msg.op === 'discover' ? 'offer' : 'ack',
      xid: msg.xid,
      chaddr: msg.chaddr,
      yiaddr: ip,
      serverId: serverIp,
      mask: pool.mask,
      router: pool.router,
      dns: pool.dns,
      giaddr: msg.giaddr,
    };
    if (msg.op === 'discover' && ip === undefined) return; // pool exhausted, stay silent
    if (reply.op === 'ack') this.bindings.set(msg.chaddr, { ip: ip!, mac: msg.chaddr, pool: pool.name, t: this.stack.host.dev.engine.now });
    if (msg.giaddr !== undefined) {
      this.stack.sendIp({ src: serverIp, dst: msg.giaddr, ttl: 255, proto: 'udp', udp: { srcPort: 67, dstPort: 67, dhcp: reply } });
    } else {
      this.stack.sendIp(
        { src: serverIp, dst: BCAST_IP, ttl: 255, proto: 'udp', udp: { srcPort: 67, dstPort: 68, dhcp: reply } },
        { broadcastOn: ifName },
      );
    }
  }

  private claim(pool: DhcpPool, msg: DhcpMsg): number | undefined {
    const ip = msg.requested!;
    if (network(ip, pool.mask!) !== pool.net) return undefined;
    const owner = [...this.bindings.values()].find((b) => b.ip === ip);
    if (owner && owner.mac !== msg.chaddr) return undefined;
    if (this.isExcluded(ip)) return undefined;
    return ip;
  }
}

export type DhcpClientState = 'idle' | 'selecting' | 'requesting' | 'bound' | 'failed';

/** Minimal DHCP client for end devices. */
export class DhcpClient {
  state: DhcpClientState = 'idle';
  private xid = 0;
  private timer: { cancelled?: boolean } | null = null;
  stack: IpStack;
  ifName: string;
  onBound: (m: DhcpMsg) => void = () => {};
  onFail: () => void = () => {};

  constructor(stack: IpStack, ifName: string) {
    this.stack = stack;
    this.ifName = ifName;
    stack.udpHandlers.set(68, (pkt) => this.onPacket(pkt));
  }

  private get eng() {
    return this.stack.host.dev.engine;
  }

  start() {
    this.cancel();
    this.xid = Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.state = 'selecting';
    this.attempt(0);
  }

  /** Retransmit DISCOVER a few times (first relayed copy is often lost to ARP), then give up. */
  private attempt(n: number) {
    if (this.state !== 'selecting') return;
    if (n >= 4) {
      this.state = 'failed';
      this.onFail();
      return;
    }
    this.send({ op: 'discover', xid: this.xid, chaddr: this.mac() });
    this.timer = this.eng.schedule(1500, () => this.attempt(n + 1));
  }

  cancel() {
    if (this.timer) this.eng.cancel(this.timer as never);
    this.timer = null;
    this.state = 'idle';
  }

  private mac() {
    return this.stack.ifByName(this.ifName)!.mac;
  }

  private send(dhcp: DhcpMsg) {
    this.stack.sendIp(
      { src: 0, dst: BCAST_IP, ttl: 128, proto: 'udp', udp: { srcPort: 68, dstPort: 67, dhcp } },
      { broadcastOn: this.ifName },
    );
  }

  private onPacket(pkt: IpPacket) {
    const m = pkt.udp?.dhcp;
    if (!m || m.xid !== this.xid || m.chaddr !== this.mac()) return;
    if (m.op === 'offer' && this.state === 'selecting') {
      this.state = 'requesting';
      if (this.timer) this.eng.cancel(this.timer as never);
      this.send({ op: 'request', xid: this.xid, chaddr: this.mac(), requested: m.yiaddr, serverId: m.serverId });
      this.timer = this.eng.schedule(1500, () => {
        if (this.state === 'requesting') {
          this.state = 'selecting';
          this.attempt(2);
        }
      });
    } else if (m.op === 'ack' && this.state === 'requesting') {
      this.state = 'bound';
      if (this.timer) this.eng.cancel(this.timer as never);
      this.onBound(m);
    } else if (m.op === 'nak') {
      this.state = 'failed';
      if (this.timer) this.eng.cancel(this.timer as never);
      this.onFail();
    }
  }
}
