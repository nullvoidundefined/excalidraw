# Tidy Up Feature Spec

## Summary

Add a "Tidy up" feature to Excalidraw. It lets a user draw a lasso around a messy cluster of shapes and, on release, automatically cleans the cluster up in place: aligning shapes, evenly spacing them, removing unnecessary overlap, and normalizing styling and size to the group's majority values. No elements are added, deleted, or have their content changed — only position, size, and style properties of existing elements are mutated.

## Trigger & Activation

- Add a new tool, analogous to the existing `magicframe` tool (`TOOL_TYPE.magicframe` in `packages/excalidraw/components/App.tsx` and `packages/common/src/constants.ts`), rendered in the toolbar (`Toolbar.tsx` / `MobileToolbar.tsx`) using wand iconography consistent with `MagicIcon` (`components/icons.tsx`).
- This is a toolbar tool selection, **not** a floating canvas overlay button (contrast with `ElementCanvasButtons.tsx` / `MagicButton.tsx`, which anchor to a single already-selected element and don't generalize to arbitrary multi-element bounding boxes) and **not** an entry in the selected-element side panel (`Actions.tsx`, where `actionAlignTop` etc. live).
- No pre-existing selection is required to use it. The tool works independently of current selection state.

## Gesture

1. User selects the Tidy Up tool from the toolbar.
2. User drags a rectangular lasso across the canvas (same drag mechanics as drawing a frame or doing a rubber-band selection).
3. On pointer release, the elements caught by the lasso are resolved using **intersect mode** — any element the lasso rectangle touches at all (partial overlap included) is included, not just fully-contained elements. Use `getElementsWithinSelection` (`packages/element/src/selection.ts`), which already supports a `BoxSelectionMode` parameter (default is `"contain"`; pass the intersect variant instead).
4. The tidy algorithm (below) runs immediately on the resolved element set — no separate confirmation step.
5. No frame element or other wrapper is created by the lasso itself; it's purely a hit-test region, unlike the `magicframe` tool which creates a persistent `newMagicFrameElement`.

**Deferred/open:** whether the tool reverts to the selection arrow after one tidy or stays active for repeated lassoing. Recommend reusing Excalidraw's existing tool-lock toggle mechanism (same one used for shape tools) so this is configurable rather than hardcoded either way.

## Tidy Algorithm

Applied to the whole resolved selection as a single group — no row/column clustering or sub-group detection.

### 1. Alignment & spacing

- Reuse the existing alignment logic (`packages/element/src/align.ts`, exposed via `alignElements`) and distribution logic (`packages/element/src/distribute.ts`, `distributeElements`) rather than building new geometry code.
- Snap the group to a shared axis (edge or center — pick one reasonable default, e.g. align to whichever axis the tightest common bound already suggests) and then redistribute with even gaps using the existing `distributeElements` "space: between" behavior.
- This redistribution is also what satisfies overlap reduction: even-gap spacing across the group's bounding box naturally eliminates unintended overlap. No separate overlap-resolution/packing algorithm is needed.

### 2. Bound elements — rigid-body movement

- Elements with bindings (bound text in a container, arrows bound to shapes, frame membership) move as a single rigid unit during the position pass. Do not let alignment/distribution separate a container from its bound text, or leave an arrow's binding stale.
- Reuse `updateBoundElements` (`packages/element/src/binding.ts`) the same way manual dragging already does, rather than writing new binding-repair logic.
- Do not detach, delete, or re-parent bindings as part of this feature.

### 3. Style normalization (majority rule)

For each of the following properties, independently: find the most common (majority) value across the resolved element group, and apply it to elements whose value differs.

- `strokeColor`
- `backgroundColor`
- `fillStyle`
- `strokeWidth`
- `roughness`

Only apply this within the lassoed group — never across unrelated elements elsewhere on the canvas.

### 4. Size normalization (majority rule)

- Also apply majority-rule normalization to `width`/`height`: elements with an outlier size get resized to match the group's common dimensions.
- **Known risk:** resizing can distort elements with bound text or images that don't scale cleanly (text reflow, image stretching/cropping). Flag this for extra manual testing — it's the highest-risk piece of the whole feature for visually "changing content" even though no text/image data is actually altered.

## Constraints (non-negotiable)

- No elements are created or deleted by the tidy operation itself (the lasso is a hit-test only, not a new frame/container).
- No element's text/image/content is altered — only geometry (`x`, `y`, `width`, `height`) and style properties (`strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `roughness`) are mutated.
- Bindings (bound text, bound arrows, frame membership) must remain intact and correctly routed after the tidy pass.
- The whole operation should be a single undo step (`CaptureUpdateAction.IMMEDIATELY`, consistent with how `actionAlignTop` etc. commit their changes).

## Key files to reference during implementation

- `packages/common/src/constants.ts`, `packages/excalidraw/components/App.tsx` — tool type registration, pattern to follow: `TOOL_TYPE.magicframe`.
- `packages/excalidraw/components/Toolbar.tsx`, `MobileToolbar.tsx`, `components/icons.tsx` — toolbar icon registration.
- `packages/element/src/selection.ts` — `getElementsWithinSelection` for lasso hit-testing (intersect mode).
- `packages/element/src/align.ts`, `packages/excalidraw/actions/actionAlign.tsx` — alignment logic to reuse.
- `packages/element/src/distribute.ts`, `packages/excalidraw/actions/actionDistribute.tsx` — spacing/distribution logic to reuse.
- `packages/element/src/binding.ts` (`updateBoundElements`) — rigid-unit movement for bound elements.
- `packages/element/src/bounds.ts` (`getCommonBoundingBox` / `getCommonBounds`) — group bounding box math, already used by align/distribute.

## Explicitly out of scope

- Row/column clustering or sub-group detection within a lassoed selection.
- A dedicated overlap-resolution/packing algorithm (handled as a byproduct of even-gap distribution instead).
- A floating canvas-anchored trigger button (rejected in favor of a toolbar tool).
