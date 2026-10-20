import { BCAST_MAC, newMac } from '../addr';
import { DhcpServer } from '../dhcp';
import { Device, type DeviceKind, type Iface } from '../engine';
import { IpStack, type L3If } from '../ipstack';
import type { Frame } from '../packets';
import { IosState } from './ios-state';

export class Router extends Device {
  kind: DeviceKind = 'router';
  model = 'NL-R3000';
  stack: IpStack;
  dhcp: DhcpServer;
  ios = new IosState();

  constructor(id: string, hostname = 'Router') {
    super(id, hostname);
    for (let p = 0; p <= 2; p++) {
      const name = `GigabitEthernet0/${p}`;
      this.ifaces.set(name, { name, mac: newMac(), adminUp: false, physical: true, speed: 1000 });
    }
    this.stack = new IpStack(
      { dev: this, l3ifs: () => this.l3ifs(), l2send: (n, f) => this.l2send(n, f) },
      { forwarding: true, ttl: 255 },
    );
    this.dhcp = new DhcpServer(this.stack);
    this.dhcp.helperFor = (n) => this.ifaces.get(n)?.helper;
  }

  addSubif(name: string): Iface | null {
    const [parent] = name.split('.');
    const p = this.ifaces.get(parent);
    if (!p || !p.physical) return null;
    let i = this.ifaces.get(name);
    if (!i) {
      i = { name, mac: p.mac, adminUp: true, physical: false, speed: p.speed, parent };
      // keep subinterfaces right after their parent in listing order
      const entries = [...this.ifaces.entries()];
      let at = entries.findIndex(([n]) => n === parent);
      while (at + 1 < entries.length && entries[at + 1][0].startsWith(parent + '.')) at++;
      entries.splice(at + 1, 0, [name, i]);
      this.ifaces = new Map(entries);
    }
    return i;
  }

  removeSubif(name: string) {
    if (this.ifaces.get(name)?.parent) {
      this.ifaces.delete(name);
      this.stack.flushIface(name);
    }
  }

  l3ifs(): L3If[] {
    return [...this.ifaces.values()].map((i) => ({ name: i.name, ip: i.ip, mask: i.mask, mac: i.mac, up: this.lineUp(i.name) }));
  }

  receive(ifName: string, frame: Frame) {
    const phys = this.ifaces.get(ifName);
    if (!phys || !this.lineUp(ifName)) return;
    let l3name: string | undefined;
    const subs = [...this.ifaces.values()].filter((i) => i.parent === ifName && i.adminUp);
    if (frame.vlan !== undefined) {
      l3name = subs.find((s) => s.dot1q === frame.vlan && !s.dot1qNative)?.name;
      if (!l3name) {
        this.drop(frame, `no sub-interface for VLAN ${frame.vlan}`);
        return;
      }
    } else {
      l3name = subs.find((s) => s.dot1qNative)?.name ?? ifName;
    }
    const l3 = this.ifaces.get(l3name)!;
    if (frame.dst !== l3.mac && frame.dst !== BCAST_MAC) {
      this.drop(frame, 'frame not addressed to this interface');
      return;
    }
    const f: Frame = { ...frame };
    delete f.vlan;
    this.stack.receiveFrame(l3name, f);
  }

  private l2send(l3name: string, frame: Frame) {
    const i = this.ifaces.get(l3name);
    if (!i) return;
    if (i.parent) {
      if (i.dot1q === undefined) return; // no encapsulation yet
      const f: Frame = { ...frame };
      if (!i.dot1qNative) f.vlan = i.dot1q;
      this.sendFrame(i.parent, f);
    } else this.sendFrame(l3name, frame);
  }

  protected onLineChange(ifName: string, up: boolean) {
    const i = this.ifaces.get(ifName)!;
    this.stack.flushIface(ifName);
    if (i.physical) {
      this.console(`\n%LINK-5-CHANGED: Interface ${ifName}, changed state to ${up ? 'up' : i.adminUp ? 'down' : 'administratively down'}\n`);
    } else {
      this.console(`\n%LINK-5-CHANGED: Interface ${ifName}, changed state to ${up ? 'up' : 'down'}\n`);
    }
    this.console(`\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifName}, changed state to ${up ? 'up' : 'down'}\n`);
  }

  toJSON() {
    return {
      type: 'router',
      id: this.id,
      hostname: this.hostname,
      x: this.x,
      y: this.y,
      ifaces: [...this.ifaces.values()].map((i) => ({ ...i, linkId: undefined })),
      routes: this.stack.staticRoutes,
      dhcp: { pools: this.dhcp.pools, excluded: this.dhcp.excluded },
      ios: this.ios.toJSON(),
    };
  }

  static fromJSON(j: Record<string, any>): Router {
    const r = new Router(j.id, j.hostname);
    r.x = j.x;
    r.y = j.y;
    r.ifaces.clear();
    for (const i of j.ifaces ?? []) r.ifaces.set(i.name, { ...i, linkId: undefined });
    r.stack.staticRoutes = j.routes ?? [];
    r.dhcp.pools = j.dhcp?.pools ?? [];
    r.dhcp.excluded = j.dhcp?.excluded ?? [];
    r.ios = IosState.fromJSON(j.ios);
    return r;
  }
}

