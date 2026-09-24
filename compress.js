// Generate compact frequency dictionaries for the gradient reader app.
//
// Output format (per language), gzip-compressed on disk (.bin.gz):
//   header:     varint numWords, varint wordStreamByteLen, varint freqScale
//   wordStream: per word (sorted ascending, front-coded against previous word):
//               packed varint v = (keepChars << 8) | suffixByteLen
//               (v === 0 is an escape: followed by varint keepChars, varint suffixByteLen)
//               then suffixByteLen UTF-8 bytes
//   freqStream: per word, varint quantizedFreq (same order as words)
//
// Quantization:
//   EN source values are already floor(log2(freq)) buckets (5..27), scale = 1.
//   CN raw counts are stored as round(log2(freq) * 4), scale = 4, because the
//   app only ever uses Math.log2(freq) for coloring.
//
// The web app / extension fetch the .gz and decompress with DecompressionStream.

const fs = require('fs');
const zlib = require('zlib');

// ---- varint (LEB128) -------------------------------------------------------
function writeVarint(n, out) {
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128); // n >>>= 7 loses bits above 2^32
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
}

function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    b = buf[pos.i++];
    n += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return n;
}

// ---- encode ----------------------------------------------------------------
function encodeFreqBin(pairs, freqScale) {
  pairs = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const words = [];
  const freqs = [];
  let prev = '';
  for (const [w, f] of pairs) {
    let keep = 0;
    const max = Math.min(prev.length, w.length);
    while (keep < max && prev[keep] === w[keep]) keep++;
    const suffix = Buffer.from(w.slice(keep), 'utf-8');
    if (keep < 32 && suffix.length < 256 && !(keep === 0 && suffix.length === 0)) {
      writeVarint((keep << 8) | suffix.length, words);
    } else {
      writeVarint(0, words); // escape: long form
      writeVarint(keep, words);
      writeVarint(suffix.length, words);
    }
    for (const b of suffix) words.push(b);
    writeVarint(f, freqs);
    prev = w;
  }
  const header = [];
  writeVarint(pairs.length, header);
  writeVarint(words.length, header);
  writeVarint(freqScale, header);
  return Buffer.concat([Buffer.from(header), Buffer.from(words), Buffer.from(freqs)]);
}

// ---- decode (mirror of the browser decoder, used for round-trip tests) -----
function decodeFreqBin(buf) {
  const pos = { i: 0 };
  const numWords = readVarint(buf, pos);
  const wordStreamLen = readVarint(buf, pos);
  const freqScale = readVarint(buf, pos);
  const wordsEnd = pos.i + wordStreamLen;
  const pairs = [];
  let prev = '';
  const decoder = new TextDecoder('utf-8');
  while (pos.i < wordsEnd) {
    let v = readVarint(buf, pos);
    let keep, suffixLen;
    if (v === 0) {
      keep = readVarint(buf, pos);
      suffixLen = readVarint(buf, pos);
    } else {
      keep = v >> 8;
      suffixLen = v & 0xff;
    }
    const w = prev.slice(0, keep) + decoder.decode(buf.subarray(pos.i, pos.i + suffixLen));
    pos.i += suffixLen;
    pairs.push([w, 0]);
    prev = w;
  }
  for (let k = 0; k < numWords; k++) {
    pairs[k][1] = readVarint(buf, pos);
  }
  if (pairs.length !== numWords) throw new Error(`word count mismatch: ${pairs.length} != ${numWords}`);
  return { pairs, freqScale };
}

// ---- sources ---------------------------------------------------------------
function loadEn() {
  const lines = fs.readFileSync('enwiki-20190320-words-frequency-fmap.txt', 'utf-8').split('\n').filter(Boolean);
  const map = new Map();
  for (const l of lines) {
    const i = l.lastIndexOf(' ');
    const w = l.slice(0, i);
    const f = Number(l.slice(i + 1));
    // the app looks up lowercased /[\w-'’]+/ tokens only; anything else is unreachable
    if (!/^[a-z0-9_'’-]+$/.test(w)) continue;
    map.set(w, f);
  }
  return { pairs: [...map.entries()], freqScale: 1 };
}

function loadCn() {
  const lines = fs.readFileSync('freq.txt', 'utf-8').split('\n').filter(Boolean);
  const map = new Map();
  for (const l of lines) {
    const i = l.lastIndexOf(' ');
    const w = l.slice(0, i);
    const f = Number(l.slice(i + 1));
    map.set(w, Math.max(1, Math.round(Math.log2(f) * 4)));
  }
  return { pairs: [...map.entries()], freqScale: 4 };
}

// ---- build + verify + write ------------------------------------------------
function build(name, { pairs, freqScale }) {
  const bin = encodeFreqBin(pairs, freqScale);
  const { pairs: back, freqScale: scaleBack } = decodeFreqBin(bin);
  if (scaleBack !== freqScale) throw new Error('scale mismatch');
  if (back.length !== pairs.length) throw new Error('length mismatch');
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = 0; i < sorted.length; i += Math.max(1, Math.floor(sorted.length / 1000))) {
    const [w, f] = sorted[i];
    if (back[i][0] !== w || back[i][1] !== f) {
      throw new Error(`round-trip mismatch at ${i}: [${back[i]}] != [${w},${f}]`);
    }
  }
  const gz = zlib.gzipSync(bin, { level: 9 });
  const file = `${name}.bin.gz`;
  fs.writeFileSync(file, gz);
  fs.writeFileSync(`extension/${file}`, gz);
  console.log(`${file}: ${sorted.length} words, raw=${(bin.length / 1e6).toFixed(2)}MB gzip=${(gz.length / 1e6).toFixed(2)}MB`);
}

build('enwiki-freq', loadEn());
build('cn-freq', loadCn());
