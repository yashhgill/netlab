/**
 * Packet Tracer (.pkt / .pka) import.
 *
 * Reads the network out of a Packet Tracer file and rebuilds it with the
 * closest NetLab models: devices, positions, cables, router and switch
 * running-configs, host addressing, server DHCP pools, wireless SSIDs and
 * notes. Anything NetLab doesn't simulate yet is listed in `warnings`.
 */
import { parseIp } from '../engine/addr';
import { Engine, mediaOf, type CableType, type Device, type DeviceKind, type Iface } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { AccessPoint } from '../engine/devices/hub';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { DEFAULT_MODEL, modelForPt } from '../engine/models';
import { createDevice, serialize, type Note, type SavedFile } from '../engine/topology';
import { applyConfig, saveStartup } from '../cli/ios';
import { decodePkt } from './pkt-crypto';
import { child, children, findAll, findFirst, parseXml, textOf, type XNode } from './xml';

export interface PtImport {
  file: SavedFile;
  version: string;
  devices: number;
  links: number;
  warnings: string[];
}

const KIND: Record<string, DeviceKind> = {
  Router: 'router',
  Switch: 'switch',
  MultiLayerSwitch: 'l3switch',
  Hub: 'hub',
  Repeater: 'hub',
  AccessPoint: 'ap',
  Pc: 'pc',
  Laptop: 'laptop',
  Server: 'server',
  Printer: 'printer',
  IpPhone: 'phone',
  TabletPC: 'tablet',
  Pda: 'smartphone',
  SmartPhone: 'smartphone',
  TV: 'tv',
};

/** Distance scale from Packet Tracer's logical workspace to NetLab's. */
const SCALE = 1.6;

const TYPE7_KEY = 'dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87';

/** Reverse a "type 7" password (a well-known, reversible obfuscation). */
export function decodeType7(s: string): string | null {
  if (!/^\d{2}([0-9A-Fa-f]{2})+$/.test(s)) return null;
  const seed = parseInt(s.slice(0, 2), 10);
  let out = '';
  for (let i = 2, k = 0; i < s.length; i += 2, k++) {
    out += String.fromCharCode(parseInt(s.slice(i, i + 2), 16) ^ TYPE7_KEY.charCodeAt((seed + k) % TYPE7_KEY.length));
  }
  return out;
}

/**
 * Turn a saved IOS running-config into lines NetLab can replay:
 * - interfaces listed without "shutdown" are up, so add "no shutdown";
 * - type 7 passwords are decoded; hashed enable secrets can't be, so they are dropped.
 */
export function prepareConfig(raw: string[], warn: (w: string) => void, host: string): string[] {
  const out: string[] = [];
  const lines = raw.map((l) => l.replace(/\r/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '#'));
  for (let k = 0; k < lines.length; k++) {
    let l = lines[k];
    const t = l.trim();
    let m = t.match(/^(enable password|password) 7 (\S+)$/);
    if (m) {
      const pw = decodeType7(m[2]);
      if (pw !== null) l = l.replace(`7 ${m[2]}`, pw);
    }
    m = t.match(/^(enable secret|username \S+ secret) (4|5|8|9) /);
    if (m) {
      warn(`${host}: "${m[1]}" was stored as a one-way hash, so it was left out. Set it again if the lab needs it.`);
      continue;
    }
    out.push(l);
    if (/^interface\s+\S+/i.test(t)) {
      let shut = false;
      for (let j = k + 1; j < lines.length && /^\s/.test(lines[j]); j++) if (lines[j].trim() === 'shutdown') shut = true;
      if (!shut) out.push(' no shutdown');
    }
  }
  return out;
}

function ptDevices(net: XNode): XNode[] {
  return children(child(net, 'DEVICES'), 'DEVICE');
}

/** The network the student sees when the file opens. */
function pickNetwork(root: XNode): XNode | null {
  const top = root.children.find((c) => c.tag.startsWith('PACKETTRACER'));
  if (!top) return null;
  if (top.tag === 'PACKETTRACER5') return child(top, 'NETWORK') ?? null;
  // activity file: several networks; the first one with devices is the working copy
  for (const pt of children(top, 'PACKETTRACER5')) {
    const net = child(pt, 'NETWORK');
    if (net && ptDevices(net).length) return net;
  }
  return findFirst(top, 'NETWORK') ?? null;
}

const DATA_PORT = /^e(Copper|Fiber|HostWireless|AccessPointWireless|Wireless|Serial|Modem)/;

function portElems(engineEl: XNode): XNode[] {
  return findAll(child(engineEl, 'MODULE'), 'PORT').filter((p) => DATA_PORT.test(textOf(p, 'TYPE')));
}

const ip = (s: string) => (s && s !== '0.0.0.0' ? (parseIp(s) ?? undefined) : undefined);

export function importPacketTracer(bytes: Uint8Array, opts: { now?: number } = {}): PtImport {
  const xml = decodePkt(bytes);
  const root = parseXml(xml);
  const top = root.children.find((c) => c.tag.startsWith('PACKETTRACER'));
  const version = textOf(top, 'VERSION') || textOf(findFirst(top, 'PACKETTRACER5'), 'VERSION');
  const net = pickNetwork(root);
  if (!net) throw new Error('No network was found in this Packet Tracer file.');

  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const e = new Engine();
  e.now = opts.now ?? 0;
  const byRef = new Map<string, Device>();
  const configs: { dev: Router | Switch; run: string[]; start: string[] }[] = [];
  const skipped = new Map<string, number>();

  const els = ptDevices(net);
  let minX = Infinity;
  let minY = Infinity;
  for (const d of els) {
    const lg = child(d, 'WORKSPACE/LOGICAL');
    minX = Math.min(minX, Number(textOf(lg, 'X')) || 0);
    minY = Math.min(minY, Number(textOf(lg, 'Y')) || 0);
  }
  const place = (x: number, y: number) => ({ x: Math.round((x - minX) * SCALE + 120), y: Math.round((y - minY) * SCALE + 100) });

  els.forEach((d, index) => {
    const eng = child(d, 'ENGINE');
    const typeEl = child(eng, 'TYPE');
    const typeName = textOf(typeEl);
    const ptModel = typeEl?.attrs.model ?? '';
    const kind = KIND[typeName];
    const ref = textOf(eng, 'SAVE_REF_ID') || String(index);
    if (!kind) {
      if (typeName === 'Power Distribution Device') return; // physical-view furniture
      skipped.set(ptModel || typeName, (skipped.get(ptModel || typeName) ?? 0) + 1);
      return;
    }
    const lg = child(d, 'WORKSPACE/LOGICAL');
    const p = place(Number(textOf(lg, 'X')) || 0, Number(textOf(lg, 'Y')) || 0);
    const ports = portElems(eng!);
    let model = modelForPt(ptModel)?.id;
    if (typeName === 'Repeater') model = 'NL-REP';
    const wireless = ports.some((pe) => /^eHostWireless/.test(textOf(pe, 'TYPE')));
    if ((kind === 'pc' || kind === 'laptop') && wireless && !ports.some((pe) => /^eCopper/.test(textOf(pe, 'TYPE')))) model = kind === 'pc' ? 'NL-PC-W' : 'NL-Laptop-W';
    if (!model) {
      model = DEFAULT_MODEL[kind];
      warn(`${ptModel} isn't a NetLab model yet, so it was replaced with the closest one (${model}). Check its ports.`);
    }
    const dev = createDevice(e, kind, p.x, p.y, model);
    const name = textOf(eng, 'NAME');
    if (name) dev.hostname = name;
    if (textOf(eng, 'POWER') === 'false') dev.powered = false;
    byRef.set(ref, dev);

    if (dev instanceof Router || dev instanceof Switch) {
      configs.push({
        dev,
        run: children(child(eng, 'RUNNINGCONFIG'), 'LINE').map((l) => l.text),
        start: children(child(eng, 'STARTUPCONFIG'), 'LINE').map((l) => l.text),
      });
    } else if (dev instanceof Host) {
      const pe = ports.find((x) => textOf(x, 'IP')) ?? ports[0];
      if (pe) {
        const dhcp = textOf(pe, 'PORT_DHCP_ENABLE') === 'true';
        if (dhcp) dev.ipMode = 'dhcp';
        else {
          const gw = ip(textOf(eng, 'GATEWAY')) ?? ip(textOf(pe, 'PORT_GATEWAY'));
          const dns = ip(textOf(eng, 'DNS_CLIENT/SERVER_IP')) ?? ip(textOf(pe, 'PORT_DNS'));
          dev.setStatic(ip(textOf(pe, 'IP')), ip(textOf(pe, 'SUBNET')), gw, dns);
        }
        const mac = textOf(pe, 'MACADDRESS').replace(/\./g, '').toLowerCase();
        if (/^[0-9a-f]{12}$/.test(mac)) dev.nic.mac = mac;
        if (dev.wifi) {
          const ssid = textOf(findFirst(pe, 'SSID'));
          const key = textOf(findFirst(pe, 'KEY'));
          const auth = Number(textOf(findFirst(pe, 'AUTHEN_TYPE')) || 0);
          dev.wifi = { ssid: ssid || 'Default', key: auth && key ? key : undefined };
        }
      }
      if (dev.dhcpServer) {
        const srv = findFirst(eng, 'DHCP_SERVER');
        const pool = findFirst(srv, 'POOL');
        if (srv && pool) {
          dev.dhcpServer.enabled = textOf(srv, 'ENABLED') === '1';
          dev.updateServerPool({
            name: textOf(pool, 'NAME') || 'serverPool',
            router: ip(textOf(pool, 'DEFAULT_ROUTER')),
            dns: ip(textOf(pool, 'DNS_SERVER')),
            start: ip(textOf(pool, 'START_IP')),
            mask: ip(textOf(pool, 'MASK')),
            max: Number(textOf(pool, 'MAX_USERS')) || undefined,
          });
        }
      }
    } else if (dev instanceof AccessPoint) {
      const radio = ports.find((x) => /Wireless/.test(textOf(x, 'TYPE')));
      const ssid = textOf(findFirst(radio, 'SSID'));
      const key = textOf(findFirst(radio, 'KEY'));
      const auth = Number(textOf(findFirst(radio, 'AUTHEN_TYPE')) || 0);
      dev.wifi = { ssid: ssid || 'Default', key: auth && key ? key : undefined };
    }
  });

  const linkEls = children(child(net, 'LINKS'), 'LINK');

  // ---------------- ports from installed modules
  // Lab files often add interface modules (an extra serial card, a Gigabit slot on a
  // generic router). Add any port a cable or the config refers to that the model lacks.
  const IFNAME = /^(FastEthernet|GigabitEthernet|Serial)\d+(\/\d+){1,2}$/;
  const need = (dev: Device | undefined, name: string, media: Iface['media']) => {
    if (!(dev instanceof Router || dev instanceof Switch) || !IFNAME.test(name) || dev.port(name)) return;
    const m = name.startsWith('Serial') ? 'serial' : media === 'serial' ? 'copper' : media;
    dev.addPort(name, m === 'serial' ? 1544 : name.startsWith('Gigabit') ? 1000 : 100, m);
  };
  for (const l of linkEls) {
    const cab = child(l, 'CABLE');
    const t = textOf(l, 'TYPE');
    const media: Iface['media'] = t === 'eSerial' ? 'serial' : t === 'eFiber' ? 'fiber' : 'copper';
    const [pa, pb] = children(cab, 'PORT').map((p) => p.text.trim());
    if (pa) need(byRef.get(textOf(cab, 'FROM')), pa, media);
    if (pb) need(byRef.get(textOf(cab, 'TO')), pb, media);
  }
  for (const c of configs) {
    for (const line of [...c.run, ...c.start]) {
      const m = line.match(/^interface\s+(\S+)\s*$/);
      if (m) need(c.dev, m[1], 'copper');
    }
  }

  // ---------------- IOS configuration
  for (const { dev, run, start } of configs) {
    if (start.length) {
      applyConfig(dev, prepareConfig(start, warn, dev.hostname));
      saveStartup(dev);
    }
    if (run.length) applyConfig(dev, prepareConfig(run, warn, dev.hostname));
  }

  // ---------------- cables
  let made = 0;
  const resolve = (dev: Device, name: string, want: CableType): Iface | undefined => {
    const exact = dev.port(name) ?? dev.port(name.replace(/\s+/g, ''));
    if (exact && !exact.linkId) {
      // the lab may have swapped the module in that slot (copper vs SFP): follow the file
      const m = mediaOf(exact);
      if ((want === 'fiber' && m === 'copper') || ((want === 'straight' || want === 'cross' || want === 'auto') && m === 'fiber')) exact.media = want === 'fiber' ? 'fiber' : 'copper';
      return exact;
    }
    const media =
      want === 'console' ? ['console', 'rs232'] : want === 'fiber' ? ['fiber'] : want.startsWith('serial') ? ['serial'] : want === 'wireless' ? ['wireless'] : ['copper', 'fiber'];
    return dev.allPorts().find((p) => !p.linkId && media.includes(mediaOf(p)));
  };
  for (const l of linkEls) {
    const cab = child(l, 'CABLE');
    const kindTxt = textOf(l, 'TYPE');
    const cTxt = textOf(cab, 'TYPE');
    const [pa, pb] = children(cab, 'PORT').map((p) => p.text.trim());
    const da = byRef.get(textOf(cab, 'FROM'));
    const db = byRef.get(textOf(cab, 'TO'));
    if (!da || !db || !pa || !pb) continue;
    let cable: CableType =
      kindTxt === 'eSerial'
        ? 'serial-dce'
        : kindTxt === 'eFiber'
          ? 'fiber'
          : cTxt === 'eRollOver'
            ? 'console'
            : cTxt === 'eCrossOver'
              ? 'cross'
              : cTxt === 'eStraightThrough'
                ? 'straight'
                : 'auto';
    if (kindTxt !== 'eCopper' && kindTxt !== 'eSerial' && kindTxt !== 'eFiber' && cTxt !== 'eRollOver') {
      warn(`A ${kindTxt.replace(/^e/, '').toLowerCase()} connection was skipped; NetLab doesn't have that cable yet.`);
      continue;
    }
    let ia = resolve(da, pa, cable);
    let ib = resolve(db, pb, cable);
    let A = da;
    let B = db;
    if (cable === 'serial-dce') {
      // put the DCE end first
      const dceDev = byRef.get(textOf(cab, 'DCEDEV'));
      if (dceDev === db) {
        [A, B, ia, ib] = [db, da, ib, ia];
      }
    }
    if (!ia || !ib) {
      warn(`The cable ${da.hostname} ${pa} – ${db.hostname} ${pb} couldn't be placed: no matching free port.`);
      continue;
    }
    const moved = (d: Device, want: string, got: Iface) => !(d instanceof Host) && got.name !== want && got.name !== want.replace(/\s+/g, '') && warn(`${d.hostname}: ${want} became ${got.name}.`);
    moved(A, A === da ? pa : pb, ia);
    moved(B, B === db ? pb : pa, ib);
    let r = e.connect({ dev: A.id, iface: ia.name }, { dev: B.id, iface: ib.name }, cable);
    if (typeof r === 'string' && cable !== 'auto') {
      cable = 'auto';
      r = e.connect({ dev: A.id, iface: ia.name }, { dev: B.id, iface: ib.name }, 'auto');
    }
    if (typeof r === 'string') warn(`The cable ${da.hostname} ${pa} – ${db.hostname} ${pb} was skipped: ${r}`);
    else made++;
  }

  // ---------------- notes
  const notes: Note[] = [];
  for (const nn of findAll(net, 'NOTE')) {
    const text = textOf(nn, 'TEXT');
    if (!text) continue;
    const p = place(Number(textOf(nn, 'X')) || 0, Number(textOf(nn, 'Y')) || 0);
    notes.push({ id: `n${notes.length + 1}`, x: p.x, y: p.y, text });
  }

  for (const [m, count] of skipped) warn(`${count} × ${m} skipped: NetLab doesn't simulate this device yet.`);

  e.refreshAll();
  return { file: serialize(e, notes), version, devices: byRef.size, links: made, warnings };
}
