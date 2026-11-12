// Built-in demo track: a ~31 s synthesized tune (kick, hats, clap, bass, arpeggio, pad) so a first-time visitor
// sees the visualizer move without needing a song. Rendered in code: no audio file ships with the project.
function renderDemoTrack(sampleRate = 44100) {
  const sr = sampleRate, BPM = 124, beat = 60 / BPM, BARS = 16, bar = 4 * beat;
  const n = Math.ceil(BARS * bar * sr);
  const dL = new Float32Array(n), dR = new Float32Array(n);   // drums
  const mL = new Float32Array(n), mR = new Float32Array(n);   // music (bass, arp, pad): ducked by the kick afterwards

  let seed = 20240607;   // deterministic noise, so the demo is identical on every machine
  const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const noise = () => rnd() * 2 - 1;
  const TAU = Math.PI * 2;

  // render fn(t) for `len` seconds starting at `start`, panned 0 (left) .. 1 (right)
  const put = (A, B, start, len, fn, pan = 0.5) => {
    const s0 = Math.floor(start * sr), cnt = Math.floor(len * sr), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    for (let k = 0; k < cnt && s0 + k < n; k++) { const v = fn(k / sr); A[s0 + k] += v * gl; B[s0 + k] += v * gr; }
  };

  const kick = t0 => { let ph = 0; put(dL, dR, t0, 0.38, t => { ph += TAU * (42 + 130 * Math.exp(-t * 30)) / sr; return Math.sin(ph) * Math.exp(-t * 7.5) * 0.95 + (t < 0.004 ? noise() * 0.3 : 0); }); };
  const hat = (t0, open) => { let prev = 0; put(dL, dR, t0, open ? 0.2 : 0.05, t => { const x = noise(), v = x - prev; prev = x; return v * Math.exp(-t * (open ? 18 : 70)) * (open ? 0.16 : 0.11); }, 0.62); };
  const clap = t0 => put(dL, dR, t0, 0.3, t => (noise() * 0.5 * Math.exp(-t * 20) + Math.sin(TAU * 185 * t) * Math.exp(-t * 25) * 0.5) * 0.4, 0.45);
  const crash = t0 => { let prev = 0; put(dL, dR, t0, 1.6, t => { const x = noise(), v = x - prev; prev = x; return v * Math.exp(-t * 2.6) * 0.1 * Math.min(1, t * 40); }, 0.5); };

  const ROOTS = [55, 43.654, 65.406, 49];   // A1 F1 C2 G1 (Am - F - C - G)
  const CHORDS = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  const bassNote = (t0, f, len) => { let ph = 0; put(mL, mR, t0, len, t => { ph += TAU * f / sr; let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(h * ph) / h; return v * Math.min(1, t * 200) * Math.exp(-t * 4.5) * 0.45; }, 0.5); };
  const arpNote = (t0, f, pan) => { let ph = 0; put(mL, mR, t0, 0.24, t => { ph += TAU * f / sr; return (Math.sin(ph) + 0.35 * Math.sin(3 * ph) + 0.15 * Math.sin(5 * ph)) * Math.min(1, t * 300) * Math.exp(-t * 13) * 0.17; }, pan); };
  const pad = (t0, freqs) => freqs.forEach((f, i) => { let p1 = 0, p2 = 0; put(mL, mR, t0, bar, t => { p1 += TAU * f * 0.996 / sr; p2 += TAU * f * 1.004 / sr; return (Math.sin(p1) + Math.sin(p2)) * Math.min(1, t / 0.5) * Math.min(1, (bar - t) / 0.4) * 0.07; }, 0.3 + i * 0.2); });

  const ARP = [0, 1, 2, 1];
  for (let b = 0; b < BARS; b++) {
    const t0 = b * bar, ci = b % 4;
    for (let k = 0; k < 4; k++) kick(t0 + k * beat);                                                            // four on the floor, the whole tune
    if (b >= 2) for (let k = 0; k < 4; k++) hat(t0 + (k + 0.5) * beat, true);                                    // open hats on the offbeat
    if (b >= 4) for (let k = 0; k < 16; k++) if (k % 2) hat(t0 + k * beat / 4, false);                           // busy 16th hats
    if (b >= 8) { clap(t0 + beat); clap(t0 + 3 * beat); }                                                         // clap on 2 and 4
    if (b === 8 || b === 12) crash(t0);
    if (b >= 4) for (let k = 0; k < 4; k++) bassNote(t0 + (k + 0.5) * beat, ROOTS[ci], beat * 0.45);              // offbeat bass
    if (b >= 4) for (let k = 0; k < 16; k++) arpNote(t0 + k * beat / 4, CHORDS[ci][ARP[k % 4]] * (k % 8 < 4 ? 1 : 2), k % 2 ? 0.35 : 0.65);
    if (b >= 8) pad(t0, CHORDS[ci]);
  }

  // mix: the music ducks on every beat (sidechain pump), then normalise, soft-clip and fade the last 1.5 s
  const L = new Float32Array(n), R = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const duck = 1 - 0.75 * Math.exp(-((i / sr) % beat) * 9);
    L[i] = dL[i] + mL[i] * duck; R[i] = dR[i] + mR[i] * duck;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.9 / peak, fade = Math.floor(1.5 * sr);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    L[i] = Math.tanh(L[i] * g * 1.2) / Math.tanh(1.2) * f; R[i] = Math.tanh(R[i] * g * 1.2) / Math.tanh(1.2) * f;
  }
  return { left: L, right: R, sampleRate: sr, duration: n / sr, bpm: BPM };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { renderDemoTrack };   // lets the Node tests load this file; in the browser it is a plain script
