/* eslint-disable @typescript-eslint/no-require-imports */
// Generates assets/icon.ico (Windows) + assets/icon-{N}.png (multi-resolution
// source files). Pure Node — no native deps required at icon-generation time.
//
// Design: a gradient violet→blue rounded "C" mark on transparent background.
// Anti-aliased edges, sized for crisp rendering at 16, 32, 48, 64, 128, 256.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const pngToIco = require('png-to-ico').default;

// --- CRC32 ----------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- PNG chunk ------------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- Pixel drawing --------------------------------------------------------
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function drawIcon(size) {
  // RGBA buffer with a leading filter byte per row (PNG filter type 0 = None).
  const px = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;

  const cx = size / 2;
  const cy = size / 2;
  // Rounded square mask
  const half = size * 0.42;
  const cornerR = size * 0.18;
  // Inner "C" stroke
  const ringOuter = size * 0.36;
  const ringInner = size * 0.24;
  const ringStart = Math.PI * 0.18; // open the "C" on the right
  const ringEnd = Math.PI * 1.82;

  for (let y = 0; y < size; y++) {
    px[p++] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      // --- Background rounded square (gradient violet→indigo) ---
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const cornerDx = Math.max(dx - (half - cornerR), 0);
      const cornerDy = Math.max(dy - (half - cornerR), 0);
      const cornerD = Math.sqrt(cornerDx * cornerDx + cornerDy * cornerDy);
      const insideSquare = dx <= half && dy <= half;
      const cornerOk = cornerD <= cornerR;
      let bgAlpha = 0;
      if (insideSquare) {
        if (dx <= half - cornerR || dy <= half - cornerR) {
          bgAlpha = 1;
        } else {
          // Anti-aliased corner
          bgAlpha = 1 - smoothstep(cornerR - 0.8, cornerR + 0.8, cornerD);
        }
      } else if (cornerOk) {
        bgAlpha = 1 - smoothstep(cornerR - 0.8, cornerR + 0.8, cornerD);
      }

      // Vertical gradient: violet (167,139,250) top → indigo (99,102,241) bottom
      const t = y / size;
      const bgR = Math.round(167 * (1 - t) + 99 * t);
      const bgG = Math.round(139 * (1 - t) + 102 * t);
      const bgB = Math.round(250 * (1 - t) + 241 * t);

      // --- "C" ring ---
      const rx = x - cx;
      const ry = y - cy;
      const dist = Math.sqrt(rx * rx + ry * ry);
      // Angle: 0 at +x, increases CCW (standard atan2). We want the gap on the right.
      let ang = Math.atan2(ry, rx);
      if (ang < 0) ang += Math.PI * 2;
      const inRing = dist >= ringInner && dist <= ringOuter;
      const inArc = ang >= ringStart && ang <= ringEnd;
      let ringAlpha = 0;
      if (inRing && inArc) {
        // Anti-alias the inner/outer edges of the ring
        const eOuter = 1 - smoothstep(ringOuter - 1, ringOuter + 0.6, dist);
        const eInner = smoothstep(ringInner - 0.6, ringInner + 1, dist);
        // Anti-alias the arc gap ends
        const eStart = smoothstep(ringStart - 0.04, ringStart + 0.04, ang);
        const eEnd = 1 - smoothstep(ringEnd - 0.04, ringEnd + 0.04, ang);
        ringAlpha = eOuter * eInner * eStart * eEnd;
      }

      // Composite: background, then white ring on top
      let R = bgR, G = bgG, B = bgB, A = bgAlpha;
      if (ringAlpha > 0) {
        // White ring with slight tint
        const ringR = 250, ringG = 250, ringB = 255;
        const a = ringAlpha;
        R = Math.round(ringR * a + R * (1 - a));
        G = Math.round(ringG * a + G * (1 - a));
        B = Math.round(ringB * a + B * (1 - a));
        A = Math.max(A, a);
      }

      px[p++] = R;
      px[p++] = G;
      px[p++] = B;
      px[p++] = Math.round(A * 255);
    }
  }

  const compressed = zlib.deflateSync(px, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10,11,12 = 0 (compression, filter, interlace)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// --- Main -----------------------------------------------------------------
async function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => {
    const buf = drawIcon(s);
    fs.writeFileSync(path.join(assetsDir, `icon-${s}.png`), buf);
    console.log(`wrote icon-${s}.png (${buf.length} bytes)`);
    return buf;
  });

  // Save 256 as canonical icon.png as well (for cross-platform pickup)
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngs[pngs.length - 1]);

  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);
  console.log(`wrote icon.ico (${ico.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
