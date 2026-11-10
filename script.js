const N = 63, X0 = 175, X1 = 1745, BASE = 543, MINH = 3, MAXH = 375;
// Settings fitted against the original video (63 bars, measured frame by frame).
const M = {
  f0: 20.9, f1: 13700, p: 0.572, tau: 0.471, wmax: 0.502, tilt: 4.40, cap: 15.94, agcmin: 0.1196, agcdec: 0.9995,
  floor: 0.0331, gamma: 1.529, att: 0.516, dec: 0.2844, sw: 0.2345, fp: 101.9, ltilt: -3.56
};
const DTV = 1001 / 30000;      // the fit's frame length (29.97 fps); all rates below scale with real frame time
const LEAD = 0 * 10 * DTV;         // the original's bars lead its audio by 10 frames (0.334 s)
let sens = 1, agc = M.agcmin, asrc = null, lastT = performance.now();
const raw = new Float32Array(N), sm2 = new Float32Array(N);
let lo = [], hi = [], fcs = [], gains = [], hz = 1, kmax = 0, sm, amp;
const cv = document.getElementById('c'), g = cv.getContext('2d');
const $ = id => document.getElementById(id);
let ctx, analyser, buf, src, startedAt = 0, offset = 0, playing = false, freq;
let coverImg = null, flash = 0, bassAvg = 0.2;
let visualColor = '#f2d90a', gradientColor = '#ff6a00', useGradient = false, backgroundColor = '#000000';
// Near-black picks keep their color; text on them turns white and a thin grey edge keeps them visible.
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
  bg: { h: 0, s: 0, v: 0, hex: '#000000' }
};
let overlayColors = false;

const rangeEls = Array.from(document.querySelectorAll('input[type=range]'));
function updateSliders() {
  for (const slider of rangeEls) {
    if (!slider) continue;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const percent = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

    const c1 = visualColor;
    const c2 = useGradient ? gradientColor : visualColor;
    const activeGrad = overlayColors ? `linear-gradient(90deg, ${c1}, ${c2})` : 'linear-gradient(90deg, #fff, #fff)';

    slider.style.backgroundImage = `linear-gradient(90deg, #444, #444), ${activeGrad}`;
    slider.style.backgroundSize = `calc((100% - 14px) * ${1 - percent / 100} + 7px) 100%, 100% 100%`;
    slider.style.backgroundPosition = 'right top, left top';
    slider.style.backgroundRepeat = 'no-repeat, no-repeat';
  }
}

function updateOverlayTheme() {
  overlayColors = $('overlayColors').checked;
  const root = document.documentElement;
  const a = overlayColors ? visualColor : '#ffffff';
  const b = overlayColors ? (useGradient ? gradientColor : visualColor) : '#ffffff';

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
const vals = new Float32Array(N);

// stars
const stars = Array.from({ length: 600 }, () => ({
  x: Math.random() * 1920, y: Math.random() * 1080,
  r: 0.5 + Math.random() * 1.8, k: 0.1 + Math.random() * 0.4,   // k: speed along the travel direction
  c: (Math.random() - 0.5) * 0.15, a: 0.25 + Math.random() * 0.6 // c: slight sideways drift
}));
const starCfg = { on: true, flash: true, count: 240, speed: 1, boost: 8, light: 1, dirX: -1, dirY: 0 };

function setup() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  const mute = ctx.createGain(); mute.gain.value = 0;
  analyser.connect(mute); mute.connect(ctx.destination);
  freq = new Float32Array(analyser.frequencyBinCount);
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
}

const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
function icon(p) { $('play').innerHTML = p ? STOP : PLAY; $('play').setAttribute('aria-label', p ? 'Stop' : 'Play'); }
icon(false);

function stopAll() { for (const n of [src, asrc]) if (n) { n.onended = null; try { n.stop(); } catch (e) { } } }
// Two sources: one you hear, one 0.334 s ahead that only feeds the analyser (the bars lead the sound).
function startAt(off) {
  stopAll();
  src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  src.onended = () => { if (playing) { playing = false; offset = 0; icon(false); vals.fill(0); } };
  src.start(0, off);
  asrc = null;
  if (off + LEAD < buf.duration) { asrc = ctx.createBufferSource(); asrc.buffer = buf; asrc.connect(analyser); asrc.start(0, off + LEAD); }
  sm.fill(0);
  startedAt = ctx.currentTime - off;
  playing = true;
  icon(true);
}

$('song').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  setup();
  $('status').textContent = 'Decoding audio…';
  try {
    buf = await ctx.decodeAudioData(await f.arrayBuffer());
    $('title').value = f.name.replace(/\.[^.]+$/, '');
    stopAll();
    playing = false; icon(false); vals.fill(0);
    offset = 0; $('play').disabled = false; $('seek').disabled = false;
    $('status').textContent = 'Ready. Press Play.';
  } catch (err) { $('status').textContent = 'Could not read that audio file. Try MP3, WAV or OGG.'; }
};

$('cover').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => coverImg = im; im.src = r.result; };
  r.readAsDataURL(f);
};

$('play').onclick = async () => {
  if (!buf) return;
  await ctx.resume();
  if (playing) { offset = ctx.currentTime - startedAt; stopAll(); playing = false; icon(false); }
  else startAt(offset % buf.duration);
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
function updatePicker(which) {
  const st = pickerState[which], hex = st.hex || hsvToHex(st.h, st.s, st.v);
  const prefix = which === 'main' ? 'color' : which === 'end' ? 'end' : 'bg';
  if (which === 'main') visualColor = hex;
  else if (which === 'end') gradientColor = hex;
  else backgroundColor = hex;
  const wheel = $(prefix + 'Wheel');
  const knob = $(prefix + 'HueKnob');
  const square = $(prefix + 'SV');
  const svknob = $(prefix + 'SVKnob');
  const angle = (st.h - 90) * Math.PI / 180, radius = 69;
  knob.style.left = (78 + Math.cos(angle) * radius) + 'px';
  knob.style.top = (78 + Math.sin(angle) * radius) + 'px';
  square.style.setProperty('--hue', `hsl(${st.h} 100% 50%)`);
  svknob.style.left = (st.s * 100) + '%';
  svknob.style.top = ((1 - st.v) * 100) + '%';
  $(prefix === 'color' ? 'colorSwatch' : prefix === 'end' ? 'endSwatch' : 'bgSwatch').style.background = hex;
  syncFields(prefix, hex);

  updateOverlayTheme();
  updateSliders();
}
function bindPicker(which) {
  const prefix = which === 'main' ? 'color' : which === 'end' ? 'end' : 'bg';
  const wheel = $(prefix + 'Wheel');
  const square = $(prefix + 'SV');
  let mode = '';
  function updateFromPointer(el, e) {
    const rect = el.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    pickerState[which].hex = null; // dragging the wheel/square takes over from typed values
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
    el.addEventListener('pointerdown', e => { e.stopPropagation(); mode = el.id; el.setPointerCapture(e.pointerId); updateFromPointer(el, e); });
    el.addEventListener('pointermove', e => { e.stopPropagation(); if (mode === el.id) updateFromPointer(el, e); });
    el.addEventListener('pointerup', () => mode = '');
    el.addEventListener('pointercancel', () => mode = '');
  }
}
$('gradient').onchange = e => {
  useGradient = e.target.checked;
  $('endColorWrap').hidden = !useGradient;
  updateOverlayTheme();
  updateSliders();
};
function syncFields(prefix, hex) {
  const n = parseInt(hex.slice(1), 16), v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const set = (id, val) => { const el = $(id); if (el && document.activeElement !== el) el.value = val; };
  set(prefix + 'HexIn', hex.toUpperCase());
  ['R', 'G', 'B'].forEach((c, i) => set(prefix + c, v[i]));
}
function bindFields(which) {
  const prefix = which === 'main' ? 'color' : which === 'end' ? 'end' : 'bg', st = pickerState[which];
  const current = () => st.hex || hsvToHex(st.h, st.s, st.v);
  const apply = (r, gr, b) => {
    const hex = '#' + [r, gr, b].map(x => x.toString(16).padStart(2, '0')).join('');
    const hsv = hexToHsv(hex);
    if (hsv.v === 0) { hsv.h = st.h; hsv.s = st.s; } else if (hsv.s === 0) hsv.h = st.h; // keep the wheel where it was for black/gray
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
bindPicker('main'); bindPicker('end'); bindPicker('bg'); bindFields('main'); bindFields('end'); bindFields('bg');
updatePicker('main'); updatePicker('end'); updatePicker('bg');
updateOverlayTheme();
updateSliders();

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
  if (b > bassAvg * 1.25 && b > 0.35) flash = 1;
  bassAvg = bassAvg * 0.95 + b * 0.05;
  flash *= 0.9;
  return b;
}

function drawStars(bass, dt) {
  if (!starCfg.on) return;
  const dx = starCfg.dirX, dy = starCfg.dirY, sp = (1 + bass * starCfg.boost) * starCfg.speed * dt * 60, f = starCfg.flash ? flash * starCfg.light : 0;
  g.fillStyle = '#fff';
  for (let i = 0; i < starCfg.count; i++) {
    const s = stars[i];
    s.x += (dx * s.k + dy * s.c) * sp; s.y += (dy * s.k + dx * s.c) * sp;
    if (s.x < -5) s.x = 1925; else if (s.x > 1925) s.x = -5;
    if (s.y < -5) s.y = 1085; else if (s.y > 1085) s.y = -5;
    g.globalAlpha = Math.min(1, s.a + f * 0.4);
    g.beginPath(); g.arc(s.x, s.y, s.r * (1 + f * 0.5), 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
}

function fitText(txt, weight, size, maxW, ls = 0) {
  // Text metrics measured from the original (AU5 reference): artist ~70px bold, title/extra ~48px book, baselines 666/716/762.
  do {
    g.font = `${weight} ${size}px Montserrat, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = (ls * size) + 'px';
    size -= 2;
  } while (g.measureText(txt).width > maxW && size > 20);
}

function frame() {
  const now = performance.now(), dt = Math.min(0.1, Math.max(0.004, (now - lastT) / 1000)); lastT = now;
  const bass = analyse(dt); ui();
  g.fillStyle = backgroundColor; g.fillRect(0, 0, 1920, 1080);
  drawStars(bass, dt);

  // Resolve the selected color (or horizontal gradient) for both spectrum and default artwork.
  const c1 = visualColor, c2 = useGradient ? gradientColor : visualColor;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(c1), [r2, g2, b2] = rgb(c2);
  const FADE_FROM = 150, FADE_TO = 45; // the white outline fades in as a bar's brightest channel drops from FADE_FROM to FADE_TO


  const barGradient = g.createLinearGradient(X0, 0, X1, 0);
  barGradient.addColorStop(0, c1); barGradient.addColorStop(1, c2);
  const coverGradient = g.createLinearGradient(175, 593, 367, 785);
  coverGradient.addColorStop(0, c1); coverGradient.addColorStop(1, c2);

  // bars
  const gap = 7, w = (X1 - X0 - gap * (N - 1)) / N;
  g.fillStyle = barGradient;
  for (let i = 0; i < N; i++) {
    const h = MINH + vals[i] * (MAXH - MINH);
    const x = X0 + i * (w + gap), y = BASE - h;
    g.fillRect(x, y, w, h);
    const tx = (x + w / 2 - X0) / (X1 - X0);   // where this bar sits along the gradient
    const br = Math.max(r1 + (r2 - r1) * tx, g1 + (g2 - g1) * tx, b1 + (b2 - b1) * tx);
    let o = Math.min(1, Math.max(0, (FADE_FROM - br) / (FADE_FROM - FADE_TO)));
    o = o * o * (3 - 2 * o);                   // smoothstep: eases in instead of switching on
    if (o > 0.01) {
      const lw = 1 + o;                        // thin and faint at first, full 2px white once the bar is nearly black
      g.globalAlpha = o; g.strokeStyle = '#fff'; g.lineWidth = lw;
      g.strokeRect(x + lw / 2, y + lw / 2, Math.max(0, w - lw), Math.max(0, h - lw));
      g.globalAlpha = 1;
    }
  }

  // cover: user artwork stays untouched; otherwise the note tile follows the chosen palette.
  const cx = 175, cy = 593, cs = 192;
  if (coverImg) {
    const s = Math.min(coverImg.width, coverImg.height);
    g.drawImage(coverImg, (coverImg.width - s) / 2, (coverImg.height - s) / 2, s, s, cx, cy, cs, cs);
  } else {
    g.fillStyle = coverGradient; g.fillRect(cx, cy, cs, cs);
    g.fillStyle = '#fff';
    g.font = '800 110px Montserrat'; g.textAlign = 'center';
    g.fillText('♪', cx + cs / 2, cy + 135); g.textAlign = 'left';
  }

  // text
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  const artist = $('artist').value.toUpperCase(), title = $('title').value.toUpperCase(), extra = $('extra').value.trim().toUpperCase();
  const three = !!extra;   // with extra info the original uses a smaller 3-line layout
  fitText(artist, 700, three ? 70 : 82, X1 - 403, three ? 0 : -0.01);
  g.fillText(artist, 403, three ? 666 : 698);
  fitText(title, 400, three ? 48 : 51, X1 - 403, three ? 0.015 : 0);
  g.fillText(title, 403, three ? 716 : 753);
  if (extra) { fitText(extra, 400, 48, X1 - 403, 0.015); g.fillText(extra, 403, 762); }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  requestAnimationFrame(frame);
}
// ---- star settings ----
function syncStarUI() {
  $('starOpts').classList.toggle('off', !starCfg.on);
  $('starOpts').inert = !starCfg.on;
  $('starLight').disabled = !starCfg.flash;
}
$('starsOn').onchange = e => { starCfg.on = e.target.checked; syncStarUI(); };
$('starFlash').onchange = e => { starCfg.flash = e.target.checked; syncStarUI(); updateSliders(); };
$('starDensity').oninput = e => { starCfg.count = +e.target.value; updateSliders(); };
$('starSpeed').oninput = e => { starCfg.speed = +e.target.value; updateSliders(); };
$('starBoost').oninput = e => { starCfg.boost = +e.target.value; updateSliders(); };
$('starLight').oninput = e => { starCfg.light = +e.target.value; updateSliders(); };
// One horizontal and one vertical direction may be active together.
// Choosing a new direction replaces only the previous direction on that axis.
document.querySelectorAll('#starDirection button').forEach(b => b.onclick = () => {
  const value = b.dataset.dir;
  if (value === 'left' || value === 'right') {
    starCfg.dirX = value === 'left' ? -1 : 1;
  } else {
    starCfg.dirY = value === 'up' ? -1 : 1;
  }
  document.querySelectorAll('#starDirection button').forEach(o => {
    const d = o.dataset.dir;
    const active = (d === 'left' && starCfg.dirX === -1) ||
      (d === 'right' && starCfg.dirX === 1) ||
      (d === 'up' && starCfg.dirY === -1) ||
      (d === 'down' && starCfg.dirY === 1);
    o.setAttribute('aria-pressed', String(active));
  });
});
syncStarUI(); updateSliders();

// ---- full screen + play bar toggle (buttons show on hover, like a video player) ----
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
  if (!req) { pseudoFS = true; syncFS(); return; }   // e.g. iPhone Safari: fill the window instead
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
  if (!stage.classList.contains('fs')) return;   // outside full screen the buttons simply follow hover
  stage.classList.add('active'); stage.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => { stage.classList.remove('active'); if (stage.classList.contains('fs')) stage.classList.add('idle'); }, 1000);
}
fsBtn.onclick = e => { toggleFS(); if (e.detail) fsBtn.blur(); };
barBtn.onclick = e => { showBar = !showBar; syncBar(); if (e.detail) barBtn.blur(); };
['pointermove', 'pointerdown', 'touchstart'].forEach(ev => stage.addEventListener(ev, wake, { passive: true }));
stage.addEventListener('pointerleave', e => {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(idleT); stage.classList.remove('active', 'idle');   // leaving with the mouse hides them at once
});
document.addEventListener('fullscreenchange', syncFS);
document.addEventListener('webkitfullscreenchange', syncFS);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pseudoFS) { pseudoFS = false; syncFS(); } });
syncFS(); syncBar();

document.fonts.load('700 40px Montserrat').then(() => document.fonts.load('800 40px Montserrat')).then(() => document.fonts.load('400 40px Montserrat')).finally(frame);
