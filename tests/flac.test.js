const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { readID3, readFlacTags, readTags } = require('../id3.js');

// helpers: build FLAC metadata blocks by hand
const be32 = n => Buffer.from([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = n => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const block = (type, data, last = false) => Buffer.concat([Buffer.from([(last ? 128 : 0) | type, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255]), data]);
const streaminfo = (last = false) => block(0, Buffer.alloc(34, 1), last);
function vorbis(fields, vendor = 'test vendor') {
  const parts = [le32(Buffer.byteLength(vendor)), Buffer.from(vendor), le32(fields.length)];
  for (const f of fields) { const b = Buffer.from(f, 'utf8'); parts.push(le32(b.length), b); }
  return Buffer.concat(parts);
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(60, 7)]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(60, 9)]);
function picture(type, img, mime = 'image/jpeg') {   // mime can be wrong on purpose: the bytes decide
  const m = Buffer.from(mime);
  return Buffer.concat([be32(type), be32(m.length), m, be32(0), be32(300), be32(300), be32(24), be32(0), be32(img.length), img]);
}
const flac = (...blocks) => Buffer.concat([Buffer.from('fLaC'), ...blocks]);
const ab = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);

test('Vorbis comments: title, artist, album, year from a full date, track "3/12", genre', () => {
  const f = flac(streaminfo(), block(4, vorbis(['TITLE=Café del Mar', 'ARTIST=Ärtist', 'ALBUM=Album', 'DATE=2021-05-04', 'TRACKNUMBER=3/12', 'GENRE=Ambient']), true));
  assert.deepEqual(readFlacTags(ab(f)), { title: 'Café del Mar', artist: 'Ärtist', album: 'Album', year: '2021', track: '3', genre: 'Ambient' });
});

test('field names are case-insensitive, the first value of a field wins, bare numeric genres are dropped', () => {
  const f = flac(streaminfo(), block(4, vorbis(['title=First', 'TITLE=Second', 'artist=Band', 'GENRE=12', 'YEAR=1999', 'DATE=nonsense']), true));
  const r = readFlacTags(ab(f));
  assert.equal(r.title, 'First'); assert.equal(r.artist, 'Band'); assert.equal(r.year, '1999'); assert.equal(r.genre, undefined);
});

test('the front cover wins over other pictures, and a wrong MIME type is corrected from the bytes', () => {
  const f = flac(streaminfo(), block(6, picture(0, JPG, 'image/png')), block(6, picture(3, PNG, 'image/jpeg'), true));
  const r = readFlacTags(ab(f));
  assert.equal(r.cover.type, 3); assert.equal(r.cover.mime, 'image/png'); assert.equal(r.cover.data.length, PNG.length);
});

test('a picture that is not an image is ignored', () => {
  const f = flac(streaminfo(), block(6, picture(3, Buffer.alloc(100, 1)), true));
  assert.equal(readFlacTags(ab(f)).cover, undefined);
});

test('parsing stops at the block marked as last', () => {
  const f = flac(streaminfo(), block(4, vorbis(['TITLE=Real']), true), block(4, vorbis(['ARTIST=Fake'])));
  assert.deepEqual(readFlacTags(ab(f)), { title: 'Real' });
});

test('padding and other unknown blocks are skipped', () => {
  const f = flac(streaminfo(), block(1, Buffer.alloc(40)), block(3, Buffer.alloc(18)), block(4, vorbis(['TITLE=After padding']), true));
  assert.equal(readFlacTags(ab(f)).title, 'After padding');
});

test('a truncated file keeps the blocks that were complete and never throws', () => {
  const full = flac(streaminfo(), block(4, vorbis(['TITLE=Kept']), false), block(6, picture(3, PNG), true));
  const cut = full.subarray(0, full.length - 30);   // cut inside the picture
  assert.equal(readFlacTags(ab(cut)).title, 'Kept');
  assert.equal(readFlacTags(ab(cut)).cover, undefined);
});

test('damaged or empty input never throws', () => {
  assert.deepEqual(readFlacTags(ab(Buffer.from('fLaC'))), {});
  assert.deepEqual(readFlacTags(ab(Buffer.alloc(0))), {});
  assert.deepEqual(readFlacTags(ab(Buffer.from('not a flac file at all'))), {});
  assert.doesNotThrow(() => readFlacTags(ab(flac(block(4, Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]), true)))));
  assert.doesNotThrow(() => readTags(ab(Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]))));
});

test('readTags picks FLAC for "fLaC" files and ID3 for everything else', () => {
  const f = flac(streaminfo(), block(4, vorbis(['TITLE=From FLAC']), true));
  assert.equal(readTags(ab(f)).title, 'From FLAC');
  // an ID3v2.3 tag with one text frame (TIT2 = "ID3 Title", encoding 0 = Latin-1)
  const text = Buffer.from('\u0000ID3 Title');
  const frame = Buffer.concat([Buffer.from('TIT2'), be32(text.length), Buffer.from([0, 0]), text]);
  const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]), Buffer.from([0, 0, 0, frame.length]), frame]);
  assert.equal(readID3(ab(id3)).title, 'ID3 Title');
  assert.equal(readTags(ab(id3)).title, 'ID3 Title');
});

test('a FLAC stream behind an ID3 header is read too, and FLAC values win', () => {
  const id3Head = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]), Buffer.from([0, 0, 0, 0])]);   // an empty ID3 tag
  const f = Buffer.concat([id3Head, flac(streaminfo(), block(4, vorbis(['TITLE=Behind ID3', 'ARTIST=Artist']), true))]);
  const r = readTags(ab(f));
  assert.equal(r.title, 'Behind ID3'); assert.equal(r.artist, 'Artist');
});

test('a real FLAC file from an encoder (tests/fixtures/tagged.flac) gives its tags and cover', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'tagged.flac'));
  const r = readTags(ab(buf));
  assert.equal(r.title, 'Café del Mar'); assert.equal(r.artist, 'Ärtist'); assert.equal(r.album, 'Test Album');
  assert.equal(r.year, '2021'); assert.equal(r.track, '3'); assert.equal(r.genre, 'Ambient');
  assert.equal(r.cover.mime, 'image/png');
});
