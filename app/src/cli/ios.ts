import { fmtIp, isValidMask, network } from '../engine/addr';
import type { Iface } from '../engine/engine';
import { IosState } from '../engine/devices/ios-state';
import { Router } from '../engine/devices/router';
import { Switch } from '../engine/devices/switch';
import type { PingResult } from '../engine/ipstack';
import { parseRange } from './ifnames';
import {
  runningConfig,
  showArp,
  showCdpNeighbors,
  showControllers,
  showRunInterface,
  showDhcpBinding,
  showDhcpPool,
  showInterface,
  showIpIntBrief,
  showIpRoute,
  showMacTable,
  showTrunk,
  showVersion,
  showVlanBrief,
  type IosDevice,
} from './ios-show';
import { CommandTree, compile, type Args } from './parser';
import { ShellBase, type Shell } from './shell';

type Mode = 'boot' | 'user' | 'exec' | 'config' | 'if' | 'subif' | 'range' | 'line' | 'dhcp' | 'vlan';

type Await =
  | { kind: 'enable'; tries: number }
  | { kind: 'console'; tries: number }
  | { kind: 'confirm'; action: () => void }
  | { kind: 'copy' };

const HELP: Record<string, string> = {
  cdp: 'CDP information',
  neighbors: 'CDP neighbor entries',
  controllers: 'Interface controller status',
  clock: 'Configure serial interface clock',
  rate: 'Configure serial interface clock speed',
  ppp: 'Point-to-Point protocol',
  hdlc: 'Serial HDLC synchronous',
  bandwidth: 'Set bandwidth informational parameter',
  enable: 'Turn on privileged commands',
  disable: 'Turn off privileged commands',
  exit: 'Exit from the EXEC',
  logout: 'Exit from the EXEC',
  configure: 'Enter configuration mode',
  terminal: 'Configure from the terminal',
  show: 'Show running system information',
  ping: 'Send echo messages',
  traceroute: 'Trace route to destination',
  copy: 'Copy from one file to another',
  'running-config': 'Current operating configuration',
  'startup-config': 'Contents of non-volatile memory',
  write: 'Write running configuration to memory',
  memory: 'Write to NV memory',
  erase: 'Erase a filesystem',
  reload: 'Halt and perform a cold restart',
  clear: 'Reset functions',
  'mac-address-table': 'MAC forwarding table',
  'mac': 'MAC configuration',
  'address-table': 'MAC forwarding table',
  dynamic: 'dynamic entry type',
  'arp-cache': 'Clear the entire ARP cache',
  ip: 'Global IP configuration subcommands',
  interface: 'Select an interface to configure',
  interfaces: 'Interface status and configuration',
  brief: 'Brief summary of IP status and configuration',
  route: 'Establish static routes',
  arp: 'ARP table',
  vlan: 'VLAN commands',
  version: 'System hardware and software status',
  trunk: 'Show interface trunk information',
  dhcp: 'Configure DHCP server and relay parameters',
  binding: 'DHCP address bindings',
  pool: 'Configure DHCP address pools',
  'excluded-address': 'Prevent DHCP from assigning certain addresses',
  hostname: 'Set system\'s network name',
  no: 'Negate a command or set its defaults',
  end: 'Exit from configure mode',
  do: 'To run exec commands in config mode',
  'default-gateway': 'Specify default gateway (if not routing IP)',
  'domain-name': 'Define the default domain name',
  'domain-lookup': 'Enable IP Domain Name System hostname translation',
  routing: 'Enable IP routing',
  secret: 'Assign the privileged level secret',
  password: 'Assign the privileged level password',
  service: 'Modify use of network based services',
  'password-encryption': 'Encrypt system passwords',
  banner: 'Define a login banner',
  motd: 'Set Message of the Day banner',
  line: 'Configure a terminal line',
  console: 'Primary terminal line',
  vty: 'Virtual terminal',
  range: 'interface range command',
  address: 'Set the IP address of an interface',
  shutdown: 'Shutdown the selected interface',
  description: 'Interface specific description',
  encapsulation: 'Set encapsulation type for an interface',
  dot1Q: 'IEEE 802.1Q Virtual LAN',
  native: 'Make this as native vlan',
  'helper-address': 'Specify a destination address for UDP broadcasts',
  duplex: 'Configure duplex operation.',
  speed: 'Configure speed operation.',
  auto: 'Enable AUTO duplex configuration',
  full: 'Force full duplex operation',
  half: 'Force half-duplex operation',
  switchport: 'Set switching mode characteristics',
  mode: 'Set trunking mode of the interface',
  access: 'Set access mode characteristics of the interface',
  allowed: 'Set allowed VLAN characteristics when interface is in trunking mode',
  add: 'add VLANs to the current list',
  remove: 'remove VLANs from the current list',
  all: 'all VLANs',
  nonegotiate: 'Device will not engage in negotiation protocol on this interface',
  'spanning-tree': 'Spanning Tree Subsystem',
  portfast: 'Spanning tree portfast options',
  login: 'Enable password checking',
  'exec-timeout': 'Set the EXEC timeout',
  logging: 'Modify message logging facilities',
  synchronous: 'Synchronized message output',
  transport: 'Define transport protocols for line',
  input: 'Define which protocols to use when connecting to the terminal server',
  network: 'Network number and mask',
  'default-router': 'Default routers',
  'dns-server': 'DNS servers',
  lease: 'Address lease time',
  name: 'Ascii name of the VLAN',
};

const PHELP: Record<string, string> = {
  dst: 'Ping destination address or hostname',
  name: 'This system\'s network name',
  addr: 'IP address',
  mask: 'IP subnet mask',
  net: 'Destination prefix',
  nh: 'Forwarding router\'s address',
  ad: 'Distance metric for this route',
  ifn: 'Interface name',
  pw: 'The UNENCRYPTED (cleartext) password',
  text: 'Text of the banner/description',
  ids: 'VLAN IDs of the allowed VLANs when this port is in trunking mode',
  vid: 'IEEE 802.1Q VLAN ID',
  gw: 'IP address of default gateway',
  lo: 'Low IP address',
  hi: 'High IP address',
  cmd: 'Exec Command',
  range: 'Interface range',
  n: 'First line number',
};

const isR = (s: IosSession) => s.dev instanceof Router;
const isSw = (s: IosSession) => s.dev instanceof Switch;
const isML = (s: IosSession) => s.dev instanceof Switch && s.dev.multilayer;
const routes = (s: IosSession) => isR(s) || isML(s);
const priv = (s: IosSession) => s.mode === 'exec';

function t(p: string) {
  return compile(p, HELP, PHELP);
}

// ------------------------------------------------------------------ EXEC
const EXEC = new CommandTree<IosSession>();
EXEC.add(t('enable'), (s) => s.doEnable());
EXEC.add(t('disable'), (s) => (s.mode = 'user'), priv);
EXEC.add(t('exit'), (s) => s.logout());
EXEC.add(t('logout'), (s) => s.logout());
EXEC.add(t('configure terminal'), (s) => s.enterConfig(), priv);
EXEC.add(t('ping {ip:dst}'), (s, a) => s.ping(a.dst));
EXEC.add(t('traceroute {ip:dst}'), (s, a) => s.traceroute(a.dst));
EXEC.add(t('show version'), (s) => s.write(showVersion(s.dev)));
EXEC.add(t('show ip interface brief'), (s) => s.write(showIpIntBrief(s.dev)));
EXEC.add(t('show ip route'), (s) => s.write(showIpRoute(s.dev)));
EXEC.add(t('show interfaces'), (s) => s.write([...s.dev.ifaces.values()].map((i) => showInterface(s.dev, i)).join('')));
EXEC.add(t('show interfaces {iface:ifn}'), (s, a) => {
  const i = s.dev.ifaces.get(a.ifn);
  if (!i) return s.invalidAt(a.ifn);
  s.write(showInterface(s.dev, i));
});
EXEC.add(t('show interfaces trunk'), (s) => s.write(showTrunk(s.dev as Switch)), isSw);
EXEC.add(t('show arp'), (s) => s.write(showArp(s.dev)));
EXEC.add(t('show ip arp'), (s) => s.write(showArp(s.dev)));
EXEC.add(t('show running-config'), (s) => s.write(runningConfig(s.dev)), priv);
EXEC.add(t('show startup-config'), (s) => s.write(s.dev.ios.startupConfig ? s.dev.ios.startupConfig.replace(/^Building configuration\.\.\.\n\n/, '').replace('Current configuration', 'Using') : 'startup-config is not present\n'), priv);
EXEC.add(t('show vlan'), (s) => s.write(showVlanBrief(s.dev as Switch)), isSw);
EXEC.add(t('show vlan brief'), (s) => s.write(showVlanBrief(s.dev as Switch)), isSw);
EXEC.add(t('show mac address-table'), (s) => s.write(showMacTable(s.dev as Switch)), isSw);
EXEC.add(t('show mac-address-table'), (s) => s.write(showMacTable(s.dev as Switch)), isSw);
EXEC.add(t('show ip dhcp binding'), (s) => s.write(showDhcpBinding(s.dev as Router)), isR);
EXEC.add(t('show ip dhcp pool'), (s) => s.write(showDhcpPool(s.dev as Router)), isR);
EXEC.add(t('show cdp neighbors'), (s) => s.write(showCdpNeighbors(s.dev)));
EXEC.add(t('show controllers {iface:ifn}'), (s, a) => {
  const i = s.dev.ifaces.get(a.ifn);
  if (!i) return s.invalidAt(a.ifn);
  s.write(showControllers(s.dev, i));
}, isR);
EXEC.add(t('show running-config interface {iface:ifn}'), (s, a) => {
  const i = s.dev.ifaces.get(a.ifn);
  if (!i) return s.invalidAt(a.ifn);
  s.write(showRunInterface(s.dev, i));
}, priv);
EXEC.add(t('show history'), (s) => s.write(s.history.slice(-10).map((h) => '  ' + h).join('\n') + '\n'));
EXEC.add(t('copy running-config startup-config'), (s) => s.askCopy(), priv);
EXEC.add(t('write'), (s) => s.saveConfig(), priv);
EXEC.add(t('write memory'), (s) => s.saveConfig(), priv);
EXEC.add(t('write erase'), (s) => s.eraseStartup(), priv);
EXEC.add(t('erase startup-config'), (s) => s.eraseStartup(), priv);
EXEC.add(t('reload'), (s) => s.askReload(), priv);
EXEC.add(t('clear mac address-table dynamic'), (s) => (s.dev as Switch).clearMacTable(), (s) => priv(s) && isSw(s));
EXEC.add(t('clear arp-cache'), (s) => s.dev.stack.arp.clear(), priv);
EXEC.add(t('clear ip dhcp binding {word:addr}'), (s) => (s.dev as Router).dhcp.bindings.clear(), (s) => priv(s) && isR(s));

// ------------------------------------------------------------------ shared config-level commands
function addCommon(tree: CommandTree<IosSession>) {
  tree.add(t('end'), (s) => s.endConfig());
  tree.add(t('do {line:cmd}'), (s, a) => s.runExec(a.cmd));
  tree.add(t('interface {iface:ifn}'), (s, a) => s.selectIface(a.ifn));
  tree.add(t('interface range {line:range}'), (s, a) => s.selectRange(a.range), isSw);
}

// ------------------------------------------------------------------ GLOBAL CONFIG
const CONF = new CommandTree<IosSession>();
addCommon(CONF);
CONF.add(t('exit'), (s) => s.endConfig());
CONF.add(t('hostname {word:name}'), (s, a) => {
  s.dev.hostname = a.name;
  s.dev.engine.bump();
});
CONF.add(t('no hostname'), (s) => (s.dev.hostname = isR(s) ? 'Router' : 'Switch'));
CONF.add(t('no interface {iface:ifn}'), (s, a) => {
  const i = s.dev.ifaces.get(a.ifn);
  if (s.dev instanceof Router && i?.parent) s.dev.removeSubif(a.ifn);
  else if (s.dev instanceof Switch && i?.sviVlan !== undefined && i.sviVlan !== 1) s.dev.ifaces.delete(a.ifn);
  else s.write('% Physical interfaces cannot be removed\n');
});
const addRoute = (s: IosSession, a: Args) => {
  const r = s.dev;
  if (!isValidMask(a.mask)) return s.write('%Inconsistent address and mask\n');
  if (network(a.net, a.mask) !== a.net) return s.write('%Inconsistent address and mask\n');
  const nr = { net: a.net, mask: a.mask, nextHop: a.nh, ifName: a.ifn, ad: a.ad ?? 1 };
  r.stack.staticRoutes = r.stack.staticRoutes.filter((x) => !(x.net === nr.net && x.mask === nr.mask && x.nextHop === nr.nextHop && x.ifName === nr.ifName));
  r.stack.staticRoutes.push(nr);
};
CONF.add(t('ip route {ip:net} {ip:mask} {ip:nh}'), addRoute, routes);
CONF.add(t('ip route {ip:net} {ip:mask} {ip:nh} {num:ad:1-255}'), addRoute, routes);
CONF.add(t('ip route {ip:net} {ip:mask} {iface:ifn}'), (s, a) => (s.dev.ifaces.has(a.ifn) ? addRoute(s, a) : s.invalidAt(a.ifn)), routes);
CONF.add(t('ip route {ip:net} {ip:mask} {iface:ifn} {num:ad:1-255}'), (s, a) => (s.dev.ifaces.has(a.ifn) ? addRoute(s, a) : s.invalidAt(a.ifn)), routes);
const delRoute = (s: IosSession, a: Args) => {
  const r = s.dev;
  const before = r.stack.staticRoutes.length;
  r.stack.staticRoutes = r.stack.staticRoutes.filter(
    (x) => !(x.net === a.net && x.mask === a.mask && (a.nh === undefined || x.nextHop === a.nh) && (a.ifn === undefined || x.ifName === a.ifn)),
  );
  if (r.stack.staticRoutes.length === before) s.write('%No matching route to delete\n');
};
CONF.add(t('no ip route {ip:net} {ip:mask}'), delRoute, routes);
CONF.add(t('no ip route {ip:net} {ip:mask} {ip:nh}'), delRoute, routes);
CONF.add(t('no ip route {ip:net} {ip:mask} {iface:ifn}'), delRoute, routes);
CONF.add(t('ip routing'), (s) => (s.dev instanceof Switch ? s.dev.setRouting(true) : undefined), routes);
CONF.add(t('no ip routing'), (s) => (s.dev instanceof Switch ? s.dev.setRouting(false) : undefined), isML);
CONF.add(t('ip classless'), () => {}, isR);
CONF.add(t('no ip domain-lookup'), () => {});
CONF.add(t('ip domain-name {word:name}'), (s, a) => (s.dev.ios.domainName = a.name));
CONF.add(t('no ip domain-name'), (s) => (s.dev.ios.domainName = undefined));
CONF.add(t('ip default-gateway {ip:gw}'), (s, a) => (s.dev.stack.defaultGateway = a.gw), isSw);
CONF.add(t('no ip default-gateway'), (s) => (s.dev.stack.defaultGateway = undefined), isSw);
CONF.add(t('ip dhcp pool {word:name}'), (s, a) => {
  const r = s.dev as Router;
  if (!r.dhcp.pools.find((p) => p.name === a.name)) r.dhcp.pools.push({ name: a.name });
  s.pool = a.name;
  s.mode = 'dhcp';
}, isR);
CONF.add(t('no ip dhcp pool {word:name}'), (s, a) => {
  const r = s.dev as Router;
  const n = r.dhcp.pools.length;
  r.dhcp.pools = r.dhcp.pools.filter((p) => p.name !== a.name);
  if (n === r.dhcp.pools.length) s.write(`%Pool ${a.name} not found\n`);
}, isR);
CONF.add(t('ip dhcp excluded-address {ip:lo}'), (s, a) => (s.dev as Router).dhcp.excluded.push({ lo: a.lo, hi: a.lo }), isR);
CONF.add(t('ip dhcp excluded-address {ip:lo} {ip:hi}'), (s, a) => {
  if (a.hi < a.lo) return s.write('% Invalid address range\n');
  (s.dev as Router).dhcp.excluded.push({ lo: a.lo, hi: a.hi });
}, isR);
const delExcl = (s: IosSession, a: Args) => {
  const r = s.dev as Router;
  r.dhcp.excluded = r.dhcp.excluded.filter((e) => !(e.lo === a.lo && e.hi === (a.hi ?? a.lo)));
};
CONF.add(t('no ip dhcp excluded-address {ip:lo}'), delExcl, isR);
CONF.add(t('no ip dhcp excluded-address {ip:lo} {ip:hi}'), delExcl, isR);
CONF.add(t('vlan {vlanlist:ids}'), (s, a) => {
  const sw = s.dev as Switch;
  for (const v of a.ids as number[]) {
    if (v >= 1002 && v <= 1005) return s.write('Default VLAN 1002-1005 may not be modified.\n');
    sw.ensureVlan(v);
  }
  s.vlanIds = a.ids;
  s.mode = 'vlan';
}, isSw);
CONF.add(t('no vlan {vlanlist:ids}'), (s, a) => {
  const sw = s.dev as Switch;
  for (const v of a.ids as number[]) {
    if (v === 1) return s.write('Default VLAN 1 may not be deleted.\n');
    sw.vlans.delete(v);
  }
}, isSw);
CONF.add(t('enable secret {word:pw}'), (s, a) => (s.dev.ios.enableSecret = a.pw));
CONF.add(t('enable password {word:pw}'), (s, a) => {
  s.dev.ios.enablePassword = a.pw;
  if (s.dev.ios.enableSecret === a.pw) s.write('The enable password you have chosen is the same as your enable secret.\nThis is not recommended.  Re-enter the enable password.\n');
});
CONF.add(t('no enable secret'), (s) => (s.dev.ios.enableSecret = undefined));
CONF.add(t('no enable password'), (s) => (s.dev.ios.enablePassword = undefined));
CONF.add(t('service password-encryption'), (s) => (s.dev.ios.passwordEncryption = true));
CONF.add(t('no service password-encryption'), (s) => (s.dev.ios.passwordEncryption = false));
CONF.add(t('banner motd {line:text}'), (s, a) => {
  const txt: string = a.text;
  const d = txt[0];
  const end = txt.indexOf(d, 1);
  s.dev.ios.banner = end > 0 ? txt.slice(1, end) : txt.slice(1);
});
CONF.add(t('no banner motd'), (s) => (s.dev.ios.banner = undefined));
CONF.add(t('line console {num:n:0-0}'), (s) => {
  s.lineKind = 'con';
  s.mode = 'line';
});
CONF.add(t('line vty {num:n:0-15}'), (s) => {
  s.lineKind = 'vty';
  s.mode = 'line';
});
CONF.add(t('line vty {num:n:0-15} {num:m:0-15}'), (s) => {
  s.lineKind = 'vty';
  s.mode = 'line';
});

// ------------------------------------------------------------------ INTERFACE
const IF = new CommandTree<IosSession>();
addCommon(IF);
IF.add(t('exit'), (s) => (s.mode = 'config'));
const l3If = (s: IosSession) => s.curIfs().every((i) => (s.dev instanceof Router ? true : i.sviVlan !== undefined || !!i.routed));
const swPort = (s: IosSession) => isSw(s) && s.curIfs().every((i) => i.physical && !i.routed);
const serial = (s: IosSession) => s.curIfs().every((i) => i.media === 'serial');
const mlPhys = (s: IosSession) => isML(s) && s.curIfs().every((i) => i.physical);
const phys = (s: IosSession) => s.curIfs().every((i) => i.physical);
const subif = (s: IosSession) => s.curIfs().every((i) => !!i.parent);
IF.add(t('ip address {ip:addr} {ip:mask}'), (s, a) => s.setIp(a.addr, a.mask), l3If);
IF.add(t('no ip address'), (s) => s.eachIf((i) => {
  i.ip = undefined;
  i.mask = undefined;
}), l3If);
IF.add(t('ip helper-address {ip:addr}'), (s, a) => s.eachIf((i) => (i.helper = a.addr)), (s) => isR(s) || l3If(s));
IF.add(t('no ip helper-address'), (s) => s.eachIf((i) => (i.helper = undefined)), (s) => isR(s) || l3If(s));
IF.add(t('shutdown'), (s) => s.eachIf((i) => (i.adminUp = false)));
IF.add(t('no shutdown'), (s) => s.eachIf((i) => (i.adminUp = true)));
IF.add(t('description {line:text}'), (s, a) => s.eachIf((i) => (i.description = a.text)));
IF.add(t('no description'), (s) => s.eachIf((i) => (i.description = undefined)));
IF.add(t('encapsulation dot1Q {num:vid:1-4094}'), (s, a) => s.setEncap(a.vid, false), subif);
IF.add(t('encapsulation dot1Q {num:vid:1-4094} native'), (s, a) => s.setEncap(a.vid, true), subif);
for (const d of ['auto', 'full', 'half']) IF.add(t(`duplex ${d}`), () => {}, phys);
for (const sp of ['10', '100', '1000', 'auto']) IF.add(compile(`speed ${sp}`, HELP), () => {}, phys);
IF.add(t('switchport mode access'), (s) => s.eachIf((i) => {
  i.swMode = 'access';
  i.swModeSet = true;
}), swPort);
IF.add(t('switchport mode trunk'), (s) => s.eachIf((i) => {
  i.swMode = 'trunk';
  i.swModeSet = true;
}), swPort);
IF.add(t('no switchport mode'), (s) => s.eachIf((i) => {
  i.swMode = 'access';
  i.swModeSet = false;
}), swPort);
IF.add(t('switchport access vlan {num:vid:1-4094}'), (s, a) => {
  const sw = s.dev as Switch;
  if (!sw.vlans.has(a.vid)) {
    s.write(`% Access VLAN does not exist. Creating vlan ${a.vid}\n`);
    sw.ensureVlan(a.vid);
  }
  s.eachIf((i) => (i.accessVlan = a.vid));
}, swPort);
IF.add(t('no switchport access vlan'), (s) => s.eachIf((i) => (i.accessVlan = 1)), swPort);
IF.add(t('switchport trunk native vlan {num:vid:1-4094}'), (s, a) => s.eachIf((i) => (i.nativeVlan = a.vid)), swPort);
IF.add(t('no switchport trunk native vlan'), (s) => s.eachIf((i) => (i.nativeVlan = 1)), swPort);
IF.add(t('switchport trunk allowed vlan {vlanlist:ids}'), (s, a) => s.eachIf((i) => (i.allowedVlans = [...a.ids])), swPort);
IF.add(t('switchport trunk allowed vlan all'), (s) => s.eachIf((i) => (i.allowedVlans = null)), swPort);
IF.add(t('switchport trunk allowed vlan add {vlanlist:ids}'), (s, a) => s.eachIf((i) => {
  if (i.allowedVlans) i.allowedVlans = [...new Set([...i.allowedVlans, ...a.ids])].sort((x, y) => x - y);
}), swPort);
IF.add(t('switchport trunk allowed vlan remove {vlanlist:ids}'), (s, a) => s.eachIf((i) => {
  const base = i.allowedVlans ?? Array.from({ length: 4094 }, (_, k) => k + 1);
  i.allowedVlans = base.filter((v) => !a.ids.includes(v));
}), swPort);
IF.add(t('no switchport trunk allowed vlan'), (s) => s.eachIf((i) => (i.allowedVlans = null)), swPort);
IF.add(t('switchport nonegotiate'), () => {}, swPort);
IF.add(t('switchport trunk encapsulation dot1q'), () => {}, (s) => swPort(s) && isML(s));
IF.add(t('no switchport'), (s) => s.eachIf((i) => (s.dev as Switch).setRouted(i.name, true)), mlPhys);
IF.add(t('switchport'), (s) => s.eachIf((i) => (s.dev as Switch).setRouted(i.name, false)), mlPhys);
IF.add(t('clock rate {num:rate:300-8000000}'), (s, a) => {
  const ok = [1200, 2400, 4800, 9600, 19200, 38400, 56000, 64000, 72000, 125000, 128000, 148000, 250000, 500000, 800000, 1000000, 1300000, 2000000, 4000000, 8000000];
  if (!ok.includes(a.rate)) return s.write(`Unknown clock rate\n`);
  s.eachIf((i) => (i.clockRate = a.rate));
  for (const i of s.curIfs()) if (s.dev.engine.isDce(s.dev.id, i.name) === false) s.write('This command applies only to DCE interfaces\n');
}, serial);
IF.add(t('no clock rate'), (s) => s.eachIf((i) => (i.clockRate = undefined)), serial);
IF.add(t('encapsulation ppp'), (s) => s.eachIf((i) => (i.encap = 'ppp')), serial);
IF.add(t('encapsulation hdlc'), (s) => s.eachIf((i) => (i.encap = 'hdlc')), serial);
IF.add(t('bandwidth {num:kbps:1-10000000}'), (s, a) => s.eachIf((i) => (i.bandwidth = a.kbps)));
IF.add(t('no bandwidth'), (s) => s.eachIf((i) => (i.bandwidth = undefined)));
IF.add(t('spanning-tree portfast'), () => {}, swPort);

// ------------------------------------------------------------------ LINE
const LINE = new CommandTree<IosSession>();
LINE.add(t('end'), (s) => s.endConfig());
LINE.add(t('exit'), (s) => (s.mode = 'config'));
LINE.add(t('do {line:cmd}'), (s, a) => s.runExec(a.cmd));
LINE.add(t('password {word:pw}'), (s, a) => {
  if (s.lineKind === 'con') s.dev.ios.consolePassword = a.pw;
  else s.dev.ios.vtyPassword = a.pw;
});
LINE.add(t('no password'), (s) => {
  if (s.lineKind === 'con') s.dev.ios.consolePassword = undefined;
  else s.dev.ios.vtyPassword = undefined;
});
LINE.add(t('login'), (s) => {
  if (s.lineKind === 'con') s.dev.ios.consoleLogin = true;
  else s.dev.ios.vtyLogin = true;
  const pw = s.lineKind === 'con' ? s.dev.ios.consolePassword : s.dev.ios.vtyPassword;
  if (!pw) s.write('% Login disabled on line, until \'password\' is set\n');
});
LINE.add(t('no login'), (s) => {
  if (s.lineKind === 'con') s.dev.ios.consoleLogin = false;
  else s.dev.ios.vtyLogin = false;
});
LINE.add(compile('exec-timeout {num:m:0-35791} {num:sec:0-2147483}', HELP), () => {});
LINE.add(t('logging synchronous'), () => {});
LINE.add(t('transport input {word:x}'), () => {});

// ------------------------------------------------------------------ DHCP POOL
const DHCP = new CommandTree<IosSession>();
DHCP.add(t('end'), (s) => s.endConfig());
DHCP.add(t('exit'), (s) => (s.mode = 'config'));
DHCP.add(t('do {line:cmd}'), (s, a) => s.runExec(a.cmd));
DHCP.add(t('network {ip:net} {ip:mask}'), (s, a) => {
  if (!isValidMask(a.mask)) return s.write('% Invalid mask\n');
  s.curPool((p) => {
    p.net = network(a.net, a.mask);
    p.mask = a.mask;
  });
});
DHCP.add(t('default-router {ip:gw}'), (s, a) => s.curPool((p) => (p.router = a.gw)));
DHCP.add(t('dns-server {ip:addr}'), (s, a) => s.curPool((p) => (p.dns = a.addr)));
DHCP.add(t('domain-name {word:name}'), () => {});
DHCP.add(t('lease {line:text}'), () => {});

// ------------------------------------------------------------------ VLAN
const VLAN = new CommandTree<IosSession>();
VLAN.add(t('end'), (s) => s.endConfig());
VLAN.add(t('exit'), (s) => (s.mode = 'config'));
VLAN.add(t('do {line:cmd}'), (s, a) => s.runExec(a.cmd));
VLAN.add(t('name {word:name}'), (s, a) => {
  for (const v of s.vlanIds) (s.dev as Switch).vlans.set(v, a.name);
});
VLAN.add(t('no name'), (s) => {
  for (const v of s.vlanIds) (s.dev as Switch).vlans.set(v, `VLAN${String(v).padStart(4, '0')}`);
});

const TREES: Record<Mode, CommandTree<IosSession> | null> = {
  boot: null,
  user: EXEC,
  exec: EXEC,
  config: CONF,
  if: IF,
  subif: IF,
  range: IF,
  line: LINE,
  dhcp: DHCP,
  vlan: VLAN,
};

// ------------------------------------------------------------------ SESSION
export class IosSession extends ShellBase implements Shell {
  dev: IosDevice;
  mode: Mode = 'boot';
  ifNames: string[] = [];
  lineKind: 'con' | 'vty' = 'con';
  pool = '';
  vlanIds: number[] = [];
  private awaiting: Await | null = null;
  private running: (() => void) | null = null;

  constructor(dev: IosDevice, attach = true) {
    super();
    this.dev = dev;
    if (!attach) {
      this.mode = 'config';
      return;
    }
    this.write(`\nHarNova NetLab Network OS, Version 1.0\n${dev.model} with 262144K bytes of memory.\n${dev.physicalIfaces().length} network interfaces initialized.\n`);
    this.write('\n\nPress RETURN to get started!\n\n\n');
    for (const line of dev.consoleBacklog) this.write(line);
    dev.consoleBacklog = [];
    dev.consoleSink = (txt) => this.write(txt);
  }

  prompt(): string {
    if (this.awaiting?.kind === 'enable' || this.awaiting?.kind === 'console') return 'Password: ';
    if (this.awaiting?.kind === 'confirm') return '';
    if (this.awaiting?.kind === 'copy') return 'Destination filename [startup-config]? ';
    const h = this.dev.hostname;
    switch (this.mode) {
      case 'boot':
        return '';
      case 'user':
        return `${h}>`;
      case 'exec':
        return `${h}#`;
      case 'config':
        return `${h}(config)#`;
      case 'if':
        return `${h}(config-if)#`;
      case 'subif':
        return `${h}(config-subif)#`;
      case 'range':
        return `${h}(config-if-range)#`;
      case 'line':
        return `${h}(config-line)#`;
      case 'dhcp':
        return `${h}(dhcp-config)#`;
      case 'vlan':
        return `${h}(config-vlan)#`;
    }
  }

  secret() {
    return this.awaiting?.kind === 'enable' || this.awaiting?.kind === 'console';
  }

  busy() {
    return this.running !== null;
  }

  // ---------------- input ----------------
  submit(raw: string) {
    if (this.running) return;
    const line = raw.replace(/\r/g, '');
    const prompt = this.prompt();
    if (this.awaiting) {
      this.write(prompt + (this.secret() ? '' : line) + '\n');
      this.handleAwait(line);
      return;
    }
    if (this.mode === 'boot') {
      this.write('\n');
      this.startLogin();
      return;
    }
    this.write(prompt + line + '\n');
    this.pushHistory(line);
    this.exec(line, prompt.length);
    this.after();
  }

  private after() {
    this.dev.engine.refreshAll();
    this.dev.engine.bump();
  }

  /** Execute a line in the current mode. */
  exec(line: string, caretOffset = 0) {
    if (!line.trim()) return;
    if (/^\s*!/.test(line)) return;
    const tree = TREES[this.mode]!;
    const r = tree.match(line, this);
    if (r.cmd) {
      r.cmd.run(this, r.args);
      return;
    }
    // In config sub-modes, fall back to global config commands (IOS does this).
    if (r.err !== 'ambiguous' && ['if', 'subif', 'range', 'line', 'dhcp', 'vlan'].includes(this.mode)) {
      const g = CONF.match(line, this);
      if (g.cmd) {
        this.mode = 'config';
        g.cmd.run(this, g.args);
        return;
      }
    }
    this.reportError(line, r.err!, r.pos!, caretOffset);
  }

  private reportError(line: string, err: string, pos: number, caretOffset: number) {
    if (err === 'ambiguous') {
      this.write(`% Ambiguous command: "${line.trim()}"\n`);
    } else if (err === 'incomplete') {
      this.write('% Incomplete command.\n\n');
    } else {
      const first = line.trim().split(/\s+/);
      if ((this.mode === 'user' || this.mode === 'exec') && pos === line.indexOf(first[0]) && first.length === 1) {
        this.write(`Translating "${first[0]}"...domain server (255.255.255.255)\n% Unknown command or computer name, or unable to find computer address\n\n`);
      } else {
        this.write(' '.repeat(caretOffset + pos) + '^\n% Invalid input detected at \'^\' marker.\n\n');
      }
    }
  }

  invalidAt(token: string) {
    this.write(`% Invalid interface ${token}\n`);
  }

  help(before: string) {
    if (this.running || this.awaiting || this.mode === 'boot') return;
    this.write(this.prompt() + before + '?\n');
    this.write(TREES[this.mode]!.help(before, this));
  }

  complete(line: string): string | null {
    if (this.mode === 'boot' || this.awaiting) return null;
    return TREES[this.mode]!.complete(line, this);
  }

  interrupt() {
    if (this.running) {
      this.running();
      this.running = null;
      this.write('\n');
      return;
    }
    if (this.awaiting) {
      this.awaiting = null;
      this.write('\n');
      return;
    }
    if (!['boot', 'user', 'exec'].includes(this.mode)) {
      this.write(this.prompt() + '^Z\n');
      this.endConfig();
    }
  }

  // ---------------- login / enable ----------------
  private startLogin() {
    const st = this.dev.ios;
    if (st.banner) this.write(st.banner + '\n');
    if (st.consoleLogin && st.consolePassword) {
      this.write('\n\nUser Access Verification\n\n');
      this.awaiting = { kind: 'console', tries: 0 };
      return;
    }
    this.mode = 'user';
  }

  doEnable() {
    if (this.mode === 'exec') return;
    const st = this.dev.ios;
    if (st.enableSecret || st.enablePassword) {
      this.awaiting = { kind: 'enable', tries: 0 };
      return;
    }
    this.mode = 'exec';
  }

  private handleAwait(line: string) {
    const a = this.awaiting!;
    const st = this.dev.ios;
    if (a.kind === 'enable') {
      const want = st.enableSecret ?? st.enablePassword;
      if (line === want) {
        this.awaiting = null;
        this.mode = 'exec';
      } else if (++a.tries >= 3) {
        this.awaiting = null;
        this.write('% Bad secrets\n\n');
      }
      return;
    }
    if (a.kind === 'console') {
      if (line === st.consolePassword) {
        this.awaiting = null;
        this.mode = 'user';
      } else if (++a.tries >= 3) {
        this.awaiting = null;
        this.write('% Bad passwords\n\n\n\nPress RETURN to get started!\n\n\n');
        this.mode = 'boot';
      }
      return;
    }
    if (a.kind === 'copy') {
      this.awaiting = null;
      if (line.trim() === '' || line.trim() === 'startup-config') this.saveConfig();
      else this.write('%Error opening flash:' + line.trim() + ' (Permission denied)\n');
      return;
    }
    if (a.kind === 'confirm') {
      this.awaiting = null;
      if (line.trim() === '' || /^y/i.test(line.trim())) a.action();
    }
  }

  logout() {
    this.mode = 'boot';
    this.write(`\n\n\n\n${this.dev.hostname} con0 is now available\n\n\n\n\n\nPress RETURN to get started.\n\n\n`);
  }

  // ---------------- modes ----------------
  enterConfig() {
    this.write('Enter configuration commands, one per line.  End with CNTL/Z.\n');
    this.mode = 'config';
  }

  endConfig() {
    this.mode = 'exec';
    this.write('\n%SYS-5-CONFIG_I: Configured from console by console\n\n');
  }

  runExec(cmd: string) {
    const keep = this.mode;
    this.mode = 'exec';
    const r = EXEC.match(cmd, this);
    if (r.cmd) r.cmd.run(this, r.args);
    else this.reportError(cmd, r.err!, r.pos!, this.prompt().length + 3);
    if (this.mode === 'exec') this.mode = keep;
  }

  selectIface(name: string) {
    const d = this.dev;
    let i = d.ifaces.get(name);
    if (!i) {
      if (d instanceof Router && name.includes('.')) i = d.addSubif(name) ?? undefined;
      else if (d instanceof Switch && name.startsWith('Vlan')) {
        const v = +name.slice(4);
        if (v >= 1 && v <= 4094) i = d.addSvi(v);
      }
    }
    if (!i) {
      this.write(`%Invalid interface type and number\n`);
      return;
    }
    this.ifNames = [i.name];
    this.mode = i.parent ? 'subif' : 'if';
  }

  selectRange(text: string) {
    const names = parseRange(text);
    if (!names || names.some((n) => !this.dev.ifaces.has(n))) {
      this.write('% Command rejected: invalid interface range\n');
      return;
    }
    this.ifNames = names;
    this.mode = 'range';
  }

  curIfs(): Iface[] {
    return this.ifNames.map((n) => this.dev.ifaces.get(n)).filter((x): x is Iface => !!x);
  }

  eachIf(fn: (i: Iface) => void) {
    for (const i of this.curIfs()) fn(i);
  }

  setIp(addr: number, mask: number) {
    if (!isValidMask(mask)) return this.write('% Bad mask 0x' + (mask >>> 0).toString(16).toUpperCase() + ' for address ' + fmtIp(addr) + '\n');
    const net = network(addr, mask);
    if (addr === net || addr === (net | (~mask >>> 0)) >>> 0) return this.write('Bad mask /' + mask + ' for address ' + fmtIp(addr) + '\n');
    if (this.dev instanceof Switch && this.curIfs().some((i) => i.physical && !i.routed)) {
      return this.write('% IP addresses may not be configured on L2 links.\n');
    }
    for (const i of this.curIfs()) {
      const clash = [...this.dev.ifaces.values()].find(
        (o) => o !== i && o.ip !== undefined && o.mask !== undefined && network(o.ip, o.mask) === net,
      );
      if (clash && this.dev instanceof Router) {
        this.write(`% ${fmtIp(net)} overlaps with ${clash.name}\n`);
        return;
      }
      i.ip = addr;
      i.mask = mask;
      this.dev.stack.flushIface(i.name);
    }
  }

  setEncap(vid: number, native: boolean) {
    this.eachIf((i) => {
      i.dot1q = vid;
      i.dot1qNative = native;
    });
  }

  curPool(fn: (p: Router['dhcp']['pools'][number]) => void) {
    const p = (this.dev as Router).dhcp.pools.find((x) => x.name === this.pool);
    if (p) fn(p);
  }

  // ---------------- save / reload ----------------
  askCopy() {
    this.awaiting = { kind: 'copy' };
  }

  saveConfig() {
    const snap = this.dev.toJSON() as Record<string, any>;
    if (snap.ios) {
      delete snap.ios.startupSnapshot;
      delete snap.ios.startupConfig;
    }
    this.dev.ios.startupSnapshot = snap;
    this.dev.ios.startupConfig = runningConfig(this.dev);
    this.write('Building configuration...\n[OK]\n');
  }

  eraseStartup() {
    this.write('Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]');
    this.awaiting = {
      kind: 'confirm',
      action: () => {
        this.dev.ios.startupSnapshot = undefined;
        this.dev.ios.startupConfig = undefined;
        this.write('[OK]\nErase of nvram: complete\n%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram\n');
      },
    };
  }

  askReload() {
    if (this.dev.ios.startupSnapshot === undefined) this.write('\nSystem configuration has been modified. Save? [yes/no]: no\n');
    this.write('Proceed with reload? [confirm]');
    this.awaiting = { kind: 'confirm', action: () => this.reload() };
  }

  reload() {
    reloadDevice(this.dev);
    this.mode = 'boot';
    this.buffer = '';
    this.write(`\nSystem Bootstrap, Version 1.0\nHarNova NetLab Network OS, Version 1.0 — reloading ${this.dev.hostname}\n`);
    this.write('Restoring startup-config...\n\n\nPress RETURN to get started!\n\n\n');
    this.after();
  }

  // ---------------- apps ----------------
  ping(dst: number) {
    const count = 5;
    this.write(`Type escape sequence to abort.\nSending ${count}, 100-byte ICMP Echos to ${fmtIp(dst)}, timeout is 2 seconds:\n`);
    let ok = 0;
    const rtts: number[] = [];
    this.running = this.dev.stack.ping(
      dst,
      { count },
      (r: PingResult) => {
        if (r.kind === 'reply') {
          ok++;
          rtts.push(Math.round(r.rtt ?? 0));
          this.write('!');
        } else if (r.kind === 'unreachable') this.write('U');
        else this.write('.');
      },
      () => {
        this.running = null;
        const pct = Math.round((ok / count) * 100);
        this.write(`\nSuccess rate is ${pct} percent (${ok}/${count})`);
        if (ok) this.write(`, round-trip min/avg/max = ${Math.min(...rtts)}/${Math.round(rtts.reduce((a, b) => a + b, 0) / ok)}/${Math.max(...rtts)} ms`);
        this.write('\n\n');
      },
    );
  }

  traceroute(dst: number) {
    this.write(`Type escape sequence to abort.\nTracing the route to ${fmtIp(dst)}\n\n`);
    this.running = this.dev.stack.traceroute(
      dst,
      {},
      (ttl, probes) => {
        const from = probes.find((p) => p.from !== undefined)?.from;
        const cols = probes.map((p) => (p.kind === 'timeout' || p.kind === 'no-route' ? '*' : `${Math.round(p.rtt ?? 0)} msec`).padEnd(10)).join('');
        this.write(`  ${String(ttl).padEnd(4)}${(from !== undefined ? fmtIp(from) : '').padEnd(16)}${cols}\n`);
      },
      () => {
        this.running = null;
        this.write('\n');
      },
    );
  }
}

/**
 * Run global-config lines against a device without touching its console session
 * (used by the GUI Config tab and example labs). Returns the echoed transcript.
 */
export function applyConfig(dev: IosDevice, lines: string[]): string {
  const s = new IosSession(dev, false);
  for (const l of lines) {
    s.write(s.prompt() + l + '\n');
    s.exec(l, s.prompt().length);
  }
  dev.engine.refreshAll();
  dev.engine.bump();
  return s.buffer;
}

/** Restore a router/switch to its startup-config (or factory defaults). */
export function reloadDevice(dev: IosDevice) {
  const snap = dev.ios.startupSnapshot as Record<string, any> | undefined;
  const fresh: IosDevice = snap
    ? dev instanceof Router
      ? Router.fromJSON({ ...snap, id: dev.id, x: dev.x, y: dev.y })
      : Switch.fromJSON({ ...snap, id: dev.id, x: dev.x, y: dev.y })
    : dev instanceof Router
      ? new Router(dev.id, dev.hostname.startsWith('Router') ? dev.hostname : 'Router', dev.model)
      : new Switch(dev.id, /^(ML)?Switch/.test(dev.hostname) ? dev.hostname : 'Switch', dev.model);
  const links = new Map([...dev.ifaces.values()].map((i) => [i.name, { linkId: i.linkId, mac: i.mac }]));
  const keepStartup = { startupSnapshot: dev.ios.startupSnapshot, startupConfig: dev.ios.startupConfig };
  dev.hostname = fresh.hostname;
  dev.ifaces = new Map(
    [...fresh.ifaces.entries()].map(([n, i]) => {
      const old = links.get(n);
      return [n, { ...i, mac: old?.mac ?? i.mac, linkId: old?.linkId }];
    }),
  );
  // physical interfaces must keep their cables even if missing from the snapshot
  for (const [n, o] of links) if (!dev.ifaces.has(n) && o.linkId) dev.engine.disconnect(o.linkId);
  dev.ios = Object.assign(new IosState(), fresh.ios, keepStartup);
  dev.stack.arp.clear();
  dev.stack.pending = [];
  dev.stack.defaultGateway = fresh.stack.defaultGateway;
  if (dev instanceof Router && fresh instanceof Router) {
    dev.stack.staticRoutes = fresh.stack.staticRoutes;
    dev.dhcp.pools = fresh.dhcp.pools;
    dev.dhcp.excluded = fresh.dhcp.excluded;
    dev.dhcp.bindings.clear();
  }
  if (dev instanceof Switch && fresh instanceof Switch) {
    dev.vlans = fresh.vlans;
    dev.macTable.clear();
    dev.stack.staticRoutes = fresh.stack.staticRoutes;
    dev.setRouting(fresh.ipRouting);
  }
}
