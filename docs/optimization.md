# Optimization Roadmap

## v0.5.17 applied

- Added Quality 4 foveated witness detail: four radii at screen focus, decaying toward cheaper radii in the periphery.
- Added a conservative void fast-exit before projection-neighbor fetches for near-exact abyss fragments with no child pointer.
- Left fixed-step simulation cadence and Quality 4 substeps unchanged.

## v0.5.16 applied

- Removed the remaining timed WebGL diagnostic/readout cadence from the smooth branch.
- Removed the unused tiny diagnostic buffer allocation.
- Left energy/coherence readouts explicitly disabled so no periodic diagnostic work wakes up during the render loop.

## v0.5.15 applied

- Lazily allocate the child hash atlas on first descent instead of at WebGL boot.
- Track active child chunks directly with `subspace.active`.
- Remove the unused crosshair shader path and uniforms.
- Compile and use a child-free render shader variant while no chunks are active.

## v0.5.14 applied

- Cache uniform locations per WebGL program to avoid repeated `gl.getUniformLocation()` calls in simulation, atlas, child, and render passes.
- Guard repeated UI text/class assignments so unchanged frame stats do not trigger unnecessary DOM writes.
- Remove the unused render-pass `uTime` uniform and setter. Simulation timing remains unchanged.

## v0.4.5 applied

- Replace unrolled 3×3 atlas blur with ping-pong bilinear atlas blur.
- Use linear atlas filtering where available; otherwise fallback to a 5-tap cross blur.
- Enforce render tap limits by quality preset: low 1 radius, medium 2 radii, high 3 radii.
- Keep the fourth r8 witness radius out of lower tiers; it is reserved for reset-only Quality 4 (3x3).
- Remove the zoom-triggered extra blur pass so auto detail cannot secretly add more blur work.

## v0.4.4 applied

- Cap presentation render target to 1280×720.
- Do not multiply canvas width/height by devicePixelRatio.
- Prefer RGBA16F for dense state and support atlas.
- Fall back to RGBA32F if half-float render targets are rejected.
- Keep hidden matrix resolution independent from display resolution.

## Next candidates

- Keep diagnostics for a separate branch so smooth builds stay render-only.
- Optional 384² global matrix mode for older Intel GPUs.
- Active child-probe backend only after global field stays smooth.



## v0.5.10 No Live Readback

The live render loop no longer calls synchronous `gl.readPixels()`. In v0.5.16, the smooth branch also removes the remaining timed diagnostic cadence and leaves energy/coherence readouts disabled. Simulation time advances using a fixed timestep rather than a variable render-frame delta.
