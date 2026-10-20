import { describe, expect, it } from 'vitest';
import { parseIp as ip } from '../engine/addr';
import { Engine } from '../engine/engine';
import type { Host } from '../engine/devices/host';
import type { Router } from '../engine/devices/router';
import type { Switch } from '../engine/devices/switch';
import { createDevice, load, serialize } from '../engine/topology';
import { applyConfig, IosSession } from './ios';
import { PcShell } from './pc';

const m24 = ip('255.255.255.0')!;

function pingStr(e: Engine, h: Host, dst: string) {
  const out: string[] = [];
  h.stack.ping(ip(dst)!, { count: 4 }, (r) => out.push(r.kind === 'reply' ? '!' : '.'), () => {});
  e.runFor(20000);
  return out.join('');
}

describe('device models and new cables', () => {
  it('routes over a serial link once the DCE side has a clock rate', () => {
    const e = new Engine();
    const r1 = createDevice(e, 'router', 0, 0, 'NL-R1900') as Router;
    const r2 = createDevice(e, 'router', 0, 0, 'NL-R1900') as Router;
    const pa = createDevice(e, 'pc', 0, 0) as Host;
    const pb = createDevice(e, 'pc', 0, 0) as Host;
    expect(e.connect({ dev: r1.id, iface: 'Serial0/0/0' }, { dev: r2.id, iface: 'Serial0/0/0' }, 'serial-dce')).toHaveProperty('id');
    e.connect({ dev: pa.id, iface: 'FastEthernet0' }, { dev: r1.id, iface: 'GigabitEthernet0/0' }, 'cross');
    e.connect({ dev: pb.id, iface: 'FastEthernet0' }, { dev: r2.id, iface: 'GigabitEthernet0/0' }, 'cross');
    applyConfig(r1, ['int g0/0', 'ip add 10.1.0.1 255.255.255.0', 'no sh', 'int s0/0/0', 'ip add 172.16.0.1 255.255.255.252', 'no sh', 'exit', 'ip route 10.2.0.0 255.255.255.0 172.16.0.2']);
    applyConfig(r2, ['int g0/0', 'ip add 10.2.0.1 255.255.255.0', 'no sh', 'int s0/0/0', 'ip add 172.16.0.2 255.255.255.252', 'no sh', 'exit', 'ip route 0.0.0.0 0.0.0.0 Serial0/0/0']);
    pa.setStatic(ip('10.1.0.10')!, m24, ip('10.1.0.1')!);
    pb.setStatic(ip('10.2.0.10')!, m24, ip('10.2.0.1')!);
    expect(r1.lineUp('Serial0/0/0')).toBe(false); // no clock yet
    applyConfig(r1, ['int s0/0/0', 'clock rate 64000']);
    expect(r1.lineUp('Serial0/0/0')).toBe(true);
    pingStr(e, pa, '10.2.0.10');
    expect(pingStr(e, pa, '10.2.0.10')).toBe('!!!!');
    // mismatched encapsulation brings the line protocol down
    applyConfig(r2, ['int s0/0/0', 'encapsulation ppp']);
    expect(r1.lineUp('Serial0/0/0')).toBe(false);
    const s = new IosSession(r1);
    s.submit('');
    s.submit('en');
    s.submit('show controllers s0/0/0');
    expect(s.buffer).toContain('DCE V.35, clock rate 64000');
    // DCE side survives save/load
    const e2 = new Engine();
    load(e2, JSON.parse(JSON.stringify(serialize(e))));
    expect(e2.isDce(r1.id, 'Serial0/0/0')).toBe(true);
  });

  it('rejects cables that do not fit the ports', () => {
    const e = new Engine();
    const r = createDevice(e, 'router', 0, 0, 'NL-R1900') as Router;
    const sw = createDevice(e, 'switch', 0, 0) as Switch;
    const r2 = createDevice(e, 'router', 0, 0, 'NL-R4400') as Router;
    expect(typeof e.connect({ dev: r.id, iface: 'Serial0/0/0' }, { dev: sw.id, iface: 'FastEthernet0/1' }, 'auto')).toBe('string');
    expect(typeof e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: sw.id, iface: 'FastEthernet0/1' }, 'fiber')).toBe('string');
    expect(typeof e.connect({ dev: r2.id, iface: 'GigabitEthernet0/1/0' }, { dev: r.id, iface: 'GigabitEthernet0/1' }, 'auto')).toBe('string');
  });

  it('hub repeats frames to every port', () => {
    const e = new Engine();
    const hub = createDevice(e, 'hub', 0, 0);
    const a = createDevice(e, 'pc', 0, 0) as Host;
    const b = createDevice(e, 'pc', 0, 0) as Host;
    const c = createDevice(e, 'pc', 0, 0) as Host;
    [a, b, c].forEach((p, k) => e.connect({ dev: p.id, iface: 'FastEthernet0' }, { dev: hub.id, iface: `Ethernet${k}` }, 'auto'));
    a.setStatic(ip('10.0.0.1')!, m24);
    b.setStatic(ip('10.0.0.2')!, m24);
    c.setStatic(ip('10.0.0.3')!, m24);
    e.mode = 'simulation';
    a.stack.ping(ip('10.0.0.2')!, { count: 1 }, () => {}, () => {});
    e.runFor(5000);
    // c sees the unicast reply/request too, because a hub floods
    const toC = e.log.filter((p) => p.to === c.id && p.kind === 'ICMP');
    expect(toC.length).toBeGreaterThan(0);
  });

  it('multilayer switch routes between VLAN SVIs and routed ports', () => {
    const e = new Engine();
    const ml = createDevice(e, 'l3switch', 0, 0) as Switch;
    const a = createDevice(e, 'pc', 0, 0) as Host;
    const b = createDevice(e, 'pc', 0, 0) as Host;
    const r = createDevice(e, 'router', 0, 0) as Router;
    e.connect({ dev: a.id, iface: 'FastEthernet0' }, { dev: ml.id, iface: 'GigabitEthernet1/0/1' }, 'auto');
    e.connect({ dev: b.id, iface: 'FastEthernet0' }, { dev: ml.id, iface: 'GigabitEthernet1/0/2' }, 'auto');
    e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: ml.id, iface: 'GigabitEthernet1/0/24' }, 'auto');
    applyConfig(ml, [
      'ip routing',
      'vlan 10',
      'vlan 20',
      'exit',
      'interface g1/0/1',
      'switchport access vlan 10',
      'interface g1/0/2',
      'switchport access vlan 20',
      'interface vlan 10',
      'ip address 10.10.0.1 255.255.255.0',
      'no shutdown',
      'interface vlan 20',
      'ip address 10.20.0.1 255.255.255.0',
      'no shutdown',
      'interface g1/0/24',
      'no switchport',
      'ip address 192.168.0.2 255.255.255.252',
      'exit',
    ]);
    applyConfig(r, ['int g0/0', 'ip add 192.168.0.1 255.255.255.252', 'no sh', 'exit', 'ip route 10.0.0.0 255.0.0.0 192.168.0.2']);
    a.setStatic(ip('10.10.0.5')!, m24, ip('10.10.0.1')!);
    b.setStatic(ip('10.20.0.5')!, m24, ip('10.20.0.1')!);
    pingStr(e, a, '10.20.0.5');
    expect(pingStr(e, a, '10.20.0.5')).toBe('!!!!');
    pingStr(e, a, '192.168.0.1');
    expect(pingStr(e, a, '192.168.0.1')).toBe('!!!!');
    const s = new IosSession(ml);
    s.submit('');
    s.submit('en');
    s.submit('show ip route');
    s.submit('show run int g1/0/24');
    expect(s.buffer).toContain('C       10.10.0.0/24 is directly connected, Vlan10');
    expect(s.buffer).toContain(' no switchport');
  });

  it('console cable connects a PC to a router CLI and CDP sees neighbors', () => {
    const e = new Engine();
    const pc = createDevice(e, 'pc', 0, 0) as Host;
    const r = createDevice(e, 'router', 0, 0) as Router;
    const sw = createDevice(e, 'switch', 0, 0) as Switch;
    expect(e.connect({ dev: pc.id, iface: 'RS232' }, { dev: r.id, iface: 'Console' }, 'auto')).toHaveProperty('cable', 'console');
    expect(e.peer(pc.id, 'RS232')?.dev).toBe(r.id);
    e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: sw.id, iface: 'GigabitEthernet0/1' }, 'auto');
    applyConfig(r, ['int g0/0', 'no sh']);
    const s = new IosSession(r);
    s.submit('');
    s.submit('show cdp neighbors');
    expect(s.buffer).toMatch(/Switch0\s+Gig0\/0\s+164\s+S\s+NL-S2400\s+Gig0\/1/);
    // power off the switch: link goes down
    sw.setPower(false);
    expect(r.lineUp('GigabitEthernet0/0')).toBe(false);
    void PcShell;
  });
});
