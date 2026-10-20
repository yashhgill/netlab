import { useState } from 'react';
import type { CableType, DeviceKind } from '../engine/engine';
import { describeScenario, fireScenario, removeScenario } from './actions';
import { CableSwatch, DeviceGlyph } from './icons';
import { setState, useUi } from './store';

type Cat = 'routers' | 'switches' | 'end' | 'connections';

const CATS: { id: Cat; label: string; icon: DeviceKind | 'cable' }[] = [
  { id: 'routers', label: 'Routers', icon: 'router' },
  { id: 'switches', label: 'Switches', icon: 'switch' },
  { id: 'end', label: 'End devices', icon: 'pc' },
  { id: 'connections', label: 'Connections', icon: 'cable' },
];

const ITEMS: Record<Exclude<Cat, 'connections'>, { kind: DeviceKind; label: string; detail: string }[]> = {
  routers: [{ kind: 'router', label: 'NL-R3000', detail: '3 × Gigabit' }],
  switches: [{ kind: 'switch', label: 'NL-S2400', detail: '24 × Fast, 2 × Gigabit' }],
  end: [
    { kind: 'pc', label: 'PC', detail: 'Desktop' },
    { kind: 'laptop', label: 'Laptop', detail: 'Portable' },
    { kind: 'server', label: 'Server', detail: 'DHCP service' },
  ],
};

const CABLES: { type: CableType; label: string; detail: string }[] = [
  { type: 'auto', label: 'Automatic', detail: 'Picks the cable and free ports' },
  { type: 'straight', label: 'Copper straight-through', detail: 'PC or router to switch' },
  { type: 'cross', label: 'Copper cross-over', detail: 'Like to like: switch–switch, PC–PC, router–PC' },
];

export function Dock() {
  const [cat, setCat] = useState<Cat>('end');
  const placing = useUi((s) => s.placing);
  const tool = useUi((s) => s.tool);
  const cable = useUi((s) => s.cable);
  const scenarios = useUi((s) => s.scenarios);

  return (
    <footer className="dock">
      <div className="dock-cats" role="tablist" aria-label="Device categories">
        {CATS.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={`dock-cat${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)} title={c.label}>
            {c.icon === 'cable' ? (
              <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M6 26 C 10 10, 22 22, 26 6" stroke="#2F5BEA" strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <circle cx="6" cy="26" r="3" fill="#22A55B" />
                <circle cx="26" cy="6" r="3" fill="#22A55B" />
              </svg>
            ) : (
              <DeviceGlyph kind={c.icon} size={32} />
            )}
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      <div className="dock-items">
        {cat === 'connections'
          ? CABLES.map((c) => (
              <button
                key={c.type}
                className={`dock-item cable${tool === 'cable' && cable === c.type ? ' on' : ''}`}
                onClick={() => setState({ tool: 'cable', cable: c.type, cableFrom: null, placing: null })}
                title={c.detail}
              >
                <span className="cable-swatch">
                  <CableSwatch type={c.type} />
                </span>
                <span className="dock-item-label">{c.label}</span>
                <span className="dock-item-detail">{c.detail}</span>
              </button>
            ))
          : ITEMS[cat].map((it) => (
              <button
                key={it.kind}
                className={`dock-item${placing === it.kind ? ' on' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-netlab-device', it.kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setState({ placing: placing === it.kind ? null : it.kind, tool: 'select', cableFrom: null })}
                title="Drag onto the workspace, or click then click the workspace. Hold Shift to place several."
              >
                <DeviceGlyph kind={it.kind} size={44} />
                <span className="dock-item-label">{it.label}</span>
                <span className="dock-item-detail">{it.detail}</span>
              </button>
            ))}
        {tool === 'cable' && <p className="dock-hint">Click the first device, then the second. {cable === 'auto' ? 'Free ports are chosen for you.' : 'Pick a port on each.'}</p>}
      </div>

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
                      <button className="link-btn danger" onClick={() => removeScenario(sc.id)} aria-label="Remove PDU">
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
    </footer>
  );
}
