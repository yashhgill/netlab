/**
 * Reading and writing Packet Tracer .pkt / .pka files.
 *
 * Packet Tracer 5+ stores a zlib-compressed XML document, scrambled and then
 * encrypted with Twofish in EAX mode under a fixed key. The scheme was
 * documented by the open-source pka2xml project (github.com/mircodz/pka2xml);
 * this is an independent TypeScript implementation for interoperability.
 */
import { unzlibSync, zlibSync } from 'fflate';

// ---------------------------------------------------------------- Twofish

const Q0T = [
  [8, 1, 7, 13, 6, 15, 3, 2, 0, 11, 5, 9, 14, 12, 10, 4],
  [14, 12, 11, 8, 1, 2, 3, 5, 15, 4, 10, 6, 7, 0, 9, 13],
  [11, 10, 5, 14, 6, 13, 9, 0, 12, 8, 15, 3, 2, 4, 7, 1],
  [13, 7, 15, 4, 1, 2, 6, 14, 9, 11, 3, 0, 8, 5, 12, 10],
];
const Q1T = [
  [2, 8, 11, 13, 15, 7, 6, 14, 3, 1, 9, 4, 0, 10, 12, 5],
  [1, 14, 2, 11, 4, 12, 3, 7, 6, 13, 10, 5, 15, 9, 0, 8],
  [4, 12, 7, 5, 1, 6, 9, 10, 0, 14, 13, 8, 2, 11, 3, 15],
  [11, 9, 5, 1, 12, 3, 13, 14, 6, 4, 7, 15, 2, 0, 8, 10],
];

const ror4 = (x: number) => ((x >> 1) | (x << 3)) & 15;

function makeQ(t: number[][]): Uint8Array {
  const q = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    let a = x >> 4;
    let b = x & 15;
    let a1 = a ^ b;
    let b1 = a ^ ror4(b) ^ ((8 * a) & 15);
    a = t[0][a1];
    b = t[1][b1];
    a1 = a ^ b;
    b1 = a ^ ror4(b) ^ ((8 * a) & 15);
    q[x] = (t[3][b1] << 4) | t[2][a1];
  }
  return q;
}
const Q0 = makeQ(Q0T);
const Q1 = makeQ(Q1T);

function gfMul(a: number, b: number, poly: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 0x100) a ^= poly;
    b >>= 1;
  }
  return r;
}

const MDS = [
  [0x01, 0xef, 0x5b, 0x5b],
  [0x5b, 0xef, 0xef, 0x01],
  [0xef, 0x5b, 0x01, 0xef],
  [0xef, 0x01, 0xef, 0x5b],
];
const RS = [
  [0x01, 0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e],
  [0xa4, 0x56, 0x82, 0xf3, 0x1e, 0xc6, 0x68, 0xe5],
  [0x02, 0xa1, 0xfc, 0xc1, 0x47, 0xae, 0x3d, 0x19],
  [0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e, 0x03],
];

// MDS lookup: column j multiplied by every byte value, packed into a word.
const MDS_T: Uint32Array[] = [0, 1, 2, 3].map((j) => {
  const t = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    let w = 0;
    for (let i = 0; i < 4; i++) w |= gfMul(v, MDS[i][j], 0x169) << (8 * i);
    t[v] = w >>> 0;
  }
  return t;
});

const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
const ror = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** h() for a 128-bit key: L = [L0, L1]. */
function h(x: number, l0: number, l1: number): number {
  const b = (w: number, i: number) => (w >>> (8 * i)) & 255;
  const y0 = Q1[Q0[Q0[b(x, 0)] ^ b(l1, 0)] ^ b(l0, 0)];
  const y1 = Q0[Q0[Q1[b(x, 1)] ^ b(l1, 1)] ^ b(l0, 1)];
  const y2 = Q1[Q1[Q0[b(x, 2)] ^ b(l1, 2)] ^ b(l0, 2)];
  const y3 = Q0[Q1[Q1[b(x, 3)] ^ b(l1, 3)] ^ b(l0, 3)];
  return (MDS_T[0][y0] ^ MDS_T[1][y1] ^ MDS_T[2][y2] ^ MDS_T[3][y3]) >>> 0;
}

const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export class Twofish128 {
  private k = new Uint32Array(40);
  private s0: number;
  private s1: number;

  constructor(key: Uint8Array) {
    if (key.length !== 16) throw new Error('Twofish128 needs a 16-byte key');
    const m = [0, 1, 2, 3].map((i) => le32(key, 4 * i));
    const s = [0, 1].map((i) => {
      let w = 0;
      for (let r = 0; r < 4; r++) {
        let v = 0;
        for (let c = 0; c < 8; c++) v ^= gfMul(key[8 * i + c], RS[r][c], 0x14d);
        w |= v << (8 * r);
      }
      return w >>> 0;
    });
    // S = (S1, S0): L0 = S1, L1 = S0
    this.s0 = s[1];
    this.s1 = s[0];
    const rho = 0x01010101;
    for (let i = 0; i < 20; i++) {
      const a = h(Math.imul(2 * i, rho) >>> 0, m[0], m[2]);
      const bb = rol(h(Math.imul(2 * i + 1, rho) >>> 0, m[1], m[3]), 8);
      this.k[2 * i] = (a + bb) >>> 0;
      this.k[2 * i + 1] = rol((a + 2 * bb) >>> 0, 9);
    }
  }

  private g(x: number) {
    return h(x, this.s0, this.s1);
  }

  encryptBlock(inp: Uint8Array, out: Uint8Array) {
    const k = this.k;
    let r0 = le32(inp, 0) ^ k[0];
    let r1 = le32(inp, 4) ^ k[1];
    let r2 = le32(inp, 8) ^ k[2];
    let r3 = le32(inp, 12) ^ k[3];
    for (let r = 0; r < 16; r++) {
      const t0 = this.g(r0 >>> 0);
      const t1 = this.g(rol(r1 >>> 0, 8));
      const f0 = (t0 + t1 + k[2 * r + 8]) >>> 0;
      const f1 = (t0 + 2 * t1 + k[2 * r + 9]) >>> 0;
      const n2 = ror((r2 ^ f0) >>> 0, 1);
      const n3 = (rol(r3 >>> 0, 1) ^ f1) >>> 0;
      r2 = r0;
      r3 = r1;
      r0 = n2;
      r1 = n3;
    }
    const c = [r2 ^ k[4], r3 ^ k[5], r0 ^ k[6], r1 ^ k[7]];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[4 * i + j] = (c[i] >>> (8 * j)) & 255;
  }
}

// ---------------------------------------------------------------- EAX

function dbl(b: Uint8Array): Uint8Array {
  const o = new Uint8Array(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const v = (b[i] << 1) | carry;
    o[i] = v & 255;
    carry = b[i] >> 7;
  }
  if (b[0] & 0x80) o[15] ^= 0x87;
  return o;
}

function omac(c: Twofish128, t: number, msg: Uint8Array): Uint8Array {
  const L = new Uint8Array(16);
  c.encryptBlock(new Uint8Array(16), L);
  const k1 = dbl(L);
  const k2 = dbl(k1);
  const data = new Uint8Array(16 + msg.length);
  data[15] = t;
  data.set(msg, 16);
  const n = Math.ceil(data.length / 16);
  const x = new Uint8Array(16);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const blk = new Uint8Array(16);
    const part = data.subarray(16 * i, 16 * i + 16);
    blk.set(part);
    if (last) {
      if (part.length === 16) for (let j = 0; j < 16; j++) blk[j] ^= k1[j];
      else {
        blk[part.length] = 0x80;
        for (let j = 0; j < 16; j++) blk[j] ^= k2[j];
      }
    }
    for (let j = 0; j < 16; j++) x[j] ^= blk[j];
    c.encryptBlock(x, x);
  }
  return x;
}

function ctr(c: Twofish128, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const ctrb = iv.slice();
  const ks = new Uint8Array(16);
  for (let o = 0; o < data.length; o += 16) {
    c.encryptBlock(ctrb, ks);
    const end = Math.min(16, data.length - o);
    for (let j = 0; j < end; j++) out[o + j] = data[o + j] ^ ks[j];
    for (let j = 15; j >= 0; j--) {
      ctrb[j] = (ctrb[j] + 1) & 255;
      if (ctrb[j] !== 0) break;
    }
  }
  return out;
}

export function eaxDecrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const c = new Twofish128(key);
  if (data.length < 16) throw new Error('File is too short.');
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const n = omac(c, 0, nonce);
  const hh = omac(c, 1, new Uint8Array(0));
  const cm = omac(c, 2, ct);
  for (let i = 0; i < 16; i++) if ((n[i] ^ hh[i] ^ cm[i]) !== tag[i]) throw new Error('Integrity check failed');
  return ctr(c, n, ct);
}

export function eaxEncrypt(key: Uint8Array, nonce: Uint8Array, pt: Uint8Array): Uint8Array {
  const c = new Twofish128(key);
  const n = omac(c, 0, nonce);
  const hh = omac(c, 1, new Uint8Array(0));
  const ct = ctr(c, n, pt);
  const cm = omac(c, 2, ct);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct);
  for (let i = 0; i < 16; i++) out[ct.length + i] = n[i] ^ hh[i] ^ cm[i];
  return out;
}

// ---------------------------------------------------------------- Packet Tracer container

const PT_KEY = new Uint8Array(16).fill(137);
const PT_IV = new Uint8Array(16).fill(16);

function inflateSized(b: Uint8Array): Uint8Array {
  return unzlibSync(b.subarray(4));
}

function xorTail(b: Uint8Array) {
  const n = b.length;
  for (let i = 0; i < n; i++) b[i] ^= (n - i) & 255;
}

/** Packet Tracer file bytes -> XML text. Throws if the file is not a Packet Tracer file. */
export function decodePkt(input: Uint8Array): string {
  const n = input.length;
  const stage1 = new Uint8Array(n);
  for (let i = 0; i < n; i++) stage1[i] = input[n - 1 - i] ^ ((n - Math.imul(i, n)) & 255);
  let plain: Uint8Array;
  try {
    plain = eaxDecrypt(PT_KEY, PT_IV, stage1);
  } catch {
    // very old files (before 5.x) were only XOR-scrambled
    const old = input.slice();
    xorTail(old);
    try {
      return new TextDecoder().decode(inflateSized(old));
    } catch {
      throw new Error('This is not a Packet Tracer file, or it is from a version that cannot be read.');
    }
  }
  xorTail(plain);
  return new TextDecoder().decode(inflateSized(plain));
}

/** XML text -> Packet Tracer file bytes. */
export function encodePkt(xml: string): Uint8Array {
  const raw = new TextEncoder().encode(xml);
  const z = zlibSync(raw);
  const sized = new Uint8Array(z.length + 4);
  sized.set([(raw.length >>> 24) & 255, (raw.length >>> 16) & 255, (raw.length >>> 8) & 255, raw.length & 255]);
  sized.set(z, 4);
  xorTail(sized);
  const enc = eaxEncrypt(PT_KEY, PT_IV, sized);
  const n = enc.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[n - 1 - i] = enc[i] ^ ((n - Math.imul(i, n)) & 255);
  return out;
}
