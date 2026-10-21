import { BCAST_MAC, newMac, network, parseIp } from '../addr';
import { DhcpClient, DhcpServer, type DhcpPool } from '../dhcp';
import { Device, type DeviceKind, type WifiSettings } from '../engine';
import { modelSpec } from '../models';
import { IpStack, type L3If } from '../ipstack';
import type { Frame } from '../packets';

export const HOST_IF = 'FastEthernet0';
export type HostKind = 'pc' | 'laptop' | 'server' | 'printer' | 'phone' | 'tablet' | 'smartphone' | 'tv';

export class Host extends Device {
  kind: DeviceKind;
  model: string;
  ipMode: 'static' | 'dhcp' = 'static';
  dns?: number;
  stack: IpStack;
  dhcpClient: DhcpClient;
  dhcpServer: DhcpServer | null = null;
  dhcpStatus = '';
  terminal: string[] = [];
  /** The NIC's port name: FastEthernet0 for wired hosts, Wireless0 for wireless ones. */
  nicName: string;
  /** Wireless settings, only on hosts with a wireless NIC. */
  wifi?: WifiSettings;

  constructor(id: string, kind: HostKind, hostname: string, model?: string) {
    super(id, hostname);
    this.kind = kind;
    const spec = modelSpec(model, kind);
    this.model = spec.id;
    const p = spec.ports[0] ?? { name: HOST_IF, media: 'copper', speed: 100 };
    this.nicName = p.name;
    this.ifaces.set(p.name, { name: p.name, mac: newMac(), adminUp: true, physical: true, speed: p.speed, media: p.media });
    if (p.media === 'wireless') this.wifi = { ssid: 'Default' };
    for (const m of spec.mgmt) this.mgmt.set(m.name, { name: m.name, mac: '000000000000', adminUp: true, physical: true, speed: m.speed, media: m.media });
    this.stack = new IpStack(
      {
        dev: this,
        l3ifs: () => this.l3ifs(),
        l2send: (n, f) => this.sendFrame(n, f),
      },
      { forwarding: false, ttl: 128 },
    );
    this.dhcpClient = new DhcpClient(this.stack, this.nicName);
    this.dhcpClient.onBound = (m) => {
      const i = this.nic;
      i.ip = m.yiaddr;
      i.mask = m.mask;
      this.stack.defaultGateway = m.router;
      this.dns = m.dns;
      this.dhcpStatus = 'DHCP request successful.';
      this.engine?.bump();
    };
    this.dhcpClient.onFail = () => {
      // APIPA fallback, like a real OS
      const i = this.nic;
      const n = parseInt(i.mac.slice(8), 16);
      i.ip = parseIp(`169.254.${(n >> 8) & 255 || 1}.${n & 255 || 1}`)!;
      i.mask = parseIp('255.255.0.0')!;
      this.stack.defaultGateway = undefined;
      this.dhcpStatus = 'DHCP failed. APIPA is being used.';
      this.engine?.bump();
    };
    if (kind === 'server') {
      this.dhcpServer = new DhcpServer(this.stack);
      this.dhcpServer.enabled = false;
      this.dhcpServer.pools = [{ name: 'serverPool' }];
    }
  }

  get nic() {
    return this.ifaces.get(this.nicName)!;
  }

  get gateway() {
    return this.stack.defaultGateway;
  }

  l3ifs(): L3If[] {
    const i = this.nic;
    return [{ name: i.name, ip: i.ip, mask: i.mask, mac: i.mac, up: this.lineUp(i.name) }];
  }

  setWifi(w: WifiSettings) {
    this.wifi = { ssid: w.ssid, key: w.key || undefined };
    this.engine?.bump();
  }

  setStatic(ip?: number, mask?: number, gw?: number, dns?: number) {
    this.dhcpClient.cancel();
    this.ipMode = 'static';
    this.nic.ip = ip;
    this.nic.mask = mask;
    this.stack.defaultGateway = gw;
    this.dns = dns;
    this.stack.arp.clear();
    this.dhcpStatus = '';
    this.engine?.bump();
  }

  useDhcp() {
    this.ipMode = 'dhcp';
    this.nic.ip = undefined;
    this.nic.mask = undefined;
    this.stack.defaultGateway = undefined;
    this.dns = undefined;
    this.stack.arp.clear();
    this.dhcpStatus = 'Requesting IP Address...';
    if (this.lineUp(this.nicName)) this.dhcpClient.start();
    else this.dhcpClient.onFail();
    this.engine?.bump();
  }

  /** Server DHCP service pool (single pool, like most lab servers). */
  get serverPool(): DhcpPool | undefined {
    return this.dhcpServer?.pools[0];
  }

  updateServerPool(p: Partial<DhcpPool>) {
    if (!this.dhcpServer) return;
    const pool = { ...this.dhcpServer.pools[0], ...p };
    if (pool.start !== undefined && pool.mask !== undefined) pool.net = network(pool.start, pool.mask);
    this.dhcpServer.pools[0] = pool;
    this.engine?.bump();
  }

  receive(ifName: string, frame: Frame) {
    if (frame.vlan !== undefined) {
      this.drop(frame, 'unexpected 802.1Q tag on a host NIC');
      return;
    }
    if (frame.dst !== this.nic.mac && frame.dst !== BCAST_MAC) {
      this.drop(frame, 'frame not addressed to this NIC');
      return;
    }
    this.stack.receiveFrame(ifName, frame);
  }

  protected onPower(on: boolean) {
    this.stack.arp.clear();
    this.stack.pending = [];
    if (!on) this.dhcpClient.cancel();
  }

  protected onLineChange(ifName: string, up: boolean) {
    this.stack.flushIface(ifName);
    if (up && this.ipMode === 'dhcp' && (this.nic.ip === undefined || this.dhcpStatus.startsWith('DHCP failed'))) {
      this.dhcpStatus = 'Requesting IP Address...';
      this.dhcpClient.start();
    }
  }

  toJSON() {
    const n = this.nic;
    return {
      type: this.kind,
      model: this.model,
      powered: this.powered,
      id: this.id,
      hostname: this.hostname,
      x: this.x,
      y: this.y,
      mac: n.mac,
      ipMode: this.ipMode,
      ip: this.ipMode === 'static' ? n.ip : undefined,
      mask: this.ipMode === 'static' ? n.mask : undefined,
      gw: this.ipMode === 'static' ? this.stack.defaultGateway : undefined,
      dns: this.ipMode === 'static' ? this.dns : undefined,
      wifi: this.wifi,
      dhcpService: this.dhcpServer ? { enabled: this.dhcpServer.enabled, pool: this.dhcpServer.pools[0] } : undefined,
    };
  }

  static fromJSON(j: Record<string, any>): Host {
    const h = new Host(j.id, j.type, j.hostname, j.model);
    if (j.powered === false) h.powered = false;
    h.x = j.x;
    h.y = j.y;
    if (j.mac) h.nic.mac = j.mac;
    if (h.wifi && j.wifi) h.wifi = { ssid: String(j.wifi.ssid ?? ''), key: j.wifi.key || undefined };
    h.ipMode = j.ipMode ?? 'static';
    if (h.ipMode === 'static') {
      h.nic.ip = j.ip ?? undefined;
      h.nic.mask = j.mask ?? undefined;
      h.stack.defaultGateway = j.gw ?? undefined;
      h.dns = j.dns ?? undefined;
    }
    if (h.dhcpServer && j.dhcpService) {
      h.dhcpServer.enabled = !!j.dhcpService.enabled;
      h.dhcpServer.pools = [j.dhcpService.pool ?? { name: 'serverPool' }];
    }
    return h;
  }
}
