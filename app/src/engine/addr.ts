// IPv4 + MAC address helpers. IPs are stored as unsigned 32-bit numbers.

export function parseIp(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function fmtIp(n: number | undefined | null): string {
  if (n === undefined || n === null) return 'unassigned';
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isValidMask(n: number): boolean {
  // contiguous ones followed by zeros
  const inv = (~n) >>> 0;
  return ((inv + 1) & inv) === 0;
}

export function parseMask(s: string): number | null {
  const n = parseIp(s);
  if (n === null || !isValidMask(n)) return null;
  return n;
}

export function maskToPrefix(m: number): number {
  let c = 0;
  for (let i = 31; i >= 0; i--) if ((m >>> i) & 1) c++;
  return c;
}

export function prefixToMask(p: number): number {
  return p === 0 ? 0 : ((0xffffffff << (32 - p)) >>> 0);
}

export function network(ip: number, mask: number): number {
  return (ip & mask) >>> 0;
}

export function broadcastOf(ip: number, mask: number): number {
  return ((ip & mask) | (~mask >>> 0)) >>> 0;
}

export function sameSubnet(a: number, b: number, mask: number): boolean {
  return network(a, mask) === network(b, mask);
}

export const BCAST_IP = 0xffffffff;
export const BCAST_MAC = 'ffffffffffff';

let macCounter = Math.floor(Math.random() * 0xffff);
export function newMac(): string {
  // locally-administered OUI prefix 02:4e:4c ("NL")
  macCounter = (macCounter + 1 + Math.floor(Math.random() * 7)) & 0xffffff;
  return '024e4c' + macCounter.toString(16).padStart(6, '0');
}

/** Dotted Cisco-style MAC: 024e.4c12.3456 */
export function fmtMacDot(m: string): string {
  return `${m.slice(0, 4)}.${m.slice(4, 8)}.${m.slice(8, 12)}`;
}

/** Windows style: 02-4E-4C-12-34-56 */
export function fmtMacDash(m: string): string {
  return m.toUpperCase().match(/../g)!.join('-');
}

export function fmtMacColon(m: string): string {
  return m.toUpperCase().match(/../g)!.join(':');
}

export function classfulMask(ip: number): number {
  const first = ip >>> 24;
  if (first < 128) return 0xff000000;
  if (first < 192) return 0xffff0000 >>> 0;
  return 0xffffff00 >>> 0;
}
