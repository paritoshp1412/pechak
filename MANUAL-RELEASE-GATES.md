# Manual release gates

These checks cannot be reliably driven by browser automation (the CDP/Playwright
golden and journey suites) because they depend on real OS-level conditions —
actual airplane mode, a real native file-picker dialog, or genuinely exhausted
device storage — that a scripted browser session cannot faithfully simulate.
Per the P1 plan, they are recorded here as explicit **manual gates to run on a
real device before each Play Store submission**, rather than claimed as passing
because an automated proxy for them passed.

Do not check a box based on the automated suites alone. Each item below already
notes what automation *did* verify (so you're not re-testing everything from
scratch) and exactly what's left that only a real device/browser can confirm.

## 1. Real-device offline test

- **Automated coverage already in place:** a headless preview confirmed full
  precache coverage of every asset the shell needs on first paint, and true
  cache interception (a stale on-disk file is still served from cache, proving
  the service worker never even asks the network for a cache-first hit).
- **What's left, manual only:** install the PWA on a real device, force-stop
  connectivity (real airplane mode, not devtools' network throttling), and
  relaunch. Confirm the app opens and is usable offline, and that `localStorage`
  /IndexedDB data survives the offline relaunch untouched.
- **Why automation can't do this:** the CDP/Playwright test harness ties the
  browser tab's lifecycle to its own dev-server health check, so it can't
  survive a literal loss of network connectivity the way a real installed PWA
  needs to.

## 2. Real File System Access API picker test (auto-backup)

- **Automated coverage already in place:** the enable/write/lapsed-permission/
  unsupported-browser auto-backup logic was exercised end-to-end in a headless
  preview with `showSaveFilePicker` mocked — confirms the code paths are real
  and correct.
- **What's left, manual only:** on a real Chromium-based browser, click "Enable
  automatic backups…", complete the actual native save-file picker dialog, and
  confirm: the one-time permission grant persists across a reload; the same
  file is silently overwritten (not duplicated) after the 14+ day interval
  elapses; and revoking the permission via the browser's own site-settings UI
  correctly surfaces as "Permission needs renewing" rather than silently
  failing.
- **Why automation can't do this:** `showSaveFilePicker` is a native OS dialog;
  no browser automation tool can drive or complete it, so it must always be
  mocked in scripted tests.

## 3. Real-device storage-failure test

- **Automated coverage already in place:** the atomic-write/previous-known-good
  fallback (Step 7) was verified against hand-simulated corruption (the
  `checksum` field flipped directly in devtools) for both `localStorage` and
  IndexedDB, and both correctly fell back to the previous-known-good copy.
- **What's left, manual only:** on a real device, genuinely exhaust available
  storage (or otherwise force a real quota/write failure, e.g. via OS-level
  storage limits or a full disk) mid-write and confirm the app surfaces a
  visible, non-silent failure and that no partially-written state corrupts the
  live data — a real interrupted write, not a simulated corrupt value.
- **Why automation can't do this:** genuinely exhausting device/browser storage
  quota (rather than editing an already-written value) isn't something a
  scripted browser session can trigger deterministically or safely repeat.

## Status

All three gates above are **not yet run**. None should be treated as passed
until executed manually on a real device/browser and this file updated with
the date, device/browser, and outcome.
