import { BCAST_MAC, newMac } from '../addr';
import { Device, type DeviceKind, type Iface } from '../engine';
import { IpStack, type L3If } from '../ipstack';
import { modelSpec } from '../models';
import type { Frame } from '../packets';
import { IosState } from './ios-state';

export interface MacEntry {
  vlan: number;
  mac: string;
  port: string;
  t: number;
}

export const MAC_AGE = 300_000;

/**
 * Layer 2 switch. Multilayer models (kind 'l3switch') can also route between
 * SVIs and routed ports once `ip routing` is enabled.
 */
export class Switch extends Device {
  kind: DeviceKind;
  model: string;
  vlans = new Map<number, string>([[1, 'default']]);
  macTable = new Map<string, MacEntry>();
  stack: IpStack;
  ios = new IosState();
  ipRouting = false;

  constructor(id: string, hostname = 'Switch', model?: string) {
    super(id, hostname);
    const spec = modelSpec(model, 'switch');
    this.model = spec.id;
    this.kind = spec.kind;
    const base = newMac();
    for (const p of spec.ports) this.addPort(p.name, p.speed, p.media);
    for (const m of spec.mgmt) this.mgmt.set(m.name, { name: m.name, mac: '000000000000', adminUp: true, physical: true, speed: m.speed, media: m.media });
    this.ifaces.set('Vlan1', { name: 'Vlan1', mac: base, adminUp: false, physical: false, speed: 1000, sviVlan: 1 });
    this.stack = new IpStack(
      { dev: this, l3ifs: () => this.l3ifs(), l2send: (n, f) => this.l3send(n, f) },
      { forwarding: false, ttl: 255 },
    );
  }

  get multilayer() {
    return this.kind === 'l3switch';
  }

  setRouting(on: boolean) {
    this.ipRouting = on && this.multilayer;
    this.stack.forwarding = this.ipRouting;
  }

  addPort(name: string, speed: number, media: Iface['media']) {
    this.ifaces.set(name, {
      name,
      mac: newMac(),
      adminUp: true,
      physical: true,
      speed,
      media,
      swMode: 'access',
      accessVlan: 1,
      nativeVlan: 1,
      allowedVlans: null,
    });
  }

  ensureVlan(id: number) {
    if (!this.vlans.has(id)) this.vlans.set(id, `VLAN${String(id).padStart(4, '0')}`);
  }

  addSvi(vlan: number): Iface {
    const name = `Vlan${vlan}`;
    let i = this.ifaces.get(name);
    if (!i) {
      i = { name, mac: this.ifaces.get('Vlan1')?.mac ?? newMac(), adminUp: false, physical: false, speed: 1000, sviVlan: vlan };
      this.ifaces.set(name, i);
    }
    return i;
  }

  /** SVIs plus routed ports carry IP. */
  l3ifs(): L3If[] {
    return [...this.ifaces.values()]
      .filter((i) => i.sviVlan !== undefined || i.routed)
      .map((i) => ({ name: i.name, ip: i.ip, mask: i.mask, mac: i.mac, up: this.lineUp(i.name) }));
  }

  protected sviUp(i: Iface): boolean {
    const v = i.sviVlan!;
    if (!this.vlans.has(v)) return false;
    return this.physicalIfaces().some((p) => !p.routed && this.carries(p, v) && this.lineUp(p.name));
  }

  /**
   * Operational switchport mode. A port left in its default (dynamic) mode
   * becomes a trunk when the switch at the other end is set to trunk, like DTP.
   */
  opMode(p: Iface): 'access' | 'trunk' {
    if (p.swModeSet || p.swMode === 'trunk') return p.swMode ?? 'access';
    const peer = this.engine?.peer(this.id, p.name);
    const pd = peer && this.engine.devices.get(peer.dev);
    if (peer && pd instanceof Switch) {
      const pi = pd.ifaces.get(peer.iface);
      if (pi && !pi.routed && pi.swModeSet && pi.swMode === 'trunk') return 'trunk';
    }
    return 'access';
  }

  carries(p: Iface, vlan: number): boolean {
    if (p.routed) return false;
    if (this.opMode(p) === 'trunk') return (p.allowedVlans === null || !!p.allowedVlans?.includes(vlan)) && this.vlans.has(vlan);
    return p.accessVlan === vlan;
  }

  receive(inPort: string, frame: Frame) {
    const p = this.ifaces.get(inPort);
    if (!p || !this.lineUp(inPort)) return;
    if (p.routed) {
      if (frame.vlan !== undefined) return this.drop(frame, 'tagged frame on a routed port');
      if (frame.dst !== p.mac && frame.dst !== BCAST_MAC) return this.drop(frame, 'frame not addressed to this routed port');
      this.stack.receiveFrame(inPort, frame);
      return;
    }
    let vlan: number;
    if (this.opMode(p) === 'trunk') {
      vlan = frame.vlan ?? p.nativeVlan ?? 1;
      if (!(p.allowedVlans === null || p.allowedVlans?.includes(vlan))) {
        this.drop(frame, `VLAN ${vlan} not allowed on trunk ${inPort}`);
        return;
      }
    } else {
      if (frame.vlan !== undefined) {
        this.drop(frame, `tagged frame received on access port ${inPort}`);
        return;
      }
      vlan = p.accessVlan ?? 1;
    }
    if (!this.vlans.has(vlan)) {
      this.drop(frame, `VLAN ${vlan} does not exist`);
      return;
    }
    const f: Frame = { ...frame };
    delete f.vlan;
    if (frame.src !== BCAST_MAC) {
      this.macTable.set(`${vlan}|${frame.src}`, { vlan, mac: frame.src, port: inPort, t: this.engine.now });
    }
    this.forward(vlan, f, inPort);
  }

  private forward(vlan: number, f: Frame, inPort: string | null) {
    const svi = this.ifaces.get(`Vlan${vlan}`);
    if (svi && inPort !== null && this.lineUp(svi.name)) {
      if (f.dst === svi.mac || f.dst === BCAST_MAC) this.stack.receiveFrame(svi.name, f);
      if (f.dst === svi.mac) return;
    }
    if (f.dst !== BCAST_MAC) {
      const e = this.macTable.get(`${vlan}|${f.dst}`);
      if (e && this.engine.now - e.t < MAC_AGE) {
        if (e.port === inPort) {
          this.drop(f, 'destination is on the same port (filtered)');
          return;
        }
        if (this.lineUp(e.port)) {
          this.egress(e.port, vlan, f);
          return;
        }
      }
    }
    let sent = 0;
    for (const p of this.physicalIfaces()) {
      if (p.name === inPort || !this.lineUp(p.name) || !this.carries(p, vlan)) continue;
      this.egress(p.name, vlan, f);
      sent++;
    }
    if (!sent && inPort !== null) this.drop(f, `no other ports in VLAN ${vlan}`);
  }

  private egress(port: string, vlan: number, f: Frame) {
    const p = this.ifaces.get(port)!;
    const out: Frame = { ...f };
    if (this.opMode(p) === 'trunk' && vlan !== (p.nativeVlan ?? 1)) out.vlan = vlan;
    else delete out.vlan;
    this.sendFrame(port, out);
  }

  private l3send(name: string, f: Frame) {
    const i = this.ifaces.get(name);
    if (!i) return;
    if (i.routed) {
      this.sendFrame(name, f);
      return;
    }
    if (i.sviVlan === undefined) return;
    this.forward(i.sviVlan, f, null);
  }

  /** Turn a port into a routed port (`no switchport`) or back. */
  setRouted(name: string, routed: boolean) {
    const i = this.ifaces.get(name);
    if (!i || !i.physical) return;
    i.routed = routed;
    if (!routed) {
      i.ip = undefined;
      i.mask = undefined;
    }
    for (const [k, e] of this.macTable) if (e.port === name) this.macTable.delete(k);
    this.stack.flushIface(name);
  }

  protected onPower(_on: boolean) {
    this.macTable.clear();
    this.stack.arp.clear();
    this.stack.pending = [];
  }

  protected onLineChange(ifName: string, up: boolean) {
    const i = this.ifaces.get(ifName)!;
    if (!up) {
      for (const [k, e] of this.macTable) if (e.port === ifName) this.macTable.delete(k);
    }
    this.stack.flushIface(ifName);
    if (i.physical) {
      this.console(`\n%LINK-5-CHANGED: Interface ${ifName}, changed state to ${up ? 'up' : i.adminUp ? 'down' : 'administratively down'}\n`);
    }
    this.console(`\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifName}, changed state to ${up ? 'up' : 'down'}\n`);
  }

  clearMacTable() {
    this.macTable.clear();
  }

  toJSON() {
    return {
      type: this.kind,
      model: this.model,
      powered: this.powered,
      id: this.id,
      hostname: this.hostname,
      x: this.x,
      y: this.y,
      vlans: [...this.vlans.entries()],
      ifaces: [...this.ifaces.values()].map((i) => ({ ...i, linkId: undefined })),
      gw: this.stack.defaultGateway,
      routing: this.ipRouting,
      routes: this.stack.staticRoutes,
      ios: this.ios.toJSON(),
    };
  }

  static fromJSON(j: Record<string, any>): Switch {
    const s = new Switch(j.id, j.hostname, j.model ?? (j.type === 'l3switch' ? 'NL-S3600' : undefined));
    if (j.powered === false) s.powered = false;
    s.x = j.x;
    s.y = j.y;
    s.vlans = new Map(j.vlans ?? [[1, 'default']]);
    s.ifaces.clear();
    for (const i of j.ifaces ?? []) s.ifaces.set(i.name, { ...i, linkId: undefined });
    s.stack.defaultGateway = j.gw ?? undefined;
    s.stack.staticRoutes = j.routes ?? [];
    s.setRouting(!!j.routing);
    s.ios = IosState.fromJSON(j.ios);
    return s;
  }
}
