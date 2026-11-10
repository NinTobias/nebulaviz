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
const MODES = ['bars', 'circular', 'mirrored', 'wave', 'wavemir', 'dots', 'ridge'];
const CIRC_CX = 960, CIRC_CY = 430, CIRC_MAX = 410;   // circular layout: ring centred above the bottom text block
const MID = BASE - MAXH / 2;                           // mirrored layout: centre line, same footprint as the normal bars
let cycleSpeed = 15, rainbow = false, rbMove = true, rbDir = 1, rbSpeed = 60, rbOffset = 0, circSym = true;
let volume = 1, muted = false, outGain = null;
let mediaRecorder = null, recDest = null, recChunks = [], recNote = '';
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
  c: (Math.random() - 0.5) * 0.15, a: 0.25 + Math.random() * 0.6
}));
const starCfg = { on: true, flash: true, count: 240, speed: 1, boost: 8, light: 1, angle: 270 };

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
  r.onload = () => { const im = new Image(); im.onload = () => { backgroundImg = im; syncBgImageUI(); }; im.src = r.result; };
  r.readAsDataURL(f);
};
$('removeBackgroundImage').onclick = () => { backgroundImg = null; $('backgroundImage').value = ''; syncBgImageUI(); };
function syncBgImageUI() {   // an image covers the color/gradient, so those controls are dimmed (not disabled)
  $('bgColorOpts').classList.toggle('off', !!backgroundImg);
  $('bgImageHint').hidden = !backgroundImg;
}

$('cover').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { coverImg = im; }; im.src = r.result; };
  r.readAsDataURL(f);
};
$('removeCoverImage').onclick = () => { coverImg = null; $('cover').value = ''; };

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
  vizMode = m; $('vizMode').value = m; $('circularOpts').hidden = m !== 'circular'; $('mirroredOpts').hidden = m !== 'mirrored'; $('dotsOpts').hidden = m !== 'dots';
}
$('vizMode').onchange = e => setMode(e.target.value);
$('circRadius').oninput = e => { circRadius = +e.target.value; updateSliders(); };
$('circLength').oninput = e => { circLength = +e.target.value; updateSliders(); };
$('circWidth').oninput = e => { circWidth = +e.target.value; updateSliders(); };
$('circCount').oninput = e => { circCount = +e.target.value; updateSliders(); };
$('mirCount').oninput = e => { mirCount = +e.target.value; updateSliders(); };
$('dotsCount').oninput = e => { dotsCount = +e.target.value; updateSliders(); };
$('dotsPeak').onchange = e => { dotsPeak = e.target.checked; };
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
  const rad = starCfg.angle * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const sp = (1 + bass * starCfg.boost) * starCfg.speed * dt * 60;
  const f = starCfg.flash ? flash * starCfg.light : 0;
  g.fillStyle = '#fff';
  for (let i = 0; i < starCfg.count; i++) {
    const s = stars[i];
    s.x += (dx * s.k - dy * s.c) * sp; s.y += (dy * s.k + dx * s.c) * sp;
    if (s.x < -5) s.x = 1925; else if (s.x > 1925) s.x = -5;
    if (s.y < -5) s.y = 1085; else if (s.y > 1085) s.y = -5;
    g.globalAlpha = Math.min(1, s.a + f * 0.4);
    g.beginPath(); g.arc(s.x, s.y, s.r * (1 + f * 0.5), 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
}

const parts = [];
const peaks = new Float32Array(160), ridgeHist = [], RIDGE_ROWS = 14; let ridgeAcc = 0;   // LED-matrix peak dots, ridgeline history
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
    g.font = `${weight} ${size}px Montserrat, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = (ls * size) + 'px';
    size -= 2;
  } while (g.measureText(txt).width > maxW && size > 20);
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

  const c1 = visualColor, c2 = useGradient ? gradientColor : visualColor;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(c1), [r2, g2, b2] = rgb(c2);
  const FADE_FROM = 150, FADE_TO = 45;

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
    const gap = 7, w = (X1 - X0 - gap * (N - 1)) / N;
    g.fillStyle = vizFill;
    for (let i = 0; i < N; i++) {
      const h = MINH + vals[i] * (MAXH - MINH);
      const x = X0 + i * (w + gap), y = BASE - h;
      g.fillRect(x, y, w, h);
      const tx = (x + w / 2 - X0) / (X1 - X0);
      const br = Math.max(r1 + (r2 - r1) * tx, g1 + (g2 - g1) * tx, b1 + (b2 - b1) * tx);
      let o = rainbow ? 0 : Math.min(1, Math.max(0, (FADE_FROM - br) / (FADE_FROM - FADE_TO)));
      o = o * o * (3 - 2 * o);
      if (o > 0.01) {
        const lw = 1 + o;
        g.globalAlpha = o; g.strokeStyle = '#fff'; g.lineWidth = lw;
        g.strokeRect(x + lw / 2, y + lw / 2, Math.max(0, w - lw), Math.max(0, h - lw));
        g.globalAlpha = 1;
      }
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
    g.stroke(); g.lineCap = 'butt';
  } else if (vizMode === 'mirrored') {
    const cnt = mirCount, gap = Math.max(2, Math.min(10, 7 * N / cnt)), w = Math.max(1, (X1 - X0 - gap * (cnt - 1)) / cnt);
    g.fillStyle = vizFill;
    for (let i = 0; i < cnt; i++) {
      const f = cnt > 1 ? i / (cnt - 1) * (N - 1) : 0, a0 = Math.floor(f), v = vals[a0] + (vals[Math.min(N - 1, a0 + 1)] - vals[a0]) * (f - a0);   // interpolate between the 63 analysed bands
      const h = (MINH + v * (MAXH - MINH)) / 2, x = X0 + i * (w + gap);
      g.fillRect(x, MID - h, w, h * 2);   // one rectangle per bar = no seam in the middle
    }
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
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = 14 + bass * 30;
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
    g.shadowColor = rainbow ? '#ffffff' : c1; g.shadowBlur = 14 + bass * 30;
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
    g.globalAlpha = 1; g.fill(lit);
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
      g.globalAlpha = 0.55 * fade; g.fillStyle = '#000'; g.fill(rp.area);   // dark body hides the rows behind it
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

  if (coverImg) {
    const sq = Math.min(coverImg.width, coverImg.height);
    g.drawImage(coverImg, (coverImg.width - sq) / 2, (coverImg.height - sq) / 2, sq, sq, cx, cy, cs, cs);
  } else {
    g.fillStyle = coverGradient; g.fillRect(cx, cy, cs, cs);
    g.fillStyle = '#fff';
    g.font = `800 ${cs * 0.573}px Montserrat`; g.textAlign = 'center';
    g.fillText('♪', cx + cs / 2, cy + cs * 0.703); g.textAlign = 'left';
  }

  // text: right of the cover normally, centred under the ring in circular mode
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  const artist = $('artist').value.toUpperCase(), title = $('title').value.toUpperCase(), extra = $('extra').value.trim().toUpperCase();
  const three = !!extra;
  if (circ) {
    g.textAlign = 'center';
    fitText(artist, 700, three ? 70 : 82, 1500, three ? 0 : -0.01);
    g.fillText(artist, 960, three ? 925 : 945);
    fitText(title, 400, three ? 48 : 51, 1500, three ? 0.015 : 0);
    g.fillText(title, 960, three ? 975 : 1005);
    if (extra) { fitText(extra, 400, 48, 1500, 0.015); g.fillText(extra, 960, 1025); }
    g.textAlign = 'left';
  } else {
    fitText(artist, 700, three ? 70 : 82, X1 - 403, three ? 0 : -0.01);
    g.fillText(artist, 403, three ? 666 : 698);
    fitText(title, 400, three ? 48 : 51, X1 - 403, three ? 0.015 : 0);
    g.fillText(title, 403, three ? 716 : 753);
    if (extra) { fitText(extra, 400, 48, X1 - 403, 0.015); g.fillText(extra, 403, 762); }
  }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
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
  recDest = null;
}
$('recBtn').onclick = () => {
  if (recActive()) { stopRecording(); return; }
  if (!buf) { notify('Load a song first, then press play and start recording.', true); return; }
  if (!playing) { notify('Press play first, then start recording.', true); return; }
  if (typeof MediaRecorder === 'undefined' || !cv.captureStream) { notify('Video export is not supported in this browser.', true); return; }
  try {
    const stream = cv.captureStream(60);
    recDest = ctx.createMediaStreamDestination();
    src.connect(recDest);
    recDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const type = REC_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    const ext = type && type.includes('mp4') ? 'mp4' : 'webm';
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
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
    bassPulse, pulseAmt, bgReactive: bgAudioReactive, bgPulse: bgPulseAmt, lockOverlay, sens,
    stars: { ...starCfg }, particles: { ...partCfg }
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
  setCtl('bassPulse', p.bassPulse); setCtl('pulseAmt', p.pulseAmt); setCtl('bgAudioReactive', p.bgReactive); setCtl('bgPulseAmt', p.bgPulse); setCtl('sens', p.sens);
  const st = p.stars;
  if (st) {
    setCtl('starsOn', st.on); setCtl('starDensity', st.count); setCtl('starSpeed', st.speed);
    setCtl('starBoost', st.boost); setCtl('starFlash', st.flash); setCtl('starLight', st.light);
    if (typeof st.angle === 'number') { starCfg.angle = wrapDeg(st.angle); updateStarDial(); }
  }
  const q = p.particles;
  if (q) { setCtl('partOn', q.on); setCtl('partCount', q.count); setCtl('partSize', q.size); setCtl('partSpeed', q.speed); setCtl('partSens', q.sens); }
  updateOverlayTheme(); updateSliders();
}

const PRESETS = {
  default: { main: '#f2d90a', end: '#ff6a00', bg: '#000000', bgEnd: '#1a0b3d', useGrad: false, useBgGrad: true, mode: 'bars' },
  cyberpunk: { main: '#00f0ff', end: '#ff0055', bg: '#05020a', bgEnd: '#150526', useGrad: true, useBgGrad: true, mode: 'circular' },
  sunset: { main: '#ff7700', end: '#ff00aa', bg: '#100514', bgEnd: '#320d3e', useGrad: true, useBgGrad: true, mode: 'mirrored' },
  monochrome: { main: '#ffffff', end: '#888888', bg: '#000000', bgEnd: '#111111', useGrad: true, useBgGrad: true, mode: 'bars' }
};
$('presetSelect').onchange = e => { const p = PRESETS[e.target.value]; if (p) applySettings(p); };

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
  const rnd = (a, b) => a + Math.random() * (b - a), h = rnd(0, 360);
  applySettings({
    main: hsvToHex(h, rnd(0.65, 1), rnd(0.85, 1)), end: hsvToHex((h + rnd(40, 160)) % 360, rnd(0.65, 1), rnd(0.85, 1)),
    bg: hsvToHex(h, rnd(0.3, 0.8), rnd(0.03, 0.1)), bgEnd: hsvToHex((h + rnd(20, 80)) % 360, rnd(0.4, 0.9), rnd(0.12, 0.28)),
    useGrad: true, useBgGrad: true, bgAngle: Math.round(rnd(0, 360)),
    mode: MODES[Math.floor(Math.random() * MODES.length)]
  });
}
$('randomizeBtn').onclick = () => { randomizeSettings(); notify('Random look applied.'); };

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