#!/usr/bin/env node
// Generates solid-color PWA icons (192x192 and 512x512) for the
// storefront. Run once per install of the repo — output ships in
// the public/icons/ folder.
//
// We deliberately avoid sharp/canvas dependencies and build the PNG
// bytes by hand using zlib for deflate. This keeps the build graph
// clean and means the icons regenerate identically on any host.

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

// Sportsmart teal (matches manifest theme_color).
const TEAL = { r: 0x3f, g: 0xa1, b: 0xae };

function makeRow(width, color) {
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0; // filter byte: none
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = color.r;
    row[2 + x * 3] = color.g;
    row[3 + x * 3] = color.b;
  }
  return row;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPng(size, color) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.concat(Array.from({ length: size }, () => makeRow(size, color)));
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(join(OUT_DIR, 'icon-192.png'), buildPng(192, TEAL));
  await fs.writeFile(join(OUT_DIR, 'icon-512.png'), buildPng(512, TEAL));
  console.log('Wrote icon-192.png and icon-512.png to', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
