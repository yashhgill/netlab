import { classfulMask, fmtIp, fmtMacDot, maskToPrefix, network } from '../engine/addr';
import type { Iface } from '../engine/engine';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import { type7, type5 } from '../engine/devices/ios-state';
import { shortIf, vlanRanges } from './ifnames';

export type IosDevice = Router | Switch;

export function statusOf(d: IosDevice, i: Iface): { status: string; proto: string } {
  if (!i.adminUp) return { status: 'administratively down', proto: 'down' };
  const up = d.lineUp(i.name);
  if (i.physical || i.parent) {
    const phys = i.parent ? d.ifaces.get(i.parent)! : i;
    const physUp = phys.adminUp && d.engine.physUp(d, phys);
    if (i.parent && !phys.adminUp) return { status: 'administratively down', proto: 'down' };
    return { status: physUp ? 'up' : 'down', proto: up ? 'up' : 'down' };
  }
  return { status: 'up', proto: up ? 'up' : 'down' };
}

export function showIpIntBrief(d: IosDevice): string {
  let out = 'Interface              IP-Address      OK? Method Status                Protocol \n';
  for (const i of d.ifaces.values()) {
    const { status, proto } = statusOf(d, i);
    out +=
      i.name.padEnd(23) +
      (i.ip !== undefined ? fmtIp(i.ip) : 'unassigned').padEnd(16) +
      'YES '.padEnd(4) +
      (i.ip !== undefined ? 'manual' : 'unset').padEnd(7) +
      status.padEnd(22) +
      proto +
      ' \n';
  }
  return out;
}

export function showIpRoute(d: IosDevice): string {
  const head =
    'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n' +
    '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n' +
    '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n' +
    '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP\n' +
    '       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area\n' +
    '       * - candidate default, U - per-user static route, o - ODR\n' +
    '       P - periodic downloaded static route\n\n';
  if (d instanceof Switch) {
    return d.stack.defaultGateway !== undefined ? `Default gateway is ${fmtIp(d.stack.defaultGateway)}\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty\n` : 'Default gateway is not set\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty\n';
  }
  const table = d.stack.routingTable();
  const def = table.find((r) => r.net === 0 && r.mask === 0);
  let out = head + (def ? `Gateway of last resort is ${def.nextHop !== undefined ? fmtIp(def.nextHop) : '0.0.0.0'} to network 0.0.0.0\n\n` : 'Gateway of last resort is not set\n\n');
  // group by classful network
  const groups = new Map<number, typeof table>();
  for (const r of table) {
    if (r.net === 0 && r.mask === 0) continue;
    const key = network(r.net, classfulMask(r.net));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const fmtRoute = (r: (typeof table)[number], indent: boolean) => {
    const code = r.code.padEnd(indent ? 8 : 5);
    const pfx = `${fmtIp(r.net)}/${maskToPrefix(r.mask)}`;
    if (r.code === 'C' || r.code === 'L') return `${code}${pfx} is directly connected, ${r.ifName}\n`;
    if (r.nextHop !== undefined) return `${code}${pfx} [${r.ad}/${r.metric}] via ${fmtIp(r.nextHop)}\n`;
    return `${code}${pfx} is directly connected, ${r.ifName}\n`;
  };
  for (const k of keys) {
    const rs = groups.get(k)!.sort((a, b) => a.net - b.net || a.mask - b.mask);
    const cm = classfulMask(k);
    const masks = new Set(rs.map((r) => r.mask));
    if (rs.length === 1 && rs[0].mask === cm) {
      out += fmtRoute(rs[0], false);
      continue;
    }
    if (masks.size > 1) out += `     ${fmtIp(k)}/${maskToPrefix(cm)} is variably subnetted, ${rs.length} subnets, ${masks.size} masks\n`;
    else out += `     ${fmtIp(k)}/${maskToPrefix([...masks][0])} is subnetted, ${rs.length} subnets\n`;
    for (const r of rs) out += fmtRoute(r, true);
  }
  if (def) out += `S*   0.0.0.0/0 [${def.ad}/0] via ${def.nextHop !== undefined ? fmtIp(def.nextHop) : def.ifName}\n`;
  return out;
}

export function showArp(d: IosDevice): string {
  let out = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n';
  const rows: [number, string, string, string][] = [];
  for (const i of d.ifaces.values()) {
    if (i.ip !== undefined && d.lineUp(i.name)) rows.push([i.ip, '-', i.mac, i.name]);
  }
  for (const [ip, e] of d.stack.arp) {
    rows.push([ip, String(Math.floor((d.engine.now - e.t) / 60000)), e.mac, e.ifName]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const [ip, age, mac, ifn] of rows) {
    out += `Internet  ${fmtIp(ip).padEnd(17)}${age.padStart(9)}   ${fmtMacDot(mac)}  ARPA   ${ifn}\n`;
  }
  return out;
}

export function showMacTable(s: Switch): string {
  let out = '          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n\n';
  const rows = [...s.macTable.values()].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  for (const r of rows) out += `${String(r.vlan).padStart(4)}    ${fmtMacDot(r.mac)}    DYNAMIC     ${shortIf(r.port)}\n`;
  return out;
}

const DEFAULT_VLANS: [number, string][] = [
  [1002, 'fddi-default'],
  [1003, 'token-ring-default'],
  [1004, 'fddinet-default'],
  [1005, 'trnet-default'],
];

export function showVlanBrief(s: Switch): string {
  let out = '\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n';
  const ids = [...s.vlans.keys()].sort((a, b) => a - b);
  for (const v of ids) {
    const ports = s.physicalIfaces().filter((p) => p.swMode !== 'trunk' && p.accessVlan === v).map((p) => shortIf(p.name));
    const lines: string[] = [];
    for (let i = 0; i < ports.length; i += 4) lines.push(ports.slice(i, i + 4).join(', ') + (i + 4 < ports.length ? ',' : ''));
    out += `${String(v).padEnd(5)}${s.vlans.get(v)!.padEnd(33)}active    ${lines[0] ?? ''}\n`;
    for (const l of lines.slice(1)) out += ' '.repeat(48) + l + '\n';
  }
  for (const [v, n] of DEFAULT_VLANS) out += `${String(v).padEnd(5)}${n.padEnd(33)}active    \n`;
  return out;
}

export function showTrunk(s: Switch): string {
  const trunks = s.physicalIfaces().filter((p) => p.swMode === 'trunk' && s.lineUp(p.name));
  if (!trunks.length) return '';
  let out = 'Port        Mode         Encapsulation  Status        Native vlan\n';
  for (const t of trunks) out += `${shortIf(t.name, true).padEnd(12)}on           802.1q         trunking      ${t.nativeVlan ?? 1}\n`;
  out += '\nPort        Vlans allowed on trunk\n';
  for (const t of trunks) out += `${shortIf(t.name, true).padEnd(12)}${t.allowedVlans ? vlanRanges(t.allowedVlans) : '1-1005'}\n`;
  out += '\nPort        Vlans allowed and active in management domain\n';
  const active = (t: Iface) => vlanRanges([...s.vlans.keys()].filter((v) => t.allowedVlans === null || t.allowedVlans!.includes(v)));
  for (const t of trunks) out += `${shortIf(t.name, true).padEnd(12)}${active(t)}\n`;
  out += '\nPort        Vlans in spanning tree forwarding state and not pruned\n';
  for (const t of trunks) out += `${shortIf(t.name, true).padEnd(12)}${active(t)}\n`;
  return out;
}

export function showInterface(d: IosDevice, i: Iface): string {
  const { status, proto } = statusOf(d, i);
  const hw = i.sviVlan !== undefined ? 'Ethernet SVI' : i.speed >= 1000 ? 'Gigabit Ethernet' : 'Fast Ethernet';
  let out = `${i.name} is ${status}, line protocol is ${proto}${i.physical ? (proto === 'up' ? ' (connected)' : ' (disabled)') : ''}\n`;
  out += `  Hardware is ${hw}, address is ${fmtMacDot(i.mac)} (bia ${fmtMacDot(i.mac)})\n`;
  if (i.description) out += `  Description: ${i.description}\n`;
  if (i.ip !== undefined) out += `  Internet address is ${fmtIp(i.ip)}/${maskToPrefix(i.mask!)}\n`;
  if (i.dot1q !== undefined) out += `  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${i.dot1q}\n`;
  out += `  MTU 1500 bytes, BW ${i.speed * 1000} Kbit, DLY 10 usec,\n     reliability 255/255, txload 1/255, rxload 1/255\n`;
  if (i.physical) out += `  Full-duplex, ${i.speed}Mb/s\n`;
  return out;
}

export function showDhcpBinding(r: Router): string {
  let out = 'IP address       Client-ID/              Lease expiration        Type\n                 Hardware address\n';
  for (const b of r.dhcp.bindings.values()) out += `${fmtIp(b.ip).padEnd(17)}${fmtMacDot(b.mac).toUpperCase().padEnd(24)}--                      Automatic\n`;
  return out;
}

export function showDhcpPool(r: Router): string {
  let out = '';
  for (const p of r.dhcp.pools) {
    const leased = [...r.dhcp.bindings.values()].filter((b) => b.pool === p.name).length;
    out += `\nPool ${p.name} :\n Utilization mark (high/low)    : 100 / 0\n Subnet size (first/next)       : 0 / 0 \n Total addresses                : ${p.mask !== undefined ? 2 ** (32 - maskToPrefix(p.mask)) - 2 : 0}\n Leased addresses               : ${leased}\n Excluded addresses             : ${r.dhcp.excluded.length}\n Pending event                  : none\n\n 1 subnet is currently in the pool\n Current index        IP address range                    Leased/Excluded/Total\n`;
  }
  return out;
}

export function showVersion(d: IosDevice): string {
  const uptime = Math.floor(d.engine.now / 60000);
  const isR = d instanceof Router;
  return (
    `HarNova NetLab Network OS, Version 1.0 (${isR ? 'router' : 'switch'} image)\n` +
    'Open-source software. Simulation only.\n\n' +
    `${d.hostname} uptime is ${uptime} minute${uptime === 1 ? '' : 's'}\n` +
    `System image file is "flash:netlab-${isR ? 'r' : 's'}-1.0.bin"\n\n` +
    `${d.model} (NetLab virtual processor) with 262144K bytes of memory.\n` +
    `${d.physicalIfaces().length} ${isR ? 'Gigabit Ethernet' : 'Ethernet'} interfaces\n` +
    'Configuration register is 0x2102\n'
  );
}

// ---------------- running-config ----------------
export function runningConfig(d: IosDevice): string {
  const st = d.ios;
  const L: string[] = ['Building configuration...', '', `Current configuration : ${0} bytes`, '!', 'version 15.1'];
  L.push('no service timestamps log datetime msec', 'no service timestamps debug datetime msec');
  L.push(st.passwordEncryption ? 'service password-encryption' : 'no service password-encryption');
  L.push('!', `hostname ${d.hostname}`, '!');
  if (st.enableSecret) L.push(`enable secret 5 ${type5(st.enableSecret)}`);
  if (st.enablePassword) L.push(st.passwordEncryption ? `enable password 7 ${type7(st.enablePassword)}` : `enable password ${st.enablePassword}`);
  if (st.enableSecret || st.enablePassword) L.push('!');
  if (d instanceof Router) {
    for (const e of d.dhcp.excluded) L.push(`ip dhcp excluded-address ${fmtIp(e.lo)}${e.hi !== e.lo ? ' ' + fmtIp(e.hi) : ''}`);
    if (d.dhcp.excluded.length) L.push('!');
    for (const p of d.dhcp.pools) {
      L.push(`ip dhcp pool ${p.name}`);
      if (p.net !== undefined) L.push(` network ${fmtIp(p.net)} ${fmtIp(p.mask!)}`);
      if (p.router !== undefined) L.push(` default-router ${fmtIp(p.router)}`);
      if (p.dns !== undefined) L.push(` dns-server ${fmtIp(p.dns)}`);
      L.push('!');
    }
  }
  if (st.domainName) L.push(`ip domain-name ${st.domainName}`, '!');
  if (d instanceof Switch) L.push('spanning-tree mode pvst', 'spanning-tree extend system-id', '!');
  for (const i of d.ifaces.values()) {
    L.push(`interface ${i.name}`);
    if (i.description) L.push(` description ${i.description}`);
    if (d instanceof Switch && i.physical) {
      if (i.swMode === 'trunk') {
        if ((i.nativeVlan ?? 1) !== 1) L.push(` switchport trunk native vlan ${i.nativeVlan}`);
        if (i.allowedVlans) L.push(` switchport trunk allowed vlan ${vlanRanges(i.allowedVlans)}`);
        L.push(' switchport mode trunk');
      } else {
        if ((i.accessVlan ?? 1) !== 1) L.push(` switchport access vlan ${i.accessVlan}`);
        if (i.swModeSet) L.push(' switchport mode access');
      }
    } else {
      if (i.dot1q !== undefined) L.push(` encapsulation dot1Q ${i.dot1q}${i.dot1qNative ? ' native' : ''}`);
      if (i.ip !== undefined) L.push(` ip address ${fmtIp(i.ip)} ${fmtIp(i.mask!)}`);
      else if (!i.parent) L.push(' no ip address');
      if (i.helper !== undefined) L.push(` ip helper-address ${fmtIp(i.helper)}`);
      if (d instanceof Router && i.physical) L.push(' duplex auto', ' speed auto');
    }
    if (!i.adminUp) L.push(' shutdown');
    L.push('!');
  }
  if (d instanceof Switch && d.stack.defaultGateway !== undefined) L.push(`ip default-gateway ${fmtIp(d.stack.defaultGateway)}`, '!');
  if (d instanceof Router) {
    L.push('ip classless');
    for (const r of d.stack.staticRoutes) {
      L.push(`ip route ${fmtIp(r.net)} ${fmtIp(r.mask)} ${r.ifName ?? fmtIp(r.nextHop!)}${r.ad !== 1 ? ' ' + r.ad : ''}`);
    }
    L.push('!', 'ip flow-export version 9', '!');
  }
  if (st.banner) L.push(`banner motd ^C${st.banner}^C`, '!');
  L.push('!', 'line con 0');
  if (st.consolePassword) L.push(st.passwordEncryption ? ` password 7 ${type7(st.consolePassword)}` : ` password ${st.consolePassword}`);
  if (st.consoleLogin) L.push(' login');
  L.push('!');
  if (d instanceof Router) L.push('line aux 0', '!');
  L.push(`line vty 0 ${d instanceof Router ? 4 : 15}`);
  if (st.vtyPassword) L.push(st.passwordEncryption ? ` password 7 ${type7(st.vtyPassword)}` : ` password ${st.vtyPassword}`);
  L.push(st.vtyLogin ? ' login' : ' login');
  L.push('!', '!', '!', 'end');
  const body = L.join('\n') + '\n';
  return body.replace('Current configuration : 0 bytes', `Current configuration : ${body.length} bytes`);
}

