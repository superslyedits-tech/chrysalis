import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const main = readFileSync(join(root, 'src/main.js'), 'utf8');
const shaders = readFileSync(join(root, 'src/shaders.js'), 'utf8');

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

assert.match(
  html,
  /<option value="8">Chiral hologram<\/option>/,
  'view dropdown should expose the restored Chiral hologram witness as view 8'
);

assert.match(
  html,
  /<option value="3">Quality 4 \(3x3\) for next reset<\/option>/,
  'quality dropdown should expose reset-only Quality 4 (3x3)'
);

assert.equal(
  countMatches(main, /\{\s*name:\s*'[^']+',\s*substeps:/g),
  4,
  'runtime quality table should contain four quality presets'
);

assert.match(
  main,
  /\{\s*name:\s*'3x3',\s*substeps:\s*9,\s*blurPasses:\s*3,\s*detail:\s*4\.35,\s*tapLevel:\s*3,/,
  'Quality 4 should be a 3x3 tier with triple Quality 3 substeps, blur passes, and detail'
);

assert.match(
  shaders,
  /float q = clamp\(uDetail, 0\.0, 4\.5\);/,
  'render shader should allow the Quality 4 detail scalar through the witness code'
);

assert.match(
  shaders,
  /float witnessAttention\(vec2 screenUv\)[\s\S]*distance\(screenUv \* WITNESS_ASPECT, vec2\(0\.5\) \* WITNESS_ASPECT\)[\s\S]*smoothstep\(0\.05, 0\.60, distFromFocus\)/,
  'render shader should foveate Quality 4 detail from the screen focus toward the periphery'
);

assert.match(
  shaders,
  /int activeWitnessRadii\(float attention\)[\s\S]*float maxRadii = float\(uQualityLevel \+ 1\);[\s\S]*mix\(1\.0, maxRadii, attention\)/,
  'render shader should convert attention into a dynamic active radius limit'
);

assert.match(
  shaders,
  /float attention = witnessAttention\(vUv\);[\s\S]*int activeRadii = activeWitnessRadii\(attention\);[\s\S]*if \(activeRadii >= 2\)[\s\S]*if \(activeRadii >= 3\)[\s\S]*if \(activeRadii >= 4\)/,
  'projection neighbor fetches should use the foveated active radius limit'
);

assert.match(
  shaders,
  /if \(pointerFlag < 0\.5 && voidEnergy < 0\.00000025 && atlasHeight\(atlas\) < 0\.0002\) \{[\s\S]*fragColor = vec4\(voidBackground\(\), 1\.0\);[\s\S]*return;/,
  'render shader should early-exit exact abyss fragments before projection loops'
);

assert.match(
  shaders,
  /else if \(uView == 8\) \{[\s\S]*sampleChiralState[\s\S]*phaseDelta[\s\S]*chiralDepth/,
  'render shader should implement the Chiral hologram view from current-state dual phase samples'
);

assert.match(
  shaders,
  /float projectorPhase\(vec2 uv\)[\s\S]*float phaseResonance\(float projector, float matrix\)[\s\S]*vec2 phaseBounceUv\(vec2 uv, vec2 slope, float resonance, float strength\)/,
  'render shader should expose stable no-light phase-lock and phase-bounce helpers'
);

assert.match(
  shaders,
  /else if \(uView == 7\) \{[\s\S]*phaseBounceUv[\s\S]*phaseResonance[\s\S]*bouncePhase/,
  'OKLCH bump crystal should use phase-bounce reflectance from the 4D matrix'
);

assert.match(
  shaders,
  /else if \(uView == 8\) \{[\s\S]*projectorPhase[\s\S]*phaseResonance[\s\S]*phaseBounceUv[\s\S]*bounceResonance/,
  'Chiral hologram should use projector phase-lock and slope phase-bounce reflectance'
);

assert.match(
  main,
  /const uniformLocations = new WeakMap\(\);[\s\S]*function uniformLocation\(gl, p, name\)/,
  'runtime should cache WebGL uniform locations instead of resolving them every pass'
);

assert.doesNotMatch(
  main,
  /gl\.uniform[1234][fi]\(gl\.getUniformLocation/,
  'uniform setters should not perform live gl.getUniformLocation lookups'
);

assert.match(
  main,
  /function setText\(node, value\)[\s\S]*function setClassName\(node, value\)/,
  'runtime should guard repeated DOM text/class writes in the frame loop'
);

assert.doesNotMatch(
  main,
  /stats\.(focus|descent|quality|atlas|tick)\.textContent|corner\.textContent/,
  'hot frame stats should use guarded DOM writes instead of unconditional textContent assignment'
);

assert.equal(
  countMatches(shaders, /uniform float uTime;/g),
  3,
  'only simulation shaders should keep uTime uniforms; render pass should not bind dead time state'
);

assert.doesNotMatch(
  main,
  /set1f\(gl, a\.renderProgram, 'uTime'/,
  'drawViewport should not set an unused render uTime uniform'
);

assert.match(
  main,
  /import \{[\s\S]*renderNoChildGLSL[\s\S]*\} from '\.\/shaders\.js';/,
  'runtime should compile a no-child render shader variant'
);

assert.match(
  shaders,
  /#define ENABLE_CHILD_RENDER 1[\s\S]*export const renderNoChildGLSL = renderGLSL\.replace\('#define ENABLE_CHILD_RENDER 1', '#define ENABLE_CHILD_RENDER 0'\);/,
  'shader module should expose a child-free render variant from the same render source'
);

assert.match(
  main,
  /let child = null;[\s\S]*function ensureChildAtlas\(a\)/,
  'child atlas textures should be lazily allocated instead of created during boot'
);

assert.doesNotMatch(
  main,
  /let child = \[tex\(gl, childAtlasSize/,
  'initWebGL should not allocate child atlas textures before first descent'
);

assert.match(
  main,
  /active: \[\][\s\S]*function activeChunkCount\(\) \{ return subspace\.active\.length; \}/,
  'active child chunks should be tracked directly instead of counted with array filters'
);

assert.doesNotMatch(
  main,
  /\.filter\(Boolean\)/,
  'hot paths should not rebuild active chunk lists with filter(Boolean)'
);

assert.match(
  main,
  /const renderProgram = activeChunkCount\(\) > 0 \? a\.renderProgram : a\.renderNoChildProgram;/,
  'drawViewport should use the no-child render program while no chunks are active'
);

assert.doesNotMatch(
  main + shaders,
  /showCrosshair|uShowCrosshair|uViewportPx/,
  'dead crosshair render path should be removed'
);

assert.doesNotMatch(
  main,
  /lastStats|diagSize|readback|diag pending|now - .* > 1100/,
  'smooth branch should not keep one-second diagnostic/readout cadence or unused readback buffers'
);

assert.match(
  main,
  /setText\(stats\.energy, 'diagnostics off'\);[\s\S]*setText\(stats\.coherence, 'diagnostics off'\);/,
  'WebGL energy/coherence diagnostics should be explicitly disabled for the smooth branch'
);

assert.doesNotMatch(
  shaders,
  /uPrevState|uJitter|phase_vel|phaseVel|scintillation/i,
  'restored chiral witness should not reintroduce previous-state, jitter, or scintillation lurch sources'
);
