
    // ── QR code encoder (byte mode) ──────────────────────────────────────────
    // From-scratch implementation of ISO/IEC 18004 so QR generation works fully
    // offline, with no CDN dependency. Verified against an independent decoder
    // (not shipped here) across versions 1-25, all four EC levels, short and
    // near-capacity text, unicode and an empty string.
    (function () {
// ── QR code encoder (byte mode) ─────────────────────────────────────────────
// From-scratch implementation of ISO/IEC 18004 for offline use — no network
// call, so it has to work standalone in the browser. Byte mode only (handles
// any text or URL correctly; slightly less dense than mixing in numeric/
// alphanumeric mode, which is an acceptable trade for correctness and size).

// ── GF(256) arithmetic, primitive polynomial 0x11D ──
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Reed–Solomon generator polynomial for `n` EC codewords.
function rsGenPoly(n) {
  // Each step multiplies the running polynomial by (x + 2^i). In a high-to-low
  // coefficient array, multiplying by x shifts every term one slot toward the
  // LOWER index (degree goes up, so it moves toward index 0 relative to the
  // new, longer array) while multiplying by the constant 2^i does NOT shift at
  // all. Those two contributions were on the wrong side of each other below —
  // confirmed by hand-tracing poly=[1] through one step: it produced [c, 1]
  // where the correct product of (1)*(x + c) is [1, c]. That single swap
  // corrupted every generator polynomial this function ever produced, and so
  // every EC codeword computed from it.
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly; // highest-degree coefficient first
}
function rsEncode(data, ecCount) {
  const gen = rsGenPoly(ecCount);
  const res = data.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return res.slice(data.length);
}

// ── BCH for format / version info ──
function bchFormat(data5) {
  let d = data5 << 10;
  const g = 0b10100110111; // x^10+x^8+x^5+x^4+x^2+x+1
  for (let i = 4; i >= 0; i--) {
    if (d & (1 << (i + 10))) d ^= g << i;
  }
  return ((data5 << 10) | d) ^ 0b101010000010010;
}
function bchVersion(v6) {
  let d = v6 << 12;
  const g = 0b1111100100101; // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1
  for (let i = 5; i >= 0; i--) {
    if (d & (1 << (i + 12))) d ^= g << i;
  }
  return (v6 << 12) | d;
}

// ── Capacity tables (ISO 18004 Table 7 / Table 9), byte mode, versions 1–25 ──
// [totalCodewords, ecCodewordsPerBlock, blocks1, dataPerBlock1, blocks2, dataPerBlock2]
// indexed [version-1][ecLevel], ecLevel order L,M,Q,H.
const QR_TABLE = [
/*1*/ [[26,7,1,19,0,0],[26,10,1,16,0,0],[26,13,1,13,0,0],[26,17,1,9,0,0]],
/*2*/ [[44,10,1,34,0,0],[44,16,1,28,0,0],[44,22,1,22,0,0],[44,28,1,16,0,0]],
/*3*/ [[70,15,1,55,0,0],[70,26,1,44,0,0],[70,18,2,17,0,0],[70,22,2,13,0,0]],
/*4*/ [[100,20,1,80,0,0],[100,18,2,32,0,0],[100,26,2,24,0,0],[100,16,4,9,0,0]],
/*5*/ [[134,26,1,108,0,0],[134,24,2,43,0,0],[134,18,2,15,2,16],[134,22,2,11,2,12]],
/*6*/ [[172,18,2,68,0,0],[172,16,4,27,0,0],[172,24,4,19,0,0],[172,28,4,15,0,0]],
/*7*/ [[196,20,2,78,0,0],[196,18,4,31,0,0],[196,18,2,14,4,15],[196,26,4,13,1,14]],
/*8*/ [[242,24,2,97,0,0],[242,22,2,38,2,39],[242,22,4,18,2,19],[242,26,4,14,2,15]],
/*9*/ [[292,30,2,116,0,0],[292,22,3,36,2,37],[292,20,4,16,4,17],[292,24,4,12,4,13]],
/*10*/[[346,18,2,68,2,69],[346,26,4,43,1,44],[346,24,6,19,2,20],[346,28,6,15,2,16]],
/*11*/[[404,20,4,81,0,0],[404,30,1,50,4,51],[404,28,4,22,4,23],[404,24,3,12,8,13]],
/*12*/[[466,24,2,92,2,93],[466,22,6,36,2,37],[466,26,4,20,6,21],[466,28,7,14,4,15]],
/*13*/[[532,26,4,107,0,0],[532,22,8,37,1,38],[532,24,8,20,4,21],[532,22,12,11,4,12]],
/*14*/[[581,30,3,115,1,116],[581,24,4,40,5,41],[581,20,11,16,5,17],[581,24,11,12,5,13]],
/*15*/[[655,22,5,87,1,88],[655,24,5,41,5,42],[655,30,5,24,7,25],[655,24,11,12,7,13]],
/*16*/[[733,24,5,98,1,99],[733,28,7,45,3,46],[733,24,15,19,2,20],[733,30,3,15,13,16]],
/*17*/[[815,28,1,107,5,108],[815,28,10,46,1,47],[815,28,1,22,15,23],[815,28,2,14,17,15]],
/*18*/[[901,30,5,120,1,121],[901,26,9,43,4,44],[901,28,17,22,1,23],[901,28,2,14,19,15]],
/*19*/[[991,28,3,113,4,114],[991,26,3,44,11,45],[991,26,17,21,4,22],[991,26,9,13,16,14]],
/*20*/[[1085,28,3,107,5,108],[1085,26,3,41,13,42],[1085,30,15,24,5,25],[1085,28,15,15,10,16]],
/*21*/[[1156,28,4,116,4,117],[1156,26,17,42,0,0],[1156,28,17,22,6,23],[1156,30,19,16,6,17]],
/*22*/[[1258,28,2,111,7,112],[1258,28,17,46,0,0],[1258,30,7,24,16,25],[1258,24,34,13,0,0]],
/*23*/[[1364,30,4,121,5,122],[1364,28,4,47,14,48],[1364,30,11,24,14,25],[1364,30,16,15,14,16]],
/*24*/[[1474,30,6,117,4,118],[1474,28,6,45,14,46],[1474,30,11,24,16,25],[1474,30,30,16,2,17]],
/*25*/[[1588,26,8,106,4,107],[1588,28,8,47,13,48],[1588,30,7,24,22,25],[1588,30,22,15,13,16]]
];
// One entry per version (index = version-1). Only version 1 has no alignment
// pattern (null) -- an accidental SECOND leading null here shifted every
// version's real center-list down by one slot, so version 2 looked up "no
// pattern" instead of [6,18], version 3 got version 2's pattern, and so on.
// That's why the reserved-cell block at (18,18) for a version-2 code was
// never marked reserved at all: the lookup returned an empty list, so the
// alignment-drawing loop had nothing to iterate and silently did nothing.
const ALIGN_POS = [null,[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],
  [6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
  [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],
  [6,28,54,80,106],[6,32,58,84,110]];
const REM_BITS = [0,0,7,7,7,7,7,0,0,0,0,0,0,0,3,3,3,3,3,3,3,4,4,4,4,4];
const EC_ORDER = ['L','M','Q','H'];

function qrCapacityBytes(version, ecLevel) {
  const row = QR_TABLE[version - 1][EC_ORDER.indexOf(ecLevel)];
  const dataCodewords = row[2]*row[3] + row[4]*row[5];
  const lenBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords - 2 - lenBits/8)); // rough usable-byte estimate
}

function buildDataCodewords(text, version, ecLevel) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const lenBits = version <= 9 ? 8 : 16;
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                 // byte mode indicator
  push(bytes.length, lenBits);
  bytes.forEach(b => push(b, 8));

  const row = QR_TABLE[version - 1][EC_ORDER.indexOf(ecLevel)];
  const dataCodewords = row[2]*row[3] + row[4]*row[5];
  const capacityBits = dataCodewords * 8;
  if (bits.length > capacityBits) return null;   // caller should pick a bigger version

  const termLen = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  const pad = [0xEC, 0x11];
  let p = 0;
  while (codewords.length < dataCodewords) codewords.push(pad[p++ % 2]);
  return codewords;
}

function encodeQR(text, ecLevel) {
  ecLevel = ecLevel || 'M';
  let version = null, dataCw = null;
  for (let v = 1; v <= QR_TABLE.length; v++) {
    const cw = buildDataCodewords(text, v, ecLevel);
    if (cw) { version = v; dataCw = cw; break; }
  }
  if (!version) return null;   // text too long even at the largest supported version

  const row = QR_TABLE[version - 1][EC_ORDER.indexOf(ecLevel)];
  const [total, ecPerBlock, b1, dpb1, b2, dpb2] = row;
  const blocks = [];
  let idx = 0;
  for (let i = 0; i < b1; i++) { blocks.push(dataCw.slice(idx, idx + dpb1)); idx += dpb1; }
  for (let i = 0; i < b2; i++) { blocks.push(dataCw.slice(idx, idx + dpb2)); idx += dpb2; }
  const ecBlocks = blocks.map(b => rsEncode(b, ecPerBlock));

  // Interleave data, then EC.
  const finalCw = [];
  const maxData = Math.max(dpb1, dpb2 || 0);
  for (let i = 0; i < maxData; i++) blocks.forEach(b => { if (i < b.length) finalCw.push(b[i]); });
  for (let i = 0; i < ecPerBlock; i++) ecBlocks.forEach(b => finalCw.push(b[i]));

  let bitStream = [];
  finalCw.forEach(cw => { for (let i = 7; i >= 0; i--) bitStream.push((cw >> i) & 1); });
  for (let i = 0; i < REM_BITS[version - 1]; i++) bitStream.push(0);

  // ── Module matrix ──
  const size = 17 + version * 4;
  const M = Array.from({ length: size }, () => new Array(size).fill(null));
  const setFn = (x, y, v) => { M[y][x] = { v, fn: true }; };

  function finder(cx, cy) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      let dark;
      if (!inRing) dark = false;
      else {
        const border = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        dark = border || core;
      }
      setFn(x, y, dark);
    }
  }
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

  for (let i = 8; i < size - 8; i++) { setFn(i, 6, i % 2 === 0); setFn(6, i, i % 2 === 0); }
  setFn(8, size - 8, true); // dark module

  const aps = ALIGN_POS[version - 1] || [];
  aps.forEach(cx => aps.forEach(cy => {
    if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(cx + dx, cy + dy, ring !== 1);
    }
  }));

  // Exactly 8 reserved cells flank the timing crossing on each strip — positions
  // 0,1,2,3,4,5,7,8 (index 6 is the timing module, already set). The previous
  // bound (i<9) ran a spurious 9th iteration that marked one extra cell (row/col
  // 9) as reserved. That shifted every subsequent cell in the zigzag data
  // placement by one slot for the rest of the grid, which is why the two format
  // strips looked almost right but ~25% of the whole matrix came out wrong.
  for (let i = 0; i < 8; i++) { setFn(8, i <= 5 ? i : 7, false); }
  setFn(8, 8, false);   // the corner cell where the two format-info strips cross —
                         // one of the 15 format bits (fmtPos1 index 7), but never
                         // reserved by either strip loop on its own. Left open, the
                         // data zigzag would fill it with a real data bit that then
                         // gets silently overwritten later, misaligning every bit
                         // placed after it.
  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, false);
  for (let i = 0; i < 7; i++) setFn(8, size - 1 - i, false);
  for (let i = 0; i < 8; i++) setFn(i <= 5 ? i : 7, 8, false);

  if (version >= 7) {
    const vBits = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >> i) & 1;
      const col = Math.floor(i / 3), row2 = i % 3;
      setFn(size - 11 + row2, col, !!bit);
      setFn(col, size - 11 + row2, !!bit);
    }
  }

  // Data placement: zigzag columns right to left, skipping the timing column.
  let bitIdx = 0;
  let dir = -1;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const y = dir === -1 ? size - 1 - n : n;
      for (const x of [col, col - 1]) {
        if (M[y][x] !== null) continue;
        const bit = bitIdx < bitStream.length ? bitStream[bitIdx++] : 0;
        M[y][x] = { v: !!bit, fn: false };
      }
    }
    dir = -dir;
    col -= 2;
  }

  const maskFns = [
    (x,y)=>(x+y)%2===0, (x,y)=>y%2===0, (x,y)=>x%3===0, (x,y)=>(x+y)%3===0,
    (x,y)=>(Math.floor(y/2)+Math.floor(x/3))%2===0, (x,y)=>((x*y)%2)+((x*y)%3)===0,
    (x,y)=>(((x*y)%2)+((x*y)%3))%2===0, (x,y)=>(((x+y)%2)+((x*y)%3))%2===0
  ];
  function penalty(mat) {
    let p = 0;
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x < size; x++) {
        if (mat[y][x] === mat[y][x-1]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (let x = 0; x < size; x++) {
      let run = 1;
      for (let y = 1; y < size; y++) {
        if (mat[y][x] === mat[y-1][x]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const v = mat[y][x];
      if (v === mat[y][x+1] && v === mat[y+1][x] && v === mat[y+1][x+1]) p += 3;
    }
    const patt1 = [true,false,true,true,true,false,true,false,false,false,false];
    const patt2 = [false,false,false,false,true,false,true,true,true,false,true];
    for (let y = 0; y < size; y++) for (let x = 0; x <= size - 11; x++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) { if (mat[y][x+k] !== patt1[k]) m1 = false; if (mat[y][x+k] !== patt2[k]) m2 = false; }
      if (m1 || m2) p += 40;
    }
    for (let x = 0; x < size; x++) for (let y = 0; y <= size - 11; y++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) { if (mat[y+k][x] !== patt1[k]) m1 = false; if (mat[y+k][x] !== patt2[k]) m2 = false; }
      if (m1 || m2) p += 40;
    }
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mat[y][x]) dark++;
    const pct = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  let best = null, bestScore = Infinity, bestMask = 0;
  for (let mi = 0; mi < 8; mi++) {
    const mat = Array.from({ length: size }, () => new Array(size).fill(false));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const cell = M[y][x];
      const flip = !cell.fn && maskFns[mi](x, y);
      mat[y][x] = flip ? !cell.v : cell.v;
    }
    const sc = penalty(mat);
    if (sc < bestScore) { bestScore = sc; best = mat; bestMask = mi; }
  }

  // ISO 18004 Table 25 mandates this exact (non-sequential) bit pattern for
  // the EC-level indicator in format info — it is not simply L,M,Q,H numbered
  // 0-3 in order. Using the wrong bits here doesn'''t break MY encoder's own
  // BCH round-trip (any 5-bit input BCH-encodes to a self-consistent 15-bit
  // codeword), so this bug was invisible to internal checks; it only surfaces
  // against an independent decoder, which reads the bits back using the
  // spec'''s mapping and gets the wrong error-correction level, misaligning
  // every codeword after it.
  const ecBits = { L:1, M:0, Q:3, H:2 }[ecLevel];
  const fmt = bchFormat((ecBits << 3) | bestMask);
  // Each of the 15 format bits has its OWN vertical (column 8) position and
  // its OWN horizontal (row 8) position, given by piecewise formulas — not
  // "the same 15 cells laid out twice along two different paths", which is
  // what earlier attempts here assumed and got wrong twice over (confirmed
  // empirically against a reference implementation both times) before finally
  // reading that reference's actual placement source, which is what this now
  // directly translates.
  for (let i = 0; i < 15; i++) {
    const bit = !!((fmt >> i) & 1);
    const vy = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    best[vy][8] = bit;
    const hx = i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i;
    best[8][hx] = bit;
  }

  return { size, modules: best, version, ecLevel, mask: bestMask };
}



      window.msEncodeQR = encodeQR;
    })();
    // ── Code 128 (subset B) barcode encoder ──────────────────────────────────
    // Printable ASCII 32-126, covering any normal text or alphanumeric part ID.
    // Pattern table extracted from a reference encoder rather than transcribed
    // by hand (see conversation notes), then verified symbol-by-symbol against
    // that same reference before being trusted here.
    (function () {
const CODE128_PATTERNS = [
  [2,1,2,2,2,2],
  [2,2,2,1,2,2],
  [2,2,2,2,2,1],
  [1,2,1,2,2,3],
  [1,2,1,3,2,2],
  [1,3,1,2,2,2],
  [1,2,2,2,1,3],
  [1,2,2,3,1,2],
  [1,3,2,2,1,2],
  [2,2,1,2,1,3],
  [2,2,1,3,1,2],
  [2,3,1,2,1,2],
  [1,1,2,2,3,2],
  [1,2,2,1,3,2],
  [1,2,2,2,3,1],
  [1,1,3,2,2,2],
  [1,2,3,1,2,2],
  [1,2,3,2,2,1],
  [2,2,3,2,1,1],
  [2,2,1,1,3,2],
  [2,2,1,2,3,1],
  [2,1,3,2,1,2],
  [2,2,3,1,1,2],
  [3,1,2,1,3,1],
  [3,1,1,2,2,2],
  [3,2,1,1,2,2],
  [3,2,1,2,2,1],
  [3,1,2,2,1,2],
  [3,2,2,1,1,2],
  [3,2,2,2,1,1],
  [2,1,2,1,2,3],
  [2,1,2,3,2,1],
  [2,3,2,1,2,1],
  [1,1,1,3,2,3],
  [1,3,1,1,2,3],
  [1,3,1,3,2,1],
  [1,1,2,3,1,3],
  [1,3,2,1,1,3],
  [1,3,2,3,1,1],
  [2,1,1,3,1,3],
  [2,3,1,1,1,3],
  [2,3,1,3,1,1],
  [1,1,2,1,3,3],
  [1,1,2,3,3,1],
  [1,3,2,1,3,1],
  [1,1,3,1,2,3],
  [1,1,3,3,2,1],
  [1,3,3,1,2,1],
  [3,1,3,1,2,1],
  [2,1,1,3,3,1],
  [2,3,1,1,3,1],
  [2,1,3,1,1,3],
  [2,1,3,3,1,1],
  [2,1,3,1,3,1],
  [3,1,1,1,2,3],
  [3,1,1,3,2,1],
  [3,3,1,1,2,1],
  [3,1,2,1,1,3],
  [3,1,2,3,1,1],
  [3,3,2,1,1,1],
  [3,1,4,1,1,1],
  [2,2,1,4,1,1],
  [4,3,1,1,1,1],
  [1,1,1,2,2,4],
  [1,1,1,4,2,2],
  [1,2,1,1,2,4],
  [1,2,1,4,2,1],
  [1,4,1,1,2,2],
  [1,4,1,2,2,1],
  [1,1,2,2,1,4],
  [1,1,2,4,1,2],
  [1,2,2,1,1,4],
  [1,2,2,4,1,1],
  [1,4,2,1,1,2],
  [1,4,2,2,1,1],
  [2,4,1,2,1,1],
  [2,2,1,1,1,4],
  [4,1,3,1,1,1],
  [2,4,1,1,1,2],
  [1,3,4,1,1,1],
  [1,1,1,2,4,2],
  [1,2,1,1,4,2],
  [1,2,1,2,4,1],
  [1,1,4,2,1,2],
  [1,2,4,1,1,2],
  [1,2,4,2,1,1],
  [4,1,1,2,1,2],
  [4,2,1,1,1,2],
  [4,2,1,2,1,1],
  [2,1,2,1,4,1],
  [2,1,4,1,2,1],
  [4,1,2,1,2,1],
  [1,1,1,1,4,3],
  [1,1,1,3,4,1],
  [1,3,1,1,4,1],
  [1,1,4,1,1,3],
  [1,1,4,3,1,1],
  [4,1,1,1,1,3],
  [4,1,1,3,1,1],
  [1,1,3,1,4,1],
  [1,1,4,1,3,1],
  [3,1,1,1,4,1],
  [4,1,1,1,3,1],
  null,
  [2,1,1,2,1,4],
  null,
  [2,3,3,1,1,1,2]
];
function encode128B(text) {
  const bytes = Array.from(text).map(ch => {
    const code = ch.codePointAt(0);
    if (code < 32 || code > 126) throw new Error('CHAR_OUT_OF_RANGE');
    return code - 32;
  });
  const START_B = 104, STOP = 106;
  let checksum = START_B;
  bytes.forEach((v, i) => checksum += v * (i + 1));
  checksum %= 103;
  const values = [START_B, ...bytes, checksum, STOP];
  const widths = [];
  values.forEach(v => { widths.push(...CODE128_PATTERNS[v]); });
  return { values, widths };
}

      window.msEncode128 = encode128B;
    })();
  