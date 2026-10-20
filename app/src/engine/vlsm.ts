import { broadcastOf, fmtIp, maskToPrefix, network, parseIp, prefixToMask } from './addr';

export interface VlsmNeed {
  name: string;
  hosts: number;
}

export interface VlsmSubnet {
  name: string;
  hostsNeeded: number;
  network: string;
  prefix: number;
  mask: string;
  firstUsable: string;
  lastUsable: string;
  broadcast: string;
  usableHosts: number;
  /** First usable address, the usual choice for the default gateway. */
  gateway: string;
}

export interface VlsmResult {
  ok: boolean;
  error?: string;
  base: string;
  subnets: VlsmSubnet[];
  /** Addresses left over after allocation, as CIDR blocks. */
  free: string[];
  used: number;
  total: number;
}

/** Smallest prefix with at least `hosts` usable addresses. Never smaller than a /30. */
export function prefixFor(hosts: number): number {
  if (hosts <= 0) return 32;
  for (let p = 30; p >= 0; p--) {
    const usable = 2 ** (32 - p) - 2;
    if (usable >= hosts) return p;
  }
  return 0;
}

export function parseCidr(s: string): { ip: number; prefix: number } | null {
  const m = s.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s*\/\s*(\d{1,2})$/);
  if (!m) return null;
  const ip = parseIp(m[1]);
  const prefix = +m[2];
  if (ip === null || prefix < 0 || prefix > 32) return null;
  return { ip, prefix };
}

/**
 * Variable-length subnet masking: largest requirement first, each block placed
 * at the next boundary that fits. Exact and deterministic.
 */
export function vlsm(base: string, needs: VlsmNeed[]): VlsmResult {
  const c = parseCidr(base);
  const empty = { base, subnets: [], free: [], used: 0, total: 0 };
  if (!c) return { ok: false, error: `"${base}" is not a network in CIDR form, like 192.168.1.0/24.`, ...empty };
  const mask = prefixToMask(c.prefix);
  const start = network(c.ip, mask);
  const end = broadcastOf(c.ip, mask);
  const total = end - start + 1;
  const order = needs.map((n, i) => ({ ...n, i, p: prefixFor(n.hosts) })).sort((a, b) => a.p - b.p || a.i - b.i);
  let cursor = start;
  const placed: (VlsmSubnet & { i: number; netNum: number; size: number })[] = [];
  for (const n of order) {
    const size = 2 ** (32 - n.p);
    const aligned = Math.ceil((cursor - start) / size) * size + start;
    if (aligned + size - 1 > end) {
      return {
        ok: false,
        error: `${fmtIp(start)}/${c.prefix} is too small. It ran out of space at "${n.name}" (${n.hosts} hosts needs a /${n.p}).`,
        base: `${fmtIp(start)}/${c.prefix}`,
        subnets: placed.map(({ i: _i, netNum: _n, size: _s, ...rest }) => rest),
        free: [],
        used: cursor - start,
        total,
      };
    }
    const m = prefixToMask(n.p);
    placed.push({
      i: n.i,
      netNum: aligned,
      size,
      name: n.name,
      hostsNeeded: n.hosts,
      network: fmtIp(aligned),
      prefix: n.p,
      mask: fmtIp(m),
      firstUsable: fmtIp(aligned + 1),
      lastUsable: fmtIp(aligned + size - 2),
      broadcast: fmtIp(aligned + size - 1),
      usableHosts: size - 2,
      gateway: fmtIp(aligned + 1),
    });
    cursor = aligned + size;
  }
  // leftover space as aligned CIDR blocks
  const free: string[] = [];
  let f = cursor;
  while (f <= end) {
    let p = 32;
    while (p > c.prefix) {
      const size = 2 ** (32 - (p - 1));
      if ((f - start) % size !== 0 || f + size - 1 > end) break;
      p--;
    }
    free.push(`${fmtIp(f)}/${p}`);
    f += 2 ** (32 - p);
    if (free.length > 16) break;
  }
  return {
    ok: true,
    base: `${fmtIp(start)}/${c.prefix}`,
    subnets: placed.map(({ i: _i, netNum: _n, size: _s, ...rest }) => rest),
    free,
    used: cursor - start,
    total,
  };
}

/** Facts about one address/prefix, for "what network is 10.1.5.77/27 in?" questions. */
export function subnetInfo(cidr: string) {
  const c = parseCidr(cidr);
  if (!c) return { ok: false, error: `"${cidr}" is not in CIDR form, like 10.1.5.77/27.` };
  const m = prefixToMask(c.prefix);
  const net = network(c.ip, m);
  const bc = broadcastOf(c.ip, m);
  const size = bc - net + 1;
  return {
    ok: true,
    address: fmtIp(c.ip),
    network: `${fmtIp(net)}/${c.prefix}`,
    mask: fmtIp(m),
    wildcard: fmtIp(~m >>> 0),
    broadcast: fmtIp(bc),
    firstUsable: c.prefix >= 31 ? fmtIp(net) : fmtIp(net + 1),
    lastUsable: c.prefix >= 31 ? fmtIp(bc) : fmtIp(bc - 1),
    usableHosts: c.prefix >= 31 ? size : size - 2,
    prefix: c.prefix,
    maskPrefix: maskToPrefix(m),
  };
}
