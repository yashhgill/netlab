/**
 * Picture exports of the workspace (network + diagram): SVG, PNG and PDF.
 * The live SVG is cloned, editing handles are stripped, styles that come from
 * CSS are written inline, and sticky notes become plain SVG so every viewer
 * (and the PNG/PDF renderer) shows the same thing.
 */
import { getState } from '../ui/store';
import { saveBlob } from '../platform';
import { wrapText } from './shapes';

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'paint-order', 'stroke-linejoin', 'stroke-linecap'];
const NS = 'http://www.w3.org/2000/svg';

export interface Picture {
  svg: string;
  width: number;
  height: number;
}

/** The current workspace as a standalone SVG document. */
export function workspaceSvg(): Picture | null {
  const live = document.querySelector('svg.canvas g.canvas-world') as SVGGElement | null;
  if (!live) return null;
  const bb = live.getBBox();
  if (!bb.width || !bb.height) return null;
  const pad = 24;
  const x = Math.floor(bb.x - pad);
  const y = Math.floor(bb.y - pad);
  const w = Math.ceil(bb.width + pad * 2);
  const h = Math.ceil(bb.height + pad * 2);

  const clone = live.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');
  // inline computed styles (walk both trees in step)
  const a = [live, ...live.querySelectorAll('*')] as Element[];
  const b = [clone, ...clone.querySelectorAll('*')] as Element[];
  a.forEach((el, i) => {
    if (!el.getAttribute('class')) return;
    const cs = getComputedStyle(el);
    const parts = STYLE_PROPS.map((p) => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${p === 'font-family' ? 'IBM Plex Sans, Arial, sans-serif' : v}` : '';
    }).filter(Boolean);
    if (cs.display === 'none' || cs.visibility === 'hidden') parts.push('display:none');
    b[i].setAttribute('style', `${parts.join(';')};${b[i].getAttribute('style') ?? ''}`);
  });
  // strip editing furniture
  clone.querySelectorAll('.shape-handle, .shape-sel, .link-hit, .device-halo, .rubber').forEach((n) => n.remove());
  // notes: HTML inside foreignObject -> SVG
  clone.querySelectorAll('foreignObject').forEach((fo) => {
    const nx = Number(fo.getAttribute('x'));
    const ny = Number(fo.getAttribute('y'));
    const text = (fo.textContent ?? '').trim();
    const lines = wrapText(text, 200, 12.5);
    const g = document.createElementNS(NS, 'g');
    const r = document.createElementNS(NS, 'rect');
    const bw = Math.min(220, Math.max(60, Math.max(...lines.map((l) => l.length)) * 7.2 + 20));
    const bh = lines.length * 16 + 16;
    Object.entries({ x: nx, y: ny, width: bw, height: bh, rx: 6, fill: '#fff8d9', stroke: '#ecdc9a' }).forEach(([k, v]) => r.setAttribute(k, String(v)));
    g.appendChild(r);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('font-size', '12.5');
    t.setAttribute('font-family', 'IBM Plex Sans, Arial, sans-serif');
    t.setAttribute('fill', '#3b3520');
    lines.forEach((l, i) => {
      const sp = document.createElementNS(NS, 'tspan');
      sp.setAttribute('x', String(nx + 10));
      sp.setAttribute('y', String(ny + 20 + i * 16));
      sp.textContent = l;
      t.appendChild(sp);
    });
    g.appendChild(t);
    fo.replaceWith(g);
  });
  const body = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
  return { svg, width: w, height: h };
}

export async function pictureToPng(p: Picture, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('The picture could not be drawn.'));
      img.src = url;
    });
    // keep the bitmap within browser limits on big diagrams
    const k = Math.min(scale, 8000 / Math.max(p.width, p.height));
    const c = document.createElement('canvas');
    c.width = Math.round(p.width * k);
    c.height = Math.round(p.height * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const base = () => getState().fileName || 'netlab';

export async function exportPicture(kind: 'svg' | 'png' | 'pdf'): Promise<string | null> {
  const p = workspaceSvg();
  if (!p) throw new Error('There is nothing on the workspace to export yet.');
  if (kind === 'svg') return saveBlob(`${base()}.svg`, new Blob([p.svg], { type: 'image/svg+xml' }), 'SVG picture');
  const png = await pictureToPng(p, 2);
  if (kind === 'png') return saveBlob(`${base()}.png`, png, 'PNG picture');
  const { jsPDF } = await import('jspdf');
  const landscape = p.width >= p.height;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = 36;
  doc.setFontSize(14);
  doc.text(base(), m, m);
  const k = Math.min((pw - m * 2) / p.width, (ph - m * 2 - 20) / p.height);
  const data = new Uint8Array(await png.arrayBuffer());
  doc.addImage(data, 'PNG', (pw - p.width * k) / 2, m + 16, p.width * k, p.height * k, undefined, 'FAST');
  return saveBlob(`${base()}.pdf`, doc.output('blob'), 'PDF document');
}
