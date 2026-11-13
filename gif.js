// --- Animated GIF decoder: pure data (no DOM), so it can be tested with Node. ---
// Every frame is composed onto the full picture as the GIF spec describes (sub-rectangles, transparency, disposal methods,
// interlacing, local colour tables). The result is RGBA pixels per frame; the page turns them into canvases.

const GIF_MAX_DECODED = 600 * 1048576;   // all frames are kept in memory, so the decoded size is capped

// concatenated data of the sub-blocks starting at p, and the position after the terminating zero-length block
function gifBlocks(u, p) {
  const parts = []; let total = 0;
  while (p < u.length) { const len = u[p++]; if (!len) break; parts.push(u.subarray(p, p + len)); total += len; p += len; }
  const data = new Uint8Array(total); let o = 0;
  for (const q of parts) { data.set(q, o); o += q.length; }
  return { data, next: p };
}

// LZW decoding of one frame's palette indices (n = number of pixels expected)
function gifLzw(minCode, data, n) {
  const out = new Uint8Array(n), clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
  let size = minCode + 1, next = eoi + 1, prev = -1, o = 0, buf = 0, bits = 0, p = 0;
  while (o < n) {
    while (bits < size) { if (p >= data.length) return out; buf |= data[p++] << bits; bits += 8; }
    const code = buf & ((1 << size) - 1); buf >>>= size; bits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    const special = prev >= 0 && code >= next;   // the code being defined right now: string(prev) + its own first character
    let c = special ? prev : code, sp = 0;
    while (c >= 0 && sp < 4096) { stack[sp++] = suffix[c]; c = prefix[c]; }
    const first = stack[sp - 1];
    for (let k = sp - 1; k >= 0 && o < n; k--) out[o++] = stack[k];
    if (special && o < n) out[o++] = first;
    if (prev >= 0 && next < 4096) { prefix[next] = prev; suffix[next] = first; next++; if (next === (1 << size) && size < 12) size++; }
    prev = code;
  }
  return out;
}

// -> { width, height, frames: [{ rgba: Uint8ClampedArray (full picture), ms }] }. Throws on data that is not a GIF.
function decodeGifFrames(ab) {
  const u = new Uint8Array(ab), rd16 = i => u[i] | u[i + 1] << 8;
  if (u.length < 13 || u[0] !== 0x47 || u[1] !== 0x49 || u[2] !== 0x46) throw new Error('not a GIF');
  const W = rd16(6), H = rd16(8), fl = u[10];
  if (!W || !H) throw new Error('empty GIF');
  let p = 13, gct = null;
  if (fl & 0x80) { const n = 3 * (2 << (fl & 7)); gct = u.subarray(p, p + n); p += n; }
  const full = new Uint8ClampedArray(W * H * 4), frames = [];
  let gce = { disposal: 0, transp: -1, ms: 100 }, saved = null, prevDisposal = 0, prevRect = null, bytes = 0;
  while (p < u.length) {
    const b = u[p++];
    if (b === 0x21) {                                   // extension
      const label = u[p++], blk = gifBlocks(u, p);
      if (label === 0xF9 && blk.data.length >= 4) {     // graphic control: disposal, transparency, delay
        const d = blk.data[1] | blk.data[2] << 8;
        gce = { disposal: (blk.data[0] >> 2) & 7, transp: blk.data[0] & 1 ? blk.data[3] : -1, ms: d <= 1 ? 100 : d * 10 };
      }
      p = blk.next;
    } else if (b === 0x2C) {                            // image
      const x = rd16(p), y = rd16(p + 2), w = rd16(p + 4), h = rd16(p + 6), ifl = u[p + 8];
      p += 9;
      let ct = gct;
      if (ifl & 0x80) { const n = 3 * (2 << (ifl & 7)); ct = u.subarray(p, p + n); p += n; }
      const minCode = u[p++], blk = gifBlocks(u, p); p = blk.next;
      // the previous frame's disposal decides what the picture looks like before this frame is drawn
      if (prevDisposal === 2 && prevRect) {
        for (let r = 0; r < prevRect.h; r++) for (let c = 0; c < prevRect.w; c++) {
          const X = prevRect.x + c, Y = prevRect.y + r;
          if (X < W && Y < H) full.fill(0, (Y * W + X) * 4, (Y * W + X) * 4 + 4);
        }
      } else if (prevDisposal === 3 && saved) full.set(saved);
      saved = gce.disposal === 3 ? full.slice() : null;
      const idx = gifLzw(minCode, blk.data, w * h);
      let rows = null;                                  // interlaced: stored row k is picture row rows[k]
      if (ifl & 0x40) { rows = []; for (const [st, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = st; r < h; r += step) rows.push(r); }
      for (let k = 0; k < h; k++) {
        const Y = y + (rows ? rows[k] : k); if (Y >= H) continue;
        for (let c = 0; c < w; c++) {
          const X = x + c; if (X >= W) continue;
          const v = idx[k * w + c];
          if (v === gce.transp || !ct || v * 3 + 2 >= ct.length) continue;
          const o = (Y * W + X) * 4;
          full[o] = ct[v * 3]; full[o + 1] = ct[v * 3 + 1]; full[o + 2] = ct[v * 3 + 2]; full[o + 3] = 255;
        }
      }
      bytes += W * H * 4;
      if (bytes > GIF_MAX_DECODED) throw new Error('too large');
      frames.push({ rgba: full.slice(), ms: gce.ms });
      prevDisposal = gce.disposal; prevRect = { x, y, w, h };
      gce = { disposal: 0, transp: -1, ms: 100 };       // the graphic control block applies to one image only
    } else break;                                        // trailer (0x3B) or damaged data
  }
  if (!frames.length) throw new Error('no frames');
  return { width: W, height: H, frames };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { decodeGifFrames, gifLzw, GIF_MAX_DECODED };   // lets the Node tests load this file; in the browser it is a plain script
