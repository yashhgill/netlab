import { fmtIp, fmtMacDash, fmtMacDot, parseIp } from '../engine/addr';
import type { Host } from '../engine/devices/host';
import type { PingResult } from '../engine/ipstack';
import { ShellBase, type Shell } from './shell';

const BANNER = 'NetLab PC Command Line 1.0\n';

const HELP_TEXT = `Available commands:
  arp -a            Display the ARP cache
  arp -d            Clear the ARP cache
  cls               Clear the screen
  help              Show this list
  hostname          Show the device name
  ipconfig          Show IP settings  (/all, /release, /renew)
  ping <ip>         Send ICMP echo requests  (-n <count>, -t until Ctrl+C)
  tracert <ip>      Trace the route to a host
`;

export class PcShell extends ShellBase implements Shell {
  host: Host;
  private running: (() => void) | null = null;

  constructor(host: Host) {
    super();
    this.host = host;
    this.buffer = BANNER + '\n';
  }

  prompt() {
    return 'C:\\>';
  }

  secret() {
    return false;
  }

  busy() {
    return this.running !== null;
  }

  clear() {
    this.buffer = '';
    this.write('');
  }

  interrupt() {
    if (this.running) {
      const r = this.running;
      this.running = null;
      r();
      this.write('^C\n');
    }
  }

  submit(line: string) {
    if (this.running) return;
    this.write(this.prompt() + line + '\n');
    this.pushHistory(line);
    const args = line.trim().split(/\s+/).filter(Boolean);
    if (!args.length) return;
    const cmd = args[0].toLowerCase();
    switch (cmd) {
      case 'help':
      case '?':
        return this.write(HELP_TEXT + '\n');
      case 'cls':
      case 'clear':
        return this.clear();
      case 'hostname':
        return this.write(this.host.hostname + '\n\n');
      case 'ipconfig':
        return this.ipconfig(args.slice(1));
      case 'ping':
        return this.ping(args.slice(1));
      case 'tracert':
      case 'traceroute':
        return this.tracert(args.slice(1));
      case 'arp':
        return this.arp(args.slice(1));
      default:
        this.write(`Invalid Command.\n\n`);
    }
  }

  private ifaceBlock(all: boolean) {
    const h = this.host;
    const n = h.nic;
    let out = `\nFastEthernet0 Connection:(default port)\n\n`;
    out += `   Connection-specific DNS Suffix..: \n`;
    if (all) {
      out += `   Physical Address................: ${fmtMacDash(n.mac)}\n`;
      out += `   DHCP Enabled....................: ${h.ipMode === 'dhcp' ? 'Yes' : 'No'}\n`;
    }
    out += `   IPv4 Address....................: ${n.ip !== undefined ? fmtIp(n.ip) : '0.0.0.0'}\n`;
    out += `   Subnet Mask.....................: ${n.mask !== undefined ? fmtIp(n.mask) : '0.0.0.0'}\n`;
    out += `   Default Gateway.................: ${h.gateway !== undefined ? fmtIp(h.gateway) : '0.0.0.0'}\n`;
    if (all) out += `   DNS Servers.....................: ${h.dns !== undefined ? fmtIp(h.dns) : '0.0.0.0'}\n`;
    return out + '\n';
  }

  private ipconfig(a: string[]) {
    const opt = (a[0] ?? '').toLowerCase();
    const h = this.host;
    if (!opt) return this.write(this.ifaceBlock(false));
    if (opt === '/all') return this.write(this.ifaceBlock(true));
    if (opt === '/release') {
      if (h.ipMode !== 'dhcp') return this.write('\nThe operation failed as no adapter is in the state permissible for this operation.\n\n');
      h.dhcpClient.cancel();
      h.nic.ip = undefined;
      h.nic.mask = undefined;
      h.stack.defaultGateway = undefined;
      h.dns = undefined;
      h.engine.bump();
      return this.write(this.ifaceBlock(false));
    }
    if (opt === '/renew') {
      if (h.ipMode !== 'dhcp') return this.write('\nThe operation failed as no adapter is in the state permissible for this operation.\n\n');
      let unsub = () => {};
      const finish = () => {
        unsub();
        this.running = null;
        this.write(this.ifaceBlock(false));
      };
      const ob = h.dhcpClient.onBound;
      const of = h.dhcpClient.onFail;
      h.dhcpClient.onBound = (m) => {
        ob(m);
        finish();
      };
      h.dhcpClient.onFail = () => {
        of();
        finish();
      };
      unsub = () => {
        h.dhcpClient.onBound = ob;
        h.dhcpClient.onFail = of;
      };
      this.running = () => {
        unsub();
        h.dhcpClient.cancel();
      };
      h.useDhcp();
      return;
    }
    this.write('Invalid Command.\n\n');
  }

  private ping(a: string[]) {
    let count = 4;
    let forever = false;
    let target: string | undefined;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-n' && a[i + 1]) count = Math.max(1, Math.min(1000, parseInt(a[++i]) || 4));
      else if (a[i] === '-t') forever = true;
      else target = a[i];
    }
    if (!target) return this.write('Invalid Command.\n\n');
    const dst = parseIp(target);
    if (dst === null) return this.write(`Ping request could not find host ${target}. Please check the name and try again.\n\n`);
    this.write(`\nPinging ${fmtIp(dst)} with 32 bytes of data:\n\n`);
    let sent = 0;
    let recv = 0;
    const rtts: number[] = [];
    const total = forever ? 100000 : count;
    const summary = () => {
      const lost = sent - recv;
      this.write(`\nPing statistics for ${fmtIp(dst)}:\n    Packets: Sent = ${sent}, Received = ${recv}, Lost = ${lost} (${sent ? Math.round((lost / sent) * 100) : 0}% loss),\n`);
      if (recv) {
        const mn = Math.min(...rtts);
        const mx = Math.max(...rtts);
        const avg = Math.round(rtts.reduce((x, y) => x + y, 0) / rtts.length);
        this.write(`Approximate round trip times in milli-seconds:\n    Minimum = ${mn}ms, Maximum = ${mx}ms, Average = ${avg}ms\n`);
      }
      this.write('\n');
    };
    const cancel = this.host.stack.ping(
      dst,
      { count: total, timeout: 2000, gap: 50 },
      (r: PingResult) => {
        sent++;
        if (r.kind === 'reply') {
          recv++;
          const t = Math.round(r.rtt ?? 0);
          rtts.push(t);
          this.write(`Reply from ${fmtIp(r.from!)}: bytes=32 time${t < 1 ? '<1' : '=' + t}ms TTL=${r.ttl}\n`);
        } else if (r.kind === 'timeout') this.write('Request timed out.\n');
        else if (r.kind === 'unreachable') this.write(`Reply from ${fmtIp(r.from!)}: Destination host unreachable.\n`);
        else if (r.kind === 'ttl-expired') this.write(`Reply from ${fmtIp(r.from!)}: TTL expired in transit.\n`);
        else this.write('PING: transmit failed. General failure. \n');
      },
      () => {
        if (!this.running) return;
        this.running = null;
        summary();
      },
    );
    this.running = () => {
      cancel();
      summary();
    };
  }

  private tracert(a: string[]) {
    const target = a.find((x) => !x.startsWith('-'));
    const dst = target ? parseIp(target) : null;
    if (dst === null) return this.write(target ? `Unable to resolve target system name ${target}.\n\n` : 'Invalid Command.\n\n');
    this.write(`\nTracing route to ${fmtIp(dst)} over a maximum of 30 hops: \n\n`);
    this.running = this.host.stack.traceroute(
      dst,
      {},
      (ttl, probes) => {
        const cols = probes.map((p) => (p.kind === 'timeout' || p.kind === 'no-route' ? '*' : `${Math.round(p.rtt ?? 0)} ms`).padEnd(10)).join('');
        const from = probes.find((p) => p.from !== undefined)?.from;
        const tail = from !== undefined ? fmtIp(from) : 'Request timed out.';
        this.write(`${String(ttl).padStart(3)}   ${cols}${tail}\n`);
      },
      () => {
        if (!this.running) return;
        this.running = null;
        this.write('\nTrace complete.\n\n');
      },
    );
  }

  private arp(a: string[]) {
    const opt = (a[0] ?? '').toLowerCase();
    if (opt === '-d') {
      this.host.stack.arp.clear();
      return this.write('\n');
    }
    if (opt !== '-a') return this.write('Invalid Command.\n\n');
    const entries = [...this.host.stack.arp.entries()];
    if (!entries.length) return this.write('No ARP Entries Found\n\n');
    let out = '  Internet Address      Physical Address      Type\n';
    for (const [ip, e] of entries) out += `  ${fmtIp(ip).padEnd(22)}${fmtMacDot(e.mac).padEnd(22)}dynamic\n`;
    this.write(out + '\n');
  }
}
