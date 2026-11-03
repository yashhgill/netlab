/**
 * Try an AI plan on a copy of the network before the user sees it, and report anything wrong:
 * commands IOS rejected, cables that could not be made, address mistakes, and pings that fail.
 * The live network is never touched here.
 */
import { fmtIp, maskToPrefix, sameSubnet } from '../engine/addr';
import { Engine, type Device } from '../engine/engine';
import { Host } from '../engine/devices/host';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import type { PingResult } from '../engine/ipstack';
import { load, serialize } from '../engine/topology';
import { applyActions, type ActionResult, type AiAction } from './apply';

export interface PingCheck {
  from: string;
  to: string;
  ip: string;
  why: 'gateway' | 'same LAN' | 'other network';
  ok: boolean;
}

export interface CheckReport {
  /** Things that are wrong and should be fixed. */
  problems: string[];
  pings: PingCheck[];
  /** Results of applying the plan on the copy. */
  results: ActionResult[];
}

type AutoPair = (a: Device, b: Device) => [string, string] | null;

const label = (d: Device) => d.hostname;

/** Does the request expect every network to reach every other one? */
export function wantsFullReach(prompt: string, actions: AiAction[]): boolean {
  if (/\b(isolat|separate|block|must not|shouldn'?t|should not|cannot reach|can'?t reach|no access)/i.test(prompt)) return false;
  if (actions.some((a) => a.type === 'cli' && a.commands.some((c) => /^ip route /i.test(c)))) return true;
  return /\b(rout|ping|reach|communicat|talk|connect|lab|build|whole|every|all|full|set ?up|configure|vlsm|subnet|network|topolog|design|fix)/i.test(prompt);
}

export function testPlan(live: Engine, actions: AiAction[], prompt: string, autoPair: AutoPair): CheckReport {
  const e = new Engine();
  load(e, serialize(live));
  const results = applyActions(
    e,
    actions,
    (a, b, cable) => {
      const r = e.connect(a, b, cable);
      return typeof r === 'string' ? r : null;
    },
    autoPair,
  );
  const problems: string[] = [];
  for (const r of results) {
    if (!r.ok && !r.errors?.length) problems.push(r.message);
    for (const err of r.errors ?? []) problems.push(`${r.message.replace(/^Configured (\S+).*/, '$1')}: IOS rejected "${err}"`);
  }

  // let links settle and DHCP clients get their addresses
  e.refreshAll();
  e.runFor(20000);

  const devs = [...e.devices.values()];
  const hosts = devs.filter((d): d is Host => d instanceof Host && d.powered);

  // ---- addresses
  const seen = new Map<number, string>();
  const note = (ip: number | undefined, who: string) => {
    if (ip === undefined) return;
    const prev = seen.get(ip);
    if (prev && prev !== who) problems.push(`${fmtIp(ip)} is used twice: on ${prev} and on ${who}`);
    else seen.set(ip, who);
  };
  for (const d of devs) {
    if (d instanceof Router || d instanceof Switch) {
      for (const i of d.ifaces.values()) {
        if (i.ip === undefined) continue;
        note(i.ip, `${label(d)} ${i.name}`);
        if (i.physical && i.linkId && !i.adminUp) problems.push(`${label(d)} ${i.name} has an address but is shut down (needs "no shutdown")`);
      }
    }
  }
  for (const h of hosts) {
    const ip = h.nic.ip;
    const mask = h.nic.mask;
    if (ip === undefined || mask === undefined) {
      if (h.ipMode === 'dhcp') problems.push(`${label(h)} did not get an address by DHCP${h.dhcpStatus ? ` (${h.dhcpStatus})` : ''}`);
      continue;
    }
    if (h.ipMode === 'dhcp' && /APIPA/i.test(h.dhcpStatus)) {
      problems.push(`${label(h)} did not get an address by DHCP and fell back to ${fmtIp(ip)}`);
      continue;
    }
    note(ip, label(h));
    const net = (ip & mask) >>> 0;
    const bcast = (net | (~mask >>> 0)) >>> 0;
    if (maskToPrefix(mask) < 31 && (ip === net || ip === bcast)) problems.push(`${label(h)} uses ${fmtIp(ip)}, which is the ${ip === net ? 'network' : 'broadcast'} address of its subnet`);
    const gw = h.stack.defaultGateway;
    if (gw === undefined) problems.push(`${label(h)} (${fmtIp(ip)}/${maskToPrefix(mask)}) has no default gateway`);
    else if (!sameSubnet(gw, ip, mask)) problems.push(`${label(h)}'s gateway ${fmtIp(gw)} is not in its own subnet ${fmtIp(net)}/${maskToPrefix(mask)}`);
  }

  // ---- pings
  const jobs: { h: Host; dst: number; check: PingCheck; replies: number; done: boolean }[] = [];
  const add = (h: Host, dst: number, to: string, why: PingCheck['why']) => {
    if (jobs.length >= 60) return;
    jobs.push({ h, dst, check: { from: label(h), to, ip: fmtIp(dst), why, ok: false }, replies: 0, done: false });
  };
  const addressed = hosts.filter((h) => h.nic.ip !== undefined && !/APIPA/i.test(h.dhcpStatus));
  const subnets = new Map<string, Host[]>();
  for (const h of addressed) {
    const key = `${fmtIp((h.nic.ip! & h.nic.mask!) >>> 0)}/${maskToPrefix(h.nic.mask!)}`;
    (subnets.get(key) ?? subnets.set(key, []).get(key)!).push(h);
  }
  for (const h of addressed) {
    const gw = h.stack.defaultGateway;
    if (gw !== undefined && sameSubnet(gw, h.nic.ip!, h.nic.mask!)) add(h, gw, `its gateway`, 'gateway');
  }
  for (const list of subnets.values()) if (list.length > 1) add(list[0], list[1].nic.ip!, label(list[1]), 'same LAN');
  if (wantsFullReach(prompt, actions)) {
    const reps = [...subnets.values()].map((l) => l[0]);
    for (const a of reps) for (const b of reps) if (a !== b) add(a, b.nic.ip!, label(b), 'other network');
  }
  for (const j of jobs) {
    j.h.stack.ping(
      j.dst,
      { count: 3 },
      (r: PingResult) => {
        if (r.kind === 'reply') j.replies++;
      },
      () => (j.done = true),
    );
  }
  e.runFor(40000);
  for (const j of jobs) {
    j.check.ok = j.replies > 0;
    if (!j.check.ok) {
      const what = j.check.why === 'gateway' ? `its gateway ${j.check.ip}` : `${j.check.to} (${j.check.ip})`;
      problems.push(`${j.check.from} (${fmtIp(j.h.nic.ip!)}) cannot ping ${what}`);
    }
  }
  return { problems: [...new Set(problems)].slice(0, 40), pings: jobs.map((j) => j.check), results };
}
