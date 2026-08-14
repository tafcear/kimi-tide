// repair-session.mjs <sessionFile> [--apply]
// Marks stored `kimi/session` events `ignorable: true` so the strict dsh
// persistence reader skips them when the bridge's type is not registered.
// Frame layout, chunk rows, and every other byte are preserved bit-for-bit;
// only frames containing a modified record are recompressed (checksummed).
//
// dsh-session is resolved from the web profile anchor (the same installation
// copy the harness uses), so this works across npx cache locations.
import { readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { zstdDecompressSync, zstdCompressSync, constants } from 'node:zlib';
import { createRequire } from 'node:module';

const PROFILE_ANCHOR = 'file:///C:/Users/tafce/.dsh/profiles/web/package.json';
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const ZSTD_MAGIC = 0xfd2fb528;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) {
  console.error('usage: node repair-session.mjs <session.jsonl.zstd> [--apply]');
  process.exit(2);
}
const buffer = readFileSync(file);
const { frames, tornStart } = scanZstdFrames(buffer);
console.log(`frames: ${frames.length} complete, tornStart: ${tornStart ?? 'none'}`);
if (tornStart !== undefined) {
  console.error('refusing to touch a log with an incomplete final frame');
  process.exit(3);
}

const known = new Set();
let decodeStorageRecord;
{
  const req = createRequire(PROFILE_ANCHOR);
  const dshSession = req.resolve('@deepseek-ai/dsh-session');
  const mod = await import(new URL(`file:///${dshSession.replaceAll('\\', '/')}`).href);
  for (const t of mod.KNOWN_SESSION_EVENT_TYPES) known.add(t);
  decodeStorageRecord = mod.decodeStorageRecord;
}

let changedFrames = 0;
let changedRecords = 0;
const outputs = [];
for (const [i, f] of frames.entries()) {
  const src = buffer.subarray(f.start, f.end);
  const plain = zstdDecompressSync(src);
  const text = plain.toString('utf8');
  const lines = text.split('\n');
  let changed = false;
  const outLines = lines.map((l) => {
    if (l.length === 0) return l;
    let rec;
    try {
      rec = JSON.parse(l);
    } catch {
      return l;
    }
    if (rec?.type === 'kimi/session' && rec.ignorable !== true) {
      rec.ignorable = true;
      changed = true;
      changedRecords += 1;
      return JSON.stringify(rec);
    }
    return l;
  });
  if (!changed) {
    outputs.push(src);
    continue;
  }
  changedFrames += 1;
  const out = Buffer.from(outLines.join('\n'), 'utf8');
  outputs.push(zstdCompressSync(out, CHECKSUM));
  console.log(`frame ${i}: ${lines.length} lines (frame ${src.length}B -> ${outputs.at(-1).length}B)`);
}
console.log(`changed frames: ${changedFrames}, changed records: ${changedRecords}`);

if (!apply) {
  console.log('dry run — nothing written');
  process.exit(0);
}
const result = Buffer.concat(outputs);
const backup = file + '.pre-kimi-fix.bak';
copyFileSync(file, backup);
writeFileSync(file + '.new', result);
renameSync(file + '.new', file);
console.log(`applied: wrote ${result.length} bytes (backup at ${backup})`);

// verify round-trip: expand chunk rows the way the harness does, then apply
// the exact assertEventsSupported rule (KNOWN || ignorable).
const check = readFileSync(file);
const re = scanZstdFrames(check);
if (re.tornStart !== undefined) throw new Error('repaired file has a torn final frame');
let total = 0;
let refused = 0;
let firstRecord = true;
for (const f of re.frames) {
  const plain = zstdDecompressSync(check.subarray(f.start, f.end)).toString('utf8');
  for (const l of plain.split('\n')) {
    if (l.length === 0) continue;
    const rec = JSON.parse(l);
    if (firstRecord) {
      // the header record is parsed as session meta, not as an event
      firstRecord = false;
      if (rec.type !== 'session') throw new Error('first record is not the session header');
      continue;
    }
    for (const event of decodeStorageRecord(rec)) {
      total += 1;
      if (!known.has(event.type) && event.ignorable !== true) {
        refused += 1;
        console.error('STILL REFUSED:', event.type, event.seq);
      }
    }
  }
}
console.log(`verify: ${total} events decoded, ${refused} would be refused by the harness reader`);
process.exit(refused === 0 ? 0 : 4);
