import type { DeviceKind } from '../engine/engine';

/**
 * Original NetLab device artwork. Each icon is drawn in a 64x64 box.
 * Style: flat front face + lighter top face, rounded corners, one glyph per role.
 */

export function DeviceGlyph({ kind, size = 64 }: { kind: DeviceKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <DeviceArt kind={kind} />
    </svg>
  );
}

export function DeviceArt({ kind }: { kind: DeviceKind }) {
  switch (kind) {
    case 'router':
      return <RouterArt />;
    case 'switch':
      return <SwitchArt />;
    case 'pc':
      return <PcArt />;
    case 'laptop':
      return <LaptopArt />;
    case 'server':
      return <ServerArt />;
  }
}

function RouterArt() {
  // Teal chassis with a forking "route" glyph.
  return (
    <g>
      <path d="M10 24 L20 14 H54 L54 14 L44 24 Z" fill="#3FB3B0" />
      <path d="M44 24 L54 14 V40 L44 50 Z" fill="#0E5F64" />
      <rect x="10" y="24" width="34" height="26" rx="3" fill="#157A82" />
      <path d="M15 37 H23 C27 37 27 31 31 31 H38" stroke="#E9FBFA" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M23 37 C27 37 27 43 31 43 H38" stroke="#E9FBFA" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="15" cy="37" r="2.6" fill="#E9FBFA" />
      <path d="M36 28 L40 31 L36 34" stroke="#E9FBFA" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M36 40 L40 43 L36 46" stroke="#E9FBFA" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function SwitchArt() {
  // Wide indigo slab with a row of ports.
  return (
    <g>
      <path d="M4 30 L12 22 H60 L52 30 Z" fill="#8A8FE6" />
      <path d="M52 30 L60 22 V36 L52 44 Z" fill="#2E3289" />
      <rect x="4" y="30" width="48" height="14" rx="2.5" fill="#4A4FB8" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={8 + i * 6.2} y="34" width="4.4" height="4" rx="0.8" fill="#DCDDFB" />
      ))}
      <rect x="45.5" y="34" width="3.5" height="4" rx="0.8" fill="#F2C14E" />
    </g>
  );
}

function PcArt() {
  return (
    <g>
      <rect x="8" y="12" width="40" height="28" rx="3" fill="#44546A" />
      <rect x="11.5" y="15.5" width="33" height="21" rx="1.5" fill="#9FE3F0" />
      <path d="M14 33 L22 25 L27 30 L33 22 L42 33 Z" fill="#5BC2D8" opacity="0.8" />
      <rect x="24" y="40" width="8" height="6" fill="#33404F" />
      <rect x="16" y="46" width="24" height="4" rx="2" fill="#33404F" />
      <rect x="50" y="18" width="9" height="32" rx="2" fill="#5B6B80" />
      <rect x="52" y="22" width="5" height="2" rx="1" fill="#C9D3DD" />
      <circle cx="54.5" cy="44" r="1.6" fill="#7CE0A0" />
    </g>
  );
}

function LaptopArt() {
  return (
    <g>
      <path d="M14 12 H50 A2.5 2.5 0 0 1 52.5 14.5 V40 H11.5 V14.5 A2.5 2.5 0 0 1 14 12 Z" fill="#44546A" />
      <rect x="15" y="15.5" width="34" height="21.5" rx="1.2" fill="#9FE3F0" />
      <path d="M17 34 L25 26 L30 31 L36 23 L46 34 Z" fill="#5BC2D8" opacity="0.8" />
      <path d="M6 42 H58 L54 50 H10 Z" fill="#5B6B80" />
      <rect x="27" y="44" width="10" height="2" rx="1" fill="#C9D3DD" />
    </g>
  );
}

function ServerArt() {
  return (
    <g>
      <path d="M16 12 L24 6 H50 L42 12 Z" fill="#B9A27E" />
      <path d="M42 12 L50 6 V52 L42 58 Z" fill="#6B5534" />
      <rect x="16" y="12" width="26" height="46" rx="2.5" fill="#8C7350" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="19.5" y={16 + i * 11} width="19" height="7.5" rx="1.2" fill="#F3EBDD" />
          <circle cx="23" cy={19.75 + i * 11} r="1.4" fill={i === 0 ? '#22A55B' : '#8C7350'} />
          <rect x="27" y={19 + i * 11} width="9" height="1.6" rx="0.8" fill="#B9A27E" />
        </g>
      ))}
      <circle cx="29" cy="52" r="2" fill="#F3EBDD" />
    </g>
  );
}

// ---- small UI icons (stroke style, 20x20) ----
type IP = { d: string };
const I = ({ d }: IP) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const UiIcon = {
  select: () => <I d="M4 3 L15 10 L10 11 L13 17 L11 18 L8 12 L4 15 Z" />,
  hand: () => <I d="M7 10 V4.5 a1.3 1.3 0 0 1 2.6 0 V9 M9.6 8.5 V3.5 a1.3 1.3 0 0 1 2.6 0 V9 M12.2 8.5 V5 a1.3 1.3 0 0 1 2.6 0 V12 c0 3.5 -2.3 5.5 -5.3 5.5 c-2.2 0 -3.4 -1 -4.6 -2.8 L3 11.6 a1.3 1.3 0 0 1 2.1 -1.5 L7 12" />,
  note: () => <I d="M4 3 H16 V12 L12 16 H4 Z M12 16 V12 H16 M7 7 H13 M7 10 H11" />,
  trash: () => <I d="M3.5 5.5 H16.5 M8 5.5 V3.5 H12 V5.5 M5.5 5.5 L6.5 17 H13.5 L14.5 5.5 M8.5 8.5 V14 M11.5 8.5 V14" />,
  pdu: () => <I d="M3 6 H17 V15 H3 Z M3 6 L10 11 L17 6" />,
  play: () => <I d="M6 4 L16 10 L6 16 Z" />,
  pause: () => <I d="M6.5 4 V16 M13.5 4 V16" />,
  step: () => <I d="M4 4 L12 10 L4 16 Z M15 4 V16" />,
  reset: () => <I d="M4 10 a6 6 0 1 0 2 -4.5 M4 3.5 V6 H6.5" />,
  zoomIn: () => <I d="M9 4 a5 5 0 1 0 0.01 0 M9 6.5 V11.5 M6.5 9 H11.5 M13 13 L17 17" />,
  zoomOut: () => <I d="M9 4 a5 5 0 1 0 0.01 0 M6.5 9 H11.5 M13 13 L17 17" />,
  fit: () => <I d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13" />,
  close: () => <I d="M5 5 L15 15 M15 5 L5 15" />,
  cableAuto: () => <I d="M11 2 L5 11 H10 L8.5 18 L15 8.5 H10 Z" />,
  cableStraight: () => <I d="M3 16 L17 4" />,
  cableCross: () => <I d="M3 16 L17 4" />,
  folder: () => <I d="M3 6 a1 1 0 0 1 1 -1 H8 L10 7 H16 a1 1 0 0 1 1 1 V15 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 Z" />,
  save: () => <I d="M4 3 H13.5 L16.5 6 V17 H4 Z M7 3 V7 H12 V3 M7 17 V12 H13 V17" />,
  file: () => <I d="M5 2.5 H12 L15.5 6 V17.5 H5 Z M12 2.5 V6 H15.5" />,
};

export function CableSwatch({ type }: { type: 'auto' | 'straight' | 'cross' }) {
  if (type === 'auto') return <UiIcon.cableAuto />;
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 16 L17 4" stroke="currentColor" strokeWidth="2" strokeDasharray={type === 'cross' ? '3 2.5' : undefined} strokeLinecap="round" />
    </svg>
  );
}
