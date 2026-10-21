import { Engine, uid, type CableType, type Device, type DeviceKind } from './engine';
import { Host, type HostKind } from './devices/host';
import { AccessPoint, Hub } from './devices/hub';
import { Router } from './devices/router';
import { Switch } from './devices/switch';

export const FILE_FORMAT = 'harnova-netlab';
export const FILE_VERSION = 1;

const baseNames: Record<DeviceKind, string> = {
  pc: 'PC',
  laptop: 'Laptop',
  server: 'Server',
  switch: 'Switch',
  router: 'Router',
  l3switch: 'MLSwitch',
  hub: 'Hub',
  printer: 'Printer',
  phone: 'IPPhone',
  tablet: 'Tablet',
  smartphone: 'Smartphone',
  tv: 'TV',
  ap: 'AccessPoint',
};

export function nextName(engine: Engine, kind: DeviceKind): string {
  const base = baseNames[kind];
  const used = new Set([...engine.devices.values()].map((d) => d.hostname));
  for (let n = 0; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

export function createDevice(engine: Engine, kind: DeviceKind, x: number, y: number, model?: string): Device {
  const id = uid('d');
  const name = nextName(engine, kind);
  let d: Device;
  if (kind === 'switch' || kind === 'l3switch') d = new Switch(id, name, model ?? (kind === 'l3switch' ? 'NL-S3600' : undefined));
  else if (kind === 'router') d = new Router(id, name, model);
  else if (kind === 'hub') d = new Hub(id, name, model);
  else if (kind === 'ap') d = new AccessPoint(id, name, model);
  else d = new Host(id, kind as HostKind, name, model);
  d.x = x;
  d.y = y;
  engine.addDevice(d);
  return d;
}

export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface SavedFile {
  format: string;
  version: number;
  devices: Record<string, unknown>[];
  links: { id: string; a: { dev: string; iface: string }; b: { dev: string; iface: string }; cable: CableType; dce?: 'a' | 'b' }[];
  notes?: Note[];
}

export function serialize(engine: Engine, notes: Note[] = []): SavedFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    devices: [...engine.devices.values()].map((d) => d.toJSON()),
    // wireless associations are rebuilt from SSID settings when a file is opened
    links: [...engine.links.values()].filter((l) => l.cable !== 'wireless').map((l) => ({ id: l.id, a: l.a, b: l.b, cable: l.cable, dce: l.dce })),
    notes,
  };
}

export function deviceFromJSON(j: Record<string, any>): Device {
  if (j.type === 'switch' || j.type === 'l3switch') return Switch.fromJSON(j);
  if (j.type === 'hub' || j.type === 'ap') return Hub.fromJSON(j);
  if (j.type === 'router') return Router.fromJSON(j);
  return Host.fromJSON(j);
}

export function load(engine: Engine, file: SavedFile): Note[] {
  if (file.format !== FILE_FORMAT) throw new Error('This is not a NetLab file.');
  engine.resetTraffic();
  engine.devices.clear();
  engine.links.clear();
  for (const j of file.devices) engine.addDevice(deviceFromJSON(j as Record<string, any>));
  for (const l of file.links) {
    // keep which end is DCE: connect with the cable that puts DCE on end a
    if (l.dce === 'b') engine.connect(l.b, l.a, 'serial-dce', l.id);
    else engine.connect(l.a, l.b, l.cable, l.id);
  }
  engine.refreshAll();
  engine.bump();
  return file.notes ?? [];
}
