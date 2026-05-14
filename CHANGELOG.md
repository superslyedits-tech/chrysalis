# Changelog

## v0.5.17 — Quality 4 Witness Optimization

No simulation cadence changes:

- Added foveated witness attention for Quality 4, keeping four projection radii at screen focus and decaying toward cheaper radii in the periphery.
- Added a conservative abyss fast-exit before projection-neighbor fetches when state/support are effectively zero and no child pointer is active.
- Left Quality 1-3 hard radius limits unchanged.
- Added source-contract guards for the foveated radius limit and void return path.

## v0.5.16 — Smooth Branch Diagnostics Disabled

No sim or witness behavior changes intended:

- Removed the remaining once-per-second WebGL diagnostic/readout cadence.
- Removed the unused tiny diagnostic buffer allocation from WebGL boot.
- Energy/coherence stat slots now explicitly report `diagnostics off`.
- Added a source-contract guard so the smooth branch does not reintroduce `lastStats`, diagnostic buffers, or `diag pending` readouts.

## v0.5.15 — Child Atlas and No-Child Render Fast Path

No functional or visual changes intended:

- Child hash atlas textures now allocate lazily on first descent instead of during boot.
- Active child chunks are tracked directly through `subspace.active`.
- Removed the unused crosshair shader branch and uniforms.
- Added a no-child render shader variant for the common `0/16` chunk state, avoiding child texture binding and pointer traversal when no child chunks exist.

## v0.5.14 — Optimization Cleanup

No functional or visual changes intended:

- Cached WebGL uniform locations per program.
- Guarded repeated DOM text/class writes in hot UI paths.
- Removed the unused render-pass `uTime` uniform and setter.
- Added source-contract checks for the optimization guardrails.

## v0.5.13 — Phase-Bounce Witness Lighting

Incorporated the "no journey, only arrival" phase-bounce idea into both color witnesses:

- Added stable projector/matrix phase-lock helpers to the render shader.
- Added slope-offset phase-bounce sampling to the OKLCH/OKLab bump crystal.
- Added projector phase-lock and chiral-slope phase-bounce reflectance to the Chiral hologram.
- Lifted the render-side detail clamp so Quality 4's larger detail scalar reaches the witness calculations.
- Kept the stability guardrails: no previous-state render texture, no jitter uniform, no phase velocity, and no live synchronous `readPixels()`.

## v0.5.12 — Stable Chiral Hologram and Quality 4

Restored the stable chiral hologram idea as a render-only witness view. The new live implementation samples the current state twice with opposite phase twists and maps wrapped phase delta to apparent depth, while keeping the removed spectral inputs out of the runtime path:

- no `uPrevState`
- no `uJitter`
- no phase-velocity scintillation
- no live synchronous `readPixels()`

Added reset-only `Quality 4 (3x3)`, which triples Quality 3's simulation substeps, blur passes, and detail scalar, and enables the heaviest projection radius only for that tier.

## v0.5.11 — Removed Chiral/Spectral Witness

The chiral/spectral hologram witness mode was removed from the live project after persistent directional lurching/jolting was observed. The removal is intentional and complete for runtime purposes:

- removed the `Chiral spectral hologram` view option
- removed the `uPrevState` render uniform
- removed the `uJitter` render uniform
- removed phase-velocity/scintillation logic
- removed opposite chiral phase sampling code
- removed refractive chiral UV distortion code
- removed chiral-specific helper functions from the render shader
- removed render-loop binding for the previous-state texture and jitter uniforms

The feature is archived as an experiment only. It should be redesigned later from a clean projection model, not patched back incrementally.

## Archived experiment: v0.5.6 — Chiral Hologram Witness

Added a render-only witness mode that sampled the existing field twice with opposite phase twists around the focus point and converted wrapped phase delta into apparent depth. It did not modify zero-matrix update rules, W-pointer allocation, child hash atlas behavior, quality reset behavior, or scar/reset behavior.

## Archived experiment: v0.5.9 — Chiral Spectral Hologram

Expanded the chiral witness with sub-pixel jitter, normal-based refractive UV distortion, phase-velocity scintillation from the current/previous state pair, spectral micro-noise, and OKLCH hue/lightness/chroma binding. This mode is now removed from live runtime code.
