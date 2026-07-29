# Engineering Audit: Tidy Up Feature

**Date:** 2026-07-30
**Auditor:** CTO audit persona
**Scope:** Feature-scoped only. Commits reviewed (base `1acf66ed` = `origin/master` HEAD at divergence):

- `ebba1d59` docs: tidy up tool spec + implementation plan
- `7ebc0ab7` feat(element): add tidyUpElements grid + majority-normalization algorithm
- `5ec2e7ab` feat(editor): tidyup tool - lasso gesture wired to tidyUpElements
- `8cda74cf` feat(editor): tidyup tool toolbar entries (desktop + mobile)
- `30d87e7e` docs: mark tidy up plan executed, record deviations
- `8a17b58e` fix(element): resolve lint violations in tidyUp.ts

Files in scope: `packages/element/src/tidyUp.ts`, `packages/element/tests/tidyUp.test.tsx`, `packages/excalidraw/tests/tidyUpTool.test.tsx`, `packages/excalidraw/components/App.tsx` (pointer-down/up wiring), `packages/excalidraw/components/Toolbar.tsx`, `packages/excalidraw/components/MobileToolbar.tsx`, `packages/excalidraw/components/icons.tsx`, `packages/common/src/constants.ts`, `packages/excalidraw/types.ts`, `packages/excalidraw/data/restore.ts`, `packages/excalidraw/locales/en.json`, `packages/element/src/index.ts`. The rest of the codebase is explicitly out of scope for this audit and was not reviewed.

## Executive Summary

The feature is small, self-contained, and reasonably well tested for its core algorithm. It does not touch auth, network, persistence, or secrets, so most of the standard CTO risk surface (security, deploy, dependencies) does not apply here. The real findings cluster around three things: a real behavioral edge case where frame-child elements get their style/size silently mutated by the tidy operation even though they are excluded from the grid placement; a test that asserts a "tie-breaking by z-order" behavior with fixture data that contains no actual tie, so that behavior is unverified; and minor UX/architecture shortcuts (icon reuse, no keyboard shortcut, no hint text) that are cosmetic on their own but are exactly the kind of "temporary, we'll fix it later" choice that calcifies.

**Top 3 priorities:**

1. **P1**: Fix or explicitly document the frame-child style/size mutation vs. grid-placement exclusion inconsistency in `tidyUp.ts` (`normalizeStyles`/`normalizeSizes` operate on all `selectedElements` including elements with `frameId` set, but `buildTidyUnits` excludes those same elements from placement).
2. **P2**: Correct or rewrite the "applies majority style values, breaking ties by z-order" test in `packages/element/tests/tidyUp.test.tsx`; the current fixture (2 red vs. 1 blue) is a clear majority, not a tie, so the tie-breaking behavior it claims to cover is untested.
3. **P2**: The `8a17b58e` `fix(element)` commit is a lint-only fix with no behavioral change, but it is still an unpaired `fix:` commit under the mechanical rule (no test file touched). Confirm this class of commit is intentionally exempt from R-403 test-pairing (it is lint/style, not a bug fix) so the exemption is explicit rather than assumed.

## Architecture & Design

**`packages/element/src/tidyUp.ts`** is a clean, single-responsibility module: one public orchestrator (`tidyUpElements`) delegating to four private step functions (`normalizeStyles`, `normalizeSizes`, `buildTidyUnits`, `placeUnitsInGrid`) plus two pure helpers (`findMajorityValue`, `findMajorityDimension`). This matches R-322 (orchestrator vs. atomic function split) well. Good separation from the editor layer: the algorithm has no React/App.tsx dependency, only `Scene`/`ExcalidrawElement` types, so it is unit-testable in isolation, which the test suite exploits.

**Wiring into `App.tsx`** reuses the existing selection rubber-band as a lasso hit-test by calling `createGenericElementOnPointerDown("selection", pointerDownState)` and manually setting `pointerDownState.boxSelection.hasOccurred = true` (`packages/excalidraw/components/App.tsx:8791-8797`). This is a pragmatic reuse of existing machinery rather than a new gesture implementation, consistent with R-308 (search/reuse before adding new logic). One design smell: the comment at line 8792-8794 acknowledges this is exploiting an internal flag ("that flag is otherwise only set for the selection tool") that lives entirely outside the tidy-up module's own boundary. This couples the new tool's correctness to an internal implementation detail of the selection tool's pointer-down state machine. If the selection tool's box-selection semantics change, tidyup silently breaks with no compiler signal. Not a blocker, but worth a comment/test tripwire.

**Finding (P1): frame-child mutation vs. placement inconsistency.**

```
// packages/element/src/tidyUp.ts:74-96 (normalizeStyles) and :98-141 (normalizeSizes)
// operate on `selectedElements` unfiltered by frameId

// packages/element/src/tidyUp.ts:149-165 (buildTidyUnits)
for (const element of selectedElements) {
    ...
    // frame children ride with their frame; if the frame wasn't lassoed,
    // leave the child untouched rather than tearing it out of the frame
    if (element.frameId) {
      continue;
    }
```

`buildTidyUnits` explicitly documents an intent to "leave the child untouched" when its frame wasn't lassoed. But `normalizeStyles` and `normalizeSizes` run before `buildTidyUnits` and iterate over the full `selectedElements` array with no `frameId` filter, so a rectangle that lives inside an un-lassoed frame but happens to overlap the lasso region will have its `strokeColor`/`backgroundColor`/`fillStyle`/`strokeWidth`/`roughness` and its `width`/`height` force-normalized to the group majority, then be left in place (not repositioned). The element ends up half-mutated: same position, different style/size than the user's original shape, with no grid placement to justify the change. This directly contradicts the "leave the child untouched" comment two functions later.

Compounding this: `App.tsx:11496-11502` calls `getElementsWithinSelection(..., excludeElementsInFrames=true, "overlap")`, but `packages/element/src/selection.ts:74-75` marks that exact parameter with `// TODO remove (this flag is effectively unused AFAIK)`. If that TODO is accurate, `elementsToTidy` may include frame children regardless of the `true` argument, meaning this is not a rare edge case: frame children overlapping the lasso are likely included in `selectedElements` in the normal case, hitting the style/size mutation path described above on every tidy that touches a framed element.

- Direction: gate `normalizeStyles`/`normalizeSizes` candidate filtering on the same `frameId`-ownership rule `buildTidyUnits` uses (skip elements whose frame wasn't itself part of the selection), or explicitly decide and document that style/size normalization is intended to apply independent of placement, and adjust the `buildTidyUnits` comment to stop claiming children are left fully "untouched."
- To confirm: read `packages/element/src/selection.ts` around the `excludeElementsInFrames` TODO to determine whether that flag currently does anything; write a test with a frame containing a child rectangle where only the child overlaps the lasso and the frame itself does not, asserting the child's style/size after tidy.

## Code Quality

- `findMajorityValue`/`findMajorityDimension` are small, pure, correctly typed generics. Tie-break is deterministic (first-encountered-value wins on count ties, via strict `>` comparison and `Map` insertion-order iteration), which is a legitimate implementation choice; see Testing section for why it's currently unverified.
- `STYLE_PROPERTIES`, `RESIZABLE_SHAPE_TYPES`, `STYLEABLE_TYPES` are extracted as named constants at module scope, good adherence to R-324 (no magic literals) and readable.
- The `8a17b58e` fix commit correctly replaced magic-number `/2` divisions with a named `HALF = 2` constant and fixed object key ordering (`box`/`unit` alphabetized), direct compliance with R-324/R-323 lint rules. This is a low-risk, well-scoped follow-up commit.
- Minor duplication: `App.tsx:11503` re-checks `elementsToTidy.length > 1` immediately before calling `tidyUpElements`, which itself re-checks `selectedElements.length < HALF` (i.e., `< 2`) at `tidyUp.ts:59`. Not a bug, but the guard exists in two places with two different literal spellings (`> 1` vs. `< HALF`) for the same invariant. A future change to the minimum-elements threshold requires remembering to update both sites.
  - Direction: consider having `tidyUpElements` return a boolean/void-with-no-op contract that callers rely on rather than re-deriving the same guard at the call site, or extract the threshold to a shared exported constant so both sites reference one source of truth.
  - To confirm: whether a `TIDY_UP_MIN_ELEMENTS`-style constant already exists elsewhere in the module (it does not, per the diff reviewed).
- `TidyUpIcon = MagicIconThin` (`packages/excalidraw/components/icons.tsx:2065-2067`) reuses an existing icon wholesale rather than introducing a distinct glyph. The accompanying comment acknowledges this ("thin variant keeps it visually distinct from the magicframe entry") but a wand icon for a grid-arrangement tool is not an intuitive icon-to-function mapping, and reusing the exact same icon object as another tool (`MagicIconThin`) means the toolbar has two conceptually unrelated tools sharing a rendered icon in different UI contexts. This is a cosmetic/tech-debt item, not a bug.
  - Direction: use a distinct icon (grid/align icon) when available in the icon set, or defer to design input; document the reuse as an intentional stopgap if it stays.
  - To confirm: whether the icon set already has a grid/align/arrange icon suitable for reuse before adding a new one (R-308).
- No hint text was added for the `tidyup` tool in `HintViewer.tsx`. Other tools with dedicated toolbar entries added around the same area (`autoshape`) have a hint (`packages/excalidraw/components/HintViewer.tsx:107-108`); tidyup has none, so activating the tool gives the user no on-canvas guidance about what to do (lasso, then release). Minor UX gap, not a blocker.
- No keyboard shortcut was wired for `tidyup` (no entry found in shortcut/action wiring). This is consistent with other extra-tools-dropdown-only tools (e.g., `magicframe`), so likely intentional, not a gap.

## Security

Not applicable in any meaningful way: this feature is pure client-side geometry manipulation on already-loaded canvas elements, with no network calls, no auth surface, no user-supplied strings rendered as HTML/markup, and no persistence changes beyond the existing scene mutation path. No findings.

## Database / API Design / Deployment & Infrastructure / Dependencies & Supply Chain

Not applicable to this diff. The feature adds no new database access, no new API routes, no new dependencies, and no deployment configuration changes. Skipped per audit scope.

## Performance

- `tidyUpElements` runs synchronously on pointer-up over the lassoed selection, calling `scene.mutateElement` once per property change per element (potentially multiple times per element across `normalizeStyles` then `normalizeSizes` then `placeUnitsInGrid`). For very large lassoed selections this is O(n) mutate calls each likely triggering their own re-render/history bookkeeping, but this mirrors the existing pattern used elsewhere in the codebase (not a new anti-pattern introduced by this feature) and the existing test suite doesn't exercise selection sizes large enough to make this a measured concern. Not flagged as a blocker; noted for awareness only, since there is no batching of the three passes into a single mutate call per element.
- No client-side polling (`refetchInterval`/`setInterval`/custom poll helpers) introduced by this feature. Not applicable.

## Testing

**Coverage present:**
- `packages/element/tests/tidyUp.test.tsx`: grid placement + no overlap, majority style application, bucketed size normalization (including "never resizes text"), image aspect-ratio-preserving scale (landscape case only), container + bound-text rigid-unit movement, bound-arrow exclusion from grid-placement with binding preservation, no-op for fewer than 2 elements.
- `packages/excalidraw/tests/tidyUpTool.test.tsx`: end-to-end lasso gesture invoking tidy on pointer-up and reverting to selection tool, no-op when lasso overlaps fewer than 2 elements, single undo step for the whole tidy, toolbar dropdown activation, and a check that no elements are created.

**Gaps and a genuine test-quality finding:**

- **P2, mislabeled/unverified test.** `packages/element/tests/tidyUp.test.tsx:83-122`, test title `"applies majority style values, breaking ties by z-order"`. The fixture data is:
  ```
  strokeColor: "#e03131", "#e03131", "#1971c2"   // 2 vs 1, a clear majority, not a tie
  backgroundColor: "#ffc9c9", "#b2f2bb", "#b2f2bb" // 2 vs 1, same, not a tie
  ```
  There is no genuine N-N (or 1-1) tie anywhere in this fixture, so the "breaking ties by z-order" claim in the test name is not exercised by this test. The `findMajorityValue` tie-break logic (`tidyUp.ts:250-266`, first-encountered value wins on equal counts via strict `>` and `Map` insertion order) is real, deliberate code, but it is currently unverified by any test in this diff.
  - Direction: add a fixture with an actual N-N tie (e.g., two elements with color A and two with color B) and assert the result matches whichever color was encountered first in the input array (document that convention explicitly in the assertion), or rename the existing test to reflect what it actually verifies (majority selection, not tie-breaking) if a true tie case is deferred.
  - To confirm: intended tie-break contract; is "first element in input order wins" a documented product decision, or an implementation accident that happens to be deterministic? The spec doc (`tidy-up-feature-spec.md`) should be checked for an explicit statement before writing the assertion.

- **Gap: portrait-orientation image scaling untested.** `packages/element/tests/tidyUp.test.tsx:171-203` only tests the `isLandscape` branch (`aspectRatio >= 1`) of the image-scaling logic in `tidyUp.ts:127-140`. The portrait branch (`newWidth = targetHeight * aspectRatio`) has no covering test. Given the branch is a ternary with materially different math on each side, an off-by-one or swapped-variable bug in the untested branch would not be caught.
- **Gap: frame handling untested.** No test in either file exercises `isFrameLikeElement` / `getFrameChildren` path in `buildTidyUnits` (`tidyUp.ts:166-177`), nor the frame-child-partial-mutation issue raised as the P1 architecture finding above. This is the same code path implicated in that finding; its absence from the test suite is likely why the inconsistency wasn't caught before merge.
- **Gap: no test for a real N-N majority style tie** (see above) and no test for a real tie in `findMajorityDimension` bucket sizing (`tidyUp.ts:268-287`), where two buckets could plausibly have equal membership counts.
- The E2E-style `tidyUpTool.test.tsx` suite is solid for the pointer/undo/toolbar-activation integration surface and reads as testing real behavior (asserting on `h.elements`, `h.state.activeTool.type`, undo stack length) rather than mock-call counts, good adherence to R-401.

## Bug Fix Discipline (R-403, scoped to this feature's commits)

Only one commit in the reviewed set has a `fix:`-style subject: `8a17b58e fix(element): resolve lint violations in tidyUp.ts`.

- **Diff:** renames two magic `2` divisors to a new `HALF` constant and reorders two object keys (`box`/`unit`) for alphabetical sort compliance. No behavioral change; no new logic path.
- **Test file changed:** no (`packages/element/src/tidyUp.ts` only).
- **Assessment:** under the mechanical rule ("fix:` subject + no test file touched = unpaired fix"), this is technically unpaired. However, the content is a lint/style-only change with zero behavioral delta; there is no bug to reproduce with a test, since nothing about program behavior changed. This is a legitimate exception to R-403's test-first-fix intent, not a case of "pushed and hoped it worked." Flagging as a single P2 pattern note per the audit's own instruction (a single unpaired fix is a P2 note, not a P1 finding), and recommending only that lint-only fix commits use a `chore:`/`style:` prefix rather than `fix:` going forward so this class doesn't need to be re-litigated on every audit.
  - Direction: adopt `style(element): resolve lint violations in tidyUp.ts` as the convention for lint-only commits so the mechanical fix/test-pairing check doesn't need a manual carve-out each time.
  - To confirm: whether the project's commit-message convention (R-505/R-506, project `CLAUDE.md`) already reserves `style:`/`chore:` for this case; the audit found no explicit statement either way in this repo's `CLAUDE.md`.

No other `fix:`-prefixed commits exist in the reviewed set, so there is no 3+-in-30-days pattern to escalate to P1.

## Tech Debt Register

| Item | Risk | Notes |
|---|---|---|
| Frame-child style/size mutation vs. placement exclusion inconsistency (`tidyUp.ts`) | P1 | See Architecture finding above; likely to surface as a user-visible "why did my shape's color change but not move" bug report. |
| `excludeElementsInFrames` param passed as `true` into a function whose own maintainers flag it as dead (`selection.ts:74-75`) | P2 | Couples tidyup's correctness to a parameter that may not do anything; worth a direct read of `selection.ts` to confirm before relying on it. |
| Tie-breaking test asserts on non-tie fixture data | P2 | See Testing section. |
| Portrait-image and frame-unit code paths untested | P2 | Both are real branches in shipped code with no covering assertions. |
| `TidyUpIcon = MagicIconThin` icon reuse | P3 | Cosmetic; flagged for awareness, not a functional risk. |
| No hint text for the `tidyup` tool | P3 | UX-polish gap relative to sibling tools. |
| Duplicated "at least 2 elements" guard at both the `App.tsx` call site and inside `tidyUpElements` | P3 | Low risk of drift, but two sources of truth for one invariant. |

## Prioritized Recommendations

| # | Recommendation | Impact | Effort |
|---|---|---|---|
| 1 | Resolve the frame-child style/size mutation vs. placement-exclusion inconsistency; add a covering test | H | M |
| 2 | Confirm whether `excludeElementsInFrames` in `selection.ts` actually does anything, and either remove the dead parameter or restore its function | M | S |
| 3 | Add a genuine N-N tie fixture to the majority-style test (or rename the test to match what it verifies) | M | S |
| 4 | Add portrait-image-scaling and frame-unit test coverage | M | S |
| 5 | Adopt `style:`/`chore:` prefix convention for lint-only follow-up commits | L | S |
| 6 | Replace `TidyUpIcon` with a distinct icon and add `HintViewer` text for the tidyup tool | L | S |

## Workspace Hygiene

Not run for this audit; the task scope was explicitly limited to the six named commits and their diffs. A workspace duplicate-directory scan is unrelated to feature-level code review and was skipped as out of scope; if a full engineering audit of this repo is requested separately, that section should be included then.

## Credential Exposure Scan

Not run. This audit's scope was explicitly limited to reviewing the tidy-up feature diff (client-side canvas geometry code, no secrets, no env vars, no credentials touched by any of the six commits). No files matching credential patterns were introduced by this diff (confirmed via the `git diff --stat` file list above: no `.env*`, no CLI config, no vendor auth files). A full credential-exposure sweep (git history, session transcripts, shell history, vendor CLI configs) was not performed because it is out of scope for a feature-level diff audit and was not requested; recommend running it separately under a full-repo audit if warranted.
