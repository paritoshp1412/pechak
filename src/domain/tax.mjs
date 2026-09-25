export function slabTax(taxable, bands) {
  let tax = 0;
  for (const [from, upTo, rate] of bands) {
    if (taxable <= from) break;
    tax += (Math.min(taxable, upTo) - from) * rate;
  }
  return tax;
}

export function rebateAndRelief(taxableIncome, slabTaxAmount, limit, maxRebate) {
  if (taxableIncome <= limit) {
    const rebate = Math.min(slabTaxAmount, maxRebate);
    return { rebate, relief: 0, taxAfter: slabTaxAmount - rebate };
  }
  const excess = taxableIncome - limit;
  if (slabTaxAmount > excess) return { rebate: 0, relief: slabTaxAmount - excess, taxAfter: excess };
  return { rebate: 0, relief: 0, taxAfter: slabTaxAmount };
}

export function computeHraExemption(hra) {
  const basic = (+hra.basicMonthly || 0) * 12;
  const received = (+hra.hraMonthly || 0) * 12;
  const rent = (+hra.rentMonthly || 0) * 12;
  return Math.max(0, Math.min(received, Math.max(0, rent - basic * 0.1), basic * (hra.metro ? 0.5 : 0.4)));
}

export function normalizeTaxRules(saved, defaults) {
  const rules = saved || structuredClone(defaults);
  for (const key of ["cg", "surchargeSlabs", "surcharge", "advanceTax", "fdTds"]) {
    if (rules[key] == null) rules[key] = structuredClone(defaults[key]);
  }
  const legacyMonths = rules.cg.otherLtMonths ?? defaults.cg.otherLtMonths;
  const legacyRate = rules.cg.otherLtRate ?? defaults.cg.otherLtRate;
  const legacySgbMonths = rules.cg.sgbLtMonths ?? defaults.cg.sgbLtMonths;
  const migrated = {
    foreignUnlisted: { ltMonths: legacyMonths, ltRate: legacyRate },
    debtPre2023: { ltMonths: legacyMonths, ltRate: legacyRate },
    goldOther: { ltMonths: legacyMonths, ltRate: legacyRate },
    sgb: { ltMonths: legacySgbMonths, ltRate: legacyRate },
    realEstate: { ltMonths: legacyMonths, ltRate: legacyRate }
  };
  rules.cg.classes ||= {};
  for (const [key, fallback] of Object.entries(migrated)) {
    rules.cg.classes[key] = { ...fallback, ...(rules.cg.classes[key] || {}) };
  }
  if (rules.alThreshold == null) rules.alThreshold = defaults.alThreshold;
  return rules;
}

export function computeTaxRegimePure(regime, income, rules, deductions = { chapterVIA: 0, hra: 0, total: 0 }) {
  const bands = regime === "new" ? rules.newSlabs : rules.oldSlabs;
  const standardDeduction = rules.stdDeduction[regime];
  const limit = rules.rebate[`${regime}Limit`];
  const maxRebate = rules.rebate[`${regime}Max`];
  const grossNormal = income.salary + income.interest + income.dividend + income.other + income.slabGains + income.fdAccrued;
  const taxable = Math.max(0, grossNormal - standardDeduction - deductions.total);
  const slabTaxAmount = slabTax(taxable, bands);
  const rebate = rebateAndRelief(taxable, slabTaxAmount, limit, maxRebate);
  const cess = rebate.taxAfter * rules.cess;
  return { grossNormal, std: standardDeduction, ded: deductions, taxable, slabTaxAmt: slabTaxAmount, rebate: rebate.rebate, relief: rebate.relief, taxAfter: rebate.taxAfter, cess, total: rebate.taxAfter + cess, bands, limit, maxRebate };
}
