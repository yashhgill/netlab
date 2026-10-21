import { useEffect, useRef } from 'react';
import { getState, setState, useUi } from '../ui/store';
import { arrangeShape, connectorEnds, deleteShape, duplicateShape, updateShape } from './actions';
import { IconArt, ShapeGlyph } from './iconArt';
import { FILLS, ICONS, SHAPE_TOOLS, STROKES, isConnector, wrapText, type Shape } from './shapes';

type Ends = { x1: number; y1: number; x2: number; y2: number };

/** One shape as plain SVG (also used for exports, so no CSS classes for looks). */
export function ShapeSvg({ s, ends }: { s: Shape; ends?: Ends }) {
  const stroke = s.stroke && s.stroke !== 'none' ? s.stroke : undefined;
  const fill = s.fill && s.fill !== 'none' ? s.fill : 'none';
  const dash = s.dashed ? '7 5' : undefined;
  const fs = s.fontSize ?? 14;
  const color = s.color ?? '#1f2933';
  if (isConnector(s)) {
    const e = ends ?? { x1: s.x, y1: s.y, x2: s.x2 ?? s.x, y2: s.y2 ?? s.y };
    const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
    const ux = (e.x2 - e.x1) / len;
    const uy = (e.y2 - e.y1) / len;
    const sw = 2;
    const head = s.kind === 'arrow' ? `M${e.x2} ${e.y2} L${e.x2 - ux * 12 - uy * 6} ${e.y2 - uy * 12 + ux * 6} L${e.x2 - ux * 12 + uy * 6} ${e.y2 - uy * 12 - ux * 6} Z` : null;
    const lx = (e.x1 + e.x2) / 2;
    const ly = (e.y1 + e.y2) / 2;
    return (
      <g>
        <path d={`M${e.x1} ${e.y1} L${s.kind === 'arrow' ? e.x2 - ux * 10 : e.x2} ${s.kind === 'arrow' ? e.y2 - uy * 10 : e.y2}`} stroke={stroke ?? '#34404c'} strokeWidth={sw} strokeDasharray={dash} fill="none" strokeLinecap="round" />
        {head && <path d={head} fill={stroke ?? '#34404c'} />}
        {s.text && (
          <g>
            <rect x={lx - (s.text.length * fs * 0.56) / 2 - 4} y={ly - fs * 0.75} width={s.text.length * fs * 0.56 + 8} height={fs * 1.4} rx="3" fill="#ffffff" opacity="0.92" />
            <text x={lx} y={ly + fs * 0.35} textAnchor="middle" fontSize={fs} fill={color} fontFamily="IBM Plex Sans, system-ui, sans-serif">
              {s.text}
            </text>
          </g>
        )}
      </g>
    );
  }
  const { x, y, w, h } = s;
  const lines = s.text ? wrapText(s.text, s.kind === 'zone' ? w - 20 : s.kind === 'icon' ? w + 90 : s.kind === 'diamond' ? w * 0.62 : w - 12, fs) : [];
  const lh = fs * 1.25;
  let body: React.ReactNode = null;
  switch (s.kind) {
    case 'rect':
    case 'round':
      body = <rect x={x} y={y} width={w} height={h} rx={s.kind === 'round' ? Math.min(12, h / 4) : 0} fill={fill} stroke={stroke} strokeWidth={1.6} strokeDasharray={dash} />;
      break;
    case 'zone':
      body = <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} fillOpacity={0.45} stroke={stroke} strokeWidth={1.8} strokeDasharray={dash} />;
      break;
    case 'ellipse':
      body = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={1.6} strokeDasharray={dash} />;
      break;
    case 'diamond':
      body = <path d={`M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z`} fill={fill} stroke={stroke} strokeWidth={1.6} strokeDasharray={dash} />;
      break;
    case 'icon':
      body = (
        <g transform={`translate(${x} ${y}) scale(${w / 64} ${h / 64})`}>
          {s.icon && <IconArt id={s.icon} />}
        </g>
      );
      break;
    case 'text':
      body = null;
      break;
  }
  // text placement: zones label top-left, icons below, others centred
  let text: React.ReactNode = null;
  if (lines.length) {
    const ff = 'IBM Plex Sans, system-ui, sans-serif';
    if (s.kind === 'zone') {
      text = (
        <text x={x + 12} y={y + 10 + fs} fontSize={fs} fill={color} fontWeight={600} fontFamily={ff}>
          {lines.map((l, i) => (
            <tspan key={i} x={x + 12} dy={i ? lh : 0}>
              {l}
            </tspan>
          ))}
        </text>
      );
    } else {
      const top = s.kind === 'icon' ? y + h + fs + 2 : y + h / 2 - ((lines.length - 1) * lh) / 2 + fs * 0.35;
      text = (
        <text x={x + w / 2} y={top} fontSize={fs} fill={color} textAnchor="middle" fontWeight={s.kind === 'icon' ? 500 : 400} fontFamily={ff}>
          {lines.map((l, i) => (
            <tspan key={i} x={x + w / 2} dy={i ? lh : 0}>
              {l}
            </tspan>
          ))}
        </text>
      );
    }
  }
  return (
    <g>
      {body}
      {text}
    </g>
  );
}

export interface ShapeHandlers {
  onDown: (e: React.PointerEvent, s: Shape) => void;
  onHandle: (e: React.PointerEvent, s: Shape, handle: 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to') => void;
  onDouble: (s: Shape) => void;
}

/** Shapes in one layer (zones behind the network, everything else above the cables). */
export function ShapeLayer({ shapes, k, selectedId, h }: { shapes: Shape[]; k: number; selectedId: string | null; h: ShapeHandlers }) {
  return (
    <g>
      {shapes.map((s) => {
        const sel = s.id === selectedId;
        const ends = isConnector(s) ? connectorEnds(s) : undefined;
        const r = 6 / k;
        return (
          <g key={s.id} className={`shape${sel ? ' selected' : ''}`} onPointerDown={(e) => h.onDown(e, s)} onDoubleClick={() => h.onDouble(s)}>
            {ends ? (
              <path d={`M${ends.x1} ${ends.y1} L${ends.x2} ${ends.y2}`} stroke="transparent" strokeWidth={14 / k + 6} fill="none" />
            ) : (
              s.kind !== 'icon' && <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.kind === 'zone' ? 'none' : 'transparent'} stroke={s.kind === 'zone' ? 'transparent' : 'none'} strokeWidth={s.kind === 'zone' ? 14 / k : 0} />
            )}
            {s.kind === 'icon' && <rect x={s.x} y={s.y} width={s.w} height={s.h + (s.text ? (s.fontSize ?? 12) + 6 : 0)} fill="transparent" />}
            {s.kind === 'zone' && <rect x={s.x} y={s.y} width={Math.min(s.w, 220)} height={Math.min(s.h, 34)} fill="transparent" />}
            <g pointerEvents={s.kind === 'zone' ? 'none' : undefined}>
              <ShapeSvg s={s} ends={ends} />
            </g>
            {sel &&
              (ends ? (
                <g>
                  {(['from', 'to'] as const).map((w) => (
                    <circle key={w} cx={w === 'from' ? ends.x1 : ends.x2} cy={w === 'from' ? ends.y1 : ends.y2} r={r} className="shape-handle" onPointerDown={(e) => h.onHandle(e, s, w)} />
                  ))}
                </g>
              ) : (
                <g>
                  <rect x={s.x} y={s.y} width={s.w} height={s.h} className="shape-sel" strokeWidth={1.2 / k} strokeDasharray={`${4 / k} ${3 / k}`} />
                  {(
                    [
                      ['nw', s.x, s.y],
                      ['ne', s.x + s.w, s.y],
                      ['sw', s.x, s.y + s.h],
                      ['se', s.x + s.w, s.y + s.h],
                    ] as const
                  ).map(([c, cx, cy]) => (
                    <rect key={c} x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={r * 0.3} className={`shape-handle ${c}`} onPointerDown={(e) => h.onHandle(e, s, c)} />
                  ))}
                </g>
              ))}
          </g>
        );
      })}
    </g>
  );
}

/** Text editor laid over a shape while its text is being changed. */
export function ShapeTextEditor({ s, view }: { s: Shape; view: { x: number; y: number; k: number } }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const ends = isConnector(s) ? connectorEnds(s) : null;
  const box = ends ? { x: (ends.x1 + ends.x2) / 2 - 80, y: (ends.y1 + ends.y2) / 2 - 18, w: 160, h: 36 } : s.kind === 'icon' ? { x: s.x - 40, y: s.y + s.h + 2, w: s.w + 80, h: 40 } : { x: s.x, y: s.y, w: Math.max(s.w, 120), h: Math.max(s.h, 36) };
  const done = (v: string) => {
    updateShape(s.id, { text: v });
    setState({ editingShape: null });
  };
  return (
    <textarea
      ref={ref}
      className="shape-text-editor"
      defaultValue={s.text ?? ''}
      style={{ left: box.x * view.k + view.x, top: box.y * view.k + view.y, width: box.w * view.k, height: box.h * view.k, fontSize: Math.max(12, (s.fontSize ?? 14) * view.k) }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => done(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && s.kind !== 'zone' && s.kind !== 'rect' && s.kind !== 'round')) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      aria-label="Shape text"
    />
  );
}

/** Formatting bar for the selected shape. */
export function FormatBar() {
  const sel = useUi((s) => s.selected);
  const shapes = useUi((s) => s.shapes);
  if (sel?.kind !== 'shape') return null;
  const s = shapes.find((x) => x.id === sel.id);
  if (!s) return null;
  const conn = isConnector(s);
  const swatch = (c: string, on: boolean, set: () => void, label: string) => (
    <button key={c} className={`swatch${on ? ' on' : ''}${c === 'none' ? ' none' : ''}`} style={c === 'none' ? undefined : { background: c }} onClick={set} title={label} aria-label={label} />
  );
  return (
    <div className="format-bar" onPointerDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Shape format">
      {!conn && s.kind !== 'icon' && s.kind !== 'text' && (
        <div className="fb-group">
          <span className="fb-label">Fill</span>
          {FILLS.map((c) => swatch(c, (s.fill ?? 'none') === c, () => updateShape(s.id, { fill: c }), c === 'none' ? 'No fill' : `Fill ${c}`))}
        </div>
      )}
      {s.kind !== 'icon' && s.kind !== 'text' && (
        <div className="fb-group">
          <span className="fb-label">{conn ? 'Line' : 'Border'}</span>
          {STROKES.filter((c) => !(conn && c === 'none')).map((c) => swatch(c, (s.stroke ?? 'none') === c, () => updateShape(s.id, { stroke: c }), c === 'none' ? 'No border' : `Colour ${c}`))}
          <button className={`fb-btn${s.dashed ? ' on' : ''}`} onClick={() => updateShape(s.id, { dashed: !s.dashed })} title="Dashed">
            - -
          </button>
        </div>
      )}
      {conn && (
        <div className="fb-group">
          <button className={`fb-btn${s.kind === 'arrow' ? ' on' : ''}`} onClick={() => updateShape(s.id, { kind: s.kind === 'arrow' ? 'line' : 'arrow' })} title="Arrow head">
            →
          </button>
        </div>
      )}
      <div className="fb-group">
        <button className="fb-btn" onClick={() => setState({ editingShape: s.id })} title="Edit text">
          Text
        </button>
        <button className="fb-btn" onClick={() => updateShape(s.id, { fontSize: Math.max(9, (s.fontSize ?? 14) - 2) })} title="Smaller text" aria-label="Smaller text">
          A−
        </button>
        <button className="fb-btn" onClick={() => updateShape(s.id, { fontSize: Math.min(48, (s.fontSize ?? 14) + 2) })} title="Bigger text" aria-label="Bigger text">
          A+
        </button>
      </div>
      <div className="fb-group">
        <button className="fb-btn" onClick={() => arrangeShape(s.id, 'front')} title="Bring to front">
          Front
        </button>
        <button className="fb-btn" onClick={() => arrangeShape(s.id, 'back')} title="Send to back">
          Back
        </button>
        <button className="fb-btn" onClick={() => duplicateShape(s.id)} title="Duplicate">
          Copy
        </button>
        <button className="fb-btn danger" onClick={() => deleteShape(s.id)} title="Delete">
          Delete
        </button>
      </div>
    </div>
  );
}

/** Flyout next to the tool palette: shapes and the drawing-only icon library. */
export function ShapePicker() {
  const open = useUi((s) => s.shapeMenu);
  const tool = useUi((s) => s.tool);
  const kind = useUi((s) => s.drawKind);
  const icon = useUi((s) => s.drawIcon);
  if (!open) return null;
  const pick = (p: Partial<ReturnType<typeof getState>>) => setState({ tool: 'shape', shapeMenu: false, placing: null, placingModel: null, cableFrom: null, selected: null, ...p });
  return (
    <div className="shape-picker" onPointerDown={(e) => e.stopPropagation()} role="menu" aria-label="Draw">
      <div className="sp-title">Shapes</div>
      <div className="sp-grid">
        {SHAPE_TOOLS.map((t) => (
          <button key={t.kind} role="menuitem" className={`sp-item${tool === 'shape' && kind === t.kind && !icon ? ' on' : ''}`} onClick={() => pick({ drawKind: t.kind, drawIcon: null })} title={t.label}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <ShapeGlyph kind={t.kind} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="sp-title">Icons (drawing only)</div>
      <div className="sp-grid">
        {ICONS.map((i) => (
          <button key={i.id} role="menuitem" className={`sp-item${tool === 'shape' && icon === i.id ? ' on' : ''}`} onClick={() => pick({ drawKind: 'icon', drawIcon: i.id })} title={i.label}>
            <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
              <IconArt id={i.id} />
            </svg>
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      <p className="sp-hint">Drag on the workspace to draw. Lines and arrows snap to devices and shapes. Double-click to type.</p>
    </div>
  );
}
