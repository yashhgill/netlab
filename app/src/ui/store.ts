import { useSyncExternalStore } from 'react';
import { Engine, type CableType, type DeviceKind, type PduEvent } from '../engine/engine';
import type { PduKind } from '../engine/packets';
import type { Note } from '../engine/topology';

export const engine = new Engine();
// expose for debugging in devtools
(globalThis as Record<string, unknown>).netlab = engine;

export type Tool = 'select' | 'inspect' | 'delete' | 'note' | 'pdu' | 'cable';
export type Tab = 'physical' | 'config' | 'cli' | 'desktop' | 'services';

export interface DeviceWin {
  devId: string;
  tab: Tab;
  x: number;
  y: number;
  z: number;
}

export interface Scenario {
  id: number;
  src: string;
  dst: string;
  dstIp: number;
  status: 'Ready' | 'In progress' | 'Successful' | 'Failed';
  fired: number;
}

export type InspectTable = 'arp' | 'mac' | 'route' | 'dhcp' | 'ports';

export interface Anim {
  pdus: PduEvent[];
  start: number;
  dur: number;
}

export interface UiState {
  tool: Tool;
  cable: CableType;
  wins: DeviceWin[];
  topZ: number;
  scenarios: Scenario[];
  notes: Note[];
  playing: boolean;
  speed: number; // ms per step
  filters: Record<PduKind, boolean>;
  fileName: string;
  dirty: boolean;
  showLabels: boolean;
  selected: { kind: 'device' | 'link' | 'note'; id: string } | null;
  cableFrom: { dev: string; iface: string } | null;
  portPicker: { dev: string; x: number; y: number } | null;
  pduSrc: string | null;
  toast: { text: string; tone: 'info' | 'error' } | null;
  pduDetail: PduEvent | null;
  anim: Anim | null;
  engineVersion: number;
  frame: number;
  menu: string | null;
  dialog: 'about' | 'shortcuts' | 'new' | null;
  placing: DeviceKind | null;
  placingModel: string | null;
  inspects: { id: number; devId: string; table: InspectTable; x: number; y: number }[];
  inspectMenu: { devId: string; x: number; y: number } | null;
  ask: { text: string; ok: string; resolve: (v: boolean) => void } | null;
  aiOpen: boolean;
  importReport: { name: string; version: string; devices: number; links: number; warnings: string[] } | null;
  /** Which bottom/side panels are open. Users can minimize each one; remembered per browser. */
  panels: Panels;
}

export interface Panels {
  devices: boolean;
  pdus: boolean;
  mode: boolean;
  sim: boolean;
}

const PANELS_KEY = 'netlab.panels';

function initialPanels(): Panels {
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 900;
  const def: Panels = { devices: true, pdus: !narrow, mode: true, sim: true };
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...def, ...saved };
  } catch {
    /* storage unavailable */
  }
  return def;
}

export function togglePanel(k: keyof Panels, open?: boolean) {
  const panels = { ...state.panels, [k]: open ?? !state.panels[k] };
  setState({ panels });
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
  } catch {
    /* storage unavailable */
  }
}

let state: UiState = {
  tool: 'select',
  cable: 'auto',
  wins: [],
  topZ: 10,
  scenarios: [],
  notes: [],
  playing: false,
  speed: 700,
  filters: { ARP: true, ICMP: true, DHCP: true },
  fileName: 'Untitled',
  dirty: false,
  showLabels: true,
  selected: null,
  cableFrom: null,
  portPicker: null,
  pduSrc: null,
  toast: null,
  pduDetail: null,
  anim: null,
  engineVersion: 0,
  frame: 0,
  menu: null,
  dialog: null,
  placing: null,
  placingModel: null,
  inspects: [],
  inspectMenu: null,
  ask: null,
  aiOpen: false,
  importReport: null,
  panels: initialPanels(),
};

const subs = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(p: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  const patch = typeof p === 'function' ? p(state) : p;
  state = { ...state, ...patch };
  for (const s of subs) s();
}

export function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'info' | 'error' = 'info') {
  setState({ toast: { text, tone } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3200);
}

export function openWindow(devId: string, tab?: Tab) {
  setState((s) => {
    const z = s.topZ + 1;
    const existing = s.wins.find((w) => w.devId === devId);
    if (existing) return { topZ: z, wins: s.wins.map((w) => (w.devId === devId ? { ...w, z, tab: tab ?? w.tab } : w)) };
    const d = engine.devices.get(devId);
    const defTab: Tab =
      tab ?? (!d ? 'physical' : d.kind === 'router' || d.kind === 'switch' || d.kind === 'l3switch' ? 'cli' : d.kind === 'pc' || d.kind === 'laptop' || d.kind === 'server' || d.kind === 'tablet' || d.kind === 'smartphone' ? 'desktop' : d.kind === 'hub' ? 'physical' : 'config');
    const n = s.wins.length;
    return { topZ: z, wins: [...s.wins, { devId, tab: defTab, x: 120 + n * 28, y: 70 + n * 28, z }] };
  });
}

export function closeWindow(devId: string) {
  setState((s) => ({ wins: s.wins.filter((w) => w.devId !== devId) }));
}

export function markDirty() {
  if (!state.dirty) setState({ dirty: true });
}

/** In-app confirmation (native confirm() is unavailable in some embeds). */
export function askConfirm(text: string, ok = 'Discard changes'): Promise<boolean> {
  return new Promise((resolve) => setState({ ask: { text, ok, resolve } }));
}
