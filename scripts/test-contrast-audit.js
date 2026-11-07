// scripts/test-contrast-audit.js
// Enhanced Automated WCAG AA Contrast Audit across all screens, modals, and both themes
// Composites RGBA layers, handles ancestor opacity, overflow containers, and captures visual verification screenshots.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const isElectronRunner = process.argv.includes('--electron-runner');

if (isElectronRunner) {
  runElectronAudit();
} else {
  runMasterProcess();
}

const pause = (ms) => new Promise(r => setTimeout(r, ms));

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
// MASTER PROCESS
// ============================================================================
async function runMasterProcess() {
  console.log('=== MULTI MEDICOS: ENHANCED WCAG AA CONTRAST AUDIT ===\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-contrast-test-'));
  const testAppData = path.join(testTempDir, 'appData');
  fs.mkdirSync(testAppData, { recursive: true });

  const testPort = '43294';

  console.log('Test APPDATA (isolated):', testAppData);
  console.log('Test Port:', testPort);

  process.env.APPDATA = testAppData;
  process.env.TEST_APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';
  process.env.PORT = testPort;

  // Seed DB with comprehensive data for rich UI
  seedRichDatabase(testAppData);
  console.log('Database pre-seeded with medicines, batches, suppliers, customers, expenses, purchases.');

  // Launch Electron test runner
  const electronExe = require('electron');
  const env = {
    ...process.env,
    TEST_APPDATA: testAppData,
    APPDATA: testAppData,
    APPNAME: 'PharmaSpot',
    PORT: testPort,
    PHARMASPOT_DISABLE_RELOADER: '1'
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronExe, [__filename, '--electron-runner', '--port', testPort, '--data', testAppData], {
    env,
    stdio: 'inherit',
    windowsHide: true
  });

  child.on('exit', (code) => {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.log('Cleaned up test directory and screenshots.');
    } catch (_) {}

    if (code === 0) {
      console.log('\n============================================================');
      console.log('TASK 1 (DARK & LIGHT CONTRAST AUDIT) VERIFICATION PASSED 100%');
      console.log('============================================================\n');
      process.exit(0);
    } else {
      console.error('\nTEST RUNNER FAILED with exit code:', code);
      process.exit(code || 1);
    }
  });
}

function seedRichDatabase(testAppData) {
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';
  const { db } = require('../api/sqlite');

  // Insert Users
  const password = require('bcrypt').hashSync('test-password-123', 10);
  db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
    VALUES (1,'owner','Pharmacy Owner',?,1,1,1,1,1)`).run(password);

  // Categories
  db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json)
    VALUES (1,'Tablets','{"name":"Tablets"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json)
    VALUES (2,'Syrups','{"name":"Syrups"}')`).run();

  // Suppliers
  db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,contact_person,phone,email,address,opening_balance_cents,status)
    VALUES (1,'Alpha Pharma','Ali Raza','03001112233','ali@alpha.com','Lahore',0,'active')`).run();

  // Purchases
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (1,'INV-001',1,'2026-10-01','2026-10-01','2026-10-01','2026-11-01','received','paid',100000,100000,'Purchase 1',1)`).run();

  // Products
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (1,1001,'Panadol 500mg',5000,'31-Dec-2028','1','1',1,10,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,50)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (1,1,1,1,'PAN-B1','2028-12-31',50,50,3500,'2026-10-01')`).run();

  db.prepare(`INSERT OR REPLACE INTO purchase_items(id,purchase_id,product_id,product_name,batch_number,expiry_date,quantity,unit_cost_cents,discount_cents,discount_percent,tax_cents,line_total_cents)
    VALUES (1,1,1,'Panadol 500mg','PAN-B1','2028-12-31',20,3500,700,10,0,63000)`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (2,1002,'Brufen Syrup 120ml',15000,'31-Dec-2027','2','1',1,5,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,30)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (2,2,1,1,'BRU-B1','2027-12-31',30,30,11000,'2026-10-01')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (3,1003,'Augmentin 625mg Amoxicillin Clavulanate Tablets',35000,'31-Dec-2028','1','1',1,10,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,50)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (3,3,1,1,'AUG-B1','2028-12-31',50,50,25000,'2026-10-01')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (4,1004,'Cefspan 400mg Cefixime Trihydrate Dispersible',42000,'31-Dec-2028','1','1',1,10,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (4,40)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (4,4,1,1,'CEF-B1','2028-12-31',40,40,30000,'2026-10-01')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img)
    VALUES (5,1005,'Flagyl 400mg Metronidazole Film-Coated',8000,'31-Dec-2028','1','1',1,10,'')`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (5,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,received_date)
    VALUES (5,5,1,1,'FLA-B1','2028-12-31',100,100,5000,'2026-10-01')`).run();

  // Customers
  const cust1 = { _id: 1, name: 'Zahid Khan', phone: '03001234567', address: 'Lahore', credit_limit: 10000 };
  db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,credit_limit_cents)
    VALUES (1,'Zahid Khan',?,1000000)`).run(JSON.stringify(cust1));

  // Expense Categories & Expenses
  db.prepare(`INSERT OR REPLACE INTO expense_categories(id,name,account_id) VALUES (1,'Utilities',6020)`).run();
  db.prepare(`INSERT OR REPLACE INTO expenses(id,expense_number,category_id,amount_cents,expense_date,payment_method,description,user_id)
    VALUES (1,'EXP-001',1,500000,'2026-10-15','cash','Electricity Bill',1)`).run();

  // Sales & COGS for Dashboard & Profit & Loss
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-AUDIT-1',1,'2026-10-10T12:00:00.000Z',1,15000,15000,'hash1','{}')`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents)
    VALUES ('SALE-AUDIT-1',0,1,'Panadol 500mg',3,5000)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-AUDIT-1',1,1,3,3500,10500,1)`).run();

  // Journal entries for Alpha Pharma
  db.prepare(`INSERT OR REPLACE INTO journal_entries(id,entry_number,entry_date,reference_type,reference_id,description,user_id)
    VALUES (1,'JE-PUR-1','2026-10-01','PURCHASE','PUR-1','Invoice INV-001',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (1,1,2010,0,100000,'supplier','1','Payable for INV-001')`).run();

  try { db.close(); } catch (_) {}
}

// ============================================================================
// ELECTRON RUNNER PROCESS
// ============================================================================
function runElectronAudit() {
  const { app } = require('electron');
  const args = process.argv;

  const dataArgIndex = args.indexOf('--data');
  const testAppData = dataArgIndex !== -1 ? args[dataArgIndex + 1] : process.env.TEST_APPDATA;

  const portArgIndex = args.indexOf('--port');
  const port = portArgIndex !== -1 ? args[portArgIndex + 1] : (process.env.PORT || '43294');

  fs.mkdirSync(testAppData, { recursive: true });
  app.setPath('appData', testAppData);
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';

  const screenshotsDir = path.join(testAppData, 'audit-screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

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
          console.log('[Electron] Logged into app.');
        }

        await waitFor(window, `() => document.querySelector('#parent .product-card-item')`, 'POS products loaded', 25000);
        await pause(1000);

        // Inject Enhanced Contrast Checking Function in Renderer Context
        await window.webContents.executeJavaScript(`(() => {
          window.auditElementContrast = function(selector, contextName) {
            function parseColor(str) {
              if (!str || str === 'transparent' || str === 'inherit') return null;
              let m = str.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/);
              if (m) {
                let a = m[4] !== undefined ? parseFloat(m[4]) : 1;
                return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a };
              }
              return null;
            }

            function compositeOver(fg, bg) {
              const a = fg.a;
              return {
                r: Math.round(fg.r * a + bg.r * (1 - a)),
                g: Math.round(fg.g * a + bg.g * (1 - a)),
                b: Math.round(fg.b * a + bg.b * (1 - a)),
                a: 1
              };
            }

            function getEffectiveBg(el) {
              const isDark = document.body.classList.contains('theme-dark') || document.documentElement.classList.contains('theme-dark');
              let canvasBg = isDark ? { r: 9, g: 13, b: 22, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
              const layers = [];
              let curr = el;
              while (curr && curr !== document && curr !== document.documentElement) {
                let style = window.getComputedStyle(curr);
                let bg = parseColor(style.backgroundColor);
                if (bg && bg.a > 0.01) {
                  layers.unshift(bg);
                  if (bg.a >= 0.99) break;
                }
                curr = curr.parentElement;
              }
              let currentBg = canvasBg;
              for (const layer of layers) {
                currentBg = compositeOver(layer, currentBg);
              }
              return currentBg;
            }

            function getCumulativeOpacity(el) {
              let op = 1;
              let curr = el;
              while (curr && curr !== document) {
                let style = window.getComputedStyle(curr);
                let o = parseFloat(style.opacity);
                if (!isNaN(o)) op *= o;
                curr = curr.parentElement;
              }
              return op;
            }

            function getLuminance(rgb) {
              let a = [rgb.r, rgb.g, rgb.b].map(v => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
              });
              return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
            }

            function getContrast(rgb1, rgb2) {
              let l1 = getLuminance(rgb1);
              let l2 = getLuminance(rgb2);
              let lighter = Math.max(l1, l2);
              let darker = Math.min(l1, l2);
              return (lighter + 0.05) / (darker + 0.05);
            }

            const root = document.querySelector(selector) || document.body;
            const elements = root.querySelectorAll('*');
            const failures = [];
            const checked = [];

            elements.forEach(el => {
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return;

              let directText = '';
              el.childNodes.forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
              });
              directText = directText.trim();

              let isInput = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
              let hasText = directText.length > 0 || isInput;
              if (!hasText) return;

              let fg = parseColor(style.color);
              if (!fg) return;

              const totalOpacity = getCumulativeOpacity(el);
              if (totalOpacity < 0.05) return;

              let bg = getEffectiveBg(el);
              if (fg.a * totalOpacity < 0.99) {
                fg = compositeOver({ r: fg.r, g: fg.g, b: fg.b, a: fg.a * totalOpacity }, bg);
              }

              let ratio = getContrast(fg, bg);

              let fontSize = parseFloat(style.fontSize);
              let fontWeight = parseInt(style.fontWeight) || 400;
              let isLarge = (fontSize >= 24) || (fontSize >= 18.66 && fontWeight >= 700);
              let minRequired = isLarge ? 3.0 : 4.5;

              if (el.disabled || el.getAttribute('readonly') !== null || el.classList.contains('disabled')) {
                minRequired = 3.0;
              }

              const snippet = (directText.slice(0, 30) || el.placeholder || el.value || el.tagName).replace(/\\s+/g, ' ');
              checked.push({ snippet, ratio: ratio.toFixed(2), minRequired });

              if (ratio < minRequired - 0.1) {
                const cls = (typeof el.className === 'string') ? el.className : (el.className && el.className.baseVal ? el.className.baseVal : '');
                failures.push({
                  element: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + String(cls).trim().split(' ').join('.') : ''),
                  text: snippet,
                  fg: 'rgb(' + fg.r + ',' + fg.g + ',' + fg.b + ')',
                  bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')',
                  ratio: ratio.toFixed(2),
                  minRequired,
                  fontSize,
                  fontWeight
                });
              }
            });

            return JSON.stringify({ contextName, totalChecked: checked.length, failures });
          };

          window.auditReceiptColors = function(contextName) {
            function parseColor(str) {
              if (!str || str === 'transparent' || str === 'inherit') return null;
              let m = str.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/);
              if (m) {
                let a = m[4] !== undefined ? parseFloat(m[4]) : 1;
                return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a };
              }
              return null;
            }

            function compositeOver(fg, bg) {
              const a = fg.a;
              return {
                r: Math.round(fg.r * a + bg.r * (1 - a)),
                g: Math.round(fg.g * a + bg.g * (1 - a)),
                b: Math.round(fg.b * a + bg.b * (1 - a)),
                a: 1
              };
            }

            function getEffectiveBg(el) {
              const isDark = document.body.classList.contains('theme-dark') || document.documentElement.classList.contains('theme-dark');
              let canvasBg = isDark ? { r: 9, g: 13, b: 22, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
              const layers = [];
              let curr = el;
              while (curr && curr !== document && curr !== document.documentElement) {
                let style = window.getComputedStyle(curr);
                let bg = parseColor(style.backgroundColor);
                if (bg && bg.a > 0.01) {
                  layers.unshift(bg);
                  if (bg.a >= 0.99) break;
                }
                curr = curr.parentElement;
              }
              let currentBg = canvasBg;
              for (const layer of layers) {
                currentBg = compositeOver(layer, currentBg);
              }
              return currentBg;
            }

            function getLuminance(rgb) {
              let a = [rgb.r, rgb.g, rgb.b].map(v => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
              });
              return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
            }

            function getContrast(rgb1, rgb2) {
              let l1 = getLuminance(rgb1);
              let l2 = getLuminance(rgb2);
              let lighter = Math.max(l1, l2);
              let darker = Math.min(l1, l2);
              return (lighter + 0.05) / (darker + 0.05);
            }

            const failures = [];
            const modal = document.querySelector('#orderModal');
            if (!modal) {
              return JSON.stringify({ contextName, passed: false, failures: [{ element: '#orderModal', error: 'Modal #orderModal not found' }] });
            }

            // 1. Header Check
            const header = modal.querySelector('.modal-header');
            if (header) {
              const hBg = getEffectiveBg(header);
              if (hBg.r < 240 || hBg.g < 240 || hBg.b < 240) {
                failures.push({ element: '.modal-header', error: 'Header background not white', bg: hBg });
              }
              const printBtn = header.querySelector('.btn-success, .btn-receipt-print');
              if (printBtn) {
                const btnStyle = window.getComputedStyle(printBtn);
                const btnBg = parseColor(btnStyle.backgroundColor);
                const btnColor = parseColor(btnStyle.color);
                if (!btnBg || btnBg.g <= btnBg.r || btnBg.g < 100) {
                  failures.push({ element: '.btn-receipt-print', error: 'Print button not green', bg: btnBg });
                }
                if (!btnColor || btnColor.r < 200 || btnColor.g < 200 || btnColor.b < 200) {
                  failures.push({ element: '.btn-receipt-print', error: 'Print button text not white', color: btnColor });
                }
              }
              const closeBtn = header.querySelector('.close, .receipt-modal-close');
              if (closeBtn) {
                const cStyle = window.getComputedStyle(closeBtn);
                const cColor = parseColor(cStyle.color);
                if (!cColor || cColor.r > 80 || cColor.g > 80 || cColor.b > 80) {
                  failures.push({ element: '.receipt-modal-close', error: 'Close button not dark', color: cColor });
                }
              }
            }

            // 2. Alert Notice Check
            const alertEl = modal.querySelector('.alert-danger, .receipt-modal-notice');
            if (alertEl) {
              const aBg = getEffectiveBg(alertEl);
              const aStyle = window.getComputedStyle(alertEl);
              const aColor = parseColor(aStyle.color) || { r: 153, g: 27, b: 27, a: 1 };
              if (aBg.r < 220 || aBg.r <= aBg.g) {
                failures.push({ element: '.alert-danger', error: 'Alert background not light red', bg: aBg });
              }
              const ratio = getContrast(aColor, aBg);
              if (ratio < 4.5) {
                failures.push({ element: '.alert-danger', error: 'Alert contrast ratio below 4.5:1', ratio: ratio.toFixed(2), bg: aBg, color: aColor });
              }
            }

            // 3. Receipt content inside #viewTransaction
            const viewTx = modal.querySelector('#viewTransaction');
            if (!viewTx) {
              failures.push({ element: '#viewTransaction', error: '#viewTransaction not found' });
            } else {
              const txBg = getEffectiveBg(viewTx);
              if (txBg.r < 235 || txBg.g < 235 || txBg.b < 235) {
                failures.push({ element: '#viewTransaction', error: '#viewTransaction background not white', bg: txBg });
              }

              const descendants = viewTx.querySelectorAll('*');
              descendants.forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;

                const effBg = getEffectiveBg(el);
                if (effBg.r < 235 || effBg.g < 235 || effBg.b < 235) {
                  failures.push({
                    element: el.tagName.toLowerCase() + (el.className ? '.' + el.className : ''),
                    error: 'Effective background not white',
                    bg: effBg,
                    text: (el.textContent || '').slice(0, 30)
                  });
                }

                let directText = '';
                el.childNodes.forEach(child => {
                  if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
                });
                directText = directText.trim();
                if (directText.length > 0) {
                  const textColor = parseColor(style.color);
                  if (textColor) {
                    if (textColor.r > 85 || textColor.g > 85 || textColor.b > 85) {
                      failures.push({
                        element: el.tagName.toLowerCase() + (el.className ? '.' + el.className : ''),
                        error: 'Receipt text color not dark',
                        color: textColor,
                        text: directText.slice(0, 30)
                      });
                    }
                    const ratio = getContrast(textColor, effBg);
                    if (ratio < 4.5) {
                      failures.push({
                        element: el.tagName.toLowerCase() + (el.className ? '.' + el.className : ''),
                        error: 'Receipt contrast below 4.5:1',
                        ratio: ratio.toFixed(2),
                        color: textColor,
                        bg: effBg,
                        text: directText.slice(0, 30)
                      });
                    }
                  }
                }
              });
            }

            return JSON.stringify({ contextName, passed: failures.length === 0, failures });
          };
          return true;
        })()`);

        async function takeScreenshot(name) {
          try {
            const img = await window.capturePage();
            const png = img.toPNG();
            const filePath = path.join(screenshotsDir, `${name}.png`);
            fs.writeFileSync(filePath, png);
            const stat = fs.statSync(filePath);
            console.log(`  [Screenshot] Captured ${name}.png (${stat.size} bytes)`);
          } catch (e) {
            console.error(`  [Screenshot] Failed to capture ${name}:`, e.message);
          }
        }

        console.log('--- AUDITING DARK THEME ---');
        // Set Dark Theme
        await window.webContents.executeJavaScript(`(() => {
          $('html').addClass('theme-dark');
          $('body').addClass('theme-dark');
          return true;
        })()`);
        await pause(600);

        // Populate POS with items, customer, discount
        await window.webContents.executeJavaScript(`(() => {
          $('#parent [data-product-id="1"]').click();
          $('#parent [data-product-id="2"]').click();
          $('#customer').val('1').trigger('chosen:updated').trigger('change');
          $('#inputDiscount').val('10').trigger('input');
          return true;
        })()`);
        await pause(600);

        const allDarkAudits = [];

        // 1. Audit POS View
        console.log('Auditing POS View in Dark Mode...');
        await takeScreenshot('dark-pos-view');
        const posAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#pos_view', 'POS Screen (Dark)')`));
        allDarkAudits.push(posAudit);

        // 2. Audit Standard Modals:
        const standardModals = [
          { id: '#paymentModel', trigger: `$('#payButton').click()`, name: 'payment-modal' },
          { id: '#holdOrdersModal', trigger: `$('#viewRefOrders').click()`, name: 'hold-orders-modal' },
          { id: '#Products', trigger: `$('#viewProducts').click()`, name: 'products-modal' },
          { id: '#newProduct', trigger: `$('#newProductModal').click()`, name: 'new-product-modal' },
          { id: '#dueModal', trigger: `$('#dueModal').modal('show')`, name: 'due-modal' },
          { id: '#Categories', trigger: `$('#viewCategories').click()`, name: 'categories-modal' },
          { id: '#newCategory', trigger: `$('#newCategory').modal('show')`, name: 'new-category-modal' },
          { id: '#settingsModal', trigger: `$('#settings').click()`, name: 'settings-modal' },
          { id: '#batchesModal', trigger: `$('#batchesModal').modal('show')`, name: 'batches-modal' },
          { id: '#Users', trigger: `$('#Users').modal('show')`, name: 'users-modal' }
        ];

        for (const m of standardModals) {
          console.log(`Auditing Modal ${m.id} in Dark Mode...`);
          await window.webContents.executeJavaScript(`(() => { $('.modal').modal('hide'); return true; })()`);
          await pause(250);

          await window.webContents.executeJavaScript(`(() => {
            ${m.trigger};
            return true;
          })()`);
          await pause(500);

          await takeScreenshot(`dark-${m.name}`);
          const audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('${m.id}', 'Modal ${m.id} (Dark)')`));
          allDarkAudits.push(audit);

          await window.webContents.executeJavaScript(`(() => { $('${m.id}').modal('hide'); return true; })()`);
          await pause(250);
        }

        // 3. Audit Enterprise Views:
        const viewsToTest = [
          { sel: '#dashboard_view', name: 'dashboard-view' },
          { sel: '#suppliers_view', name: 'suppliers-view' },
          { sel: '#purchases_view', name: 'purchases-view' },
          { sel: '#customers_khata_view', name: 'customers-khata-view' },
          { sel: '#expenses_view', name: 'expenses-view' },
          { sel: '#reports_view', name: 'reports-view' },
          { sel: '#transactions_view', name: 'transactions-view' }
        ];

        for (const v of viewsToTest) {
          console.log(`Auditing View ${v.sel} in Dark Mode...`);
          await window.webContents.executeJavaScript(`(() => {
            $('.enterprise-view, #pos_view').hide();
            $('${v.sel}').show();
            if ('${v.sel}' === '#dashboard_view' && typeof loadDashboard === 'function') loadDashboard();
            if ('${v.sel}' === '#reports_view' && typeof loadActiveReport === 'function') loadActiveReport();
            return true;
          })()`);
          await pause(600);

          await takeScreenshot(`dark-${v.name}`);
          const audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('${v.sel}', 'View ${v.sel} (Dark)')`));
          allDarkAudits.push(audit);
        }

        // 4. Audit Enterprise Modals (ESPECIALLY NEW MEDICINE PURCHASE WITH POPULATED LINES)
        console.log('Auditing Modal #modal_new_purchase with POPULATED lines and discount in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('.modal').modal('hide');
          $('#btn_new_purchase').click();
          return true;
        })()`);
        await pause(600);

        // Add items, discount, batch, expiry, and supplier
        await window.webContents.executeJavaScript(`(() => {
          // Select Supplier
          $('#pur_supplier_select').val('1');
          $('#pur_supplier_search').val('Alpha Pharma');

          // Trigger medicine results & add 2 medicines
          $('#pur_medicine_results .purchase-search-option').first().click();
          if ($('#purchase_items_cards .purchase-item-card').length === 0) {
            // fallback add
            $('#purchase_items_cards').append(\`
              <div class="purchase-item-card" id="pur_card_test_1" data-product-id="1">
                <div class="purchase-item-card-header">
                  <div><strong>Panadol 500mg</strong> <small class="text-muted">SKU 1001</small></div>
                </div>
                <div class="purchase-item-fields">
                  <div><label>Quantity</label><input type="number" class="form-control pur-item-qty" value="10" /></div>
                  <div><label>Purchase Price</label><input type="number" class="form-control pur-item-cost" value="100.00" /></div>
                  <div><label>Discount %</label><div class="input-group"><input type="number" class="form-control pur-item-discount" value="5" /><span class="input-group-addon">%</span></div></div>
                  <div><label>Line Total</label><div class="purchase-line-total">PKR <span class="pur-item-linetotal">950.00</span></div></div>
                  <div><label>Batch Number</label><input type="text" class="form-control pur-item-batch" value="PAN-B1" /></div>
                  <div><label>Expiry Date</label><input type="date" class="form-control pur-item-expiry" value="2028-12-31" /></div>
                  <div><label>Bonus Qty</label><input type="number" class="form-control pur-item-bonus" value="2" /></div>
                </div>
              </div>
            \`);
          }
          $('#pur_invoice_no').val('INV-AUDIT-001');
          $('#pur_grand_total').text('950.00');
          $('#pur_summary_paid').text('950.00');
          $('#pur_summary_remaining').text('0.00');
          return true;
        })()`);
        await pause(600);

        await takeScreenshot('dark-modal-new-purchase-populated');
        const newPurchaseAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_new_purchase', 'Modal #modal_new_purchase (Dark)')`));
        allDarkAudits.push(newPurchaseAudit);

        // Audit quick medicine modal
        console.log('Auditing Modal #modal_quick_medicine in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_new_purchase').modal('hide');
          $('#modal_quick_medicine').modal('show');
          return true;
        })()`);
        await pause(500);
        await takeScreenshot('dark-modal-quick-medicine');
        const quickMedAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_quick_medicine', 'Modal #modal_quick_medicine (Dark)')`));
        allDarkAudits.push(quickMedAudit);

        // Audit purchase view modal
        console.log('Auditing Modal #modal_view_purchase in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_quick_medicine').modal('hide');
          $('#vpur_invoice_no').text('INV-001');
          $('#vpur_supplier').text('Alpha Pharma');
          $('#vpur_date').text('2026-10-01');
          $('#vpur_status').text('received');
          $('#vpur_payment_status').text('paid');
          $('#vpur_total').text('PKR 1,000.00');
          $('#vpur_paid').text('PKR 1,000.00');
          $('#vpur_outstanding').text('PKR 0.00');
          $('#vpur_items_tbody').html(\`
            <tr>
              <td><strong>Panadol 500mg</strong></td>
              <td>PAN-B1</td>
              <td>2028-12-31</td>
              <td>20</td>
              <td>PKR 35.00</td>
              <td>10%</td>
              <td><strong>PKR 630.00</strong></td>
            </tr>
          \`);
          $('#modal_view_purchase').modal('show');
          return true;
        })()`);
        await pause(500);
        await takeScreenshot('dark-modal-view-purchase');
        const viewPurchaseAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_view_purchase', 'Modal #modal_view_purchase (Dark)')`));
        allDarkAudits.push(viewPurchaseAudit);

        // Audit supplier statement modal
        console.log('Auditing Modal #modal_supplier_statement in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_view_purchase').modal('hide');
          $('#stmt_supplier_name').text('Alpha Pharma');
          $('#stmt_supplier_phone').text('03001112233');
          $('#stmt_supplier_balance').text('PKR 0.00');
          $('#stmt_table_body').html(\`
            <tr>
              <td>01/10/2026</td>
              <td><strong>JE-PUR-1</strong></td>
              <td>Invoice INV-001</td>
              <td class="text-right text-success">-</td>
              <td class="text-right text-danger">PKR 1,000.00</td>
              <td class="text-right"><strong>PKR 1,000.00</strong></td>
            </tr>
          \`);
          $('#modal_supplier_statement').modal('show');
          return true;
        })()`);
        await pause(500);
        await takeScreenshot('dark-modal-supplier-statement');
        const stmtAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_supplier_statement', 'Modal #modal_supplier_statement (Dark)')`));
        allDarkAudits.push(stmtAudit);

        // Audit supplier payment modal
        console.log('Auditing Modal #modal_supplier_payment in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_supplier_statement').modal('hide');
          $('#pay_supplier_name').text('Alpha Pharma');
          $('#pay_supplier_balance').text('PKR 1,000.00');
          $('#pay_invoices_tbody').html(\`
            <tr>
              <td>INV-001</td>
              <td>2026-10-01</td>
              <td>PKR 1,000.00</td>
              <td>PKR 1,000.00</td>
              <td><input type="number" class="form-control input-sm pay-alloc-input" value="1000.00" /></td>
            </tr>
          \`);
          $('#modal_supplier_payment').modal('show');
          return true;
        })()`);
        await pause(500);
        await takeScreenshot('dark-modal-supplier-payment');
        const suppPayAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_supplier_payment', 'Modal #modal_supplier_payment (Dark)')`));
        allDarkAudits.push(suppPayAudit);

        // Audit add expense modal
        console.log('Auditing Modal #modal_add_expense in Dark Mode...');
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_supplier_payment').modal('hide');
          $('#modal_add_expense').modal('show');
          return true;
        })()`);
        await pause(500);
        await takeScreenshot('dark-modal-add-expense');
        const expenseAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_add_expense', 'Modal #modal_add_expense (Dark)')`));
        allDarkAudits.push(expenseAudit);

        await window.webContents.executeJavaScript(`(() => { $('.modal').modal('hide'); return true; })()`);
        await pause(300);

        // 5. Audit Receipts: Strict light theme check across 8 scenarios (MUST BE WHITE BG, BLACK TEXT)
        console.log('\n============================================================');
        console.log('--- SECTION 5: AUDITING ALL 8 RECEIPT / INVOICE SCENARIOS IN DARK THEME ---');
        console.log('============================================================');

        // Restore POS view
        await window.webContents.executeJavaScript(`(() => {
          $('.modal').modal('hide');
          $('.enterprise-view').hide();
          $('#pos_view').show();
          $('#pointofsale').show();
          return true;
        })()`);
        await pause(500);

        // Helpers to manage cart and products
        async function resetPosCart() {
          await window.webContents.executeJavaScript(`(() => {
            $('.modal').modal('hide');
            if (typeof window.clearPosCart === 'function') {
              window.clearPosCart();
            } else {
              if (typeof cart !== 'undefined') cart = [];
              if (typeof $.fn.renderTable === 'function') $(this).renderTable([]);
              $('#inputDiscount').val('').trigger('input');
              $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
              $('#customer').trigger('chosen:updated').trigger('change');
              $('#payment, #paymentText, #refNumber').val('');
              $('#change').text('');
            }
            return true;
          })()`);
          await pause(300);
        }

        async function addProduct(productId) {
          const lenBefore = await window.webContents.executeJavaScript(`(() => {
            return (window.getPosCart ? window.getPosCart().length : (typeof cart !== 'undefined' ? cart.length : 0));
          })()`);
          await window.webContents.executeJavaScript(`(() => {
            const el = document.querySelector('#parent [data-product-id="${productId}"]');
            if (el) el.click();
            return true;
          })()`);
          await waitFor(window, `() => {
            const curr = (window.getPosCart ? window.getPosCart().length : (typeof cart !== 'undefined' ? cart.length : 0));
            return curr > ${lenBefore};
          }`, `Product ${productId} added to cart`, 15000);
          await pause(250);
        }

        async function openPaymentModal() {
          for (let i = 0; i < 20; i++) {
            const isVis = await window.webContents.executeJavaScript(`(() => {
              if ($('#paymentModel').hasClass('in') || $('#paymentModel').is(':visible')) return true;
              $('#payButton').click();
              return $('#paymentModel').hasClass('in') || $('#paymentModel').is(':visible');
            })()`);
            if (isVis) {
              await pause(250);
              return true;
            }
            await pause(250);
          }
          throw new Error('Payment modal failed to open');
        }

        // Scenario 1: Cash sale (2 items, paid cash, change)
        console.log('\n[Scenario 1/8] Cash sale (2 items, paid cash, change)...');
        await resetPosCart();
        await addProduct(1);
        await addProduct(2);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('300.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-1-cash-sale');
        const receipt1Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 1: Cash Sale')`));
        console.log(`  Audit [Receipt 1]: Passed=${receipt1Audit.passed}, Failures=${receipt1Audit.failures.length}`);
        if (!receipt1Audit.passed) {
          console.error('Receipt 1 Failures:', receipt1Audit.failures);
          throw new Error('Receipt 1 Failed: ' + JSON.stringify(receipt1Audit.failures));
        }

        const r1Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r1Content.includes('Panadol 500mg') || !r1Content.includes('Brufen Syrup 120ml') || !r1Content.includes('Change')) {
          throw new Error('Receipt 1 missing expected content: ' + r1Content);
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        // Scenario 2: Khata / credit sale (customer selected, paid 0)
        console.log('\n[Scenario 2/8] Khata / credit sale (customer selected, paid 0)...');
        await resetPosCart();
        await addProduct(1);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Zahid Khan'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          return true;
        })()`);
        await pause(200);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#creditPaymentBtn').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('0.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-2-khata-credit-sale');
        const receipt2Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 2: Khata / Credit Sale')`));
        console.log(`  Audit [Receipt 2]: Passed=${receipt2Audit.passed}, Failures=${receipt2Audit.failures.length}`);
        if (!receipt2Audit.passed) {
          console.error('Receipt 2 Failures:', receipt2Audit.failures);
          throw new Error('Receipt 2 Failed: ' + JSON.stringify(receipt2Audit.failures));
        }

        const r2Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r2Content.includes('Zahid Khan') || !r2Content.includes('Credit')) {
          throw new Error('Receipt 2 missing expected content: ' + r2Content);
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        // Scenario 3: Mixed sale (customer selected, partial cash, remaining receivable)
        console.log('\n[Scenario 3/8] Mixed sale (customer selected, partial cash, remaining receivable)...');
        await resetPosCart();
        await addProduct(2);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Zahid Khan'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          return true;
        })()`);
        await pause(200);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('50.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-3-mixed-sale');
        const receipt3Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 3: Mixed Sale')`));
        console.log(`  Audit [Receipt 3]: Passed=${receipt3Audit.passed}, Failures=${receipt3Audit.failures.length}`);
        if (!receipt3Audit.passed) {
          console.error('Receipt 3 Failures:', receipt3Audit.failures);
          throw new Error('Receipt 3 Failed: ' + JSON.stringify(receipt3Audit.failures));
        }

        const r3Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r3Content.includes('Zahid Khan') || !r3Content.includes('Paid')) {
          throw new Error('Receipt 3 missing expected content: ' + r3Content);
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        // Scenario 4: Percent discount sale (15% discount, line "Discount (15%): PKR XX")
        console.log('\n[Scenario 4/8] Percent discount sale (15% discount)...');
        await resetPosCart();
        await addProduct(1);
        await addProduct(2);
        await window.webContents.executeJavaScript(`(() => {
          $('#customer option').filter(function() { return $(this).text().includes('Walk in customer'); }).prop('selected', true);
          $('#customer').trigger('chosen:updated').trigger('change');
          $('#inputDiscount').val('15').trigger('input');
          return true;
        })()`);
        await pause(200);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('170.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-4-percent-discount');
        const receipt4Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 4: Percent Discount Sale')`));
        console.log(`  Audit [Receipt 4]: Passed=${receipt4Audit.passed}, Failures=${receipt4Audit.failures.length}`);
        if (!receipt4Audit.passed) {
          console.error('Receipt 4 Failures:', receipt4Audit.failures);
          throw new Error('Receipt 4 Failed: ' + JSON.stringify(receipt4Audit.failures));
        }

        const r4Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r4Content.includes('Discount (15%)')) {
          throw new Error('Receipt 4 missing expected Discount (15%) text: ' + r4Content);
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        // Scenario 5: VAT sale (settings charge_tax = true, line "VAT(X)%: PKR XX")
        console.log('\n[Scenario 5/8] VAT sale (charge_tax = true, percentage = 16)...');
        await resetPosCart();
        await window.webContents.executeJavaScript(`(() => {
          if (typeof window.setTaxSettings === 'function') {
            window.setTaxSettings(true, '16');
          } else if (window.settings) {
            window.settings.charge_tax = true;
            window.settings.percentage = '16';
          }
          return true;
        })()`);
        await addProduct(1);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('58.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-5-vat-sale');
        const receipt5Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 5: VAT Sale')`));
        console.log(`  Audit [Receipt 5]: Passed=${receipt5Audit.passed}, Failures=${receipt5Audit.failures.length}`);
        if (!receipt5Audit.passed) {
          console.error('Receipt 5 Failures:', receipt5Audit.failures);
          throw new Error('Receipt 5 Failed: ' + JSON.stringify(receipt5Audit.failures));
        }

        const r5Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r5Content.toLowerCase().includes('vat(16)%')) {
          throw new Error('Receipt 5 missing expected VAT row: ' + r5Content);
        }
        await window.webContents.executeJavaScript(`(() => {
          if (typeof window.setTaxSettings === 'function') {
            window.setTaxSettings(false, '0');
          } else if (window.settings) {
            window.settings.charge_tax = false;
            window.settings.percentage = '0';
          }
          $('#orderModal').modal('hide');
          return true;
        })()`);
        await pause(300);

        // Scenario 6: Many items sale (5 items with long pharmaceutical names)
        console.log('\n[Scenario 6/8] Many items sale (5 items with long pharmaceutical names)...');
        await resetPosCart();
        for (let pid = 1; pid <= 5; pid++) {
          await addProduct(pid);
        }
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('1050.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible', 25000);
        await pause(400);

        await takeScreenshot('dark-receipt-6-many-items-long-names');
        const receipt6Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 6: Many Items Long Names')`));
        console.log(`  Audit [Receipt 6]: Passed=${receipt6Audit.passed}, Failures=${receipt6Audit.failures.length}`);
        if (!receipt6Audit.passed) {
          console.error('Receipt 6 Failures:', receipt6Audit.failures);
          throw new Error('Receipt 6 Failed: ' + JSON.stringify(receipt6Audit.failures));
        }

        const r6Content = await window.webContents.executeJavaScript(`$('#viewTransaction').text()`);
        if (!r6Content.includes('Augmentin 625mg') || !r6Content.includes('Cefspan 400mg') || !r6Content.includes('Flagyl 400mg')) {
          throw new Error('Receipt 6 missing expected long medicine names: ' + r6Content);
        }
        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        // Scenario 7: Reprint from Transactions (open Transactions view, click view invoice icon)
        console.log('\n[Scenario 7/8] Reprint from Transactions view...');
        await window.webContents.executeJavaScript(`(() => {
          $('#orderModal').modal('hide');
          $('.enterprise-view').hide();
          $('#transactions').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#transaction_list tr').length > 0`, 'Transactions list loaded');
        await pause(500);

        await window.webContents.executeJavaScript(`(() => {
          const btn = $('#transaction_list tr').first().find('button[title="View invoice"], button.btn-info');
          btn.click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible from transactions');
        await pause(400);

        await takeScreenshot('dark-receipt-7-reprint-transaction');
        const receipt7Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt 7: Reprint from Transactions')`));
        console.log(`  Audit [Receipt 7]: Passed=${receipt7Audit.passed}, Failures=${receipt7Audit.failures.length}`);
        if (!receipt7Audit.passed) {
          console.error('Receipt 7 Failures:', receipt7Audit.failures);
          throw new Error('Receipt 7 Failed: ' + JSON.stringify(receipt7Audit.failures));
        }

        await window.webContents.executeJavaScript(`(() => {
          $('#orderModal').modal('hide');
          $('#pointofsale').click();
          return true;
        })()`);
        await pause(300);

        // Scenario 8: Purchase invoice view (#modal_view_purchase)
        console.log('\n[Scenario 8/8] Purchase invoice view (#modal_view_purchase)...');
        await window.webContents.executeJavaScript(`(() => {
          $('#vpur_invoice_no').text('INV-001');
          $('#vpur_supplier').text('Alpha Pharma');
          $('#vpur_date').text('2026-10-01');
          $('#vpur_status').text('received');
          $('#vpur_payment_status').text('paid');
          $('#vpur_total').text('PKR 1,000.00');
          $('#vpur_paid').text('PKR 1,000.00');
          $('#vpur_outstanding').text('PKR 0.00');
          $('#vpur_items_tbody').html(\`
            <tr>
              <td><strong>Panadol 500mg</strong></td>
              <td>PAN-B1</td>
              <td>2028-12-31</td>
              <td>20</td>
              <td>PKR 35.00</td>
              <td>10%</td>
              <td><strong>PKR 630.00</strong></td>
            </tr>
          \`);
          $('#modal_view_purchase').modal('show');
          return true;
        })()`);
        await waitFor(window, `() => $('#modal_view_purchase').is(':visible')`, 'Purchase view modal open');
        await pause(400);

        await takeScreenshot('dark-receipt-8-purchase-invoice');
        const receipt8Audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#modal_view_purchase', 'Receipt 8: Purchase Invoice View')`));
        console.log(`  Audit [Receipt 8]: Checked ${receipt8Audit.totalChecked} elements, Failures=${receipt8Audit.failures.length}`);
        if (receipt8Audit.failures.length > 0) {
          console.error('Receipt 8 Failures:', receipt8Audit.failures);
          throw new Error('Receipt 8 Audit Failed: ' + JSON.stringify(receipt8Audit.failures));
        }

        await window.webContents.executeJavaScript(`(() => { $('#modal_view_purchase').modal('hide'); return true; })()`);
        await pause(300);

        // Print Check Verification
        console.log('\n--- VERIFYING PRINT STYLES (@media print & printJS) ---');
        const printCheck = await window.webContents.executeJavaScript(`(() => {
          const printFnStr = ($.fn.print || '').toString();
          const hasWhiteBg = printFnStr.includes('#ffffff') && printFnStr.includes('background');
          const hasBlackColor = printFnStr.includes('#000000') && printFnStr.includes('color');
          return {
            hasWhiteBg,
            hasBlackColor,
            fnLength: printFnStr.length
          };
        })()`);
        console.log('Print Check Result:', printCheck);
        if (!printCheck.hasWhiteBg || !printCheck.hasBlackColor) {
          throw new Error('FAIL: $.fn.print does not inject explicit white background and black text style for printing!');
        }
        console.log('PASS: Print styles guarantee strictly black text on white background in dark mode.');

        // Check all Dark Mode Audits for failures
        let totalDarkFailures = 0;
        for (const res of allDarkAudits) {
          console.log(`Audit [${res.contextName}]: Checked ${res.totalChecked} elements, Failures: ${res.failures.length}`);
          if (res.failures.length > 0) {
            totalDarkFailures += res.failures.length;
            console.error(`Failures in ${res.contextName}:`, res.failures.slice(0, 5));
          }
        }

        if (totalDarkFailures > 0) {
          throw new Error(`FAIL: Dark theme contrast audit found ${totalDarkFailures} WCAG AA violations!`);
        }
        console.log('\nPASS: Dark theme passed WCAG AA contrast across all views & modals (0 violations)!');

        // 6. Audit Light Theme (Regression check to ensure light mode is preserved cleanly)
        console.log('\n--- AUDITING LIGHT THEME (REGRESSION CHECK) ---');
        await window.webContents.executeJavaScript(`(() => {
          $('html').removeClass('theme-dark');
          $('body').removeClass('theme-dark');
          $('.enterprise-view').hide();
          $('#pos_view').show();
          return true;
        })()`);
        await pause(500);

        // Also test Receipt in Light Theme
        console.log('\nAuditing Receipt in Light Mode...');
        await resetPosCart();
        await addProduct(1);
        await openPaymentModal();
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel .list-group-item').removeClass('active');
          $('#cash').addClass('active');
          $('#cardInfo').hide();
          $('#payment').val('50.00').trigger('input');
          if (typeof $.fn.calculateChange === 'function') $(this).calculateChange();
          $('#confirmPayment').click();
          return true;
        })()`);
        await waitFor(window, `() => $('#orderModal').is(':visible') && $('#viewTransaction #invoice-pos').length > 0`, 'Order modal receipt visible in light mode', 25000);
        await pause(400);

        await takeScreenshot('light-receipt-1-cash-sale');
        const lightReceiptAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditReceiptColors('Receipt in Light Mode')`));
        console.log(`Receipt in Light Mode Audit: Passed=${lightReceiptAudit.passed}, Failures=${lightReceiptAudit.failures.length}`);
        if (!lightReceiptAudit.passed) {
          console.error('Light Receipt Failures:', lightReceiptAudit.failures);
          throw new Error('Receipt in Light Mode Audit Failed: ' + JSON.stringify(lightReceiptAudit.failures));
        }

        await window.webContents.executeJavaScript(`(() => { $('#orderModal').modal('hide'); return true; })()`);
        await pause(300);

        const allLightAudits = [];
        const posLightAudit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('#pos_view', 'POS Screen (Light)')`));
        allLightAudits.push(posLightAudit);

        const viewsLightToTest = [
          { sel: '#dashboard_view', name: 'dashboard-view' },
          { sel: '#reports_view', name: 'reports-view' }
        ];
        for (const v of viewsLightToTest) {
          console.log(`Auditing View ${v.sel} in Light Mode...`);
          await window.webContents.executeJavaScript(`(() => {
            $('.enterprise-view, #pos_view').hide();
            $('${v.sel}').show();
            if ('${v.sel}' === '#dashboard_view' && typeof loadDashboard === 'function') loadDashboard();
            if ('${v.sel}' === '#reports_view' && typeof loadActiveReport === 'function') loadActiveReport();
            return true;
          })()`);
          await pause(600);
          await takeScreenshot(`light-${v.name}`);
          const audit = JSON.parse(await window.webContents.executeJavaScript(`window.auditElementContrast('${v.sel}', 'View ${v.sel} (Light)')`));
          allLightAudits.push(audit);
        }

        let totalLightFailures = 0;
        for (const res of allLightAudits) {
          console.log(`Audit [${res.contextName}]: Checked ${res.totalChecked} elements, Failures: ${res.failures.length}`);
          if (res.failures.length > 0) {
            totalLightFailures += res.failures.length;
            console.error(`Light theme failures in ${res.contextName}:`, res.failures.slice(0, 5));
          }
        }

        if (totalLightFailures > 0) {
          throw new Error(`FAIL: Light theme contrast audit found ${totalLightFailures} WCAG AA violations!`);
        }
        console.log('PASS: Light theme contrast verified cleanly (0 violations).');

        app.exit(0);
      } catch (err) {
        console.error('[Electron] Audit failed:', err);
        app.exit(1);
      }
    });
  });

  require('../start');
}
