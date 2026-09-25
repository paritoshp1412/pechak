# Pechak — storage baseline (as of Pechak 1.5.0)

Generated from the current Vite app in `index.html` and verified by the production-browser golden suite.

## localStorage

| Key (literal string) | Variable name | Shape | What it holds | Criticality |
|---|---|---|---|---|
| `ledger_app_v7` | `STORE` | Checksummed JSON envelope | The main app state: `txns, holdings, accounts, cats, subcats, budget, budgetMonths, targetMix, plan, taxRules, taxRulesEditedAt, deductions, capGainsEvents, fxRates, taxPayments, taxSettings, scheduleFA, fixedDeposits, modelSettings, transactionTemplates, txnDraft, workbookBaselineFingerprint, workbookReceipts` (latest 20), `onboarded, wizardOnly, lastSyncedAt, lastBackupAt` | **Critical** — this is the core dataset |
| `ledger_app_v7_localsync` | `LOCAL_SYNC_LS_KEY` | JSON object | Mirror of the IndexedDB `localSync` record (see below) — a localStorage backup copy of the same sync-state object | Critical (duplicate of an IndexedDB value) |
| `ledger_app_v7_theme_v2` | (inline, `STORE+"_theme_v2"`) | string (`"noir"` or `"swiss"`) | UI theme preference | Cosmetic — safe to lose |
| `cap_queue_v1` | `CAP_K_QUEUE` | JSON array | Quick Add transaction entries queued for merge into the workbook, not yet reflected in `S.txns` | **Critical** — unmerged user entries |
| `cap_archives_v1` | `CAP_K_ARCH` | JSON object | Archived/merged Quick Add entries | Important — historical record |
| `cap_meta_v1` | `CAP_K_META` | JSON object | Metadata about the Quick Add queue/merge process | Important |
| `cat_queue_v1` | `CAT_K_QUEUE` | JSON array | Pending category additions/edits queued for merge | Critical while unmerged |
| `acct_queue_v1` | `ACCT_K_QUEUE` | JSON array | Pending account additions/edits queued for merge | Critical while unmerged |
| `hold_queue_v1` | `HOLD_K_QUEUE` | JSON array | Pending holdings changes queued for merge | Critical while unmerged |
| `bud_queue_v1` | `BUD_K_QUEUE` | JSON array | Pending budget changes queued for merge | Critical while unmerged |
| `lot_queue_v1` | `LOT_K_QUEUE` | JSON array | Pending tax-lot changes queued for merge | Critical while unmerged |
| `ded_queue_v1` | `DED_K_QUEUE` | JSON array | Pending deduction entries queued for merge | Critical while unmerged |
| `pay_queue_v1` | `PAY_K_QUEUE` | JSON array | Pending tax payment entries queued for merge | Critical while unmerged |
| `cg_queue_v1` | `CG_K_QUEUE` | JSON array | Pending capital-gains events queued for merge | Critical while unmerged |
| `tr_queue_v1` | `TR_K_QUEUE` | JSON array | Pending Tax Rules saves queued for workbook update | Critical while unmerged |
| `fd_queue_v1` | `FD_K_QUEUE` | JSON array | Pending fixed-deposit entries queued for merge | Critical while unmerged |
| `ms_queue_v1` | `MS_K_QUEUE` | JSON array | Pending model-settings changes queued for merge | Important |

**Bulk-clear helper:** `ALL_APP_LS_KEYS()` enumerates every key above except the theme key — this is the canonical list the app itself uses for a full reset.

**Write-failure handling:** core state goes through `storageAdapter.setStateAtomic()`, while queue writes use the adapter's guarded `setItem()` path. Both raise `#storageWarnBanner` after a failed write. Preserve equivalent "write actually failed, don't just toast and move on" behavior in any Android storage adapter.

## IndexedDB

**Database:** `ledger_wb_cache` (version 1)
**Object store:** `kv` (generic key/value store, not per-record typed)

| Record key | Shape | What it holds |
|---|---|---|
| `workbook` (`WB_KEY`) | Checksummed envelope containing `{ bytes: Uint8Array, name, cachedAt, writtenAt, appVersion }` | Cached raw `.xlsx` bytes used for workbook updates — the workbook baseline |
| `workbook__prev` (`WB_KEY_PREV`) | Same as `workbook` | Previous-known-good workbook fallback |
| `localSync` (`LOCAL_SYNC_KEY`) | object | Same-device safety-copy object, also mirrored into localStorage under `ledger_app_v7_localsync` |
| `autoBackupHandle` (`AUTO_BACKUP_HANDLE_KEY`) | `FileSystemFileHandle` | User-granted Chromium auto-backup destination |

"Start fresh" deletes the live/previous workbook records and `localSync` together. Any Android migration/reset logic should preserve that reset behavior.

## Open questions to verify against the running app (not fully resolved from static reading)

- ~~Confirm whether any of the queue arrays can legitimately be empty vs. absent...~~ **Resolved:** traced `capLoad` → `storageAdapter.getItem(key, fallback)` (`src/adapters/storageAdapter.js`): a missing key returns `null` from `localStorage.getItem`, which is falsy, so it returns `fallback` (`[]`/`{}`); a present-but-empty-array value (`"[]"`) is a truthy string, parses to `[]`, and returns the identical shape. There is no third distinguishable state and no code path anywhere treats "key never existed" differently from "key holds an empty array" — both are, by construction, the same value once loaded. Not a bug; nothing to fix.
