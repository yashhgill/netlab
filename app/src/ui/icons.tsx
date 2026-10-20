
export { DeviceArt, DeviceGlyph } from './deviceArt';

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
  sparkle: () => <I d="M10 2.5 L11.6 7.4 L16.5 9 L11.6 10.6 L10 15.5 L8.4 10.6 L3.5 9 L8.4 7.4 Z M15.5 13.5 L16.2 15.3 L18 16 L16.2 16.7 L15.5 18.5 L14.8 16.7 L13 16 L14.8 15.3 Z" />,
  user: () => <I d="M10 3.5 a3.2 3.2 0 1 0 0.01 0 M3.5 17 c0.8 -3.4 3.4 -5 6.5 -5 s5.7 1.6 6.5 5" />,
  send: () => <I d="M3 10 L17 3.5 L12 17 L9.5 11 Z M9.5 11 L17 3.5" />,
  calc: () => <I d="M5 2.5 H15 V17.5 H5 Z M7.5 5 H12.5 V7.5 H7.5 Z M7.5 10.5 H8.5 M10 10.5 H10.5 M12 10.5 H12.5 M7.5 13.5 H8.5 M10 13.5 H10.5 M12 13.5 H12.5" />,
  inspect: () => <I d="M8.5 3.5 a5 5 0 1 0 0.01 0 M12.2 12.2 L17 17 M6.5 8.5 H10.5 M8.5 6.5 V10.5" />,
  power: () => <I d="M10 3 V10 M6 5.6 a6 6 0 1 0 8 0" />,
  fastForward: () => <I d="M3 5 L10 10 L3 15 Z M10 5 L17 10 L10 15 Z" />,
  clock: () => <I d="M10 3.5 a6.5 6.5 0 1 0 0.01 0 M10 6.5 V10 L12.5 11.5" />,
  stopwatch: () => <I d="M10 5.5 a6 6 0 1 0 0.01 0 M8 2.5 H12 M10 2.5 V5.5 M10 8 V11.5 M15 5 L16.3 3.7" />,
  newFile: () => <I d="M5 2.5 H12 L15.5 6 V17.5 H5 Z M12 2.5 V6 H15.5 M10.25 9 V14 M7.75 11.5 H12.75" />,
};

import type { CableType } from '../engine/engine';

/** How each cable type is drawn, on the workspace and in the picker. */
export const CABLE_STYLE: Record<CableType, { stroke: string; dash?: string; width: number }> = {
  auto: { stroke: '#34404c', width: 2 },
  straight: { stroke: '#34404c', width: 2 },
  cross: { stroke: '#34404c', dash: '7 5', width: 2 },
  fiber: { stroke: '#e8812f', width: 2.4 },
  'serial-dce': { stroke: '#d9434e', width: 2.2 },
  'serial-dte': { stroke: '#d9434e', width: 2.2 },
  console: { stroke: '#5aa9de', width: 2.2 },
};

export function CableSwatch({ type, big = false }: { type: CableType; big?: boolean }) {
  const sz = big ? 34 : 18;
  if (type === 'auto') {
    return (
      <svg width={sz} height={sz} viewBox="0 0 20 20" aria-hidden="true">
        <path d="M11 2 L5 11 H10 L8.5 18 L15 8.5 H10 Z" fill="#f2b84b" stroke="#a8741a" strokeWidth="0.8" strokeLinejoin="round" />
      </svg>
    );
  }
  const st = CABLE_STYLE[type];
  const serial = type.startsWith('serial');
  return (
    <svg width={sz} height={sz} viewBox="0 0 20 20" aria-hidden="true">
      {serial ? (
        <path d="M3 16 L8 11 L12 12 L17 4" stroke={st.stroke} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : type === 'console' ? (
        <path d="M3 16 C 6 4, 14 16, 17 4" stroke={st.stroke} strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M3 16 L17 4" stroke={st.stroke} strokeWidth="2" strokeDasharray={st.dash ? '3 2.5' : undefined} strokeLinecap="round" />
      )}
      {type === 'serial-dce' && (
        <g transform="translate(14.5 14.5)">
          <circle r="4" fill="#fff" stroke={st.stroke} strokeWidth="1.2" />
          <path d="M0 -2.2 V0 L1.6 1" stroke={st.stroke} strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
