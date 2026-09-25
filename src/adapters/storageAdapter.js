import packageMetadata from "../../package.json" with { type: "json" };

// Web implementation of the storage adapter: localStorage + IndexedDB.
// Key/DB names match the pre-adapter code exactly so existing data is read
// back unchanged. A future native (Capacitor) adapter implements the same
// method names against app-private storage instead.

const WB_DB = "ledger_wb_cache", WB_STORE = "kv", WB_KEY = "workbook";
const WB_KEY_PREV = "workbook__prev";
const LOCAL_SYNC_KEY = "localSync";
const AUTO_BACKUP_HANDLE_KEY = "autoBackupHandle";

// ---- Atomic-write envelope (main STORE state + workbook cache only) ----
// Plain localStorage.setItem/IndexedDB put calls have no built-in way to tell
// a good write from a truncated/corrupt one, and no rollback if a write does
// go bad mid-way (quota errors, engine bugs, a tab killed mid-write). This
// wraps the two things worth protecting -- the main ledger state and the
// cached workbook bytes -- in a small envelope (schemaVersion/writtenAt/
// appVersion/checksum) that's validated on every read, and keeps one
// previous-known-good copy to fall back to if the current one fails
// validation. Everything else (queues, theme, localSync) is left on the
// original plain get/setItem path -- lower value, and every one of those
// already has its own re-derivable source of truth.
const ENVELOPE_SCHEMA_VERSION = 1;
const APP_VERSION = packageMetadata.version;
const STORE_PREV_SUFFIX = "__prev";
const STORE_STAGING_SUFFIX = "__staging";

export function checksumString(str) {
  // djb2 -- fast, synchronous, good enough to catch truncation/corruption.
  // Not a security control, just a "did this write/read come back intact" check.
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function checksumBytes(bytes) {
  let h = 5381;
  for (let i = 0; i < bytes.length; i++) h = ((h * 33) ^ bytes[i]) >>> 0;
  return h.toString(16);
}

export function looksLikeEnvelope(obj) {
  return !!obj && typeof obj === "object" && "schemaVersion" in obj && "checksum" in obj;
}

export function isValidStoreEnvelope(env) {
  if (!looksLikeEnvelope(env) || !("payload" in env) || typeof env.checksum !== "string") return false;
  return checksumString(JSON.stringify(env.payload)) === env.checksum;
}

export function isValidWorkbookEnvelope(env) {
  if (!looksLikeEnvelope(env) || !env.bytes || typeof env.checksum !== "string") return false;
  return checksumBytes(env.bytes) === env.checksum;
}

function wbDbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(WB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(WB_STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export function createStorageAdapter() {
  let persistFailWarned = false;

  function setStorageWarning(on) {
    persistFailWarned = on;
    const el = document.querySelector("#storageWarnBanner");
    if (el) el.classList.toggle("show", on);
  }

  return {
    isWarned() { return persistFailWarned; },

    getItem(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) { return fallback; }
    },

    setItem(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        if (persistFailWarned) setStorageWarning(false);
        return true;
      } catch (e) {
        console.error("localStorage.setItem failed for key", key, e);
        if (!persistFailWarned) setStorageWarning(true);
        return false;
      }
    },

    removeItem(key) {
      try { localStorage.removeItem(key); } catch (e) {}
    },

    // Atomic, validated write for the main ledger STORE key (see the envelope
    // note above). Order matters: stage the new envelope, read it back and
    // validate it, THEN snapshot the current value as previous-known-good,
    // and only then promote staging into the real key. If anything throws
    // partway through, the real key still holds whatever it held before --
    // never a half-written value.
    setStateAtomic(key, value) {
      const stagingKey = key + STORE_STAGING_SUFFIX;
      const prevKey = key + STORE_PREV_SUFFIX;
      try {
        const body = JSON.stringify(value);
        const envelope = {
          schemaVersion: ENVELOPE_SCHEMA_VERSION,
          writtenAt: new Date().toISOString(),
          appVersion: APP_VERSION,
          checksum: checksumString(body),
          payload: value,
        };
        const serialized = JSON.stringify(envelope);

        localStorage.setItem(stagingKey, serialized);
        const stagedRaw = localStorage.getItem(stagingKey);
        const staged = stagedRaw ? JSON.parse(stagedRaw) : null;
        if (!isValidStoreEnvelope(staged)) throw new Error("staged write failed validation");

        const currentRaw = localStorage.getItem(key);
        if (currentRaw) {
          try {
            const current = JSON.parse(currentRaw);
            // Only snapshot the current value if it's itself a valid envelope
            // or pre-envelope legacy data -- either way it's a real prior
            // state worth being able to fall back to.
            if (isValidStoreEnvelope(current) || (current && typeof current === "object")) {
              localStorage.setItem(prevKey, currentRaw);
            }
          } catch (e) { /* current value unparsable -- nothing sane to snapshot, just move on */ }
        }

        localStorage.setItem(key, serialized);
        localStorage.removeItem(stagingKey);
        if (persistFailWarned) setStorageWarning(false);
        return true;
      } catch (e) {
        console.error("setStateAtomic failed for key", key, e);
        if (!persistFailWarned) setStorageWarning(true);
        return false;
      }
    },

    // Reads the STORE key back, validating the envelope checksum. Falls back
    // to the previous-known-good copy if the main copy is corrupt, and treats
    // pre-envelope legacy data (installs upgrading from before this existed)
    // as valid as-is -- it gets wrapped in an envelope on the next write.
    getStateAtomic(key, fallback) {
      const prevKey = key + STORE_PREV_SUFFIX;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (isValidStoreEnvelope(parsed)) return parsed.payload;
          if (!looksLikeEnvelope(parsed)) return parsed; // legacy pre-envelope value
          console.error("getStateAtomic: envelope for", key, "failed checksum validation, trying previous-known-good copy");
        }
      } catch (e) { console.error("getStateAtomic: main copy for", key, "unreadable", e); }
      try {
        const prevRaw = localStorage.getItem(prevKey);
        if (prevRaw) {
          const parsed = JSON.parse(prevRaw);
          if (isValidStoreEnvelope(parsed)) return parsed.payload;
          if (!looksLikeEnvelope(parsed)) return parsed;
        }
      } catch (e) { console.error("getStateAtomic: previous-known-good copy for", key, "also unreadable", e); }
      return fallback;
    },

    getStateMetadata(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isValidStoreEnvelope(parsed)) return null;
        return {
          schemaVersion: parsed.schemaVersion,
          writtenAt: parsed.writtenAt,
          appVersion: parsed.appVersion,
          checksum: parsed.checksum,
        };
      } catch (e) {
        console.error("getStateMetadata failed for key", key, e);
        return null;
      }
    },

    // Plain-string variants (no JSON encode/decode) -- for values that were
    // always stored as raw strings, e.g. the theme key, so existing installs'
    // stored values keep reading back correctly.
    getRawItem(key, fallback) {
      try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; }
    },

    setRawItem(key, value) {
      try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },

    // Validates the checksum on read, falling back to the previous-known-good
    // copy if the main record is corrupt. Pre-envelope legacy records (no
    // schemaVersion/checksum) are returned as-is -- they predate this check
    // and get upgraded to a full envelope on the next setWorkbookBytes.
    async getWorkbookBytes() {
      try {
        const db = await wbDbOpen();
        const tryRead = (recordKey) => new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readonly");
          const rq = tx.objectStore(WB_STORE).get(recordKey);
          rq.onsuccess = () => res(rq.result || null);
          rq.onerror = () => rej(rq.error);
        });
        let val = await tryRead(WB_KEY);
        if (val && looksLikeEnvelope(val) && !isValidWorkbookEnvelope(val)) {
          console.error("getWorkbookBytes: main copy failed checksum validation, trying previous-known-good copy");
          val = await tryRead(WB_KEY_PREV);
          if (val && looksLikeEnvelope(val) && !isValidWorkbookEnvelope(val)) val = null;
        }
        db.close();
        return val;
      } catch (e) { console.error("getWorkbookBytes failed", e); return null; }
    },

    // Write-validate-then-replace: compute the checksum up front, snapshot the
    // current record as previous-known-good, write the new one, then read it
    // back inside the same IndexedDB transaction to confirm it landed intact
    // before the transaction is allowed to commit. IndexedDB transactions are
    // all-or-nothing, so if validation fails and we reject, none of this
    // transaction's writes (including the previous-known-good snapshot) apply.
    async setWorkbookBytes(bytes, name) {
      try {
        const byteArr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const envelope = {
          schemaVersion: ENVELOPE_SCHEMA_VERSION,
          writtenAt: new Date().toISOString(),
          appVersion: APP_VERSION,
          checksum: checksumBytes(byteArr),
          bytes: byteArr,
          name,
          cachedAt: new Date().toISOString(),
        };
        const db = await wbDbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readwrite");
          const store = tx.objectStore(WB_STORE);
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
          tx.oncomplete = res;

          const getCurrent = store.get(WB_KEY);
          getCurrent.onsuccess = () => {
            const current = getCurrent.result;
            if (current && (looksLikeEnvelope(current) ? isValidWorkbookEnvelope(current) : true)) {
              store.put(current, WB_KEY_PREV);
            }
            const putReq = store.put(envelope, WB_KEY);
            putReq.onsuccess = () => {
              const verify = store.get(WB_KEY);
              verify.onsuccess = () => {
                if (!isValidWorkbookEnvelope(verify.result)) tx.abort();
              };
            };
          };
        });
        db.close();
      } catch (e) { console.error("setWorkbookBytes failed", e); }
    },

    async clearWorkbookBytes() {
      try {
        const db = await wbDbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readwrite");
          tx.objectStore(WB_STORE).delete(WB_KEY);
          tx.objectStore(WB_STORE).delete(WB_KEY_PREV);
          tx.objectStore(WB_STORE).delete(LOCAL_SYNC_KEY); // same store, same "start fresh" intent -- must go together
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        db.close();
      } catch (e) { console.error("clearWorkbookBytes failed", e); }
    },

    async getLocalSync(lsFallbackKey) {
      try {
        const db = await wbDbOpen();
        const val = await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readonly");
          const rq = tx.objectStore(WB_STORE).get(LOCAL_SYNC_KEY);
          rq.onsuccess = () => res(rq.result || null);
          rq.onerror = () => rej(rq.error);
        });
        db.close();
        if (val) return val;
      } catch (e) { console.error("getLocalSync (IndexedDB) failed", e); }
      try {
        const raw = localStorage.getItem(lsFallbackKey);
        if (raw) return JSON.parse(raw);
      } catch (e) { console.error("getLocalSync (localStorage mirror) failed", e); }
      return null;
    },

    async setLocalSync(obj, lsFallbackKey) {
      let idbOk = false, lsOk = false;
      try {
        const db = await wbDbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readwrite");
          tx.objectStore(WB_STORE).put(obj, LOCAL_SYNC_KEY);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        db.close();
        idbOk = true;
      } catch (e) { console.error("setLocalSync (IndexedDB) failed", e); }
      try {
        localStorage.setItem(lsFallbackKey, JSON.stringify(obj));
        lsOk = true;
      } catch (e) { console.error("setLocalSync (localStorage mirror) failed", e); }
      return idbOk || lsOk;
    },

    // Persists the File System Access API handle the user grants for silent
    // auto-backup (see index.html's checkAutoBackup/writeAutoBackupTo).
    // FileSystemFileHandle is structured-cloneable, so IndexedDB can store it
    // directly -- same object store the workbook cache and local-sync record
    // already share, just another key.
    async setAutoBackupHandle(handle) {
      try {
        const db = await wbDbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readwrite");
          tx.objectStore(WB_STORE).put(handle, AUTO_BACKUP_HANDLE_KEY);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        db.close();
        return true;
      } catch (e) { console.error("setAutoBackupHandle failed", e); return false; }
    },

    async getAutoBackupHandle() {
      try {
        const db = await wbDbOpen();
        const val = await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readonly");
          const rq = tx.objectStore(WB_STORE).get(AUTO_BACKUP_HANDLE_KEY);
          rq.onsuccess = () => res(rq.result || null);
          rq.onerror = () => rej(rq.error);
        });
        db.close();
        return val;
      } catch (e) { console.error("getAutoBackupHandle failed", e); return null; }
    },

    async clearAutoBackupHandle() {
      try {
        const db = await wbDbOpen();
        await new Promise((res, rej) => {
          const tx = db.transaction(WB_STORE, "readwrite");
          tx.objectStore(WB_STORE).delete(AUTO_BACKUP_HANDLE_KEY);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        db.close();
      } catch (e) { console.error("clearAutoBackupHandle failed", e); }
    },
  };
}
