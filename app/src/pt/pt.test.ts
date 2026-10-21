import { describe, expect, it } from 'vitest';
import { Twofish128, decodePkt, encodePkt } from './pkt-crypto';
import { decodeType7, importPacketTracer, prepareConfig } from './import';
import { parseXml, textOf, child } from './xml';
import { Engine } from '../engine/engine';
import { load, createDevice } from '../engine/topology';
import { Host } from '../engine/devices/host';
import { AccessPoint } from '../engine/devices/hub';
import { Router } from '../engine/devices/router';
import { parseIp } from '../engine/addr';
import { type7 } from '../engine/devices/ios-state';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Packet Tracer container', () => {
  it('Twofish-128 matches the published test vector', () => {
    const out = new Uint8Array(16);
    new Twofish128(new Uint8Array(16)).encryptBlock(new Uint8Array(16), out);
    expect(hex(out)).toBe('9f589f5cf6122c32b6bfec2f2ae8c35a');
  });

  it('round-trips and rejects other files', () => {
    const xml = '<PACKETTRACER5><VERSION>8.2.2</VERSION></PACKETTRACER5>';
    expect(decodePkt(encodePkt(xml))).toBe(xml);
    expect(() => decodePkt(new TextEncoder().encode('not a packet tracer file at all'))).toThrow();
  });
});

describe('xml reader', () => {
  it('tolerates control characters and entities', () => {
    const r = parseXml('<A><B x="1">a &amp; b\u0003</B><C/></A>');
    expect(textOf(child(r, 'A/B'))).toBe('a & b\u0003');
    expect(child(r, 'A/B')!.attrs.x).toBe('1');
  });
});

describe('config preparation', () => {
  it('decodes type 7, drops hashes, and keeps unshut interfaces up', () => {
    expect(decodeType7(type7('cisco'))).toBe('cisco');
    const warns: string[] = [];
    const out = prepareConfig(['hostname R1', 'enable secret 5 $1$abc$xyz', 'interface GigabitEthernet0/0', ' ip address 10.0.0.1 255.255.255.0', 'interface GigabitEthernet0/1', ' shutdown', 'line con 0', ` password 7 ${type7('class')}`], (w) => warns.push(w), 'R1');
    expect(out).toEqual(['hostname R1', 'interface GigabitEthernet0/0', ' no shutdown', ' ip address 10.0.0.1 255.255.255.0', 'interface GigabitEthernet0/1', ' shutdown', 'line con 0', ' password class']);
    expect(warns.length).toBe(1);
  });
});

/** A small lab in Packet Tracer's own format: router, switch, wired PC, AP and a wireless laptop. */
function sampleLab(): Uint8Array {
  const port = (type: string, ip = '', mask = '', extra = '') => `<PORT><TYPE>${type}</TYPE><IP>${ip}</IP><SUBNET>${mask}</SUBNET><PORT_DHCP_ENABLE>false</PORT_DHCP_ENABLE>${extra}</PORT>`;
  const dev = (type: string, model: string, name: string, ref: string, x: number, y: number, body: string, extra = '') =>
    `<DEVICE><ENGINE><TYPE customModel="" model="${model}">${type}</TYPE><NAME translate="true">${name}</NAME><POWER>true</POWER><MODULE>${body}</MODULE><SAVE_REF_ID>${ref}</SAVE_REF_ID>${extra}</ENGINE><WORKSPACE><LOGICAL><X>${x}</X><Y>${y}</Y></LOGICAL></WORKSPACE></DEVICE>`;
  const lines = (ls: string[]) => ls.map((l) => `<LINE>${l}</LINE>`).join('');
  const xml = `<PACKETTRACER5><VERSION>8.2.2.0400</VERSION><NETWORK><DEVICES>
  ${dev('Router', '1941', 'R1', 'r1', 300, 50, '', `<RUNNINGCONFIG>${lines(['hostname R1', '!', 'interface GigabitEthernet0/0', ' ip address 192.168.1.1 255.255.255.0', ' duplex auto', '!', 'interface GigabitEthernet0/1', ' no ip address', ' shutdown', '!', 'end'])}</RUNNINGCONFIG><STARTUPCONFIG/>`)}
  ${dev('Switch', '2960-24TT', 'S1', 's1', 300, 200, '', `<RUNNINGCONFIG>${lines(['hostname S1', 'end'])}</RUNNINGCONFIG>`)}
  ${dev('Pc', 'PC-PT', 'PC0', 'p0', 150, 320, port('eCopperFastEthernet', '192.168.1.10', '255.255.255.0'), '<GATEWAY>192.168.1.1</GATEWAY>')}
  ${dev('AccessPoint', 'AccessPoint-PT', 'AP0', 'ap', 450, 320, port('eCopperFastEthernet') + port('eAccessPointWirelessG', '', '', '<SSID>LabNet</SSID><AUTHEN_TYPE>4</AUTHEN_TYPE><KEY>secret123</KEY>'))}
  ${dev('Laptop', 'Laptop-PT', 'Laptop0', 'l0', 600, 420, port('eHostWirelessN', '192.168.1.20', '255.255.255.0', '<SSID>LabNet</SSID><AUTHEN_TYPE>4</AUTHEN_TYPE><KEY>secret123</KEY>'), '<GATEWAY>192.168.1.1</GATEWAY>')}
  ${dev('Power Distribution Device', 'Power Distribution Device', 'PDU', 'pd', 0, 0, '')}
  ${dev('Cloud', 'Cloud-PT', 'ISP', 'cl', 0, 0, '')}
  </DEVICES><LINKS>
  <LINK><TYPE>eCopper</TYPE><CABLE><FROM>r1</FROM><PORT>GigabitEthernet0/0</PORT><TO>s1</TO><PORT>GigabitEthernet0/1</PORT><TYPE>eStraightThrough</TYPE></CABLE></LINK>
  <LINK><TYPE>eCopper</TYPE><CABLE><FROM>p0</FROM><PORT>FastEthernet0</PORT><TO>s1</TO><PORT>FastEthernet0/1</PORT><TYPE>eStraightThrough</TYPE></CABLE></LINK>
  <LINK><TYPE>eCopper</TYPE><CABLE><FROM>ap</FROM><PORT>Port 0</PORT><TO>s1</TO><PORT>FastEthernet0/2</PORT><TYPE>eStraightThrough</TYPE></CABLE></LINK>
  </LINKS><NOTES><NOTE><X>100</X><Y>100</Y><TEXT>LAN 192.168.1.0/24</TEXT></NOTE></NOTES></NETWORK></PACKETTRACER5>`;
  return encodePkt(xml);
}

describe('Packet Tracer import', () => {
  it('rebuilds the lab and it works', () => {
    const r = importPacketTracer(sampleLab());
    expect(r.version).toBe('8.2.2.0400');
    expect(r.devices).toBe(5);
    expect(r.links).toBe(3);
    expect(r.warnings.some((w) => w.includes('Cloud-PT'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Power'))).toBe(false);
    expect(r.file.notes?.[0].text).toBe('LAN 192.168.1.0/24');

    const e = new Engine();
    load(e, r.file);
    const by = (n: string) => [...e.devices.values()].find((d) => d.hostname === n)!;
    const r1 = by('R1') as Router;
    expect(r1.model).toBe('NL-R1900');
    expect(r1.ifaces.get('GigabitEthernet0/0')!.adminUp).toBe(true);
    expect(r1.ifaces.get('GigabitEthernet0/1')!.adminUp).toBe(false);
    const lap = by('Laptop0') as Host;
    expect(lap.model).toBe('NL-Laptop-W');
    expect(lap.nic.linkId).toBeTruthy(); // associated with AP0 over WPA2
    e.runFor(3000);
    for (const h of [by('PC0') as Host, lap]) {
      const res: string[] = [];
      for (let k = 0; k < 2; k++) {
        h.stack.ping(parseIp('192.168.1.1')!, { count: 1 }, (x) => res.push(x.kind), () => {});
        e.runFor(6000);
      }
      expect(res).toContain('reply');
    }
  });
});

describe('wireless', () => {
  it('associates by SSID and key, and re-associates on change', () => {
    const e = new Engine();
    const ap = createDevice(e, 'ap', 0, 0) as AccessPoint;
    const t = createDevice(e, 'tablet', 100, 0) as Host;
    expect(t.nicName).toBe('Wireless0');
    expect(t.nic.linkId).toBeTruthy(); // both on "Default", open
    ap.setWifi({ ssid: 'Office', key: 'password1' });
    expect(t.nic.linkId).toBeFalsy();
    t.setWifi({ ssid: 'Office', key: 'wrong-key' });
    expect(t.nic.linkId).toBeFalsy();
    t.setWifi({ ssid: 'Office', key: 'password1' });
    expect(t.nic.linkId).toBeTruthy();
    ap.setPower(false);
    expect(t.nic.linkId).toBeFalsy();
    ap.setPower(true);
    expect(t.nic.linkId).toBeTruthy();
    e.removeDevice(ap.id);
    expect(t.nic.linkId).toBeFalsy();
    expect(e.links.size).toBe(0);
  });
});
