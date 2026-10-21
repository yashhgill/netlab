import { newMac } from '../addr';
import { Device, type DeviceKind, type WifiSettings } from '../engine';
import { modelSpec } from '../models';
import type { Frame } from '../packets';

/** A repeater: every frame that arrives goes out of every other connected port. */
export class Hub extends Device {
  kind: DeviceKind = 'hub';
  model: string;

  constructor(id: string, hostname = 'Hub', model?: string, kind: 'hub' | 'ap' = 'hub') {
    super(id, hostname);
    this.kind = kind;
    const spec = modelSpec(model, kind);
    this.model = spec.id;
    for (const p of spec.ports) this.ifaces.set(p.name, { name: p.name, mac: newMac(), adminUp: true, physical: true, speed: p.speed, media: p.media });
  }

  receive(inPort: string, frame: Frame) {
    if (!this.lineUp(inPort)) return;
    let sent = 0;
    for (const p of this.physicalIfaces()) {
      if (p.name === inPort || !this.lineUp(p.name)) continue;
      this.sendFrame(p.name, frame);
      sent++;
    }
    if (!sent && this.kind === 'hub') this.drop(frame, 'no other ports connected');
  }

  toJSON() {
    return { type: this.kind, model: this.model, powered: this.powered, id: this.id, hostname: this.hostname, x: this.x, y: this.y };
  }

  static fromJSON(j: Record<string, any>): Hub {
    const h = j.type === 'ap' ? new AccessPoint(j.id, j.hostname, j.model) : new Hub(j.id, j.hostname, j.model);
    if (h instanceof AccessPoint && j.wifi) h.wifi = { ssid: String(j.wifi.ssid ?? 'Default'), key: j.wifi.key || undefined };
    if (j.powered === false) h.powered = false;
    h.x = j.x;
    h.y = j.y;
    return h;
  }
}

/**
 * Wireless access point: a bridge between its Ethernet port and the radio.
 * Clients whose SSID and key match are associated by the engine and get a
 * radio slot each; the radio is a shared medium, so frames are repeated.
 */
export class AccessPoint extends Hub {
  wifi: WifiSettings = { ssid: 'Default' };

  constructor(id: string, hostname = 'AccessPoint', model?: string) {
    super(id, hostname, model, 'ap');
  }

  setWifi(w: WifiSettings) {
    this.wifi = { ssid: w.ssid, key: w.key || undefined };
    this.engine?.bump();
  }

  toJSON() {
    return { ...super.toJSON(), wifi: this.wifi };
  }

  /** Clients associated right now. */
  clients(): string[] {
    const out: string[] = [];
    for (const i of this.ifaces.values()) {
      if (i.media !== 'wireless' || !i.linkId) continue;
      const p = this.engine?.peer(this.id, i.name);
      const d = p && this.engine.devices.get(p.dev);
      if (d) out.push(d.hostname);
    }
    return out;
  }
}
