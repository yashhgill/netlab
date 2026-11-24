import { describe, expect, it } from 'vitest';
import { parseIp as ip } from './addr';
import { Engine } from './engine';
import type { Host } from './devices/host';
import type { Router } from './devices/router';
import { createDevice, load, serialize } from './topology';
import { applyConfig, IosSession } from '../cli/ios';

function pingStr(e: Engine, h: Host, dst: string) {
  const out: string[] = [];
  h.stack.ping(ip(dst)!, { count: 4 }, (r) => out.push(r.kind === 'reply' ? '!' : '.'), () => {});
  e.runFor(20000);
  return out.join('');
}

function exec(r: Router, cmd: string) {
  const s = new IosSession(r, false);
  s.mode = 'exec';
  s.runExec(cmd);
  return s.buffer;
}

/** The "Packet Tracer VLSM & Routing Test Lab": 192.168.10.0/24, HQ 60 hosts, Branch 25, WAN /30, OSPF area 0. */
function lab() {
  const e = new Engine();
  const r1 = createDevice(e, 'router', 0, 0, 'NL-R2900') as Router;
  const r2 = createDevice(e, 'router', 0, 0, 'NL-R2900') as Router;
  const swHq = createDevice(e, 'switch', 0, 0, 'NL-S2400');
  const swBr = createDevice(e, 'switch', 0, 0, 'NL-S2400');
  const pcHq = createDevice(e, 'pc', 0, 0) as Host;
  const pcBr = createDevice(e, 'pc', 0, 0) as Host;
  r1.hostname = 'R1';
  r2.hostname = 'R2';
  e.connect({ dev: r1.id, iface: 'GigabitEthernet0/0' }, { dev: r2.id, iface: 'GigabitEthernet0/0' }, 'cross');
  e.connect({ dev: r1.id, iface: 'GigabitEthernet0/1' }, { dev: swHq.id, iface: 'GigabitEthernet0/1' }, 'straight');
  e.connect({ dev: r2.id, iface: 'GigabitEthernet0/1' }, { dev: swBr.id, iface: 'GigabitEthernet0/1' }, 'straight');
  e.connect({ dev: pcHq.id, iface: 'FastEthernet0' }, { dev: swHq.id, iface: 'FastEthernet0/1' }, 'straight');
  e.connect({ dev: pcBr.id, iface: 'FastEthernet0' }, { dev: swBr.id, iface: 'FastEthernet0/1' }, 'straight');
  // HQ 192.168.10.0/26, Branch 192.168.10.64/27, WAN 192.168.10.96/30
  applyConfig(r1, ['int g0/1', 'ip add 192.168.10.1 255.255.255.192', 'no sh', 'int g0/0', 'ip add 192.168.10.97 255.255.255.252', 'no sh', 'exit', 'router ospf 1', 'network 192.168.10.0 0.0.0.63 area 0', 'network 192.168.10.96 0.0.0.3 area 0']);
  applyConfig(r2, ['int g0/1', 'ip add 192.168.10.65 255.255.255.224', 'no sh', 'int g0/0', 'ip add 192.168.10.98 255.255.255.252', 'no sh', 'exit', 'router ospf 1', 'network 192.168.10.64 0.0.0.31 area 0', 'network 192.168.10.96 0.0.0.3 area 0']);
  pcHq.setStatic(ip('192.168.10.62')!, ip('255.255.255.192')!, ip('192.168.10.1')!);
  pcBr.setStatic(ip('192.168.10.94')!, ip('255.255.255.224')!, ip('192.168.10.65')!);
  return { e, r1, r2, pcHq, pcBr };
}

describe('OSPF', () => {
  it('learns the remote LAN once the adjacency is full, and PC-HQ can ping PC-BR', () => {
    const { e, r1, pcHq } = lab();
    // straight after configuration the neighbours are still exchanging hellos
    expect(r1.stack.routingTable().some((r) => r.code === 'O')).toBe(false);
    e.runFor(8000);
    const route = r1.stack.routingTable().find((r) => r.code === 'O');
    expect(route).toMatchObject({ net: ip('192.168.10.64'), mask: ip('255.255.255.224'), nextHop: ip('192.168.10.98'), ifName: 'GigabitEthernet0/0', ad: 110, metric: 2 });
    pingStr(e, pcHq, '192.168.10.94');
    expect(pingStr(e, pcHq, '192.168.10.94')).toBe('!!!!');
    const sh = exec(r1, 'show ip route');
    expect(sh).toContain('O       192.168.10.64/27 [110/2] via 192.168.10.98, 00:00:12, GigabitEthernet0/0');
    expect(sh).toContain('C       192.168.10.0/26 is directly connected, GigabitEthernet0/1');
    const nb = exec(r1, 'show ip ospf neighbor');
    expect(nb).toMatch(/192\.168\.10\.98\s+1\s+FULL\/DR\s+.*192\.168\.10\.98\s+GigabitEthernet0\/0/);
    expect(exec(r1, 'show running-config')).toContain('router ospf 1\n log-adjacency-changes\n network 192.168.10.0 0.0.0.63 area 0\n network 192.168.10.96 0.0.0.3 area 0');
  });

  it('passive interfaces still advertise their network but form no neighbours; a wrong area forms none', () => {
    const { e, r1, r2 } = lab();
    applyConfig(r2, ['router ospf 1', 'passive-interface g0/1']);
    e.runFor(8000);
    expect(r1.stack.routingTable().some((r) => r.code === 'O' && r.net === ip('192.168.10.64'))).toBe(true);
    applyConfig(r2, ['router ospf 1', 'no network 192.168.10.96 0.0.0.3 area 0', 'network 192.168.10.96 0.0.0.3 area 1']);
    e.runFor(8000);
    expect(r1.stack.routingTable().some((r) => r.code === 'O')).toBe(false);
  });

  it('a static route beats OSPF, and OSPF survives save and reload', () => {
    const { e, r1 } = lab();
    e.runFor(8000);
    applyConfig(r1, ['ip route 192.168.10.64 255.255.255.224 192.168.10.98']);
    expect(r1.stack.routingTable().find((r) => r.net === ip('192.168.10.64'))?.code).toBe('S');
    const e2 = new Engine();
    load(e2, serialize(e));
    e2.runFor(8000);
    const r1b = [...e2.devices.values()].find((d) => d.hostname === 'R1') as Router;
    expect(r1b.ospf?.networks).toHaveLength(2);
  });
});
