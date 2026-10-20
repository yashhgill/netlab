import { fmtIp, maskToPrefix } from '../engine/addr';
import { mediaOf, type Device } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import type { Engine } from '../engine/engine';
import { MODELS } from '../engine/models';

/**
 * A compact, model-friendly description of the topology: every device, its cabled
 * ports, addresses, VLANs and routes, plus how many free ports of each type it has.
 */
export function describeTopology(engine: Engine) {
  const name = (id: string) => engine.devices.get(id)?.hostname ?? '?';
  const devices = [...engine.devices.values()].map((d) => describeDevice(engine, d, name));
  return {
    devices,
    links: [...engine.links.values()].map((l) => ({
      a: `${name(l.a.dev)} ${l.a.iface}`,
      b: `${name(l.b.dev)} ${l.b.iface}`,
      cable: l.cable,
      ...(l.dce ? { dce: l.dce === 'a' ? name(l.a.dev) : name(l.b.dev) } : {}),
    })),
    availableModels: MODELS.map((m) => ({ id: m.id, kind: m.kind, ports: m.detail })),
  };
}

function describeDevice(engine: Engine, d: Device, name: (id: string) => string) {
  const ports = d.allPorts();
  const cabled = ports
    .filter((i) => i.linkId)
    .map((i) => {
      const peer = engine.peer(d.id, i.name);
      const row: Record<string, unknown> = { port: i.name, media: mediaOf(i), to: peer ? `${name(peer.dev)} ${peer.iface}` : undefined, up: d.lineUp(i.name) };
      if (i.ip !== undefined) row.ip = `${fmtIp(i.ip)}/${maskToPrefix(i.mask!)}`;
      if (d instanceof Switch && i.physical && !i.routed) row.mode = i.swMode === 'trunk' ? 'trunk' : `access vlan ${i.accessVlan ?? 1}`;
      if (i.routed) row.mode = 'routed';
      if (i.media === 'serial') row.clockRate = i.clockRate ?? null;
      return row;
    });
  const free: Record<string, string[]> = {};
  for (const i of ports) {
    if (i.linkId) continue;
    const m = mediaOf(i);
    (free[m] ??= []).push(i.name);
  }
  const freeSummary = Object.fromEntries(Object.entries(free).map(([m, list]) => [m, list.length > 6 ? `${list.slice(0, 6).join(', ')} (+${list.length - 6} more)` : list.join(', ')]));
  const base: Record<string, unknown> = { name: d.hostname, kind: d.kind, model: d.model, powered: d.powered, ports: cabled, freePorts: freeSummary };
  if (d instanceof Host) {
    base.ipMode = d.ipMode;
    if (d.nic.ip !== undefined) base.ip = `${fmtIp(d.nic.ip)}/${maskToPrefix(d.nic.mask!)}`;
    if (d.gateway !== undefined) base.gateway = fmtIp(d.gateway);
  }
  if (d instanceof Router || d instanceof Switch) {
    const virt = [...d.ifaces.values()].filter((i) => !i.physical && (i.ip !== undefined || i.dot1q !== undefined));
    if (virt.length) base.virtualInterfaces = virt.map((i) => ({ name: i.name, ip: i.ip !== undefined ? `${fmtIp(i.ip)}/${maskToPrefix(i.mask!)}` : undefined, dot1q: i.dot1q, up: d.lineUp(i.name) }));
    if (d.stack.staticRoutes.length) base.staticRoutes = d.stack.staticRoutes.map((r) => `${fmtIp(r.net)}/${maskToPrefix(r.mask)} via ${r.ifName ?? fmtIp(r.nextHop!)}`);
  }
  if (d instanceof Switch) {
    base.vlans = [...d.vlans.entries()].map(([id, n]) => `${id} ${n}`);
    if (d.multilayer) base.ipRouting = d.ipRouting;
    if (d.stack.defaultGateway !== undefined) base.defaultGateway = fmtIp(d.stack.defaultGateway);
  }
  if (d instanceof Router && d.dhcp.pools.length) {
    base.dhcpPools = d.dhcp.pools.map((p) => ({ name: p.name, network: p.net !== undefined ? `${fmtIp(p.net)}/${maskToPrefix(p.mask!)}` : undefined, router: p.router !== undefined ? fmtIp(p.router) : undefined }));
  }
  return base;
}
