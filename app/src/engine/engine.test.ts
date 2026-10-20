import { describe, expect, it } from 'vitest';
import { parseIp as ip } from './addr';
import { Engine } from './engine';
import { Host } from './devices/host';
import { Router } from './devices/router';
import { Switch } from './devices/switch';
import type { PingResult } from './ipstack';
import { createDevice, load, serialize } from './topology';

const m24 = ip('255.255.255.0')!;

function ping(e: Engine, h: Host | Router, dst: string, count = 4) {
  const results: PingResult[] = [];
  let done = false;
  h.stack.ping(ip(dst)!, { count }, (r) => results.push(r), () => (done = true));
  e.runFor(30000);
  expect(done).toBe(true);
  return results.map((r) => (r.kind === 'reply' ? '!' : r.kind === 'timeout' ? '.' : r.kind === 'unreachable' ? 'U' : '?')).join('');
}

function twoLans() {
  const e = new Engine();
  const pc1 = createDevice(e, 'pc', 0, 0) as Host;
  const pc2 = createDevice(e, 'pc', 0, 0) as Host;
  const s1 = createDevice(e, 'switch', 0, 0) as Switch;
  const s2 = createDevice(e, 'switch', 0, 0) as Switch;
  const r = createDevice(e, 'router', 0, 0) as Router;
  e.connect({ dev: pc1.id, iface: 'FastEthernet0' }, { dev: s1.id, iface: 'FastEthernet0/1' }, 'straight');
  e.connect({ dev: pc2.id, iface: 'FastEthernet0' }, { dev: s2.id, iface: 'FastEthernet0/1' }, 'straight');
  e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: s1.id, iface: 'GigabitEthernet0/1' }, 'straight');
  e.connect({ dev: r.id, iface: 'GigabitEthernet0/1' }, { dev: s2.id, iface: 'GigabitEthernet0/1' }, 'straight');
  const g0 = r.ifaces.get('GigabitEthernet0/0')!;
  const g1 = r.ifaces.get('GigabitEthernet0/1')!;
  g0.ip = ip('192.168.1.1')!;
  g0.mask = m24;
  g0.adminUp = true;
  g1.ip = ip('192.168.2.1')!;
  g1.mask = m24;
  g1.adminUp = true;
  e.refreshAll();
  pc1.setStatic(ip('192.168.1.10')!, m24, ip('192.168.1.1')!);
  pc2.setStatic(ip('192.168.2.10')!, m24, ip('192.168.2.1')!);
  return { e, pc1, pc2, s1, s2, r };
}

describe('engine', () => {
  it('pings within a LAN', () => {
    const { e, pc1 } = twoLans();
    expect(ping(e, pc1, '192.168.1.1')).toBe('!!!!');
  });

  it('routes between LANs (router drops first packet while ARPing)', () => {
    const { e, pc1 } = twoLans();
    const r = ping(e, pc1, '192.168.2.10');
    expect(r).toMatch(/^[.!]!!!$/);
    expect(ping(e, pc1, '192.168.2.10')).toBe('!!!!');
  });

  it('wrong cable keeps link down', () => {
    const e = new Engine();
    const a = createDevice(e, 'pc', 0, 0) as Host;
    const b = createDevice(e, 'pc', 0, 0) as Host;
    e.connect({ dev: a.id, iface: 'FastEthernet0' }, { dev: b.id, iface: 'FastEthernet0' }, 'straight');
    expect(a.lineUp('FastEthernet0')).toBe(false);
    const e2 = new Engine();
    const c = createDevice(e2, 'pc', 0, 0) as Host;
    const d = createDevice(e2, 'pc', 0, 0) as Host;
    e2.connect({ dev: c.id, iface: 'FastEthernet0' }, { dev: d.id, iface: 'FastEthernet0' }, 'cross');
    c.setStatic(ip('10.0.0.1')!, m24);
    d.setStatic(ip('10.0.0.2')!, m24);
    expect(ping(e2, c, '10.0.0.2')).toBe('!!!!');
  });

  it('isolates VLANs and routes with router-on-a-stick', () => {
    const e = new Engine();
    const pa = createDevice(e, 'pc', 0, 0) as Host;
    const pb = createDevice(e, 'pc', 0, 0) as Host;
    const sw = createDevice(e, 'switch', 0, 0) as Switch;
    const r = createDevice(e, 'router', 0, 0) as Router;
    e.connect({ dev: pa.id, iface: 'FastEthernet0' }, { dev: sw.id, iface: 'FastEthernet0/1' }, 'auto');
    e.connect({ dev: pb.id, iface: 'FastEthernet0' }, { dev: sw.id, iface: 'FastEthernet0/2' }, 'auto');
    e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: sw.id, iface: 'GigabitEthernet0/1' }, 'auto');
    sw.ensureVlan(10);
    sw.ensureVlan(20);
    sw.ifaces.get('FastEthernet0/1')!.accessVlan = 10;
    sw.ifaces.get('FastEthernet0/2')!.accessVlan = 20;
    pa.setStatic(ip('10.10.0.5')!, m24, ip('10.10.0.1')!);
    pb.setStatic(ip('10.20.0.5')!, m24, ip('10.20.0.1')!);
    // same subnet test without router: put pb in pa's subnet -> still isolated by VLAN
    pb.setStatic(ip('10.10.0.6')!, m24);
    expect(ping(e, pa, '10.10.0.6', 2)).toBe('..');
    pb.setStatic(ip('10.20.0.5')!, m24, ip('10.20.0.1')!);
    sw.ifaces.get('GigabitEthernet0/1')!.swMode = 'trunk';
    r.ifaces.get('GigabitEthernet0/0')!.adminUp = true;
    for (const v of [10, 20]) {
      const s = r.addSubif(`GigabitEthernet0/0.${v}`)!;
      s.dot1q = v;
      s.ip = ip(`10.${v}.0.1`)!;
      s.mask = m24;
    }
    e.refreshAll();
    expect(ping(e, pa, '10.20.0.5')).toMatch(/^[.!]!!!$/);
  });

  it('hands out addresses with router DHCP and relays via helper-address', () => {
    const { e, pc1, pc2, r, s1 } = twoLans();
    r.dhcp.pools.push({ name: 'LAN1', net: ip('192.168.1.0')!, mask: m24, router: ip('192.168.1.1')!, dns: ip('8.8.8.8')! });
    r.dhcp.excluded.push({ lo: ip('192.168.1.1')!, hi: ip('192.168.1.10')! });
    pc1.setStatic();
    pc1.useDhcp();
    e.runFor(6000);
    expect(pc1.nic.ip).toBe(ip('192.168.1.11'));
    expect(pc1.gateway).toBe(ip('192.168.1.1'));

    // relay: server on LAN1, client on LAN2
    const srv = createDevice(e, 'server', 0, 0) as Host;
    e.connect({ dev: srv.id, iface: 'FastEthernet0' }, { dev: s1.id, iface: 'FastEthernet0/2' }, 'straight');
    srv.setStatic(ip('192.168.1.5')!, m24, ip('192.168.1.1')!);
    r.dhcp.pools = [];
    srv.updateServerPool({ start: ip('192.168.2.100')!, mask: m24, router: ip('192.168.2.1')!, max: 50 });
    srv.dhcpServer!.enabled = true;
    // server pool network must match giaddr subnet
    r.ifaces.get('GigabitEthernet0/1')!.helper = ip('192.168.1.5')!;
    pc2.useDhcp();
    e.runFor(12000);
    expect(pc2.nic.ip).toBe(ip('192.168.2.100'));
  });

  it('traceroute lists hops', () => {
    const { e, pc1 } = twoLans();
    ping(e, pc1, '192.168.2.10', 1);
    const hops: (number | undefined)[] = [];
    pc1.stack.traceroute(ip('192.168.2.10')!, {}, (_t, p) => hops.push(p.find((x) => x.from)?.from), () => {});
    e.runFor(30000);
    expect(hops).toEqual([ip('192.168.1.1'), ip('192.168.2.10')]);
  });

  it('saves and loads a topology', () => {
    const { e } = twoLans();
    const file = JSON.parse(JSON.stringify(serialize(e)));
    const e2 = new Engine();
    load(e2, file);
    const pc = [...e2.devices.values()].find((d) => d.hostname === 'PC0') as Host;
    expect(ping(e2, pc, '192.168.2.10')).toMatch(/^[.!]!!!$/);
  });

  it('simulation mode steps hop by hop', () => {
    const { e, pc1 } = twoLans();
    e.mode = 'simulation';
    pc1.stack.ping(ip('192.168.1.1')!, { count: 1 }, () => {}, () => {});
    const first = e.stepVisible();
    expect(first[0].kind).toBe('ARP');
    expect(first[0].from).toBe(pc1.id);
  });
});
