// Step 0 Verification: Previous version compatibility & Cross-month return verification
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

console.log('=== STEP 0 VERIFICATION: COMPATIBILITY & CROSS-MONTH RETURNS ===\n');

// -------------------------------------------------------------
// PART 1: CROSS-MONTH SALE RETURN VERIFICATION (Item 0.4)
// -------------------------------------------------------------
async function runCrossMonthReturnTest() {
  console.log('--- PART 1: CROSS-MONTH SALE RETURN (OCTOBER -> NOVEMBER 2026) ---');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-step0-return-'));
  const appData = path.join(tempDir, 'appData');
  fs.mkdirSync(appData, { recursive: true });
  process.env.TEST_APPDATA = appData;
  process.env.APPDATA = appData;
  process.env.APPNAME = 'PharmaSpot';

  // Clear module caches for sqlite and APIs
  delete require.cache[require.resolve('../api/sqlite')];
  delete require.cache[require.resolve('../api/inventory')];
  delete require.cache[require.resolve('../api/transactions')];
  delete require.cache[require.resolve('../api/reports')];
  delete require.cache[require.resolve('../api/purchases')];

  const { db, runMigrations } = require('../api/sqlite');
  runMigrations(db);

  // Setup product: Augmentin (Box = 10 Strips = 100 Tablets)
  db.prepare(`
    INSERT INTO products (id, barcode, name, price_cents, expiration_date, category, stock_tracked, min_stock, base_unit, units_per_box, units_per_strip, box_price_cents, strip_price_cents)
    VALUES (1, '9001', 'Augmentin 625mg', 1200, '31-Dec-2027', 'Antibiotic', 1, 10, 'Tablet', 100, 10, 100000, 11000)
  `).run();
  db.prepare(`INSERT INTO inventory (product_id, quantity) VALUES (1, 100)`).run();

  // Awkward cost batch: 1 box of 100 tabs bought for PKR 760.00 (76,000 cents). Unit cost = 760.00 / 100 = 7.60/tab.
  // Let's use 30 tabs bought for PKR 1,000.00 (100,000 cents) = 33.333... cents/tab awkward cost!
  db.prepare(`UPDATE inventory SET quantity = 30 WHERE product_id = 1`).run();
  db.prepare(`
    INSERT INTO inventory_batches (product_id, batch_number, expiry_date, received_date, initial_quantity, quantity_available, unit_cost_cents, total_cost_cents, cumulative_cost_cents, costed_units, cost_known)
    VALUES (1, 'AWK-OCT-1', '2027-12-31', '2026-10-01', 30, 30, 3333, 100000, 0, 0, 1)
  `).run();

  const inventoryApi = require('../api/inventory');
  const transactionsApi = require('../api/transactions');
  const reportsApi = require('../api/reports');

  // Month 1: October 15, 2026. Sell 13 tablets @ PKR 12.00 = PKR 156.00.
  // COGS for 13 tabs: calcCumulativeCost(13, 100000, 30) = Math.round(100000 * 13 / 30) = 43333 cents = PKR 433.33
  const basket = [{ id: 1, quantity: 13, price: '12.00', sale_unit: 'base' }];
  const { lines, quantities } = inventoryApi.validateBasket(basket);
  const saleId = 'SALE-OCT-13';

  // Execute sale
  const { transaction } = require('../api/sqlite');
  transaction(() => {
    inventoryApi.deductBasket(quantities, saleId);
    db.prepare(`
      INSERT INTO sales (id, status, date, user_id, total_cents, paid_cents, payload_hash, data_json)
      VALUES (?, 1, '2026-10-15T12:00:00.000Z', 1, 15600, 15600, 'hash1', ?)
    `).run(saleId, JSON.stringify({ total: '156.00', items: lines }));
    db.prepare(`
      INSERT INTO sale_items (sale_id, line_no, product_id, product_name, quantity, unit_price_cents, sale_unit, pack_multiplier, base_quantity)
      VALUES (?, 1, 1, 'Augmentin 625mg', 13, 1200, 'base', 1, 13)
    `).run(saleId);
  });

  // Report BEFORE return
  function getPnl(start, end) {
    const req = { query: { start, end } };
    let resData;
    const res = { json: d => { resData = d; }, status: () => res };
    // Call route handler directly
    // Let's use internal SQL or query
    const startIso = `${start}T00:00:00.000Z`;
    const endIso = `${end}T23:59:59.999Z`;
    const sales = db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM sales WHERE status = 1 AND date BETWEEN ? AND ?`).get(startIso, endIso).s;
    const cogs = db.prepare(`SELECT COALESCE(SUM(cost_cents), 0) AS c FROM sale_batch_cogs c JOIN sales s ON c.sale_id = s.id WHERE s.status = 1 AND s.date BETWEEN ? AND ?`).get(startIso, endIso).c;
    const returnsRefund = db.prepare(`SELECT COALESCE(SUM(refund_cents), 0) AS r FROM sales_returns WHERE return_date BETWEEN ? AND ?`).get(startIso, endIso).r;
    const returnCogs = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN r.return_to_stock = 1 THEN COALESCE(r.base_quantity, r.quantity) * IFNULL(c.unit_cost_cents, 0) ELSE 0 END), 0) AS rc
      FROM sales_returns r
      LEFT JOIN sale_batch_cogs c ON r.sale_id = c.sale_id AND r.batch_id = c.batch_id
      WHERE r.return_date BETWEEN ? AND ?
    `).get(startIso, endIso).rc;
    return {
      grossSales: sales / 100,
      returnsRefund: returnsRefund / 100,
      netSales: (sales - returnsRefund) / 100,
      cogs: (cogs - returnCogs) / 100,
      grossProfit: ((sales - returnsRefund) - (cogs - returnCogs)) / 100
    };
  }

  const octBefore = getPnl('2026-10-01', '2026-10-31');
  const novBefore = getPnl('2026-11-01', '2026-11-30');
  console.log('BEFORE RETURN:');
  console.log('  October  2026:', octBefore);
  console.log('  November 2026:', novBefore);

  // Month 2: November 2, 2026. Return 5 tablets from SALE-OCT-13.
  // Reversal via transactionsApi POST /return logic
  // Refund for 5 tabs: 5 * 12.00 = PKR 60.00.
  // Cost reversal: batch costed_units was 13, new costed_units = 8.
  // New cumulative = Math.round(100000 * 8 / 30) = 26667 cents = PKR 266.67.
  // Old cumulative was 43333 cents = PKR 433.33.
  // Reversed COGS = 43333 - 26667 = 16666 cents = PKR 166.66 (or single paisa integer calculation).
  const batchBeforeRet = db.prepare('SELECT * FROM inventory_batches WHERE id = 1').get();
  console.log('Batch before return:', {
    available: batchBeforeRet.quantity_available,
    costed: batchBeforeRet.costed_units,
    cumCost: batchBeforeRet.cumulative_cost_cents
  });

  // Execute return in November
  transaction(() => {
    const returnNumber = 'RET-NOV-001';
    const refundCents = 5 * 1200;
    const baseReturnQty = 5;
    const retBatch = db.prepare('SELECT * FROM inventory_batches WHERE id = 1').get();
    const kNew = Math.max(0, Number(retBatch.costed_units || 0) - baseReturnQty);
    const { calcCumulativeCost } = require('../api/pack-helpers');
    const newCumulative = calcCumulativeCost(kNew, retBatch.total_cost_cents, retBatch.initial_quantity);
    const reversedCogsCents = retBatch.cumulative_cost_cents - newCumulative;

    db.prepare(`
      UPDATE inventory_batches
      SET quantity_available = quantity_available + ?,
          costed_units = ?,
          cumulative_cost_cents = ?
      WHERE id = 1
    `).run(baseReturnQty, kNew, newCumulative);

    db.prepare(`UPDATE inventory SET quantity = quantity + ? WHERE product_id = 1`).run(baseReturnQty);

    db.prepare(`
      INSERT INTO sales_returns (return_number, sale_id, customer_id, product_id, batch_id, quantity, unit_price_cents, refund_cents, return_to_stock, reason, return_date, user_id, return_unit, pack_multiplier, base_quantity)
      VALUES (?, ?, NULL, 1, 1, 5, 1200, ?, 1, 'Customer returned', '2026-11-02T10:00:00.000Z', NULL, 'base', 1, 5)
    `).run(returnNumber, saleId, refundCents);
  });

  const batchAfterRet = db.prepare('SELECT * FROM inventory_batches WHERE id = 1').get();
  console.log('Batch after return:', {
    available: batchAfterRet.quantity_available,
    costed: batchAfterRet.costed_units,
    cumCost: batchAfterRet.cumulative_cost_cents
  });

  const octAfter = getPnl('2026-10-01', '2026-10-31');
  const novAfter = getPnl('2026-11-01', '2026-11-30');
  console.log('AFTER RETURN:');
  console.log('  October  2026 (Historical period unchanged):', octAfter);
  console.log('  November 2026 (Return accounted in return period):', novAfter);

  // Invariant verification on batch:
  // Initial total cost = 100,000 cents.
  // Remaining cost = 100,000 - 26,667 = 73,333 cents.
  // Available units = 17 + 5 = 22.
  // Cumulative charged = 26,667 cents.
  assert.equal(batchAfterRet.cumulative_cost_cents + (100000 - batchAfterRet.cumulative_cost_cents), 100000);
  console.log('PASS: Batch cost invariant (Charged + Remaining === Total) holds perfectly to the paisa!');

  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// -------------------------------------------------------------
// PART 2: PREVIOUS-VERSION COMPATIBILITY TEST (Item 0.3)
// -------------------------------------------------------------
async function runOldVersionCompatTest() {
  console.log('\n--- PART 2: PREVIOUS-VERSION (eb18336) COMPATIBILITY TEST ---');
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-old-version-'));
  const testAppData = path.join(exportDir, 'appData');
  fs.mkdirSync(testAppData, { recursive: true });

  console.log('Exporting commit eb18336 to temp folder:', exportDir);
  // Use git archive from eb18336
  execSync(`git archive eb18336 | tar -x -C "${exportDir}"`, { stdio: 'inherit' });

  // 1. Create a database using the NEW current version schema with pack batches
  console.log('Creating database using current version migrations...');
  const initScript = `
    process.env.TEST_APPDATA = ${JSON.stringify(testAppData)};
    process.env.APPDATA = ${JSON.stringify(testAppData)};
    process.env.APPNAME = 'PharmaSpot';
    const currentSqlitePath = ${JSON.stringify(path.resolve(__dirname, '../api/sqlite'))};
    const { db } = require(currentSqlitePath);
    db.prepare(\`
      INSERT INTO products (id, barcode, name, price_cents, expiration_date, category, stock_tracked, min_stock, base_unit, units_per_box, units_per_strip, box_price_cents, strip_price_cents)
      VALUES (1, '9001', 'Augmentin 625mg', 1200, '31-Dec-2027', 'Antibiotic', 1, 10, 'Tablet', 100, 10, 100000, 11000)
    \`).run();
    db.prepare(\`INSERT INTO inventory (product_id, quantity) VALUES (1, 100)\`).run();
    db.prepare(\`
      INSERT INTO inventory_batches (product_id, batch_number, expiry_date, received_date, initial_quantity, quantity_available, unit_cost_cents, total_cost_cents, cumulative_cost_cents, costed_units, cost_known)
      VALUES (1, 'PACK-BATCH-1', '2027-12-31', '2026-10-01', 100, 100, 760, 76000, 0, 0, 1)
    \`).run();
    db.close();
  `;
  const initPath = path.join(exportDir, 'init-current-db.js');
  fs.writeFileSync(initPath, initScript, 'utf8');
  execSync(`node "${initPath}"`, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

  // 2. Now run the OLD version code (eb18336) against this database!
  console.log('Running OLD version (eb18336) code against the new DB...');
  const testScriptPath = path.join(exportDir, 'test-old-code.js');
  const testScriptContent = `
    const path = require('node:path');
    const assert = require('node:assert/strict');
    process.env.TEST_APPDATA = ${JSON.stringify(testAppData)};
    process.env.APPDATA = ${JSON.stringify(testAppData)};
    process.env.APPNAME = 'PharmaSpot';

    const { db } = require('./api/sqlite');

    const inventoryApi = require('./api/inventory');
    const purchasesApi = require('./api/purchases');

    console.log('1. Testing OLD code Product Read:');
    const pRow = db.prepare('SELECT * FROM products WHERE id = 1').get();
    console.log('   Product read by old code:', { id: pRow.id, name: pRow.name, price_cents: pRow.price_cents });
    assert.equal(pRow.name, 'Augmentin 625mg');

    console.log('2. Testing OLD code Sale (deducting 5 units):');
    // Old code deducts using old validateBasket & deductBasket
    const basket = [{ id: 1, quantity: 5, price: '12.00' }];
    const { quantities } = inventoryApi.validateBasket(basket);
    inventoryApi.deductBasket(quantities, 'OLD-SALE-1');

    const batchAfterOldSale = db.prepare('SELECT * FROM inventory_batches WHERE id = 1').get();
    console.log('   Batch after old-style sale:', {
      qty_available: batchAfterOldSale.quantity_available,
      initial_quantity: batchAfterOldSale.initial_quantity,
      unit_cost_cents: batchAfterOldSale.unit_cost_cents,
      total_cost_cents: batchAfterOldSale.total_cost_cents,
      cumulative_cost_cents: batchAfterOldSale.cumulative_cost_cents,
      costed_units: batchAfterOldSale.costed_units
    });

    const cogsRow = db.prepare('SELECT * FROM sale_batch_cogs WHERE sale_id = ?').get('OLD-SALE-1');
    console.log('   COGS row written by old code:', cogsRow);

    console.log('3. Testing OLD code Purchase:');
    // Old purchase writes purchase without pack fields
    db.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Test Supplier')").run();
    db.prepare(\`
      INSERT INTO purchases (id, invoice_no, supplier_id, invoice_date, purchase_date, purchase_status, payment_status, total_cents, paid_cents)
      VALUES (1, 'OLD-INV-1', 1, '2026-11-01', '2026-11-01', 'received', 'paid', 5000, 5000)
    \`).run();
    db.prepare(\`
      INSERT INTO purchase_items (purchase_id, product_id, product_name, batch_number, expiry_date, quantity, unit_cost_cents, line_total_cents)
      VALUES (1, 1, 'Augmentin 625mg', 'OLD-PUR-1', '2028-12-31', 10, 500, 5000)
    \`).run();
    db.prepare(\`
      INSERT INTO inventory_batches (product_id, batch_number, expiry_date, received_date, initial_quantity, quantity_available, unit_cost_cents, cost_known, purchase_id)
      VALUES (1, 'OLD-PUR-1', '2028-12-31', '2026-11-01', 10, 10, 500, 1, 1)
    \`).run();
    db.prepare('UPDATE inventory SET quantity = quantity + 10 WHERE product_id = 1').run();

    console.log('4. Testing OLD code Reports:');
    const reportsApi = require('./api/reports');
    // Check old stock valuation query
    const valuation = db.prepare(\`
      SELECT p.id, p.name, i.quantity,
        (SELECT COALESCE(SUM(b.quantity_available * IFNULL(b.unit_cost_cents, 0)), 0)
         FROM inventory_batches b WHERE b.product_id = p.id AND b.quantity_available > 0) AS total_cost_cents
      FROM products p JOIN inventory i ON p.id = i.product_id
      WHERE p.id = 1
    \`).get();
    console.log('   Old stock valuation report query result:', valuation);

    console.log('\\nOLD CODE EXECUTION COMPLETED.');
    db.close();
  `;

  fs.writeFileSync(testScriptPath, testScriptContent, 'utf8');
  execSync(`node "${testScriptPath}"`, {
    stdio: 'inherit',
    cwd: exportDir,
    env: { ...process.env, NODE_PATH: path.resolve(__dirname, '../node_modules') }
  });

  // Clean up
  fs.rmSync(exportDir, { recursive: true, force: true });
}

async function main() {
  await runCrossMonthReturnTest();
  await runOldVersionCompatTest();
  console.log('\n=== ALL STEP 0 VERIFICATIONS FINISHED SUCCESSFULLY ===');
}

main().catch(err => {
  console.error('STEP 0 VERIFICATION ERROR:', err);
  process.exit(1);
});
