/**
 * Minimal Ruby Marshal 4.8 reader (enough for RGSS1/RGSS3 data files).
 * Ruby objects become plain objects with `__class`; ivar names keep Ruby's
 * snake_case and only lose the `@` (the addon's normalizer accepts either).
 * `_dump` payloads (Table, Color, Tone) are not decoded.
 */
const utf8 = new TextDecoder('utf-8');
const ivar = (s: string) => s.replace(/^@/, '');

export type RubyObject = { __class: string; [k: string]: unknown };

export function parseMarshal(buf: Uint8Array): unknown {
  if (buf.length < 2 || buf[0] !== 4 || buf[1] !== 8) throw new Error('Not a Ruby Marshal 4.8 stream');
  return new Reader(buf).read();
}

class Reader {
  pos = 2;
  symbols: string[] = [];
  objects: unknown[] = [];
  private buf: Uint8Array;
  constructor(buf: Uint8Array) { this.buf = buf; }

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error(`Marshal: unexpected end of data at ${this.pos}`);
    return this.buf[this.pos++];
  }
  int(): number {
    const c = (this.byte() << 24) >> 24;
    if (c === 0) return 0;
    if (c >= 5) return c - 5;
    if (c <= -5) return c + 5;
    const n = Math.abs(c);
    let x = 0;
    for (let i = 0; i < n; i++) x += this.byte() * 2 ** (8 * i);
    return c > 0 ? x : x - 2 ** (8 * n);
  }
  bytes(): Uint8Array {
    const n = this.int();
    if (n < 0 || this.pos + n > this.buf.length) throw new Error('Marshal: bad length');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  str(): string { return utf8.decode(this.bytes()); }
  skipIvars(): void { for (let n = this.int(); n > 0; n--) { this.symbol(); this.read(); } }

  symbol(): string {
    const t = this.byte();
    if (t === 0x3a) { const s = this.str(); this.symbols.push(s); return s; }      // ':'
    if (t === 0x3b) return this.symbols[this.int()];                                 // ';'
    if (t === 0x49) { const s = this.symbol(); this.skipIvars(); return s; }        // 'I'
    throw new Error(`Marshal: expected symbol, got 0x${t.toString(16)}`);
  }
  reg<T>(v: T): T { this.objects.push(v); return v; }

  read(): unknown {
    const t = String.fromCharCode(this.byte());
    switch (t) {
      case '0': return null;
      case 'T': return true;
      case 'F': return false;
      case 'i': return this.int();
      case ':': case ';': this.pos--; return this.symbol();
      case '"': return this.reg(this.str());
      case 'I': { const v = this.read(); this.skipIvars(); return v; }
      case '@': return this.objects[this.int()];
      case '[': {
        const a: unknown[] = this.reg([]);
        for (let n = this.int(); n > 0; n--) a.push(this.read());
        return a;
      }
      case '{': case '}': {
        const h: Record<string, unknown> = this.reg({});
        for (let n = this.int(); n > 0; n--) { const k = this.read(); h[String(k)] = this.read(); }
        if (t === '}') this.read();
        return h;
      }
      case 'o': case 'S': {
        const o: RubyObject = { __class: this.symbol() };
        this.reg(o);
        for (let n = this.int(); n > 0; n--) { const k = ivar(this.symbol()); o[k] = this.read(); }
        return o;
      }
      case 'f': {
        const s = this.str();
        return this.reg(s === 'inf' ? Infinity : s === '-inf' ? -Infinity : s === 'nan' ? NaN : parseFloat(s));
      }
      case 'l': {
        const sign = this.byte(); const len = this.int() * 2;
        let x = 0;
        for (let i = 0; i < len; i++) x += this.byte() * 2 ** (8 * i);
        return this.reg(sign === 0x2d ? -x : x);
      }
      case 'u': { const cls = this.symbol(); const size = this.bytes().length; return this.reg({ __class: cls, __dumpSize: size }); }
      case 'U': { const o: RubyObject = this.reg({ __class: this.symbol() }); o.data = this.read(); return o; }
      case 'd': { const o: RubyObject = this.reg({ __class: this.symbol() }); o.data = this.read(); return o; }
      case 'e': case 'C': this.symbol(); return this.read();
      case '/': { const s = this.str(); this.byte(); return this.reg(s); }
      case 'c': case 'm': case 'M': return this.reg({ __class: 'Class', name: this.str() });
      default: throw new Error(`Marshal: unsupported type '${t}' at ${this.pos - 1}`);
    }
  }
}
