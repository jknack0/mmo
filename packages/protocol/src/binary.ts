// Binary wire codec (S23 #25, ADR-0012 / PROTOTYPE_NOTES.md lesson #4).
//
// Each frame begins with a magic/version byte so the decoder can self-describe:
//   0xB1 — binary v1 (hand-packed, the production default)
//   0x4A — JSON dev frame ('J'): the rest is UTF-8 JSON (toggle for debugging)
//   0x7B — legacy raw JSON ('{'): the whole buffer is UTF-8 JSON, no magic
// Because the magic byte is read first, binary and JSON peers interoperate and
// the JSON dev flag only changes what the *encoder* emits.
//
// Low-level layout: little-endian. varuint = LEB128 (small ints in 1–2 bytes).
// Strings are varuint-length-prefixed UTF-8. Positions/resources are f32.

export const MAGIC_BINARY = 0xb1;
export const MAGIC_JSON = 0x4a; // 'J'
export const ASCII_LBRACE = 0x7b; // '{'

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
  private buf = new Uint8Array(64);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }

  /** Unsigned LEB128. Negatives/fractions are clamped/floored defensively. */
  varuint(v: number): void {
    let x = v < 0 ? 0 : Math.floor(v);
    do {
      let byte = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) byte |= 0x80;
      this.u8(byte);
    } while (x > 0);
  }

  f32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setFloat32(this.len, v, true);
    this.len += 4;
  }

  str(s: string): void {
    const bytes = textEncoder.encode(s);
    this.varuint(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  finish(magic: number): Uint8Array {
    const out = new Uint8Array(this.len + 1);
    out[0] = magic;
    out.set(this.buf.subarray(0, this.len), 1);
    return out;
  }
}

export class ByteReader {
  private view: DataView;
  constructor(private buf: Uint8Array, private pos: number) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(): number {
    return this.buf[this.pos++]!;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  varuint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  str(): string {
    const n = this.varuint();
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

/** Normalise the many WS payload shapes (Buffer/ArrayBuffer/typed-array) to bytes. */
export function toBytes(raw: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

export function utf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}
