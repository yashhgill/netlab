/** IOS-style settings shared by routers and switches. */
export class IosState {
  enableSecret?: string;
  enablePassword?: string;
  consolePassword?: string;
  consoleLogin = false;
  vtyPassword?: string;
  vtyLogin = false;
  banner?: string;
  passwordEncryption = false;
  domainName?: string;
  startupConfig?: string;
  startupSnapshot?: Record<string, unknown>;

  toJSON() {
    return { ...this };
  }

  static fromJSON(j: Record<string, unknown> | undefined): IosState {
    const s = new IosState();
    if (j) Object.assign(s, j);
    return s;
  }
}

/** Type 7-looking obfuscation (purely cosmetic, reversible). */
export function type7(pw: string): string {
  const key = 'dsfd;kfoA,.iyewrkldJKD';
  let out = '08';
  for (let i = 0; i < pw.length; i++) {
    out += ((pw.charCodeAt(i) ^ key.charCodeAt((i + 8) % key.length)) & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Type 5-looking hash for enable secret (cosmetic). */
export function type5(pw: string): string {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) >>> 0;
  const chars = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = '';
  let x = h;
  for (let i = 0; i < 22; i++) {
    s += chars[x % 64];
    x = Math.floor(x / 64) ^ ((h * (i + 7)) >>> 0);
    x >>>= 0;
  }
  return `$1$mERr$${s}`;
}
