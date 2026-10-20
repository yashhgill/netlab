import type { Device } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { IosSession } from './ios';
import { PcShell } from './pc';
import type { Shell } from './shell';

const sessions = new WeakMap<Device, Shell>();

export function shellFor(d: Device): Shell {
  let s = sessions.get(d);
  if (!s) {
    if (d instanceof Router || d instanceof Switch) s = new IosSession(d);
    else s = new PcShell(d as Host);
    sessions.set(d, s);
  }
  return s;
}

export function dropShell(d: Device) {
  sessions.delete(d);
}
