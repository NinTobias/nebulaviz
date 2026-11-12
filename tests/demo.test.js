const test = require('node:test'), assert = require('node:assert/strict');
const { renderDemoTrack } = require('../demo.js');

const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
// energy at one frequency (Goertzel), to confirm the layers really are in the audio
function goertzel(a, from, to, f, sr) {
  const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s = a[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (to - from);
}

test('demo track: right length, finite, not clipping, stereo', () => {
  const d = renderDemoTrack(44100);
  assert.ok(d.duration > 30 && d.duration < 33, `duration ${d.duration}`);
  assert.equal(d.left.length, d.right.length);
  let peak = 0;
  for (let i = 0; i < d.left.length; i++) { assert.ok(Number.isFinite(d.left[i]) && Number.isFinite(d.right[i])); peak = Math.max(peak, Math.abs(d.left[i]), Math.abs(d.right[i])); }
  assert.ok(peak > 0.5 && peak <= 1, `peak ${peak}`);
  assert.ok(Math.abs(rms(d.left, 0, d.left.length) - rms(d.right, 0, d.right.length)) < 0.05, 'channels are balanced');
});

test('demo track builds up: the intro is sparser than the full section', () => {
  const d = renderDemoTrack(44100), sr = d.sampleRate, bar = Math.round(4 * 60 / d.bpm * sr);
  const intro = [0, 4 * bar], full = [12 * bar, 15 * bar];
  assert.ok(rms(d.left, ...full) > rms(d.left, ...intro) * 1.15, 'more layers = more energy');
  assert.ok(goertzel(d.left, ...full, 6000, sr) > goertzel(d.left, ...intro, 6000, sr) * 2, 'hats appear in the high end');
  assert.ok(goertzel(d.left, ...full, 55, sr) > 0.001, 'bass and kick are present in the low end');
});

test('demo track is deterministic', () => {
  const a = renderDemoTrack(22050), b = renderDemoTrack(22050);
  assert.deepEqual(Array.from(a.left.slice(10000, 10010)), Array.from(b.left.slice(10000, 10010)));
});
