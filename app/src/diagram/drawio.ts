/**
 * draw.io (diagrams.net) files.
 *
 * Export writes an uncompressed .drawio file: devices become image shapes that
 * keep their NetLab kind and model, cables become edges, and diagram shapes map
 * to draw.io's own styles.
 *
 * Import reads plain or compressed .drawio files. Shapes, text, zones and
 * arrows come across as diagram objects. Network shapes (routers, switches, PCs,
 * servers... from draw.io's network and Cisco libraries, or NetLab's own export)
 * become live devices, and an edge between two of them becomes a real cable.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inflateSync } from 'fflate';
import { Engine, type Device, type DeviceKind } from '../engine/engine';
import { createDevice, serialize, type Note, type SavedFile } from '../engine/topology';
import { DEFAULT_MODEL, MODELS } from '../engine/models';
import { DeviceArt } from '../ui/deviceArt';
import { autoPair } from '../ui/actions';
import { CABLE_STYLE } from '../ui/icons';
import { IconArt } from './iconArt';
import { child, findAll, parseXml, type XNode } from '../pt/xml';
import { ICONS, isConnector, shapeId, type IconId, type Shape } from './shapes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');

function svgDataUri(inner: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${inner}</svg>`;
  // draw.io style strings use ';' as a separator, so the image must be base64
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return `data:image/svg+xml,${b64}`;
}

const deviceImage = (kind: DeviceKind, model: string) => svgDataUri(renderToStaticMarkup(createElement(DeviceArt, { kind, model })));
const iconImage = (id: IconId) => svgDataUri(renderToStaticMarkup(createElement(IconArt, { id })));

/** The workspace as a .drawio file. */
export function toDrawio(engine: Engine, shapes: Shape[], notes: Note[], name = 'NetLab'): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const imgCache = new Map<string, string>();
  const img = (key: string, make: () => string) => imgCache.get(key) ?? (imgCache.set(key, make()), imgCache.get(key)!);
  const color = (c?: string, fb = 'none') => (c && c !== 'none' ? c : fb);
  const geo = (x: number, y: number, w: number, h: number) => `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>`;

  // zones first so they sit behind everything
  const ordered = [...shapes.filter((s) => s.kind === 'zone'), ...shapes.filter((s) => s.kind !== 'zone' && !isConnector(s))];
  for (const s of ordered) {
    const base = `whiteSpace=wrap;html=1;fontSize=${s.fontSize ?? 14};fontColor=${color(s.color, '#1f2933')};`;
    let style = '';
    switch (s.kind) {
      case 'rect':
        style = `rounded=0;${base}fillColor=${color(s.fill)};strokeColor=${color(s.stroke)};`;
        break;
      case 'round':
        style = `rounded=1;${base}fillColor=${color(s.fill)};strokeColor=${color(s.stroke)};`;
        break;
      case 'ellipse':
        style = `ellipse;${base}fillColor=${color(s.fill)};strokeColor=${color(s.stroke)};`;
        break;
      case 'diamond':
        style = `rhombus;${base}fillColor=${color(s.fill)};strokeColor=${color(s.stroke)};`;
        break;
      case 'zone':
        style = `rounded=1;arcSize=4;${base}fillColor=${color(s.fill)};opacity=45;textOpacity=100;strokeColor=${color(s.stroke)};verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontStyle=1;container=0;netlabZone=1;`;
        break;
      case 'text':
        style = `text;${base}align=center;verticalAlign=middle;strokeColor=none;fillColor=none;`;
        break;
      case 'icon':
        style = `shape=image;image=${img(`i:${s.icon}`, () => iconImage(s.icon!))};verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;imageAspect=0;html=1;fontSize=${s.fontSize ?? 12};netlabIcon=${s.icon};`;
        break;
    }
    if (s.dashed) style += 'dashed=1;';
    cells.push(`<mxCell id="${s.id}" value="${esc(s.text ?? '')}" style="${style}" vertex="1" parent="1">${geo(s.x, s.y, s.w, s.h)}</mxCell>`);
  }
  for (const n of notes) {
    cells.push(`<mxCell id="${n.id}" value="${esc(n.text)}" style="shape=note;size=12;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;align=left;spacingLeft=6;" vertex="1" parent="1">${geo(n.x, n.y, 180, Math.max(40, 18 * (n.text.split('\n').length + 1)))}</mxCell>`);
  }
  for (const d of engine.devices.values()) {
    const style = `shape=image;image=${img(`d:${d.kind}:${d.model}`, () => deviceImage(d.kind, d.model))};verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;imageAspect=0;html=1;fontSize=12;`;
    cells.push(
      `<object id="${d.id}" label="${esc(d.hostname)}" netlabKind="${d.kind}" netlabModel="${d.model}"><mxCell style="${style}" vertex="1" parent="1">${geo(d.x - 33, d.y - 33, 66, 66)}</mxCell></object>`,
    );
  }
  for (const l of engine.links.values()) {
    const st = CABLE_STYLE[l.cable];
    cells.push(
      `<mxCell id="${l.id}" value="" style="endArrow=none;html=1;strokeWidth=2;strokeColor=${st.stroke};${st.dash ? 'dashed=1;' : ''}netlabCable=${l.cable};netlabA=${esc(l.a.iface)};netlabB=${esc(l.b.iface)};" edge="1" parent="1" source="${l.a.dev}" target="${l.b.dev}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  for (const s of shapes.filter(isConnector)) {
    const pts = `<mxPoint x="${Math.round(s.x)}" y="${Math.round(s.y)}" as="sourcePoint"/><mxPoint x="${Math.round(s.x2 ?? s.x)}" y="${Math.round(s.y2 ?? s.y)}" as="targetPoint"/>`;
    const style = `endArrow=${s.kind === 'arrow' ? 'classic' : 'none'};html=1;strokeWidth=2;strokeColor=${color(s.stroke, '#34404c')};fontSize=${s.fontSize ?? 14};fontColor=${color(s.color, '#1f2933')};${s.dashed ? 'dashed=1;' : ''}`;
    cells.push(
      `<mxCell id="${s.id}" value="${esc(s.text ?? '')}" style="${style}" edge="1" parent="1"${s.from ? ` source="${s.from}"` : ''}${s.to ? ` target="${s.to}"` : ''}><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`,
    );
  }
  return `<mxfile host="HarNova NetLab" type="device"><diagram id="netlab" name="${esc(name)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}

// ---------------------------------------------------------------- import

function styleMap(style: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const part of style.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) m[part] = '1';
    else m[part.slice(0, i)] = part.slice(i + 1);
  }
  return m;
}

function plainLabel(v: string): string {
  return v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Recognise network gear in a draw.io shape style or label. */
function deviceKindFor(style: string, label: string): { kind: DeviceKind; l3?: boolean } | null {
  const s = style.toLowerCase();
  const isNet = /mxgraph\.(cisco|cisco19|cisco_safe|network|networks|citrix|rack|azure|aws)/.test(s) || /netlabkind/.test(s);
  if (!isNet) return null;
  const t = `${s} ${label.toLowerCase()}`;
  if (/firewall|asa\b/.test(t)) return null; // drawn as an icon
  if (/multilayer|layer_3_switch|l3_switch|layer 3 switch/.test(t)) return { kind: 'l3switch' };
  if (/wireless_router|wifi_router|access_point|wireless_ap|accesspoint|\bap\b/.test(t)) return { kind: 'ap' };
  if (/router/.test(t)) return { kind: 'router' };
  if (/switch/.test(t)) return { kind: 'switch' };
  if (/\bhub\b|\.hub/.test(t)) return { kind: 'hub' };
  if (/laptop|notebook/.test(t)) return { kind: 'laptop' };
  if (/server|mainframe/.test(t)) return { kind: 'server' };
  if (/printer/.test(t)) return { kind: 'printer' };
  if (/ip_phone|phone|telephone/.test(t)) return { kind: /smart|mobile|cell/.test(t) ? 'smartphone' : 'phone' };
  if (/tablet|ipad/.test(t)) return { kind: 'tablet' };
  if (/pc|workstation|computer|desktop|terminal/.test(t)) return { kind: 'pc' };
  return null;
}

function iconFor(style: string, label: string): IconId | null {
  const t = `${style} ${label}`.toLowerCase();
  if (/firewall|asa\b/.test(t)) return 'firewall';
  if (/internet|globe|web\b/.test(t)) return 'internet';
  if (/cloud/.test(t)) return 'cloud';
  if (/database|storage|\bdb\b/.test(t)) return 'database';
  if (/rack/.test(t)) return 'rack';
  if (/users|group/.test(t) && /user|people/.test(t)) return 'users';
  if (/user|person|actor|people/.test(t)) return 'user';
  if (/building|office|branch|headquarters/.test(t)) return 'building';
  if (/lock|security|vpn/.test(t)) return 'lock';
  if (/tower|antenna|isp|radio/.test(t)) return 'tower';
  return null;
}

/** The first page's graph model, whether stored plainly or compressed. */
function graphModel(xml: string): XNode {
  const root = parseXml(xml);
  const direct = findAll(root, 'mxGraphModel')[0];
  if (direct) return direct;
  const diagram = findAll(root, 'diagram')[0];
  const packed = diagram?.text.trim();
  if (!packed) throw new Error('This file has no diagram in it.');
  const bin = atob(packed);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const inflated = new TextDecoder().decode(inflateSync(bytes));
  const model = findAll(parseXml(decodeURIComponent(inflated)), 'mxGraphModel')[0];
  if (!model) throw new Error('The diagram could not be read.');
  return model;
}

export interface DrawioImport {
  file: SavedFile;
  devices: number;
  cables: number;
  shapes: number;
}

export function fromDrawio(xml: string): DrawioImport {
  const model = graphModel(xml);
  const root = child(model, 'root');
  if (!root) throw new Error('The diagram is empty.');
  // flatten <object>/<UserObject> wrappers: they hold the id and label, the inner mxCell the rest
  interface Cell {
    id: string;
    value: string;
    attrs: Record<string, string>;
    style: Record<string, string>;
    rawStyle: string;
    vertex: boolean;
    edge: boolean;
    parent: string;
    source?: string;
    target?: string;
    geo?: XNode;
  }
  const cells: Cell[] = [];
  for (const n of root.children) {
    const isWrap = n.tag === 'object' || n.tag === 'UserObject';
    const c = isWrap ? child(n, 'mxCell') : n;
    if (!c || c.tag !== 'mxCell') continue;
    const rawStyle = c.attrs.style ?? '';
    cells.push({
      id: (isWrap ? n.attrs.id : c.attrs.id) ?? shapeId(),
      value: plainLabel((isWrap ? n.attrs.label : c.attrs.value) ?? ''),
      attrs: isWrap ? n.attrs : {},
      style: styleMap(rawStyle),
      rawStyle,
      vertex: c.attrs.vertex === '1',
      edge: c.attrs.edge === '1',
      parent: c.attrs.parent ?? '1',
      source: c.attrs.source,
      target: c.attrs.target,
      geo: child(c, 'mxGeometry'),
    });
  }
  const byId = new Map(cells.map((c) => [c.id, c]));
  // absolute position of a vertex (children of groups are relative to the group)
  const absPos = (c: Cell): { x: number; y: number } => {
    const x = Number(c.geo?.attrs.x ?? 0);
    const y = Number(c.geo?.attrs.y ?? 0);
    const p = byId.get(c.parent);
    if (p && p.vertex) {
      const pp = absPos(p);
      return { x: x + pp.x, y: y + pp.y };
    }
    return { x, y };
  };

  const e = new Engine();
  const shapes: Shape[] = [];
  const notes: Note[] = [];
  const devOf = new Map<string, Device>();
  const shapeOf = new Map<string, string>();
  const used = new Set<string>();
  const color = (v?: string) => (!v || v === 'none' || v === 'default' ? undefined : v);

  for (const c of cells.filter((x) => x.vertex)) {
    const { x, y } = absPos(c);
    const w = Number(c.geo?.attrs.width ?? 80);
    const h = Number(c.geo?.attrs.height ?? 40);
    const st = c.style;
    const fs = Number(st.fontSize) || undefined;
    // NetLab's own export, or recognised network gear -> a live device
    const nk = c.attrs.netlabKind as DeviceKind | undefined;
    const found = nk ? { kind: nk } : deviceKindFor(c.rawStyle, c.value);
    if (found) {
      const model = (c.attrs.netlabModel && MODELS.some((m) => m.id === c.attrs.netlabModel) ? c.attrs.netlabModel : undefined) ?? DEFAULT_MODEL[found.kind];
      const d = createDevice(e, found.kind, Math.round(x + w / 2), Math.round(y + h / 2), model);
      const name = c.value.split('\n')[0].trim();
      if (name && !used.has(name)) {
        d.hostname = name.slice(0, 40);
        used.add(name);
      }
      devOf.set(c.id, d);
      continue;
    }
    if (st.shape === 'note' || st.note) {
      notes.push({ id: `n${notes.length}${Date.now().toString(36)}`, x, y, text: c.value || 'Note' });
      continue;
    }
    const base: Shape = { id: shapeId(), kind: 'rect', x, y, w, h, text: c.value, fill: color(st.fillColor) ?? (st.fillColor === 'none' ? 'none' : '#ffffff'), stroke: color(st.strokeColor) ?? (st.strokeColor === 'none' ? 'none' : '#34404c'), color: color(st.fontColor) ?? '#1f2933', dashed: st.dashed === '1', fontSize: fs ?? 14 };
    const icon = (c.attrs.netlabIcon as IconId | undefined) ?? (st.netlabIcon as IconId | undefined) ?? (st.shape === 'image' || /mxgraph\./.test(c.rawStyle) ? iconFor(c.rawStyle, c.value) : null);
    let s: Shape;
    if (icon && ICONS.some((i) => i.id === icon)) s = { ...base, kind: 'icon', icon, fontSize: fs ?? 12 };
    else if ('text' in st || st.shape === 'text') s = { ...base, kind: 'text', fill: 'none', stroke: 'none' };
    else if ('ellipse' in st || st.shape === 'ellipse') s = { ...base, kind: 'ellipse' };
    else if ('rhombus' in st || st.shape === 'rhombus') s = { ...base, kind: 'diamond' };
    else if (st.netlabZone || 'swimlane' in st || st.container === '1' || (st.verticalAlign === 'top' && w * h > 60000)) s = { ...base, kind: 'zone', fill: color(st.fillColor) ?? '#dae8fc', stroke: color(st.strokeColor) ?? '#6c8ebf' };
    else if (st.rounded === '1') s = { ...base, kind: 'round' };
    else s = base;
    shapes.push(s);
    shapeOf.set(c.id, s.id);
  }

  let cables = 0;
  for (const c of cells.filter((x) => x.edge)) {
    const da = c.source ? devOf.get(c.source) : undefined;
    const db = c.target ? devOf.get(c.target) : undefined;
    if (da && db) {
      // two devices: lay a real cable (keep NetLab's own ports when the file says which)
      const want = [c.style.netlabA, c.style.netlabB];
      const pa = want[0] && da.port(want[0]) && !da.port(want[0])!.linkId ? want[0] : undefined;
      const pair = autoPair(da, db, pa);
      const pb = want[1] && db.port(want[1]) && !db.port(want[1])!.linkId ? want[1] : pair?.[1].name;
      if (pair && pb) {
        const r = e.connect({ dev: da.id, iface: pair[0].name }, { dev: db.id, iface: pb }, (c.style.netlabCable as never) ?? 'auto');
        if (typeof r !== 'string') {
          cables++;
          continue;
        }
        const r2 = e.connect({ dev: da.id, iface: pair[0].name }, { dev: db.id, iface: pb }, 'auto');
        if (typeof r2 !== 'string') {
          cables++;
          continue;
        }
      }
    }
    const pts = (c.geo?.children ?? []).filter((n) => n.tag === 'mxPoint');
    const sp = pts.find((p) => p.attrs.as === 'sourcePoint');
    const tp = pts.find((p) => p.attrs.as === 'targetPoint');
    const from = c.source ? (devOf.get(c.source)?.id ?? shapeOf.get(c.source)) : undefined;
    const to = c.target ? (devOf.get(c.target)?.id ?? shapeOf.get(c.target)) : undefined;
    const arrow = (c.style.endArrow ?? 'classic') !== 'none';
    shapes.push({
      id: shapeId(),
      kind: arrow ? 'arrow' : 'line',
      x: Number(sp?.attrs.x ?? 0),
      y: Number(sp?.attrs.y ?? 0),
      w: 0,
      h: 0,
      x2: Number(tp?.attrs.x ?? 100),
      y2: Number(tp?.attrs.y ?? 0),
      from,
      to,
      text: c.value || undefined,
      stroke: color(c.style.strokeColor) ?? '#34404c',
      color: color(c.style.fontColor) ?? '#1f2933',
      dashed: c.style.dashed === '1',
      fontSize: Number(c.style.fontSize) || 13,
    });
  }
  e.refreshAll();
  return { file: serialize(e, notes, shapes), devices: devOf.size, cables, shapes: shapes.length };
}
