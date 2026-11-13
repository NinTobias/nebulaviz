const test = require('node:test'), assert = require('node:assert/strict');
const { readID3 } = require('../id3.js');

const enc = s => Buffer.from(s, 'latin1');
const ss = n => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
const be = n => Buffer.from([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(60, 7)]);
const u16 = s => Buffer.concat([Buffer.from([1, 0xFF, 0xFE]), Buffer.from(s, 'utf16le'), Buffer.from([0, 0])]);
const u8 = s => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
const l1 = s => Buffer.concat([Buffer.from([0]), enc(s)]);
function frame(v, id, data) {
  if (v === 2) return Buffer.concat([enc(id), Buffer.from([data.length >> 16, (data.length >> 8) & 255, data.length & 255]), data]);
  return Buffer.concat([enc(id), v === 3 ? be(data.length) : ss(data.length), Buffer.from([0, 0]), data]);
}
const tag = (v, frames) => { const b = Buffer.concat(frames); return Buffer.concat([enc('ID3'), Buffer.from([v, 0, 0]), ss(b.length), b]); };

test('ID3v2.4: UTF-8 and UTF-16 text, year from a full date, track "3/12", embedded cover with a wrong MIME type', () => {
  const t = tag(4, [
    frame(4, 'TIT2', u8('Café del Mar')), frame(4, 'TPE1', u16('Ärtist')), frame(4, 'TDRC', u8('2021-05-04')), frame(4, 'TRCK', u8('3/12')),
    frame(4, 'TCON', u8('(13)')),
    frame(4, 'APIC', Buffer.concat([Buffer.from([0]), enc('image/jpg'), Buffer.from([0, 3]), enc('desc'), Buffer.from([0]), png]))]);
  const r = readID3(Buffer.concat([t, Buffer.alloc(100)]));
  assert.equal(r.title, 'Café del Mar'); assert.equal(r.artist, 'Ärtist'); assert.equal(r.year, '2021'); assert.equal(r.track, '3');
  assert.equal(r.genre, undefined, 'a bare numeric genre code is not shown');
  assert.equal(r.cover.mime, 'image/png', 'the real image type is sniffed from the bytes'); assert.equal(r.cover.data.length, png.length);
});

test('ID3v2.3 Latin-1 text with padding', () => {
  const t = tag(3, [frame(3, 'TIT2', l1('Song')), frame(3, 'TALB', l1('Album')), frame(3, 'TYER', l1('1999')), frame(3, 'TCON', l1('Rock'))]);
  assert.deepEqual(readID3(Buffer.concat([t, Buffer.alloc(50)])), { title: 'Song', album: 'Album', year: '1999', genre: 'Rock' });
});

test('ID3v2.2 three-letter frames and PIC', () => {
  const t = tag(2, [frame(2, 'TT2', l1('Old')), frame(2, 'TP1', l1('Band')), frame(2, 'PIC', Buffer.concat([Buffer.from([0]), enc('PNG'), Buffer.from([3, 0]), png]))]);
  const r = readID3(t);
  assert.equal(r.title, 'Old'); assert.equal(r.artist, 'Band'); assert.equal(r.cover.mime, 'image/png');
});

test('the front cover wins over other pictures', () => {
  const apic = type => frame(4, 'APIC', Buffer.concat([Buffer.from([0]), enc('image/png'), Buffer.from([0, type]), Buffer.from([0]), png]));
  assert.equal(readID3(tag(4, [apic(0), apic(3)])).cover.type, 3);
});

test('ID3v1 fallback fills only the missing fields', () => {
  const v1 = Buffer.alloc(128); v1.write('TAG'); v1.write('V1 Title', 3); v1.write('V1 Artist', 33); v1.write('V1 Album', 63); v1.write('2005', 93); v1[125] = 0; v1[126] = 9;
  assert.deepEqual(readID3(Buffer.concat([Buffer.alloc(500, 1), v1])), { title: 'V1 Title', artist: 'V1 Artist', album: 'V1 Album', year: '2005', track: '9' });
  const mixed = Buffer.concat([tag(3, [frame(3, 'TIT2', l1('V2 Title'))]), Buffer.alloc(300, 1), v1]);
  const r = readID3(mixed); assert.equal(r.title, 'V2 Title'); assert.equal(r.artist, 'V1 Artist');
});

test('garbage, truncated and empty input never throw', () => {
  assert.deepEqual(readID3(Buffer.alloc(10, 1)), {});
  assert.deepEqual(readID3(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x10TIT2')), {});
  assert.deepEqual(readID3(new ArrayBuffer(0)), {});
});

// --- real-world edge cases ---
const u16be = s => Buffer.concat([Buffer.from([1, 0xFE, 0xFF]), Buffer.from(s, 'utf16le').swap16(), Buffer.from([0, 0])]);
// a v2.4 frame whose flags say "unsynchronised": every 0xFF in the data is followed by a 0x00 on disk
function frame24Flags(id, data, flags2) {
  return Buffer.concat([enc(id), ss(data.length), Buffer.from([0, flags2]), data]);
}

test('ID3v2.4: UTF-16 big-endian with a byte-order mark', () => {
  const r = readID3(tag(4, [frame(4, 'TIT2', u16be('Großer Titel')), frame(4, 'TPE1', u16be('Künstler'))]));
  assert.equal(r.title, 'Großer Titel'); assert.equal(r.artist, 'Künstler');
});

test('ID3v2.4: an unsynchronised frame is decoded back to its real bytes', () => {
  // real text: "A", 0xFF, "B"  (encoded as Latin-1, so 0xFF is a sync-like byte that gets a 0x00 inserted on disk)
  const onDisk = Buffer.from([0x00, 0x41, 0xFF, 0x00, 0x42]);
  const r = readID3(tag(4, [frame24Flags('TIT2', onDisk, 0x02)]));
  assert.equal(r.title, 'A\u00FFB');
});

test('ID3v2.4: compressed and encrypted frames are skipped, the rest still reads', () => {
  const compressed = frame24Flags('TPE1', Buffer.from([0x00, 0x58, 0x58]), 0x08);
  const encrypted = frame24Flags('TALB', Buffer.from([0x00, 0x58]), 0x04);
  const r = readID3(tag(4, [compressed, encrypted, frame(4, 'TIT2', l1('Still here'))]));
  assert.deepEqual(r, { title: 'Still here' });
});

test('genre: numeric codes are dropped, "(17)Rock" becomes "Rock", several values are joined', () => {
  assert.equal(readID3(tag(3, [frame(3, 'TCON', l1('(17)Rock'))])).genre, 'Rock');
  assert.equal(readID3(tag(3, [frame(3, 'TCON', l1('(17)'))])).genre, undefined);
  assert.equal(readID3(tag(4, [frame(4, 'TCON', u8('Rock\0Pop'))])).genre, 'Rock, Pop');
});

test('several artists separated by a null byte are joined with ", "', () => {
  assert.equal(readID3(tag(4, [frame(4, 'TPE1', u8('Alpha\0Beta'))])).artist, 'Alpha, Beta');
});

test('ID3v2.3 extended header is skipped before the frames', () => {
  const ext = Buffer.from([0, 0, 0, 6, 0, 0, 0, 0, 0, 0]);   // size (6), flags, padding
  const body = Buffer.concat([ext, frame(3, 'TIT2', l1('After ext'))]);
  const t = Buffer.concat([enc('ID3'), Buffer.from([3, 0, 0x40]), ss(body.length), body]);
  assert.equal(readID3(t).title, 'After ext');
});

test('ID3v2.4 extended header (synchsafe size) is skipped before the frames', () => {
  const ext = Buffer.from([0, 0, 0, 6, 1, 0]);               // synchsafe size 6 (includes itself), one flag byte
  const body = Buffer.concat([ext, frame(4, 'TIT2', l1('After ext 4'))]);
  const t = Buffer.concat([enc('ID3'), Buffer.from([4, 0, 0x40]), ss(body.length), body]);
  assert.equal(readID3(t).title, 'After ext 4');
});

test('a tag that claims more bytes than the file holds still returns what is there', () => {
  const t = tag(4, [frame(4, 'TIT2', l1('Short'))]);
  t.writeUInt8(0x7F, 9);   // claim a much larger tag size
  assert.equal(readID3(t).title, 'Short');
});

test('ID3v2.3 tag-level unsynchronisation (header flag) is undone before the frames are read', () => {
  // decoded text is "A", 0xFF, "B"; on disk a 0x00 follows every 0xFF in the tag body, which splits the text if it is not undone
  const decoded = frame(3, 'TIT2', l1('A\xFFB'));
  const onDisk = []; for (const b of decoded) { onDisk.push(b); if (b === 0xFF) onDisk.push(0); }
  const t = Buffer.concat([enc('ID3'), Buffer.from([3, 0, 0x80]), ss(onDisk.length), Buffer.from(onDisk)]);
  assert.equal(readID3(t).title, 'A\u00FFB');
});
