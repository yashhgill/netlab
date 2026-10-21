import { useEffect, useState } from 'react';
import { CABLE_LABEL, type CableType } from '../engine/engine';
import { MODELS, type Category, type ModelSpec } from '../engine/models';
import { describeScenario, fastForward, fireScenario, powerCycleAll, removeScenario, setMode } from './actions';
import { CableSwatch, DeviceGlyph, UiIcon } from './icons';
import { askConfirm, engine, setState, togglePanel, useUi, type Panels } from './store';
import { canvasApi } from './Canvas';

type Top = 'network' | 'end' | 'connections';

let dragJustEnded = false;

/**
 * Drag a device from the picker onto the workspace with mouse, pen or finger.
 * A ghost icon follows the pointer; releasing over the workspace places the device.
 */
function startDeviceDrag(e: React.PointerEvent, m: ModelSpec) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const src = (e.currentTarget as HTMLElement).querySelector('svg');
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      // touch: horizontal swipes scroll the picker, so only an upward drag picks a device up
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.hypot(dx, dy) < 8) return;
      if (ev.pointerType === 'touch' && !(dy < -8 && Math.abs(dy) > Math.abs(dx))) {
        cleanup();
        return;
      }
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      if (src) ghost.appendChild(src.cloneNode(true));
      document.body.appendChild(ghost);
    }
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX - 32}px, ${ev.clientY - 32}px)`;
  };
  const up = (ev: PointerEvent) => {
    if (ghost) {
      ghost.remove();
      canvasApi.dropAt(m.kind, m.id, ev.clientX, ev.clientY);
      dragJustEnded = true;
      setTimeout(() => (dragJustEnded = false), 50);
    }
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const cancel = () => {
    ghost?.remove();
    cleanup();
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

const SUBS: Record<Top, { id: Category; label: string; kind: ModelSpec['kind']; model: string }[]> = {
  network: [
    { id: 'routers', label: 'Routers', kind: 'router', model: 'NL-R1900' },
    { id: 'switches', label: 'Switches', kind: 'switch', model: 'NL-S2400' },
    { id: 'hubs', label: 'Hubs', kind: 'hub', model: 'NL-H800' },
    { id: 'wireless', label: 'Wireless', kind: 'ap', model: 'NL-AP' },
  ],
  end: [{ id: 'end', label: 'End devices', kind: 'pc', model: 'NL-PC' }],
  connections: [],
};

const CABLES: { type: CableType; detail: string }[] = [
  { type: 'auto', detail: 'Picks free ports and the right cable for you' },
  { type: 'console', detail: 'PC RS-232 to a router or switch Console port' },
  { type: 'straight', detail: 'PC, router or server to a switch or hub' },
  { type: 'cross', detail: 'Like to like: switch to switch, PC to PC, router to router or PC' },
  { type: 'fiber', detail: 'Between fiber (SFP) ports' },
  { type: 'serial-dce', detail: 'Router serial ports; the first end you click is the DCE' },
  { type: 'serial-dte', detail: 'Router serial ports; the first end you click is the DTE' },
];

export function Dock() {
  const [top, setTop] = useState<Top>('network');
  const [sub, setSub] = useState<Category>('routers');
  const [hover, setHover] = useState<string>('');
  const placing = useUi((s) => s.placing);
  const placingModel = useUi((s) => s.placingModel);
  const tool = useUi((s) => s.tool);
  const cable = useUi((s) => s.cable);
  const scenarios = useUi((s) => s.scenarios);
  useUi((s) => s.engineVersion);

  const panels = useUi((s) => s.panels);
  const wide = useWide();
  const chooseTop = (t: Top) => {
    setTop(t);
    if (SUBS[t][0]) setSub(SUBS[t][0].id);
  };
  const models = MODELS.filter((m) => m.category === sub);
  const caption = hover || (top === 'connections' ? (tool === 'cable' ? CABLE_LABEL[cable] : 'Choose a cable') : placingModel ?? 'Drag a device onto the workspace');

  const any = panels.devices || panels.pdus || panels.mode;
  // desktop: columns follow whichever sections are open
  const cols = [panels.devices ? 'auto minmax(0, 1fr)' : '', panels.pdus ? 'minmax(240px, 28%)' : '', panels.mode ? 'auto' : ''].filter(Boolean).join(' ');
  const onlySmall = !panels.devices && !panels.pdus;
  return (
    <footer className="dock-wrap">
      <DockBar panels={panels} pdus={scenarios.length} />
      {any && (
    <div className={`dock${onlySmall ? ' short' : ''}`} style={wide ? { gridTemplateColumns: cols } : undefined}>
      {panels.devices && (
      <>
      <div className="dock-picker">
        <div className="dock-tops" role="tablist" aria-label="Device types">
          {(
            [
              ['network', 'Network devices', <DeviceGlyph key="n" kind="router" model="NL-R3000" size={34} />],
              ['end', 'End devices', <DeviceGlyph key="e" kind="pc" size={34} />],
              ['connections', 'Connections', <CableSwatch key="c" type="auto" big />],
            ] as [Top, string, React.ReactNode][]
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={top === id} className={`dock-top${top === id ? ' on' : ''}`} onClick={() => chooseTop(id)} title={label}>
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
        {SUBS[top].length > 1 && (
          <div className="dock-subs" role="tablist" aria-label="Device families">
            {SUBS[top].map((s) => (
              <button key={s.id} role="tab" aria-selected={sub === s.id} className={`dock-sub${sub === s.id ? ' on' : ''}`} onClick={() => setSub(s.id)}>
                <DeviceGlyph kind={s.kind} model={s.model} size={24} />
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="dock-strip-wrap">
        <div className="dock-strip" onMouseLeave={() => setHover('')}>
          {top === 'connections'
            ? CABLES.map((c) => (
                <button
                  key={c.type}
                  className={`dock-item cable${tool === 'cable' && cable === c.type ? ' on' : ''}`}
                  onClick={() => setState({ tool: 'cable', cable: c.type, cableFrom: null, placing: null, portPicker: null })}
                  onMouseEnter={() => setHover(`${CABLE_LABEL[c.type]}: ${c.detail}`)}
                  aria-label={CABLE_LABEL[c.type]}
                >
                  <span className="cable-swatch">
                    <CableSwatch type={c.type} big />
                  </span>
                  <span className="dock-item-label">{CABLE_LABEL[c.type]}</span>
                </button>
              ))
            : models.map((m) => (
                <button
                  key={m.id}
                  className={`dock-item${placing && placingModel === m.id ? ' on' : ''}`}
                  onPointerDown={(e) => startDeviceDrag(e, m)}
                  onClick={() => {
                    if (dragJustEnded) return;
                    setState(placing && placingModel === m.id ? { placing: null, placingModel: null } : { placing: m.kind, placingModel: m.id, tool: 'select', cableFrom: null });
                  }}
                  onMouseEnter={() => setHover(`${m.label}: ${m.detail}`)}
                  aria-label={`${m.label}, ${m.detail}`}
                >
                  <DeviceGlyph kind={m.kind} model={m.id} size={50} />
                  <span className="dock-item-label">{m.label}</span>
                </button>
              ))}
        </div>
        <div className="dock-caption">{caption}</div>
      </div>
      </>
      )}

      {panels.pdus && (
      <div className="scenarios">
        <div className="scenarios-head">
          <span>Simple PDUs</span>
          <button className="link-btn" onClick={() => setState({ tool: 'pdu', pduSrc: null })}>
            Add
          </button>
        </div>
        {scenarios.length ? (
          <table className="grid-table compact">
            <thead>
              <tr>
                <th>Status</th>
                <th>Source</th>
                <th>Destination</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {scenarios.map((sc) => {
                const d = describeScenario(sc);
                return (
                  <tr key={sc.id}>
                    <td>
                      <span className={`status ${sc.status.replace(' ', '-').toLowerCase()}`}>{sc.status}</span>
                    </td>
                    <td>{d.a}</td>
                    <td title={d.ip}>{d.b}</td>
                    <td className="nowrap">
                      <button className="link-btn" onClick={() => fireScenario(sc.id)}>
                        Fire
                      </button>
                      <button className="link-btn danger" onClick={() => removeScenario(sc.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted small">Choose Add, click a source device, then a destination to send one ping.</p>
        )}
      </div>
      )}

      {panels.mode && <ModeBox />}
    </div>
      )}
    </footer>
  );
}

function useWide() {
  const q = '(min-width: 761px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Thin bar above the dock: show or hide each section, or everything at once. */
function DockBar({ panels, pdus }: { panels: Panels; pdus: number }) {
  const sim = engine.mode === 'simulation';
  const any = panels.devices || panels.pdus || panels.mode;
  const chip = (k: keyof Panels, label: React.ReactNode, title = String(k)) => (
    <button className={`dock-chip${panels[k] ? ' on' : ''}`} onClick={() => togglePanel(k)} aria-pressed={panels[k]} title={panels[k] ? `Hide ${title}` : `Show ${title}`}>
      <span className="dock-chip-caret" aria-hidden="true">
        {panels[k] ? '▾' : '▸'}
      </span>
      {label}
    </button>
  );
  return (
    <div className="dock-bar" role="toolbar" aria-label="Panels">
      {chip('devices', 'Devices', 'devices')}
      {chip(
        'pdus',
        <>
          <span className="wide-only">Simple </span>PDUs{pdus ? ` (${pdus})` : ''}
        </>,
        'simple PDUs',
      )}
      {chip(
        'mode',
        <>
          <span className="wide-only">Time · </span>
          {sim ? 'Simulation' : 'Realtime'}
        </>,
        'time and mode',
      )}
      {sim && chip('sim', 'Events', 'the event list')}
      <span className="dock-bar-fill" />
      <button
        className="dock-chip"
        onClick={() => {
          const open = !any;
          (['devices', 'pdus', 'mode'] as const).forEach((k) => togglePanel(k, open));
        }}
        title={any ? 'Minimize all panels for more workspace' : 'Show all panels'}
      >
        {any ? (
          <>
            <span className="wide-only">Minimize </span>
            <span className="narrow-only">Hide </span>all
          </>
        ) : (
          'Show all'
        )}
      </button>
    </div>
  );
}

function ModeBox() {
  useUi((s) => s.engineVersion);
  const sim = engine.mode === 'simulation';
  return (
    <div className="modebox">
      <div className="modebox-time">
        <span className="muted small">Time</span>
        <span className="clock">{formatClock(engine.now)}</span>
      </div>
      <div className="modebox-actions">
        <button
          className="btn small"
          onClick={async () => {
            if (await askConfirm('Restart every device? Routers and switches lose any configuration that was not saved with copy running-config startup-config.', 'Restart devices')) powerCycleAll();
          }}
          title="Turn every device off and on"
        >
          <UiIcon.power />
          Power cycle
        </button>
        <button className="btn small" onClick={() => fastForward()} disabled={sim} title="Skip ahead 30 seconds">
          <UiIcon.fastForward />
          Fast forward
        </button>
      </div>
      <div className="modebox-tabs" role="radiogroup" aria-label="Mode">
        <button role="radio" aria-checked={!sim} className={!sim ? 'on' : ''} onClick={() => setMode('realtime')}>
          <UiIcon.clock />
          Realtime
        </button>
        <button role="radio" aria-checked={sim} className={sim ? 'on sim' : ''} onClick={() => setMode('simulation')}>
          <UiIcon.stopwatch />
          Simulation
        </button>
      </div>
    </div>
  );
}

function formatClock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
