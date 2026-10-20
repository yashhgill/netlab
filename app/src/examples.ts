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

function link(e: Engine, a: { id: string }, ai: string, b: { id: string }, bi: string, cable: 'straight' | 'cross' = 'straight') {
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
];
