const N = 63, X0 = 175, X1 = 1745, BASE = 543, MINH = 3, MAXH = 375;
const M = {
  f0: 20.9, f1: 13700, p: 0.572, tau: 0.471, wmax: 0.502, tilt: 4.40, cap: 15.94, agcmin: 0.1196, agcdec: 0.9995,
  floor: 0.0331, gamma: 1.529, att: 0.516, dec: 0.2844, sw: 0.2345, fp: 101.9, ltilt: -3.56
};
const DTV = 1001 / 30000;
const LEAD = 0 * 10 * DTV;
// Frequency range group: these start at the original M values, so the default look is unchanged. applyBands() copies them into M.
const bandCfg = { lo: M.f0, hi: M.f1, spacing: 0, tilt: M.tilt, pivot: M.fp, cap: M.cap, lowCut: -M.ltilt, smooth: M.sw, attack: M.att, decay: M.dec, floor: M.floor, gamma: M.gamma };
const BAND_DEFAULTS = { ...bandCfg };
let bassN = 15;   // how many of the lowest bars count as "bass" for the pulses and star boost (recomputed from the range in layout)
// Lower edge of bar i (i = N gives the top edge). Spacing 0 = logarithmic (the original), 1 = linear; in between blends the two.
function bandEdge(i, f1 = M.f1) {
  const lg = M.f0 * Math.pow(f1 / M.f0, i / N), ln = M.f0 + (f1 - M.f0) * i / N;
  return lg + (ln - lg) * bandCfg.spacing;
}
let sens = 1, agc = M.agcmin, asrc = null, lastT = performance.now();
const raw = new Float32Array(N), sm2 = new Float32Array(N);
let lo = [], hi = [], fcs = [], gains = [], hz = 1, kmax = 0, sm, amp;
const cv = document.getElementById('c'), g = cv.getContext('2d');
const $ = id => document.getElementById(id);
let ctx, analyser, buf, src, startedAt = 0, offset = 0, playing = false, freq;
// Live input: audio captured from a shared browser tab or the system. It feeds the same analyser as a song; it is not played
// back here, because the shared source already plays on its own.
let liveMode = false, liveSrc = null, liveStream = null;
const isActive = () => playing || liveMode;   // the visuals run while a song plays or live input is on
let coverImg = null, backgroundImg = null, flash = 0;
let coverSpot = null;   // where the cover is drawn on the 1920x1080 canvas (unpulsed), so a dropped image can land on it
let beatAvg = 0, beatPeak = 1e-6, beatClock = 0, lastBeat = -9, beatK0 = 1, beatK1 = 2, beatStrength = 1, lastBurst = -9;   // beat detector state
let visualColor = '#f2d90a', gradientColor = '#ff6a00', useGradient = false, backgroundColor = '#000000';
let backgroundEndColor = '#1a0b3d', useBgGradient = false, bgAngle = 180;
let vizMode = 'bars', circRadius = 200, circCount = 90, circWidth = 5, circLength = 190, mirCount = 63, dotsCount = 63, dotsPeak = true;
let waveWidth = 6, waveFill = 0.3, waveGlow = 1, waveDetail = 126, ridgeRows = 14, ridgeStep = 20, ridgeAmp = 175, ridgeLine = 1;   // Smooth Wave / Ridgeline options
let barShape = 'rect', barRound = 4, barGap = 7, glowBlur = 24, glowBars = 0, glowCover = 0, glowText = 0;
const MODES = ['bars', 'circular', 'mirrored', 'wave', 'wavemir', 'dots', 'ridge'];
const textCfg = { on: true, font: 'montserrat', weight: 'default', size: 100, space: 0, align: 'auto', x: 0, y: 0, color: '#ffffff', match: false, shOp: 0, shBlur: 8, shX: 3, shY: 3, shColor: '#000000' };
const coverCfg = { on: true, shape: 'square', fit: 'crop', size: 100, x: 0, y: 0, radius: 15, opacity: 1, attach: true, bw: 0, bcolor: '#ffffff', bmatch: false, shOp: 0, shBlur: 12, shX: 0, shY: 6, shColor: '#000000', note: true, noteColor: '#ffffff' };
const coverBuf = document.createElement('canvas'), bx = coverBuf.getContext('2d');   // the cover is drawn here first (clipped to its shape), then composited with opacity / shadow / glow
function coverShapePath(x, y, s) {   // outline of the cover in its current shape, at (x, y) with side s
  const p = new Path2D(), sh = coverCfg.shape;
  if (sh === 'circle') p.arc(x + s / 2, y + s / 2, s / 2, 0, 6.283185);
  else if (sh === 'squircle') {   // superellipse |x|^4 + |y|^4 = 1
    const h = s / 2, K = 96;
    for (let i = 0; i < K; i++) {
      const t = i / K * 6.283185, c = Math.cos(t), n = Math.sin(t);
      const px = x + h + h * Math.sign(c) * Math.sqrt(Math.abs(c)), py = y + h + h * Math.sign(n) * Math.sqrt(Math.abs(n));
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    }
    p.closePath();
  } else if (sh === 'rounded' && p.roundRect) p.roundRect(x, y, s, s, Math.min(s / 2, coverCfg.radius / 100 * s));
  else p.rect(x, y, s, s);
  return p;
}
const TEXT_FONTS = { montserrat: 'Montserrat, sans-serif', oswald: 'Oswald, sans-serif', bebas: '"Bebas Neue", Impact, sans-serif', playfair: '"Playfair Display", Georgia, serif', orbitron: 'Orbitron, sans-serif', pacifico: 'Pacifico, cursive', arial: 'Arial, Helvetica, sans-serif', georgia: 'Georgia, serif', courier: '"Courier New", Courier, monospace', impact: 'Impact, "Arial Black", sans-serif' };
const TEXT_WEIGHTS = { default: [700, 400], regular: [400, 400], bold: [700, 700], heavy: [800, 800] };   // [artist, title / extra]
const CIRC_CX = 960, CIRC_CY = 430, CIRC_MAX = 410;   // circular layout: ring centred above the bottom text block
const MID = BASE - MAXH / 2;                           // mirrored layout: centre line, same footprint as the normal bars
let cycleSpeed = 15, rainbow = false, rbMove = true, rbDir = 1, rbSpeed = 60, rbOffset = 0, circSym = true;
let volume = 1, muted = false, outGain = null;
let mediaRecorder = null, recDest = null, recChunks = [], recNote = '', expCanvas = null, expCtx = null;
let autoColorCycle = false, colorCycleHue = 52;
let bassPulse = true, pulseAmt = 0.08, bgAudioReactive = false, bgPulseAmt = 0.15, beatNow = false;
const vizCfg = { on: true, x: 0, y: 0, w: 1 };   // position (pixels of the 1920x1080 frame) and horizontal stretch (1 = normal width) of the whole visualizer
let outlineViz = true, outlineCover = true, outlineText = true;   // contrast outlines (see the contrast safety code in the renderer); on by default

// Lock overlay color: uiMain/uiEnd hold the colors the user last SET (picker, hex, preset). Auto color cycling doesn't touch them.
let lockOverlay = false, uiMain = '#f2d90a', uiEnd = '#ff6a00';

const UI_DARK = 90, EDGE = '#8c8c8c';
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const isDark = hex => Math.max(...rgbOf(hex)) < UI_DARK;
const inkFor = hex => {
  const l = rgbOf(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000' : '#fff';
};
const midHex = (a, b) => '#' + rgbOf(a).map((v, i) => Math.round((v + rgbOf(b)[i]) / 2).toString(16).padStart(2, '0')).join('');
const lumHex = hex => { const l = rgbOf(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const hslHex = (h, sat, l) => { l /= 100; const a = sat / 100 * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); };
const RB_SAMPLES = Array.from({ length: 12 }, (_, k) => hslHex(k * 30, 100, 55));   // the rainbow always shows the whole spectrum, so these stand in for it
let bgImgRefs = [];   // representative colors of the background image (dark ... light), computed once when the image is loaded
function sampleBgImage(img) {
  if (!img) { bgImgRefs = []; return; }
  const W = 32, H = 18, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  const sc = Math.max(W / mediaW(img), H / mediaH(img)), w = mediaW(img) * sc, h = mediaH(img) * sc;
  x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  let d; try { d = x.getImageData(0, 0, W, H).data; } catch (e) { bgImgRefs = ['#000000', '#ffffff']; return; }
  const cells = []; for (let i = 0; i < d.length; i += 4) { const hx = '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); cells.push([lumHex(hx), hx]); }
  cells.sort((p, q) => p[0] - q[0]);
  bgImgRefs = [0.03, 0.25, 0.5, 0.75, 0.97].map(p => cells[Math.min(cells.length - 1, Math.floor(p * cells.length))][1]);
}
const crOf = (a, b) => { const x = lumHex(a), y = lumHex(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pickerState = {
  main: { h: 52, s: 0.96, v: 0.95 },
  end: { h: 25, s: 1, v: 1 },
  bg: { h: 0, s: 0, v: 0, hex: '#000000' },
  bgEnd: { h: 258, s: 0.82, v: 0.24, hex: '#1a0b3d' }
};
const PREFIX = { main: 'color', end: 'end', bg: 'bg', bgEnd: 'bgEnd' };
let overlayColors = false;

// Colors the interface (play bar, sliders, checkboxes) is drawn in: white when overlay colors are off,
// otherwise the live main/gradient colors, or the last hand-picked ones while locked.
function uiColors() {
  if (!overlayColors) return ['#ffffff', '#ffffff'];
  const a = lockOverlay ? uiMain : visualColor;
  return [a, useGradient ? (lockOverlay ? uiEnd : gradientColor) : a];
}

const rangeEls = Array.from(document.querySelectorAll('input[type=range]'));
function updateSliders() {
  for (const slider of rangeEls) {
    if (!slider) continue;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const percent = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

    const [c1, c2] = uiColors();
    const activeGrad = `linear-gradient(90deg, ${c1}, ${c2})`;

    slider.style.backgroundImage = `linear-gradient(90deg, #444, #444), ${activeGrad}`;
    slider.style.backgroundSize = `calc((100% - 14px) * ${1 - percent / 100} + 7px) 100%, 100% 100%`;
    slider.style.backgroundPosition = 'right top, left top';
    slider.style.backgroundRepeat = 'no-repeat, no-repeat';
  }
}

function updateOverlayTheme() {
  overlayColors = $('overlayColors').checked;
  $('lockOverlay').disabled = !overlayColors;   // while the interface is plain white there is nothing to lock
  const root = document.documentElement;
  const [a, b] = uiColors();

  root.style.setProperty('--overlay-accent', a);
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-ink', inkFor(a));
  root.style.setProperty('--accent-edge', isDark(a) ? EDGE : 'transparent');
  root.style.setProperty('--overlay-edge', isDark(a) || isDark(b) ? EDGE : 'transparent');
  root.style.setProperty('--overlay-ink', inkFor(a));   // solid fill: one ink color can't be readable across a gradient
  root.style.setProperty('--overlay-fill', a);
  updateSliders();
}
$('overlayColors').onchange = updateOverlayTheme;
$('lockOverlay').onchange = e => { lockOverlay = e.target.checked; updateOverlayTheme(); };
const vals = new Float32Array(N);

const stars = Array.from({ length: 1200 }, () => ({
  x: Math.random() * 1920, y: Math.random() * 1080,
  r: 0.5 + Math.random() * 1.8, k: 0.1 + Math.random() * 0.4,
  c: (Math.random() - 0.5) * 0.15, a: 0.25 + Math.random() * 0.6, t: Math.random()   // t: this star's place in the gradient / rainbow
}));
const starCfg = { on: true, flash: true, count: 240, speed: 1, boost: 8, light: 1, angle: 270, color: 'white' };

function setup() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  const mute = ctx.createGain(); mute.gain.value = 0;
  analyser.connect(mute); mute.connect(ctx.destination);
  freq = new Float32Array(analyser.frequencyBinCount);
  outGain = ctx.createGain(); outGain.connect(ctx.destination); applyVol();
  layout();
}

function layout() {
  hz = ctx.sampleRate / analyser.fftSize;
  const f1 = Math.min(M.f1, ctx.sampleRate / 2 * 0.98);   // never read past the top of what the audio device can carry
  for (let i = 0; i < N; i++) {
    const a = bandEdge(i, f1), b = bandEdge(i + 1, f1);
    lo[i] = Math.floor(a / hz); hi[i] = Math.max(lo[i] + 1, Math.floor(b / hz));
    const fc = Math.sqrt(a * b); fcs[i] = fc;
    const db = fc >= M.fp ? Math.min(M.cap, M.tilt * Math.log2(fc / M.fp)) : M.ltilt * Math.log2(M.fp / fc);
    gains[i] = Math.pow(10, db / 40);
  }
  bassN = Math.max(3, fcs.filter(f => f < 98).length);   // default range: the lowest 15 bars (up to ~98 Hz), as before
  kmax = Math.max(...hi) + 3;
  sm = new Float32Array(kmax); amp = new Float32Array(kmax);
  beatK0 = Math.max(1, Math.floor(30 / hz)); beatK1 = Math.floor(150 / hz) + 1;   // beat detector listens to 30-150 Hz
}

const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', STOP = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
function icon(p) { $('play').innerHTML = p ? STOP : PLAY; $('play').setAttribute('aria-label', p ? 'Pause' : 'Play'); }
icon(false);

function stopAll() { for (const n of [src, asrc]) if (n) { n.onended = null; try { n.stop(); } catch (e) { } } }
function startAt(off) {
  setup();
  stopAll();
  src = ctx.createBufferSource(); src.buffer = buf; src.connect(outGain);
  src.onended = () => { if (playing) { playing = false; offset = 0; icon(false); vals.fill(0); parts.length = 0; stopRecording('Song ended. Video saved.'); advanceAfterEnd(); } };
  src.start(0, off);
  asrc = null;
  if (off + LEAD < buf.duration) { asrc = ctx.createBufferSource(); asrc.buffer = buf; asrc.connect(analyser); asrc.start(0, off + LEAD); }
  sm.fill(0); beatAvg = 0;
  startedAt = ctx.currentTime - off;
  playing = true;
  icon(true);
}

// --- Live input: the audio of a shared browser tab (or the whole system, where the browser allows it) ---
// Chrome and Edge offer tab audio; the picker is shown by the browser every time, and nothing starts without a click.
function setLiveUI(on) {
  const b = $('liveBtn');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.textContent = on ? 'Stop live input' : 'Live input';
  $('seek').disabled = on || !buf;
  $('play').disabled = !on && !buf;   // while live input is on, play stops it
  icon(on || playing);
  $('play').setAttribute('aria-label', on ? 'Stop live input' : playing ? 'Pause' : 'Play');
  syncQueueUI();
}
async function startLive() {
  if (liveMode) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.isSecureContext) { notify('Live input needs a secure page (https or localhost) in a browser that can capture tab audio.', true); return; }
  setup();
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }   // the browser asks which tab or screen to share
  catch (err) { if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') notify('Live input could not start: ' + err.message, true); return; }
  stream.getVideoTracks().forEach(t => t.stop());   // only the audio is used
  const track = stream.getAudioTracks()[0];
  if (!track) { stream.getTracks().forEach(t => t.stop()); notify('No audio was shared. In the picker, choose a tab and tick "Share tab audio" (or choose the entire screen with system audio).', true); return; }
  await ctx.resume();
  if (playing) offset = Math.min(buf.duration, ctx.currentTime - startedAt);   // the song keeps its place
  stopAll(); playing = false; icon(false);
  vals.fill(0); parts.length = 0; sm.fill(0);
  liveStream = stream;
  liveSrc = ctx.createMediaStreamSource(new MediaStream([track]));
  liveSrc.connect(analyser);
  if (recDest) liveSrc.connect(recDest);
  liveMode = true; recSync();
  track.onended = () => stopLive('Sharing stopped. Live input is off.');   // the browser's own "Stop sharing" button
  setLiveUI(true);
  notify('Live input is on. The shared audio drives the visualizer; it keeps playing in its own tab.');
}
function stopLive(msg) {
  if (!liveMode) return;
  liveMode = false;
  try { liveSrc.disconnect(); } catch (e) { }
  if (liveStream) liveStream.getTracks().forEach(t => t.stop());
  liveSrc = null; liveStream = null;
  sm.fill(0); parts.length = 0;
  setLiveUI(false); recSync();
  if (msg) notify(msg);
}
$('liveBtn').onclick = () => { if (liveMode) stopLive('Live input stopped.'); else startLive(); };
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.isSecureContext) {
  $('liveBtn').disabled = true;
  $('liveBtn').title = !window.isSecureContext ? 'Live input needs a secure page (https or localhost)' : 'This browser cannot capture tab audio';
}

let loadGen = 0;
let coverFromTag, autoArtist = null;   // so a new song may replace art / artist that came from the previous song's tags, but never the user's own choices

// Decoded audio lives in memory as 32-bit floats: about 10-20x the size of an MP3 and 2x a 16-bit WAV. A very long file would exhaust the
// browser's memory, so a rough estimate is checked first and the file is refused with a clear message instead of crashing the tab.
function estimateDecodedBytes(f) {
  const ext = (f.name.match(/\.(\w+)$/) || [])[1] || '';
  return f.size * (/^(wav|aiff?)$/i.test(ext) ? 2.2 : /^flac$/i.test(ext) ? 4 : 16);   // PCM / FLAC / lossy (MP3, AAC, OGG, ...)
}
const audioMemoryLimit = () => Math.max(0.4, Math.min(2, (navigator.deviceMemory || 4) * 0.2)) * 1073741824;   // about 0.8 GB on a typical desktop, less on small devices
const fmtMB = b => Math.round(b / 1048576).toLocaleString('en') + ' MB';

// Make a decoded buffer the current song (shared by file loading and the built-in demo)
function installSong(decoded, { gen, title, label, size, tags = {}, edit = {} }) {   // edit = what the user typed for this track (kept on repeat or when coming back to it)
  stopRecording();   // only once the new song is really replacing the old one
  stopLive();
  buf = decoded;
  $('demoBtn').hidden = true;   // the demo link is only an empty-state hint
  $('title').value = 'title' in edit ? edit.title : (tags.title || title);
  if ('artist' in edit) { $('artist').value = edit.artist; autoArtist = null; }
  else if (tags.artist) { $('artist').value = tags.artist; autoArtist = tags.artist; }
  else if (autoArtist !== null) { if ($('artist').value === autoArtist) $('artist').value = DEFAULTS.artist; autoArtist = null; }   // drop the previous song's artist, unless the user edited it
  if (tags.cover) {
    if (!coverImg || coverFromTag) loadImage(new File([tags.cover.data], 'cover', { type: tags.cover.mime }), 'cover', im => {
      if (gen !== loadGen) return;
      coverImg = im; coverFromTag = true; commitHistory();
    });
  } else if (coverFromTag) { coverImg = null; coverFromTag = false; }
  const mm = Math.floor(buf.duration / 60), ss = Math.floor(buf.duration % 60);
  $('songInfo').hidden = false;
  const meta = [tags.artist && tags.title ? `${tags.artist} — ${tags.title}` : tags.title || tags.artist, tags.album, tags.year, tags.track && `Track ${tags.track}`, tags.genre].filter(Boolean).join(' · ');
  $('songInfo').textContent = (meta ? meta + '\n' : '') + `${label} · ${mm}:${String(ss).padStart(2, '0')} · ${(buf.sampleRate / 1000).toFixed(1)} kHz · ${buf.numberOfChannels === 1 ? 'mono' : buf.numberOfChannels === 2 ? 'stereo' : buf.numberOfChannels + ' channels'}${size != null ? ` · ${(size / 1048576).toFixed(1)} MB` : ''}`;
  stopAll();
  playing = false; icon(false); vals.fill(0); parts.length = 0;
  offset = 0; $('play').disabled = false; $('seek').disabled = false;
  $('status').textContent = 'Ready. Press Play or Spacebar.';
  if ($('presetRandomize').checked) randomizeSettings();
  commitHistory();
}

// --- Songs and playlist ---
// The queue is a list of files, not decoded audio: only the playing track is held in memory, so a long playlist costs no extra RAM.
let queue = [], queueIdx = -1;             // queueIdx = the playing track in the queue, -1 when the song is not from the queue
let playlistLoop = false, playlistAuto = true;   // repeat the whole queue / go on to the next track by itself
const isAudioFile = f => !isVideoFile(f) && (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));   // a video (even a .webm) is never a song: it can only be a background
const titleFromName = name => name.replace(/\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|aiff?|webm|mp4)$/i, '');

// Decode queue[i] into the song slot, optionally starting playback. Returns false (after telling the user why) when it could not be loaded.
async function loadTrack(i, autoplay) {
  const entry = queue[i]; if (!entry) return false;
  const f = entry.file, gen = ++loadGen;
  const est = estimateDecodedBytes(f), limit = audioMemoryLimit();
  // Decoded audio lives in memory as 32-bit floats: a very long file would exhaust the browser's memory, so it is refused up front
  if (est > limit) {
    notify(`"${f.name}" is too long to load safely: it would need roughly ${fmtMB(est)} of memory once decoded, and this browser allows about ${fmtMB(limit)}. Try a shorter or smaller file.${buf ? ' Your previous song is still loaded.' : ''}`, true);
    return false;
  }
  setup();
  const prevStatus = $('status').textContent;
  $('status').textContent = queue.length > 1 ? `Loading ${i + 1} of ${queue.length}: ${f.name}…`
    : est > limit * 0.4 ? 'Decoding a large audio file, this can take a moment…' : 'Decoding audio…';
  try {
    const ab = await f.arrayBuffer();
    const tags = readTags(ab);   // read before decoding: decodeAudioData may detach the buffer (MP3 / ID3 and FLAC tags)
    const decoded = await ctx.decodeAudioData(ab);
    if (gen !== loadGen) return false;   // a newer selection started: drop this stale result
    installSong(decoded, { gen, title: titleFromName(f.name), label: f.name, size: f.size, tags, edit: entry.edit || {} });
    queueIdx = queue.indexOf(entry);
    renderQueue();
    if (autoplay) {
      await ctx.resume();
      startAt(0);
      recSync();
      $('status').textContent = `Now playing: ${f.name}`;
    }
    return true;
  } catch (err) {
    if (gen !== loadGen) return false;
    $('status').textContent = buf ? prevStatus : 'No song loaded.';   // failed replacement: the previous song and its status stay as they were
    console.error('Audio decode failed:', { name: f.name, type: f.type || '(unknown)', size: f.size }, err);
    notify(`Could not decode "${f.name}" (${f.type || 'unknown type'}${err && err.message ? ': ' + err.message : ''}). ${buf ? 'Your previous song is still loaded.' : 'No song is loaded.'} Supported formats depend on your browser.${f.size > 30 * 1048576 ? ' Very long files can also run out of memory.' : ''}`, true);
    return false;
  }
}

// Skip, click on a track: stops the current audio at once (so nothing plays over the decode), then plays the target if the song was playing
function skipTo(i) {
  const wasPlaying = playing;
  stopAll(); playing = false; offset = 0; icon(false); vals.fill(0); parts.length = 0;
  recSync();
  loadTrack(i, wasPlaying);
}

// A track played to its end: go on to the next one if the playlist says so (the stop bookkeeping has already run)
function advanceAfterEnd() {
  if (!playlistAuto) return;
  const n = queueNextIndex(queue.length, queueIdx, playlistLoop);
  if (n >= 0) loadTrack(n, true);
}

function restartSong() { if (playing) startAt(0); else { offset = 0; ui(); } }
function nextTrack() {
  if (liveMode) return;   // the transport is locked while live input is on
  const n = queueNextIndex(queue.length, queueIdx, playlistLoop);
  if (buf && n >= 0) skipTo(n);
}
function prevTrack() {
  if (!buf || liveMode) return;
  const p = queuePrevIndex(queue.length, queueIdx, playlistLoop);
  // like a CD player: after 3 seconds, or on the first track, Previous restarts the song instead of going back
  if (cur() > 3 || p < 0) restartSong(); else skipTo(p);
}

// Choose song / drop audio on the page: the chosen files replace the queue and the first one is loaded
function setQueue(files) {
  queue = files.map(file => ({ file, name: file.name })); queueIdx = -1;
  renderQueue();
  loadTrack(0, false);
}
// Add to queue (mode 'end') or Play next (mode 'next'); when no song is loaded yet, the first new file is loaded
function addToQueue(files, mode) {
  const at = mode === 'next' ? queueInsertIndex(queue.length, queueIdx) : queue.length;
  queue.splice(at, 0, ...files.map(file => ({ file, name: file.name })));
  if (queueIdx >= at) queueIdx += files.length;   // the playing track moves along with the list
  renderQueue();
  if (!buf) loadTrack(at, false);
}
function removeFromQueue(i) {
  queue.splice(i, 1);
  queueIdx = queueIndexAfterRemove(queueIdx, i);   // removing the playing track keeps the audio going, detached from the list
  renderQueue();
}
function clearQueue() { queue = []; queueIdx = -1; renderQueue(); }
// Reorder: the track at `from` ends up at index `to`. The playing track keeps playing and the queue keeps pointing at it.
function moveInQueue(from, to) {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
  const [t] = queue.splice(from, 1); queue.splice(to, 0, t);
  queueIdx = queueIndexAfterMove(queueIdx, from, to);
  renderQueue();
}
// Drag a row by its grip (pointer events, so it works with mouse, pen and touch). The line shows where the track will land.
function startQueueDrag(e, from, li) {
  if (e.button) return;   // left button / touch / pen only
  e.preventDefault();
  const list = $('queueList'), rows = Array.from(list.children), grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch (_) { }
  li.classList.add('dragging'); list.classList.add('sorting');
  let slot = from, lastY = e.clientY, done = false;   // slot = gap the track would drop into: 0 (before the first row) .. rows.length (after the last)
  const update = () => {
    const r = list.getBoundingClientRect();
    if (lastY < r.top + 28) list.scrollTop -= 8; else if (lastY > r.bottom - 28) list.scrollTop += 8;   // edge auto-scroll for long queues
    slot = rows.length;
    for (let k = 0; k < rows.length; k++) { const b = rows[k].getBoundingClientRect(); if (lastY < b.top + b.height / 2) { slot = k; break; } }
    rows.forEach((row, k) => {
      row.classList.toggle('drop-above', k === slot);
      row.classList.toggle('drop-below', slot === rows.length && k === rows.length - 1);
    });
  };
  const finish = apply => {
    if (done) return; done = true;
    clearInterval(timer);
    grip.removeEventListener('pointermove', onMove); grip.removeEventListener('pointerup', onUp); grip.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    rows.forEach(row => row.classList.remove('dragging', 'drop-above', 'drop-below')); list.classList.remove('sorting');
    if (apply) moveInQueue(from, slot > from ? slot - 1 : slot);
  };
  const onMove = ev => { lastY = ev.clientY; update(); };
  const onUp = () => finish(true), onCancel = () => finish(false);
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
  const timer = setInterval(update, 40);   // keeps scrolling while the pointer rests near an edge
  grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', onUp); grip.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  update();
}

function syncQueueUI() {
  $('prevBtn').disabled = !buf || liveMode;
  $('nextBtn').disabled = !buf || liveMode || queueNextIndex(queue.length, queueIdx, playlistLoop) < 0;
  $('queueClear').disabled = !queue.length;
}
function renderQueue() {
  const list = $('queueList');
  list.innerHTML = '';
  queue.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'queue-row' + (i === queueIdx ? ' now' : '');
    const grip = document.createElement('button');
    grip.type = 'button'; grip.className = 'queue-grip'; grip.textContent = '⋮⋮';
    grip.title = 'Drag to reorder, or press the up / down arrow keys';
    grip.setAttribute('aria-label', `Move ${t.name}. Drag it, or press the up or down arrow key.`);
    grip.onpointerdown = e => startQueueDrag(e, i, li);
    grip.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= queue.length) return;
      moveInQueue(i, to);
      const g = list.children[to] && list.children[to].querySelector('.queue-grip'); if (g) g.focus();   // the list was rebuilt: keep the keyboard on the moved track
    };
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'queue-name'; play.textContent = `${i + 1}. ${t.name}`; play.title = 'Play this track';
    play.onclick = () => skipTo(i);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'queue-rm'; rm.textContent = '✕'; rm.title = 'Remove from the queue';
    rm.setAttribute('aria-label', `Remove ${t.name} from the queue`);
    rm.onclick = () => removeFromQueue(i);
    li.append(grip, play, rm);
    list.append(li);
  });
  $('queueHint').hidden = queue.length > 0;
  $('queueCount').textContent = queue.length ? `${queue.length} track${queue.length > 1 ? 's' : ''} in the queue` : '';
  syncQueueUI();
}
renderQueue();

// typing a title or artist is remembered for that track, so repeating it or coming back to it keeps the typed text
for (const id of ['title', 'artist']) $(id).addEventListener('input', () => { const t = queue[queueIdx]; if (t) (t.edit ||= {})[id] = $(id).value; });

$('song').onchange = e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) setQueue(files); };
$('queueAdd').onchange = e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) addToQueue(files, 'end'); };
$('queueNext').onchange = e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) addToQueue(files, 'next'); };
$('queueClear').onclick = clearQueue;
$('queueAuto').onchange = e => { playlistAuto = e.target.checked; };
$('queueLoop').onchange = e => { playlistLoop = e.target.checked; syncQueueUI(); };
$('prevBtn').onclick = prevTrack;
$('nextBtn').onclick = nextTrack;

// Built-in demo: a short synthesized tune (see demo.js), so the visualizer can be tried without a file. It is not part of the queue.
$('demoBtn').onclick = async () => {
  const gen = ++loadGen;
  queue = []; queueIdx = -1; renderQueue();
  setup();
  try {
    await ctx.resume();
    const d = renderDemoTrack(ctx.sampleRate);
    const ab = ctx.createBuffer(2, d.left.length, d.sampleRate);
    ab.copyToChannel(d.left, 0); ab.copyToChannel(d.right, 1);
    if (gen !== loadGen) return;
    installSong(ab, { gen, title: 'Demo Track', label: 'Built-in demo', size: null, tags: { artist: 'Nebula', title: 'Demo Track' } });
    $('play').click();
  } catch (err) { console.error('Demo failed:', err); notify('The demo track could not be started in this browser.', true); }
};

const IMG_MAX_BYTES = 25 * 1048576, IMG_MAX_PX = 4096;   // hard cap; the real target is smaller (see loadImage)
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i, VIDEO_MAX_BYTES = 1024 * 1048576;
const isVideoFile = f => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);
const isGif = f => f.type === 'image/gif' || /\.gif$/i.test(f.name);
function mediaW(m) { return m.videoWidth || m.naturalWidth || m.width; }
function mediaH(m) { return m.videoHeight || m.naturalHeight || m.height; }
// Animated GIFs are drawn from the original file: re-encoding them into a canvas (as stills are) would freeze them.
// The object URL is kept on purpose, because the browser keeps animating the GIF from it.
// Playback follows the song, like the stars and particles: while a loaded song is paused, videos stop and GIFs stop on their current frame.
// With no song loaded everything keeps moving, so the look can be previewed.
const isLive = () => !buf || isActive();
function syncVideoPlayback() {
  const v = backgroundImg;
  if (!v || v.tagName !== 'VIDEO') return;
  if (isLive() && v.paused) v.play().catch(() => { });
  else if (!isLive() && !v.paused) v.pause();
}
// Advances the animated GIFs in use. Their clock is the stars' clock: it stops while a loaded song is paused.
function advanceGifs(mdt) {
  for (const a of [backgroundImg, coverImg]) {
    if (!a || !a.isGif) continue;
    a.t += mdt * 1000;
    let r = a.total > 0 ? a.t % a.total : 0, i = 0;
    while (i < a.frames.length - 1 && r >= a.frames[i].ms) { r -= a.frames[i].ms; i++; }
    a.cur = a.frames[i].c;
  }
}
function loadGif(f, what, cb) {
  if (f.size > IMG_MAX_BYTES) { notify(`That ${what} GIF is larger than 25 MB.`, true); return; }
  f.arrayBuffer().then(ab => {
    let g;
    try { g = decodeGifFrames(ab); }   // gif.js
    catch (err) { notify(`Could not read that ${what} GIF${err.message === 'too large' ? ': its frames would need too much memory to animate.' : '. It may be corrupt.'}`, true); return; }
    const frames = g.frames.map(fr => {
      const c = document.createElement('canvas'); c.width = g.width; c.height = g.height;
      c.getContext('2d').putImageData(new ImageData(fr.rgba, g.width, g.height), 0, 0);
      return { c, ms: fr.ms };
    });
    const total = frames.reduce((n, x) => n + x.ms, 0);
    cb({ isGif: true, width: g.width, height: g.height, frames, total, t: 0, cur: frames[0].c });
  }, () => notify(`Could not load that ${what} GIF.`, true));
}

// Videos are played by the browser (muted, looping) and drawn into the canvas every frame, so exports include them.
function loadVideo(f, cb) {
  if (f.size > VIDEO_MAX_BYTES) { notify(`That video is larger than 1 GB.`, true); return; }
  const url = URL.createObjectURL(f), v = document.createElement('video');
  const fail = () => notify(`Could not play "${f.name}" in this browser. MP4 (H.264) and WebM are the safest formats.`, true);
  v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
  v.onloadeddata = () => { if (v.videoWidth) cb(v); else fail(); };
  v.onerror = fail;
  v.src = url;   // kept alive: undo can bring the video back
}
function loadImage(f, what, cb) {   // size limit, error messages, and downscaling of huge images
  if (!f.type.startsWith('image/')) { notify(`That file is not an image.`, true); return; }
  if (isGif(f)) return loadGif(f, what, cb);
  if (f.size > IMG_MAX_BYTES) { notify(`That ${what} image is larger than 25 MB.`, true); return; }
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    const w = im.naturalWidth, h = im.naturalHeight;
    if (!w || !h) { notify(`Could not read that ${what} image.`, true); return; }
    // keep only the pixels that can ever be drawn: the background is cover-fitted to 1920x1080, the cover art is drawn small
    const k = Math.min(1, IMG_MAX_PX / Math.max(w, h), what === 'background' ? Math.max(1920 / w, 1080 / h) : 1024 / Math.max(w, h));
    let out = im;
    if (k < 1) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); out = c; }
    cb(out);
  };
  im.onerror = () => { URL.revokeObjectURL(url); notify(`Could not load that ${what} image. It may be corrupt or in an unsupported format.`, true); };
  im.src = url;
}
// The background is an image, a GIF, a video element or null. A video plays only while it is the background,
// and its colour checks are refreshed every few seconds because its picture keeps changing.
let bgVideoTimer = 0;
function setBackground(m) {
  if (backgroundImg && backgroundImg !== m && backgroundImg.tagName === 'VIDEO') backgroundImg.pause();
  clearInterval(bgVideoTimer);
  backgroundImg = m;
  if (m && m.tagName === 'VIDEO') {
    m.play().catch(() => { });
    const resample = () => { if (backgroundImg === m && m.readyState >= 2) sampleBgImage(m); };
    resample(); bgVideoTimer = setInterval(resample, 3000);
  } else if (m && m.isGif) {
    const resample = () => { if (backgroundImg === m) sampleBgImage(m.cur); };
    resample(); bgVideoTimer = setInterval(resample, 3000);
  } else sampleBgImage(m);
  syncBgImageUI();
}
function loadBackground(f) {
  const done = m => { setBackground(m); commitHistory(); };
  if (isVideoFile(f)) loadVideo(f, done); else loadImage(f, 'background', done);
}
$('backgroundImage').onchange = e => { const f = e.target.files[0]; if (f) loadBackground(f); };
$('removeBackgroundImage').onclick = () => { setBackground(null); $('backgroundImage').value = ''; commitHistory(); };
function syncBgImageUI() {   // an image covers the color/gradient, so those controls are dimmed (not disabled)
  $('bgColorOpts').classList.toggle('off', !!backgroundImg);
  $('bgImageHint').hidden = !backgroundImg;
}

$('cover').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  loadImage(f, 'cover', im => { coverImg = im; coverFromTag = false; commitHistory(); });
};
$('removeCoverImage').onclick = () => { coverImg = null; coverFromTag = false; $('cover').value = ''; commitHistory(); };

$('play').onclick = async () => {
  if (liveMode) { stopLive('Live input stopped.'); return; }
  if (!buf) return;
  await ctx.resume();
  if (playing) { offset = ctx.currentTime - startedAt; stopAll(); playing = false; icon(false); }
  else startAt(offset % buf.duration);
  recSync();   // pausing the song pauses the recording too
};

const fmt = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor((s % 60) * 10) / 10; return m + ':' + r.toFixed(1).padStart(4, '0'); };
const cur = () => !buf ? 0 : playing ? Math.min(buf.duration, ctx.currentTime - startedAt) : offset;
let dragging = false;
function ui() {
  if (liveMode) { $('time').textContent = 'Live input'; return; }
  if (!buf) return;
  const t = dragging ? $('seek').value / 1000 * buf.duration : cur();
  if (!dragging) $('seek').value = t / buf.duration * 1000;
  $('time').textContent = timeText(t);
  updateSliders();
}
// Click the time to switch between elapsed (0:20.0 / 1:00.0) and remaining (-0:40.0 / 1:00.0). The choice is remembered.
const TIME_KEY = 'nebulaTimeMode';
let showRemaining = false; try { showRemaining = localStorage.getItem(TIME_KEY) === 'remaining'; } catch (e) { }
function timeText(t) {
  if (!buf) return (showRemaining ? '-' : '') + '0:00.0 / 0:00.0';
  // work in whole tenths, so elapsed + remaining always add up to the total shown (and float error cannot drop a tenth)
  const tq = Math.floor(t * 10 + 1e-6) / 10;
  return (showRemaining ? '-' + fmt(buf.duration - tq + 1e-6) : fmt(tq)) + ' / ' + fmt(buf.duration);
}
function toggleTimeMode() {
  showRemaining = !showRemaining;
  try { localStorage.setItem(TIME_KEY, showRemaining ? 'remaining' : 'elapsed'); } catch (e) { }
  $('time').textContent = timeText(buf ? cur() : 0);
}
$('time').onclick = toggleTimeMode;
$('time').onkeydown = e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); e.stopPropagation();   // Space must not also start / pause the song
  toggleTimeMode();
};
$('time').textContent = timeText(0);
$('seek').oninput = () => { dragging = true; updateSliders(); };
$('seek').onchange = () => {
  dragging = false;
  const t = $('seek').value / 1000 * buf.duration;
  offset = t; if (playing) startAt(t);
  updateSliders();
};
$('sens').oninput = e => { sens = +e.target.value; updateSliders(); };

function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

function updatePicker(which, auto = false) {   // auto = true when the color cycler moves it, not the user
  const st = pickerState[which], hex = st.hex || hsvToHex(st.h, st.s, st.v);
  const prefix = PREFIX[which];
  if (which === 'main') { visualColor = hex; if (!auto) uiMain = hex; }
  else if (which === 'end') { gradientColor = hex; if (!auto) uiEnd = hex; }
  else if (which === 'bg') backgroundColor = hex;
  else backgroundEndColor = hex;
  const knob = $(prefix + 'HueKnob');
  const square = $(prefix + 'SV');
  const svknob = $(prefix + 'SVKnob');
  const angle = (st.h - 90) * Math.PI / 180, radius = 69;
  if (knob) {
    knob.style.left = (78 + Math.cos(angle) * radius) + 'px';
    knob.style.top = (78 + Math.sin(angle) * radius) + 'px';
  }
  if (square) square.style.setProperty('--hue', `hsl(${st.h} 100% 50%)`);
  if (svknob) {
    svknob.style.left = (st.s * 100) + '%';
    svknob.style.top = ((1 - st.v) * 100) + '%';
  }
  const swatch = $(prefix + 'Swatch');
  if (swatch) swatch.style.background = hex;
  if (which === 'bg' || which === 'bgEnd') updateDial();
  syncFields(prefix, hex);
  if (auto && lockOverlay) return;   // the interface isn't following the cycler, so skip the restyle
  updateOverlayTheme();
  updateSliders();
}

function bindPicker(which) {
  const prefix = PREFIX[which];
  const wheel = $(prefix + 'Wheel');
  const square = $(prefix + 'SV');
  let mode = '';
  function updateFromPointer(el, e) {
    const rect = el.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    pickerState[which].hex = null;
    if (el === wheel) {
      const dx = x - rect.width / 2, dy = y - rect.height / 2;
      if (Math.hypot(dx, dy) > rect.width * 0.29) {
        pickerState[which].h = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      }
    } else {
      pickerState[which].s = Math.max(0, Math.min(1, x / rect.width));
      pickerState[which].v = 1 - Math.max(0, Math.min(1, y / rect.height));
    }
    updatePicker(which);
  }
  for (const el of [wheel, square]) {
    if (!el) continue;
    el.addEventListener('pointerdown', e => { e.stopPropagation(); mode = el.id; el.setPointerCapture(e.pointerId); updateFromPointer(el, e); });
    el.addEventListener('pointermove', e => { e.stopPropagation(); if (mode === el.id) updateFromPointer(el, e); });
    el.addEventListener('pointerup', () => mode = '');
    el.addEventListener('pointercancel', () => mode = '');
  }
}
$('gradient').onchange = e => {
  useGradient = e.target.checked;
  $('endColorWrap').hidden = !useGradient;
  updatePicker('end');
  updateOverlayTheme();
  updateSliders();
};

function syncBgGradient() {
  useBgGradient = $('bgGradient').checked;
  $('bgEndWrap').hidden = !useBgGradient;
  $('bgDirRow').hidden = !useBgGradient;
}
$('bgGradient').onchange = syncBgGradient;

const SNAP_DEG = 4;
function makeDial({ dial, input, get, set, onUpdate }) {
  const update = () => {
    const a = get();
    dial.style.setProperty('--angle', a + 'deg');
    dial.setAttribute('aria-valuenow', String(Math.round(a) % 360));
    if (document.activeElement !== input) input.value = Math.round(a) % 360;
    if (onUpdate) onUpdate(a);
  };
  const apply = a => { set(((a % 360) + 360) % 360); update(); };
  const angleAt = e => {
    const r = dial.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 6) return null;
    let a = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else if (!e.altKey) {
      const n = Math.round(a / 45) * 45;
      if (Math.abs(a - n) <= SNAP_DEG) a = n;
    }
    return a % 360;
  };
  let drag = false;
  const drive = e => { const a = angleAt(e); if (a !== null) apply(a); };
  dial.addEventListener('pointerdown', e => { drag = true; dial.setPointerCapture(e.pointerId); drive(e); });
  dial.addEventListener('pointermove', e => { if (drag) drive(e); });
  ['pointerup', 'pointercancel'].forEach(t => dial.addEventListener(t, () => { drag = false; }));
  dial.addEventListener('keydown', e => {
    const step = e.shiftKey ? 15 : 1, k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') apply(get() + step);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') apply(get() - step);
    else return;
    e.preventDefault();
  });
  input.addEventListener('input', () => { const v = parseFloat(input.value); if (isFinite(v)) apply(v); });
  input.addEventListener('blur', update);
  update();
  return update;
}
const bgDial = $('bgDial');
const updateDial = makeDial({
  dial: bgDial, input: $('bgAngleIn'),
  get: () => bgAngle, set: a => { bgAngle = a; },
  onUpdate: a => { bgDial.style.background = `linear-gradient(${a}deg, ${backgroundColor}, ${backgroundEndColor})`; }
});
syncBgGradient();

function syncFields(prefix, hex) {
  const n = parseInt(hex.slice(1), 16), v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const set = (id, val) => { const el = $(id); if (el && document.activeElement !== el) el.value = val; };
  set(prefix + 'HexIn', hex.toUpperCase());
  ['R', 'G', 'B'].forEach((c, i) => set(prefix + c, v[i]));
}
function bindFields(which) {
  const prefix = PREFIX[which];
  const current = () => { const st = pickerState[which]; return st.hex || hsvToHex(st.h, st.s, st.v); };
  const apply = (r, gr, b) => {
    const hex = '#' + [r, gr, b].map(x => x.toString(16).padStart(2, '0')).join('');
    const hsv = hexToHsv(hex);
    const st = pickerState[which];
    if (hsv.v === 0) { hsv.h = st.h; hsv.s = st.s; } else if (hsv.s === 0) hsv.h = st.h;
    Object.assign(st, hsv, { hex });
    updatePicker(which);
  };
  const hexIn = $(prefix + 'HexIn'), ch = ['R', 'G', 'B'].map(c => $(prefix + c));
  hexIn.addEventListener('input', () => {
    let t = hexIn.value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{6}$/i.test(t)) { const n = parseInt(t, 16); apply((n >> 16) & 255, (n >> 8) & 255, n & 255); }
  });
  ch.forEach(el => el.addEventListener('input', () => {
    const v = ch.map(e => e.value === '' ? NaN : Math.round(+e.value));
    if (v.every(x => x >= 0 && x <= 255)) apply(...v);
  }));
  [hexIn, ...ch].forEach(el => el.addEventListener('blur', () => syncFields(prefix, current())));
}
bindPicker('main'); bindPicker('end'); bindPicker('bg'); bindPicker('bgEnd');
bindFields('main'); bindFields('end'); bindFields('bg'); bindFields('bgEnd');
updatePicker('main'); updatePicker('end'); updatePicker('bg'); updatePicker('bgEnd');
updateOverlayTheme();
updateSliders();

// --- Visualizer Mode Selectors & Controls ---
function setMode(m) {
  if (!MODES.includes(m)) m = 'bars';
  vizMode = m; $('vizMode').value = m; $('circularOpts').hidden = m !== 'circular'; $('mirroredOpts').hidden = m !== 'mirrored'; $('dotsOpts').hidden = m !== 'dots'; $('waveOpts').hidden = !(m === 'wave' || m === 'wavemir'); $('ridgeOpts').hidden = m !== 'ridge'; $('barOpts').hidden = !(m === 'bars' || m === 'mirrored');
}
$('vizMode').onchange = e => setMode(e.target.value);
$('circRadius').oninput = e => { circRadius = +e.target.value; updateSliders(); };
$('circLength').oninput = e => { circLength = +e.target.value; updateSliders(); };
$('circWidth').oninput = e => { circWidth = +e.target.value; updateSliders(); };
$('circCount').oninput = e => { circCount = +e.target.value; updateSliders(); };
$('mirCount').oninput = e => { mirCount = +e.target.value; updateSliders(); };
$('dotsCount').oninput = e => { dotsCount = +e.target.value; updateSliders(); };
$('dotsPeak').onchange = e => { dotsPeak = e.target.checked; };
Object.entries({ vizX: 'x', vizY: 'y', vizW: 'w' }).forEach(([id, k]) => { $(id).oninput = e => { vizCfg[k] = +e.target.value; }; });
$('outlineViz').onchange = e => { outlineViz = e.target.checked; };
$('outlineCover').onchange = e => { outlineCover = e.target.checked; };
$('outlineText').onchange = e => { outlineText = e.target.checked; };
$('waveWidth').oninput = e => { waveWidth = +e.target.value; updateSliders(); };
$('waveFill').oninput = e => { waveFill = +e.target.value; updateSliders(); };
$('waveGlow').oninput = e => { waveGlow = +e.target.value; updateSliders(); };
$('waveDetail').oninput = e => { waveDetail = +e.target.value; updateSliders(); };
$('ridgeRows').oninput = e => { ridgeRows = +e.target.value; updateSliders(); };
$('ridgeStep').oninput = e => { ridgeStep = +e.target.value; updateSliders(); };
$('ridgeAmp').oninput = e => { ridgeAmp = +e.target.value; updateSliders(); };
$('ridgeLine').oninput = e => { ridgeLine = +e.target.value; updateSliders(); };
function syncBarUI() { $('barRound').disabled = !(barShape === 'rounded' || barShape === 'beveled'); }   // corner size only matters for these two
$('barShape').onchange = e => { barShape = e.target.value; syncBarUI(); };
$('barRound').oninput = e => { barRound = +e.target.value; updateSliders(); };
$('barGap').oninput = e => { barGap = +e.target.value; updateSliders(); };
$('glowBlur').oninput = e => { glowBlur = +e.target.value; updateSliders(); };

// Text styling
function loadTextFont() {   // web fonts are only downloaded once something asks for them; the canvas never asks by itself
  const f = TEXT_FONTS[textCfg.font];
  if (document.fonts && f) [400, 700, 800].forEach(w => document.fonts.load(`${w} 40px ${f}`).catch(() => { }));
}
function syncTextDisabled() {
  $('textColor').disabled = textCfg.match;
  ['textShBlur', 'textShX', 'textShY', 'textShColor'].forEach(id => { $(id).disabled = textCfg.shOp <= 0; });   // nothing to adjust while the shadow is off
}
function syncTextUI() { syncTextDisabled(); updateSliders(); }
$('textFont').onchange = e => { textCfg.font = e.target.value; loadTextFont(); };
$('textWeight').onchange = e => { textCfg.weight = e.target.value; };
$('textAlign').onchange = e => { textCfg.align = e.target.value; };
Object.entries({ textSize: 'size', textSpace: 'space', textX: 'x', textY: 'y', textShOp: 'shOp', textShBlur: 'shBlur', textShX: 'shX', textShY: 'shY' })
  .forEach(([id, k]) => { $(id).oninput = e => { textCfg[k] = +e.target.value; syncTextUI(); }; });
$('textColor').oninput = $('textColor').onchange = e => { textCfg.color = e.target.value; };
$('textShColor').oninput = $('textShColor').onchange = e => { textCfg.shColor = e.target.value; };
$('textMatch').onchange = e => { textCfg.match = e.target.checked; syncTextUI(); };
syncTextDisabled();

// Cover styling
function syncCoverUI() {
  const C = coverCfg;
  $('coverRadius').disabled = C.shape !== 'rounded';                     // only the rounded square has corners to adjust
  $('coverBorderMatch').disabled = C.bw <= 0;
  $('coverBorderColor').disabled = C.bw <= 0 || C.bmatch;
  ['coverShBlur', 'coverShX', 'coverShY', 'coverShColor'].forEach(id => { $(id).disabled = C.shOp <= 0; });   // nothing to adjust while the shadow is off
  $('coverNoteColor').disabled = !C.note;
  updateSliders();
}
$('coverOn').onchange = e => { coverCfg.on = e.target.checked; syncCoverUI(); };
$('textOn').onchange = e => { textCfg.on = e.target.checked; };
$('vizOn').onchange = e => { vizCfg.on = e.target.checked; };
$('coverShape').onchange = e => { coverCfg.shape = e.target.value; syncCoverUI(); };
$('coverFit').onchange = e => { coverCfg.fit = e.target.value; };
$('coverAttach').onchange = e => { coverCfg.attach = e.target.checked; };
$('coverBorderMatch').onchange = e => { coverCfg.bmatch = e.target.checked; syncCoverUI(); };
$('coverNote').onchange = e => { coverCfg.note = e.target.checked; syncCoverUI(); };
Object.entries({ coverSize: 'size', coverX: 'x', coverY: 'y', coverRadius: 'radius', coverOpacity: 'opacity', coverBw: 'bw', coverShOp: 'shOp', coverShBlur: 'shBlur', coverShX: 'shX', coverShY: 'shY' })
  .forEach(([id, k]) => { $(id).oninput = e => { coverCfg[k] = +e.target.value; syncCoverUI(); }; });
[['coverBorderColor', 'bcolor'], ['coverShColor', 'shColor'], ['coverNoteColor', 'noteColor']]
  .forEach(([id, k]) => { $(id).oninput = $(id).onchange = e => { coverCfg[k] = e.target.value; }; });
syncCoverUI();
$('glowBars').oninput = e => { glowBars = +e.target.value; updateSliders(); };
$('glowCover').oninput = e => { glowCover = +e.target.value; updateSliders(); };
$('glowText').oninput = e => { glowText = +e.target.value; updateSliders(); };
syncBarUI();
$('autoColorCycle').onchange = e => { autoColorCycle = e.target.checked; syncRainbowUI(); };
$('cycleSpeed').oninput = e => { cycleSpeed = +e.target.value; updateSliders(); };
$('rainbow').onchange = e => { rainbow = e.target.checked; syncRainbowUI(); };
$('rbMove').onchange = e => { rbMove = e.target.checked; syncRainbowUI(); };
$('rbDir').onchange = e => { rbDir = +e.target.value; };
$('rbSpeed').oninput = e => { rbSpeed = +e.target.value; updateSliders(); };
$('circSym').onchange = e => { circSym = e.target.checked; };
function syncRainbowUI() {
  $('cycleSpeed').disabled = !autoColorCycle;
  $('rbMove').disabled = !rainbow;
  $('rbDir').disabled = !(rainbow && rbMove);
  $('rbSpeed').disabled = !(rainbow && rbMove);
  $('colorTools').classList.toggle('off', rainbow);
  updateSliders();
}
syncRainbowUI();

// Volume
const SPK_ON = '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
const SPK_OFF = '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
function applyVol() {
  const off = muted || volume === 0;
  if (outGain) outGain.gain.value = off ? 0 : volume * volume;   // squared = more natural slider feel
  $('muteBtn').innerHTML = off ? SPK_OFF : SPK_ON;
  const t = off ? 'Unmute (M)' : 'Mute (M)';
  $('muteBtn').setAttribute('aria-label', t); $('muteBtn').title = t;
}
$('vol').oninput = e => { volume = +e.target.value; if (volume > 0) muted = false; applyVol(); updateSliders(); };
$('muteBtn').onclick = e => { muted = !muted; applyVol(); if (e.detail) $('muteBtn').blur(); };
applyVol();
$('bassPulse').onchange = e => { bassPulse = e.target.checked; $('pulseAmt').disabled = !bassPulse; updateSliders(); };
$('pulseAmt').oninput = e => { pulseAmt = +e.target.value; updateSliders(); };
$('bgAudioReactive').onchange = e => { bgAudioReactive = e.target.checked; $('bgPulseAmt').disabled = !bgAudioReactive; updateSliders(); };
$('bgPulseAmt').oninput = e => { bgPulseAmt = +e.target.value; updateSliders(); };

// Stars + particles
const partCfg = { on: true, count: 40, size: 3, speed: 1, sens: 1 };
function syncStarUI() {
  $('starOpts').classList.toggle('off', !starCfg.on);
  $('starOpts').inert = !starCfg.on;
  $('starLight').disabled = !starCfg.flash;
  $('partOpts').classList.toggle('off', !partCfg.on);
  $('partOpts').inert = !partCfg.on;
}
$('starsOn').onchange = e => { starCfg.on = e.target.checked; syncStarUI(); };
$('starFlash').onchange = e => { starCfg.flash = e.target.checked; syncStarUI(); updateSliders(); };
$('starDensity').oninput = e => { starCfg.count = +e.target.value; updateSliders(); };
$('starSpeed').oninput = e => { starCfg.speed = +e.target.value; updateSliders(); };
$('starBoost').oninput = e => { starCfg.boost = +e.target.value; updateSliders(); };
$('starLight').oninput = e => { starCfg.light = +e.target.value; updateSliders(); };
$('starColor').onchange = e => { starCfg.color = e.target.value; };
$('partOn').onchange = e => { partCfg.on = e.target.checked; syncStarUI(); };
$('partCount').oninput = e => { partCfg.count = +e.target.value; updateSliders(); };
$('partSize').oninput = e => { partCfg.size = +e.target.value; updateSliders(); };
$('partSpeed').oninput = e => { partCfg.speed = +e.target.value; updateSliders(); };
$('partSens').oninput = e => { partCfg.sens = +e.target.value; updateSliders(); };
const updateStarDial = makeDial({ dial: $('starDial'), input: $('starAngleIn'), get: () => starCfg.angle, set: a => { starCfg.angle = a; } });
syncStarUI(); updateSliders();

// --- Number readouts: every settings slider also shows (and accepts) a real value with a unit ---
// scale converts the slider's internal value to what is shown (e.g. 0.08 -> 8 %). The tip explains what the number means.
const SLIDER_INFO = {
  sens:        { scale: 100, unit: '%',     tip: 'Bar height gain. 100% matches the original reference look. 50% = bars half as tall; above 100% the loudest bars start to clip at the top.' },
  circRadius:  { unit: 'px',     tip: 'Radius of the inner ring, in pixels of the 1920x1080 frame.' },
  circLength:  { unit: 'px',     tip: 'Longest a bar can grow outward from the ring, in pixels (limited by the frame edge).' },
  circWidth:   { unit: 'px',     tip: 'Thickness of each bar, in pixels.' },
  circCount:   { unit: 'bars',   tip: 'Number of bars around the ring.' },
  dotsCount:   { unit: 'bars',   tip: 'Number of columns in the LED matrix.' },
  waveWidth:   { unit: 'px',     tip: 'Thickness of the wave line, in pixels (Smooth Wave modes).' },
  waveFill:    { scale: 100, unit: '%', tip: 'Opacity of the soft fill under (or inside) the wave. 0% = line only.' },
  waveGlow:    { scale: 100, unit: '%', tip: 'Strength of the glow around the wave line. It also pulses with the bass. 0% = no glow.' },
  waveDetail:  { unit: 'pts',    tip: 'How many points the curve is drawn through. Fewer = rounder and smoother, more = follows every little peak.' },
  ridgeRows:   { unit: 'rows',   tip: 'How many past moments of the spectrum are stacked behind the front line.' },
  ridgeStep:   { unit: 'px',     tip: 'Vertical distance between neighbouring rows, in pixels. Larger = the stack reaches further up.' },
  ridgeAmp:    { unit: 'px',     tip: 'How tall the loudest peak of a row can grow, in pixels.' },
  ridgeLine:   { scale: 100, unit: '%', tip: 'Line thickness of every row. 100% is the standard look.' },
  barRound:    { unit: 'px',     tip: 'Corner size for the Rounded and Beveled shapes, in pixels. Large values are limited to what fits the bar.' },
  barGap:      { unit: 'px',     tip: 'Space between neighbouring bars, in pixels (63-bar and mirrored modes). Wider gaps make thinner bars.' },
  glowBlur:    { unit: 'px',     tip: 'How far the glow spreads, in pixels of the 1920x1080 frame. Shared by bars, cover art and text.' },
  glowBars:    { scale: 100, unit: '%', tip: 'Glow around the bars and lines. In the Ridgeline only the front line glows. 0% = off.' },
  glowCover:   { scale: 100, unit: '%', tip: 'Glow around the cover artwork. 0% = off.' },
  bandLo:      { unit: 'Hz',     tip: 'Lowest frequency shown by the bars. Raise it to skip sub-bass; the bars are then spread over the remaining range.' },
  bandHi:      { unit: 'Hz',     tip: 'Highest frequency shown by the bars. Lower it to drop the quiet top end and give the bass and mids more bars.' },
  bandSpacing: { scale: 100, unit: '%', tip: 'How the 63 bars are spread over the range. 0% = logarithmic (every octave gets a similar share, like hearing works). 100% = linear (the treble gets many more bars).' },
  bandTilt:    { unit: 'dB/oct', tip: 'Treble boost: extra gain for every octave above the pivot frequency, because music has far less energy up high.' },
  bandPivot:   { unit: 'Hz',     tip: 'Frequency where the treble boost starts and the low-end cut ends.' },
  bandCap:     { unit: 'dB',     tip: 'The most the treble boost may add, however high the frequency.' },
  bandLowCut:  { unit: 'dB/oct', tip: 'Low-end cut: quieter bars for every octave below the pivot frequency, so sub-bass does not dominate.' },
  bandSmooth:  { scale: 100, unit: '%', tip: 'How much each bar borrows from its two neighbours. 0% = jagged and independent, higher = smoother, rounder spectrum.' },
  bandAttack:  { scale: 100, unit: '%', tip: 'How fast bars rise towards a louder level. 100% = instantly.' },
  bandDecay:   { scale: 100, unit: '%', tip: 'How fast bars fall after a loud moment. Lower = longer, floatier fall.' },
  bandFloor:   { scale: 100, unit: '%', tip: 'Noise floor: levels below this are cut to zero, so quiet background noise does not show.' },
  bandGamma:   { unit: '×',      tip: 'Contrast. Above 1 makes quiet bars smaller and loud ones stand out; below 1 lifts the quiet parts.' },
  coverSize:   { unit: '%',      tip: 'Size of the cover. 100% is the original (192 px, or a bit under the ring radius in circular mode).' },
  vizW:        { scale: 100, unit: '%', tip: 'Stretches the whole visualizer sideways around the centre. 100% = normal width. About 122% reaches the left and right edges; the cover and text stay where they are.' },
  vizX:        { unit: 'px',     tip: 'Moves the whole visualizer left (negative) or right (positive), in pixels of the 1920x1080 frame. The cover and text stay where they are.' },
  vizY:        { unit: 'px',     tip: 'Moves the whole visualizer up (negative) or down (positive), in pixels of the 1920x1080 frame. The range is not symmetric: at +545 every mode reaches the bottom edge, and at -200 the bars reach the top edge.' },
  coverX:      { unit: 'px',     tip: 'Moves the cover left (negative) or right (positive), in pixels of the 1920x1080 frame. With "Attach text to cover" the text follows.' },
  coverY:      { unit: 'px',     tip: 'Moves the cover up (negative) or down (positive), in pixels of the 1920x1080 frame. With "Attach text to cover" the text follows.' },
  coverRadius: { unit: '%',      tip: 'Corner radius of the rounded square, as a percentage of the cover size. 50% = a circle.' },
  coverOpacity:{ scale: 100, unit: '%', tip: 'How see-through the cover is. Useful over busy background images.' },
  coverBw:     { unit: 'px',     tip: 'Border thickness, drawn inside the cover edge. 0 = no border.' },
  coverShOp:   { scale: 100, unit: '%', tip: 'Strength of the drop shadow behind the cover. 0% = no shadow.' },
  coverShBlur: { unit: 'px',     tip: 'How soft the shadow edge is, in pixels. 0 = a sharp copy of the cover shape.' },
  coverShX:    { unit: 'px',     tip: 'Shadow offset to the right (positive) or left (negative), in pixels.' },
  coverShY:    { unit: 'px',     tip: 'Shadow offset downward (positive) or upward (negative), in pixels.' },
  textSize:    { unit: '%',      tip: 'Size of the artist, title and extra-info text. 100% is the original size; the lines keep their spacing relative to each other.' },
  textSpace:   { unit: '%',      tip: 'Extra space between letters, as a percentage of the font size. Negative values squeeze the letters together.' },
  textX:       { unit: 'px',     tip: 'Moves the text left (negative) or right (positive), in pixels of the 1920x1080 frame.' },
  textY:       { unit: 'px',     tip: 'Moves the text up (negative) or down (positive), in pixels of the 1920x1080 frame.' },
  textShOp:    { scale: 100, unit: '%', tip: 'Strength of the drop shadow behind the text. 0% = no shadow.' },
  textShBlur:  { unit: 'px',     tip: 'How soft the shadow edge is, in pixels. 0 = a sharp copy of the text.' },
  textShX:     { unit: 'px',     tip: 'Shadow offset to the right (positive) or left (negative), in pixels.' },
  textShY:     { unit: 'px',     tip: 'Shadow offset downward (positive) or upward (negative), in pixels.' },
  glowText:    { scale: 100, unit: '%', tip: 'Glow behind the artist, title and extra-info text. 0% = off.' },
  partSens:    { scale: 100, unit: '%', tip: 'How easily a bass hit releases particles. Lower it for very bassy songs: only the strongest hits (and fewer of them) will burst. Star flashes are not affected.' },
  mirCount:    { unit: 'bars',   tip: 'Number of bars in the mirrored spectrum. 63 matches the original; more bars look smoother, fewer look chunkier.' },
  cycleSpeed:  { unit: '°/s',    tip: 'Hue shift per second. 15°/s is one full trip around the color wheel every 24 seconds; 360°/s is one per second.' },
  rbSpeed:     { unit: '°/s',    tip: 'How fast the rainbow slides, in degrees of hue per second. 360°/s = one full rainbow cycle per second.' },
  pulseAmt:    { scale: 100, unit: '%', tip: 'How much the cover grows at full bass. 8% = up to 8% larger on the loudest kick.' },
  bgPulseAmt:  { scale: 100, unit: '%', tip: 'How strongly the background lights up on bass. 15% = at full bass, 15% of your main color is added on top of the background.' },
  starDensity: { unit: 'stars',  tip: 'Number of stars on screen.' },
  starSpeed:   { unit: '×',      tip: 'Drift speed multiplier. 1× is the default pace; 0 freezes the stars.' },
  starBoost:   { unit: '×',      tip: 'Extra speed at full bass. At 8×, stars fly 9 times faster on the loudest kick than at rest.' },
  starLight:   { scale: 100, unit: '%', tip: 'How bright and large stars flash on a beat. 100% is the default; 0% turns the flash off.' },
  partCount:   { unit: '/beat',  tip: 'Particles released on each detected beat.' },
  partSize:    { unit: 'px',     tip: 'Average particle radius, in pixels.' },
  partSpeed:   { unit: '×',      tip: 'Particle speed multiplier. 1× is the default.' }
};
function initReadouts() {
  const decimals = x => { const t = String(+x.toFixed(4)), i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };
  for (const [id, info] of Object.entries(SLIDER_INFO)) {
    const range = $(id), label = range && range.closest('label');
    if (!range || !label) continue;
    const scale = info.scale || 1, dec = Math.min(2, decimals(parseFloat(range.step) * scale));
    const min = parseFloat(range.min), max = parseFloat(range.max);
    const name = Array.from(label.childNodes).find(n => n.nodeType === 3 && n.textContent.trim()).textContent.trim();
    const wrap = document.createElement('span'); wrap.className = 'val';
    const num = document.createElement('input'); num.type = 'number'; num.className = 'num-in';
    num.min = +(min * scale).toFixed(4); num.max = +(max * scale).toFixed(4); num.step = +(parseFloat(range.step) * scale).toFixed(4);
    num.setAttribute('aria-label', `${name} in ${info.unit}`);
    const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = info.unit;
    wrap.append(num, unit); label.append(wrap);
    label.title = info.tip;
    const show = () => { if (document.activeElement !== num) num.value = (+range.value * scale).toFixed(dec); };
    range.addEventListener('input', show);                                  // slider, presets and imports all end up here
    num.addEventListener('input', () => {                                   // typed number -> slider (clamped), then the slider's normal handler runs
      const v = parseFloat(num.value); if (!isFinite(v)) return;
      range.value = Math.min(max, Math.max(min, v / scale));
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    num.addEventListener('blur', () => { num.value = (+range.value * scale).toFixed(dec); });
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
    new MutationObserver(() => { num.disabled = range.disabled; }).observe(range, { attributes: true, attributeFilter: ['disabled'] });
    num.disabled = range.disabled; show();
  }
}
initReadouts();

// Tooltips for the checkboxes and dropdowns (sliders get theirs from SLIDER_INFO above). A tooltip already set in the HTML wins.
const CONTROL_TIPS = {
  vizMode: 'How the music is drawn. Each mode shows its own extra settings below.',
  barShape: 'Shape of each bar in the 63-bar and mirrored modes. Corner size applies to Rounded and Beveled.',
  circSym: 'On: the left and right halves of the ring mirror each other, with the bass at the top. Off: the spectrum wraps once around the ring.',
  dotsPeak: 'A single dot per column that stays at the highest recent level and slowly falls back down.',
  bassPulse: 'Makes the cover grow a little on every bass hit. The amount is set by Cover pulse.',
  bgAudioReactive: 'Lights up the background with your main color on bass hits. The strength is set by BG pulse.',
  gradient: 'Blend from the main color to a second end color across the bars, cover and text.',
  autoColorCycle: 'Slowly rotates the main and gradient colors around the color wheel while the song plays.',
  rainbow: 'Paints the full color spectrum across the bars (or around the ring). Replaces the main and gradient colors while on.',
  rbMove: 'Slides the rainbow along while the song plays.',
  bgGradient: 'Blend from the background color to a second color, at the angle set by the dial.',
  starsOn: 'Shows the drifting star field behind the visualizer.',
  starFlash: 'Stars grow and brighten on every detected beat. The strength is set by Intensity.',
  starColor: 'Color of the stars: plain white, your main color, the gradient colors, or the whole rainbow.',
  partOn: 'Releases a burst of particles from the bars (or the ring) on strong beats.',
  coverOn: 'Shows or hides the cover. When hidden, the text slides left into the free space.',
  coverShape: 'Outline of the cover and its placeholder.',
  coverFit: 'Crop to fill cuts the image to fill the shape. Fit shows the whole image with black bars where it does not fill it.',
  coverAttach: 'On: moving or resizing the cover carries the text with it. Off: the text stays where it is.',
  coverBorderMatch: 'Paints the border with the same colors (gradient or rainbow) as the visualizer.',
  outlineViz: 'Adds a dark or white edge to the bars, ring or wave when they would blend into the background. Turn it off to keep the plain colors.',
  outlineCover: 'Adds an edge to the placeholder when it would blend into the background. Has no effect once a cover image or a border is used.',
  outlineText: 'Adds an outline to the text when it would be hard to read on the background. Turn it off to keep plain text.',
  coverNote: 'Shows the music note on the placeholder that appears when no cover image is loaded.',
  vizOn: 'Shows or hides the visualizer. The cover and text stay as they are.',
  textOn: 'Shows or hides the artist, title and extra info. The cover stays as it is.',
  textFont: 'Typeface for artist, title and extra info. Fonts other than Montserrat and the system fonts are fetched from Google Fonts when first picked.',
  textWeight: 'Default = bold artist over a regular title (the original look). The other choices use one weight for every line. Some fonts only have one weight.',
  textAlign: 'Auto = left of the cover, or centered under the ring in circular mode.',
  textMatch: 'Paints the text with the same colors (gradient or rainbow) as the visualizer.',
  presetSelect: 'Applies a look. Presets never change your text or cover styling. Ctrl+Z undoes it.',
  presetRandomize: 'Applies a random color and layout look each time you choose a new song.',
  overlayColors: 'Tints the play bar, sliders and checkboxes with your main color.',
  lockOverlay: 'Keeps the interface on the color you last picked, so auto color cycling and rainbow mode do not keep recoloring it.',
  expFormat: 'Container and codec of the exported video. Only formats this browser can record are listed.',
  expRes: 'Size of the exported video. The picture is drawn at 1920 x 1080 and scaled, so larger sizes are an upscale.',
  expFps: 'Frames per second of the exported video.',
  expAudioBr: 'Audio quality of the exported video.'
};
for (const [id, tip] of Object.entries(CONTROL_TIPS)) {
  const el = $(id), lab = el && el.closest('label');
  if (lab && !lab.title) lab.title = tip;
}

// --- Frequency range: sliders, Advanced section and the draggable graph ---
function applyBands() {
  const B = bandCfg;
  M.f0 = B.lo; M.f1 = B.hi; M.tilt = B.tilt; M.fp = B.pivot; M.cap = B.cap; M.ltilt = -B.lowCut;
  M.sw = B.smooth; M.att = B.attack; M.dec = B.decay; M.floor = B.floor; M.gamma = B.gamma;
  if (ctx && analyser) layout();   // before a song is loaded the first layout() picks these values up by itself
  updateSliders();
}
Object.entries({ bandLo: 'lo', bandHi: 'hi', bandSpacing: 'spacing', bandTilt: 'tilt', bandPivot: 'pivot', bandCap: 'cap', bandLowCut: 'lowCut', bandSmooth: 'smooth', bandAttack: 'attack', bandDecay: 'decay', bandFloor: 'floor', bandGamma: 'gamma' })
  .forEach(([id, k]) => { $(id).oninput = e => { bandCfg[k] = +e.target.value; applyBands(); }; });
$('bandAdvBtn').onclick = () => {
  const open = $('bandAdv').hidden;
  $('bandAdv').hidden = !open;
  $('bandAdvBtn').setAttribute('aria-expanded', String(open));
  $('bandAdvBtn').textContent = open ? 'Advanced options ▾' : 'Advanced options ▸';
};
$('bandReset').onclick = () => { applySettings({ bands: { ...BAND_DEFAULTS } }); commitHistory(); notify('Frequency range reset to the defaults. Undo (Ctrl+Z) brings the old values back.'); };

const bandGraph = $('bandGraph'), bgx = bandGraph.getContext('2d'), GF0 = 20, GF1 = 20000;
const gx = (f, W) => Math.log(f / GF0) / Math.log(GF1 / GF0) * W;      // log frequency axis, 20 Hz .. 20 kHz
const gf = (x, W) => GF0 * Math.pow(GF1 / GF0, x / W);
const hzText = f => f < 1000 ? Math.round(f) + ' Hz' : (f / 1000).toFixed(f < 10000 ? 2 : 1).replace(/\.?0+$/, '') + ' kHz';
function drawBandGraph() {
  if (!$('bandsGroup').open) return;   // only while the group is open
  const W = bandGraph.width, H = bandGraph.height, top = 22, bot = H - 24, ph = bot - top, c = bgx;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  // frequency grid
  c.font = '12px Montserrat, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const x = Math.min(W - 1, Math.max(1, gx(f, W)));
    c.fillStyle = '#ffffff1f'; c.fillRect(x, top, 1, ph);
    c.fillStyle = '#8d8a78'; c.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), Math.min(W - 10, Math.max(10, x)), H - 7);
  }
  // the 63 bars: faint slots show where each bar sits, the live level fills them while a song plays
  const [r, gg, b] = rgbOf(visualColor);
  for (let i = 0; i < N; i++) {
    const a = gx(bandEdge(i), W), e = gx(bandEdge(i + 1), W), w = Math.max(1, e - a - 1);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(a, top, w, ph);
    if (playing && vals[i] > 0.005) { c.fillStyle = `rgba(${r},${gg},${b},0.9)`; const hh = vals[i] * ph; c.fillRect(a, bot - hh, w, hh); }
  }
  // outside the chosen range
  const x0 = gx(M.f0, W), x1 = gx(Math.min(M.f1, GF1), W);
  c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, top, x0, ph); c.fillRect(x1, top, W - x1, ph);
  // handles
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2;
  for (const x of [x0, x1]) {
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.roundRect ? c.roundRect(x - 6, top + ph / 2 - 16, 12, 32, 4) : c.rect(x - 6, top + ph / 2 - 16, 12, 32); c.fill();
    c.fillStyle = '#000'; c.fillRect(x - 1, top + ph / 2 - 8, 2, 16);
  }
  c.font = '700 12px Montserrat, sans-serif'; c.fillStyle = '#fff';
  c.textAlign = 'left'; c.fillText(hzText(M.f0), Math.min(x0 + 8, W - 70), 14);
  c.textAlign = 'right'; c.fillText(hzText(M.f1), Math.max(x1 - 8, 70), 14);
}
let bandDrag = null;
const bandX = e => { const r = bandGraph.getBoundingClientRect(); return Math.min(bandGraph.width, Math.max(0, (e.clientX - r.left) / r.width * bandGraph.width)); };
function setBand(id, f) {   // goes through the slider so the number box, undo history and the audio all follow
  const el = $(id), step = +el.step, v = Math.min(+el.max, Math.max(+el.min, Math.round(f / step) * step));
  el.value = +v.toFixed(4);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const bandMove = e => { if (bandDrag) setBand(bandDrag, gf(bandX(e), bandGraph.width)); };
bandGraph.addEventListener('pointerdown', e => {
  const x = bandX(e), W = bandGraph.width;
  bandDrag = Math.abs(x - gx(M.f0, W)) <= Math.abs(x - gx(M.f1, W)) ? 'bandLo' : 'bandHi';   // the nearer handle
  bandGraph.setPointerCapture(e.pointerId); bandMove(e);
});
bandGraph.addEventListener('pointermove', bandMove);
['pointerup', 'pointercancel'].forEach(t => bandGraph.addEventListener(t, () => { bandDrag = null; }));

// Messages: toast near the bottom of the screen (always visible) + the status line
let toastT;
function notify(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 6000 : 3500);
  $('status').textContent = msg;
}

function analyse(dt) {
  if (!analyser || !isActive()) { flash *= 0.9; return 0; }
  analyser.getFloatFrequencyData(freq);
  const r = dt / DTV, kt = Math.pow(M.tau, r);
  for (let k = 0; k < kmax; k++) {
    sm[k] = kt * sm[k] + (1 - kt) * Math.pow(10, freq[k] / 20);
    amp[k] = Math.pow(sm[k] * 30, M.p);
  }
  for (let i = 0; i < N; i++) {
    let m;
    if (hi[i] - lo[i] <= 2) {
      const pos = fcs[i] / hz, k = Math.floor(pos), fr = pos - k;
      m = amp[k] * (1 - fr) + amp[k + 1] * fr;
    } else {
      let mx = 0, sum = 0;
      for (let k = lo[i]; k < hi[i]; k++) { const v = amp[k]; sum += v; if (v > mx) mx = v; }
      m = M.wmax * mx + (1 - M.wmax) * sum / (hi[i] - lo[i]);
    }
    raw[i] = m * gains[i];
  }
  let pk = 0;
  for (let i = 0; i < N; i++) {
    sm2[i] = (1 - 2 * M.sw) * raw[i] + M.sw * (raw[Math.max(0, i - 1)] + raw[Math.min(N - 1, i + 1)]);
    if (sm2[i] > pk) pk = sm2[i];
  }
  agc = Math.max(pk, agc * Math.pow(M.agcdec, r), M.agcmin);
  const ka = 1 - Math.pow(1 - M.att, r), kd = 1 - Math.pow(1 - M.dec, r);
  for (let i = 0; i < N; i++) {
    let t = Math.max(0, Math.min(1.2, sm2[i] / agc) * sens - M.floor) / (1 - M.floor);
    t = Math.min(1, Math.pow(t, M.gamma));
    vals[i] += (t - vals[i]) * (t > vals[i] ? ka : kd);
  }
  let b = 0; for (let i = 0; i < bassN; i++) b += vals[i]; b /= bassN;
  // Beat = a jump in the raw 30-150 Hz energy compared with its own recent average. Relative on purpose: the old fixed
  // threshold on the (auto-gained) bar heights never fired on songs whose bass sits below their mids.
  let E = 0;
  for (let k = beatK0; k < beatK1; k++) { const m = Math.pow(10, freq[k] / 20); E += m * m; }
  E = Math.sqrt(E);
  beatClock += dt;
  beatPeak = Math.max(E, beatPeak * Math.pow(0.999, dt * 60));                 // slow-decay loudness reference
  if (!beatAvg) beatAvg = E;
  if (E > beatAvg * 1.25 && E > beatPeak * 0.15 && beatClock - lastBeat > 0.3) { beatNow = true; flash = 1; lastBeat = beatClock; beatStrength = E / Math.max(beatAvg, 1e-9); }
  beatAvg += (E - beatAvg) * (1 - Math.exp(-dt / 0.4));
  flash *= Math.pow(0.9, dt * 60);
  return b;
}

function drawStars(bass, dt) {
  if (!starCfg.on) return;
  let pal = null;   // per-star colours: a small palette, indexed by each star's own t
  if (starCfg.color === 'gradient') { const c2 = useGradient ? gradientColor : visualColor; pal = Array.from({ length: 16 }, (_, k) => lerpHex(visualColor, c2, k / 15)); }
  else if (starCfg.color === 'rainbow') { const t0 = performance.now() * 0.03; pal = Array.from({ length: 24 }, (_, k) => `hsl(${(t0 + k * 15) % 360} 100% 72%)`); }
  const rad = starCfg.angle * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const sp = (1 + bass * starCfg.boost) * starCfg.speed * dt * 60;
  const f = starCfg.flash ? flash * starCfg.light : 0;
  g.fillStyle = starCfg.color === 'main' ? visualColor : '#fff';
  for (let i = 0; i < starCfg.count; i++) {
    const s = stars[i];
    if (pal) g.fillStyle = pal[Math.min(pal.length - 1, (s.t * pal.length) | 0)];
    s.x += (dx * s.k - dy * s.c) * sp; s.y += (dy * s.k + dx * s.c) * sp;
    if (s.x < -5) s.x = 1925; else if (s.x > 1925) s.x = -5;
    if (s.y < -5) s.y = 1085; else if (s.y > 1085) s.y = -5;
    g.globalAlpha = Math.min(1, s.a + f * 0.4);
    g.beginPath(); g.arc(s.x, s.y, s.r * (1 + f * 0.5), 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
}

const parts = [];
const peaks = new Float32Array(160), ridgeHist = []; let ridgeAcc = 0;
const ridgeBG = document.createElement('canvas'); ridgeBG.width = 1920; ridgeBG.height = 1080; const rbg = ridgeBG.getContext('2d');   // backdrop snapshot for the ridgeline   // LED-matrix peak dots, ridgeline history
function ridgePaths(row, amp) {   // one ridge row as paths at y = 0 (moved into place with translate), so old rows are built only once
  const p = new Path2D(); p.moveTo(X0, -row[0] * amp);
  for (let i = 1; i < N - 1; i++) {
    const x0 = X0 + (X1 - X0) * i / (N - 1), x1 = X0 + (X1 - X0) * (i + 1) / (N - 1);
    p.quadraticCurveTo(x0, -row[i] * amp, (x0 + x1) / 2, -(row[i] + row[i + 1]) / 2 * amp);
  }
  p.lineTo(X1, -row[N - 1] * amp);
  const area = new Path2D(p); area.lineTo(X1, 2); area.lineTo(X0, 2); area.closePath();
  return { curve: p, area };
}
const lerpHex = (a, b, t) => '#' + rgbOf(a).map((v, i) => Math.round(v + (rgbOf(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
function spawnBurst() {
  if (!partCfg.on) return;
  const c2 = useGradient ? gradientColor : visualColor;
  for (let i = 0; i < partCfg.count && parts.length < 3000; i++) {
    const sp = (120 + Math.random() * 260) * partCfg.speed;
    let x, y, a, t, tr;
    if (vizMode === 'circular') {               // explode outward from the ring
      a = Math.random() * 6.283;
      x = CIRC_CX + Math.cos(a) * (circRadius + Math.random() * 20); y = CIRC_CY + Math.sin(a) * (circRadius + Math.random() * 20);
      t = Math.abs(((a / 6.283) * 2) % 2 - 1); tr = ((a / 6.283) + 0.25) % 1;
    } else {                                    // shoot up from the bars (and down too in mirrored mode)
      t = tr = Math.random(); x = X0 + t * (X1 - X0);
      const up = vizMode === 'mirrored' && Math.random() < 0.5 ? 1 : -1;
      y = vizMode === 'mirrored' ? MID : BASE;
      a = up * Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    }
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.5 + Math.random() * 0.5, r: partCfg.size * (0.6 + Math.random() * 0.9), col: rainbow ? `hsl(${(rbOffset + tr * 360) % 360} 100% 55%)` : lerpHex(visualColor, c2, t) });
  }
}
function drawParticles(dt) {
  if (!partCfg.on) parts.length = 0;
  if (!parts.length) return;
  const rad = starCfg.angle * Math.PI / 180, wx = Math.sin(rad) * 90 * partCfg.speed, wy = -Math.cos(rad) * 90 * partCfg.speed;   // direction dial = wind
  const drag = Math.pow(0.5, dt);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= p.decay * dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.vx *= drag; p.vy *= drag;
    p.x += (p.vx + wx) * dt; p.y += (p.vy + wy) * dt;
    g.globalAlpha = Math.min(1, p.life); g.fillStyle = p.col;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
}

function fitText(txt, weight, size, maxW, ls = 0) {
  do {
    g.font = `${weight} ${size}px ${TEXT_FONTS[textCfg.font] || TEXT_FONTS.montserrat}`;
    if ('letterSpacing' in g) g.letterSpacing = (ls * size) + 'px';
    size -= 2;
  } while (g.measureText(txt).width > maxW && size > 20);
}

// One bar as a path. full = shape both ends (mirrored bars, capsules); otherwise the base stays flat on the baseline.
function addBar(p, x, y, w, h, full) {
  if (w <= 0 || h <= 0) return;
  const lim = full ? Math.min(w, h) / 2 : Math.min(w / 2, h);
  const r = Math.min(barShape === 'capsule' ? w / 2 : barRound, lim);
  if (barShape === 'rect' || r < 0.5) { p.rect(x, y, w, h); return; }
  if (barShape === 'beveled') {
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.lineTo(x + w, y + r);
    if (full) { p.lineTo(x + w, y + h - r); p.lineTo(x + w - r, y + h); p.lineTo(x + r, y + h); p.lineTo(x, y + h - r); }
    else { p.lineTo(x + w, y + h); p.lineTo(x, y + h); }
    p.lineTo(x, y + r); p.closePath(); return;
  }
  if (!p.roundRect) { p.rect(x, y, w, h); return; }
  p.roundRect(x, y, w, h, full ? r : [r, r, 0, 0]);
}
function frame() {
  const now = performance.now(), dt = Math.min(0.1, Math.max(0.004, (now - lastT) / 1000)); lastT = now;
  const bass = analyse(dt); ui();
  if (beatNow) {   // particle sensitivity: lower = only stronger hits, spaced further apart
    beatNow = false;
    const k = Math.max(0, 1 - partCfg.sens);
    if (beatStrength >= 1.25 + k * 0.12 && beatClock - lastBurst >= 0.3 + k * 0.4 + k * k * 1.5) { lastBurst = beatClock; spawnBurst(); }
  }
  // Stars and particles stand still while a loaded song is paused or stopped (so a recording resumes exactly where it left off).
  // With no song loaded yet they keep drifting, so the star settings can still be previewed.
  const mdt = (isActive() || !buf) ? dt : 0;
  syncVideoPlayback();
  advanceGifs(mdt);

  if (autoColorCycle && playing) {
    const d = dt * cycleSpeed;
    pickerState.main.h = (pickerState.main.h + d) % 360; pickerState.main.hex = null;
    pickerState.end.h = (pickerState.end.h + d) % 360; pickerState.end.hex = null;
    updatePicker('main', true);
    if (useGradient) updatePicker('end', true);
  }
  if (rainbow && rbMove && playing) rbOffset = (((rbOffset - rbDir * rbSpeed * dt) % 360) + 360) % 360;

  // Background rendering
  const bgSrc = backgroundImg && backgroundImg.isGif ? backgroundImg.cur : backgroundImg;
  const bgPic = bgSrc && (bgSrc.tagName !== 'VIDEO' || bgSrc.readyState >= 2) ? bgSrc : null;   // a video shows nothing until its first frame
  if (bgPic) {
    const bw = mediaW(bgPic), bh = mediaH(bgPic), scale = Math.max(1920 / bw, 1080 / bh), w = bw * scale, h = bh * scale;
    g.drawImage(bgPic, (1920 - w) / 2, (1080 - h) / 2, w, h);
  } else if (useBgGradient) {
    const W = 1920, H = 1080;
    const rad = bgAngle * Math.PI / 180;
    const ux = Math.sin(rad), uy = -Math.cos(rad);
    const half = (Math.abs(ux) * W + Math.abs(uy) * H) / 2;
    const bgGrad = g.createLinearGradient(W / 2 - ux * half, H / 2 - uy * half, W / 2 + ux * half, H / 2 + uy * half);
    bgGrad.addColorStop(0, backgroundColor);
    bgGrad.addColorStop(1, backgroundEndColor);
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = backgroundColor;
    g.fillRect(0, 0, 1920, 1080);
  }
  if (bgAudioReactive && bgPulseAmt > 0 && bass > 0.01) {   // add a wash of the main color on top of whatever background is shown
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, bass * bgPulseAmt);
    g.fillStyle = rainbow ? `hsl(${rbOffset} 100% 50%)` : visualColor;
    g.fillRect(0, 0, 1920, 1080);
    g.restore();
  }
  drawStars(bass, mdt);
  if (vizMode === 'ridge') rbg.drawImage(cv, 0, 0);   // background + pulse + stars, before any ridge is drawn

  const c1 = visualColor, c2 = useGradient ? gradientColor : visualColor;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(c1), [r2, g2, b2] = rgb(c2);
  const FADE_FROM = 150, FADE_TO = 45;
  const gRGB = rgb(lerpHex(c1, c2, 0.5));   // glow colour: the middle of the bar gradient (or the live rainbow hue)
  const glowCol = a => rainbow ? `hsl(${rbOffset} 100% 60% / ${a})` : `rgba(${gRGB[0]},${gRGB[1]},${gRGB[2]},${a})`;

  const barGradient = g.createLinearGradient(X0, 0, X1, 0);
  barGradient.addColorStop(0, c1); barGradient.addColorStop(1, c2);
  // Contrast safety: when the chosen colors are too close to the background an outline in the opposite tone is added. The colors themselves are never changed.
  // Backgrounds are judged by several reference colors: gradient ends + middle, or dark..light samples of the image. If they call for different
  // outline tones (light on dark parts, dark on light parts) a two-tone outline is used, so it stays visible wherever the visualizer sits.
  const bgRefs = backgroundImg && bgImgRefs.length ? bgImgRefs : useBgGradient ? [backgroundColor, lerpHex(backgroundColor, backgroundEndColor, 0.5), backgroundEndColor] : [backgroundColor];
  const needOL = cr => Math.min(1, Math.max(0, (3 - cr) / 1.5));
  const fills = rainbow ? RB_SAMPLES : [c1, c2];
  const ol = needOL(Math.min(...fills.flatMap(a => bgRefs.map(b => crOf(a, b)))));
  const inks = new Set(bgRefs.map(inkFor)), twoTone = inks.size > 1, olCol = twoTone ? '#000' : inks.values().next().value;
  // stroke the given path (or the current path when none) as an outline; twoTone = light halo under a dark line
  const olStroke = (path, lw, alpha = 1, on = outlineViz) => {
    if (ol <= 0 || !on) return;
    g.save(); g.shadowBlur = 0; g.lineJoin = 'round';
    const run = () => path ? g.stroke(path) : g.stroke();
    g.globalAlpha = alpha * ol;
    if (twoTone) { g.strokeStyle = '#fff'; g.lineWidth = lw + 4; run(); }
    g.strokeStyle = olCol; g.lineWidth = lw; run();
    g.restore();
  };

  // Rainbow: every hue across the bars (or around the ring); rbOffset slides it
  let vizFill = barGradient;
  if (rainbow) {
    vizFill = (vizMode === 'circular' && g.createConicGradient) ? g.createConicGradient(-Math.PI / 2, CIRC_CX, CIRC_CY) : g.createLinearGradient(X0, 0, X1, 0);
    for (let k = 0; k <= 24; k++) vizFill.addColorStop(k / 24, `hsl(${(rbOffset + k * 15) % 360} 100% 55%)`);
  }

  // --- RENDER VISUALIZER MODES --- (moved as one block by the Position offsets; gradients and glow move with it)
  if (vizCfg.on) {   // 'Show visualizer' off: the mode drawing is skipped, the cover and text stay
  g.save(); const frameBase = g.getTransform();   // untransformed frame: used for the ridgeline backdrop
  g.translate(vizCfg.x, vizCfg.y);
  g.translate(960, 0); g.scale(vizCfg.w, 1); g.translate(-960, 0);   // stretch around the centre line (X0..X1 is centred on 960)
  if (vizMode === 'bars') {
    const gap = barGap, w = (X1 - X0 - gap * (N - 1)) / N, cap = barShape === 'capsule';
    const all = new Path2D(), outlined = [];
    for (let i = 0; i < N; i++) {
      const h = MINH + vals[i] * (MAXH - MINH);
      const x = X0 + i * (w + gap), y = BASE - h;
      addBar(all, x, y, w, h, cap);
      const tx = (x + w / 2 - X0) / (X1 - X0);
      const br = Math.max(r1 + (r2 - r1) * tx, g1 + (g2 - g1) * tx, b1 + (b2 - b1) * tx);
      let o = rainbow ? 0 : Math.min(1, Math.max(0, (FADE_FROM - br) / (FADE_FROM - FADE_TO)));
      o = o * o * (3 - 2 * o);
      if (o > 0.01 && outlineViz) outlined.push([x, y, w, h, o]);   // near-black bars get a white outline that fades in
    }
    g.save();
    if (glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
    g.fillStyle = vizFill; g.fill(all);   // all bars as one path = one glow pass instead of 63
    olStroke(all, 2);
    g.restore();
    for (const [x, y, w2, h, o] of outlined) {
      const lw = 1 + o, p = new Path2D();
      addBar(p, x + lw / 2, y + lw / 2, Math.max(0, w2 - lw), Math.max(0, h - lw), cap);
      g.globalAlpha = o; g.strokeStyle = '#fff'; g.lineWidth = lw; g.stroke(p); g.globalAlpha = 1;
    }
  } else if (vizMode === 'circular') {
    // ring centred on the canvas; bass at the top, mirrored left/right so it looks symmetric
    const R = circRadius, len = Math.max(MINH + 2, Math.min(circLength, CIRC_MAX - R));
    g.strokeStyle = vizFill; g.lineWidth = circWidth; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < circCount; i++) {
      const f = i / circCount, sym = !circSym ? f : f < 0.5 ? f * 2 : (1 - f) * 2;   // asymmetric = the normal bar order wrapped around the circle
      const v = vals[Math.min(N - 1, Math.round(sym * (N - 1)))];
      const a = -Math.PI / 2 + f * 2 * Math.PI, l = MINH + v * (len - MINH);
      g.moveTo(CIRC_CX + Math.cos(a) * R, CIRC_CY + Math.sin(a) * R);
      g.lineTo(CIRC_CX + Math.cos(a) * (R + l), CIRC_CY + Math.sin(a) * (R + l));
    }
    olStroke(null, circWidth + 4);
    g.save(); if (glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
    g.stroke(); g.restore(); g.lineCap = 'butt';
  } else if (vizMode === 'mirrored') {
    const cnt = mirCount, gap = Math.max(1, Math.min(barGap * 1.5, barGap * N / cnt)), w = Math.max(1, (X1 - X0 - gap * (cnt - 1)) / cnt);
    const all = new Path2D();
    for (let i = 0; i < cnt; i++) {
      const f = cnt > 1 ? i / (cnt - 1) * (N - 1) : 0, a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);   // interpolate between the 63 analysed bands
      const h = (MINH + v * (MAXH - MINH)) / 2, x = X0 + i * (w + gap);
      addBar(all, x, MID - h, w, h * 2, true);   // one shape per bar = no seam in the middle
    }
    g.save();
    if (glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
    g.fillStyle = vizFill; g.fill(all);
    olStroke(all, 2);
    g.restore();
  } else if (vizMode === 'wave') {
    // Smooth Wave: one flowing glowing curve through all bands, with a soft fill underneath
    const K = waveDetail, pts = [];
    for (let j = 0; j <= K; j++) {
      const f = j / K * (N - 1), a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);
      pts.push([X0 + (X1 - X0) * j / K, BASE - (MINH + v * (MAXH - MINH))]);
    }
    const line = new Path2D(); line.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < K; j++) line.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2);
    line.lineTo(pts[K][0], pts[K][1]);
    const area = new Path2D(line); area.lineTo(X1, BASE); area.lineTo(X0, BASE); area.closePath();
    g.save();
    g.globalAlpha = waveFill; g.fillStyle = vizFill; if (waveFill > 0) g.fill(area);
    g.globalAlpha = 1; g.strokeStyle = vizFill; g.lineWidth = waveWidth; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = (14 + bass * 30 + glowBars * glowBlur) * waveGlow;
    olStroke(line, waveWidth + 4);
    g.stroke(line);
    g.restore();
  } else if (vizMode === 'wavemir') {
    // Mirrored Smooth Wave: the same flowing curve above and below a centre line
    const K = waveDetail, top = [], bot = [];
    for (let j = 0; j <= K; j++) {
      const f = j / K * (N - 1), a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);
      const h = (MINH + v * (MAXH - MINH)) / 2, x = X0 + (X1 - X0) * j / K;
      top.push([x, MID - h]); bot.push([x, MID + h]);
    }
    const seg = (p, pts) => {
      for (let j = 1; j < K; j++) p.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2);
      p.lineTo(pts[K][0], pts[K][1]);
    };
    const body = new Path2D(); body.moveTo(top[0][0], top[0][1]); seg(body, top); body.lineTo(bot[K][0], bot[K][1]); seg(body, bot.slice().reverse()); body.closePath();
    const tl = new Path2D(); tl.moveTo(top[0][0], top[0][1]); seg(tl, top);
    const bl = new Path2D(); bl.moveTo(bot[0][0], bot[0][1]); seg(bl, bot);
    g.save();
    g.globalAlpha = waveFill; g.fillStyle = vizFill; if (waveFill > 0) g.fill(body);
    g.globalAlpha = 1; g.strokeStyle = vizFill; g.lineWidth = waveWidth; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = (14 + bass * 30 + glowBars * glowBlur) * waveGlow;
    olStroke(tl, waveWidth + 4); olStroke(bl, waveWidth + 4);
    g.stroke(tl); g.stroke(bl);
    g.restore();
  } else if (vizMode === 'dots') {
    // LED Matrix: columns of round lights; optional slowly falling peak dot (gravity)
    const cnt = dotsCount, R = 14, rp = MAXH / R, pitch = (X1 - X0 - 18) / Math.max(1, cnt - 1), rad = Math.min(8.5, rp * 0.32, pitch * 0.34);
    const lit = new Path2D(), dim = new Path2D(), pk = new Path2D();
    for (let i = 0; i < cnt; i++) {
      const f = cnt > 1 ? i / (cnt - 1) * (N - 1) : 0, a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);
      const x = X0 + 9 + i * pitch, on = Math.round(v * R);
      for (let r = 0; r < R; r++) {
        const y = BASE - (r + 0.5) * rp, path = r < on ? lit : dim;
        path.moveTo(x + rad, y); path.arc(x, y, rad, 0, 6.283);
      }
      if (dotsPeak) {
        peaks[i] = Math.max(v, peaks[i] - 0.35 * mdt);
        const pr = Math.min(R - 1, Math.round(peaks[i] * R));
        if (pr >= on) { const y = BASE - (pr + 0.5) * rp; pk.moveTo(x + rad, y); pk.arc(x, y, rad, 0, 6.283); }
      }
    }
    g.fillStyle = vizFill;
    g.globalAlpha = 0.1; g.fill(dim);
    g.globalAlpha = 1;
    g.save(); if (glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
    g.fill(lit);
    olStroke(lit, 1.5);
    g.restore();
    if (dotsPeak) { g.globalAlpha = 0.85; g.fill(pk); }
    g.globalAlpha = 1;
  } else if (vizMode === 'ridge') {
    // Ridgeline: the last moments of the spectrum, stacked back to front, scrolling away smoothly
    const HZ = 14, step = ridgeStep, amp = ridgeAmp;
    ridgeAcc += mdt;
    if (ridgeAcc >= 1 / HZ) { ridgeAcc = Math.min(ridgeAcc - 1 / HZ, 1 / HZ); ridgeHist.unshift(ridgePaths(vals, amp)); }
    while (ridgeHist.length > ridgeRows - 1) ridgeHist.pop();   // also trims the history when the Rows slider goes down
    const phase = Math.min(1, ridgeAcc * HZ);   // how far the rows have slid toward the next slot
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = vizFill;
    const drawRow = (rp, by, fade, glow) => {   // glow = the front line only: a glow on every row would be far too heavy
      g.save(); g.translate(0, by);
      g.save(); g.clip(rp.area);   // body = an exact copy of the backdrop (colour, gradient, image, pulse): hides the rows behind, adds no colour of its own
      g.globalAlpha = 1; g.setTransform(frameBase); g.drawImage(ridgeBG, 0, 0);   // the backdrop copy stays put: no offset, no stretch
      g.restore();
      olStroke(rp.curve, (3 + 1.5 * fade) * ridgeLine, fade);
      if (glow && glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
      g.globalAlpha = fade; g.lineWidth = (1.5 + 1.5 * fade) * ridgeLine; g.stroke(rp.curve);
      g.restore();
    };
    for (let j = ridgeHist.length - 1; j >= 0; j--) {
      const pos = j + phase;
      drawRow(ridgeHist[j], BASE - pos * step, Math.pow(Math.max(0, 1 - pos / (ridgeRows - 1)), 0.8));
    }
    drawRow(ridgePaths(vals, amp), BASE, 1, true);
    g.globalAlpha = 1;
  }

  drawParticles(mdt);

  g.restore();
  }

  // Cover artwork: bottom-left normally, centred inside the ring in circular mode (styled in the Cover group)
  const circ = vizMode === 'circular', C = coverCfg;
  const bs = (circ ? Math.round(circRadius * 0.95) : 192) * C.size / 100;   // base side before the bass pulse; circular: a bit under the ring radius, so the cover sits well inside the bars
  const ccx = circ ? CIRC_CX + C.x : X0 + bs / 2 + C.x, ccy = (circ ? CIRC_CY : 689) + C.y;   // default: left edge on the bars' left edge, vertically centred as in the original layout
  coverSpot = C.on ? { x: ccx - bs / 2, y: ccy - bs / 2, s: bs } : null;
  const coverRight = ccx + bs / 2;   // unpulsed right edge: attached text hangs off this, so it doesn't jitter with the bass
  if (C.on) {
    const cs = bs * (bassPulse ? 1 + bass * pulseAmt : 1), cx = ccx - cs / 2, cy = ccy - cs / 2, S = Math.max(2, Math.ceil(cs));
    const coverGrad = (cxt, x, y, s) => {
      const gr = cxt.createLinearGradient(x, y, x + s, y + s);
      if (rainbow) for (let k = 0; k <= 12; k++) gr.addColorStop(k / 12, `hsl(${(rbOffset + k * 30) % 360} 100% 55%)`);
      else { gr.addColorStop(0, c1); gr.addColorStop(1, c2); }
      return gr;
    };
    // 1) the cover itself, clipped to its shape, in its own buffer
    if (coverBuf.width !== S) { coverBuf.width = S; coverBuf.height = S; } else bx.clearRect(0, 0, S, S);
    bx.save(); bx.clip(coverShapePath(0, 0, cs));
    const cvSrc = coverImg && coverImg.isGif ? coverImg.cur : coverImg;
    if (cvSrc) {
      const iw = cvSrc.width, ih = cvSrc.height;
      if (C.fit === 'fit') {   // whole image, black bars where it doesn't fill the shape
        const k = Math.min(cs / iw, cs / ih), dw = iw * k, dh = ih * k;
        bx.fillStyle = '#000'; bx.fillRect(0, 0, cs, cs);
        bx.drawImage(cvSrc, (cs - dw) / 2, (cs - dh) / 2, dw, dh);
      } else {
        const sq = Math.min(iw, ih);
        bx.drawImage(cvSrc, (iw - sq) / 2, (ih - sq) / 2, sq, sq, 0, 0, cs, cs);
      }
    } else {
      bx.fillStyle = coverGrad(bx, 0, 0, cs); bx.fillRect(0, 0, cs, cs);
      if (C.note) {   // the note is white by default but gets an opposite-tone edge when its color is hard to read on the cover colors
        const noteOL = rainbow ? 0 : needOL(Math.min(crOf(C.noteColor, c1), crOf(C.noteColor, c2)));
        bx.font = `800 ${cs * 0.573}px Montserrat`; bx.textAlign = 'center';
        if (noteOL > 0) { bx.save(); bx.globalAlpha = noteOL; bx.strokeStyle = inkFor(C.noteColor); bx.lineWidth = Math.max(3, cs * 0.035); bx.lineJoin = 'round'; bx.strokeText('♪', cs / 2, cs * 0.703); bx.restore(); }
        bx.fillStyle = C.noteColor; bx.fillText('♪', cs / 2, cs * 0.703); bx.textAlign = 'left';
      }
    }
    bx.restore();
    // 2) onto the frame: glow and drop shadow first (shadow-only passes: the picture itself is thrown far off-canvas and only its shadow lands here), then the cover once, so opacity never stacks
    const full = coverShapePath(cx, cy, cs), FAR = 10000;
    g.save(); g.globalAlpha = C.opacity;
    const shadowPass = (col, blur, sx, sy) => { g.save(); g.shadowColor = col; g.shadowBlur = blur; g.shadowOffsetX = FAR + sx; g.shadowOffsetY = sy; g.drawImage(coverBuf, cx - FAR, cy); g.restore(); };
    if (glowCover > 0) shadowPass(glowCol(Math.min(1, glowCover)), glowBlur, 0, 0);
    if (C.shOp > 0) { const sc = rgbOf(C.shColor); shadowPass(`rgba(${sc[0]},${sc[1]},${sc[2]},${C.shOp})`, C.shBlur, C.shX, C.shY); }
    g.drawImage(coverBuf, cx, cy);
    g.restore();
    // 3) border (inside the edge) or, without one, the contrast outline for a placeholder that blends into the background
    if (C.bw > 0) {
      g.save(); g.globalAlpha = C.opacity; g.clip(full);
      g.strokeStyle = C.bmatch ? coverGrad(g, cx, cy, cs) : C.bcolor; g.lineWidth = C.bw * 2; g.lineJoin = 'round'; g.stroke(full);
      g.restore();
    } else if (!coverImg) olStroke(full, 4, C.opacity, outlineCover);
  }

  // text: styled in the Text group. Right of the cover normally, centred under the ring in circular mode
  const T = textCfg, ts = T.size / 100;
  const artist = $('artist').value.toUpperCase(), title = $('title').value.toUpperCase(), extra = $('extra').value.trim().toUpperCase();
  const three = !!extra, wt = TEXT_WEIGHTS[T.weight] || TEXT_WEIGHTS.default;
  // Text left edge: hangs off the cover's right edge (attached), stays at the original spot (independent), or takes the cover's place when it is hidden. Circular: always under the ring.
  const tL = circ ? X0 : !C.on ? X0 : C.attach ? Math.min(coverRight + 36, X1 - 200) : 403;
  const attachDy = !circ && C.on && C.attach ? C.y : 0;   // the text also follows the cover up and down
  const maxW = circ ? 1500 : X1 - tL;
  const algn = T.align === 'auto' ? (circ ? 'center' : 'left') : T.align;
  const ax = (circ ? { left: X0, center: CIRC_CX, right: X1 } : { left: tL, center: (tL + X1) / 2, right: X1 })[algn] + T.x;
  const yy = circ ? (three ? [925, 975, 1025] : [945, 1005]) : (three ? [666, 716, 762] : [698, 753]);   // baselines of the original layout
  const lineY0 = i => yy[0] + (yy[i] - yy[0]) * ts;                                                       // spacing between lines grows with the size
  const yShift = circ ? Math.min(0, 1062 - lineY0(three ? 2 : 1)) : 0;                                     // circular: big text must not run off the bottom (the Y offset below can still move it)
  const lineY = i => lineY0(i) + yShift + T.y + attachDy;
  const sp = T.space / 100, shRGB = rgbOf(T.shColor);
  g.fillStyle = T.match ? vizFill : T.color; g.textBaseline = 'alphabetic'; g.textAlign = algn;
  const tol = !outlineText ? 0 : T.match ? ol : needOL(Math.min(...bgRefs.map(b => crOf(T.color, b))));   // text outline only when the text would be hard to read (rainbow text is judged via ol)
  const drawLine = (txt, y) => {
    let drawn = false;
    if (tol > 0) { g.save(); g.globalAlpha = tol; g.lineJoin = 'round'; if (twoTone) { g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeText(txt, ax, y); } g.strokeStyle = olCol; g.lineWidth = 6; g.strokeText(txt, ax, y); g.restore(); }
    if (T.shOp > 0) {   // drop shadow
      g.save(); g.shadowColor = `rgba(${shRGB[0]},${shRGB[1]},${shRGB[2]},${T.shOp})`; g.shadowBlur = T.shBlur; g.shadowOffsetX = T.shX; g.shadowOffsetY = T.shY;
      g.fillText(txt, ax, y); g.restore(); drawn = true;
    }
    if (glowText > 0 || !drawn) {   // glow (and the plain text when there is no shadow)
      g.save(); if (glowText > 0) { g.shadowColor = glowCol(Math.min(1, glowText)); g.shadowBlur = glowBlur; }
      g.fillText(txt, ax, y); g.restore();
    }
  };
  if (T.on) {   // 'Show text' off: the lines are laid out above but nothing is drawn
    fitText(artist, wt[0], (three ? 70 : 82) * ts, maxW, (three ? 0 : -0.01) + sp); drawLine(artist, lineY(0));
    fitText(title, wt[1], (three ? 48 : 51) * ts, maxW, (three ? 0.015 : 0) + sp); drawLine(title, lineY(1));
    if (extra) { fitText(extra, wt[1], 48 * ts, maxW, 0.015 + sp); drawLine(extra, lineY(2)); }
  }
  g.textAlign = 'left';
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (expCanvas && recActive()) { expCtx.imageSmoothingQuality = 'high'; expCtx.drawImage(cv, 0, 0, expCanvas.width, expCanvas.height); }   // scaled copy for the chosen export resolution
  drawBandGraph();
  requestAnimationFrame(frame);
}

// --- Snapshot Screenshot Export ---
$('snapshotBtn').onclick = () => {
  const dataUrl = cv.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = ($('title').value || 'visualizer') + '-snapshot.png';
  a.click();
};

// --- Video Export via MediaRecorder ---
const REC_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const recActive = () => mediaRecorder && mediaRecorder.state !== 'inactive';
let recWasHidden = false;   // browsers throttle background tabs, which makes a real-time recording drop frames
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (recActive()) recWasHidden = true; return; }
  if (recWasHidden && recActive()) notify('This tab was in the background while recording, so the video may have dropped frames. Keep the tab visible until a recording finishes.', true);
  recWasHidden = false;
});
const EXPORT_FORMATS = [['WebM (VP9)', 'video/webm;codecs=vp9,opus'], ['WebM (VP8)', 'video/webm;codecs=vp8,opus'], ['WebM (browser default)', 'video/webm'],
  ['MP4 (H.264)', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'], ['MP4 (browser default)', 'video/mp4'], ['WebM (AV1)', 'video/webm;codecs=av1,opus']];
if (typeof MediaRecorder !== 'undefined') {   // only offer what this browser can actually record; the first one is the default
  EXPORT_FORMATS.forEach(([name, type]) => { if (MediaRecorder.isTypeSupported(type)) { const o = document.createElement('option'); o.value = type; o.textContent = name; $('expFormat').appendChild(o); } });
}
if (!$('expFormat').options.length) $('expFormat').innerHTML = '<option value="">Browser default</option>';
function recSync() {   // recording follows playback: paused song = paused recording (live input never pauses it)
  if (!recActive()) return;
  try {
    if (isActive() && mediaRecorder.state === 'paused') mediaRecorder.resume();
    else if (!isActive() && mediaRecorder.state === 'recording') mediaRecorder.pause();
  } catch (e) { }
  $('recBtn').classList.toggle('paused', mediaRecorder.state === 'paused');
}
function stopRecording(msg) {
  if (!recActive()) return;
  recNote = msg || 'Recording stopped. Video saved.';
  try { mediaRecorder.stop(); } catch (e) { }
}
function recCleanup() {
  $('recBtn').classList.remove('rec', 'paused');
  try { if (outGain && recDest) outGain.disconnect(recDest); } catch (e) { }
  try { if (liveSrc && recDest) liveSrc.disconnect(recDest); } catch (e) { }
  recDest = null; expCanvas = null; expCtx = null;
}
$('recBtn').onclick = () => {
  if (recActive()) { stopRecording(); return; }
  if (!buf && !liveMode) { notify('Load a song first, then press play and start recording.', true); return; }
  if (!isActive()) { notify('Press play first, then start recording.', true); return; }
  if (typeof MediaRecorder === 'undefined' || !cv.captureStream) { notify('Video export is not supported in this browser.', true); return; }
  let stream = null;   // outer scope: the catch below can always stop it, even if setup throws before finish() exists
  try {
    const [expW, expH] = $('expRes').value.split('x').map(Number), expFps = +$('expFps').value;
    let capCanvas = cv; expCanvas = expCtx = null;
    if (expW !== cv.width || expH !== cv.height) { expCanvas = document.createElement('canvas'); expCanvas.width = expW; expCanvas.height = expH; expCtx = expCanvas.getContext('2d'); capCanvas = expCanvas; }
    stream = capCanvas.captureStream(expFps);
    recDest = ctx.createMediaStreamDestination();
    outGain.connect(recDest);   // export follows the volume slider / mute, and survives seeks (new sources feed outGain)
    recDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    if (liveSrc) liveSrc.connect(recDest);   // live input is recorded too
    const type = $('expFormat').value || REC_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    const ext = type && type.includes('mp4') ? 'mp4' : 'webm';
    recChunks = [];
    const bps = Math.min(40e6, Math.max(2e6, Math.round(8e6 * expW * expH / (1920 * 1080) * (expFps > 30 ? 1 : 0.7))));   // ~8 Mbit/s at 1080p60, scaled by size and rate
    mediaRecorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: bps, audioBitsPerSecond: +$('expAudioBr').value});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
    const rec = mediaRecorder; let finished = false;
    const finish = save => {   // the single finalisation path for stop, error and song end; runs once
      if (finished) return false; finished = true;
      recCleanup(); stream.getTracks().forEach(t => t.stop());
      if (!save || !recChunks.length) return false;
      const blob = new Blob(recChunks, { type: rec.mimeType || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (($('title').value || 'visualizer').replace(/[\\/:*?"<>|]/g, '_')) + '.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return true;
    };
    rec.onerror = e => {   // partial recordings are discarded on error
      finish(false);
      try { if (rec.state !== 'inactive') rec.stop(); } catch (_) { }
      notify('Recording failed: ' + ((e.error && e.error.message) || 'unknown error'), true);
    };
    rec.onstop = () => { const was = finished; if (finish(true)) notify(recNote); else if (!was) notify('Recording stopped, but no video data was captured.', true); };
    rec.start();
    $('recBtn').classList.add('rec');
    const kb = Math.round((rec.audioBitsPerSecond || 0) / 1000), mb = ((rec.videoBitsPerSecond || 0) / 1e6).toFixed(1);
    console.info('Recorder:', rec.mimeType, 'audio bps', rec.audioBitsPerSecond, 'video bps', rec.videoBitsPerSecond);
    notify(`Recording (${rec.mimeType || 'browser default'}; browser reports audio ${kb || '?'} kbps, video ${mb} Mbit/s). Pausing the song pauses the recording. Click the camera button again to stop and save.`);
  } catch (err) { recCleanup(); if (stream) stream.getTracks().forEach(t => t.stop()); mediaRecorder = null; notify('Video recording error: ' + err.message, true); }
};

// --- Settings: one set of functions shared by presets, randomize, export and import ---
function setCtl(id, v) {   // set a control and fire its normal handler
  const el = $(id);
  if (!el || v === undefined || v === null) return;
  if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change', { bubbles: true }));
}
function setPickerHex(which, hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  Object.assign(pickerState[which], hexToHsv(hex), { hex: hex.toLowerCase() });   // in place: the hex / RGB fields hold a reference to this object
  updatePicker(which);
}
const wrapDeg = a => ((a % 360) + 360) % 360;
function getSettings(withText) {
  return {
    ...(withText ? { artist: $('artist').value, title: $('title').value, extra: $('extra').value } : {}),
    main: visualColor, end: gradientColor, bg: backgroundColor, bgEnd: backgroundEndColor,
    useGrad: useGradient, useBgGrad: useBgGradient, bgAngle, overlay: overlayColors, autoCycle: autoColorCycle,
    cycleSpeed, rainbow: { on: rainbow, move: rbMove, dir: rbDir, speed: rbSpeed },
    mode: vizMode, circ: { radius: circRadius, length: circLength, width: circWidth, count: circCount, sym: circSym }, mir: { count: mirCount }, dots: { count: dotsCount, peak: dotsPeak },
    wave: { width: waveWidth, fill: waveFill, glow: waveGlow, detail: waveDetail }, ridge: { rows: ridgeRows, step: ridgeStep, amp: ridgeAmp, line: ridgeLine },
    bars: { shape: barShape, round: barRound, gap: barGap }, glow: { blur: glowBlur, bars: glowBars, cover: glowCover, text: glowText },
    bassPulse, pulseAmt, bgReactive: bgAudioReactive, bgPulse: bgPulseAmt, lockOverlay, sens,
    outlines: { viz: outlineViz, cover: outlineCover, text: outlineText }, viz: { ...vizCfg },
    stars: { ...starCfg }, particles: { ...partCfg }, text: { ...textCfg }, cover: { ...coverCfg }, bands: { ...bandCfg }
  };
}
function applySettings(p) {
  ['artist', 'title', 'extra'].forEach(k => { if (typeof p[k] === 'string') $(k).value = p[k]; });
  setPickerHex('main', p.main); setPickerHex('end', p.end); setPickerHex('bg', p.bg); setPickerHex('bgEnd', p.bgEnd);
  setCtl('gradient', p.useGrad); setCtl('bgGradient', p.useBgGrad);
  setCtl('overlayColors', p.overlay); setCtl('lockOverlay', p.lockOverlay); setCtl('autoColorCycle', p.autoCycle);
  if (typeof p.bgAngle === 'number') { bgAngle = wrapDeg(p.bgAngle); updateDial(); }
  setCtl('cycleSpeed', p.cycleSpeed);
  const rb = p.rainbow;
  if (rb) { setCtl('rainbow', rb.on); setCtl('rbMove', rb.move); setCtl('rbDir', rb.dir); setCtl('rbSpeed', rb.speed); }
  if (p.mode) setMode(p.mode);
  const c = p.circ || {};
  setCtl('circRadius', c.radius); setCtl('circLength', c.length); setCtl('circWidth', c.width); setCtl('circCount', c.count); setCtl('circSym', c.sym);
  setCtl('mirCount', (p.mir || {}).count); setCtl('dotsCount', (p.dots || {}).count); setCtl('dotsPeak', (p.dots || {}).peak);
  const wv = p.wave || {}, rd = p.ridge || {};
  setCtl('waveWidth', wv.width); setCtl('waveFill', wv.fill); setCtl('waveGlow', wv.glow); setCtl('waveDetail', wv.detail);
  setCtl('ridgeRows', rd.rows); setCtl('ridgeStep', rd.step); setCtl('ridgeAmp', rd.amp); setCtl('ridgeLine', rd.line);
  const vz = p.viz || {};
  setCtl('vizOn', vz.on); setCtl('vizX', vz.x); setCtl('vizY', vz.y); setCtl('vizW', vz.w);
  const ou = p.outlines || {};
  setCtl('outlineViz', ou.viz); setCtl('outlineCover', ou.cover); setCtl('outlineText', ou.text);
  const bs = p.bars || {}, gl = p.glow || {};
  setCtl('barShape', bs.shape); setCtl('barRound', bs.round); setCtl('barGap', bs.gap);
  setCtl('glowBlur', gl.blur); setCtl('glowBars', gl.bars); setCtl('glowCover', gl.cover); setCtl('glowText', gl.text);
  setCtl('bassPulse', p.bassPulse); setCtl('pulseAmt', p.pulseAmt); setCtl('bgAudioReactive', p.bgReactive); setCtl('bgPulseAmt', p.bgPulse); setCtl('sens', p.sens);
  const st = p.stars;
  if (st) {
    setCtl('starsOn', st.on); setCtl('starDensity', st.count); setCtl('starSpeed', st.speed);
    setCtl('starBoost', st.boost); setCtl('starFlash', st.flash); setCtl('starLight', st.light); setCtl('starColor', st.color);
    if (typeof st.angle === 'number') { starCfg.angle = wrapDeg(st.angle); updateStarDial(); }
  }
  const q = p.particles;
  if (q) { setCtl('partOn', q.on); setCtl('partCount', q.count); setCtl('partSize', q.size); setCtl('partSpeed', q.speed); setCtl('partSens', q.sens); }
  const tx = p.text;
  if (tx) {
    setCtl('textOn', tx.on); setCtl('textFont', tx.font); setCtl('textWeight', tx.weight); setCtl('textAlign', tx.align);
    setCtl('textSize', tx.size); setCtl('textSpace', tx.space); setCtl('textX', tx.x); setCtl('textY', tx.y);
    setCtl('textColor', tx.color); setCtl('textMatch', tx.match);
    setCtl('textShOp', tx.shOp); setCtl('textShBlur', tx.shBlur); setCtl('textShX', tx.shX); setCtl('textShY', tx.shY); setCtl('textShColor', tx.shColor);
  }
  const bd = p.bands;
  if (bd) {
    setCtl('bandLo', bd.lo); setCtl('bandHi', bd.hi); setCtl('bandSpacing', bd.spacing);
    setCtl('bandTilt', bd.tilt); setCtl('bandPivot', bd.pivot); setCtl('bandCap', bd.cap); setCtl('bandLowCut', bd.lowCut);
    setCtl('bandSmooth', bd.smooth); setCtl('bandAttack', bd.attack); setCtl('bandDecay', bd.decay); setCtl('bandFloor', bd.floor); setCtl('bandGamma', bd.gamma);
  }
  const cvr = p.cover;
  if (cvr) {
    setCtl('coverOn', cvr.on); setCtl('coverShape', cvr.shape); setCtl('coverFit', cvr.fit); setCtl('coverAttach', cvr.attach);
    setCtl('coverSize', cvr.size); setCtl('coverX', cvr.x); setCtl('coverY', cvr.y); setCtl('coverRadius', cvr.radius); setCtl('coverOpacity', cvr.opacity);
    setCtl('coverBw', cvr.bw); setCtl('coverBorderColor', cvr.bcolor); setCtl('coverBorderMatch', cvr.bmatch);
    setCtl('coverShOp', cvr.shOp); setCtl('coverShBlur', cvr.shBlur); setCtl('coverShX', cvr.shX); setCtl('coverShY', cvr.shY); setCtl('coverShColor', cvr.shColor);
    setCtl('coverNote', cvr.note); setCtl('coverNoteColor', cvr.noteColor);
  }
  updateOverlayTheme(); updateSliders();
}

const DEFAULTS = getSettings(true);   // snapshot of the starting look: used by Reset and as the base of every preset
const PRESET_INFO = {   // [display name, short description]
  default: ['Default Nebula', 'The original yellow look.'],
  cyberpunk: ['Cyberpunk Neon', 'Cyan and magenta ring on near-black.'],
  sunset: ['Sunset Vibes', 'Warm orange to pink, mirrored bars.'],
  monochrome: ['Minimal Mono', 'White on black, nothing else.'],
  cinematic: ['Cinematic', 'Warm gold and rust, slow drifting stars, restrained motion.'],
  neon: ['Neon Ring', 'Electric green and cyan ring, dense fast stars, strong bursts.'],
  chillwave: ['Chillwave', 'Soft cyan and pink on purple, gentle waveform.'],
  synthwave: ['Synthwave', 'Hot pink and cyan bars on deep purple, stars flying down.'],
  minimal: ['Clean Minimal', 'Plain white bars, no stars, no particles, no pulsing.'],
  darkclub: ['Dark Club', 'Red and violet ridgeline, heavy bass flashes and particles.'],
  ledmatrix: ['LED Matrix', 'Green to amber lights on black, with falling peak dots.'],
  ledamber: ['Amber Console', 'Orange to red LED columns on warm black, a vintage VU wall.'],
  aurora: ['Aurora Wave', 'Mirrored smooth wave in green and violet, soft fill and glow.'],
  emberwave: ['Ember Mirror', 'Mirrored smooth wave in amber and rose over dark red.']
};
const PRESETS = {
  default: { main: '#f2d90a', end: '#ff6a00', bg: '#000000', bgEnd: '#1a0b3d', useGrad: false, useBgGrad: true, mode: 'bars' },
  cyberpunk: { main: '#00f0ff', end: '#ff0055', bg: '#05020a', bgEnd: '#150526', useGrad: true, useBgGrad: true, mode: 'circular' },
  sunset: { main: '#ff7700', end: '#ff00aa', bg: '#100514', bgEnd: '#320d3e', useGrad: true, useBgGrad: true, mode: 'mirrored' },
  monochrome: { main: '#ffffff', end: '#888888', bg: '#000000', bgEnd: '#111111', useGrad: true, useBgGrad: true, mode: 'bars' },
  cinematic: {
    main: '#e9c46a', end: '#e76f51', bg: '#050403', bgEnd: '#1c130b', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'mirrored', mir: { count: 80 },
    sens: 0.9, bassPulse: true, pulseAmt: 0.05, bgReactive: false,
    stars: { on: true, count: 140, speed: 0.35, boost: 3, flash: true, light: 0.6, angle: 270 }, particles: { on: true, count: 18, size: 2.5, speed: 0.6, sens: 0.6 }
  },
  neon: {
    main: '#39ff14', end: '#00e5ff', bg: '#020308', bgEnd: '#06122b', useGrad: true, useBgGrad: true, bgAngle: 200, mode: 'circular',
    circ: { radius: 210, length: 200, width: 6, count: 96, sym: true }, overlay: true, sens: 1.1, pulseAmt: 0.12, bgReactive: true, bgPulse: 0.2,
    stars: { on: true, count: 320, speed: 1.4, boost: 12, flash: true, light: 1.4, angle: 270 }, particles: { on: true, count: 70, size: 3, speed: 1.3, sens: 1 }
  },
  chillwave: {
    main: '#7df9ff', end: '#ff9ad5', bg: '#1b1035', bgEnd: '#3a1c71', useGrad: true, useBgGrad: true, bgAngle: 160, mode: 'wave', sens: 0.9, pulseAmt: 0.06,
    stars: { on: true, count: 180, speed: 0.5, boost: 4, flash: true, light: 0.8, angle: 300 }, particles: { on: true, count: 22, size: 4, speed: 0.6, sens: 0.7 }
  },
  synthwave: {
    main: '#ff2a6d', end: '#05d9e8', bg: '#0b0221', bgEnd: '#2b0a4a', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'bars', overlay: true, sens: 1.1, bgReactive: true, bgPulse: 0.15,
    stars: { on: true, count: 220, speed: 0.9, boost: 8, flash: true, light: 1, angle: 180 }, particles: { on: true, count: 45, size: 3, speed: 1, sens: 1 }
  },
  minimal: {
    main: '#ffffff', end: '#ffffff', useGrad: false, bg: '#0a0a0a', bgEnd: '#0a0a0a', useBgGrad: false, mode: 'bars', bassPulse: false, bgReactive: false, sens: 1,
    stars: { on: false }, particles: { on: false }
  },
  darkclub: {
    main: '#ff0033', end: '#7a00ff', bg: '#000000', bgEnd: '#14001f', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'ridge', sens: 1.15, pulseAmt: 0.1, bgReactive: true, bgPulse: 0.25,
    stars: { on: true, count: 100, speed: 0.7, boost: 10, flash: true, light: 1.2, angle: 90 }, particles: { on: true, count: 90, size: 3, speed: 1.2, sens: 1 }
  },
  ledmatrix: {
    main: '#19ff6b', end: '#ffd400', bg: '#020503', bgEnd: '#0a1a10', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'dots',
    dots: { count: 48, peak: true }, glow: { blur: 16, bars: 0.55, cover: 0, text: 0 }, sens: 1.1, bassPulse: false, bgReactive: false,
    stars: { on: false }, particles: { on: false }
  },
  ledamber: {
    main: '#ffa200', end: '#ff2d00', bg: '#0b0502', bgEnd: '#1c0b03', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'dots',
    dots: { count: 32, peak: true }, glow: { blur: 20, bars: 0.5, cover: 0.2, text: 0.15 }, sens: 1, bassPulse: true, pulseAmt: 0.05, bgReactive: false,
    stars: { on: true, count: 80, speed: 0.4, boost: 3, flash: true, light: 0.5, angle: 90 }, particles: { on: false }
  },
  aurora: {
    main: '#3dffb0', end: '#8a5cff', bg: '#04101c', bgEnd: '#0e0a2e', useGrad: true, useBgGrad: true, bgAngle: 180, mode: 'wavemir',
    wave: { width: 5, fill: 0.35, glow: 1, detail: 170 }, glow: { blur: 26, bars: 0.45, cover: 0.25, text: 0.2 }, sens: 0.95, pulseAmt: 0.06, bgReactive: false,
    stars: { on: true, count: 200, speed: 0.4, boost: 3, flash: true, light: 0.8, angle: 270 }, particles: { on: true, count: 20, size: 3, speed: 0.5, sens: 0.6 }
  },
  emberwave: {
    main: '#ffb347', end: '#ff3c78', bg: '#12040a', bgEnd: '#2b0a14', useGrad: true, useBgGrad: true, bgAngle: 160, mode: 'wavemir',
    wave: { width: 7, fill: 0.22, glow: 0.9, detail: 140 }, glow: { blur: 22, bars: 0.4, cover: 0.2, text: 0.25 }, sens: 1.05, bgReactive: true, bgPulse: 0.12,
    stars: { on: true, count: 120, speed: 0.6, boost: 5, flash: true, light: 1, angle: 90 }, particles: { on: true, count: 35, size: 3, speed: 0.9, sens: 0.9 }
  }
};
{ const sel = $('presetSelect'); sel.innerHTML = ''; Object.entries(PRESET_INFO).forEach(([k, v]) => sel.add(new Option(v[0], k))); }
const NESTED = ['circ', 'rainbow', 'mir', 'dots', 'wave', 'ridge', 'bars', 'glow', 'stars', 'particles'];
// glow / bar-shape touches for some of the built-in looks
Object.assign(PRESETS.cyberpunk, { glow: { blur: 28, bars: 0.7, cover: 0.4, text: 0.3 } });
Object.assign(PRESETS.neon, { glow: { blur: 32, bars: 0.8, cover: 0.5, text: 0.4 } });
Object.assign(PRESETS.synthwave, { glow: { blur: 30, bars: 0.7, cover: 0.3, text: 0.5 }, bars: { shape: 'rounded', round: 5 } });
Object.assign(PRESETS.chillwave, { bars: { shape: 'capsule' } });
Object.assign(PRESETS.minimal, { bars: { shape: 'rounded', round: 3 } });
function applyPreset(key) {
  const p = PRESETS[key]; if (!p) return;
  const base = { ...DEFAULTS }; delete base.artist; delete base.title; delete base.extra; delete base.text; delete base.cover; delete base.bands; delete base.viz;   // presets never touch the text, cover, frequency range or visualizer position
  const m = { ...base, ...p };
  NESTED.forEach(k => { m[k] = { ...(base[k] || {}), ...(p[k] || {}) }; });
  applySettings(m);
  commitHistory();
  // shown only in the popup: the status line keeps describing the song
  const msg = isBuiltIn(key) ? `${PRESET_INFO[key][0]}: ${PRESET_INFO[key][1]}` : 'Preset applied.';
  const st = $('status').textContent; notify(msg); $('status').textContent = st;
}
$('presetSelect').onchange = e => applyPreset(e.target.value);

// Preset gallery: a small drawing of each look, built from the preset's own settings and the app's real layout constants
// (nothing is rendered live). Coordinates are canvas pixels * TS, so the drawing lines up with what the canvas will show:
// same horizontal colour gradient across the whole width (a ring therefore only shows the middle of it), cover and text below the visualizer, stars, glow.
const TS = 100 / 1920;
const thumbSpec = u => Math.min(1, 0.07 + 0.62 * Math.exp(-(((u - 0.28) / 0.1) ** 2)) + 0.45 * Math.exp(-(((u - 0.42) / 0.07) ** 2)) + 0.2 * Math.exp(-(((u - 0.62) / 0.1) ** 2)) + 0.05 * Math.sin(u * 61));   // a typical bass-heavy spectrum
const THUMB_STARS = (() => { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; return Array.from({ length: 70 }, () => [r() * 100, r() * 56.25, 0.18 + r() * 0.22, 0.35 + r() * 0.5]); })();
function presetThumb(key, uid) {
  const p = { ...DEFAULTS, ...PRESETS[key] }, a = p.main, b = p.useGrad ? p.end : p.main, m = p.mode, f = v => v.toFixed(2);
  const bg = p.useBgGrad ? `linear-gradient(${p.bgAngle}deg, ${p.bg}, ${p.bgEnd})` : p.bg;
  const gx0 = X0 * TS, gx1 = X1 * TS, base = BASE * TS, mid = MID * TS, maxh = MAXH * TS, minh = MINH * TS;
  let stops = `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>`;
  if (p.rainbow && p.rainbow.on) stops = Array.from({ length: 13 }, (_, k) => `<stop offset="${f(k / 12)}" stop-color="hsl(${k * 30} 100% 55%)"/>`).join('');
  const glowOn = m === 'wave' || m === 'wavemir' ? p.wave.glow > 0 : m !== 'ridge' && p.glow.bars > 0;
  const gs = f(Math.max(0.5, Math.min(2.4, p.glow.blur * TS * 1.1)));
  const defs = `<defs><linearGradient id="pg${uid}" gradientUnits="userSpaceOnUse" x1="${f(gx0)}" x2="${f(gx1)}" y1="0" y2="0">${stops}</linearGradient>` +
    `<linearGradient id="pc${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `<filter id="pf${uid}" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="${gs}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  const F = `url(#pg${uid})`; let viz = '';
  const circ = m === 'circular';
  if (m === 'bars' || m === 'mirrored') {
    const n = m === 'bars' ? 26 : 30, pitch = (gx1 - gx0) / n, w = pitch * (m === 'bars' ? 0.74 : 0.62), cap = m === 'mirrored' || p.bars.shape === 'capsule';
    const rx = cap ? w / 2 : p.bars.shape === 'rounded' ? Math.min(w / 2, 0.5) : 0;
    for (let i = 0; i < n; i++) {
      const h = minh + thumbSpec(i / (n - 1)) * (maxh - minh) * 0.9, x = gx0 + i * pitch;
      viz += m === 'bars' ? `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${F}"/>` : `<rect x="${f(x)}" y="${f(mid - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${F}"/>`;
    }
  } else if (m === 'wave' || m === 'wavemir') {
    const K = 48, sw = f(Math.max(0.8, p.wave.width * TS * 2.2)), top = [], bot = [];
    for (let j = 0; j <= K; j++) { const h = minh + thumbSpec(j / K) * (maxh - minh) * 0.9, x = gx0 + (gx1 - gx0) * j / K; if (m === 'wave') top.push([x, base - h]); else { top.push([x, mid - h / 2]); bot.push([x, mid + h / 2]); } }
    const line = pts => 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join(' L');
    if (m === 'wave') viz = `<path d="${line(top)} L${f(gx1)} ${f(base)} L${f(gx0)} ${f(base)}Z" fill="${F}" opacity="${p.wave.fill}"/><path d="${line(top)}" fill="none" stroke="${F}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else viz = `<path d="${line(top)} L${line(bot.slice().reverse()).slice(1)}Z" fill="${F}" opacity="${p.wave.fill}"/><path d="${line(top)}" fill="none" stroke="${F}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/><path d="${line(bot)}" fill="none" stroke="${F}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (m === 'dots') {
    const cols = 22, rows = 9, pitch = (gx1 - gx0 - 1) / (cols - 1), rp = maxh / rows, r = Math.min(pitch * 0.34, rp * 0.34);
    for (let i = 0; i < cols; i++) {
      const on = Math.round(thumbSpec(i / (cols - 1)) * rows * 0.9);
      for (let k = 0; k < rows; k++) viz += `<circle cx="${f(gx0 + 0.5 + i * pitch)}" cy="${f(base - (k + 0.5) * rp)}" r="${f(r)}" fill="${F}" opacity="${k < on ? 1 : 0.1}"/>`;
      if (p.dots.peak && on < rows) viz += `<circle cx="${f(gx0 + 0.5 + i * pitch)}" cy="${f(base - (Math.min(rows - 1, on + 1 + (i % 3)) + 0.5) * rp)}" r="${f(r)}" fill="${F}" opacity=".85"/>`;
    }
  } else if (m === 'ridge') {
    const rowsN = 7, step = p.ridge.step * TS * 1.5, bgc = p.bg;
    for (let r = rowsN - 1; r >= 0; r--) {
      const y = base - r * step; let d = `M${f(gx0)} ${f(y)}`;
      for (let i = 0; i <= 30; i++) { const u = i / 30; d += ` L${f(gx0 + (gx1 - gx0) * u)} ${f(y - thumbSpec(u) * 8 * (1 - r * 0.08))}`; }
      viz += `<path d="${d} L${f(gx1)} ${f(y)}Z" fill="${bgc}" stroke="${F}" stroke-width="0.45" opacity="${f(1 - r * 0.1)}"/>`;
    }
  } else if (circ) {
    const R = p.circ.radius, len = Math.max(MINH + 2, Math.min(p.circ.length, CIRC_MAX - R)), n = 56;
    for (let i = 0; i < n; i++) {
      const fr = i / n, sym = p.circ.sym ? (fr < 0.5 ? fr * 2 : (1 - fr) * 2) : fr, l = MINH + thumbSpec(sym) * (len - MINH) * 0.9, t = -Math.PI / 2 + fr * 2 * Math.PI;
      viz += `<line x1="${f((CIRC_CX + Math.cos(t) * R) * TS)}" y1="${f((CIRC_CY + Math.sin(t) * R) * TS)}" x2="${f((CIRC_CX + Math.cos(t) * (R + l)) * TS)}" y2="${f((CIRC_CY + Math.sin(t) * (R + l)) * TS)}" stroke="${F}" stroke-width="${f(Math.max(0.5, p.circ.width * TS * 1.5))}" stroke-linecap="round"/>`;
    }
  }
  viz = `<g${glowOn ? ` filter="url(#pf${uid})"` : ''}>${viz}</g>`;
  // stars: more stars = more dots
  let stars = '';
  if (p.stars.on) {
    const n = Math.max(6, Math.min(THUMB_STARS.length, Math.round(p.stars.count / 6))), sc = p.starColor || p.stars.color || 'white', col = sc === 'main' ? a : sc === 'gradient' ? b : '#fff';
    stars = THUMB_STARS.slice(0, n).map(s => `<circle cx="${f(s[0])}" cy="${f(s[1])}" r="${f(s[2])}" fill="${col}" opacity="${f(s[3])}"/>`).join('');
  }
  // cover art + title text, where the canvas puts them (ring: cover inside the ring, text centred below; others: cover and text under the bars)
  const cs = 10.2, cx = circ ? 50 - cs / 2 : gx0, cy = circ ? CIRC_CY * TS - cs / 2 : 31;
  const tx = circ ? 50 : cx + cs + 2.6, ty = circ ? 47.4 : 34.2, an = circ ? 'middle' : 'start', lx = circ ? tx - 7 : tx;
  const cover = `<rect x="${f(cx)}" y="${f(cy)}" width="${cs}" height="${cs}" fill="url(#pc${uid})"/><text x="${f(cx + cs / 2)}" y="${f(cy + cs * 0.72)}" font-size="6.5" text-anchor="middle" fill="#fff" font-family="sans-serif">♪</text>`;
  const text = `<rect x="${f(lx)}" y="${f(ty)}" width="14" height="2.1" rx=".4" fill="#fff" opacity=".95"/><rect x="${f(circ ? tx - 5 : tx)}" y="${f(ty + 3)}" width="10" height="1.3" rx=".3" fill="#fff" opacity=".8"/>`;
  return `<span class="thumb" style="background:${bg}"><svg viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden="true">${defs}${stars}${viz}${cover}${text}</svg></span>`;
}
function renderPresetGallery() {
  const box = $('presetGallery'); if (!box) return;
  box.innerHTML = '';
  Array.from($('presetSelect').options).forEach((o, i) => {
    if (!PRESETS[o.value]) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'preset-card'; btn.setAttribute('role', 'listitem'); btn.dataset.key = o.value;
    btn.title = PRESET_INFO[o.value] ? PRESET_INFO[o.value][1] : 'Custom preset';
    btn.innerHTML = presetThumb(o.value, i) + '<span class="name"></span>';
    btn.querySelector('.name').textContent = o.textContent;
    btn.onclick = () => { $('presetSelect').value = o.value; applyPreset(o.value); };
    box.append(btn);
  });
}
new MutationObserver(renderPresetGallery).observe($('presetSelect'), { childList: true });   // custom presets being saved or deleted
renderPresetGallery();

// custom presets = everything in PRESETS that is not built in; they are part of every undo step
const isBuiltIn = k => Object.prototype.hasOwnProperty.call(PRESET_INFO, k);
const customPresets = () => Object.fromEntries(Object.entries(PRESETS).filter(([k]) => !isBuiltIn(k)));
function restoreCustomPresets(saved) {
  const sel = $('presetSelect'), cur = sel.value;
  Object.keys(PRESETS).forEach(k => { if (!isBuiltIn(k)) delete PRESETS[k]; });
  Array.from(sel.options).forEach(o => { if (!isBuiltIn(o.value)) o.remove(); });
  Object.entries(saved).forEach(([k, v]) => { PRESETS[k] = v; sel.add(new Option(v.__name || k, k)); });
  sel.value = PRESETS[cur] ? cur : Object.keys(PRESET_INFO)[0];
}
$('savePresetBtn').onclick = () => {
  const name = (prompt('Enter preset name (max 40 characters):') || '').trim().slice(0, 40);
  if (!name) return;
  const low = name.toLowerCase(), key = 'u:' + low;   // prefix: a user name can never collide with a built-in key or an Object property
  if (isBuiltIn(low) || Object.values(PRESET_INFO).some(v => v[0].toLowerCase() === low)) { notify('That name belongs to a built-in preset. Choose another name.', true); return; }
  const isNew = !Object.prototype.hasOwnProperty.call(PRESETS, key);
  if (!isNew && !confirm(`A preset named "${name}" already exists. Replace it?`)) return;
  const snap = getSettings(false); delete snap.text; delete snap.cover; delete snap.bands;   // like the built-in presets, never include text, cover or frequency range
  snap.__name = name;   // display name, so undo/redo can rebuild the dropdown
  PRESETS[key] = snap;
  if (isNew) { const opt = document.createElement('option'); opt.value = key; opt.textContent = name; $('presetSelect').appendChild(opt); }
  $('presetSelect').value = key;
  commitHistory();   // saving / replacing a preset is an undo step
  notify(`Preset "${name}" saved. Undo (Ctrl+Z) removes it again.`);
};

$('exportJsonBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'nebula-visualizer', version: 2, ...getSettings(true) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (($('title').value || 'visualizer-project').replace(/[\\/:*?"<>|]/g, '_')) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  notify('Project settings exported (audio and images are not included).');
};

const num = (a, b) => v => { if (typeof v !== 'number' || !isFinite(v)) throw 0; return Math.min(b, Math.max(a, v)); };
const bool = v => { if (typeof v !== 'boolean') throw 0; return v; };
const hex = v => { if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw 0; return v; };
const str = v => { if (typeof v !== 'string') throw 0; return v.slice(0, 200); };
const oneOf = l => v => { if (!l.includes(v)) throw 0; return v; };
const rg = id => num(+$(id).min, +$(id).max), sel = id => oneOf(Array.from($(id).options).map(o => o.value));
const projectSchema = () => ({
  artist: str, title: str, extra: str, main: hex, end: hex, bg: hex, bgEnd: hex, useGrad: bool, useBgGrad: bool, bgAngle: num(0, 360), overlay: bool, autoCycle: bool, cycleSpeed: rg('cycleSpeed'),
  rainbow: { on: bool, move: bool, dir: oneOf([1, -1]), speed: rg('rbSpeed') }, mode: oneOf(MODES),
  circ: { radius: rg('circRadius'), length: rg('circLength'), width: rg('circWidth'), count: rg('circCount'), sym: bool }, mir: { count: rg('mirCount') }, dots: { count: rg('dotsCount'), peak: bool },
  wave: { width: rg('waveWidth'), fill: rg('waveFill'), glow: rg('waveGlow'), detail: rg('waveDetail') }, ridge: { rows: rg('ridgeRows'), step: rg('ridgeStep'), amp: rg('ridgeAmp'), line: rg('ridgeLine') },
  bars: { shape: sel('barShape'), round: rg('barRound'), gap: rg('barGap') }, glow: { blur: rg('glowBlur'), bars: rg('glowBars'), cover: rg('glowCover'), text: rg('glowText') },
  bassPulse: bool, pulseAmt: rg('pulseAmt'), bgReactive: bool, bgPulse: rg('bgPulseAmt'), lockOverlay: bool, sens: rg('sens'),
  outlines: { viz: bool, cover: bool, text: bool }, viz: { on: bool, x: rg('vizX'), y: rg('vizY'), w: rg('vizW') },
  stars: { on: bool, flash: bool, count: rg('starDensity'), speed: rg('starSpeed'), boost: rg('starBoost'), light: rg('starLight'), angle: num(0, 360), color: sel('starColor') },
  particles: { on: bool, count: rg('partCount'), size: rg('partSize'), speed: rg('partSpeed'), sens: rg('partSens') },
  bands: { lo: rg('bandLo'), hi: rg('bandHi'), spacing: rg('bandSpacing'), tilt: rg('bandTilt'), pivot: rg('bandPivot'), cap: rg('bandCap'), lowCut: rg('bandLowCut'),
    smooth: rg('bandSmooth'), attack: rg('bandAttack'), decay: rg('bandDecay'), floor: rg('bandFloor'), gamma: rg('bandGamma') },
  cover: { on: bool, shape: sel('coverShape'), fit: sel('coverFit'), attach: bool, size: rg('coverSize'), x: rg('coverX'), y: rg('coverY'), radius: rg('coverRadius'), opacity: rg('coverOpacity'),
    bw: rg('coverBw'), bcolor: hex, bmatch: bool, shOp: rg('coverShOp'), shBlur: rg('coverShBlur'), shX: rg('coverShX'), shY: rg('coverShY'), shColor: hex, note: bool, noteColor: hex },
  text: { on: bool, font: sel('textFont'), weight: sel('textWeight'), align: sel('textAlign'), size: rg('textSize'), space: rg('textSpace'), x: rg('textX'), y: rg('textY'), color: hex, match: bool, shOp: rg('textShOp'), shBlur: rg('textShBlur'), shX: rg('textShX'), shY: rg('textShY'), shColor: hex }
});
function cleanProject(schema, obj, path, bad) {   // keeps only valid fields (numbers clamped to the real control ranges); lists the rest in bad
  const out = {};
  for (const [k, rule] of Object.entries(schema)) {
    if (obj[k] === undefined) continue;
    try {
      if (typeof rule === 'function') out[k] = rule(obj[k]);
      else if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) out[k] = cleanProject(rule, obj[k], path + k + '.', bad);
      else throw 0;
    } catch (_) { bad.push(path + k); }
  }
  return out;
}
$('importJsonFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      let p = JSON.parse(ev.target.result);
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('not a project file');
      if (p.visualColor) p = {   // files exported by the first version
        artist: p.artist, title: p.title, extra: p.extra, main: p.visualColor, end: p.gradientColor, bg: p.backgroundColor, bgEnd: p.backgroundEndColor,
        useGrad: p.useGradient, useBgGrad: p.useBgGradient, bgAngle: p.bgAngle, mode: p.vizMode, sens: p.sens, stars: p.starCfg,
        circ: { radius: p.circRadius, count: p.circCount }
      };
      if (p.app !== undefined && p.app !== 'nebula-visualizer') throw new Error('this is not a Nebula Visualizer project');
      if (typeof p.version === 'number' && p.version > 2) throw new Error('it was saved by a newer version');
      const bad = [], clean = cleanProject(projectSchema(), p, '', bad);
      if (!Object.keys(clean).length) throw new Error('no recognised settings found');
      applySettings(clean);   // only validated data ever reaches the live state
      commitHistory();   // the import is one undo step
      notify(bad.length ? `Project partly imported: ${bad.length} invalid setting${bad.length > 1 ? 's were' : ' was'} skipped and left unchanged (${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ', …' : ''}). Everything else was applied. Undo (Ctrl+Z) reverts the import.` : 'Project settings imported.', bad.length > 0);
    } catch (err) { notify('Could not import that file: ' + err.message, true); }
    e.target.value = '';   // allow importing the same file again
  };
  r.readAsText(f);
};

function randomizeSettings() {
  const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)], chance = p => Math.random() < p;
  // a value inside the slider's own range (a..b = the part of the range to use), snapped to its step
  const R = (id, a = 0, b = 1) => { const el = $(id), mn = +el.min, mx = +el.max, st = +el.step || 1; return +(Math.round((mx - mn) * rnd(a, b) / st) * st + mn).toFixed(4); };
  const h = rnd(0, 360), h2 = { analog: h + rnd(25, 60), complement: h + 180 + rnd(-20, 20), triad: h + 120, mono: h }[pick(['analog', 'complement', 'triad', 'mono'])] % 360;
  const rainbowOn = chance(0.12);
  applySettings({
    main: hsvToHex(h, rnd(0.65, 1), rnd(0.85, 1)), end: hsvToHex(h2, rnd(0.6, 1), rnd(0.8, 1)),
    bg: hsvToHex(h, rnd(0.3, 0.8), rnd(0.03, 0.1)), bgEnd: hsvToHex((h + rnd(20, 80)) % 360, rnd(0.4, 0.9), rnd(0.12, 0.28)),
    useGrad: chance(0.8), useBgGrad: chance(0.85), bgAngle: Math.round(rnd(0, 360)), overlay: chance(0.5),
    autoCycle: !rainbowOn && chance(0.1), cycleSpeed: R('cycleSpeed', 0.05, 0.4),
    rainbow: { on: rainbowOn, move: chance(0.8), dir: pick([1, -1]), speed: R('rbSpeed', 0.05, 0.4) },
    mode: pick(MODES),
    circ: { radius: R('circRadius', 0.15, 0.8), length: R('circLength', 0.3, 0.8), width: R('circWidth', 0.15, 0.6), count: R('circCount', 0.2, 0.8), sym: chance(0.7) },
    bars: { shape: pick(['rect', 'rounded', 'capsule', 'beveled']), round: R('barRound', 0.15, 0.8), gap: R('barGap', 0.1, 0.55) },
    glow: { blur: R('glowBlur', 0.15, 0.6), bars: chance(0.5) ? R('glowBars', 0.3, 0.9) : 0, cover: chance(0.3) ? R('glowCover', 0.3, 0.8) : 0, text: chance(0.3) ? R('glowText', 0.3, 0.8) : 0 },
    mir: { count: R('mirCount', 0.2, 0.9) }, dots: { count: R('dotsCount', 0.2, 0.8), peak: chance(0.7) },
    wave: { width: R('waveWidth', 0.15, 0.6), fill: R('waveFill', 0.1, 0.7), glow: R('waveGlow', 0.4, 1), detail: R('waveDetail', 0.2, 0.8) },
    ridge: { rows: R('ridgeRows', 0.2, 0.8), step: R('ridgeStep', 0.2, 0.7), amp: R('ridgeAmp', 0.3, 0.8), line: R('ridgeLine', 0.2, 0.6) },
    sens: R('sens', 0.35, 0.7),
    bassPulse: chance(0.8), pulseAmt: R('pulseAmt', 0.1, 0.6), bgReactive: chance(0.4), bgPulse: R('bgPulseAmt', 0.2, 0.7),
    stars: { on: chance(0.85), count: R('starDensity', 0.05, 0.35), speed: R('starSpeed', 0.1, 0.6), boost: R('starBoost', 0.1, 0.6), flash: chance(0.8), light: R('starLight', 0.2, 0.5), angle: Math.round(rnd(0, 360)), color: pick(['white', 'white', 'main', 'gradient', 'rainbow']) },
    particles: { on: chance(0.8), count: R('partCount', 0.05, 0.3), size: R('partSize', 0.2, 0.6), speed: R('partSpeed', 0.2, 0.7) }
  });
}
$('randomizeBtn').onclick = () => { randomizeSettings(); commitHistory(); notify('Random look applied. Undo (Ctrl+Z) brings your old one back.'); };

// --- Undo / redo / reset to defaults ---
// A step = all settings + which cover / background image is loaded. Every change (sliders, toggles, pickers, dials, text, presets,
// import, randomize, image drops/removals) adds one step; dragging a slider or wheel counts as one.
// A step is only added when the USER changed something (the "dirty" flag), never because something moves by itself
// (auto color cycling), which is what used to throw away the redo steps.
const takeSnap = () => ({ s: JSON.stringify(getSettings(true)), cover: coverImg, bg: backgroundImg, presets: JSON.stringify(customPresets()) });
const hist = [takeSnap()]; let hIdx = 0, restoring = false, dirty = false, hTimer;
function syncHistUI() { $('undoBtn').disabled = hIdx <= 0; $('redoBtn').disabled = hIdx >= hist.length - 1; }
function commitHistory() {   // save the current state as a new step (nothing happens if it equals the current step)
  clearTimeout(hTimer); dirty = false;
  if (restoring) return;
  const n = takeSnap(), c = hist[hIdx];
  if (n.s === c.s && n.cover === c.cover && n.bg === c.bg && n.presets === c.presets) return;
  hist.length = hIdx + 1; hist.push(n);
  if (hist.length > 100) hist.shift();
  hIdx = hist.length - 1; syncHistUI();
}
const flushHistory = () => { if (dirty) commitHistory(); };
const commitSoon = () => { if (restoring) return; dirty = true; clearTimeout(hTimer); hTimer = setTimeout(flushHistory, 500); };
const mainEl = document.querySelector('main');
['input', 'change'].forEach(t => mainEl.addEventListener(t, e => { if (!e.target.closest('.stage')) commitSoon(); }));   // not the seek bar / volume
mainEl.addEventListener('pointerup', e => { if (e.target.closest('.groups')) commitSoon(); });                           // color wheels and dials
function jumpHistory(i) {
  clearTimeout(hTimer); dirty = false;
  hIdx = i; restoring = true;
  try {
    const e = hist[i];
    applySettings(JSON.parse(e.s));
    restoreCustomPresets(JSON.parse(e.presets));
    coverImg = e.cover; coverFromTag = false; setBackground(e.bg);
  } finally { restoring = false; }
  dirty = false; syncHistUI();
}
function undo() { flushHistory(); if (hIdx > 0) jumpHistory(hIdx - 1); }
function redo() { flushHistory(); if (hIdx < hist.length - 1) jumpHistory(hIdx + 1); }
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase(), t = e.target;
  if ((t.tagName === 'INPUT' && ['text', 'number'].includes(t.type)) || t.tagName === 'TEXTAREA') return;   // keep the browser's own text undo
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});
$('resetBtn').onclick = () => { $('resetDlg').returnValue = ''; $('resetDlg').showModal(); };
$('resetDlg').addEventListener('close', () => {
  if ($('resetDlg').returnValue !== 'ok') return;
  commitHistory();   // save the current look first, so the reset can be undone
  const d = { ...DEFAULTS }; delete d.artist; delete d.title; delete d.extra;
  applySettings(d);
  commitHistory();
  notify('Settings reset to defaults (your cover and background images are kept). Undo (Ctrl+Z) brings the old look back.');
});
syncHistUI();

// --- Drag & drop: audio -> song, images -> cover (or background when dropped on the Background group), .json -> import ---
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|aiff?|webm|mp4)$/i;
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
// Audio always becomes the song / playlist. An image dropped on the cover spot or the Cover panel becomes the cover;
// any other image, GIF or video becomes the background. A .json file imports a project.
const coverSpotAt = (x, y) => {
  const r = $('c').getBoundingClientRect();
  if (!coverSpot || !r.width) return false;
  const k = 1920 / r.width, px = (x - r.left) * k, py = (y - r.top) * k, pad = 16;   // a little slack around the cover
  return px >= coverSpot.x - pad && px <= coverSpot.x + coverSpot.s + pad && py >= coverSpot.y - pad && py <= coverSpot.y + coverSpot.s + pad;
};
function dropZone(e) {
  if (coverSpotAt(e.clientX, e.clientY)) return 'cover';
  const grp = e.target.closest && e.target.closest('.group');
  if (grp && grp.id === 'coverGroup') return 'cover';
  if (grp && grp.id === 'backgroundGroup') return 'background';
  if (grp && grp.id === 'playlistGroup') return 'playlist';
  return null;
}
function placeDropSpot(zone) {   // dashed box over the cover, shown while files are dragged over the page
  const el = $('dropSpot'), r = $('c').getBoundingClientRect();
  if (!coverSpot || !r.width) { el.hidden = true; return; }
  const k = r.width / 1920;
  Object.assign(el.style, { left: r.left + coverSpot.x * k + 'px', top: r.top + coverSpot.y * k + 'px', width: coverSpot.s * k + 'px', height: coverSpot.s * k + 'px' });
  el.hidden = false;
  el.classList.toggle('over', zone === 'cover');
}
function clearDropHints() {
  document.body.classList.remove('dragging', 'dz-cover', 'dz-background');
  $('dropSpot').hidden = true;
}
document.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); placeDropSpot(null); } });
document.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; clearDropHints(); } });
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const z = dropZone(e);
  document.body.classList.toggle('dz-cover', z === 'cover');
  document.body.classList.toggle('dz-background', z !== 'cover' && z !== 'playlist');   // the background is the default target
  placeDropSpot(z);
});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; clearDropHints();
  const zone = dropZone(e), files = Array.from(e.dataTransfer.files);
  const audio = files.filter(isAudioFile);
  if (audio.length) { if (zone === 'playlist') addToQueue(audio, 'end'); else setQueue(audio); }   // all dropped songs form the queue
  let visualUsed = false, jsonUsed = false;
  for (const f of files) {
    if (isAudioFile(f)) continue;
    let kind = null;
    if (/\.json$/i.test(f.name)) { if (!jsonUsed) kind = 'importJsonFile'; }
    else if (f.type.startsWith('image/') || isVideoFile(f)) {
      if (visualUsed) continue;   // first file of each kind wins
      // on the cover spot or the Cover panel an image is the cover; anywhere else it is the background (videos always are)
      kind = zone === 'cover' && !isVideoFile(f) ? 'cover' : 'backgroundImage';
    }
    if (!kind) continue;
    if (kind === 'importJsonFile') jsonUsed = true; else visualUsed = true;
    const dt = new DataTransfer(); dt.items.add(f); $(kind).files = dt.files; $(kind).dispatchEvent(new Event('change'));
  }
  if (!audio.length && !visualUsed && !jsonUsed) notify('Drop audio files, an image or video, or a project .json file.', true);
});

// --- Keyboard Shortcuts & Fullscreen ---
const stage = $('stage'), fsBtn = $('fsBtn'), barBtn = $('barToggle');
const ICON_ENTER = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_EXIT = '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
const ICON_BAR = '<svg viewBox="0 0 24 24"><path d="M4 19h16M6 5v8l7-4z"/><circle cx="10" cy="19" r="1.6"/></svg>';
const ICON_BAR_OFF = '<svg viewBox="0 0 24 24"><path d="M4 19h16M6 5v8l7-4z"/><circle cx="10" cy="19" r="1.6"/><path d="M3 3l18 18"/></svg>';
const nativeFS = () => document.fullscreenElement || document.webkitFullscreenElement;
let pseudoFS = false, showBar = true, idleT;

function syncFS() {
  const on = nativeFS() === stage || pseudoFS;
  stage.classList.toggle('fs', on);
  if (!on) stage.classList.remove('idle');
  fsBtn.innerHTML = on ? ICON_EXIT : ICON_ENTER;
  if (on) wake();
  const t = on ? 'Exit full screen' : 'Full screen';
  fsBtn.setAttribute('aria-label', t); fsBtn.title = t;
}
function toggleFS() {
  if (nativeFS()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (pseudoFS) { pseudoFS = false; syncFS(); return; }
  const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (!req) { pseudoFS = true; syncFS(); return; }
  const p = req.call(stage);
  if (p && p.catch) p.catch(() => { pseudoFS = true; syncFS(); });
}
function syncBar() {
  stage.classList.toggle('nobar', !showBar);
  barBtn.innerHTML = showBar ? ICON_BAR : ICON_BAR_OFF;
  barBtn.setAttribute('aria-pressed', String(showBar));
  const t = showBar ? 'Hide play bar' : 'Show play bar';
  barBtn.setAttribute('aria-label', t); barBtn.title = t;
}
function wake() {
  if (!stage.classList.contains('fs')) return;
  stage.classList.add('active'); stage.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => { stage.classList.remove('active'); if (stage.classList.contains('fs')) stage.classList.add('idle'); }, 1000);
}
fsBtn.onclick = e => { toggleFS(); if (e.detail) fsBtn.blur(); };
barBtn.onclick = e => { showBar = !showBar; syncBar(); if (e.detail) barBtn.blur(); };
['pointermove', 'pointerdown', 'touchstart'].forEach(ev => stage.addEventListener(ev, wake, { passive: true }));
stage.addEventListener('pointerleave', e => {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(idleT); stage.classList.remove('active', 'idle');
});
document.addEventListener('fullscreenchange', syncFS);
document.addEventListener('webkitfullscreenchange', syncFS);

// Keyboard shortcuts (Space to play/pause, F for fullscreen)
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === ' ') {
    if (e.target.closest && e.target.closest('button, summary, a[href], [role=slider]')) return;   // focused controls keep their own Space action
    e.preventDefault();
    $('play').click();
  } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
    nextTrack();
  } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
    prevTrack();
  } else if (e.key.toLowerCase() === 'm') {
    $('muteBtn').click();
  } else if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFS();
  } else if (e.key === 'Escape' && pseudoFS) {
    pseudoFS = false; syncFS();
  }
});

syncFS(); syncBar();

document.fonts.load('700 40px Montserrat').then(() => document.fonts.load('800 40px Montserrat')).then(() => document.fonts.load('400 40px Montserrat')).finally(frame);