import assert from "node:assert/strict";
import test from "node:test";
import { checksumBytes, checksumString, createStorageAdapter, isValidStoreEnvelope, isValidWorkbookEnvelope, looksLikeEnvelope } from "../../src/adapters/storageAdapter.js";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

test.beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.document = { querySelector: () => null };
});

test("atomic state accepts legacy unwrapped data and writes a valid envelope", () => {
  const adapter = createStorageAdapter();
  localStorage.setItem("state", JSON.stringify({ legacy: true }));
  assert.deepEqual(adapter.getStateAtomic("state", null), { legacy: true });
  assert.equal(adapter.setStateAtomic("state", { current: true }), true);
  const envelope = JSON.parse(localStorage.getItem("state"));
  assert.equal(looksLikeEnvelope(envelope), true);
  assert.equal(isValidStoreEnvelope(envelope), true);
  assert.deepEqual(adapter.getStateAtomic("state", null), { current: true });
});

test("corrupt current envelope falls back to previous known good", () => {
  const adapter = createStorageAdapter();
  adapter.setStateAtomic("state", { version: 1 });
  adapter.setStateAtomic("state", { version: 2 });
  const corrupt = JSON.parse(localStorage.getItem("state"));
  corrupt.payload.version = 999;
  localStorage.setItem("state", JSON.stringify(corrupt));
  assert.deepEqual(adapter.getStateAtomic("state", null), { version: 1 });
});

test("checksum validators reject corrupt store and workbook envelopes", () => {
  const payload = { value: 1 };
  const storeEnvelope = { schemaVersion: 1, checksum: checksumString(JSON.stringify(payload)), payload };
  assert.equal(isValidStoreEnvelope(storeEnvelope), true);
  storeEnvelope.payload.value = 2;
  assert.equal(isValidStoreEnvelope(storeEnvelope), false);
  const bytes = new Uint8Array([1, 2, 3]);
  const workbookEnvelope = { schemaVersion: 1, checksum: checksumBytes(bytes), bytes };
  assert.equal(isValidWorkbookEnvelope(workbookEnvelope), true);
  workbookEnvelope.bytes = new Uint8Array([1, 2, 4]);
  assert.equal(isValidWorkbookEnvelope(workbookEnvelope), false);
});
