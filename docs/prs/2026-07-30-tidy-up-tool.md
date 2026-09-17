# PR: Tidy Up tool

## Summary

Adds a "Tidy Up" tool: lasso-select a group of elements and arrange them into
a centered grid, normalizing majority style properties (stroke color,
background color, fill style, stroke width, roughness) and majority shape
sizes, while preserving bindings (bound text, bound arrows, frame membership).

## What changed

- `packages/element/src/tidyUp.ts`: core `tidyUpElements` algorithm, style
  normalization by majority vote, size normalization by bucketed majority,
  grid unit construction (frames/bound text/bound arrows travel as one unit),
  and grid placement preserving row/column ordering from original layout.
- `packages/excalidraw/components/App.tsx`, `Toolbar.tsx`,
  `MobileToolbar.tsx`, `icons.tsx`: wires the tidy-up tool into the desktop
  and mobile toolbars and hooks the lasso gesture to `tidyUpElements`.
- `packages/common/src/constants.ts`, `packages/element/src/index.ts`,
  `packages/excalidraw/data/restore.ts`, `packages/excalidraw/types.ts`,
  `packages/excalidraw/locales/en.json`: new tool-type plumbing (constants,
  exports, restore.ts record, i18n string).
- Tests: `packages/element/tests/tidyUp.test.tsx` (algorithm-level, 7 cases),
  `packages/excalidraw/tests/tidyUpTool.test.tsx` (toolbar/gesture wiring,
  5 cases).
- `docs/superpowers/plans/2026-07-29-tidy-up.md`, `tidy-up-feature-spec.md`:
  spec and implementation plan carried over from planning.

## Architectural decisions

- **Chosen:** majority-vote normalization bucketed by `SIZE_BUCKET_PX` (16px)
  for dimensions, exact-match majority for style properties. Alternative
  considered: averaging all values, rejected because it would resize/recolor
  every element to a value nothing in the selection actually has, whereas
  majority-vote snaps outliers to what's already dominant in the group.
- **Chosen:** frame children, bound text, and bound arrows are excluded from
  independent grid placement and instead ride with their parent/container as
  one `TidyUnit`. Alternative: grid-place every selected element
  independently, rejected because it would tear bound text off its
  container and re-route arrows through arbitrary intermediate positions.

## Testing

- `npx eslint packages/element/src/tidyUp.ts`, clean (see fix commit
  8a17b58e for the violations resolved: magic-number extraction and
  object-key ordering).
- `yarn vitest run packages/element/tests/tidyUp.test.tsx
  packages/excalidraw/tests/tidyUpTool.test.tsx`, 12/12 passing.
- Engineering audit dispatched separately, scoped to this diff
  (`docs/audits/`, pending at PR time).

## Reflection

What I understand now: the lint gate (R-323/R-321/R-319) blocked the initial
push on magic numbers (`/ 2`) and object key ordering inside `tidyUp.ts`,
introduced during earlier implementation and not caught until push time
rather than at commit time, since pre-commit only lints staged files per
R-408/R-409.

What I got wrong first: attempted to push straight to the fork without
checking that R-323/R-321 apply repo-wide; the fix was a follow-up commit
(8a17b58e) rather than amending history, per R-504/git safety rules (never
rewrite already-pushed history without explicit instruction).
