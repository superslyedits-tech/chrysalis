# Chiral Hologram and Quality 4 Design

## Goal

Restore the removed Chiral Hologram witness as a stable render-only view, and add a reset-only `Quality 4 (3x3)` preset.

## Architecture

The chiral view belongs only in the projection shader and the existing view dropdown. It must sample the current state texture twice with opposite phase twists, compute a wrapped phase delta, and shade apparent depth from that interference. It must not bind previous-state textures, per-frame jitter uniforms, synchronous readback, or phase-velocity scintillation.

The quality change uses the existing reset-only quality pipeline. Quality 4 becomes the fourth entry in `ui.qualities`; selecting it updates the reset label and applies only after pressing Reset or `R`.

## Components

- `index.html`: add the view option and `Quality 4 (3x3)` dropdown option.
- `src/main.js`: add the fourth quality preset and update small UI text that names the view count/version.
- `src/shaders.js`: add current-state chiral helper functions and `uView == 8` shading.
- `tests/source-contracts.test.mjs`: protect the view option, quality preset, and absence of old lurch sources.
- `README.md`, `CHANGELOG.md`, and `docs/methods.md`: document the restored stable witness and reset-only quality tier.

## Stability Constraints

The old v0.5.9 lurch-prone pieces stay removed: no `uPrevState`, no `uJitter`, no phase-velocity scintillation, and no render-loop readback. The renderer continues to use fixed simulation time and the capped presentation buffer.

## Testing

Run `npm test` for source contracts, then run the app through the static server and verify the dropdowns/render path loads without console errors.
