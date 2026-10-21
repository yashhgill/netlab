import { useEffect, useRef, useState } from 'react';
import { fmtIp, fmtMacDot, maskToPrefix, parseIp, parseMask, classfulMask } from '../engine/addr';
import type { Device, Iface } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { AccessPoint } from '../engine/devices/hub';
import type { WifiSettings } from '../engine/engine';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { applyConfig } from '../cli/ios';
import { statusOf } from '../cli/ios-show';
import { shellFor } from '../cli/sessions';
import { DeviceGlyph, UiIcon } from './icons';
import { DevicePanel } from './deviceArt';
import { togglePower } from './actions';
import { Terminal } from './Terminal';
import { closeWindow, engine, markDirty, setState, useUi, type DeviceWin, type Tab } from './store';

export function DeviceWindows() {
  const wins = useUi((s) => s.wins);
  useUi((s) => s.engineVersion);
  return (
    <>
      {wins.map((w) => {
        const d = engine.devices.get(w.devId);
        return d ? <DeviceWindow key={w.devId} win={w} dev={d} /> : null;
      })}
    </>
  );
}

function tabsFor(d: Device): { id: Tab; label: string }[] {
  const t: { id: Tab; label: string }[] = [
    { id: 'physical', label: 'Physical' },
    { id: 'config', label: 'Config' },
  ];
  if (d instanceof Router || d instanceof Switch) t.push({ id: 'cli', label: 'CLI' });
  if (d.kind === 'server') t.push({ id: 'services', label: 'Services' });
  if (d instanceof Host && ['pc', 'laptop', 'server', 'tablet', 'smartphone'].includes(d.kind)) t.push({ id: 'desktop', label: 'Desktop' });
  return t;
}

function DeviceWindow({ win, dev }: { win: DeviceWin; dev: Device }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const tabs = tabsFor(dev);
  const tab = tabs.some((t) => t.id === win.tab) ? win.tab : tabs[tabs.length - 1].id;

  const front = () =>
    setState((s) => ({ topZ: s.topZ + 1, wins: s.wins.map((w) => (w.devId === win.devId ? { ...w, z: s.topZ + 1 } : w)) }));
  const setTab = (t: Tab) => setState((s) => ({ wins: s.wins.map((w) => (w.devId === win.devId ? { ...w, tab: t } : w)) }));

  const onTitleDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, x: win.x, y: win.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr) return;
    const x = Math.max(-400, Math.min(window.innerWidth - 120, dr.x + e.clientX - dr.sx));
    const y = Math.max(0, Math.min(window.innerHeight - 60, dr.y + e.clientY - dr.sy));
    setState((s) => ({ wins: s.wins.map((w) => (w.devId === win.devId ? { ...w, x, y } : w)) }));
  };

  return (
    <div
      ref={ref}
      className="devwin"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onPointerDown={front}
      role="dialog"
      aria-label={`${dev.hostname} settings`}
    >
      <div className="devwin-title" onPointerDown={onTitleDown} onPointerMove={onTitleMove} onPointerUp={() => (drag.current = null)}>
        <DeviceGlyph kind={dev.kind} model={dev.model} size={22} />
        <span className="devwin-name">{dev.hostname}</span>
        <span className="devwin-model">{dev.model}</span>
        <button className="icon-btn" onClick={() => closeWindow(dev.id)} aria-label="Close window">
          <UiIcon.close />
        </button>
      </div>
      <div className="devwin-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="devwin-body">
        {tab === 'physical' && <PhysicalTab dev={dev} />}
        {tab === 'config' && (dev instanceof Host ? <HostConfigTab dev={dev} /> : dev instanceof Router || dev instanceof Switch ? <IosConfigTab dev={dev} /> : <NameOnlyConfig dev={dev} />)}
        {tab === 'cli' && <Terminal shell={shellFor(dev)} />}
        {tab === 'desktop' && dev instanceof Host && <DesktopTab dev={dev} />}
        {tab === 'services' && dev instanceof Host && <ServicesTab dev={dev} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Physical
function PhysicalTab({ dev }: { dev: Device }) {
  useUi((s) => s.engineVersion);
  return (
    <div className="physical">
      <div className="physical-panel">
        <DevicePanel dev={dev} onPower={() => togglePower(dev)} />
      </div>
      <p className="muted small">
        Click the power button to turn {dev.hostname} {dev.powered ? 'off' : 'on'}.
        {(dev instanceof Router || dev instanceof Switch) && ' Turning a router or switch on loads its startup-config, so save first with copy running-config startup-config.'}
      </p>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Type</th>
            <th>Link</th>
            <th>Connected to</th>
          </tr>
        </thead>
        <tbody>
          {dev.allPorts().filter((i) => !(dev.kind === 'ap' && i.media === 'wireless')).map((i) => {
            const peer = engine.peer(dev.id, i.name);
            const pd = peer && engine.devices.get(peer.dev);
            const mgmt = i.media === 'console' || i.media === 'rs232';
            const up = dev.lineUp(i.name);
            const dce = engine.isDce(dev.id, i.name);
            return (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td className="muted">{i.media === 'rs232' ? 'RS-232' : i.media === 'serial' ? `Serial${dce === null ? '' : dce ? ' (DCE)' : ' (DTE)'}` : i.media === 'fiber' ? 'Fiber' : i.media === 'console' ? 'Console' : i.media === 'wireless' ? 'Wireless' : `${i.speed >= 1000 ? 'Gigabit' : i.speed >= 100 ? 'Fast' : ''} Ethernet`.trim()}</td>
                <td>
                  {mgmt ? (
                    i.linkId ? 'Console cable' : 'Empty'
                  ) : (
                    <>
                      <span className={`dot ${up ? 'up' : 'down'}`} /> {up ? 'Up' : i.linkId ? 'Down' : 'Empty'}
                    </>
                  )}
                </td>
                <td>{pd ? `${pd.hostname} ${peer!.iface}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Config (IOS devices)
function IosConfigTab({ dev }: { dev: Router | Switch }) {
  const [section, setSection] = useState<string>('global');
  const [log, setLog] = useState('');
  const logRef = useRef<HTMLPreElement>(null);
  const run = (lines: string[]) => {
    const out = applyConfig(dev, lines);
    setLog((l) => (l + out).slice(-6000));
    markDirty();
  };
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const ifaces = [...dev.ifaces.values()].filter((i) => i.physical || i.sviVlan !== undefined || i.parent);
  const cur = ifaces.find((i) => i.name === section);

  return (
    <div className="config">
      <nav className="config-nav" aria-label="Config sections">
        <div className="config-nav-group">Global</div>
        <button className={section === 'global' ? 'on' : ''} onClick={() => setSection('global')}>
          Settings
        </button>
        {dev instanceof Router && (
          <button className={section === 'routing' ? 'on' : ''} onClick={() => setSection('routing')}>
            Static routes
          </button>
        )}
        {dev instanceof Switch && (
          <button className={section === 'vlans' ? 'on' : ''} onClick={() => setSection('vlans')}>
            VLAN database
          </button>
        )}
        <div className="config-nav-group">Interfaces</div>
        {ifaces.map((i) => (
          <button key={i.name} className={section === i.name ? 'on' : ''} onClick={() => setSection(i.name)}>
            <span className={`dot ${dev.lineUp(i.name) ? 'up' : 'down'}`} />
            {i.name}
          </button>
        ))}
      </nav>
      <div className="config-main">
        <div className="config-form">
          {section === 'global' && <GlobalForm dev={dev} run={run} />}
          {section === 'routing' && dev instanceof Router && <RoutesForm dev={dev} run={run} />}
          {section === 'vlans' && dev instanceof Switch && <VlanForm dev={dev} run={run} />}
          {cur && <IfaceForm key={cur.name} dev={dev} i={cur} run={run} />}
        </div>
        <div className="config-log">
          <div className="config-log-title">Equivalent IOS commands</div>
          <pre ref={logRef}>{log || 'Changes you make here are shown as the commands you would type in the CLI.'}</pre>
        </div>
      </div>
    </div>
  );
}

function GlobalForm({ dev, run }: { dev: Router | Switch; run: (l: string[]) => void }) {
  const [name, setName] = useState(dev.hostname);
  const [gw, setGw] = useState(dev instanceof Switch && dev.stack.defaultGateway !== undefined ? fmtIp(dev.stack.defaultGateway) : '');
  return (
    <>
      <h3>Settings</h3>
      <Field label="Hostname">
        <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} onKeyDown={(e) => e.key === 'Enter' && name && run([`hostname ${name}`])} />
        <button className="btn" disabled={!name || name === dev.hostname} onClick={() => run([`hostname ${name}`])}>
          Apply
        </button>
      </Field>
      {dev instanceof Switch && (
        <Field label="Default gateway" error={gw && parseIp(gw) === null ? 'Enter an address like 192.168.1.1' : undefined}>
          <input value={gw} onChange={(e) => setGw(e.target.value)} placeholder="192.168.1.1" />
          <button className="btn" disabled={!!gw && parseIp(gw) === null} onClick={() => run([gw ? `ip default-gateway ${gw}` : 'no ip default-gateway'])}>
            Apply
          </button>
        </Field>
      )}
      <p className="muted small">Save the running configuration from the CLI tab with <code>copy running-config startup-config</code>.</p>
    </>
  );
}

function RoutesForm({ dev, run }: { dev: Router; run: (l: string[]) => void }) {
  const [net, setNet] = useState('');
  const [mask, setMask] = useState('');
  const [nh, setNh] = useState('');
  const ok = parseIp(net) !== null && parseMask(mask) !== null && parseIp(nh) !== null;
  return (
    <>
      <h3>Static routes</h3>
      <div className="row3">
        <label>
          Network
          <input value={net} onChange={(e) => setNet(e.target.value)} placeholder="10.0.0.0" />
        </label>
        <label>
          Mask
          <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.0.0.0" />
        </label>
        <label>
          Next hop
          <input value={nh} onChange={(e) => setNh(e.target.value)} placeholder="192.168.1.2" />
        </label>
      </div>
      <button
        className="btn primary"
        disabled={!ok}
        onClick={() => {
          run([`ip route ${net} ${mask} ${nh}`]);
          setNet('');
          setMask('');
          setNh('');
        }}
      >
        Add route
      </button>
      <table className="grid-table compact">
        <thead>
          <tr>
            <th>Network</th>
            <th>Next hop</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {dev.stack.staticRoutes.map((r, k) => (
            <tr key={k}>
              <td className="mono">
                {fmtIp(r.net)}/{maskToPrefix(r.mask)}
              </td>
              <td className="mono">{r.ifName ?? fmtIp(r.nextHop!)}</td>
              <td>
                <button className="link-btn" onClick={() => run([`no ip route ${fmtIp(r.net)} ${fmtIp(r.mask)} ${r.ifName ?? fmtIp(r.nextHop!)}`])}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {!dev.stack.staticRoutes.length && (
            <tr>
              <td colSpan={3} className="muted">
                No static routes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function VlanForm({ dev, run }: { dev: Switch; run: (l: string[]) => void }) {
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const n = parseInt(num);
  const ok = n >= 2 && n <= 4094 && !(n >= 1002 && n <= 1005);
  return (
    <>
      <h3>VLAN database</h3>
      <div className="row3">
        <label>
          VLAN number
          <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} placeholder="10" />
        </label>
        <label>
          VLAN name
          <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))} placeholder="SALES" />
        </label>
      </div>
      <button
        className="btn primary"
        disabled={!ok}
        onClick={() => {
          run([`vlan ${n}`, ...(name ? [`name ${name}`] : []), 'exit']);
          setNum('');
          setName('');
        }}
      >
        Add VLAN
      </button>
      <table className="grid-table compact">
        <thead>
          <tr>
            <th>VLAN</th>
            <th>Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...dev.vlans.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([v, nm]) => (
              <tr key={v}>
                <td>{v}</td>
                <td>{nm}</td>
                <td>
                  {v !== 1 && (
                    <button className="link-btn" onClick={() => run([`no vlan ${v}`])}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}

function IfaceForm({ dev, i, run }: { dev: Router | Switch; i: Iface; run: (l: string[]) => void }) {
  const [ip, setIp] = useState(i.ip !== undefined ? fmtIp(i.ip) : '');
  const [mask, setMask] = useState(i.mask !== undefined ? fmtIp(i.mask) : '');
  const st = statusOf(dev, i);
  const l3 = dev instanceof Router || i.sviVlan !== undefined || !!i.routed;
  const sw = dev instanceof Switch && i.physical && !i.routed;
  const dce = engine.isDce(dev.id, i.name);
  const pre = [`interface ${i.name}`];
  const ipOk = parseIp(ip) !== null && parseMask(mask) !== null;
  return (
    <>
      <h3>{i.name}</h3>
      <p className="muted small">
        Status: {st.status}, line protocol {st.proto}
      </p>
      <Field label="Port status">
        <label className="switch">
          <input type="checkbox" checked={i.adminUp} onChange={(e) => run([...pre, e.target.checked ? 'no shutdown' : 'shutdown', 'exit'])} />
          <span>{i.adminUp ? 'On' : 'Off'}</span>
        </label>
      </Field>
      {l3 && (
        <>
          <Field label="IPv4 address">
            <input
              value={ip}
              onChange={(e) => {
                setIp(e.target.value);
                const p = parseIp(e.target.value);
                if (p !== null && !mask) setMask(fmtIp(classfulMask(p)));
              }}
              placeholder="192.168.1.1"
            />
          </Field>
          <Field label="Subnet mask">
            <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.255.255.0" />
          </Field>
          <div className="btn-row">
            <button className="btn primary" disabled={!ipOk} onClick={() => run([...pre, `ip address ${ip} ${mask}`, 'exit'])}>
              Apply address
            </button>
            {i.ip !== undefined && (
              <button
                className="btn"
                onClick={() => {
                  run([...pre, 'no ip address', 'exit']);
                  setIp('');
                  setMask('');
                }}
              >
                Clear address
              </button>
            )}
          </div>
          {i.media === 'serial' && (
            <>
              <Field label="Clock rate">
                <select
                  value={i.clockRate ?? ''}
                  disabled={dce === false}
                  onChange={(e) => run([...pre, e.target.value ? `clock rate ${e.target.value}` : 'no clock rate', 'exit'])}
                >
                  <option value="">Not set</option>
                  {[9600, 56000, 64000, 128000, 1000000, 2000000, 4000000].map((r) => (
                    <option key={r} value={r}>
                      {r.toLocaleString()} bit/s
                    </option>
                  ))}
                </select>
              </Field>
              <p className="muted small">{dce === null ? 'No serial cable connected.' : dce ? 'This end is the DCE, so it must provide the clock rate.' : 'This end is the DTE; the clock comes from the other end.'}</p>
              <Field label="Encapsulation">
                <select value={i.encap ?? 'hdlc'} onChange={(e) => run([...pre, `encapsulation ${e.target.value}`, 'exit'])}>
                  <option value="hdlc">HDLC</option>
                  <option value="ppp">PPP</option>
                </select>
              </Field>
            </>
          )}
          {i.parent && <p className="muted small">Sub-interface: VLAN {i.dot1q ?? 'not set'} — set it in the CLI with <code>encapsulation dot1Q</code>.</p>}
        </>
      )}
      {sw && (
        <>
          <Field label="Mode">
            <select value={i.swMode} onChange={(e) => run([...pre, `switchport mode ${e.target.value}`, 'exit'])}>
              <option value="access">Access</option>
              <option value="trunk">Trunk</option>
            </select>
          </Field>
          {i.swMode !== 'trunk' ? (
            <Field label="Access VLAN">
              <select value={i.accessVlan} onChange={(e) => run([...pre, `switchport access vlan ${e.target.value}`, 'exit'])}>
                {[...(dev as Switch).vlans.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([v, n]) => (
                    <option key={v} value={v}>
                      {v} {n}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="Native VLAN">
              <select value={i.nativeVlan ?? 1} onChange={(e) => run([...pre, `switchport trunk native vlan ${e.target.value}`, 'exit'])}>
                {[...(dev as Switch).vlans.keys()]
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </>
      )}
    </>
  );
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-ctl">{children}</div>
      {error && <span className="field-err">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Hosts
function HostConfigTab({ dev }: { dev: Host }) {
  const [name, setName] = useState(dev.hostname);
  return (
    <div className="pad">
      <h3>Settings</h3>
      <Field label="Display name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          disabled={!name.trim() || name === dev.hostname}
          onClick={() => {
            dev.hostname = name.trim();
            engine.bump();
            markDirty();
          }}
        >
          Apply
        </button>
      </Field>
      {dev.wifi && (
        <>
          <h3>Wireless</h3>
          <WifiForm wifi={dev.wifi} onSave={(w) => dev.setWifi(w)} />
          <p className="muted small">
            {dev.nic.linkId ? `Connected to ${engine.devices.get(engine.peer(dev.id, dev.nicName)?.dev ?? '')?.hostname ?? 'an access point'}.` : 'Not connected. It joins the nearest access point with the same SSID and key.'}
          </p>
        </>
      )}
      <h3>{dev.nicName}</h3>
      <IpConfigForm dev={dev} />
    </div>
  );
}

function NameOnlyConfig({ dev }: { dev: Device }) {
  const [name, setName] = useState(dev.hostname);
  return (
    <div className="pad">
      <h3>Settings</h3>
      <Field label="Display name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          disabled={!name.trim() || name === dev.hostname}
          onClick={() => {
            dev.hostname = name.trim();
            engine.bump();
            markDirty();
          }}
        >
          Apply
        </button>
      </Field>
      {dev instanceof AccessPoint ? (
        <>
          <h3>Wireless</h3>
          <WifiForm wifi={dev.wifi} onSave={(w) => dev.setWifi(w)} />
          <p className="muted small">
            {dev.clients().length ? `Clients: ${dev.clients().join(', ')}` : 'No clients yet. Wireless PCs, laptops, tablets and phones with this SSID and key join automatically.'}
          </p>
        </>
      ) : (
        <p className="muted small">A hub has nothing to configure. It repeats every frame it receives out of all its other ports.</p>
      )}
    </div>
  );
}

function WifiForm({ wifi, onSave }: { wifi: WifiSettings; onSave: (w: WifiSettings) => void }) {
  const [ssid, setSsid] = useState(wifi.ssid);
  const [secure, setSecure] = useState(!!wifi.key);
  const [key, setKey] = useState(wifi.key ?? '');
  const bad = !ssid.trim() || (secure && key.length < 8);
  const same = ssid === wifi.ssid && (secure ? key : '') === (wifi.key ?? '');
  return (
    <>
      <Field label="SSID">
        <input value={ssid} onChange={(e) => setSsid(e.target.value)} maxLength={32} aria-label="SSID" />
      </Field>
      <Field label="Security">
        <select value={secure ? 'wpa2' : 'open'} onChange={(e) => setSecure(e.target.value === 'wpa2')} aria-label="Security">
          <option value="open">Open</option>
          <option value="wpa2">WPA2-PSK</option>
        </select>
      </Field>
      {secure && (
        <Field label="Passphrase">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="8 characters or more" aria-label="Passphrase" />
        </Field>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          className="btn primary"
          disabled={bad || same}
          onClick={() => {
            onSave({ ssid: ssid.trim(), key: secure ? key : undefined });
            markDirty();
          }}
        >
          Save wireless settings
        </button>
      </div>
    </>
  );
}

function DesktopTab({ dev }: { dev: Host }) {
  const [app, setApp] = useState<'home' | 'ip' | 'cmd' | 'term'>('home');
  if (app === 'home') {
    return (
      <div className="desktop">
        <button className="app-tile" onClick={() => setApp('ip')}>
          <span className="app-icon ip">IP</span>
          IP Configuration
        </button>
        <button className="app-tile" onClick={() => setApp('cmd')}>
          <span className="app-icon cmd">C:\&gt;</span>
          Command Prompt
        </button>
        {dev.mgmt.has('RS232') && (
          <button className="app-tile" onClick={() => setApp('term')}>
            <span className="app-icon term">&gt;_</span>
            Terminal
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="desktop-app">
      <div className="desktop-app-bar">
        <button className="link-btn" onClick={() => setApp('home')}>
          Desktop
        </button>
        <span>/</span>
        <span>{app === 'ip' ? 'IP Configuration' : app === 'term' ? 'Terminal' : 'Command Prompt'}</span>
      </div>
      {app === 'ip' ? (
        <div className="pad">
          <IpConfigForm dev={dev} />
        </div>
      ) : app === 'term' ? (
        <ConsoleTerminal dev={dev} />
      ) : (
        <Terminal shell={shellFor(dev)} />
      )}
    </div>
  );
}

/** Terminal app: talks to whatever router or switch the PC's RS-232 port is cabled to. */
function ConsoleTerminal({ dev }: { dev: Host }) {
  useUi((s) => s.engineVersion);
  const peer = engine.peer(dev.id, 'RS232');
  const target = peer ? engine.devices.get(peer.dev) : undefined;
  if (!target || !(target instanceof Router || target instanceof Switch)) {
    return (
      <div className="pad">
        <h3>No console connection</h3>
        <p className="muted">Connect a Console cable from this PC's RS-232 port to the Console port of a router or switch, then open Terminal again.</p>
        <p className="muted small">Settings: 9600 bits per second, 8 data bits, no parity, 1 stop bit, no flow control.</p>
      </div>
    );
  }
  if (!target.powered) {
    return (
      <div className="pad">
        <h3>{target.hostname} is turned off</h3>
        <p className="muted">Turn it on from its Physical tab to use the console.</p>
      </div>
    );
  }
  return <Terminal shell={shellFor(target)} />;
}

function IpConfigForm({ dev }: { dev: Host }) {
  useUi((s) => s.engineVersion);
  const n = dev.nic;
  const v = (x?: number) => (x !== undefined ? fmtIp(x) : '');
  const [ip, setIp] = useState(v(n.ip));
  const [mask, setMask] = useState(v(n.mask));
  const [gw, setGw] = useState(v(dev.gateway));
  const [dns, setDns] = useState(v(dev.dns));
  const dhcp = dev.ipMode === 'dhcp';

  // follow DHCP results
  useEffect(() => {
    if (dhcp) {
      setIp(v(n.ip));
      setMask(v(n.mask));
      setGw(v(dev.gateway));
      setDns(v(dev.dns));
    }
  }, [dhcp, n.ip, n.mask, dev.gateway, dev.dns]);

  const apply = (next: { ip?: string; mask?: string; gw?: string; dns?: string }) => {
    const a = { ip, mask, gw, dns, ...next };
    const pIp = a.ip ? parseIp(a.ip) : undefined;
    const pMask = a.mask ? parseMask(a.mask) : undefined;
    const pGw = a.gw ? parseIp(a.gw) : undefined;
    const pDns = a.dns ? parseIp(a.dns) : undefined;
    if (pIp === null || pMask === null || pGw === null || pDns === null) return;
    dev.setStatic(pIp, pMask, pGw, pDns);
    markDirty();
  };

  const err = (s: string, mask = false) => (s && (mask ? parseMask(s) : parseIp(s)) === null ? (mask ? 'Enter a valid mask, like 255.255.255.0' : 'Enter an address like 192.168.1.10') : undefined);

  return (
    <div className="ipconf">
      <div className="radio-row" role="radiogroup" aria-label="Address assignment">
        <label>
          <input type="radio" checked={dhcp} onChange={() => (dev.useDhcp(), markDirty())} /> DHCP
        </label>
        <label>
          <input
            type="radio"
            checked={!dhcp}
            onChange={() => {
              dev.setStatic(parseIp(ip) ?? undefined, parseMask(mask) ?? undefined, parseIp(gw) ?? undefined, parseIp(dns) ?? undefined);
              markDirty();
            }}
          />{' '}
          Static
        </label>
        {dhcp && dev.dhcpStatus && <span className={`dhcp-status${dev.dhcpStatus.includes('failed') ? ' bad' : ''}`}>{dev.dhcpStatus}</span>}
      </div>
      <Field label="IPv4 address" error={err(ip)}>
        <input
          disabled={dhcp}
          value={ip}
          onChange={(e) => {
            setIp(e.target.value);
            const p = parseIp(e.target.value);
            if (p !== null && !mask) {
              const m = fmtIp(classfulMask(p));
              setMask(m);
              apply({ ip: e.target.value, mask: m });
            } else apply({ ip: e.target.value });
          }}
          placeholder="192.168.1.10"
        />
      </Field>
      <Field label="Subnet mask" error={err(mask, true)}>
        <input disabled={dhcp} value={mask} onChange={(e) => (setMask(e.target.value), apply({ mask: e.target.value }))} placeholder="255.255.255.0" />
      </Field>
      <Field label="Default gateway" error={err(gw)}>
        <input disabled={dhcp} value={gw} onChange={(e) => (setGw(e.target.value), apply({ gw: e.target.value }))} placeholder="192.168.1.1" />
      </Field>
      <Field label="DNS server" error={err(dns)}>
        <input disabled={dhcp} value={dns} onChange={(e) => (setDns(e.target.value), apply({ dns: e.target.value }))} placeholder="8.8.8.8" />
      </Field>
      <p className="muted small mono">MAC {fmtMacDot(n.mac)}</p>
    </div>
  );
}

function ServicesTab({ dev }: { dev: Host }) {
  useUi((s) => s.engineVersion);
  const pool = dev.serverPool ?? { name: 'serverPool' };
  const v = (x?: number) => (x !== undefined ? fmtIp(x) : '');
  const [gw, setGw] = useState(v(pool.router));
  const [dns, setDns] = useState(v(pool.dns));
  const [start, setStart] = useState(v(pool.start));
  const [mask, setMask] = useState(v(pool.mask));
  const [max, setMax] = useState(String(pool.max ?? 50));
  const srv = dev.dhcpServer!;
  const ok = parseIp(start) !== null && parseMask(mask) !== null && (!gw || parseIp(gw) !== null) && (!dns || parseIp(dns) !== null) && +max > 0;
  return (
    <div className="pad">
      <h3>DHCP</h3>
      <Field label="Service">
        <label className="switch">
          <input
            type="checkbox"
            checked={srv.enabled}
            onChange={(e) => {
              srv.enabled = e.target.checked;
              engine.bump();
              markDirty();
            }}
          />
          <span>{srv.enabled ? 'On' : 'Off'}</span>
        </label>
      </Field>
      <Field label="Default gateway">
        <input value={gw} onChange={(e) => setGw(e.target.value)} placeholder="192.168.1.1" />
      </Field>
      <Field label="DNS server">
        <input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="8.8.8.8" />
      </Field>
      <Field label="Start IP address">
        <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="192.168.1.100" />
      </Field>
      <Field label="Subnet mask">
        <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.255.255.0" />
      </Field>
      <Field label="Maximum users">
        <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <button
        className="btn primary"
        disabled={!ok}
        onClick={() => {
          dev.updateServerPool({
            router: gw ? parseIp(gw)! : undefined,
            dns: dns ? parseIp(dns)! : undefined,
            start: parseIp(start)!,
            mask: parseMask(mask)!,
            max: +max,
          });
          markDirty();
        }}
      >
        Save pool
      </button>
      <p className="muted small">The server's own address must be in the same subnet as the pool. For clients on other networks, add <code>ip helper-address</code> on the router.</p>
      {srv.bindings.size > 0 && (
        <table className="grid-table compact">
          <thead>
            <tr>
              <th>Leased address</th>
              <th>Client MAC</th>
            </tr>
          </thead>
          <tbody>
            {[...srv.bindings.values()].map((b) => (
              <tr key={b.mac}>
                <td className="mono">{fmtIp(b.ip)}</td>
                <td className="mono">{fmtMacDot(b.mac)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
