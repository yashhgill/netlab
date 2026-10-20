import { useEffect } from 'react';
import { autosave, restoreAutosave, simStep } from './ui/actions';
import { Canvas, canvasApi } from './ui/Canvas';
import { DeviceWindows } from './ui/DeviceWindow';
import { Dock } from './ui/Dock';
import { PduDetail, SimPanel } from './ui/SimPanel';
import { loadExample, ToolPalette, TopBar } from './ui/TopBar';
import { InspectMenu, InspectWindows } from './ui/Inspect';
import { UiIcon } from './ui/icons';
import { engine, getState, setState, useUi } from './ui/store';
import { isDesktop } from './platform';

function useEngineLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastVersion = -1;
    let lastStep = 0;
    let lastSave = 0;
    let savedVersion = -1;
    const loop = (t: number) => {
      const dt = Math.min(250, t - last);
      last = t;
      const s = getState();
      if (engine.mode === 'realtime') engine.tick(dt);
      else if (s.playing && t - lastStep >= s.speed) {
        lastStep = t;
        const moved = simStep();
        if (!moved && engine.pendingCount() === 0) setState({ playing: false });
      }
      if (engine.version !== lastVersion) {
        lastVersion = engine.version;
        setState({ engineVersion: engine.version });
      }
      const anim = getState().anim;
      if (anim) {
        if (t - anim.start > anim.dur + 120) setState({ anim: null });
        else setState({ frame: t });
      }
      if (t - lastSave > 3000 && savedVersion !== engine.version) {
        lastSave = t;
        savedVersion = engine.version;
        autosave();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export default function App() {
  useEngineLoop();
  useUi((s) => s.engineVersion);
  const toast = useUi((s) => s.toast);
  const dialog = useUi((s) => s.dialog);
  const tool = useUi((s) => s.tool);
  const sim = engine.mode === 'simulation';

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ex = params.get('example');
    if (ex) loadExample(ex);
    else if (restoreAutosave()) setTimeout(() => canvasApi.fit(), 60);
    else if (import.meta.env.VITE_FIRST_EXAMPLE) loadExample(import.meta.env.VITE_FIRST_EXAMPLE);
    const close = () => setState({ menu: null });
    window.addEventListener('pointerdown', close);
    const warn = (e: BeforeUnloadEvent) => {
      autosave();
      if (getState().dirty && !isDesktop) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  return (
    <div className={`app tool-${tool}`}>
      <TopBar />
      <main className="main">
        <div className="stage">
          <Canvas />
          <ToolPalette />
          <InspectMenu />
          <InspectWindows />
          <DeviceWindows />
        </div>
        {sim && <SimPanel />}
      </main>
      <Dock />
      <PduDetail />
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
      {dialog && <Dialog kind={dialog} />}
      <AskDialog />
    </div>
  );
}

function Dialog({ kind }: { kind: 'about' | 'shortcuts' | 'new' }) {
  const close = () => setState({ dialog: null });
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label={kind === 'about' ? 'About NetLab' : 'Keyboard shortcuts'} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{kind === 'about' ? 'HarNova NetLab' : 'Keyboard shortcuts'}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <UiIcon.close />
          </button>
        </div>
        {kind === 'about' ? (
          <div className="about">
            <p>An open-source network simulator for learning switching, routing and the IOS-style command line. Build a topology, configure it, and watch every frame move in simulation mode.</p>
            <p className="muted small">Version 1.0. Made by HarNova Technology. NetLab is an independent project and is not affiliated with or endorsed by any network equipment vendor.</p>
            <p className="muted small">Supported today: 4 router models with Gigabit, serial and fiber ports; 4 switch models including a multilayer switch; hubs; PCs, laptops, servers, printers and IP phones; straight-through, cross-over, fiber, serial DCE/DTE and console cables. Ethernet switching, VLANs and 802.1Q trunks, router-on-a-stick, inter-VLAN routing on SVIs and routed ports, serial links with clock rate and HDLC/PPP, static routing, ARP, ICMP ping and traceroute, DHCP server and relay, CDP neighbors, IOS passwords, banners and startup-config.</p>
          </div>
        ) : (
          <table className="grid-table compact shortcuts">
            <tbody>
              {[
                ['V', 'Select and move'],
                ['N', 'Place a note'],
                ['D', 'Delete tool'],
                ['P', 'Add a simple PDU'],
                ['I', 'Inspect ARP, MAC and routing tables'],
                ['Esc', 'Back to select'],
                ['Delete', 'Delete the selected item'],
                ['Ctrl/⌘ + S', 'Save'],
                ['Ctrl/⌘ + O', 'Open'],
                ['Scroll', 'Zoom the workspace'],
                ['Drag empty space', 'Pan the workspace'],
                ['?', 'In the CLI: list commands you can type next'],
                ['Tab', 'In the CLI: complete the current word'],
                ['↑ ↓', 'In the CLI: command history'],
                ['Ctrl + C', 'In the CLI: stop a ping, or leave config mode'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AskDialog() {
  const ask = useUi((s) => s.ask);
  if (!ask) return null;
  const done = (v: boolean) => {
    setState({ ask: null });
    ask.resolve(v);
  };
  return (
    <div className="modal-back" onPointerDown={() => done(false)}>
      <div className="modal" role="alertdialog" aria-label="Confirm" onPointerDown={(e) => e.stopPropagation()}>
        <p style={{ margin: '0 0 18px', fontSize: 15 }}>{ask.text}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => done(false)} autoFocus>
            Keep editing
          </button>
          <button className="btn primary" onClick={() => done(true)}>
            {ask.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
