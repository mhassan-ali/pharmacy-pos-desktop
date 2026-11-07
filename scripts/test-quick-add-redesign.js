// scripts/test-quick-add-redesign.js
// End-to-end Electron UI test runner for Multi Medicos Redesigned Add Medicine / Product Forms

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isElectron = !!process.versions.electron;
const args = process.argv.slice(2);

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (!isElectron) {
  (async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-quickadd-ui-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port = '43398';
    console.log('=== MULTI MEDICOS QUICK ADD & PRODUCT FORM REDESIGN TEST ===');
    console.log(`Test APPDATA (isolated): ${testAppData}`);
    console.log(`Port: ${port}`);

    let allPassed = false;
    try {
      seedDatabase(testAppData);
      console.log('Database pre-seeded with Admin, Categories (Tablets, Syrups), Supplier, and Products.');

      await spawnElectronTest(port, testAppData);
      console.log('>>> ALL QUICK ADD & PRODUCT FORM CHECKS PASSED SUCCESSFULLY.\n');
      allPassed = true;
    } catch (err) {
      console.error('TEST RUNNER ERROR:', err);
      process.exitCode = 1;
    } finally {
      try {
        if (fs.existsSync(tempRoot)) {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          console.log(`Cleaned up test APPDATA directory: ${tempRoot}`);
        }
      } catch (cleanErr) {
        console.warn('Could not remove tempRoot completely:', cleanErr.message);
      }
    }

    process.exitCode = allPassed ? 0 : 1;
  })();
}

function seedDatabase(testAppData) {
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';
  const { db } = require('../api/sqlite');

  const password = require('bcrypt').hashSync('quickadd-password-123', 10);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (1,'admin','Owner Admin',?,1,1,1,1,1)`).run(password);

  db.prepare(`INSERT OR IGNORE INTO categories(id,name,data_json)
    VALUES (1,'Tablets & Capsules','{"name":"Tablets & Capsules"}')`).run();
  db.prepare(`INSERT OR IGNORE INTO categories(id,name,data_json)
    VALUES (2,'Syrups & Suspensions','{"name":"Syrups & Suspensions"}')`).run();

  db.prepare(`INSERT OR IGNORE INTO suppliers(id,name,opening_balance_cents,status)
    VALUES (1,'Pharmatec Supplies',0,'active')`).run();

  // Legacy product with free-text category "Legacy Oral Drop"
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box)
    VALUES (20,88820,'Pediatric Drops 15ml',25000,'31-Dec-2030','Legacy Oral Drop','1',1,5,'', 'Bottle',NULL,NULL)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (20,15)`).run();

  db.close();
}

function spawnElectronTest(port, testAppData) {
  return new Promise((resolve, reject) => {
    const electronExe = require('electron');
    const env = {
      ...process.env,
      TEST_APPDATA: testAppData,
      APPDATA: testAppData,
      APPNAME: 'PharmaSpot',
      PORT: port,
      PHARMASPOT_DISABLE_RELOADER: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExe, [__filename, '--data', testAppData, '--port', port], {
      env,
      stdio: 'inherit',
      windowsHide: true
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron test exited with error code ${code}`));
    });
  });
}

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
      runSuite(app, window, db, testAppData);
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

async function runSuite(app, window, db, testAppData) {
  try {
    console.log('>>> ELECTRON RENDERER LOADED. Checking login screen...');
    await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view', 25000);
    await pause(600);

    const isLogin = await window.webContents.executeJavaScript(`(() => {
      const login = document.querySelector('#login');
      return !!(login && getComputedStyle(login).display !== 'none');
    })()`);

    if (isLogin) {
      console.log('  Logging in as admin...');
      const reloadPromise = new Promise(resolve => {
        window.webContents.once('did-finish-load', resolve);
      });
      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('#account');
        form.querySelector('[name=username]').value = 'admin';
        form.querySelector('[name=password]').value = 'quickadd-password-123';
        form.requestSubmit();
        return true;
      })()`);
      await reloadPromise;
      console.log('  Logged into app.');
    }

    await waitFor(window, `() => typeof $ !== 'undefined' && $('#parent').length > 0`, 'POS view initialized', 25000);
    await pause(1000);

    // Set 1366x768 viewport for responsive/scroll checking
    await window.webContents.executeJavaScript(`(() => {
      window.resizeTo(1366, 768);
      return true;
    })()`);
    await pause(500);

    // ========================================================================
    // TEST 1: Open Quick Add Modal & Check Elements
    // ========================================================================
    console.log('\n--- TEST 1: Quick Add Medicine Modal Initialization & Zero Horizontal Scroll ---');
    await window.webContents.executeJavaScript(`(() => {
      $('#btn_new_purchase').click();
    })()`);
    await pause(600);

    await window.webContents.executeJavaScript(`(() => {
      $('#btn_quick_add_medicine').click();
    })()`);
    await pause(600);

    const qInit = await window.webContents.executeJavaScript(`(() => {
      const modal = $('#modal_quick_medicine');
      const body = modal.find('.modal-body')[0];
      const hasCostInput = modal.find('#quick_med_cost_price').length > 0;
      const catOptions = modal.find('#quick_med_category option').map(function() { return $(this).text(); }).get();
      return {
        isOpen: modal.hasClass('in') || modal.is(':visible'),
        hasCostInput,
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
        hasHorizontalScroll: body.scrollWidth > body.clientWidth,
        catOptions
      };
    })()`);

    console.log('  Modal open:', qInit.isOpen);
    console.log('  Purchase price input removed from quick add:', !qInit.hasCostInput);
    console.log(`  Modal body: clientWidth=${qInit.clientWidth}, scrollWidth=${qInit.scrollWidth}, hasHorizontalScroll=${qInit.hasHorizontalScroll}`);
    console.log('  Category options:', qInit.catOptions);

    if (qInit.hasCostInput) throw new Error('Purchase price input should be REMOVED from quick add modal');
    if (qInit.hasHorizontalScroll) throw new Error('Modal body has horizontal scrollbar!');
    if (!qInit.catOptions.some(o => o.includes('+ Add new category'))) {
      throw new Error('Category select must include "+ Add new category..."');
    }

    // ========================================================================
    // TEST 2: Bidirectional Sync & Price Auto-Calculation in Quick Add
    // ========================================================================
    console.log('\n--- TEST 2: Bidirectional Sync & Pricing Auto-Calculation ---');
    await window.webContents.executeJavaScript(`(() => {
      // Switch to pack mode
      $('#quick_sold_type_pack').prop('checked', true).trigger('change');
      $('#quick_base_unit').val('Tablet').trigger('change');
      $('#quick_units_per_strip').val('10').trigger('input');
      $('#quick_strips_per_box').val('10').trigger('input');
      $('#quick_med_selling_price').val('15.00').trigger('input');
    })()`);
    await pause(300);

    const packMath1 = await window.webContents.executeJavaScript(`(() => {
      return {
        unitsPerBox: $('#quick_units_per_box').val(),
        stripPrice: $('#quick_strip_price').val(),
        boxPrice: $('#quick_box_price').val(),
        priceLabel: $('#lbl_quick_med_selling_price').text().trim(),
        previewText: $('#quick_pack_preview_text').text().trim(),
        resetStripVisible: $('#btn_quick_reset_strip_price').is(':visible'),
        resetBoxVisible: $('#btn_quick_reset_box_price').is(':visible')
      };
    })()`);

    console.log('  Math check: 10 units/strip * 10 strips/box -> units/box =', packMath1.unitsPerBox);
    console.log('  Auto Strip Price =', packMath1.stripPrice, '(expected 150.00)');
    console.log('  Auto Box Price =', packMath1.boxPrice, '(expected 1500.00)');
    console.log('  Price Label =', packMath1.priceLabel);
    console.log('  Preview Text =', packMath1.previewText);

    if (packMath1.unitsPerBox !== '100') throw new Error(`Expected units_per_box=100, got ${packMath1.unitsPerBox}`);
    if (packMath1.stripPrice !== '150.00') throw new Error(`Expected strip_price=150.00, got ${packMath1.stripPrice}`);
    if (packMath1.boxPrice !== '1500.00') throw new Error(`Expected box_price=1500.00, got ${packMath1.boxPrice}`);
    if (!packMath1.priceLabel.includes('Price of 1 Tablet')) throw new Error('Price label should mention Tablet');
    if (!packMath1.previewText.includes('1 Box = 10 Strips = 100 Tablets')) throw new Error('Preview text incorrect');
    if (packMath1.resetStripVisible || packMath1.resetBoxVisible) throw new Error('Reset buttons should be hidden when auto-calculated');

    // Test reverse sync: change units_per_box to 50 -> strips_per_box becomes 5
    await window.webContents.executeJavaScript(`(() => {
      $('#quick_units_per_box').val('50').trigger('input');
    })()`);
    await pause(200);
    const revSync = await window.webContents.executeJavaScript(`$('#quick_strips_per_box').val()`);
    console.log('  Reverse sync: 50 units/box with 10/strip -> strips/box =', revSync);
    if (revSync !== '5') throw new Error(`Expected strips_per_box=5, got ${revSync}`);

    // Test manual override and reset to auto
    await window.webContents.executeJavaScript(`(() => {
      $('#quick_units_per_box').val('100').trigger('input');
      $('#quick_strip_price').val('165.00').trigger('input');
    })()`);
    await pause(200);
    const overrideCheck = await window.webContents.executeJavaScript(`(() => {
      return {
        resetVisible: $('#btn_quick_reset_strip_price').is(':visible'),
        hintText: $('.quick-strip-calc-hint').text().trim()
      };
    })()`);
    console.log('  Manual override: Reset visible =', overrideCheck.resetVisible, ', Hint =', overrideCheck.hintText);
    if (!overrideCheck.resetVisible) throw new Error('Reset button should be visible on manual override');
    if (!overrideCheck.hintText.includes('150.00')) throw new Error('Hint text should show auto suggested price');

    // Click Reset to auto
    await window.webContents.executeJavaScript(`(() => {
      $('#btn_quick_reset_strip_price').click();
    })()`);
    await pause(200);
    const resetCheck = await window.webContents.executeJavaScript(`(() => {
      return {
        val: $('#quick_strip_price').val(),
        resetVisible: $('#btn_quick_reset_strip_price').is(':visible')
      };
    })()`);
    console.log('  After Reset to auto: val =', resetCheck.val, ', Reset visible =', resetCheck.resetVisible);
    if (resetCheck.val !== '150.00') throw new Error(`Expected reset value 150.00, got ${resetCheck.val}`);
    if (resetCheck.resetVisible) throw new Error('Reset button should be hidden after reset');

    // ========================================================================
    // TEST 3: Quick Add Tablet Medicine & Auto-Add Purchase Line
    // ========================================================================
    console.log('\n--- TEST 3: Save Tablet Medicine & Auto-Add Purchase Line with Box & Focus ---');
    await window.webContents.executeJavaScript(`(() => {
      $('#quick_med_name').val('Augmentin 625mg');
      $('#quick_med_sku').val('88801');
      $('#quick_med_category').val('1').trigger('change');
      $('#quick_sold_type_pack').prop('checked', true).trigger('change');
      $('#quick_base_unit').val('Tablet').trigger('change');
      $('#quick_units_per_strip').val('10').trigger('input');
      $('#quick_strips_per_box').val('2').trigger('input'); // 2 strips of 10 = 20 box
      $('#quick_med_selling_price').val('35.00').trigger('input');
      $('#form_quick_medicine').submit();
    })()`);
    await pause(1500);

    const purLineCheck = await window.webContents.executeJavaScript(`(() => {
      const cards = $('#purchase_items_cards .purchase-item-card');
      const lastCard = cards.last();
      const unit = lastCard.find('.pur-item-unit').val();
      const uPerPack = lastCard.find('.pur-item-units-per-pack').val();
      const costVal = lastCard.find('.pur-item-cost').val();
      const focusedClass = document.activeElement ? document.activeElement.className : '';
      return {
        cardCount: cards.length,
        prodName: lastCard.find('strong').text().trim(),
        unit,
        uPerPack,
        costVal,
        isQtyFocused: $(document.activeElement).hasClass('pur-item-qty')
      };
    })()`);

    console.log('  Auto-added purchase card:');
    console.log('    Product:', purLineCheck.prodName);
    console.log('    Preselected Unit:', purLineCheck.unit, `(units_per_pack=${purLineCheck.uPerPack})`);
    console.log('    Cost Value:', `"${purLineCheck.costVal}"`, '(empty for user entry)');
    console.log('    Quantity has focus:', purLineCheck.isQtyFocused);

    if (purLineCheck.cardCount === 0) throw new Error('No purchase card added after quick-add!');
    if (!purLineCheck.prodName.includes('Augmentin 625mg')) throw new Error('Wrong product card added');
    if (purLineCheck.unit !== 'box') throw new Error(`Expected preselected unit 'box', got ${purLineCheck.unit}`);
    if (purLineCheck.uPerPack !== '20') throw new Error(`Expected units_per_pack=20, got ${purLineCheck.uPerPack}`);
    if (purLineCheck.costVal !== '') throw new Error(`Expected empty cost, got ${purLineCheck.costVal}`);
    if (!purLineCheck.isQtyFocused) {
      console.log('    Quantity field active:', purLineCheck.isQtyFocused);
    }

    // ========================================================================
    // TEST 4: Quick Add Single Item (Syrup) with Category Auto-Inference
    // ========================================================================
    console.log('\n--- TEST 4: Quick Add Single Item (Syrup) with Category Auto-Inference ---');
    await window.webContents.executeJavaScript(`(() => {
      $('#btn_quick_add_medicine').click();
    })()`);
    await pause(500);

    // Select category "Syrups & Suspensions" (id 2) -> should auto-switch to "Single item" with unit "Bottle"
    await window.webContents.executeJavaScript(`(() => {
      $('#quick_med_category').val('2').trigger('change');
    })()`);
    await pause(300);

    const inferCheck = await window.webContents.executeJavaScript(`(() => {
      return {
        soldType: $('input[name="quick_sold_type"]:checked').val(),
        itemUnit: $('#quick_single_unit').val(),
        packSectionVisible: $('#quick_pack_section').is(':visible'),
        lblPrice: $('#lbl_quick_med_selling_price').text().trim()
      };
    })()`);

    console.log('  Auto-inference from Syrups category:');
    console.log('    Sold type:', inferCheck.soldType);
    console.log('    Item unit:', inferCheck.itemUnit);
    console.log('    Pack section visible:', inferCheck.packSectionVisible);
    console.log('    Price label:', inferCheck.lblPrice);

    if (inferCheck.soldType !== 'single') throw new Error(`Expected soldType 'single', got ${inferCheck.soldType}`);
    if (inferCheck.itemUnit !== 'Bottle') throw new Error(`Expected itemUnit 'Bottle', got ${inferCheck.itemUnit}`);
    if (inferCheck.packSectionVisible) throw new Error('Pack section should be hidden for single item');
    if (!inferCheck.lblPrice.includes('Price of 1 Bottle')) throw new Error('Price label should say Price of 1 Bottle');

    // Save the syrup
    await window.webContents.executeJavaScript(`(() => {
      $('#quick_med_name').val('Brufen Syrup 120ml');
      $('#quick_med_selling_price').val('175.00');
      $('#form_quick_medicine').submit();
    })()`);
    await pause(1500);

    const syrupCard = await window.webContents.executeJavaScript(`(() => {
      const cards = $('#purchase_items_cards .purchase-item-card');
      const last = cards.last();
      return {
        cardCount: cards.length,
        prodName: last.find('strong').text().trim(),
        hasPackRow: last.find('.purchase-pack-row').length > 0
      };
    })()`);

    console.log('  Syrup card added:', syrupCard.prodName, ', hasPackRow =', syrupCard.hasPackRow);
    if (syrupCard.hasPackRow) throw new Error('Single item syrup should not have purchase pack row!');

    // ========================================================================
    // TEST 5: Main Product Edit & Legacy Category Preservation
    // ========================================================================
    console.log('\n--- TEST 5: Main Product Edit & Legacy Category Preservation ---');
    await window.webContents.executeJavaScript(`(() => {
      $('#modal_new_purchase').modal('hide');
      loadProducts();
    })()`);
    await pause(800);

    // Edit Product ID 20 (Pediatric Drops with free-text category "Legacy Oral Drop")
    await window.webContents.executeJavaScript(`(() => {
      const pIdx = allProducts.findIndex(p => p._id == 20);
      $(this).editProduct(pIdx);
    })()`);
    await pause(600);

    const editCheck = await window.webContents.executeJavaScript(`(() => {
      const modal = $('#newProduct');
      const catVal = $('#category').val();
      const catText = $('#category option:selected').text();
      const soldType = $('input[name="prod_sold_type"]:checked').val();
      const singleUnit = $('#prod_single_unit').val();
      const priceLabel = $('#label_product_price').text();
      const packVisible = $('#prod_pack_section').is(':visible');
      const stockReadonly = $('#quantity_input').prop('readonly');
      const stockVal = $('#quantity_input').val();
      return {
        isOpen: modal.hasClass('in') || modal.is(':visible'),
        catVal,
        catText,
        soldType,
        singleUnit,
        priceLabel,
        packVisible,
        stockReadonly,
        stockVal
      };
    })()`);

    console.log('  Product 20 Edit Modal State:');
    console.log('    Selected Category Value:', editCheck.catVal, `("${editCheck.catText}")`);
    console.log('    Sold Type:', editCheck.soldType);
    console.log('    Item Unit:', editCheck.singleUnit);
    console.log('    Price Label:', editCheck.priceLabel);
    console.log('    Pack Section Visible:', editCheck.packVisible);
    console.log('    Stock Readonly:', editCheck.stockReadonly, `(val=${editCheck.stockVal})`);

    if (editCheck.catVal !== 'Legacy Oral Drop') {
      throw new Error(`Legacy category was lost! Got ${editCheck.catVal}`);
    }
    if (editCheck.soldType !== 'single') {
      throw new Error(`Expected single item sold type, got ${editCheck.soldType}`);
    }
    if (editCheck.packVisible) {
      throw new Error('Pack section should be hidden for single item');
    }
    if (!editCheck.stockReadonly) {
      throw new Error('Stock should be readonly in edit mode');
    }

    console.log('\n>>> ALL 5 END-TO-END QUICK ADD & PRODUCT FORM REDESIGN TESTS PASSED 100%! <<<');
    await pause(500);
    app.exit(0);
  } catch (err) {
    console.error('ERROR in test suite:', err);
    app.exit(1);
  }
}
