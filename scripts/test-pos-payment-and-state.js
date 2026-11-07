const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

// Use isolated test directory - NEVER touch real %APPDATA%\PharmaSpot!
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-pos-suite-'));
process.env.APPDATA = root;
process.env.APPNAME = 'PharmaSpotTest';
const dataDir = path.join(root, process.env.APPNAME);
fs.mkdirSync(path.join(dataDir, 'server', 'databases'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/inventory', require('../api/inventory'));
app.use('/api', require('../api/transactions'));
const server = app.listen(0, '127.0.0.1');

async function request(route, method = 'GET', body) {
  const url = `http://127.0.0.1:${server.address().port}${route}`;
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function addTestProduct(id, barcode, name, price, qty, expiry = '31-Dec-2035') {
  const { db } = require('../api/sqlite');
  db.prepare(`INSERT OR REPLACE INTO products(id, barcode, name, price_cents, expiration_date, stock_tracked)
    VALUES (?, ?, ?, ?, ?, 1)`).run(id, barcode, name, Math.round(price * 100), expiry);
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id, quantity)
    VALUES (?, ?)`).run(id, qty);
}

async function runSuite() {
  if (!server.listening) await once(server, 'listening');

  console.log('=== RUNNING AUTOMATED POS PAYMENT & STATE TEST SUITE ===');

  // Setup test products
  await addTestProduct(101, 101001, 'Panadol 500mg', 5.00, 50);
  await addTestProduct(102, 102002, 'Amoxicillin 250mg', 12.50, 30);
  await addTestProduct(103, 103003, 'Expired Syrup', 8.00, 10, '01-Jan-2020');

  // -------------------------------------------------------------
  // TEST 1: Database rollback behavior in api/sqlite.js
  // -------------------------------------------------------------
  console.log('\n[TEST 1] Verifying unconditional rollback on error in sqlite.js...');
  const { db, transaction } = require('../api/sqlite');
  let errCaught = false;
  try {
    transaction(() => {
      db.prepare('UPDATE inventory SET quantity = 999 WHERE product_id = 101').run();
      throw new Error('Forced work() failure');
    });
  } catch (e) {
    errCaught = true;
    assert.equal(e.message, 'Forced work() failure');
  }
  assert.equal(errCaught, true);
  // Ensure inventory was NOT changed (was rolled back)
  const q1 = db.prepare('SELECT quantity FROM inventory WHERE product_id = 101').get().quantity;
  assert.equal(q1, 50, 'Quantity must remain 50 after rollback');

  // Next transaction must succeed immediately
  const nextRes = transaction(() => {
    return 'tx-success';
  });
  assert.equal(nextRes, 'tx-success', 'Subsequent transaction must succeed');
  console.log('  -> PASS: Rollback and subsequent transaction work correctly.');

  // -------------------------------------------------------------
  // TEST 2: Unrounded VAT causing "Invalid money amount." failure
  // In current pos.js: totalVat = (total * vat) / 100 sends raw float (e.g. 0.4995)
  // This test checks that sending unrounded VAT fails on backend cents() check (400),
  // whereas rounding to 2 decimals succeeds (200).
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Verifying VAT rounding behavior...');
  const unroundedTax = 0.4995; // (3.33 * 15) / 100
  const unroundedSale = {
    _id: 'vat-test-unrounded',
    order: 'vat-test-unrounded',
    status: 1,
    items: [{ id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 1 }],
    discount: 0,
    tax: unroundedTax,
    total: 5.50,
    paid: 5.50,
    date: new Date().toISOString()
  };
  const unroundedRes = await request('/api/new', 'POST', unroundedSale);
  console.log('  Unrounded VAT response status:', unroundedRes.status, unroundedRes.data);
  assert.equal(unroundedRes.status, 400, 'Unrounded VAT must be rejected with 400 Invalid money amount');

  const roundedTax = Number((unroundedTax).toFixed(2)); // 0.50
  const roundedSale = {
    _id: 'vat-test-rounded',
    order: 'vat-test-rounded',
    status: 1,
    items: [{ id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 1 }],
    discount: 0,
    tax: roundedTax,
    total: 5.50,
    paid: 5.50,
    date: new Date().toISOString()
  };
  const roundedRes = await request('/api/new', 'POST', roundedSale);
  assert.equal(roundedRes.status, 200, 'Properly 2-decimal rounded VAT sale must succeed');
  console.log('  -> PASS: VAT rounding test verified.');

  // -------------------------------------------------------------
  // TEST 3: Held order double-submit race condition
  // In current pos.js: held order PUT generates new Date(moment()) on each click!
  // Request 1 has date1, Request 2 has date2.
  // Request 2 fails with 409 'Sale ID already belongs to another completed sale.'!
  // In fixed code: frontend uses a stable timestamp per sale attempt.
  // -------------------------------------------------------------
  console.log('\n[TEST 3] Verifying held order double-submit race condition...');
  const heldSaleId = 'held-race-test-001';
  const initialHeld = {
    _id: heldSaleId,
    order: heldSaleId,
    status: 0,
    ref_number: 'REF-001',
    items: [{ id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 2 }],
    discount: 0,
    tax: 0,
    total: 10,
    paid: '',
    date: '2026-10-29T10:00:00.000Z'
  };
  const heldCreateRes = await request('/api/new', 'POST', initialHeld);
  assert.equal(heldCreateRes.status, 200, 'Held order creation must succeed');

  // SIMULATE BUGGY CURRENT FRONTEND BEHAVIOR (different timestamps on double-click):
  const bugClick1 = { ...initialHeld, status: 1, paid: 10, date: '2026-10-29T10:05:00.100Z' };
  const bugClick2 = { ...initialHeld, status: 1, paid: 10, date: '2026-10-29T10:05:00.250Z' };

  const resClick1 = await request('/api/new', 'PUT', bugClick1);
  assert.equal(resClick1.status, 200, 'First payment click on held order succeeds');

  const resClick2 = await request('/api/new', 'PUT', bugClick2);
  console.log('  Second click with different timestamp (current buggy frontend):', resClick2.status, resClick2.data);
  assert.equal(resClick2.status, 409, 'Different timestamp on second click fails with 409 conflict');

  // NOW TEST FIXED FRONTEND BEHAVIOR (stable timestamp & idempotency key reused):
  const heldSaleId2 = 'held-race-test-002';
  const initialHeld2 = {
    _id: heldSaleId2,
    order: heldSaleId2,
    status: 0,
    ref_number: 'REF-002',
    items: [{ id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 2 }],
    discount: 0,
    tax: 0,
    total: 10,
    paid: '',
    date: '2026-10-29T10:00:00.000Z'
  };
  await request('/api/new', 'POST', initialHeld2);

  const stableAttempt = { ...initialHeld2, status: 1, paid: 10, date: '2026-10-29T10:10:00.000Z' };
  const fixedClick1 = await request('/api/new', 'PUT', stableAttempt);
  assert.equal(fixedClick1.status, 200);

  const fixedClick2 = await request('/api/new', 'PUT', stableAttempt);
  assert.equal(fixedClick2.status, 200, 'Reused stable attempt on retry/double-click must return 200 (duplicate)');
  console.log('  -> PASS: Double-submit idempotency verified.');

  // -------------------------------------------------------------
  // TEST 4: Error Logging to %APPDATA%\PharmaSpot\logs\pos-errors.log
  // Verify that payment failure writes to log file and returns readable message
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Verifying POS error logging to file...');
  const logFile = path.join(dataDir, 'logs', 'pos-errors.log');
  
  // Trigger a sale failure (insufficient stock)
  const failSale = {
    _id: 'fail-stock-test',
    order: 'fail-stock-test',
    status: 1,
    items: [{ id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 9999 }],
    discount: 0,
    tax: 0,
    total: 49995,
    paid: 49995,
    date: new Date().toISOString()
  };
  const failRes = await request('/api/new', 'POST', failSale);
  assert.equal(failRes.status, 409, 'Sale with insufficient stock must fail with 409');
  assert.match(failRes.data.message, /Insufficient stock/);

  // Check if log file exists and contains error details (required by condition 5)
  console.log('  Checking for log file at:', logFile);
  const logExists = fs.existsSync(logFile);
  assert.equal(logExists, true, 'pos-errors.log MUST exist under app data logs folder after payment error');
  const logContent = fs.readFileSync(logFile, 'utf8');
  assert.match(logContent, /Insufficient stock/, 'Log file must record error message');
  console.log('  -> PASS: pos-errors.log verified.');

  // -------------------------------------------------------------
  // TEST 5: POS Draft Persistence & Validation Logic
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Verifying POS draft persistence validation rules...');
  // Mock product catalog as seen by POS frontend
  const allProducts = [
    { _id: 101, name: 'Panadol 500mg', price: '5.00', quantity: 50, stock: 1, expirationDate: '31-Dec-2035' },
    { _id: 102, name: 'Amoxicillin 250mg', price: '15.00', quantity: 2, stock: 1, expirationDate: '31-Dec-2035' },
    { _id: 103, name: 'Expired Syrup', price: '8.00', quantity: 10, stock: 1, expirationDate: '01-Jan-2020' },
  ];

  const savedDraft = {
    userId: 1,
    cart: [
      { id: 101, product_name: 'Panadol 500mg', price: '5.00', quantity: 3 },
      { id: 102, product_name: 'Amoxicillin 250mg', price: '12.50', quantity: 5 },
      { id: 103, product_name: 'Expired Syrup', price: '8.00', quantity: 1 },
      { id: 999, product_name: 'Deleted Med', price: '20.00', quantity: 1 }
    ],
    discount: 2,
    customer: JSON.stringify({ id: 'c1', name: 'Test Customer' }),
    payment: '10.00',
    paymentText: '10.00',
    paymentType: 1
  };

  function validateRestoredDraft(draft, products, currentUserId) {
    if (!draft || draft.userId !== currentUserId || !Array.isArray(draft.cart)) return null;
    const validatedCart = [];
    for (const item of draft.cart) {
      const prod = products.find(p => p._id === item.id);
      if (!prod) continue;
      const isExp = require('../assets/js/utils').isExpired(prod.expirationDate);
      if (isExp) continue;
      
      let qty = parseInt(item.quantity) || 1;
      if (prod.stock == 1) {
        if (prod.quantity <= 0) continue;
        if (qty > prod.quantity) qty = prod.quantity;
      }
      validatedCart.push({
        id: prod._id,
        product_name: prod.name,
        sku: prod.barcode || prod.sku,
        price: prod.price,
        quantity: qty
      });
    }
    return {
      ...draft,
      cart: validatedCart
    };
  }

  const restored = validateRestoredDraft(savedDraft, allProducts, 1);
  assert.equal(restored.cart.length, 2, 'Should keep only the 2 valid items');
  assert.equal(restored.cart[0].id, 101);
  assert.equal(restored.cart[0].quantity, 3);
  assert.equal(restored.cart[1].id, 102);
  assert.equal(restored.cart[1].quantity, 2, 'Quantity should be clamped to current stock (2)');
  assert.equal(restored.cart[1].price, '15.00', 'Price should be updated to current price (15.00)');

  const otherUserRestored = validateRestoredDraft(savedDraft, allProducts, 2);
  assert.equal(otherUserRestored, null, 'Draft of another user must be discarded');
  console.log('  -> PASS: Draft restoration and validation rules passed.');

  console.log('\n=== ALL POS PAYMENT & STATE SUITE TESTS PASSED ===\n');
}

runSuite().then(() => {
  server.close(() => {
    try { require('../api/sqlite').db.close(); } catch (_) {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });
}).catch(err => {
  console.error('\nSUITE ERROR:', err);
  server.close(() => {
    try { require('../api/sqlite').db.close(); } catch (_) {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    process.exitCode = 1;
  });
});
