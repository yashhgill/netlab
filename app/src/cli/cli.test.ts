import { describe, expect, it } from 'vitest';
import { parseIp as ip } from '../engine/addr';
import { Engine } from '../engine/engine';
import type { Host } from '../engine/devices/host';
import type { Router } from '../engine/devices/router';
import type { Switch } from '../engine/devices/switch';
import { createDevice } from '../engine/topology';
import { IosSession } from './ios';
import { PcShell } from './pc';

function run(s: IosSession | PcShell, e: Engine, lines: string[]) {
  for (const l of lines) {
    s.submit(l);
    e.runFor(15000);
  }
  return s.buffer;
}

function lab() {
  const e = new Engine();
  const pc1 = createDevice(e, 'pc', 0, 0) as Host;
  const pc2 = createDevice(e, 'pc', 0, 0) as Host;
  const sw = createDevice(e, 'switch', 0, 0) as Switch;
  const r = createDevice(e, 'router', 0, 0) as Router;
  e.connect({ dev: pc1.id, iface: 'FastEthernet0' }, { dev: sw.id, iface: 'FastEthernet0/1' }, 'straight');
  e.connect({ dev: pc2.id, iface: 'FastEthernet0' }, { dev: sw.id, iface: 'FastEthernet0/2' }, 'straight');
  e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: sw.id, iface: 'GigabitEthernet0/1' }, 'straight');
  return { e, pc1, pc2, sw, r };
}

describe('IOS CLI', () => {
  it('configures router-on-a-stick, VLANs and DHCP from the CLI', () => {
    const { e, pc1, pc2, sw, r } = lab();
    const rs = new IosSession(r);
    const ss = new IosSession(sw);
    run(ss, e, [
      '',
      'en',
      'conf t',
      'hostname S1',
      'vlan 10',
      'name SALES',
      'vlan 20',
      'name HR',
      'exit',
      'int fa0/1',
      'sw mode acc',
      'sw acc vlan 10',
      'int f0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'interface gig0/1',
      'switchport mode trunk',
      'end',
    ]);
    expect(sw.hostname).toBe('S1');
    expect(sw.vlans.get(10)).toBe('SALES');
    const out = run(rs, e, [
      '',
      'enable',
      'configure terminal',
      'hostname R1',
      'interface g0/0',
      'no shutdown',
      'interface g0/0.10',
      'encapsulation dot1q 10',
      'ip address 10.10.0.1 255.255.255.0',
      'int g0/0.20',
      'encap dot1Q 20',
      'ip add 10.20.0.1 255.255.255.0',
      'exit',
      'ip dhcp excluded-address 10.10.0.1 10.10.0.9',
      'ip dhcp pool V10',
      'network 10.10.0.0 255.255.255.0',
      'default-router 10.10.0.1',
      'dns-server 8.8.8.8',
      'ip dhcp pool V20',
      'network 10.20.0.0 255.255.255.0',
      'default-router 10.20.0.1',
      'end',
      'show ip interface brief',
    ]);
    expect(out).toContain('GigabitEthernet0/0.10  10.10.0.1       YES manual up                    up');
    expect(out).toContain('%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up');
    pc1.useDhcp();
    pc2.useDhcp();
    e.runFor(10000);
    expect(pc1.nic.ip).toBe(ip('10.10.0.10'));
    expect(pc2.nic.ip).toBe(ip('10.20.0.1')! + 1);
    const p = new PcShell(pc1);
    const pout = run(p, e, ['ping 10.20.0.2']);
    expect(pout).toContain('Reply from 10.20.0.2: bytes=32');
    expect(pout).toMatch(/Received = [34]/);
    const shows = run(rs, e, ['show ip route', 'show run', 'show ip dhcp binding']);
    expect(shows).toContain('C       10.10.0.0/24 is directly connected, GigabitEthernet0/0.10');
    expect(shows).toContain(' encapsulation dot1Q 10');
    expect(shows).toContain('ip dhcp pool V10');
    const sws = run(ss, e, ['show vlan brief', 'show interfaces trunk', 'show mac address-table']);
    expect(sws).toMatch(/10\s+SALES\s+active\s+Fa0\/1/);
    expect(sws).toContain('Gig0/1      on           802.1q         trunking      1');
    expect(sws).toContain('DYNAMIC     Fa0/1');
  });

  it('reports IOS-style errors, help and abbreviations', () => {
    const { e, r } = lab();
    const s = new IosSession(r);
    run(s, e, ['', 'enable']);
    let out = run(s, e, ['sh ip int br', 'c', 'show ip interfac', 'conf t', 'ip address 1.1.1.1 255.0.0.0', 'hostnam']);
    expect(out).toContain('GigabitEthernet0/0     unassigned      YES unset  administratively down down');
    expect(out).toContain('% Ambiguous command: "c"');
    expect(out).toContain('% Incomplete command.');
    expect(out).toContain("% Invalid input detected at '^' marker.");
    s.help('sh');
    expect(s.buffer).toContain('show');
    s.help('');
    expect(s.buffer).toContain('hostname');
    expect(s.complete('hostn')).toBe('hostname ');
    out = run(s, e, ['end', 'foo']);
    expect(out).toContain('Translating "foo"');
  });

  it('handles enable secret, console login, save and reload', () => {
    const { e, r } = lab();
    const s = new IosSession(r);
    run(s, e, ['', 'en', 'conf t', 'enable secret class', 'line con 0', 'password cisco', 'login', 'exit', 'banner motd #Authorized only#', 'hostname R9', 'end', 'copy run start', '']);
    expect(r.ios.startupSnapshot).toBeTruthy();
    run(s, e, ['conf t', 'hostname Temp', 'end', 'reload', '']);
    expect(r.hostname).toBe('R9');
    run(s, e, ['']);
    expect(s.buffer).toContain('Authorized only');
    expect(s.secret()).toBe(true);
    run(s, e, ['cisco', 'enable', 'wrong', 'class']);
    expect(s.prompt()).toBe('R9#');
    const sr = run(s, e, ['show run']);
    expect(sr).toMatch(/enable secret 5 \$1\$/);
  });

  it('switch SVI management and PC ipconfig', () => {
    const { e, pc1, sw } = lab();
    const s = new IosSession(sw);
    run(s, e, ['', 'en', 'conf t', 'int vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'no shut', 'exit', 'ip default-gateway 192.168.1.1', 'end']);
    pc1.setStatic(ip('192.168.1.10')!, ip('255.255.255.0')!, ip('192.168.1.1')!);
    const out = run(s, e, ['ping 192.168.1.10']);
    expect(out).toMatch(/Success rate is (80|100) percent/);
    const p = new PcShell(pc1);
    const po = run(p, e, ['ipconfig', 'arp -a', 'tracert 192.168.1.2']);
    expect(po).toContain('IPv4 Address....................: 192.168.1.10');
    expect(po).toContain('192.168.1.2');
    expect(po).toContain('Trace complete.');
  });
});
