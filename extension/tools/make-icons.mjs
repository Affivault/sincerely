/**
 * Builds the extension icons from the platform's own brand mark
 * (client/public/favicon.png — the gradient "S"), so the toolbar icon is the
 * same mark users see in the app, not a lookalike.
 *
 * Pure node: decodes the source PNG, resamples it, re-encodes. Downscales use
 * area averaging (correct for minification); upscales use bicubic, which keeps
 * the mark's curves smooth where bilinear would flatten them.
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });

/* ---------------- CRC / chunks ---------------- */

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* ---------------- decode ---------------- */

/** @returns {{width: number, height: number, pixels: Buffer}} RGBA */
function decodePng(buf) {
  let pos = 8; // skip signature
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  prev.fill(0);

  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    raw.copy(line, 0, offset, offset + stride);
    offset += stride;

    // Undo the per-scanline filter (PNG spec §9.2).
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = value & 0xff;
    }
    line.copy(prev);

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (channels === 4) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = line[src + 3];
      } else if (channels === 3) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = 255;
      } else if (channels === 2) {
        out[dst] = out[dst + 1] = out[dst + 2] = line[src];
        out[dst + 3] = line[src + 1];
      } else {
        out[dst] = out[dst + 1] = out[dst + 2] = line[src];
        out[dst + 3] = 255;
      }
    }
  }

  return { width, height, pixels: out };
}

/* ---------------- resample ---------------- */

/**
 * Colour must be averaged in premultiplied space, or transparent pixels (whose
 * RGB is arbitrary) bleed dark fringes into the antialiased edge of the mark.
 */
function sampleBox(src, sw, sh, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  const xs = Math.max(0, Math.floor(x0));
  const xe = Math.min(sw, Math.ceil(x1));
  const ys = Math.max(0, Math.floor(y0));
  const ye = Math.min(sh, Math.ceil(y1));
  for (let y = ys; y < ye; y += 1) {
    for (let x = xs; x < xe; x += 1) {
      const i = (y * sw + x) * 4;
      const alpha = src[i + 3] / 255;
      r += src[i] * alpha;
      g += src[i + 1] * alpha;
      b += src[i + 2] * alpha;
      a += alpha;
      n += 1;
    }
  }
  if (n === 0 || a === 0) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, (a / n) * 255];
}

function cubic(t, a, b, c, d) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

function sampleBicubic(src, sw, sh, fx, fy) {
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const tx = fx - x;
  const ty = fy - y;
  const at = (px, py, ch) => {
    const cx = Math.min(sw - 1, Math.max(0, px));
    const cy = Math.min(sh - 1, Math.max(0, py));
    const i = (cy * sw + cx) * 4;
    const alpha = src[i + 3] / 255;
    return ch === 3 ? src[i + 3] : src[i + ch] * alpha; // premultiplied
  };

  const out = [0, 0, 0, 0];
  for (let ch = 0; ch < 4; ch += 1) {
    const rows = [];
    for (let m = -1; m <= 2; m += 1) {
      rows.push(cubic(tx, at(x - 1, y + m, ch), at(x, y + m, ch), at(x + 1, y + m, ch), at(x + 2, y + m, ch)));
    }
    out[ch] = cubic(ty, rows[0], rows[1], rows[2], rows[3]);
  }

  const alpha = Math.min(255, Math.max(0, out[3]));
  if (alpha <= 0) return [0, 0, 0, 0];
  const k = 255 / alpha; // un-premultiply
  return [
    Math.min(255, Math.max(0, out[0] * k)),
    Math.min(255, Math.max(0, out[1] * k)),
    Math.min(255, Math.max(0, out[2] * k)),
    alpha,
  ];
}

function resize(src, sw, sh, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = sw / size;
  const shrinking = size < sw;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = shrinking
        ? sampleBox(src, sw, sh, x * scale, y * (sh / size), (x + 1) * scale, (y + 1) * (sh / size))
        : sampleBicubic(src, sw, sh, (x + 0.5) * scale - 0.5, (y + 0.5) * (sh / size) - 0.5);
      const i = (y * size + x) * 4;
      out[i] = Math.round(px[0]);
      out[i + 1] = Math.round(px[1]);
      out[i + 2] = Math.round(px[2]);
      out[i + 3] = Math.round(px[3]);
    }
  }
  return out;
}

/* ---------------- encode ---------------- */

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const source = decodePng(readFileSync(SRC));
console.log(`source ${source.width}x${source.height}`);
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, resize(source.pixels, source.width, source.height, size)));
  console.log(`wrote ${file}`);
}
