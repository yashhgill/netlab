import { useRef } from 'react';
import { fmtIp, fmtMacDot, maskToPrefix } from '../engine/addr';
import type { Device } from '../engine/engine';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import type { IpStack } from '../engine/ipstack';
import { shortIf } from '../cli/ifnames';
import { UiIcon } from './icons';
import { engine, getState, setState, useUi, type InspectTable } from './store';

const LABEL: Record<InspectTable, string> = {
  arp: 'ARP table',
  mac: 'MAC address table',
  route: 'Routing table',
  dhcp: 'DHCP leases',
  ports: 'Port status',
};

function stackOf(d: Device): IpStack | undefined {
  return (d as unknown as { stack?: IpStack }).stack;
}

export function tablesFor(d: Device): InspectTable[] {
  const t: InspectTable[] = [];
  if (stackOf(d)) t.push('arp');
  if (d instanceof Switch) t.push('mac');
  if (d instanceof Router || (d instanceof Switch && d.ipRouting)) t.push('route');
  if (d instanceof Router) t.push('dhcp');
  t.push('ports');
  return t;
}

let seq = 0;

function openInspect(devId: string, table: InspectTable, x: number, y: number) {
  setState((s) => ({
    inspectMenu: null,
    inspects: s.inspects.some((i) => i.devId === devId && i.table === table) ? s.inspects : [...s.inspects, { id: ++seq, devId, table, x, y }],
  }));
}

export function InspectMenu() {
  const m = useUi((s) => s.inspectMenu);
  if (!m) return null;
  const d = engine.devices.get(m.devId);
  if (!d) return null;
  return (
    <div className="inspect-menu" style={{ left: m.x, top: m.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      <div className="inspect-menu-title">Inspect {d.hostname}</div>
      {tablesFor(d).map((t) => (
        <button key={t} role="menuitem" onClick={() => openInspect(d.id, t, m.x, m.y)}>
          {LABEL[t]}
        </button>
      ))}
    </div>
  );
}

export function InspectWindows() {
  const list = useUi((s) => s.inspects);
  useUi((s) => s.engineVersion);
  return (
    <>
      {list.map((w) => {
        const d = engine.devices.get(w.devId);
        return d ? <InspectWindow key={w.id} id={w.id} dev={d} table={w.table} x={w.x} y={w.y} /> : null;
      })}
    </>
  );
}

function InspectWindow({ id, dev, table, x, y }: { id: number; dev: Device; table: InspectTable; x: number; y: number }) {
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const close = () => setState((s) => ({ inspects: s.inspects.filter((i) => i.id !== id) }));
  const { head, rows } = buildTable(dev, table);
  return (
    <div className="inspect-win" style={{ left: x, top: y }} role="dialog" aria-label={`${LABEL[table]} for ${dev.hostname}`}>
      <div
        className="inspect-title"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          drag.current = { sx: e.clientX, sy: e.clientY, x, y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const dr = drag.current;
          if (!dr) return;
          const nx = dr.x + e.clientX - dr.sx;
          const ny = Math.max(0, dr.y + e.clientY - dr.sy);
          setState({ inspects: getState().inspects.map((i) => (i.id === id ? { ...i, x: nx, y: ny } : i)) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span>
          <strong>{dev.hostname}</strong> {LABEL[table]}
        </span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <UiIcon.close />
        </button>
      </div>
      <div className="inspect-body">
        <table className="grid-table compact">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>
                {r.map((c, j) => (
                  <td key={j} className={j === 0 || /\d+\.\d+/.test(c) ? 'mono' : ''}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={head.length} className="muted">
                  Empty. Send some traffic and this fills in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildTable(d: Device, t: InspectTable): { head: string[]; rows: string[][] } {
  const st = stackOf(d);
  switch (t) {
    case 'arp':
      return {
        head: ['IP address', 'MAC address', 'Interface'],
        rows: st ? [...st.arp.entries()].sort((a, b) => a[0] - b[0]).map(([ip, e]) => [fmtIp(ip), fmtMacDot(e.mac), e.ifName]) : [],
      };
    case 'mac':
      return {
        head: ['VLAN', 'MAC address', 'Port'],
        rows: d instanceof Switch ? [...d.macTable.values()].sort((a, b) => a.vlan - b.vlan).map((e) => [String(e.vlan), fmtMacDot(e.mac), shortIf(e.port)]) : [],
      };
    case 'route':
      return {
        head: ['Type', 'Network', 'Port', 'Next hop'],
        rows: st
          ? st
              .routingTable()
              .filter((r) => r.code !== 'L')
              .map((r) => [r.code === 'C' ? 'Connected' : 'Static', `${fmtIp(r.net)}/${maskToPrefix(r.mask)}`, r.ifName ?? '', r.nextHop !== undefined ? fmtIp(r.nextHop) : '—'])
          : [],
      };
    case 'dhcp':
      return {
        head: ['IP address', 'Client MAC', 'Pool'],
        rows: d instanceof Router ? [...d.dhcp.bindings.values()].map((b) => [fmtIp(b.ip), fmtMacDot(b.mac), b.pool]) : [],
      };
    case 'ports':
      return {
        head: ['Port', 'Link', 'IP address'],
        rows: d.allPorts().map((i) => [shortIf(i.name), !d.powered ? 'Off' : i.media === 'console' || i.media === 'rs232' ? (i.linkId ? 'Console' : '—') : d.lineUp(i.name) ? 'Up' : i.linkId ? 'Down' : '—', i.ip !== undefined ? `${fmtIp(i.ip)}/${maskToPrefix(i.mask!)}` : '']),
      };
  }
}
