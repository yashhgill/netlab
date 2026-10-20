import { parseIp, parseMask } from '../engine/addr';
import type { CableType, Device, DeviceKind, Engine } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { MODELS } from '../engine/models';
import { createDevice } from '../engine/topology';
import { applyConfig } from '../cli/ios';
import { parseIfaceTokens } from '../cli/ifnames';

export type AiAction =
  | { type: 'add_device'; kind: DeviceKind; model?: string; name?: string }
  | { type: 'connect'; a: string; aPort?: string; b: string; bPort?: string; cable?: CableType }
  | { type: 'cli'; device: string; commands: string[] }
  | { type: 'host_ip'; device: string; ip: string; mask: string; gateway?: string; dns?: string }
  | { type: 'host_dhcp'; device: string };

export interface ActionResult {
  ok: boolean;
  message: string;
  /** IOS errors printed while running commands. */
  errors?: string[];
}

const KINDS: DeviceKind[] = ['router', 'switch', 'l3switch', 'hub', 'pc', 'laptop', 'server', 'printer', 'phone'];

export function describeAction(a: AiAction): string {
  switch (a.type) {
    case 'add_device':
      return `Add ${a.name ?? 'a ' + a.kind}${a.model ? ` (${a.model})` : ''}`;
    case 'connect':
      return `Cable ${a.a}${a.aPort ? ' ' + a.aPort : ''} to ${a.b}${a.bPort ? ' ' + a.bPort : ''}`;
    case 'cli':
      return `Configure ${a.device} (${a.commands.length} command${a.commands.length === 1 ? '' : 's'})`;
    case 'host_ip':
      return `Set ${a.device} to ${a.ip} ${a.mask}${a.gateway ? `, gateway ${a.gateway}` : ''}`;
    case 'host_dhcp':
      return `Set ${a.device} to get its address by DHCP`;
  }
}

/** Keep only well-formed actions; drop anything the model invented in the wrong shape. */
export function sanitizeActions(raw: unknown[]): AiAction[] {
  const out: AiAction[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const a = r as Record<string, unknown>;
    const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : undefined);
    switch (a.type) {
      case 'add_device': {
        const kind = s('kind') as DeviceKind;
        if (KINDS.includes(kind)) out.push({ type: 'add_device', kind, model: s('model'), name: s('name') });
        break;
      }
      case 'connect':
        if (s('a') && s('b')) out.push({ type: 'connect', a: s('a')!, b: s('b')!, aPort: s('aPort'), bPort: s('bPort'), cable: (s('cable') as CableType) || 'auto' });
        break;
      case 'cli':
        if (s('device') && Array.isArray(a.commands)) {
          const cmds = (a.commands as unknown[]).filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean);
          // the app already starts in global config; drop mode-entry commands the model may add
          const filtered = cmds.filter((c) => !/^(en|ena|enable|conf(igure)?( t(erminal)?)?)$/i.test(c));
          if (filtered.length) out.push({ type: 'cli', device: s('device')!, commands: filtered.slice(0, 300) });
        }
        break;
      case 'host_ip':
        if (s('device') && s('ip') && s('mask')) out.push({ type: 'host_ip', device: s('device')!, ip: s('ip')!, mask: s('mask')!, gateway: s('gateway'), dns: s('dns') });
        break;
      case 'host_dhcp':
        if (s('device')) out.push({ type: 'host_dhcp', device: s('device')! });
        break;
    }
  }
  return out;
}

function findDevice(engine: Engine, name: string): Device | undefined {
  const n = name.toLowerCase();
  return [...engine.devices.values()].find((d) => d.hostname.toLowerCase() === n);
}

function resolvePort(d: Device, port?: string): string | undefined {
  if (!port) return undefined;
  if (d.port(port)) return port;
  const toks = port.trim().split(/\s+/);
  const r = parseIfaceTokens(toks, 0);
  if (r && d.port(r.name)) return r.name;
  const lower = port.replace(/\s+/g, '').toLowerCase();
  return d.allPorts().find((p) => p.name.toLowerCase() === lower)?.name;
}

/** A free spot for new devices: a row below everything that exists. */
function nextSpot(engine: Engine, k: number) {
  const ds = [...engine.devices.values()];
  if (!ds.length) return { x: 200 + (k % 5) * 170, y: 160 + Math.floor(k / 5) * 160 };
  const maxY = Math.max(...ds.map((d) => d.y));
  const minX = Math.min(...ds.map((d) => d.x));
  return { x: minX + (k % 5) * 170, y: maxY + 170 + Math.floor(k / 5) * 160 };
}

export function applyActions(
  engine: Engine,
  actions: AiAction[],
  connect: (a: { dev: string; iface: string }, b: { dev: string; iface: string }, cable: CableType) => string | null,
  autoPair: (a: Device, b: Device) => [string, string] | null,
): ActionResult[] {
  const results: ActionResult[] = [];
  let added = 0;
  for (const a of actions) {
    try {
      results.push(applyOne(a));
    } catch (e) {
      results.push({ ok: false, message: `${describeAction(a)}: ${(e as Error).message}` });
    }
  }
  engine.refreshAll();
  engine.bump();
  return results;

  function applyOne(a: AiAction): ActionResult {
    switch (a.type) {
      case 'add_device': {
        if (a.name && findDevice(engine, a.name)) return { ok: true, message: `${a.name} already exists` };
        const model = a.model && MODELS.some((m) => m.id === a.model && m.kind === a.kind) ? a.model : undefined;
        const spot = nextSpot(engine, added++);
        const d = createDevice(engine, a.kind, spot.x, spot.y, model);
        if (a.name && /^[A-Za-z][\w-]{0,30}$/.test(a.name)) d.hostname = a.name;
        return { ok: true, message: `Added ${d.hostname} (${d.model})` };
      }
      case 'connect': {
        const da = findDevice(engine, a.a);
        const db = findDevice(engine, a.b);
        if (!da || !db) return { ok: false, message: `Can't cable ${a.a} to ${a.b}: ${!da ? a.a : a.b} doesn't exist` };
        let pa = resolvePort(da, a.aPort);
        let pb = resolvePort(db, a.bPort);
        if (pa && da.port(pa)?.linkId) {
          const peer = engine.peer(da.id, pa);
          if (peer && peer.dev === db.id) return { ok: true, message: `${da.hostname} ${pa} is already cabled to ${db.hostname}` };
          pa = undefined;
        }
        if (pb && db.port(pb)?.linkId) pb = undefined;
        if (!pa || !pb) {
          const pair = autoPair(da, db);
          if (!pair) return { ok: false, message: `${da.hostname} and ${db.hostname} have no free ports that one cable can join` };
          pa = pa ?? pair[0];
          pb = pb ?? pair[1];
        }
        const err = connect({ dev: da.id, iface: pa }, { dev: db.id, iface: pb }, a.cable ?? 'auto');
        return err ? { ok: false, message: err } : { ok: true, message: `Cabled ${da.hostname} ${pa} to ${db.hostname} ${pb}` };
      }
      case 'cli': {
        const d = findDevice(engine, a.device);
        if (!(d instanceof Router || d instanceof Switch)) return { ok: false, message: `${a.device} isn't a router or switch` };
        const out = applyConfig(d, a.commands);
        const lines = out.split('\n');
        const errors: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (/^%\s?(Invalid|Incomplete|Ambiguous|Unknown)|^% |Bad mask|overlaps with/.test(lines[i]) && !lines[i].startsWith('%LINK') && !lines[i].startsWith('%LINEPROTO') && !lines[i].startsWith('%SYS')) {
            // the command that caused it is the most recent prompt line above
            let j = i - 1;
            while (j >= 0 && !/[#>]/.test(lines[j])) j--;
            const cmd = j >= 0 ? lines[j].replace(/^.*?[#>]/, '') : '';
            errors.push(`${cmd.trim()}: ${lines[i].replace(/^%\s*/, '').trim()}`);
          }
        }
        return { ok: errors.length === 0, message: `Configured ${d.hostname} with ${a.commands.length} command${a.commands.length === 1 ? '' : 's'}`, errors };
      }
      case 'host_ip': {
        const d = findDevice(engine, a.device);
        if (!(d instanceof Host)) return { ok: false, message: `${a.device} isn't an end device` };
        const ip = parseIp(a.ip);
        const mask = parseMask(a.mask);
        const gw = a.gateway ? parseIp(a.gateway) : undefined;
        const dns = a.dns ? parseIp(a.dns) : undefined;
        if (ip === null || mask === null || gw === null || dns === null) return { ok: false, message: `${a.device}: ${a.ip} ${a.mask} isn't a valid address and mask` };
        d.setStatic(ip, mask, gw ?? undefined, dns ?? undefined);
        return { ok: true, message: `${d.hostname} is now ${a.ip} ${a.mask}${a.gateway ? `, gateway ${a.gateway}` : ''}` };
      }
      case 'host_dhcp': {
        const d = findDevice(engine, a.device);
        if (!(d instanceof Host)) return { ok: false, message: `${a.device} isn't an end device` };
        d.useDhcp();
        return { ok: true, message: `${d.hostname} is asking for an address by DHCP` };
      }
    }
  }
}
