import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';

/** Read-only view over a game's files (directory and/or encrypted archive). */
export interface GameFiles {
  read(rel: string): Buffer | null;
  has(rel: string): boolean;
}

/** Case-insensitive directory access (RPG Maker games are made on Windows). */
export class DirFiles implements GameFiles {
  private cache = new Map<string, string[] | null>();
  readonly root: string;
  constructor(root: string) { this.root = root; }

  private list(dir: string): string[] | null {
    if (!this.cache.has(dir)) {
      let names: string[] | null = null;
      try { names = readdirSync(dir); } catch { /* missing */ }
      this.cache.set(dir, names);
    }
    return this.cache.get(dir)!;
  }
  resolve(rel: string): string | null {
    let cur = this.root;
    for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
      const hit = this.list(cur)?.find((n) => n.toLowerCase() === part.toLowerCase());
      if (!hit) return null;
      cur = join(cur, hit);
    }
    return cur;
  }
  has(rel: string): boolean { return this.resolve(rel) !== null; }
  read(rel: string): Buffer | null {
    const p = this.resolve(rel);
    return p && statSync(p).isFile() ? readFileSync(p) : null;
  }
}

const step = (k: number) => (Math.imul(k, 7) + 3) >>> 0;
const norm = (name: string) => name.replace(/\\/g, '/').toLowerCase();

/** RGSSAD v1 (XP `.rgssad`, VX `.rgss2a`) and v3 (VX Ace `.rgss3a`) archives. */
export class RgssArchive implements GameFiles {
  readonly entries = new Map<string, { offset: number; size: number; key: number }>();
  readonly version: number;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const at = (pos: number, n: number) => {
        const b = Buffer.alloc(n);
        if (readSync(fd, b, 0, n, pos) !== n) throw new Error(`Truncated archive ${path}`);
        return b;
      };
      const head = at(0, 8);
      if (head.toString('latin1', 0, 7) !== 'RGSSAD\0') throw new Error(`Not an RGSS archive: ${path}`);
      this.version = head[7];
      if (this.version === 1) {
        let key = 0xdeadcafe, pos = 8;
        while (pos + 4 <= size) {
          const nameLen = (at(pos, 4).readUInt32LE(0) ^ key) >>> 0; key = step(key); pos += 4;
          if (nameLen > 4096) throw new Error('Corrupt RGSSAD v1 index');
          const name = at(pos, nameLen);
          for (let i = 0; i < nameLen; i++) { name[i] ^= key & 0xff; key = step(key); }
          pos += nameLen;
          const len = (at(pos, 4).readUInt32LE(0) ^ key) >>> 0; key = step(key); pos += 4;
          this.entries.set(norm(name.toString('utf8')), { offset: pos, size: len, key });
          pos += len;
        }
      } else if (this.version === 3) {
        const key = (Math.imul(at(8, 4).readUInt32LE(0), 9) + 3) >>> 0;
        let pos = 12;
        while (pos + 16 <= size) {
          const h = at(pos, 16); pos += 16;
          const offset = (h.readUInt32LE(0) ^ key) >>> 0;
          if (offset === 0) break;
          const len = (h.readUInt32LE(4) ^ key) >>> 0;
          const fileKey = (h.readUInt32LE(8) ^ key) >>> 0;
          const nameLen = (h.readUInt32LE(12) ^ key) >>> 0;
          if (nameLen > 4096) throw new Error('Corrupt RGSSAD v3 index');
          const name = at(pos, nameLen); pos += nameLen;
          for (let i = 0; i < nameLen; i++) name[i] ^= (key >>> (8 * (i % 4))) & 0xff;
          this.entries.set(norm(name.toString('utf8')), { offset, size: len, key: fileKey });
        }
      } else throw new Error(`Unsupported RGSSAD version ${this.version}`);
    } finally { closeSync(fd); }
  }

  has(rel: string): boolean { return this.entries.has(norm(rel)); }
  read(rel: string): Buffer | null {
    const e = this.entries.get(norm(rel));
    if (!e) return null;
    const fd = openSync(this.path, 'r');
    const buf = Buffer.alloc(e.size);
    try { readSync(fd, buf, 0, e.size, e.offset); } finally { closeSync(fd); }
    let key = e.key;
    for (let i = 0; i < buf.length; i += 4) {
      for (let j = 0; j < 4 && i + j < buf.length; j++) buf[i + j] ^= (key >>> (8 * j)) & 0xff;
      key = step(key);
    }
    return buf;
  }
}

/** Loose files win over archived ones (that is how RGSS resolves them too). */
export class LayeredFiles implements GameFiles {
  private layers: GameFiles[];
  constructor(layers: GameFiles[]) { this.layers = layers; }
  has(rel: string) { return this.layers.some((l) => l.has(rel)); }
  read(rel: string) {
    for (const l of this.layers) { const b = l.read(rel); if (b) return b; }
    return null;
  }
}

export const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** View of `inner` rooted at a sub-folder (e.g. MV's `www/`). */
export class PrefixFiles implements GameFiles {
  private inner: GameFiles;
  private prefix: string;
  constructor(inner: GameFiles, prefix: string) { this.inner = inner; this.prefix = prefix; }
  has(rel: string) { return this.inner.has(this.prefix + rel); }
  read(rel: string) { return this.inner.read(this.prefix + rel); }
}

/**
 * ZIP reader for NW.js packages: a `package.nw` file, or a zip appended to
 * `Game.exe` (`copy /b nw.exe+package.nw Game.exe`). Offsets inside an appended
 * zip are relative to the zip start, so we derive the shift from the EOCD.
 */
export class ZipFiles implements GameFiles {
  readonly path: string;
  readonly entries = new Map<string, { method: number; compSize: number; local: number }>();
  private shift: number;

  static tryOpen(path: string): ZipFiles | null {
    try { return new ZipFiles(path); } catch { return null; }
  }

  constructor(path: string) {
    this.path = path;
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const tailLen = Math.min(size, 22 + 0xffff);
      const tail = readAt(fd, size - tailLen, tailLen);
      const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (e < 0 || e + 22 > tail.length) throw new Error(`No ZIP archive in ${path}`);
      const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
      if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64 archives are not supported');
      const cdStart = size - tailLen + e - cdSize;
      this.shift = cdStart - cdOff;
      if (cdStart < 0 || this.shift < 0) throw new Error(`Corrupt ZIP directory in ${path}`);
      const cd = readAt(fd, cdStart, cdSize);
      for (let p = 0, i = 0; i < count; i++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`Corrupt ZIP entry in ${path}`);
        const nameLen = cd.readUInt16LE(p + 28);
        const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
        this.entries.set(norm(name), { method: cd.readUInt16LE(p + 10), compSize: cd.readUInt32LE(p + 20), local: cd.readUInt32LE(p + 42) });
        p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
      }
    } finally { closeSync(fd); }
  }

  has(rel: string) { return this.entries.has(norm(rel)); }
  read(rel: string): Buffer | null {
    const e = this.entries.get(norm(rel));
    if (!e) return null;
    const fd = openSync(this.path, 'r');
    try {
      const pos = e.local + this.shift;
      const h = readAt(fd, pos, 30);
      if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`Corrupt ZIP local header for ${rel}`);
      const data = readAt(fd, pos + 30 + h.readUInt16LE(26) + h.readUInt16LE(28), e.compSize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported ZIP compression method ${e.method} for ${rel}`);
    } finally { closeSync(fd); }
  }
}

function readAt(fd: number, pos: number, n: number): Buffer {
  const b = Buffer.alloc(n);
  if (readSync(fd, b, 0, n, pos) !== n) throw new Error('Unexpected end of file');
  return b;
}

/** Enigma Virtual Box embeds files in a PE section named `.enigma1`/`.enigma2`. */
export function isEnigmaPacked(exePath: string): boolean {
  const fd = openSync(exePath, 'r');
  try {
    const head = Buffer.alloc(4096);
    const n = readSync(fd, head, 0, head.length, 0);
    return head[0] === 0x4d && head[1] === 0x5a && head.subarray(0, n).includes('.enigma');
  } finally { closeSync(fd); }
}
