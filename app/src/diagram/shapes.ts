/**
 * Diagram objects that live on the same workspace as the network: boxes, zones,
 * text, connectors and drawing-only icons. They never carry traffic; devices do.
 */
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'diamond' | 'zone' | 'text' | 'line' | 'arrow' | 'icon';

export interface Shape {
  id: string;
  kind: ShapeKind;
  /** Box shapes: top-left corner and size. Connectors: start point (used when not attached). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Connectors: end point (used when not attached). */
  x2?: number;
  y2?: number;
  /** Connectors: attached ends (a device id or a shape id). */
  from?: string;
  to?: string;
  text?: string;
  fill?: string;
  stroke?: string;
  color?: string;
  dashed?: boolean;
  fontSize?: number;
  /** Icon shapes: which drawing-only icon. */
  icon?: IconId;
}

export const isConnector = (s: Shape) => s.kind === 'line' || s.kind === 'arrow';
export const isBox = (s: Shape) => !isConnector(s);

export const FILLS = ['none', '#ffffff', '#dae8fc', '#d5e8d4', '#ffe6cc', '#fff2cc', '#f8cecc', '#e1d5e7', '#f1f3f5'];
export const STROKES = ['#34404c', '#6c8ebf', '#82b366', '#d79b00', '#d6b656', '#b85450', '#9673a6', '#9aa4ae', 'none'];

export type IconId = 'firewall' | 'cloud' | 'internet' | 'rack' | 'user' | 'users' | 'building' | 'database' | 'lock' | 'tower';

export const ICONS: { id: IconId; label: string }[] = [
  { id: 'firewall', label: 'Firewall' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'internet', label: 'Internet' },
  { id: 'rack', label: 'Server rack' },
  { id: 'user', label: 'User' },
  { id: 'users', label: 'Users' },
  { id: 'building', label: 'Building' },
  { id: 'database', label: 'Database' },
  { id: 'lock', label: 'Security' },
  { id: 'tower', label: 'ISP / tower' },
];

export const SHAPE_TOOLS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'round', label: 'Rounded box' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'zone', label: 'Zone / area' },
  { kind: 'text', label: 'Text' },
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
];

let seq = 0;
export const shapeId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A new shape with sensible defaults, drawn from (x1,y1) to (x2,y2). */
export function newShape(kind: ShapeKind, x1: number, y1: number, x2: number, y2: number, icon?: IconId): Shape {
  const id = shapeId();
  if (kind === 'line' || kind === 'arrow') return { id, kind, x: x1, y: y1, w: 0, h: 0, x2, y2, stroke: '#34404c' };
  let x = Math.min(x1, x2);
  let y = Math.min(y1, y2);
  let w = Math.abs(x2 - x1);
  let h = Math.abs(y2 - y1);
  const tiny = w < 12 && h < 12;
  const def: Record<string, [number, number]> = { rect: [140, 70], round: [140, 70], ellipse: [130, 80], diamond: [120, 90], zone: [360, 240], text: [160, 32], icon: [64, 64] };
  if (tiny) {
    [w, h] = def[kind];
    x = x1 - w / 2;
    y = y1 - h / 2;
  }
  const s: Shape = { id, kind, x, y, w: Math.max(w, 20), h: Math.max(h, 20) };
  switch (kind) {
    case 'zone':
      return { ...s, fill: '#dae8fc', stroke: '#6c8ebf', dashed: true, text: 'Zone', fontSize: 15, color: '#2f4a73' };
    case 'text':
      return { ...s, fill: 'none', stroke: 'none', text: 'Text', fontSize: 16, color: '#1f2933' };
    case 'icon':
      return { ...s, icon, text: ICONS.find((i) => i.id === icon)?.label ?? '', fontSize: 12, color: '#1f2933' };
    default:
      return { ...s, fill: '#ffffff', stroke: '#34404c', text: '', fontSize: 14, color: '#1f2933' };
  }
}

/** Wrap text into lines that fit a width (approximate glyph width). */
export function wrapText(text: string, width: number, fontSize: number): string[] {
  const max = Math.max(1, Math.floor(width / (fontSize * 0.56)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (next.length > max && line) {
        out.push(line);
        line = word;
      } else line = next;
      while (line.length > max) {
        out.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    out.push(line);
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a connector meets the edge of a box, heading from its centre toward a point. */
export function edgePoint(b: Box, tx: number, ty: number, pad = 2): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k };
}
