# Chiral Hologram Quality 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a stable render-only Chiral Hologram view and add reset-only `Quality 4 (3x3)`.

**Architecture:** Keep the simulation unchanged. Add UI/runtime plumbing for one new view and one new quality preset, then implement current-state-only dual chiral phase sampling inside the projection shader.

**Tech Stack:** Static HTML, vanilla JavaScript modules, WebGL2 GLSL ES 3.00, Node source-contract tests.

---

### Task 1: Source Contracts

**Files:**
- Modify: `package.json`
- Create: `tests/source-contracts.test.mjs`

- [x] **Step 1: Write the failing test**

Create `tests/source-contracts.test.mjs` with assertions for the Chiral hologram dropdown option, the Quality 4 dropdown option, the fourth runtime quality preset, the shader's `uView == 8` branch, and the absence of `uPrevState`, `uJitter`, and scintillation terms.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because `index.html`, `src/main.js`, and `src/shaders.js` do not yet contain the new contracts.

### Task 2: UI and Runtime Quality

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

- [x] **Step 1: Implement minimal UI/runtime changes**

Add `<option value="8">Chiral hologram</option>` to `#viewMode`, add `<option value="3">Quality 4 (3x3) for next reset</option>` to `#qualityOverride`, and append `{ name: '3x3', substeps: 9, blurPasses: 3, detail: 4.35, tapLevel: 3, probeFactor: 6.5 }` to `ui.qualities`.

- [x] **Step 2: Run test**

Run: `npm test`

Expected: still FAIL until the shader branch is implemented.

### Task 3: Chiral Render Shader

**Files:**
- Modify: `src/shaders.js`

- [x] **Step 1: Implement current-state-only chiral helpers**

Add helper functions that sample `uState` at opposite twists around `uFocus`, compute wrapped phase difference, and shade depth without adding new uniforms.

- [x] **Step 2: Run test**

Run: `npm test`

Expected: PASS.

### Task 4: Docs and Render QA

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/methods.md`

- [x] **Step 1: Document the stable chiral witness and Quality 4**

Update docs to say Quality 4 is reset-only and Chiral Hologram is current-state-only, with old previous-state/jitter/scintillation lurch sources still removed.

- [x] **Step 2: Run browser smoke validation**

Run: `python3 -m http.server 8787`, open `http://localhost:8787/`, select Chiral hologram and Quality 4, and check for meaningful canvas rendering and no console errors.
