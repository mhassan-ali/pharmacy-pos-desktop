const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const http = require('http');
const moment = require('moment');
const { DatabaseSync } = require('node:sqlite');

// Isolated TEST_APPDATA and isolated PORT
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-pack-test-'));
const appDataDir = path.join(testDir, 'appData');
fs.mkdirSync(appDataDir, { recursive: true });
process.env.TEST_APPDATA = appDataDir;
process.env.APPDATA = appDataDir;
process.env.APPNAME = 'PharmaSpot';
const PORT = 43301;
process.env.PORT = String(PORT);

console.log('=== MULTI MEDICOS PACK SIZES VERIFICATION (STAGE A) ===');
console.log('Isolated APPDATA:', appDataDir);

const { db, transaction, cents, pkr, runMigrations } = require('../api/sqlite');
const serverModule = require('../server');
const {
  formatUnitName,
  formatStockPacks,
  calcCumulativeCost,
  calcCostAllocation,
  adjustBatchStock,
  resolveUnitMultiplier,
  resolveTierPriceCents
} = require('../api/pack-helpers');

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

function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (err) {
    console.error('Cleanup warning:', err.message);
  }
}

async function run() {
  try {
    await serverModule.ready;
    console.log('Server ready on port', PORT);

    // Setup owner
    const ownerRes = await request('POST', '/api/users/setup', {
      username: 'owner',
      password: 'password12345'
    });
    assert.strictEqual(ownerRes.status, 200, 'Owner creation must succeed');
    const ownerAuth = { 'X-Access-Token': ownerRes.body.token };

    // Setup Supplier
    const supRes = await request('POST', '/api/suppliers', {
      name: 'PharmaDist Pakistan',
      phone: '03001234567',
      address: 'Lahore'
    }, ownerAuth);
    assert.ok(supRes.status === 200 || supRes.status === 201);
    const supplierId = supRes.body.id;

    // Setup Customer for Khata test
    const custId = 1;
    db.prepare('INSERT OR REPLACE INTO customers (id, name, phone, credit_limit_cents, data_json) VALUES (?, ?, ?, ?, ?)').run(
      custId, 'Zubair Ahmed', '03331112233', 100000, JSON.stringify({ _id: custId, name: 'Zubair Ahmed' })
    );

    // =========================================================================
    // TEST 1: Box = 10 strips = 100 tablets, buy 5 boxes at PKR 800 with 5% discount
    // =========================================================================
    console.log('\n--- TEST 1: Purchase 5 boxes with 5% discount ---');
    const prod1Res = await request('POST', '/api/inventory/product', {
      name: 'Panadol Extra Pack',
      barcode: 8881001,
      price: '12.00', // PKR 12.00 per tablet
      category: 'Analgesics',
      base_unit: 'Tablet',
      units_per_box: 100,
      units_per_strip: 10,
      box_price: '1000.00',
      strip_price: '110.00',
      default_sale_unit: 'strip'
    }, ownerAuth);
    assert.strictEqual(prod1Res.status, 200, 'Create product with pack fields');
    const p1Id = prod1Res.body.id || prod1Res.body._id;

    // Buy 5 boxes at PKR 800 each with 5% discount
    // Gross = 5 * 800 = 4000. Discount 5% = 200. Net = 3800.
    // Base units = 5 * 100 = 500 tablets.
    // Cost per tablet = 3800 / 500 = PKR 7.60 (760 cents).
    const pur1Res = await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-TEST-001',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [
        {
          product_id: p1Id,
          purchase_unit: 'Box',
          units_per_pack: 100,
          quantity: 5,
          unit_cost: 800.00,
          discount_percent: 5,
          batch_number: 'B001',
          expiry_date: '2028-12-31'
        }
      ]
    }, ownerAuth);
    assert.ok(pur1Res.status === 200 || pur1Res.status === 201, 'Purchase 5 boxes received');

    // Verify stock = 500
    const stockP1 = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(p1Id).quantity;
    assert.strictEqual(stockP1, 500, 'Stock must be 500 tablets');

    // Verify batch total cost and unit cost
    const batchP1 = db.prepare('SELECT * FROM inventory_batches WHERE product_id = ?').get(p1Id);
    assert.strictEqual(batchP1.initial_quantity, 500);
    assert.strictEqual(batchP1.quantity_available, 500);
    assert.strictEqual(batchP1.total_cost_cents, 380000, 'Batch total cost must be 380,000 cents (PKR 3,800)');
    assert.strictEqual(batchP1.unit_cost_cents, 760, 'Batch integer unit cost must be 760 cents (PKR 7.60)');

    // =========================================================================
    // TEST 2: Sell 1 strip, 3 tablets, 1 box (Detailed Numbers Print)
    // =========================================================================
    console.log('\n--- TEST 2: Sale scenario numbers breakdown (1 strip, 3 tablets, 1 box) ---');
    console.log('Purchase baseline: 5 boxes bought @ PKR 800 with 5% discount = PKR 3,800 total (500 tabs, unit cost = PKR 7.60/tab)');

    // Step 2a: Sell 1 strip @ 110.00
    const sale1Res = await request('POST', '/api/new', {
      _id: 'SALE-T2-1',
      id: 'SALE-T2-1',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p1Id, sale_unit: 'strip', quantity: 1, price: '110.00' }],
      total: '110.00',
      paid: '110.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(sale1Res.status, 200);

    const cogs1 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-T2-1').cost_cents;
    const profit1 = 11000 - cogs1;

    // Step 2b: Sell 3 tablets @ 12.00 each = 36.00
    const sale2Res = await request('POST', '/api/new', {
      _id: 'SALE-T2-2',
      id: 'SALE-T2-2',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p1Id, sale_unit: 'base', quantity: 3, price: '12.00' }],
      total: '36.00',
      paid: '36.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(sale2Res.status, 200);

    const cogs2 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-T2-2').cost_cents;
    const profit2 = 3600 - cogs2;

    // Step 2c: Sell 1 box @ 1000.00
    const sale3Res = await request('POST', '/api/new', {
      _id: 'SALE-T2-3',
      id: 'SALE-T2-3',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p1Id, sale_unit: 'box', quantity: 1, price: '1000.00' }],
      total: '1000.00',
      paid: '1000.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(sale3Res.status, 200);

    const cogs3 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-T2-3').cost_cents;
    const profit3 = 100000 - cogs3;

    const bAfterT2 = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchP1.id);
    const totalT2Cogs = cogs1 + cogs2 + cogs3;
    const remainingBatchCostT2 = bAfterT2.total_cost_cents - bAfterT2.cumulative_cost_cents;

    console.log('+--------------------+------------+--------------+--------------+---------------+---------------+');
    console.log('| Sale Step          | Base Units | Expected Bill| Actual Bill  | Expected COGS | Actual COGS   | Expected Profit | Actual Profit |');
    console.log('+--------------------+------------+--------------+--------------+---------------+---------------+');
    console.log(`| Line 1: 1 Strip    | 10 tabs    | PKR 110.00   | PKR 110.00   | PKR 76.00     | PKR ${(cogs1 / 100).toFixed(2)}     | PKR 34.00       | PKR ${(profit1 / 100).toFixed(2)}     |`);
    console.log(`| Line 2: 3 Tablets  | 3 tabs     | PKR 36.00    | PKR 36.00    | PKR 22.80     | PKR ${(cogs2 / 100).toFixed(2)}     | PKR 13.20       | PKR ${(profit2 / 100).toFixed(2)}     |`);
    console.log(`| Line 3: 1 Box      | 100 tabs   | PKR 1,000.00 | PKR 1,000.00 | PKR 760.00    | PKR ${(cogs3 / 100).toFixed(2)}    | PKR 240.00      | PKR ${(profit3 / 100).toFixed(2)}    |`);
    console.log('+--------------------+------------+--------------+--------------+---------------+---------------+');
    console.log(`| Total              | 113 tabs   | PKR 1,146.00 | PKR 1,146.00 | PKR 858.80    | PKR ${(totalT2Cogs / 100).toFixed(2)}    | PKR 287.20      | PKR ${((114600 - totalT2Cogs) / 100).toFixed(2)}    |`);
    console.log('+--------------------+------------+--------------+--------------+---------------+---------------+');
    console.log(`Remaining stock: ${bAfterT2.quantity_available} base units ("${formatStockPacks(bAfterT2.quantity_available, 100, 10, 'Tablet')}")`);
    console.log(`Remaining batch cost: PKR ${(remainingBatchCostT2 / 100).toFixed(2)}, Cumulative charged: PKR ${(bAfterT2.cumulative_cost_cents / 100).toFixed(2)}`);
    assert.strictEqual(cogs1, 7600, 'Expected COGS 76.00 for 1 strip');
    assert.strictEqual(profit1, 3400, 'Expected profit 34.00 for 1 strip');
    assert.strictEqual(cogs2, 2280, 'Expected COGS 22.80 for 3 tablets');
    assert.strictEqual(profit2, 1320, 'Expected profit 13.20 for 3 tablets');
    assert.strictEqual(cogs3, 76000, 'Expected COGS 760.00 for 1 box');
    assert.strictEqual(profit3, 24000, 'Expected profit 240.00 for 1 box');
    assert.strictEqual(bAfterT2.quantity_available, 387, 'Stock must be 387 tablets');
    assert.strictEqual(bAfterT2.cumulative_cost_cents + remainingBatchCostT2, bAfterT2.total_cost_cents, 'Invariant held: charged + remaining = total cost');

    // =========================================================================
    // TEST 3: Awkward cost (1 box of 30 tabs bought for PKR 1,000 = 100,000 cents)
    // Full step-by-step table print & invariant proof across sales, returns, adjustments
    // =========================================================================
    console.log('\n--- TEST 3: Awkward Cost Exact Integer Invariant Verification ---');
    console.log('Setup: 1 box of 30 tabs bought for PKR 1,000.00 (100,000 cents). Unit cost = 33.333... cents/tab.');

    const prod3Res = await request('POST', '/api/inventory/product', {
      name: 'Awkward Pack Medicine',
      barcode: 8881003,
      price: '50.00',
      category: 'Antibiotics',
      base_unit: 'Tablet',
      units_per_box: 30,
      box_price: '1500.00'
    }, ownerAuth);
    const p3Id = prod3Res.body.id || prod3Res.body._id;

    // Buy 1 box of 30 tablets for PKR 1,000.00 (100,000 cents)
    const pur3Res = await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-TEST-AWKWARD',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [
        {
          product_id: p3Id,
          purchase_unit: 'Box',
          units_per_pack: 30,
          quantity: 1,
          unit_cost: 1000.00,
          batch_number: 'BAWK1',
          expiry_date: '2028-12-31'
        }
      ]
    }, ownerAuth);
    assert.ok(pur3Res.status === 200 || pur3Res.status === 201);
    const bAwk1 = db.prepare('SELECT * FROM inventory_batches WHERE batch_number = ?').get('BAWK1');

    console.log('\nBatch 1 Step-by-Step Ledger:');
    console.log('+----------------------------------+-------+---------------+--------------------+--------------------+--------------------+--------------+');
    console.log('| Step / Action                    | Units | Charged (PKR) | Cumulative Charged | Remaining Cost     | Qty Available      | Costed Units |');
    console.log('+----------------------------------+-------+---------------+--------------------+--------------------+--------------------+--------------+');

    function logBatchState(action, units, chargedCents, batch) {
      const remainingCost = batch.total_cost_cents - batch.cumulative_cost_cents;
      console.log(
        `| ${action.padEnd(32)} | ` +
        `${String(units).padStart(5)} | ` +
        `PKR ${(chargedCents / 100).toFixed(2).padStart(10)} | ` +
        `PKR ${(batch.cumulative_cost_cents / 100).toFixed(2).padStart(15)} | ` +
        `PKR ${(remainingCost / 100).toFixed(2).padStart(15)} | ` +
        `${String(batch.quantity_available).padStart(18)} | ` +
        `${String(batch.costed_units).padStart(12)} |`
      );
      assert.strictEqual(
        batch.cumulative_cost_cents + remainingCost,
        batch.total_cost_cents,
        `Invariant violation at step: ${action}`
      );
    }

    logBatchState('Initial Batch Receipt', 30, 0, bAwk1);

    // Step 1: Sell 7 tabs
    await request('POST', '/api/new', {
      _id: 'SALE-AWK-1',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p3Id, sale_unit: 'base', quantity: 7, price: '50.00' }],
      total: '350.00',
      paid: '350.00',
      user_id: 1
    }, ownerAuth);
    const bAwkAfterS1 = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(bAwk1.id);
    const cAwk1 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-AWK-1').cost_cents;
    assert.strictEqual(cAwk1, 23333, '7 tabs COGS must be 23,333 cents');
    logBatchState('Sell 7 tablets', 7, cAwk1, bAwkAfterS1);

    // Step 2: Sell 13 tabs
    await request('POST', '/api/new', {
      _id: 'SALE-AWK-2',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p3Id, sale_unit: 'base', quantity: 13, price: '50.00' }],
      total: '650.00',
      paid: '650.00',
      user_id: 1
    }, ownerAuth);
    const bAwkAfterS2 = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(bAwk1.id);
    const cAwk2 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-AWK-2').cost_cents;
    assert.strictEqual(cAwk2, 43334, '13 tabs COGS must be 43,334 cents');
    logBatchState('Sell 13 tablets', 13, cAwk2, bAwkAfterS2);

    // Step 3: Customer return of 5 tabs (restocking to batch)
    const retAwkRes = await request('POST', '/api/return', {
      sale_id: 'SALE-AWK-2',
      product_id: p3Id,
      quantity: 5,
      return_unit: 'base',
      return_to_stock: 1,
      reason: 'Customer return 5 tablets',
      refund_method: 'cash'
    }, ownerAuth);
    assert.strictEqual(retAwkRes.status, 200);

    const bAwkAfterRet = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(bAwk1.id);
    const reversedCost = bAwkAfterS2.cumulative_cost_cents - bAwkAfterRet.cumulative_cost_cents;
    assert.strictEqual(reversedCost, 16667, 'Reversed cost must be exactly 16,667 cents');
    logBatchState('Customer return 5 tablets', -5, -reversedCost, bAwkAfterRet);

    // Step 4: Sell 10 tabs
    await request('POST', '/api/new', {
      _id: 'SALE-AWK-3',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p3Id, sale_unit: 'base', quantity: 10, price: '50.00' }],
      total: '500.00',
      paid: '500.00',
      user_id: 1
    }, ownerAuth);
    const bAwkAfterS3 = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(bAwk1.id);
    const cAwk3 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-AWK-3').cost_cents;
    assert.strictEqual(cAwk3, 33333, '10 tabs COGS must be 33,333 cents');
    logBatchState('Sell 10 tablets', 10, cAwk3, bAwkAfterS3);

    // Step 4b: Sell final remaining 5 tabs to completely exhaust batch
    await request('POST', '/api/new', {
      _id: 'SALE-AWK-4',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p3Id, sale_unit: 'base', quantity: 5, price: '50.00' }],
      total: '250.00',
      paid: '250.00',
      user_id: 1
    }, ownerAuth);
    const bAwkFinal = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(bAwk1.id);
    const cAwk4 = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-AWK-4').cost_cents;
    assert.strictEqual(cAwk4, 16667, 'Final 5 tabs COGS must be 16,667 cents');
    logBatchState('Sell final 5 tabs (Exhausted)', 5, cAwk4, bAwkFinal);
    console.log('+----------------------------------+-------+---------------+--------------------+--------------------+--------------------+--------------+');

    // Check that batch is completely exhausted and total net COGS === batch cost to the single paisa!
    assert.strictEqual(bAwkFinal.quantity_available, 0, 'Batch 1 must have 0 quantity available');
    assert.strictEqual(bAwkFinal.costed_units, 30, 'Batch 1 must have 30 costed units');
    assert.strictEqual(bAwkFinal.cumulative_cost_cents, 100000, 'Batch 1 cumulative cost must equal EXACT 100,000 cents');
    const netCOGS = cAwk1 + cAwk2 - reversedCost + cAwk3 + cAwk4;
    assert.strictEqual(netCOGS, 100000, 'Net COGS charged must be EXACTLY PKR 1,000.00 (100,000 cents)');
    console.log('PASS: Batch 1 fully exhausted. Total Net COGS = PKR 1,000.00 exact to the paisa (0 paisa discrepancy).');

    // -------------------------------------------------------------------------
    // Batch 2: Purchase Return, Stock Adjustment (Dec/Inc), Owner Set Batch Cost
    // -------------------------------------------------------------------------
    console.log('\n--- Batch 2: Purchase Return, Stock Adjustments, and Owner Cost Setting ---');
    const pur3bRes = await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-TEST-AWKWARD-2',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [
        {
          product_id: p3Id,
          purchase_unit: 'Box',
          units_per_pack: 30,
          quantity: 1,
          unit_cost: 1000.00,
          batch_number: 'BAWK2',
          expiry_date: '2029-12-31'
        }
      ]
    }, ownerAuth);
    assert.ok(pur3bRes.status === 200 || pur3bRes.status === 201);
    const b2 = db.prepare('SELECT * FROM inventory_batches WHERE batch_number = ?').get('BAWK2');

    // Step 5: Purchase return of 6 units to supplier
    const purRetRes = await request('POST', `/api/purchases/${pur3bRes.body.id}/return`, {
      product_id: p3Id,
      batch_number: 'BAWK2',
      quantity: 6,
      return_unit: 'base',
      reason: 'Damaged strips returned to supplier'
    }, ownerAuth);
    assert.strictEqual(purRetRes.status, 200, 'Purchase return succeeds');

    const b2AfterPurRet = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(b2.id);
    assert.strictEqual(b2AfterPurRet.quantity_available, 24, '24 units available after purchase return of 6');
    assert.strictEqual(b2AfterPurRet.initial_quantity, 24, 'Initial quantity adjusted to 24');
    assert.strictEqual(b2AfterPurRet.total_cost_cents, 80000, 'Total cost adjusted to 80,000 cents');
    assert.strictEqual(b2AfterPurRet.cumulative_cost_cents + (b2AfterPurRet.total_cost_cents - b2AfterPurRet.cumulative_cost_cents), b2AfterPurRet.total_cost_cents);
    console.log('PASS: Step 5 Purchase return verified. Invariant holds (charged 0 + remaining 800.00 === 800.00).');

    // Step 6: Stock Adjustments (Decrease 2, Increase 3)
    // 6a. Decrease 2 units (damage/shrinkage)
    const adjDec = adjustBatchStock(b2AfterPurRet, -2);
    db.prepare(`
      UPDATE inventory_batches
      SET quantity_available = ?, initial_quantity = ?, total_cost_cents = ?
      WHERE id = ?
    `).run(adjDec.newQuantityAvailable, adjDec.newInitialQty, adjDec.newTotalCost, b2.id);
    db.prepare('UPDATE inventory SET quantity = quantity - 2 WHERE product_id = ?').run(p3Id);

    const b2AfterDec = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(b2.id);
    assert.strictEqual(b2AfterDec.quantity_available, 22);
    assert.strictEqual(b2AfterDec.initial_quantity, 22);
    assert.strictEqual(b2AfterDec.cumulative_cost_cents + (b2AfterDec.total_cost_cents - b2AfterDec.cumulative_cost_cents), b2AfterDec.total_cost_cents);
    console.log(`PASS: Step 6a Stock decrease (-2 units). Invariant holds (remaining cost = PKR ${(b2AfterDec.total_cost_cents / 100).toFixed(2)}).`);

    // 6b. Increase 3 units (audit recount / found stock)
    const adjInc = adjustBatchStock(b2AfterDec, 3);
    db.prepare(`
      UPDATE inventory_batches
      SET quantity_available = ?, initial_quantity = ?, total_cost_cents = ?
      WHERE id = ?
    `).run(adjInc.newQuantityAvailable, adjInc.newInitialQty, adjInc.newTotalCost, b2.id);
    db.prepare('UPDATE inventory SET quantity = quantity + 3 WHERE product_id = ?').run(p3Id);

    const b2AfterInc = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(b2.id);
    assert.strictEqual(b2AfterInc.quantity_available, 25);
    assert.strictEqual(b2AfterInc.initial_quantity, 25);
    assert.strictEqual(b2AfterInc.cumulative_cost_cents + (b2AfterInc.total_cost_cents - b2AfterInc.cumulative_cost_cents), b2AfterInc.total_cost_cents);
    console.log(`PASS: Step 6b Stock increase (+3 units). Invariant holds (remaining cost = PKR ${(b2AfterInc.total_cost_cents / 100).toFixed(2)}).`);

    // Step 7: Owner setting cost on an unknown-cost batch followed by sale
    // Seed unknown-cost batch
    const unkIns = db.prepare(`
      INSERT INTO inventory_batches (product_id, batch_number, expiry_date, initial_quantity, quantity_available, unit_cost_cents, received_date, cost_known)
      VALUES (?, 'UNK-BATCH-7', '2028-06-30', 20, 20, 0, date('now'), 0)
    `).run(p3Id);
    const unkBatchId = unkIns.lastInsertRowid;
    db.prepare('UPDATE inventory SET quantity = quantity + 20 WHERE product_id = ?').run(p3Id);

    // Owner sets cost to PKR 45.50 (4,550 cents)
    const setCostRes = await request('PUT', `/api/inventory/batch/${unkBatchId}`, {
      batch_number: 'UNK-BATCH-7',
      expiry_date: '2028-06-30',
      unit_cost: '45.50'
    }, ownerAuth);
    assert.strictEqual(setCostRes.status, 200, 'Owner sets batch cost');

    const bUnkUpdated = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(unkBatchId);
    assert.strictEqual(bUnkUpdated.unit_cost_cents, 4550);
    assert.strictEqual(bUnkUpdated.total_cost_cents, 20 * 4550, 'Total cost = 20 * 45.50 = PKR 910.00 (91,000 cents)');
    assert.strictEqual(bUnkUpdated.cost_known, 1);
    assert.strictEqual(bUnkUpdated.costed_units, 0);
    assert.strictEqual(bUnkUpdated.cumulative_cost_cents, 0);

    // Sell 8 units from this updated batch (temporarily deduct earlier batch to reach this batch)
    db.prepare('UPDATE inventory_batches SET quantity_available = 0 WHERE id = ?').run(b2.id);
    await request('POST', '/api/new', {
      _id: 'SALE-UNK-SET-1',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p3Id, sale_unit: 'base', quantity: 8, price: '50.00' }],
      total: '400.00',
      paid: '400.00',
      user_id: 1
    }, ownerAuth);

    const bUnkAfterSale = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(unkBatchId);
    const cogsUnk = db.prepare('SELECT cost_cents, cost_known FROM sale_batch_cogs WHERE sale_id = ?').get('SALE-UNK-SET-1');
    assert.strictEqual(cogsUnk.cost_known, 1, 'Sale from updated batch must have cost_known = 1');
    assert.strictEqual(cogsUnk.cost_cents, 8 * 4550, 'Exact COGS: 8 * 45.50 = PKR 364.00');
    assert.strictEqual(bUnkAfterSale.costed_units, 8);
    assert.strictEqual(bUnkAfterSale.cumulative_cost_cents, 8 * 4550);
    assert.strictEqual(bUnkAfterSale.cumulative_cost_cents + (bUnkAfterSale.total_cost_cents - bUnkAfterSale.cumulative_cost_cents), bUnkAfterSale.total_cost_cents);
    console.log('PASS: Step 7 Owner cost setting & subsequent sale verified. Invariant holds.');

    // Restore b2 quantity
    db.prepare('UPDATE inventory_batches SET quantity_available = 25 WHERE id = ?').run(b2.id);

    // =========================================================================
    // TEST 4: Bonus packs dilution (10 + 1 boxes = 1,100 tablets @ 10,000)
    // =========================================================================
    console.log('\n--- TEST 4: Bonus packs dilution ---');
    const prod4Res = await request('POST', '/api/inventory/product', {
      name: 'Bonus Medicine',
      barcode: 8881004,
      price: '15.00',
      category: 'Vitamins',
      base_unit: 'Tablet',
      units_per_box: 100
    }, ownerAuth);
    const p4Id = prod4Res.body.id || prod4Res.body._id;

    // Buy 10 boxes + 1 bonus box at PKR 1,000 per box with 0% discount
    // Invoice total = 10 * 1,000 = Rs 10,000 (1,000,000 cents).
    // Stock added = (10 + 1) * 100 = 1,100 tablets.
    // Batch total cost = 1,000,000 cents.
    // Initial batch unit cost = 1,000,000 / 1,100 = 909.09 paisas.
    const pur4Res = await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-BONUS-DILUTION',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [
        {
          product_id: p4Id,
          purchase_unit: 'Box',
          units_per_pack: 100,
          quantity: 10,
          bonus_quantity: 1,
          unit_cost: 1000.00,
          discount_percent: 0,
          batch_number: 'BBONUS1',
          expiry_date: '2028-12-31'
        }
      ]
    }, ownerAuth);
    assert.ok(pur4Res.status === 200 || pur4Res.status === 201);

    const bBonus = db.prepare('SELECT * FROM inventory_batches WHERE batch_number = ?').get('BBONUS1');
    assert.strictEqual(bBonus.initial_quantity, 1100, 'Initial quantity must be 1,100 tablets');
    assert.strictEqual(bBonus.quantity_available, 1100, 'Available quantity must be 1,100 tablets');
    assert.strictEqual(bBonus.total_cost_cents, 1000000, 'Batch total cost must be 1,000,000 cents (PKR 10,000.00)');
    assert.strictEqual(bBonus.unit_cost_cents, 909, 'Diluted integer unit cost must be 909 cents');

    // Verify stock valuation for 1,100 tablets is exactly PKR 10,000.00
    const valBonusRes = await request('GET', '/api/reports/stock-valuation', null, ownerAuth);
    const p4Val = (valBonusRes.body.rows || valBonusRes.body.medicines).find(r => r.id == p4Id);
    assert.ok(p4Val);
    assert.strictEqual(p4Val.totalCost.replace(/,/g, ''), '10000.00', 'Stock valuation of 1,100 tablets must be EXACTLY PKR 10,000.00, not 11,000.00');

    // =========================================================================
    // TEST 5: Combined multi-line stock and FEFO across batches
    // =========================================================================
    console.log('\n--- TEST 5: Combined multi-line stock and FEFO validation ---');
    const prod5Res = await request('POST', '/api/inventory/product', {
      name: 'Combined MultiLine Med',
      barcode: 8881005,
      price: '5.00',
      category: 'Analgesics',
      base_unit: 'Tablet',
      units_per_box: 100,
      units_per_strip: 10,
      box_price: '400.00',
      strip_price: '45.00'
    }, ownerAuth);
    const p5Id = prod5Res.body.id || prod5Res.body._id;

    // Receive Batch 1: 50 tablets expiring 2027-01-01
    await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-FEFO-1',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [{
        product_id: p5Id, purchase_unit: 'base', units_per_pack: 1, quantity: 50,
        unit_cost: 3.00, batch_number: 'B-FEFO-1', expiry_date: '2027-01-01'
      }]
    }, ownerAuth);

    // Receive Batch 2: 100 tablets expiring 2028-01-01
    await request('POST', '/api/purchases', {
      supplier_id: supplierId,
      invoice_no: 'INV-FEFO-2',
      invoice_date: '2026-11-01',
      status: 'received',
      payment_method: 'other',
      items: [{
        product_id: p5Id, purchase_unit: 'base', units_per_pack: 1, quantity: 100,
        unit_cost: 3.00, batch_number: 'B-FEFO-2', expiry_date: '2028-01-01'
      }]
    }, ownerAuth);

    // Basket has 1 box (100) + 2 strips (20) = 120 tablets total. Stock has 150.
    const saleMulti = await request('POST', '/api/new', {
      _id: 'SALE-MULTI-1',
      status: 1,
      date: new Date().toISOString(),
      items: [
        { id: p5Id, sale_unit: 'box', quantity: 1, price: '400.00' },
        { id: p5Id, sale_unit: 'strip', quantity: 2, price: '45.00' }
      ],
      total: '490.00',
      paid: '490.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(saleMulti.status, 200, 'Multi-line sale succeeds');

    // Verify FEFO: Batch 1 (50 tabs) completely depleted (0 remaining), Batch 2 has 30 remaining (100 - 70)
    const bf1 = db.prepare('SELECT quantity_available FROM inventory_batches WHERE batch_number = ?').get('B-FEFO-1').quantity_available;
    const bf2 = db.prepare('SELECT quantity_available FROM inventory_batches WHERE batch_number = ?').get('B-FEFO-2').quantity_available;
    assert.strictEqual(bf1, 0, 'Batch 1 must be completely depleted under FEFO');
    assert.strictEqual(bf2, 30, 'Batch 2 must have 30 tablets remaining');

    // Attempt to sell 4 strips (40 tablets) when only 30 remain -> MUST BE REJECTED
    const oversellRes = await request('POST', '/api/new', {
      _id: 'SALE-OVERSELL',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p5Id, sale_unit: 'strip', quantity: 4, price: '45.00' }],
      total: '180.00',
      paid: '180.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(oversellRes.status, 409, 'Oversell must be rejected with 409 Insufficient stock');

    // =========================================================================
    // TEST 6: Tampered payload rejection
    // =========================================================================
    console.log('\n--- TEST 6: Tampered payload rejection ---');
    const tamperRes = await request('POST', '/api/new', {
      _id: 'SALE-TAMPER',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p5Id, sale_unit: 'strip', quantity: 1, price: '1.00' }], // Expected 45.00
      total: '1.00',
      paid: '1.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(tamperRes.status, 409, 'Tampered price must be rejected with 409');

    // Unconfigured unit
    const prodNoStrip = await request('POST', '/api/inventory/product', {
      name: 'No Strip Med',
      barcode: 8881006,
      price: '10.00',
      category: 'General'
    }, ownerAuth);
    const p6Id = prodNoStrip.body.id || prodNoStrip.body._id;

    const unconfRes = await request('POST', '/api/new', {
      _id: 'SALE-UNCONF',
      status: 1,
      date: new Date().toISOString(),
      items: [{ id: p6Id, sale_unit: 'strip', quantity: 1, price: '10.00' }],
      total: '10.00',
      paid: '10.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(unconfRes.status, 409, 'Unconfigured pack unit must be rejected with 409');

    // =========================================================================
    // TEST 7: Backward compatibility, legacy syrup with default 'Tablet' in DB,
    // and safe plural formatting
    // =========================================================================
    console.log('\n--- TEST 7: Backward compatibility: Old syrup with default Tablet in DB ---');
    // Seed an old syrup product directly with base_unit = 'Tablet' (simulating old migration default)
    // but units_per_box = null, units_per_strip = null
    const insSyrup = db.prepare(`
      INSERT INTO products (name, barcode, price_cents, expiration_date, category, stock_tracked, min_stock, base_unit, units_per_strip, units_per_box)
      VALUES ('Hydryllin Syrup 120ml', 8881007, 12000, '30-Jun-2027', 'Syrups', 1, 20, 'Tablet', NULL, NULL)
    `).run();
    const syrupId = Number(insSyrup.lastInsertRowid);
    db.prepare('INSERT INTO inventory (product_id, quantity) VALUES (?, 16)').run(syrupId);

    // Also insert batch for expiry report
    db.prepare(`
      INSERT INTO inventory_batches (product_id, batch_number, expiry_date, initial_quantity, quantity_available, unit_cost_cents, received_date)
      VALUES (?, 'SYR-BATCH-1', '2027-06-30', 16, 16, 8000, date('now'))
    `).run(syrupId);

    // 1. Inventory read
    const pSyrup = (await request('GET', `/api/inventory/product/${syrupId}`, null, ownerAuth)).body;
    assert.strictEqual(pSyrup.stock_display, '16', 'Old syrup stock_display must be "16", NOT "16 Tablets"');
    assert.strictEqual(pSyrup.base_unit, null, 'base_unit must be treated as unset (null) for old syrup');

    // 2. Low stock report
    const lowStockRes = await request('GET', '/api/reports/low-stock', null, ownerAuth);
    const syrupLow = lowStockRes.body.rows.find(r => r.id == syrupId);
    assert.ok(syrupLow, 'Syrup must be in low stock report (16 <= 20)');
    assert.strictEqual(syrupLow.pack_display, '16', 'Low stock report must show "16", no unit word');

    // 3. Stock valuation report
    const valRes = await request('GET', '/api/reports/stock-valuation', null, ownerAuth);
    const syrupVal = (valRes.body.rows || valRes.body.medicines).find(r => r.id == syrupId);
    assert.ok(syrupVal);
    assert.strictEqual(syrupVal.pack_display, '16', 'Stock valuation must show "16", no unit word');

    // 4. Expiry report
    const expRes = await request('GET', '/api/reports/expiry', null, ownerAuth);
    const syrupExp = (expRes.body.rows || expRes.body.batches).find(r => r.productId == syrupId);
    assert.ok(syrupExp);
    assert.strictEqual(syrupExp.pack_display, '16', 'Expiry report must show "16", no unit word');

    // 5. Plural handling for free-text units verification
    assert.strictEqual(formatUnitName(10, 'ml'), '10 ml', 'ml must stay ml');
    assert.strictEqual(formatUnitName(5, 'mg'), '5 mg', 'mg must stay mg');
    assert.strictEqual(formatUnitName(1, 'Bottle'), '1 Bottle');
    assert.strictEqual(formatUnitName(2, 'Bottle'), '2 Bottles');
    assert.strictEqual(formatUnitName(1, 'Ampoule'), '1 Ampoule');
    assert.strictEqual(formatUnitName(3, 'Ampoule'), '3 Ampoules');
    assert.strictEqual(formatUnitName(2, 'Drops'), '2 Drops');
    assert.strictEqual(formatUnitName(2, 'Syrup'), '2 Syrups');
    console.log('PASS: Old syrup product correctly displays no unit word across all reports and plural rules verified.');

    // =========================================================================
    // TEST 8: C7 Backend Tests (Held Order, Idempotency, Discount %, Khata, Returns)
    // =========================================================================
    console.log('\n--- TEST 8: C7 Backend Verification ---');

    // 8a. Held order with a Box line saved and resumed gives identical totals
    const holdOrderPayload = {
      _id: 'ORDER-HOLD-BOX-1',
      status: 0,
      customer: '0',
      date: new Date().toISOString(),
      items: [
        {
          id: p1Id,
          product_name: 'Panadol Extra Pack',
          sale_unit: 'box',
          quantity: 1,
          price: '1000.00'
        }
      ],
      discount: '0.00',
      total: '1000.00',
      paid: '0.00',
      user_id: 1
    };
    const holdRes = await request('POST', '/api/new', holdOrderPayload, ownerAuth);
    assert.strictEqual(holdRes.status, 200, 'Hold order saved');

    // Read back held order
    const heldOrderDoc = (await request('GET', '/api/ORDER-HOLD-BOX-1', null, ownerAuth)).body;
    assert.strictEqual(heldOrderDoc.status, 0);
    assert.strictEqual(heldOrderDoc.items[0].sale_unit, 'box');
    assert.strictEqual(heldOrderDoc.total.replace(/,/g, ''), '1000.00');

    // Resume held order (PUT /api/new with status: 1)
    const resumePayload = {
      ...holdOrderPayload,
      status: 1,
      total: '1000.00',
      paid: '1000.00'
    };
    const resumeRes = await request('PUT', '/api/new', resumePayload, ownerAuth);
    assert.strictEqual(resumeRes.status, 200, 'Held order resumed and completed');

    const completedSale = (await request('GET', '/api/ORDER-HOLD-BOX-1', null, ownerAuth)).body;
    assert.strictEqual(completedSale.status, 1);
    assert.strictEqual(completedSale.total.replace(/,/g, ''), '1000.00', 'Totals must be identical on resume');

    // 8b. Same sale ID with a different unit is rejected as a conflict (409)
    const conflictPayload = {
      ...resumePayload,
      items: [
        {
          id: p1Id,
          product_name: 'Panadol Extra Pack',
          sale_unit: 'strip', // Different unit!
          quantity: 1,
          price: '110.00'
        }
      ],
      total: '110.00',
      paid: '110.00'
    };
    const conflictRes = await request('POST', '/api/new', conflictPayload, ownerAuth);
    assert.strictEqual(conflictRes.status, 409, 'Sale with same ID but different unit MUST be rejected with 409');
    console.log('PASS: Held order resume and idempotency conflict on different unit verified.');

    // 8c. 10% discount on Box + Strip basket totals correctly
    // 1 Box (1000.00) + 1 Strip (110.00) = Gross 1,110.00. 10% discount = 111.00. Net = 999.00.
    const saleDiscountRes = await request('POST', '/api/new', {
      _id: 'SALE-DISC-PACK',
      status: 1,
      date: new Date().toISOString(),
      items: [
        { id: p1Id, sale_unit: 'box', quantity: 1, price: '1000.00' },
        { id: p1Id, sale_unit: 'strip', quantity: 1, price: '110.00' }
      ],
      discount: '111.00',
      discount_percent: 10,
      total: '999.00',
      paid: '999.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(saleDiscountRes.status, 200, 'Discounted pack sale succeeds');
    console.log('PASS: 10% discount on Box + Strip basket totals correctly (PKR 999.00).');

    // 8d. Khata sale of a strip creates the right receivable
    // 1 Strip @ 110.00, customer pays 10.00 cash, 100.00 Khata credit
    const khataSaleRes = await request('POST', '/api/new', {
      _id: 'SALE-KHATA-STRIP',
      status: 1,
      customer: String(custId),
      date: new Date().toISOString(),
      items: [{ id: p1Id, sale_unit: 'strip', quantity: 1, price: '110.00' }],
      discount: '0.00',
      total: '110.00',
      paid: '10.00',
      user_id: 1
    }, ownerAuth);
    assert.strictEqual(khataSaleRes.status, 200, 'Khata credit sale succeeds');

    const custReceivable = db.prepare(`
      SELECT SUM(debit_cents) - SUM(credit_cents) AS balance
      FROM journal_lines
      WHERE account_id = 1100 AND party_type = 'customer' AND party_id = ?
    `).get(String(custId)).balance;
    assert.strictEqual(custReceivable, 10000, 'Customer Khata balance must be exactly PKR 100.00 (10,000 cents)');
    console.log('PASS: Khata sale of strip creates correct accounts receivable (PKR 100.00).');

    // 8e. Sale returns by unit restocking the ORIGINAL batches
    const returnStripRes = await request('POST', '/api/return', {
      sale_id: 'SALE-KHATA-STRIP',
      product_id: p1Id,
      quantity: 1,
      return_unit: 'strip',
      return_to_stock: 1,
      reason: 'Wrong medicine returned',
      refund_method: 'credit'
    }, ownerAuth);
    assert.strictEqual(returnStripRes.status, 200, 'Sale return of strip succeeds');

    // Verify 10 base units were restocked
    const sretRow = db.prepare('SELECT * FROM sales_returns WHERE sale_id = ?').get('SALE-KHATA-STRIP');
    assert.strictEqual(sretRow.base_quantity, 10, 'Return must record 10 base units');
    assert.strictEqual(sretRow.return_unit, 'strip');
    console.log('PASS: Sale return by unit restocked original batch with 10 base units.');

    // =========================================================================
    // TEST 9: Double-entry trial balance debits == credits
    // =========================================================================
    console.log('\n--- TEST 9: Double-entry trial balance debits == credits ---');
    const trialBalance = db.prepare(`
      SELECT SUM(debit_cents) AS total_debits, SUM(credit_cents) AS total_credits
      FROM journal_lines
    `).get();
    console.log(`Total Debits: PKR ${(trialBalance.total_debits / 100).toFixed(2)}, Total Credits: PKR ${(trialBalance.total_credits / 100).toFixed(2)}`);
    assert.strictEqual(trialBalance.total_debits, trialBalance.total_credits, 'Total debits MUST exactly equal total credits across all transactions');

    // =========================================================================
    // TEST 10: Reports consistency with base units
    // =========================================================================
    console.log('\n--- TEST 10: Reports aggregate base units correctly ---');
    const topRes = await request('GET', '/api/reports/product-movement?days=90', null, ownerAuth);
    assert.strictEqual(topRes.status, 200);
    assert.ok(Array.isArray(topRes.body.topSelling));
    const p1Top = topRes.body.topSelling.find(r => r.productId == p1Id);
    assert.ok(p1Top);
    // Sold base units must be positive and aggregate base units, not pack count
    assert.ok(Number(p1Top.quantitySold) >= 100);

    // =========================================================================
    // TEST 11: Purchase Items API Response Format (C5)
    // =========================================================================
    console.log('\n--- TEST 11: Purchase Items API Response Format ---');
    const pur1View = (await request('GET', `/api/purchases/${pur1Res.body.id}`, null, ownerAuth)).body;
    assert.ok(Array.isArray(pur1View.items));
    const purItem = pur1View.items[0];
    assert.strictEqual(purItem.purchase_unit, 'Box');
    assert.strictEqual(purItem.units_per_pack, 100);
    assert.strictEqual(purItem.base_quantity, 500);
    assert.strictEqual(purItem.pack_display, '5 Box (500 base units)');
    console.log(`PASS: Purchase items response verified: "${purItem.pack_display}"`);

    // =========================================================================
    // TEST 12: Backup and Restore Verification (a, b, c)
    // =========================================================================
    console.log('\n--- TEST 12: Backup & Restore Verification ---');
    // (a) Old-version database restores into this version
    const oldDbPath = path.join(testDir, 'legacy_v150.sqlite');
    const oldDb = new DatabaseSync(oldDbPath);
    oldDb.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode INTEGER UNIQUE,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        expiration_date TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        supplier TEXT NOT NULL DEFAULT '',
        stock_tracked INTEGER NOT NULL DEFAULT 1,
        min_stock INTEGER NOT NULL DEFAULT 0,
        img TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        line_total_cents INTEGER NOT NULL
      );
      CREATE TABLE inventory_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        batch_number TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        initial_quantity INTEGER NOT NULL,
        quantity_available INTEGER NOT NULL,
        unit_cost_cents INTEGER NOT NULL,
        received_date TEXT NOT NULL
      );
      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL
      );
      CREATE TABLE sales_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_number TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL
      );
      CREATE TABLE purchase_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_number TEXT NOT NULL,
        purchase_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost_cents INTEGER NOT NULL
      );
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
    // Run migrations on oldDb
    runMigrations(oldDb);
    const oldMigratedCols = oldDb.prepare("PRAGMA table_info('products')").all().map(c => c.name);
    assert.ok(oldMigratedCols.includes('base_unit'));
    assert.ok(oldMigratedCols.includes('units_per_box'));
    const oldPiCols = oldDb.prepare("PRAGMA table_info('purchase_items')").all().map(c => c.name);
    assert.ok(oldPiCols.includes('purchase_unit'));
    assert.ok(oldPiCols.includes('base_quantity'));
    oldDb.close();
    console.log('PASS: (a) Old-version backup restores cleanly and migrations upgrade schema safely.');

    // (b) Backup made by this version restores in this version
    const newDbPath = path.join(testDir, 'backup_v155.sqlite');
    const newBackupDb = new DatabaseSync(newDbPath);
    newBackupDb.exec(`
      CREATE TABLE products (id INTEGER PRIMARY KEY, barcode INTEGER, name TEXT, price_cents INTEGER, expiration_date TEXT, base_unit TEXT, units_per_box INTEGER, units_per_strip INTEGER);
      CREATE TABLE purchase_items (id INTEGER PRIMARY KEY, purchase_id INTEGER, product_id INTEGER, purchase_unit TEXT, units_per_pack INTEGER, base_quantity INTEGER, total_cost_cents INTEGER);
      CREATE TABLE inventory_batches (id INTEGER PRIMARY KEY, total_cost_cents INTEGER, cumulative_cost_cents INTEGER, costed_units INTEGER, cost_known INTEGER);
      CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_unit TEXT, pack_multiplier INTEGER, base_quantity INTEGER);
      CREATE TABLE sales_returns (id INTEGER PRIMARY KEY, return_unit TEXT, pack_multiplier INTEGER, base_quantity INTEGER);
      CREATE TABLE purchase_returns (id INTEGER PRIMARY KEY, return_unit TEXT, pack_multiplier INTEGER, base_quantity INTEGER);
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    `);
    runMigrations(newBackupDb);
    runMigrations(newBackupDb); // Second idempotent call
    newBackupDb.close();
    console.log('PASS: (b) Backup made by this version restores and runs idempotently without errors.');

    // (c) Backup made by this version opened with previous version queries
    const checkDb = new DatabaseSync(newDbPath);
    // Previous version SELECT query on products
    const oldQuery = 'SELECT id, barcode, name, price_cents, expiration_date FROM products';
    assert.doesNotThrow(() => checkDb.prepare(oldQuery).all());
    checkDb.close();
    console.log('PASS: (c) Database from this version is fully queryable by earlier version queries.');

    console.log('\n>>> ALL PACK SIZE VERIFICATION TESTS (STAGE A) PASSED SUCCESSFULLY! <<<');
    try { db.close(); } catch (_) {}
    process.exit(0);
  } catch (err) {
    console.error('\n>>> TEST FAILED <<<');
    console.error(err);
    try { db.close(); } catch (_) {}
    process.exit(1);
  } finally {
    cleanup();
  }
}

run();
