/**
 * A small, forgiving XML reader. Packet Tracer files can contain control
 * characters (for example in banners) that strict parsers reject, so this one
 * reads elements, attributes and text and keeps going.
 */
export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      const tag = body.slice(1).trim();
      // pop to the matching element (tolerates stray tags)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const m = inner.match(/^\s*([^\s/>]+)/);
    if (!m) continue;
    const node: XNode = { tag: m[1], attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const rest = inner.slice(m[0].length);
    while ((a = re.exec(rest))) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** First child with this tag. A path "A/B/C" walks down. */
export function child(n: XNode | undefined, path: string): XNode | undefined {
  let cur = n;
  for (const part of path.split('/')) {
    if (!cur) return undefined;
    cur = cur.children.find((c) => c.tag === part);
  }
  return cur;
}

export function children(n: XNode | undefined, tag: string): XNode[] {
  return n ? n.children.filter((c) => c.tag === tag) : [];
}

export function textOf(n: XNode | undefined, path?: string): string {
  const t = path ? child(n, path) : n;
  return t ? t.text.trim() : '';
}

/** Depth-first search for every descendant with this tag. */
export function findAll(n: XNode | undefined, tag: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const c of n.children) {
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

export function findFirst(n: XNode | undefined, tag: string): XNode | undefined {
  if (!n) return undefined;
  for (const c of n.children) {
    if (c.tag === tag) return c;
    const f = findFirst(c, tag);
    if (f) return f;
  }
  return undefined;
}
