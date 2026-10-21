import { describe, expect, it } from 'vitest';
import { deflateSync } from 'fflate';
import { Engine } from '../engine/engine';
import { createDevice, load } from '../engine/topology';
import { Host } from '../engine/devices/host';
import { parseIp } from '../engine/addr';
import { newShape, edgePoint, wrapText } from './shapes';
import { fromDrawio, toDrawio } from './drawio';

describe('shapes', () => {
  it('gives a tap a sensible default size and zones their look', () => {
    const z = newShape('zone', 100, 100, 100, 100);
    expect(z.w).toBe(360);
    expect(z.dashed).toBe(true);
    const r = newShape('rect', 10, 20, 210, 120);
    expect([r.x, r.y, r.w, r.h]).toEqual([10, 20, 200, 100]);
  });

  it('wraps text and finds box edges', () => {
    expect(wrapText('Data centre building two', 80, 14)).toEqual(['Data', 'centre', 'building', 'two']);
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, 300, 25, 0)).toEqual({ x: 100, y: 25 });
  });
});

describe('draw.io', () => {
  it('round-trips a NetLab workspace', () => {
    const e = new Engine();
    const r = createDevice(e, 'router', 300, 100, 'NL-R1900');
    const s = createDevice(e, 'switch', 300, 260);
    e.connect({ dev: r.id, iface: 'GigabitEthernet0/0' }, { dev: s.id, iface: 'GigabitEthernet0/1' }, 'auto');
    const zone = { ...newShape('zone', 150, 200, 500, 400), text: 'Office' };
    const cloud = newShape('icon', 600, 80, 600, 80, 'cloud');
    const arrow = { ...newShape('arrow', 0, 0, 10, 10), from: r.id, to: cloud.id, text: 'uplink' };
    const xml = toDrawio(e, [zone, cloud, arrow], [{ id: 'n1', x: 10, y: 10, text: 'Lab 3' }]);
    expect(xml).toContain('<mxfile');
    expect(xml).toContain('netlabKind="router"');

    const back = fromDrawio(xml);
    expect(back.devices).toBe(2);
    expect(back.cables).toBe(1);
    const shapes = back.file.shapes!;
    expect(shapes.find((x) => x.kind === 'zone')?.text).toBe('Office');
    expect(shapes.find((x) => x.kind === 'icon')?.icon).toBe('cloud');
    const a = shapes.find((x) => x.kind === 'arrow')!;
    expect(a.text).toBe('uplink');
    expect(a.from).toBeTruthy(); // still hooked to the router
    expect(back.file.notes?.[0].text).toBe('Lab 3');
    const e2 = new Engine();
    load(e2, back.file);
    const r2 = [...e2.devices.values()].find((d) => d.hostname === 'Router0')!;
    expect(r2.model).toBe('NL-R1900');
    expect(r2.port('GigabitEthernet0/0')?.linkId).toBeTruthy();
  });

  it('turns a draw.io network drawing (compressed) into a working network', () => {
    const inner = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="pc1" value="PC-A" style="shape=mxgraph.cisco.computers_and_peripherals.pc;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="200" width="60" height="50" as="geometry"/></mxCell>
      <mxCell id="pc2" value="PC-B" style="shape=mxgraph.cisco.computers_and_peripherals.pc;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="200" width="60" height="50" as="geometry"/></mxCell>
      <mxCell id="sw" value="SW1" style="shape=mxgraph.cisco.switches.workgroup_switch;html=1;" vertex="1" parent="1"><mxGeometry x="100" y="50" width="64" height="32" as="geometry"/></mxCell>
      <mxCell id="t" value="&lt;b&gt;Lab&lt;/b&gt; network" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="30" as="geometry"/></mxCell>
      <mxCell id="e1" style="endArrow=none;" edge="1" parent="1" source="pc1" target="sw"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="e2" style="endArrow=none;" edge="1" parent="1" source="pc2" target="sw"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const packed = deflateSync(new TextEncoder().encode(encodeURIComponent(inner)));
    let bin = '';
    for (const b of packed) bin += String.fromCharCode(b);
    const xml = `<mxfile><diagram id="a" name="Page-1">${btoa(bin)}</diagram></mxfile>`;
    const r = fromDrawio(xml);
    expect(r.devices).toBe(3);
    expect(r.cables).toBe(2);
    expect(r.file.shapes?.find((s) => s.kind === 'text')?.text).toBe('Lab network');

    const e = new Engine();
    load(e, r.file);
    const a = [...e.devices.values()].find((d) => d.hostname === 'PC-A') as Host;
    const b = [...e.devices.values()].find((d) => d.hostname === 'PC-B') as Host;
    a.setStatic(parseIp('10.0.0.1')!, parseIp('255.255.255.0')!);
    b.setStatic(parseIp('10.0.0.2')!, parseIp('255.255.255.0')!);
    const got: string[] = [];
    a.stack.ping(parseIp('10.0.0.2')!, { count: 2 }, (x) => got.push(x.kind), () => {});
    e.runFor(10000);
    expect(got).toContain('reply');
  });
});
