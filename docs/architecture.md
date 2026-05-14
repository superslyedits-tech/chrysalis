# Architecture

## Layer separation

```text
hidden zero matrix
  -> support atlas / field memory
  -> projection renderer
  -> UI witness
```

The viewer does not own the ontology. View changes do not reset the matrix.

## Hidden state

The dense global state prefers an **RGBA16F half-float** texture treated as a hidden 4D relation cell. If the browser/GPU cannot render to RGBA16F, the runtime falls back to RGBA32F rather than failing boot:

```text
S(x,y) = vec4(a,b,c,d)
```

It starts as exact zero. The first non-zero basis appears only from fold debt.

## Support atlas

A second **RGBA16F half-float** texture stores derived support memory, with the same RGBA32F fallback:

```text
A(x,y) = vec4(density, curvature, negative_ocean, support)
```

This is the direct adaptation of slime-style trails, but the trail is not agent paint. It is a memory of support/debt/curvature produced by the hidden matrix.

The atlas blur uses ping-pong bilinear sampling when linear float filtering is available. Half-texel atlas samples let the GPU sampler blend neighboring support cells without a 9-fetch custom blur. If linear float filtering is unavailable, the runtime uses a cheaper 5-tap fallback blur.

## Projection quality

The renderer samples a bounded number of radii around the focused coordinate. Quality presets now enforce hard tap limits: low uses one radius, medium uses two, high uses three, and reset-only Quality 4 (3x3) uses the fourth/r8 radius with triple high simulation cadence.

At higher zoom, projection scale and detail weighting still increase, but zoom does not force lower quality tiers to evaluate all radii. The final presentation canvas is capped at **1280×720** and intentionally ignores `window.devicePixelRatio`, so Retina screens do not multiply the final pass cost.

This means zoom can ask the hidden matrix for a sharper local witness without turning every zoom level into a full-screen heavy shader path.

## v0.5 Hash Atlas / W-Pointer Extension

The first Projective Subspace Lattice pass adds a fixed child hash atlas. Macro cells can rupture under descent pressure and store a negative pointer in their `W` channel. `W = -(chunkId + 1)` points to one of sixteen atlas chunks. The witness renderer detects the pointer and samples child detail using local sub-UV coordinates.
