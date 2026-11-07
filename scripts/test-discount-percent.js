// End-to-end Electron UI verification for Task 2: POS Discount as Percentage
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isElectron = !!process.versions.electron;
const args = process.argv.slice(2);
const isElectronRunner = args.includes('--electron-runner');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// PARENT ORCHESTRATOR (Runs under Node.js)
// ============================================================================
if (!isElectron) {
  (async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-discount-test-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port = '43293';
    console.log('=== MULTI MEDICOS TASK 2: POS DISCOUNT AS PERCENTAGE VERIFICATION ===');
    console.log(`Test APPDATA (isolated): ${testAppData}`);
    console.log(`Test Port: ${port}`);

    let allPassed = false;
    try {
      seedDatabase(testAppData);
      console.log('Database pre-seeded with medicines, customers, batches, and old held order.');

      console.log('\n--- LAUNCHING REAL ELECTRON UI TEST RUNNER ---');
      await spawnElectronTest('--electron-runner', port, testAppData);
      console.log('>>> ELECTRON TEST RUNNER COMPLETED.\n');

      allPassed = true;
    } catch (err) {
      console.error('TEST RUNNER FAILED:', err);
      process.exitCode = 1;
    } finally {
      for (let retries = 0; retries < 10; retries++) {
        try {
          if (fs.existsSync(tempRoot)) {
            fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            console.log(`Cleaned up temp test directory: ${tempRoot}`);
          }
          break;
        } catch (e) {
          await pause(300);
        }
      }
    }

    if (allPassed) {
      console.log('============================================================');
      console.log('TASK 2 (DISCOUNT AS PERCENTAGE) VERIFICATION PASSED 100%');
      console.log('============================================================');
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

  // Insert Users
  const password = require('bcrypt').hashSync('test-password-123', 10);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (1,'owner','Pharmacy Owner',?,1,1,1,1,1)`).run(password);

  // Insert Categories
  db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json)
    VALUES (1,'General Medicines','{"name":"General Medicines"}')`).run();

  // Insert Supplier
  db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,opening_balance_cents,status)
    VALUES (1,'Test Pharma Dist',0,'active')`).run();

  // Insert Purchase record for FK
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (1,'INV-TASK-2',1,'2026-10-01','2026-10-01','2026-10-01','2026-11-01','received','paid',500000,500000,'Test purchase',1)`).run();

  // Insert Products:
  // 1. Medicine 1000: Price PKR 1,000.00 (100000 cents)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (1,2001,'Product 1000',100000,'31-Dec-2030','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (1,1,1,1,'P1000-B1','2030-12-31',100,100,50000,'2026-10-01')`).run();

  // 2. Odd price item: Price PKR 125.50 (12550 cents)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (2,2002,'Odd Price Tonic',12550,'31-Dec-2030','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (2,2,1,1,'ODD-B1','2030-12-31',100,100,8000,'2026-10-01')`).run();

  // 3. Regular item: Price PKR 100.00 (10000 cents)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (3,2003,'Regular Cap 100',10000,'31-Dec-2030','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (3,3,1,1,'REG-B1','2030-12-31',100,100,6000,'2026-10-01')`).run();

  // Insert Customers:
  // Customer 1: Registered Customer (Khata Limit PKR 10,000)
  const cust1 = { _id: 1, name: 'Zahid Khan', phone: '03001234567', address: 'Lahore', credit_limit: 10000 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES (1,'Zahid Khan',?,1000000)`).run(JSON.stringify(cust1));

  // Customer 2: Low Khata Customer (Limit PKR 500 = 50000 cents)
  const cust2 = { _id: 2, name: 'Imran Ali', phone: '03007654321', address: 'Karachi', credit_limit: 500 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES (2,'Imran Ali',?,50000)`).run(JSON.stringify(cust2));

  // Seed an OLD held order with RUPEE discount (PKR 50.00 discount on Product 1000)
  const oldHeldData = {
    _id: 'old-held-order-001',
    order: 'old-held-order-001',
    ref_number: 'OLD-REF-50',
    discount: 50, // Old rupee discount (no discount_percent)
    customer: 0,
    status: 0,
    subtotal: '1000.00',
    tax: 0,
    order_type: 1,
    items: [{ id: 1, product_name: 'Product 1000', price: 1000, quantity: 1 }],
    date: '2026-10-01 10:00:00',
    total: '950.00',
    paid: '0.00',
    change: '0.00',
    user: 'Pharmacy Owner',
    user_id: 1
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('old-held-order-001',0,'2026-10-01T05:00:00.000Z',1,95000,0,'hash-old',?)`).run(JSON.stringify(oldHeldData));
}

function spawnElectronTest(phaseFlag, port, testAppData) {
  return new Promise((resolve, reject) => {
    const electronExe = require('electron');

    const env = {
      ...process.env,
      TEST_APPDATA: testAppData,
      PORT: port,
      PHARMASPOT_DISABLE_RELOADER: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExe, [__filename, phaseFlag, '--port', port, '--data', testAppData], {
      env,
      stdio: 'inherit',
      windowsHide: true
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron test runner timed out after 180s`));
    }, 180000);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron test runner exited with error code ${code}`));
    });
  });
}

// Helper to clear POS cart cleanly
async function clearCart(window) {
  await window.webContents.executeJavaScript(`(() => {
    if (typeof window.clearPosCart === 'function') {
      window.clearPosCart();
    }
    return true;
  })()`);
  await pause(300);
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
  throw new Error(`Timeout waiting for: ${label}`);
}

// ============================================================================
// ELECTRON EXECUTION (Runs under Electron process)
// ============================================================================
if (isElectron && isElectronRunner) {
  const { app, BrowserWindow } = require('electron');
  BrowserWindow.prototype.show = function () {};

  const dataArgIndex = args.indexOf('--data');
  const testAppData = dataArgIndex !== -1 ? args[dataArgIndex + 1] : process.env.TEST_APPDATA;
  if (!testAppData) throw new Error('TEST_APPDATA is required for Electron runner.');

  const portArgIndex = args.indexOf('--port');
  const port = portArgIndex !== -1 ? args[portArgIndex + 1] : (process.env.PORT || '43293');

  fs.mkdirSync(testAppData, { recursive: true });
  app.setPath('appData', testAppData);
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';

  const { db } = require('../api/sqlite');

  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', (_event, level, message) => {
      if (!/Content Security Policy|Content-Security-Policy|Electron Security Warning|DevTools/.test(message)) {
        console.log(`[RENDERER CONSOLE]: ${message}`);
      }
    });

    window.webContents.once('did-finish-load', async () => {
      try {
        await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view');
        await pause(600);

        const isLogin = await window.webContents.executeJavaScript(`(() => {
          const login = document.querySelector('#login');
          return !!(login && getComputedStyle(login).display !== 'none');
        })()`);

        if (isLogin) {
          console.log('[Electron] Submitting login credentials...');
          const reloadPromise = new Promise(resolve => {
            window.webContents.once('did-finish-load', resolve);
          });
          await window.webContents.executeJavaScript(`(() => {
            const form = document.querySelector('#account');
            form.querySelector('[name=username]').value = 'owner';
            form.querySelector('[name=password]').value = 'test-password-123';
            form.requestSubmit();
            return true;
          })()`);
          await reloadPromise;
          await pause(1000);
        }

        await waitFor(window, `() => {
          const main = document.querySelector('#main_app');
          return !!(main && getComputedStyle(main).display !== 'none');
        }`, 'Main application container');

        console.log('[Electron] Logged into POS. Waiting for product cards...');
        await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 3`, 'Product cards in POS', 30000);

        // ====================================================================
        // CHECK 1: 10% on PKR 1,000 cart -> Discount PKR 100.00, Gross Total PKR 900.00
        // ====================================================================
        console.log('\n--- CHECK 1: 10% discount on PKR 1,000 cart ---');
        await clearCart(window);

        // Add Product 1000 to cart (Price: 1,000.00)
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="1"]').click();
          return true;
        })()`);
        await pause(400);

        // Enter 10 in #inputDiscount
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('10').trigger('input');
          return true;
        })()`);
        await pause(300);

        const check1 = await window.webContents.executeJavaScript(`(() => {
          return {
            subtotalText: $('#price').text().trim(),
            discountVal: $('#inputDiscount').val(),
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotalText: $('#gross_price').text().trim(),
            payablePrice: $('#payablePrice').val().trim()
          };
        })()`);
        console.log('Check 1 UI values:', check1);

        if (!check1.subtotalText.includes('1,000') && !check1.subtotalText.includes('1000')) {
          throw new Error('FAIL: Check 1 subtotal expected 1,000.00, got: ' + check1.subtotalText);
        }
        if (!check1.rupeeLabel.includes('100.00') && !check1.rupeeLabel.includes('100')) {
          throw new Error('FAIL: Check 1 rupee preview expected 100.00, got: ' + check1.rupeeLabel);
        }
        if (!check1.grossTotalText.includes('900.00') && !check1.grossTotalText.includes('900')) {
          throw new Error('FAIL: Check 1 gross total expected 900.00, got: ' + check1.grossTotalText);
        }
        console.log('PASS: 10% on PKR 1,000 displays Discount PKR 100.00 and Gross Total PKR 900.00.');

        // Complete sale and verify backend saved transaction stores discount 100
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await window.webContents.executeJavaScript(`(() => {
          $('#cash').click();
          $('#payment').val('900.00').trigger('input');
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => !$('#paymentModel').is(':visible')`, 'Payment modal close', 20000);
        await pause(500);

        const latestSale1 = db.prepare('SELECT total_cents, data_json FROM sales WHERE status = 1 ORDER BY rowid DESC LIMIT 1').get();
        const saleData1 = JSON.parse(latestSale1.data_json);
        console.log('Sale 1 saved in DB:', { total_cents: latestSale1.total_cents, discount: saleData1.discount, discount_percent: saleData1.discount_percent });
        if (latestSale1.total_cents !== 90000 || Number(saleData1.discount) !== 100 || Number(saleData1.discount_percent) !== 10) {
          throw new Error(`FAIL: Sale 1 in DB incorrect: total=${latestSale1.total_cents}, discount=${saleData1.discount}, discount_percent=${saleData1.discount_percent}`);
        }
        console.log('PASS: Transaction saved in DB with discount=100, discount_percent=10, total=900.00.');

        // Close receipt modal
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(500);

        // ====================================================================
        // CHECK 2: 2.5% on odd subtotal rounds correctly to 2 decimals
        // ====================================================================
        console.log('\n--- CHECK 2: 2.5% discount on odd subtotal (PKR 125.50) ---');
        await clearCart(window);

        // Add Odd Price Tonic (Price: 125.50)
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="2"]').click();
          return true;
        })()`);
        await pause(400);

        // 125.50 * 0.025 = 3.1375 -> rounded to 2 decimals = 3.14. Total = 125.50 - 3.14 = 122.36
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('2.5').trigger('input');
          return true;
        })()`);
        await pause(300);

        const check2 = await window.webContents.executeJavaScript(`(() => {
          return {
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotalText: $('#gross_price').text().trim(),
            payablePrice: $('#payablePrice').val().trim()
          };
        })()`);
        console.log('Check 2 UI values:', check2);
        if (!check2.rupeeLabel.includes('3.14')) {
          throw new Error('FAIL: Check 2 discount expected 3.14, got: ' + check2.rupeeLabel);
        }
        if (!check2.grossTotalText.includes('122.36')) {
          throw new Error('FAIL: Check 2 gross total expected 122.36, got: ' + check2.grossTotalText);
        }
        console.log('PASS: 2.5% on PKR 125.50 rounds correctly to PKR 3.14 discount, PKR 122.36 total.');

        // ====================================================================
        // CHECK 3: 0 and empty work
        // ====================================================================
        console.log('\n--- CHECK 3: 0 and empty discount input ---');
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('0').trigger('input');
          return true;
        })()`);
        await pause(200);
        let check3 = await window.webContents.executeJavaScript(`(() => {
          return { rupeeLabel: $('#discountRupeeLabel').text().trim(), grossTotal: $('#gross_price').text().trim() };
        })()`);
        if (!check3.rupeeLabel.includes('0') || !check3.grossTotal.includes('125.5')) {
          throw new Error('FAIL: 0 discount failed: ' + JSON.stringify(check3));
        }

        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('').trigger('input');
          return true;
        })()`);
        await pause(200);
        check3 = await window.webContents.executeJavaScript(`(() => {
          return { rupeeLabel: $('#discountRupeeLabel').text().trim(), grossTotal: $('#gross_price').text().trim() };
        })()`);
        if (!check3.rupeeLabel.includes('0') || !check3.grossTotal.includes('125.5')) {
          throw new Error('FAIL: Empty discount failed: ' + JSON.stringify(check3));
        }
        console.log('PASS: 0 and empty discount properly reset discount amount to 0.00.');

        // ====================================================================
        // CHECK 4: 100% gives total 0 handled sensibly
        // ====================================================================
        console.log('\n--- CHECK 4: 100% discount gives total 0.00 ---');
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('100').trigger('input');
          return true;
        })()`);
        await pause(300);
        const check4 = await window.webContents.executeJavaScript(`(() => {
          return {
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotal: $('#gross_price').text().trim(),
            payablePrice: $('#payablePrice').val().trim()
          };
        })()`);
        console.log('Check 4 (100% discount):', check4);
        if (!check4.rupeeLabel.includes('125.5') || !check4.grossTotal.includes('0') || parseFloat(check4.payablePrice) !== 0) {
          throw new Error('FAIL: 100% discount did not give 0.00 total: ' + JSON.stringify(check4));
        }
        console.log('PASS: 100% discount gives 0.00 total.');

        // ====================================================================
        // CHECK 5: Invalid values (101, -5, "abc") are clamped/rejected
        // ====================================================================
        console.log('\n--- CHECK 5: Validation - reject 101, -5, abc ---');
        // > 100 should clamp to 100
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('101').trigger('input');
          return true;
        })()`);
        await pause(200);
        const val101 = await window.webContents.executeJavaScript(`$('#inputDiscount').val()`);
        if (parseFloat(val101) > 100) {
          throw new Error('FAIL: Discount > 100 was not clamped, got: ' + val101);
        }

        // Negative should clamp to 0 / empty
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('-5').trigger('input');
          return true;
        })()`);
        await pause(200);
        const valNeg = await window.webContents.executeJavaScript(`$('#inputDiscount').val()`);
        if (parseFloat(valNeg) < 0) {
          throw new Error('FAIL: Negative discount was not clamped, got: ' + valNeg);
        }
        console.log('PASS: Invalid discount values (>100 and negative) are strictly rejected/clamped.');

        // ====================================================================
        // CHECK 6: Changing quantity updates the discount amount live
        // ====================================================================
        console.log('\n--- CHECK 6: Live recalculation when quantity changes ---');
        await clearCart(window);

        // Add Regular Cap 100 (PKR 100.00)
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="3"]').click();
          return true;
        })()`);
        await pause(300);

        // Set 10% discount -> PKR 10.00 discount on 100.00
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('10').trigger('input');
          return true;
        })()`);
        await pause(300);
        let discQty1 = await window.webContents.executeJavaScript(`$('#discountRupeeLabel').text().trim()`);
        if (!discQty1.includes('10')) throw new Error('FAIL: Expected 10 discount on qty 1, got: ' + discQty1);

        // Increment qty to 2 (Subtotal = 200.00)
        await window.webContents.executeJavaScript(`(() => {
          $(this).qtIncrement(0);
          return true;
        })()`);
        await pause(400);

        const check6 = await window.webContents.executeJavaScript(`(() => {
          return {
            subtotal: $('#price').text().trim(),
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotal: $('#gross_price').text().trim()
          };
        })()`);
        console.log('Check 6 after qty increase:', check6);
        if (!check6.subtotal.includes('200') || !check6.rupeeLabel.includes('20') || !check6.grossTotal.includes('180')) {
          throw new Error('FAIL: Quantity increase did not recalculate discount live: ' + JSON.stringify(check6));
        }
        console.log('PASS: Increasing quantity from 1 to 2 recalculated discount live from PKR 10.00 to PKR 20.00.');

        // ====================================================================
        // CHECK 7: Mixed and Khata sales with percent discount compute correct due
        // ====================================================================
        console.log('\n--- CHECK 7: Khata credit sale with percent discount ---');
        // Total is 180.00. Select Customer 1 (Zahid Khan), Pay 80.00 Cash, Due 100.00 to Khata
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Zahid Khan'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await window.webContents.executeJavaScript(`(() => {
          $('#cash').click();
          $('#payment').val('80.00').trigger('input');
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => !$('#paymentModel').is(':visible')`, 'Payment modal close', 20000);
        await pause(500);

        const latestSale7 = db.prepare('SELECT total_cents, paid_cents FROM sales WHERE status = 1 ORDER BY rowid DESC LIMIT 1').get();
        const { getCustomerReceivableFromJournal } = require('../api/accounting');
        const cust1Receivable = getCustomerReceivableFromJournal('1');
        console.log('Sale 7 Khata result:', { total_cents: latestSale7.total_cents, paid_cents: latestSale7.paid_cents, cust1Receivable });
        if (latestSale7.total_cents !== 18000 || latestSale7.paid_cents !== 8000 || cust1Receivable !== 10000) {
          throw new Error(`FAIL: Mixed sale Khata mismatch: total=${latestSale7.total_cents}, paid=${latestSale7.paid_cents}, rec=${cust1Receivable}`);
        }
        console.log('PASS: Mixed payment with percent discount correctly posted PKR 80.00 cash and PKR 100.00 to customer Khata.');
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(500);

        // ====================================================================
        // CHECK 8: Hold order with percent discount, then resume
        // ====================================================================
        console.log('\n--- CHECK 8: Hold order with percent discount and resume ---');
        await clearCart(window);

        // Add Product 1000 (PKR 1,000.00)
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="1"]').click();
          return true;
        })()`);
        await pause(300);

        // Set 15% discount -> PKR 150.00 discount, total 850.00
        await window.webContents.executeJavaScript(`(() => {
          $('#inputDiscount').val('15').trigger('input');
          return true;
        })()`);
        await pause(300);

        // Hold order
        await window.webContents.executeJavaScript(`(() => {
          $('#refNumber').val('HELD-PCT-15');
          $(this).submitDueOrder(0);
          return true;
        })()`);
        await pause(1000);

        // Clear cart
        await clearCart(window);
        const emptyTotal = await window.webContents.executeJavaScript(`parseInt($('#total').text()) || 0`);
        if (emptyTotal !== 0) throw new Error('Cart not empty before resuming held order');

        // Resume held order via UI button in #renderHoldOrders
        const resumed = await window.webContents.executeJavaScript(`(() => {
          let found = false;
          $('#renderHoldOrders .order-box').each(function() {
            if ($(this).find('.ref_number').text().trim() === 'HELD-PCT-15') {
              $(this).find('button:has(.fa-shopping-basket)').click();
              found = true;
              return false;
            }
          });
          return {
            found,
            discountVal: $('#inputDiscount').val(),
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotal: $('#gross_price').text().trim()
          };
        })()`);
        console.log('Resumed held order:', resumed);
        if (!resumed.found || resumed.discountVal !== '15' || !resumed.rupeeLabel.includes('150') || !resumed.grossTotal.includes('850')) {
          throw new Error('FAIL: Held order with percent discount failed to resume with correct values: ' + JSON.stringify(resumed));
        }
        console.log('PASS: Held order with 15% discount resumed with percent (15%) and totals (PKR 850.00) intact.');

        // ====================================================================
        // CHECK 9: Ctrl+R / window reload draft restore keeps percent & totals
        // ====================================================================
        console.log('\n--- CHECK 9: Window reload restores draft percent and totals ---');
        // Draft currently has the resumed order with 15% discount
        await pause(500);
        window.webContents.reload();
        await new Promise(r => window.webContents.once('did-finish-load', r));
        await pause(1500);

        const restoredDraft = await window.webContents.executeJavaScript(`(() => {
          return {
            totalItems: parseInt($('#total').text()) || 0,
            discountVal: $('#inputDiscount').val(),
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotal: $('#gross_price').text().trim()
          };
        })()`);
        console.log('Restored draft after reload:', restoredDraft);
        if (restoredDraft.totalItems !== 1 || restoredDraft.discountVal !== '15' || !restoredDraft.rupeeLabel.includes('150') || !restoredDraft.grossTotal.includes('850')) {
          throw new Error('FAIL: Draft restore after reload failed: ' + JSON.stringify(restoredDraft));
        }
        console.log('PASS: Draft restore after window reload preserved 15% discount and PKR 850.00 total.');

        // Clear cart
        await clearCart(window);

        // ====================================================================
        // CHECK 10: Old held order with RUPEE discount resumes and totals unchanged
        // ====================================================================
        console.log('\n--- CHECK 10: Old held order with rupee discount (PKR 50.00) ---');
        const oldResumed = await window.webContents.executeJavaScript(`(() => {
          let found = false;
          $('#renderHoldOrders .order-box').each(function() {
            if ($(this).find('.ref_number').text().trim() === 'OLD-REF-50') {
              $(this).find('button:has(.fa-shopping-basket)').click();
              found = true;
              return false;
            }
          });
          return {
            found,
            discountVal: $('#inputDiscount').val(),
            rupeeLabel: $('#discountRupeeLabel').text().trim(),
            grossTotal: $('#gross_price').text().trim()
          };
        })()`);
        console.log('Old held order resumed:', oldResumed);
        // Product 1000 was PKR 1,000.00 with PKR 50.00 rupee discount.
        // 50 / 1000 * 100 = 5%. Total = 950.00.
        if (!oldResumed.found || parseFloat(oldResumed.discountVal) !== 5 || !oldResumed.rupeeLabel.includes('50') || !oldResumed.grossTotal.includes('950')) {
          throw new Error('FAIL: Old held order with rupee discount did not convert correctly: ' + JSON.stringify(oldResumed));
        }
        console.log('PASS: Old held order converted PKR 50.00 rupee discount to 5% with exact PKR 950.00 total.');

        // Clear cart
        await clearCart(window);

        // ====================================================================
        // CHECK 11: Trial balance remains in balance (debits == credits)
        // ====================================================================
        console.log('\n--- CHECK 11: Trial balance integrity ---');
        const tb = db.prepare(`
          SELECT
            ROUND(SUM(debit_cents) / 100.0, 2) AS total_debits,
            ROUND(SUM(credit_cents) / 100.0, 2) AS total_credits
          FROM journal_lines
        `).get();
        console.log('Trial balance:', tb);
        if (tb.total_debits !== tb.total_credits) {
          throw new Error(`FAIL: Trial balance mismatch! Debits=${tb.total_debits}, Credits=${tb.total_credits}`);
        }
        console.log('PASS: Trial balance in balance (Debits === Credits: ' + tb.total_debits + ').');

        console.log('\n============================================================');
        console.log('ALL TASK 2 DISCOUNT VERIFICATIONS COMPLETED SUCCESSFULLY');
        console.log('============================================================\n');

        app.exit(0);
      } catch (err) {
        console.error('[Electron] Error during Task 2 verification:', err);
        app.exit(1);
      }
    });
  });

  require('../start');
}
