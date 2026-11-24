/**
 * OSPF (single process per router, any number of areas treated as one backbone).
 *
 * Instead of simulating hello/LSA packets, the link-state result is computed from the
 * routers' configuration and line states, the way the protocol converges: routers become
 * neighbours when OSPF-enabled, non-passive interfaces share a subnet (and area), each
 * router runs shortest-path-first over the cost graph, and every network that another
 * router advertises is installed as an "O" route with administrative distance 110.
 * Adjacencies form a few seconds after both ends come up, like a real hello exchange.
 */
import { fmtIp, maskToPrefix, network } from './addr';
import type { Engine, Iface } from './engine';
import type { Route } from './ipstack';

export interface OspfNetwork {
  net: number;
  wildcard: number;
  area: number;
}

export interface OspfConfig {
  pid: number;
  routerId?: number;
  networks: OspfNetwork[];
  passive: string[];
  passiveDefault?: boolean;
  defaultOriginate?: boolean;
  referenceBandwidth?: number; // Mbit/s
}

/** A router that can run OSPF. */
export interface OspfRouter {
  id: string;
  hostname: string;
  powered: boolean;
  ospf?: OspfConfig;
  ifaces: Map<string, Iface>;
  lineUp(name: string): boolean;
  stack: { staticRoutes: { net: number; mask: number }[] };
}

export interface OspfIf {
  name: string;
  ip: number;
  mask: number;
  area: number;
  cost: number;
  passive: boolean;
}

export interface OspfNeighbor {
  routerId: number;
  ip: number;
  ifName: string;
  state: string; // FULL/DR, FULL/BDR, FULL/DROTHER, FULL/-
  device: string;
}

export interface OspfResult {
  routes: Route[];
  neighbors: OspfNeighbor[];
  routerId: number;
  ifs: OspfIf[];
}

/** How long a new adjacency takes to reach FULL (hello + database exchange). */
export const OSPF_CONVERGE_MS = 5000;

const matches = (ip: number, n: OspfNetwork) => (ip & ~n.wildcard) >>> 0 === (n.net & ~n.wildcard) >>> 0;

/** Interface cost: reference bandwidth (default 100 Mbit/s) divided by the interface speed. */
export function ifCost(i: Iface, refMbps = 100): number {
  if (i.ospfCost) return i.ospfCost;
  const kbps = i.media === 'serial' ? (i.bandwidth ?? 1544) : (i.bandwidth ?? i.speed * 1000);
  return Math.max(1, Math.floor((refMbps * 1000) / kbps));
}

export function ospfIfs(r: OspfRouter): OspfIf[] {
  const c = r.ospf;
  if (!c || !r.powered) return [];
  const out: OspfIf[] = [];
  for (const i of r.ifaces.values()) {
    if (i.ip === undefined || i.mask === undefined || !r.lineUp(i.name)) continue;
    const n = c.networks.find((x) => matches(i.ip!, x));
    if (!n) continue;
    const passive = c.passive.includes(i.name) !== !!c.passiveDefault || /^loopback/i.test(i.name);
    out.push({ name: i.name, ip: i.ip, mask: i.mask, area: n.area, cost: /^loopback/i.test(i.name) ? 1 : ifCost(i, c.referenceBandwidth), passive });
  }
  return out;
}

export function routerId(r: OspfRouter): number {
  if (r.ospf?.routerId !== undefined) return r.ospf.routerId;
  const ips = [...r.ifaces.values()].filter((i) => i.ip !== undefined && r.lineUp(i.name));
  const loops = ips.filter((i) => /^loopback/i.test(i.name));
  const pool = loops.length ? loops : ips;
  return pool.reduce((m, i) => Math.max(m, i.ip! >>> 0), 0) >>> 0;
}

interface Node {
  r: OspfRouter;
  rid: number;
  ifs: OspfIf[];
}

interface Cache {
  key: string;
  result: Map<string, OspfResult>;
  upSince: Map<string, number>;
}

const caches = new WeakMap<Engine, Cache>();

function fingerprint(nodes: Node[]): string {
  return nodes.map((n) => `${n.r.id}:${n.rid}:${n.r.ospf?.defaultOriginate ? 1 : 0}:${n.ifs.map((i) => `${i.name}/${i.ip}/${i.mask}/${i.area}/${i.cost}/${i.passive ? 1 : 0}`).join(',')}`).join(';');
}

/** OSPF state of one router (routes, neighbours), recomputed when anything relevant changes. */
export function ospfFor(engine: Engine, deviceId: string): OspfResult | undefined {
  const routers = [...engine.devices.values()].filter((d) => (d as unknown as OspfRouter).ospf) as unknown as OspfRouter[];
  if (!routers.length) return undefined;
  const nodes: Node[] = routers.map((r) => ({ r, rid: routerId(r), ifs: ospfIfs(r) }));
  const key = fingerprint(nodes);
  let cache = caches.get(engine);
  if (!cache) caches.set(engine, (cache = { key: '', result: new Map(), upSince: new Map() }));
  const now = engine.now;
  // links between OSPF interfaces: [nodeA, ifA, nodeB, ifB]
  const adj: { a: Node; ai: OspfIf; b: Node; bi: OspfIf; key: string }[] = [];
  for (let x = 0; x < nodes.length; x++)
    for (let y = x + 1; y < nodes.length; y++)
      for (const ai of nodes[x].ifs)
        for (const bi of nodes[y].ifs) {
          if (ai.passive || bi.passive || ai.area !== bi.area || ai.mask !== bi.mask) continue;
          if (network(ai.ip, ai.mask) !== network(bi.ip, bi.mask)) continue;
          adj.push({ a: nodes[x], ai, b: nodes[y], bi, key: `${nodes[x].r.id}/${ai.name}-${nodes[y].r.id}/${bi.name}` });
        }
  // adjacencies take a few seconds to reach FULL
  const live = new Set(adj.map((e) => e.key));
  for (const k of [...cache.upSince.keys()]) if (!live.has(k)) cache.upSince.delete(k);
  let pending = false;
  for (const e of adj) {
    if (!cache.upSince.has(e.key)) cache.upSince.set(e.key, now);
    if (now - cache.upSince.get(e.key)! < OSPF_CONVERGE_MS) pending = true;
  }
  const full = adj.filter((e) => now - cache.upSince.get(e.key)! >= OSPF_CONVERGE_MS);
  const stateKey = `${key}|${full.map((e) => e.key).join(',')}`;
  if (cache.key === stateKey && !pending) return cache.result.get(deviceId);
  if (cache.key === stateKey) return cache.result.get(deviceId);

  // DR election per broadcast segment (highest router ID wins; point-to-point links have none)
  const segRole = new Map<string, Map<string, string>>(); // segment -> router id -> role
  const segments = new Map<string, { n: Node; i: OspfIf }[]>();
  for (const n of nodes)
    for (const i of n.ifs) {
      if (i.passive) continue;
      const k = `${network(i.ip, i.mask)}/${i.mask}`;
      (segments.get(k) ?? segments.set(k, []).get(k)!).push({ n, i });
    }
  for (const [k, members] of segments) {
    const p2p = members.length === 2 && members.every((m) => m.n.r.ifaces.get(m.i.name)?.media === 'serial');
    const sorted = [...members].sort((a, b) => b.n.rid - a.n.rid);
    const roles = new Map<string, string>();
    sorted.forEach((m, idx) => roles.set(m.n.r.id, p2p ? '-' : idx === 0 ? 'DR' : idx === 1 ? 'BDR' : 'DROTHER'));
    segRole.set(k, roles);
  }

  const result = new Map<string, OspfResult>();
  for (const src of nodes) {
    const neighbors: OspfNeighbor[] = [];
    for (const e of full) {
      const [me, mine, them, theirs] = e.a === src ? [e.a, e.ai, e.b, e.bi] : e.b === src ? [e.b, e.bi, e.a, e.ai] : [null, null, null, null];
      if (!me || !mine || !them || !theirs) continue;
      const role = segRole.get(`${network(theirs.ip, theirs.mask)}/${theirs.mask}`)?.get(them.r.id) ?? '-';
      neighbors.push({ routerId: them.rid, ip: theirs.ip, ifName: mine.name, state: `FULL/${role === '-' ? '-' : role}`, device: them.r.hostname });
    }
    // shortest path first
    const dist = new Map<Node, number>([[src, 0]]);
    const first = new Map<Node, { ifName: string; nh: number }>();
    const done = new Set<Node>();
    for (;;) {
      let u: Node | undefined;
      for (const [n, d] of dist) if (!done.has(n) && (u === undefined || d < dist.get(u)!)) u = n;
      if (!u) break;
      done.add(u);
      for (const e of full) {
        const [from, fi, to, ti] = e.a === u ? [e.a, e.ai, e.b, e.bi] : e.b === u ? [e.b, e.bi, e.a, e.ai] : [null, null, null, null];
        if (!from || !fi || !to || !ti) continue;
        const nd = dist.get(u)! + fi.cost;
        if (dist.has(to) && dist.get(to)! <= nd) continue;
        dist.set(to, nd);
        first.set(to, u === src ? { ifName: fi.name, nh: ti.ip } : first.get(u)!);
      }
    }
    const connected = new Set(src.ifs.map((i) => `${network(i.ip, i.mask)}/${i.mask}`));
    for (const i of src.r.ifaces.values()) if (i.ip !== undefined && i.mask !== undefined && src.r.lineUp(i.name)) connected.add(`${network(i.ip, i.mask)}/${i.mask}`);
    const best = new Map<string, Route>();
    for (const [n, d] of dist) {
      if (n === src) continue;
      const via = first.get(n)!;
      for (const i of n.ifs) {
        const net = network(i.ip, i.mask);
        const k = `${net}/${i.mask}`;
        if (connected.has(k)) continue;
        const metric = d + i.cost;
        const cur = best.get(k);
        if (!cur || metric < cur.metric) best.set(k, { code: 'O', net, mask: i.mask, nextHop: via.nh, ifName: via.ifName, ad: 110, metric });
      }
      if (n.r.ospf?.defaultOriginate && n.r.stack.staticRoutes.some((s) => s.net === 0 && s.mask === 0)) {
        const cur = best.get('0/0');
        const metric = d + 1;
        if (!cur || metric < cur.metric) best.set('0/0', { code: 'O*E2', net: 0, mask: 0, nextHop: via.nh, ifName: via.ifName, ad: 110, metric: 1 });
      }
    }
    result.set(src.r.id, { routes: [...best.values()], neighbors, routerId: src.rid, ifs: src.ifs });
  }
  cache.key = stateKey;
  cache.result = result;
  return result.get(deviceId);
}

/** Lines for the running configuration. */
export function ospfConfigLines(c: OspfConfig): string[] {
  const L = [`router ospf ${c.pid}`];
  if (c.routerId !== undefined) L.push(` router-id ${fmtIp(c.routerId)}`);
  L.push(' log-adjacency-changes');
  if (c.referenceBandwidth) L.push(` auto-cost reference-bandwidth ${c.referenceBandwidth}`);
  if (c.passiveDefault) L.push(' passive-interface default');
  for (const p of c.passive) L.push(`${c.passiveDefault ? ' no' : ''} passive-interface ${p}`);
  for (const n of c.networks) L.push(` network ${fmtIp(n.net)} ${fmtIp(n.wildcard)} area ${n.area}`);
  if (c.defaultOriginate) L.push(' default-information originate');
  L.push('!');
  return L;
}

export function showIpOspfNeighbor(res: OspfResult | undefined): string {
  let out = '\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n';
  for (const n of res?.neighbors ?? []) {
    out += `${fmtIp(n.routerId).padEnd(16)}${'1'.padEnd(6)}${n.state.padEnd(16)}00:00:3${Math.floor(Math.random() * 10)}    ${fmtIp(n.ip).padEnd(16)}${n.ifName}\n`;
  }
  return out;
}

export function showIpProtocols(c: OspfConfig | undefined, res: OspfResult | undefined): string {
  if (!c) return '';
  let out = `\nRouting Protocol is "ospf ${c.pid}"\n  Outgoing update filter list for all interfaces is not set\n  Incoming update filter list for all interfaces is not set\n  Router ID ${fmtIp(res?.routerId ?? 0)}\n  Number of areas in this router is 1. 1 normal 0 stub 0 nssa\n  Maximum path: 4\n  Routing for Networks:\n`;
  for (const n of c.networks) out += `    ${fmtIp(n.net)} ${fmtIp(n.wildcard)} area ${n.area}\n`;
  const passive = (res?.ifs ?? []).filter((i) => i.passive);
  if (passive.length) out += `  Passive Interface(s):\n${passive.map((i) => `    ${i.name}\n`).join('')}`;
  out += '  Routing Information Sources:\n    Gateway         Distance      Last Update\n';
  for (const n of res?.neighbors ?? []) out += `    ${fmtIp(n.routerId).padEnd(16)}110           00:00:10\n`;
  out += '  Distance: (default is 110)\n';
  return out;
}

export function showIpOspfInterfaceBrief(res: OspfResult | undefined, pid: number): string {
  let out = 'Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C\n';
  for (const i of res?.ifs ?? []) {
    const nbrs = (res?.neighbors ?? []).filter((n) => n.ifName === i.name).length;
    out += `${i.name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Serial', 'Se').padEnd(13)}${String(pid).padEnd(6)}${String(i.area).padEnd(16)}${`${fmtIp(i.ip)}/${maskToPrefix(i.mask)}`.padEnd(19)}${String(i.cost).padEnd(6)}${(i.passive ? 'DOWN' : 'UP').padEnd(6)}${nbrs}/${nbrs}\n`;
  }
  return out;
}
