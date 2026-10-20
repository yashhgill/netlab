import { fmtIp, fmtMacDot } from './addr';

export interface ArpPacket {
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: number;
  targetMac: string;
  targetIp: number;
}

export type IcmpType = 'echo-request' | 'echo-reply' | 'time-exceeded' | 'unreachable';

export interface IcmpPacket {
  type: IcmpType;
  id: number;
  seq: number;
  /** For errors: the original echo id/seq so apps can match. */
  origId?: number;
  origSeq?: number;
  code?: 'net' | 'host';
}

export type DhcpOp = 'discover' | 'offer' | 'request' | 'ack' | 'nak';

export interface DhcpMsg {
  op: DhcpOp;
  xid: number;
  chaddr: string;
  yiaddr?: number;
  serverId?: number;
  mask?: number;
  router?: number;
  dns?: number;
  requested?: number;
  /** relay agent address (giaddr) */
  giaddr?: number;
}

export interface UdpPacket {
  srcPort: number;
  dstPort: number;
  dhcp?: DhcpMsg;
}

export interface IpPacket {
  src: number;
  dst: number;
  ttl: number;
  proto: 'icmp' | 'udp';
  icmp?: IcmpPacket;
  udp?: UdpPacket;
}

export interface Frame {
  src: string;
  dst: string;
  vlan?: number; // 802.1Q tag
  type: 'arp' | 'ipv4';
  arp?: ArpPacket;
  ip?: IpPacket;
}

export type PduKind = 'ARP' | 'ICMP' | 'DHCP';

export function pduKind(f: Frame): PduKind {
  if (f.type === 'arp') return 'ARP';
  if (f.ip?.proto === 'udp') return 'DHCP';
  return 'ICMP';
}

export const PDU_COLORS: Record<PduKind, string> = {
  ARP: '#E0A31A',
  ICMP: '#7C5CE0',
  DHCP: '#1C9C8A',
};

export function cloneFrame(f: Frame): Frame {
  return structuredClone(f);
}

export function describeFrame(f: Frame): string {
  if (f.arp) {
    const a = f.arp;
    return a.op === 'request'
      ? `ARP who has ${fmtIp(a.targetIp)}? tell ${fmtIp(a.senderIp)}`
      : `ARP ${fmtIp(a.senderIp)} is at ${fmtMacDot(a.senderMac)}`;
  }
  const ip = f.ip!;
  if (ip.icmp) {
    const t = ip.icmp.type;
    const label =
      t === 'echo-request' ? 'Echo request' : t === 'echo-reply' ? 'Echo reply' : t === 'time-exceeded' ? 'Time exceeded' : 'Destination unreachable';
    return `ICMP ${label} ${fmtIp(ip.src)} → ${fmtIp(ip.dst)} (TTL ${ip.ttl})`;
  }
  if (ip.udp?.dhcp) {
    return `DHCP ${ip.udp.dhcp.op.toUpperCase()} ${fmtIp(ip.src)} → ${fmtIp(ip.dst)}`;
  }
  return `IPv4 ${fmtIp(ip.src)} → ${fmtIp(ip.dst)}`;
}

/** Layered breakdown used by the PDU inspector. */
export function frameLayers(f: Frame): { layer: string; lines: string[] }[] {
  const out: { layer: string; lines: string[] }[] = [];
  const l2 = [`Source MAC: ${fmtMacDot(f.src)}`, `Destination MAC: ${f.dst === 'ffffffffffff' ? 'ffff.ffff.ffff (broadcast)' : fmtMacDot(f.dst)}`];
  if (f.vlan !== undefined) l2.push(`802.1Q tag: VLAN ${f.vlan}`);
  l2.push(`EtherType: ${f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'}`);
  out.push({ layer: 'Ethernet II (layer 2)', lines: l2 });
  if (f.arp) {
    const a = f.arp;
    out.push({
      layer: 'ARP',
      lines: [
        `Operation: ${a.op}`,
        `Sender: ${fmtIp(a.senderIp)} / ${fmtMacDot(a.senderMac)}`,
        `Target: ${fmtIp(a.targetIp)} / ${a.targetMac === '000000000000' ? '0000.0000.0000' : fmtMacDot(a.targetMac)}`,
      ],
    });
  }
  if (f.ip) {
    const ip = f.ip;
    out.push({
      layer: 'IPv4 (layer 3)',
      lines: [`Source IP: ${fmtIp(ip.src)}`, `Destination IP: ${fmtIp(ip.dst)}`, `TTL: ${ip.ttl}`, `Protocol: ${ip.proto === 'icmp' ? '1 (ICMP)' : '17 (UDP)'}`],
    });
    if (ip.icmp) {
      out.push({ layer: 'ICMP', lines: [`Type: ${ip.icmp.type}`, `Identifier: ${ip.icmp.id}`, `Sequence: ${ip.icmp.seq}`] });
    }
    if (ip.udp) {
      const lines = [`Source port: ${ip.udp.srcPort}`, `Destination port: ${ip.udp.dstPort}`];
      out.push({ layer: 'UDP (layer 4)', lines });
      const d = ip.udp.dhcp;
      if (d) {
        const dl = [`Message: ${d.op.toUpperCase()}`, `Transaction ID: 0x${d.xid.toString(16)}`, `Client MAC: ${fmtMacDot(d.chaddr)}`];
        if (d.yiaddr) dl.push(`Your IP: ${fmtIp(d.yiaddr)}`);
        if (d.mask) dl.push(`Subnet mask: ${fmtIp(d.mask)}`);
        if (d.router) dl.push(`Router: ${fmtIp(d.router)}`);
        if (d.dns) dl.push(`DNS: ${fmtIp(d.dns)}`);
        if (d.serverId) dl.push(`Server ID: ${fmtIp(d.serverId)}`);
        out.push({ layer: 'DHCP', lines: dl });
      }
    }
  }
  return out;
}
