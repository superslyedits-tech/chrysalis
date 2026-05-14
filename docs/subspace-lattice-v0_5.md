# Projective Subspace Lattice v0.5

This is the first implementation pass from the autopoietic optimum handoff.

## What is implemented

- A fixed macro field remains the always-on base simulation.
- A fixed child hash atlas is allocated at startup.
- The atlas is logically divided into 16 chunks using a 4 × 4 layout.
- The macro state's fourth channel, `W`, can become a negative pointer:

```txt
W = -(chunkId + 1)
```

- Zoom/descent pressure at the focus coordinate can rupture the focused parent cell.
- The ruptured parent cell receives a chunk pointer.
- The newly allocated child chunk is initialized from the parent macro state.
- Active child chunks are simulated only inside their own atlas viewport.
- The projection renderer checks `W`; if it sees a pointer, it fetches the child chunk using local sub-UV coordinates.

## What is intentionally not complete yet

This is not yet the full recursive infinite zoom engine. v0.5 does not yet implement:

- nested child-of-child chunk allocation;
- true chunk average foldback into the parent state;
- GPU-side allocation buffer / SSBO;
- variance-based garbage collection;
- multi-parent boundary sampling across adjacent chunks.

Those are the next phases. This version proves the core syntax: parent cell → W pointer → fixed atlas chunk → witness render fetch.

## Hardware rule

The hash atlas has a fixed maximum footprint. Zooming should increase local detail by allocating/reusing chunks, not by increasing global texture size or Retina presentation resolution.
