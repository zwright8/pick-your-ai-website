# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Bind local pricing and compatibility to the build’s pinned artifacts, and reject foreign evaluation evidence before HTTP requests.
- Withhold candidate verdicts from a different displayed snapshot, and avoid presenting unavailable requirement or check counts as zero.
- Refresh Linux builder visual baselines for the mode-dependent requirement label and the earlier light-theme status contrast fix.
- Keep export failures visible in the builder and summary, and clean up temporary download links if the browser rejects an export.
- Keep share failures visible until dismissed or a retry succeeds, and preserve feedback when clipboard attempts overlap.
- Refresh repeated toast announcements and clear expired messages from the accessibility tree.
- Make summary and shared-build warning paragraphs readable at narrow widths without changing compact severity badges.
- Show reported subtotal, tax and total in empty complete and partial cost breakdowns; keep totals hidden when coverage is unknown.
- Show nonzero totals even when an estimate has no priced line items, including tax-only estimates.
- Preserve small and large compute and storage usage projections to contract precision, and leave unsupported precision unpriced.
- Preserve exact request and token projections for large workload objectives, and leave unsafe imported integer inputs unpriced.
- Leave conflicting or conditional preview price rates unpriced instead of adding unresolvable quotes together; ignore expired alternatives when a current rate for the same meter applies.
- Improve light-theme contrast for unknown and partial values in the builder status strip.

- Scope `@typescript-eslint/typescript-estree` to `minimatch` 11.0.1 for the affected development-tooling path in [#338](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/338). Remove the override when a compatible upstream release supplies a patched dependency. The separate ESLint 3.x path remains in the advisory inventory; this is a partial remediation.

- **Builder, catalog and compare rebuilt on a dense "parts list" layer** (`src/styles/dense.css`, `src/components/parts.tsx`) modelled on the PCPartPicker interaction patterns recorded in `docs/research/pcpartpicker-ux-notes.md`: fixed component rows in dependency order with "Choose …" empty states, a status strip carrying the worst outcome plus live estimates, a running total under the table, lettered findings with severity and outcome as words, an explicit "what was not checked" note, a compatibility filter that is on by default with `unknown` as its own bucket, `aria-sort` table headers, active-filter chips, and URL-carried filter state.
- Compare is now one aligned table (properties as rows, up to three products as columns) with difference markers, slot pickers, and explicit "not recorded" cells instead of blanks. `*_ref` spec values are resolved to the referenced component's name so no internal catalog id is printed.
- The three pages use compact titles and tables instead of the marketing hero treatment; the marketing pages are unchanged.
- **Website UI rebuilt to match the approved design mock** (`docs/design/pickyourai-complete.html`). The mock's stylesheet is vendored verbatim as `src/styles/mock.css` (the only edit is scoping the theme class to `<html>`), its 33-glyph icon sprite as `src/components/icon.tsx`, and every screen now uses the mock's markup and class names instead of utility classes; Tailwind was removed. The seven "layers" of the mock are the contract's seven tiers, so no parallel taxonomy was introduced.
- Home, builder, catalog directory, component chooser, component detail, compare, My Builds, starter builds, methodology, about, legal, build summary and the shared-build preview all follow the mock's layout, typography, palette and responsive behaviour.
- A first visit opens an empty canvas, not the mock's prefilled demonstration stack: a preselected stack would read as a recommendation, and an unconfigured build must surface as `Incomplete`, not `Compatible`. Starter stacks remain an explicit choice on /templates.
- Per-component prices come from the real preview estimator over a one-item probe build (`src/lib/item-cost.ts`), never from hard-coded numbers. Every applicable meter is summed, so a component with two billable meters shows both; if any meter has no applicable rate the row is a lower bound (`≥ … partial`) rather than a monthly price, and `Unknown` when none applies. Free/included is an admission outcome of the build policy, not a property of the item: absent or false `allow_unverified_catalog_items` gives `Unknown`, true gives `Included*` with a caveat. Never `$0`.
- Catalog rows carry a one-line spec subtitle (`rowSubtitle` in `src/lib/catalog-view.ts`) that only prints values the catalog records, prefers numbers, and never restates the component kind or layer.
- Compare and catalog rows show licence/billing facts the contract actually carries instead of inventing a vendor name.
- Dim greys were lifted to the WCAG AA contrast floor in both themes, and accent-filled controls pick ink or white per theme.
- Documentation: `docs/DESIGN_SYSTEM.md` rewritten for the new design system; `docs/ARCHITECTURE.md` stack line updated.

### Fixed

- Methodology now distinguishes fixture pricing from API-provided estimates and does not claim the client independently verifies server arithmetic or that HTTP data is entirely synthetic.
- Privacy, About and saved-build screens describe the configured local or API build store and disclose API analysis requests; removing an API-backed build is clearly identified as a local-only removal.
- Global, home, builder, catalog, component detail, comparison and saved-build labels no longer describe all HTTP-mode data as synthetic demo data; fixture mode retains its demo labels, and synthetic-tagged HTTP records remain identified.
- Summary and shared views identify names and synthetic labels as belonging to a different current catalog version; summary cost tables use a neutral caption in HTTP mode.
- Markdown exports label synthetic catalog records individually and no longer describe HTTP-mode data as wholly synthetic; drifted records are labelled without attributing their provenance to the pinned version.
- Markdown exports keep user and catalog text within its intended heading or table cell, including names and versions containing markup, pipes or line breaks.
- Contract-valid timestamps that the browser cannot format, including leap seconds, display their recorded value instead of “Invalid Date” in build and history views. Saved builds sort by actual instants across time-zone offsets and fractional seconds.
- The JSON preview uses the same portable formatting as downloads, reports import limitations, and cannot copy an error message as if it were JSON.
- JSON exports use compact formatting when indentation alone would prevent re-import; summary-page exports also show persistent warnings when a downloaded backup cannot be re-imported.
- Builds imported at the nesting limit can now round-trip through the export envelope and share links.
- Export warnings remain visible beside the relevant action until dismissed, identify the downloaded file, and return keyboard focus to the export button.
- Deeply nested imported files and links now show a clear error before they can overflow the browser's stack during editing or saving.
- Restoring a revision now restores its catalog locks and extension data, including absent optional fields, while preserving the current build's identity and lifecycle metadata; an outdated restore action cannot overwrite a newly opened build.
- Invalid import metadata no longer crashes build import or shared previews; builds too large for the preview limit no longer produce unusable share links. JSON imports accept files up to 5 MB, independently of the 512 KB link limit. Larger JSON downloads remain available as backups and report that they exceed the import limit.
- Saved-build recovery can find records missing from a partially intact library index while preserving existing entries and backing up the index. Duplicate index entries no longer create duplicate cards.
- Storage operations release their Web Lock after synchronous failures on Node 25, allowing subsequent operations to proceed.
- Open component settings retain unapplied edits and cannot apply them to a selection that was replaced, removed, changed version or became ambiguous.
- Objective edits update only changed fields and merge policy changes into the latest draft, preserving untouched values and absent policy defaults. Field guidance is associated with its input for screen readers.
- Component settings preserve untouched values, including empty lists and scopes containing commas; JSON array input supports editing those values without losing whitespace or delimiters.
- Builder rows identify pinned versions that differ from the current catalog and do not attribute newer billing or evidence to them. Missing catalog selections remain configurable, and revision comparisons show changed pinned versions.
- The local evaluator excludes catalog records that do not match an enabled selection's pinned kind and version, keeping affected tool and capacity checks unknown instead of using another version's facts.
- Deployment-mode guidance and cost estimates no longer infer facts from a mismatched catalog record; summary, shared and Markdown views identify unavailable or different versions.
- Catalog, detail and comparison selection guards distinguish component versions, allowing a current version to replace an older selection without mispricing the existing one. Version replacement confirms before resetting component settings.
- The home preview prices its selected version rather than borrowing the price of a newer catalog record.
- Replacement links cannot apply a component to a missing, ambiguous or different-kind slot; invalid replacements leave the draft unchanged.
- Catalog, component detail and comparison views only use compatibility results for the exact item version; ambiguous or failed results remain unknown.
- Reevaluate compatibility when cost or capacity evidence changes under the same ID, and withhold the previous report while the new evaluation is pending.
- Failed analysis refreshes no longer present retained cost, resource evidence or evaluation reports as current.
- Malformed component links no longer crash catalog or comparison pages; unavailable comparison slots are explained without discarding valid components.
- Catalog specification sorting keeps missing values last in both directions and orders list-valued fields by their displayed values.
- Catalog cost sorting keeps complete estimates, partial lower bounds and unknown prices in separate groups in both directions, with exact decimal ordering and accessible sort descriptions.
- The catalog provides a sorting control on small screens, where the sortable table headers are hidden.
- Saved-build cards keep known layer counts and prices when compatibility checks are slow or unavailable, while withholding mismatched evaluation results.
- Saved-build cards load their analysis independently, so a slow build no longer delays the rest of the library; details from a different revision are withheld.
- Reject API cost estimates with conflicting currencies, and exclude inconsistent cost evidence from local budget checks instead of reporting a misleading result.
- Cost differences use exact decimal arithmetic and retain sub-cent precision; currency totals also format large and half-cent amounts without binary rounding errors.
- Build comparisons retain repeated selections, match revisions by selection identity, and show role promotions separately from removals.
- Saved-build cost sorting groups estimates by coverage, currency and period, and orders comparable decimal amounts exactly; group labels explain the ordering.
- Late save responses from an earlier draft no longer change the current build pointer or its save status; an older save cannot report a newer pending edit as saved.
- Rapid edits to the same draft save in revision order. If a save fails, later edits remain in the working draft and can be retried in order without overwriting a conflicting saved revision.
- The browser warns before leaving while the current draft has a pending or failed save, reducing the chance of losing unsaved edits on reload or close.
- Starting or opening another build now asks before replacing a draft with unsaved changes; deleting the current build warns when its working draft has unsaved edits.
- A slow request to open a saved build no longer replaces a newer selection, new draft or subsequent edit when it finishes late.
- An over-limit name stays available when leaving the builder or starting a new build is cancelled, with a warning before the uncommitted name is discarded.
- Component settings reject malformed, non-finite and unsafe integer inputs instead of silently changing them, and enforce the contract's exclusive numeric bounds.
- Settings inputs and validation messages remain legible in light mode's dark dialogs.
- Unapplied objectives remain in the form when another change creates a build revision; untouched fields continue to reflect the latest build values.
- The builder warns before discarding unapplied objectives when navigating away, reloading or starting another build; applying or reverting the edits clears the warning.
- The component settings dialog warns before discarding edits through its close controls or reload; reverting the edits removes the warning.
- Numeric objectives reject non-decimal and unsafe integers instead of silently changing them; whitespace-only optional fields remain unset.
- Tool settings flag duplicate allowed scopes before saving, as required by the contract.
- URI-formatted component settings use the contract validator's URI rules and report invalid values before applying them.
- Leaving My Builds cancels a pending open action so a late response cannot replace the working draft or redirect the user.
- Incomplete remote drafts are rejected locally with an explanation instead of sending a snapshot the API contract cannot accept. Local-to-remote draft promotion remains unsupported and is documented in `docs/DATA_INTEGRATION.md`.
- If a build saves but the browser cannot remember it as current, the builder and library explain how to reopen it and offer a pointer-only retry.
- A single builder edit no longer queues duplicate saves under React Strict Mode; consecutive edits still persist in order.
- A build requested while the catalog is loading remains pending through a failed catalog request and opens after a successful retry, without a duplicate fetch.
- Removing a primary selection now promotes an enabled remaining selection before a disabled one, so primary-based checks continue to see the active component.
- Open component settings retain edited fields while updating untouched fields from a newer build snapshot, avoiding overwriting newer values on apply.
- A delayed delete no longer resets a newer working build or cancels an in-flight request to open another build. If the deleted build was edited or the open fails, its draft remains visible and is marked unsaved so it can be copied.
- Generated visual and Lighthouse reports are excluded from lint and formatting checks.
- Saved-build deletion checks the confirmed record for changes and refreshes the library on conflict, including for unreadable records. Cooperating tabs use Web Locks where available; localStorage itself is not atomic across non-cooperating tabs.
- Local build reads, writes, deletes and index recovery share an exclusive browser lock where supported; submitted snapshots are captured before waiting for that lock.
- The unload warning is installed as soon as a save is queued, including while it waits for another tab's lock.
- Saved histories with duplicate or out-of-order revisions, a mismatched current head, or future change records are reported as damaged; a valid current head can still be recovered as a copy without changing the original.
- Saved-history and remote-cache comparisons treat omitted optional values according to their persisted JSON representation, avoiding false conflicts for `undefined` properties.
- Retries of the same unconfirmed remote write reuse its idempotency key within the current session; concurrent identical accepted responses can share an unchanged local cache entry.
- Visual regression checks wait for fixture results before capture and allow slower runners time to obtain stable screenshots; the checked-in baselines are unchanged.
- **Per-item price no longer reports only the first billable meter.** A component can have several applicable meters (a model has input and output token rates), and the register showed the first line as if it were the whole monthly price. All lines are now summed with the estimator's exact decimal arithmetic, a partly-priced component is labelled a lower bound, and the build policy decides free/included admission rather than the item's billing class alone.
- **No invented evidence expiry.** The register derived a `stale` flag from `days > 30` and the methodology page claimed a 30-day warning. Research #41 adopts no time-to-live: an evidence date is descriptive, and a version-pinned fact does not expire with age. Age-derived staleness is removed; `evidenceDateLabel` (`src/domain/freshness.ts`) presents the date and its basis (latest recorded source check, or item update).
- **Historical `verified` labels are no longer presented as current independent verification.** The strongest recorded provenance status is shown as `Recorded: verified` with its caveat, because the label may record a source check only. Extracted to `src/features/builder/evidence.ts`.
- **A declared SPDX licence is no longer treated as proof of open-source distribution.** `isOpenSource` became `accessSummary` / `declaresLicence`; the filter reads "Declared licence only".
- **`unicode-range` excluded glyphs the UI renders.** The self-hosted faces carried Google Fonts' default _latin_ range, which stops at U+2193, so `→ ↗ ↥ ≠ ≤ ≥ ⊆ ✓ ✕` silently fell back to a system font although the subset contained them. The range is removed and a unit test asserts any declared range covers the whole subset.
- **No horizontal page scroll on any route (WCAG 1.4.10 reflow).** The catalog rail, the About value grid and manifesto, the compare tier tabs and the header navigation each made the document wider than the viewport at 320–820 px, because grid/flex children default to `min-width: auto` and the menu button only appeared below 760 px. Fixed, and `tests/e2e/no-horizontal-scroll.spec.ts` asserts no route scrolls sideways at five widths.
- **Layout shift on the parts routes.** The builder status headline and the catalog rail status note grow from one line to three when the evaluation resolves, moving the table by 32–47 px. Both reserve their tallest state (CLS 0.055–0.071 → 0.007–0.023).
- **The build-compare chooser had no `h1`.** `tests/e2e/document-structure.spec.ts` now asserts exactly one `h1` per route, an accessible name on every visible control, and no request leaving the origin.
- **The dialog did not contain keyboard focus.** Tab is trapped inside the modal and focus returns to the opener on close.
- **Builder and revision comparison were lost in the redesign.** Restored on top of the design system as `?revisions=` and `?builds=`, sharing one diff renderer with selections by tier, objectives/policy/locks, outcome changes and cost.

- **The landing page's primary call to action seeded a preselected stack.** "Build your AI stack" started the builder from `STARTERS[0]`, so a first-time visitor arrived at a complete stack with prices and a `Compatible` verdict they had not chosen — the same preselected-recommendation problem the builder's own first-visit rule forbids. It now starts a blank build, and choosing a starter stays an explicit action on `/templates`. `tests/e2e/start-blank-build.spec.ts` asserts the landing CTA lands on `Incomplete — 0 of 4 required choices made` with zero selections.

### Performance

- Web fonts are glyph-subset to the characters the UI renders: ~91 kB of faces became ~58 kB. `fonts-src/` keeps the pristine upstream files (never shipped); `npm run fonts:subset` regenerates. The `wght` axis is **not** clipped — doing so rewrote the retained masters and changed interpolated advances between the named weights (Space Grotesk at 550 differed by 0.25%). Which weights may be used is declared in CSS instead.
- Each family has a metric-matched `'<Family> Fallback'` face (`size-adjust`, `ascent-override`, `descent-override`) so the `font-display: swap` swap does not reflow: the line box matches the webfont exactly and the advance is within ~3%. The mono faces use `font-display: optional`, since a late swap would re-lay every numeric column.
- The shipped binaries are verified by decoding them: the variable axes keep their upstream bounds (DM Sans `100/400/1000`, Space Grotesk `300/300/700`), and the copyright and SIL OFL licence-URL `name` records survive subsetting (`preserveNameIds`), which the OFL requires. The subset also no longer includes `U+007F` (DEL), a control character that was in the printable-ASCII range by an off-by-one.
- Guards: a unit test fails on a character outside the subset, on a payload over 64 kB, or if the subset script re-introduces axis clipping; an e2e test loads each pristine face beside its subset and asserts all 120 codepoints measure identically **and** that the variable faces interpolate identically at 400/450/500/550/600/650/700; a second e2e test asserts the fallback faces match and are measurably closer than the plain generic family.
- `dense.css` is imported by the modules that render the parts register instead of globally, so the marketing pages no longer ship table CSS they cannot match.

### Added

- Accepted English 1.0.0 display labels from Research #487, pinned independently of frozen v1 and imported without a duplicate kind table; normal contract verification checks the sidecar and its immutable upstream source.
- Project bootstrap: Vite + React 19 + TypeScript (strict), React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright with axe.
- `dist/version.json` build stamp (commit, build time, contract version and source SHA, data mode) and a footer build indicator.
- Vendored research contract v1.0.0 from `Pick-Your-AI/pick-your-ai-research@d4bdca4` with provenance manifest and hash verification (`npm run contracts:verify`).
- CI workflow (`CI`) with the `ci-required` aggregate check, reusable via `workflow_call`, uploading the `site-dist` artifact.
- Contract-generated TypeScript types and ahead-of-time Ajv validators (`npm run contracts:types`; no `eval`, CSP-safe).
- Domain layer: TypeScript port of the reference rule interpreter (parity-tested against `reference/evaluate.py`), bidirectional graph invalidation, revisioned build operations, preview cost estimator, freshness checks, import/export and share links.
- Data layer: `CatalogRepository`, `BuildRepository`, `CompatibilityEvaluator`, `PricingProvider`, `EvidenceProvider`, `ResourceEstimateProvider` with fixture and HTTP implementations selected by `VITE_DATA_MODE`; synthetic demo catalog and pricebook validated against the schemas.
- Website UI: home, AI stack builder (T0–T6 rows for all 29 kinds, add/replace/remove/disable, schema-driven settings, objectives, persistent summary, findings with outcome + severity, invalidation notices, revision history, local drafts, JSON/Markdown export, import, share links), catalog, component selection (search, schema facets, sortable columns, compatibility buckets, compare tray), component details, compare (components, builds, revisions), build summary, My Builds, shared build preview, methodology, about, legal; light/dark themes, mobile layouts, demo-mode banner.
- Original raster art generated with OpenAI Codex (GPT Image), optimised to AVIF/WebP; provenance in `docs/ASSETS.md`.
- Playwright smoke and axe (WCAG 2.2 AA tags) tests for every route on desktop and mobile, plus builder, selection and share flows.
- Repository governance: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, issue and PR templates, Dependabot.
