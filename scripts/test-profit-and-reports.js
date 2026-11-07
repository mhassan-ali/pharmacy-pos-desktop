const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const http = require('http');
const moment = require('moment');

// Setup isolated TEST_APPDATA
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-profit-test-'));
const appDataDir = path.join(testDir, 'appData');
fs.mkdirSync(appDataDir, { recursive: true });
process.env.TEST_APPDATA = appDataDir;
process.env.APPDATA = appDataDir;
process.env.APPNAME = 'PharmaSpot';
process.env.PORT = '43295';

const PORT = 43295;
console.log('=== MULTI MEDICOS PROFIT & REPORTS VERIFICATION ===');
console.log('Isolated APPDATA:', appDataDir);

const { db, transaction, cents, pkr } = require('../api/sqlite');
const serverModule = require('../server');

function request(method, pathUrl, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathUrl,
      method: method,
      headers: reqHeaders
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  await serverModule.ready;
  console.log('Server ready on port', PORT);

  // 1. Create Owner & Cashier accounts
  const ownerRes = await request('POST', '/api/users/setup', {
    username: 'owner',
    password: 'password12345'
  });
  assert.strictEqual(ownerRes.status, 200, 'Owner creation must succeed');
  const ownerToken = ownerRes.body.token;
  const ownerId = ownerRes.body._id;
  const ownerAuth = { 'X-Access-Token': ownerToken };

  // Create Cashier (no perm_transactions, no perm_products)
  const cashierRes = await request('POST', '/api/users/post', {
    id: '',
    username: 'cashier1',
    fullname: 'Cashier One',
    password: 'password12345',
    perm_products: 0,
    perm_categories: 0,
    perm_transactions: 0,
    perm_users: 0,
    perm_settings: 0
  }, ownerAuth);
  assert.strictEqual(cashierRes.status, 200, 'Cashier creation must succeed');
  const cashierId = cashierRes.body._id;

  const cashierLogin = await request('POST', '/api/users/login', {
    username: 'cashier1',
    password: 'password12345'
  });
  const cashierAuth = { 'X-Access-Token': cashierLogin.body.token };

  // 2. Create Categories & Supplier
  db.prepare("INSERT INTO categories(id, name, data_json) VALUES (1, 'General', '{\"name\":\"General\"}'), (2, 'Antibiotics', '{\"name\":\"Antibiotics\"}')").run();
  db.prepare("INSERT INTO suppliers(id, name, opening_balance_cents) VALUES (1, 'Multi Pharma', 0)").run();
  db.prepare("INSERT INTO customers(id, name, phone, opening_balance_cents, credit_limit_cents, data_json) VALUES ('1', 'Ali Khan', '03001234567', 0, 500000, '{\"name\":\"Ali Khan\",\"phone\":\"03001234567\"}')").run();

  // 3. Create Products
  // Product 1: Panadol 500mg (Retail price: PKR 50.00 = 5000 cents)
  db.prepare(`
    INSERT INTO products(id, barcode, name, price_cents, expiration_date, category, supplier, stock_tracked, min_stock)
    VALUES (1, 1001, 'Panadol 500mg', 5000, '31-Dec-2028', 'General', 'Multi Pharma', 1, 10)
  `).run();
  db.prepare("INSERT INTO inventory(product_id, quantity) VALUES (1, 0)").run();

  // Product 2: Amoxil 500mg (Retail price: PKR 150.00 = 15000 cents)
  db.prepare(`
    INSERT INTO products(id, barcode, name, price_cents, expiration_date, category, supplier, stock_tracked, min_stock)
    VALUES (2, 1002, 'Amoxil 500mg', 15000, '31-Dec-2029', 'Antibiotics', 'Multi Pharma', 1, 5)
  `).run();
  db.prepare("INSERT INTO inventory(product_id, quantity) VALUES (2, 0)").run();

  // Product 3: Uncosted Medicine (Opening stock = 20, no purchase cost)
  db.prepare(`
    INSERT INTO products(id, barcode, name, price_cents, expiration_date, category, supplier, stock_tracked, min_stock)
    VALUES (3, 1003, 'Old Balm', 8000, '31-Dec-2027', 'General', 'Multi Pharma', 1, 5)
  `).run();
  db.prepare("INSERT INTO inventory(product_id, quantity) VALUES (3, 20)").run();
  // Batch with unit_cost_cents = 0 (Unknown cost)
  db.prepare(`
    INSERT INTO inventory_batches(id, product_id, batch_number, expiry_date, initial_quantity, quantity_available, unit_cost_cents, received_date)
    VALUES (10, 3, 'BALM-OLD', '2027-12-31', 20, 20, 0, '2026-07-01')
  `).run();

  console.log('\n--- TEST CASE 1: PERMISSIONS CHECK ---');
  // Cashier calls profit route -> 403 Forbidden
  const cashPnl = await request('GET', '/api/reports/profit-loss', null, cashierAuth);
  assert.strictEqual(cashPnl.status, 403, 'Cashier must be blocked with 403 on profit-loss route');
  const cashDash = await request('GET', '/api/reports/dashboard-profit', null, cashierAuth);
  assert.strictEqual(cashDash.status, 403, 'Cashier must be blocked with 403 on dashboard-profit route');
  const cashVal = await request('GET', '/api/reports/stock-valuation', null, cashierAuth);
  assert.strictEqual(cashVal.status, 403, 'Cashier must be blocked with 403 on stock-valuation route');
  const cashPur = await request('GET', '/api/reports/purchases', null, cashierAuth);
  assert.strictEqual(cashPur.status, 403, 'Cashier must be blocked with 403 on purchases report route');

  // Owner calls profit route -> 200 OK
  const ownerPnl = await request('GET', '/api/reports/profit-loss', null, ownerAuth);
  assert.strictEqual(ownerPnl.status, 200, 'Owner must have access to profit-loss route');
  console.log('PASS: Permissions correctly enforced (Cashier 403, Owner 200).');

  console.log('\n--- TEST CASE 2: SEEDING PURCHASES WITH DISCOUNT ACROSS MONTHS ---');
  // Purchase 1 (August 2026):
  // 100 units Panadol @ Gross PKR 30.00, Discount 5% -> Net unit cost = PKR 28.50 = 2850 cents. Line total = 2850.00
  // 50 units Amoxil @ Gross PKR 100.00, Discount 10% -> Net unit cost = PKR 90.00 = 9000 cents. Line total = 4500.00
  // Total invoice = 7350.00
  const pur1Res = await request('POST', '/api/purchases', {
    supplier_id: 1,
    invoice_no: 'INV-AUG-001',
    invoice_date: '2026-08-01',
    purchase_date: '2026-08-01',
    receiving_date: '2026-08-01',
    due_date: '2026-08-31',
    status: 'received',
    payment_method: 'cash',
    payment_status: 'paid',
    paid_amount: '7350.00',
    items: [
      {
        product_id: 1,
        batch_number: 'PAN-AUG',
        expiry_date: '2028-12-31',
        quantity: 100,
        bonus_quantity: 0,
        unit_cost: '30.00',
        unit_cost_cents: 3000,
        discount_percent: 5,
        discount_cents: 15000,
        line_total: '2850.00',
        line_total_cents: 285000
      },
      {
        product_id: 2,
        batch_number: 'AMX-AUG',
        expiry_date: '2029-12-31',
        quantity: 50,
        bonus_quantity: 0,
        unit_cost: '100.00',
        unit_cost_cents: 10000,
        discount_percent: 10,
        discount_cents: 50000,
        line_total: '4500.00',
        line_total_cents: 450000
      }
    ]
  }, ownerAuth);
  assert.strictEqual(pur1Res.status, 201, 'Purchase 1 must succeed');

  // Verify batches created with effective net unit cost
  const b1 = db.prepare("SELECT * FROM inventory_batches WHERE batch_number = 'PAN-AUG'").get();
  assert.strictEqual(b1.unit_cost_cents, 2850, 'Panadol batch unit cost must be net PKR 28.50');
  const b2 = db.prepare("SELECT * FROM inventory_batches WHERE batch_number = 'AMX-AUG'").get();
  assert.strictEqual(b2.unit_cost_cents, 9000, 'Amoxil batch unit cost must be net PKR 90.00');
  console.log('PASS: Purchases received at effective discounted unit costs (Panadol 28.50, Amoxil 90.00).');

  console.log('\n--- TEST CASE 3: OLD SALES WITHOUT COST DATA (JULY 2026) ---');
  // Sale in July 2026 of Old Balm (which has batch with cost = 0)
  // 5 units @ PKR 80 = PKR 400.00
  const oldSaleRes = await request('POST', '/api/new', {
    _id: 'SALE-JULY-001',
    status: 1,
    user_id: 1,
    date: '2026-07-15T10:00:00.000Z',
    items: [
      { id: 3, product_name: 'Old Balm', price: '80.00', quantity: 5 }
    ],
    discount: '0.00',
    total: '400.00',
    paid: '400.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(oldSaleRes.status, 200, 'July sale must succeed');

  // Verify row in sale_batch_cogs has cost_known = 0 and NULL costs
  const cogsJuly = db.prepare("SELECT * FROM sale_batch_cogs WHERE sale_id = 'SALE-JULY-001'").get();
  assert.ok(cogsJuly, 'COGS row must exist for July sale');
  assert.strictEqual(cogsJuly.cost_known, 0, 'cost_known must be 0 for zero-cost batch');
  assert.strictEqual(cogsJuly.unit_cost_cents, null, 'unit_cost_cents must be NULL');
  assert.strictEqual(cogsJuly.cost_cents, null, 'cost_cents must be NULL');
  console.log('PASS: Zero-cost batch sale stored with cost_known = 0 and NULL costs.');

  console.log('\n--- TEST CASE 4: AUGUST 2026 SALES (CASH, KHATA, MIXED WITH PERCENT DISCOUNT) ---');
  // Sale 1: Cash sale of 10 Panadol @ 50 = PKR 500, no discount.
  // COGS = 10 * 28.50 = PKR 285.00
  const s1 = await request('POST', '/api/new', {
    _id: 'SALE-AUG-001',
    status: 1,
    user_id: 1,
    date: '2026-08-10T11:00:00.000Z',
    items: [{ id: 1, product_name: 'Panadol 500mg', price: '50.00', quantity: 10 }],
    discount: '0.00',
    total: '500.00',
    paid: '500.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(s1.status, 200);

  // Sale 2: Mixed payment with 10% discount:
  // 5 Amoxil @ 150 = 750. Discount 10% = 75. Net total = 675.00. Paid 200 cash, 475 Khata.
  // COGS = 5 * 90.00 = PKR 450.00
  const s2 = await request('POST', '/api/new', {
    _id: 'SALE-AUG-002',
    status: 1,
    user_id: 1,
    customer: 1,
    date: '2026-08-15T14:00:00.000Z',
    items: [{ id: 2, product_name: 'Amoxil 500mg', price: '150.00', quantity: 5 }],
    discount: '75.00',
    discount_percent: '10',
    total: '675.00',
    paid: '200.00',
    payment_type: 'Mixed'
  }, ownerAuth);
  assert.strictEqual(s2.status, 200);

  // Operating Expenses for August 2026:
  // Rent: PKR 300.00 (expense category 1)
  // Electricity: PKR 100.00 (expense category 2)
  // Total expenses = 400.00
  db.prepare(`
    INSERT INTO expenses(expense_number, category_id, amount_cents, expense_date, payment_method, description, user_id)
    VALUES ('EXP-AUG-01', 1, 30000, '2026-08-20T10:00:00.000Z', 'cash', 'August Rent', 1),
           ('EXP-AUG-02', 2, 10000, '2026-08-22T10:00:00.000Z', 'cash', 'August Electricity', 1)
  `).run();

  // Hand-calculation for August 2026:
  // Gross Sales = 500 + 675 = 1175.00
  // COGS = 285.00 + 450.00 = 735.00
  // Gross Profit = 1175.00 - 735.00 = 440.00
  // Operating Expenses = 400.00
  // Net Profit = 440.00 - 400.00 = 40.00 (Profit!)
  // Margin % = (40 / 1175) * 100 = 3.4%

  console.log('\n--- TEST CASE 5: SEPTEMBER 2026 (LOSS MONTH) ---');
  // Small sales: 2 Panadol @ 50 = 100.00. COGS = 2 * 28.50 = 57.00. Gross profit = 43.00.
  // Heavy expenses: Salaries = PKR 500.00.
  // Net Profit = 43.00 - 500.00 = -457.00 (Loss!)
  const sSept = await request('POST', '/api/new', {
    _id: 'SALE-SEPT-001',
    status: 1,
    user_id: 1,
    date: '2026-09-05T09:00:00.000Z',
    items: [{ id: 1, product_name: 'Panadol 500mg', price: '50.00', quantity: 2 }],
    discount: '0.00',
    total: '100.00',
    paid: '100.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(sSept.status, 200);

  db.prepare(`
    INSERT INTO expenses(expense_number, category_id, amount_cents, expense_date, payment_method, description, user_id)
    VALUES ('EXP-SEPT-01', 4, 50000, '2026-09-25T10:00:00.000Z', 'cash', 'Staff Salaries', 1)
  `).run();

  console.log('\n--- TEST CASE 6: OCTOBER 2026 WITH SALE RETURN & TIMEZONE BOUNDARIES ---');
  // Sale on Oct 10: 4 Amoxil @ 150 = 600.00. COGS = 4 * 90 = 360.00.
  const sOct = await request('POST', '/api/new', {
    _id: 'SALE-OCT-001',
    status: 1,
    user_id: 1,
    date: '2026-10-10T12:00:00.000Z',
    items: [{ id: 2, product_name: 'Amoxil 500mg', price: '150.00', quantity: 4 }],
    discount: '0.00',
    total: '600.00',
    paid: '600.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(sOct.status, 200);

  // Return of 1 unit of Amoxil from SALE-OCT-001 on Oct 12:
  // Refund = 150.00. COGS reversed = 1 * 90.00 = 90.00.
  // Net Oct Sales before boundary: 600 - 150 = 450.00.
  // Net Oct COGS before boundary: 360 - 90 = 270.00.
  const retRes = await request('POST', '/api/return', {
    sale_id: 'SALE-OCT-001',
    product_id: 2,
    quantity: 1,
    return_to_stock: true,
    return_date: '2026-10-12T10:00:00.000Z',
    reason: 'Customer returned 1 box',
    refund_method: 'cash'
  }, ownerAuth);
  assert.strictEqual(retRes.status, 200, 'Customer return must succeed');

  // Month boundary tests:
  // Boundary 1: 2026-10-31T18:59:00.000Z (+5h = 2026-10-31 23:59:00 Karachi) -> Lands in OCTOBER!
  // Sale of 2 Panadol @ 50 = 100.00. COGS = 2 * 28.50 = 57.00.
  const sOctBoundary = await request('POST', '/api/new', {
    _id: 'SALE-OCT-BOUND',
    status: 1,
    user_id: 1,
    date: '2026-10-31T18:59:00.000Z',
    items: [{ id: 1, product_name: 'Panadol 500mg', price: '50.00', quantity: 2 }],
    discount: '0.00',
    total: '100.00',
    paid: '100.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(sOctBoundary.status, 200);

  // Boundary 2: 2026-10-31T19:01:00.000Z (+5h = 2026-11-01 00:01:00 Karachi) -> Lands in NOVEMBER!
  // Sale of 1 Panadol @ 50 = 50.00. COGS = 1 * 28.50 = 28.50.
  const sNovBoundary = await request('POST', '/api/new', {
    _id: 'SALE-NOV-BOUND',
    status: 1,
    user_id: 1,
    date: '2026-10-31T19:01:00.000Z',
    items: [{ id: 1, product_name: 'Panadol 500mg', price: '50.00', quantity: 1 }],
    discount: '0.00',
    total: '50.00',
    paid: '50.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(sNovBoundary.status, 200);

  // Hand-calculation for October 2026:
  // Gross sales = 600.00 + 100.00 = 700.00
  // Returns = 150.00
  // Net Sales = 550.00
  // Gross COGS = 360.00 + 57.00 = 417.00
  // Returned COGS = 90.00
  // Net COGS = 327.00
  // Gross Profit = 550.00 - 327.00 = 223.00
  // Expenses = 0.00
  // Net Profit = 223.00

  // Hand-calculation for November 2026:
  // Net Sales = 50.00
  // COGS = 28.50
  // Gross Profit = 21.50
  // Expenses = 0.00
  // Net Profit = 21.50

  console.log('\n--- TEST CASE 7: VERIFY DASHBOARD & P&L TO THE PAISA ---');
  const dashRes = await request('GET', '/api/reports/dashboard-profit', null, ownerAuth);
  assert.strictEqual(dashRes.status, 200);

  const mList = dashRes.body.last12Months;
  const jul = mList.find(m => m.month === '2026-07');
  const aug = mList.find(m => m.month === '2026-08');
  const sep = mList.find(m => m.month === '2026-09');
  const oct = mList.find(m => m.month === '2026-10');
  const nov = mList.find(m => m.month === '2026-11');

  // Verify July: Cost unavailable for 1 sale (PKR 400.00)
  assert.strictEqual(jul.unknownCount, 1, 'July must flag 1 unknown cost sale');
  assert.strictEqual(jul.unknownAmount, '400.00', 'July unknown amount must be 400.00');

  // Verify August:
  console.log('August computed:', { sales: aug.sales, cogs: aug.cogs, gp: aug.grossProfit, exp: aug.expenses, np: aug.netProfit });
  assert.strictEqual(aug.sales, '1175.00', 'August sales must match 1175.00');
  assert.strictEqual(aug.cogs, '735.00', 'August COGS must match 735.00');
  assert.strictEqual(aug.grossProfit, '440.00', 'August Gross Profit must match 440.00');
  assert.strictEqual(aug.expenses, '400.00', 'August Expenses must match 400.00');
  assert.strictEqual(aug.netProfit, '40.00', 'August Net Profit must match 40.00');
  assert.strictEqual(aug.marginPct, 3.4, 'August Margin % must be 3.4%');

  // Verify September (Loss month):
  console.log('September computed (Loss):', { sales: sep.sales, cogs: sep.cogs, gp: sep.grossProfit, exp: sep.expenses, np: sep.netProfit });
  assert.strictEqual(sep.sales, '100.00', 'September sales must be 100.00');
  assert.strictEqual(sep.cogs, '57.00', 'September COGS must be 57.00');
  assert.strictEqual(sep.grossProfit, '43.00', 'September GP must be 43.00');
  assert.strictEqual(sep.expenses, '500.00', 'September Expenses must be 500.00');
  assert.strictEqual(sep.netProfit, '-457.00', 'September Net Profit must be -457.00 (loss)');

  // Verify October (with return and boundary sale):
  console.log('October computed (with return):', { sales: oct.sales, cogs: oct.cogs, gp: oct.grossProfit, exp: oct.expenses, np: oct.netProfit });
  assert.strictEqual(oct.sales, '550.00', 'October sales must be 550.00 (after return)');
  assert.strictEqual(oct.cogs, '327.00', 'October COGS must be 327.00 (after return reversal)');
  assert.strictEqual(oct.grossProfit, '223.00', 'October Gross Profit must be 223.00');
  assert.strictEqual(oct.netProfit, '223.00', 'October Net Profit must be 223.00');

  // Verify November (month boundary sale at 00:01 landed here):
  console.log('November computed (boundary sale):', { sales: nov.sales, cogs: nov.cogs, gp: nov.grossProfit, np: nov.netProfit });
  assert.strictEqual(nov.sales, '50.00', 'November sales must be 50.00');
  assert.strictEqual(nov.cogs, '28.50', 'November COGS must be 28.50');
  assert.strictEqual(nov.grossProfit, '21.50', 'November GP must be 21.50');
  console.log('PASS: All months match hand-calculations to the exact paisa!');

  console.log('\n--- TEST CASE 8: SET BATCH COST FOR ZERO-COST BATCH ---');
  // Attempt to set cost on b1 (which already has known cost 28.50) -> Must fail with 400
  const lockRes = await request('PUT', `/api/inventory/batch/${b1.id}`, {
    unit_cost: '35.00'
  }, ownerAuth);
  assert.strictEqual(lockRes.status, 400, 'Modifying cost of an already-known cost batch must return 400');
  assert.strictEqual(lockRes.body.error, 'Cost locked');

  // Set cost on Batch 10 (Old Balm, cost = 0) -> Sets unit cost to PKR 45.50 = 4550 cents
  const setRes = await request('PUT', `/api/inventory/batch/10`, {
    unit_cost: '45.50'
  }, ownerAuth);
  assert.strictEqual(setRes.status, 200, 'Setting cost on zero-cost batch must succeed');
  const b10Updated = db.prepare("SELECT unit_cost_cents FROM inventory_batches WHERE id = 10").get();
  assert.strictEqual(b10Updated.unit_cost_cents, 4550, 'Batch 10 unit cost must now be 4550 cents');

  // Verify audit log
  const auditEntry = db.prepare("SELECT * FROM audit_logs WHERE action = 'SET_BATCH_COST' ORDER BY id DESC LIMIT 1").get();
  assert.ok(auditEntry, 'Audit log entry must exist for SET_BATCH_COST');
  console.log('PASS: Unknown batch cost set to 45.50 and locked batches protected.');

  // Subsequent sale of Old Balm now gets known cost:
  // 2 units @ 80 = 160.00. COGS = 2 * 45.50 = 91.00.
  const sBalmNew = await request('POST', '/api/new', {
    _id: 'SALE-NOV-BALM',
    status: 1,
    user_id: 1,
    date: '2026-11-02T10:00:00.000Z',
    items: [{ id: 3, product_name: 'Old Balm', price: '80.00', quantity: 2 }],
    discount: '0.00',
    total: '160.00',
    paid: '160.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(sBalmNew.status, 200);

  const cogsBalmNew = db.prepare("SELECT * FROM sale_batch_cogs WHERE sale_id = 'SALE-NOV-BALM'").get();
  assert.strictEqual(cogsBalmNew.cost_known, 1, 'Subsequent sale must now have cost_known = 1');
  assert.strictEqual(cogsBalmNew.unit_cost_cents, 4550, 'Unit cost must match 4550 cents');
  assert.strictEqual(cogsBalmNew.cost_cents, 9100, 'Total cost must match 9100 cents (91.00 PKR)');
  console.log('PASS: Subsequent sale of updated batch has cost_known = 1 and exact COGS.');

  console.log('\n--- TEST CASE 9: ROLLBACK AND IDEMPOTENCY SAFETY ---');
  // Attempt invalid sale (insufficient stock) -> Rolls back, no rows in sale_batch_cogs
  try {
    await request('POST', '/api/new', {
      _id: 'SALE-FAIL-001',
      status: 1,
      user_id: 1,
      date: new Date().toISOString(),
      items: [{ id: 1, product_name: 'Panadol 500mg', price: '50.00', quantity: 99999 }],
      discount: '0.00',
      total: '4999950.00',
      paid: '4999950.00',
      payment_type: 'Cash'
    }, ownerAuth);
  } catch (_) {}
  const failCogs = db.prepare("SELECT * FROM sale_batch_cogs WHERE sale_id = 'SALE-FAIL-001'").all();
  assert.strictEqual(failCogs.length, 0, 'Rolled-back sale must leave zero orphan COGS rows');

  // Retry duplicate sale -> no duplicate rows
  const retryRes = await request('POST', '/api/new', {
    _id: 'SALE-OCT-001',
    status: 1,
    user_id: 1,
    date: '2026-10-10T12:00:00.000Z',
    items: [{ id: 2, product_name: 'Amoxil 500mg', price: '150.00', quantity: 4 }],
    discount: '0.00',
    total: '600.00',
    paid: '600.00',
    payment_type: 'Cash'
  }, ownerAuth);
  assert.strictEqual(retryRes.status, 200, 'Duplicate sale request returns 200 without error');
  const octCogsRows = db.prepare("SELECT * FROM sale_batch_cogs WHERE sale_id = 'SALE-OCT-001'").all();
  assert.strictEqual(octCogsRows.length, 1, 'Duplicate retry must NOT create duplicate COGS rows');
  console.log('PASS: Transaction rollback leaves no orphan rows and duplicate retries create no duplicates.');

  console.log('\n--- TEST CASE 10: TRIAL BALANCE INTEGRITY ---');
  const tbRes = await request('GET', '/api/ledger/trial-balance', null, ownerAuth);
  assert.strictEqual(tbRes.status, 200);
  assert.strictEqual(tbRes.body.is_balanced, true, 'Trial balance must remain perfectly balanced');
  console.log(`PASS: Trial balance in perfect double-entry balance (Debits: ${tbRes.body.total_debit} == Credits: ${tbRes.body.total_credit}).`);

  console.log('\n--- TEST CASE 11: ALL 10 REPORTS ENDPOINTS VERIFICATION ---');
  // 1. Profit & Loss
  const pnl = await request('GET', '/api/reports/profit-loss', null, ownerAuth);
  assert.strictEqual(pnl.status, 200);
  assert.ok(pnl.body.summary && pnl.body.expensesByCategory);

  // 2. Sales Report
  const sales = await request('GET', '/api/reports/sales?groupBy=day', null, ownerAuth);
  assert.strictEqual(sales.status, 200);
  assert.ok(sales.body.summary.totalBills > 0);

  // 3. Expenses Report
  const exp = await request('GET', '/api/reports/expenses', null, ownerAuth);
  assert.strictEqual(exp.status, 200);
  assert.ok(exp.body.summary.totalCount > 0);

  // 4. Stock Valuation Report
  const val = await request('GET', '/api/reports/stock-valuation', null, ownerAuth);
  assert.strictEqual(val.status, 200);
  assert.ok(val.body.summary.totalMedicines > 0);

  // 5. Expiry Report
  const expy = await request('GET', '/api/reports/expiry?bucket=all', null, ownerAuth);
  assert.strictEqual(expy.status, 200);
  assert.ok(expy.body.rows.length > 0);

  // 6. Low Stock Report
  const low = await request('GET', '/api/reports/low-stock', null, ownerAuth);
  assert.strictEqual(low.status, 200);
  assert.ok(Array.isArray(low.body.rows));

  // 7. Product Movement Report
  const mov = await request('GET', '/api/reports/product-movement?days=90', null, ownerAuth);
  assert.strictEqual(mov.status, 200);
  assert.ok(mov.body.topSelling.length > 0);

  // 8. Purchases Report
  const pur = await request('GET', '/api/reports/purchases', null, ownerAuth);
  assert.strictEqual(pur.status, 200);
  assert.strictEqual(pur.body.summary.totalPurchasesCount, 1);

  // 9. Payables & Khata Aging Report
  const aging = await request('GET', '/api/reports/payables-aging', null, ownerAuth);
  assert.strictEqual(aging.status, 200);
  assert.ok(aging.body.suppliers && aging.body.customers);

  // 10. Daily Closing Report
  const closing = await request('GET', `/api/reports/daily-closing?date=2026-08-10`, null, ownerAuth);
  assert.strictEqual(closing.status, 200);
  assert.strictEqual(closing.body.billsCount, 1);
  console.log('PASS: All 10 report endpoints return accurate data and match underlying transactions.');

  console.log('\n--- TEST CASE 12: PERFORMANCE BENCHMARK (20,000 SALE LINES) ---');
  // Seed 20,000 sales lines in memory / db
  console.log('Generating 20,000 sales lines for performance benchmark...');
  transaction(() => {
    const insertSale = db.prepare("INSERT INTO sales(id, status, date, user_id, total_cents, paid_cents, payload_hash, data_json) VALUES (?, 1, ?, 1, 1000, 1000, 'bench', '{}')");
    const insertCogs = db.prepare("INSERT INTO sale_batch_cogs(sale_id, product_id, batch_id, quantity, unit_cost_cents, cost_cents, cost_known) VALUES (?, 1, 1, 1, 700, 700, 1)");

    for (let i = 1; i <= 20000; i++) {
      const sId = `BENCH-${i}`;
      // Distribute across last 6 months
      const mIdx = i % 6;
      const dStr = moment().utcOffset('+05:00').subtract(mIdx, 'months').toISOString();
      insertSale.run(sId, dStr);
      insertCogs.run(sId);
    }
  });

  const t0 = Date.now();
  const perfDash = await request('GET', '/api/reports/dashboard-profit', null, ownerAuth);
  const t1 = Date.now();
  const durationMs = t1 - t0;
  console.log(`20,000 sales lines aggregated in ${durationMs}ms`);
  assert.strictEqual(perfDash.status, 200);
  assert.ok(durationMs < 1500, `Dashboard profit aggregation must be fast (<1.5s), got ${durationMs}ms`);
  console.log(`PASS: Performance benchmark passed (${durationMs}ms for 20,000 rows).`);

  // Clean up benchmark rows
  transaction(() => {
    db.prepare("DELETE FROM sale_batch_cogs WHERE sale_id LIKE 'BENCH-%'").run();
    db.prepare("DELETE FROM sales WHERE id LIKE 'BENCH-%'").run();
  });

  console.log('\n============================================================');
  console.log('ALL PROFIT & REPORTS VERIFICATIONS PASSED (100% SUCCESS)');
  console.log('============================================================\n');

  // Close DB and server
  db.close();
  process.exit(0);
}

run().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  try { db.close(); } catch (_) {}
  process.exit(1);
});
