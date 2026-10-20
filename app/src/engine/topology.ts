import { Engine, uid, type CableType, type Device, type DeviceKind } from './engine';
import { Host } from './devices/host';
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
};

export function nextName(engine: Engine, kind: DeviceKind): string {
  const base = baseNames[kind];
  const used = new Set([...engine.devices.values()].map((d) => d.hostname));
  for (let n = 0; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

export function createDevice(engine: Engine, kind: DeviceKind, x: number, y: number): Device {
  const id = uid('d');
  const name = nextName(engine, kind);
  let d: Device;
  if (kind === 'switch') d = new Switch(id, name);
  else if (kind === 'router') d = new Router(id, name);
  else d = new Host(id, kind, name);
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
  links: { id: string; a: { dev: string; iface: string }; b: { dev: string; iface: string }; cable: CableType }[];
  notes?: Note[];
}

export function serialize(engine: Engine, notes: Note[] = []): SavedFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    devices: [...engine.devices.values()].map((d) => d.toJSON()),
    links: [...engine.links.values()].map((l) => ({ id: l.id, a: l.a, b: l.b, cable: l.cable })),
    notes,
  };
}

export function deviceFromJSON(j: Record<string, any>): Device {
  if (j.type === 'switch') return Switch.fromJSON(j);
  if (j.type === 'router') return Router.fromJSON(j);
  return Host.fromJSON(j);
}

export function load(engine: Engine, file: SavedFile): Note[] {
  if (file.format !== FILE_FORMAT) throw new Error('This is not a NetLab file.');
  engine.resetTraffic();
  engine.devices.clear();
  engine.links.clear();
  for (const j of file.devices) engine.addDevice(deviceFromJSON(j as Record<string, any>));
  for (const l of file.links) engine.connect(l.a, l.b, l.cable, l.id);
  engine.refreshAll();
  engine.bump();
  return file.notes ?? [];
}
