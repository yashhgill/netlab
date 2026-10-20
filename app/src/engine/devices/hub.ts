import { newMac } from '../addr';
import { Device, type DeviceKind } from '../engine';
import { modelSpec } from '../models';
import type { Frame } from '../packets';

/** A repeater: every frame that arrives goes out of every other connected port. */
export class Hub extends Device {
  kind: DeviceKind = 'hub';
  model: string;

  constructor(id: string, hostname = 'Hub', model?: string) {
    super(id, hostname);
    const spec = modelSpec(model, 'hub');
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
    if (!sent) this.drop(frame, 'no other ports connected');
  }

  toJSON() {
    return { type: 'hub', model: this.model, powered: this.powered, id: this.id, hostname: this.hostname, x: this.x, y: this.y };
  }

  static fromJSON(j: Record<string, any>): Hub {
    const h = new Hub(j.id, j.hostname, j.model);
    if (j.powered === false) h.powered = false;
    h.x = j.x;
    h.y = j.y;
    return h;
  }
}
