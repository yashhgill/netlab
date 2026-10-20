const TYPES = [
  { full: 'FastEthernet', short: 'Fa', trunk: 'Fa', numRe: /^\d+\/\d+(\.\d+)?$/ },
  { full: 'GigabitEthernet', short: 'Gi', trunk: 'Gig', numRe: /^\d+\/\d+(\.\d+)?$/ },
  { full: 'Vlan', short: 'Vlan', trunk: 'Vlan', numRe: /^\d+$/ },
];

function typeFor(prefix: string) {
  const p = prefix.toLowerCase();
  if (!p) return null;
  const m = TYPES.filter((t) => t.full.toLowerCase().startsWith(p));
  return m.length === 1 ? m[0] : null;
}

/** Parse one interface reference starting at tokens[i] ("fa0/1", "Fa 0/1", "vlan 10"). */
export function parseIfaceTokens(tokens: string[], i: number): { name: string; used: number } | null {
  const t = tokens[i];
  if (!t) return null;
  const m = t.match(/^([a-zA-Z]+)([\d/.]*)$/);
  if (!m) return null;
  const type = typeFor(m[1]);
  if (!type) return null;
  let num = m[2];
  let used = 1;
  if (!num && tokens[i + 1] && /^\d/.test(tokens[i + 1])) {
    num = tokens[i + 1];
    used = 2;
  }
  if (!num || !type.numRe.test(num)) return null;
  return { name: type.full + num, used };
}

export function shortIf(name: string, trunkStyle = false): string {
  for (const t of TYPES) if (name.startsWith(t.full)) return (trunkStyle ? t.trunk : t.short) + name.slice(t.full.length);
  return name;
}

/** "fa0/1 - 5, fa0/10, gi0/1-2" -> canonical names */
export function parseRange(text: string): string[] | null {
  const parts = text.replace(/\s*-\s*/g, '-').split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z]+)\s*(\d+)\/(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const type = typeFor(m[1]);
    if (!type || type.full === 'Vlan') return null;
    const lo = +m[3];
    const hi = m[4] ? +m[4] : lo;
    if (hi < lo) return null;
    for (let n = lo; n <= hi; n++) out.push(`${type.full}${m[2]}/${n}`);
  }
  return out.length ? out : null;
}

export function parseVlanList(text: string): number[] | null {
  if (!/^[\d,\-]+$/.test(text)) return null;
  const out: number[] = [];
  for (const part of text.split(',')) {
    if (!part) continue;
    const [a, b] = part.split('-').map(Number);
    const hi = b ?? a;
    if (!(a >= 1 && hi <= 4094 && hi >= a)) return null;
    for (let v = a; v <= hi; v++) out.push(v);
  }
  return out;
}

/** Compress [1,2,3,10] -> "1-3,10" */
export function vlanRanges(list: number[]): string {
  const s = [...new Set(list)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out.join(',');
}
