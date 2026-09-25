import assert from "node:assert/strict";
import test from "node:test";
import { computeHraExemption, computeTaxRegimePure, normalizeTaxRules, rebateAndRelief, slabTax } from "../../src/domain/tax.mjs";

const rules = {
  newSlabs: [[0, 400000, 0], [400000, 800000, .05], [800000, 1200000, .10], [1200000, 1e12, .15]],
  oldSlabs: [[0, 250000, 0], [250000, 500000, .05], [500000, 1e12, .20]],
  rebate: { newLimit: 1200000, newMax: 60000, oldLimit: 500000, oldMax: 12500 },
  stdDeduction: { new: 75000, old: 50000 }, cess: .04,
  cg: { equityLtMonths: 12 }, surchargeSlabs: [], surcharge: { capOnSpecialIncome: .15 },
  advanceTax: { rate: .01 }, fdTds: { threshold: 50000 }, alThreshold: 10000000
};
const zeroIncome = { salary: 0, interest: 0, dividend: 0, other: 0, slabGains: 0, fdAccrued: 0 };

test("slab boundaries and 87A marginal relief use production formulas", () => {
  assert.equal(slabTax(400000, rules.newSlabs), 0);
  assert.equal(slabTax(800000, rules.newSlabs), 20000);
  assert.equal(slabTax(1200000, rules.newSlabs), 60000);
  assert.deepEqual(rebateAndRelief(1200000, 60000, 1200000, 60000), { rebate: 60000, relief: 0, taxAfter: 0 });
  assert.deepEqual(rebateAndRelief(1200010, 60001.5, 1200000, 60000), { rebate: 0, relief: 59991.5, taxAfter: 10 });
});

test("regime calculations apply deductions and cess", () => {
  const result = computeTaxRegimePure("new", { ...zeroIncome, salary: 1500000 }, rules, { chapterVIA: 0, hra: 0, total: 0 });
  assert.equal(result.taxable, 1425000);
  assert.equal(result.slabTaxAmt, 93750);
  assert.equal(result.total, 97500);
  assert.equal(computeHraExemption({ basicMonthly: 50000, hraMonthly: 20000, rentMonthly: 25000, metro: true }), 240000);
});

test("legacy tax rules are migrated without replacing saved values", () => {
  const saved = { ...rules, cg: undefined, fdTds: undefined, alThreshold: undefined, cess: .05 };
  const migrated = normalizeTaxRules(saved, rules);
  assert.equal(migrated.cg.equityLtMonths, rules.cg.equityLtMonths);
  assert.deepEqual(migrated.fdTds, rules.fdTds);
  assert.equal(migrated.alThreshold, rules.alThreshold);
  assert.equal(migrated.cess, .05);
});

test("capital gains 'other' classes migrate from the legacy shared fields and preserve per-class overrides", () => {
  const cgDefaults = { equityLtMonths: 12, otherLtMonths: 24, sgbLtMonths: 12, otherLtRate: .125 };
  const defaults = { ...rules, cg: cgDefaults };

  const legacyOnly = normalizeTaxRules({ ...rules, cg: { ...cgDefaults } }, defaults);
  assert.deepEqual(legacyOnly.cg.classes.goldOther, { ltMonths: 24, ltRate: .125 });
  assert.deepEqual(legacyOnly.cg.classes.foreignUnlisted, { ltMonths: 24, ltRate: .125 });
  assert.deepEqual(legacyOnly.cg.classes.debtPre2023, { ltMonths: 24, ltRate: .125 });
  assert.deepEqual(legacyOnly.cg.classes.realEstate, { ltMonths: 24, ltRate: .125 });
  assert.deepEqual(legacyOnly.cg.classes.sgb, { ltMonths: 12, ltRate: .125 });

  const withOverride = normalizeTaxRules(
    { ...rules, cg: { ...cgDefaults, classes: { goldOther: { ltMonths: 36, ltRate: .2 } } } },
    defaults
  );
  assert.deepEqual(withOverride.cg.classes.goldOther, { ltMonths: 36, ltRate: .2 });
  assert.deepEqual(withOverride.cg.classes.sgb, { ltMonths: 12, ltRate: .125 });
});
