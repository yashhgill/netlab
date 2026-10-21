import { useEffect } from 'react';
import { autosave, restoreAutosave, simStep } from './ui/actions';
import { Canvas, canvasApi } from './ui/Canvas';
import { DeviceWindows } from './ui/DeviceWindow';
import { Dock } from './ui/Dock';
import { PduDetail, SimPanel } from './ui/SimPanel';
import { openBytes, ToolPalette, TopBar } from './ui/TopBar';
import { InspectMenu, InspectWindows } from './ui/Inspect';
import { UiIcon } from './ui/icons';
import { engine, getState, setState, useUi } from './ui/store';
import { isDesktop } from './platform';
import { AiPanel } from './ui/AiPanel';
import { AccountDialogs } from './account/AccountUi';

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
    if (restoreAutosave()) setTimeout(() => canvasApi.fit(), 60);
    const close = () => setState({ menu: null });
    window.addEventListener('pointerdown', close);
    const warn = (e: BeforeUnloadEvent) => {
      autosave();
      if (getState().dirty && !isDesktop) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    // drop a .nlab / .pkt / .pka / .pkz file anywhere to open it
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      if (getState().dirty && !window.confirm('This topology has unsaved changes. Discard them?')) return;
      await openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
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
        <AiPanel />
      </main>
      <Dock />
      <PduDetail />
      <AccountDialogs />
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
      {dialog && <Dialog kind={dialog} />}
      <AskDialog />
      <ImportReport />
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
            <p className="muted small">Supported today: 8 router models with Fast Ethernet, Gigabit, serial and fiber ports; 7 switch models including two multilayer switches; hubs and repeaters; wireless access points; PCs, laptops, servers, printers, IP phones, tablets, smartphones and TVs, wired or Wi-Fi; straight-through, cross-over, fiber, serial DCE/DTE, console and wireless connections. Opens Packet Tracer .pkt, .pka and .pkz files. Ethernet switching, VLANs and 802.1Q trunks, router-on-a-stick, inter-VLAN routing on SVIs and routed ports, serial links with clock rate and HDLC/PPP, static routing, ARP, ICMP ping and traceroute, DHCP server and relay, CDP neighbors, IOS passwords, banners and startup-config.</p>
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

function ImportReport() {
  const r = useUi((s) => s.importReport);
  if (!r) return null;
  const close = () => setState({ importReport: null });
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label="Packet Tracer import" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Opened {r.name}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <UiIcon.close />
          </button>
        </div>
        <p style={{ marginTop: 0 }}>
          Imported {r.devices} device{r.devices === 1 ? '' : 's'} and {r.links} cable{r.links === 1 ? '' : 's'}
          {r.version ? ` from a Packet Tracer ${r.version} file` : ''}, with router and switch configurations, addressing and wireless settings.
        </p>
        {r.warnings.length > 0 && (
          <>
            <p className="muted small" style={{ marginBottom: 6 }}>
              Worth checking:
            </p>
            <ul className="import-warnings">
              {r.warnings.slice(0, 30).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {r.warnings.length > 30 && <li>…and {r.warnings.length - 30} more.</li>}
            </ul>
          </>
        )}
        <p className="muted small">Save with Ctrl/⌘ + S to keep it as a NetLab file. Routing protocols and some features from the original lab may not be simulated yet.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={close} autoFocus>
            Start working
          </button>
        </div>
      </div>
    </div>
  );
}
