# Automated test layers

All fixtures are synthetic. No command updates reviewed expectations implicitly.

## Commands

- `npm run test:unit` — Node `node:test` coverage for the extracted production
  ledger, tax, backup, migration, and storage-envelope seams, plus tax-rule release
  tests.
- `npm run test:integration` — production build followed by the CDP workbook
  golden suite.
- `npm run test:journeys` — production build followed by Playwright DOM journeys.
- `npm test` — unit tests, one production build, then both preview-based suites.
- `npm run test:golden:update` — the only explicit golden update command.

Playwright and the golden runner use an installed Microsoft Edge or Google Chrome
on Windows when available, so downloading Playwright browser binaries is not
required. Set `PECHAK_BROWSER_PATH` to another compatible Chromium executable if
neither browser is in its standard install location. Native File System Access
picker automation and Android instrumented tests are intentionally out of scope.

## Unit and round-trip coverage

`tests/unit/` calls production exports from `src/domain/` and
`src/adapters/storageAdapter.js`. It covers ledger balances, cash flow and
validation; tax slab/rebate/HRA boundaries and legacy rule migration; valid,
legacy and corrupt storage envelopes with previous-known-good fallback; and a
full portable-backup export → parse → restore-plan round trip. The backup tests
include every state field, all 12 queues, archives, workbook bytes, old/new
formats, invalid inputs, and no-mutation failure behavior.

## Workbook integration

The existing golden runner opens the production `dist` build in Edge/Chrome through
the browser DevTools protocol and compares it with
`tests/golden/baseline.json`.

Coverage:

- reviewed synthetic tax fixtures driven through the production browser engine:
  slab boundaries, 87A rebate/marginal relief, standard deductions, cess,
  surcharge thresholds/cap, 111A/112A/other gains, advance-tax checkpoints,
  Schedule AL, and normal/senior FD thresholds;
- representative synthetic ledger finance and tax totals;
- a 5,000-transaction ledger;
- bundled-template and generated populated-workbook imports;
- all 12 pending queue families through backup serialization and one workbook merge;
- malformed workbook rejection;
- backup format/count round trip;
- calculation provenance on Overview, Statements, Tax, Investments, Fixed
  Deposits, and Budget;
- transaction templates, recent choices, draft restore, progressive fields, and
  effect previews;
- compatible workbook-drift confirmation, source/output fingerprints, and
  bounded merge receipts;
- the five-destination mobile navigation, leaf-route deep links, and 48px targets;
- SHA-256 signatures of unzipped workbook and worksheet XML, excluding the
  timestamped Change Log sheet.

The source fixture is `tests/fixtures/populated-state.json`. The populated workbook
is generated in memory from `public/template.xlsx`; no personal workbook or
financial data is stored in the repository.

`npm run tax-rules:test` separately covers closed JSON schemas, semantic
validation, incompatible versions, immutable release safeguards, RFC 8785
canonicalization with Ed25519 signing/verification, wrong/missing keys and
signatures, mutation, field-level diffs, and unsafe promotion. Normal `npm test`
runs those tests before this browser suite.

Use `npm run test:golden:update` only after reviewing an intentional finance,
tax, import, queue, backup, or workbook-output change. Never update the golden file
merely to make a failing test pass.

## DOM journeys

`tests/journeys/primary-flows.spec.mjs` uses visible controls and accessible
selectors for fresh onboarding, add/edit/reload persistence, primary navigation,
synthetic workbook import and update/download, and portable backup
export/restore. The localhost-only golden fixture bridge seeds state where needed;
asserted user actions still go through the real DOM, persistence, file input, and
download paths.
