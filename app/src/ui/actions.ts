import { fmtIp } from '../engine/addr';
import { cableFor, deviceGroup, mediaOf, type CableType, type Device, type DeviceKind, type Iface, type Media } from '../engine/engine';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { reloadDevice } from '../cli/ios';
import { createDevice, load, serialize, type Note, type SavedFile } from '../engine/topology';
import { dropShell } from '../cli/sessions';
import { closeWindow, engine, getState, markDirty, setState, toast, type Scenario } from './store';

export function placeDevice(kind: DeviceKind, x: number, y: number, model?: string) {
  const d = createDevice(engine, kind, Math.round(x), Math.round(y), model);
  markDirty();
  return d;
}

export function deleteDevice(id: string) {
  const d = engine.devices.get(id);
  if (!d) return;
  closeWindow(id);
  dropShell(d);
  engine.removeDevice(id);
  setState((s) => ({
    selected: s.selected?.id === id ? null : s.selected,
    scenarios: s.scenarios.filter((sc) => sc.src !== id && sc.dst !== id),
    cableFrom: s.cableFrom?.dev === id ? null : s.cableFrom,
  }));
  markDirty();
}

export function deleteLink(id: string) {
  engine.disconnect(id);
  setState((s) => ({ selected: s.selected?.id === id ? null : s.selected }));
  markDirty();
}

export function freePorts(d: Device, media?: Media[]): Iface[] {
  return d.allPorts().filter((i) => !i.linkId && (!media || media.includes(mediaOf(i))));
}

/** Port media a cable type plugs into. */
export function mediaForCable(c: CableType): Media[] {
  switch (c) {
    case 'console':
      return ['console', 'rs232'];
    case 'fiber':
      return ['fiber'];
    case 'serial-dce':
    case 'serial-dte':
      return ['serial'];
    case 'straight':
    case 'cross':
      return ['copper'];
    default:
      return ['copper', 'fiber', 'serial'];
  }
}

/**
 * Choose free ports on both devices for an automatic cable: the first pair of
 * matching media, preferring copper, then fiber, then serial.
 */
export function autoPair(a: Device, b: Device, fixedA?: string): [Iface, Iface] | null {
  const prefer: Media[] = ['copper', 'fiber', 'serial'];
  const aPorts = fixedA ? [a.port(fixedA)!] : freePorts(a, prefer);
  for (const m of prefer) {
    const pa = aPorts.filter((p) => mediaOf(p) === m);
    if (!pa.length) continue;
    let pb = freePorts(b, [m]);
    // switches: uplinks to other network gear go on the Gigabit ports first
    if (b.kind === 'switch' && deviceGroup(a.kind) === 'N' && a.kind === 'router') pb = [...pb.filter((p) => p.name.startsWith('Gigabit')), ...pb];
    if ((b.kind === 'switch' || b.kind === 'l3switch') && (a.kind === 'switch' || a.kind === 'l3switch')) pb = [...pb.filter((p) => p.name.startsWith('Gigabit')), ...pb];
    let first = pa[0];
    if ((a.kind === 'switch') && (b.kind === 'router' || b.kind === 'switch' || b.kind === 'l3switch')) first = pa.find((p) => p.name.startsWith('Gigabit')) ?? pa[0];
    if (pb.length) return [first, pb[0]];
  }
  return null;
}

/** Old helper kept for callers that need a single port. */
export function autoPort(d: Device, other: Device): Iface | undefined {
  return autoPair(d, other)?.[0];
}

export function properCable(a: Device, b: Device): CableType {
  return deviceGroup(a.kind) === deviceGroup(b.kind) ? 'cross' : 'straight';
}

export function connectPorts(a: { dev: string; iface: string }, b: { dev: string; iface: string }, cable: CableType) {
  const da = engine.devices.get(a.dev)!;
  const db = engine.devices.get(b.dev)!;
  const r = engine.connect(a, b, cable);
  if (typeof r === 'string') {
    toast(r, 'error');
    return false;
  }
  if (!engine.cableOk(r)) {
    const need = cableFor(da, da.port(a.iface)!, db, db.port(b.iface)!);
    toast(`That cable type won't bring the link up between ${da.hostname} and ${db.hostname}. Try ${need === 'cross' ? 'a cross-over' : 'a straight-through'} cable.`, 'error');
  } else if (r.dce) {
    const dce = engine.dceEnd(r)!;
    toast(`Serial link: ${engine.devices.get(dce.dev)!.hostname} ${dce.iface} is the DCE end. Set "clock rate 64000" on it to bring the line up.`);
  }
  markDirty();
  return true;
}

/** Turn every device off and on again. Routers and switches boot from startup-config. */
export function powerCycleAll() {
  for (const d of engine.devices.values()) d.setPower(false);
  for (const d of engine.devices.values()) {
    if (d instanceof Router || d instanceof Switch) reloadDevice(d);
    d.setPower(true);
  }
  engine.refreshAll();
  markDirty();
  toast('All devices restarted. Routers and switches loaded their startup-config.');
}

export function togglePower(d: Device) {
  if (d.powered) d.setPower(false);
  else {
    if (d instanceof Router || d instanceof Switch) reloadDevice(d);
    d.setPower(true);
  }
  markDirty();
}

/** Skip ahead in time: finishes pending pings, DHCP, ARP timeouts. */
export function fastForward(ms = 30000) {
  engine.runFor(ms);
  setState({ engineVersion: engine.version });
}

/** First usable IP on a device (for Simple PDU destinations). */
export function primaryIp(d: Device): number | undefined {
  for (const i of d.ifaces.values()) if (i.ip !== undefined && d.lineUp(i.name)) return i.ip;
  for (const i of d.ifaces.values()) if (i.ip !== undefined) return i.ip;
  return undefined;
}

let scenarioSeq = 0;

function stackOf(d: Device) {
  return (d as unknown as { stack?: import('../engine/ipstack').IpStack }).stack;
}

export function createScenario(srcId: string, dstId: string) {
  const src = engine.devices.get(srcId);
  const dst = engine.devices.get(dstId);
  if (!src || !dst) return;
  const ip = primaryIp(dst);
  if (ip === undefined) {
    toast(`${dst.hostname} has no IP address yet. Configure one, then try again.`, 'error');
    return;
  }
  if (!stackOf(src)) return;
  const sc: Scenario = { id: ++scenarioSeq, src: srcId, dst: dstId, dstIp: ip, status: 'In progress', fired: 0 };
  setState((s) => ({ scenarios: [...s.scenarios, sc] }));
  fireScenario(sc.id);
}

export function fireScenario(id: number) {
  const sc = getState().scenarios.find((s) => s.id === id);
  if (!sc) return;
  const src = engine.devices.get(sc.src);
  const stack = src && stackOf(src);
  if (!stack) return;
  const update = (status: Scenario['status']) =>
    setState((s) => ({ scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, status, fired: x.fired + (status === 'In progress' ? 1 : 0) } : x)) }));
  update('In progress');
  stack.ping(
    sc.dstIp,
    { count: 1, timeout: 3000 },
    (r) => update(r.kind === 'reply' ? 'Successful' : 'Failed'),
    () => {},
  );
}

export function removeScenario(id: number) {
  setState((s) => ({ scenarios: s.scenarios.filter((x) => x.id !== id) }));
}

export function describeScenario(sc: Scenario) {
  const a = engine.devices.get(sc.src)?.hostname ?? '?';
  const b = engine.devices.get(sc.dst)?.hostname ?? '?';
  return { a, b, ip: fmtIp(sc.dstIp) };
}

// ---------------- simulation ----------------
export function setMode(mode: 'realtime' | 'simulation') {
  engine.mode = mode;
  if (mode === 'realtime') {
    setState({ playing: false, anim: null });
  }
  engine.bump();
  setState({ engineVersion: engine.version });
}

export function simStep() {
  const pdus = engine.stepVisible();
  const f = getState().filters;
  const shown = pdus.filter((p) => f[p.kind]);
  if (shown.length) setState({ anim: { pdus: shown, start: performance.now(), dur: Math.min(getState().speed * 0.85, 900) } });
  setState({ engineVersion: engine.version });
  return pdus.length > 0;
}

export function simReset() {
  engine.resetTraffic();
  for (const d of engine.devices.values()) {
    const st = stackOf(d);
    if (st) {
      st.arp.clear();
      st.pending = [];
    }
    if (d.kind === 'switch') (d as unknown as { macTable: Map<string, unknown> }).macTable.clear();
  }
  // Scenario PDUs stay listed; they show as Ready until fired again.
  setState((s) => ({ anim: null, playing: false, scenarios: s.scenarios.map((x) => ({ ...x, status: 'Ready' as const, fired: 0 })), engineVersion: engine.version }));
}

// ---------------- files ----------------
export const AUTOSAVE_KEY = 'netlab.autosave.v1';

export function currentFile(): SavedFile {
  return serialize(engine, getState().notes);
}

export function newTopology() {
  for (const w of getState().wins) closeWindow(w.devId);
  for (const d of engine.devices.values()) dropShell(d);
  engine.devices.clear();
  engine.links.clear();
  engine.resetTraffic();
  engine.now = 0;
  setState({ notes: [], scenarios: [], selected: null, fileName: 'Untitled', dirty: false, anim: null, playing: false, cableFrom: null, pduSrc: null });
}

export function openTopology(file: SavedFile, name: string) {
  newTopology();
  try {
    const notes = load(engine, file);
    setState({ notes, fileName: name.replace(/\.nlab$/i, ''), dirty: false });
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

export function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: getState().fileName, file: currentFile() }));
  } catch {
    /* storage may be unavailable */
  }
}

export function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const { name, file } = JSON.parse(raw);
    if (!file?.devices?.length) return false;
    openTopology(file, name ?? 'Untitled');
    return true;
  } catch {
    return false;
  }
}

export function addNote(x: number, y: number) {
  const n: Note = { id: 'n' + Date.now().toString(36), x, y, text: 'Note' };
  setState((s) => ({ notes: [...s.notes, n], selected: { kind: 'note', id: n.id } }));
  markDirty();
  return n;
}

export function updateNote(id: string, patch: Partial<Note>) {
  setState((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  markDirty();
}

export function deleteNote(id: string) {
  setState((s) => ({ notes: s.notes.filter((n) => n.id !== id), selected: null }));
  markDirty();
}

export function deleteSelected() {
  const sel = getState().selected;
  if (!sel) return;
  if (sel.kind === 'device') deleteDevice(sel.id);
  else if (sel.kind === 'link') deleteLink(sel.id);
  else deleteNote(sel.id);
}
