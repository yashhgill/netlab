import type { DeviceKind, Media } from './engine';

export interface PortSpec {
  name: string;
  media: Media;
  speed: number;
}

export type Category = 'routers' | 'switches' | 'hubs' | 'wireless' | 'end' | 'connections';

export interface ModelSpec {
  id: string;
  kind: DeviceKind;
  category: Category;
  label: string;
  detail: string;
  ports: PortSpec[];
  /** Management ports (console / RS-232). */
  mgmt: PortSpec[];
  /** Packet Tracer model names this model stands in for when importing .pkt files. */
  pt?: string[];
}

const range = (prefix: string, from: number, to: number, media: Media, speed: number): PortSpec[] =>
  Array.from({ length: to - from + 1 }, (_, k) => ({ name: `${prefix}${from + k}`, media, speed }));

const CONSOLE: PortSpec[] = [{ name: 'Console', media: 'console', speed: 9.6 }];
const RS232: PortSpec[] = [{ name: 'RS232', media: 'rs232', speed: 9.6 }];
const FA0: PortSpec[] = [{ name: 'FastEthernet0', media: 'copper', speed: 100 }];
const WL0: PortSpec[] = [{ name: 'Wireless0', media: 'wireless', speed: 300 }];
/** Radio slots an access point offers to clients (one per associated client). */
const RADIO: PortSpec[] = Array.from({ length: 32 }, (_, k) => ({ name: `Radio${k + 1}`, media: 'wireless' as Media, speed: 54 }));

export const MODELS: ModelSpec[] = [
  // ---------------- routers ----------------
  {
    id: 'NL-R1900',
    kind: 'router',
    category: 'routers',
    label: 'NL-R1900',
    detail: '2 × Gigabit, 2 × Serial',
    ports: [...range('GigabitEthernet0/', 0, 1, 'copper', 1000), ...range('Serial0/0/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
    pt: ['1941', '2901', '1921'],
  },
  {
    id: 'NL-R2800',
    kind: 'router',
    category: 'routers',
    label: 'NL-R2800',
    detail: '2 × Fast Ethernet, 2 × Serial',
    ports: [...range('FastEthernet0/', 0, 1, 'copper', 100), ...range('Serial0/0/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
    pt: ['2811', '1841', '2620XM', '2621XM'],
  },
  {
    id: 'NL-R3000',
    kind: 'router',
    category: 'routers',
    label: 'NL-R3000',
    detail: '3 × Gigabit',
    ports: range('GigabitEthernet0/', 0, 2, 'copper', 1000),
    mgmt: CONSOLE,
  },
  {
    id: 'NL-R4320',
    kind: 'router',
    category: 'routers',
    label: 'NL-R4320',
    detail: '2 × Gigabit, 4 × Serial (ISR style)',
    ports: [...range('GigabitEthernet0/0/', 0, 1, 'copper', 1000), ...range('Serial0/1/', 0, 1, 'serial', 1544), ...range('Serial0/2/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
    pt: ['ISR4321'],
  },
  {
    id: 'NL-R4330',
    kind: 'router',
    category: 'routers',
    label: 'NL-R4330',
    detail: '3 × Gigabit, 4 × Serial (ISR style)',
    ports: [...range('GigabitEthernet0/0/', 0, 2, 'copper', 1000), ...range('Serial0/1/', 0, 1, 'serial', 1544), ...range('Serial0/2/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
    pt: ['ISR4331'],
  },
  {
    id: 'NL-R2900',
    kind: 'router',
    category: 'routers',
    label: 'NL-R2900',
    detail: '3 × Gigabit, 4 × Serial',
    ports: [...range('GigabitEthernet0/', 0, 2, 'copper', 1000), ...range('Serial0/0/', 0, 1, 'serial', 1544), ...range('Serial0/1/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
    pt: ['2911'],
  },
  {
    id: 'NL-R4400',
    kind: 'router',
    category: 'routers',
    label: 'NL-R4400',
    detail: '4 × Gigabit, 2 × fiber',
    ports: [...range('GigabitEthernet0/0/', 0, 3, 'copper', 1000), ...range('GigabitEthernet0/1/', 0, 1, 'fiber', 1000)],
    mgmt: CONSOLE,
    pt: ['ISR4431', 'ISR4451'],
  },
  {
    id: 'NL-RMOD',
    kind: 'router',
    category: 'routers',
    label: 'Modular router',
    detail: 'Generic: 4 × Fast Ethernet, 2 × Serial in slots',
    ports: [
      { name: 'FastEthernet0/0', media: 'copper', speed: 100 },
      { name: 'FastEthernet1/0', media: 'copper', speed: 100 },
      { name: 'Serial2/0', media: 'serial', speed: 1544 },
      { name: 'Serial3/0', media: 'serial', speed: 1544 },
      { name: 'FastEthernet4/0', media: 'copper', speed: 100 },
      { name: 'FastEthernet5/0', media: 'copper', speed: 100 },
    ],
    mgmt: CONSOLE,
    pt: ['Router-PT', 'Router-PT-Empty'],
  },
  // ---------------- switches ----------------
  {
    id: 'NL-S2400',
    kind: 'switch',
    category: 'switches',
    label: 'NL-S2400',
    detail: '24 × Fast, 2 × Gigabit',
    ports: [...range('FastEthernet0/', 1, 24, 'copper', 100), ...range('GigabitEthernet0/', 1, 2, 'copper', 1000)],
    mgmt: CONSOLE,
    pt: ['2960-24TT', '2950T-24', '2960-24TC'],
  },
  {
    id: 'NL-S2924',
    kind: 'switch',
    category: 'switches',
    label: 'NL-S2924',
    detail: '24 × Fast Ethernet',
    ports: range('FastEthernet0/', 1, 24, 'copper', 100),
    mgmt: CONSOLE,
    pt: ['2950-24'],
  },
  {
    id: 'NL-S2448',
    kind: 'switch',
    category: 'switches',
    label: 'NL-S2448',
    detail: '48 × Fast, 2 × Gigabit',
    ports: [...range('FastEthernet0/', 1, 48, 'copper', 100), ...range('GigabitEthernet0/', 1, 2, 'copper', 1000)],
    mgmt: CONSOLE,
    pt: ['2960-48TT'],
  },
  {
    id: 'NL-S2960F',
    kind: 'switch',
    category: 'switches',
    label: 'NL-S2960F',
    detail: '24 × Gigabit, 2 × fiber',
    ports: [...range('GigabitEthernet0/', 1, 24, 'copper', 1000), ...range('GigabitEthernet0/', 25, 26, 'fiber', 1000)],
    mgmt: CONSOLE,
  },
  {
    id: 'NL-S3600',
    kind: 'l3switch',
    category: 'switches',
    label: 'NL-S3600',
    detail: 'Multilayer, 24 × Gigabit, 4 × fiber',
    ports: [...range('GigabitEthernet1/0/', 1, 24, 'copper', 1000), ...range('GigabitEthernet1/1/', 1, 4, 'fiber', 1000)],
    mgmt: CONSOLE,
    pt: ['3650-24PS'],
  },
  {
    id: 'NL-S3524',
    kind: 'l3switch',
    category: 'switches',
    label: 'NL-S3524',
    detail: 'Multilayer, 24 × Fast, 2 × Gigabit',
    ports: [...range('FastEthernet0/', 1, 24, 'copper', 100), ...range('GigabitEthernet0/', 1, 2, 'copper', 1000)],
    mgmt: CONSOLE,
    pt: ['3560-24PS'],
  },
  {
    id: 'NL-SMOD',
    kind: 'switch',
    category: 'switches',
    label: 'Modular switch',
    detail: 'Generic: 6 × Fast Ethernet in slots',
    ports: [0, 1, 2, 3, 4, 5].map((k) => ({ name: `FastEthernet${k}/1`, media: 'copper' as Media, speed: 100 })),
    mgmt: CONSOLE,
    pt: ['Switch-PT', 'Switch-PT-Empty'],
  },
  // ---------------- hubs ----------------
  {
    id: 'NL-H800',
    kind: 'hub',
    category: 'hubs',
    label: 'Hub',
    detail: '8 × Ethernet, repeats every frame',
    ports: range('Ethernet', 0, 7, 'copper', 10),
    mgmt: [],
  },
  {
    id: 'NL-H6',
    kind: 'hub',
    category: 'hubs',
    label: 'Hub 6',
    detail: '6 × Fast Ethernet, repeats every frame',
    ports: range('FastEthernet', 0, 5, 'copper', 100),
    mgmt: [],
    pt: ['Hub-PT'],
  },
  {
    id: 'NL-REP',
    kind: 'hub',
    category: 'hubs',
    label: 'Repeater',
    detail: '2 ports, extends a cable run',
    ports: [
      { name: 'Port 0', media: 'copper', speed: 100 },
      { name: 'Port 1', media: 'copper', speed: 100 },
    ],
    mgmt: [],
    pt: ['Repeater-PT'],
  },
  // ---------------- wireless ----------------
  {
    id: 'NL-AP',
    kind: 'ap',
    category: 'wireless',
    label: 'Access point',
    detail: 'Bridges wireless clients to Ethernet; SSID + WPA2',
    ports: [{ name: 'Port 0', media: 'copper', speed: 100 }, ...RADIO],
    mgmt: [],
    pt: ['AccessPoint-PT', 'AccessPoint-PT-A', 'AccessPoint-PT-N', 'AccessPoint-PT-AC'],
  },
  // ---------------- end devices ----------------
  { id: 'NL-PC', kind: 'pc', category: 'end', label: 'PC', detail: 'Desktop', ports: FA0, mgmt: RS232, pt: ['PC-PT'] },
  { id: 'NL-PC-W', kind: 'pc', category: 'end', label: 'PC (Wi-Fi)', detail: 'Desktop with a wireless card', ports: WL0, mgmt: RS232 },
  { id: 'NL-Laptop', kind: 'laptop', category: 'end', label: 'Laptop', detail: 'Portable, wired', ports: FA0, mgmt: RS232, pt: ['Laptop-PT'] },
  { id: 'NL-Laptop-W', kind: 'laptop', category: 'end', label: 'Laptop (Wi-Fi)', detail: 'Portable, wireless', ports: WL0, mgmt: RS232 },
  { id: 'NL-Server', kind: 'server', category: 'end', label: 'Server', detail: 'DHCP service', ports: FA0, mgmt: [], pt: ['Server-PT'] },
  { id: 'NL-Printer', kind: 'printer', category: 'end', label: 'Printer', detail: 'Network printer', ports: FA0, mgmt: [], pt: ['Printer-PT'] },
  { id: 'NL-Phone', kind: 'phone', category: 'end', label: 'IP Phone', detail: 'Desk phone', ports: FA0, mgmt: [], pt: ['7960'] },
  { id: 'NL-Tablet', kind: 'tablet', category: 'end', label: 'Tablet', detail: 'Wireless tablet', ports: WL0, mgmt: [], pt: ['TabletPC-PT'] },
  { id: 'NL-Smartphone', kind: 'smartphone', category: 'end', label: 'Smartphone', detail: 'Wireless phone', ports: WL0, mgmt: [], pt: ['SMARTPHONE-PT'] },
  { id: 'NL-TV', kind: 'tv', category: 'end', label: 'Smart TV', detail: 'Wired network TV', ports: FA0, mgmt: [], pt: ['TV-PT'] },
];

export const DEFAULT_MODEL: Record<DeviceKind, string> = {
  router: 'NL-R3000',
  switch: 'NL-S2400',
  l3switch: 'NL-S3600',
  hub: 'NL-H800',
  pc: 'NL-PC',
  laptop: 'NL-Laptop',
  server: 'NL-Server',
  printer: 'NL-Printer',
  phone: 'NL-Phone',
  tablet: 'NL-Tablet',
  smartphone: 'NL-Smartphone',
  tv: 'NL-TV',
  ap: 'NL-AP',
};

export function modelSpec(id: string | undefined, kind: DeviceKind): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL[kind])!;
}

/** The NetLab model that stands in for a Packet Tracer model name. */
export function modelForPt(ptModel: string): ModelSpec | undefined {
  return MODELS.find((m) => m.pt?.includes(ptModel));
}
