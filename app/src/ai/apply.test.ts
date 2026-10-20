import { describe, expect, it } from 'vitest';
import { parseIp } from '../engine/addr';
import { Engine, type CableType } from '../engine/engine';
import type { Host } from '../engine/devices/host';
import { createDevice } from '../engine/topology';
import { applyActions, sanitizeActions } from './apply';
import { describeTopology } from './topology';
import { vlsm } from '../engine/vlsm';

describe('AI actions', () => {
  it('builds, addresses and routes a network from an action list, end to end', () => {
    const e = new Engine();
    const plan = vlsm('192.168.0.0/24', [
      { name: 'LAN1', hosts: 50 },
      { name: 'LAN2', hosts: 20 },
      { name: 'WAN', hosts: 2 },
    ]);
    const [lan1, lan2, wan] = plan.subnets;
    const raw = [
      { type: 'add_device', kind: 'router', model: 'NL-R1900', name: 'R1' },
      { type: 'add_device', kind: 'router', model: 'NL-R1900', name: 'R2' },
      { type: 'add_device', kind: 'pc', name: 'PCA' },
      { type: 'add_device', kind: 'pc', name: 'PCB' },
      { type: 'connect', a: 'R1', aPort: 'Se0/0/0', b: 'R2', bPort: 'Serial0/0/0', cable: 'serial-dce' },
      { type: 'connect', a: 'PCA', b: 'R1', aPort: 'FastEthernet0', bPort: 'g0/0' },
      { type: 'connect', a: 'PCB', b: 'R2' },
      { type: 'cli', device: 'R1', commands: ['enable', 'configure terminal', 'interface g0/0', `ip address ${lan1.gateway} ${lan1.mask}`, 'no shutdown', 'interface s0/0/0', `ip address ${wan.firstUsable} ${wan.mask}`, 'clock rate 64000', 'no shutdown', 'exit', `ip route ${lan2.network} ${lan2.mask} ${wan.lastUsable}`] },
      { type: 'cli', device: 'R2', commands: ['interface g0/0', `ip address ${lan2.gateway} ${lan2.mask}`, 'no shutdown', 'interface s0/0/0', `ip address ${wan.lastUsable} ${wan.mask}`, 'no shutdown', 'exit', `ip route ${lan1.network} ${lan1.mask} ${wan.firstUsable}`, 'bogus command'] },
      { type: 'host_ip', device: 'PCA', ip: '192.168.0.10', mask: lan1.mask, gateway: lan1.gateway },
      { type: 'host_ip', device: 'PCB', ip: '192.168.0.70', mask: lan2.mask, gateway: lan2.gateway },
      { type: 'nonsense' },
    ];
    const actions = sanitizeActions(raw);
    expect(actions.length).toBe(11);
    const res = applyActions(
      e,
      actions,
      (a, b, c: CableType) => {
        const r = e.connect(a, b, c);
        return typeof r === 'string' ? r : null;
      },
      (a, b) => {
        const pa = a.allPorts().find((p) => !p.linkId && p.media === 'copper');
        const pb = b.allPorts().find((p) => !p.linkId && p.media === 'copper');
        return pa && pb ? [pa.name, pb.name] : null;
      },
    );
    expect(res.filter((r) => !r.ok).map((r) => r.errors?.[0])).toEqual(["bogus command: Invalid input detected at '^' marker."]);
    const pca = [...e.devices.values()].find((d) => d.hostname === 'PCA') as Host;
    const run = () => {
      const out: string[] = [];
      pca.stack.ping(parseIp('192.168.0.70')!, { count: 3 }, (r) => out.push(r.kind === 'reply' ? '!' : '.'), () => {});
      e.runFor(15000);
      return out.join('');
    };
    run();
    expect(run()).toBe('!!!');
    const t = describeTopology(e);
    expect(t.devices.find((d) => d.name === 'R1')?.staticRoutes).toEqual(['192.168.0.64/27 via 192.168.0.98']);
    void createDevice;
  });
});
