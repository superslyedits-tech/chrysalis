# Chrysalis Vault — Zero Matrix Lab v0.5.17

A GitHub-Pages-compatible repo build for the zero-state 4D matrix simulator.

This is the repo version of the smooth standalone HTML prototype, refactored so we can optimize and scale it without turning the simulator into a UI toy.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m http.server 8787
```

Open:

```text
http://localhost:8787/
```


## v0.4.5 performance guardrails

- The canvas CSS still fills the screen, but the internal render target is capped at **1280×720**.
- The renderer does **not** multiply canvas resolution by `window.devicePixelRatio`; Retina displays no longer force a 2560×1600 final projection pass.
- Hidden global state and support atlas textures prefer **RGBA16F half-float**. If a browser/GPU rejects RGBA16F render targets, the runtime falls back to RGBA32F rather than failing boot.
- The simulation matrix remains fixed-size and independent from screen resolution.
- Support atlas blur now uses a **ping-pong bilinear blur** when linear float sampling is available: half-texel samples use the GPU sampler to blend neighboring cells instead of doing a 9-fetch custom blur.
- If linear float sampling is unavailable, blur falls back to a cheaper 5-tap cross blur instead of the old 9-tap blur.
- Projection quality presets now enforce hard tap limits: low = 1 radius, medium = 2 radii, high = 3 radii, and Quality 4 (3x3) = 4 radii plus triple high sim cadence.
- Quality 4's fourth projection radius is foveated: full detail is kept at screen focus while peripheral fragments decay toward cheaper radii.
- Empty abyss fragments can return before the projection-neighbor fetches when state/support are effectively zero.

## Core rules

- Hidden state starts as exact zero.
- Genesis comes from fold debt, not a particle source.
- No rays, no raymarching, no source turns, no particle slider.
- Render is a projection/witness of the matrix.
- Energy/coherence diagnostics are disabled in the smooth branch to avoid periodic readout work.
- Detail scales through projection sampling and support memory, not by blindly increasing global resolution. Low quality is intentionally strict to keep Intel/LPDDR bandwidth stable.

## Controls

- Wheel: visual zoom only. It does not generate subspace tiles.
- Descent Probe Mode: arms the reticle and zoom panel. Move the mouse to aim, then click to commit descent.
- Descent click: centers the camera on that point, zooms in, and requests a 5-tile micro patch: clicked cell plus nearest cardinal neighbors.
- Reset Zoom Tiles + Center / Z: clears active mini-generating tiles, restores W-pointers, clears the child atlas, and recenters without resetting the macro field.
- V: cycle witness view.
- Quality override dropdown: choose quality 1, 2, 3, or 4 (3x3) for the next reset only.
- Reset / R: reset at selected quality. Quality cannot be changed mid-run.
- Space: pause / resume.
- H: hide UI.

## Integrated source-code ideas

From the uploaded slime WebGPU source:

- ping-pong state/texture architecture
- trail/support memory field
- fade then blur support pass
- ping-pong bilinear atlas blur instead of unrolled 3×3 / 9-fetch blur
- full-screen triangle render path

From the uploaded Particle Lenia notebook:

- kernel growth field idea
- energy as repulsion minus growth
- growth peak near a target density
- field-gradient behavior adapted to dense 4D matrix state

From the uploaded dynamic hash-grid source:

- deferred to future sparse child probes
- sorted neighborhood index is useful once descent becomes local active simulation
- not used in the dense global field yet because the current bottleneck is projection quality, not sparse-neighbor search



## v0.5.8 Reset-only quality selection

Quality now has one dropdown and one reset button. The dropdown chooses the quality for the next reset only; it does not change the active run. Press **Reset** or **R** to apply that quality and clear the macro field, support atlas, child hash atlas, and W-pointers. The warning is intentional: changing quality can affect sim generation patterns. Use at your own risk.

## v0.5.8 Descent Probe Mode

Regular wheel zoom is now separated from tile generation. The reticle and zoom panel only appear while **Descent Probe Mode** is armed. Clicking while armed commits the descent target, returns the cursor to normal, centers/zooms the camera, and generates a 5-cell micro-tile patch: the clicked parent cell plus its nearest cardinal neighbors.

## v0.5.4 Reset Zoom Tiles + Center

The zoom-tile reset is now a failsafe return-to-center operation: it clears active local subspace tiles, restores their W pointers, clears the child hash atlas, sets main zoom/descent pressure back below rupture threshold, and returns focus to `(0.5, 0.5)`. This keeps the macro field untouched while making it easy to recover the view after descending into a mini-tile.

## v0.5.3 OKLCH Bump Witness

This build adds a render-only **OKLCH bump crystal** witness mode:

- Uses the existing blurred support atlas as a height/density field.
- Computes a cheap bump normal from the density gradient.
- Maps slope/view angle to OKLCH lightness.
- Maps coherence/support to OKLCH chroma, so stable regions saturate and chaotic regions desaturate toward grey.
- Maps internal 4D phase plus slope direction to the circular OKLCH hue loop.
- v0.5.13 adds phase-bounce reflectance: the bump normal offsets one extra current-state matrix sample and uses projector/matrix resonance to brighten, tint, and hue-shift the OKLab/OKLCH color.
- Does not change the zero-matrix simulation, W-pointer allocation, child chunk reset, or scar/reset behavior.

Select **OKLCH bump crystal** from the view menu, or press **V** until it appears.

## File map

```text
index.html              page shell
src/style.css           UI and layout
src/main.js             runtime, GL passes, controls
src/shaders.js          zero-matrix, support atlas, blur, render shaders
docs/architecture.md    system architecture
docs/methods.md         source-method adaptation notes
docs/optimization.md    next optimization roadmap
```


## v0.5.17 Quality 4 Witness Optimization

This pass implements the two safe Quality 4 optimizations from the plan and leaves simulation cadence untouched:

- Foveated witness detail: Quality 4 keeps four projection radii at screen focus and decays toward cheaper radii in the periphery.
- Void culling: near-exact empty fragments with no child pointer return the abyss color before the projection-neighbor fetches.
- Quality 1-3 retain their existing hard radius limits.
- No time-slicing/substep amortization was added in this pass.


## v0.5.2 Projective Subspace Lattice

This build adds the first conservative sparse-lattice implementation:

- Macro state/support textures remain fixed-size.
- A fixed RGBA16F child hash atlas is allocated at startup.
- The macro W channel can become a negative chunk pointer: `W = -(chunkId + 1)`.
- Regular wheel zoom is visual-only and does not allocate subspace tiles.
- Descent Probe Mode explicitly selects a parent macro cell and unfolds a 5-cell patch into atlas chunks.
- Active chunks are simulated only inside their atlas viewports.
- The renderer reads the child chunk when it samples a parent cell whose W channel is a pointer.

This is phase one: allocation, child simulation, and witness fetch. Active chunks persist until Reset Zoom Tiles + Center or a full reset.

### Zoom-generation reset

The **Reset Zoom Tiles + Center** button (or **Z**) clears active mini-generating tiles, restores their parent W-pointers, clears the child hash atlas, drops descent pressure below rupture threshold, and recenters the focus/camera on the macro box area. It does **not** reset the macro simulation field, so the existing scar/reshape behavior from a full sim reset while tiles are active remains available for experiments.



## v0.5.13 Phase-Bounce Witness Lighting

This build incorporates the "no journey, only arrival" phase-bounce idea into both render-only color witnesses:

- A stable projector phase is derived from focus, zoom, and witness coordinate.
- Matrix phase is read from the current 4D state only.
- Phase resonance uses `cos(projector - matrix)` so in-sync regions light up and out-of-sync regions fall toward shadow.
- The OKLCH/OKLab bump crystal uses its slope normal to offset one extra current-state matrix sample, creating cheap reflectance without raymarching.
- The Chiral hologram uses the dual chiral phase delta for depth, then uses the chiral slope to perform the same phase-bounce reflectance.
- The lurch-prone spectral ingredients stay absent: no previous-state render texture, no jitter uniform, no phase-velocity effect, and no live `readPixels()`.

## v0.5.14 Optimization Cleanup

This pass is intended to preserve sim behavior and witness output while reducing CPU/GPU overhead:

- Caches WebGL uniform locations per linked program instead of resolving them in every pass.
- Guards repeated DOM text/class writes in the frame loop so unchanged stats do not force unnecessary browser work.
- Removes the dead render-pass `uTime` uniform and setter. Simulation shaders still receive time exactly as before.

## v0.5.16 Smooth Branch Diagnostics Removal

This pass removes the remaining timed diagnostic/readout scaffolding from the live WebGL path:

- Removed the once-per-second `lastStats` update cadence.
- Removed the unused tiny diagnostic/readback buffer allocation.
- Energy/coherence stat slots now explicitly report `diagnostics off`.
- The fixed-step sim, render-only witnesses, Quality 4 (3x3), lazy child atlas, and no-child render fast path remain unchanged.

## v0.5.15 Hash Atlas / Render Fast Path Cleanup

This pass keeps the sim and visuals unchanged while reducing work around inactive child chunks:

- Child atlas textures are allocated lazily on first descent instead of at boot.
- Active child chunks are tracked directly, so the frame loop does not rebuild active lists with array filtering.
- The dead crosshair branch and uniforms were removed from the render shader.
- A no-child render shader variant is used while the readout is `0/16`, skipping child texture binding and W-pointer traversal logic until chunks exist.

## v0.5.12 Stable Chiral Hologram Witness

This build restores the stable **Chiral hologram** witness mode:

- Samples the current matrix twice with opposite left/right phase twists around the focus.
- Converts wrapped phase delta into apparent depth/interference color.
- Stays render-only and does not change the zero-matrix simulation, W-pointer allocation, child atlas behavior, or reset behavior.
- Keeps the unstable v0.5.9 ingredients removed: no previous-state render texture, no jitter uniform, no phase-velocity scintillation, and no live `readPixels()`.

This build also adds reset-only **Quality 4 (3x3)**. It triples Quality 3's simulation substeps, blur passes, and detail scalar, and adds one heavier projection radius. Like the other presets, it only applies after Reset or `R`.

## v0.5.11 Chiral/Spectral Witness Removal

The unstable chiral/spectral hologram witness was fully removed from runtime code, shaders, uniforms, UI, and active docs. It is preserved only in `CHANGELOG.md` as an archived experiment to be redesigned later from a clean projection model.

## v0.5.10 Stability Patch

- Removed synchronous `gl.readPixels()` from the live render loop.
- Energy/coherence readouts are disabled in the smooth branch; reattach diagnostics only in a future diagnostic branch.
- Simulation stepping now uses a fixed timestep so render stalls or future diagnostics cannot inject a larger one-frame physics kick.
