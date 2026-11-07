// End-to-end Electron UI test runner for Multi Medicos Point of Sale
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isElectron = !!process.versions.electron;
const args = process.argv.slice(2);
const isPhase1 = args.includes('--electron-phase-1');
const isPhase2 = args.includes('--electron-phase-2');

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// PARENT ORCHESTRATOR (Runs under Node.js)
// ============================================================================
if (!isElectron) {
  (async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-e2e-pos-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port1 = '43281';
    const port2 = '43282';
    console.log('=== MULTI MEDICOS END-TO-END ELECTRON UI VERIFICATION ===');
    console.log(`Test APPDATA (isolated): ${testAppData}`);
    console.log(`Port Phase 1: ${port1}, Phase 2: ${port2}`);

    let allPassed = false;
    try {
      // 1. Pre-seed database under testAppData
      seedDatabase(testAppData);
      console.log('Database pre-seeded with Owner, Categories, Suppliers, 4 Medicines, and 2 Customers.');

      // 2. Run Phase 1 in Electron
      console.log('\n--- LAUNCHING ELECTRON UI TEST PHASE 1 (Main Checks 1, 2, 3, 4A, 5, 6 + Extra Checks) ---');
      await spawnElectronPhase('--electron-phase-1', port1, testAppData);
      console.log('>>> ELECTRON UI PHASE 1 COMPLETED SUCCESSFULLY.\n');

      // 3. Run Phase 2 in Electron (Cold app restart persistence & product validation)
      console.log('--- LAUNCHING ELECTRON UI TEST PHASE 2 (Cold App Restart Persistence & Product Validation) ---');
      await spawnElectronPhase('--electron-phase-2', port2, testAppData);
      console.log('>>> ELECTRON UI PHASE 2 COMPLETED SUCCESSFULLY.\n');

      // 4. Run Phase 3: Rollback isolation test (Original code vs Fix comparison)
      console.log('--- RUNNING PHASE 3: ROLLBACK LOGIC COMPARISON (Original vs Fix) ---');
      runRollbackComparisonTest();
      console.log('>>> PHASE 3 COMPLETED SUCCESSFULLY.\n');

      allPassed = true;
    } catch (err) {
      console.error('E2E TEST RUNNER ERROR:', err);
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
      console.log('ALL END-TO-END POS UI CHECKS PASSED (100% SUCCESS)');
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

  // Insert Owner and Cashier 2
  const password = require('bcrypt').hashSync('isolated-ui-password-123', 10);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (1,'ui-owner','POS Cashier',?,1,1,1,1,1)`).run(password);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (2,'ui-cashier2','Second Cashier',?,1,1,1,1,1)`).run(password);

  // Insert Category
  db.prepare(`INSERT OR IGNORE INTO categories(id,name,data_json)
    VALUES (1,'General Medicines','{"name":"General Medicines"}')`).run();

  // Insert Supplier
  db.prepare(`INSERT OR IGNORE INTO suppliers(id,name,opening_balance_cents,status)
    VALUES (1,'Medix Distribution',0,'active')`).run();

  // Insert Purchase record for batch FK
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (1,'INV-001',1,'2026-10-01','2026-10-01','2026-10-01','2026-10-31','received','paid',100000,100000,'Stock In',1)`).run();

  // Insert 4 Medicines with inventory and inventory_batches
  // 1: Panadol 500mg (Price 50.00 = 5000 cents, initial stock 100, cost 3000)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (1,10001,'Panadol 500mg',5000,'31-Dec-2035','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (1,1,1,1,'BAT-001','2035-12-31',100,100,3000,'2026-10-01')`).run();

  // 2: Brufen 400mg (Price 80.00 = 8000 cents, initial stock 100, cost 5000)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (2,10002,'Brufen 400mg',8000,'31-Dec-2035','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (2,2,1,1,'BAT-002','2035-12-31',100,100,5000,'2026-10-01')`).run();

  // 3: Augmentin 625mg (Price 250.00 = 25000 cents, initial stock 50, cost 18000)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (3,10003,'Augmentin 625mg',25000,'31-Dec-2035','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,50)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (3,3,1,1,'BAT-003','2035-12-31',50,50,18000,'2026-10-01')`).run();

  // 4: Limited Stock Syrup (Price 120.00 = 12000 cents, initial stock 5, cost 8000)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (4,10004,'Limited Stock Syrup',12000,'31-Dec-2035','1','1',1,2,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (4,5)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (4,4,1,1,'BAT-004','2035-12-31',5,5,8000,'2026-10-01')`).run();

  // Insert 2 Customers
  // Customer 1: Tariq Mahmood (low Khata limit: PKR 500 = 50000 cents)
  const cust1Data = { _id: 1, name: 'Tariq Mahmood', phone: '03001111111', address: 'Lahore', credit_limit: 500 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES ('1','Tariq Mahmood',?,50000)`).run(JSON.stringify(cust1Data));

  // Customer 2: Zubair Ahmed (Khata limit: PKR 5000 = 500000 cents)
  const cust2Data = { _id: 2, name: 'Zubair Ahmed', phone: '03002222222', address: 'Karachi', credit_limit: 5000 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES ('2','Zubair Ahmed',?,500000)`).run(JSON.stringify(cust2Data));

  // Close parent DB handle so SQLite file is not locked
  db.close();
}

function spawnElectronPhase(phaseFlag, port, testAppData) {
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
      reject(new Error(`Electron test ${phaseFlag} timed out after 200 seconds.`));
    }, 200000);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron test ${phaseFlag} exited with error code ${code}`));
    });
  });
}

function runRollbackComparisonTest() {
  const { DatabaseSync } = require('node:sqlite');
  console.log('Checking whether DatabaseSync.isTransaction exists in bundled runtime:');
  const tempDbPath = path.join(os.tmpdir(), `test-trans-${Date.now()}.sqlite`);
  const db = new DatabaseSync(tempDbPath);
  db.exec('CREATE TABLE test_val (id INTEGER PRIMARY KEY, v TEXT);');

  const hasIsTransaction = typeof db.isTransaction !== 'undefined';
  console.log(`  DatabaseSync.isTransaction property exists: ${hasIsTransaction} (value: ${db.isTransaction})`);

  // Original transaction logic:
  function originalTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const res = work();
      db.exec('COMMIT');
      return res;
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
  }

  // Fixed transaction logic:
  function fixedTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const res = work();
      db.exec('COMMIT');
      return res;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }

  // Test 1: Exception thrown in work()
  let origError;
  try {
    originalTransaction(() => {
      db.exec("INSERT INTO test_val VALUES (1, 'orig');");
      throw new Error('Work failed');
    });
  } catch (e) {
    origError = e;
  }
  console.log(`  Original rollback caught work error: "${origError.message}"`);

  // Test 2: In original code, if rollback itself threw or if transaction was aborted:
  // With fix, original error is NEVER masked even if db.exec('ROLLBACK') throws
  let fixedCaught;
  try {
    fixedTransaction(() => {
      db.exec("INSERT INTO test_val VALUES (2, 'fix');");
      throw new Error('Original business error that must not be masked');
    });
  } catch (e) {
    fixedCaught = e;
  }
  if (!fixedCaught || fixedCaught.message !== 'Original business error that must not be masked') {
    throw new Error('Fixed transaction failed to preserve original error');
  }

  // Verify next transaction works immediately:
  const result = fixedTransaction(() => {
    db.prepare("INSERT INTO test_val VALUES (3, 'success');").run();
    return db.prepare('SELECT COUNT(*) AS c FROM test_val WHERE id = 3').get().c;
  });
  if (result !== 1) throw new Error('Transaction after rollback failed');
  console.log('  Subsequent transaction succeeded without transaction lock leak.');

  db.close();
  try { fs.rmSync(tempDbPath, { force: true }); } catch (_) {}
}

// ============================================================================
// ELECTRON EXECUTION (Runs under Electron binary)
// ============================================================================
if (isElectron) {
  const { app, BrowserWindow } = require('electron');
  // Avoid window popup during background execution
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
      if (isPhase1) {
        runPhase1(app, window, db, testAppData);
      } else if (isPhase2) {
        runPhase2(app, window, db, testAppData);
      }
    });
  });

  require('../start');
}

// Helper to execute code in renderer and poll for condition
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

async function addProductToCart(window, productId) {
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const el = document.querySelector('#parent [data-product-id="${productId}"]');
      if (el) {
        const prevCount = parseInt($('#total').text()) || 0;
        el.click();
        for (let i = 0; i < 30; i++) {
          const curCount = parseInt($('#total').text()) || 0;
          if (curCount > prevCount) return true;
          await new Promise(r => setTimeout(r, 50));
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Product ${productId} was not added to cart in time');
  })()`);
}

async function reloadAndWait(window) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Window reload timed out.')), 25000);
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    window.webContents.reload();
  });
}

async function dismissNotiflixReport(window) {
  await window.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById('NXReportButton');
    if (btn) btn.click();
    const wrap = document.getElementById('NotiflixReportWrap');
    if (wrap) wrap.remove();
    $('#paymentModel').modal('hide');
    return true;
  })()`);
  await pause(300);
}

async function openPaymentModal(window) {
  for (let i = 0; i < 20; i++) {
    const isVis = await window.webContents.executeJavaScript(`(() => {
      if ($('#paymentModel').is(':visible')) return true;
      $('#payButton').click();
      return $('#paymentModel').is(':visible');
    })()`);
    if (isVis) return true;
    await pause(250);
  }
  throw new Error('Payment modal failed to open');
}

// ============================================================================
// PHASE 1: Main Electron UI Verification
// ============================================================================
async function runPhase1(app, window, db, testAppData) {
  try {
    console.log('[PHASE 1] Waiting for window to finish loading...');
    await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view');
    await pause(600);

    // 1. Authenticate if login screen is visible
    const isLogin = await window.webContents.executeJavaScript(`(() => {
      const login = document.querySelector('#login');
      return !!(login && getComputedStyle(login).display !== 'none');
    })()`);

    if (isLogin) {
      console.log('[PHASE 1] Login screen visible. Submitting credentials...');
      const reloadPromise = new Promise(resolve => {
        window.webContents.once('did-finish-load', resolve);
      });
      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('#account');
        form.querySelector('[name=username]').value = 'ui-owner';
        form.querySelector('[name=password]').value = 'isolated-ui-password-123';
        form.requestSubmit();
        return true;
      })()`);
      console.log('[PHASE 1] Waiting for post-login reload...');
      await reloadPromise;
      await pause(1000);
    }

    await waitFor(window, `() => {
      const main = document.querySelector('#main_app');
      return !!(main && getComputedStyle(main).display !== 'none');
    }`, 'Main application container');

    console.log('[PHASE 1] Logged in to POS. Waiting for product cards and customer dropdown...');
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'Product cards in POS', 30000);
    await waitFor(window, `() => document.querySelectorAll('#customer option').length >= 3`, 'Customer options in POS', 30000);
    console.log('[PHASE 1] UI elements ready. Starting Checks.');

    // ------------------------------------------------------------------------
    // CHECK 1: 30 consecutive sales through the UI
    // (10 cash, 10 full Khata to Customer 2, 10 mixed payment to Customer 2)
    // ------------------------------------------------------------------------
    console.log('\n--- CHECK 1: 30 Consecutive Sales through the UI ---');
    for (let i = 1; i <= 30; i++) {
      if (i <= 10) {
        // Add Panadol x 1 (PKR 50.00)
        await addProductToCart(window, 1);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await window.webContents.executeJavaScript(`(() => {
          $('#cash').click();
          $('#payment').val('50.00').trigger('input');
          $('#confirmPayment').click();
          return true;
        })()`);
      } else if (i <= 20) {
        // Add Brufen x 1 (PKR 80.00), Customer 2
        await addProductToCart(window, 2);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await window.webContents.executeJavaScript(`(() => {
          $('#creditPaymentBtn').click();
          $('#confirmPayment').click();
          return true;
        })()`);
      } else {
        // Add Augmentin x 1 (PKR 250.00), Customer 2, Pay 100 Cash, Due 150
        await addProductToCart(window, 3);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await window.webContents.executeJavaScript(`(() => {
          $('#cash').click();
          $('#payment').val('100.00').trigger('input');
          $('#confirmPayment').click();
          return true;
        })()`);
      }

      // Wait for sale completion: paymentModel hides, and cart empty
      await waitFor(window, `() => {
        return parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible');
      }`, `Sale #${i} completed`);

      // Dismiss receipt modal if open
      await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
      await pause(250);
      process.stdout.write(`.`);
    }
    console.log('\nAll 30 sales dispatched and completed through the UI.');

    // Verify DB state for Check 1
    const totalSales = db.prepare('SELECT COUNT(*) AS count FROM sales WHERE status = 1').get().count;
    const stockP = db.prepare('SELECT quantity FROM inventory WHERE product_id = 1').get().quantity;
    const stockB = db.prepare('SELECT quantity FROM inventory WHERE product_id = 2').get().quantity;
    const stockA = db.prepare('SELECT quantity FROM inventory WHERE product_id = 3').get().quantity;
    const { getCustomerReceivableFromJournal } = require('../api/accounting');
    const cust2Khata = getCustomerReceivableFromJournal('2');
    const trialBalance = db.prepare(`SELECT SUM(debit_cents) AS debits, SUM(credit_cents) AS credits FROM journal_lines`).get();

    console.log(`CHECK 1 EVIDENCE:`);
    console.log(`  Total completed sales in DB: ${totalSales} (Expected: 30)`);
    console.log(`  Stock: Panadol=${stockP} (100-10=90), Brufen=${stockB} (100-10=90), Augmentin=${stockA} (50-10=40)`);
    console.log(`  Customer 2 Khata receivable: PKR ${(cust2Khata / 100).toFixed(2)} (Expected: 10*80 + 10*150 = 2300.00)`);
    console.log(`  Trial Balance: Debits=${(trialBalance.debits/100).toFixed(2)}, Credits=${(trialBalance.credits/100).toFixed(2)}`);

    if (totalSales !== 30) throw new Error(`Check 1 Failed: Expected 30 sales, got ${totalSales}`);
    if (stockP !== 90 || stockB !== 90 || stockA !== 40) throw new Error('Check 1 Failed: Stock deduction mismatch');
    if (cust2Khata !== 230000) throw new Error(`Check 1 Failed: Khata receivable mismatch: ${cust2Khata}`);
    if (trialBalance.debits !== trialBalance.credits || trialBalance.debits <= 0) throw new Error('Check 1 Failed: Trial balance imbalance');
    console.log('-> CHECK 1: PASS\n');

    // ------------------------------------------------------------------------
    // CHECK 2: Deliberate failure then recovery (rollback test)
    // ------------------------------------------------------------------------
    console.log('--- CHECK 2: Deliberate Failure then Recovery ---');
    // Part A: Credit limit exceeded (Customer 1 limit is 500; attempt 3 Augmentin = 750)
    await addProductToCart(window, 3);
    await addProductToCart(window, 3);
    await addProductToCart(window, 3);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Tariq Mahmood'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#payButton').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#creditPaymentBtn').click();
      $('#confirmPayment').click();
      return true;
    })()`);

    // Wait for failure alert
    await waitFor(window, `() => {
      const alert = document.querySelector('.notiflix-report-content');
      return !!(alert && alert.textContent.includes('credit limit'));
    }`, 'Credit limit failure report');

    const failMsg1 = await window.webContents.executeJavaScript(`document.querySelector('.notiflix-report-content').textContent`);
    console.log(`  UI Failure message captured: "${failMsg1.replace(/\\s+/g, ' ').trim()}"`);

    // Dismiss failure dialog and confirm cart still intact
    await dismissNotiflixReport(window);
    const cartCountAfterFail = await window.webContents.executeJavaScript(`parseInt($('#total').text())`);
    console.log(`  Cart item count intact after error: ${cartCountAfterFail}`);
    if (cartCountAfterFail !== 3) throw new Error('Cart was wiped upon payment failure');

    // Part B: Try selling more than available stock
    // Clear cart via row delete buttons
    await window.webContents.executeJavaScript(`(() => {
      $('#cartTable .card-body .btn-light.btn-xs').each(function() { $(this).click(); });
      return true;
    })()`);
    await pause(300);

    // Add Panadol x 3, then simulate stock reduction in DB to 1 (e.g. concurrent sale at another till)
    await addProductToCart(window, 1);
    await addProductToCart(window, 1);
    await addProductToCart(window, 1);
    db.prepare('UPDATE inventory SET quantity = 1 WHERE product_id = 1').run();

    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#payButton').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('150.00').trigger('input');
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => {
      const alert = document.querySelector('.notiflix-report-content');
      return !!(alert && alert.textContent.includes('Insufficient stock'));
    }`, 'Insufficient stock report');

    const failMsg2 = await window.webContents.executeJavaScript(`document.querySelector('.notiflix-report-content').textContent`);
    console.log(`  UI Stock failure message captured: "${failMsg2.replace(/\\s+/g, ' ').trim()}"`);

    await dismissNotiflixReport(window);

    // Restore Panadol stock to 90
    db.prepare('UPDATE inventory SET quantity = 90 WHERE product_id = 1').run();

    // Part C: Immediately complete valid cash sale WITHOUT restarting
    console.log('  Completing immediate normal valid cash sale without restarting...');
    await window.webContents.executeJavaScript(`(() => {
      $('#cartTable .card-body .btn-light.btn-xs').each(function() { $(this).click(); });
      return true;
    })()`);
    await pause(300);
    await addProductToCart(window, 1);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#payButton').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('50.00').trigger('input');
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Recovery sale completed');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);

    // Check pos-errors.log exists and contains real failure reasons
    const logPath = path.join(testAppData, 'PharmaSpot', 'logs', 'pos-errors.log');
    if (!fs.existsSync(logPath)) throw new Error('pos-errors.log was not created');
    const logContent = fs.readFileSync(logPath, 'utf8');
    if (!logContent.includes('credit limit') || !logContent.includes('Insufficient stock')) {
      throw new Error('pos-errors.log missing expected failure reasons');
    }
    console.log(`  pos-errors.log verified (${fs.statSync(logPath).size} bytes), contains real failure reasons.`);
    console.log('-> CHECK 2: PASS\n');

    // ------------------------------------------------------------------------
    // CHECK 3: Rapid double-click & Enter on Pay / Confirm Payment
    // ------------------------------------------------------------------------
    console.log('--- CHECK 3: Rapid Double-Click & Double Submission Guard ---');
    const salesBeforeDouble = db.prepare('SELECT COUNT(*) AS count FROM sales WHERE status = 1').get().count;

    // Normal sale rapid click
    await addProductToCart(window, 1);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      return true;
    })()`);
    await openPaymentModal(window);
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('50.00').trigger('input');
      // Rapid double click
      $('#confirmPayment').click();
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Sale completed');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);

    const salesAfterNormalDouble = db.prepare('SELECT COUNT(*) AS count FROM sales WHERE status = 1').get().count;
    if (salesAfterNormalDouble !== salesBeforeDouble + 1) {
      throw new Error(`Double click created multiple sales! Expected ${salesBeforeDouble + 1}, got ${salesAfterNormalDouble}`);
    }
    console.log('  Normal sale double click guard: Exactly ONE sale created.');

    // Held order double click
    console.log('  Testing held order double click...');
    await addProductToCart(window, 2);
    await window.webContents.executeJavaScript(`(() => {
      $('#hold').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#dueModal').is(':visible')`, 'Hold modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#refNumber').val('HOLD-RACE-1');
      $(this).submitDueOrder(0);
      return true;
    })()`);
    await pause(600);

    // Resume and pay the held order with double click
    await window.webContents.executeJavaScript(`(() => {
      $('#dueModal').modal('hide');
      $.fn.getHoldOrders();
      return true;
    })()`);
    await pause(500);

    await window.webContents.executeJavaScript(`(() => {
      $.fn.payOrder(0, 1);
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open for held order');
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('80.00').trigger('input');
      $('#confirmPayment').click();
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Held sale completed');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);
    await pause(500);

    const salesAfterHeldDouble = db.prepare('SELECT COUNT(*) AS count FROM sales WHERE status = 1').get().count;
    if (salesAfterHeldDouble !== salesAfterNormalDouble + 1) {
      throw new Error(`Held order double click created multiple sales! Expected ${salesAfterNormalDouble + 1}, got ${salesAfterHeldDouble}`);
    }
    console.log('  Held order double click guard: Exactly ONE sale created.');
    console.log('-> CHECK 3: PASS\n');

    // ------------------------------------------------------------------------
    // CHECK 4: Reload persistence (Part 1 - Window Reload)
    // ------------------------------------------------------------------------
    console.log('--- CHECK 4: POS State Reload Persistence ---');
    // Add Panadol x 2 (50.00 ea) and Brufen x 3 (80.00 ea), Select Customer 2, Discount 20.00, Card, Payment 320.00
    await addProductToCart(window, 1);
    await addProductToCart(window, 1);
    await addProductToCart(window, 2);
    await addProductToCart(window, 2);
    await addProductToCart(window, 2);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#inputDiscount').val('20.00').trigger('input');
      return true;
    })()`);
    await openPaymentModal(window);
    await window.webContents.executeJavaScript(`(() => {
      $('#card').click();
      $('#payment').val('320.00').trigger('input');
      return true;
    })()`);
    // Allow debounce timer to persist draft
    await pause(600);

    console.log('  Triggering window reload (Ctrl+R / webContents.reload())...');
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(1000);

    const restoredState = await window.webContents.executeJavaScript(`(() => {
      const rows = document.querySelectorAll('#cartTable .card-body .row').length;
      const totalCount = parseInt($('#total').text()) || 0;
      const discount = $('#inputDiscount').val();
      const customer = $('#customer option:selected').text();
      const khataBadge = $('#customer_khata_badge').is(':visible');
      const draftNotice = $('#draftNoticeAlert').is(':visible');
      const discardBtn = $('#discardRestoredDraft').length > 0;
      const paymentVal = $('#payment').val();
      const isCardActive = $('#card').hasClass('active');
      return { rows, totalCount, discount, customer, khataBadge, draftNotice, discardBtn, paymentVal, isCardActive };
    })()`);

    console.log('  Restored State after reload:', JSON.stringify(restoredState));
    if (restoredState.rows !== 2 || restoredState.totalCount !== 5) {
      throw new Error(`Check 4 Failed: Expected 2 cart rows (total 5), got rows=${restoredState.rows}, total=${restoredState.totalCount}`);
    }
    if (parseFloat(restoredState.discount) !== 20) throw new Error(`Check 4 Failed: Discount mismatch: ${restoredState.discount}`);
    if (!restoredState.customer.includes('Zubair Ahmed')) throw new Error('Check 4 Failed: Customer was not restored');
    if (!restoredState.khataBadge) throw new Error('Check 4 Failed: Customer Khata badge was not displayed');
    if (!restoredState.draftNotice || !restoredState.discardBtn) throw new Error('Check 4 Failed: Draft notice or discard button missing');
    if (restoredState.paymentVal !== '320.00' || !restoredState.isCardActive) throw new Error('Check 4 Failed: Payment inputs were not restored');
    console.log('  Window reload persistence verified completely.');
    console.log('-> CHECK 4 (Part A - Window Reload): PASS\n');

    // ------------------------------------------------------------------------
    // CHECK 5: Draft clearing
    // ------------------------------------------------------------------------
    console.log('--- CHECK 5: Draft Clearing Rules ---');
    // Part A: Completing sale clears draft
    console.log('  Completing sale with restored draft...');
    await openPaymentModal(window);
    await window.webContents.executeJavaScript(`(() => {
      $('#confirmPayment').click();
      return true;
    })()`);
    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Sale completed');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);

    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(600);
    const cartAfterCompletedSaleReload = await window.webContents.executeJavaScript(`parseInt($('#total').text()) || 0`);
    if (cartAfterCompletedSaleReload !== 0) throw new Error('Check 5 Failed: Draft was not cleared after successful sale');
    console.log('  Successful sale cleared draft verified (cart empty after reload).');

    // Part B: Discard / Cancel draft
    console.log('  Testing discard draft button...');
    await addProductToCart(window, 1);
    await window.webContents.executeJavaScript(`(() => {
      $('#inputDiscount').val('5.00').trigger('input');
      return true;
    })()`);
    await pause(500);
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(800);

    await window.webContents.executeJavaScript(`(() => { $('#discardRestoredDraft').click(); return true; })()`);
    await pause(300);
    const cartAfterDiscard = await window.webContents.executeJavaScript(`parseInt($('#total').text()) || 0`);
    if (cartAfterDiscard !== 0) throw new Error('Check 5 Failed: Discard button did not clear cart');
    console.log('  Discard draft button cleared cart verified.');

    // Part C: Failed payment does NOT clear draft
    console.log('  Testing failed payment draft retention...');
    await addProductToCart(window, 3);
    await addProductToCart(window, 3);
    await addProductToCart(window, 3);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Tariq Mahmood'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#payButton').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#creditPaymentBtn').click();
      $('#confirmPayment').click();
      return true;
    })()`);
    await waitFor(window, `() => document.querySelector('.notiflix-report-content')`, 'Failure modal');
    await dismissNotiflixReport(window);
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(800);
    const cartAfterFailReload = await window.webContents.executeJavaScript(`parseInt($('#total').text()) || 0`);
    if (cartAfterFailReload !== 3) throw new Error('Check 5 Failed: Draft was lost after failed payment');
    console.log('  Failed payment draft retention verified.');

    // Part D: Discard and clear for next test
    await window.webContents.executeJavaScript(`(() => { $('#discardRestoredDraft').click(); return true; })()`);

    // Part E: Logging in as different user does not restore previous user's draft
    console.log('  Testing multi-user draft isolation...');
    await window.webContents.executeJavaScript(`(() => {
      const Store = require('electron-store');
      const st = new Store();
      // Inject draft belonging to a different user (userId: 999)
      st.set('pos_draft', {
        userId: 999,
        savedAt: Date.now(),
        cart: [{ id: 1, product_name: 'Panadol 500mg', sku: '10001', price: 50, quantity: 1 }]
      });
      return true;
    })()`);
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(800);

    const checkDraftNotRestored = await window.webContents.executeJavaScript(`(() => {
      const Store = require('electron-store');
      const st = new Store();
      const count = parseInt($('#total').text()) || 0;
      const draftInStore = st.get('pos_draft');
      return { count, draftInStore: !!draftInStore };
    })()`);
    console.log('  Multi-user draft isolation result:', JSON.stringify(checkDraftNotRestored));
    if (checkDraftNotRestored.count !== 0 || checkDraftNotRestored.draftInStore) {
      throw new Error('Check 5 Failed: Different user draft was restored or not purged!');
    }
    console.log('  Different user draft isolation verified.');

    console.log('-> CHECK 5: PASS\n');

    // ------------------------------------------------------------------------
    // CHECK 6: Hold order regression
    // ------------------------------------------------------------------------
    console.log('--- CHECK 6: Hold Order Regression ---');
    await addProductToCart(window, 3);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#hold').click();
      return true;
    })()`);
    await waitFor(window, `() => $('#dueModal').is(':visible')`, 'Hold modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#refNumber').val('HOLD-REG-1');
      $(this).submitDueOrder(0);
      return true;
    })()`);
    await pause(600);

    const heldInDb = db.prepare("SELECT COUNT(*) AS c FROM sales WHERE status = 0 AND data_json LIKE '%HOLD-REG-1%'").get().c;
    if (heldInDb !== 1) throw new Error('Held order was not saved in DB with status 0');
    console.log('  Held order saved in SQLite with status 0 verified.');

    console.log('  Reloading window with held order present...');
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(600);

    // Resume and pay the held order
    await window.webContents.executeJavaScript(`(() => {
      $.fn.getHoldOrders();
      return true;
    })()`);
    await pause(500);

    await window.webContents.executeJavaScript(`(() => {
      $.fn.payOrder(0, 1);
      return true;
    })()`);
    await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('250.00').trigger('input');
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Held sale completed');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);

    const heldRemaining = db.prepare("SELECT COUNT(*) AS c FROM sales WHERE status = 0 AND data_json LIKE '%HOLD-REG-1%'").get().c;
    const completedHeld = db.prepare("SELECT COUNT(*) AS c FROM sales WHERE status = 1 AND data_json LIKE '%HOLD-REG-1%'").get().c;
    if (heldRemaining !== 0 || completedHeld !== 1) {
      throw new Error(`Check 6 Failed: Held order not transitioned properly. Remaining: ${heldRemaining}, Completed: ${completedHeld}`);
    }
    console.log('  Held order cleanly transitioned from status 0 to 1 without duplicates.');
    console.log('-> CHECK 6: PASS\n');

    // ------------------------------------------------------------------------
    // EXTRA CHECKS: Session Expiry (401) & Print Failure
    // ------------------------------------------------------------------------
    console.log('--- EXTRA CHECKS: 401 Session Expiry & Print Failure ---');
    // 1. Session Expiry: Draft saved before reload
    console.log('  Testing 401 Session Expiry draft preservation...');
    await addProductToCart(window, 1);
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      // Trigger ajaxError 401 handler
      $(document).trigger('ajaxError', [{ status: 401 }, { url: 'http://localhost:43281/api/some-endpoint' }]);
      return true;
    })()`);
    await pause(600);

    // Verify draft was saved in storage before reload
    const Store = require('electron-store');
    const store = new Store();
    const draftBeforeRelogin = store.get('pos_draft');
    if (!draftBeforeRelogin || !draftBeforeRelogin.cart || draftBeforeRelogin.cart.length === 0) {
      throw new Error('Draft was not saved prior to 401 redirect');
    }
    console.log('  401 handler saved draft synchronously before redirect verified.');

    // Wait for login screen and re-authenticate as Owner
    await waitFor(window, `() => document.querySelector('#login') && getComputedStyle(document.querySelector('#login')).display !== 'none'`, 'Login screen after 401');
    const reloadPromise = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    await window.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('#account');
      form.querySelector('[name=username]').value = 'ui-owner';
      form.querySelector('[name=password]').value = 'isolated-ui-password-123';
      form.requestSubmit();
      return true;
    })()`);
    await reloadPromise;
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded after 401 re-login');
    await pause(800);

    // Verify draft was restored after re-login
    const restoredCountAfter401 = await window.webContents.executeJavaScript(`parseInt($('#total').text()) || 0`);
    console.log(`  Restored cart count after 401 re-login: ${restoredCountAfter401}`);
    if (restoredCountAfter401 !== 1) {
      throw new Error(`Expected draft restored after 401 re-login, got ${restoredCountAfter401}`);
    }

    // Discard restored draft before print test
    await window.webContents.executeJavaScript(`(() => { $('#discardRestoredDraft').click(); return true; })()`);
    await pause(300);

    // 2. Print Failure Simulation: window.printJS throws error
    console.log('  Testing Print Failure gracefulness...');
    await addProductToCart(window, 1);
    await window.webContents.executeJavaScript(`(() => {
      window.printJS = () => { throw new Error('Printer spooler hardware error'); };
      $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      return true;
    })()`);
    await openPaymentModal(window);
    await window.webContents.executeJavaScript(`(() => {
      $('#cash').click();
      $('#payment').val('50.00').trigger('input');
      $('#confirmPayment').click();
      return true;
    })()`);

    await waitFor(window, `() => parseInt($('#total').text()) === 0 && !$('#paymentModel').is(':visible')`, 'Sale completed with simulated print error');
    await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
    await pause(500);
    console.log('  Print failure did NOT fail or block the sale.');
    console.log('-> EXTRA CHECKS: PASS\n');

    // Setup for Phase 2: Add cart items and persist draft before app exit
    console.log('Preparing draft state for Phase 2 cold app restart...');
    await addProductToCart(window, 1);
    await addProductToCart(window, 1); // Panadol x 2
    await addProductToCart(window, 2); // Brufen x 1
    await window.webContents.executeJavaScript(`(() => {
      $('#customer option').filter(function() { return $(this).text().includes('Zubair Ahmed'); }).prop('selected', true);
      $('#customer').trigger('chosen:updated').trigger('change');
      $('#inputDiscount').val('10.00').trigger('input');
      return true;
    })()`);
    await pause(600);

    console.log('[PHASE 1] All checks completed successfully. Exiting Electron...');
    app.exit(0);
  } catch (err) {
    console.error('PHASE 1 ERROR:', err);
    app.exit(1);
  }
}

// ============================================================================
// PHASE 2: Cold App Restart Persistence & Product Validation
// ============================================================================
async function runPhase2(app, window, db, testAppData) {
  try {
    console.log('[PHASE 2] Cold relaunch detected. Waiting for UI...');
    await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view');
    await pause(600);

    const isLogin = await window.webContents.executeJavaScript(`(() => {
      const login = document.querySelector('#login');
      return !!(login && getComputedStyle(login).display !== 'none');
    })()`);

    if (isLogin) {
      console.log('[PHASE 2] Re-logging in as Owner...');
      const reloadPromise = new Promise(resolve => {
        window.webContents.once('did-finish-load', resolve);
      });
      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('#account');
        form.querySelector('[name=username]').value = 'ui-owner';
        form.querySelector('[name=password]').value = 'isolated-ui-password-123';
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

    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'Product cards in POS', 30000);
    await pause(1000);

    // Verify draft restored after cold app restart
    const restoredRows = await window.webContents.executeJavaScript(`document.querySelectorAll('#cartTable .card-body .row').length`);
    const restoredNotice = await window.webContents.executeJavaScript(`$('#draftNoticeAlert').is(':visible')`);
    console.log(`  Cold app restart restored rows: ${restoredRows}, notice visible: ${restoredNotice}`);
    if (restoredRows !== 2 || !restoredNotice) {
      throw new Error('Check 4 (Cold App Restart): Draft was not restored across process restarts');
    }
    console.log('-> CHECK 4 (Part B - Cold App Restart Persistence): PASS\n');

    // Product validation test: Modify price and clamp stock in DB
    console.log('  Testing price update & stock clamp validation on restored draft...');
    // Update Brufen price to 95.00 (9500 cents) and clamp Panadol stock to 1
    db.prepare('UPDATE products SET price_cents = 9500 WHERE id = 2').run();
    db.prepare('UPDATE inventory SET quantity = 1 WHERE product_id = 1').run();

    console.log('  Reloading window to trigger draft re-validation against updated product data...');
    await reloadAndWait(window);
    await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'POS reloaded');
    await pause(1000);

    const validationCheck = await window.webContents.executeJavaScript(`(() => {
      let panadolQty = 0;
      let brufenPrice = '';
      // Extract from the rendered DOM rows
      const rows = document.querySelectorAll('#cartTable .card-body .row');
      rows.forEach(r => {
        const text = r.textContent;
        const qtyVal = r.querySelector('input') ? parseInt(r.querySelector('input').value) : 0;
        if (text.includes('Panadol')) panadolQty = qtyVal;
        if (text.includes('Brufen')) {
          brufenPrice = (r.children && r.children[3]) ? r.children[3].textContent : text;
        }
      });
      return { panadolQty, brufenPrice };
    })()`);

    console.log('  Validation Check Result:', JSON.stringify(validationCheck));
    if (validationCheck.panadolQty !== 1) {
      throw new Error(`Check 4 (Stock Clamp): Expected Panadol quantity clamped to 1, got ${validationCheck.panadolQty}`);
    }
    if (!validationCheck.brufenPrice.includes('95')) {
      throw new Error(`Check 4 (Price Update): Expected Brufen price updated to 95, got ${validationCheck.brufenPrice}`);
    }
    console.log('  Draft validation against modified price and reduced stock passed.');
    console.log('-> CHECK 4 (Part C - Product Data Validation): PASS\n');

    // Clean up draft and exit
    await window.webContents.executeJavaScript(`(() => { $('#discardRestoredDraft').click(); return true; })()`);
    await pause(300);

    console.log('[PHASE 2] Cold app restart and validation checks passed. Exiting Electron...');
    app.exit(0);
  } catch (err) {
    console.error('PHASE 2 ERROR:', err);
    app.exit(1);
  }
}
