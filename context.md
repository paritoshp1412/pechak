# Pechak — session context

Read this first in any new chat about this repo. It's the "what/why/where are we" doc; the deep detail lives in the three docs it points to.

## What Pechak is

A single-page personal-finance app (ledger, budget, investments, Indian tax calculations) that mirrors a real Excel workbook (`Personal_Finance_Add_v2.xlsx`). Local-first: all data lives in the browser (`localStorage` + IndexedDB) until the user explicitly imports from or merges/exports back to their `.xlsx`. No backend, no accounts, no cloud database — see `pechak-documentation.md` for the full feature tour and sync internals.

Currently deployed as a GitHub Pages PWA. Built with Vite (migrated from a single static HTML file in commit `3037169`).

## The goal right now: get Pechak onto the Google Play Store

Full analysis and recommendation is in **`pechak-play-store-assessment.md`** (long — read the executive summary + whichever numbered section is relevant). Bottom line:

- **Recommended architecture:** a **hardened Capacitor Android app** with the web assets bundled inside it (not a Trusted Web Activity, not a native rewrite). Keep GitHub Pages as the browser version.
- **Why:** reuses the entire existing finance/tax/workbook-merge engine, needs no server, and Capacitor gives reliable file import/export, app-private storage, and a path to real security hardening (encryption, biometric lock) that a browser-hosted PWA/TWA can't offer.

### The high-level plan (assessment doc, executive recommendation)

1. **Harden the web app** and split platform-sensitive operations behind adapters (storage / document / share / network).
2. **Bundle it in Capacitor.**
3. **Store live state and cached workbook bytes locally** (move off browser-only `localStorage` to native persistence).
4. **Use Android's system document picker** for `.xlsx`, JSON, and CSV import/export.
5. **Release** through internal testing, then a closed test.
6. **Harden** privacy, backup, security, and compatibility before a public release.

**Per a later decision: all Capacitor/native work (plan steps 2–4, i.e. actually building/bundling the Android shell) is parked until the end.** Keep making the web app itself more robust first (see "Where we are" / "What's next" below); only pick up Capacitor once that web-hardening track is exhausted.

Section 4 of the assessment ("Existing code changes likely required") breaks step 1 + the native work into concrete launch blockers:
1. Platform adapter layer (storage/document/share/network interfaces) — **done, see below**
2. Reliable Android open/save via system document picker — parked with the rest of Capacitor, see above
3. Bundle critical dependencies (SheetJS, fonts, `template.xlsx`) — **done, see below**
4. Native storage migration (off `localStorage` onto app-private/SQLite storage) — parked with the rest of Capacitor, see above
5. Service-worker gating (keep SW for the hosted PWA, don't rely on it inside the Android WebView)
6. Error/lifecycle handling (transactional writes, interrupted import/export recovery) — **atomic writes + previous-known-good snapshot done (Step 7), plus a hardened/transactional-ish backup-restore path (Step 8), see below; import/export interruption recovery beyond that is still open**

## Where we are

**Done:** the PWA-hardening checklist that was pulled out of the assessment's §3A recommendations (this covers launch-blocker #3 above, plus part of #5):

1. ✅ Vendored SheetJS via npm/Vite instead of loading from cdnjs (`src/xlsx-loader.js`), now pinned to the official SheetJS 0.20.3 CDN tarball with lockfile integrity metadata; this resolves the prototype-pollution and ReDoS advisories reported against 0.18.5.
2. ✅ Self-hosted the three Google Fonts as local `woff2` files (`public/fonts/`).
3. ✅ Added the missing `manifest.json` fields (`id`, `lang`, `dir`, `categories`) — and fixed a live bug found along the way: `start_url` still pointed at `mobile.html`, a file the Vite migration had already deleted, which was silently breaking installed-PWA launches.
4. ✅ Rewrote `public/sw.js` with explicit per-asset-type caching (cache-first for immutable assets, network-first for the app shell, network-only/uncached for the MFAPI/stock-price/CORS-proxy hosts).
5. ✅ Replaced the unconditional `self.skipWaiting()` with a visible "Update ready" banner, gated so it can't fire mid-import/merge (`window.__pechakBusy`).
6. ✅ Verified price-API failures stay isolated, visible, and non-blocking (this was already correct; confirmed by testing, not fixed).

Commits: `1b09780` (the hardening itself), `1b45d2c` (documenting it).

**Also done:** the platform adapter layer (assessment's step 6, pulled forward — see `pechak-documentation.md` §7 item 8 for the full writeup): `src/adapters/storageAdapter.js`, `documentAdapter.js`, `shareAdapter.js`, web-only implementations wrapping the existing localStorage/IndexedDB/file-input/download code, called through the adapter instead of directly. Required converting `index.html`'s main script to `type="module"` to import them without a race on page load — see the doc entry for the two non-obvious fallout points (theme-reset race, `window.switchCapTab` export) if touching that script again. Capacitor/native adapter implementations remain out of scope until that work resumes.

**Exit gate passed** (with one caveat) before moving on: confirmed offline launch after install and confirmed an accepted update doesn't lose `localStorage`/IndexedDB data. See "Limitations" below for the one thing that gate could *not* fully prove.

**Also done — Step 7, atomic writes + previous-known-good snapshot** (still web-backed, no native files involved): `storageAdapter.js`'s `setStateAtomic`/`getStateAtomic` (for the main `S` state, `localStorage` key `ledger_app_v7`) and an updated `setWorkbookBytes`/`getWorkbookBytes` (for the IndexedDB workbook cache) now wrap writes in a versioned envelope (`schemaVersion`, `writtenAt`, `appVersion`, a checksum over the payload/bytes), write to a staging/temp location and validate before promoting it into the real key, and keep one previous-known-good copy to fall back to if the live copy ever fails checksum validation. Verified in a headless preview including a hand-corrupted main copy correctly falling back to the previous-known-good one. Pending queues, theme, and `localSync` deliberately stay on the old plain-write path. Full writeup: `pechak-documentation.md` §7 item 9.

**Also done — Step 8, hardened portable backup + auto-backup** (closes two long-documented backup gaps and adds real protection against browser-storage eviction, still web-backed): the JSON backup format bumped to 5 to include archived Quick-Add batches and the cached workbook bytes (base64-encoded) that were previously excluded; `capParseBackupFile()` now rejects wrong-app/wrong-typed backups without breaking old-format compatibility; `capRestoreFromBackup()` was restructured to build-then-commit instead of ~25 interleaved live mutations; and a new **File System Access API auto-backup** (Chromium-only, one-time picker grant, then silent same-file overwrite every 14+ days, no accumulation) replaces what was originally going to be a dismissible reminder banner — that plan changed mid-task to "no nagging, silent instead," confirmed with you directly. A passive "Last full backup"/"Auto-backup" status pair now lives in the Data tab instead of any banner. Verified end-to-end in a headless preview: full round-trip through the actual restore UI (including a validation bug the first pass had — several fields were misclassified array-vs-object relative to `S`'s real shapes, caught before shipping), old-format backward compatibility, and all three auto-backup UI states (enabled/lapsed-permission/unsupported-browser) with `showSaveFilePicker` mocked (the real native picker can't be driven by browser automation). Full writeup: `pechak-documentation.md` §7 item 10.

**Also done — Step 9 items 3-4, reconciliation/integrity checks + Needs Attention** (Play Store assessment's priority-UX list, jumped ahead of items 5-9 since these are financial-accuracy correctness gaps, not polish): a new `integrityChecks()` promotes the cash-flow reconciliation identity from an uncolored table row into a real fail/pass check, and adds warn-level checks for transactions or pending workbook-change entries that reference an account/category/holding since deleted (tolerated by the app's own confirm dialogs, but silently excluded from balances per how `compute()` works — worth surfacing even though it's by design). Surfaced in Statements, a new Data-tab card, and a new **Needs Attention** nav tab that also aggregates budget overage, capital-gains exclusions, Schedule AL/FA flags, TDS-likely FDs, and allocation drift — all via existing computations, no reimplementation. Full writeup: `pechak-documentation.md` §7 item 11; rejected checks logged in §6.

**Also done — the remaining web UX priority releases (`1.1.0`–`1.5.0`, commit `20032e5`):**

1. A dependency-free production-browser golden suite froze reviewed finance, tax, import, backup, all-12-queue, and workbook XML results before UX work.
2. **1.1.0:** separated Save safety copy, Update workbook, and Export backup into explicit journeys.
3. **1.2.0:** added shared calculation explanations/provenance across Overview, Statements, Tax, Investments, Fixed Deposits, and Budget.
4. **1.3.0:** added transaction templates/recent choices, progressive fields, effect previews, persisted drafts, and duplicate-and-edit.
5. **1.4.0:** added workbook SHA-256 drift detection, compatible-drift confirmation, structural blocking, bounded receipts, and downloadable JSON merge reports.
6. **1.5.0:** applied the approved Home / Activity / Plan / Tax / More mobile navigation, preserved leaf-route deep links, and fixed sticky table columns so long labels cannot cover horizontally scrolled values.

Each release passed `npm run build` and the unchanged Step 0 golden baseline. Tax-rule update review remains deliberately deferred.

**Automated test layers are now implemented.** Narrow production seams live in
`src/domain/ledger.mjs`, `tax.mjs`, and `backup.mjs`; storage envelope validators
are exported from the existing adapter. Node `node:test` suites cover calculations,
validation, tax boundaries/migrations, storage corruption/fallback, and complete
backup round trips. The unchanged CDP golden baseline remains the workbook
integration gate, and Playwright covers the primary DOM journeys against a
production preview. `npm test` builds once and runs every layer; see
`tests/README.md`. Android/native instrumented tests remain intentionally skipped.

Full changelog entries and the "still needs validation" list live in `pechak-documentation.md` §6–§7 — that's the canonical running record, this file is just the orientation summary.

## What's next

**Capacitor/Android work (Step 4 onward: installing Android Studio, `npx cap init`, the native shell, document picker, native storage migration) is explicitly parked until last** — see the note under "The high-level plan" above. Until that track is picked back up, keep finding web-hardening work in the spirit of Steps 7–9 (robustness/safety improvements to the existing browser app) rather than starting the native shell.

**The planned web UX sequence is complete except for tax-rule update review, which remains deliberately out of scope.** Use `tests/golden/baseline.json` as the regression boundary for subsequent work; do not regenerate it for UX-only changes.

**Tax-rule publishing workflow:** the repository now contains the closed v1
schemas, the immutable FY 2026-27 pack mirroring `TAX_RULES_DEFAULT`, RFC
8785/Ed25519 Node tooling, immutable promotion safeguards, and reviewed browser
tax fixtures. Operator instructions are in `tax-rules/README.md`. This is a
publishing workflow only: runtime fetch/banner/review/apply, override conflicts,
cache/history/rollback, and richer workbook capital-gains fields remain out of
scope. The app deliberately retains its single shared `otherLtRate` model.

Still open whenever Capacitor work does resume: launch blockers **#2 (Android document picker)** and **#4 (native storage migration)** from the assessment's list above, plus before any of it starts, Android Studio needs to be installed (SDK Platform 36+, matching build tools, an emulator image) — not yet done.

## Known limitations (accepted, not blockers)

- **"Local-only" needs a precise privacy claim.** Per the assessment §5: local storage isn't an encrypted vault, Android system backup can copy app data off-device unless explicitly disabled, and price lookups reveal IP + ticker to third parties. Don't claim "nothing ever leaves the device" — see the assessment for the exact recommended wording.
- **`sw.js`'s `networkFirst()`** only falls back to cache on a thrown fetch exception (genuine offline), not on a resolved-but-non-2xx response (e.g. a misconfigured host returning 404/500). Fine for the offline guarantee (real offline throws), but a gap if the server is ever up-but-broken.
- **GitHub Pages web app and the future Capacitor app will not share storage automatically** — a one-time JSON-backup-based migration path is planned (assessment §3, "Migration from the website") but not built.

## What still needs testing/validation

- **Real-device offline test.** The exit gate proved SW cache-interception and full precache coverage in a headless preview (confirmed the SW serves stale cached bytes even when the on-disk file changes — proof it never even asks the network for a cache-first hit), but couldn't do a literal airplane-mode test because the browser tool ties the tab's lifecycle to its own dev-server health check. **Do a real install → force-stop connectivity → relaunch test on an actual device before Play Store submission.**
- **`manifest.json`'s `"id"` field** is currently the placeholder `/pechak/`. Confirm the final deployed path (custom domain vs. GitHub project-Pages path) and update it — a mismatched `id` makes Play/PWA treat an update as a different app.
- Everything in the assessment's own validation asks: TWA Digital Asset Links (`/.well-known/assetlinks.json`) if a TWA is ever built instead; Android WebView compatibility for `CompressionStream`/`DecompressionStream` (used for workbook ZIP processing) once Capacitor is in play; storage-schema migration correctness once native storage replaces `localStorage`.
- `BASELINE.md` has its own open-questions list (exact scope of `tr_queue_v1`, whether empty vs. absent queue arrays are handled identically) — relevant once the native storage migration (`localStorage` → native) actually happens, since that's when every key in that baseline needs a 1:1 native equivalent.
- **Step 7's atomic-write/previous-known-good fallback** was only verified against hand-simulated corruption (flipping the `checksum` field directly in devtools), not a real interrupted-write scenario. The code path is identical either way, but worth keeping in mind if it's ever depended on as a real safety net.
- **Step 8's auto-backup** was verified with `showSaveFilePicker` mocked (browser automation can't drive the real native file-picker dialog) — the enable/write/lapsed-permission/unsupported-browser logic is real, exercised code, but the actual native-picker interaction itself is unverified. Also: someone who never grants the one-time File System Access permission gets no silent auto-backup at all (by design) — their only safety net is the manual button prompted by the "Last full backup" row going stale.

## Where things live

| What | File |
|---|---|
| Full Play Store architecture analysis & recommendations | `pechak-play-store-assessment.md` |
| Feature tour, sync internals, changelog, known limitations | `pechak-documentation.md` (§6 limitations, §7 changelog) |
| `localStorage`/IndexedDB key-by-key inventory | `BASELINE.md` |
| Vendored SheetJS loader | `src/xlsx-loader.js` |
| Platform adapters (storage/document/share — web-only for now) | `src/adapters/storageAdapter.js`, `documentAdapter.js`, `shareAdapter.js` |
| Self-hosted fonts | `public/fonts/` |
| Service worker | `public/sw.js` |
| PWA manifest | `public/manifest.json` |
| Main app (single-file UI + logic, pre-Capacitor) | `index.html` |
| Frozen production-browser regression suite | `tests/golden.mjs`, `tests/golden/baseline.json`, `tests/fixtures/populated-state.json` |
| Tax-rule release operations | `tax-rules/README.md`, `scripts/tax-rules/`, `tests/fixtures/tax-goldens.json` |

## Working notes for whoever picks this up

- Build: `npm run build` (Vite). Dev: `npm run dev`. Preview built output: `npm run preview`.
- When verifying UI/PWA changes, prefer the `preview` (built `dist/`) server over `dev` for anything service-worker-related — the SW behavior only matters against a production-like build.
- This project has a standing habit (see repo docs, §6/§7 pattern in `pechak-documentation.md`) of writing non-obvious findings and pending-validation items into the docs as they're discovered, not just stating them in chat. Keep doing that.
