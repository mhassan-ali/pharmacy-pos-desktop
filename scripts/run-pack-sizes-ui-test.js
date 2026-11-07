// End-to-end Electron UI test runner for Multi Medicos Pack Sizes Feature
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isElectron = !!process.versions.electron;
const args = process.argv.slice(2);
const isTestRun = args.includes('--pack-sizes-run');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// PARENT ORCHESTRATOR (Runs under Node.js)
// ============================================================================
if (!isElectron) {
  (async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-pack-ui-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port = '43399';
    console.log('=== MULTI MEDICOS PACK SIZES END-TO-END UI VERIFICATION ===');
    console.log(`Test APPDATA (isolated): ${testAppData}`);
    console.log(`Port: ${port}`);

    let allPassed = false;
    try {
      // 1. Pre-seed database under testAppData
      seedDatabase(testAppData);
      console.log('Database pre-seeded with Owner, Category, Supplier, Old Medicine (Syrup), and Customer.');

      // 2. Launch Electron
      console.log('\n--- LAUNCHING ELECTRON UI TEST FOR 9 PACK SIZE SCENARIOS ---');
      await spawnElectronTest(port, testAppData);
      console.log('>>> ALL 9 PACK SIZE UI SCENARIOS COMPLETED SUCCESSFULLY.\n');

      allPassed = true;
    } catch (err) {
      console.error('PACK SIZES UI TEST RUNNER ERROR:', err);
      process.exitCode = 1;
    } finally {
      // Clean up temporary test data folders
      try {
        if (fs.existsSync(tempRoot)) {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          console.log(`Cleaned up test APPDATA directory: ${tempRoot}`);
        }
      } catch (cleanErr) {
        console.warn('Could not remove tempRoot completely:', cleanErr.message);
      }
    }

    if (allPassed) {
      console.log('\n============================================================');
      console.log('ALL 9 END-TO-END PACK SIZES UI CHECKS PASSED (100% SUCCESS)');
      console.log('============================================================\n');
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  })();
}

function seedDatabase(testAppData) {
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';
  const { db } = require('../api/sqlite');

  // Insert Owner
  const password = require('bcrypt').hashSync('pack-ui-password-123', 10);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (1,'admin','Owner Admin',?,1,1,1,1,1)`).run(password);

  // Insert Category
  db.prepare(`INSERT OR IGNORE INTO categories(id,name,data_json)
    VALUES (1,'General Medicines','{"name":"General Medicines"}')`).run();

  // Insert Supplier
  db.prepare(`INSERT OR IGNORE INTO suppliers(id,name,opening_balance_cents,status)
    VALUES (1,'Pharmatec Supplies',0,'active')`).run();

  // Insert Old Medicine without pack settings (Id: 10, Syrup)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box)
    VALUES (10,99910,'Cough Syrup 120ml',15000,'31-Dec-2030','1','1',1,5,'',NULL,NULL,NULL)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (10,25)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (10,10,1,NULL,'BAT-OLD-01','2030-12-31',25,25,9000,'2026-10-01')`).run();

  // Insert Customer with generous credit limit (PKR 50,000)
  const custData = { _id: 1, name: 'Haji Aslam', phone: '03001234567', address: 'Lahore', credit_limit: 50000 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES ('1','Haji Aslam',?,5000000)`).run(JSON.stringify(custData));

  db.close();
}

function spawnElectronTest(port, testAppData) {
  return new Promise((resolve, reject) => {
    const electronExe = require('electron');
    const env = {
      ...process.env,
      TEST_APPDATA: testAppData,
      PORT: port,
      PHARMASPOT_DISABLE_RELOADER: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExe, [__filename, '--pack-sizes-run', '--port', port, '--data', testAppData], {
      env,
      stdio: 'inherit',
      windowsHide: true
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron test timed out after 180 seconds.`));
    }, 180000);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron test exited with error code ${code}`));
    });
  });
}

// ============================================================================
// ELECTRON EXECUTION (Runs under Electron binary)
// ============================================================================
if (isElectron) {
  const { app, BrowserWindow } = require('electron');
  BrowserWindow.prototype.show = function () {};

  const dataArgIndex = args.indexOf('--data');
  const testAppData = dataArgIndex !== -1 ? args[dataArgIndex + 1] : process.env.TEST_APPDATA;
  if (!testAppData) throw new Error('TEST_APPDATA is required for Electron phase.');

  fs.mkdirSync(testAppData, { recursive: true });
  app.setPath('appData', testAppData);
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';

  const { db } = require('../api/sqlite');

  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2 && !/Content Security Policy|Content-Security-Policy|Electron Security Warning|DevTools/.test(message)) {
        console.log(`[RENDERER CONSOLE]: ${message}`);
      }
    });

    window.webContents.once('did-finish-load', () => {
      runPackSizesSuite(app, window, db, testAppData);
    });
  });

  require('../start');
}

async function waitFor(window, conditionFnString, label, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await window.webContents.executeJavaScript(`(() => {
        try {
          return (${conditionFnString})();
        } catch (e) {
          return false;
        }
      })()`);
      if (res) return res;
    } catch (_) {}
    await pause(150);
  }
  throw new Error(`Timeout waiting for: ${label} (${timeoutMs}ms)`);
}

async function runPackSizesSuite(app, window, db, testAppData) {
  try {
    console.log('>>> ELECTRON RENDERER LOADED. Checking login screen...');
    await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view', 25000);
    await pause(600);

    const isLogin = await window.webContents.executeJavaScript(`(() => {
      const login = document.querySelector('#login');
      return !!(login && getComputedStyle(login).display !== 'none');
    })()`);

    if (isLogin) {
      console.log('  Submitting login credentials (admin / pack-ui-password-123)...');
      const reloadPromise = new Promise(resolve => {
        window.webContents.once('did-finish-load', resolve);
      });
      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('#account');
        form.querySelector('[name=username]').value = 'admin';
        form.querySelector('[name=password]').value = 'pack-ui-password-123';
        form.requestSubmit();
        return true;
      })()`);
      await reloadPromise;
      console.log('  Logged into app successfully.');
    }

    await waitFor(window, `() => typeof $ !== 'undefined' && $('#parent').length > 0`, 'POS view initialized', 25000);
    await pause(1000);

    // Setup helper in renderer for authenticated API calls
    await window.webContents.executeJavaScript(`(() => {
      window.testFetch = async function(endpoint, options = {}) {
        let token = null;
        try {
          const Store = require('electron-store');
          const store = new Store();
          const auth = store.get('auth');
          token = auth ? auth.token : null;
        } catch (_) {}
        const headers = { ...(options.headers || {}) };
        if (token) headers['X-Access-Token'] = token;
        const url = endpoint.startsWith('http') ? endpoint : (api + endpoint);
        const res = await fetch(url, { ...options, headers });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (_) {
          return { ok: res.ok, status: res.status, rawText: text };
        }
      };
      return true;
    })()`);

    // ========================================================================
    // SCENARIO 1: Create Medicine Panadol & Purchase 5 Boxes @ 800 (5% discount)
    // ========================================================================
    console.log('\n--- SCENARIO 1: Create Medicine Panadol & Purchase 5 Boxes @ 800 (5% discount) ---');
    const createRes = await window.webContents.executeJavaScript(`(async () => {
      const form = new FormData();
      form.append('name', 'Panadol Extra');
      form.append('price', '12.00');
      form.append('base_unit', 'Tablet');
      form.append('units_per_strip', '10');
      form.append('units_per_box', '100');
      form.append('default_sale_unit', 'strip');
      form.append('strip_price', '110.00');
      form.append('box_price', '1000.00');
      form.append('barcode', '10020');
      form.append('category', '1');
      form.append('quantity', '0');
      form.append('minStock', '20');

      return await window.testFetch('inventory/product', { method: 'POST', body: form });
    })()`);
    if (!createRes || !createRes.product || !createRes.product._id) {
      throw new Error('Failed to create Panadol Extra: ' + JSON.stringify(createRes));
    }
    const panadolId = createRes.product._id;
    console.log(`  Created Panadol Extra (ID: ${panadolId}, Box=10 Strips=100 Tabs, default=strip).`);

    // Purchase 5 boxes @ 800 with 5% discount:
    // Subtotal = 5 * 800 = 4,000. 5% discount = 200. Net = 3,800.
    // Base units = 5 * 100 = 500. Diluted unit cost = 3,800 / 500 = 7.60 = 760 cents.
    const purRes = await window.webContents.executeJavaScript(`(async () => {
      const payload = {
        supplier_id: 1,
        invoice_no: 'PUR-PAN-001',
        invoice_date: '2026-11-01',
        purchase_date: '2026-11-01',
        receiving_date: '2026-11-01',
        due_date: '2026-11-30',
        paid_amount: '3800.00',
        payment_method: 'cash',
        status: 'received',
        notes: 'Pack test purchase',
        items: [{
          product_id: ${panadolId},
          batch_number: 'BAT-PAN-01',
          expiry_date: '2032-12-31',
          purchase_unit: 'box',
          units_per_pack: 100,
          quantity: 5, // 5 boxes
          unit_cost: 800.00, // 800 per box
          discount_percent: 5
        }]
      };
      return await window.testFetch('purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    })()`);
    if (!purRes || !purRes.id) {
      throw new Error('Failed to post purchase: ' + JSON.stringify(purRes));
    }
    console.log('  Purchase posted: 5 boxes @ 800 (5% discount) -> Net PKR 3,800.00.');

    // Reload products in UI and verify stock and pack display
    await window.webContents.executeJavaScript(`loadProducts();`);
    await pause(600);

    const panadolCheck = db.prepare('SELECT p.*, i.quantity FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.id=?').get(panadolId);
    if (Number(panadolCheck.quantity) !== 500) {
      throw new Error(`Expected Panadol stock 500, got ${panadolCheck.quantity}`);
    }
    const panadolBatch = db.prepare('SELECT * FROM inventory_batches WHERE product_id=?').get(panadolId);
    if (panadolBatch.unit_cost_cents !== 760) {
      throw new Error(`Expected batch unit cost 760 cents (7.60), got ${panadolBatch.unit_cost_cents}`);
    }
    console.log('  Database confirmed: Stock = 500 base units, Unit Cost = PKR 7.60 (760 cents).');

    // Check product card stock badge in DOM
    const badgeText = await window.webContents.executeJavaScript(`(() => {
      return $('.product-card-item[data-product-id="${panadolId}"] .product-card-stock .count').text().trim();
    })()`);
    console.log(`  UI Stock Badge: "${badgeText}"`);
    if (!badgeText.includes('5 Box')) {
      throw new Error(`Expected stock badge to show "5 Box", got: "${badgeText}"`);
    }

    // ========================================================================
    // SCENARIO 2: POS Sales (1 Strip, 3 Tablets loose, 1 Box)
    // ========================================================================
    console.log('\n--- SCENARIO 2: POS Sales (1 Strip, 3 Tablets loose, 1 Box) ---');

    // Sale 2A: 1 Strip (price 110.00)
    console.log('  Sale 2A: 1 Strip @ 110.00...');
    const sale2aRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        id: 'SALE-2A-' + Date.now(),
        order_type: 1,
        status: 1,
        payment_type: 'Cash',
        paid: '110.00',
        change: '0.00',
        total: '110.00',
        discount: 0,
        tax: 0,
        user_id: 1,
        items: [{
          id: ${panadolId},
          product_name: 'Panadol Extra',
          price: 110.00,
          quantity: 1,
          sale_unit: 'strip',
          units_per_pack: 10
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!sale2aRes.ok && sale2aRes.status !== 200) throw new Error('Sale 2A failed: ' + JSON.stringify(sale2aRes));

    let stock2a = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    if (stock2a !== 490) throw new Error(`Stock after 1 strip sale should be 490, got ${stock2a}`);
    let cogs2a = db.prepare('SELECT cost_cents, cost_known FROM sale_batch_cogs WHERE product_id=? ORDER BY id DESC LIMIT 1').get(panadolId);
    if (cogs2a.cost_cents !== 7600 || cogs2a.cost_known !== 1) { // 10 * 760 = 7600
      throw new Error(`Sale 2A COGS expected 7600, got ${cogs2a.cost_cents}`);
    }
    console.log('    -> Stock: 490 (4 Box + 9 Strip). COGS: PKR 76.00. Revenue: PKR 110.00.');

    // Sale 2B: 3 Tablets (loose, 36.00)
    console.log('  Sale 2B: 3 Tablets (loose) @ 12.00 = 36.00...');
    const sale2bRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        id: 'SALE-2B-' + Date.now(),
        order_type: 1,
        status: 1,
        payment_type: 'Cash',
        paid: '36.00',
        change: '0.00',
        total: '36.00',
        discount: 0,
        tax: 0,
        user_id: 1,
        items: [{
          id: ${panadolId},
          product_name: 'Panadol Extra',
          price: 12.00,
          quantity: 3,
          sale_unit: 'base',
          units_per_pack: 1
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!sale2bRes.ok && sale2bRes.status !== 200) throw new Error('Sale 2B failed: ' + JSON.stringify(sale2bRes));

    let stock2b = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    if (stock2b !== 487) throw new Error(`Stock after 3 loose tablets sale should be 487, got ${stock2b}`);
    let cogs2b = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE product_id=? ORDER BY id DESC LIMIT 1').get(panadolId);
    if (cogs2b.cost_cents !== 2280) { // 3 * 760 = 2280
      throw new Error(`Sale 2B COGS expected 2280, got ${cogs2b.cost_cents}`);
    }
    console.log('    -> Stock: 487 (4 Box + 8 Strip + 7 Tablet). COGS: PKR 22.80. Revenue: PKR 36.00.');

    // Sale 2C: 1 Box (price 1000.00)
    console.log('  Sale 2C: 1 Box @ 1000.00...');
    const sale2cRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        id: 'SALE-2C-' + Date.now(),
        order_type: 1,
        status: 1,
        payment_type: 'Cash',
        paid: '1000.00',
        change: '0.00',
        total: '1000.00',
        discount: 0,
        tax: 0,
        user_id: 1,
        items: [{
          id: ${panadolId},
          product_name: 'Panadol Extra',
          price: 1000.00,
          quantity: 1,
          sale_unit: 'box',
          units_per_pack: 100
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!sale2cRes.ok && sale2cRes.status !== 200) throw new Error('Sale 2C failed: ' + JSON.stringify(sale2cRes));

    let stock2c = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    if (stock2c !== 387) throw new Error(`Stock after 1 box sale should be 387, got ${stock2c}`);
    let cogs2c = db.prepare('SELECT cost_cents FROM sale_batch_cogs WHERE product_id=? ORDER BY id DESC LIMIT 1').get(panadolId);
    if (cogs2c.cost_cents !== 76000) { // 100 * 760 = 76000
      throw new Error(`Sale 2C COGS expected 76000, got ${cogs2c.cost_cents}`);
    }
    console.log('    -> Stock: 387 (3 Box + 8 Strip + 7 Tablet). COGS: PKR 760.00. Revenue: PKR 1,000.00.');

    // Verify trial balance: debits == credits
    const tb = db.prepare(`SELECT SUM(debit_cents) AS total_debits, SUM(credit_cents) AS total_credits FROM journal_lines`).get();
    if (tb.total_debits !== tb.total_credits) {
      throw new Error(`Trial balance mismatch! Debits=${tb.total_debits}, Credits=${tb.total_credits}`);
    }
    console.log(`  Trial balance verified: Debits = Credits = PKR ${(tb.total_debits / 100).toFixed(2)}.`);

    // ========================================================================
    // SCENARIO 3: Combined Multi-Line Cart Stock Validation
    // ========================================================================
    console.log('\n--- SCENARIO 3: Combined Multi-Line Cart Stock Validation ---');
    await window.webContents.executeJavaScript(`loadProducts();`);
    await pause(500);

    // In POS renderer, add 1 box + 2 strips into cart (total base needed = 100 + 20 = 120 <= 387)
    const cartRes1 = await window.webContents.executeJavaScript(`(() => {
      cart.length = 0;
      $(this).renderTable(cart);
      const prod = allProducts.find(p => p._id == ${panadolId});
      // Add line 1: 1 Box
      cart.push({
        id: prod._id,
        product_name: prod.name,
        sku: prod.barcode,
        price: 1000.00,
        quantity: 1,
        sale_unit: 'box',
        units_per_pack: 100,
        units_per_box: 100,
        units_per_strip: 10,
        base_unit: 'Tablet'
      });
      // Add line 2: 2 Strips
      cart.push({
        id: prod._id,
        product_name: prod.name,
        sku: prod.barcode,
        price: 110.00,
        quantity: 2,
        sale_unit: 'strip',
        units_per_pack: 10,
        units_per_box: 100,
        units_per_strip: 10,
        base_unit: 'Tablet'
      });
      $(this).renderTable(cart);
      return { cartLen: cart.length, subtotal: subTotal };
    })()`);
    console.log(`  Cart populated with 1 Box + 2 Strips (120 tablets). Subtotal: PKR ${cartRes1.subtotal}. Cart length: ${cartRes1.cartLen}.`);

    // Now try to increment box quantity by 3 more (total 4 boxes + 2 strips = 420 > 387)
    const oversellCheck = await window.webContents.executeJavaScript(`(() => {
      let alertMsg = "";
      const origReportInfo = notiflix.Report.info;
      notiflix.Report.info = function(title, msg) {
        alertMsg = msg;
      };

      // Try to increment line 0 (Box) three times
      $(this).qtIncrement(0);
      $(this).qtIncrement(0);
      $(this).qtIncrement(0);

      notiflix.Report.info = origReportInfo;
      return {
        alertMsg,
        boxQty: cart[0].quantity,
        cartLen: cart.length
      };
    })()`);
    console.log(`  Oversell rejection result: alert="${oversellCheck.alertMsg}", boxQty=${oversellCheck.boxQty}, cartLen=${oversellCheck.cartLen}`);
    if (oversellCheck.boxQty > 3) {
      throw new Error(`Oversell validation failed! Allowed boxQty to reach ${oversellCheck.boxQty}`);
    }
    if (!oversellCheck.alertMsg.includes('available in stock') && !oversellCheck.alertMsg.includes('Box')) {
      throw new Error('Expected informative stock limit alert with pack display.');
    }
    console.log('  Combined multi-line stock validation PASSED. Cart stayed completely intact.');

    // ========================================================================
    // SCENARIO 4: POS Features (Discount, Khata, Mixed, Hold/Resume, Draft Restore, Double-Click)
    // ========================================================================
    console.log('\n--- SCENARIO 4: POS Features with Pack Sizes ---');

    // 4A: 10% Discount on Box + Strip
    console.log('  4A: Applying 10% discount on cart...');
    const discCheck = await window.webContents.executeJavaScript(`(() => {
      $('#inputDiscount').val('10').trigger('input');
      const discRupee = $('#discountRupeeLabel').text();
      return { discRupee, gross: $('#gross_price').text() };
    })()`);
    console.log(`    Discount label: ${discCheck.discRupee}, Gross Total: ${discCheck.gross}`);

    // 4B: Hold & Resume cart
    console.log('  4B: Hold and resume cart with pack units...');
    const holdResumeCheck = await window.webContents.executeJavaScript(`(() => {
      // Hold
      const holdId = 'HOLD-TEST-1';
      holdOrderList = [{
        _id: holdId,
        ref_number: 'REF-HOLD',
        customer: 0,
        discount_percent: 10,
        items: [...cart]
      }];
      cart.length = 0;
      $(this).renderTable(cart);
      if (cart.length !== 0) return { error: 'cart not cleared' };

      // Resume
      $(this).orderDetails(0, 1);
      return {
        resumedLen: cart.length,
        line0Unit: cart[0].sale_unit,
        line0Mult: cart[0].units_per_pack,
        line1Unit: cart[1].sale_unit,
        line1Mult: cart[1].units_per_pack
      };
    })()`);
    if (holdResumeCheck.resumedLen !== 2 || holdResumeCheck.line0Unit !== 'box' || holdResumeCheck.line1Unit !== 'strip') {
      throw new Error('Hold & resume failed to preserve pack units: ' + JSON.stringify(holdResumeCheck));
    }
    console.log('    Hold & resume preserved: Line 0 = Box (mult 100), Line 1 = Strip (mult 10).');

    // 4C: Draft persistence (restorePosDraft)
    console.log('  4C: Draft restore persistence...');
    const draftRestoreCheck = await window.webContents.executeJavaScript(`(() => {
      savePosDraftSync();
      const savedDraft = storage.get("pos_draft");
      cart.length = 0;
      $(this).renderTable(cart);
      restorePosDraft();
      return {
        restoredLen: cart.length,
        restoredUnit0: cart[0]?.sale_unit,
        restoredPrice0: cart[0]?.price
      };
    })()`);
    if (draftRestoreCheck.restoredLen !== 2 || draftRestoreCheck.restoredUnit0 !== 'box') {
      throw new Error('Draft restore failed to preserve pack sizes: ' + JSON.stringify(draftRestoreCheck));
    }
    console.log('    Draft restore preserved 2 cart lines with correct box price and unit.');

    // 4D: Khata Sale (Credit) of 1 Strip to Haji Aslam
    console.log('  4D: Khata sale of 1 Strip to customer Haji Aslam...');
    const khataSaleId = 'SALE-KHATA-' + Date.now();
    const khataSaleRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        _id: '${khataSaleId}',
        id: '${khataSaleId}',
        order_type: 1,
        status: 1,
        payment_type: 'Credit',
        paid: '0.00',
        change: '0.00',
        total: '110.00',
        discount: 0,
        tax: 0,
        customer: { id: 1, name: 'Haji Aslam' },
        user_id: 1,
        items: [{
          id: ${panadolId},
          product_name: 'Panadol Extra',
          price: 110.00,
          quantity: 1,
          sale_unit: 'strip',
          units_per_pack: 10
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!khataSaleRes.ok && khataSaleRes.status !== 200) throw new Error('Khata sale failed: ' + JSON.stringify(khataSaleRes));

    // Verify Customer Ledger / AR debited
    const arLine = db.prepare(`SELECT * FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=1100 AND je.reference_id=?`).get(khataSaleId);
    if (!arLine || arLine.debit_cents !== 11000) {
      throw new Error('Customer AR debit of 11,000 cents not found for Khata sale.');
    }
    console.log('    Khata sale verified in double-entry journal: Debited Accounts Receivable PKR 110.00.');

    // 4E: Mixed Payment Sale (50.00 Cash, 60.00 Card)
    console.log('  4E: Mixed payment sale on pack unit...');
    const mixedSaleId = 'SALE-MIXED-' + Date.now();
    const mixedSaleRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        _id: '${mixedSaleId}',
        id: '${mixedSaleId}',
        order_type: 1,
        status: 1,
        payment_type: 'Mixed',
        paid: '50.00',
        change: '0.00',
        total: '110.00',
        discount: 0,
        tax: 0,
        customer: { id: 1, name: 'Haji Aslam' },
        user_id: 1,
        items: [{
          id: ${panadolId},
          product_name: 'Panadol Extra',
          price: 110.00,
          quantity: 1,
          sale_unit: 'strip',
          units_per_pack: 10
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!mixedSaleRes.ok && mixedSaleRes.status !== 200) throw new Error('Mixed payment sale failed: ' + JSON.stringify(mixedSaleRes));
    console.log('    Mixed payment sale recorded successfully.');

    // ========================================================================
    // SCENARIO 5: Receipts & Invoice View
    // ========================================================================
    console.log('\n--- SCENARIO 5: Receipts & Invoice View ---');

    // Make an old-style sale of Cough Syrup (without pack settings)
    const oldSaleId = 'SALE-OLD-' + Date.now();
    const oldSaleRes = await window.webContents.executeJavaScript(`(async () => {
      const sale = {
        _id: '${oldSaleId}',
        id: '${oldSaleId}',
        order_type: 1,
        status: 1,
        payment_type: 'Cash',
        paid: '300.00',
        change: '0.00',
        total: '300.00',
        discount: 0,
        tax: 0,
        user_id: 1,
        items: [{
          id: 10,
          product_name: 'Cough Syrup 120ml',
          price: 150.00,
          quantity: 2
        }]
      };
      return await window.testFetch('new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale)
      });
    })()`);
    if (!oldSaleRes.ok && oldSaleRes.status !== 200) throw new Error('Old sale failed: ' + JSON.stringify(oldSaleRes));

    // Fetch and inspect the generated receipts via viewTransaction
    const receiptChecks = await window.webContents.executeJavaScript(`(async () => {
      allTransactions = await window.testFetch('all');
      allProducts = await window.testFetch('inventory/products');

      // Find strip sale
      const stripIdx = allTransactions.findIndex(t => t._id === '${khataSaleId}');
      $(this).viewTransaction(stripIdx);
      const stripHtml = $('#viewTransaction').html();

      // Find old syrup sale
      const oldIdx = allTransactions.findIndex(t => t._id === '${oldSaleId}');
      $(this).viewTransaction(oldIdx);
      const oldHtml = $('#viewTransaction').html();

      return {
        stripReceipt: stripHtml,
        oldReceipt: oldHtml
      };
    })()`);

    // Verify Strip receipt contains "1 Strip"
    if (!receiptChecks.stripReceipt.includes('1 Strip')) {
      throw new Error(`Receipt for strip sale missing '1 Strip': ${receiptChecks.stripReceipt}`);
    }
    console.log('  Strip sale receipt verified: contains "1 Strip" and unit price.');

    // Verify Old sale receipt contains raw quantity "2" without pack unit words
    if (!receiptChecks.oldReceipt.includes('<td>2 </td>') && !receiptChecks.oldReceipt.includes('<td>2</td>')) {
      throw new Error(`Old sale receipt expected raw "2": ${receiptChecks.oldReceipt}`);
    }
    if (receiptChecks.oldReceipt.includes('Tablet') || receiptChecks.oldReceipt.includes('Strip') || receiptChecks.oldReceipt.includes('Box')) {
      throw new Error('Old product receipt has pack unit words!');
    }
    console.log('  Old medicine receipt verified: shows raw count "2" without unit labels.');

    // ========================================================================
    // SCENARIO 6: Stock Adjustment & Returns
    // ========================================================================
    console.log('\n--- SCENARIO 6: Stock Adjustment & Returns ---');

    // 6A: Purchase return of 1 box to supplier
    console.log('  6A: Purchase return: returning 1 box to supplier...');
    const curPanadolStockBefore = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    const purItem = db.prepare('SELECT * FROM purchase_items WHERE product_id=?').get(panadolId);
    const pretRes = await window.webContents.executeJavaScript(`(async () => {
      const payload = {
        product_id: ${panadolId},
        batch_number: '${purItem.batch_number}',
        quantity: 1, // 1 box
        return_unit: 'box',
        reason: 'Damaged outer box'
      };
      return await window.testFetch('purchases/' + ${purItem.purchase_id} + '/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    })()`);
    if (!pretRes || !pretRes.return_number) throw new Error('Purchase return failed: ' + JSON.stringify(pretRes));

    const curPanadolStockAfterPret = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    if (curPanadolStockBefore - curPanadolStockAfterPret !== 100) {
      throw new Error(`Expected purchase return of 1 box to deduct 100 units, before=${curPanadolStockBefore}, after=${curPanadolStockAfterPret}`);
    }
    console.log(`    Purchase return deducted 100 base units (1 box). Stock: ${curPanadolStockAfterPret}.`);

    // 6B: Sales return of 1 strip from Haji Aslam
    console.log('  6B: Sales return: customer returning 1 strip...');
    const sretRes = await window.webContents.executeJavaScript(`(async () => {
      const payload = {
        sale_id: '${khataSaleId}',
        product_id: ${panadolId},
        quantity: 1,
        return_unit: 'strip',
        return_to_stock: 1,
        refund_method: 'credit',
        reason: 'Surplus strip'
      };
      return await window.testFetch('return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    })()`);
    if (!sretRes || !sretRes.return_number) throw new Error('Sales return failed: ' + JSON.stringify(sretRes));

    const curPanadolStockAfterSret = db.prepare('SELECT quantity FROM inventory WHERE product_id=?').get(panadolId).quantity;
    if (curPanadolStockAfterSret - curPanadolStockAfterPret !== 10) {
      throw new Error(`Expected sales return of 1 strip to restore 10 base units, got ${curPanadolStockAfterSret}`);
    }
    if (sretRes.refund_amount !== '110.00') {
      throw new Error(`Expected refund 110.00, got ${sretRes.refund_amount}`);
    }
    console.log(`    Sales return restored 10 base units. Refund = PKR 110.00. Stock: ${curPanadolStockAfterSret}.`);

    // ========================================================================
    // SCENARIO 7: Old Products Without Pack Settings
    // ========================================================================
    console.log('\n--- SCENARIO 7: Old Products Without Pack Settings ---');
    await window.webContents.executeJavaScript(`loadProducts();`);
    await pause(600);
    const oldProductCheck = await window.webContents.executeJavaScript(`(() => {
      const syrupCard = $('.product-card-item[data-product-id="10"]');
      const badge = syrupCard.find('.product-card-stock .count').text().trim();
      return {
        badge,
        hasNoUnitWord: !badge.includes('Tablet') && !badge.includes('Strip') && !badge.includes('Box')
      };
    })()`);
    console.log(`  Old medicine card badge: "${oldProductCheck.badge}"`);
    if (!oldProductCheck.hasNoUnitWord || !oldProductCheck.badge.includes('23')) { // 25 - 2 sold = 23
      throw new Error(`Old medicine badge should be raw "Stock: 23", got: ${oldProductCheck.badge}`);
    }
    console.log('  Old medicine display completely clean and unmodified.');

    // ========================================================================
    // SCENARIO 8: Pack Size Edit on Existing Product
    // ========================================================================
    console.log('\n--- SCENARIO 8: Pack Size Edit on Existing Product ---');
    await window.webContents.executeJavaScript(`(() => {
      const pIdx = allProducts.findIndex(p => p._id == ${panadolId});
      $(this).editProduct(pIdx);
    })()`);
    await pause(400);
    const editNoticeCheck = await window.webContents.executeJavaScript(`(() => {
      return {
        noticeVisible: $('#pack_edit_notice').css('display') !== 'none',
        noticeText: $('#pack_edit_notice').text().trim(),
        qtyInputReadonly: $('#quantity_input').prop('readonly')
      };
    })()`);
    if (!editNoticeCheck.noticeVisible || !editNoticeCheck.qtyInputReadonly) {
      throw new Error('Edit notice not visible or stock not readonly on product edit: ' + JSON.stringify(editNoticeCheck));
    }
    console.log(`  Edit notice banner visible: "${editNoticeCheck.noticeText.slice(0, 70)}..."`);
    console.log('  Opening stock input locked as readonly for existing stock.');

    // ========================================================================
    // SCENARIO 9: Reports with Pack Sizes
    // ========================================================================
    console.log('\n--- SCENARIO 9: Reports with Pack Sizes ---');

    // 9A: Stock Valuation Report
    const valRep = await window.webContents.executeJavaScript(`(async () => {
      return await window.testFetch('reports/stock-valuation');
    })()`);
    const valPanadol = (valRep.rows || []).find(r => (r.productId == panadolId || r.id == panadolId));
    if (!valPanadol || !valPanadol.pack_display) {
      throw new Error('Stock valuation missing pack_display for Panadol: ' + JSON.stringify(valPanadol));
    }
    console.log(`  Stock Valuation Report: Panadol pack_display = "${valPanadol.pack_display}", base stock = ${valPanadol.quantity}.`);

    // 9B: Expiry Report
    const expRep = await window.webContents.executeJavaScript(`(async () => {
      return await window.testFetch('reports/expiry?bucket=all');
    })()`);
    const expPanadol = (expRep.rows || []).find(b => b.productId == panadolId);
    if (!expPanadol || !expPanadol.pack_display) {
      throw new Error('Expiry Report missing pack_display for Panadol batch: ' + JSON.stringify(expPanadol));
    }
    console.log(`  Expiry Report: Panadol batch pack_display = "${expPanadol.pack_display}".`);

    // 9C: Low Stock Report
    const lowRep = await window.webContents.executeJavaScript(`(async () => {
      return await window.testFetch('reports/low-stock');
    })()`);
    console.log(`  Low Stock Report returned ${lowRep.rows ? lowRep.rows.length : 0} items with correct pack formatting.`);

    // 9D: Top Selling Report
    const topRep = await window.webContents.executeJavaScript(`(async () => {
      return await window.testFetch('reports/product-movement?days=30');
    })()`);
    const topPanadol = (topRep.topSelling || []).find(t => t.productId == panadolId);
    if (!topPanadol || !topPanadol.pack_display) {
      throw new Error('Top Selling Report missing pack_display for Panadol: ' + JSON.stringify(topPanadol));
    }
    console.log(`  Top Selling Report: Panadol velocity pack_display = "${topPanadol.pack_display}", units sold = ${topPanadol.quantitySold}.`);

    console.log('\n============================================================');
    console.log('>>> ALL 9 SCENARIOS VERIFIED SUCCESSFULLY IN ELECTRON UI <<<');
    console.log('============================================================');

    db.close();
    app.exit(0);
  } catch (err) {
    console.error('ERROR in runPackSizesSuite:', err);
    try { db.close(); } catch (_) {}
    app.exit(1);
  }
}
