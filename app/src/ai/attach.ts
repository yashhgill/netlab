/**
 * Read files people give the AI: pictures (topology drawings, screenshots, photos of a lab
 * sheet), PDFs, Word and PowerPoint files, and plain text. Everything is read here in the
 * browser; only the text and small copies of the pictures are sent to the AI.
 */
import { unzipSync, strFromU8 } from 'fflate';

export interface Attachment {
  id: number;
  name: string;
  /** Text read from the file. */
  text: string;
  /** Pictures as JPEG data URLs. */
  images: string[];
  /** Short summary for the chip, e.g. "3 pages" or "picture". */
  info: string;
}

/** The AI reads at most this many pictures per question. */
export const MAX_IMAGES = 3;
export const MAX_TEXT = 12000;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_SIDE = 1600;

export const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.docx,.pptx,.txt,.md,.csv,.cfg,.conf,.log,.json,image/*,application/pdf';

let seq = 0;

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

/** Draw an image source onto a canvas no bigger than MAX_SIDE and return a JPEG data URL. */
function toJpeg(src: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

async function imageFromBlob(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('That picture could not be opened.'));
      img.src = url;
    });
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

/** Word: paragraphs become lines and table cells are separated by " | ". */
export function docxText(xml: string): string {
  return decode(
    xml
      .replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ \| \n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pptxText(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides
    .map((n, i) => {
      const xml = strFromU8(files[n]);
      const parts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>|<\/a:p>/g)].map((m) => (m[1] !== undefined ? decode(m[1]) : '\n'));
      return `Slide ${i + 1}:\n${parts.join('').replace(/\n{2,}/g, '\n').trim()}`;
    })
    .join('\n\n');
}

async function officeMedia(files: Record<string, Uint8Array>, folder: string): Promise<string[]> {
  const pics = Object.keys(files)
    .filter((n) => n.startsWith(folder) && /\.(png|jpe?g|gif|bmp)$/i.test(n))
    .sort((a, b) => files[b].length - files[a].length) // biggest first: diagrams over icons
    .slice(0, MAX_IMAGES);
  const out: string[] = [];
  for (const n of pics) {
    if (files[n].length < 4000) continue; // skip tiny logos and bullets
    const type = /\.png$/i.test(n) ? 'image/png' : /\.gif$/i.test(n) ? 'image/gif' : /\.bmp$/i.test(n) ? 'image/bmp' : 'image/jpeg';
    try {
      out.push(await imageFromBlob(new Blob([files[n] as BlobPart], { type })));
    } catch {
      /* unreadable picture: skip */
    }
  }
  return out;
}

async function readPdf(file: File): Promise<{ text: string; images: string[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const texts: string[] = [];
  const pageText: number[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
      if (it.str === undefined) continue;
      line += it.str;
      if (it.hasEOL) {
        lines.push(line);
        line = '';
      } else line += ' ';
    }
    if (line.trim()) lines.push(line);
    const t = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    pageText.push(t.length);
    texts.push(`Page ${p}:\n${t}`);
  }
  // Pictures of the pages: lab sheets usually draw the topology, so the AI sees the first pages.
  // Scanned PDFs (pages with no text) are sent as pictures first.
  const order = [...pageText.keys()].sort((a, b) => (pageText[a] < 40 ? 0 : 1) - (pageText[b] < 40 ? 0 : 1) || a - b);
  const images: string[] = [];
  for (const i of order.slice(0, Math.min(MAX_IMAGES, doc.numPages))) {
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2.5, MAX_SIDE / Math.max(base.width, base.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp, canvas: c }).promise;
    images.push(c.toDataURL('image/jpeg', 0.85));
  }
  return { text: texts.join('\n\n'), images, pages: doc.numPages };
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is bigger than 25 MB.`);
  const e = ext(file.name);
  const base = { id: ++seq, name: file.name };
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) {
    return { ...base, text: '', images: [await imageFromBlob(file)], info: 'picture' };
  }
  if (e === 'pdf' || file.type === 'application/pdf') {
    const r = await readPdf(file);
    return { ...base, text: r.text, images: r.images, info: `${r.pages} page${r.pages === 1 ? '' : 's'}` };
  }
  if (e === 'docx' || e === 'pptx') {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    if (e === 'docx') {
      const xml = files['word/document.xml'];
      if (!xml) throw new Error(`${file.name} is not a Word document NetLab can read.`);
      const text = docxText(strFromU8(xml));
      const images = await officeMedia(files, 'word/media/');
      return { ...base, text, images, info: images.length ? `document, ${images.length} picture${images.length === 1 ? '' : 's'}` : 'document' };
    }
    const text = pptxText(files);
    const images = await officeMedia(files, 'ppt/media/');
    return { ...base, text, images, info: 'slides' };
  }
  if (['txt', 'md', 'csv', 'cfg', 'conf', 'log', 'json'].includes(e) || file.type.startsWith('text/')) {
    return { ...base, text: (await file.text()).slice(0, MAX_TEXT), images: [], info: 'text' };
  }
  if (e === 'doc' || e === 'ppt') throw new Error(`${file.name} is an old Office file. Save it as .docx or .pptx, or as a PDF, and attach it again.`);
  throw new Error(`NetLab can't read ${file.name}. Attach a picture, a PDF, a Word or PowerPoint file, or a text file.`);
}

/** Combine attachments into what's sent to the AI, within its limits. */
export function bundle(list: Attachment[]) {
  const images = list.flatMap((a) => a.images).slice(0, MAX_IMAGES);
  let text = list
    .filter((a) => a.text.trim())
    .map((a) => `--- ${a.name} ---\n${a.text.trim()}`)
    .join('\n\n');
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n[the rest of the document was cut off]`;
  return { images, text, names: list.map((a) => a.name) };
}
