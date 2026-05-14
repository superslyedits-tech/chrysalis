# Method adaptation notes

## Slime WebGPU source

Useful pattern: a simulation texture is written, copied/ping-ponged, then a trail texture is faded and blurred. The important part is not the agents. The important part is the separation of:

```text
state update -> support deposit -> support diffusion -> render
```

This repo uses that structure as:

```text
zero-matrix update -> support atlas deposit -> bilinear atlas blur -> projection render
```

## Particle Lenia notebook

Original energy form:

```text
E = R - G
```

where `G` peaks near a target potential/density and `R` repels overcrowding.

Field adaptation in this repo:

```text
density = atlas_density + curvature contribution
G = exp(-((density - target) / width)^2)
R = max(energy + negative_ocean - threshold, 0)^2
E = R - G
```

The matrix update receives a small correction from this energy. It does not create particles.

## Dynamic hash grid

The hash-grid source is not wired into the dense global field yet. It becomes relevant when a descent probe becomes an active child simulation with sparse local support samples.

Future use:

```text
child probe samples -> hash local supports -> sort by cell -> active local interaction pass
```

For the current milestone, the global field is dense and texture-local, so the hash-grid would be overhead.


## v0.4.5 blur correction

The earlier repo notes described an unrolled 3×3 atlas blur. That is now removed because 9 texture fetches per atlas pixel is too expensive on Intel/LPDDR-class GPUs. The support atlas blur now uses the ping-pong bilinear trick:

```text
prev atlas -> half-texel bilinear samples -> next atlas
```

When the atlas texture supports hardware linear filtering, each half-texel sample blends four neighboring cells in the fixed-function sampler. The shader uses four diagonal half-texel samples instead of nine discrete texel reads. If linear float filtering is unavailable, the shader falls back to a 5-tap cross blur, still cheaper than the previous 9-tap pass.

## v0.4.5 render sampling correction

Projection quality now enforces hard tap limits:

```text
low    = center + 1 radius, 4 neighbor state fetches
medium = center + 2 radii, 8 neighbor state fetches
high   = center + 3 radii, 12 neighbor state fetches
q4 3x3 = center + 4 radii, 16 neighbor state fetches, triple high simulation cadence
```

The fourth radius is reserved for reset-only Quality 4 (3x3). Zoom still changes projection scale and weighting, but lower quality tiers do not force every fragment to evaluate every possible witness radius.

## v0.5.12 Chiral hologram witness

The restored Chiral hologram is a projection-only witness. It samples the current matrix twice from opposite phase twists around the focus point, compares the wrapped phase delta, and maps that interference to apparent depth and color.

The lurch-prone spectral experiment remains excluded from the render path. The chiral witness does not bind a previous-state texture, does not receive a jitter uniform, does not compute phase velocity, and does not use scintillation.

## v0.5.13 No-light phase-bounce

The phase-bounce pass treats light as resonance instead of a ray journey:

```text
projector phase = stable witness/focus phase
matrix phase    = current 4D state phase
resonance       = 0.5 + 0.5 * cos(projector - matrix)
bounce UV       = UV + slope * resonance strength
```

The OKLCH/OKLab witness gets its slope from the existing bump normal, samples the current matrix once at the bounce UV, and uses that bounce phase to lift lightness, chroma, and hue. The Chiral hologram gets its slope from the left/right chiral phase split plus local matrix gradient, samples the current matrix at the bounce UV, and blends that resonance into chiral depth lighting.

This keeps the "arrival" idea cheap and stable: no raymarching, no previous-frame state, no jitter, and no live readback.

## v0.5 Sparse Subspace Method

The dynamic hash grid is represented as a fixed texture atlas divided into sixteen chunks. Allocation is currently JS-managed for WebGL2 compatibility. Active chunks are simulated by drawing only into their atlas viewport, so empty subspace is not stepped. The renderer traverses the first lattice level by checking whether macro `W` is a negative pointer.
