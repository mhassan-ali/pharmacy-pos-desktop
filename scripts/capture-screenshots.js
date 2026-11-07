// scripts/capture-screenshots.js
// Automated high-resolution screenshot generator for Multi Medicos documentation.
// Generates clean PNGs with realistic demo data, isolated TEST_APPDATA, and no UI clutter.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const isElectron = !!process.versions.electron;
const args = process.argv.slice(2);
const isCaptureRun = args.includes('--capture-run');

const pause = (ms) => new Promise(r => setTimeout(r, ms));

if (!isElectron) {
  (async () => {
    console.log('=== MULTI MEDICOS SCREENSHOT CAPTURE PROCESS ===\n');

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmaspot-shots-'));
    const testAppData = path.join(tempRoot, 'appData');
    fs.mkdirSync(testAppData, { recursive: true });

    const port = '43288';
    console.log('Isolated TEST_APPDATA:', testAppData);
    console.log('Port:', port);

    try {
      // 1. Seed comprehensive realistic demo database
      seedDemoDatabase(testAppData);
      console.log('Database pre-seeded with Al-Shifa Pharmacy demo data.');

      // 2. Launch Electron capture runner
      console.log('\n--- LAUNCHING ELECTRON FOR SCREENSHOT CAPTURE ---');
      await spawnElectronCapture(port, testAppData);
      console.log('>>> ALL SCREENSHOTS CAPTURED SUCCESSFULLY.\n');
    } catch (err) {
      console.error('SCREENSHOT CAPTURE ERROR:', err);
      process.exitCode = 1;
    } finally {
      try {
        if (fs.existsSync(tempRoot)) {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          console.log('Cleaned up temporary test directory:', tempRoot);
        }
      } catch (cleanErr) {
        console.warn('Could not remove tempRoot completely:', cleanErr.message);
      }
    }
  })();
}

function seedDemoDatabase(testAppData) {
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';
  const { db } = require('../api/sqlite');

  try {
    // 1. Users
    const bcrypt = require('bcrypt');
    const ownerPass = bcrypt.hashSync('AlShifaOwner2026!', 10);
    const staffPass = bcrypt.hashSync('CashierPass123!', 10);

    db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
      VALUES (1,'admin','Hassan Raza (Pharmacist)',?,1,1,1,1,1)`).run(ownerPass);
    db.prepare(`INSERT OR REPLACE INTO users(id,username,fullname,password,perm_users,perm_products,perm_categories,perm_transactions,perm_settings)
      VALUES (2,'bilal','Bilal Ahmed (Cashier)',?,0,1,0,1,0)`).run(staffPass);

    // 2. Settings (Al-Shifa Pharmacy)
    const settings = {
      app: 'Multi Medicos',
      store: 'Al-Shifa Pharmacy',
      address_one: 'Plot 42, Main Commercial Market',
      address_two: 'Gulberg III, Lahore',
      contact: '042-35870000',
      tax: '',
      symbol: 'Rs.',
      percentage: '0',
      charge_tax: false,
      quick_billing: false,
      footer: 'Thank you for visiting Al-Shifa Pharmacy! Open 24/7 for patient care.'
    };
    db.prepare(`INSERT OR REPLACE INTO settings(id,data_json) VALUES (1,?)`).run(JSON.stringify(settings));

    // 3. Categories
    db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json) VALUES (1,'Tablets & Capsules','{"name":"Tablets & Capsules"}')`).run();
    db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json) VALUES (2,'Syrups & Suspensions','{"name":"Syrups & Suspensions"}')`).run();
    db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json) VALUES (3,'Injections & Ampoules','{"name":"Injections & Ampoules"}')`).run();
    db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json) VALUES (4,'Drops & Inhalers','{"name":"Drops & Inhalers"}')`).run();
    db.prepare(`INSERT OR REPLACE INTO categories(id,name,data_json) VALUES (5,'Medical Supplies','{"name":"Medical Supplies"}')`).run();

    // 4. Suppliers
    db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,contact_person,phone,email,address,opening_balance_cents,status)
      VALUES (1,'Matrix Pharma Distributors','Tariq Mehmood','0321-5550001','orders@matrixpharma.pk','Plot 12 Industrial Area, Lahore',0,'active')`).run();
    db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,contact_person,phone,email,address,opening_balance_cents,status)
      VALUES (2,'Global Health Logistics','Kamran Khan','0333-5550002','supply@globalhealth.pk','45 Commercial Area, Karachi',0,'active')`).run();
    db.prepare(`INSERT OR REPLACE INTO suppliers(id,name,contact_person,phone,email,address,opening_balance_cents,status)
      VALUES (3,'Standard Medical Supplies','Rashid Ali','0345-5550003','sales@standardmed.pk','88 Mall Road, Rawalpindi',0,'active')`).run();

    // 5. Customers (with realistic Khata balances)
    const c1 = { _id: 1, name: 'Muhammad Usman', phone: '0300-1112233', address: 'Gulberg III, Lahore', credit_limit: 25000 };
    const c2 = { _id: 2, name: 'Dr. Tariq Aziz', phone: '0321-4445566', address: 'Model Town, Lahore', credit_limit: 50000 };
    const c3 = { _id: 3, name: 'Haji Abdul Rehman', phone: '0345-7778899', address: 'Faisal Town, Lahore', credit_limit: 20000 };

    db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,phone,address,credit_limit_cents,opening_balance_cents)
      VALUES ('1','Muhammad Usman',?,'0300-1112233','Gulberg III, Lahore',2500000,0)`).run(JSON.stringify(c1));
    db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,phone,address,credit_limit_cents,opening_balance_cents)
      VALUES ('2','Dr. Tariq Aziz',?,'0321-4445566','Model Town, Lahore',5000000,0)`).run(JSON.stringify(c2));
    db.prepare(`INSERT OR REPLACE INTO customers(id,name,data_json,phone,address,credit_limit_cents,opening_balance_cents)
      VALUES ('3','Haji Abdul Rehman',?,'0345-7778899','Faisal Town, Lahore',2000000,0)`).run(JSON.stringify(c3));

  // 6. Products
  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (1,10001,'Panadol 500mg Tablets',1200,'31-Dec-2027','1','1',1,50,'','Tablet',10,100,11000,100000,'strip')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (2,10002,'Amoxil 500mg Capsules',2500,'30-Jun-2027','1','1',1,50,'','Capsule',10,100,22000,200000,'strip')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (3,10003,'Hydryllin Syrup 120ml',18000,'31-Dec-2026','2','2',1,10,'','Bottle',NULL,NULL,NULL,NULL,NULL)`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (4,10004,'Tramal Injection 2ml',9500,'31-Mar-2028','3','2',1,10,'','Ampoule',NULL,5,NULL,45000,'box')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (5,10005,'Brufen 400mg Tablets',1500,'25-Nov-2026','1','1',1,50,'','Tablet',10,200,13000,240000,'strip')`).run();

  db.prepare(`INSERT OR REPLACE INTO products(id,barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
    VALUES (6,10006,'Surbex Z High Potency Tablets',45000,'31-Oct-2027','1','3',1,10,'','Bottle',NULL,NULL,NULL,NULL,NULL)`).run();

  // 7. Purchases & Purchase Items (Must exist before inventory_batches references them)
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (1,'INV-MAT-8841',1,'2026-10-05','2026-10-05','2026-10-06','2026-11-05','received','paid',987500,987500,'Delivered in good condition',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO purchase_items(id,purchase_id,product_id,product_name,batch_number,expiry_date,quantity,unit_cost_cents,discount_cents,discount_percent,tax_cents,line_total_cents,purchase_unit,units_per_pack,base_quantity,total_cost_cents)
    VALUES (1,1,1,'Panadol 500mg Tablets','BAT-PAN-01','2027-12-31',5,80000,20000,5,0,380000,'box',100,500,380000)`).run();

  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (2,'INV-GLO-2092',2,'2026-10-18','2026-10-18','2026-10-19','2026-11-18','received','partially_paid',859500,500000,'Partial payment via bank transfer',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO purchases(id,invoice_no,supplier_id,invoice_date,purchase_date,receiving_date,due_date,purchase_status,payment_status,total_cents,paid_cents,notes,created_by)
    VALUES (3,'INV-STD-3105',3,'2026-10-25','2026-10-25','2026-10-26','2026-11-10','received','paid',1080000,1080000,'Vitamin supplements stock',1)`).run();

  // 8. Inventory & Batches
  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (1,480)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (1,1,1,1,'BAT-PAN-01','2027-12-31',500,480,760,380000,380000,500,1,'2026-10-05')`).run();

  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (2,340)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (2,2,1,1,'BAT-AMX-02','2027-06-30',350,340,1600,560000,560000,350,1,'2026-10-05')`).run();

  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (3,42)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (3,3,2,2,'BAT-HYD-03','2026-12-31',45,42,13500,607500,607500,45,1,'2026-10-18')`).run();

  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (4,30)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (4,4,2,2,'BAT-TRM-04','2028-03-31',35,30,7200,252000,252000,35,1,'2026-10-18')`).run();

  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (5,15)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (5,5,1,1,'BAT-BRU-EXP','2026-11-25',50,15,950,47500,47500,50,1,'2026-10-05')`).run();

  db.prepare(`INSERT OR REPLACE INTO inventory(product_id,quantity) VALUES (6,28)`).run();
  db.prepare(`INSERT OR REPLACE INTO inventory_batches(id,product_id,supplier_id,purchase_id,batch_number,expiry_date,initial_quantity,quantity_available,unit_cost_cents,total_cost_cents,cumulative_cost_cents,costed_units,cost_known,received_date)
    VALUES (6,6,3,3,'BAT-SBX-06','2027-10-31',30,28,36000,1080000,1080000,30,1,'2026-10-25')`).run();

  // 8. Expenses
  db.prepare(`INSERT OR REPLACE INTO expense_categories(id,name,account_id) VALUES (1,'Shop Rent',6010)`).run();
  db.prepare(`INSERT OR REPLACE INTO expense_categories(id,name,account_id) VALUES (2,'Electricity & Utilities',6020)`).run();
  db.prepare(`INSERT OR REPLACE INTO expense_categories(id,name,account_id) VALUES (3,'Staff Salaries',6030)`).run();
  db.prepare(`INSERT OR REPLACE INTO expense_categories(id,name,account_id) VALUES (4,'Tea & Refreshment',6040)`).run();

  db.prepare(`INSERT OR REPLACE INTO expenses(id,expense_number,category_id,amount_cents,expense_date,payment_method,description,user_id)
    VALUES (1,'EXP-2026-001',1,4000000,'2026-10-01','cash','Shop monthly rent October 2026',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO expenses(id,expense_number,category_id,amount_cents,expense_date,payment_method,description,user_id)
    VALUES (2,'EXP-2026-002',2,1850000,'2026-10-10','bank','LESCO Electricity Bill',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO expenses(id,expense_number,category_id,amount_cents,expense_date,payment_method,description,user_id)
    VALUES (3,'EXP-2026-003',3,3500000,'2026-10-31','cash','Staff monthly salaries',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO expenses(id,expense_number,category_id,amount_cents,expense_date,payment_method,description,user_id)
    VALUES (4,'EXP-2026-004',4,320000,'2026-11-02','cash','Daily staff tea & mineral water',1)`).run();

  // 9. Sales across multiple months (for Dashboard & Reports)
  // Sale 1: Cash sale
  const sale1Data = {
    order: '1001',
    items: [{ id: 2, product_name: 'Amoxil 500mg Capsules', price: 220, quantity: 2, unit: 'strip', pack_multiplier: 10, base_quantity: 20 }],
    total: 440,
    paid: 440,
    change: 0,
    customer: 0,
    payment_type: 'Cash',
    date: '2026-10-12T14:30:00.000Z'
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-DEMO-001',1,'2026-10-12T14:30:00.000Z',1,44000,44000,'hash1',?)`).run(JSON.stringify(sale1Data));
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents,sale_unit,pack_multiplier,base_quantity)
    VALUES ('SALE-DEMO-001',0,2,'Amoxil 500mg Capsules',2,22000,'strip',10,20)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-DEMO-001',2,2,20,1600,32000,1)`).run();

  // Sale 2: Customer Khata (Credit) sale to Muhammad Usman
  const sale2Data = {
    order: '1002',
    items: [
      { id: 1, product_name: 'Panadol 500mg Tablets', price: 1000, quantity: 1, unit: 'box', pack_multiplier: 100, base_quantity: 100 },
      { id: 3, product_name: 'Hydryllin Syrup 120ml', price: 180, quantity: 2, unit: 'Bottle', pack_multiplier: 1, base_quantity: 2 },
      { id: 6, product_name: 'Surbex Z High Potency Tablets', price: 450, quantity: 2, unit: 'Bottle', pack_multiplier: 1, base_quantity: 2 },
      { id: 5, product_name: 'Brufen 400mg Tablets', price: 130, quantity: 9, unit: 'strip', pack_multiplier: 10, base_quantity: 90 }
    ],
    total: 3450,
    paid: 0,
    customer: 1,
    customer_name: 'Muhammad Usman',
    payment_type: 'Khata',
    date: '2026-10-20T17:15:00.000Z'
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-DEMO-002',1,'2026-10-20T17:15:00.000Z',1,345000,0,'hash2',?)`).run(JSON.stringify(sale2Data));
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents,sale_unit,pack_multiplier,base_quantity)
    VALUES ('SALE-DEMO-002',0,1,'Panadol 500mg Tablets',1,100000,'box',100,100)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-DEMO-002',1,1,100,760,76000,1)`).run();

  // Sale 3: Mixed Payment sale to Dr. Tariq Aziz
  const sale3Data = {
    order: '1003',
    items: [
      { id: 1, product_name: 'Panadol 500mg Tablets', price: 1000, quantity: 3, unit: 'box', pack_multiplier: 100, base_quantity: 300 },
      { id: 2, product_name: 'Amoxil 500mg Capsules', price: 2000, quantity: 3, unit: 'box', pack_multiplier: 100, base_quantity: 300 }
    ],
    total: 9000,
    paid: 4000,
    customer: 2,
    customer_name: 'Dr. Tariq Aziz',
    payment_type: 'Mixed',
    date: '2026-10-28T19:40:00.000Z'
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-DEMO-003',1,'2026-10-28T19:40:00.000Z',1,900000,400000,'hash3',?)`).run(JSON.stringify(sale3Data));
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents,sale_unit,pack_multiplier,base_quantity)
    VALUES ('SALE-DEMO-003',0,1,'Panadol 500mg Tablets',3,100000,'box',100,300)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-DEMO-003',1,1,300,760,228000,1)`).run();

  // Sale 4: November Cash Sale with 5% discount
  const sale4Data = {
    order: '1004',
    items: [
      { id: 3, product_name: 'Hydryllin Syrup 120ml', price: 180, quantity: 2, unit: 'Bottle', pack_multiplier: 1, base_quantity: 2 },
      { id: 6, product_name: 'Surbex Z High Potency Tablets', price: 450, quantity: 2, unit: 'Bottle', pack_multiplier: 1, base_quantity: 2 }
    ],
    total: 1200,
    paid: 1200,
    discount_percent: 5,
    customer: 0,
    payment_type: 'Cash',
    date: '2026-11-03T11:20:00.000Z'
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-DEMO-004',1,'2026-11-03T11:20:00.000Z',1,120000,120000,'hash4',?)`).run(JSON.stringify(sale4Data));
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents,sale_unit,pack_multiplier,base_quantity)
    VALUES ('SALE-DEMO-004',0,3,'Hydryllin Syrup 120ml',2,18000,'Bottle',1,2)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-DEMO-004',3,3,2,13500,27000,1)`).run();

  // Sale 5: Verified Worked Example (1 strip Panadol sold at Rs. 110. Unit cost Rs. 7.60/tab -> Rs. 76 cost -> Rs. 34 profit)
  const sale5Data = {
    order: '1005',
    items: [
      { id: 1, product_name: 'Panadol 500mg Tablets', price: 110, quantity: 1, unit: 'strip', pack_multiplier: 10, base_quantity: 10 }
    ],
    total: 110,
    paid: 110,
    customer: 0,
    payment_type: 'Cash',
    date: '2026-11-06T16:10:00.000Z'
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('SALE-DEMO-005',1,'2026-11-06T16:10:00.000Z',1,11000,11000,'hash5',?)`).run(JSON.stringify(sale5Data));
  db.prepare(`INSERT OR REPLACE INTO sale_items(sale_id,line_no,product_id,product_name,quantity,unit_price_cents,sale_unit,pack_multiplier,base_quantity)
    VALUES ('SALE-DEMO-005',0,1,'Panadol 500mg Tablets',1,11000,'strip',10,10)`).run();
  db.prepare(`INSERT OR REPLACE INTO sale_batch_cogs(sale_id,product_id,batch_id,quantity,unit_cost_cents,cost_cents,cost_known)
    VALUES ('SALE-DEMO-005',1,1,10,760,7600,1)`).run();

  // 10. Held Order (Open Tab)
  const heldData = {
    _id: 'HELD-TAB-101',
    refNumber: 'Ward-Bed-03',
    items: [
      { id: 1, product_name: 'Panadol 500mg Tablets', price: 110, quantity: 2, unit: 'strip', pack_multiplier: 10, base_quantity: 20 },
      { id: 3, product_name: 'Hydryllin Syrup 120ml', price: 180, quantity: 1, unit: 'Bottle', pack_multiplier: 1, base_quantity: 1 }
    ],
    total: 400
  };
  db.prepare(`INSERT OR REPLACE INTO sales(id,status,date,user_id,total_cents,paid_cents,payload_hash,data_json)
    VALUES ('HELD-TAB-101',0,datetime('now'),1,40000,0,'',?)`).run(JSON.stringify(heldData));

  // 11. Journal Entries for Customer Khata and Supplier Payables
  db.prepare(`INSERT OR REPLACE INTO journal_entries(id,entry_number,entry_date,reference_type,reference_id,description,user_id)
    VALUES (101,'JE-AR-001','2026-10-20','SALE','SALE-DEMO-002','Credit sale to Muhammad Usman',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (101,101,1100,345000,0,'customer','1','Receivable from Muhammad Usman')`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (102,101,4010,0,345000,NULL,NULL,'Sales Revenue')`).run();

  db.prepare(`INSERT OR REPLACE INTO journal_entries(id,entry_number,entry_date,reference_type,reference_id,description,user_id)
    VALUES (102,'JE-AR-002','2026-10-28','SALE','SALE-DEMO-003','Credit sale to Dr. Tariq Aziz',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (103,102,1100,1000000,0,'customer','2','Receivable from Dr. Tariq Aziz')`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (104,102,4010,0,1000000,NULL,NULL,'Sales Revenue')`).run();

  db.prepare(`INSERT OR REPLACE INTO journal_entries(id,entry_number,entry_date,reference_type,reference_id,description,user_id)
    VALUES (103,'JE-AP-002','2026-10-18','PURCHASE','PUR-2','Payable for INV-GLO-2092',1)`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (105,103,1300,359500,0,NULL,NULL,'Inventory Asset')`).run();
  db.prepare(`INSERT OR REPLACE INTO journal_lines(id,entry_id,account_id,debit_cents,credit_cents,party_type,party_id,line_description)
    VALUES (106,103,2010,0,359500,'supplier','2','Payable to Global Health Logistics')`).run();
  } finally {
    try { db.close(); } catch (_) {}
  }
}

function spawnElectronCapture(port, testAppData) {
  return new Promise((resolve, reject) => {
    const electronExe = require('electron');
    const env = {
      ...process.env,
      TEST_APPDATA: testAppData,
      PORT: port,
      PHARMASPOT_DISABLE_RELOADER: '1'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExe, [__filename, '--capture-run', '--port', port, '--data', testAppData], {
      env,
      stdio: 'inherit',
      windowsHide: false
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Electron capture timed out after 180 seconds.'));
    }, 180000);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron capture exited with error code ${code}`));
    });
  });
}

// ============================================================================
// ELECTRON EXECUTION (Runs under Electron binary)
// ============================================================================
if (isElectron && isCaptureRun) {
  const { app, BrowserWindow } = require('electron');

  const dataArgIndex = args.indexOf('--data');
  const testAppData = dataArgIndex !== -1 ? args[dataArgIndex + 1] : process.env.TEST_APPDATA;
  if (!testAppData) throw new Error('TEST_APPDATA is required for Electron capture phase.');

  fs.mkdirSync(testAppData, { recursive: true });
  app.setPath('appData', testAppData);
  process.env.APPDATA = testAppData;
  process.env.APPNAME = 'PharmaSpot';

  const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

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

  async function takeShot(window, filename, description) {
    // Remove Notiflix popups / toasts if any
    await window.webContents.executeJavaScript(`(() => {
      $('#notiflix-report-wrap, [id^="Notiflix"], .notiflix-report, .notiflix-notify').remove();
    })()`);
    await pause(400);
    const img = await window.webContents.capturePage();
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, img.toPNG());
    const stats = fs.statSync(filePath);
    console.log(`[CAPTURE OK] ${filename} (${Math.round(stats.size / 1024)} KB) - ${description}`);
  }

  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2 && !/Content Security Policy|Content-Security-Policy|Electron Security Warning|DevTools/.test(message)) {
        console.log(`[RENDERER LOG]: ${message}`);
      }
    });

    window.webContents.once('did-finish-load', async () => {
      try {
        console.log('Renderer loaded. Setting window size to 1440x900...');
        window.setSize(1440, 900);
        window.center();

        await waitFor(window, `() => document.querySelector('#login') || document.querySelector('#main_app')`, 'Initial view');
        await pause(600);

        const isLogin = await window.webContents.executeJavaScript(`(() => {
          const login = document.querySelector('#login');
          return !!(login && getComputedStyle(login).display !== 'none');
        })()`);

        if (isLogin) {
          console.log('[Electron] Submitting login credentials for admin...');
          const reloadPromise = new Promise(resolve => {
            window.webContents.once('did-finish-load', resolve);
          });
          await window.webContents.executeJavaScript(`(() => {
            const form = document.querySelector('#account');
            form.querySelector('[name=username]').value = 'admin';
            form.querySelector('[name=password]').value = 'AlShifaOwner2026!';
            form.requestSubmit();
            return true;
          })()`);
          await reloadPromise;
          console.log('[Electron] Logged into app after reload.');
        }

        await waitFor(window, `() => document.querySelector('#parent .product-card-item')`, 'POS products loaded', 25000);
        await pause(1000);

        // Ensure we are in Light mode initially
        await window.webContents.executeJavaScript(`(() => {
          $('html').removeClass('theme-dark');
        })()`);

        // ====================================================================
        // SHOT 1: pos.png (POS view with items in cart, category badges, pack unit selector)
        // ====================================================================
        console.log('\nPreparing SHOT 1: pos.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="pos"]').trigger('click');
          $('.modal').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');

          // Add Panadol to cart
          if (typeof window.addToCart === 'function') {
            window.addToCart(1); // Panadol
            window.addToCart(2); // Amoxil
            window.addToCart(3); // Hydryllin
          } else {
            $('#parent .product-card-item:eq(0)').trigger('click');
            $('#parent .product-card-item:eq(1)').trigger('click');
            $('#parent .product-card-item:eq(2)').trigger('click');
          }
        })()`);
        await pause(800);

        // Set cart item units: Panadol to 'strip' qty 2
        await window.webContents.executeJavaScript(`(() => {
          const panadolRow = $('#cartTable tbody tr:contains("Panadol")');
          if (panadolRow.length) {
            const unitSelect = panadolRow.find('.item-unit-select');
            if (unitSelect.length) {
              unitSelect.val('strip').trigger('change');
            }
            const qtyInput = panadolRow.find('input[name="qty"]');
            if (qtyInput.length) {
              qtyInput.val(2).trigger('change');
            }
          }
        })()`);
        await pause(500);
        await takeShot(window, 'pos.png', 'Point of sale with cart items, category badges, pack unit selector');

        // ====================================================================
        // SHOT 2: pos-payment.png (Payment dialog)
        // ====================================================================
        console.log('\nPreparing SHOT 2: pos-payment.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('#payButton').trigger('click');
        })()`);
        await pause(800);
        await takeShot(window, 'pos-payment.png', 'Payment dialog with cash and Khata options');

        // Close payment modal
        await window.webContents.executeJavaScript(`(() => {
          $('#paymentModel').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');
        })()`);
        await pause(500);

        // ====================================================================
        // SHOT 3: receipt.png (Printed receipt preview)
        // ====================================================================
        console.log('\nPreparing SHOT 3: receipt.png...');
        await window.webContents.executeJavaScript(`(() => {
          // Trigger receipt display for Sale 5 (Panadol 1 strip worked example)
          const transaction = {
            order: '1005',
            date: '2026-11-06 16:10:00',
            user: 'Hassan Raza (Pharmacist)',
            customer: 'Walk-in Customer',
            items: [
              { product_name: 'Panadol 500mg Tablets', price: 110, quantity: 1, unit: 'strip' }
            ],
            total: 110,
            paid: 110,
            change: 0,
            payment_type: 'Cash'
          };
          const settings = {
            store: 'Al-Shifa Pharmacy',
            address_one: 'Plot 42, Main Commercial Market',
            address_two: 'Gulberg III, Lahore',
            contact: '042-35870000',
            symbol: 'Rs.',
            footer: 'Thank you for visiting Al-Shifa Pharmacy! Open 24/7.'
          };

          let receiptHtml = '<div style="font-size: 13px; line-height: 1.5; color: #222; font-family: monospace; max-width: 360px; margin: 0 auto; background: #fff; padding: 15px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">' +
            '<div style="text-align:center; margin-bottom: 12px;">' +
            '<h3 style="margin: 0; font-weight: bold; color: #15803d; font-size: 20px;">' + settings.store + '</h3>' +
            '<p style="margin: 2px 0;">' + settings.address_one + '</p>' +
            '<p style="margin: 2px 0;">' + settings.address_two + '</p>' +
            '<p style="margin: 2px 0;">Tel: ' + settings.contact + '</p>' +
            '</div>' +
            '<hr style="border: 0; border-top: 1px dashed #666; margin: 8px 0;">' +
            '<div style="display:flex; justify-content:space-between;"><span>Invoice: #INV-1005</span><span>06-Nov-2026 16:10</span></div>' +
            '<div style="display:flex; justify-content:space-between;"><span>Cashier: ' + transaction.user + '</span><span>Cash Sale</span></div>' +
            '<hr style="border: 0; border-top: 1px dashed #666; margin: 8px 0;">' +
            '<table style="width:100%; border-collapse:collapse;">' +
            '<thead><tr style="border-bottom: 1px solid #444;"><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>' +
            '<tbody>' +
            '<tr><td style="padding: 4px 0;">Panadol 500mg Tablets<br><small style="color:#555;">[Pack: 1 Strip]</small></td><td style="text-align:center;">1</td><td style="text-align:right;">110.00</td><td style="text-align:right;">110.00</td></tr>' +
            '</tbody>' +
            '</table>' +
            '<hr style="border: 0; border-top: 1px dashed #666; margin: 8px 0;">' +
            '<div style="display:flex; justify-content:space-between; font-size: 15px; font-weight: bold; margin: 6px 0;"><span>TOTAL AMOUNT:</span><span>Rs. 110.00</span></div>' +
            '<div style="display:flex; justify-content:space-between;"><span>Cash Tendered:</span><span>Rs. 110.00</span></div>' +
            '<div style="display:flex; justify-content:space-between;"><span>Change Due:</span><span>Rs. 0.00</span></div>' +
            '<hr style="border: 0; border-top: 1px dashed #666; margin: 8px 0;">' +
            '<p style="text-align:center; margin: 12px 0 4px; font-size: 11px;">' + settings.footer + '</p>' +
            '<p style="text-align:center; margin: 0; font-size: 10px; color:#777;">Multi Medicos Pharmacy POS</p>' +
            '</div>';

          $('#viewTransaction').html(receiptHtml);
          $('#orderModal').modal('show');
        })()`);
        await pause(800);
        await takeShot(window, 'receipt.png', 'Printed receipt preview with pharmacy header and item breakdown');

        // Close receipt modal
        await window.webContents.executeJavaScript(`(() => {
          $('#orderModal').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');
        })()`);
        await pause(500);

        // ====================================================================
        // SHOT 4: dashboard.png (Dashboard with month-wise profit, 12-month chart)
        // ====================================================================
        console.log('\nPreparing SHOT 4: dashboard.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="dashboard"]').trigger('click');
        })()`);
        await pause(1500);
        await takeShot(window, 'dashboard.png', 'Enterprise Dashboard with profit metrics and monthly chart');

        // ====================================================================
        // SHOT 5: reports.png (Report Center - Profit & Loss)
        // ====================================================================
        console.log('\nPreparing SHOT 5: reports.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="reports"]').trigger('click');
        })()`);
        await pause(1500);
        await takeShot(window, 'reports.png', 'Report Center Profit and Loss statement');

        // ====================================================================
        // SHOT 6: products.png (Product catalog list modal)
        // ====================================================================
        console.log('\nPreparing SHOT 6: products.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="pos"]').trigger('click');
          $('#productModal').trigger('click');
        })()`);
        await pause(1000);
        await takeShot(window, 'products.png', 'Products catalog modal with stock and prices');

        // Close products modal
        await window.webContents.executeJavaScript(`(() => {
          $('#Products').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');
        })()`);
        await pause(500);

        // ====================================================================
        // SHOT 7: add-medicine.png (New Add Medicine modal with pack sizes)
        // ====================================================================
        console.log('\nPreparing SHOT 7: add-medicine.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('#newProductModal').trigger('click');
        })()`);
        await pause(800);

        // Switch to "In strips / boxes" pack mode and prefill demo data
        await window.webContents.executeJavaScript(`(() => {
          $('#prod_sold_type_pack_lbl').trigger('click');
          $('input[name="prod_sold_type"][value="pack"]').prop('checked', true).trigger('change');

          $('#productName').val('Panadol Extra 500mg/65mg Tablets');
          $('#barcode').val('10007');
          $('#supplier').val('Matrix Pharma Distributors');
          $('#category').val('1');
          $('#product_base_unit').val('Tablet').trigger('change');
          $('#product_units_per_strip').val('10').trigger('input');
          $('#product_strips_per_box').val('10').trigger('input');
          $('#product_box_price').val('1200').trigger('input');
          $('#product_strip_price').val('130').trigger('input');
          $('#product_price').val('15').trigger('input');
        })()`);
        await pause(600);
        await takeShot(window, 'add-medicine.png', 'Add Medicine modal with pack size configuration and live calculation');

        // Close add product modal
        await window.webContents.executeJavaScript(`(() => {
          $('#newProduct').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');
        })()`);
        await pause(500);

        // ====================================================================
        // SHOT 8: purchase.png (New purchase entry with unit selector, discount %, live preview)
        // ====================================================================
        console.log('\nPreparing SHOT 8: purchase.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="purchases"]').trigger('click');
        })()`);
        await pause(600);
        await window.webContents.executeJavaScript(`(() => {
          $('#btn_new_purchase').trigger('click');
        })()`);
        await pause(800);

        // Search Panadol and click search option to add medicine card
        await window.webContents.executeJavaScript(`(() => {
          $('#pur_supplier_search').val('Matrix Pharma Distributors');
          $('#pur_supplier_select').val('1');
          $('#pur_invoice_no').val('INV-MAT-9901');

          // Trigger medicine search
          $('#pur_medicine_search').val('Panadol').trigger('input');
        })()`);
        await pause(400);

        // Click search result and fill fields
        await window.webContents.executeJavaScript(`(() => {
          const opt = $('#pur_medicine_results .purchase-search-option').first();
          if (opt.length) opt.trigger('click');

          const card = $('#purchase_items_cards .purchase-item-card').first();
          if (card.length) {
            card.find('.pur-item-unit').val('box').trigger('change');
            card.find('.pur-item-qty').val('5').trigger('input');
            card.find('.pur-item-cost').val('800.00').trigger('input');
            card.find('.pur-item-discount').val('5').trigger('input');
            card.find('.pur-item-batch').val('BT-2024A');
            card.find('.pur-item-expiry').val('2027-12-31');
            card.find('.pur-item-qty').trigger('input');
          }

          // Clear search and blur
          $('#pur_medicine_search').val('');
          $('.purchase-search-results').hide();
          $(':focus').blur();
        })()`);
        await pause(600);
        await takeShot(window, 'purchase.png', 'New purchase modal with unit selector, discount %, and live cost preview');

        // Close purchase modal
        await window.webContents.executeJavaScript(`(() => {
          $('#modal_new_purchase').modal('hide');
          $('.modal-backdrop').remove();
          $('body').removeClass('modal-open');
        })()`);
        await pause(500);

        // ====================================================================
        // SHOT 9: khata.png (Customer Khata ledger)
        // ====================================================================
        console.log('\nPreparing SHOT 9: khata.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="customers_khata"]').trigger('click');
        })()`);
        await pause(1000);
        await takeShot(window, 'khata.png', 'Customer Khata ledger with balances and credit limits');

        // ====================================================================
        // SHOT 10: suppliers.png (Suppliers management view)
        // ====================================================================
        console.log('\nPreparing SHOT 10: suppliers.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="suppliers"]').trigger('click');
        })()`);
        await pause(1000);
        await takeShot(window, 'suppliers.png', 'Suppliers management directory with contact info');

        // ====================================================================
        // SHOT 11: transactions.png (Transaction history view)
        // ====================================================================
        console.log('\nPreparing SHOT 11: transactions.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('#transactions').trigger('click');
        })()`);
        await pause(1000);
        await takeShot(window, 'transactions.png', 'Transaction history with Cash, Khata, and Mixed tags');

        // ====================================================================
        // SHOT 12: dark-pos.png (POS in dark theme)
        // ====================================================================
        console.log('\nPreparing SHOT 12: dark-pos.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('#theme-toggle').trigger('click');
          $('.nav-tab[data-view="pos"]').trigger('click');
        })()`);
        await pause(1000);
        await takeShot(window, 'dark-pos.png', 'Point of sale in dark theme');

        // ====================================================================
        // SHOT 13: dark-dashboard.png (Dashboard in dark theme)
        // ====================================================================
        console.log('\nPreparing SHOT 13: dark-dashboard.png...');
        await window.webContents.executeJavaScript(`(() => {
          $('.nav-tab[data-view="dashboard"]').trigger('click');
        })()`);
        await pause(1500);
        await takeShot(window, 'dark-dashboard.png', 'Enterprise Dashboard in dark theme');

        // Revert to light theme before exit
        await window.webContents.executeJavaScript(`(() => {
          $('#theme-toggle').trigger('click');
        })()`);
        await pause(300);
        await pause(300);

        console.log('\nAll 13 screenshots generated successfully!');
        process.exitCode = 0;
        app.exit(0);
      } catch (err) {
        console.error('CAPTURE ERROR IN RENDERER:', err);
        process.exitCode = 1;
        app.exit(1);
      }
    });
  });

  require('../start');
}
