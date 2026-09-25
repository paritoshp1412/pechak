# Pechak on Google Play: possibilities, limitations, and recommended route

## Executive recommendation

Build Pechak as a **Capacitor Android app with the web assets bundled inside the app**, while keeping GitHub Pages as the browser version and documentation/privacy-policy host.

This preserves almost all of the existing HTML, CSS, JavaScript, tax logic, and workbook merge code. It does **not** require a server, user accounts, cloud database, analytics, or recurring backend cost. Capacitor provides the Android shell needed for reliable file import/export, app-private persistence, sharing, lifecycle handling, and future security features.

Use a **Trusted Web Activity (TWA)** only if the immediate goal is the fastest possible Play Store proof of concept and its limitations are accepted. A native rewrite is not justified at this stage.

The recommended path is:

1. Harden the web app and split platform-sensitive operations behind adapters.
2. Bundle it in Capacitor.
3. Store live state and cached workbook bytes locally.
4. Use Android's system document picker for `.xlsx`, JSON, and CSV import/export.
5. Release through internal testing, then a closed test.
6. Harden privacy, backup, security, and compatibility before a public release.

---

## 1. What you already have

Pechak is much closer to an Android app than a normal desktop website:

- Mobile-responsive layout with safe-area handling.
- Web app manifest reference.
- Service-worker registration.
- Home-screen metadata and icons.
- Local-first operation.
- No login or backend dependency.
- User-controlled workbook and JSON transfer.
- Mature calculation and workbook-sync logic in JavaScript.

The current app uses:

- `localStorage` for parsed application state and pending queues.
- IndexedDB for workbook bytes and a local snapshot.
- `<input type="file">` and `FileReader` for workbook, JSON, and CSV imports.
- generated `Blob` downloads for workbook and backup exports.
- `CompressionStream` / `DecompressionStream` for workbook ZIP processing.
- a CDN-hosted SheetJS script and Google Fonts.
- external requests to MFAPI and a stock-price worker.

The app can therefore be packaged without moving finance data to a backend. However, packaging alone does not make browser storage durable, encrypted, portable, or recoverable.

The supplied `manifest.json` and `sw.js` confirm that the app has the basic PWA structure, but the service worker needs hardening before a TWA or public PWA release. See [§3A](#3a-review-of-the-current-manifest-and-service-worker).

---

## 2. The three realistic options

| Criterion | Trusted Web Activity | Capacitor hybrid | Native rewrite |
|---|---|---|---|
| Reuse existing code | Excellent | Excellent | Poor |
| Initial complexity | Low | Medium | Very high |
| Offline control | Depends on service worker and cached web origin | Strong; app assets are bundled | Strong |
| Workbook open/save | Browser-dependent | Reliable via Android document APIs | Reliable |
| Local-data control | Browser-origin storage | App-private storage plus native files | Full native control |
| Security hardening | Limited by browser model | Good | Best potential |
| Native features | Limited | Plugins/custom bridges | Full |
| Web updates without Play release | Yes | Only if loading hosted code; not recommended for core app | No |
| Play-review risk | Acceptable if high-quality, but can look like a website wrapper | Lower if the app is polished and integrated | Lowest wrapper risk |
| Maintenance | Web deployment plus Android wrapper | Shared web code plus small Android project | Two substantially different products |
| Fit for Pechak | Fast prototype | **Best overall fit** | Not currently justified |

### Option A: Trusted Web Activity

A TWA launches the hosted PWA fullscreen using a supported Android browser. It is not an embedded copy of the site.

**Advantages**

- Small Android project.
- Almost no changes to the application code.
- GitHub Pages remains the live runtime.
- Web deployments update the Play-installed experience immediately.
- Existing origin-scoped browser data may remain available because the TWA uses the browser's web storage for the same origin.

**Limitations**

- The Android host cannot directly access the page's cookies, `localStorage`, or other web state.
- Workbook import/export remains dependent on browser download and file-picker behavior.
- Offline use depends completely on a correct service worker and cached dependencies.
- A service-worker or hosted deployment bug affects installed users immediately.
- Storage remains attached to the web origin/browser rather than the Android app.
- Browser data clearing or storage eviction can remove the app's only live state.
- You have limited ability to add encrypted app storage, biometric locking, native save flows, or robust lifecycle recovery.
- TWA verification requires Digital Asset Links. The file must be served at:
  `https://<origin>/.well-known/assetlinks.json`.
- A GitHub **project Pages** URL can be awkward because the site lives under a path while Digital Asset Links are origin-rooted. A custom domain, or full control of the corresponding `username.github.io` root, is preferable.
- If asset verification fails, the experience falls back to a Custom Tab with browser chrome.

**Best use**

Use TWA for a quick feasibility build or a very small trusted group when the current browser behavior is already satisfactory. Do not treat it as the strongest public-product architecture for Pechak's sensitive local data and workbook-heavy workflow.

### Option B: Capacitor

Capacitor packages the web app in an Android application and exposes native APIs to JavaScript.

**Advantages**

- Reuses the finance engine and UI.
- Core HTML, CSS, JS, icons, and `template.xlsx` can be bundled, so the app starts offline.
- App-private storage is separate from Chrome browsing data.
- Android system file pickers can open and create documents without broad storage permission.
- Exported workbooks can be saved through "Save as" or shared to Drive, Files, email, or another app.
- Native adapters can provide explicit errors rather than relying on browser download behavior.
- Future biometric lock, screen-capture protection, encrypted files, notifications, and Android backup rules are possible.
- The same web code can still run on GitHub Pages.

**Limitations**

- Requires an Android/Gradle project and Play release maintenance.
- The bundled app has a different origin/storage container from the GitHub Pages site. Existing web data will not automatically appear in the Android app.
- Platform-specific adapters and migration paths must be designed.
- App updates require Play submission when bundled assets change.
- Android WebView compatibility must be tested for compression APIs and large workbook operations.
- Native plugins and their data handling become part of the policy/security surface.

**Best use**

This is the best balance for Pechak: one web-first product, no backend, and native integration only where file handling, storage, security, or lifecycle reliability requires it.

### Option C: native rewrite

A Kotlin/Jetpack Compose rewrite would reproduce the UI, calculations, storage, workbook parser/merger, queues, tax screens, and reports natively.

**Advantages**

- Maximum Android control and native UX.
- Strongest access to platform security and performance primitives.
- No WebView runtime dependency.

**Limitations**

- Very high effort and regression risk.
- The mature tax and workbook logic would need to be ported and revalidated.
- Browser and Android implementations would diverge.
- Every future feature would require maintaining two codebases or abandoning the web version.

**When it becomes justified**

Only reconsider a rewrite if Pechak later depends on extensive background work, deep OS integrations, large-scale performance beyond WebView limits, or a native interaction model that a hybrid app cannot deliver.

---

## 3. Recommended architecture

### Keep one product core

Refactor the single HTML file into buildable web assets over time, but do not rewrite the business logic merely to enter the Play Store.

Use platform adapters:

```text
Pechak UI and finance/workbook engine
        |
        +-- Storage adapter
        |     Web: localStorage + IndexedDB
        |     Android: app-private file/database
        |
        +-- Document adapter
        |     Web: file input + Blob download
        |     Android: system Open / Create Document intents
        |
        +-- Share adapter
        |     Web: download / Web Share where available
        |     Android: native share sheet
        |
        +-- Network adapter
              Optional price queries only
```

### Bundle the runtime

For the Android build, bundle:

- application HTML, CSS, and JavaScript;
- SheetJS rather than loading it from a CDN;
- fonts or local/system-font fallbacks;
- `template.xlsx`;
- icons and splash assets.

This makes the finance app and workbook engine independent of GitHub Pages availability. Optional price lookup can remain online-only and fail visibly without affecting local records.

Do not make the Android app load its core code from the live GitHub site. Doing so gives up much of Capacitor's offline/reliability benefit and makes a bad web deployment an immediate mobile incident.

### Use a local-only data model deliberately

No cloud database is needed. Separate the data into four categories:

1. **Operational state** — transactions, holdings, tax rules, queues, and preferences.
2. **Workbook baseline** — the cached `.xlsx` bytes used for future merge/export.
3. **Portable backup** — a user-created JSON or encrypted backup file.
4. **Exported documents** — workbooks and CSV/JSON files saved where the user chooses.

Recommended Android persistence:

- Use app-private files or SQLite for operational state and workbook bytes.
- Write state atomically: write a new file, validate it, then replace the old file.
- Keep a previous-known-good local snapshot.
- Do not use Android cache directories for the only copy of valuable data.
- Use Android's Storage Access Framework for user-selected import/export locations.
- Continue to offer visible manual backup and restore.
- Decide explicitly whether Android system backup is allowed.

Android Auto Backup can upload eligible app data to the user's Google Drive. It is free and protected by the user's Google account; newer Android versions can require client-side encryption. However, it changes the literal meaning of "data never leaves the device." Pechak should therefore choose and disclose one of these policies:

- **Strict device-only:** disable Android cloud backup and rely on user-created files.
- **User-account device backup:** allow only carefully selected encrypted state, clearly disclosed.
- **Device-to-device only:** exclude cloud backup while permitting supported local transfer, if the chosen Android backup rules can enforce the desired behavior.

For Pechak's stated trust model, strict device-only plus prominent manual backup is the simplest promise to explain. It also means uninstalling the app or losing the device can permanently lose unsaved data, so this warning must be explicit.

### Migration from the website

The GitHub Pages app and Capacitor app will not share storage automatically.

Provide a one-time migration:

1. Export a Pechak JSON backup from the website.
2. Import it into the Android app.
3. Import or restore the workbook baseline separately, because current JSON backups do not include cached raw workbook bytes.
4. Validate counts, totals, queue contents, and workbook availability before declaring migration complete.

An improved portable backup format could optionally include both structured state and workbook bytes in a ZIP container. That remains local and user-controlled, but raises backup size and compatibility considerations.

### 3A. Review of the current manifest and service worker

#### `manifest.json`

The manifest has the important baseline fields:

- name and short name;
- relative `start_url` and matching scope;
- standalone display;
- portrait orientation;
- theme/background colors;
- regular and maskable 192px/512px icons.

Recommended additions:

- a stable `id`, such as `"/pechak/"` or the final deployed path;
- `lang: "en-IN"`;
- `dir: "ltr"`;
- `categories: ["finance", "productivity"]`;
- optional screenshots for richer install surfaces.

The relative start URL and scope are appropriate for GitHub project Pages. They do not solve TWA's Digital Asset Links requirement, which still needs `/.well-known/assetlinks.json` at the origin root.

#### `sw.js`

The current service worker is usable for a private prototype but has four important limitations:

1. **A failed CDN/font request can undermine the whole install cache.**  
   All local assets and third-party URLs are passed to one `cache.addAll()`. A single failed or opaque third-party response can reject the batch; the error is then swallowed, allowing installation to appear successful without a dependable offline shell.

2. **It is cache-first forever for matching entries.**  
   Cached app-shell files are never revalidated during normal fetches. Updates depend on the browser noticing a changed `sw.js`, successfully installing it, and the cache contents being replaced or the cache name being bumped.

3. **There is no update notification UX.**  
   `skipWaiting()` and `clients.claim()` activate the new worker automatically, but the open page is not told that newer app assets are ready. A user can continue looking at an older loaded document until a later navigation/reload.

4. **The "network fallback" does not runtime-cache new responses.**  
   For an uncached URL, the code fetches it but never stores the response. The `catch(() => cached)` fallback returns the same missing value that already caused the network branch, so it provides no real offline fallback for previously fetched non-shell resources.

Recommended PWA changes:

- self-host SheetJS and fonts;
- precache only same-origin, versioned critical assets;
- fail the service-worker install if a critical local asset cannot be cached;
- use explicit strategies:
  - cache-first for immutable versioned assets;
  - network-first or stale-while-revalidate for `mobile.html`;
  - network-only with visible errors for optional market-price requests;
- remove unconditional `skipWaiting()`;
- detect a waiting worker in the app, show "Update ready", and activate/reload only after the user accepts and no import/merge operation is active;
- retain old cache cleanup on activation;
- add an offline navigation fallback;
- show the running application/version and last update date.

These service-worker changes apply to the hosted PWA/TWA. A bundled Capacitor build should not rely on this service worker for its app shell.

### 3B. Application updates and centrally controlled tax rules

Treat **application code** and **tax-rule data** as two separate update channels.

#### Application code: Google Play channel

For the recommended bundled Capacitor app, HTML/CSS/JavaScript changes are part of the Android app and should ship through Google Play.

Users can receive updates in three ways:

- Google Play's normal auto-update behavior;
- Play Store update notifications;
- an in-app prompt using the Play Core In-App Updates API.

Use:

- a **flexible update** for normal releases: download in the background, then show "Restart to update";
- an **immediate update** only when continuing with the old version is unsafe, incompatible, or produces materially wrong results.

Do not force every update. Preserve local state before beginning the update flow and run storage-schema migrations after restart.

The app must not download replacement Android binaries itself. Also avoid using remotely hosted JavaScript as a way to bypass Play review. Core executable code should remain in the signed Play-delivered bundle.

#### Tax rules: signed static-data channel

Tax tables are configuration data, not executable code. They can be centrally published without operating a database.

Host versioned JSON files on GitHub Pages or another static HTTPS host:

```text
/tax-rules/index.json
/tax-rules/in/fy-2025-26/v1.json
/tax-rules/in/fy-2025-26/v2.json
/tax-rules/in/fy-2026-27/v1.json
```

Each rule pack should include:

```json
{
  "schemaVersion": 1,
  "rulePackVersion": "in-fy2026-27-v1",
  "jurisdiction": "IN",
  "financialYear": "2026-27",
  "assessmentYear": "2027-28",
  "publishedAt": "2026-09-24T00:00:00Z",
  "effectiveFrom": "2026-04-01",
  "minimumAppVersion": "1.2.0",
  "status": "final",
  "sourceUrls": [],
  "summary": "Initial FY 2026-27 rules",
  "rules": {}
}
```

Recommended behavior:

1. On app launch, and no more than once per chosen interval, fetch the small index file.
2. Compare its rule-pack version with the locally installed version.
3. If newer, show an in-app banner: **"Updated tax rules are available."**
4. Download and validate the candidate pack.
5. Show a human-readable difference: changed slabs, thresholds, rates, dates, and source links.
6. Let the user apply it to the relevant FY.
7. Keep the prior version for rollback.
8. Record the applied rule-pack version with calculations and exports.

Do **not** silently overwrite local tax rules:

- statutory defaults can update centrally;
- user overrides must remain distinguishable from defaults;
- if the user customized a field, show the conflict and ask whether to retain the override or accept the new statutory value;
- historical financial years must remain pinned to their historical rule packs;
- a new rule pack for one FY must not mutate another FY.

For stronger supply-chain protection, sign each canonical JSON rule pack with a release key and embed only the verification public key in the app. The app should reject invalid signatures, unsupported schema versions, impossible dates/rates, and packs requiring a newer app version. HTTPS alone protects transport; a content signature also protects against an accidentally or maliciously altered static host.

This central check does not upload the user's ledger, workbook, tax values, or holdings. The host will still receive ordinary request metadata such as IP address, timestamp, and user agent. State that accurately in the privacy policy.

#### Notifications while the app is closed

A static GitHub Pages feed cannot push an Android notification by itself.

There are three choices:

- **Recommended:** check on app launch/resume and show an in-app banner. Tax rules are rarely so urgent that background push is necessary.
- **Backend-free background check:** schedule Android WorkManager to periodically check the static index and raise a local notification. Android controls the timing, so delivery is not immediate or guaranteed.
- **True push notification:** use Firebase Cloud Messaging or another push service. This introduces a service dependency, device tokens, additional privacy/Data Safety disclosures, and some operational complexity, even if there is still no finance database.

For Pechak, launch/resume checks plus optional periodic WorkManager checks preserve the no-backend model and are sufficient.

---

## 4. Existing code changes likely required

### Launch blockers

1. **Platform adapter layer**
   - Replace direct file/download calls with web and Android implementations.
   - Route persistence through one storage interface.

2. **Reliable Android open/save**
   - Open `.xlsx`, `.json`, and `.csv` via Android's system document picker.
   - Save `.xlsx` and backup files through the system "Create document" UI.
   - Share generated files through Android's share sheet.
   - Avoid broad storage permissions.

3. **Bundle critical dependencies**
   - Remove runtime dependence on the SheetJS CDN.
   - Bundle or replace Google-hosted fonts.
   - Bundle `template.xlsx`.

4. **Native storage migration**
   - Move the authoritative Android copy away from browser-only `localStorage`.
   - Preserve queue semantics and workbook bytes.
   - Add schema/version migration for future releases.

5. **Service-worker gating**
   - Keep the service worker for the hosted PWA.
   - Do not rely on it inside the bundled Android runtime; gate registration by platform if needed.

6. **Error and lifecycle handling**
   - Make writes transactional.
   - Handle Android process death while a file picker is open.
   - Recover from interrupted import/export.
   - Show actionable errors when a document provider revokes access.

### Important public-launch hardening

- Optional app lock using device credentials/biometrics.
- Disable screenshots on sensitive screens if desired, with a clear UX trade-off.
- Encrypt authoritative local files using a key protected by Android Keystore if the threat model warrants it.
- Add an automatic local previous-version snapshot.
- Add a backup-health reminder that verifies a recent portable backup exists.
- Add in-app privacy and data-handling information.
- Remove all analytics/advertising SDKs unless there is a clear reason to add them.
- Audit external price services and make lookups opt-in if necessary.

### What should remain unchanged

- Tax calculations.
- Workbook XML merge logic.
- Pending queues.
- Existing UI and responsive layout, apart from Android polish.
- Local-first, explicit-sync model.
- No-account model.
- User ownership of workbook and backup files.

---

## 5. Privacy and security realities

### "Local-only" is compatible with Google Play

Google Play does not require a backend. A finance app can keep all substantive data locally.

However, local storage is not automatically secure:

- `localStorage` and IndexedDB are not application-level encrypted vaults.
- Anyone with an unlocked device and sufficient access may be able to inspect app data.
- Rooted devices weaken platform isolation.
- App uninstall or "Clear storage" deletes app-private data.
- Browser/TWA storage can be cleared separately from the installed wrapper.
- Android system backup may copy eligible app data off-device unless configured.

The trust claim should be precise:

> Pechak does not operate accounts or a database and does not upload your financial records to Pechak servers. Your records remain in app storage and in files you explicitly choose to import, export, save, or share. Optional market-price lookups contact third-party services with the requested instrument identifier.

Do not claim "nothing ever leaves the device" while external fonts, CDN scripts, stock/MF queries, Android cloud backup, or user-initiated sharing can make network requests.

### Third-party requests

The current app makes or can make requests to:

- Google Fonts;
- cdnjs for SheetJS;
- MFAPI;
- a stock-price worker.

Bundling scripts and fonts removes two unnecessary runtime dependencies. Price lookups still reveal the device IP address and the requested ticker/scheme to those services. They do not need the user's full portfolio, but a series of lookups can reveal parts of it. The privacy policy and Data Safety analysis must account for actual endpoint logging and retention.

### WebView security

Do not enable broad `file://` access or universal file access in the Android WebView. Android recommends safer asset loading and warns that permissive WebView file access can expose local files. Use Capacitor's normal secure origin and narrowly scoped native document APIs.

### Privacy-first architecture recommendation

Packaging HTML as an Android app does not automatically encrypt it. If a Capacitor build continues to use `localStorage` and IndexedDB, the records are normally stored as readable WebView data inside the application's private directory.

Android's application sandbox prevents ordinary applications from reading that directory, and device encryption protects it while a properly secured phone is locked. That is meaningful protection, but it is not equivalent to application-level encryption. Exposure remains possible through:

- an unlocked lost or stolen phone;
- a rooted or otherwise compromised device;
- unintended Android cloud backup;
- debug builds, logs, crash reports, screenshots, or recent-app previews;
- unencrypted workbook, JSON, and CSV exports;
- compromised remotely loaded JavaScript;
- third-party scripts, keyboards, analytics, or price services;
- an unsafe native plugin or JavaScript bridge.

A fully native application using an ordinary unencrypted SQLite database has many of the same risks. Native UI technology is not itself a privacy control.

| Property | Hosted PWA | Hardened Capacitor | Native application |
|---|---|---|---|
| No Pechak server/database | Yes | Yes | Yes |
| Android application sandbox | Browser-managed origin | Yes | Yes |
| Application-level encryption | Limited | Can be implemented | Can be implemented |
| Biometric/device-credential lock | Limited | Can be implemented | Can be implemented |
| Signed executable updates | No; hosted deployment changes runtime | Yes, through Play | Yes, through Play |
| Remote-script supply-chain exposure | Higher | Low when all code is bundled | Low |
| Existing finance engine reused | Yes | Yes | No |
| Rewrite and regression risk | None | Low-medium | Very high |
| Protection on a rooted/fully compromised device | Limited | Limited | Limited |

For Pechak, the recommended privacy architecture is a **hardened, bundled Capacitor application**, not a hosted TWA and not an immediate native rewrite.

#### Bundle all executable code

- Bundle SheetJS, fonts, application JavaScript, CSS, icons, and the workbook template.
- Do not load executable JavaScript from CDNs or the tax-rule host.
- Deliver executable changes only through signed Play releases.
- Treat tax packs as validated data, never executable expressions or scripts.
- Apply a strict Content Security Policy that blocks unapproved scripts and limits network destinations.
- Prevent WebView navigation to untrusted origins; open external links outside the privileged application WebView.

This reduces the risk that a compromised CDN, GitHub deployment, or third-party script reads the locally stored ledger.

#### Encrypt authoritative financial data

- Do not use `localStorage` or IndexedDB as the final authoritative Android store.
- Encrypt state using an authenticated encryption mode such as AES-GCM.
- Generate and protect the wrapping/key-encryption key with Android Keystore.
- Store the cached workbook baseline separately and encrypt it if retained.
- Authenticate metadata such as schema version and record inventory so tampering is detected.
- Use atomic writes and retain a previous-known-good encrypted snapshot.
- Never hardcode an encryption key in JavaScript, the Android package, or source control.

If SQLite is introduced, using SQLite alone does not encrypt the data. Use a properly reviewed encrypted-database design or encrypt sensitive values/files separately.

#### Offer application locking

- Allow the user to require device credentials or biometrics before financial data is decrypted or displayed.
- Re-lock after a configurable background timeout.
- Require re-authentication before revealing backups, exporting full data, or changing privacy settings.
- Explain recovery consequences before enabling biometric/key-bound protection; device-credential changes and key invalidation must fail safely.

Biometric authentication should unlock a Keystore-protected key, not merely hide the UI while leaving plaintext data accessible to the application.

#### Configure Android backup deliberately

Choose and document one policy:

- **Strict device-only:** disable Android cloud backup and rely on user-controlled portable backups.
- **Encrypted backup:** allow Android backup only for already-encrypted application data with carefully tested restore behavior.
- **Device-to-device transfer:** permit only transfer modes that can be reliably enforced and explained.

For the strongest simple privacy promise, use strict device-only storage. The consequence is that uninstalling the app, clearing its storage, or losing the phone destroys the only local copy unless the user created a portable backup.

#### Protect screens and temporary surfaces

- Hide sensitive content in Android's recent-app snapshot.
- Offer or enable screenshot/screen-recording protection on financial screens, with a clear explanation of the usability trade-off.
- Do not place financial values, account names, tax amounts, or backup content on the clipboard automatically.
- Keep lock-screen notifications generic; for example, "Tax-rule update available," not a financial amount.
- Delete temporary shared files after the sharing operation or expiry period where Android permits it.
- Avoid sensitive autofill and keyboard learning on fields such as backup passphrases.

#### Secure exports and recovery

- Treat `.xlsx`, CSV, and plain JSON exports as readable documents outside Pechak's protection.
- Offer an encrypted `.pechak` portable archive for backup and device migration.
- Let the user choose and retain the backup passphrase; Pechak cannot recover it.
- Validate archive checksums and inventory before restore.
- Show a restore preview and retain a rollback snapshot until restore succeeds.
- Warn when the latest verified portable backup is stale.
- Test restoration regularly; an untested backup is not a recovery mechanism.

Encryption creates a deliberate trade-off: forgetting the passphrase can make a backup permanently unrecoverable.

#### Minimize network exposure

- Provide a fully functional offline mode.
- Make market-price retrieval optional.
- Send only the instrument identifier necessary for the selected lookup.
- Never send the ledger, holdings quantities, account balances, workbook, deductions, or tax results.
- Explain that the price provider can still observe the device IP address and requested ticker/scheme.
- Allow users to disable all external requests.
- Use HTTPS only, reject cleartext traffic, and keep a narrow network allowlist.

Central tax-rule checks should request only the signed rule index/pack. They do not require a user identifier, device identifier, or financial payload.

#### Prevent accidental operational leakage

- Do not log financial values, workbook rows, imported content, encryption material, or backup passphrases.
- Keep production builds non-debuggable.
- Do not add advertising, behavioral analytics, session replay, or third-party crash tooling without a separate privacy review.
- If crash reporting is ever added, scrub payloads and make its data path explicit.
- Review every Capacitor/native plugin, transitive dependency, and permission.
- Request no contacts, SMS, email, media-library, location, or broad storage permission.
- Use synthetic/anonymized data for tests, screenshots, support, and Play review instructions.

#### Preserve a clear threat model

Pechak should explicitly protect against:

- developer collection of financial records;
- opportunistic access by other normal applications;
- loss or theft of a locked device;
- accidental cloud backup;
- accidental disclosure through logs, screenshots, exports, or notifications;
- compromised hosted/CDN executable code;
- corrupted or partially written local data.

Pechak cannot guarantee secrecy on:

- an unlocked device in another person's possession;
- a rooted device controlled by an attacker;
- a device with malicious accessibility services, keyboard, screen capture, or OS-level compromise;
- a backup whose passphrase the user discloses;
- an exported workbook after the user shares it.

No fully native application can provide absolute protection in those conditions either. The product should state these boundaries honestly rather than use an unqualified "completely secure" claim.

#### When a native rewrite becomes justified

A native rewrite should be considered only if Pechak later requires:

- extensive background processing that Capacitor cannot safely support;
- deep Android integrations that cannot be isolated behind narrow native bridges;
- performance that a tested WebView implementation cannot meet;
- a formally audited native-only security boundary;
- sufficient resources to revalidate every finance, tax, workbook, migration, and backup behavior.

An immediate rewrite would simultaneously replace the mature finance engine and introduce new security-sensitive storage code. That larger implementation surface can create more defects and vulnerabilities. Privacy alone is therefore not a reason to rewrite; a correctly hardened Capacitor architecture can provide strong practical privacy while preserving the validated calculation engine.

#### Privacy release gates

Before any public release:

- [ ] All executable assets are bundled; no CDN scripts or remote application code.
- [ ] Authoritative financial state and cached workbook are encrypted at rest.
- [ ] Keys are protected by Android Keystore and never embedded in JavaScript.
- [ ] Backup behavior is explicitly configured and documented.
- [ ] Portable encrypted backup and verified restore work on a clean device.
- [ ] Production logging contains no financial or secret data.
- [ ] Application lock and background re-lock behave correctly.
- [ ] Recent-app preview and screenshot policy are intentional.
- [ ] Network allowlist and offline mode are tested.
- [ ] No unnecessary Android permissions or third-party SDKs exist.
- [ ] Release build is non-debuggable and signed through the approved process.
- [ ] Rooted/compromised-device limitations and exported-file risks are disclosed.
- [ ] Security behavior survives application upgrades and storage-schema migrations.

---

## 6. Google Play requirements as of 24 September 2026

### Android package and release

You will need:

- A stable application ID, for example `in.pechak.app`.
- App display name, launcher icons, adaptive icon, and splash screen.
- Version code and version name.
- A release Android App Bundle (`.aab`).
- Play App Signing and a protected upload key.
- A target SDK compatible with current Play requirements.

From 31 August 2026, new apps and updates must target **Android 16 / API level 36 or higher**. This requirement changes annually, so maintaining the Android wrapper is an ongoing obligation.

### Testing tracks

Recommended release progression:

1. **Local/device testing** — direct development builds.
2. **Internal testing** — fastest Play-distributed builds for a small trusted group.
3. **Closed testing** — the intended initial audience.
4. **Production** — public listing after quality and policy work.

For personal Play developer accounts created after 13 November 2023, Google currently requires at least **12 testers continuously opted into a closed test for 14 days** before production access can be requested. The production application asks about tester engagement, feedback, changes made, and readiness.

### Store and policy material

Prepare:

- App title, short description, full description.
- App icon, phone screenshots, and feature graphic.
- Support email and support/privacy web page.
- Privacy policy linked in Play Console and accessible inside the app.
- Data Safety form.
- Financial features declaration.
- Content rating questionnaire.
- Target audience declaration.
- App access/reviewer instructions.
- Ads declaration: no ads, if that remains true.
- Clear test instructions for importing a sample workbook and exercising core features.

### Finance classification

Pechak manages and analyzes personal financial information, so the Financial features declaration is relevant. That does **not** automatically make it a regulated lender, broker, adviser, or payment provider.

Describe the app narrowly and accurately:

- personal finance record keeping;
- workbook companion;
- budgeting and tax-estimation tools;
- no lending;
- no deposits or custody;
- no payment initiation;
- no securities execution;
- no connection to bank accounts;
- no personalized investment execution;
- calculations are informational and users remain responsible for professional/tax advice where needed.

Do not market tax estimates as guaranteed filing advice or investment planning as regulated personalized advice without appropriate review.

### Data Safety

Google defines collection around data transmitted off the device, not merely data the user types locally. A local-only app may be able to declare that financial records are not collected by the developer.

Do not finalize "no data collected" until these are audited:

- MFAPI logging and retention;
- stock-price worker logging and ownership;
- crash reporting, if later added;
- analytics, if later added;
- Android backup configuration;
- any network-loaded scripts or fonts;
- support workflows where users might send backup/workbook files.

User-initiated save/share is different from developer collection, but it must remain clearly user-driven.

---

## 7. Compatibility and validation matrix

Test on physical devices, not only emulators.

| Scenario | Required result |
|---|---|
| First launch offline | App opens; bundled features work |
| First launch online | Same result; optional prices may update |
| Import workbook from Downloads | Import succeeds and baseline persists |
| Import workbook from Google Drive provider | Content URI is handled correctly |
| Merge a workbook | Output matches browser build byte/logic expectations |
| Save exported workbook | System picker creates a usable `.xlsx` |
| Share exported workbook | Recipient receives correct MIME type and filename |
| JSON backup/restore | State and all queues round-trip |
| CSV lot/FX import | Same behavior as web app |
| App process killed during picker | App resumes safely or cancels visibly |
| Device restarts | State and workbook remain available |
| App updates | State schema migrates without data loss |
| Uninstall/reinstall | Expected loss or configured restore is clearly documented |
| Clear app storage | Data deletion is complete and understandable |
| Low storage | Writes fail explicitly; old good state remains |
| Large workbook / long ledger | Memory and WebView remain stable |
| No Chrome installed | Capacitor works; TWA behavior would differ |
| Price API unavailable | Local records and calculations still work |
| Dark/light themes | Status/navigation bars and splash are coherent |
| Back navigation | Android Back behaves naturally in overlays and screens |
| Accessibility | Touch targets, focus order, labels, contrast, text scaling |

For finance/workbook correctness, run the same known workbook fixtures through the browser and Android builds and compare:

- imported entity counts;
- computed totals;
- pending queues;
- generated workbook changes;
- JSON backups;
- failure messages.

---

## 8. Complexity by workstream

| Workstream | Complexity | Why |
|---|---|---|
| Basic Capacitor shell | Low | Existing app is already mobile-responsive |
| Android icons, splash, package, signing | Low | Standard Android/Play setup |
| Bundle JS/fonts/template | Low–medium | Straightforward but needs build organization |
| Web/Android file adapters | Medium | Multiple file types and content URI handling |
| Native authoritative storage | Medium–high | Migration, atomicity, schema versions, workbook bytes |
| Existing-web-to-app migration | Medium | JSON plus separate workbook baseline |
| Offline and dependency hardening | Medium | Service-worker and optional-network separation |
| Security hardening/encryption | Medium–high | Key lifecycle, backup, recovery, UX trade-offs |
| Device compatibility testing | Medium–high | File providers and WebView versions vary |
| Play listing and declarations | Medium | Sensitive finance context requires precision |
| Full native rewrite | Very high | Duplicates the complete product and validation burden |

---

## 9. Phased roadmap

### Phase 1 — web/PWA hardening

- Review `manifest.json` and `sw.js`.
- Self-host/bundle SheetJS and fonts.
- Document all network requests.
- Introduce storage, document, share, and network adapters.
- Add explicit backup-age and no-server-recovery messaging.

### Phase 2 — Android proof of concept

- Create the Capacitor project and target API 36+.
- Bundle the current app.
- Confirm all calculations and navigation run in Android WebView.
- Implement workbook open, create/save, and share.
- Gate PWA-only service-worker behavior.
- Test compression and large workbook operations.

### Phase 3 — durable local data

- Move Android authoritative state and workbook bytes to app-private durable storage.
- Add atomic writes, a previous-known-good snapshot, and migrations.
- Implement website-to-app JSON plus workbook migration.
- Decide and configure Android backup policy.

### Phase 4 — closed release

- Add app identity, signing, screenshots, privacy policy, and declarations.
- Run internal testing.
- Run closed testing with representative devices and workbook sources.
- Record tester feedback and fixes.

### Phase 5 — public hardening

- Complete security and privacy audit.
- Add optional app lock/encryption if required by the threat model.
- Validate accessibility and large-data behavior.
- Confirm price-service disclosures.
- Complete production-access and policy submissions.
- Use staged production rollout and monitor Play pre-launch reports.

---

## 10. Product and UX recommendations

### Product position

Pechak should not compete with Walnut-style apps on automatic ingestion. Its strongest position is:

> **A private, precise financial operating system where every number is explainable and every change is controlled by the user.**

The deliberate trade is a little more user effort in exchange for:

- no SMS, email, notification, or bank-account scraping;
- no opaque categorization;
- no advertising incentives;
- no developer-operated copy of the user's finances;
- explicit workbook synchronization;
- calculations users can inspect and correct.

That should drive design decisions more strongly than generic "reduce all taps" advice. The goal is not maximum automation; it is **minimum effort without sacrificing provenance or control**.

### Five design principles

1. **Explainability over magic**  
   Every important number should answer: what is included, what is excluded, which rule was used, and when it was last updated.

2. **Explicit control over silent automation**  
   Suggest categories, rules, and corrections, but do not silently change financial history or user overrides.

3. **Correctness over feature count**  
   Reconciliation, validation, and failure visibility are more valuable than adding another chart.

4. **Reversible actions by default**  
   Preserve originals, show previews, support undo/rollback, and make destructive operations exceptional.

5. **Local-first must feel safe, not fragile**  
   "We do not have your data" is a trust advantage only when backup health, device-loss consequences, and recovery are obvious.

### Highest-priority changes

#### 1. Add a "Needs attention" home surface

The current Overview is primarily a financial dashboard. Add a small operational section above or alongside it:

- uncategorized or incomplete transactions;
- holdings without lot history;
- unclassified capital-gains events;
- account balances not recently reconciled;
- tax rules with an update available;
- pending workbook changes;
- stale portable backup;
- workbook baseline missing;
- sync actions that previously failed.

This turns Pechak from a passive dashboard into a reliable system of record. Each item should open directly at the record or corrective action.

Do not overwhelm the user with permanent warnings. Rank items as:

- **Action required** — affects correctness;
- **Review suggested** — confidence or freshness issue;
- **Informational** — optional improvement.

#### 2. Make every major number explainable

For Overview, statements, tax totals, investment value, FD interest, and budget variance, add a consistent "How is this calculated?" drill-down:

- source records and total count;
- formula or calculation description;
- financial period;
- tax-rule pack/version where relevant;
- exclusions and missing inputs;
- last recalculation time;
- link to correct the underlying record.

For tax outputs, include an explicit confidence/status label:

- **Complete for tracked inputs**
- **Estimate — missing classification**
- **Estimate — unsupported relief**
- **Rule update available**
- **Contains user overrides**

Avoid an undifferentiated "accurate" badge. Accuracy is contextual and should be evidenced.

#### 3. Add reconciliation as a first-class journey

Accuracy-oriented users need to establish that Pechak matches reality.

Create a guided reconcile flow:

1. Choose an account and statement date.
2. Enter the real closing balance.
3. Show Pechak's calculated balance and the difference.
4. Help find likely causes:
   - missing transaction;
   - duplicate;
   - transfer recorded on one side;
   - opening-balance mismatch;
   - wrong date or account.
5. Let the user correct records or add an explicit reconciliation adjustment.
6. Record the last reconciled date and balance.

Extend integrity checks to investments:

- holding units versus sum of open lots;
- sale quantity versus available lots;
- cash leg versus investment leg;
- workbook row versus local queued state.

This is more aligned with Pechak's purpose than automatic SMS parsing and materially differentiates it from inaccurate aggregators.

#### 4. Simplify the two meanings of "Sync"

The floating Sync action currently saves an IndexedDB snapshot, while "Sync to Excel" writes pending changes to the workbook. The badge on the floating button counts workbook changes even though tapping it does something else. This is a high-risk mental-model conflict.

Use distinct names and icons:

- **Save safety copy** — local snapshot;
- **Update workbook** — review and merge pending changes;
- **Export backup** — portable JSON/ZIP file.

Better still, replace the floating Sync button with a **Data safety** status:

```text
Saved on this device · 12 workbook changes pending · Backup 18 days old
```

Tapping it opens one place with three separate actions and plain consequences.

#### 5. Make backup health visible

Because there is no server recovery, add:

- last successful local save;
- last portable backup date;
- last workbook export date;
- whether cached workbook bytes are available;
- reminder cadence chosen by the user;
- restore preview before replacing live data;
- periodic restore testing in QA.

Upgrade the portable backup to optionally include:

- structured state;
- all pending queues;
- archived transaction batches;
- cached workbook baseline;
- backup schema version;
- checksums and an inventory manifest.

An encrypted backup option is useful for storing files in Drive or sending them between devices. The encryption passphrase must be user-held; Pechak cannot recover it.

### Improve the core user journeys

#### First-run journey

Offer three clear starts:

1. **Import my Pechak workbook** — recommended for an existing user.
2. **Start a new private ledger** — uses the bundled template.
3. **Explore with sample data** — explicitly disposable and visually marked as demo.

Before asking for data, explain in one screen:

- stored on this device;
- no bank/SMS/email access;
- no Pechak account;
- optional price queries contact external services;
- user is responsible for backups.

After import, show an import report rather than jumping straight to the dashboard:

- records imported by type;
- warnings and unmatched rows;
- unsupported workbook fields;
- calculation checks;
- next recommended action.

#### Daily transaction entry

Keep explicit entry but reduce friction:

- ask for transaction type first, then show only relevant fields;
- default date, common account, currency, and recently used category;
- provide recent/favorite templates such as rent, salary, SIP, credit-card payment;
- support duplicate-and-edit for repetitive entries;
- optionally support user-defined recurring reminders, not automatic insertion;
- validate transfer double-entry before save;
- show the resulting account/holding effect in a compact preview.

Avoid adding SMS/email scraping merely to appear competitive. A privacy-preserving CSV import with a review screen is a better optional bulk-entry path.

#### Workbook import and update

Present the operation as a three-step flow:

1. **Choose source** — cached baseline or another workbook.
2. **Review changes** — additions, edits, removals, skipped duplicates, warnings.
3. **Save result** — select location/share; confirm cache updated.

After saving, show a receipt:

- output filename and time;
- successful actions;
- still-pending actions and why;
- workbook version/checksum;
- button to share or open the saved file.

If a user chooses a workbook different from the cached baseline, detect likely drift and explain whether it is safe to continue.

#### Tax-rule updates

Present central rules as **maintained statutory defaults**, not remote control of user data.

The update screen should show:

- current versus available rule-pack version;
- applicable financial year;
- authoritative source links;
- field-level changes;
- effects on the user's estimated tax, calculated locally;
- conflicts with user overrides;
- apply, retain overrides, or defer.

Historical reports must display the exact rule version used.

### Mobile information architecture

The app exposes many destinations. A drawer works, but it makes the primary workflow feel like navigating a workbook.

For Android, use four or five primary bottom destinations:

- **Home**
- **Activity**
- **Plan**
- **Tax**
- **More**

Suggested grouping:

- **Home:** overview, needs attention, recent activity;
- **Activity:** transactions and quick add;
- **Plan:** budget, investments, target allocation;
- **Tax:** summary, deductions, gains, payments, rules;
- **More:** statements, trends, ratios, categories/accounts, workbook, backup, appearance.

Preserve deep links so a warning or search result opens the exact screen/record.

Keep the floating Add button only if it always means "add a financial record." Do not overload floating actions with unrelated data-safety behavior.

### Interaction and accessibility

- Replace confirm dialogs with **Undo** for reversible local deletions; retain explicit confirmation for destructive imports, clear-data, and irreversible workbook operations.
- Disable Save until required fields are valid and put error text beside the field, not only in a toast.
- Preserve entered form data when navigating back or when Android kills/recreates the activity.
- Use consistent terminology: record, workbook change, safety copy, portable backup, tax-rule update.
- Provide minimum 48dp mobile targets, visible keyboard focus, logical focus order, accessible names, and screen-reader announcements for saves/errors.
- Ensure charts have text summaries and tables; color must never be the only indicator.
- Support system font scaling without horizontal page overflow.
- Use native Android Back semantics: close picker/modal/drawer first, then navigate back, and only exit from the root.

### Data-model and correctness improvements

- Give every internal entity a stable immutable ID, even if workbook matching still needs natural keys. This reduces accidental ambiguity during edit, undo, migration, and audit history.
- Add a lightweight local audit trail for material changes: timestamp, entity, old value, new value, and origin (user, import, rule update). Keep it local and bounded.
- Record calculation provenance: app version, rule-pack version, workbook template version, and relevant user overrides.
- Make all importers idempotent and produce machine-readable reports.
- Add schema migrations for both local state and backups.
- Build golden-fixture tests comparing browser, Android, and workbook results for known ledgers.
- Prioritize closing Capital Gains edit write-back before public release; a known local/workbook classification divergence directly conflicts with the accuracy promise.
- Replace the four-way Capital Gains rule fan-out with a model that can represent the sheet's distinct classes before central tax-rule distribution is enabled.

### What not to add yet

- Bank credential connections or account aggregation.
- SMS, notification, or email scraping.
- Social comparisons or engagement streaks.
- Ads or behavioral analytics.
- AI-generated financial advice.
- Automatic edits based on inferred behavior.
- A cloud account merely to support update notifications.

These either weaken the privacy position, introduce recurring cost and regulatory complexity, or distract from the core outcome.

### Recommended priority order

| Priority | Change | Outcome |
|---|---|---|
| P0 | Distinguish safety copy, workbook update, and backup | Prevents dangerous user misunderstanding |
| P0 | Durable Android storage and complete portable backup | Makes local-only trustworthy |
| P0 | Reconciliation and integrity checks | Directly improves accuracy |
| P0 | Calculation provenance and tax-rule versioning | Makes tax estimates explainable |
| P1 | Needs-attention surface | Guides users to correctness issues |
| P1 | Progressive transaction form and templates | Reduces daily-entry friction |
| P1 | Import/update receipts and drift detection | Makes workbook operations safer |
| P1 | Capital Gains edit write-back and richer rule model | Removes known divergence |
| P2 | Bottom navigation and screen regrouping | Improves mobile discoverability |
| P2 | Local audit history and Undo | Improves reversibility |
| P2 | Optional biometric lock/encrypted backup | Strengthens device/privacy controls |
| P3 | Periodic tax-update local notification | Useful convenience, not core correctness |

## 11. Step-by-step conversion playbook

### Direct answers

#### Do these changes require a database?

**No server database is required.** Reconciliation, needs-attention checks, explainable calculations, templates, audit history, backups, and tax-rule updates can all run locally.

There are three separate concepts:

| Storage | Needed? | Purpose |
|---|---|---|
| Cloud/server database | No | Pechak does not need accounts or developer-hosted financial data |
| Local browser storage | Already present | Good enough for the web app and early Android prototype |
| Local app database/file | Recommended eventually | More reliable Android persistence, migrations, audit records, and atomic writes |

For the first Android proof of concept, retain `localStorage` and IndexedDB so migration risk stays low.

Before public release, move the authoritative Android state to one of:

- **Versioned app-private JSON files** — simplest match for the current nested `S` state;
- **Local SQLite** — useful if transaction volume, reconciliation queries, audit history, and cross-entity integrity become substantial.

A sensible final split is:

- transactions, accounts, lots, events, and audit history: local SQLite or versioned JSON;
- preferences and small settings: native preferences or JSON;
- cached workbook: app-private `.xlsx` file;
- portable backup: user-created encrypted or plain ZIP/JSON;
- statutory tax packs: locally cached signed JSON.

SQLite is not automatically more private or secure; it is still a local file. Encryption, backup policy, and device access are separate decisions.

#### Is HTML the best approach?

**Web technology is the best migration approach; one 7,000-line HTML file is not the best long-term structure.**

Do not rewrite Pechak in Kotlin or React merely to reach Android. First prove that the existing app works in Capacitor. Then refactor gradually into:

```text
pechak/
  index.html
  package.json
  vite.config.js
  public/
    manifest.json
    sw.js
    template.xlsx
    icons/
  src/
    main.js
    styles/
      tokens.css
      layout.css
      components.css
    core/
      state.js
      calculations.js
      tax.js
      workbook.js
      validation.js
    features/
      transactions/
      investments/
      tax/
      budget/
      data-safety/
    platform/
      storage.web.js
      storage.android.js
      documents.web.js
      documents.android.js
      updates.android.js
      share.android.js
  tests/
    fixtures/
    unit/
    integration/
  android/
```

Use **plain HTML/CSS/JavaScript modules with Vite** initially. This adds a build process and modules without changing the programming model.

TypeScript can be introduced module-by-module later for workbook schemas, tax rules, queue actions, and storage migrations. A framework such as React is optional, not a prerequisite. Introducing Capacitor, a new framework, a new database, a redesign, and TypeScript simultaneously would create unnecessary risk.

#### Should wireframes be built?

**Yes, but do not wireframe the entire existing product before proving the Android wrapper.**

Run two controlled tracks:

1. **Technical proof:** package the current app unchanged and validate workbook/storage compatibility.
2. **UX design:** wireframe only the journeys being materially changed.

Wireframe these first:

- first launch and privacy explanation;
- import result;
- Home / Needs attention;
- add transaction;
- reconcile account;
- Data safety hub;
- update workbook review and receipt;
- tax-rule update review;
- backup and restore preview.

Do not spend time redrawing every report or settings field that will remain structurally unchanged.

Recommended tools:

- **Figma** — best for reusable components, clickable mobile flows, and developer handoff;
- **Penpot** — open-source alternative with similar screen/prototype workflow;
- **HTML prototype** — best after the flow is agreed, using Pechak's real design tokens and controls.

Store the source wireframes in one shared design file. Export reviewed screens as PNG/PDF into repository documentation only when they become an agreed implementation reference. Do not use exported images as the app UI.

#### Can the wireframing be done collaboratively with Copilot?

**Yes. Figma is optional.**

The most efficient collaboration model is:

1. Copilot maps the current screen and user flow.
2. Copilot creates a clickable HTML prototype using synthetic data.
3. The prototype opens in a browser beside this conversation.
4. The user clicks through it and gives directional feedback:
   - what feels wrong;
   - what should be more prominent;
   - terminology;
   - which information is missing;
   - whether a confirmation feels necessary.
5. Copilot revises the prototype.
6. Once approved, Copilot converts the prototype into production components and integrates them with the real logic.

HTML prototypes are especially suitable here because:

- Pechak is already an HTML application;
- approved components can be reused rather than redrawn from a design image;
- real mobile scrolling, forms, drawers, and state changes can be tested;
- browser accessibility and responsive behavior can be checked early;
- no paid design tool is required.

Figma's free Starter tier is sufficient for a solo wireframing file and basic clickable prototypes, subject to its current collaboration/file limits. Use Figma when freeform visual review and commenting are important. Use an HTML prototype when interaction fidelity and eventual code reuse matter more.

Copilot can produce:

- journey maps;
- low-fidelity grayscale screens;
- high-fidelity Pechak-themed screens;
- clickable interactions;
- responsive phone/desktop states;
- empty, loading, error, success, and conflict states;
- accessible component markup;
- implementation-ready HTML/CSS/JavaScript.

Copilot cannot infer personal product preferences reliably. The user's role is to make a small number of product decisions and react to prototypes; it does not require drawing screens or writing code.

### Non-coder quick start: run the current app in Capacitor first

This is a disposable proof of concept. It deliberately avoids Vite, refactoring, SQLite, and redesign. Its only purpose is to establish that the current app opens and runs inside Android.

#### What to install

1. **Node.js LTS** from [nodejs.org](https://nodejs.org/). Accept the default installer options.
2. **Android Studio** from [developer.android.com/studio](https://developer.android.com/studio). Accept the Standard installation so it installs:
   - Android SDK;
   - emulator;
   - platform tools;
   - supported JDK.
3. Restart Windows after both installations if either installer requests it.

#### Prepare one folder

Create:

```text
C:\PechakAndroid
```

Inside it create:

```text
C:\PechakAndroid\www
```

Copy these files into `www`:

- copy `mobile.html` and rename the copy to `index.html`;
- `template.xlsx`;
- `manifest.json`;
- all four icon files.

The initial Android proof does not need `sw.js`; bundled Capacitor assets are already local. The existing registration failure is caught by the page, but the production build should later gate service-worker registration explicitly.

Keep `mobile.html` and all original files elsewhere as the untouched source.

#### Open PowerShell in the folder

In File Explorer:

1. Open `C:\PechakAndroid`.
2. Click the address bar.
3. Type `powershell`.
4. Press Enter.

Run one command at a time:

```powershell
npm init -y
npm install @capacitor/core @capacitor/android
npm install --save-dev @capacitor/cli
npx cap init Pechak in.pechak.app --web-dir=www
npx cap add android
npx cap sync android
npx cap open android
```

What these do:

- create the JavaScript project;
- install Capacitor;
- identify the app as Pechak;
- create the Android project;
- copy `www` into Android;
- open it in Android Studio.

If `in.pechak.app` is not the final desired package name, choose the final ID before uploading anything to Play. The local proof can use a temporary ID such as `in.pechak.prototype`.

#### Create an Android emulator

In Android Studio:

1. Wait until the progress indicators and Gradle sync finish.
2. Open **Tools → Device Manager**.
3. Click **Create Virtual Device**.
4. Choose a recent Pixel phone.
5. Choose/download an Android API 36 image.
6. Finish and start the emulator.
7. Select that emulator in Android Studio's top device list.
8. Click the green Run triangle.

The first build can take several minutes because Android Studio downloads build components.

#### Use a physical Android phone instead

1. On the phone, open Settings and enable Developer options by tapping Build number seven times.
2. Enable USB debugging.
3. Connect the phone using a data-capable USB cable.
4. Accept the phone's debugging prompt.
5. Select the phone in Android Studio.
6. Click Run.

This installs only a development build on that phone; it does not publish anything.

#### After changing an app file

Copy the updated file into `www`, then run:

```powershell
npx cap sync android
```

Return to Android Studio and click Run again.

#### What to test in this first proof

Do not enter irreplaceable personal data.

Test:

1. every navigation destination opens;
2. a synthetic workbook imports;
3. dashboard/tax totals match the browser;
4. add/edit/remove survives closing and reopening the app;
5. JSON backup downloads or shares;
6. restore works;
7. workbook merge completes;
8. the generated workbook can be found and opened;
9. CSV import works;
10. offline launch behavior;
11. Android Back behavior;
12. layout at normal and large font sizes.

Browser-style downloads are expected to be the weakest area. A failure there does not invalidate Capacitor; it confirms that the native document adapter in the main plan is required.

#### What Copilot can take over

If the GitHub repository containing the complete Pechak deployment is configured as a project, Copilot can perform the technical work in an isolated project session:

- create the Capacitor/Vite structure;
- preserve the original app;
- copy and wire all assets;
- install dependencies;
- create the Android project;
- fix build/configuration errors;
- add native adapters;
- add tests;
- produce a debug build and exact run instructions.

The user would still need to:

- install/authorize Android Studio components on the machine;
- connect a physical phone or start an emulator;
- approve final product decisions;
- create and control the Play developer account and signing credentials.

Do not send signing-key passwords, private financial workbooks, or production credentials into prompts.

### The safe implementation order

The conversion should separate platform risk, data risk, and redesign risk. Do not change all three at once.

### Step 0 — freeze and baseline the current product

1. Put the complete deployed PWA in source control:
   - `mobile.html`;
   - `manifest.json`;
   - `sw.js`;
   - icons;
   - `template.xlsx`;
   - any worker/config files.
2. Tag the exact current version as the web baseline.
3. Create anonymized test fixtures:
   - empty/new workbook;
   - real-shaped populated workbook;
   - workbook with every queue action;
   - large ledger;
   - malformed/unsupported workbook.
4. Record expected outputs:
   - imported counts;
   - financial totals;
   - tax totals;
   - generated workbook hashes or normalized XML differences;
   - backup round trips.
5. Document every current localStorage and IndexedDB key.

**Exit gate:** the current browser app can be tested repeatably without personal financial data.

### Step 1 — create low-fidelity journey wireframes

1. Create a 390×844 Android phone frame in Figma or Penpot.
2. Define reusable primitives:
   - top bar;
   - bottom navigation;
   - cards;
   - list rows;
   - input fields;
   - status banners;
   - bottom sheets;
   - review/diff rows.
3. Draw each target journey in grayscale.
4. Connect frames into clickable flows.
5. Test each flow with three questions:
   - Does the user know where their data is?
   - Can the user predict what the next action changes?
   - Can the user recover from a mistake?
6. Add final visual styling only after the flow works.

**Exit gate:** the primary flows are understandable without verbal explanation.

### Step 2 — introduce a minimal web build

Install current Node.js LTS and Git. In a clean project directory:

```powershell
npm init -y
npm install --save-dev vite
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Move or copy the app to `index.html`, keeping behavior unchanged initially. Put static files in `public\`.

Run:

```powershell
npm run dev
npm run build
npm run preview
```

Verify the production `dist\` build, not only the development server.

**Exit gate:** `dist\` behaves identically to the current GitHub Pages build for import, calculations, queues, backup, and workbook export.

### Step 3 — self-host dependencies and harden the PWA

1. Install or vendor the workbook library instead of loading it from cdnjs.
2. Bundle font files or use system fonts.
3. Add `id`, language, direction, and categories to the manifest.
4. Rewrite the service worker using explicit cache strategies.
5. Add a visible update-ready flow.
6. Keep price APIs optional and visibly network-dependent.
7. Add application and data-schema version displays.

**Exit gate:** the installed PWA launches offline after one successful installation, and an update can be accepted without losing entered data.

### Step 4 — create the Capacitor Android shell

Install Android Studio with:

- Android SDK Platform 36 or newer;
- matching build tools;
- an Android emulator image;
- Android Studio's supported JDK.

In the web project:

```powershell
npm install @capacitor/core @capacitor/android
npm install --save-dev @capacitor/cli
npx cap init Pechak in.pechak.app --web-dir=dist
npx cap add android
npm run build
npx cap sync android
npx cap open android
```

Choose the package ID carefully before Play release. Changing it later creates a different Play Store application.

In Android Studio:

1. Wait for Gradle sync.
2. Create an API 36 emulator.
3. Select the `app` run configuration.
4. Click Run.

For subsequent web changes:

```powershell
npm run build
npx cap sync android
```

Use `npx cap copy android` only when native plugin/config synchronization is not needed; `sync` is the safer normal command.

**Exit gate:** the unmodified Pechak app launches on emulator and physical Android devices, including all navigation and calculations.

### Step 5 — test existing browser APIs inside Android

Before adding plugins, test:

- `.xlsx` selection;
- JSON restore;
- CSV imports;
- workbook generation;
- backup download;
- `CompressionStream` and `DecompressionStream`;
- IndexedDB persistence after app restart;
- low-memory restart;
- external price requests;
- Android Back behavior;
- file names and MIME types.

Classify each capability:

- works reliably unchanged;
- works but has poor UX;
- fails or varies by provider/device;
- needs native implementation.

**Exit gate:** there is an evidence-based list of native bridges, not a speculative plugin list.

### Step 6 — add platform adapters

Replace direct platform calls with interfaces:

```javascript
const storage = createStorageAdapter();
const documents = createDocumentAdapter();
const sharing = createShareAdapter();
const updates = createUpdateAdapter();
```

Implement:

- web adapters using existing browser behavior;
- Android adapters using Capacitor plugins or small custom native plugins.

For Android documents, use the Storage Access Framework:

- `ACTION_OPEN_DOCUMENT` for workbook/backup/CSV input;
- `ACTION_CREATE_DOCUMENT` for workbook/backup output;
- `FileProvider` plus the share sheet for temporary generated files.

Do not request broad storage access.

**Exit gate:** files can be opened from local storage and common document providers, then saved/shared with correct content and names.

### Step 7 — establish durable local persistence

Start with a versioned storage envelope:

```json
{
  "schemaVersion": 1,
  "writtenAt": "2026-09-24T00:00:00Z",
  "appVersion": "1.0.0",
  "checksum": "...",
  "state": {},
  "queues": {}
}
```

Required behavior:

1. Write a temporary copy.
2. Read it back and validate schema/checksum.
3. Atomically replace the authoritative copy.
4. Retain one previous-known-good copy.
5. Migrate older schemas on startup.
6. Never clear the old copy until migration succeeds.

Keep workbook bytes as a separate app-private file to avoid repeatedly serializing binary data into the main state.

If choosing SQLite, introduce it only after the adapter contract and migrations exist. The UI and calculations should not know whether state is backed by JSON or SQLite.

**Exit gate:** process death, app restart, and version upgrade cannot silently lose or partially write state.

### Step 8 — build complete portable backup and migration

Define a portable Pechak archive such as `.pechak` ZIP:

```text
manifest.json
state.json
queues.json
workbook.xlsx
archives.json
checksums.json
```

Support:

- export without encryption;
- optional passphrase encryption;
- inventory and checksum validation;
- preview before restore;
- restore into an empty app;
- restore over existing data with rollback;
- browser-to-Android migration.

Continue accepting old JSON backups.

**Exit gate:** a user can move from GitHub Pages to Android, lose the original installation, and recover all documented data from a user-held backup.

### Step 9 — implement the priority UX changes

Build in this order:

1. Rename and separate safety copy, workbook update, and portable backup.
2. Add Data safety status and backup reminders.
3. Add account reconciliation and integrity checks.
4. Add Needs attention.
5. Add calculation explanations/provenance.
6. Add transaction templates and progressive forms.
7. Add workbook receipts and drift detection.
8. Implement tax-rule update review.
9. Apply the approved mobile navigation wireframes.

Avoid combining all UI changes into a single release. Each step should preserve the golden financial/workbook results.

### Step 10 — add the tax-rule publishing workflow

Create a separate repository directory:

```text
tax-rules/
  index.json
  schemas/
    rule-pack-v1.schema.json
  in/
    fy-2026-27/
      v1.json
      v1.sig
```

Publishing procedure:

1. Update rule data with official source links.
2. Validate against JSON Schema.
3. Run tax golden fixtures.
4. Review the generated field-level diff.
5. Sign the canonical JSON.
6. Publish the immutable versioned file.
7. Update `index.json` last.
8. Verify from a clean device.

The application should cache packs, preserve history, and require review before replacing overrides.

**Exit gate:** a bad, unsigned, incompatible, or malformed pack is rejected without affecting the installed rules.

### Step 11 — automated and manual testing

Recommended automated layers:

- unit tests for calculations, validation, classification, and migrations;
- golden workbook integration tests;
- backup/restore round-trip tests;
- DOM journey tests for primary flows;
- Android instrumented tests for native file adapters where valuable.

Run manual tests on:

- a current Pixel/stock Android device or emulator;
- a Samsung device;
- a lower-memory device;
- at least one older supported Android version;
- Files/Downloads, Google Drive, and another document provider.

Test install states:

- fresh install;
- upgrade over populated data;
- interrupted update;
- app process killed;
- device restart;
- no network;
- low storage;
- clear cache;
- clear data;
- uninstall/reinstall.

Use only anonymized or synthetic workbooks in test tracks and screenshots.

### Step 12 — build a signed test release

In Android Studio:

1. Set version code and version name.
2. Confirm target SDK 36 or the then-current Play requirement.
3. Select **Build → Generate Signed Bundle / APK**.
4. Choose **Android App Bundle**.
5. Create and securely back up the upload keystore.
6. Generate the release `.aab`.

Never commit the keystore or passwords to Git.

Install debug builds directly during development. Test release behavior through Google Play because signing, Play Core updates, and store delivery differ from local debug installation.

### Step 13 — Play Console testing

1. Create the Play Console app.
2. Enroll in Play App Signing.
3. Complete:
   - store listing;
   - privacy policy;
   - Data Safety;
   - Financial features declaration;
   - content rating;
   - target audience;
   - ads declaration;
   - app access/reviewer instructions.
4. Upload the AAB to **Internal testing**.
5. Add trusted testers and test installation/update through the Play link.
6. Fix pre-launch report findings.
7. Promote to **Closed testing**.
8. If the account is subject to the current personal-account rule, keep at least 12 testers opted in continuously for 14 days and record their feedback.
9. Apply for production access.
10. Use a staged production rollout rather than releasing to everyone at once.

### Step 14 — release and update operations

For every app release:

1. Backward-compatibility test populated state.
2. Run golden finance/workbook fixtures.
3. Build and sign AAB.
4. Internal test.
5. Closed/staged rollout.
6. Watch Play pre-launch, crash, and user feedback signals.
7. Never require export/reimport for a routine update.

For every tax pack:

1. Cite sources.
2. Validate schema.
3. Run fixtures.
4. Review diff.
5. Sign.
6. Publish immutable version.
7. Update index.
8. Verify app notification and local impact preview.

### Recommended first milestone

Do not begin with the redesign or database.

The first milestone should prove:

1. the current app builds with Vite;
2. it runs unchanged in Capacitor;
3. a real-shaped workbook can be imported;
4. all calculations match the browser;
5. the merged workbook can be saved through Android;
6. state survives restart;
7. a portable backup restores correctly.

Only after this milestone should the storage migration and approved UX wireframes be implemented.

## 12. Bottom line

You do **not** need to turn Pechak into a conventional cloud product to publish it.

The fastest route is a TWA, but it preserves the exact browser limitations that matter most for this app: origin-bound storage, browser-controlled workbook downloads, and limited native security/recovery options.

The recommended route is a **bundled Capacitor app with a small native document/storage layer**. It keeps the existing product, retains the zero-backend cost model, supports a credible privacy promise, and creates a clean path from a closed group to a public release.

A native rewrite would add cost and correctness risk without solving a present requirement.

---

## Official references

- [Android: Trusted Web Activities](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities)
- [Chrome: TWA quick start and Digital Asset Links](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start)
- [Google: Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started)
- [Capacitor documentation](https://capacitorjs.com/docs)
- [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem)
- [Capacitor Share](https://capacitorjs.com/docs/apis/share)
- [Android Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)
- [Android Auto Backup](https://developer.android.com/identity/data/autobackup)
- [Android WebView file-access risks](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion)
- [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Google Play testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Google Play Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play financial-services policy](https://support.google.com/googleplay/android-developer/answer/9876821)
