#!/usr/bin/env node
/**
 * Build / refresh the artwork manifest: public/art/art.json
 *
 * Drop image files (downloaded from Instagram or sent by the artist) into public/art/ — optionally
 * one level of sub-folders, e.g. public/art/2023/heron.jpg — then run:
 *
 *   npm run art                  update public/art/art.json
 *   npm run art -- --dry-run     print the resulting manifest instead of writing it
 *   npm run art -- --help        show help
 *
 * What it does:
 *   - keeps every existing entry whose image still exists — in its current order, with every field
 *     you've edited (including custom fields you've added);
 *   - appends newly found images, sorted naturally by path, with a title guessed from the filename;
 *   - removes entries whose image file has gone;
 *   - (re)reads each image's pixel width/height from its file header (PNG, JPEG incl. EXIF rotation,
 *     GIF, WebP, AVIF).
 *
 * Zero dependencies — Node.js 18+.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ART_DIR = path.join(REPO_ROOT, 'public', 'art');
const MANIFEST_NAME = 'art.json';
const MANIFEST_PATH = path.join(ART_DIR, MANIFEST_NAME);
const MANIFEST_DISPLAY = 'public/art/art.json';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
// Image files people commonly have lying around that browsers can't display — skipped with a hint.
const UNSUPPORTED_EXTS = new Set(['.heic', '.heif', '.tif', '.tiff', '.psd', '.dng', '.cr2', '.nef', '.arw', '.raw']);
const HEADER_BYTES = 512 * 1024; // only this much of each file is read to find its size

const DEFAULT_MANIFEST = {
  artist: 'Dan Peacock',
  tagline: 'Paintings, drawings & other things',
  instagram: '',
  works: [],
};
// Keys every work gets (in this order, after `file` and `title`) if it doesn't already have them.
const WORK_DEFAULTS = { year: '', medium: '', caption: '', instagram: '', featured: false };

const FORMAT_NAMES = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', heif: 'HEIC/HEIF' };
const FORMAT_EXTS = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  gif: ['.gif'],
  webp: ['.webp'],
  avif: ['.avif'],
  heif: ['.heic', '.heif'],
};

const HELP = `Usage: npm run art [-- options]
       node scripts/build-art-manifest.mjs [options]

Scans public/art/ (and one level of sub-folders) for images (.jpg .jpeg .png .webp .gif .avif)
and creates or updates public/art/art.json, which the gallery loads at runtime.

  - Existing entries, and everything you've edited in them, are kept in their current order.
  - New images are appended with a title guessed from the filename (or "Untitled").
  - Entries whose image file no longer exists are removed.
  - Pixel width/height are (re)read from every image.
  - Files and folders whose names start with "." are ignored.

Options:
  -n, --dry-run   print the resulting manifest to stdout instead of writing it
  -h, --help      show this help
`;

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`build-art-manifest: ${err.message}\n`);
    console.error(HELP);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // With --dry-run the manifest goes to stdout, so keep all the chatter on stderr.
  const log = opts.dryRun ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const warn = (msg) => console.error(`  ! ${msg}`);

  // 1. Load the existing manifest (or start from the defaults).
  let raw = null;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let manifest;
  if (raw === null || raw.trim() === '') {
    manifest = structuredClone(DEFAULT_MANIFEST);
    log(raw === null ? `Creating ${MANIFEST_DISPLAY}` : `${MANIFEST_DISPLAY} is empty — starting from the defaults`);
  } else {
    try {
      manifest = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
      console.error(`Error: ${MANIFEST_DISPLAY} is not valid JSON:\n  ${err.message}`);
      console.error('Fix the syntax error (e.g. a trailing comma or a missing quote) and run again.');
      console.error('The file was not modified.');
      return 1;
    }
    if (!isPlainObject(manifest)) {
      console.error(`Error: ${MANIFEST_DISPLAY} must contain a JSON object ({ "artist": …, "works": [ … ] }).`);
      console.error('The file was not modified.');
      return 1;
    }
    if (manifest.works !== undefined && !Array.isArray(manifest.works)) {
      console.error(`Error: "works" in ${MANIFEST_DISPLAY} must be an array ([ … ]).`);
      console.error('The file was not modified.');
      return 1;
    }
  }

  // 2. Find the images on disk.
  const { images, skipped } = scanImages(ART_DIR);
  for (const rel of skipped) {
    warn(`skipping ${rel}: browsers can't display ${path.extname(rel).slice(1).toUpperCase()} files — convert it to JPEG, PNG or WebP`);
  }

  // 3. Merge: keep existing entries whose files still exist (in order), then append new files.
  const resolver = createResolver(ART_DIR);
  const works = [];
  const claimed = new Set();
  const removed = [];

  (manifest.works || []).forEach((entry, index) => {
    const work = typeof entry === 'string' ? { file: entry } : entry; // tolerate a bare list of filenames
    if (!isPlainObject(work) || typeof work.file !== 'string' || !work.file.trim()) {
      removed.push({ label: `entry #${index + 1}`, reason: 'it has no "file"' });
      return;
    }
    const actual = resolver.resolve(work.file);
    if (!actual) {
      removed.push({ label: work.file, reason: 'file not found in public/art/' });
      return;
    }
    if (claimed.has(actual)) {
      removed.push({ label: work.file, reason: `duplicate of an earlier entry for ${actual}` });
      return;
    }
    claimed.add(actual);
    if (actual !== work.file) log(`  ~ ${work.file} → ${actual} (fixed path to match the file on disk)`);
    works.push(normalizeWork(work, actual));
  });

  const added = images.filter((rel) => !claimed.has(rel)).sort(naturalCompare);
  for (const rel of added) works.push(normalizeWork({}, rel));
  const addedSet = new Set(added);

  // 4. (Re)read pixel sizes.
  for (const work of works) {
    const abs = path.join(ART_DIR, ...work.file.split('/'));
    const hadSize = Number.isFinite(work.width) && Number.isFinite(work.height);
    const keeping = hadSize ? ' — keeping the previous width/height' : '';
    let info;
    try {
      info = readImageInfo(abs);
    } catch (err) {
      warn(`${work.file}: couldn't read the image size (${err.message})${keeping}`);
      continue;
    }
    if (info.format === 'heif') {
      warn(`${work.file}: this is a HEIC/HEIF photo, which most browsers can't display — convert it to JPEG`);
    } else if (!info.format) {
      warn(`${work.file}: unrecognised image format${keeping}`);
    } else if (!FORMAT_EXTS[info.format].includes(path.posix.extname(work.file).toLowerCase())) {
      log(`  ~ ${work.file} is actually a ${FORMAT_NAMES[info.format]} image (browsers will still display it)`);
    }
    if (info.width && info.height) {
      work.width = info.width; // updates in place if present, otherwise appended after the other keys
      work.height = info.height;
    }
  }

  // 5. Report.
  for (const work of works) {
    if (!addedSet.has(work.file)) continue;
    const size = work.width && work.height ? `  ${work.width}×${work.height}` : '';
    log(`  + ${work.file}  "${work.title}"${size}`);
  }
  for (const { label, reason } of removed) log(`  - removed ${label} (${reason})`);

  manifest.works = works;
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const summary = `${works.length} work${works.length === 1 ? '' : 's'} (${added.length} added, ${removed.length} removed)`;

  if (opts.dryRun) {
    process.stdout.write(json);
    log(`Dry run: ${summary} — ${MANIFEST_DISPLAY} was not written.`);
    return 0;
  }

  fs.mkdirSync(ART_DIR, { recursive: true });
  if (raw === json) {
    log(`${MANIFEST_DISPLAY} is up to date: ${summary}.`);
  } else {
    writeFileAtomic(MANIFEST_PATH, json);
    log(`Wrote ${MANIFEST_DISPLAY}: ${summary}.`);
  }
  if (works.length === 0) {
    log('No images found yet — drop .jpg/.png/.webp/.gif/.avif files into public/art/ and run `npm run art` again.');
  } else {
    log(`Next: edit titles, years, media, captions and Instagram links in ${MANIFEST_DISPLAY}.`);
  }
  return 0;
}

function parseArgs(argv) {
  const opts = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new UsageError(`unknown option "${arg}"`);
  }
  return opts;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** Lists images in `dir` and its direct sub-folders as POSIX paths relative to `dir`. */
function scanImages(dir) {
  const images = [];
  const skipped = [];
  const visit = (absDir, relDir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
      throw err;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.')) continue; // dotfiles, .DS_Store, macOS "._" files, hidden folders
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = fs.statSync(abs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // dangling link
        }
      }
      if (isDir) {
        if (depth === 0) visit(abs, rel, 1);
        continue;
      }
      if (!isFile || (depth === 0 && name === MANIFEST_NAME)) continue;
      const ext = path.extname(name).toLowerCase();
      if (IMAGE_EXTS.has(ext)) images.push(rel);
      else if (UNSUPPORTED_EXTS.has(ext)) skipped.push(rel);
    }
  };
  visit(dir, '', 0);
  return { images, skipped };
}

/**
 * Maps a `file` value from the manifest to the actual (correctly cased) POSIX path of an existing
 * file under `root`, or null. Case is fixed so the site also works on case-sensitive web hosts.
 */
function createResolver(root) {
  const listings = new Map();
  const list = (dir) => {
    if (!listings.has(dir)) {
      let names = null;
      try {
        names = fs.readdirSync(dir);
      } catch {
        // not a directory / doesn't exist
      }
      listings.set(dir, names);
    }
    return listings.get(dir);
  };
  const lookup = (rel) => {
    let dir = root;
    const out = [];
    for (const part of rel.split('/')) {
      const names = list(dir);
      if (!names) return null;
      const lower = part.toLowerCase();
      const name = names.includes(part) ? part : names.find((n) => n.toLowerCase() === lower);
      if (!name) return null;
      out.push(name);
      dir = path.join(dir, name);
    }
    try {
      return fs.statSync(dir).isFile() ? out.join('/') : null;
    } catch {
      return null;
    }
  };
  return {
    resolve(file) {
      const rel = normalizeRelPath(file);
      if (!rel) return null;
      // Also accept paths written relative to the site or repo root ("art/x.jpg", "public/art/x.jpg").
      const alt = rel.replace(/^(?:public\/)?art\//i, '');
      return lookup(rel) || (alt !== rel && alt ? lookup(alt) : null);
    },
  };
}

/** "./2023\\heron.jpg" → "2023/heron.jpg"; null for absolute paths or paths escaping the folder. */
function normalizeRelPath(file) {
  const s = String(file).trim().replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // URLs, Windows drive letters
  const segments = s.split('/').filter((seg) => seg !== '' && seg !== '.');
  if (!segments.length || segments.includes('..')) return null;
  return segments.join('/');
}

function writeFileAtomic(file, contents) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Works
// ---------------------------------------------------------------------------------------------

/**
 * Returns a copy of `existing` with `file` set and the standard keys present (existing values are
 * never overwritten). Key order: file, title, year, medium, caption, instagram, featured, then any
 * other keys (custom fields, width, height) in their existing order.
 */
function normalizeWork(existing, file) {
  const has = (key) => Object.prototype.hasOwnProperty.call(existing, key);
  const entries = [
    ['file', file],
    ['title', has('title') ? existing.title : titleFromFilename(file)],
  ];
  for (const [key, value] of Object.entries(WORK_DEFAULTS)) entries.push([key, has(key) ? existing[key] : value]);
  const known = new Set(entries.map(([key]) => key));
  for (const [key, value] of Object.entries(existing)) if (!known.has(key)) entries.push([key, value]);
  return Object.fromEntries(entries);
}

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'onto', 'or',
  'over', 'the', 'to', 'with', 'vs',
]);
const ROMAN_NUMERAL = /^(?=[ivx]+$)x{0,3}(?:ix|iv|v?i{0,3})$/i;

// Letter runs that on their own mean a camera / phone / app made the name up.
const MACHINE_WORDS = new Set([
  'img', 'image', 'images', 'dsc', 'dscn', 'dscf', 'dcim', 'pxl', 'mvimg', 'vid', 'video', 'pic', 'pict',
  'picture', 'photo', 'photos', 'screenshot', 'screen', 'shot', 'fb', 'received', 'whatsapp', 'snapchat',
  'signal', 'telegram', 'insta', 'instagram', 'ig', 'at', 'am', 'pm', 'wa', 'edited', 'edit', 'export',
  'exported', 'untitled', 'unnamed', 'download', 'downloaded', 'scan', 'scanned', 'file', 'copy', 'burst',
  'hdr', 'pano', 'raw', 'jpeg', 'jpg', 'png', 'heic', 'webp', 'gif', 'avif', 'final', 'resized',
  'compressed', 'thumb', 'thumbnail', 'original', 'iphone', 'gopr', 'gopro', 'dji', 'cimg', 'imag', 'sam',
  'wp', 'mmexport', 'temp', 'tmp', 'new',
]);

/** "blue-heron.jpg" → "Blue Heron"; "IMG_1234.jpg" → "Untitled". */
function titleFromFilename(rel) {
  let base = path.posix.basename(rel).replace(/\.[^.]*$/, '');
  base = base
    .replace(/(^|[\s_.-])\d{2,5}\s*[x×]\s*\d{2,5}(?=$|[\s_.-])/gi, ' ') // pixel sizes, e.g. "-1080x1350"
    .replace(/@\dx$/i, '') // retina suffixes
    .replace(/(?:[\s_-]+copy(?:[\s_-]+\d+)?|\s*\(\d+\))+$/i, ''); // "heron copy 2", "heron (1)"
  if (looksMachineGenerated(base)) return 'Untitled';

  let s = base.replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s.includes(' ')) s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'); // "BlueHeron" → "Blue Heron"
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.every((ch) => ch === ch.toUpperCase())) s = s.toLowerCase(); // "BLUE HERON" → title case
  const words = s.split(' ');
  return words
    .map((word, i) => {
      if (ROMAN_NUMERAL.test(word)) return word.toUpperCase(); // "study ii" → "Study II"
      const lower = word.toLowerCase();
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower)) return lower;
      if (word === lower) return word.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
      return word; // keep deliberate capitals: "NYC", "McDonald"
    })
    .join(' ');
}

function looksMachineGenerated(base) {
  const letters = (base.match(/\p{L}/gu) || []).length;
  const digits = (base.match(/\p{Nd}/gu) || []).length;
  if (letters < 2 || digits > letters) return true; // Instagram downloads, "20230512_142233", "1"
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(base)) return true; // UUID
  const compact = base.replace(/[\s_.-]+/g, '');
  if (/^[0-9a-f]{16,}$/i.test(compact) || (/^[0-9a-f]{8,}$/i.test(compact) && /\d/.test(compact))) return true; // hash
  const runs = base.match(/\p{L}{2,}/gu) || [];
  if (!runs.some((run) => !MACHINE_WORDS.has(run.toLowerCase()))) return true; // "IMG_1234", "DSCN0042", "image (3)"
  const tokens = base.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Random IDs that mix letters and digits, e.g. "CwXyZ1aBcDe" (but not "study2023" or "2023heron").
  return tokens.some(
    (t) => t.length >= 8 && /\d/.test(t) && /\p{L}/u.test(t) && !/^\p{L}+\d{1,4}$/u.test(t) && !/^\d{1,4}\p{L}+$/u.test(t),
  );
}

function naturalCompare(a, b) {
  return a.localeCompare(b, 'en', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------
// Image headers
// ---------------------------------------------------------------------------------------------

const headerBuffer = Buffer.allocUnsafe(HEADER_BYTES);

/** Reads the first HEADER_BYTES of a file. The returned view is only valid until the next call. */
function readHeader(abs) {
  const fd = fs.openSync(abs, 'r');
  try {
    let total = 0;
    while (total < HEADER_BYTES) {
      const n = fs.readSync(fd, headerBuffer, total, HEADER_BYTES - total, total);
      if (n === 0) break;
      total += n;
    }
    return headerBuffer.subarray(0, total);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Returns { format, width, height } — format is null if unrecognised; width/height are omitted for
 * formats whose size isn't read (HEIF). Throws an Error with a readable message for corrupt files.
 */
function readImageInfo(abs) {
  const buf = readHeader(abs);
  if (buf.length === 0) throw new Error('empty file');
  const format = sniffFormat(buf);
  if (!format || format === 'heif') return { format };
  let size;
  try {
    size = SIZE_READERS[format](buf);
  } catch (err) {
    if (err instanceof RangeError) throw new Error(`truncated or corrupt ${FORMAT_NAMES[format]} header`);
    throw err;
  }
  const { width, height } = size;
  if (!(width > 0 && height > 0)) throw new Error(`invalid ${FORMAT_NAMES[format]} size ${width}×${height}`);
  return { format, width, height };
}

function sniffFormat(buf) {
  const ascii = (start, end) => buf.toString('latin1', start, end);
  if (buf.length >= 8 && buf[0] === 0x89 && ascii(1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return 'gif';
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 16 && ascii(4, 8) === 'ftyp') {
    const size = Math.min(buf.readUInt32BE(0), buf.length, 256);
    const brands = [ascii(8, 12)];
    for (let p = 16; p + 4 <= size; p += 4) brands.push(ascii(p, p + 4));
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.some((b) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b))) return 'heif';
  }
  return null;
}

const SIZE_READERS = {
  png(buf) {
    // Signature, then chunks; IHDR is normally first (Apple "CgBI" PNGs put a chunk before it).
    let p = 8;
    while (p + 8 <= buf.length) {
      const length = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      if (type === 'IHDR') return { width: buf.readUInt32BE(p + 8), height: buf.readUInt32BE(p + 12) };
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + length;
    }
    throw new Error('no PNG IHDR chunk');
  },

  gif(buf) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  },

  webp(buf) {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') {
      // 3-byte frame tag, start code 9d 01 2a, then 14-bit width & height (top 2 bits = scaling).
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error('bad VP8 start code');
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      // Signature 0x2f, then width-1 (14 bits) and height-1 (14 bits), little-endian bit order.
      if (buf[20] !== 0x2f) throw new Error('bad VP8L signature');
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      // Flags (1) + reserved (3), then canvas width-1 and height-1 as 24-bit little-endian.
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    throw new Error(`unknown WebP chunk "${chunk}"`);
  },

  jpeg(buf) {
    const n = buf.length;
    let orientation = 1;
    let exifSeen = false;
    let i = 2;
    while (i < n) {
      if (buf[i] !== 0xff) {
        i++; // tolerate junk between segments
        continue;
      }
      while (i < n && buf[i] === 0xff) i++; // 0xFF fill bytes
      if (i >= n) break;
      const marker = buf[i++];
      // Standalone markers have no length: TEM, SOI, RST0-7 (and a stray stuffed 0x00).
      if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9) break; // EOI
      if (i + 2 > n) break;
      const length = buf.readUInt16BE(i);
      if (length < 2) throw new Error('corrupt JPEG segment length');
      const start = i + 2;
      const end = i + length;
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (start + 5 > n) break;
        const height = buf.readUInt16BE(start + 1);
        const width = buf.readUInt16BE(start + 3);
        // EXIF orientations 5–8 are rotated by 90°, so the displayed image is height × width.
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
      }
      if (marker === 0xe1 && !exifSeen && end <= n) {
        const value = exifOrientation(buf, start, end);
        if (value !== null) {
          orientation = value;
          exifSeen = true;
        }
      }
      if (marker === 0xda) {
        // Start of scan before any frame header: skip the entropy-coded data to the next marker.
        i = end;
        while (i + 1 < n && !(buf[i] === 0xff && buf[i + 1] !== 0x00 && !(buf[i + 1] >= 0xd0 && buf[i + 1] <= 0xd7))) i++;
        continue;
      }
      i = end;
    }
    throw new Error(n >= HEADER_BYTES ? 'no JPEG frame header in the first 512 KB' : 'truncated JPEG, no frame header found');
  },

  avif(buf) {
    // ISO-BMFF: meta → pitm (primary item), iprp → ipco (properties) + ipma (item → property links).
    const meta = findBox(buf, 0, buf.length, 'meta');
    if (!meta) throw new Error('no AVIF meta box in the first 512 KB');
    const metaStart = meta.start + 4; // FullBox version + flags
    let primary = null;
    const pitm = findBox(buf, metaStart, meta.end, 'pitm');
    if (pitm) primary = buf[pitm.start] === 0 ? buf.readUInt16BE(pitm.start + 4) : buf.readUInt32BE(pitm.start + 4);
    const iprp = findBox(buf, metaStart, meta.end, 'iprp');
    const ipco = iprp && findBox(buf, iprp.start, iprp.end, 'ipco');
    if (!ipco) throw new Error('no AVIF item properties');
    const props = [...boxes(buf, ipco.start, ipco.end)]; // referenced 1-based by ipma

    let linked = null;
    for (const box of boxes(buf, iprp.start, iprp.end)) {
      if (box.type !== 'ipma') continue;
      const version = buf[box.start];
      const wideIndex = (buf.readUIntBE(box.start + 1, 3) & 1) === 1;
      let p = box.start + 4;
      const count = buf.readUInt32BE(p);
      p += 4;
      for (let e = 0; e < count && p < box.end; e++) {
        const itemId = version < 1 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
        p += version < 1 ? 2 : 4;
        const associations = buf[p++];
        const indices = [];
        for (let a = 0; a < associations; a++) {
          indices.push(wideIndex ? buf.readUInt16BE(p) & 0x7fff : buf[p] & 0x7f);
          p += wideIndex ? 2 : 1;
        }
        if (itemId === primary) linked = indices.map((index) => props[index - 1]).filter(Boolean);
      }
    }

    const sizeOf = (box) => ({ width: buf.readUInt32BE(box.start + 4), height: buf.readUInt32BE(box.start + 8) });
    let ispe = linked && linked.find((box) => box.type === 'ispe');
    if (!ispe) {
      // Fall back to the largest declared image size.
      for (const box of props) {
        if (box.type !== 'ispe') continue;
        const s = sizeOf(box);
        if (!ispe || s.width * s.height > sizeOf(ispe).width * sizeOf(ispe).height) ispe = box;
      }
    }
    if (!ispe) throw new Error('no AVIF image size property');
    let { width, height } = sizeOf(ispe);
    // Clean-aperture crop (e.g. macOS writes an even-sized image plus a crop to the real size).
    const clap = linked && linked.find((box) => box.type === 'clap');
    if (clap && clap.end - clap.start >= 16) {
      const [wN, wD, hN, hD] = [0, 4, 8, 12].map((o) => buf.readUInt32BE(clap.start + o));
      if (wD && hD && wN % wD === 0 && hN % hD === 0) {
        const cropW = wN / wD;
        const cropH = hN / hD;
        if (cropW > 0 && cropH > 0 && cropW <= width && cropH <= height) {
          width = cropW;
          height = cropH;
        }
      }
    }
    const irot = linked && linked.find((box) => box.type === 'irot');
    const quarterTurns = irot ? buf[irot.start] & 3 : 0;
    return quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height };
  },
};

/** Returns the EXIF orientation (1–8) from an APP1 segment, 1 if absent, or null if not EXIF. */
function exifOrientation(buf, start, end) {
  if (end - start < 14 || buf.toString('latin1', start, start + 4) !== 'Exif' || buf[start + 4] !== 0) return null;
  const tiff = start + 6;
  const order = buf.toString('latin1', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (p) => (little ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
  const u32 = (p) => (little ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) break;
    if (u16(entry) !== 0x0112) continue;
    const type = u16(entry + 2);
    const value = type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : buf[entry + 8];
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** Iterates ISO-BMFF boxes in [start, end): { type, start (payload), end }. */
function* boxes(buf, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p; // box extends to the end
    }
    if (size < header) return; // corrupt
    yield { type, start: p + header, end: Math.min(p + size, end) };
    p += size;
  }
}

function findBox(buf, start, end, type) {
  for (const box of boxes(buf, start, end)) if (box.type === type) return box;
  return null;
}

// ---------------------------------------------------------------------------------------------

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`build-art-manifest: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
}
