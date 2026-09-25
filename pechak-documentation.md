# Pechak — full documentation

*A personal-finance app that mirrors an Excel workbook. Everything you do in the app happens locally first; nothing touches your actual `.xlsx` file until you explicitly sync.*

---

## Table of contents

1. [What Pechak is](#1-what-pechak-is)
2. [The core model: local-first, sync-on-demand](#2-the-core-model-local-first-sync-on-demand)
3. [Getting started](#3-getting-started)
4. [Feature tour and user journeys](#4-feature-tour-and-user-journeys)
   - 4.1 [Transactions](#41-transactions)
   - 4.2 [Accounts, Categories & Budget](#42-accounts-categories--budget)
   - 4.3 [Investments — Holdings](#43-investments--holdings)
   - 4.4 [Investments — Fixed Deposits](#44-investments--fixed-deposits)
   - 4.5 [Tax Summary](#45-tax-summary)
   - 4.6 [Deductions](#46-deductions)
   - 4.7 [Capital Gains](#47-capital-gains)
   - 4.8 [Tax Payments](#48-tax-payments)
   - 4.9 [Tax Rules](#49-tax-rules)
   - 4.10 [Data tab — syncing to your workbook](#410-data-tab--syncing-to-your-workbook)
   - 4.11 [Backup & Restore](#411-backup--restore)
   - 4.12 [Calculation explanations](#412-calculation-explanations)
   - 4.13 [Mobile navigation](#413-mobile-navigation)
   - 4.14 [Appearance](#414-appearance)
5. [How syncing actually works, in detail](#5-how-syncing-actually-works-in-detail)
6. [Known limitations & open items](#6-known-limitations--open-items)
7. [Fixes made in this development thread](#7-fixes-made-in-this-development-thread)
8. [Technical appendix](#8-technical-appendix)

---

## 1. What Pechak is

Pechak is a single-file web app (`index.html`) that acts as a companion to a specific Excel workbook template used for personal finance and Indian income-tax planning. It runs entirely in your browser — no account, and no developer-operated backend (price lookups still contact third-party services).

Two things make it distinctive:

- **It's a mirror, not a replacement.** Every screen — Transactions, Budget, Investments, Tax Summary, and so on — corresponds to a sheet in the workbook. The app computes the same numbers the workbook's own formulas would, independently, so you can use the app day-to-day and only touch Excel when you want a durable, shareable file.
- **Nothing writes to your `.xlsx` until you tell it to.** Every add/edit/delete you make lives in the browser first (in `localStorage`, mirrored to `IndexedDB`). A separate "sync" step reviews everything that's changed and writes it into an actual copy of your workbook, which you then download.

---

## 2. The core model: local-first, sync-on-demand

This is the single most important thing to understand about how Pechak behaves, because it explains almost every "why does it work this way" question.

**Two layers of state:**

1. **`S`** — the app's live data: transactions, holdings, budget, deductions, capital gains events, tax payments, fixed deposits, tax rules, and so on. This is what every screen reads from and what every KPI is calculated from. It's saved to `localStorage` after every change (`persist()`), so it survives a page reload.
2. **Pending queues** — one per entity type (12 in total: Transactions, Categories, Accounts, Holdings, Lots, Budget, Deductions, Tax Payments, Capital Gains, Tax Rules, Fixed Deposits, Model Settings). Every add/edit/remove you make *also* appends an entry to the relevant queue. These queues are the todo-list for the next sync — they say "these specific things still need to be written into the real `.xlsx`."

**Why split it this way?** Because your Excel workbook has no concept of your browser session. The app can update its own numbers instantly, but writing into the actual file requires you to hand it a copy of that file, at which point the app replays every queued action against it. Splitting "what I see" (`S`) from "what still needs to reach Excel" (the queues) is what allows the app to work completely offline, indefinitely, without ever touching a file — you only need a file the moment you want one.

**What this means in practice:**
- Add a transaction → it appears in your Overview/Budget/Tax numbers immediately. It also gets queued.
- Go to the Data tab → "Update workbook" → the app reviews everything queued, shows you a plain-English preview, and only writes to the workbook when you confirm.
- Confirm → it writes every queued change into your `.xlsx`'s actual cells, downloads the result, and clears the queues (they're done, no longer pending).
- If you never sync, your data is still 100% usable in the app — you just don't have an updated Excel file yet.

---

## 3. Getting started

There are two ways into the app:

- **Import a workbook** — choose your existing `.xlsx` file. The app reads every sheet (Transactions, Holdings, Investment Lots, Fixed Deposits, Deductions, Tax Payments, Capital Gains, Tax Rules) and populates itself. From this point on, that file's bytes are cached (see [§8](#8-technical-appendix)) as the baseline for future syncs.
- **Start fresh (wizard-only)** — skip the import and start from a blank template. The app seeds itself from a bundled `template.xlsx` the first time you sync, since there's no real file to fall back to otherwise.

Either way, the app then behaves identically — the only difference is what the very first sync merges into.

---

## 4. Feature tour and user journeys

### 4.1 Transactions

The ledger of every income/expense/transfer event. Each transaction updates the relevant account balance and holding immediately.

**Journey — log a transaction:**
1. Tap the floating **+** button (bottom-right) from anywhere in the app.
2. Choose the kind (Expense, Income, Transfer, Buy, Sell, etc.), amount, date, category, and accounts involved.
3. Save — it's queued (`CAP_QUEUE`) and immediately reflected in Overview, Budget, and any affected account/holding balances.

The add overlay also supports saved templates, favorite templates, recent choices, progressive disclosure, a live account/category effect preview, persisted drafts, and duplicate-and-edit. Transfer forms hide irrelevant category fields. Drafts/templates survive reloads and portable backup/restore.

**Nuance:** a Buy/Sell transaction is the *recommended* way to change a holding's units, because it automatically keeps your cash ledger and the holding in sync (the cash leaves/enters an account exactly as the trade implies). The **Investments** tab's own "Add or fix a holding" form exists specifically for cases a transaction can't express cleanly — opening balances, corrections, splits, vesting, gifts.

### 4.2 Accounts, Categories & Budget

Standard setup screens: bank/broker accounts, a category/sub-category tree, and monthly budget targets per category. All three are queue-backed the same way as Transactions, and all three write back to their respective sheets on sync.

**Nuance — category cross-references:** adding a new category doesn't just touch the Categories sheet; if the Budget sheet has its own reference list of category names (for its dropdown/validation), adding a category queues an update to *that* too. This is why the merge pipeline for Budget carries an extra `ratiosXml` alongside its own sheet — a single "add category" action can touch two sheets in one pass.

### 4.3 Investments — Holdings

Tracks your actual portfolio: stocks, mutual funds, ETFs, gold, cash-equivalents.

**Journey — add or fix a holding:**
1. Investments tab → the form under "Add or fix a holding directly."
2. Pick an asset class and instrument type. If it's a mutual fund/index fund/ELSS, a **fund category** field appears — this matters for capital-gains classification later (equity vs. debt tax treatment).
3. Fill in either Units + Avg cost + Current price, *or* just Invested/Value directly for things that don't have a natural "units" concept (e.g. a lump-sum PPF-style entry).
4. Save.

**Journey — import historical lots (CSV):**
1. "Import historical lots" button → pick a CSV with Name, Date, Quantity, Price columns (Ticker and Account are optional).
2. Each row becomes a lot, queued the same as a manually-added one — it *will* be written to the Investment Lots sheet on your next sync (this was previously misdocumented as not happening; confirmed fixed and verified against the real workbook, see [§7](#7-fixes-made-in-this-development-thread)).

**Journey — sell part of a holding, spanning multiple lots:**
1. Log a Sell transaction for more units than your oldest lot holds.
2. The app consumes lots oldest-first (FIFO). A lot that's fully used up gets queued for removal from the Investment Lots sheet (its row is blanked, freed for reuse); a lot that's partially used gets its quantity reduced.
3. **Each lot slice becomes its own Capital Gains event** — a sale spanning three lots produces three rows on the Capital Gains sheet, each with its own acquisition date and holding period. This matters because different lots of the same holding can land in different LTCG/STCG buckets from a single sale.
4. If some of the units sold have no real lot behind them (an "unclassified" gap between what the app tracks and what real lot history exists), that slice gets its own capital-gains event too, but is never written to the Lots sheet (there's no real row to point at) and is excluded from computed CG totals.

**Nuance — lot matching:** a lot has no ID of its own on the sheet. It's matched by Holding Name + Account + Acquisition Date + Cost/Unit together — those four fields are exactly what stays stable across an edit (only quantity changes on a partial sale).

### 4.4 Investments — Fixed Deposits

A dedicated card on the Investments tab (added in this development thread) for adding, editing, and removing FDs, with full write-back to the workbook.

**Journey — add an FD:**
1. Investments tab → scroll to the "Fixed Deposits" card below Holdings.
2. Fill in Bank/Account, Principal, Rate (as a plain percentage, e.g. `7`), Compounding frequency, Start date, Maturity date, Payout type (Cumulative/Payout), Status, TDS paid this FY, and optionally mark it a Senior-citizen account.
3. Click "Add FD" — it appears in the list immediately, the KPIs (accrued interest, TDS paid, FDs tracked, likely-TDS count) recalculate, and it's saved to `localStorage` right away (survives a reload).

**Journey — edit or remove an FD:**
- Pencil icon → form prefills, title changes to "Edit Fixed Deposit" → "Update FD" saves in place.
- ✕ icon → confirms, then removes.
- Internally, edits/removals are matched against the sheet by the FD's *original* Bank+Principal+Start (captured before your edit), so changing any of those three fields mid-edit still finds the right row.

**Nuance — accrual vs. cash:** FD interest is taxed on an accrual basis every financial year, even for a cumulative FD that pays nothing out until maturity. The app computes this itself (30/360 day-count convention, matching the sheet's own formula) rather than asking you to enter it — "Value @ As-of" and "Interest this FY" are never something you type.

**Nuance — the Senior-citizen checkbox is app-only.** It exists purely to compute the "likely TDS this FY" estimate (the Sec 194A threshold differs for senior citizens); the real workbook has no column for it, so it's never written back. "TDS paid" (what your bank actually deducted) *is* written back — it's the one input column on the sheet that has its own defined name (`FD_TDSpaid`).

### 4.5 Tax Summary

A read-only dashboard: your total tax liability under Old vs. New regime, broken down by income head, computed live from everything else in the app (transactions, deductions, capital gains, FD interest, tax payments already made).

### 4.6 Deductions

Chapter VI-A deductions (80C, 80D, HRA, etc.) plus the Old vs. New regime comparison.

**Journey:**
1. Deductions tab.
2. Each deduction category shows its limit and a field for what you're claiming; the app computes the allowed amount (`min(claimed, limit)`).
3. HRA has its own sub-form (basic salary, rent paid, city — metro/non-metro changes the exemption formula).
4. Changes queue and write back to the Deductions sheet on sync.

**Limitation:** Sections 89 (relief for arrears/advance salary taxed at a bunched-up rate), 90/90A (foreign tax credit under a DTAA), and 91 (unilateral relief, no-DTAA countries) are not modeled anywhere — not in the app, not in the underlying workbook. This is a real gap in tax coverage for anyone with foreign income or salary arrears, not an app-vs-sheet inconsistency.

### 4.7 Capital Gains

Shows every classified sale event, bucketed into STCG/LTCG under the relevant sections (111A equity, 112A equity, other-asset LTCG, or slab-rate), with bucket totals feeding Tax Summary.

**Journey — reclassify a sale's asset category:**
1. Capital Gains tab → find the sale event.
2. The Equity/Debt/Other selector on that row edits *that specific sale's* category — it doesn't touch the holding's own default classification, and the holding's default doesn't retroactively change past sales either. Each sale is a snapshot.

**Limitation — write-back is add-only.** If you reclassify a sale's category *after* it's already been written to the Capital Gains sheet, there's no mechanism to push that correction back — the app's own numbers update, but the exported sheet row keeps the old classification until someone edits it by hand in Excel. Building an "edit" write-back for this would need a real workbook to verify column layout against, which wasn't available for this particular sheet's edit path.

**Limitation — the four-way rate fan-out.** The sheet's `CG_Class` matrix has 7 separate rows, each capable of its own long-term holding period and rate. The app's own tax-rules model only has *one* "other assets" rate field, applied uniformly. Saving Tax Rules from the app writes that single value into four of those seven rows identically (Foreign/Unlisted, Debt pre-2023, Gold, Real Estate) — if you'd deliberately set different rates for, say, Gold vs. Real Estate directly in the sheet, saving from the app will silently overwrite that divergence to one shared value.

### 4.8 Tax Payments

Advance tax and self-assessment tax payments, tracked by type/date/amount, feeding the final tax-due-vs-paid calculation.

**Journey:** add/edit/remove entries directly on the Tax Payments tab; same queue-and-sync pattern as everything else. Entries have no ID on the sheet, so they're matched by Type+Date+Amount+Section together.

### 4.9 Tax Rules

The knobs behind every tax calculation: slab rates, standard deduction, rebate thresholds, capital-gains rates and holding periods, FD TDS thresholds, Section 80 limits.

**Journey:** Settings → Tax Rules → edit any field → Save. This is a single flat settings object, not a list — there's no per-field add/edit/remove, and no dedup concern (each save just overwrites the same cells, last write wins, which is correct for a settings object).

**Nuance:** a few fields visible on the *sheet* (e.g. Advance-tax schedule dates, the FD TDS threshold split, the Section 54 property-reinvestment threshold) have no corresponding form control in the app and are deliberately left untouched on save — editing those still requires opening the workbook directly.

### 4.10 Data tab — syncing to your workbook

This is where every queued change actually reaches your `.xlsx`.

**Journey — sync:**
1. Data tab → "Update workbook" (or "Save safety copy" for a same-device IndexedDB snapshot — see [§4.11](#411-backup--restore)).
2. Pick your workbook file (or use the cached copy from your last import/sync).
3. The app replays every queued action against a working copy and shows a **plain-English review**: what will be added, updated, or removed, on which sheet, plus any warnings (buffer full, overwriting real data, an action that failed to find its target row).
4. Confirm → it writes the changes, downloads the merged file, and clears every queue that succeeded.

**Nuance — sheets are buffers, not infinite lists.** Several sheets (Tax Payments, Capital Gains, Fixed Deposits, Investment Lots, Deductions) use a fixed-size row buffer (e.g. Fixed Deposits: rows 5–29, 25 slots) rather than growing indefinitely. Adding beyond the buffer's capacity fails loudly with an actionable message ("ask Claude to extend the buffer") rather than silently overflowing into the next sheet's rows.

**Nuance — nothing is ever guessed.** Every write resolves its target column either from the workbook's own named ranges (e.g. `Budget_Cat`, `FD_TDSpaid`) or from a column position verified directly against a real copy of the workbook. If a resolver can't find what it expects, it throws a clear, specific error rather than writing to a wrong cell.

**Workbook drift detection.** Review computes a SHA-256 source fingerprint. A workbook that differs from the last known baseline but retains the required structure is treated as compatible drift and requires explicit confirmation. A workbook missing a sheet required by pending changes is blocked as structurally incompatible. Successful updates save the output fingerprint and a bounded history of the latest 20 machine-readable receipts; each receipt can be downloaded as JSON and is included in portable backups.

### 4.11 Backup & Restore

Two independent-but-identical mechanisms exist, both drawing from the exact same snapshot function so they can't drift apart:

- **Export backup** — Settings → Data → "Export backup" downloads a `.json` file with your full state.
- **Save safety copy** — the same-device "Save safety copy" action saves the same snapshot into this browser's `IndexedDB`, with no file, no picker — a "just in case" second copy alongside the autosave that already happens after every change.

**Journey — restore:** Settings → Data → Restore, either from a JSON file or from the local sync snapshot. You'll get a warning if you have unsynced pending changes (they'll be discarded and replaced by what's in the backup). Confirm, and every field — including every pending queue, as of this development thread — comes back exactly as it was at export time.

Portable JSON backups (format 5) also include archived Quick-Add batches and the cached workbook bytes, so neither is left out of a restore.

### 4.12 Calculation explanations

Overview, Statements, Tax, Investments, Fixed Deposits, and Budget expose a "How is this calculated?" detail covering sources, formula, period, exclusions, last recalculation, app version, tax-rule provenance, and cached workbook provenance. Tax explanations explicitly flag unsupported relief and incomplete/unclassified gains.

### 4.13 Mobile navigation

Mobile uses Home / Activity / Plan / Tax / More. Existing leaf destinations remain addressable through URL hashes. Plan links to Budget and Investments/target allocation; More contains reports, data safety, setup, workbook, and appearance. Desktop navigation remains intact. Sticky table label columns wrap and are capped on mobile; `colspan` section rows are not sticky.

### 4.14 Appearance

Two themes, switchable any time from Settings → Appearance:
- **Noir** — black background, cream text, one muted-red signal color. This is the default.
- **Swiss** — white background, Bauhaus blue/red/yellow, sharper geometric accents.

The app's brand mark (an owl) and its favicon both re-color automatically with the active theme — dark/cream/red for Noir, blue/white/red for Swiss.

---

## 5. How syncing actually works, in detail

For anyone who wants to understand *why* the sync step behaves the way it does, not just what button to press:

**The queue → merge → write pipeline**, in order, every time you sync: Categories → Accounts → Holdings → Investment Lots → Budget → Deductions → Tax Payments → Capital Gains → Tax Rules → Fixed Deposits → Model Settings. Each step is chained off the previous step's output — if a step has nothing queued, it passes its input straight through unchanged, so the chain is unbroken regardless of which queues are actually non-empty.

**Every entity is matched one of two ways:**
- **By a stable ID** (Transactions, Holdings by Name+Account) — straightforward.
- **By a natural key of several fields together**, when the sheet has no ID column of its own (Lots: Name+Account+Date+Cost; Tax Payments: Type+Date+Amount+Section; Fixed Deposits: Bank+Principal+Start). Edits and removals always carry the record's *original* key fields — captured *before* the edit — so renaming/re-dating something mid-edit still finds the right row.

**Add is dedup-checked; edit/remove are throw-on-miss.** Adding something that already matches an existing row (by its natural key) is skipped, not duplicated, and logged as such. Editing or removing something that *can't* be found in the target workbook copy fails loudly with a specific error naming what it was looking for — never a silent no-op, and never a guess at the wrong row.

**Computed columns are never touched.** Interest-this-FY, Value-@-As-of, and similar formula-driven columns are always left to the sheet's own formulas — the app writes only the raw inputs those formulas depend on, and independently recomputes the same derived numbers for its own display, rather than importing or exporting a pre-computed value that could silently drift from the formula's own answer.

---

## 6. Known limitations & open items

Grouped by whether they're fixable from here, and roughly by severity.

**Real tax-coverage gaps (affect both the app and the underlying workbook):**
- Sections 89, 90, 90A, 91 relief (arrears relief, foreign tax credit, DTAA/non-DTAA relief) — not modeled anywhere.
- Foreign Assets (Schedule FA) — read-only, best-effort match against holdings; never written back. This was a deliberate decision, not an oversight: Schedule FA entries are naturally per-stock while the app's lot model is per-lot, making the mapping the weakest write-back candidate of everything considered.

**App-specific, fixable-with-more-work gaps:**
- Capital Gains write-back is add-only — reclassifying a sale after it's been written to the sheet doesn't correct the already-exported row.
- The Tax Rules "other assets" LT rate fans out identically into four sheet rows (Foreign/Unlisted, Debt pre-2023, Gold, Real Estate) that the real sheet can otherwise hold independently — a real divergence between them gets silently flattened if Tax Rules is saved from the app afterward.
- A handful of sheet-only fields (advance-tax schedule dates, FD TDS threshold split, Section 54 reinvestment threshold) have no form control in the app at all.

**Design decisions that read as limitations but are intentional:**
- CSV-imported holdings/lots *do* get written back to the Investment Lots sheet (this was previously misdocumented as not happening — confirmed and fixed).
- The Senior-citizen flag on a Fixed Deposit is app-only by design (no such column exists on the sheet).
- Theme preference is deliberately excluded from "Clear cache" and from backups — it's a UI preference, not financial data.

**Dead code, not a functional gap:**
- `CAP_META` (a localStorage key alongside the transaction-archive feature) is declared, loaded, and persisted, but nothing in the app currently writes anything into it.

**Integrity checks deliberately not built (§7 item 11), and why:**
- Bank/cash/credit-card/loan balance vs. any real-world source (a bank statement, a broker statement) — there's no independent source of truth anywhere in the app to check against; every balance is `open + ledger deltas` by construction (`compute()`), so it can only ever be compared to itself.
- The broker "uninvested cash" plug (`bal[acct]-secByAcct[acct]`, pushed as a synthetic holding) — a derivation, not a comparison; it always reconciles by construction.
- Opening-balance (`open`) correctness — same reasoning as above, no independent source of truth to check it against.
- Storage-integrity (the Step 7 checksum/envelope, `src/adapters/storageAdapter.js`) was deliberately left out of the integrity-check panel and the Needs Attention badge — it's a different failure layer (bytes truncated/corrupted vs. ledger data being logically inconsistent), already has its own silent fallback-to-previous-known-good plus a `console.error`, and conflating the two severities would be misleading.
- Queue-vs-current-state cross-reference checks (a pending, not-yet-synced change pointing at a since-deleted master record) are only wired for Accounts, Categories, and Holdings (the transaction queue and the lot queue) — Budget/Deductions/Tax Payments/Capital Gains/Tax Rules/Fixed Deposits queues don't have an equivalent "references another entity's master list" relationship inside `S` today, so there's nothing analogous to check for them.

**Still needs validation (not yet confirmed on a real device/install):**
- Offline-launch and update-preserves-data behavior for the PWA (see §7 below) were verified via service-worker interception proof and `localStorage`/IndexedDB checks in a headless preview, not via a literal airplane-mode test on an actually-installed PWA. Do that once before Play Store submission: install, force-stop connectivity, relaunch.
- `manifest.json`'s `"id"` is currently a placeholder (`/pechak/`) — confirm the final deployed path (GitHub Pages custom domain vs. project path) and update it before publishing. A mismatched `id` makes Play/PWA treat an update as a different app.
- `sw.js`'s `networkFirst()` only falls back to the cache on a thrown fetch exception (genuine connectivity failure), not on a resolved-but-non-2xx response (e.g. a misconfigured host returning 404/500). Real offline throws, so this doesn't affect the offline-launch guarantee, but it's a gap if the *server* is ever up-but-broken.
- The atomic-write envelope + previous-known-good snapshot (§7 item 9) was verified with hand-simulated corruption (flipping the `checksum` field directly), not a real interrupted-write scenario (tab killed mid-`setItem`, quota exceeded partway, actual disk corruption). The logic path is the same either way, but a real device test would give more confidence before relying on it as the safety net it's meant to be. `APP_VERSION` in the envelope is now imported directly from `package.json`'s `"version"`, so the two can no longer drift apart.
- **Auto-backup (§7 item 10) is Chromium-only.** `showSaveFilePicker` doesn't exist in Firefox or Safari — those browsers fall back to relying on the manual "Download full backup" button and the passive "Last full backup" health row; there's no second silent mechanism for them. Even on Chromium, the very first grant needs one real click (the File System Access API requires a user gesture to open the picker — a script can't do this at page load), and a later-lapsed/revoked permission can only be re-requested from another click, never silently — the Data tab surfaces "Permission needs renewing" in that case rather than retrying on its own.
- **No true cleanup story for auto-backups if the user never grants the File System Access permission.** Someone who declines/never clicks "Enable automatic backups" gets no auto-backup at all (by design, not a bug) — the only safety net for them is remembering to use the manual button, prompted by the "Last full backup" row going stale. Once enabled, though, the FSA handle is reused and overwritten in place, so there's no file accumulation to worry about (unlike a plain `<a download>` approach, which was considered and rejected specifically because a page can never overwrite or delete a file it previously downloaded).
- Verified via headless preview with `showSaveFilePicker` mocked (a real native file-picker dialog can't be driven by browser automation) — the enable/write/lapsed-permission/unsupported-browser code paths were all exercised this way, but never against the real native picker UI itself.

---

## 7. Fixes made in this development thread

For a clear record of what changed and why, verified against real data rather than assumed:

1. **Fixed Deposits management UI + write-back, built from scratch** — add/edit/remove FDs directly in the app, with full sync to the real Fixed Deposits sheet. Verified against the actual uploaded workbook's bytes (column layout, buffer bounds, dedup, edit, remove, and the not-found error path all tested against real data, not just syntax-checked).
2. **`S.fixedDeposits` persistence bug** — imported FD data was silently lost on every page reload because `persist()`/`restore()`/the backup functions never included it. Fixed in all four places.
3. **`renderCapMerge()`'s pending-count bug** — the merge screen's "anything queued?" check only summed five of the eleven queues, so having *only* a Lot, Deduction, Tax Payment, Capital Gains, Tax Rules, or Fixed Deposit change pending (nothing else) wrongly showed "Nothing queued" and blocked opening the review screen entirely. Fixed to count all eleven; also fixed Budget changes never appearing in the queued-changes summary text despite counting toward the total.
4. **Page-wide horizontal scroll on mobile** — root-caused (not guessed) via a headless-browser repro at a 390px viewport. Two separate causes: `.main` (a CSS Grid item) had no `min-width:0`, so its widest descendant's content size floored the whole page's width; and several Tax/Capital-Gains tables were never wrapped in their own scroll container. Both fixed and verified across all 15 tabs with real data, with desktop layout confirmed pixel-identical to before.
5. **Backups didn't cover pending queues** — a restore gave back accurate data but an empty to-do-list for Excel, silently losing track of anything not yet synced. Fixed: all 11 queues now round-trip through both the JSON backup and the IndexedDB local-sync snapshot, verified end-to-end (export → simulated wipe → restore → confirmed both in-memory and in localStorage), with backward compatibility for older backup files confirmed not to throw.
6. **Rebranding** — renamed from "Ledger" to "Pechak" throughout (title, iOS home-screen label, mobile header, both brand marks); replaced the old abstract-square logo with a cartoon owl mark, in both Noir and Swiss color treatments, plus a matching favicon that now swaps live with the theme toggle.
7. **PWA offline-shell hardening**, ahead of Play Store packaging (see `pechak-play-store-assessment.md`):
   - Vendored SheetJS via npm/Vite (`src/xlsx-loader.js`) instead of loading it from cdnjs, upgraded it to `xlsx` 0.20.3 from the official SheetJS CDN tarball to resolve the prototype-pollution and ReDoS advisories, and self-hosted the three Google Fonts as local `woff2` files — removes two third-party runtime dependencies from the offline shell.
   - Added the manifest fields the assessment flagged as missing (`id`, `lang`, `dir`, `categories`); also fixed `start_url`, which still pointed at `mobile.html`, a file the Vite migration had already removed — this was silently breaking installed-PWA launches.
   - Rewrote `sw.js` with explicit per-asset-type caching: cache-first for immutable/static assets, network-first for the app shell, and a deliberate no-op (no `respondWith` at all) for the MFAPI/stock-price/CORS-proxy hosts, so a failed price lookup can never take down the offline shell or get silently cached.
   - Replaced the unconditional `self.skipWaiting()` with a message-triggered one: the page shows an "Update ready" banner and only tells the waiting worker to activate when the user accepts *and* no import/merge is mid-flight (a `window.__pechakBusy` flag set around `capDoMerge()` and the workbook file-import handler).
   - Verified end-to-end in a headless preview: full precache coverage of everything the shell needs on first paint, true cache interception (stale on-disk file still served from cache), and `localStorage`/IndexedDB data surviving an accepted update and reload untouched. See the "Still needs validation" list in §6 for what a real-device test should still confirm.
8. **Platform adapter layer** (`src/adapters/storageAdapter.js`, `documentAdapter.js`, `shareAdapter.js`), the assessment's step 6 pulled forward ahead of any Capacitor work (still parked). Storage (`localStorage`/IndexedDB) and file save (`capDownload`) were already centralized behind a handful of functions, so this was mostly a redirect of those functions to `window.storageAdapter`/`window.documentAdapter`; file *reads* (5 separate `<input type=file>` handlers, each rolling its own `FileReader`) were the one place genuinely consolidated, onto `documentAdapter.readAsArrayBuffer`/`readAsText`. `shareAdapter.js` exists as an empty-but-correct shell (`navigator.share` with a download fallback) — nothing in the UI calls it yet, since there was no existing share feature to migrate.
   - **Non-obvious fallout, worth remembering:** the main app script (`index.html`'s single `<script>` block) had to become `type="module"` so it could `import` the three adapter files directly — otherwise `window.storageAdapter` wouldn't exist yet by the time the script's own synchronous top-level code ran (module scripts always execute *after* the document finishes parsing, so a plain classic script calling into a separately-loaded module at its own parse-time position is a race that silently loses — it's how the theme preference briefly regressed to always resetting to "swiss" on reload during this change, since `restore()`'s `storageAdapter` call threw into an empty `catch`). Converting to a module means top-level `function`/`const` declarations are no longer implicitly on `window` — one inline `onclick="switchCapTab(...)"` string (built via `innerHTML`) needed an explicit `window.switchCapTab=switchCapTab;` to keep working, since inline event-handler attributes always evaluate in global scope.
   - Also: the theme key (`ledger_app_v7_theme_v2`) was never JSON-encoded (raw string, unlike every other stored key) — routing it through `storageAdapter` needed dedicated `getRawItem`/`setRawItem` methods so existing installs' already-stored plain-string values keep reading back correctly, instead of routing through the JSON-encoding `getItem`/`setItem` and getting `JSON.parse` failures on old data.
   - Web-only for now, by design — a future Capacitor build implements the same three method names against native storage/the Android document picker instead of rewriting call sites again.
9. **Atomic writes + previous-known-good snapshot** for the two storage locations worth protecting: the main `S` state (`localStorage` key `ledger_app_v7`/`STORE`) and the cached workbook bytes (IndexedDB `workbook` record). Both now go through `storageAdapter.setStateAtomic`/`getStateAtomic` and an updated `setWorkbookBytes`/`getWorkbookBytes`, wrapping the stored value in an envelope (`schemaVersion`, `writtenAt`, `appVersion`, a djb2 checksum over the payload/bytes) that's validated on every read. Everything else (the 11 pending-queue keys, theme, `localSync`) deliberately stays on the plain `getItem`/`setItem` path — lower value, and each already has its own re-derivable source of truth.
   - **Write pattern (localStorage):** serialize to a `__staging` key, read it back and validate the checksum, snapshot the current main value (if parseable) to a `__prev` key, *then* promote staging into the real key and delete staging. If anything throws partway through, the real key is untouched — never left holding a half-written value.
   - **Write pattern (IndexedDB):** compute the checksum before opening a transaction; within one `readwrite` transaction, copy the current record to `workbook__prev` (if itself valid), `put` the new envelope, then `get` it back and `tx.abort()` if it fails validation — IndexedDB transactions are all-or-nothing, so an abort here means neither the new write nor the `__prev` snapshot apply, leaving the previous state exactly as it was.
10. **Hardened the portable JSON backup and added an unobtrusive auto-backup**, closing the two gaps §6 used to list ("archived batches"/"workbook bytes not included in either backup mechanism") and adding real protection against browser-storage eviction while Pechak stays PWA-only:
    - **Backup format bumped 4→5**: `capStateBackupObj()` (the cheap, synchronous shape `doLocalSync()`'s IndexedDB snapshot also uses) now includes `archives:CAP_ARCH`; a new async `capFullBackupObj()` — used only by the actual JSON-export path, not by local sync, which already lives in the same IndexedDB the workbook cache and archives live in and gains nothing from re-embedding them — additionally base64-encodes the cached workbook bytes into `workbook:{name,cachedAt,bytesB64}` via two small chunked helpers (`bytesToB64`/`b64ToBytes`, chunked in 32KB slices to avoid a `String.fromCharCode(...)` call-stack blowup on a multi-MB workbook).
    - **`capParseBackupFile()` hardened**: still never requires a field to be present (old backups keep restoring exactly as before), but now rejects a backup whose `_backup.app` doesn't match this app, and type-checks every field that *is* present (arrays must be arrays, objects must be objects — and explicitly not arrays, since `typeof [] === "object"` in JS would otherwise let a wrong-typed array slip through an object check). **Bug caught during verification, not shipped**: the first pass mis-classified `subcats`/`taxRules`/`deductions`/`fxRates`/`scheduleFA` as arrays and `accounts`/`budget` as objects — backwards from their real shapes in `S`'s own default state (confirmed by reading the actual `S={...}` initializer and every default-object constant, not guessed) — which would have made every real backup fail validation. Caught by an end-to-end round-trip test through the actual UI (not a unit test in isolation) before it shipped.
    - **`capRestoreFromBackup()` restructured build-then-commit**: stages the risky async workbook-bytes decode first (throws before touching any live state on bad data), builds the full candidate field/queue set into local variables, then commits synchronously in one block, with the one remaining async step (writing decoded workbook bytes back to IndexedDB) last and non-blocking of the already-committed dashboard-data restore if it fails. Real improvement over the previous ~25 interleaved live mutations + 11 immediate per-queue writes, but explicitly *not* full cross-key atomicity (that would need a wrapping transaction across 12+ separate localStorage keys) — said so in a code comment rather than overclaiming.
    - **New `S.lastBackupAt`**, tracked through `persist()`/`restore()` exactly like `S.lastSyncedAt` already was; seeded from a restored file's own `_backup.exportedAt` on restore, so restoring a backup doesn't immediately look "overdue."
    - **Auto-backup via the File System Access API** (`showSaveFilePicker`/`FileSystemFileHandle`, Chromium-only) — see §6 for the constraints. One click ("Enable automatic backups…" in the Data tab) grants a reusable handle, persisted via three new `storageAdapter.js` methods (`setAutoBackupHandle`/`getAutoBackupHandle`/`clearAutoBackupHandle`, reusing the same IndexedDB store `localSync`/the workbook cache already share — `FileSystemFileHandle` is structured-cloneable, so it stores directly). From then on, `checkAutoBackup()` (called once at startup, gated by an in-memory flag so it can never fire twice in one session) silently overwrites that same file once 14+ days have passed since the last backup — true no-accumulation, unlike a plain `<a download>` trigger, which a page can never overwrite or delete later (considered and explicitly rejected for that reason). A lapsed/revoked permission surfaces as "Permission needs renewing" in the Data tab rather than silently retrying (the File System Access API's `requestPermission()`, unlike `queryPermission()`, needs a real user gesture, so it can't be re-prompted from a silent background check).
    - **Explicit design correction mid-task**: the original ask was a dismissible reminder banner; after discussion this became "no nagging, silent auto-backup instead" — no new fixed-position banner was added, only the passive "Last full backup"/"Auto-backup" status rows in the existing Data tab card.
    - Verified end-to-end in a headless preview: real round-trip (download → corrupt live state including workbook cache and archives → restore → confirmed byte-identical workbook, archive, and transaction recovery) through the actual restore UI, not a bypassed unit call; old format-1-shaped backups confirmed to restore without touching fields they don't include; each new validation rejection confirmed to actually throw with the right message; the enable/lapsed-permission/unsupported-browser UI states confirmed with `showSaveFilePicker` mocked (see §6 — the real native picker dialog itself couldn't be driven by browser automation).
   - **Read fallback:** if the main copy fails checksum validation, fall back to the `__prev` copy and log a `console.error` either way so a corruption event is visible, not silent.
   - **Backward compatibility:** pre-envelope legacy data (every existing install, before this shipped) has no `schemaVersion`/`checksum` fields at all — `getStateAtomic`/`getWorkbookBytes` detect this and return it as-is rather than treating "no envelope" as "corrupt", so nothing breaks for anyone upgrading. It gets wrapped in a real envelope the next time that key is written.
   - "Clear cache" (`ALL_APP_LS_KEYS()`) now also removes `STORE`'s `__prev`/`__staging` keys, and `clearWorkbookBytes()` also deletes `workbook__prev` — otherwise a reset would leave a stale backup copy behind that a corrupted-then-restored main copy could resurrect later.
   - Verified in a headless preview: normal write/read round-trip, a second write correctly snapshots the first as `__prev`, and — with the main copy's `checksum` field hand-corrupted directly in `localStorage`/IndexedDB — both `getStateAtomic` and `getWorkbookBytes` correctly detected the mismatch and returned the previous-known-good payload instead. Not yet tested against a real partial-write/corruption scenario in the wild (only simulated); see §6.
   - `APP_VERSION` in the envelope is a hardcoded string (`"1.0.0"`) mirroring `package.json`'s `"version"` by hand — nothing wires this up to the build automatically yet.
11. **Reconciliation & integrity checks, and a new Needs Attention tab** (Play Store assessment's Step 9, items 3-4 — shipped ahead of items 5-9 since they're financial-accuracy correctness gaps, not UX polish):
    - New `integrityChecks(model)`, called from inside `compute()` so `M.integrity` is populated on every recompute. Checks: `cf-recon` (the cash-flow-statement-vs-balance-sheet identity, `CF.chk`, promoted from an uncolored table row into a `fail`-severity check — a nonzero value means a real bug in cash-flow categorization); `orphan-txn-account`/`orphan-txn-holding` (transactions whose `from`/`to`/`holdName` reference an account or holding since deleted — `removeAccount()` and holding-removal both allow this by design via a confirm dialog, but `compute()`'s `if(x.to in inn)` pattern means those transactions' amounts silently stop counting toward any balance once the account is gone, so it's worth surfacing even though it's tolerated); `queue-orphan-acct`/`queue-orphan-cat`/`queue-orphan-hold` (a pending, not-yet-synced transaction or lot queue entry pointing at a since-deleted account/category/holding — catches, before the user ever opens the sync dialog, exactly the "can't find target row, fails loudly" scenario §5 already documents for sync time). Orphan/queue-orphan checks are `warn` severity, not `fail` — the app already tolerates these states by design; only `cf-recon` is a true internal-consistency failure. See §6 for checks deliberately not built.
    - Surfaced in two places, both reading `M.integrity` (no duplicate logic): a colored pass/fail box under the existing Cash Flow reconciliation row in Statements, and a new "Reconciliation & integrity" card in the Data tab (grouped with the other data-safety cards).
    - New **Needs Attention** tab (`renderNeedsAttention()`), a first-class nav destination (with a small red count badge — reused `.fab-badge`, since `.nav button` was already `position:relative` — counting `fail`-severity items only, so routine warns don't cause badge fatigue). Aggregates every `M.integrity` entry plus: over-budget categories (via a new shared `budgetOverageRows(month)` helper, factored out of `insights()`'s own inline calculation so Overview and Needs Attention can't drift apart — `renderBudget()`'s own separate, user-selectable-period table was deliberately left alone, since unifying it would have changed its own selectable-period behavior), capital-gains events excluded from computed totals, Schedule AL/FA flags, TDS-likely fixed deposits, and asset classes outside target allocation drift — each of the last five reuses an existing computation (`capGainsBreakdown()`, `scheduleFACandidates()`, `fixedDepositsBreakdown()`, `curMixVals()`/`pctOf()`) rather than reimplementing it. `insights()` itself (Overview) was deliberately left alone — it's trend/informational commentary, not action items.
    - Verified in a headless preview: forced both a genuine orphan-account and a queue-orphan scenario through the real UI (added an account, added a transaction against it, deleted the account, confirmed both checks fired with the correct count/name in Statements, Data tab, and Needs Attention, confirmed the badge stayed at 0 since these are `warn` not `fail`, then cleaned up); confirmed all other views (Overview, Budget, Ratios, Tax Summary, Investments) still render with no console errors.
12. **Remaining UX priorities shipped as independent releases (`1.1.0`–`1.5.0`)** — first added a dependency-free production-browser golden suite with frozen finance/tax/import/backup/queue/workbook-XML expectations, then released: clearer data-safety/workbook journeys; shared calculation explanations and provenance; transaction templates, recent choices, progressive forms, effect previews, drafts, and duplicate-and-edit; workbook source/output fingerprints, compatible-drift confirmation, structural blocking, bounded update receipts and downloadable JSON reports; and the approved five-destination mobile navigation with leaf-route hashes. A follow-up fixed horizontally scrolling statement tables by wrapping/capping actual sticky label cells and excluding full-width `colspan` section rows from stickiness. Every release passed the unchanged golden baseline. Tax-rule update review was explicitly excluded.
13. **Added the tax-rule publishing workflow (assessment Step 10)** — `tax-rules/`
    now holds closed JSON Schemas for rule packs, detached signatures, and the
    release index plus an immutable FY 2026-27 v1 pack whose `rules` object mirrors
    `TAX_RULES_DEFAULT`. Node ESM tools under `scripts/tax-rules/` implement RFC
    8785 canonicalization, strict schema/semantic and app-compatibility checks,
    Ed25519 sign/verify, field-level diff, immutable-release checks, and promotion
    that verifies artifacts before atomically updating the index last. Signing
    never edits the index and private PKCS#8 keys are refused if their output path
    is inside the repository. Synthetic tax goldens now exercise the real browser
    functions for slab boundaries, 87A relief, standard deductions, cess,
    surcharge and its special-income cap, 111A/112A/other gains, 234B/234C,
    Schedule AL, and normal/senior FD thresholds; negative Node tests cover
    malformed/incompatible packs, unknown fields, mutation, wrong/missing
    signatures, and unsafe promotion. Operator sequence and key custody/rotation
    are documented in `tax-rules/README.md`.
    - Scope remains publishing-only. Runtime fetch/banner/review/apply, override
      conflicts, local cache/history/rollback, and richer workbook capital-gains
      categories remain out of scope.
    - The pack intentionally preserves the production engine's one shared
      `otherLtRate` for supported non-111A/112A long-term gains rather than
      inventing fields the app cannot consume.
14. **Per-class Capital Gains "other" rates, safe workbook edit write-back, and reclassify UI** — resuming and closing out a previously-interrupted change: `S.taxRules.cg` gained a `classes` object (`foreignUnlisted`, `debtPre2023`, `goldOther`, `sgb`, `realEstate`), each with its own `ltMonths`/`ltRate`, replacing the single shared `otherLtRate`/`otherLtMonths` model the rest of this doc (and `tax-rules/README.md`'s published pack) still correctly describes as the *publishing-workflow* schema — the runtime app's own state now migrates beyond that immutable schema. `normalizeTaxRules()` (`src/domain/tax.mjs`) populates `.classes` on load, defaulting each key from the legacy scalar fields but preserving any existing per-key override, so older saved state upgrades without data loss.
    - The Tax Rules Settings UI's Capital Gains card was rewritten from three flat legacy fields to a 5-row per-class table (months/rate per asset class); the save handler builds `cg.classes` from it while still writing `otherLtMonths`/`otherLtRate`/`sgbLtMonths` as legacy mirrors for backward compatibility. **Bug caught and fixed during this work**: the save handler previously rebuilt `cg` from scratch without `.classes` at all, silently wiping every per-class override on each save — now included explicitly.
    - Workbook write-back (`trApplyQueue`'s Capital Gains section) now writes each class's own `ltMonths`/`ltRate` to its own sheet row (35/37/38/39/40) via `cgClassRule()`, instead of broadcasting one flat "other" value to all of them.
    - The Capital Gains tab's "Bucket totals" table gained a per-class breakdown (gain/tax/rate per class, from the already-computed `cg.otherByClass`), and a shared `CG_CLASS_LABELS` constant keeps naming consistent between Settings and the Capital Gains tab.
    - Each CG sale event now carries `sheetRowId`/`sheetMatchKey` once it's been merged into a workbook, so reclassifying an event's asset class (`sheetClassSelectHtml`/`setEventSheetClass`) and merging again updates that same sheet row instead of appending a duplicate — `cgQueueEdit`/`cgFindEditRow`/`cgFindRowsByKey` try the stored row id first (guarded against workbook drift by also matching the natural key), fall back to natural-key matching if the id is stale, and throw a clear, non-mutating error rather than silently duplicating a row if the match is ambiguous or the row is gone.
    - **Test coverage added to close the gap this feature previously shipped without**: a unit test for the `classes` migration (legacy-field fallback and override preservation), a new golden-suite scenario (`__pechakTestApi.cgReclassifyRoundTrip()`) that adds a CG sale via merge, reclassifies it, merges again, and asserts the row count stays at one and the sheet cell reflects the new class, and a new `tax-goldens.json` fixture case with hand-computed expected gains/rates/taxes for four divergent per-class "other" rates. (Note for future readers of the golden suite: this new scenario performs two sequential `capReviewMerge`/confirm cycles in one page session — it must re-inject the `#cm_result` stub div before *each* merge, not just the first, since the page's own re-render after a successful merge removes it; and it must run after the existing single-merge receipt/backup assertions, not before, since its own merges create additional receipts that would otherwise change those counts.)

---

## 8. Technical appendix

**Platform adapters** (`src/adapters/`): `storageAdapter.js`, `documentAdapter.js`, `shareAdapter.js` — see §7 item 8. Everything below still describes the same underlying storage; it's now reached through these adapters rather than raw browser APIs.

**Storage layout:**
- `localStorage` key `ledger_app_v7` (aliased internally as `STORE`) — the main `S` state object.
- 12 separate `localStorage` keys, one per pending queue (e.g. `fd_queue_v1`).
- `localStorage` key for the theme preference — deliberately outside the "clear cache" / backup scope.
- `IndexedDB` database `ledger_wb_cache` — the cached raw workbook bytes, stored as a checksummed live/previous-known-good pair (`workbook`/`workbook__prev`); a File System Access API auto-backup handle; and the local-sync snapshot (same-device safety copy, mirrored to a `localStorage` key too, as a fallback if IndexedDB itself is blocked).

**Regression gate:** `npm test` now runs four explicit layers: Node built-in unit
tests over the production seams in `src/domain/` and the storage adapter; tax-rule
release tests; the existing production-build CDP workbook golden suite; and
Playwright DOM journeys for onboarding, transaction persistence, navigation,
workbook import/update, and portable backup restore. The aggregate builds once
before both preview suites. `tests/golden/baseline.json` still freezes the reviewed
finance, tax, import, backup, all-queue merge, and workbook XML results and was not
regenerated for this test-layer work. Run `npm run test:golden:update` only after an
intentional reviewed result change, never to make a UX-only test pass. Browser
requirements and per-layer commands are documented in `tests/README.md`.

**Fixed Deposits sheet layout** (verified directly against a real workbook, not assumed):
| Column | Field | Notes |
|---|---|---|
| A | FD ID | User's own free-text label; app never reads or writes it |
| B | Bank / Account | |
| C | Principal ₹ | |
| D | Rate % | Stored as a fraction internally (7% → `0.07`) |
| E | Comp/yr | |
| F | Start | |
| G | Maturity | |
| H | Payout | Cumulative / Payout |
| I | Status | |
| J | Value @ As-of ₹ | Computed by the sheet's own formula; never written |
| K | Interest this FY ₹ | Computed; has defined name `FD_InterestFY`; never written |
| L | TDS paid ₹ | The one input column with its own defined name, `FD_TDSpaid` |

Buffer: rows 5–29 (25 slots), TOTAL row at 31.

**Merge chain order:** Categories → Accounts → Holdings → Investment Lots → Budget → Deductions → Tax Payments → Capital Gains → Tax Rules → Fixed Deposits → Model Settings.

**Theme tokens driving the logo/favicon:** `--logo-bg`, `--logo-body`, `--logo-signal` — Noir: `#0a0a0b` / `#f2f2ef` / `#d6524f`. Swiss: `#3A63F9` / `#ffffff` / `#EB1000`.
