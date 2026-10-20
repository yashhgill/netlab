import { describe, expect, it } from 'vitest';
import { prefixFor, subnetInfo, vlsm } from './vlsm';

describe('vlsm', () => {
  it('allocates largest first on aligned boundaries', () => {
    const r = vlsm('192.168.1.0/24', [
      { name: 'LAN B', hosts: 25 },
      { name: 'LAN A', hosts: 100 },
      { name: 'WAN', hosts: 2 },
      { name: 'LAN C', hosts: 10 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.subnets.map((s) => `${s.name} ${s.network}/${s.prefix}`)).toEqual([
      'LAN A 192.168.1.0/25',
      'LAN B 192.168.1.128/27',
      'LAN C 192.168.1.160/28',
      'WAN 192.168.1.176/30',
    ]);
    expect(r.subnets[0].gateway).toBe('192.168.1.1');
    expect(r.subnets[3].lastUsable).toBe('192.168.1.178');
    expect(r.free[0]).toBe('192.168.1.180/30');
  });

  it('reports when the block is too small', () => {
    const r = vlsm('10.0.0.0/26', [
      { name: 'A', hosts: 50 },
      { name: 'B', hosts: 20 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('B');
  });

  it('subnet facts and prefix sizing', () => {
    expect(prefixFor(2)).toBe(30);
    expect(prefixFor(62)).toBe(26);
    expect(prefixFor(63)).toBe(25);
    const i = subnetInfo('10.1.5.77/27');
    expect(i).toMatchObject({ network: '10.1.5.64/27', broadcast: '10.1.5.95', firstUsable: '10.1.5.65', usableHosts: 30, wildcard: '0.0.0.31' });
  });
});
