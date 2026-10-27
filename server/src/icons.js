const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makeIcon(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const radius = size * 0.38;

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2 + size * 0.02;
      const inside = dx * dx + dy * dy <= radius * radius;
      const o = y * stride + 1 + x * 4;
      if (inside) {
        raw[o] = 91;
        raw[o + 1] = 140;
        raw[o + 2] = 255;
      } else {
        raw[o] = 11;
        raw[o + 1] = 18;
        raw[o + 2] = 32;
      }
      raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ensureIcons(publicDir) {
  fs.mkdirSync(publicDir, { recursive: true });
  for (const size of [192, 512]) {
    const file = path.join(publicDir, `icon-${size}.png`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, makeIcon(size));
    }
  }
}

module.exports = { ensureIcons };
