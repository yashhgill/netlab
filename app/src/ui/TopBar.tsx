import { useEffect } from 'react';
import { EXAMPLES } from '../examples';
import { Engine } from '../engine/engine';
import { serialize } from '../engine/topology';
import { isDesktop, openText, saveText } from '../platform';
import { currentFile, deleteSelected, newTopology, openTopology, setMode } from './actions';
import { canvasApi } from './Canvas';
import { UiIcon } from './icons';
import { askConfirm, engine, getState, setState, toast, useUi, type Tool } from './store';

export async function doSave() {
  const name = await saveText(`${getState().fileName}.nlab`, JSON.stringify(currentFile(), null, 1));
  if (name) {
    setState({ fileName: name.replace(/\.nlab$/i, ''), dirty: false });
    toast(`Saved ${name}`);
  }
}

export async function doOpen() {
  if (getState().dirty && !(await askConfirm('This topology has unsaved changes. Discard them?'))) return;
  const f = await openText();
  if (!f) return;
  try {
    openTopology(JSON.parse(f.text), f.name);
    setTimeout(() => canvasApi.fit(), 50);
  } catch {
    toast(`${f.name} could not be opened. It isn't a NetLab topology file.`, 'error');
  }
}

export async function doNew() {
  if (getState().dirty && !(await askConfirm('This topology has unsaved changes. Discard them?'))) return;
  newTopology();
}

export async function loadExample(id: string) {
  const ex = EXAMPLES.find((x) => x.id === id);
  if (!ex) return;
  if (getState().dirty && !(await askConfirm('This topology has unsaved changes. Discard them?'))) return;
  // build in a scratch engine, then load through the normal file path so ids/notes are consistent
  const scratch = new Engine();
  const notes = ex.build(scratch);
  scratch.runFor(8000);
  openTopology(serialize(scratch, notes), ex.title);
  setState({ dirty: false });
  setTimeout(() => canvasApi.fit(), 50);
}

const TOOLS: { id: Tool; label: string; key: string; icon: () => React.ReactElement }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: UiIcon.select },
  { id: 'note', label: 'Place note', key: 'N', icon: UiIcon.note },
  { id: 'delete', label: 'Delete', key: 'D', icon: UiIcon.trash },
  { id: 'pdu', label: 'Add simple PDU (ping)', key: 'P', icon: UiIcon.pdu },
];

export function TopBar() {
  const tool = useUi((s) => s.tool);
  const menu = useUi((s) => s.menu);
  const fileName = useUi((s) => s.fileName);
  const dirty = useUi((s) => s.dirty);
  const showLabels = useUi((s) => s.showLabels);
  useUi((s) => s.engineVersion);
  const mode = engine.mode;

  const setTool = (t: Tool) => setState({ tool: t, cableFrom: null, pduSrc: null, placing: null, portPicker: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const typing = tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        doOpen();
        return;
      }
      if (typing || mod) return;
      if (e.key === 'Escape') setTool('select');
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else {
        const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (t) setTool(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleMenu = (m: string) => setState({ menu: menu === m ? null : m });
  const item = (label: string, fn: () => void, hint?: string) => (
    <button
      role="menuitem"
      onClick={() => {
        setState({ menu: null });
        fn();
      }}
    >
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
  const modKey = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="3" fill="#7FD6CF" />
          <circle cx="19" cy="5" r="3" fill="#A9ADF2" />
          <circle cx="19" cy="19" r="3" fill="#F2C14E" />
          <path d="M8 12 L16 6 M8 12 L16 18" stroke="#DCE6EE" strokeWidth="1.8" />
        </svg>
        <span className="brand-name">NetLab</span>
      </div>
      <nav className="menus" onPointerDown={(e) => e.stopPropagation()}>
        {['File', 'Edit', 'View', 'Help'].map((m) => (
          <div key={m} className="menu">
            <button className={`menu-btn${menu === m ? ' on' : ''}`} onClick={() => toggleMenu(m)} aria-haspopup="menu" aria-expanded={menu === m}>
              {m}
            </button>
            {menu === m && (
              <div className="menu-pop" role="menu">
                {m === 'File' && (
                  <>
                    {item('New topology', doNew)}
                    {item('Open…', doOpen, `${modKey}O`)}
                    {item('Save', doSave, `${modKey}S`)}
                    <div className="menu-sep" />
                    <div className="menu-label">Example labs</div>
                    {EXAMPLES.map((ex) => (
                      <button key={ex.id} role="menuitem" className="menu-example" onClick={() => (setState({ menu: null }), loadExample(ex.id))}>
                        <span>{ex.title}</span>
                        <small>{ex.summary}</small>
                      </button>
                    ))}
                  </>
                )}
                {m === 'Edit' && (
                  <>
                    {item('Delete selection', deleteSelected, 'Del')}
                    {item('Clear event list', () => engine.clearLog())}
                  </>
                )}
                {m === 'View' && (
                  <>
                    {item(showLabels ? 'Hide port labels' : 'Show port labels', () => setState({ showLabels: !showLabels }))}
                    {item('Zoom in', () => canvasApi.zoom(1.2))}
                    {item('Zoom out', () => canvasApi.zoom(1 / 1.2))}
                    {item('Fit topology', () => canvasApi.fit())}
                  </>
                )}
                {m === 'Help' && (
                  <>
                    {item('Keyboard shortcuts', () => setState({ dialog: 'shortcuts' }))}
                    {item('About NetLab', () => setState({ dialog: 'about' }))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="toolbar" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool${tool === t.id ? ' on' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id}>
            <t.icon />
          </button>
        ))}
        <span className="toolbar-sep" />
        <button className="tool" onClick={() => canvasApi.zoom(1.2)} title="Zoom in">
          <UiIcon.zoomIn />
        </button>
        <button className="tool" onClick={() => canvasApi.zoom(1 / 1.2)} title="Zoom out">
          <UiIcon.zoomOut />
        </button>
        <button className="tool" onClick={() => canvasApi.fit()} title="Fit topology">
          <UiIcon.fit />
        </button>
      </div>

      <div className="file-title" title={isDesktop ? 'Desktop app' : 'Browser'}>
        {fileName}
        {dirty && <span className="dirty" aria-label="Unsaved changes" />}
      </div>

      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        <span className="clock">{formatClock(engine.now)}</span>
        <button role="radio" aria-checked={mode === 'realtime'} className={mode === 'realtime' ? 'on' : ''} onClick={() => setMode('realtime')}>
          Realtime
        </button>
        <button role="radio" aria-checked={mode === 'simulation'} className={mode === 'simulation' ? 'on sim' : ''} onClick={() => setMode('simulation')}>
          Simulation
        </button>
      </div>
    </header>
  );
}

function formatClock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
