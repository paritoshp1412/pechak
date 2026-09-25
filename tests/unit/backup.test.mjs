import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BACKUP_FORMAT, QUEUE_FIELDS, STATE_FIELDS, createBackup, parseBackup, planRestore } from "../../src/domain/backup.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/populated-state.json", import.meta.url), "utf8"));
const store = "ledger_app_v7";

test("full export, parse, normalize and restore round trip preserves every field", () => {
  const arrayFields = new Set(["txns", "holdings", "accounts", "cats", "budget", "capGainsEvents", "taxPayments", "fixedDeposits", "transactionTemplates", "workbookReceipts"]);
  const state = Object.fromEntries(STATE_FIELDS.map(field => [field, fixture.state[field] ?? (arrayFields.has(field) ? [{ synthetic: field }] : { synthetic: field })]));
  state.txns = fixture.state.txns;
  const queues = Object.fromEntries(QUEUE_FIELDS.map(field => [field, [{ id: field }]]));
  const archives = { FY26: { entries: [{ id: "archived" }] } };
  const workbook = { name: "synthetic.xlsx", cachedAt: "2026-01-01T00:00:00.000Z", bytes: new Uint8Array([80, 75, 3, 4]) };
  const exported = createBackup({ store, state, queues, archives, workbook, exportedAt: "2026-09-25T00:00:00.000Z" });
  const parsed = parseBackup(JSON.stringify(exported), store);
  const restored = planRestore(parsed, {});
  assert.equal(parsed._backup.format, BACKUP_FORMAT);
  assert.deepEqual(restored.state, state);
  assert.deepEqual(restored.queues, queues);
  assert.deepEqual(restored.archives, archives);
  assert.equal(restored.workbook.name, workbook.name);
  assert.deepEqual([...restored.workbook.bytes], [...workbook.bytes]);
});

test("old format fills only absent fields and all queues default empty", () => {
  const old = parseBackup(JSON.stringify({ _backup: { app: store, format: 1 }, txns: [] }), store);
  const current = Object.fromEntries(STATE_FIELDS.map(field => [field, `current-${field}`]));
  const restored = planRestore(old, current);
  assert.equal(restored.state.accounts, "current-accounts");
  assert.ok(QUEUE_FIELDS.every(field => restored.queues[field].length === 0));
});

test("newer compatible formats retain recognized fields", () => {
  const parsed = parseBackup(JSON.stringify({ _backup: { app: store, format: 99 }, txns: [], accounts: [], futureField: true }), store);
  assert.deepEqual(planRestore(parsed, {}).state.accounts, []);
});

test("invalid inputs fail before current state can be mutated", () => {
  const current = { txns: [{ id: "keep" }], accounts: [{ name: "Keep" }] };
  const before = structuredClone(current);
  assert.throws(() => parseBackup("{", store), /valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ accounts: [] }), store), /transactions array/);
  assert.throws(() => parseBackup(JSON.stringify({ txns: [], accounts: {} }), store), /accounts.*list/);
  assert.throws(() => parseBackup(JSON.stringify({ _backup: { app: "other" }, txns: [] }), store), /different app/);
  assert.throws(() => planRestore({ txns: [], workbook: { bytesB64: "%" } }, current), /couldn't be decoded/);
  assert.deepEqual(current, before);
});
