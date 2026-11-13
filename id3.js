// --- ID3 tags (MP3 and friends): title, artist, album, year, track, genre and embedded cover art. Supports ID3v1 and ID3v2.2 / 2.3 / 2.4. ---
const ID3_TEXT = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TDRC: 'year', TYER: 'year', TYE: 'year', TRCK: 'track', TRK: 'track', TCON: 'genre', TCO: 'genre' };
const id3Sync = (u, i) => (u[i] & 127) << 21 | (u[i + 1] & 127) << 14 | (u[i + 2] & 127) << 7 | (u[i + 3] & 127);
const id3Unsync = u => { const o = []; for (let i = 0; i < u.length; i++) { o.push(u[i]); if (u[i] === 255 && u[i + 1] === 0) i++; } return Uint8Array.from(o); };
function id3Term(b, from, enc) {   // index of the string terminator at or after `from` (-1 if none); UTF-16 terminators are two aligned zero bytes
  if (enc === 1 || enc === 2) { for (let i = from; i + 1 < b.length; i += 2) if (!b[i] && !b[i + 1]) return i; return -1; }
  return b.indexOf(0, from);
}
function id3Str(b, enc) {   // decode one string, honouring the byte-order mark of UTF-16
  let label = 'iso-8859-1';
  if (enc === 3) label = 'utf-8';
  else if (enc === 1 || enc === 2) {
    label = enc === 2 ? 'utf-16be' : 'utf-16le';
    if (b[0] === 0xFE && b[1] === 0xFF) { label = 'utf-16be'; b = b.subarray(2); }
    else if (b[0] === 0xFF && b[1] === 0xFE) { label = 'utf-16le'; b = b.subarray(2); }
  }
  return new TextDecoder(label).decode(b).replace(/\0+$/, '').trim();
}
function id3Strings(b, enc) {   // a text frame holds one or more terminated strings
  const out = []; let p = 0;
  while (p < b.length) {
    let e = id3Term(b, p, enc); if (e < 0) e = b.length;
    const s = id3Str(b.subarray(p, e), enc); if (s) out.push(s);
    p = e + (enc === 1 || enc === 2 ? 2 : 1);
  }
  return out;
}
function id3Image(d) {   // sniff the real image type; embedded files often declare the wrong one
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png';
  if (d[0] === 0xFF && d[1] === 0xD8) return 'image/jpeg';
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return 'image/gif';
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46) return 'image/webp';
  return '';
}
function id3Picture(f, v) {   // APIC (v2.3/2.4) or PIC (v2.2) frame -> { data, mime, type }
  const enc = f[0]; let p = 1;
  if (v === 2) p += 3; else { const e = f.indexOf(0, p); if (e < 0) return null; p = e + 1; }   // image format / MIME type
  const type = f[p++];
  const e = id3Term(f, p, enc); if (e < 0) return null;   // description, not needed
  p = e + (enc === 1 || enc === 2 ? 2 : 1);
  const data = f.slice(p), mime = id3Image(data);
  return mime && data.length > 32 ? { data, mime, type } : null;
}
function readID3v2(u, out) {
  if (u.length < 10 || u[0] !== 0x49 || u[1] !== 0x44 || u[2] !== 0x33) return;   // "ID3"
  const v = u[3], fl = u[5];
  if (v < 2 || v > 4 || (v === 2 && fl & 0x40)) return;   // unknown version, or compressed v2.2 (never used in practice)
  let body = u.subarray(10, Math.min(u.length, 10 + id3Sync(u, 6)));
  if (v < 4 && fl & 0x80) body = id3Unsync(body);
  let p = 0;
  if (fl & 0x40) p = v === 3 ? 4 + ((body[0] << 24 | body[1] << 16 | body[2] << 8 | body[3]) >>> 0) : id3Sync(body, 0);   // extended header
  const hdr = v === 2 ? 6 : 10;
  while (p + hdr <= body.length && body[p] !== 0) {
    const id = String.fromCharCode(...body.subarray(p, p + (v === 2 ? 3 : 4)));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = v === 2 ? body[p + 3] << 16 | body[p + 4] << 8 | body[p + 5] : v === 3 ? (body[p + 4] << 24 | body[p + 5] << 16 | body[p + 6] << 8 | body[p + 7]) >>> 0 : id3Sync(body, p + 4);
    const f2 = v === 2 ? 0 : body[p + 9];
    const start = p + hdr; p = start + size;
    if (p > body.length) break;
    if (v === 3 ? f2 & 0xC0 : f2 & 0x0C) continue;   // compressed or encrypted frame: skip
    let d = body.subarray(start, p);
    if (v === 3 && f2 & 0x20) d = d.subarray(1);   // grouping byte
    if (v === 4) {
      if (f2 & 0x40) d = d.subarray(1);                      // grouping byte
      if (f2 & 0x01) d = d.subarray(4);                      // data length indicator
      if (f2 & 0x02 || fl & 0x80) d = id3Unsync(d);          // unsynchronised frame
    }
    if (!d.length) continue;
    if (ID3_TEXT[id]) {
      const key = ID3_TEXT[id];
      if (out[key]) continue;
      const s = id3Strings(d.subarray(1), d[0]);
      if (!s.length) continue;
      let val = key === 'year' ? s[0].slice(0, 4) : key === 'track' ? s[0].split('/')[0].trim()
        : key === 'genre' ? s.join(', ').replace(/^\(\d+\)/, '').trim() : s.join(', ');
      if (key === 'genre' && /^\d+$/.test(val)) val = '';   // bare numeric genre codes aren't meaningful
      if (val) out[key] = val;
    } else if (id === 'APIC' || id === 'PIC') {
      const pic = id3Picture(d, v);
      if (pic && (!out.cover || (pic.type === 3 && out.cover.type !== 3))) out.cover = pic;   // prefer the front cover
    }
  }
}
function readID3v1(u, out) {   // fixed 128-byte block at the very end, used as a fallback for missing fields
  if (u.length < 128) return;
  const t = u.length - 128;
  if (u[t] !== 0x54 || u[t + 1] !== 0x41 || u[t + 2] !== 0x47) return;   // "TAG"
  const s = (a, n) => new TextDecoder('iso-8859-1').decode(u.subarray(t + a, t + a + n)).replace(/[\0\s]+$/, '');
  if (!out.title && s(3, 30)) out.title = s(3, 30);
  if (!out.artist && s(33, 30)) out.artist = s(33, 30);
  if (!out.album && s(63, 30)) out.album = s(63, 30);
  if (!out.year && /^\d{4}$/.test(s(93, 4))) out.year = s(93, 4);
  if (!out.track && u[t + 125] === 0 && u[t + 126]) out.track = String(u[t + 126]);
}
function readID3(ab) {   // never throws: a damaged tag just means no metadata
  const u = new Uint8Array(ab), out = {};
  try { readID3v2(u, out); } catch (e) { console.warn('ID3v2 tag could not be read', e); }
  try { readID3v1(u, out); } catch (e) { console.warn('ID3v1 tag could not be read', e); }
  return out;
}

// --- FLAC tags: Vorbis comments (title, artist, album, date, track, genre) and the PICTURE block (cover art). Same result shape as readID3. ---
const FLAC_KEYS = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track', TRACK: 'track', GENRE: 'genre' };
function flacComments(b, out) {   // one VORBIS_COMMENT block (little-endian lengths); the first value of each field wins
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 4 + dv.getUint32(0, true);   // skip the vendor string
  const n = dv.getUint32(p, true); p += 4;
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const len = dv.getUint32(p, true); p += 4;
    if (p + len > b.length) break;
    const s = new TextDecoder('utf-8').decode(b.subarray(p, p + len)); p += len;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const key = FLAC_KEYS[s.slice(0, eq).trim().toUpperCase()]; if (!key || out[key]) continue;
    let val = s.slice(eq + 1).trim();
    if (key === 'year') { if (!/^\d{4}/.test(val)) continue; val = val.slice(0, 4); }
    else if (key === 'track') val = val.split('/')[0].trim();
    else if (key === 'genre' && /^\d+$/.test(val)) continue;   // bare numeric genre codes aren't meaningful
    if (val) out[key] = val;
  }
}
function flacPicture(b) {   // one PICTURE block (big-endian): { data, mime, type }, or null when the image is not PNG / JPEG / GIF / WebP
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = dv.getUint32(0);
  let p = 8 + dv.getUint32(4);                  // MIME type
  p += 4 + dv.getUint32(p);                     // description
  p += 16;                                      // width, height, colour depth, colour count
  const n = dv.getUint32(p); p += 4;
  if (p + n > b.length) return null;
  const data = b.slice(p, p + n), mime = id3Image(data);
  return mime && data.length > 32 ? { data, mime, type } : null;
}
function readFlacTags(ab) {   // never throws: a damaged block just means no metadata from it
  const out = {};
  try {
    const u = new Uint8Array(ab);
    if (u.length < 8 || u[0] !== 0x66 || u[1] !== 0x4C || u[2] !== 0x61 || u[3] !== 0x43) return out;   // "fLaC"
    let p = 4;
    while (p + 4 <= u.length) {
      const type = u[p] & 127, last = u[p] & 128, len = u[p + 1] << 16 | u[p + 2] << 8 | u[p + 3];
      p += 4;
      if (p + len > u.length) break;            // truncated block
      const b = u.subarray(p, p + len);
      try {
        if (type === 4) flacComments(b, out);
        else if (type === 6) { const pic = flacPicture(b); if (pic && (!out.cover || (pic.type === 3 && out.cover.type !== 3))) out.cover = pic; }   // prefer the front cover
      } catch (e) { console.warn('FLAC block could not be read', e); }
      p += len;
      if (last) break;
    }
  } catch (e) { console.warn('FLAC tags could not be read', e); }
  return out;
}
function readTags(ab) {   // any supported file: FLAC (also when an ID3 header sits in front of it), otherwise ID3
  const u = new Uint8Array(ab);
  if (u.length >= 14 && u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) {   // "ID3" header first
    const at = 10 + id3Sync(u, 6);
    if (at + 4 <= u.length && u[at] === 0x66 && u[at + 1] === 0x4C && u[at + 2] === 0x61 && u[at + 3] === 0x43)
      return Object.assign(readID3(ab), readFlacTags(ab.slice(at)));
  }
  if (u.length >= 4 && u[0] === 0x66 && u[1] === 0x4C && u[2] === 0x61 && u[3] === 0x43) return readFlacTags(ab);
  return readID3(ab);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { readID3, readFlacTags, readTags };   // lets the Node tests load this file; in the browser it is a plain script