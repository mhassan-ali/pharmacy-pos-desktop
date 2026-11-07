const app = require('express')();
const moment = require('moment');
const { db, pkr } = require('./sqlite');
const { formatStockPacks } = require('./pack-helpers');

function toKarachiMonth(isoStr) {
  if (!isoStr) return '';
  return moment(isoStr).utcOffset('+05:00').format('YYYY-MM');
}

function toKarachiDate(isoStr) {
  if (!isoStr) return '';
  return moment(isoStr).utcOffset('+05:00').format('YYYY-MM-DD');
}

function getCategoryMap() {
  const map = new Map();
  try {
    const rows = db.prepare('SELECT id, name FROM categories').all();
    for (const r of rows) {
      map.set(Number(r.id), r.name);
      map.set(String(r.id), r.name);
    }
  } catch (e) {
    console.error('Error loading categories:', e);
  }
  return map;
}

function resolveCategoryName(catVal, categoryMap) {
  if (catVal === null || catVal === undefined) return 'Uncategorized';
  const str = String(catVal).trim();
  if (!str || str === '0') return 'Uncategorized';

  if (/^\d+$/.test(str)) {
    const numId = parseInt(str, 10);
    if (categoryMap && categoryMap.has(numId)) {
      return categoryMap.get(numId);
    }
    return 'Uncategorized';
  }

  return str;
}

function getSupplierMap() {
  const map = new Map();
  try {
    const rows = db.prepare('SELECT id, name FROM suppliers').all();
    for (const r of rows) {
      map.set(Number(r.id), r.name);
      map.set(String(r.id), r.name);
    }
  } catch (e) {
    console.error('Error loading suppliers:', e);
  }
  return map;
}

function resolveSupplierName(suppVal, supplierMap) {
  if (suppVal === null || suppVal === undefined) return '-';
  const str = String(suppVal).trim();
  if (!str || str === '0') return '-';

  if (/^\d+$/.test(str)) {
    const numId = parseInt(str, 10);
    if (supplierMap && supplierMap.has(numId)) {
      return supplierMap.get(numId);
    }
    return '-';
  }

  return str;
}

const COSTED_SALES_SUBQUERY = `
  SELECT c_sub.sale_id
  FROM sale_batch_cogs c_sub
  GROUP BY c_sub.sale_id
  HAVING COUNT(*) > 0 AND MIN(c_sub.cost_known) = 1
`;

function parseKarachiDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return { error: `Invalid date format: "${str}". Expected YYYY-MM-DD.` };
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12) {
    return { error: `Invalid month: ${month}. Must be between 1 and 12.` };
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { error: `Invalid day: ${day} for month ${month}/${year}.` };
  }
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const normalized = `${year}-${paddedMonth}-${paddedDay}`;
  const startIso = new Date(`${normalized}T00:00:00.000+05:00`).toISOString();
  const endIso = new Date(`${normalized}T23:59:59.999+05:00`).toISOString();
  return { year, month, day, normalized, startIso, endIso };
}

function parseKarachiRange(startStr, endStr) {
  let startIso = null;
  let endIso = null;
  let normalizedStart = null;
  let normalizedEnd = null;

  if (startStr !== undefined && startStr !== null && String(startStr).trim() !== '') {
    const res = parseKarachiDate(String(startStr));
    if (res.error) return { error: res.error };
    startIso = res.startIso;
    normalizedStart = res.normalized;
  }

  if (endStr !== undefined && endStr !== null && String(endStr).trim() !== '') {
    const res = parseKarachiDate(String(endStr));
    if (res.error) return { error: res.error };
    endIso = res.endIso;
    normalizedEnd = res.normalized;
  }

  if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
    return { error: `Start date (${normalizedStart}) cannot be after end date (${normalizedEnd}).` };
  }

  return { startIso, endIso, normalizedStart, normalizedEnd };
}

function requireFinancialPerm(req, res, next) {
  const auth = req.authUser;
  if (!auth || (auth._id !== 1 && auth.perm_transactions !== 1)) {
    return res.status(403).json({ error: 'Permission denied', message: 'You do not have permission to access financial and profit reports.' });
  }
  next();
}

/**
 * Helper: Computes monthly profit data across all months or filtered range.
 */
function computeMonthlyProfitData(startMonth = null, endMonth = null) {
  // Group by Karachi month
  const salesRows = db.prepare(`
    SELECT 
      strftime('%Y-%m', datetime(s.date, '+5 hours')) AS month,
      COUNT(DISTINCT s.id) AS total_bills,
      COALESCE(SUM(s.total_cents), 0) AS total_sales_cents,
      COALESCE(SUM(s.paid_cents), 0) AS paid_sales_cents,
      COALESCE(SUM(CASE WHEN s.paid_cents >= s.total_cents THEN s.total_cents ELSE 0 END), 0) AS cash_sales_cents,
      COALESCE(SUM(CASE WHEN s.paid_cents = 0 THEN s.total_cents ELSE 0 END), 0) AS credit_sales_cents,
      COALESCE(SUM(CASE WHEN s.paid_cents > 0 AND s.paid_cents < s.total_cents THEN s.total_cents ELSE 0 END), 0) AS mixed_sales_cents
    FROM sales s
    WHERE s.status = 1
    GROUP BY month
    ORDER BY month ASC
  `).all();

  const costedSalesRows = db.prepare(`
    SELECT 
      strftime('%Y-%m', datetime(s.date, '+5 hours')) AS month,
      COUNT(DISTINCT s.id) AS costed_bills,
      COALESCE(SUM(s.total_cents), 0) AS costed_sales_cents
    FROM sales s
    WHERE s.status = 1
      AND s.id IN (${COSTED_SALES_SUBQUERY})
    GROUP BY month
  `).all();

  const cogsRows = db.prepare(`
    SELECT 
      strftime('%Y-%m', datetime(s.date, '+5 hours')) AS month,
      COALESCE(SUM(c.cost_cents), 0) AS cogs_cents
    FROM sale_batch_cogs c
    JOIN sales s ON s.id = c.sale_id
    WHERE s.status = 1
      AND s.id IN (${COSTED_SALES_SUBQUERY})
    GROUP BY month
  `).all();

  const returnsRows = db.prepare(`
    SELECT 
      strftime('%Y-%m', datetime(r.return_date, '+5 hours')) AS month,
      COALESCE(SUM(r.refund_cents), 0) AS return_refund_cents,
      COALESCE(SUM(CASE WHEN r.sale_id IN (${COSTED_SALES_SUBQUERY}) THEN r.refund_cents ELSE 0 END), 0) AS costed_return_refund_cents,
      COALESCE(SUM(CASE WHEN r.sale_id IN (${COSTED_SALES_SUBQUERY}) AND r.return_to_stock = 1 THEN COALESCE(r.base_quantity, r.quantity) * IFNULL(c.unit_cost_cents, 0) ELSE 0 END), 0) AS return_cogs_cents
    FROM sales_returns r
    LEFT JOIN sale_batch_cogs c ON c.sale_id = r.sale_id AND c.product_id = r.product_id AND c.cost_known = 1
    GROUP BY month
  `).all();

  const expensesRows = db.prepare(`
    SELECT 
      strftime('%Y-%m', datetime(e.expense_date, '+5 hours')) AS month,
      COALESCE(SUM(e.amount_cents), 0) AS expenses_cents
    FROM expenses e
    GROUP BY month
  `).all();

  // Consolidate into a map by month
  const monthMap = new Map();
  function getEntry(m) {
    if (!monthMap.has(m)) {
      monthMap.set(m, {
        month: m,
        bills: 0,
        totalSalesCents: 0,
        costedBills: 0,
        costedSalesCents: 0,
        cashSalesCents: 0,
        creditSalesCents: 0,
        mixedSalesCents: 0,
        returnRefundCents: 0,
        costedReturnRefundCents: 0,
        cogsCents: 0,
        returnCogsCents: 0,
        expensesCents: 0
      });
    }
    return monthMap.get(m);
  }

  salesRows.forEach(r => {
    const e = getEntry(r.month);
    e.bills = Number(r.total_bills);
    e.totalSalesCents = Number(r.total_sales_cents);
    e.cashSalesCents = Number(r.cash_sales_cents);
    e.creditSalesCents = Number(r.credit_sales_cents);
    e.mixedSalesCents = Number(r.mixed_sales_cents);
  });

  costedSalesRows.forEach(r => {
    const e = getEntry(r.month);
    e.costedBills = Number(r.costed_bills);
    e.costedSalesCents = Number(r.costed_sales_cents);
  });

  cogsRows.forEach(r => {
    const e = getEntry(r.month);
    e.cogsCents = Number(r.cogs_cents);
  });

  returnsRows.forEach(r => {
    const e = getEntry(r.month);
    e.returnRefundCents = Number(r.return_refund_cents);
    e.costedReturnRefundCents = Number(r.costed_return_refund_cents);
    e.returnCogsCents = Number(r.return_cogs_cents);
  });

  expensesRows.forEach(r => {
    const e = getEntry(r.month);
    e.expensesCents = Number(r.expenses_cents);
  });

  return monthMap;
}

// ----------------------------------------------------------------------------
// 1. DASHBOARD PROFIT SUMMARY
// ----------------------------------------------------------------------------
app.get('/dashboard-profit', requireFinancialPerm, (_req, res) => {
  try {
    const currentMonth = moment().utcOffset('+05:00').format('YYYY-MM');
    const prevMonth = moment().utcOffset('+05:00').subtract(1, 'month').format('YYYY-MM');

    // Build list of last 12 months up to current
    const monthsList = [];
    for (let i = 11; i >= 0; i--) {
      monthsList.push(moment().utcOffset('+05:00').subtract(i, 'months').format('YYYY-MM'));
    }

    const monthMap = computeMonthlyProfitData();

    function formatMonthData(m) {
      const e = monthMap.get(m) || {
        month: m, bills: 0, totalSalesCents: 0, costedBills: 0, costedSalesCents: 0,
        cashSalesCents: 0, creditSalesCents: 0, mixedSalesCents: 0, returnRefundCents: 0,
        costedReturnRefundCents: 0, cogsCents: 0, returnCogsCents: 0, expensesCents: 0
      };

      const netSalesCents = Math.max(0, e.totalSalesCents - e.returnRefundCents);
      const knownSalesCents = Math.max(0, e.costedSalesCents - e.costedReturnRefundCents);
      const unknownSalesCents = Math.max(0, netSalesCents - knownSalesCents);
      const unknownSalesCount = Math.max(0, e.bills - e.costedBills);
      const netCogsCents = Math.max(0, e.cogsCents - e.returnCogsCents);

      const isIncomplete = unknownSalesCount > 0;

      let grossProfit = '—';
      let grossProfitCents = null;
      let grossMarginPct = null;
      let cogs = '—';

      if (knownSalesCents > 0) {
        grossProfitCents = knownSalesCents - netCogsCents;
        grossProfit = pkr(grossProfitCents);
        grossMarginPct = Number(((grossProfitCents / knownSalesCents) * 100).toFixed(1));
        cogs = pkr(netCogsCents);
      }

      let netProfit = '—';
      let netProfitCents = null;
      let marginPct = null;

      if (!isIncomplete) {
        netProfitCents = (grossProfitCents !== null ? grossProfitCents : 0) - e.expensesCents;
        netProfit = pkr(netProfitCents);
        marginPct = knownSalesCents > 0
          ? Number(((netProfitCents / knownSalesCents) * 100).toFixed(1))
          : 0;
      }

      return {
        month: m,
        monthLabel: moment(m, 'YYYY-MM').format('MMM YYYY'),
        bills: e.bills,
        knownBills: e.costedBills,
        sales: pkr(netSalesCents),
        salesCents: netSalesCents,
        knownSales: pkr(knownSalesCents),
        knownSalesCents: knownSalesCents,
        cogs: cogs,
        cogsCents: knownSalesCents > 0 ? netCogsCents : 0,
        grossProfit: grossProfit,
        grossProfitCents: grossProfitCents,
        grossMarginPct: grossMarginPct,
        expenses: pkr(e.expensesCents),
        expensesCents: e.expensesCents,
        netProfit: netProfit,
        netProfitCents: netProfitCents,
        marginPct: marginPct,
        unknownCount: unknownSalesCount,
        unknownAmount: pkr(unknownSalesCents),
        unknownAmountCents: unknownSalesCents,
        isIncomplete: isIncomplete
      };
    }

    const thisMonthData = formatMonthData(currentMonth);
    const prevMonthData = formatMonthData(prevMonth);

    // Calculate changes vs previous month (show '—' if either is incomplete or <= 0)
    function pctChange(currVal, prevVal, currIncomplete = false, prevIncomplete = false) {
      if (currIncomplete || prevIncomplete) return '—';
      if (prevVal === null || currVal === null || prevVal === undefined || currVal === undefined) return '—';
      if (prevVal <= 0 || currVal <= 0) return '—';
      const pct = ((currVal - prevVal) / Math.abs(prevVal)) * 100;
      return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    }

    thisMonthData.salesChange = pctChange(thisMonthData.salesCents, prevMonthData.salesCents);
    thisMonthData.grossProfitChange = pctChange(thisMonthData.grossProfitCents, prevMonthData.grossProfitCents);
    thisMonthData.expensesChange = pctChange(thisMonthData.expensesCents, prevMonthData.expensesCents);
    thisMonthData.netProfitChange = pctChange(thisMonthData.netProfitCents, prevMonthData.netProfitCents, thisMonthData.isIncomplete, prevMonthData.isIncomplete);

    const last12Months = monthsList.map(formatMonthData);

    res.json({
      thisMonth: thisMonthData,
      previousMonth: prevMonthData,
      last12Months: last12Months
    });
  } catch (error) {
    console.error('Dashboard profit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 2. PROFIT & LOSS REPORT
// ----------------------------------------------------------------------------
app.get('/profit-loss', requireFinancialPerm, (req, res) => {
  try {
    const range = parseKarachiRange(req.query.start, req.query.end);
    if (range.error) {
      return res.status(400).json({ error: 'Invalid date parameter', message: range.error });
    }
    const { startIso, endIso } = range;
    let salesWhere = 's.status = 1';
    let expensesWhere = '1=1';
    let returnsWhere = '1=1';
    const paramsSales = [];
    const paramsExp = [];
    const paramsRet = [];

    if (startIso) {
      salesWhere += ' AND s.date >= ?';
      paramsSales.push(startIso);
      expensesWhere += ' AND e.expense_date >= ?';
      paramsExp.push(startIso);
      returnsWhere += ' AND r.return_date >= ?';
      paramsRet.push(startIso);
    }
    if (endIso) {
      salesWhere += ' AND s.date <= ?';
      paramsSales.push(endIso);
      expensesWhere += ' AND e.expense_date <= ?';
      paramsExp.push(endIso);
      returnsWhere += ' AND r.return_date <= ?';
      paramsRet.push(endIso);
    }

    // 1. Gross sales & all bills
    const salesAgg = db.prepare(`
      SELECT 
        COUNT(DISTINCT s.id) AS total_bills,
        COALESCE(SUM(s.total_cents), 0) AS total_sales_cents
      FROM sales s
      WHERE ${salesWhere}
    `).get(...paramsSales);

    // 2. Costed sales: ALL items in the sale have known cost
    const costedSalesAgg = db.prepare(`
      SELECT 
        COUNT(DISTINCT s.id) AS costed_bills,
        COALESCE(SUM(s.total_cents), 0) AS costed_sales_cents
      FROM sales s
      WHERE ${salesWhere}
        AND s.id IN (${COSTED_SALES_SUBQUERY})
    `).get(...paramsSales);

    // Parse data_json for total discounts given in period
    const allSalesData = db.prepare(`SELECT data_json, total_cents FROM sales s WHERE ${salesWhere}`).all(...paramsSales);
    let totalDiscountCents = 0;
    allSalesData.forEach(s => {
      try {
        const d = JSON.parse(s.data_json);
        if (d.discount) totalDiscountCents += Math.round(Number(d.discount) * 100);
      } catch (_) {}
    });

    // 3. Returns: total refunds, costed refunds, and return COGS
    const returnsAgg = db.prepare(`
      SELECT 
        COALESCE(SUM(r.refund_cents), 0) AS return_refund_cents,
        COALESCE(SUM(CASE WHEN r.sale_id IN (${COSTED_SALES_SUBQUERY}) THEN r.refund_cents ELSE 0 END), 0) AS costed_return_refund_cents,
        COALESCE(SUM(CASE WHEN r.sale_id IN (${COSTED_SALES_SUBQUERY}) AND r.return_to_stock = 1 THEN COALESCE(r.base_quantity, r.quantity) * IFNULL(c.unit_cost_cents, 0) ELSE 0 END), 0) AS return_cogs_cents
      FROM sales_returns r
      LEFT JOIN sale_batch_cogs c ON c.sale_id = r.sale_id AND c.product_id = r.product_id AND c.cost_known = 1
      WHERE ${returnsWhere}
    `).get(...paramsRet);

    // 4. COGS: ONLY from costed sales
    const cogsAgg = db.prepare(`
      SELECT COALESCE(SUM(c.cost_cents), 0) AS cogs_cents
      FROM sale_batch_cogs c
      JOIN sales s ON s.id = c.sale_id
      WHERE s.status = 1 AND ${salesWhere}
        AND s.id IN (${COSTED_SALES_SUBQUERY})
    `).get(...paramsSales);

    // 5. Expenses breakdown by category
    const expenseCats = db.prepare(`
      SELECT 
        ec.id AS category_id,
        ec.name AS category_name,
        COALESCE(SUM(e.amount_cents), 0) AS amount_cents
      FROM expense_categories ec
      LEFT JOIN expenses e ON e.category_id = ec.id AND ${expensesWhere}
      GROUP BY ec.id, ec.name
      ORDER BY amount_cents DESC
    `).all(...paramsExp);

    const totalExpenseCents = expenseCats.reduce((sum, c) => sum + Number(c.amount_cents), 0);

    const totalBills = Number(salesAgg.total_bills);
    const grossSalesCents = Number(salesAgg.total_sales_cents);
    const returnRefundCents = Number(returnsAgg.return_refund_cents);
    const netSalesCents = Math.max(0, grossSalesCents - returnRefundCents);

    const costedBills = Number(costedSalesAgg.costed_bills);
    const costedSalesCents = Number(costedSalesAgg.costed_sales_cents);
    const costedReturnRefundCents = Number(returnsAgg.costed_return_refund_cents);
    const knownSalesCents = Math.max(0, costedSalesCents - costedReturnRefundCents);

    const unknownCount = Math.max(0, totalBills - costedBills);
    const unknownSalesCents = Math.max(0, netSalesCents - knownSalesCents);

    const netCogsCents = Math.max(0, Number(cogsAgg.cogs_cents) - Number(returnsAgg.return_cogs_cents));
    const isIncomplete = unknownCount > 0;

    let grossProfit = '—';
    let grossProfitCents = null;
    let grossMarginPct = '—';
    let cogs = '—';

    if (knownSalesCents > 0) {
      grossProfitCents = knownSalesCents - netCogsCents;
      grossProfit = pkr(grossProfitCents);
      grossMarginPct = ((grossProfitCents / knownSalesCents) * 100).toFixed(1) + '%';
      cogs = pkr(netCogsCents);
    }

    let netProfit = '—';
    let netProfitCents = null;
    let marginPct = '—';

    if (!isIncomplete) {
      netProfitCents = (grossProfitCents !== null ? grossProfitCents : 0) - totalExpenseCents;
      netProfit = pkr(netProfitCents);
      marginPct = knownSalesCents > 0
        ? ((netProfitCents / knownSalesCents) * 100).toFixed(1) + '%'
        : '0.0%';
    }

    res.json({
      summary: {
        totalBills,
        grossSales: pkr(grossSalesCents),
        discountsGiven: pkr(totalDiscountCents),
        returnsRefunds: pkr(returnRefundCents),
        netSales: pkr(netSalesCents),
        knownSales: pkr(knownSalesCents),
        knownBills: costedBills,
        cogs: cogs,
        cogsCents: knownSalesCents > 0 ? netCogsCents : 0,
        grossProfit: grossProfit,
        grossProfitCents: grossProfitCents,
        grossMarginPct: grossMarginPct,
        expenses: pkr(totalExpenseCents),
        expensesCents: totalExpenseCents,
        netProfit: netProfit,
        netProfitCents: netProfitCents,
        marginPct: marginPct,
        unknownCount,
        unknownAmount: pkr(unknownSalesCents),
        unknownAmountCents: unknownSalesCents,
        isIncomplete: isIncomplete,
        incompleteReason: isIncomplete
          ? `${unknownCount} sales missing purchase cost. Net profit cannot be determined accurately until purchase bills are entered.`
          : null
      },
      expensesByCategory: expenseCats.map(c => ({
        categoryId: c.category_id,
        categoryName: c.category_name,
        amount: pkr(c.amount_cents),
        amountCents: Number(c.amount_cents),
        percentage: totalExpenseCents > 0 ? ((Number(c.amount_cents) / totalExpenseCents) * 100).toFixed(1) + '%' : '0.0%'
      }))
    });
  } catch (error) {
    console.error('Profit & loss report error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/sales', (req, res) => {
  try {
    const range = parseKarachiRange(req.query.start, req.query.end);
    if (range.error) {
      return res.status(400).json({ error: 'Invalid date parameter', message: range.error });
    }
    const { startIso, endIso } = range;
    const groupBy = req.query.groupBy === 'month' ? 'month' : 'day';
    let where = 's.status = 1';
    const params = [];
    if (startIso) {
      where += ' AND s.date >= ?';
      params.push(startIso);
    }
    if (endIso) {
      where += ' AND s.date <= ?';
      params.push(endIso);
    }

    const groupFmt = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';

    const rows = db.prepare(`
      SELECT 
        strftime('${groupFmt}', datetime(s.date, '+5 hours')) AS period,
        COUNT(DISTINCT s.id) AS bills,
        COALESCE(SUM(s.total_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN s.paid_cents >= s.total_cents THEN s.total_cents ELSE 0 END), 0) AS cash_cents,
        COALESCE(SUM(CASE WHEN s.paid_cents = 0 THEN s.total_cents ELSE 0 END), 0) AS khata_cents,
        COALESCE(SUM(CASE WHEN s.paid_cents > 0 AND s.paid_cents < s.total_cents THEN s.total_cents ELSE 0 END), 0) AS mixed_cents
      FROM sales s
      WHERE ${where}
      GROUP BY period
      ORDER BY period DESC
    `).all(...params);

    const cashierRows = db.prepare(`
      SELECT 
        u.id AS user_id,
        COALESCE(u.fullname, u.username, 'Unknown') AS user_name,
        COUNT(DISTINCT s.id) AS bills,
        COALESCE(SUM(s.total_cents), 0) AS total_cents
      FROM sales s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE ${where}
      GROUP BY u.id, user_name
      ORDER BY total_cents DESC
    `).all(...params);

    const summary = rows.reduce((acc, r) => {
      acc.totalBills += Number(r.bills);
      acc.totalSalesCents += Number(r.total_cents);
      acc.cashSalesCents += Number(r.cash_cents);
      acc.khataSalesCents += Number(r.khata_cents);
      acc.mixedSalesCents += Number(r.mixed_cents);
      return acc;
    }, { totalBills: 0, totalSalesCents: 0, cashSalesCents: 0, khataSalesCents: 0, mixedSalesCents: 0 });

    res.json({
      summary: {
        totalBills: summary.totalBills,
        totalSales: pkr(summary.totalSalesCents),
        cashSales: pkr(summary.cashSalesCents),
        khataSales: pkr(summary.khataSalesCents),
        mixedSales: pkr(summary.mixedSalesCents)
      },
      rows: rows.map(r => ({
        period: r.period,
        bills: Number(r.bills),
        totalSales: pkr(r.total_cents),
        cashSales: pkr(r.cash_cents),
        khataSales: pkr(r.khata_cents),
        mixedSales: pkr(r.mixed_cents)
      })),
      cashiers: cashierRows.map(c => ({
        userId: c.user_id,
        userName: c.user_name,
        bills: Number(c.bills),
        totalSales: pkr(c.total_cents)
      }))
    });
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 4. EXPENSES REPORT
// ----------------------------------------------------------------------------
app.get('/expenses', (req, res) => {
  try {
    const range = parseKarachiRange(req.query.start, req.query.end);
    if (range.error) {
      return res.status(400).json({ error: 'Invalid date parameter', message: range.error });
    }
    const { startIso, endIso } = range;
    let where = '1=1';
    const params = [];
    if (startIso) {
      where += ' AND e.expense_date >= ?';
      params.push(startIso);
    }
    if (endIso) {
      where += ' AND e.expense_date <= ?';
      params.push(endIso);
    }
    if (req.query.category_id) {
      where += ' AND e.category_id = ?';
      params.push(Number(req.query.category_id));
    }

    const rows = db.prepare(`
      SELECT 
        e.id, e.expense_number, e.expense_date, e.amount_cents,
        e.payment_method, e.description, e.reference_number,
        ec.name AS category_name,
        COALESCE(u.fullname, u.username, 'Admin') AS user_name
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      LEFT JOIN users u ON u.id = e.user_id
      WHERE ${where}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT 1000
    `).all(...params);

    const totalCents = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);

    const catSummary = db.prepare(`
      SELECT ec.name AS category, COALESCE(SUM(e.amount_cents), 0) AS total_cents, COUNT(e.id) AS count
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      WHERE ${where}
      GROUP BY ec.name
      ORDER BY total_cents DESC
    `).all(...params);

    res.json({
      summary: {
        totalCount: rows.length,
        totalAmount: pkr(totalCents),
        byCategory: catSummary.map(c => ({
          category: c.category,
          amount: pkr(c.total_cents),
          count: Number(c.count)
        }))
      },
      rows: rows.map(r => ({
        id: r.id,
        expenseNumber: r.expense_number,
        date: toKarachiDate(r.expense_date),
        category: r.category_name,
        description: r.description || '-',
        paymentMethod: r.payment_method.toUpperCase(),
        amount: pkr(r.amount_cents),
        amountCents: Number(r.amount_cents),
        user: r.user_name
      }))
    });
  } catch (error) {
    console.error('Expenses report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 5. STOCK VALUATION REPORT
// ----------------------------------------------------------------------------
app.get('/stock-valuation', requireFinancialPerm, (req, res) => {
  try {
    const categoryMap = getCategoryMap();
    const supplierMap = getSupplierMap();

    let where = 'p.stock_tracked = 1';
    const params = [];
    if (req.query.category) {
      where += ' AND p.category = ?';
      params.push(String(req.query.category));
    }
    if (req.query.supplier) {
      where += ' AND p.supplier = ?';
      params.push(String(req.query.supplier));
    }

    const prods = db.prepare(`
      SELECT 
        p.id, p.barcode, p.name, p.category, p.supplier, p.price_cents,
        p.base_unit, p.units_per_strip, p.units_per_box,
        i.quantity,
        (
          SELECT unit_cost_cents FROM inventory_batches b
          WHERE b.product_id = p.id AND b.unit_cost_cents > 0
          ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1
        ) AS batch_unit_cost_cents,
        (
          SELECT SUM(
            CASE
              WHEN b.total_cost_cents IS NOT NULL AND b.total_cost_cents > 0
              THEN (b.total_cost_cents - b.cumulative_cost_cents)
              ELSE (b.quantity_available * IFNULL(b.unit_cost_cents, 0))
            END
          )
          FROM inventory_batches b
          WHERE b.product_id = p.id AND b.quantity_available > 0
        ) AS batch_remaining_cost_cents
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE ${where}
      ORDER BY p.name ASC
    `).all(...params);

    let totalQty = 0;
    let totalCostValCents = 0;
    let totalRetailValCents = 0;

    const rows = prods.map(p => {
      const qty = Number(p.quantity || 0);
      const retailPriceCents = Number(p.price_cents || 0);
      const unitCostCents = Number(p.batch_unit_cost_cents || 0);
      const costValCents = p.batch_remaining_cost_cents != null ? Number(p.batch_remaining_cost_cents) : (qty * unitCostCents);
      const retailValCents = qty * retailPriceCents;
      const potProfitCents = retailValCents - costValCents;
      const marginPct = retailValCents > 0 ? ((potProfitCents / retailValCents) * 100).toFixed(1) : '0.0';

      totalQty += qty;
      totalCostValCents += costValCents;
      totalRetailValCents += retailValCents;

      const catName = resolveCategoryName(p.category, categoryMap);
      const suppName = resolveSupplierName(p.supplier, supplierMap);

      return {
        id: p.id,
        barcode: p.barcode || '-',
        name: p.name,
        productName: p.name,
        medicineName: p.name,
        category: catName,
        supplier: suppName,
        quantity: qty,
        pack_display: formatStockPacks(qty, p.units_per_box, p.units_per_strip, p.base_unit),
        unitCost: unitCostCents > 0 ? pkr(unitCostCents) : 'Unknown',
        unitPrice: pkr(retailPriceCents),
        retailPrice: pkr(retailPriceCents),
        totalCost: pkr(costValCents),
        costValue: pkr(costValCents),
        totalRetail: pkr(retailValCents),
        retailValue: pkr(retailValCents),
        potentialProfit: pkr(potProfitCents),
        potentialGrossProfit: pkr(potProfitCents),
        potentialProfitCents: potProfitCents,
        marginPct: marginPct + '%',
        overallMarginPct: marginPct
      };
    });

    const potProfitCents = totalRetailValCents - totalCostValCents;
    const marginPct = totalRetailValCents > 0 ? ((potProfitCents / totalRetailValCents) * 100).toFixed(1) : '0.0';

    res.json({
      summary: {
        totalMedicines: rows.length,
        totalQuantity: totalQty,
        totalCostValue: pkr(totalCostValCents),
        totalRetailValue: pkr(totalRetailValCents),
        potentialProfit: pkr(potProfitCents),
        potentialGrossProfit: pkr(potProfitCents),
        potentialProfitCents: potProfitCents,
        marginPct: marginPct + '%',
        overallMarginPct: marginPct
      },
      rows,
      medicines: rows
    });
  } catch (error) {
    console.error('Stock valuation report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 6. EXPIRY REPORT
// ----------------------------------------------------------------------------
app.get('/expiry', (req, res) => {
  try {
    const bucket = req.query.bucket || 'all'; // all, expired, 30, 60, 90
    const today = moment().utcOffset('+05:00').startOf('day');
    const supplierMap = getSupplierMap();

    const batches = db.prepare(`
      SELECT 
        b.id AS batch_id, b.product_id, b.supplier_id, b.batch_number, b.expiry_date,
        b.quantity_available, b.unit_cost_cents,
        p.name AS product_name, p.barcode, p.supplier AS product_supplier,
        p.base_unit, p.units_per_strip, p.units_per_box,
        COALESCE(s.name, p.supplier, 'N/A') AS supplier_name
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.quantity_available > 0
      ORDER BY b.expiry_date ASC, b.id ASC
    `).all();

    let expiredCount = 0;
    let expiredValueCents = 0;
    let exp30Count = 0;
    let exp30ValueCents = 0;
    let exp60Count = 0;
    let exp60ValueCents = 0;
    let exp90Count = 0;
    let exp90ValueCents = 0;

    const mapped = [];
    batches.forEach(b => {
      const expMoment = moment(b.expiry_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']).startOf('day');
      const daysLeft = expMoment.diff(today, 'days');
      const qty = Number(b.quantity_available);
      const unitCost = Number(b.unit_cost_cents || 0);
      const valCents = qty * unitCost;

      let status = 'Valid';
      let riskLevel = 'good';
      let inBucket = false;

      if (daysLeft < 0) {
        status = 'Expired';
        riskLevel = 'expired';
        expiredCount += qty;
        expiredValueCents += valCents;
        if (bucket === 'expired' || bucket === 'all') inBucket = true;
      } else if (daysLeft <= 30) {
        status = 'Expiring in <= 30 Days';
        riskLevel = '30_days';
        exp30Count += qty;
        exp30ValueCents += valCents;
        if (bucket === '30' || bucket === 'all') inBucket = true;
      } else if (daysLeft <= 60) {
        status = 'Expiring in <= 60 Days';
        riskLevel = '60_days';
        exp60Count += qty;
        exp60ValueCents += valCents;
        if (bucket === '60' || bucket === 'all') inBucket = true;
      } else if (daysLeft <= 90) {
        status = 'Expiring in <= 90 Days';
        riskLevel = '90_days';
        exp90Count += qty;
        exp90ValueCents += valCents;
        if (bucket === '90' || bucket === 'all') inBucket = true;
      } else {
        status = 'Good';
        riskLevel = 'good';
        if (bucket === 'all') inBucket = true;
      }

      if (inBucket) {
        const suppDisplay = resolveSupplierName(b.supplier_id || b.supplier_name || b.product_supplier, supplierMap);
        mapped.push({
          batchId: b.batch_id,
          productId: b.product_id,
          name: b.product_name,
          productName: b.product_name,
          medicineName: b.product_name,
          barcode: b.barcode || '-',
          batchNumber: b.batch_number || '-',
          supplier: suppDisplay,
          expiryDate: expMoment.format('DD-MMM-YYYY'),
          daysLeft: daysLeft,
          daysUntilExpiry: daysLeft,
          quantity: qty,
          pack_display: formatStockPacks(qty, b.units_per_box, b.units_per_strip, b.base_unit),
          unitCost: unitCost > 0 ? pkr(unitCost) : 'Unknown',
          totalCostValue: pkr(valCents),
          costValue: pkr(valCents),
          status: status,
          riskLevel: riskLevel,
          isExpired: daysLeft < 0
        });
      }
    });

    const atRiskBatches = expiredCount + exp30Count + exp60Count + exp90Count;
    const atRiskValueCents = expiredValueCents + exp30ValueCents + exp60ValueCents + exp90ValueCents;

    res.json({
      summary: {
        expiredUnits: expiredCount,
        expiredCount: expiredCount,
        expiredValue: pkr(expiredValueCents),
        expiredCostValue: pkr(expiredValueCents),
        exp30Units: exp30Count,
        within30DaysCount: exp30Count,
        exp30Value: pkr(exp30ValueCents),
        within30DaysCostValue: pkr(exp30ValueCents),
        exp60Units: exp60Count,
        within60DaysCount: exp60Count,
        exp60Value: pkr(exp60ValueCents),
        within60DaysCostValue: pkr(exp60ValueCents),
        exp90Units: exp90Count,
        within90DaysCount: exp90Count,
        exp90Value: pkr(exp90ValueCents),
        within90DaysCostValue: pkr(exp90ValueCents),
        totalAtRiskBatches: atRiskBatches,
        totalAtRiskCostValue: pkr(atRiskValueCents)
      },
      rows: mapped,
      batches: mapped
    });
  } catch (error) {
    console.error('Expiry report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 7. LOW STOCK / REORDER REPORT
// ----------------------------------------------------------------------------
app.get('/low-stock', (req, res) => {
  try {
    const categoryMap = getCategoryMap();
    const supplierMap = getSupplierMap();

    const prods = db.prepare(`
      SELECT 
        p.id, p.barcode, p.name, p.category, p.supplier, p.min_stock,
        p.base_unit, p.units_per_strip, p.units_per_box,
        i.quantity,
        (
          SELECT unit_cost_cents FROM inventory_batches b
          WHERE b.product_id = p.id AND b.unit_cost_cents > 0
          ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1
        ) AS batch_unit_cost_cents
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE p.stock_tracked = 1 AND i.quantity <= p.min_stock
      ORDER BY i.quantity ASC, p.name ASC
    `).all();

    let outOfStockCount = 0;
    let lowStockCount = 0;
    let totalDeficitUnits = 0;
    let totalRestockCostCents = 0;

    const rows = prods.map(p => {
      const qty = Number(p.quantity);
      const minStock = Number(p.min_stock || 0);
      const deficit = Math.max(0, minStock - qty);
      const unitCost = Number(p.batch_unit_cost_cents || 0);
      const estCost = deficit * unitCost;

      const isOut = qty <= 0;
      if (isOut) outOfStockCount++;
      else lowStockCount++;

      totalDeficitUnits += deficit;
      totalRestockCostCents += estCost;

      const catName = resolveCategoryName(p.category, categoryMap);
      const suppName = resolveSupplierName(p.supplier, supplierMap);

      return {
        id: p.id,
        barcode: p.barcode || '-',
        name: p.name,
        productName: p.name,
        medicineName: p.name,
        category: catName,
        supplier: suppName,
        quantity: qty,
        currentStock: qty,
        pack_display: formatStockPacks(qty, p.units_per_box, p.units_per_strip, p.base_unit),
        minStock: minStock,
        deficit: deficit,
        shortage: deficit,
        suggestedReorder: deficit,
        unitCost: unitCost > 0 ? pkr(unitCost) : 'Unknown',
        estimatedRestockCost: pkr(estCost),
        reorderCost: pkr(estCost),
        status: isOut ? 'OUT OF STOCK' : 'LOW STOCK',
        isOutOfStock: isOut
      };
    });

    res.json({
      summary: {
        totalLowStockMedicines: rows.length,
        outOfStockMedicines: outOfStockCount,
        outOfStockCount: outOfStockCount,
        lowStockMedicines: lowStockCount,
        belowMinStockCount: lowStockCount,
        totalDeficitUnits: totalDeficitUnits,
        totalSuggestedReorderQty: totalDeficitUnits,
        totalRestockCost: pkr(totalRestockCostCents),
        totalReorderCost: pkr(totalRestockCostCents)
      },
      rows,
      lowStockItems: rows
    });
  } catch (error) {
    console.error('Low stock report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 8. PRODUCT MOVEMENT (TOP SELLING & DEAD STOCK)
// ----------------------------------------------------------------------------
app.get('/product-movement', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const cutoffDate = moment().utcOffset('+05:00').subtract(days, 'days').toISOString();
    const categoryMap = getCategoryMap();
    const supplierMap = getSupplierMap();

    // Top selling medicines in last N days
    const topSelling = db.prepare(`
      SELECT 
        si.product_id, COALESCE(p.name, si.product_name) AS product_name, p.barcode, p.category,
        p.base_unit, p.units_per_strip, p.units_per_box,
        SUM(COALESCE(si.base_quantity, si.quantity)) AS qty_sold,
        SUM(si.quantity * si.unit_price_cents) AS revenue_cents,
        MAX(s.date) AS last_sale_date
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.status = 1 AND s.date >= ?
      GROUP BY si.product_id, COALESCE(p.name, si.product_name)
      ORDER BY qty_sold DESC
      LIMIT 25
    `).all(cutoffDate);

    // Dead stock: products with quantity > 0 but NO sales since cutoffDate
    const deadStock = db.prepare(`
      SELECT 
        p.id, p.barcode, p.name, p.category, p.supplier,
        p.base_unit, p.units_per_strip, p.units_per_box,
        i.quantity,
        (
          SELECT unit_cost_cents FROM inventory_batches b
          WHERE b.product_id = p.id AND b.unit_cost_cents > 0
          ORDER BY b.expiry_date ASC, b.id ASC LIMIT 1
        ) AS batch_unit_cost_cents,
        (
          SELECT s.date FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.status = 1
          ORDER BY s.date DESC LIMIT 1
        ) AS last_sale_date
      FROM products p
      JOIN inventory i ON i.product_id = p.id
      WHERE p.stock_tracked = 1 AND i.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.status = 1 AND s.date >= ?
        )
      ORDER BY i.quantity DESC
      LIMIT 100
    `).all(cutoffDate);

    let totalDeadStockTiedUpCents = 0;
    const mappedDeadStock = deadStock.map(p => {
      const qty = Number(p.quantity);
      const unitCost = Number(p.batch_unit_cost_cents || 0);
      const tiedUp = qty * unitCost;
      totalDeadStockTiedUpCents += tiedUp;

      const catName = resolveCategoryName(p.category, categoryMap);
      const suppName = resolveSupplierName(p.supplier, supplierMap);

      return {
        id: p.id,
        barcode: p.barcode || '-',
        name: p.name,
        productName: p.name,
        medicineName: p.name,
        category: catName,
        supplier: suppName,
        quantity: qty,
        pack_display: formatStockPacks(qty, p.units_per_box, p.units_per_strip, p.base_unit),
        unitCost: unitCost > 0 ? pkr(unitCost) : 'Unknown',
        tiedUpCost: pkr(tiedUp),
        tiedUpCapital: pkr(tiedUp),
        lastSaleDate: p.last_sale_date ? toKarachiDate(p.last_sale_date) : 'Never sold'
      };
    });

    res.json({
      summary: {
        analyzedDays: days,
        topSellingCount: topSelling.length,
        deadStockCount: mappedDeadStock.length,
        deadStockTiedUpValue: pkr(totalDeadStockTiedUpCents)
      },
      deadStockSummary: {
        count: mappedDeadStock.length,
        tiedUpCapital: pkr(totalDeadStockTiedUpCents),
        tiedUpCapitalCents: totalDeadStockTiedUpCents
      },
      topSelling: topSelling.map(t => ({
        productId: t.product_id,
        name: t.product_name,
        productName: t.product_name,
        medicineName: t.product_name,
        barcode: t.barcode || '-',
        category: resolveCategoryName(t.category, categoryMap),
        quantitySold: Number(t.qty_sold),
        pack_display: formatStockPacks(t.qty_sold, t.units_per_box, t.units_per_strip, t.base_unit),
        revenue: pkr(t.revenue_cents),
        revenueCents: Number(t.revenue_cents),
        lastSaleDate: t.last_sale_date ? toKarachiDate(t.last_sale_date) : '-'
      })),
      deadStock: mappedDeadStock
    });
  } catch (error) {
    console.error('Product movement report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 9. PURCHASES REPORT
// ----------------------------------------------------------------------------
app.get('/purchases', requireFinancialPerm, (req, res) => {
  try {
    const range = parseKarachiRange(req.query.start, req.query.end);
    if (range.error) {
      return res.status(400).json({ error: 'Invalid date parameter', message: range.error });
    }
    const { startIso, endIso } = range;
    let where = '1=1';
    const params = [];
    if (startIso) {
      where += ' AND p.purchase_date >= ?';
      params.push(startIso);
    }
    if (endIso) {
      where += ' AND p.purchase_date <= ?';
      params.push(endIso);
    }
    if (req.query.supplier_id) {
      where += ' AND p.supplier_id = ?';
      params.push(Number(req.query.supplier_id));
    }

    const purchases = db.prepare(`
      SELECT 
        p.id, p.invoice_no, p.supplier_id, p.invoice_date, p.purchase_date,
        p.receiving_date, p.purchase_status, p.payment_status,
        p.total_cents, p.paid_cents,
        s.name AS supplier_name,
        (
          SELECT COALESCE(SUM(pi.discount_cents), 0)
          FROM purchase_items pi WHERE pi.purchase_id = p.id
        ) AS total_discount_cents,
        (
          SELECT COALESCE(SUM(pr.total_cents), 0)
          FROM purchase_returns pr WHERE pr.purchase_id = p.id
        ) AS total_return_cents
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${where}
      ORDER BY p.purchase_date DESC, p.id DESC
      LIMIT 1000
    `).all(...params);

    let grossTotalCents = 0;
    let discountTotalCents = 0;
    let netTotalCents = 0;
    let paidTotalCents = 0;
    let returnsTotalCents = 0;

    const rows = purchases.map(p => {
      const net = Number(p.total_cents);
      const paid = Number(p.paid_cents);
      const disc = Number(p.total_discount_cents || 0);
      const ret = Number(p.total_return_cents || 0);
      const gross = net + disc;
      const bal = Math.max(0, net - paid);

      grossTotalCents += gross;
      discountTotalCents += disc;
      netTotalCents += net;
      paidTotalCents += paid;
      returnsTotalCents += ret;

      return {
        id: p.id,
        invoiceNo: p.invoice_no,
        supplier: p.supplier_name,
        invoiceDate: p.invoice_date,
        receivingDate: p.receiving_date ? toKarachiDate(p.receiving_date) : '-',
        purchaseStatus: p.purchase_status.toUpperCase(),
        paymentStatus: p.payment_status.toUpperCase(),
        grossTotal: pkr(gross),
        discountReceived: pkr(disc),
        netTotal: pkr(net),
        paidAmount: pkr(paid),
        balance: pkr(bal),
        returnsAmount: pkr(ret)
      };
    });

    res.json({
      summary: {
        totalPurchasesCount: rows.length,
        invoiceCount: rows.length,
        grossPurchases: pkr(grossTotalCents),
        discountReceived: pkr(discountTotalCents),
        totalDiscountsReceived: pkr(discountTotalCents),
        netPurchases: pkr(netTotalCents),
        paidPurchases: pkr(paidTotalCents),
        totalPaid: pkr(paidTotalCents),
        balancePayable: pkr(Math.max(0, netTotalCents - paidTotalCents)),
        outstandingBalance: pkr(Math.max(0, netTotalCents - paidTotalCents)),
        returnsTotal: pkr(returnsTotalCents)
      },
      rows
    });
  } catch (error) {
    console.error('Purchases report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 10. SUPPLIER PAYABLES & CUSTOMER KHATA AGING
// ----------------------------------------------------------------------------
app.get('/payables-aging', (req, res) => {
  try {
    const today = moment().utcOffset('+05:00').startOf('day');

    // Supplier Payables
    const suppliers = db.prepare(`
      SELECT 
        s.id, s.name, s.phone, s.payment_terms, s.due_period_days,
        COALESCE((
          SELECT SUM(jl.credit_cents) - SUM(jl.debit_cents)
          FROM journal_lines jl
          WHERE jl.account_id = 2010 AND jl.party_type = 'supplier' AND jl.party_id = s.id
        ), 0) AS balance_cents,
        (
          SELECT COUNT(*)
          FROM purchases p
          WHERE p.supplier_id = s.id AND p.purchase_status = 'received' AND p.payment_status != 'paid'
            AND p.due_date IS NOT NULL AND date(p.due_date) < date('now')
        ) AS overdue_count
      FROM suppliers s
      WHERE s.status = 'active'
      ORDER BY balance_cents DESC
    `).all();

    let totalSupplierPayableCents = 0;
    let overdueCountTotal = 0;

    const supplierRows = suppliers.map(s => {
      const bal = Number(s.balance_cents);
      if (bal > 0) totalSupplierPayableCents += bal;
      const isOver = Number(s.overdue_count) > 0;
      if (isOver) overdueCountTotal++;

      return {
        id: s.id,
        name: s.name,
        phone: s.phone || '-',
        terms: s.payment_terms || 'Net 30',
        dueDays: s.due_period_days || 30,
        balance: pkr(bal),
        balanceCents: bal,
        isOverdue: isOver
      };
    });

    // Customer Khata Aging
    const customers = db.prepare(`
      SELECT 
        c.id, c.name, c.phone, c.credit_limit_cents,
        COALESCE((
          SELECT SUM(jl.debit_cents) - SUM(jl.credit_cents)
          FROM journal_lines jl
          WHERE jl.account_id = 1100 AND jl.party_type = 'customer' AND jl.party_id = c.id
        ), 0) AS balance_cents
      FROM customers c
      WHERE c.status = 'active'
      ORDER BY balance_cents DESC
    `).all();

    let totalKhataReceivableCents = 0;
    let bucket0_30Total = 0;
    let bucket31_60Total = 0;
    let bucket61_90Total = 0;
    let bucket90PlusTotal = 0;

    const customerRows = customers.filter(c => Number(c.balance_cents) > 0).map(c => {
      const totalBal = Number(c.balance_cents);
      totalKhataReceivableCents += totalBal;

      // Fetch unpaid sales for this customer
      const unpaidSales = db.prepare(`
        SELECT date, total_cents, paid_cents
        FROM sales
        WHERE status = 1 AND json_extract(data_json, '$.customer') = ? AND total_cents > paid_cents
        ORDER BY date DESC
      `).all(String(c.id));

      let remBal = totalBal;
      let b0 = 0, b30 = 0, b60 = 0, b90 = 0;

      for (const s of unpaidSales) {
        if (remBal <= 0) break;
        const unp = Math.min(remBal, Number(s.total_cents) - Number(s.paid_cents));
        const days = today.diff(moment(s.date).utcOffset('+05:00').startOf('day'), 'days');
        if (days <= 30) b0 += unp;
        else if (days <= 60) b30 += unp;
        else if (days <= 90) b60 += unp;
        else b90 += unp;
        remBal -= unp;
      }
      if (remBal > 0) {
        b90 += remBal; // remaining from opening balance placed in 90+ bucket
      }

      bucket0_30Total += b0;
      bucket31_60Total += b30;
      bucket61_90Total += b60;
      bucket90PlusTotal += b90;

      return {
        id: c.id,
        name: c.name,
        phone: c.phone || '-',
        creditLimit: pkr(c.credit_limit_cents || 0),
        totalBalance: pkr(totalBal),
        bucket0_30: pkr(b0),
        bucket31_60: pkr(b30),
        bucket61_90: pkr(b60),
        bucket90Plus: pkr(b90)
      };
    });

    res.json({
      suppliers: {
        summary: {
          totalPayables: pkr(totalSupplierPayableCents),
          overdueCount: overdueCountTotal
        },
        rows: supplierRows
      },
      customers: {
        summary: {
          totalReceivables: pkr(totalKhataReceivableCents),
          bucket0_30: pkr(bucket0_30Total),
          bucket31_60: pkr(bucket31_60Total),
          bucket61_90: pkr(bucket61_90Total),
          bucket90Plus: pkr(bucket90PlusTotal)
        },
        rows: customerRows
      }
    });
  } catch (error) {
    console.error('Payables aging report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 11. DAILY CLOSING REPORT
// ----------------------------------------------------------------------------
app.get('/daily-closing', (req, res) => {
  try {
    const dateParam = req.query.date || moment().utcOffset('+05:00').format('YYYY-MM-DD');
    const parsed = parseKarachiDate(String(dateParam));
    if (parsed.error) {
      return res.status(400).json({ error: 'Invalid date parameter', message: parsed.error });
    }
    const { startIso, endIso, normalized: targetDate } = parsed;

    // 1. Sales on target date
    const salesAgg = db.prepare(`
      SELECT 
        COUNT(id) AS bills_count,
        COALESCE(SUM(total_cents), 0) AS total_sales_cents,
        COALESCE(SUM(paid_cents), 0) AS cash_collected_cents,
        COALESCE(SUM(CASE WHEN paid_cents >= total_cents THEN total_cents ELSE 0 END), 0) AS cash_sales_cents,
        COALESCE(SUM(CASE WHEN paid_cents = 0 THEN total_cents ELSE 0 END), 0) AS khata_sales_cents,
        COALESCE(SUM(CASE WHEN paid_cents > 0 AND paid_cents < total_cents THEN total_cents ELSE 0 END), 0) AS mixed_sales_cents
      FROM sales
      WHERE status = 1 AND date >= ? AND date <= ?
    `).get(startIso, endIso);

    // 2. Customer Khata payments collected on target date
    const custPaymentsAgg = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS collected_cents
      FROM payments
      WHERE party_type = 'customer' AND payment_date >= ? AND payment_date <= ?
    `).get(startIso, endIso);

    // 3. Supplier payments made on target date
    const suppPaymentsAgg = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
      FROM payments
      WHERE party_type = 'supplier' AND payment_date >= ? AND payment_date <= ?
    `).get(startIso, endIso);

    // 4. Operating expenses paid on target date
    const expAgg = db.prepare(`
      SELECT 
        COALESCE(SUM(amount_cents), 0) AS total_exp_cents,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount_cents ELSE 0 END), 0) AS cash_exp_cents
      FROM expenses
      WHERE expense_date >= ? AND expense_date <= ?
    `).get(startIso, endIso);

    // 5. Cashbook opening / balance for drawer
    const cashSalesCollected = Number(salesAgg.cash_collected_cents);
    const khataCollected = Number(custPaymentsAgg.collected_cents);
    const supplierPaid = Number(suppPaymentsAgg.paid_cents);
    const cashExpenses = Number(expAgg.cash_exp_cents);

    const totalCashInflow = cashSalesCollected + khataCollected;
    const totalCashOutflow = supplierPaid + cashExpenses;
    const netDrawerChange = totalCashInflow - totalCashOutflow;

    const cbBalanceRow = db.prepare(`
      SELECT balance_cents FROM cashbook_entries
      WHERE entry_date <= ?
      ORDER BY id DESC LIMIT 1
    `).get(endIso);
    const cashbookBalance = cbBalanceRow ? Number(cbBalanceRow.balance_cents) : 0;

    res.json({
      date: targetDate,
      billsCount: Number(salesAgg.bills_count),
      totalSales: pkr(salesAgg.total_sales_cents),
      cashSales: pkr(salesAgg.cash_sales_cents),
      khataSales: pkr(salesAgg.khata_sales_cents),
      mixedSales: pkr(salesAgg.mixed_sales_cents),
      cashCollectedFromSales: pkr(cashSalesCollected),
      customerKhataCollected: pkr(khataCollected),
      supplierPaymentsMade: pkr(supplierPaid),
      expensesPaid: pkr(expAgg.total_exp_cents),
      cashExpensesPaid: pkr(cashExpenses),
      totalCashInflow: pkr(totalCashInflow),
      totalCashOutflow: pkr(totalCashOutflow),
      netDrawerChange: pkr(netDrawerChange),
      cashbookBalance: pkr(cashbookBalance)
    });
  } catch (error) {
    console.error('Daily closing report error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;

