import type { DeviceKind, Media } from './engine';

export interface PortSpec {
  name: string;
  media: Media;
  speed: number;
}

export type Category = 'routers' | 'switches' | 'hubs' | 'end' | 'connections';

export interface ModelSpec {
  id: string;
  kind: DeviceKind;
  category: Category;
  label: string;
  detail: string;
  ports: PortSpec[];
  /** Management ports (console / RS-232). */
  mgmt: PortSpec[];
}

const range = (prefix: string, from: number, to: number, media: Media, speed: number): PortSpec[] =>
  Array.from({ length: to - from + 1 }, (_, k) => ({ name: `${prefix}${from + k}`, media, speed }));

const CONSOLE: PortSpec[] = [{ name: 'Console', media: 'console', speed: 9.6 }];
const RS232: PortSpec[] = [{ name: 'RS232', media: 'rs232', speed: 9.6 }];

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
    id: 'NL-R2900',
    kind: 'router',
    category: 'routers',
    label: 'NL-R2900',
    detail: '3 × Gigabit, 4 × Serial',
    ports: [...range('GigabitEthernet0/', 0, 2, 'copper', 1000), ...range('Serial0/0/', 0, 1, 'serial', 1544), ...range('Serial0/1/', 0, 1, 'serial', 1544)],
    mgmt: CONSOLE,
  },
  {
    id: 'NL-R4400',
    kind: 'router',
    category: 'routers',
    label: 'NL-R4400',
    detail: '4 × Gigabit, 2 × fiber',
    ports: [...range('GigabitEthernet0/0/', 0, 3, 'copper', 1000), ...range('GigabitEthernet0/1/', 0, 1, 'fiber', 1000)],
    mgmt: CONSOLE,
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
  },
  {
    id: 'NL-S2448',
    kind: 'switch',
    category: 'switches',
    label: 'NL-S2448',
    detail: '48 × Fast, 2 × Gigabit',
    ports: [...range('FastEthernet0/', 1, 48, 'copper', 100), ...range('GigabitEthernet0/', 1, 2, 'copper', 1000)],
    mgmt: CONSOLE,
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
  // ---------------- end devices ----------------
  { id: 'NL-PC', kind: 'pc', category: 'end', label: 'PC', detail: 'Desktop', ports: [{ name: 'FastEthernet0', media: 'copper', speed: 100 }], mgmt: RS232 },
  { id: 'NL-Laptop', kind: 'laptop', category: 'end', label: 'Laptop', detail: 'Portable', ports: [{ name: 'FastEthernet0', media: 'copper', speed: 100 }], mgmt: RS232 },
  { id: 'NL-Server', kind: 'server', category: 'end', label: 'Server', detail: 'DHCP service', ports: [{ name: 'FastEthernet0', media: 'copper', speed: 100 }], mgmt: [] },
  { id: 'NL-Printer', kind: 'printer', category: 'end', label: 'Printer', detail: 'Network printer', ports: [{ name: 'FastEthernet0', media: 'copper', speed: 100 }], mgmt: [] },
  { id: 'NL-Phone', kind: 'phone', category: 'end', label: 'IP Phone', detail: 'Desk phone', ports: [{ name: 'FastEthernet0', media: 'copper', speed: 100 }], mgmt: [] },
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
};

export function modelSpec(id: string | undefined, kind: DeviceKind): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL[kind])!;
}
