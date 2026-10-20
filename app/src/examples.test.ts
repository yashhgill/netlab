import { describe, expect, it } from 'vitest';
import { parseIp } from './engine/addr';
import { Engine } from './engine/engine';
import type { Host } from './engine/devices/host';
import { EXAMPLES } from './examples';

describe('example labs', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.title} pings end to end`, () => {
      const e = new Engine();
      ex.build(e);
      e.runFor(10000);
      const hosts = [...e.devices.values()].filter((d) => d.kind === 'pc' || d.kind === 'laptop' || d.kind === 'printer') as Host[];
      const src = hosts[0];
      const dst = hosts[hosts.length - 1];
      expect(dst.nic.ip).toBeDefined();
      const run = () => {
        const out: string[] = [];
        src.stack.ping(dst.nic.ip!, { count: 3 }, (r) => out.push(r.kind === 'reply' ? '!' : '.'), () => {});
        e.runFor(15000);
        return out.join('');
      };
      run();
      expect(run()).toBe('!!!');
      void parseIp;
    });
  }
});
