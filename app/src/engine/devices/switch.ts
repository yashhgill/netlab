import { BCAST_MAC, newMac } from '../addr';
import { Device, type DeviceKind, type Iface } from '../engine';
import { IpStack, type L3If } from '../ipstack';
import type { Frame } from '../packets';
import { IosState } from './ios-state';

export interface MacEntry {
  vlan: number;
  mac: string;
  port: string;
  t: number;
}

export const MAC_AGE = 300_000;

export class Switch extends Device {
  kind: DeviceKind = 'switch';
  model = 'NL-S2400';
  vlans = new Map<number, string>([[1, 'default']]);
  macTable = new Map<string, MacEntry>();
  stack: IpStack;
  ios = new IosState();

  constructor(id: string, hostname = 'Switch') {
    super(id, hostname);
    const base = newMac();
    for (let p = 1; p <= 24; p++) this.addPort(`FastEthernet0/${p}`, 100);
    for (let p = 1; p <= 2; p++) this.addPort(`GigabitEthernet0/${p}`, 1000);
    this.ifaces.set('Vlan1', { name: 'Vlan1', mac: base, adminUp: false, physical: false, speed: 1000, sviVlan: 1 });
    this.stack = new IpStack(
      { dev: this, l3ifs: () => this.l3ifs(), l2send: (n, f) => this.sviSend(n, f) },
      { forwarding: false, ttl: 255 },
    );
  }

  private addPort(name: string, speed: number) {
    this.ifaces.set(name, {
      name,
      mac: newMac(),
      adminUp: true,
      physical: true,
      speed,
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

  l3ifs(): L3If[] {
    return [...this.ifaces.values()]
      .filter((i) => i.sviVlan !== undefined)
      .map((i) => ({ name: i.name, ip: i.ip, mask: i.mask, mac: i.mac, up: this.lineUp(i.name) }));
  }

  protected sviUp(i: Iface): boolean {
    const v = i.sviVlan!;
    if (!this.vlans.has(v)) return false;
    return this.physicalIfaces().some((p) => this.carries(p, v) && this.lineUp(p.name));
  }

  carries(p: Iface, vlan: number): boolean {
    if (p.swMode === 'trunk') return (p.allowedVlans === null || !!p.allowedVlans?.includes(vlan)) && this.vlans.has(vlan);
    return p.accessVlan === vlan;
  }

  receive(inPort: string, frame: Frame) {
    const p = this.ifaces.get(inPort);
    if (!p || !this.lineUp(inPort)) return;
    let vlan: number;
    if (p.swMode === 'trunk') {
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
    const f: Frame = { ...frame, vlan: undefined };
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
    // flood
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
    if (p.swMode === 'trunk' && vlan !== (p.nativeVlan ?? 1)) out.vlan = vlan;
    else delete out.vlan;
    this.sendFrame(port, out);
  }

  private sviSend(sviName: string, f: Frame) {
    const svi = this.ifaces.get(sviName);
    if (!svi || svi.sviVlan === undefined) return;
    this.forward(svi.sviVlan, f, null);
  }

  protected onLineChange(ifName: string, up: boolean) {
    const i = this.ifaces.get(ifName)!;
    if (!up) {
      for (const [k, e] of this.macTable) if (e.port === ifName) this.macTable.delete(k);
    }
    this.stack.flushIface(ifName);
    if (i.physical) {
      this.console(`\n%LINK-5-CHANGED: Interface ${ifName}, changed state to ${up ? 'up' : i.adminUp ? 'down' : 'administratively down'}\n`);
      this.console(`\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifName}, changed state to ${up ? 'up' : 'down'}\n`);
    } else {
      this.console(`\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifName}, changed state to ${up ? 'up' : 'down'}\n`);
    }
  }

  clearMacTable() {
    this.macTable.clear();
  }

  toJSON() {
    return {
      type: 'switch',
      id: this.id,
      hostname: this.hostname,
      x: this.x,
      y: this.y,
      vlans: [...this.vlans.entries()],
      ifaces: [...this.ifaces.values()].map((i) => ({ ...i, linkId: undefined })),
      gw: this.stack.defaultGateway,
      ios: this.ios.toJSON(),
    };
  }

  static fromJSON(j: Record<string, any>): Switch {
    const s = new Switch(j.id, j.hostname);
    s.x = j.x;
    s.y = j.y;
    s.vlans = new Map(j.vlans ?? [[1, 'default']]);
    s.ifaces.clear();
    for (const i of j.ifaces ?? []) s.ifaces.set(i.name, { ...i, linkId: undefined });
    s.stack.defaultGateway = j.gw ?? undefined;
    s.ios = IosState.fromJSON(j.ios);
    return s;
  }
}
