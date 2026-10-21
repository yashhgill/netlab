import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { fmtIp, maskToPrefix } from '../engine/addr';
import { mediaOf, type Device, type DeviceKind, type Link } from '../engine/engine';
import { PDU_COLORS } from '../engine/packets';
import { shortIf } from '../cli/ifnames';
import {
  addNote,
  autoPair,
  mediaForCable,
  connectPorts,
  createScenario,
  deleteDevice,
  deleteLink,
  deleteNote,
  freePorts,
  placeDevice,
  updateNote,
} from './actions';
import { CABLE_STYLE, DeviceArt } from './icons';
import { engine, getState, markDirty, openWindow, setState, toast, useUi } from './store';
import { addShape, connectorEnds, deleteShape, hitTarget, updateShape } from '../diagram/actions';
import { FormatBar, ShapeLayer, ShapeSvg, ShapeTextEditor, type ShapeHandlers } from '../diagram/DiagramLayer';
import { isConnector, newShape, type Shape } from '../diagram/shapes';

const ICON = 66;

interface View {
  x: number;
  y: number;
  k: number;
}

export let canvasApi: {
  fit: () => void;
  zoom: (f: number) => void;
  centerWorld: () => { x: number; y: number };
  /** Place a device where a finger or mouse was released; false if the point is off the workspace. */
  dropAt: (kind: DeviceKind, model: string, clientX: number, clientY: number) => boolean;
} = {
  fit: () => {},
  zoom: () => {},
  centerWorld: () => ({ x: 400, y: 300 }),
  dropAt: () => false,
};

export function Canvas() {
  useUi((s) => s.engineVersion);
  const frame = useUi((s) => s.frame);
  const tool = useUi((s) => s.tool);
  const cable = useUi((s) => s.cable);
  const cableFrom = useUi((s) => s.cableFrom);
  const pduSrc = useUi((s) => s.pduSrc);
  const selected = useUi((s) => s.selected);
  const showLabels = useUi((s) => s.showLabels);
  const notes = useUi((s) => s.notes);
  const anim = useUi((s) => s.anim);
  const placing = useUi((s) => s.placing);
  const picker = useUi((s) => s.portPicker);
  const shapes = useUi((s) => s.shapes);
  const editingShape = useUi((s) => s.editingShape);
  const drawKind = useUi((s) => s.drawKind);
  const drawIcon = useUi((s) => s.drawIcon);
  const [drawing, setDrawing] = useState<{ x1: number; y1: number; x2: number; y2: number; from?: string } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; sx: number; sy: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<
    | { kind: 'device'; id: string; dx: number; dy: number; moved: boolean; sx: number; sy: number }
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'note'; id: string; dx: number; dy: number }
    | { kind: 'shape'; id: string; sx: number; sy: number; orig: Shape; moved: boolean }
    | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; orig: Shape }
    | { kind: 'end'; id: string; which: 'from' | 'to' }
    | { kind: 'draw'; x1: number; y1: number; from?: string }
    | null
  >(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  useEffect(() => {
    canvasApi = {
      fit: () => {
        const ds = [...engine.devices.values()];
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return;
        if (!ds.length) return setView({ x: 0, y: 0, k: 1 });
        const xs = ds.map((d) => d.x);
        const ys = ds.map((d) => d.y);
        const minX = Math.min(...xs) - 90;
        const maxX = Math.max(...xs) + 90;
        const minY = Math.min(...ys) - 90;
        const maxY = Math.max(...ys) + 110;
        const k = Math.min(1.6, Math.max(0.3, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
        setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
      },
      zoom: (f: number) => {
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return;
        zoomAt(r.width / 2, r.height / 2, f);
      },
      centerWorld: () => {
        const r = svgRef.current?.getBoundingClientRect();
        const v = viewRef.current;
        if (!r) return { x: 400, y: 300 };
        return { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k };
      },
      dropAt: (kind, model, cx, cy) => {
        const r = svgRef.current?.getBoundingClientRect();
        if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
        const under = document.elementFromPoint(cx, cy);
        if (under && !svgRef.current!.contains(under)) return false; // released over a window or panel
        const w = toWorld(cx, cy);
        placeDevice(kind, w.x, w.y, model);
        return true;
      },
    };
  });

  // Two-finger pinch to zoom and pan (touch screens). Any one-finger gesture in progress is cancelled.
  useEffect(() => {
    const el = svgRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; cx: number; cy: number } | null = null;
    const center = () => {
      const [a, b] = [...pts.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        drag.current = null;
        pinch = center();
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        e.stopPropagation();
        const c = center();
        const r = el.getBoundingClientRect();
        const f = c.d / pinch.d;
        setView((v) => {
          const k = Math.min(3, Math.max(0.25, v.k * f));
          const sx = c.cx - r.left;
          const sy = c.cy - r.top;
          const wx = (pinch!.cx - r.left - v.x) / v.k;
          const wy = (pinch!.cy - r.top - v.y) / v.k;
          return { k, x: sx - wx * k, y: sy - wy * k };
        });
        pinch = c;
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  const zoomAt = (sx: number, sy: number, f: number) => {
    setView((v) => {
      const k = Math.min(3, Math.max(0.25, v.k * f));
      const wx = (sx - v.x) / v.k;
      const wy = (sy - v.y) / v.k;
      return { k, x: sx - wx * k, y: sy - wy * k };
    });
  };

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- device interactions ----------
  const onDeviceDown = (e: RPE, d: Device) => {
    e.stopPropagation();
    setHover(null);
    clearTimeout(hoverTimer.current);
    const s = getState();
    if (s.tool === 'delete') {
      deleteDevice(d.id);
      return;
    }
    if (s.tool === 'shape') {
      // lines and arrows start on the device; other shapes draw from here
      const w0 = toWorld(e.clientX, e.clientY);
      const conn = s.drawKind === 'line' || s.drawKind === 'arrow';
      startDraw(conn ? d.x : w0.x, conn ? d.y : w0.y, conn ? d.id : undefined);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (s.tool === 'cable') {
      handleCableClick(d, e.clientX, e.clientY);
      return;
    }
    if (s.tool === 'inspect') {
      const r = svgRef.current!.getBoundingClientRect();
      setState({ inspectMenu: { devId: d.id, x: Math.min(e.clientX - r.left + 10, r.width - 220), y: Math.min(e.clientY - r.top + 10, r.height - 200) } });
      return;
    }
    if (s.tool === 'pdu') {
      if (!s.pduSrc) {
        setState({ pduSrc: d.id });
        toast(`Source: ${d.hostname}. Now click the destination.`);
      } else if (s.pduSrc !== d.id) {
        createScenario(s.pduSrc, d.id);
        setState({ pduSrc: null });
      }
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { kind: 'device', id: d.id, dx: w.x - d.x, dy: w.y - d.y, moved: false, sx: e.clientX, sy: e.clientY };
    setState({ selected: { kind: 'device', id: d.id } });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handleCableClick = (d: Device, cx: number, cy: number) => {
    const s = getState();
    const from = s.cableFrom;
    if (from && from.dev === d.id) {
      setState({ cableFrom: null });
      return;
    }
    const media = mediaForCable(s.cable);
    if (!freePorts(d, media).length) {
      toast(`${d.hostname} has no free ${s.cable === 'console' ? 'console or RS-232' : s.cable === 'fiber' ? 'fiber' : s.cable.startsWith('serial') ? 'serial' : ''} ports.`.replace('  ', ' '), 'error');
      return;
    }
    if (s.cable === 'auto') {
      if (!from) {
        setState({ cableFrom: { dev: d.id, iface: '' } });
        return;
      }
      const a = engine.devices.get(from.dev)!;
      const pair = autoPair(a, d, from.iface || undefined);
      if (!pair) return toast(`${a.hostname} and ${d.hostname} have no free ports that one cable can join.`, 'error');
      connectPorts({ dev: a.id, iface: pair[0].name }, { dev: d.id, iface: pair[1].name }, 'auto');
      setState({ cableFrom: null });
      return;
    }
    const r = svgRef.current!.getBoundingClientRect();
    setState({ portPicker: { dev: d.id, x: Math.min(cx - r.left, r.width - 290), y: Math.max(8, Math.min(cy - r.top, r.height - 360)) } });
  };

  const pickPort = (iface: string) => {
    const s = getState();
    const p = s.portPicker!;
    setState({ portPicker: null });
    if (!s.cableFrom) {
      setState({ cableFrom: { dev: p.dev, iface } });
      return;
    }
    connectPorts(s.cableFrom, { dev: p.dev, iface }, s.cable);
    setState({ cableFrom: null });
  };

  // ---------- diagram shapes ----------
  const startDraw = (x: number, y: number, from?: string) => {
    drag.current = { kind: 'draw', x1: x, y1: y, from };
    setDrawing({ x1: x, y1: y, x2: x, y2: y, from });
  };

  const shapeHandlers: ShapeHandlers = {
    onDown: (e, sh) => {
      const s = getState();
      if (s.tool === 'shape' || s.tool === 'cable' || s.tool === 'pdu' || s.tool === 'inspect' || s.placing) return; // let the background handle it
      e.stopPropagation();
      if (s.tool === 'delete') return deleteShape(sh.id);
      if (s.tool === 'note') return;
      setState({ selected: { kind: 'shape', id: sh.id }, portPicker: null, menu: null, shapeMenu: false });
      const w = toWorld(e.clientX, e.clientY);
      let orig = sh;
      if (isConnector(sh) && (sh.from || sh.to)) {
        // moving a whole connector unhooks it from what it was attached to
        const en = connectorEnds(sh);
        orig = { ...sh, from: undefined, to: undefined, x: en.x1, y: en.y1, x2: en.x2, y2: en.y2 };
      }
      drag.current = { kind: 'shape', id: sh.id, sx: w.x, sy: w.y, orig, moved: false };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    onHandle: (e, sh, which) => {
      e.stopPropagation();
      if (which === 'from' || which === 'to') drag.current = { kind: 'end', id: sh.id, which };
      else drag.current = { kind: 'resize', id: sh.id, corner: which, orig: sh };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    onDouble: (sh) => setState({ editingShape: sh.id, selected: { kind: 'shape', id: sh.id } }),
  };

  // ---------- background ----------
  const onBgDown = (e: RPE) => {
    const s = getState();
    setState({ portPicker: null, menu: null, shapeMenu: false });
    if (s.tool === 'shape' && !s.placing) {
      const w0 = toWorld(e.clientX, e.clientY);
      startDraw(w0.x, w0.y, s.drawKind === 'line' || s.drawKind === 'arrow' ? hitTarget(w0.x, w0.y) : undefined);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    setState({ inspectMenu: null });
    if (s.placing) {
      placeDevice(s.placing, w.x, w.y, s.placingModel ?? undefined);
      if (!e.shiftKey) setState({ placing: null, placingModel: null });
      return;
    }
    if (s.tool === 'note') {
      const n = addNote(w.x, w.y);
      setEditingNote(n.id);
      setState({ tool: 'select' });
      return;
    }
    if (s.cableFrom) setState({ cableFrom: null });
    if (s.pduSrc) setState({ pduSrc: null });
    setState({ selected: null });
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: RPE) => {
    const w = toWorld(e.clientX, e.clientY);
    if (getState().cableFrom || getState().placing) setMouse(w);
    const dr = drag.current;
    if (!dr) return;
    if (dr.kind === 'pan') {
      setView((v) => ({ ...v, x: dr.vx + e.clientX - dr.sx, y: dr.vy + e.clientY - dr.sy }));
    } else if (dr.kind === 'device') {
      if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 4) return;
      dr.moved = true;
      const d = engine.devices.get(dr.id);
      if (d) {
        d.x = Math.round(w.x - dr.dx);
        d.y = Math.round(w.y - dr.dy);
        engine.bump();
        setState({ engineVersion: engine.version });
      }
    } else if (dr.kind === 'note') {
      updateNote(dr.id, { x: w.x - dr.dx, y: w.y - dr.dy });
    } else if (dr.kind === 'draw') {
      setDrawing({ x1: dr.x1, y1: dr.y1, x2: w.x, y2: w.y, from: dr.from });
    } else if (dr.kind === 'shape') {
      const dx = w.x - dr.sx;
      const dy = w.y - dr.sy;
      if (!dr.moved && Math.hypot(dx, dy) < 3 / viewRef.current.k) return;
      dr.moved = true;
      const o = dr.orig;
      updateShape(dr.id, isConnector(o) ? { from: undefined, to: undefined, x: o.x + dx, y: o.y + dy, x2: (o.x2 ?? o.x) + dx, y2: (o.y2 ?? o.y) + dy } : { x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
    } else if (dr.kind === 'resize') {
      const o = dr.orig;
      let x1 = o.x;
      let y1 = o.y;
      let x2 = o.x + o.w;
      let y2 = o.y + o.h;
      if (dr.corner.includes('w')) x1 = Math.min(w.x, x2 - 16);
      else x2 = Math.max(w.x, x1 + 16);
      if (dr.corner.includes('n')) y1 = Math.min(w.y, y2 - 16);
      else y2 = Math.max(w.y, y1 + 16);
      updateShape(dr.id, { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) });
    } else if (dr.kind === 'end') {
      const sh = getState().shapes.find((x) => x.id === dr.id);
      if (!sh) return;
      const cur = connectorEnds(sh);
      const other = dr.which === 'from' ? sh.to : sh.from;
      const target = hitTarget(w.x, w.y, sh.id);
      const attach = target && target !== other ? target : undefined;
      if (dr.which === 'from') updateShape(dr.id, { from: attach, x: w.x, y: w.y, ...(sh.to ? {} : { x2: cur.x2, y2: cur.y2 }) });
      else updateShape(dr.id, { to: attach, x2: w.x, y2: w.y, ...(sh.from ? {} : { x: cur.x1, y: cur.y1 }) });
    }
  };

  const onUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (dr?.kind === 'draw') {
      const st = getState();
      const d = drawing ?? { x1: dr.x1, y1: dr.y1, x2: dr.x1, y2: dr.y1 };
      setDrawing(null);
      const conn = st.drawKind === 'line' || st.drawKind === 'arrow';
      if (conn) {
        const to = hitTarget(d.x2, d.y2, undefined);
        const short = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 10;
        if (short && !to) return; // a tap draws nothing; drag to draw a line
        addShape({ ...newShape(st.drawKind, d.x1, d.y1, short ? d.x1 + 120 : d.x2, short ? d.y1 : d.y2), from: dr.from, to: to && to !== dr.from ? to : undefined });
      } else {
        const sh = newShape(st.drawKind, d.x1, d.y1, d.x2, d.y2, st.drawIcon ?? undefined);
        addShape(sh);
        if (sh.kind === 'text') setState({ editingShape: sh.id });
      }
      setState({ tool: 'select' });
      return;
    }
    if (dr?.kind === 'device') {
      if (!dr.moved) openWindow(dr.id);
      else markDirty();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const data = e.dataTransfer.getData('application/x-netlab-device');
    if (!data) return;
    const [kind, model] = data.split('|') as [DeviceKind, string];
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    placeDevice(kind, w.x, w.y, model);
  };

  const onLinkDown = (e: RPE, l: Link) => {
    e.stopPropagation();
    if (getState().tool === 'delete') deleteLink(l.id);
    else setState({ selected: { kind: 'link', id: l.id } });
  };

  // ---------- render helpers ----------
  const devices = [...engine.devices.values()];
  const links = [...engine.links.values()];
  const pos = (id: string) => {
    const d = engine.devices.get(id);
    return d ? { x: d.x, y: d.y } : { x: 0, y: 0 };
  };

  const now = performance.now();
  void frame;
  const animT = anim ? Math.min(1, (now - anim.start) / anim.dur) : 0;
  const cursor =
    placing ? 'copy' : tool === 'shape' ? 'crosshair' : tool === 'delete' ? 'not-allowed' : tool === 'cable' ? 'crosshair' : tool === 'pdu' ? 'cell' : tool === 'note' ? 'text' : drag.current?.kind === 'pan' ? 'grabbing' : 'default';

  const hoverDev = hover ? engine.devices.get(hover.id) : null;

  return (
    <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setMouse(null)}
        role="application"
        aria-label="Network workspace"
      >
        <defs>
          <pattern id="dots" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={Math.max(0.7, 1 * view.k)} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
        <g className="canvas-world" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <ShapeLayer shapes={shapes.filter((x) => x.kind === 'zone')} k={view.k} selectedId={selected?.kind === 'shape' ? selected.id : null} h={shapeHandlers} />
          {links.map((l) => {
            const a = pos(l.a.dev);
            const b = pos(l.b.dev);
            const sel = selected?.kind === 'link' && selected.id === l.id;
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ux = (b.x - a.x) / len;
            const uy = (b.y - a.y) / len;
            const sa = engine.endState(l.a.dev, l.a.iface);
            const sb = engine.endState(l.b.dev, l.b.iface);
            const ea = exitDist(ux, uy);
            const eb = exitDist(-ux, -uy);
            const lightA = Math.min(ea + 7, len / 2 - 4);
            const lightB = Math.min(eb + 7, len / 2 - 4);
            const labA = Math.min(ea + 22, len / 2 - 2);
            const labB = Math.min(eb + 22, len / 2 - 2);
            // labels sit beside the cable, on its left-hand side
            const px = -uy * 11;
            const py = ux * 11;
            return (
              <g key={l.id} className="link" onPointerDown={(e) => onLinkDown(e, l)}>
                <path d={cablePath(a, b, l.cable)} className="link-hit" fill="none" />
                <path
                  d={cablePath(a, b, l.cable)}
                  fill="none"
                  className={`link-line${sel ? ' selected' : ''}`}
                  style={sel ? undefined : { stroke: CABLE_STYLE[l.cable].stroke, strokeWidth: CABLE_STYLE[l.cable].width }}
                  strokeDasharray={CABLE_STYLE[l.cable].dash}
                  strokeLinejoin="round"
                />
                {l.cable !== 'console' && (
                  <>
                    <circle cx={a.x + ux * lightA} cy={a.y + uy * lightA} r={5} className={`light ${sa}`} />
                    <circle cx={b.x - ux * lightB} cy={b.y - uy * lightB} r={5} className={`light ${sb}`} />
                  </>
                )}
                {l.dce && (() => {
                  const fromA = l.dce === 'a';
                  const base = fromA ? a : b;
                  const sgn = fromA ? 1 : -1;
                  const dist = (fromA ? lightA : lightB) + 16;
                  return (
                    <g transform={`translate(${base.x + sgn * ux * dist - px * 0.9} ${base.y + sgn * uy * dist - py * 0.9})`} pointerEvents="none">
                      <title>DCE end</title>
                      <circle r="6" fill="#fff" stroke="#d9434e" strokeWidth="1.4" />
                      <path d="M0 -3.4 V0 L2.4 1.4" stroke="#d9434e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                    </g>
                  );
                })()}
                {showLabels && l.cable !== 'wireless' && (
                  <>
                    <text x={a.x + ux * labA + px} y={a.y + uy * labA + py + 3.5} className="port-label">
                      {shortIf(l.a.iface)}
                    </text>
                    <text x={b.x - ux * labB + px} y={b.y - uy * labB + py + 3.5} className="port-label">
                      {shortIf(l.b.iface)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          <ShapeLayer shapes={shapes.filter((x) => x.kind !== 'zone')} k={view.k} selectedId={selected?.kind === 'shape' ? selected.id : null} h={shapeHandlers} />

          {drawing &&
            (() => {
              const conn = drawKind === 'line' || drawKind === 'arrow';
              const tiny = Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1) < 6;
              if (tiny && conn) return null;
              const preview = newShape(drawKind, drawing.x1, drawing.y1, drawing.x2, drawing.y2, drawIcon ?? undefined);
              return (
                <g opacity={0.6} pointerEvents="none">
                  <ShapeSvg s={preview} />
                </g>
              );
            })()}

          {cableFrom && mouse && (
            <path d={cablePath(pos(cableFrom.dev), mouse, cable)} fill="none" className="rubber" style={cable === 'auto' ? undefined : { stroke: CABLE_STYLE[cable].stroke }} strokeDasharray={CABLE_STYLE[cable].dash} />
          )}

          {notes.map((n) => (
            <foreignObject key={n.id} x={n.x} y={n.y} width={220} height={140} className="note-fo">
              <div
                className={`note${selected?.kind === 'note' && selected.id === n.id ? ' selected' : ''}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (getState().tool === 'delete') return deleteNote(n.id);
                  setState({ selected: { kind: 'note', id: n.id } });
                  if (editingNote === n.id) return;
                  const w = toWorld(e.clientX, e.clientY);
                  drag.current = { kind: 'note', id: n.id, dx: w.x - n.x, dy: w.y - n.y };
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onDoubleClick={() => setEditingNote(n.id)}
              >
                {editingNote === n.id ? (
                  <textarea
                    autoFocus
                    defaultValue={n.text}
                    onBlur={(e) => {
                      updateNote(n.id, { text: e.target.value });
                      setEditingNote(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
                    }}
                  />
                ) : (
                  n.text
                )}
              </div>
            </foreignObject>
          ))}

          {devices.map((d) => {
            const sel = selected?.kind === 'device' && selected.id === d.id;
            const marked = cableFrom?.dev === d.id || pduSrc === d.id;
            return (
              <g
                key={d.id}
                transform={`translate(${d.x} ${d.y})`}
                className={`device${sel ? ' selected' : ''}${marked ? ' marked' : ''}`}
                onPointerDown={(e) => onDeviceDown(e, d)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  clearTimeout(hoverTimer.current);
                  const r = svgRef.current!.getBoundingClientRect();
                  const sx = e.clientX - r.left;
                  const sy = e.clientY - r.top;
                  hoverTimer.current = setTimeout(() => !drag.current && setHover({ id: d.id, sx, sy }), 650);
                }}
                onPointerLeave={() => {
                  clearTimeout(hoverTimer.current);
                  setHover(null);
                }}
              >
                <rect x={-ICON / 2 - 4} y={-ICON / 2 + 6} width={ICON + 8} height={ICON + 12} rx={10} className="device-halo" />
                <g transform={`translate(${-ICON / 2} ${-ICON / 2}) scale(${ICON / 64})`}>
                  <DeviceArt kind={d.kind} model={d.model} />
                </g>
                <text y={ICON / 2 + 4} className="device-name">
                  {d.hostname}
                </text>
                <text y={ICON / 2 + 15} className="device-model">
                  {d.model}
                </text>
              </g>
            );
          })}

          {anim &&
            anim.pdus.map((p) => {
              if (p.status === 'drop') {
                const a = pos(p.from);
                return (
                  <g key={p.id} transform={`translate(${a.x + 22} ${a.y - 30})`} opacity={1 - animT * 0.3}>
                    <circle r={10} fill="var(--down)" />
                    <path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
                  </g>
                );
              }
              const a = pos(p.from);
              const b = pos(p.to);
              const t = easeInOut(animT);
              const x = a.x + (b.x - a.x) * t;
              const y = a.y + (b.y - a.y) * t;
              return (
                <g
                  key={p.id}
                  transform={`translate(${x - 13} ${y - 9})`}
                  className="envelope"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setState({ pduDetail: p });
                  }}
                >
                  <rect width={26} height={18} rx={2.5} fill={PDU_COLORS[p.kind]} stroke="#fff" strokeWidth={1.5} />
                  <path d="M1.5 2 L13 10 L24.5 2" stroke="#fff" strokeWidth={1.5} fill="none" />
                </g>
              );
            })}

          {placing && mouse && (
            <g transform={`translate(${mouse.x - ICON / 2} ${mouse.y - ICON / 2}) scale(${ICON / 64})`} opacity={0.5} pointerEvents="none">
              <DeviceArt kind={placing} model={getState().placingModel ?? undefined} />
            </g>
          )}
        </g>
      </svg>

      {!devices.length && !shapes.length && !placing && tool !== 'shape' && (
        <div className="empty-hint">
          <p className="empty-title">Start a topology</p>
          <p>Drag a router, switch or PC from the device bar below, or open a NetLab or Packet Tracer file from the File menu.</p>
        </div>
      )}

      {editingShape && shapes.find((x) => x.id === editingShape) && <ShapeTextEditor key={editingShape} s={shapes.find((x) => x.id === editingShape)!} view={view} />}
      <FormatBar />

      {picker && <PortPicker dev={engine.devices.get(picker.dev)!} x={picker.x} y={picker.y} onPick={pickPort} onClose={() => setState({ portPicker: null })} />}

      {hoverDev && hover && (
        <div className="tooltip" style={{ left: hover.sx + 18, top: hover.sy + 12 }}>
          <strong>{hoverDev.hostname}</strong>
          <span className="tooltip-model">{hoverDev.model}</span>
          <table>
            <tbody>
              {[...hoverDev.ifaces.values()]
                .filter((i) => i.linkId || i.ip !== undefined)
                .slice(0, 10)
                .map((i) => (
                  <tr key={i.name}>
                    <td>
                      <span className={`dot ${hoverDev.lineUp(i.name) ? 'up' : 'down'}`} />
                      {shortIf(i.name)}
                    </td>
                    <td>{i.ip !== undefined ? `${fmtIp(i.ip)}/${maskToPrefix(i.mask!)}` : i.swMode === 'trunk' ? 'trunk' : i.accessVlan !== undefined ? `VLAN ${i.accessVlan}` : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Cable geometry: serial gets a lightning kink, console a gentle curve, the rest are straight. */
function cablePath(a: { x: number; y: number }, b: { x: number; y: number }, cable: Link['cable']) {
  if (cable === 'serial-dce' || cable === 'serial-dte') {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const k = Math.min(12, len / 8);
    const p1 = { x: mx - ux * k + -uy * k, y: my - uy * k + ux * k };
    const p2 = { x: mx + ux * k + uy * k, y: my + uy * k - ux * k };
    return `M${a.x} ${a.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y} L${b.x} ${b.y}`;
  }
  if (cable === 'console') {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const bend = Math.min(40, len / 5);
    return `M${a.x} ${a.y} Q${mx + nx * bend} ${my + ny * bend} ${b.x} ${b.y}`;
  }
  return `M${a.x} ${a.y} L${b.x} ${b.y}`;
}

/** Distance from a device's centre to the edge of its icon-plus-label box along a direction. */
function exitDist(ux: number, uy: number) {
  const halfW = 34;
  const top = 22;
  const bottom = 50;
  const tx = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-6 ? (uy > 0 ? bottom : top) / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function PortPicker({ dev, x, y, onPick, onClose }: { dev: Device; x: number; y: number; onPick: (n: string) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const cable = getState().cable;
  const media = mediaForCable(cable);
  const ports = dev.allPorts().filter((p) => media.includes(mediaOf(p)));
  return (
    <div className="port-picker" style={{ left: x + 8, top: y + 8 }} onPointerDown={(e) => e.stopPropagation()} role="menu">
      <div className="port-picker-title">Choose a port on {dev.hostname}</div>
      <div className="port-picker-list">
        {ports.map((p) => {
          const peer = p.linkId ? engine.peer(dev.id, p.name) : null;
          const peerName = peer ? engine.devices.get(peer.dev)?.hostname : null;
          return (
            <button key={p.name} role="menuitem" disabled={!!p.linkId} onClick={() => onPick(p.name)}>
              <span>{p.name}</span>
              <span className="port-peer">{peerName ? `to ${peerName}` : mediaOf(p) === 'copper' ? '' : mediaOf(p) === 'rs232' ? 'RS-232' : mediaOf(p)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
