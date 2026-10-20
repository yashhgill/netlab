import { useEffect, useRef } from 'react';
import { PDU_COLORS, frameLayers, type PduKind } from '../engine/packets';
import { simReset, simStep } from './actions';
import { UiIcon } from './icons';
import { engine, setState, useUi } from './store';

export function SimPanel() {
  useUi((s) => s.engineVersion);
  const playing = useUi((s) => s.playing);
  const speed = useUi((s) => s.speed);
  const filters = useUi((s) => s.filters);
  const listRef = useRef<HTMLDivElement>(null);
  const log = engine.log.filter((p) => filters[p.kind]);
  const pending = engine.pendingCount();

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [log.length]);

  const name = (id: string) => engine.devices.get(id)?.hostname ?? '—';

  return (
    <aside className="simpanel" aria-label="Simulation">
      <div className="sim-head">
        <h2>Simulation</h2>
        <span className="muted small">{pending ? `${pending} pending` : 'Idle'}</span>
      </div>
      <div className="sim-controls">
        <button className="btn icon" onClick={simReset} title="Reset simulation (clears traffic, ARP and MAC tables)">
          <UiIcon.reset />
        </button>
        <button className="btn primary grow" onClick={() => setState({ playing: !playing })} aria-pressed={playing}>
          {playing ? <UiIcon.pause /> : <UiIcon.play />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn grow" onClick={() => simStep()} disabled={playing} title="Capture and forward one step">
          <UiIcon.step />
          Step
        </button>
      </div>
      <label className="speed">
        <span>Speed</span>
        <input type="range" min={150} max={1600} step={50} value={1750 - speed} onChange={(e) => setState({ speed: 1750 - +e.target.value })} />
      </label>
      <div className="sim-filters" role="group" aria-label="Show protocols">
        {(Object.keys(filters) as PduKind[]).map((k) => (
          <button key={k} className={`chip${filters[k] ? ' on' : ''}`} onClick={() => setState({ filters: { ...filters, [k]: !filters[k] } })} aria-pressed={filters[k]}>
            <span className="chip-swatch" style={{ background: PDU_COLORS[k] }} />
            {k}
          </button>
        ))}
      </div>
      <div className="events" ref={listRef}>
        <table className="grid-table compact sticky">
          <thead>
            <tr>
              <th />
              <th>Time (s)</th>
              <th>Last device</th>
              <th>At device</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {log.map((p) => (
              <tr key={p.id} className={p.status === 'drop' ? 'drop' : ''} onClick={() => setState({ pduDetail: p })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setState({ pduDetail: p })}>
                <td>
                  <span className="chip-swatch" style={{ background: p.status === 'drop' ? 'var(--down)' : PDU_COLORS[p.kind] }} />
                </td>
                <td className="mono">{(p.t / 1000).toFixed(3)}</td>
                <td>{p.status === 'drop' ? name(p.from) : name(p.from)}</td>
                <td>{p.status === 'drop' ? 'dropped' : name(p.to)}</td>
                <td>{p.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!log.length && <p className="muted small pad">Send traffic (a ping from a PC, or a Simple PDU), then press Step or Play to follow it hop by hop.</p>}
      </div>
    </aside>
  );
}

export function PduDetail() {
  const p = useUi((s) => s.pduDetail);
  if (!p) return null;
  const from = engine.devices.get(p.from)?.hostname;
  const to = engine.devices.get(p.to)?.hostname;
  return (
    <div className="modal-back" onPointerDown={() => setState({ pduDetail: null })}>
      <div className="modal" role="dialog" aria-label="PDU information" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="chip-swatch big" style={{ background: PDU_COLORS[p.kind] }} />
          <div>
            <h2>{p.kind} PDU</h2>
            <p className="muted small">{p.status === 'drop' ? p.info : `${from} to ${to} at ${(p.t / 1000).toFixed(3)} s`}</p>
          </div>
          <button className="icon-btn" onClick={() => setState({ pduDetail: null })} aria-label="Close">
            <UiIcon.close />
          </button>
        </div>
        <p className="pdu-summary">{p.status === 'drop' ? 'Frame contents when dropped:' : p.info}</p>
        {frameLayers(p.frame).map((l) => (
          <section key={l.layer} className="layer">
            <h3>{l.layer}</h3>
            <ul>
              {l.lines.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
