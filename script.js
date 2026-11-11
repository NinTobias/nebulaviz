const N = 63, X0 = 175, X1 = 1745, BASE = 543, MINH = 3, MAXH = 375;
const M = {
  f0: 20.9, f1: 13700, p: 0.572, tau: 0.471, wmax: 0.502, tilt: 4.40, cap: 15.94, agcmin: 0.1196, agcdec: 0.9995,
  floor: 0.0331, gamma: 1.529, att: 0.516, dec: 0.2844, sw: 0.2345, fp: 101.9, ltilt: -3.56
};
const DTV = 1001 / 30000;
const LEAD = 0 * 10 * DTV;
let sens = 1, agc = M.agcmin, asrc = null, lastT = performance.now();
const raw = new Float32Array(N), sm2 = new Float32Array(N);
let lo = [], hi = [], fcs = [], gains = [], hz = 1, kmax = 0, sm, amp;
const cv = document.getElementById('c'), g = cv.getContext('2d');
const $ = id => document.getElementById(id);
let ctx, analyser, buf, src, startedAt = 0, offset = 0, playing = false, freq;
let coverImg = null, backgroundImg = null, flash = 0;
let beatAvg = 0, beatPeak = 1e-6, beatClock = 0, lastBeat = -9, beatK0 = 1, beatK1 = 2, beatStrength = 1, lastBurst = -9;   // beat detector state
let visualColor = '#f2d90a', gradientColor = '#ff6a00', useGradient = false, backgroundColor = '#000000';
let backgroundEndColor = '#1a0b3d', useBgGradient = false, bgAngle = 180;
let vizMode = 'bars', circRadius = 200, circCount = 90, circWidth = 5, circLength = 190, mirCount = 63, dotsCount = 63, dotsPeak = true;
let barShape = 'rect', barRound = 4, barGap = 7, glowBlur = 24, glowBars = 0, glowCover = 0, glowText = 0;
const MODES = ['bars', 'circular', 'mirrored', 'wave', 'wavemir', 'dots', 'ridge'];
const textCfg = { font: 'montserrat', weight: 'default', size: 100, space: 0, align: 'auto', x: 0, y: 0, color: '#ffffff', match: false, shOp: 0, shBlur: 8, shX: 3, shY: 3, shColor: '#000000' };
const TEXT_FONTS = { montserrat: 'Montserrat, sans-serif', oswald: 'Oswald, sans-serif', bebas: '"Bebas Neue", Impact, sans-serif', playfair: '"Playfair Display", Georgia, serif', orbitron: 'Orbitron, sans-serif', pacifico: 'Pacifico, cursive', arial: 'Arial, Helvetica, sans-serif', georgia: 'Georgia, serif', courier: '"Courier New", Courier, monospace', impact: 'Impact, "Arial Black", sans-serif' };
const TEXT_WEIGHTS = { default: [700, 400], regular: [400, 400], bold: [700, 700], heavy: [800, 800] };   // [artist, title / extra]
const CIRC_CX = 960, CIRC_CY = 430, CIRC_MAX = 410;   // circular layout: ring centred above the bottom text block
const MID = BASE - MAXH / 2;                           // mirrored layout: centre line, same footprint as the normal bars
let cycleSpeed = 15, rainbow = false, rbMove = true, rbDir = 1, rbSpeed = 60, rbOffset = 0, circSym = true;
let volume = 1, muted = false, outGain = null;
let mediaRecorder = null, recDest = null, recChunks = [], recNote = '', expCanvas = null, expCtx = null;
let autoColorCycle = false, colorCycleHue = 52;
let bassPulse = true, pulseAmt = 0.08, bgAudioReactive = false, bgPulseAmt = 0.15, beatNow = false;
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
  root.style.setProperty('--overlay-ink', inkFor(useGradient && overlayColors ? midHex(a, b) : a));
  root.style.setProperty('--overlay-fill', useGradient && overlayColors
    ? `linear-gradient(90deg, ${a}, ${b})` : a);
  updateSliders();
}
$('overlayColors').onchange = updateOverlayTheme;
$('lockOverlay').onchange = e => { lockOverlay = e.target.checked; updateOverlayTheme(); };
const vals = new Float32Array(N);

const stars = Array.from({ length: 600 }, () => ({
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
  for (let i = 0; i < N; i++) {
    const a = M.f0 * Math.pow(M.f1 / M.f0, i / N), b = M.f0 * Math.pow(M.f1 / M.f0, (i + 1) / N);
    lo[i] = Math.floor(a / hz); hi[i] = Math.max(lo[i] + 1, Math.floor(b / hz));
    const fc = Math.sqrt(a * b); fcs[i] = fc;
    const db = fc >= M.fp ? Math.min(M.cap, M.tilt * Math.log2(fc / M.fp)) : M.ltilt * Math.log2(M.fp / fc);
    gains[i] = Math.pow(10, db / 40);
  }
  kmax = Math.max(...hi) + 3;
  sm = new Float32Array(kmax); amp = new Float32Array(kmax);
  beatK0 = Math.max(1, Math.floor(30 / hz)); beatK1 = Math.floor(150 / hz) + 1;   // beat detector listens to 30-150 Hz
}

const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
function icon(p) { $('play').innerHTML = p ? STOP : PLAY; $('play').setAttribute('aria-label', p ? 'Stop' : 'Play'); }
icon(false);

function stopAll() { for (const n of [src, asrc]) if (n) { n.onended = null; try { n.stop(); } catch (e) { } } }
function startAt(off) {
  setup();
  stopAll();
  src = ctx.createBufferSource(); src.buffer = buf; src.connect(outGain);
  if (recDest) src.connect(recDest);   // keep the recording's audio alive across seeks/resumes
  src.onended = () => { if (playing) { playing = false; offset = 0; icon(false); vals.fill(0); parts.length = 0; stopRecording('Song ended. Video saved.'); } };
  src.start(0, off);
  asrc = null;
  if (off + LEAD < buf.duration) { asrc = ctx.createBufferSource(); asrc.buffer = buf; asrc.connect(analyser); asrc.start(0, off + LEAD); }
  sm.fill(0); beatAvg = 0;
  startedAt = ctx.currentTime - off;
  playing = true;
  icon(true);
}

$('song').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  setup();
  stopRecording();
  $('status').textContent = 'Decoding audio…';
  try {
    buf = await ctx.decodeAudioData(await f.arrayBuffer());
    $('title').value = f.name.replace(/\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|aiff?|webm|mp4)$/i, '');
    const mm = Math.floor(buf.duration / 60), ss = Math.floor(buf.duration % 60);
    $('songInfo').hidden = false;
    $('songInfo').textContent = `${f.name} · ${mm}:${String(ss).padStart(2, '0')} · ${(buf.sampleRate / 1000).toFixed(1)} kHz · ${buf.numberOfChannels === 1 ? 'mono' : buf.numberOfChannels === 2 ? 'stereo' : buf.numberOfChannels + ' channels'} · ${(f.size / 1048576).toFixed(1)} MB`;
    stopAll();
    playing = false; icon(false); vals.fill(0); parts.length = 0;
    offset = 0; $('play').disabled = false; $('seek').disabled = false;
    $('status').textContent = 'Ready. Press Play or Spacebar.';
    if ($('presetRandomize').checked) randomizeSettings();
  } catch (err) { notify('Could not read that audio file. Try MP3, WAV or OGG.', true); }
};

$('backgroundImage').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { backgroundImg = im; syncBgImageUI(); commitHistory(); }; im.src = r.result; };
  r.readAsDataURL(f);
};
$('removeBackgroundImage').onclick = () => { backgroundImg = null; $('backgroundImage').value = ''; syncBgImageUI(); commitHistory(); };
function syncBgImageUI() {   // an image covers the color/gradient, so those controls are dimmed (not disabled)
  $('bgColorOpts').classList.toggle('off', !!backgroundImg);
  $('bgImageHint').hidden = !backgroundImg;
}

$('cover').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { coverImg = im; commitHistory(); }; im.src = r.result; };
  r.readAsDataURL(f);
};
$('removeCoverImage').onclick = () => { coverImg = null; $('cover').value = ''; commitHistory(); };

$('play').onclick = async () => {
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
  if (!buf) return;
  const t = dragging ? $('seek').value / 1000 * buf.duration : cur();
  if (!dragging) $('seek').value = t / buf.duration * 1000;
  $('time').textContent = fmt(t) + ' / ' + fmt(buf.duration);
  updateSliders();
}
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
  const prefix = PREFIX[which], st = pickerState[which];
  const current = () => st.hex || hsvToHex(st.h, st.s, st.v);
  const apply = (r, gr, b) => {
    const hex = '#' + [r, gr, b].map(x => x.toString(16).padStart(2, '0')).join('');
    const hsv = hexToHsv(hex);
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
  vizMode = m; $('vizMode').value = m; $('circularOpts').hidden = m !== 'circular'; $('mirroredOpts').hidden = m !== 'mirrored'; $('dotsOpts').hidden = m !== 'dots'; $('barOpts').hidden = !(m === 'bars' || m === 'mirrored');
}
$('vizMode').onchange = e => setMode(e.target.value);
$('circRadius').oninput = e => { circRadius = +e.target.value; updateSliders(); };
$('circLength').oninput = e => { circLength = +e.target.value; updateSliders(); };
$('circWidth').oninput = e => { circWidth = +e.target.value; updateSliders(); };
$('circCount').oninput = e => { circCount = +e.target.value; updateSliders(); };
$('mirCount').oninput = e => { mirCount = +e.target.value; updateSliders(); };
$('dotsCount').oninput = e => { dotsCount = +e.target.value; updateSliders(); };
$('dotsPeak').onchange = e => { dotsPeak = e.target.checked; };
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
  barRound:    { unit: 'px',     tip: 'Corner size for the Rounded and Beveled shapes, in pixels. Large values are limited to what fits the bar.' },
  barGap:      { unit: 'px',     tip: 'Space between neighbouring bars, in pixels (63-bar and mirrored modes). Wider gaps make thinner bars.' },
  glowBlur:    { unit: 'px',     tip: 'How far the glow spreads, in pixels of the 1920x1080 frame. Shared by bars, cover art and text.' },
  glowBars:    { scale: 100, unit: '%', tip: 'Glow around the bars (every mode except the Ridgeline). 0% = off.' },
  glowCover:   { scale: 100, unit: '%', tip: 'Glow around the cover artwork. 0% = off.' },
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

// Messages: toast near the bottom of the screen (always visible) + the status line
let toastT;
function notify(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 6000 : 3500);
  $('status').textContent = msg;
}

function analyse(dt) {
  if (!analyser || !playing) { flash *= 0.9; return 0; }
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
  let b = 0; for (let i = 0; i < 15; i++) b += vals[i]; b /= 15;
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
const peaks = new Float32Array(160), ridgeHist = [], RIDGE_ROWS = 14; let ridgeAcc = 0;
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
  for (let i = 0; i < partCfg.count && parts.length < 1500; i++) {
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
  const mdt = (playing || !buf) ? dt : 0;

  if (autoColorCycle && playing) {
    const d = dt * cycleSpeed;
    pickerState.main.h = (pickerState.main.h + d) % 360; pickerState.main.hex = null;
    pickerState.end.h = (pickerState.end.h + d) % 360; pickerState.end.hex = null;
    updatePicker('main', true);
    if (useGradient) updatePicker('end', true);
  }
  if (rainbow && rbMove && playing) rbOffset = (((rbOffset - rbDir * rbSpeed * dt) % 360) + 360) % 360;

  // Background rendering
  if (backgroundImg) {
    const scale = Math.max(1920 / backgroundImg.width, 1080 / backgroundImg.height);
    const w = backgroundImg.width * scale, h = backgroundImg.height * scale;
    g.drawImage(backgroundImg, (1920 - w) / 2, (1080 - h) / 2, w, h);
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

  // Rainbow: every hue across the bars (or around the ring); rbOffset slides it
  let vizFill = barGradient;
  if (rainbow) {
    vizFill = (vizMode === 'circular' && g.createConicGradient) ? g.createConicGradient(-Math.PI / 2, CIRC_CX, CIRC_CY) : g.createLinearGradient(X0, 0, X1, 0);
    for (let k = 0; k <= 24; k++) vizFill.addColorStop(k / 24, `hsl(${(rbOffset + k * 15) % 360} 100% 55%)`);
  }

  // --- RENDER VISUALIZER MODES ---
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
      if (o > 0.01) outlined.push([x, y, w, h, o]);   // near-black bars get a white outline that fades in
    }
    g.save();
    if (glowBars > 0) { g.shadowColor = glowCol(Math.min(1, glowBars)); g.shadowBlur = glowBlur; }
    g.fillStyle = vizFill; g.fill(all);   // all bars as one path = one glow pass instead of 63
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
    g.restore();
  } else if (vizMode === 'wave') {
    // Smooth Wave: one flowing glowing curve through all bands, with a soft fill underneath
    const K = 126, pts = [];
    for (let j = 0; j <= K; j++) {
      const f = j / K * (N - 1), a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);
      pts.push([X0 + (X1 - X0) * j / K, BASE - (MINH + v * (MAXH - MINH))]);
    }
    const line = new Path2D(); line.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < K; j++) line.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2);
    line.lineTo(pts[K][0], pts[K][1]);
    const area = new Path2D(line); area.lineTo(X1, BASE); area.lineTo(X0, BASE); area.closePath();
    g.save();
    g.globalAlpha = 0.3; g.fillStyle = vizFill; g.fill(area);
    g.globalAlpha = 1; g.strokeStyle = vizFill; g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = 14 + bass * 30 + glowBars * glowBlur;
    g.stroke(line);
    g.restore();
  } else if (vizMode === 'wavemir') {
    // Mirrored Smooth Wave: the same flowing curve above and below a centre line
    const K = 126, top = [], bot = [];
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
    g.globalAlpha = 0.3; g.fillStyle = vizFill; g.fill(body);
    g.globalAlpha = 1; g.strokeStyle = vizFill; g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = 14 + bass * 30 + glowBars * glowBlur;
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
    g.fill(lit); g.restore();
    if (dotsPeak) { g.globalAlpha = 0.85; g.fill(pk); }
    g.globalAlpha = 1;
  } else if (vizMode === 'ridge') {
    // Ridgeline: the last moments of the spectrum, stacked back to front, scrolling away smoothly
    const HZ = 14, step = 20, amp = 175;
    ridgeAcc += mdt;
    if (ridgeAcc >= 1 / HZ) { ridgeAcc = Math.min(ridgeAcc - 1 / HZ, 1 / HZ); ridgeHist.unshift(ridgePaths(vals, amp)); if (ridgeHist.length > RIDGE_ROWS - 1) ridgeHist.pop(); }
    const phase = Math.min(1, ridgeAcc * HZ);   // how far the rows have slid toward the next slot
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = vizFill;
    const drawRow = (rp, by, fade) => {
      g.save(); g.translate(0, by);
      g.save(); g.clip(rp.area);   // body = an exact copy of the backdrop (colour, gradient, image, pulse): hides the rows behind, adds no colour of its own
      g.globalAlpha = 1; g.drawImage(ridgeBG, 0, -by);
      g.restore();
      g.globalAlpha = fade; g.lineWidth = 1.5 + 1.5 * fade; g.stroke(rp.curve);
      g.restore();
    };
    for (let j = ridgeHist.length - 1; j >= 0; j--) {
      const pos = j + phase;
      drawRow(ridgeHist[j], BASE - pos * step, Math.pow(Math.max(0, 1 - pos / (RIDGE_ROWS - 1)), 0.8));
    }
    drawRow(ridgePaths(vals, amp), BASE, 1);
    g.globalAlpha = 1;
  }

  drawParticles(mdt);

  // Cover artwork: bottom-left normally, centred inside the ring in circular mode
  const circ = vizMode === 'circular';
  const pulseScale = bassPulse ? (1 + bass * pulseAmt) : 1;
  const cs = (circ ? Math.round(circRadius * 0.95) : 192) * pulseScale;   // circular: a bit under the ring's radius, so the square sits well inside the bars
  const ccx = circ ? CIRC_CX : 271, ccy = circ ? CIRC_CY : 689;
  const cx = ccx - cs / 2, cy = ccy - cs / 2;
  const coverGradient = g.createLinearGradient(cx, cy, cx + cs, cy + cs);
  coverGradient.addColorStop(0, c1); coverGradient.addColorStop(1, c2);

  g.save(); if (glowCover > 0) { g.shadowColor = glowCol(Math.min(1, glowCover)); g.shadowBlur = glowBlur; }
  if (coverImg) {
    const sq = Math.min(coverImg.width, coverImg.height);
    g.drawImage(coverImg, (coverImg.width - sq) / 2, (coverImg.height - sq) / 2, sq, sq, cx, cy, cs, cs);
  } else {
    g.fillStyle = coverGradient; g.fillRect(cx, cy, cs, cs);
    g.fillStyle = '#fff';
    g.font = `800 ${cs * 0.573}px Montserrat`; g.textAlign = 'center';
    g.fillText('♪', cx + cs / 2, cy + cs * 0.703); g.textAlign = 'left';
  }
  g.restore();

  // text: styled in the Text group. Right of the cover normally, centred under the ring in circular mode
  const T = textCfg, ts = T.size / 100;
  const artist = $('artist').value.toUpperCase(), title = $('title').value.toUpperCase(), extra = $('extra').value.trim().toUpperCase();
  const three = !!extra, wt = TEXT_WEIGHTS[T.weight] || TEXT_WEIGHTS.default;
  const maxW = circ ? 1500 : X1 - 403;
  const algn = T.align === 'auto' ? (circ ? 'center' : 'left') : T.align;
  const ax = (circ ? { left: X0, center: CIRC_CX, right: X1 } : { left: 403, center: (403 + X1) / 2, right: X1 })[algn] + T.x;
  const yy = circ ? (three ? [925, 975, 1025] : [945, 1005]) : (three ? [666, 716, 762] : [698, 753]);   // baselines of the original layout
  const lineY = i => yy[0] + (yy[i] - yy[0]) * ts + T.y;                                                  // spacing between lines grows with the size
  const sp = T.space / 100, shRGB = rgbOf(T.shColor);
  g.fillStyle = T.match ? vizFill : T.color; g.textBaseline = 'alphabetic'; g.textAlign = algn;
  const drawLine = (txt, y) => {
    let drawn = false;
    if (T.shOp > 0) {   // drop shadow
      g.save(); g.shadowColor = `rgba(${shRGB[0]},${shRGB[1]},${shRGB[2]},${T.shOp})`; g.shadowBlur = T.shBlur; g.shadowOffsetX = T.shX; g.shadowOffsetY = T.shY;
      g.fillText(txt, ax, y); g.restore(); drawn = true;
    }
    if (glowText > 0 || !drawn) {   // glow (and the plain text when there is no shadow)
      g.save(); if (glowText > 0) { g.shadowColor = glowCol(Math.min(1, glowText)); g.shadowBlur = glowBlur; }
      g.fillText(txt, ax, y); g.restore();
    }
  };
  fitText(artist, wt[0], (three ? 70 : 82) * ts, maxW, (three ? 0 : -0.01) + sp); drawLine(artist, lineY(0));
  fitText(title, wt[1], (three ? 48 : 51) * ts, maxW, (three ? 0.015 : 0) + sp); drawLine(title, lineY(1));
  if (extra) { fitText(extra, wt[1], 48 * ts, maxW, 0.015 + sp); drawLine(extra, lineY(2)); }
  g.textAlign = 'left';
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (expCanvas && recActive()) { expCtx.imageSmoothingQuality = 'high'; expCtx.drawImage(cv, 0, 0, expCanvas.width, expCanvas.height); }   // scaled copy for the chosen export resolution
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
const EXPORT_FORMATS = [['WebM (VP9)', 'video/webm;codecs=vp9,opus'], ['WebM (VP8)', 'video/webm;codecs=vp8,opus'], ['WebM (browser default)', 'video/webm'],
  ['MP4 (H.264)', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'], ['MP4 (browser default)', 'video/mp4'], ['WebM (AV1)', 'video/webm;codecs=av1,opus']];
if (typeof MediaRecorder !== 'undefined') {   // only offer what this browser can actually record; the first one is the default
  EXPORT_FORMATS.forEach(([name, type]) => { if (MediaRecorder.isTypeSupported(type)) { const o = document.createElement('option'); o.value = type; o.textContent = name; $('expFormat').appendChild(o); } });
}
if (!$('expFormat').options.length) $('expFormat').innerHTML = '<option value="">Browser default</option>';
function recSync() {   // recording follows playback: paused song = paused recording
  if (!recActive()) return;
  try {
    if (playing && mediaRecorder.state === 'paused') mediaRecorder.resume();
    else if (!playing && mediaRecorder.state === 'recording') mediaRecorder.pause();
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
  try { if (src && recDest) src.disconnect(recDest); } catch (e) { }
  recDest = null; expCanvas = null; expCtx = null;
}
$('recBtn').onclick = () => {
  if (recActive()) { stopRecording(); return; }
  if (!buf) { notify('Load a song first, then press play and start recording.', true); return; }
  if (!playing) { notify('Press play first, then start recording.', true); return; }
  if (typeof MediaRecorder === 'undefined' || !cv.captureStream) { notify('Video export is not supported in this browser.', true); return; }
  try {
    const [expW, expH] = $('expRes').value.split('x').map(Number), expFps = +$('expFps').value;
    let capCanvas = cv; expCanvas = expCtx = null;
    if (expW !== cv.width || expH !== cv.height) { expCanvas = document.createElement('canvas'); expCanvas.width = expW; expCanvas.height = expH; expCtx = expCanvas.getContext('2d'); capCanvas = expCanvas; }
    const stream = capCanvas.captureStream(expFps);
    recDest = ctx.createMediaStreamDestination();
    src.connect(recDest);
    recDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const type = $('expFormat').value || REC_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    const ext = type && type.includes('mp4') ? 'mp4' : 'webm';
    recChunks = [];
    const bps = Math.min(40e6, Math.max(2e6, Math.round(8e6 * expW * expH / (1920 * 1080) * (expFps > 30 ? 1 : 0.7))));   // ~8 Mbit/s at 1080p60, scaled by size and rate
    mediaRecorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: bps });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
    mediaRecorder.onerror = e => { recCleanup(); notify('Recording failed: ' + ((e.error && e.error.message) || 'unknown error'), true); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'video/webm' });
      recCleanup();
      stream.getTracks().forEach(t => t.stop());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (($('title').value || 'visualizer').replace(/[\\/:*?"<>|]/g, '_')) + '.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      notify(recNote);
    };
    mediaRecorder.start();
    $('recBtn').classList.add('rec');
    notify('Recording… pausing the song pauses the recording. Click the camera button again to stop and save.');
  } catch (err) { recCleanup(); notify('Video recording error: ' + err.message, true); }
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
  pickerState[which] = Object.assign(hexToHsv(hex), { hex: hex.toLowerCase() });
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
    bars: { shape: barShape, round: barRound, gap: barGap }, glow: { blur: glowBlur, bars: glowBars, cover: glowCover, text: glowText },
    bassPulse, pulseAmt, bgReactive: bgAudioReactive, bgPulse: bgPulseAmt, lockOverlay, sens,
    stars: { ...starCfg }, particles: { ...partCfg }, text: { ...textCfg }
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
    setCtl('textFont', tx.font); setCtl('textWeight', tx.weight); setCtl('textAlign', tx.align);
    setCtl('textSize', tx.size); setCtl('textSpace', tx.space); setCtl('textX', tx.x); setCtl('textY', tx.y);
    setCtl('textColor', tx.color); setCtl('textMatch', tx.match);
    setCtl('textShOp', tx.shOp); setCtl('textShBlur', tx.shBlur); setCtl('textShX', tx.shX); setCtl('textShY', tx.shY); setCtl('textShColor', tx.shColor);
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
  darkclub: ['Dark Club', 'Red and violet ridgeline, heavy bass flashes and particles.']
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
  }
};
{ const sel = $('presetSelect'); sel.innerHTML = ''; Object.entries(PRESET_INFO).forEach(([k, v]) => sel.add(new Option(v[0], k))); }
const NESTED = ['circ', 'rainbow', 'mir', 'dots', 'bars', 'glow', 'stars', 'particles'];
// glow / bar-shape touches for some of the built-in looks
Object.assign(PRESETS.cyberpunk, { glow: { blur: 28, bars: 0.7, cover: 0.4, text: 0.3 } });
Object.assign(PRESETS.neon, { glow: { blur: 32, bars: 0.8, cover: 0.5, text: 0.4 } });
Object.assign(PRESETS.synthwave, { glow: { blur: 30, bars: 0.7, cover: 0.3, text: 0.5 }, bars: { shape: 'rounded', round: 5 } });
Object.assign(PRESETS.chillwave, { bars: { shape: 'capsule' } });
Object.assign(PRESETS.minimal, { bars: { shape: 'rounded', round: 3 } });
function applyPreset(key) {
  const p = PRESETS[key]; if (!p) return;
  const base = { ...DEFAULTS }; delete base.artist; delete base.title; delete base.extra; delete base.text;   // presets never touch the text or its styling
  const m = { ...base, ...p };
  NESTED.forEach(k => { m[k] = { ...(base[k] || {}), ...(p[k] || {}) }; });
  applySettings(m);
  commitHistory();
  notify(PRESET_INFO[key] ? `${PRESET_INFO[key][0]}: ${PRESET_INFO[key][1]}` : 'Preset applied.');
}
$('presetSelect').onchange = e => applyPreset(e.target.value);

$('savePresetBtn').onclick = () => {
  const name = (prompt('Enter preset name:') || '').trim();
  if (!name) return;
  const key = name.toLowerCase();
  const isNew = !PRESETS[key];
  PRESETS[key] = getSettings(false);
  if (isNew) { const opt = document.createElement('option'); opt.value = key; opt.textContent = name; $('presetSelect').appendChild(opt); }
  $('presetSelect').value = key;
  notify(`Preset "${name}" saved.`);
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
      applySettings(p);
      notify('Project settings imported.');
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
    sens: R('sens', 0.35, 0.7),
    bassPulse: chance(0.8), pulseAmt: R('pulseAmt', 0.1, 0.6), bgReactive: chance(0.4), bgPulse: R('bgPulseAmt', 0.2, 0.7),
    stars: { on: chance(0.85), count: R('starDensity', 0.1, 0.7), speed: R('starSpeed', 0.1, 0.6), boost: R('starBoost', 0.1, 0.6), flash: chance(0.8), light: R('starLight', 0.2, 0.5), angle: Math.round(rnd(0, 360)), color: pick(['white', 'white', 'main', 'gradient', 'rainbow']) },
    particles: { on: chance(0.8), count: R('partCount', 0.1, 0.6), size: R('partSize', 0.2, 0.6), speed: R('partSpeed', 0.2, 0.7) }
  });
}
$('randomizeBtn').onclick = () => { randomizeSettings(); commitHistory(); notify('Random look applied. Undo (Ctrl+Z) brings your old one back.'); };

// --- Undo / redo / reset to defaults ---
// A step = all settings + which cover / background image is loaded. Every change (sliders, toggles, pickers, dials, text, presets,
// import, randomize, image drops/removals) adds one step; dragging a slider or wheel counts as one.
// A step is only added when the USER changed something (the "dirty" flag), never because something moves by itself
// (auto color cycling), which is what used to throw away the redo steps.
const takeSnap = () => ({ s: JSON.stringify(getSettings(true)), cover: coverImg, bg: backgroundImg });
const hist = [takeSnap()]; let hIdx = 0, restoring = false, dirty = false, hTimer;
function syncHistUI() { $('undoBtn').disabled = hIdx <= 0; $('redoBtn').disabled = hIdx >= hist.length - 1; }
function commitHistory() {   // save the current state as a new step (nothing happens if it equals the current step)
  clearTimeout(hTimer); dirty = false;
  if (restoring) return;
  const n = takeSnap(), c = hist[hIdx];
  if (n.s === c.s && n.cover === c.cover && n.bg === c.bg) return;
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
    coverImg = e.cover; backgroundImg = e.bg; syncBgImageUI();
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
  notify('Settings reset to defaults. Undo (Ctrl+Z) brings them back.');
});
syncHistUI();

// --- Drag & drop: audio -> song, images -> cover (or background when dropped on the Background group), .json -> import ---
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|aiff?|webm|mp4)$/i;
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const grp = e.target.closest && e.target.closest('.group'), toBg = !!grp && grp.contains($('backgroundImage'));
  const used = new Set();
  for (const f of e.dataTransfer.files) {
    const kind = (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)) ? 'song' : f.type.startsWith('image/') ? (toBg ? 'backgroundImage' : 'cover') : /\.json$/i.test(f.name) ? 'importJsonFile' : null;
    if (!kind || used.has(kind)) continue;   // first file of each kind wins
    used.add(kind);
    const dt = new DataTransfer(); dt.items.add(f); $(kind).files = dt.files; $(kind).dispatchEvent(new Event('change'));
  }
  if (!used.size) notify('Drop an audio file, an image or a project .json file.', true);
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
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ') {
    e.preventDefault();
    $('play').click();
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