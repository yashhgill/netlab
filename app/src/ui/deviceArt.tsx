import { mediaOf, type Device, type DeviceKind, type Iface } from '../engine/engine';

/**
 * Original NetLab device artwork, drawn in a 64x64 box.
 * Hardware is shown as a three-quarter (isometric) box with a lit front panel,
 * so each model reads like the physical unit while staying small and crisp.
 */

const C = {
  front: '#3b4653',
  top: '#5d6a78',
  side: '#29323c',
  edge: '#7d8a97',
  port: '#141a20',
  led: '#3ddc84',
  amber: '#f2b84b',
  screen: '#9fe3f0',
  screen2: '#5bc2d8',
  light: '#e9eef2',
};

const ACCENT: Record<string, string> = {
  'NL-R1900': '#2fb3a8',
  'NL-R3000': '#2f9de0',
  'NL-R2900': '#7c6cf0',
  'NL-R4400': '#f08a3c',
  'NL-S2400': '#5b8def',
  'NL-S2448': '#4cb8d8',
  'NL-S2960F': '#8fc94f',
  'NL-S3600': '#e0625b',
  'NL-H800': '#a0aab4',
};

/** Isometric box: front rectangle plus top and side faces. */
function Box({ x, y, w, h, d, front = C.front, top = C.top, side = C.side }: { x: number; y: number; w: number; h: number; d: number; front?: string; top?: string; side?: string }) {
  const dy = d * 0.55;
  return (
    <g>
      <path d={`M${x} ${y} L${x + d} ${y - dy} L${x + w + d} ${y - dy} L${x + w} ${y} Z`} fill={top} />
      <path d={`M${x + w} ${y} L${x + w + d} ${y - dy} L${x + w + d} ${y + h - dy} L${x + w} ${y + h} Z`} fill={side} />
      <rect x={x} y={y} width={w} height={h} fill={front} />
      <path d={`M${x} ${y + 0.5} H${x + w}`} stroke={C.edge} strokeWidth="1" />
    </g>
  );
}

function RouterArt({ model }: { model: string }) {
  const accent = ACCENT[model] ?? ACCENT['NL-R3000'];
  const serial = model === 'NL-R1900' || model === 'NL-R2900';
  const ports = model === 'NL-R4400' ? 4 : model === 'NL-R1900' ? 2 : 3;
  return (
    <g>
      <Box x={5} y={30} w={44} h={17} d={13} />
      {/* top-face emblem: two routes crossing */}
      <g transform="translate(34.5 26.4) scale(1 0.55)">
        <circle r="8.6" fill={accent} />
        <path d="M-5 -2.2 H3.2 M1 -4.6 L3.6 -2.2 L1 0.2 M5 2.2 H-3.2 M-1 4.6 L-3.6 2.2 L-1 -0.2" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* front panel */}
      <rect x={5} y={30} width={2.5} height={17} fill={accent} />
      {Array.from({ length: ports }, (_, k) => (
        <g key={k}>
          <rect x={10.5 + k * 6} y={37} width={4.4} height={4} rx="0.6" fill={C.port} />
          <rect x={10.9 + k * 6} y={34.4} width={1.4} height={1.2} fill={C.led} />
        </g>
      ))}
      {serial &&
        [0, 1].map((k) => (
          <path key={k} d={`M${11 + ports * 6 + k * 7.4} 37 h6 l-0.8 4 h-4.4 z`} fill={C.port} />
        ))}
      <circle cx={45.5} cy={34} r="1.1" fill={C.led} />
      <circle cx={45.5} cy={38} r="1.1" fill={C.amber} />
    </g>
  );
}

function SwitchArt({ model, kind }: { model: string; kind: DeviceKind }) {
  const accent = ACCENT[model] ?? ACCENT['NL-S2400'];
  const cols = model === 'NL-S2448' ? 12 : 8;
  const fiber = model === 'NL-S2960F' || model === 'NL-S3600';
  const ml = kind === 'l3switch';
  return (
    <g>
      <Box x={2} y={33} w={50} h={11} d={10} />
      {ml && (
        <g transform="translate(34 30.2) scale(1 0.55)">
          <circle r="7" fill={accent} />
          <path d="M-4 -1.6 H2.6 M0.8 -3.6 L2.8 -1.6 L0.8 0.4 M4 1.6 H-2.6 M-0.8 3.6 L-2.8 1.6 L-0.8 -0.4" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {!ml && <path d="M14 30.2 l6 -3.3 h22 l-6 3.3 z" fill={accent} opacity="0.9" />}
      <rect x={2} y={33} width={2.2} height={11} fill={accent} />
      {Array.from({ length: cols }, (_, k) => {
        const w = (fiber ? 34 : 42) / cols;
        return (
          <g key={k}>
            <rect x={6 + k * w} y={35.2} width={w - 1} height={3} rx="0.4" fill={C.port} />
            <rect x={6 + k * w} y={39.2} width={w - 1} height={3} rx="0.4" fill={C.port} />
          </g>
        );
      })}
      {fiber &&
        [0, 1].map((k) => <rect key={k} x={42 + k * 4.5} y={36} width={3.6} height={5.5} rx="0.5" fill="#8a96a3" stroke={C.port} strokeWidth="0.8" />)}
      <rect x={6} y={43} width={20} height={0.8} fill={C.led} opacity="0.85" />
    </g>
  );
}

function HubArt() {
  return (
    <g>
      <Box x={8} y={34} w={40} h={10} d={9} front="#6c7783" top="#97a2ad" side="#4c5560" />
      {Array.from({ length: 8 }, (_, k) => (
        <g key={k}>
          <rect x={11.5 + k * 4.4} y={37.5} width={3.4} height={3.4} rx="0.4" fill={C.port} />
          <circle cx={13.2 + k * 4.4} cy={35.8} r="0.6" fill={k < 3 ? C.led : '#9aa4ae'} />
        </g>
      ))}
    </g>
  );
}

function PcArt() {
  return (
    <g>
      {/* tower */}
      <Box x={44} y={20} w={10} h={30} d={6} front="#4a5663" top="#6f7c89" side="#323b45" />
      <rect x={46} y={23} width={6} height={1.6} rx="0.8" fill="#c9d3dd" />
      <rect x={46} y={26.5} width={6} height={1.2} rx="0.6" fill="#c9d3dd" />
      <circle cx={49} cy={45} r="1.4" fill={C.led} />
      {/* monitor */}
      <rect x={6} y={13} width={36} height={25} rx="2.5" fill="#2f3943" />
      <rect x={8.5} y={15.5} width={31} height={20} rx="1" fill={C.screen} />
      <path d="M10 33 L18 25.5 L23 30 L29 23 L38 33 Z" fill={C.screen2} opacity="0.8" />
      <path d="M21 38 h6 l1.5 6 h-9 z" fill="#2f3943" />
      <rect x={15} y={44} width={18} height={3} rx="1.5" fill="#2f3943" />
    </g>
  );
}

function LaptopArt() {
  return (
    <g>
      <path d="M14 12 H50 A2.5 2.5 0 0 1 52.5 14.5 V39 H11.5 V14.5 A2.5 2.5 0 0 1 14 12 Z" fill="#2f3943" />
      <rect x={14.5} y={15} width={35} height={21.5} rx="1" fill={C.screen} />
      <path d="M16 34 L24 26 L29 31 L35 23 L47 34 Z" fill={C.screen2} opacity="0.8" />
      <path d="M8 40 H56 L60 47 H4 Z" fill="#5d6a78" />
      <path d="M4 47 H60 V48.5 A1.5 1.5 0 0 1 58.5 50 H5.5 A1.5 1.5 0 0 1 4 48.5 Z" fill="#3b4653" />
      <path d="M12 41.8 H52 M10.5 43.8 H53.5" stroke="#8592a0" strokeWidth="1" />
      <rect x={27} y={45} width={10} height={1.4} rx="0.7" fill="#8592a0" />
    </g>
  );
}

function ServerArt() {
  return (
    <g>
      <Box x={16} y={14} w={24} h={42} d={10} front="#3b4653" top="#5d6a78" side="#29323c" />
      {[0, 1, 2, 3].map((k) => (
        <g key={k}>
          <rect x={18.5} y={17 + k * 8.5} width={19} height={6.5} rx="0.8" fill="#4c5865" stroke="#2a323b" strokeWidth="0.6" />
          <rect x={21} y={19.6 + k * 8.5} width={10} height={1.3} rx="0.6" fill="#8592a0" />
          <circle cx={34.5} cy={20.25 + k * 8.5} r="1" fill={k === 0 ? C.led : k === 1 ? C.amber : '#6b7784'} />
        </g>
      ))}
      <rect x={18.5} y={51} width={19} height={2} rx="1" fill="#2fb3a8" />
    </g>
  );
}

function PrinterArt() {
  return (
    <g>
      <path d="M20 14 h22 v10 h-22 z" fill={C.light} stroke="#b9c3cc" strokeWidth="0.8" />
      <Box x={8} y={24} w={42} h={18} d={8} front="#e4e9ee" top="#f5f7f9" side="#bcc6cf" />
      <rect x={14} y={30} width={30} height={3.5} rx="1" fill="#3b4653" />
      <path d="M14 33.5 h30 l3 10 h-36 z" fill={C.light} stroke="#b9c3cc" strokeWidth="0.8" />
      <circle cx={46} cy={28} r="1.3" fill={C.led} />
      <rect x={10.5} y={27} width={8} height={1.6} rx="0.8" fill="#9aa6b2" />
    </g>
  );
}

function PhoneArt() {
  return (
    <g>
      <path d="M10 46 L16 22 H48 L54 46 Z" fill="#3b4653" />
      <path d="M10 46 H54 V50 H10 Z" fill="#29323c" />
      <rect x={30} y={25} width={16} height={9} rx="1" fill={C.screen} />
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={31 + c * 5} y={36.5 + r * 3.2} width={3.6} height={2.2} rx="0.6" fill="#9aa6b2" />),
      )}
      {/* handset */}
      <path d="M14 24 c-2 0 -3 1.5 -2.5 3.5 l3 14 c0.5 2 2 3 4 2.6 l3 -0.8 c1 -0.3 1.5 -1.3 1.2 -2.3 l-0.8 -2.8 c-0.3 -1 -1.3 -1.5 -2.3 -1.2 l-1.4 0.4 l-1.8 -8.2 l1.4 -0.4 c1 -0.3 1.5 -1.3 1.3 -2.3 l-0.7 -2.8 c-0.3 -1 -1.2 -1.6 -2.2 -1.4 z" fill="#1f262e" />
    </g>
  );
}

export function DeviceArt({ kind, model = '' }: { kind: DeviceKind; model?: string }) {
  switch (kind) {
    case 'router':
      return <RouterArt model={model} />;
    case 'switch':
    case 'l3switch':
      return <SwitchArt model={model} kind={kind} />;
    case 'hub':
      return <HubArt />;
    case 'pc':
      return <PcArt />;
    case 'laptop':
      return <LaptopArt />;
    case 'server':
      return <ServerArt />;
    case 'printer':
      return <PrinterArt />;
    case 'phone':
      return <PhoneArt />;
  }
}

export function DeviceGlyph({ kind, model, size = 64 }: { kind: DeviceKind; model?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <DeviceArt kind={kind} model={model} />
    </svg>
  );
}

// ---------------------------------------------------------------- front panel

function shortName(n: string) {
  return n
    .replace('GigabitEthernet', 'Gi')
    .replace('FastEthernet', 'Fa')
    .replace('Serial', 'Se')
    .replace('Ethernet', 'Eth');
}

/** Front view of a device with every port and its link LED. */
export function DevicePanel({ dev, onPower, onPort }: { dev: Device; onPower?: () => void; onPort?: (i: Iface) => void }) {
  const ports = dev.allPorts();
  const groups: { media: string; items: Iface[] }[] = [];
  for (const p of ports) {
    const m = mediaOf(p);
    const g = groups[groups.length - 1];
    if (g && g.media === m) g.items.push(p);
    else groups.push({ media: m, items: [p] });
  }
  const accent = ACCENT[dev.model] ?? '#2fb3a8';
  const twoRows = ports.length > 16;
  const PW = 22; // port pitch
  let x = 120;
  const layout: { i: Iface; x: number; y: number }[] = [];
  for (const g of groups) {
    const perRow = twoRows && g.items.length > 8 ? Math.ceil(g.items.length / 2) : g.items.length;
    g.items.forEach((it, k) => {
      const col = k % perRow;
      const row = Math.floor(k / perRow);
      layout.push({ i: it, x: x + col * PW, y: twoRows ? 26 + row * 34 : 40 });
    });
    x += perRow * PW + 16;
  }
  const width = Math.max(x + 60, 420);
  const height = twoRows ? 104 : 96;
  const state = (i: Iface) => {
    if (!dev.powered) return 'off';
    if (mediaOf(i) === 'console' || mediaOf(i) === 'rs232') return i.linkId ? 'console' : 'off';
    return dev.lineUp(i.name) ? 'up' : i.linkId ? 'down' : 'off';
  };
  const ledColor = { up: '#3ddc84', down: '#f2b84b', off: '#56606b', console: '#6cb6e8' } as const;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width * 1.15 }} role="img" aria-label={`${dev.model} front panel`}>
      <rect x="2" y="2" width={width - 4} height={height - 4} rx="8" fill="#2f3943" />
      <rect x="2" y="2" width="8" height={height - 4} rx="4" fill={accent} />
      <text x="22" y="30" fill="#e9eef2" fontSize="15" fontWeight="600" fontFamily="var(--font)">
        {dev.model}
      </text>
      <text x="22" y="48" fill="#9aa6b2" fontSize="11" fontFamily="var(--font)">
        {dev.hostname}
      </text>
      <g onClick={onPower} style={{ cursor: onPower ? 'pointer' : 'default' }} role={onPower ? 'button' : undefined} aria-label={onPower ? (dev.powered ? 'Turn off' : 'Turn on') : undefined}>
        <circle cx="40" cy={height - 26} r="13" fill="#1d242b" stroke={dev.powered ? '#3ddc84' : '#56606b'} strokeWidth="2" />
        <path d={`M40 ${height - 33} v6 M35.2 ${height - 30.5} a6.6 6.6 0 1 0 9.6 0`} stroke={dev.powered ? '#3ddc84' : '#8b96a1'} strokeWidth="2" fill="none" strokeLinecap="round" />
        <text x="60" y={height - 22} fill="#9aa6b2" fontSize="11" fontFamily="var(--font)">
          {dev.powered ? 'Power on' : 'Power off'}
        </text>
      </g>
      {layout.map(({ i, x, y }) => {
        const m = mediaOf(i);
        const st = state(i);
        return (
          <g key={i.name} transform={`translate(${x} ${y})`} onClick={() => onPort?.(i)} style={{ cursor: onPort ? 'pointer' : 'default' }}>
            <title>{`${i.name}${i.linkId ? ' (connected)' : ''}`}</title>
            <rect x="5" y="-7" width="7" height="3" rx="1" fill={ledColor[st]} />
            {m === 'serial' ? (
              <path d="M-1 0 h20 l-3 12 h-14 z" fill="#141a20" stroke="#4a5562" />
            ) : m === 'fiber' ? (
              <g>
                <rect x="1" y="0" width="15" height="13" rx="1.5" fill="#8a96a3" />
                <rect x="4" y="3" width="3.5" height="7" fill="#141a20" />
                <rect x="9.5" y="3" width="3.5" height="7" fill="#141a20" />
              </g>
            ) : (
              <path d="M1 0 h15 v10 h-3 v3 h-9 v-3 h-3 z" fill={m === 'console' || m === 'rs232' ? '#2e6f99' : '#141a20'} stroke="#4a5562" />
            )}
            <text x="8.5" y="25" textAnchor="middle" fill="#9aa6b2" fontSize="8.5" fontFamily="var(--mono)">
              {m === 'console' ? 'CON' : m === 'rs232' ? 'COM' : (i.name.match(/(\d+)$/)?.[1] ?? '')}
            </text>
          </g>
        );
      })}
      {groups.map((g, k) => {
        const first = layout.find((l) => l.i === g.items[0])!;
        const prefix = shortName(g.items[0].name).replace(/\d+$/, '');
        const label = g.media === 'console' ? 'Console' : g.media === 'rs232' ? 'RS-232' : g.media === 'fiber' ? `SFP ${prefix}` : prefix;
        return (
          <text key={k} x={first.x} y={14} fill="#c9d3dd" fontSize="10" fontFamily="var(--font)">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
