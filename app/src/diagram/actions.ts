import { engine, getState, markDirty, setState } from '../ui/store';
import { edgePoint, isConnector, shapeId, type Box, type Shape } from './shapes';

export function addShape(s: Shape, select = true) {
  setState((st) => ({ shapes: [...st.shapes, s], ...(select ? { selected: { kind: 'shape' as const, id: s.id } } : {}) }));
  markDirty();
}

export function updateShape(id: string, patch: Partial<Shape>) {
  setState((st) => ({ shapes: st.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  markDirty();
}

export function deleteShape(id: string) {
  detachFrom(id);
  setState((st) => ({ shapes: st.shapes.filter((s) => s.id !== id), selected: st.selected?.id === id ? null : st.selected, editingShape: null }));
  markDirty();
}

export function duplicateShape(id: string) {
  const s = getState().shapes.find((x) => x.id === id);
  if (!s) return;
  const ends = isConnector(s) ? connectorEnds(s) : null;
  const copy: Shape = ends
    ? { ...s, id: shapeId(), from: undefined, to: undefined, x: ends.x1 + 24, y: ends.y1 + 24, x2: ends.x2 + 24, y2: ends.y2 + 24 }
    : { ...s, id: shapeId(), x: s.x + 24, y: s.y + 24 };
  addShape(copy);
}

/** Bring to front (end of the list) or send to back (start of the list). */
export function arrangeShape(id: string, where: 'front' | 'back') {
  setState((st) => {
    const s = st.shapes.find((x) => x.id === id);
    if (!s) return {};
    const rest = st.shapes.filter((x) => x.id !== id);
    return { shapes: where === 'front' ? [...rest, s] : [s, ...rest] };
  });
  markDirty();
}

/** A device or shape a connector can attach to. */
export function targetBox(id: string): Box | null {
  const d = engine.devices.get(id);
  if (d) return { x: d.x - 34, y: d.y - 24, w: 68, h: 74 };
  const s = getState().shapes.find((x) => x.id === id);
  if (s && !isConnector(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  return null;
}

/** Where a connector's two ends are right now (attached ends follow their device or shape). */
export function connectorEnds(s: Shape): { x1: number; y1: number; x2: number; y2: number } {
  const a = s.from ? targetBox(s.from) : null;
  const b = s.to ? targetBox(s.to) : null;
  let p1 = { x: s.x, y: s.y };
  let p2 = { x: s.x2 ?? s.x, y: s.y2 ?? s.y };
  const ca = a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : p1;
  const cb = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : p2;
  if (a) p1 = edgePoint(a, cb.x, cb.y, 4);
  if (b) p2 = edgePoint(b, ca.x, ca.y, 4);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** Before a device or shape goes away, leave its connectors where they are, unattached. */
export function detachFrom(id: string) {
  const st = getState();
  if (!st.shapes.some((s) => s.from === id || s.to === id)) return;
  setState({
    shapes: st.shapes.map((s) => {
      if (s.from !== id && s.to !== id) return s;
      const e = connectorEnds(s);
      return { ...s, x: e.x1, y: e.y1, x2: e.x2, y2: e.y2, from: s.from === id ? undefined : s.from, to: s.to === id ? undefined : s.to };
    }),
  });
}

/** The device or box shape under a world point (for attaching connectors). */
export function hitTarget(x: number, y: number, exclude?: string): string | undefined {
  for (const d of engine.devices.values()) {
    if (Math.abs(d.x - x) < 36 && y > d.y - 30 && y < d.y + 46) return d.id;
  }
  const shapes = getState().shapes;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.id === exclude || isConnector(s) || s.kind === 'zone') continue;
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s.id;
  }
  return undefined;
}
