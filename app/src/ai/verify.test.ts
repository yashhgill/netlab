import { describe, expect, it } from 'vitest';
import { Engine, type Device } from '../engine/engine';
import { vlsm } from '../engine/vlsm';
import { sanitizeActions } from './apply';
import { testPlan } from './verify';

const pair = (a: Device, b: Device): [string, string] | null => {
  const pa = a.allPorts().find((p) => !p.linkId && p.media === 'copper');
  const pb = b.allPorts().find((p) => !p.linkId && p.media === 'copper');
  return pa && pb ? [pa.name, pb.name] : null;
};

function lab(withRoutes: boolean, pcbGateway?: string) {
  const plan = vlsm('192.168.0.0/24', [
    { name: 'LAN1', hosts: 50 },
    { name: 'LAN2', hosts: 20 },
    { name: 'WAN', hosts: 2 },
  ]);
  const [lan1, lan2, wan] = plan.subnets;
  return sanitizeActions([
    { type: 'add_device', kind: 'router', model: 'NL-R1900', name: 'R1' },
    { type: 'add_device', kind: 'router', model: 'NL-R1900', name: 'R2' },
    { type: 'add_device', kind: 'switch', name: 'S1' },
    { type: 'add_device', kind: 'pc', name: 'PCA' },
    { type: 'add_device', kind: 'pc', name: 'PCA2' },
    { type: 'add_device', kind: 'pc', name: 'PCB' },
    { type: 'connect', a: 'R1', aPort: 'Se0/0/0', b: 'R2', bPort: 'Serial0/0/0', cable: 'serial-dce' },
    { type: 'connect', a: 'R1', aPort: 'g0/0', b: 'S1', bPort: 'g0/1' },
    { type: 'connect', a: 'PCA', b: 'S1', aPort: 'FastEthernet0', bPort: 'Fa0/1' },
    { type: 'connect', a: 'PCA2', b: 'S1', aPort: 'FastEthernet0', bPort: 'Fa0/2' },
    { type: 'connect', a: 'PCB', b: 'R2' },
    { type: 'cli', device: 'R1', commands: ['interface g0/0', `ip address ${lan1.gateway} ${lan1.mask}`, 'no shutdown', 'interface s0/0/0', `ip address ${wan.firstUsable} ${wan.mask}`, 'clock rate 64000', 'no shutdown', 'exit', ...(withRoutes ? [`ip route ${lan2.network} ${lan2.mask} ${wan.lastUsable}`] : [])] },
    { type: 'cli', device: 'R2', commands: ['interface g0/0', `ip address ${lan2.gateway} ${lan2.mask}`, 'no shutdown', 'interface s0/0/0', `ip address ${wan.lastUsable} ${wan.mask}`, 'no shutdown', 'exit', `ip route ${lan1.network} ${lan1.mask} ${wan.firstUsable}`] },
    { type: 'host_ip', device: 'PCA', ip: '192.168.0.10', mask: lan1.mask, gateway: lan1.gateway },
    { type: 'host_ip', device: 'PCA2', ip: '192.168.0.11', mask: lan1.mask, gateway: lan1.gateway },
    { type: 'host_ip', device: 'PCB', ip: '192.168.0.70', mask: lan2.mask, gateway: pcbGateway ?? lan2.gateway },
  ]);
}

describe('testing an AI plan on a copy', () => {
  it('passes a correct plan and leaves the live network alone', () => {
    const live = new Engine();
    const r = testPlan(live, lab(true), 'build a lab with 2 routers', pair);
    expect(r.problems).toEqual([]);
    expect(r.pings.length).toBeGreaterThanOrEqual(5);
    expect(r.pings.every((p) => p.ok)).toBe(true);
    expect(live.devices.size).toBe(0);
  });

  it('finds a missing route and a wrong gateway', () => {
    const r = testPlan(new Engine(), lab(false, '192.168.0.99'), 'build a lab with 2 routers', pair);
    expect(r.problems.join('\n')).toMatch(/PCB's gateway 192\.168\.0\.99 is not in its own subnet/);
    expect(r.problems.join('\n')).toMatch(/PCA \(192\.168\.0\.10\) cannot ping PCB/);
  });

  it('reports commands IOS rejects and duplicate addresses', () => {
    const acts = lab(true);
    acts.push(...sanitizeActions([
      { type: 'cli', device: 'R1', commands: ['interfaze g0/0'] },
      { type: 'host_ip', device: 'PCA2', ip: '192.168.0.10', mask: '255.255.255.192', gateway: '192.168.0.1' },
    ]));
    const r = testPlan(new Engine(), acts, 'set it up', pair);
    expect(r.problems.join('\n')).toMatch(/R1: IOS rejected "interfaze g0\/0/);
    expect(r.problems.join('\n')).toMatch(/192\.168\.0\.10 is used twice/);
  });
});
