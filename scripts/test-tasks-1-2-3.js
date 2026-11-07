// End-to-end verification script for Tasks 1, 2, and 3 using real Electron UI
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
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-tasks-test-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port = '43292';
    console.log('=== MULTI MEDICOS TASKS 1, 2, 3 END-TO-END ELECTRON UI VERIFICATION ===');
    console.log(`Test APPDATA (isolated): ${testAppData}`);
    console.log(`Test Port: ${port}`);

    let allPassed = false;
    try {
      seedDatabase(testAppData);
      console.log('Database pre-seeded with test data (categories, products, batches, users, customers).');

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
      console.log('TASKS 1, 2, 3 VERIFICATION PASSED (100% SUCCESS)');
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
  db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json)
    VALUES (2,'Antibiotics','{"name":"Antibiotics"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json)
    VALUES (3,'Syrups & Liquids','{"name":"Syrups & Liquids"}')`).run();

  // Insert Supplier
  db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,opening_balance_cents,status)
    VALUES (1,'Test Pharma Dist',0,'active')`).run();

  // Insert Purchase record for FK
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (1,'INV-TASK-1',1,'2026-10-01','2026-10-01','2026-10-01','2026-11-01','received','paid',500000,500000,'Test purchase',1)`).run();

  // 1: Panadol (Category: 1 = General Medicines)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (1,1001,'Panadol 500mg',5000,'31-Dec-2030','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (1,1,1,1,'PAN-B1','2030-12-31',100,100,3000,'2026-10-01')`).run();

  // 2: Amoxil (Category: 2 = Antibiotics)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (2,1002,'Amoxil 500mg',12000,'31-Dec-2030','2','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (2,2,1,1,'AMX-B1','2030-12-31',100,100,8000,'2026-10-01')`).run();

  // 3: Uncategorized Balm (category: '' empty string)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (3,1003,'Uncategorized Balm',3000,'31-Dec-2030','','1',1,2,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,50)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (3,3,1,1,'BALM-B1','2030-12-31',50,50,1500,'2026-10-01')`).run();

  // 4: Risek 40 (Wrongly marked Expired with past date: 01-Jan-2024)
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (4,1004,'Risek 40',15000,'01-Jan-2024','1','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (4,40)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (4,4,1,1,'RIS-ERR','2024-01-01',40,40,10000,'2026-10-01')`).run();

  // Customer
  const custData = { _id: 1, name: 'Asad Khan', phone: '03001234567', address: 'Lahore', credit_limit: 10000 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES (1,'Asad Khan',?,1000000)`).run(JSON.stringify(custData));
}

function spawnElectronTest(phaseFlag, port, testAppData) {
  return new Promise((resolve, reject) => {
    const electronExe = process.platform === 'win32'
      ? path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
      : path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

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
      reject(new Error(`Electron test runner timed out after 120 seconds.`));
    }, 120000);

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
  const port = portArgIndex !== -1 ? args[portArgIndex + 1] : (process.env.PORT || '43292');

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
          console.log('[Electron] Login screen visible. Submitting credentials...');
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
          console.log('[Electron] Waiting for post-login reload...');
          await reloadPromise;
          await pause(1000);
        }

        await waitFor(window, `() => {
          const main = document.querySelector('#main_app');
          return !!(main && getComputedStyle(main).display !== 'none');
        }`, 'Main application container');

        console.log('[Electron] Logged in to POS. Waiting for product cards...');
        await waitFor(window, `() => document.querySelectorAll('#parent .box').length >= 4`, 'Product cards in POS', 30000);
        console.log('[Electron] UI ready. Starting Task verifications.');

        // ====================================================================
        // TASK 1 VERIFICATION: Categories in POS
        // ====================================================================
        console.log('\n========================================');
        console.log('RUNNING TASK 1 CHECKS (CATEGORY IN POS)');
        console.log('========================================');

        const catCheck = await window.webContents.executeJavaScript(`
          (() => {
            const cards = [];
            $('#parent .product-card-item').each(function() {
              const pId = $(this).attr('data-product-id');
              const name = $(this).find('.product-card-name').text().trim();
              const catBadge = $(this).find('.product-category-badge').text().trim();
              const hidden = $(this).hasClass('pos-product-hidden');
              cards.push({ pId, name, catBadge, hidden });
            });

            const categoriesOptions = [];
            $('#categories option').each(function() {
              categoriesOptions.push({ val: $(this).val(), text: $(this).text().trim() });
            });

            return { cards, categoriesOptions };
          })()
        `);

        console.log('Product cards with categories:', catCheck.cards);
        console.log('Dropdown options:', catCheck.categoriesOptions);

        const panadol = catCheck.cards.find(c => c.name.includes('Panadol'));
        const amoxil = catCheck.cards.find(c => c.name.includes('Amoxil'));
        const balm = catCheck.cards.find(c => c.name.includes('Uncategorized Balm'));

        if (!panadol || panadol.catBadge !== 'General Medicines') {
          throw new Error(`FAIL: Panadol category badge expected 'General Medicines', got: '${panadol?.catBadge}'`);
        }
        if (!amoxil || amoxil.catBadge !== 'Antibiotics') {
          throw new Error(`FAIL: Amoxil category badge expected 'Antibiotics', got: '${amoxil?.catBadge}'`);
        }
        if (!balm || balm.catBadge !== 'Uncategorized') {
          throw new Error(`FAIL: Uncategorized Balm expected 'Uncategorized', got: '${balm?.catBadge}'`);
        }
        console.log('PASS: Category badges clearly displayed on product cards.');

        const optAll = catCheck.categoriesOptions.find(o => o.val === '0' && o.text.toLowerCase().includes('all'));
        if (!optAll) {
          throw new Error('FAIL: #categories does not contain "All categories" option');
        }
        console.log('PASS: Category filter dropdown contains "All categories" option.');

        // Test Category Filtering
        console.log('Testing category filter: selecting "Antibiotics"...');
        await window.webContents.executeJavaScript(`(() => {
          $('#categories').val('2').trigger('change');
          return true;
        })()`);
        await pause(300);

        const filter1 = await window.webContents.executeJavaScript(`
          (() => {
            const amoxilHidden = $('#parent [data-product-id="2"]').hasClass('pos-product-hidden');
            const panadolHidden = $('#parent [data-product-id="1"]').hasClass('pos-product-hidden');
            const balmHidden = $('#parent [data-product-id="3"]').hasClass('pos-product-hidden');
            return { amoxilHidden, panadolHidden, balmHidden };
          })()
        `);
        if (filter1.amoxilHidden || !filter1.panadolHidden || !filter1.balmHidden) {
          throw new Error(`FAIL: Category filter incorrect: Amoxil hidden=${filter1.amoxilHidden}, Panadol hidden=${filter1.panadolHidden}, Balm hidden=${filter1.balmHidden}`);
        }
        console.log('PASS: Category filter by Antibiotics correctly shows only Antibiotics.');

        // Test Combined Search + Category Filter
        console.log('Testing combined search + category filter...');
        await window.webContents.executeJavaScript(`(() => {
          $('#categories').val('0').trigger('change');
          $('#search').val('balm').trigger('input');
          return true;
        })()`);
        await pause(300);

        const filter2 = await window.webContents.executeJavaScript(`
          (() => {
            const balmHidden = $('#parent [data-product-id="3"]').hasClass('pos-product-hidden');
            const panadolHidden = $('#parent [data-product-id="1"]').hasClass('pos-product-hidden');
            return { balmHidden, panadolHidden };
          })()
        `);
        if (filter2.balmHidden || !filter2.panadolHidden) {
          throw new Error('FAIL: Combined search did not isolate Balm');
        }
        console.log('PASS: Combined search and filter works correctly.');

        // Reset search & filter
        await window.webContents.executeJavaScript(`(() => {
          $('#search').val('').trigger('input');
          $('#categories').val('0').trigger('change');
          return true;
        })()`);
        await pause(300);

        // Add "Uncategorized" item to cart and verify cart row subtitle
        console.log('Testing cart row category subtitle with Uncategorized item...');
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="3"]').click();
          return true;
        })()`);
        await pause(500);

        const cartCheck = await window.webContents.executeJavaScript(`
          (() => {
            const rowText = $('#cartTable .card-body .row:first').text();
            const catSub = $('#cartTable .cart-item-category').text().trim();
            return { rowText, catSub };
          })()
        `);
        console.log('Cart row inspection:', cartCheck);
        if (!cartCheck.catSub.includes('Uncategorized')) {
          throw new Error(`FAIL: Cart row missing category subtitle, got: '${cartCheck.catSub}'`);
        }
        console.log('PASS: Cart row displays small category subtitle [Uncategorized].');

        // Clear cart
        await clearCart(window);

        // ====================================================================
        // TASK 2 VERIFICATION: Medicine & Batch Expiry Edit
        // ====================================================================
        console.log('\n======================================================');
        console.log('RUNNING TASK 2 CHECKS (MEDICINE & BATCH EXPIRY EDIT)');
        console.log('======================================================');

        // 1. Verify Risek 40 is currently expired and clicking is blocked
        console.log('Checking Risek 40 (initially expired)...');
        await clearCart(window);

        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="4"]').click();
          return true;
        })()`);
        await pause(500);

        const risekCartCheck = await window.webContents.executeJavaScript(`(() => {
          const cartList = window.getPosCart ? window.getPosCart() : [];
          const inCart = cartList.some(item => item.id == 4);
          const rowCount = $('#cartTable .card-body .row').length;
          return { inCart, rowCount };
        })()`);
        console.log('Risek cart check after click:', risekCartCheck);
        if (risekCartCheck.inCart || risekCartCheck.rowCount > 0) {
          throw new Error('FAIL: Expired Risek 40 was added to cart! Should have been blocked.');
        }
        console.log('PASS: Expired Risek 40 correctly blocked from adding to cart.');

        // 2. Edit Risek 40 batch expiry from 2024-01-01 to 2029-12-31
        console.log('Updating Risek 40 batch expiry to 2029-12-31...');
        const updateRes = await window.webContents.executeJavaScript(`
          new Promise(resolve => {
            $.ajax({
              url: window.api + 'inventory/batch/4',
              type: 'PUT',
              contentType: 'application/json',
              data: JSON.stringify({
                batch_number: 'RIS-FIXED',
                expiry_date: '2029-12-31',
                userId: 1
              }),
              success: res => resolve({ ok: true, res }),
              error: (xhr) => resolve({ ok: false, status: xhr.status, err: xhr.responseJSON })
            });
          })
        `);
        console.log('Batch update response:', updateRes);
        if (!updateRes.ok) {
          throw new Error('FAIL: Batch update failed: ' + JSON.stringify(updateRes.err));
        }

        const risekProd = db.prepare('SELECT expiration_date, price_cents FROM products WHERE id = 4').get();
        const risekBatch = db.prepare('SELECT batch_number, expiry_date, quantity_available FROM inventory_batches WHERE id = 4').get();
        console.log('Risek product row in DB:', risekProd);
        console.log('Risek batch row in DB:', risekBatch);

        if (risekProd.expiration_date !== '31-Dec-2029' || risekBatch.expiry_date !== '2029-12-31') {
          throw new Error('FAIL: Product or batch expiry date did not sync properly.');
        }
        if (risekBatch.quantity_available !== 40) {
          throw new Error('FAIL: Stock quantity was modified during batch edit!');
        }
        console.log('PASS: Batch expiry updated in inventory_batches and synced to products.expiration_date. Stock quantity unchanged.');

        // Verify audit log
        const auditEntry = db.prepare("SELECT * FROM audit_logs WHERE entity_type = 'inventory_batches' AND entity_id = '4' ORDER BY id DESC LIMIT 1").get();
        console.log('Audit log entry for batch update:', auditEntry);
        if (!auditEntry || !auditEntry.details_json.includes('2029-12-31')) {
          throw new Error('FAIL: Audit log was not created for batch expiry update.');
        }
        console.log('PASS: Audit log correctly recorded batch change.');

        // 3. Reload products in POS and verify Risek 40 is now sellable
        console.log('Reloading products in POS and testing sale of Risek 40...');
        await window.webContents.executeJavaScript(`(() => { loadProducts(); return true; })()`);
        await pause(1000);

        // Click Risek 40 - should successfully add to cart
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="4"]').click();
          return true;
        })()`);
        await pause(500);

        const risekInCart = await window.webContents.executeJavaScript(`
          $('#cartTable .card-body .row').length > 0 && $('#cartTable').text().includes('Risek 40')
        `);
        if (!risekInCart) {
          throw new Error('FAIL: Risek 40 was not added to cart after expiry correction!');
        }
        console.log('PASS: Risek 40 is now sellable and successfully added to cart.');

        // Complete sale with Risek 40
        console.log('Completing sale of Risek 40...');
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#payButton').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#paymentModel').is(':visible')`, 'Payment modal open');
        await pause(300);

        const payPrep = await window.webContents.executeJavaScript(`(() => {
          $('#cash').click();
          $('#payment').val('150.00').trigger('input');
          return {
            paymentVal: $('#payment').val(),
            changeText: $('#change').text(),
            confirmVisible: $('#confirmPayment').is(':visible'),
            confirmDisabled: $('#confirmPayment').is(':disabled'),
            payablePrice: $('#payablePrice').val()
          };
        })()`);
        console.log('Payment modal prep state:', payPrep);

        await window.webContents.executeJavaScript(`(() => {
          $('#confirmPayment').click();
          return true;
        })()`);

        // Wait up to 20 seconds, logging state if stuck
        let closed = false;
        for (let wait = 0; wait < 40; wait++) {
          const state = await window.webContents.executeJavaScript(`(() => {
            const modalVis = $('#paymentModel').is(':visible');
            const total = parseInt($('#total').text()) || 0;
            const notiflixReport = $('#NXReportButton').length > 0;
            const notiflixText = $('#NXReportMessage').text();
            const orderModalVis = $('#orderModal').is(':visible');
            return { modalVis, total, notiflixReport, notiflixText, orderModalVis };
          })()`);
          if (!state.modalVis && state.total === 0) {
            closed = true;
            break;
          }
          if (state.notiflixReport) {
            console.log('Notiflix report detected:', state.notiflixText);
            await window.webContents.executeJavaScript(`(() => {
              $('#NXReportButton').click();
              $('#paymentModel').modal('hide');
              return true;
            })()`);
          }
          await pause(500);
        }
        if (!closed) {
          throw new Error('FAIL: Payment modal did not close or sale did not finish.');
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(1000);

        const risekRemaining = db.prepare('SELECT quantity FROM inventory WHERE product_id = 4').get().quantity;
        const risekBatchRemaining = db.prepare('SELECT quantity_available FROM inventory_batches WHERE id = 4').get().quantity_available;
        console.log('Risek stock after sale: inventory=' + risekRemaining + ', batch_qty=' + risekBatchRemaining);
        if (risekRemaining !== 39 || risekBatchRemaining !== 39) {
          throw new Error('FAIL: FEFO deduction failed on corrected item: inventory=' + risekRemaining + ', batch=' + risekBatchRemaining);
        }
        console.log('PASS: Corrected medicine sold and deducted atomically with FEFO.');

        // 4. Test reversing: Change an active product's batch to expired date and verify it becomes unsellable
        console.log('Changing Amoxil batch expiry to past date (2023-01-01)...');
        const expireAmoxil = await window.webContents.executeJavaScript(`
          new Promise(resolve => {
            $.ajax({
              url: window.api + 'inventory/batch/2',
              type: 'PUT',
              contentType: 'application/json',
              data: JSON.stringify({
                batch_number: 'AMX-EXPIRED',
                expiry_date: '2023-01-01',
                userId: 1
              }),
              success: res => resolve({ ok: true, res }),
              error: xhr => resolve({ ok: false, err: xhr.responseJSON })
            });
          })
        `);
        if (!expireAmoxil.ok) {
          throw new Error('FAIL: Could not update Amoxil expiry: ' + JSON.stringify(expireAmoxil.err));
        }
        await window.webContents.executeJavaScript(`(() => { loadProducts(); return true; })()`);
        await pause(1000);

        // Attempt to click Amoxil
        await clearCart(window);
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="2"]').click();
          return true;
        })()`);
        await pause(500);
        const amoxilBlocked = await window.webContents.executeJavaScript(`
          !(window.getPosCart ? window.getPosCart() : []).some(item => item.id == 2)
        `);
        if (!amoxilBlocked) {
          throw new Error('FAIL: Amoxil was added to cart even after being marked expired!');
        }
        console.log('PASS: Medicine changed to expired becomes immediately unsellable.');

        // 5. Test duplicate barcode rejection on product edit
        console.log('Testing duplicate barcode rejection on edit...');
        const dupBarcodeRes = await window.webContents.executeJavaScript(`
          new Promise(resolve => {
            const fd = new FormData();
            fd.append('id', '2');
            fd.append('barcode', '1001'); // Panadol's barcode
            fd.append('name', 'Amoxil Edited');
            fd.append('price', '120.00');
            fd.append('quantity', '50');
            fd.append('category', '2');
            fd.append('stock', 'on');
            $.ajax({
              url: window.api + 'inventory/product',
              type: 'POST',
              data: fd,
              processData: false,
              contentType: false,
              success: res => resolve({ ok: true, res }),
              error: xhr => resolve({ ok: false, status: xhr.status, err: xhr.responseJSON })
            });
          })
        `);
        console.log('Duplicate barcode response:', dupBarcodeRes);
        if (dupBarcodeRes.ok || dupBarcodeRes.status !== 409) {
          throw new Error('FAIL: Duplicate barcode was not rejected with 409 on product edit!');
        }
        console.log('PASS: Duplicate barcode correctly rejected with HTTP 409.');

        // Verify trial balance integrity
        const tb = db.prepare(`
          SELECT
            ROUND(SUM(debit_cents) / 100.0, 2) AS total_debits,
            ROUND(SUM(credit_cents) / 100.0, 2) AS total_credits
          FROM journal_lines
        `).get();
        console.log('Trial balance check: Debits=' + tb.total_debits + ', Credits=' + tb.total_credits);
        if (tb.total_debits !== tb.total_credits) {
          throw new Error('FAIL: Trial balance mismatch! Debits=' + tb.total_debits + ', Credits=' + tb.total_credits);
        }
        console.log('PASS: Trial balance remains in balance (debits == credits).');

        // ====================================================================
        // TASK 3 VERIFICATION: Light / Dark Theme Toggle
        // ====================================================================
        console.log('\n===========================================');
        console.log('RUNNING TASK 3 CHECKS (LIGHT / DARK THEME)');
        console.log('===========================================');

        // Click theme toggle button to switch to Dark
        console.log('Clicking #theme-toggle to switch to Dark mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#theme-toggle').click();
          return true;
        })()`);
        await pause(500);

        const darkState = await window.webContents.executeJavaScript(`
          (() => {
            const hasDarkClass = $('body').hasClass('theme-dark') || $('html').hasClass('theme-dark');
            const iconClass = $('#theme-icon').attr('class');
            const Store = require('electron-store');
            const saved = new Store().get('theme');
            return { hasDarkClass, iconClass, saved };
          })()
        `);
        console.log('Dark mode state:', darkState);
        if (!darkState.hasDarkClass || darkState.saved !== 'dark') {
          throw new Error('FAIL: Theme did not switch to dark or electron-store did not persist "dark"');
        }
        console.log('PASS: Switched to dark theme and persisted to electron-store.');

        // Reload window and verify theme persists with no flash
        console.log('Reloading window to verify dark theme persistence...');
        window.webContents.reload();
        await new Promise(r => window.webContents.once('did-finish-load', r));
        await pause(1000);

        const reloadedTheme = await window.webContents.executeJavaScript(`
          (() => {
            const hasDarkClass = $('body').hasClass('theme-dark') || $('html').hasClass('theme-dark');
            const Store = require('electron-store');
            const saved = new Store().get('theme');
            return { hasDarkClass, saved };
          })()
        `);
        console.log('Theme state after reload:', reloadedTheme);
        if (!reloadedTheme.hasDarkClass || reloadedTheme.saved !== 'dark') {
          throw new Error('FAIL: Dark theme did not persist after window reload!');
        }
        console.log('PASS: Dark theme persists across window reload.');

        // Verify receipt printing / preview styles remain strictly light
        const printCheck = await window.webContents.executeJavaScript(`
          (() => {
            const testEl = $('<div id="invoice-pos" class="receipt" style="display:none;"><span>Test</span></div>').appendTo('body');
            const computed = window.getComputedStyle(testEl[0]);
            const receiptBg = computed.backgroundColor;
            const receiptColor = computed.color;
            testEl.remove();
            return { receiptBg, receiptColor };
          })()
        `);
        console.log('Print / Receipt computed styles:', printCheck);
        if (printCheck.receiptBg !== 'rgb(255, 255, 255)' || printCheck.receiptColor !== 'rgb(0, 0, 0)') {
          throw new Error('FAIL: Receipt background or text color inverted! bg=' + printCheck.receiptBg + ', color=' + printCheck.receiptColor);
        }
        console.log('PASS: Receipts and print preview remain strictly white background (#ffffff) and black text (#000000).');

        // Toggle back to Light mode
        console.log('Toggling back to Light theme...');
        await window.webContents.executeJavaScript(`(() => {
          $('#theme-toggle').click();
          return true;
        })()`);
        await pause(300);
        const lightState = await window.webContents.executeJavaScript(`
          new (require('electron-store'))().get('theme')
        `);
        if (lightState !== 'light') {
          throw new Error('FAIL: Toggling back to light did not persist "light"');
        }
        console.log('PASS: Toggled back to light mode successfully.');

        console.log('\n============================================================');
        console.log('ALL TASKS 1, 2, 3 CHECKS COMPLETED AND VERIFIED 100%');
        console.log('============================================================\n');

        app.exit(0);
      } catch (err) {
        console.error('[Electron] Error during verification:', err);
        app.exit(1);
      }
    });
  });

  require('../start');
}
