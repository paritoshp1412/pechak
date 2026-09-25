import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateLedger, transactionCashFlow, transactionType, validateTransaction } from "../../src/domain/ledger.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/populated-state.json", import.meta.url), "utf8")).state;
const kinds = {
  "Spend - Bank/Cash": { t: "Expense", cf: "Operating", cr: 1 },
  "Spend - Credit Card": { t: "Expense", cf: "Operating", cr: 1 },
  "Salary / Recurring Income": { t: "Income", cf: "Operating", cr: 1 },
  "Transfer - Between My Accounts": { t: "Transfer", cf: "Internal", cr: 0 },
  "Credit Card Bill Payment": { t: "Transfer", cf: "Financing", cr: 0 }
};

test("ledger balances, cash flow and integrity inputs reconcile", () => {
  const ledger = calculateLedger(fixture, kinds);
  assert.deepEqual(ledger.bal, { "Primary Bank": 120000, "Credit Card": 0, Broker: 30000 });
  assert.equal(ledger.IS.rev._t, 120000);
  assert.equal(ledger.IS.exp._t, 30000);
  assert.equal(ledger.CF.chk, 0);
  assert.equal(ledger.CF.end, ledger.CF.bsCash);
  assert.equal(ledger.netWorth, 152000);
  assert.equal(ledger.portCur, 32000);
});

test("transaction classification and validation cover boundary failures", () => {
  const external = "External / World";
  const valid = { kind: "Spend - Bank/Cash", from: "Bank", to: external, amt: 1, cat: "Food" };
  assert.equal(transactionType(valid, kinds), "Expense");
  assert.equal(transactionCashFlow(valid, kinds), "Operating");
  assert.deepEqual(validateTransaction(valid, kinds, external), { ok: true });
  assert.match(validateTransaction({ ...valid, amt: 0 }, kinds, external).msg, /> 0/);
  assert.match(validateTransaction({ ...valid, to: "Other" }, kinds, external).msg, /To External/);
  assert.match(validateTransaction({ ...valid, cat: "" }, kinds, external).msg, /Category required/);
  assert.match(validateTransaction({ kind: "Transfer - Between My Accounts", from: external, to: "Bank", amt: 1 }, kinds, external).msg, /cannot touch External/);
});

test("unknown references do not mutate source state", () => {
  const state = structuredClone(fixture);
  state.txns.push({ date: "2026-05-01", kind: "Spend - Bank/Cash", from: "Deleted", to: "External / World", amt: 99, cat: "Food" });
  const before = structuredClone(state);
  const ledger = calculateLedger(state, kinds);
  assert.equal(ledger.CF.chk, 0);
  assert.deepEqual(state, before);
});
