import { parseIp } from '../engine/addr';
import { parseIfaceTokens, parseVlanList } from './ifnames';

export type ParamKind = 'ip' | 'num' | 'iface' | 'vlanlist' | 'word' | 'line';

export interface Tok {
  kw?: string;
  p?: ParamKind;
  name?: string;
  lo?: number;
  hi?: number;
  help?: string;
}

export type Args = Record<string, any>;

export interface Cmd<S> {
  toks: Tok[];
  run: (s: S, a: Args) => void;
  when?: (s: S) => boolean;
}

interface Node<S> {
  tok?: Tok;
  children: Node<S>[];
  cmds: Cmd<S>[];
}

const PARAM_ORDER: ParamKind[] = ['ip', 'num', 'iface', 'vlanlist', 'word', 'line'];

const PARAM_LABEL: Record<ParamKind, string> = {
  ip: 'A.B.C.D',
  num: '<1-4094>',
  iface: 'WORD',
  vlanlist: 'WORD',
  word: 'WORD',
  line: 'LINE',
};

export interface Token {
  text: string;
  start: number;
}

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], start: m.index });
  return out;
}

/**
 * Pattern syntax: keywords are plain words; params are {kind:name} or {num:name:lo-hi}.
 * Example: "ip address {ip:addr} {ip:mask}"
 */
export function compile(pattern: string, help: Record<string, string>, paramHelp: Record<string, string> = {}): Tok[] {
  return pattern.split(/\s+/).map((w) => {
    const m = w.match(/^\{(\w+):(\w+)(?::(\d+)-(\d+))?\}$/);
    if (m) {
      return {
        p: m[1] as ParamKind,
        name: m[2],
        lo: m[3] ? +m[3] : undefined,
        hi: m[4] ? +m[4] : undefined,
        help: paramHelp[m[2]],
      };
    }
    return { kw: w, help: help[w] ?? '' };
  });
}

export class CommandTree<S> {
  root: Node<S> = { children: [], cmds: [] };

  add(toks: Tok[], run: Cmd<S>['run'], when?: Cmd<S>['when']) {
    const cmd: Cmd<S> = { toks, run, when };
    let node = this.root;
    for (const t of toks) {
      let next = node.children.find((c) => sameTok(c.tok!, t));
      if (!next) {
        next = { tok: t, children: [], cmds: [] };
        node.children.push(next);
      } else if (!next.tok!.help && t.help) next.tok!.help = t.help;
      node = next;
    }
    node.cmds.push(cmd);
  }

  private visible(n: Node<S>, s: S): boolean {
    return n.cmds.some((c) => !c.when || c.when(s)) || n.children.some((c) => this.visible(c, s));
  }

  private leaf(n: Node<S>, s: S): Cmd<S> | undefined {
    return n.cmds.find((c) => !c.when || c.when(s));
  }

  private kids(n: Node<S>, s: S) {
    return n.children.filter((c) => this.visible(c, s));
  }

  match(line: string, s: S): MatchResult<S> {
    const tokens = tokenize(line);
    const texts = tokens.map((t) => t.text);
    let node = this.root;
    const args: Args = {};
    let i = 0;
    while (i < tokens.length) {
      const t = texts[i].toLowerCase();
      const kids = this.kids(node, s);
      const kw = kids.filter((k) => k.tok!.kw);
      const exact = kw.find((k) => k.tok!.kw!.toLowerCase() === t);
      const cand = exact ? [exact] : kw.filter((k) => k.tok!.kw!.toLowerCase().startsWith(t));
      if (cand.length === 1) {
        node = cand[0];
        i++;
        continue;
      }
      if (cand.length > 1) return { err: 'ambiguous', pos: tokens[i].start, token: texts[i] };
      const params = kids.filter((k) => k.tok!.p).sort((a, b) => PARAM_ORDER.indexOf(a.tok!.p!) - PARAM_ORDER.indexOf(b.tok!.p!));
      let matched = false;
      for (const pk of params) {
        const r = matchParam(pk.tok!, texts, i, line, tokens);
        if (r) {
          args[pk.tok!.name!] = r.value;
          i += r.used;
          node = pk;
          matched = true;
          break;
        }
      }
      if (!matched) return { err: 'invalid', pos: tokens[i].start, token: texts[i] };
    }
    const cmd = this.leaf(node, s);
    if (!cmd || node === this.root) return { err: 'incomplete', pos: line.length };
    return { cmd, args };
  }

  /** Context help for a line that ended in '?'. */
  help(before: string, s: S): string {
    const endsSpace = before === '' || /\s$/.test(before);
    const tokens = tokenize(before);
    const walkTokens = endsSpace ? tokens : tokens.slice(0, -1);
    const partial = endsSpace ? '' : tokens[tokens.length - 1].text.toLowerCase();
    const walkLine = walkTokens.length ? before.slice(0, walkTokens[walkTokens.length - 1].start + walkTokens[walkTokens.length - 1].text.length) : '';
    const node = this.walk(walkLine, s);
    if (!node) return '% Unrecognized command\n';
    const kids = this.kids(node, s);
    if (!endsSpace) {
      const ms = kids.filter((k) => k.tok!.kw && k.tok!.kw.toLowerCase().startsWith(partial)).map((k) => k.tok!.kw!);
      if (!ms.length) return '% Unrecognized command\n';
      return ms.join('  ') + '\n';
    }
    const rows: [string, string][] = [];
    for (const k of kids) {
      const t = k.tok!;
      if (t.kw) rows.push([t.kw, t.help ?? '']);
      else rows.push([t.p === 'num' && t.lo !== undefined ? `<${t.lo}-${t.hi}>` : PARAM_LABEL[t.p!], t.help ?? '']);
    }
    rows.sort((a, b) => (a[0].startsWith('<') || a[0] === a[0].toUpperCase() ? 1 : 0) - (b[0].startsWith('<') || b[0] === b[0].toUpperCase() ? 1 : 0) || a[0].localeCompare(b[0]));
    if (this.leaf(node, s) && node !== this.root) rows.push(['<cr>', '']);
    const w = Math.max(...rows.map((r) => r[0].length), 4) + 2;
    return rows.map(([a, b]) => `  ${a.padEnd(w)}${b}`.trimEnd()).join('\n') + '\n';
  }

  /** Tab completion: returns the completed line or null. */
  complete(line: string, s: S): string | null {
    if (!line || /\s$/.test(line)) return null;
    const tokens = tokenize(line);
    const last = tokens[tokens.length - 1];
    const prefix = line.slice(0, last.start);
    const node = this.walk(prefix.trimEnd(), s);
    if (!node) return null;
    const ms = this.kids(node, s).filter((k) => k.tok!.kw && k.tok!.kw.toLowerCase().startsWith(last.text.toLowerCase()));
    if (ms.length !== 1) return null;
    return prefix + ms[0].tok!.kw + ' ';
  }

  private walk(line: string, s: S): Node<S> | null {
    const tokens = tokenize(line);
    const texts = tokens.map((t) => t.text);
    let node = this.root;
    let i = 0;
    while (i < tokens.length) {
      const t = texts[i].toLowerCase();
      const kids = this.kids(node, s);
      const kw = kids.filter((k) => k.tok!.kw);
      const exact = kw.find((k) => k.tok!.kw!.toLowerCase() === t);
      const cand = exact ? [exact] : kw.filter((k) => k.tok!.kw!.toLowerCase().startsWith(t));
      if (cand.length === 1) {
        node = cand[0];
        i++;
        continue;
      }
      if (cand.length > 1) return null;
      let matched = false;
      for (const pk of kids.filter((k) => k.tok!.p)) {
        const r = matchParam(pk.tok!, texts, i, line, tokens);
        if (r) {
          i += r.used;
          node = pk;
          matched = true;
          break;
        }
      }
      if (!matched) return null;
    }
    return node;
  }
}

export type MatchResult<S> =
  | { cmd: Cmd<S>; args: Args; err?: undefined }
  | { err: 'ambiguous' | 'invalid' | 'incomplete'; pos: number; token?: string; cmd?: undefined };

function sameTok(a: Tok, b: Tok) {
  if (a.kw || b.kw) return a.kw === b.kw;
  return a.p === b.p && a.name === b.name && a.lo === b.lo && a.hi === b.hi;
}

function matchParam(t: Tok, texts: string[], i: number, line: string, tokens: Token[]): { value: any; used: number } | null {
  const s = texts[i];
  switch (t.p) {
    case 'ip': {
      const v = parseIp(s);
      return v === null ? null : { value: v, used: 1 };
    }
    case 'num': {
      if (!/^\d+$/.test(s)) return null;
      const v = +s;
      if (t.lo !== undefined && (v < t.lo || v > t.hi!)) return null;
      return { value: v, used: 1 };
    }
    case 'iface': {
      const r = parseIfaceTokens(texts, i);
      return r ? { value: r.name, used: r.used } : null;
    }
    case 'vlanlist': {
      const v = parseVlanList(s);
      return v ? { value: v, used: 1 } : null;
    }
    case 'word':
      return { value: s, used: 1 };
    case 'line':
      return { value: line.slice(tokens[i].start).trimEnd(), used: texts.length - i };
  }
  return null;
}
