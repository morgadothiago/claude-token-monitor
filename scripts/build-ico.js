'use strict';

// Packs a set of pre-rendered PNGs (16..256 px, embedded as-is — the modern
// "PNG in ICO" format supported since Windows Vista) into a single
// build/icon.ico, without any external dependency or wine.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'build', 'ico-tmp');
const OUT_PATH = path.join(__dirname, '..', 'build', 'icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

const images = SIZES.map((size) => ({
  size,
  buffer: fs.readFileSync(path.join(SRC_DIR, `${size}.png`)),
}));

const headerSize = 6;
const entrySize = 16;
let offset = headerSize + entrySize * images.length;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(images.length, 4);

const entries = [];
const dataBuffers = [];

for (const img of images) {
  const entry = Buffer.alloc(entrySize);
  const dim = img.size === 256 ? 0 : img.size; // 0 means 256 in ICO format
  entry.writeUInt8(dim, 0); // width
  entry.writeUInt8(dim, 1); // height
  entry.writeUInt8(0, 2); // color palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(img.buffer.length, 8); // size of image data
  entry.writeUInt32LE(offset, 12); // offset of image data
  offset += img.buffer.length;
  entries.push(entry);
  dataBuffers.push(img.buffer);
}

const ico = Buffer.concat([header, ...entries, ...dataBuffers]);
fs.writeFileSync(OUT_PATH, ico);
console.log(`[build-ico] saved ${OUT_PATH} (${images.length} sizes: ${SIZES.join(', ')})`);
