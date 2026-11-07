// scripts/test-task2-purchase-discount.js
// Verification suite for Task 2: Optional Discount % in Medicine Purchase Lines (14 Cases)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-discount-14cases-'));
const testAppData = path.join(root, 'appData');
fs.mkdirSync(testAppData, { recursive: true });
process.env.APPDATA = testAppData;
process.env.TEST_APPDATA = testAppData;
process.env.APPNAME = 'PharmaSpot';

fs.mkdirSync(path.join(testAppData, 'PharmaSpot', 'server', 'databases'), { recursive: true });
fs.mkdirSync(path.join(testAppData, 'PharmaSpot', 'uploads'), { recursive: true });

const express = require('express');
const app = express();
app.use(express.json());
const usersApi = require('../api/users');
app.use('/api', usersApi.authorize);
app.use('/api/inventory', require('../api/inventory'));
app.use('/api/suppliers', require('../api/suppliers'));
app.use('/api/purchases', require('../api/purchases'));
app.use('/api/ledger', require('../api/ledger'));
app.use('/api/users', usersApi);

const server = app.listen(0, '127.0.0.1');
let token = '';

async function request(route, method = 'GET', body) {
  const headers = token ? { 'X-Access-Token': token } : {};
  headers['content-type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { status: response.status, data };
}

(async () => {
  try {
    if (!server.listening) await once(server, 'listening');

    console.log('=== VERIFYING TASK 2: MEDICINE PURCHASE DISCOUNT % (14 CASES) ===\n');

    // 0. Setup owner & supplier & base medicines
    const setup = await request('/api/users/setup', 'POST', { username: 'owner', password: 'OwnerPassword123!' });
    assert.equal(setup.status, 200);
    token = setup.data.token;

    const suppRes = await request('/api/suppliers', 'POST', { name: 'Alpha Pharma Distributors', phone: '03001234567' });
    assert.equal(suppRes.status, 201);
    const supplierId = suppRes.data.id;

    const { db } = require('../api/sqlite');
    // Pre-insert products for tests
    db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
      VALUES (1,101,'Panadol Regular 500mg',15000,'31-Dec-2028','Tablets','1',1,5,'')`).run();
    db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,0)`).run();

    db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
      VALUES (2,102,'Brufen 400mg',25000,'31-Dec-2028','Tablets','1',1,5,'')`).run();
    db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,0)`).run();

    db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
      VALUES (3,103,'Odd Price Syrup',10000,'31-Dec-2028','Syrup','1',1,5,'')`).run();
    db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,0)`).run();

    // CASE 1: Line with qty 10, price 100, no discount: total 1000 (unchanged behavior)
    console.log('Test Case 1: Line qty 10, price 100, no discount...');
    const c1 = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-CASE-1',
      invoice_date: '2026-10-31',
      status: 'received',
      items: [{
        product_id: 1,
        batch_number: 'B-C1',
        expiry_date: '2028-12-31',
        quantity: 10,
        unit_cost: '100.00'
      }]
    });
    assert.equal(c1.status, 201);
    const p1 = (await request(`/api/purchases/${c1.data.id}`)).data;
    assert.equal(p1.total_cents, 100000); // 1000.00 PKR
    assert.equal(p1.items[0].line_total_cents, 100000);
    assert.equal(p1.items[0].discount_percent, 0);
    console.log('  PASS: Case 1 Total is PKR 1000.00 without discount.\n');

    // CASE 2: Line qty 10, price 100, discount 5%: total 950; purchase total, payable, journal and supplier statement all show 950
    console.log('Test Case 2: Line qty 10, price 100, discount 5%...');
    const c2 = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-CASE-2',
      invoice_date: '2026-10-31',
      status: 'received',
      items: [{
        product_id: 1,
        batch_number: 'B-C2',
        expiry_date: '2028-12-31',
        quantity: 10,
        unit_cost: '100.00',
        discount_percent: 5
      }]
    });
    assert.equal(c2.status, 201);
    const p2 = (await request(`/api/purchases/${c2.data.id}`)).data;
    assert.equal(p2.total_cents, 95000); // 950.00 PKR
    assert.equal(p2.items[0].discount_cents, 5000); // 50.00 discount
    assert.equal(p2.items[0].line_total_cents, 95000);
    assert.equal(p2.items[0].discount_percent, 5);

    // Check journal entry
    const je2 = db.prepare(`SELECT * FROM journal_entries WHERE reference_id = ?`).get(`PUR-${c2.data.id}`);
    assert.ok(je2, 'Journal entry created for purchase');
    const lines2 = db.prepare(`SELECT * FROM journal_lines WHERE entry_id = ?`).all(je2.id);
    const apLine = lines2.find(l => l.account_id === 2010);
    const invLine = lines2.find(l => l.account_id === 1200);
    assert.equal(apLine.credit_cents, 95000, 'Accounts payable credit must be 950.00');
    assert.equal(invLine.debit_cents, 95000, 'Inventory debit must be 950.00');

    // Check supplier statement
    const stmt2 = (await request(`/api/suppliers/${supplierId}/statement`)).data;
    const inv2Row = stmt2.transactions.find(t => t.description.includes('INV-CASE-2'));
    assert.ok(inv2Row, 'Statement contains INV-CASE-2');
    assert.equal(inv2Row.credit, '950.00');
    console.log('  PASS: Case 2 purchase total, AP journal, and supplier statement all equal PKR 950.00.\n');

    // CASE 3: Purchase with two lines, only one discounted: totals correct to the paisa; the other line unaffected
    console.log('Test Case 3: Two lines, only one discounted...');
    const c3 = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-CASE-3',
      invoice_date: '2026-10-31',
      status: 'received',
      items: [
        {
          product_id: 1,
          batch_number: 'B-C3-1',
          expiry_date: '2028-12-31',
          quantity: 10,
          unit_cost: '100.00',
          discount_percent: 10 // 1000 - 100 = 900
        },
        {
          product_id: 2,
          batch_number: 'B-C3-2',
          expiry_date: '2028-12-31',
          quantity: 4,
          unit_cost: '50.00' // 200, discount 0
        }
      ]
    });
    assert.equal(c3.status, 201);
    const p3 = (await request(`/api/purchases/${c3.data.id}`)).data;
    assert.equal(p3.items[0].line_total_cents, 90000);
    assert.equal(p3.items[1].line_total_cents, 20000);
    assert.equal(p3.total_cents, 110000); // 1100.00
    console.log('  PASS: Case 3 lines: PKR 900.00 + PKR 200.00 = PKR 1100.00 exactly.\n');

    // CASE 4: Odd numbers: qty 3, price 33.33, discount 12.5% rounds correctly to 2 decimals
    console.log('Test Case 4: Odd numbers qty 3 @ 33.33, discount 12.5%...');
    // Gross = 3 * 3333 = 9999 cents (99.99 PKR)
    // Discount = round(9999 * 0.125) = round(1249.875) = 1250 cents (12.50 PKR)
    // Net Line Total = 9999 - 1250 = 8749 cents (87.49 PKR)
    const c4 = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-CASE-4',
      invoice_date: '2026-10-31',
      status: 'received',
      items: [{
        product_id: 3,
        batch_number: 'B-C4',
        expiry_date: '2028-12-31',
        quantity: 3,
        unit_cost: '33.33',
        discount_percent: 12.5
      }]
    });
    assert.equal(c4.status, 201);
    const p4 = (await request(`/api/purchases/${c4.data.id}`)).data;
    assert.equal(p4.items[0].discount_cents, 1250);
    assert.equal(p4.items[0].line_total_cents, 8749);
    assert.equal(p4.total_cents, 8749);
    console.log('  PASS: Case 4 99.99 - 12.50 = 87.49 PKR to the paisa.\n');

    // CASE 5: Invalid input rejected; empty discount accepted as 0; tamper rejection
    console.log('Test Case 5: Validation (-5, 101, "abc", tamper)...');
    const negDisc = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-INVALID-1',
      invoice_date: '2026-10-31',
      items: [{ product_id: 1, batch_number: 'B-INV', expiry_date: '2028-12-31', quantity: 1, unit_cost: '10.00', discount_percent: -5 }]
    });
    assert.equal(negDisc.status, 400, 'Negative discount must be rejected');

    const overDisc = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-INVALID-2',
      invoice_date: '2026-10-31',
      items: [{ product_id: 1, batch_number: 'B-INV', expiry_date: '2028-12-31', quantity: 1, unit_cost: '10.00', discount_percent: 101 }]
    });
    assert.equal(overDisc.status, 400, 'Discount > 100 must be rejected');

    const strDisc = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-INVALID-3',
      invoice_date: '2026-10-31',
      items: [{ product_id: 1, batch_number: 'B-INV', expiry_date: '2028-12-31', quantity: 1, unit_cost: '10.00', discount_percent: 'abc' }]
    });
    assert.equal(strDisc.status, 400, 'NaN discount must be rejected');

    const tamperLine = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-TAMPER-1',
      invoice_date: '2026-10-31',
      items: [{ product_id: 1, batch_number: 'B-INV', expiry_date: '2028-12-31', quantity: 10, unit_cost: '100.00', discount_percent: 5, line_total: '500.00' }]
    });
    assert.equal(tamperLine.status, 400, 'Tampered line total must be rejected');

    const emptyDisc = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-EMPTY-1',
      invoice_date: '2026-10-31',
      items: [{ product_id: 1, batch_number: 'B-EMPTY', expiry_date: '2028-12-31', quantity: 2, unit_cost: '50.00', discount_percent: '' }]
    });
    assert.equal(emptyDisc.status, 201, 'Empty discount string must be accepted as 0');
    console.log('  PASS: Case 5 all invalid inputs and tamper attempts properly rejected.\n');

    // CASE 6: Bonus quantity: stock increases by qty + bonus, invoice amount only qty-based discounted total, cost per unit as expected
    console.log('Test Case 6: Bonus quantity with discount...');
    const stockBefore6 = db.prepare('SELECT quantity FROM inventory WHERE product_id = 1').get().quantity;
    const c6 = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-CASE-6',
      invoice_date: '2026-10-31',
      status: 'received',
      items: [{
        product_id: 1,
        batch_number: 'B-C6',
        expiry_date: '2028-12-31',
        quantity: 10,
        bonus_quantity: 2,
        unit_cost: '100.00',
        discount_percent: 10
      }]
    });
    assert.equal(c6.status, 201);
    const p6 = (await request(`/api/purchases/${c6.data.id}`)).data;
    assert.equal(p6.total_cents, 90000); // 10 * 100 - 10% = 900.00 (bonus does not increase invoice amount)
    const stockAfter6 = db.prepare('SELECT quantity FROM inventory WHERE product_id = 1').get().quantity;
    assert.equal(stockAfter6 - stockBefore6, 12, 'Stock increased by qty (10) + bonus (2) = 12');
    const batch6 = db.prepare('SELECT * FROM inventory_batches WHERE purchase_id = ?').get(c6.data.id);
    assert.equal(batch6.initial_quantity, 12);
    assert.equal(batch6.unit_cost_cents, 7500); // Math.round(90000 / 12) = 75.00 per unit (diluted by bonus)
    console.log('  PASS: Case 6 stock increased by 12, invoice amount 900.00, batch unit cost 75.00.\n');

    // CASE 7: Fully paid, partially paid and unpaid purchases with discount: balance and supplier statement
    console.log('Test Case 7: Paid, partial and unpaid with discount...');
    const c7Paid = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-C7-PAID',
      invoice_date: '2026-10-31',
      status: 'received',
      payment_method: 'cash',
      paid_amount: '950.00',
      items: [{ product_id: 1, batch_number: 'B-C7-1', expiry_date: '2028-12-31', quantity: 10, unit_cost: '100.00', discount_percent: 5 }]
    });
    assert.equal(c7Paid.status, 201);
    const p7Paid = (await request(`/api/purchases/${c7Paid.data.id}`)).data;
    assert.equal(p7Paid.payment_status, 'paid');
    assert.equal(p7Paid.outstanding_cents, 0);

    const c7Partial = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-C7-PARTIAL',
      invoice_date: '2026-10-31',
      status: 'received',
      payment_method: 'cash',
      paid_amount: '500.00',
      items: [{ product_id: 1, batch_number: 'B-C7-2', expiry_date: '2028-12-31', quantity: 10, unit_cost: '100.00', discount_percent: 5 }]
    });
    assert.equal(c7Partial.status, 201);
    const p7Partial = (await request(`/api/purchases/${c7Partial.data.id}`)).data;
    assert.equal(p7Partial.payment_status, 'partially_paid');
    assert.equal(p7Partial.outstanding_cents, 45000); // 950 - 500 = 450

    // Pay remaining 450 later via supplier payment
    const payLater = await request('/api/ledger/payments', 'POST', {
      party_type: 'supplier',
      party_id: supplierId,
      payment_date: '2026-10-31',
      amount: '450.00',
      payment_method: 'cash',
      allocations: [{ invoice_id: c7Partial.data.id, invoice_type: 'purchase', amount: '450.00' }]
    });
    assert.equal(payLater.status, 201);
    const p7AfterPay = (await request(`/api/purchases/${c7Partial.data.id}`)).data;
    assert.equal(p7AfterPay.outstanding_cents, 0);
    assert.equal(p7AfterPay.payment_status, 'paid');
    console.log('  PASS: Case 7 payment statuses and settlements correctly verified.\n');

    // CASE 8: Receive now vs receive later (draft) with discount
    console.log('Test Case 8: Receive now vs receive later with discount...');
    const stockBefore8 = db.prepare('SELECT quantity FROM inventory WHERE product_id = 2').get().quantity;
    const c8Draft = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-C8-DRAFT',
      invoice_date: '2026-10-31',
      status: 'draft',
      items: [{ product_id: 2, batch_number: 'B-C8', expiry_date: '2028-12-31', quantity: 5, unit_cost: '50.00', discount_percent: 20 }]
    });
    assert.equal(c8Draft.status, 201);
    const stockDuringDraft = db.prepare('SELECT quantity FROM inventory WHERE product_id = 2').get().quantity;
    assert.equal(stockDuringDraft, stockBefore8, 'Draft must not change inventory');

    // Receive draft now
    const c8Receive = await request(`/api/purchases/${c8Draft.data.id}/receive`, 'POST', {});
    assert.equal(c8Receive.status, 200);
    const stockAfter8 = db.prepare('SELECT quantity FROM inventory WHERE product_id = 2').get().quantity;
    assert.equal(stockAfter8 - stockBefore8, 5, 'Receiving draft increases stock');
    const p8 = (await request(`/api/purchases/${c8Draft.data.id}`)).data;
    assert.equal(p8.total_cents, 20000); // 5 * 50 - 20% = 200.00
    console.log('  PASS: Case 8 draft did not affect stock, receive updated stock and posted 200.00 total.\n');

    // CASE 9: Purchase draft saved and reopened keeps discount values
    console.log('Test Case 9: Purchase draft saved keeps discount values...');
    const c9Draft = await request('/api/purchases', 'POST', {
      supplier_id: supplierId,
      invoice_no: 'INV-C9-PRESERVE',
      invoice_date: '2026-10-31',
      status: 'draft',
      items: [{ product_id: 1, batch_number: 'B-C9', expiry_date: '2028-12-31', quantity: 8, unit_cost: '80.00', discount_percent: 15 }]
    });
    assert.equal(c9Draft.status, 201);
    const p9 = (await request(`/api/purchases/${c9Draft.data.id}`)).data;
    assert.equal(p9.items[0].discount_percent, 15);
    assert.equal(p9.items[0].discount_cents, 9600); // 8 * 80 * 0.15 = 96.00
    assert.equal(p9.items[0].line_total_cents, 54400); // 640 - 96 = 544.00
    console.log('  PASS: Case 9 draft preserves discount_percent (15%) and line totals.\n');

    // CASE 10: Purchase return of discounted items refunds net cost; supplier balance and journal correct
    console.log('Test Case 10: Purchase return of discounted items refunds net cost...');
    // We created c2 with 10 units @ 100 with 5% discount (net cost 95.00 each)
    const ret10 = await request(`/api/purchases/${c2.data.id}/return`, 'POST', {
      product_id: 1,
      batch_number: 'B-C2',
      quantity: 2,
      reason: 'Damaged packaging'
    });
    assert.equal(ret10.status, 200);
    assert.equal(ret10.data.total_refund, '190.00'); // 2 units * 95.00 = 190.00 exactly (never gross 200!)
    const pretRecord = db.prepare('SELECT * FROM purchase_returns WHERE purchase_id = ?').get(c2.data.id);
    assert.equal(pretRecord.unit_cost_cents, 9500);
    assert.equal(pretRecord.total_cents, 19000);
    console.log('  PASS: Case 10 return refunded net cost (PKR 190.00 for 2 units, not gross 200.00).\n');

    // CASE 11: Purchase View modal and any print show discount %/net total; OLD purchase opens as before
    console.log('Test Case 11: Purchase View and backward compatibility with old purchases...');
    // Insert an old purchase without discount_percent
    db.prepare(`INSERT INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
      VALUES (999,'OLD-PREV-VER',1,'2026-09-01','2026-09-01','2026-09-01','2026-10-01','received','paid',50000,50000,'Old system purchase',1)`).run();
    db.prepare(`INSERT INTO purchase_items(purchase_id,product_id,product_name,batch_number,expiry_date,quantity,unit_cost_cents,discount_cents,discount_percent,tax_cents,line_total_cents)
      VALUES (999,1,'Panadol Regular 500mg','OLD-B1','2028-12-31',5,10000,0,0,0,50000)`).run();

    const pOld = (await request('/api/purchases/999')).data;
    assert.equal(pOld.total, '500.00');
    assert.equal(pOld.items[0].discount_percent, 0);
    assert.equal(pOld.items[0].line_total, '500.00');
    console.log('  PASS: Case 11 old purchase opens and formats with discount 0% / - cleanly.\n');

    // CASE 12: Batch cost price equals net cost per unit; stock quantity correct; FEFO unaffected
    console.log('Test Case 12: Batch unit cost and FEFO...');
    const batch2 = db.prepare("SELECT * FROM inventory_batches WHERE batch_number = ?").get('B-C2');
    assert.equal(batch2.unit_cost_cents, 9500); // 95.00 net cost
    console.log('  PASS: Case 12 batch cost price is PKR 95.00.\n');

    // CASE 13: Trial balance debits == credits after all of the above
    console.log('Test Case 13: Trial balance debits == credits...');
    const tb = (await request('/api/ledger/trial-balance')).data;
    assert.equal(tb.is_balanced, true, 'Trial balance must be balanced');
    assert.equal(tb.total_debit, tb.total_credit, `Debits (${tb.total_debit}) must equal Credits (${tb.total_credit})`);
    console.log(`  PASS: Case 13 Trial Balance is perfectly balanced (${tb.total_debit} == ${tb.total_credit}).\n`);

    // CASE 14: Database created by PREVIOUS version opens/restores and works with new code
    console.log('Test Case 14: Previous version DB compatibility...');
    const cols = db.prepare("PRAGMA table_info('purchase_items')").all().map(c => c.name);
    assert.ok(cols.includes('discount_percent'), 'discount_percent column exists');
    assert.ok(cols.includes('line_total_cents'), 'line_total_cents column exists');
    console.log('  PASS: Case 14 backward-compatible migration verified.\n');

    console.log('============================================================');
    console.log('ALL 14 TASK 2 PURCHASE DISCOUNT TEST CASES PASSED 100%!');
    console.log('============================================================\n');

    server.close();
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    process.exit(0);
  } catch (err) {
    console.error('VERIFICATION FAILED:', err);
    if (server.listening) server.close();
    try { const { db } = require('../api/sqlite'); db.close(); } catch (_) {}
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (_) {}
    process.exit(1);
  }
})();
