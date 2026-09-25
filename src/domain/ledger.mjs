export function transactionType(transaction, kinds) {
  if (transaction.type) return transaction.type;
  return kinds[transaction.kind]?.t || "Expense";
}

export function transactionCashFlow(transaction, kinds) {
  if (transaction.cf) return transaction.cf;
  return kinds[transaction.kind]?.cf || "Operating";
}

export function validateTransaction(transaction, kinds, externalAccount) {
  const type = transactionType(transaction, kinds);
  const kind = kinds[transaction.kind] || {};
  if (!(Number(transaction.amt) > 0)) return { ok: false, msg: "Amount must be > 0" };
  if (transaction.from === transaction.to) return { ok: false, msg: "From = To not allowed" };
  if (type === "Expense" && transaction.to !== externalAccount) return { ok: false, msg: "Expense must go To External" };
  if (type === "Expense" && transaction.from === externalAccount) return { ok: false, msg: "Expense From cannot be External" };
  if (type === "Income" && transaction.from !== externalAccount) return { ok: false, msg: "Income must come From External" };
  if (type === "Income" && transaction.to === externalAccount) return { ok: false, msg: "Income To cannot be External" };
  if (type === "Transfer" && (transaction.from === externalAccount || transaction.to === externalAccount)) {
    return { ok: false, msg: "Transfer cannot touch External" };
  }
  if (kind.cr && !transaction.cat) return { ok: false, msg: "Category required for this kind" };
  return { ok: true };
}

const monthOf = value => String(value || "").slice(0, 7);

export function calculateLedger(state, kinds) {
  const accounts = state.accounts || [];
  const transactions = state.txns || [];
  const categories = state.cats || [];
  const holdings = state.holdings || [];
  const incoming = {}, outgoing = {};
  accounts.forEach(account => { incoming[account.name] = 0; outgoing[account.name] = 0; });
  transactions.forEach(transaction => {
    const amount = Number(transaction.amt) || 0;
    if (transaction.to in incoming) incoming[transaction.to] += amount;
    if (transaction.from in outgoing) outgoing[transaction.from] += amount;
  });
  const balances = {};
  accounts.forEach(account => { balances[account.name] = (Number(account.open) || 0) + incoming[account.name] - outgoing[account.name]; });
  const byKind = kind => accounts.filter(account => account.kind === kind).reduce((sum, account) => sum + balances[account.name], 0);
  const investmentAccounts = accounts.filter(account => account.kind === "Investment").map(account => account.name);
  const securitiesByAccount = Object.fromEntries(investmentAccounts.map(name => [name, 0]));
  const computedHoldings = [];
  holdings.forEach((holding, index) => {
    if (holding.cls === "Cash") return;
    const invested = holding.units != null && holding.avg != null ? holding.units * holding.avg : (holding.minv || 0);
    const current = holding.units != null && holding.price != null ? holding.units * holding.price : (holding.mval != null ? holding.mval : invested);
    computedHoldings.push({ ...holding, invested, current, plug: false, _i: index });
    if (holding.acct && securitiesByAccount[holding.acct] != null) securitiesByAccount[holding.acct] += invested;
  });
  investmentAccounts.forEach(name => {
    const plug = balances[name] - (securitiesByAccount[name] || 0);
    if (Math.abs(plug) >= 1) computedHoldings.push({ cls: "Cash", type: "Broker Cash", name: `${name} uninvested cash`, acct: name, units: null, invested: plug, current: plug, plug: true });
  });
  const portfolioInvested = computedHoldings.reduce((sum, holding) => sum + holding.invested, 0);
  const portfolioCurrent = computedHoldings.reduce((sum, holding) => sum + holding.current, 0);
  const bank = byKind("Bank"), cash = byKind("Cash"), receivable = byKind("Receivable");
  const clearing = byKind("Clearing"), deposit = byKind("Deposit");
  const creditCard = -byKind("Credit Card"), loan = -byKind("Loan");
  const currentAssets = bank + cash + receivable + clearing;
  const totalAssets = currentAssets + portfolioCurrent + deposit;
  const totalLiabilities = creditCard + loan;
  const netWorth = totalAssets - totalLiabilities;
  const months = [...new Set(transactions.map(transaction => monthOf(transaction.date)).filter(Boolean))].sort();
  const typeOf = transaction => transactionType(transaction, kinds);
  const categoryOf = transaction => categories.find(category => category.name === transaction.cat) || {};
  const sumMonthly = predicate => {
    const result = Object.fromEntries(months.map(month => [month, 0]));
    let total = 0;
    transactions.forEach(transaction => {
      if (!predicate(transaction)) return;
      const amount = Number(transaction.amt) || 0, month = monthOf(transaction.date);
      if (month in result) result[month] += amount;
      total += amount;
    });
    result._t = total;
    return result;
  };
  const incomeStatement = { months };
  incomeStatement.rec = sumMonthly(x => typeOf(x) === "Income" && (x.inc || categoryOf(x).incclass) === "Recurring");
  incomeStatement.win = sumMonthly(x => typeOf(x) === "Income" && (x.inc || categoryOf(x).incclass) === "Windfall");
  incomeStatement.rev = sumMonthly(x => typeOf(x) === "Income");
  incomeStatement.ess = sumMonthly(x => typeOf(x) === "Expense" && (x.ess || categoryOf(x).essdisc) === "Essential");
  incomeStatement.disc = sumMonthly(x => typeOf(x) === "Expense" && (x.ess || categoryOf(x).essdisc) === "Discretionary");
  incomeStatement.exp = sumMonthly(x => typeOf(x) === "Expense");
  incomeStatement.net = { _t: incomeStatement.rev._t - incomeStatement.exp._t };
  months.forEach(month => { incomeStatement.net[month] = incomeStatement.rev[month] - incomeStatement.exp[month]; });
  incomeStatement.incRows = categories.filter(x => x.applies === "Income").map(category => ({ cat: category.name, grp: category.incclass || "Other", m: sumMonthly(x => x.cat === category.name && typeOf(x) === "Income") }));
  incomeStatement.expRows = categories.filter(x => x.applies === "Expense").map(category => ({ cat: category.name, grp: category.essdisc || "Other", m: sumMonthly(x => x.cat === category.name && typeOf(x) === "Expense") }));
  const accountKind = name => accounts.find(account => account.name === name)?.kind || "";
  const isCash = name => accountKind(name) === "Bank" || accountKind(name) === "Cash";
  const cashFlowBucket = bucket => transactions.filter(x => transactionCashFlow(x, kinds) === bucket)
    .reduce((sum, x) => sum + (isCash(x.to) ? Number(x.amt) || 0 : 0) - (isCash(x.from) ? Number(x.amt) || 0 : 0), 0);
  const beginningCash = accounts.filter(x => x.kind === "Bank" || x.kind === "Cash").reduce((sum, x) => sum + (Number(x.open) || 0), 0);
  const cashFlow = { begin: beginningCash, op: cashFlowBucket("Operating"), inv: cashFlowBucket("Investing"), fin: cashFlowBucket("Financing"), int: cashFlowBucket("Internal") };
  cashFlow.net = cashFlow.op + cashFlow.inv + cashFlow.fin + cashFlow.int;
  cashFlow.end = cashFlow.begin + cashFlow.net;
  cashFlow.bsCash = bank + cash;
  cashFlow.chk = cashFlow.end - cashFlow.bsCash;
  const monthCount = months.length || 1, averageMonthly = incomeStatement.exp._t / monthCount;
  const ratios = {
    liquid: bank + cash, avgMo: averageMonthly, runway: (bank + cash) / (averageMonthly || 1),
    curRatio: totalLiabilities ? currentAssets / totalLiabilities : null,
    dNW: netWorth ? totalLiabilities / netWorth : null,
    dInc: incomeStatement.rev._t ? totalLiabilities / incomeStatement.rev._t : null,
    saveCore: incomeStatement.rec._t ? (incomeStatement.rec._t - incomeStatement.exp._t) / incomeStatement.rec._t : null,
    saveAll: incomeStatement.rev._t ? incomeStatement.net._t / incomeStatement.rev._t : null,
    ret: portfolioInvested ? (portfolioCurrent - portfolioInvested) / portfolioInvested : null,
    wc: currentAssets - totalLiabilities,
    empRecv: balances["Employer Receivable"] || 0,
    reimb: transactions.filter(x => x.kind === "Reimbursable Spend (Claim)").reduce((sum, x) => sum + (Number(x.amt) || 0), 0)
  };
  ratios.dso = ratios.reimb ? ratios.empRecv / ratios.reimb * 365 : null;
  return {
    bal: balances, byKind, holds: computedHoldings, bank, cash, recv: receivable, clr: clearing, dep: deposit,
    cc: creditCard, loan, curAssets: currentAssets, totAssets: totalAssets, totLiab: totalLiabilities,
    netWorth, portInv: portfolioInvested, portCur: portfolioCurrent, IS: incomeStatement, CF: cashFlow, R: ratios, months
  };
}
