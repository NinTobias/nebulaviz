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
