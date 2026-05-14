import { vsGLSL, simGLSL, atlasGLSL, blurGLSL, ruptureGLSL, childInitGLSL, childSimGLSL, renderGLSL, renderNoChildGLSL } from './shaders.js';

const canvas = document.getElementById('view');
const panel = document.getElementById('panel');
const probeFrame = document.getElementById('probeFrame');
const probeLabel = document.getElementById('probeLabel');
const mouseReticle = document.getElementById('mouseReticle');
const corner = document.getElementById('corner');
const el = (id) => document.getElementById(id);

const stats = {
  engine: el('engineStat'), matrix: el('matrixStat'), tick: el('tickStat'), energy: el('energyStat'),
  focus: el('focusStat'), descent: el('descentStat'), quality: el('qualityStat'), atlas: el('atlasStat'), subspace: el('subspaceStat'), coherence: el('coherenceStat'), log: el('log')
};

// Presentation buffer is intentionally capped. CSS still stretches the canvas to
// the screen, but the GPU does not render the final projection at Retina scale.
// This keeps final-pass texture reads bounded on MacBook Air / Intel GPUs.
const PRESENT_WIDTH = 1280;
const PRESENT_HEIGHT = 720;
const CHUNK_GRID = 4;
const MAX_CHUNKS = CHUNK_GRID * CHUNK_GRID;
const TARGET_CHILD_ATLAS_SIZE = 1024;
const RUPTURE_PRESSURE = 7.5;
const FOLD_PRESSURE = 2.4;

let paused = false;
let viewMode = 0;
let descentProbeMode = false;
let probePointerX = 0.5;
let probePointerY = 0.5;
let startTime = performance.now();
let lastNow = performance.now();
let fps = 0;
let tick = 0;
let simTime = 0;
let simAccumulator = 0;
let app = null;

// The simulation advances on fixed-time steps so render hitches, tab stalls,
// or future diagnostic work cannot inject a larger one-frame physics kick.
const FIXED_SIM_DT = 1 / 60;
const MAX_SIM_STEPS_PER_FRAME = 3;
const MAX_SIM_ACCUMULATED_DT = 0.050;
const subspace = {
  chunks: Array.from({ length: MAX_CHUNKS }, () => null),
  active: [],
  byKey: new Map(),
  pendingPointers: [],
  pendingInits: []
};

const ui = {
  focusX: 0.5,
  focusY: 0.5,
  mainZoom: 1.0,
  descentLevel: 2,
  qualityIndex: 1,
  qualities: [
    { name: 'low', substeps: 1, blurPasses: 0, detail: 0.65, tapLevel: 0, probeFactor: 3.0 },
    { name: 'medium', substeps: 2, blurPasses: 1, detail: 1.05, tapLevel: 1, probeFactor: 4.0 },
    { name: 'high', substeps: 3, blurPasses: 1, detail: 1.45, tapLevel: 2, probeFactor: 5.0 },
    { name: '3x3', substeps: 9, blurPasses: 3, detail: 4.35, tapLevel: 3, probeFactor: 6.5 }
  ]
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmt(x, n=3) { return Number(x).toFixed(n); }
function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}
function setClassName(node, value) {
  if (node && node.className !== value) node.className = value;
}
function setLog(line) { setText(stats.log, line); }
function currentQuality() {
  return ui.qualities[ui.qualityIndex];
}
function projectionDetail() {
  const q = currentQuality();
  const z = Math.log2(Math.max(1, ui.mainZoom));
  const detailCap = q.tapLevel >= 3 ? 4.35 : 2.0;
  return clamp(q.detail + z * 0.18, 0.65, detailCap);
}

function selectedResetQualityIndex() {
  const node = el('qualityOverride');
  const raw = node ? Number(node.value) : ui.qualityIndex;
  return clamp(Number.isFinite(raw) ? raw : ui.qualityIndex, 0, ui.qualities.length - 1);
}
function syncResetQualityLabel() {
  const idx = selectedResetQualityIndex();
  const reset = el('resetBtn');
  setText(reset, 'Reset at Quality ' + (idx + 1));
}
function applyResetQualitySelection() {
  const idx = selectedResetQualityIndex();
  ui.qualityIndex = idx;
  syncResetQualityLabel();
  return idx;
}
function noteResetQualitySelection() {
  const idx = selectedResetQualityIndex();
  syncResetQualityLabel();
  updateDerivedStats();
  setLog('Quality ' + (idx + 1) + ' selected for the next reset only. Current run quality remains unchanged.');
}

function parentCellForFocus(size) {
  return {
    x: clamp(Math.floor(ui.focusX * size), 0, size - 1),
    y: clamp(Math.floor(ui.focusY * size), 0, size - 1)
  };
}
function parentKey(cell) { return cell.x + ':' + cell.y; }
function descentPressure() { return ui.mainZoom * Math.pow(1.55, ui.descentLevel); }
function activeChunkCount() { return subspace.active.length; }
function firstFreeChunk() { return subspace.chunks.findIndex((x) => !x); }
function clearSubspaceQueues() {
  subspace.byKey.clear();
  subspace.active.length = 0;
  subspace.pendingPointers.length = 0;
  subspace.pendingInits.length = 0;
  for (let i = 0; i < subspace.chunks.length; i++) subspace.chunks[i] = null;
}
function releaseSubspaceRecordsKeepPointerQueue() {
  subspace.byKey.clear();
  subspace.active.length = 0;
  subspace.pendingInits.length = 0;
  for (let i = 0; i < subspace.chunks.length; i++) subspace.chunks[i] = null;
}
function requestUnfoldCell(size, cell) {
  if (!app || app.kind !== 'webgl2') return false;
  const safeCell = {
    x: clamp(cell.x, 0, size - 1),
    y: clamp(cell.y, 0, size - 1)
  };
  const key = parentKey(safeCell);
  if (subspace.byKey.has(key)) return false;
  const chunkId = firstFreeChunk();
  if (chunkId < 0) return false;
  const parentUv = [(safeCell.x + 0.5) / size, (safeCell.y + 0.5) / size];
  const record = { chunkId, key, cell: safeCell, parentUv, age: 0, pressureAtBirth: descentPressure() };
  subspace.chunks[chunkId] = record;
  subspace.active.push(record);
  subspace.byKey.set(key, record);
  subspace.pendingPointers.push({ cell: safeCell, pointer: -(chunkId + 1.0) });
  subspace.pendingInits.push(record);
  return true;
}
function requestUnfoldPatchAtFocus(size) {
  const center = parentCellForFocus(size);
  const offsets = [[0,0], [1,0], [-1,0], [0,1], [0,-1]];
  const seen = new Set();
  let made = 0;
  for (const [dx, dy] of offsets) {
    const cell = {
      x: clamp(center.x + dx, 0, size - 1),
      y: clamp(center.y + dy, 0, size - 1)
    };
    const key = parentKey(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    if (requestUnfoldCell(size, cell)) made++;
  }
  if (made && app?.kind === 'webgl2') {
    app.gl.bindVertexArray(app.vao);
    processSubspaceQueues(app);
  }
  return made;
}
function maybeFoldWhenFullyAscended() {
  if (!app || app.kind !== 'webgl2') return;
  if (activeChunkCount() === 0) return;
  if (descentPressure() > FOLD_PRESSURE || ui.mainZoom > 1.15 || ui.descentLevel > 0) return;
  for (const record of subspace.active) {
    subspace.pendingPointers.push({ cell: record.cell, pointer: 1.0 });
  }
  releaseSubspaceRecordsKeepPointerQueue();
}

function updateDerivedStats() {
  const q = currentQuality();
  const probeZoom = ui.mainZoom * q.probeFactor * Math.pow(1.9, ui.descentLevel);
  setText(stats.focus, fmt(ui.focusX, 3) + ', ' + fmt(ui.focusY, 3));
  setText(stats.descent, 'main ×' + ui.mainZoom.toFixed(1) + ' / probe ×' + probeZoom.toFixed(1));
  setText(stats.quality, 'quality ' + (ui.qualityIndex + 1) + ' · ' + q.name + ' · next reset ' + (selectedResetQualityIndex() + 1));
  setText(stats.atlas, 'trail + kernel memory');
  setText(stats.subspace, activeChunkCount() + '/' + MAX_CHUNKS + ' chunks · probe ' + (descentProbeMode ? 'armed' : 'off'));
  setText(el('descentProbeBtn'), descentProbeMode ? 'Descent Probe Armed' : 'Descent Probe Mode');
  setClassName(el('descentProbeBtn'), descentProbeMode ? 'warn' : '');
  canvas.classList.toggle('descent-armed', descentProbeMode);
  if (mouseReticle) mouseReticle.classList.toggle('hidden', !descentProbeMode);
  syncResetQualityLabel();
  probeFrame.classList.toggle('hidden', !descentProbeMode);
  setText(probeLabel, 'descent probe ×' + probeZoom.toFixed(1));
}
function resizeCanvas() {
  // Do not multiply by devicePixelRatio. Retina displays can silently turn a
  // fullscreen canvas into a 2560×1600 render target. The hidden matrix remains
  // fixed-size, and this capped presentation buffer is stretched by CSS.
  const w = PRESENT_WIDTH;
  const h = PRESENT_HEIGHT;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

el('pauseBtn').onclick = () => { paused = !paused; setText(el('pauseBtn'), paused ? 'Resume' : 'Pause'); };
el('resetBtn').onclick = () => resetZero();
el('resetZoomBtn').onclick = () => resetZoomGeneration();
el('descentProbeBtn').onclick = () => {
  descentProbeMode = !descentProbeMode;
  probePointerX = ui.focusX;
  probePointerY = ui.focusY;
  updateReticlePositionFromUv(probePointerX, probePointerY);
  updateDerivedStats();
  setLog(descentProbeMode ? 'Descent Probe Mode armed: move the mouse to place the reticle, then click to generate a 5-tile descent patch and zoom camera into that spot.' : 'Descent Probe Mode cancelled.');
};
el('qualityOverride').onchange = () => noteResetQualitySelection();
el('hideBtn').onclick = () => panel.classList.toggle('hidden');
el('viewMode').onchange = () => { viewMode = Number(el('viewMode').value); };
window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();
  const handled = (k === 'h' || k === ' ' || k === 'r' || k === 'z' || k === 'v' || k === 'escape');
  if (!handled) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();

  if (k === 'h') panel.classList.toggle('hidden');
  if (k === ' ') el('pauseBtn').click();
  if (k === 'r') resetZero();
  if (k === 'z') resetZoomGeneration();
  if (k === 'v') { viewMode = (viewMode + 1) % el('viewMode').options.length; el('viewMode').value = String(viewMode); }
  if (k === 'escape' && descentProbeMode) { descentProbeMode = false; updateDerivedStats(); setLog('Descent Probe Mode cancelled.'); }
});
function uvFromMouseEvent(ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp((ev.clientX - r.left) / r.width, 0.0, 1.0),
    y: clamp(1.0 - (ev.clientY - r.top) / r.height, 0.0, 1.0),
    px: ev.clientX,
    py: ev.clientY
  };
}
function updateReticlePositionFromUv(x, y) {
  if (!mouseReticle) return;
  const r = canvas.getBoundingClientRect();
  mouseReticle.style.left = (r.left + x * r.width) + 'px';
  mouseReticle.style.top = (r.top + (1.0 - y) * r.height) + 'px';
}
canvas.addEventListener('mousemove', (ev) => {
  if (!descentProbeMode) return;
  const uv = uvFromMouseEvent(ev);
  probePointerX = uv.x;
  probePointerY = uv.y;
  if (mouseReticle) {
    mouseReticle.style.left = uv.px + 'px';
    mouseReticle.style.top = uv.py + 'px';
  }
});
canvas.addEventListener('click', (ev) => {
  const uv = uvFromMouseEvent(ev);
  ui.focusX = uv.x;
  ui.focusY = uv.y;
  if (descentProbeMode) {
    ui.mainZoom = clamp(Math.max(ui.mainZoom, 7.0), 1.0, 48.0);
    ui.descentLevel = Math.max(ui.descentLevel, 2);
    const made = app?.kind === 'webgl2' ? requestUnfoldPatchAtFocus(app.size) : 0;
    descentProbeMode = false;
    updateDerivedStats();
    setLog('Descent committed: camera centered on selected point and ' + made + ' new micro-tile(s) requested in a 5-cell patch. Use Reset Zoom Tiles + Center to clear active zoom generation.');
  } else {
    updateDerivedStats();
  }
});
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  ui.mainZoom = clamp(ui.mainZoom * Math.exp(-ev.deltaY * 0.0012), 1.0, 48.0);
  updateDerivedStats();
}, { passive: false });

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p) || 'program link failed';
    gl.deleteProgram(p);
    throw new Error(info);
  }
  return p;
}
function tex(gl, w, h, formatInfo, filter = gl.NEAREST) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, formatInfo.internalFormat, w, h, 0, gl.RGBA, formatInfo.type, null);
  return t;
}
function makeTextureFormat(gl, internalFormat, type, label) {
  return { internalFormat, type, label };
}
function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x03ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
function bindTexture(gl, slot, texture) {
  gl.activeTexture(gl.TEXTURE0 + slot);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}
const uniformLocations = new WeakMap();
function uniformLocation(gl, p, name) {
  let cache = uniformLocations.get(p);
  if (!cache) {
    cache = new Map();
    uniformLocations.set(p, cache);
  }
  if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
  return cache.get(name);
}
function set1i(gl, p, name, v) {
  const loc = uniformLocation(gl, p, name);
  if (loc !== null) gl.uniform1i(loc, v);
}
function set1f(gl, p, name, v) {
  const loc = uniformLocation(gl, p, name);
  if (loc !== null) gl.uniform1f(loc, v);
}
function set2i(gl, p, name, x, y) {
  const loc = uniformLocation(gl, p, name);
  if (loc !== null) gl.uniform2i(loc, x, y);
}
function set2f(gl, p, name, x, y) {
  const loc = uniformLocation(gl, p, name);
  if (loc !== null) gl.uniform2f(loc, x, y);
}

function initWebGL() {
  resizeCanvas();
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
  const halfLinear = !!gl.getExtension('OES_texture_half_float_linear');
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');

  const halfFloatFormat = makeTextureFormat(gl, gl.RGBA16F, gl.HALF_FLOAT, 'RGBA16F');
  const fullFloatFormat = makeTextureFormat(gl, gl.RGBA32F, gl.FLOAT, 'RGBA32F');
  let textureFormat = halfFloatFormat;
  let atlasFilter = halfLinear ? gl.LINEAR : gl.NEAREST;

  const simProgram = program(gl, vsGLSL, simGLSL);
  const atlasProgram = program(gl, vsGLSL, atlasGLSL);
  const blurProgram = program(gl, vsGLSL, blurGLSL);
  const ruptureProgram = program(gl, vsGLSL, ruptureGLSL);
  const childInitProgram = program(gl, vsGLSL, childInitGLSL);
  const childSimProgram = program(gl, vsGLSL, childSimGLSL);
  const renderProgram = program(gl, vsGLSL, renderGLSL);
  const renderNoChildProgram = program(gl, vsGLSL, renderNoChildGLSL);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const size = Math.min(512, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const childAtlasSize = Math.min(TARGET_CHILD_ATLAS_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const chunkSize = Math.floor(childAtlasSize / CHUNK_GRID);
  const fbo = gl.createFramebuffer();
  let state = [tex(gl, size, size, textureFormat, gl.NEAREST), tex(gl, size, size, textureFormat, gl.NEAREST)];
  let atlas = [tex(gl, size, size, textureFormat, atlasFilter), tex(gl, size, size, textureFormat, atlasFilter)];
  let child = null;

  const clearZero = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const clearLists = [[state, size], [atlas, size]];
    if (child) clearLists.push([child, childAtlasSize]);
    for (const [list, clearSize] of clearLists) {
      for (const t of list) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.viewport(0, 0, clearSize, clearSize);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  clearZero();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state[0], 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    // Some browser/GPU combinations expose float color buffers but reject RGBA16F
    // as a render target. Keep boot reliable by falling back to RGBA32F.
    textureFormat = fullFloatFormat;
    atlasFilter = floatLinear ? gl.LINEAR : gl.NEAREST;
    state = [tex(gl, size, size, textureFormat, gl.NEAREST), tex(gl, size, size, textureFormat, gl.NEAREST)];
    atlas = [tex(gl, size, size, textureFormat, atlasFilter), tex(gl, size, size, textureFormat, atlasFilter)];
    child = null;
    clearZero();
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state[0], 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float framebuffer incomplete');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { kind: 'webgl2', gl, simProgram, atlasProgram, blurProgram, ruptureProgram, childInitProgram, childSimProgram, renderProgram, renderNoChildProgram, vao, size, childAtlasSize, chunkSize, state, atlas, child, fbo, textureFormat, childFilter: atlasFilter, atlasLinear: atlasFilter === gl.LINEAR, atlasFilterLabel: atlasFilter === gl.LINEAR ? 'linear atlas' : 'nearest atlas', sRead:0, sWrite:1, aRead:0, aWrite:1, cRead:0, cWrite:1, clearZero };
}

function ensureChildAtlas(a) {
  if (!a || a.kind !== 'webgl2' || a.child) return;
  const gl = a.gl;
  a.child = [
    tex(gl, a.childAtlasSize, a.childAtlasSize, a.textureFormat, a.childFilter),
    tex(gl, a.childAtlasSize, a.childAtlasSize, a.textureFormat, a.childFilter)
  ];
  gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
  for (const target of a.child) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, a.childAtlasSize, a.childAtlasSize);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resetZero() {
  const resetQualityIndex = applyResetQualitySelection();
  tick = 0;
  simTime = 0;
  startTime = performance.now();
  clearSubspaceQueues();
  if (app?.clearZero) app.clearZero();
  setText(stats.matrix, 'exact zero');
  setText(stats.energy, 'diagnostics off');
  setClassName(stats.energy, 'warn');
  setText(stats.coherence, 'diagnostics off');
  setClassName(stats.coherence, 'warn');
  updateDerivedStats();
  setLog('Reset complete at quality ' + (resetQualityIndex + 1) + ': macro field, support atlas, child hash atlas, and W-pointers cleared to exact zero. Genesis resumes from fold debt only.');
}

function clearChildAtlasTextures(a) {
  if (!a || a.kind !== 'webgl2' || !a.child) return;
  const gl = a.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
  for (const target of a.child) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, a.childAtlasSize, a.childAtlasSize);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resetZoomGeneration() {
  const records = subspace.active.slice();
  subspace.pendingPointers.length = 0;
  subspace.pendingInits.length = 0;

  // Drop descent pressure below rupture threshold so the same focus cell cannot
  // immediately re-allocate a new chunk on the next frame. Also recenter the
  // projection focus so the camera returns to the macro box area after a local
  // descent tile has pulled attention off-center.
  ui.mainZoom = 1.0;
  ui.descentLevel = 0;
  ui.focusX = 0.5;
  ui.focusY = 0.5;
  descentProbeMode = false;

  if (records.length && app?.kind === 'webgl2') {
    for (const record of records) subspace.pendingPointers.push({ cell: record.cell, pointer: 1.0 });
    app.gl.bindVertexArray(app.vao);
    processSubspaceQueues(app);
  }

  subspace.byKey.clear();
  subspace.active.length = 0;
  for (let i = 0; i < subspace.chunks.length; i++) subspace.chunks[i] = null;
  subspace.pendingPointers.length = 0;
  subspace.pendingInits.length = 0;
  clearChildAtlasTextures(app);

  updateDerivedStats();
  setLog('Zoom-generation reset: active mini-tiles released, W-pointers restored, child hash atlas cleared, descent pressure returned below rupture threshold, and focus recentered. Macro field/scar state was not reset.');
}

function drawFull(gl) { gl.drawArrays(gl.TRIANGLES, 0, 3); }
function drawToTexture(gl, texture, size, programToUse) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, app.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, size, size);
  gl.useProgram(programToUse);
}
function swapState(a) { const t = a.sRead; a.sRead = a.sWrite; a.sWrite = t; }
function swapAtlas(a) { const t = a.aRead; a.aRead = a.aWrite; a.aWrite = t; }
function swapChild(a) { const t = a.cRead; a.cRead = a.cWrite; a.cWrite = t; }

function getProbeViewport() {
  const rect = probeFrame.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const sx = canvas.width / canvasRect.width;
  const sy = canvas.height / canvasRect.height;
  const x = Math.floor((rect.left - canvasRect.left) * sx);
  const topY = Math.floor((rect.top - canvasRect.top) * sy);
  const w = Math.max(1, Math.floor(rect.width * sx));
  const h = Math.max(1, Math.floor(rect.height * sy));
  return { x, y: canvas.height - topY - h, w, h };
}
function drawViewport(gl, a, viewport, centerX, centerY, zoom) {
  const q = currentQuality();
  const renderProgram = activeChunkCount() > 0 ? a.renderProgram : a.renderNoChildProgram;
  gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);
  gl.useProgram(renderProgram);
  bindTexture(gl, 0, a.state[a.sRead]); set1i(gl, renderProgram, 'uState', 0);
  bindTexture(gl, 1, a.atlas[a.aRead]); set1i(gl, renderProgram, 'uAtlas', 1);
  if (activeChunkCount() > 0) {
    ensureChildAtlas(a);
    bindTexture(gl, 2, a.child[a.cRead]); set1i(gl, renderProgram, 'uChildState', 2);
    set1f(gl, renderProgram, 'uMacroSize', a.size);
    set1f(gl, renderProgram, 'uChunkGrid', CHUNK_GRID);
  }
  set2f(gl, renderProgram, 'uTexel', 1/a.size, 1/a.size);
  set1i(gl, renderProgram, 'uView', viewMode);
  set2f(gl, renderProgram, 'uFocus', centerX, centerY);
  set1f(gl, renderProgram, 'uZoom', zoom);
  set1f(gl, renderProgram, 'uDetail', projectionDetail());
  set1i(gl, renderProgram, 'uQualityLevel', q.tapLevel);
  drawFull(gl);
}


function chunkViewport(a, chunkId) {
  const cx = chunkId % CHUNK_GRID;
  const cy = Math.floor(chunkId / CHUNK_GRID);
  return { x: cx * a.chunkSize, y: cy * a.chunkSize, w: a.chunkSize, h: a.chunkSize };
}
function chunkOrigin(a, chunkId) {
  const cx = chunkId % CHUNK_GRID;
  const cy = Math.floor(chunkId / CHUNK_GRID);
  return [cx / CHUNK_GRID, cy / CHUNK_GRID];
}
function applyParentPointer(a, cell, pointer) {
  const gl = a.gl;
  drawToTexture(gl, a.state[a.sWrite], a.size, a.ruptureProgram);
  bindTexture(gl, 0, a.state[a.sRead]); set1i(gl, a.ruptureProgram, 'uPrev', 0);
  set2i(gl, a.ruptureProgram, 'uParentCell', cell.x, cell.y);
  set1f(gl, a.ruptureProgram, 'uPointerValue', pointer);
  set1i(gl, a.ruptureProgram, 'uEnable', 1);
  drawFull(gl);
  swapState(a);
}
function initChildChunk(a, record) {
  const gl = a.gl;
  const vp = chunkViewport(a, record.chunkId);
  const targets = [a.child[a.cRead], a.child[a.cWrite]];
  for (const target of targets) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(vp.x, vp.y, vp.w, vp.h);
    gl.useProgram(a.childInitProgram);
    bindTexture(gl, 0, a.state[a.sRead]); set1i(gl, a.childInitProgram, 'uMacroState', 0);
    set2f(gl, a.childInitProgram, 'uParentUv', record.parentUv[0], record.parentUv[1]);
    set1f(gl, a.childInitProgram, 'uTime', simTime);
    set1f(gl, a.childInitProgram, 'uChunkId', record.chunkId);
    drawFull(gl);
  }
}
function processSubspaceQueues(a) {
  if (subspace.pendingPointers.length) {
    const pending = subspace.pendingPointers.splice(0);
    for (const item of pending) applyParentPointer(a, item.cell, item.pointer);
  }
  if (subspace.pendingInits.length) {
    ensureChildAtlas(a);
    const pending = subspace.pendingInits.splice(0);
    for (const record of pending) initChildChunk(a, record);
  }
}
function stepActiveChunks(a, dt) {
  const gl = a.gl;
  const active = subspace.active;
  if (!active.length) return;
  ensureChildAtlas(a);
  gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.child[a.cWrite], 0);
  gl.useProgram(a.childSimProgram);
  bindTexture(gl, 0, a.child[a.cRead]); set1i(gl, a.childSimProgram, 'uPrevChild', 0);
  bindTexture(gl, 1, a.state[a.sRead]); set1i(gl, a.childSimProgram, 'uMacroState', 1);
  set2f(gl, a.childSimProgram, 'uChildTexel', 1 / a.childAtlasSize, 1 / a.childAtlasSize);
  set1f(gl, a.childSimProgram, 'uTime', simTime);
  set1f(gl, a.childSimProgram, 'uDt', dt);
  for (const record of active) {
    const vp = chunkViewport(a, record.chunkId);
    const origin = chunkOrigin(a, record.chunkId);
    gl.viewport(vp.x, vp.y, vp.w, vp.h);
    set2f(gl, a.childSimProgram, 'uChunkOrigin', origin[0], origin[1]);
    set2f(gl, a.childSimProgram, 'uChunkScale', 1 / CHUNK_GRID, 1 / CHUNK_GRID);
    set2f(gl, a.childSimProgram, 'uParentUv', record.parentUv[0], record.parentUv[1]);
    drawFull(gl);
    record.age += dt;
  }
  swapChild(a);
}

function stepWebGL(a, now) {
  const gl = a.gl;
  gl.bindVertexArray(a.vao);
  const q = currentQuality();

  let fixedSteps = 0;
  if (paused) {
    simAccumulator = 0;
  } else {
    const elapsed = Math.min(MAX_SIM_ACCUMULATED_DT, Math.max(0, (now - lastNow) / 1000));
    simAccumulator = Math.min(MAX_SIM_ACCUMULATED_DT, simAccumulator + elapsed);
    fixedSteps = Math.min(MAX_SIM_STEPS_PER_FRAME, Math.floor(simAccumulator / FIXED_SIM_DT));
    if (fixedSteps > 0) {
      processSubspaceQueues(a);
    }
  }

  for (let step = 0; step < fixedSteps; step++) {
    const dt = FIXED_SIM_DT / q.substeps;
    for (let i = 0; i < q.substeps; i++) {
      drawToTexture(gl, a.state[a.sWrite], a.size, a.simProgram);
      bindTexture(gl, 0, a.state[a.sRead]); set1i(gl, a.simProgram, 'uPrev', 0);
      bindTexture(gl, 1, a.atlas[a.aRead]); set1i(gl, a.simProgram, 'uAtlas', 1);
      set2f(gl, a.simProgram, 'uTexel', 1/a.size, 1/a.size);
      set1f(gl, a.simProgram, 'uTime', simTime);
      set1f(gl, a.simProgram, 'uDt', dt);
      drawFull(gl);
      swapState(a);

      drawToTexture(gl, a.atlas[a.aWrite], a.size, a.atlasProgram);
      bindTexture(gl, 0, a.state[a.sRead]); set1i(gl, a.atlasProgram, 'uState', 0);
      bindTexture(gl, 1, a.atlas[a.aRead]); set1i(gl, a.atlasProgram, 'uPrevAtlas', 1);
      set2f(gl, a.atlasProgram, 'uTexel', 1/a.size, 1/a.size);
      set1f(gl, a.atlasProgram, 'uDt', dt);
      drawFull(gl);
      swapAtlas(a);

      stepActiveChunks(a, dt);

      const blurPasses = q.blurPasses;
      for (let b = 0; b < blurPasses; b++) {
        drawToTexture(gl, a.atlas[a.aWrite], a.size, a.blurProgram);
        bindTexture(gl, 0, a.atlas[a.aRead]); set1i(gl, a.blurProgram, 'uPrevAtlas', 0);
        set2f(gl, a.blurProgram, 'uTexel', 1/a.size, 1/a.size);
        set1f(gl, a.blurProgram, 'uBlurMix', 0.42);
        set1i(gl, a.blurProgram, 'uLinearBlur', a.atlasLinear ? 1 : 0);
        drawFull(gl);
        swapAtlas(a);
      }

      tick++;
      simTime += dt;
    }
    simAccumulator = Math.max(0, simAccumulator - FIXED_SIM_DT);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  drawViewport(gl, a, { x:0, y:0, w:canvas.width, h:canvas.height }, ui.focusX, ui.focusY, ui.mainZoom);
  if (descentProbeMode) {
    const pv = getProbeViewport();
    const probeZoom = ui.mainZoom * q.probeFactor * Math.pow(1.9, ui.descentLevel);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, pv.x - 3), Math.max(0, pv.y - 3), Math.min(canvas.width, pv.w + 6), Math.min(canvas.height, pv.h + 6));
    gl.clearColor(0.01, 0.02, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.scissor(pv.x, pv.y, pv.w, pv.h);
    drawViewport(gl, a, pv, ui.focusX, ui.focusY, probeZoom);
    gl.disable(gl.SCISSOR_TEST);
  }

}

function initCPUFallback() {
  resizeCanvas();
  const ctx = canvas.getContext('2d', { alpha: false });
  const w = 192, h = 108;
  const state = [new Float32Array(w*h*4), new Float32Array(w*h*4)];
  const img = ctx.createImageData(w, h);
  return { kind: 'cpu', ctx, w, h, state, read: 0, write: 1, img, clearZero(){ for (const arr of state) arr.fill(0); } };
}
function hashCPU(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function idxCPU(x, y, w, h) { x=(x+w)%w; y=(y+h)%h; return (y*w+x)*4; }
function stepCPU(a, now) {
  const dt = paused ? 0 : Math.min(0.033, Math.max(0.001, (now - lastNow) / 1000));
  const src = a.state[a.read], dst = a.state[a.write];
  if (!paused) {
    for (let y=0; y<a.h; y++) for (let x=0; x<a.w; x++) {
      const o = idxCPU(x,y,a.w,a.h);
      const s0=src[o], s1=src[o+1], s2=src[o+2], s3=src[o+3];
      let m0=0,m1=0,m2=0,m3=0;
      for (const n of [[1,0],[-1,0],[0,1],[0,-1]]) { const p=idxCPU(x+n[0],y+n[1],a.w,a.h); m0+=src[p]; m1+=src[p+1]; m2+=src[p+2]; m3+=src[p+3]; }
      m0*=0.25; m1*=0.25; m2*=0.25; m3*=0.25;
      const l0=m0-s0,l1=m1-s1,l2=m2-s2,l3=m3-s3;
      const e=s0*s0+s1*s1+s2*s2+s3*s3;
      const zero = e < 7e-7 ? 1 : 0;
      const debt = 1 - Math.exp(-simTime*0.37);
      const ha = hashCPU(x+11,y+17)*Math.PI*2, hb = hashCPU(x+31,y+43)*Math.PI*2;
      let u0=s0+zero*debt*0.00125*Math.cos(ha), u1=s1+zero*debt*0.00125*Math.sin(ha), u2=s2+zero*debt*0.00125*Math.cos(hb), u3=s3+zero*debt*0.00125*Math.sin(hb);
      const pressure = Math.log2(1 + e*12 + Math.hypot(l0,l1,l2,l3)*44);
      const ang=dt*(0.34+0.74*(0.5-0.5*Math.sin(simTime*0.77)))*(1+pressure);
      const ca=Math.cos(ang), sa=Math.sin(ang);
      const r0=ca*u0-sa*u1, r1=sa*u0+ca*u1, r2=ca*u2+sa*u3, r3=-sa*u2+ca*u3;
      dst[o]=Math.tanh((r0 + l0*dt*0.19)*1.006)*0.9974;
      dst[o+1]=Math.tanh((r1 + l1*dt*0.19)*1.006)*0.9974;
      dst[o+2]=Math.tanh((r2 + l2*dt*0.19)*1.006)*0.9974;
      dst[o+3]=Math.tanh((r3 + l3*dt*0.19)*1.006)*0.9974;
    }
    const tmp=a.read; a.read=a.write; a.write=tmp; tick++; simTime += dt;
  }
  const data = a.img.data, src2 = a.state[a.read];
  let sum=0;
  for (let y=0; y<a.h; y++) for (let x=0; x<a.w; x++) {
    const o=idxCPU(x,y,a.w,a.h); const e=src2[o]*src2[o]+src2[o+1]*src2[o+1]+src2[o+2]*src2[o+2]+src2[o+3]*src2[o+3]; sum+=e;
    const v=clamp(Math.log2(1+e*240),0,1); const p=(y*a.w+x)*4;
    data[p]=Math.floor(12+230*v); data[p+1]=Math.floor(24+180*Math.sqrt(v)); data[p+2]=Math.floor(52+170*(1-v)*v+60*v); data[p+3]=255;
  }
  a.ctx.putImageData(a.img,0,0); a.ctx.imageSmoothingEnabled=false; a.ctx.drawImage(canvas,0,0,a.w,a.h,0,0,canvas.width,canvas.height);
  setText(stats.matrix, a.w+'×'+a.h+' active');
  setText(stats.energy, (sum/(a.w*a.h)).toFixed(6));
  setText(stats.coherence, 'cpu');
}

function frame(now) {
  resizeCanvas();
  const rawDt = Math.max(0.001, Math.min(0.050, (now - lastNow) / 1000));
  fps = fps ? fps * 0.92 + (1 / rawDt) * 0.08 : (1 / rawDt);
  if (app?.kind === 'webgl2') stepWebGL(app, now); else if (app?.kind === 'cpu') stepCPU(app, now);
  setText(stats.tick, tick + ' / ' + simTime.toFixed(1) + 's');
  updateDerivedStats();
  setText(corner, 'projection only\npresent: 1280×720\nsupport atlas: on\nOKLCH view 7 · chiral view 8\nhash chunks: ' + activeChunkCount() + '/' + MAX_CHUNKS + '\nquality locked: ' + (ui.qualityIndex + 1) + '\nfps ' + Math.round(fps) + '\nwheel visual zoom only\ndescent mode for tiles');
  lastNow = now;
  requestAnimationFrame(frame);
}

(function boot(){
  updateDerivedStats();
  try {
    app = initWebGL();
    setText(stats.engine, 'WebGL2 ' + app.textureFormat.label + ' · ' + app.atlasFilterLabel + ' · hash atlas ' + app.childAtlasSize + '² · 1280×720');
    setClassName(stats.engine, 'good');
    setText(stats.matrix, app.size + '² zero');
    setText(stats.energy, 'diagnostics off');
    setClassName(stats.energy, 'warn');
    setText(stats.coherence, 'diagnostics off');
    setClassName(stats.coherence, 'warn');
    setLog('Running v0.5.17. Quality 4 uses foveated witness detail plus abyss fast-exit; smooth diagnostics remain disabled and fixed-step timing remains active.');
  } catch (err) {
    setLog('WebGL2 float path unavailable: ' + (err?.message || err));
    app = initCPUFallback();
    setText(stats.engine, 'CPU fallback');
    setClassName(stats.engine, 'warn');
    setText(stats.matrix, app.w + '×' + app.h + ' zero');
    setLog('WebGL2 float path unavailable: ' + (err?.message || err) + '\nCPU fallback is running a reduced zero-state rule.');
  }
  requestAnimationFrame(frame);
})();
