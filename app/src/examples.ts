import { parseIp } from './engine/addr';
import type { Engine } from './engine/engine';
import type { Host } from './engine/devices/host';
import type { Router } from './engine/devices/router';
import type { Switch } from './engine/devices/switch';
import { createDevice } from './engine/topology';
import { applyConfig } from './cli/ios';
import type { Note } from './engine/topology';

const ip = (s: string) => parseIp(s)!;
const m24 = ip('255.255.255.0');

export interface Example {
  id: string;
  title: string;
  summary: string;
  build: (e: Engine) => Note[];
}

function link(e: Engine, a: { id: string }, ai: string, b: { id: string }, bi: string, cable: import('./engine/engine').CableType = 'straight') {
  e.connect({ dev: a.id, iface: ai }, { dev: b.id, iface: bi }, cable);
}

export const EXAMPLES: Example[] = [
  {
    id: 'lan',
    title: 'One switch, three PCs',
    summary: 'A flat LAN with static addresses. Try pinging between PCs and watching ARP in simulation mode.',
    build(e) {
      const sw = createDevice(e, 'switch', 420, 160) as Switch;
      const pcs = [0, 1, 2].map((k) => createDevice(e, k === 2 ? 'laptop' : 'pc', 240 + k * 180, 340) as Host);
      pcs.forEach((p, k) => {
        link(e, p, 'FastEthernet0', sw, `FastEthernet0/${k + 1}`);
        p.setStatic(ip(`192.168.10.${11 + k}`), m24, ip('192.168.10.1'));
      });
      return [{ id: 'n1', x: 160, y: 40, text: 'All hosts are in 192.168.10.0/24.\nOpen PC0 → Desktop → Command Prompt and run: ping 192.168.10.13' }];
    },
  },
  {
    id: 'routing',
    title: 'Two routers, static routing',
    summary: 'Two LANs joined by a point-to-point link. Static routes are already configured.',
    build(e) {
      const r1 = createDevice(e, 'router', 300, 140) as Router;
      const r2 = createDevice(e, 'router', 620, 140) as Router;
      const s1 = createDevice(e, 'switch', 220, 300) as Switch;
      const s2 = createDevice(e, 'switch', 700, 300) as Switch;
      const p1 = createDevice(e, 'pc', 140, 450) as Host;
      const p2 = createDevice(e, 'pc', 300, 450) as Host;
      const p3 = createDevice(e, 'pc', 780, 450) as Host;
      link(e, r1, 'GigabitEthernet0/1', r2, 'GigabitEthernet0/1', 'cross');
      link(e, r1, 'GigabitEthernet0/0', s1, 'GigabitEthernet0/1');
      link(e, r2, 'GigabitEthernet0/0', s2, 'GigabitEthernet0/1');
      link(e, p1, 'FastEthernet0', s1, 'FastEthernet0/1');
      link(e, p2, 'FastEthernet0', s1, 'FastEthernet0/2');
      link(e, p3, 'FastEthernet0', s2, 'FastEthernet0/1');
      applyConfig(r1, [
        'hostname R1',
        'interface g0/0',
        'ip address 192.168.1.1 255.255.255.0',
        'no shutdown',
        'interface g0/1',
        'ip address 10.0.0.1 255.255.255.252',
        'no shutdown',
        'exit',
        'ip route 192.168.2.0 255.255.255.0 10.0.0.2',
      ]);
      applyConfig(r2, [
        'hostname R2',
        'interface g0/0',
        'ip address 192.168.2.1 255.255.255.0',
        'no shutdown',
        'interface g0/1',
        'ip address 10.0.0.2 255.255.255.252',
        'no shutdown',
        'exit',
        'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
      ]);
      p1.setStatic(ip('192.168.1.10'), m24, ip('192.168.1.1'));
      p2.setStatic(ip('192.168.1.11'), m24, ip('192.168.1.1'));
      p3.setStatic(ip('192.168.2.10'), m24, ip('192.168.2.1'));
      return [{ id: 'n1', x: 330, y: 20, text: 'Run "show ip route" on R1, then tracert 192.168.2.10 from PC0.' }];
    },
  },
  {
    id: 'vlans',
    title: 'VLANs, router-on-a-stick and DHCP',
    summary: 'Two VLANs on one switch, routed by sub-interfaces, with addresses from the router\'s DHCP pools.',
    build(e) {
      const r = createDevice(e, 'router', 460, 110) as Router;
      const sw = createDevice(e, 'switch', 460, 270) as Switch;
      const a = createDevice(e, 'pc', 240, 440) as Host;
      const b = createDevice(e, 'pc', 400, 440) as Host;
      const c = createDevice(e, 'pc', 560, 440) as Host;
      const d = createDevice(e, 'laptop', 720, 440) as Host;
      link(e, r, 'GigabitEthernet0/0', sw, 'GigabitEthernet0/1');
      [a, b, c, d].forEach((p, k) => link(e, p, 'FastEthernet0', sw, `FastEthernet0/${k + 1}`));
      applyConfig(sw, [
        'hostname S1',
        'vlan 10',
        'name STAFF',
        'vlan 20',
        'name GUEST',
        'exit',
        'interface range fa0/1 - 2',
        'switchport mode access',
        'switchport access vlan 10',
        'interface range fa0/3 - 4',
        'switchport mode access',
        'switchport access vlan 20',
        'interface g0/1',
        'switchport mode trunk',
        'exit',
      ]);
      applyConfig(r, [
        'hostname R1',
        'interface g0/0',
        'no shutdown',
        'interface g0/0.10',
        'encapsulation dot1Q 10',
        'ip address 10.10.0.1 255.255.255.0',
        'interface g0/0.20',
        'encapsulation dot1Q 20',
        'ip address 10.20.0.1 255.255.255.0',
        'exit',
        'ip dhcp excluded-address 10.10.0.1 10.10.0.9',
        'ip dhcp excluded-address 10.20.0.1 10.20.0.9',
        'ip dhcp pool STAFF',
        'network 10.10.0.0 255.255.255.0',
        'default-router 10.10.0.1',
        'dns-server 10.10.0.1',
        'ip dhcp pool GUEST',
        'network 10.20.0.0 255.255.255.0',
        'default-router 10.20.0.1',
        'exit',
      ]);
      for (const p of [a, b, c, d]) p.useDhcp();
      return [
        { id: 'n1', x: 120, y: 60, text: 'PC0, PC1: VLAN 10 (STAFF)\nPC2, Laptop0: VLAN 20 (GUEST)\nEvery host gets its address from R1 by DHCP.' },
      ];
    },
  },
  {
    id: 'wan',
    title: 'Serial WAN between two sites',
    summary: 'Two NL-R1900 routers joined by a serial cable. HQ is the DCE and sets the clock rate. A console cable is ready on PC0.',
    build(e) {
      const hq = createDevice(e, 'router', 300, 160, 'NL-R1900') as Router;
      const br = createDevice(e, 'router', 700, 160, 'NL-R1900') as Router;
      const s1 = createDevice(e, 'switch', 300, 330) as Switch;
      const p1 = createDevice(e, 'pc', 200, 480) as Host;
      const p2 = createDevice(e, 'laptop', 380, 480) as Host;
      const p3 = createDevice(e, 'pc', 700, 400) as Host;
      link(e, hq, 'Serial0/0/0', br, 'Serial0/0/0', 'serial-dce');
      link(e, hq, 'GigabitEthernet0/0', s1, 'GigabitEthernet0/1');
      link(e, p1, 'FastEthernet0', s1, 'FastEthernet0/1');
      link(e, p2, 'FastEthernet0', s1, 'FastEthernet0/2');
      link(e, p3, 'FastEthernet0', br, 'GigabitEthernet0/0', 'cross');
      link(e, p1, 'RS232', hq, 'Console', 'console');
      applyConfig(hq, ['hostname HQ', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown', 'interface s0/0/0', 'ip address 10.0.0.1 255.255.255.252', 'clock rate 64000', 'no shutdown', 'exit', 'ip route 192.168.20.0 255.255.255.0 10.0.0.2']);
      applyConfig(br, ['hostname Branch', 'interface g0/0', 'ip address 192.168.20.1 255.255.255.0', 'no shutdown', 'interface s0/0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 Serial0/0/0']);
      p1.setStatic(ip('192.168.10.10'), m24, ip('192.168.10.1'));
      p2.setStatic(ip('192.168.10.11'), m24, ip('192.168.10.1'));
      p3.setStatic(ip('192.168.20.10'), m24, ip('192.168.20.1'));
      return [{ id: 'n1', x: 430, y: 40, text: 'Try: on HQ, show controllers s0/0/0\nOn PC0, open Desktop > Terminal for HQ\'s console.' }];
    },
  },
  {
    id: 'multilayer',
    title: 'Inter-VLAN routing on a multilayer switch',
    summary: 'An NL-S3600 routes between VLAN 10 and VLAN 20 with SVIs, and reaches the internet edge router over a routed port.',
    build(e) {
      const edge = createDevice(e, 'router', 460, 100, 'NL-R4400') as Router;
      const core = createDevice(e, 'l3switch', 460, 260) as Switch;
      const a1 = createDevice(e, 'switch', 260, 400) as Switch;
      const a2 = createDevice(e, 'switch', 660, 400) as Switch;
      const hosts = [
        createDevice(e, 'pc', 180, 540) as Host,
        createDevice(e, 'laptop', 340, 540) as Host,
        createDevice(e, 'pc', 580, 540) as Host,
        createDevice(e, 'printer', 740, 540) as Host,
      ];
      link(e, edge, 'GigabitEthernet0/0/0', core, 'GigabitEthernet1/0/24');
      link(e, core, 'GigabitEthernet1/0/1', a1, 'GigabitEthernet0/1', 'cross');
      link(e, core, 'GigabitEthernet1/0/2', a2, 'GigabitEthernet0/1', 'cross');
      link(e, hosts[0], 'FastEthernet0', a1, 'FastEthernet0/1');
      link(e, hosts[1], 'FastEthernet0', a1, 'FastEthernet0/2');
      link(e, hosts[2], 'FastEthernet0', a2, 'FastEthernet0/1');
      link(e, hosts[3], 'FastEthernet0', a2, 'FastEthernet0/2');
      applyConfig(a1, ['hostname Access1', 'vlan 10', 'name STAFF', 'exit', 'interface range fa0/1 - 2', 'switchport mode access', 'switchport access vlan 10', 'interface g0/1', 'switchport mode trunk', 'exit']);
      applyConfig(a2, ['hostname Access2', 'vlan 20', 'name LAB', 'exit', 'interface range fa0/1 - 2', 'switchport mode access', 'switchport access vlan 20', 'interface g0/1', 'switchport mode trunk', 'exit']);
      applyConfig(core, [
        'hostname Core',
        'ip routing',
        'vlan 10',
        'name STAFF',
        'vlan 20',
        'name LAB',
        'exit',
        'interface range g1/0/1 - 2',
        'switchport trunk encapsulation dot1q',
        'switchport mode trunk',
        'interface vlan 10',
        'ip address 10.10.0.1 255.255.255.0',
        'no shutdown',
        'interface vlan 20',
        'ip address 10.20.0.1 255.255.255.0',
        'no shutdown',
        'interface g1/0/24',
        'no switchport',
        'ip address 172.16.0.2 255.255.255.252',
        'exit',
        'ip route 0.0.0.0 0.0.0.0 172.16.0.1',
      ]);
      applyConfig(edge, ['hostname Edge', 'interface g0/0/0', 'ip address 172.16.0.1 255.255.255.252', 'no shutdown', 'exit', 'ip route 10.0.0.0 255.0.0.0 172.16.0.2']);
      hosts[0].setStatic(ip('10.10.0.10'), m24, ip('10.10.0.1'));
      hosts[1].setStatic(ip('10.10.0.11'), m24, ip('10.10.0.1'));
      hosts[2].setStatic(ip('10.20.0.10'), m24, ip('10.20.0.1'));
      hosts[3].setStatic(ip('10.20.0.50'), m24, ip('10.20.0.1'));
      return [{ id: 'n1', x: 100, y: 80, text: 'Core routes between VLANs.\nRun show ip route on Core, then ping 172.16.0.1 from PC0.' }];
    },
  },
];
