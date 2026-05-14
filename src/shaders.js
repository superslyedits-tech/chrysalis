export const commonGLSL = `#version 300 es
precision highp float;
precision highp sampler2D;
#define TAU 6.283185307179586
`;

export const vsGLSL = commonGLSL + `
const vec2 POS[3] = vec2[3](vec2(-1.0,-3.0), vec2(3.0,1.0), vec2(-1.0,1.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const simGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outState;
uniform sampler2D uPrev;
uniform sampler2D uAtlas;
uniform vec2 uTexel;
uniform float uTime;
uniform float uDt;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 unit4(vec2 address) {
  float a = TAU * hash12(address + 11.17);
  float b = TAU * hash12(address + 37.91);
  float c = TAU * hash12(address + 71.43);
  vec4 v = vec4(cos(a), sin(a), cos(b), sin(b));
  v.xy = mix(v.xy, vec2(cos(c), sin(c)), 0.333);
  return normalize(v + 1e-6);
}
vec4 cleanState(vec4 s) {
  if (s.w < -0.5) s.w = 0.0;
  return s;
}
vec4 fetchClean(sampler2D tex, vec2 uv) {
  return cleanState(texture(tex, uv));
}
vec4 rot4(vec4 s, float a, float b, float c) {
  float sa = sin(a), ca = cos(a);
  float sb = sin(b), cb = cos(b);
  float sc = sin(c), cc = cos(c);
  vec4 r = s;
  r.xy = mat2(ca, -sa, sa, ca) * r.xy;
  r.zw = mat2(cb, -sb, sb, cb) * r.zw;
  r.xw = mat2(cc, -sc, sc, cc) * r.xw;
  return r;
}
void main() {
  vec4 rawS = texture(uPrev, vUv);
  float pointerW = rawS.w;
  float hasPointer = pointerW < -0.5 ? 1.0 : 0.0;
  vec4 s = cleanState(rawS);
  vec4 atlas = texture(uAtlas, vUv);
  vec4 n0 = fetchClean(uPrev, vUv + vec2( uTexel.x, 0.0));
  vec4 n1 = fetchClean(uPrev, vUv + vec2(-uTexel.x, 0.0));
  vec4 n2 = fetchClean(uPrev, vUv + vec2(0.0,  uTexel.y));
  vec4 n3 = fetchClean(uPrev, vUv + vec2(0.0, -uTexel.y));
  vec4 d0 = fetchClean(uPrev, vUv + vec2( uTexel.x,  uTexel.y));
  vec4 d1 = fetchClean(uPrev, vUv + vec2(-uTexel.x,  uTexel.y));
  vec4 d2 = fetchClean(uPrev, vUv + vec2( uTexel.x, -uTexel.y));
  vec4 d3 = fetchClean(uPrev, vUv + vec2(-uTexel.x, -uTexel.y));
  vec4 f0 = fetchClean(uPrev, vUv + vec2( 2.0*uTexel.x, 0.0));
  vec4 f1 = fetchClean(uPrev, vUv + vec2(-2.0*uTexel.x, 0.0));
  vec4 f2 = fetchClean(uPrev, vUv + vec2(0.0,  2.0*uTexel.y));
  vec4 f3 = fetchClean(uPrev, vUv + vec2(0.0, -2.0*uTexel.y));

  vec4 localMean = (n0+n1+n2+n3 + 0.70710678*(d0+d1+d2+d3)) / 6.82842712;
  vec4 farMean = 0.25 * (f0 + f1 + f2 + f3);
  vec4 lap = localMean - s;
  vec4 shear = farMean - localMean;

  float e = dot(s, s);
  float curve1 = length(lap);
  float curve2 = length(shear);
  float fold = 0.5 + 0.5 * sin(uTime * 0.77);
  float unfold = 1.0 - fold;

  // Zero-state genesis: exact-zero cells instantiate only from continuity debt.
  float zeroMask = 1.0 - smoothstep(0.0, 0.0000007, e);
  float debt = 1.0 - exp(-uTime * 0.37);
  vec4 vacuum = unit4(gl_FragCoord.xy);
  vec4 born = vacuum * zeroMask * debt * 0.00125;

  // Particle-Lenia idea, field form: growth peaks when local support density is near target.
  float density = clamp(atlas.x + 0.35 * atlas.y + 0.2 * curve1, 0.0, 3.0);
  float leniaGrowth = exp(-pow((density - 0.72) / 0.19, 2.0));
  float repulsion = pow(max(e + atlas.z - 0.78, 0.0), 2.0);
  float leniaEnergy = repulsion - leniaGrowth;

  float pressure = log2(1.0 + e * 12.0 + curve1 * 44.0 + curve2 * 22.0 + atlas.x * 3.5);
  float more = 1.0 + pressure;
  float thetaA = uDt * (0.34 + 0.74 * unfold) * more;
  float thetaB = -uDt * (0.29 + 0.66 * fold) * more;
  float thetaC = uDt * (0.08 + 0.21 * sin(uTime * 0.17 + pressure + curve2 * 3.0));

  vec4 turned = rot4(s + born, thetaA, thetaB, thetaC);
  vec4 atlasVector = vec4(atlas.x - atlas.y, atlas.z - atlas.w, atlas.y - atlas.z, atlas.w - atlas.x);
  float foldPull = uDt * (0.052 + 0.19 * fold);
  float shearPull = uDt * (0.015 + 0.05 * unfold);
  float unfoldLift = uDt * (0.026 + 0.082 * unfold);

  vec4 update = turned
    + lap * foldPull
    + shear * shearPull
    + normalize(turned + born + 1e-6) * unfoldLift * (pressure + 0.45 * curve2)
    - normalize(turned + 1e-6) * uDt * 0.020 * leniaEnergy
    + atlasVector * uDt * 0.011;

  update += 0.020 * uDt * vec4(-update.y, update.x, -update.w, update.z);
  update = tanh(update * 1.006) * 0.9974;
  update -= 0.00032 * vec4(dot(update, vec4(1.0)));
  if (hasPointer > 0.5) update.w = pointerW;
  outState = update;
}
`;

export const atlasGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outAtlas;
uniform sampler2D uState;
uniform sampler2D uPrevAtlas;
uniform vec2 uTexel;
uniform float uDt;

void main() {
  vec4 s = texture(uState, vUv);
  vec4 a = texture(uPrevAtlas, vUv);
  vec4 nx = texture(uState, vUv + vec2( uTexel.x, 0.0));
  vec4 px = texture(uState, vUv + vec2(-uTexel.x, 0.0));
  vec4 ny = texture(uState, vUv + vec2(0.0,  uTexel.y));
  vec4 py = texture(uState, vUv + vec2(0.0, -uTexel.y));
  vec4 n2x = texture(uState, vUv + vec2( 2.0*uTexel.x, 0.0));
  vec4 p2x = texture(uState, vUv + vec2(-2.0*uTexel.x, 0.0));
  vec4 n2y = texture(uState, vUv + vec2(0.0,  2.0*uTexel.y));
  vec4 p2y = texture(uState, vUv + vec2(0.0, -2.0*uTexel.y));

  vec4 mean1 = 0.25 * (nx + px + ny + py);
  vec4 mean2 = 0.25 * (n2x + p2x + n2y + p2y);
  vec4 lap1 = mean1 - s;
  vec4 lap2 = mean2 - mean1;
  float energy = dot(s, s);
  float curvature = length(lap1) + 0.55 * length(lap2);
  float negativeOcean = length(vec2(s.x - s.z, s.y - s.w)) + 0.50 * length(lap1.xy - lap1.zw);
  float support = 1.0 / (1.0 + 10.0 * length(lap1) + 3.0 * length(lap2));

  float density = clamp(0.55 * energy + 1.2 * curvature + 0.35 * negativeOcean, 0.0, 3.0);
  float leniaGrowth = exp(-pow((density - 0.72) / 0.19, 2.0));
  float repulsion = pow(max(energy - 0.74, 0.0), 2.0);
  float leniaSignal = clamp(0.5 + 0.5 * (leniaGrowth - repulsion), 0.0, 1.0);

  // Slime-style trail memory: fade old support, deposit new support, then blur in a later pass.
  vec4 deposit = vec4(density, curvature, negativeOcean, support * leniaSignal);
  float persistence = exp(-uDt * 0.74);
  outAtlas = max(a * persistence, deposit * (1.0 - persistence * 0.72));
}
`;

export const blurGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outAtlas;
uniform sampler2D uPrevAtlas;
uniform vec2 uTexel;
uniform float uBlurMix;
uniform int uLinearBlur;
void main() {
  vec4 c = texture(uPrevAtlas, vUv);
  vec4 b;

  if (uLinearBlur == 1) {
    // Ping-pong bilinear blur hack: atlas textures use hardware LINEAR
    // filtering. Each half-texel diagonal sample blends four neighboring
    // atlas cells in the fixed-function sampler, avoiding the old 9-fetch blur.
    vec2 h = 0.5 * uTexel;
    b = 0.25 * (
      texture(uPrevAtlas, vUv + vec2( h.x,  h.y)) +
      texture(uPrevAtlas, vUv + vec2(-h.x,  h.y)) +
      texture(uPrevAtlas, vUv + vec2( h.x, -h.y)) +
      texture(uPrevAtlas, vUv + vec2(-h.x, -h.y))
    );
  } else {
    // Fallback for GPUs/browsers without linear float sampling. Still cheaper
    // than the old 9-tap blur: center plus four cardinal neighbors.
    b = (c +
      texture(uPrevAtlas, vUv + vec2( uTexel.x, 0.0)) +
      texture(uPrevAtlas, vUv + vec2(-uTexel.x, 0.0)) +
      texture(uPrevAtlas, vUv + vec2(0.0,  uTexel.y)) +
      texture(uPrevAtlas, vUv + vec2(0.0, -uTexel.y))
    ) * 0.2;
  }

  outAtlas = mix(c, b, uBlurMix);
}
`;


export const ruptureGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outState;
uniform sampler2D uPrev;
uniform ivec2 uParentCell;
uniform float uPointerValue;
uniform int uEnable;
void main() {
  vec4 s = texture(uPrev, vUv);
  if (uEnable == 1) {
    ivec2 cell = ivec2(floor(gl_FragCoord.xy));
    if (cell.x == uParentCell.x && cell.y == uParentCell.y) {
      s.w = uPointerValue;
    }
  }
  outState = s;
}
`;

export const childInitGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outChild;
uniform sampler2D uMacroState;
uniform vec2 uParentUv;
uniform float uTime;
uniform float uChunkId;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 unit4(vec2 p) {
  float a = TAU * hash12(p + uChunkId * 17.0);
  float b = TAU * hash12(p + 37.0 + uChunkId * 5.0);
  return normalize(vec4(cos(a), sin(a), cos(b), sin(b)) + 1e-6);
}
void main() {
  vec4 parent = texture(uMacroState, uParentUv);
  if (parent.w < -0.5) parent.w = 0.0;
  vec2 p = vUv - 0.5;
  float r = length(p);
  float membrane = smoothstep(0.52, 0.18, r);
  vec4 seed = unit4(gl_FragCoord.xy + vUv * 8192.0);
  outChild = parent * (0.84 + 0.12 * membrane) + seed * (0.0025 + 0.0075 * membrane);
  outChild.w = 1.0;
}
`;

export const childSimGLSL = commonGLSL + `
in vec2 vUv;
out vec4 outChild;
uniform sampler2D uPrevChild;
uniform sampler2D uMacroState;
uniform vec2 uChunkOrigin;
uniform vec2 uChunkScale;
uniform vec2 uChildTexel;
uniform vec2 uParentUv;
uniform float uTime;
uniform float uDt;
vec2 atlasUv(vec2 localUv) { return uChunkOrigin + fract(localUv) * uChunkScale; }
vec4 fetchLocal(vec2 localUv) {
  vec4 s = texture(uPrevChild, atlasUv(localUv));
  if (s.w < -0.5) s.w = 0.0;
  return s;
}
vec4 rot4(vec4 s, float a, float b) {
  float sa = sin(a), ca = cos(a);
  float sb = sin(b), cb = cos(b);
  vec4 r = s;
  r.xy = mat2(ca, -sa, sa, ca) * r.xy;
  r.zw = mat2(cb, -sb, sb, cb) * r.zw;
  return r;
}
void main() {
  vec2 localTexel = uChildTexel / uChunkScale;
  vec4 s = fetchLocal(vUv);
  vec4 n0 = fetchLocal(vUv + vec2( localTexel.x, 0.0));
  vec4 n1 = fetchLocal(vUv + vec2(-localTexel.x, 0.0));
  vec4 n2 = fetchLocal(vUv + vec2(0.0,  localTexel.y));
  vec4 n3 = fetchLocal(vUv + vec2(0.0, -localTexel.y));
  vec4 mean = 0.25 * (n0 + n1 + n2 + n3);
  vec4 lap = mean - s;
  vec4 parent = texture(uMacroState, uParentUv);
  if (parent.w < -0.5) parent.w = 0.0;
  float e = dot(s, s);
  float curve = length(lap);
  float pressure = log2(1.0 + e * 10.0 + curve * 60.0);
  float fold = 0.5 + 0.5 * sin(uTime * 0.91 + uChunkOrigin.x * 17.0 + uChunkOrigin.y * 13.0);
  vec4 update = rot4(s, uDt * (0.42 + pressure), -uDt * (0.31 + 0.7 * fold))
    + lap * uDt * (0.26 + 0.18 * fold)
    + (parent - s) * uDt * 0.012
    + normalize(s + 1e-6) * uDt * 0.016 * pressure;
  update = tanh(update * 1.004) * 0.9982;
  update.w = clamp(update.w, 0.0, 1.35);
  outChild = update;
}
`;

export const renderGLSL = commonGLSL + `
#define ENABLE_CHILD_RENDER 1
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform sampler2D uAtlas;
#if ENABLE_CHILD_RENDER
uniform sampler2D uChildState;
#endif
uniform vec2 uTexel;
uniform int uView;
uniform vec2 uFocus;
uniform float uZoom;
uniform float uDetail;
uniform int uQualityLevel;
#if ENABLE_CHILD_RENDER
uniform float uMacroSize;
uniform float uChunkGrid;
#endif

const vec2 WITNESS_ASPECT = vec2(16.0, 9.0);

vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 cold = vec3(0.018, 0.036, 0.095);
  vec3 mid = vec3(0.080, 0.285, 0.550);
  vec3 hot = vec3(0.98, 0.76, 0.40);
  vec3 white = vec3(0.93, 0.98, 1.0);
  vec3 c = mix(cold, mid, smoothstep(0.0, 0.38, x));
  c = mix(c, hot, smoothstep(0.28, 0.78, x));
  c = mix(c, white, smoothstep(0.83, 1.0, x));
  return c;
}
vec3 voidBackground() {
  return vec3(0.0072, 0.0144, 0.0380);
}

vec3 oklchToSrgb(float L, float C, float H) {
  // OKLCH -> OKLab -> linear RGB -> approximate sRGB.
  // Kept in the witness shader only: it does not feed back into simulation state.
  float a = C * cos(H);
  float b = C * sin(H);

  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  float l3 = l_ * l_ * l_;
  float m3 = m_ * m_ * m_;
  float s3 = s_ * s_ * s_;

  vec3 rgbLin = vec3(
     4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186148 * m3 + 1.7076147010 * s3
  );
  rgbLin = clamp(rgbLin, vec3(0.0), vec3(1.0));
  return pow(rgbLin, vec3(1.0 / 2.2));
}

float atlasHeight(vec4 a) {
  return clamp(a.x + 0.45 * a.y + 0.22 * a.z + 0.18 * a.w, 0.0, 3.0) / 3.0;
}
float childHeight(vec4 c) {
  vec4 cc = c;
  if (cc.w < -0.5) cc.w = 0.0;
  float e = dot(cc, cc);
  float neg = length(vec2(cc.x - cc.z, cc.y - cc.w));
  return clamp(0.58 * e + 0.34 * neg, 0.0, 3.0) / 3.0;
}
vec4 cleanWitnessState(vec4 s) {
  if (s.w < -0.5) s.w = 0.0;
  return s;
}
float statePhase(vec4 s) {
  s = cleanWitnessState(s);
  return atan(s.y + 0.35 * s.w, s.x + 0.35 * s.z);
}
float wrappedPhaseDelta(float a, float b) {
  return atan(sin(a - b), cos(a - b));
}
vec4 sampleChiralState(vec2 uv, float twist) {
  vec2 rel = uv - uFocus;
  float radial = length(rel);
  float angle = twist * (0.42 + radial * 3.25);
  float sa = sin(angle);
  float ca = cos(angle);
  vec2 twisted = uFocus + mat2(ca, -sa, sa, ca) * rel;
  return cleanWitnessState(texture(uState, clamp(twisted, vec2(0.0), vec2(1.0))));
}
float projectorPhase(vec2 uv) {
  vec2 witness = (uv - uFocus) * max(uZoom, 1.0);
  float radialPhase = atan(witness.y, witness.x);
  float latticePhase = dot(witness, vec2(1.61803398875, -2.41421356237)) * 0.37;
  return radialPhase + latticePhase;
}
float phaseResonance(float projector, float matrix) {
  return 0.5 + 0.5 * cos(wrappedPhaseDelta(projector, matrix));
}
vec2 phaseBounceUv(vec2 uv, vec2 slope, float resonance, float strength) {
  vec2 safeSlope = normalize(slope + vec2(1e-6));
  float gate = 0.22 + 0.78 * clamp(resonance, 0.0, 1.0);
  return clamp(uv + safeSlope * strength * gate / max(uZoom, 1.0), vec2(0.0), vec2(1.0));
}
float witnessAttention(vec2 screenUv) {
  float distFromFocus = distance(screenUv * WITNESS_ASPECT, vec2(0.5) * WITNESS_ASPECT);
  return 1.0 - smoothstep(0.05, 0.60, distFromFocus);
}
int activeWitnessRadii(float attention) {
  if (uQualityLevel < 3) return uQualityLevel + 1;
  attention = clamp(attention, 0.0, 1.0);
  float maxRadii = float(uQualityLevel + 1);
  int radiusLimit = int(mix(1.0, maxRadii, attention));
  if (radiusLimit < 1) radiusLimit = 1;
  if (radiusLimit > 4) radiusLimit = 4;
  return radiusLimit;
}
vec2 sampleUV(vec2 uv) {
  vec2 d = uv - 0.5;
  return clamp(uFocus + d / uZoom, vec2(0.0), vec2(1.0));
}
void main() {
  vec2 uv = sampleUV(vUv);
  vec4 s = texture(uState, uv);
  vec4 atlas = texture(uAtlas, uv);
#if ENABLE_CHILD_RENDER
  float pointerFlag = s.w < -0.5 ? 1.0 : 0.0;
  vec2 activeChildUv = vec2(0.0);
  if (pointerFlag > 0.5) {
    float chunkId = floor(abs(s.w) - 1.0 + 0.5);
    vec2 chunkCell = vec2(mod(chunkId, uChunkGrid), floor(chunkId / uChunkGrid));
    vec2 parentCoord = uv * uMacroSize;
    vec2 childLocal = fract(parentCoord);
    vec2 childUv = (chunkCell + childLocal) / uChunkGrid;
    activeChildUv = childUv;
    vec4 child = texture(uChildState, childUv);
    vec4 childAtlas = vec4(
      dot(child, child),
      length(vec2(child.x - child.z, child.y - child.w)),
      abs(child.x - child.z) + abs(child.y - child.w),
      1.0
    );
    s = mix(vec4(s.xyz, 0.0), child, 0.90);
    atlas = mix(atlas, childAtlas, 0.55);
  }
#else
  float pointerFlag = 0.0;
  vec2 activeChildUv = vec2(0.0);
#endif

  float voidEnergy = dot(cleanWitnessState(s), cleanWitnessState(s));
  if (pointerFlag < 0.5 && voidEnergy < 0.00000025 && atlasHeight(atlas) < 0.0002) {
    fragColor = vec4(voidBackground(), 1.0);
    return;
  }

  float zoomDetail = clamp(log2(max(uZoom, 1.0)) / 6.0, 0.0, 1.0);
  float q = clamp(uDetail, 0.0, 4.5);
  float attention = witnessAttention(vUv);
  int activeRadii = activeWitnessRadii(attention);

  // Quality step-downs are hard tap limits, not just visual weighting.
  // low:    1 radius / 4 neighbor fetches
  // medium: 2 radii  / 8 neighbor fetches
  // high:   3 radii  / 12 neighbor fetches
  // 3x3:    4 radii  / 16 neighbor fetches plus triple high sim cadence.
  // Quality 4 additionally decays from 4 radii at screen focus to 1 radius
  // in the periphery; lower quality tiers keep their existing hard limits.
  vec4 nx = texture(uState, clamp(uv + vec2( uTexel.x, 0.0), 0.0, 1.0));
  vec4 px = texture(uState, clamp(uv + vec2(-uTexel.x, 0.0), 0.0, 1.0));
  vec4 ny = texture(uState, clamp(uv + vec2(0.0,  uTexel.y), 0.0, 1.0));
  vec4 py = texture(uState, clamp(uv + vec2(0.0, -uTexel.y), 0.0, 1.0));
  vec4 mean1 = 0.25 * (nx + px + ny + py);
  vec4 lap1 = mean1 - s;

  vec4 lap2 = vec4(0.0);
  vec4 lap4 = vec4(0.0);
  vec4 lap8 = vec4(0.0);
  float c1 = length(lap1);
  float c2 = 0.0;
  float c4 = 0.0;
  float c8 = 0.0;

  if (activeRadii >= 2) {
    float r2 = 2.0;
    vec4 n2x = texture(uState, clamp(uv + vec2( r2*uTexel.x, 0.0), 0.0, 1.0));
    vec4 p2x = texture(uState, clamp(uv + vec2(-r2*uTexel.x, 0.0), 0.0, 1.0));
    vec4 n2y = texture(uState, clamp(uv + vec2(0.0,  r2*uTexel.y), 0.0, 1.0));
    vec4 p2y = texture(uState, clamp(uv + vec2(0.0, -r2*uTexel.y), 0.0, 1.0));
    vec4 mean2 = 0.25 * (n2x + p2x + n2y + p2y);
    lap2 = mean2 - mean1;
    c2 = length(lap2);

    if (activeRadii >= 3) {
      float r4 = 4.0;
      vec4 n4x = texture(uState, clamp(uv + vec2( r4*uTexel.x, 0.0), 0.0, 1.0));
      vec4 p4x = texture(uState, clamp(uv + vec2(-r4*uTexel.x, 0.0), 0.0, 1.0));
      vec4 n4y = texture(uState, clamp(uv + vec2(0.0,  r4*uTexel.y), 0.0, 1.0));
      vec4 p4y = texture(uState, clamp(uv + vec2(0.0, -r4*uTexel.y), 0.0, 1.0));
      vec4 mean4 = 0.25 * (n4x + p4x + n4y + p4y);
      lap4 = mean4 - mean2;
      c4 = length(lap4);

      if (activeRadii >= 4) {
        float r8 = 8.0;
        vec4 n8x = texture(uState, clamp(uv + vec2( r8*uTexel.x, 0.0), 0.0, 1.0));
        vec4 p8x = texture(uState, clamp(uv + vec2(-r8*uTexel.x, 0.0), 0.0, 1.0));
        vec4 n8y = texture(uState, clamp(uv + vec2(0.0,  r8*uTexel.y), 0.0, 1.0));
        vec4 p8y = texture(uState, clamp(uv + vec2(0.0, -r8*uTexel.y), 0.0, 1.0));
        vec4 mean8 = 0.25 * (n8x + p8x + n8y + p8y);
        lap8 = mean8 - mean4;
        c8 = length(lap8);
      }
    }
  }

  float energy = dot(s, s);
  float fineBoost = 1.0 + 0.55 * zoomDetail + 0.20 * q;
  float support = 1.0 / (1.0 + 12.0*c1 + 5.0*c2 + 2.0*c4 + 0.9*c8);
  float pressure = log2(1.0 + 18.0*energy + 62.0*c1 + 30.0*c2 + 13.0*c4 + 7.0*c8 + 6.0*atlas.x);
  float coherence = support / (1.0 + 0.22 * pressure);
  float negativeOcean = length(vec2(s.x - s.z, s.y - s.w)) + 0.55 * length(lap1.xy - lap1.zw) + 0.25 * length(lap2.xy - lap2.zw) + 0.11 * length(lap8.xy - lap8.zw);
  float edge = length(vec4(c1 - c2, c2 - c4, c4 - c8, c1 + c4));
  float density = clamp(atlas.x + 0.45*atlas.y + 0.25*edge, 0.0, 3.0);
  float leniaGrowth = exp(-pow((density - 0.72) / 0.19, 2.0));
  float leniaEnergy = pow(max(energy + atlas.z - 0.78, 0.0), 2.0) - leniaGrowth;
  float anatomy = fineBoost * (pressure * (1.10 - support) + negativeOcean*0.20 + edge*0.42 + atlas.w*0.35);
  vec2 axis = normalize(vec2(s.x + s.z, s.y + s.w) + 1e-6);

  vec3 color;
  if (uView == 1) {
    color = heat(pressure * 0.18 + abs(leniaEnergy) * 0.28);
  } else if (uView == 2) {
    float o = smoothstep(0.0, 1.6, negativeOcean + atlas.z * 0.45);
    color = vec3(0.03,0.08,0.16) + vec3(0.10,0.38,0.64)*o + vec3(0.48,0.16,0.72)*smoothstep(0.38,1.25,edge);
  } else if (uView == 3) {
    float c = clamp(coherence, 0.0, 1.0);
    color = mix(vec3(0.30,0.06,0.08), vec3(0.62,0.95,0.80), c);
    color *= 0.42 + 0.58*smoothstep(0.0,0.16,energy+c1+atlas.w*0.2);
  } else if (uView == 4) {
    color = vec3(0.5+0.5*axis.x, 0.5+0.5*axis.y, 0.48+0.52*sin(atan(axis.y,axis.x)*3.0));
    color *= 0.20 + 0.80*smoothstep(0.0,0.30,energy+c1+c2+atlas.x*0.25);
  } else if (uView == 5) {
    color = vec3(0.04,0.08,0.13) + vec3(0.18,0.42,0.82)*smoothstep(0.0,1.35,atlas.x) + vec3(0.95,0.80,0.45)*smoothstep(0.15,0.9,atlas.w);
  } else if (uView == 6) {
    color = mix(vec3(0.20,0.05,0.08), vec3(0.70,0.95,0.68), smoothstep(-1.0,1.0,-leniaEnergy));
    color += vec3(0.1,0.2,0.5) * smoothstep(0.0,1.0,density);
  } else if (uView == 7) {
    // OKLCH bump witness: density gradient -> normal -> lightness,
    // coherence/support -> chroma, internal phase/slope -> hue.
    // This is purely a projection layer and does not write back to state.
    float h0 = atlasHeight(atlas);
    float hx;
    float hy;
#if ENABLE_CHILD_RENDER
    if (pointerFlag > 0.5) {
      vec2 cTexel = vec2(1.0 / (uMacroSize * 2.0));
      hx = childHeight(texture(uChildState, clamp(activeChildUv + vec2(cTexel.x, 0.0), 0.0, 1.0)));
      hy = childHeight(texture(uChildState, clamp(activeChildUv + vec2(0.0, cTexel.y), 0.0, 1.0)));
    } else {
      hx = atlasHeight(texture(uAtlas, clamp(uv + vec2(uTexel.x, 0.0), 0.0, 1.0)));
      hy = atlasHeight(texture(uAtlas, clamp(uv + vec2(0.0, uTexel.y), 0.0, 1.0)));
    }
#else
    hx = atlasHeight(texture(uAtlas, clamp(uv + vec2(uTexel.x, 0.0), 0.0, 1.0)));
    hy = atlasHeight(texture(uAtlas, clamp(uv + vec2(0.0, uTexel.y), 0.0, 1.0)));
#endif
    float dxB = (hx - h0) * (18.0 + 7.0 * q);
    float dyB = (hy - h0) * (18.0 + 7.0 * q);
    vec3 normal = normalize(vec3(dxB, dyB, 0.08));
    float slopeAngle = clamp(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    float projector = projectorPhase(uv);
    vec2 bounceUv = phaseBounceUv(uv, normal.xy, phaseResonance(projector, statePhase(s)), 0.014 + 0.004 * q);
    vec4 bounceState = cleanWitnessState(texture(uState, bounceUv));
    float bouncePhase = statePhase(bounceState);
    float bounceResonance = phaseResonance(projector, bouncePhase);

    float lightness = clamp(slopeAngle * 0.72 + 0.10 + 0.08 * smoothstep(0.0, 0.9, h0) + 0.13 * bounceResonance, 0.0, 1.0);
    float chroma = clamp(coherence * 0.30 + atlas.w * 0.07 + bounceResonance * 0.09, 0.0, 0.31);
    float phaseHue = atan(s.y + 0.35 * s.w, s.x + 0.35 * s.z);
    float slopeHue = atan(dyB, dxB);
    float hue = mod(mix(mix(phaseHue, slopeHue, 0.28), bouncePhase, 0.18 + 0.14 * bounceResonance) + TAU, TAU);

    color = oklchToSrgb(lightness, chroma, hue);
    float rim = pow(1.0 - slopeAngle, 1.75);
    color += rim * vec3(0.12, 0.16, 0.19);
    color += bounceResonance * vec3(0.05, 0.06, 0.08) * smoothstep(0.05, 0.65, length(normal.xy));
    color *= 0.68 + 0.32 * smoothstep(0.0, 1.0, h0 + atlas.w * 0.35) + 0.12 * bounceResonance;
  } else if (uView == 8) {
    // Chiral hologram witness: sample the current matrix twice with opposite
    // phase twists. Projector/matrix phase-lock becomes light; slope bounce
    // adds cheap reflectance without marching or previous-frame inputs.
    float twist = clamp(0.030 + pressure * 0.010 + edge * 0.016 + q * 0.006, 0.018, 0.145);
    vec4 leftChiral = sampleChiralState(uv, -twist);
    vec4 rightChiral = sampleChiralState(uv, twist);
    float leftPhase = statePhase(leftChiral);
    float rightPhase = statePhase(rightChiral);
    float phaseDelta = wrappedPhaseDelta(leftPhase, rightPhase);
    float chiralDepth = clamp(0.5 + 0.5 * phaseDelta / 3.141592653589793, 0.0, 1.0);
    float projector = projectorPhase(uv);
    float matrixPhase = mix(leftPhase, rightPhase, 0.5);
    float matrixResonance = phaseResonance(projector, matrixPhase + phaseDelta * 0.25);
    vec2 chiralSlope = vec2(leftChiral.x - rightChiral.x + lap1.x - lap1.z, leftChiral.y - rightChiral.y + lap1.y - lap1.w);
    vec2 bounceUv = phaseBounceUv(uv, chiralSlope, matrixResonance, 0.016 + 0.005 * q);
    vec4 bounceChiral = sampleChiralState(bounceUv, twist * mix(-1.0, 1.0, chiralDepth));
    float bouncePhase = statePhase(bounceChiral);
    float bounceResonance = phaseResonance(projector, bouncePhase);
    float sync = max(0.5 + 0.5 * cos(phaseDelta), matrixResonance * 0.88 + bounceResonance * 0.12);
    float cavity = pow(abs(phaseDelta) / 3.141592653589793, 0.62);
    float handedness = smoothstep(-0.85, 0.85, phaseDelta);
    float leftEnergy = dot(leftChiral, leftChiral);
    float rightEnergy = dot(rightChiral, rightChiral);
    float relief = smoothstep(0.0, 1.35, pressure * 0.22 + edge * 0.75 + atlas.w * 0.28);
    float hue = mod(mix(matrixPhase, bouncePhase, 0.16 + 0.18 * bounceResonance) + phaseDelta * 0.72 + TAU, TAU);
    float lightness = clamp(0.12 + 0.44 * sync + 0.18 * relief + 0.11 * cavity + 0.13 * bounceResonance, 0.0, 1.0);
    float chroma = clamp(0.06 + 0.17 * coherence + 0.08 * abs(leftEnergy - rightEnergy) + 0.05 * cavity + 0.06 * bounceResonance, 0.0, 0.32);
    color = oklchToSrgb(lightness, chroma, hue);
    vec3 depthTint = mix(vec3(0.08, 0.17, 0.34), vec3(0.86, 0.60, 0.32), handedness);
    color = mix(color, depthTint, 0.22 * cavity);
    color += vec3(0.10, 0.16, 0.20) * pow(sync, 8.0);
    color += bounceResonance * vec3(0.06, 0.07, 0.08) * smoothstep(0.0, 1.0, length(chiralSlope));
    color *= 0.62 + 0.34 * smoothstep(0.0, 1.0, relief + cavity * 0.45) + 0.16 * matrixResonance;
  } else {
    color = heat(smoothstep(0.0, 0.98, anatomy));
    color *= 0.40 + 0.60*smoothstep(0.0,0.10,energy + c1*0.3 + atlas.w*0.12);
  }

  if (uView != 7 && uView != 8) {
    color += 0.07 * fineBoost * vec3(c1 + atlas.y*0.2, c2 + atlas.w*0.15, c4 + c8*0.6 + atlas.z*0.1);
    if (pointerFlag > 0.5) color += vec3(0.04, 0.11, 0.08);
    color = pow(max(color, vec3(0.0)), vec3(0.92));
  } else {
    color = clamp(color, vec3(0.0), vec3(1.0));
  }

  fragColor = vec4(color, 1.0);
}
`;

export const renderNoChildGLSL = renderGLSL.replace('#define ENABLE_CHILD_RENDER 1', '#define ENABLE_CHILD_RENDER 0');
