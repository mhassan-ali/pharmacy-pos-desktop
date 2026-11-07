const app = require('express')();
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const multer = require('multer');
const validator = require('validator');
const sanitizeFilename = require('sanitize-filename');
const { filterFile } = require('../assets/js/utils');
const { db, transaction, cents, audit } = require('./sqlite');
const {
  formatStockPacks,
  calcCumulativeCost,
  calcCostAllocation,
  resolveUnitMultiplier,
  resolveTierPriceCents
} = require('./pack-helpers');

const uploads = path.join(process.env.APPDATA, process.env.APPNAME, 'uploads');
fs.mkdirSync(uploads, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: uploads, filename: (_req, file, done) => done(null, `${Date.now()}${path.extname(file.originalname)}`) }),
  limits: { fileSize: 2097152 }, fileFilter: filterFile,
}).single('imagename');

const productQuery = `SELECT p.id AS _id, p.barcode, p.name, p.price_cents, p.expiration_date,
  p.category, p.supplier, p.stock_tracked AS stock, p.min_stock AS minStock,
  p.img, p.base_unit, p.units_per_strip, p.units_per_box, p.strip_price_cents, p.box_price_cents,
  p.default_sale_unit, i.quantity FROM products p JOIN inventory i ON i.product_id = p.id`;
function product(row) {
  if (!row) return null;
  const hasBox = row.units_per_box != null && Number(row.units_per_box) > 1;
  const hasStrip = row.units_per_strip != null && Number(row.units_per_strip) > 1;
  const hasPackLevel = hasBox || hasStrip;
  const rawBase = row.base_unit ? String(row.base_unit).trim() : '';
  const effectiveBase = (!hasPackLevel && (!rawBase || rawBase.toLowerCase() === 'tablet')) ? null : (rawBase || null);

  return {
    _id: row._id,
    id: row._id,
    barcode: row.barcode,
    name: row.name,
    price: (row.price_cents / 100).toFixed(2),
    price_cents: row.price_cents,
    expirationDate: row.expiration_date,
    category: row.category,
    supplier: row.supplier,
    stock: row.stock,
    minStock: row.minStock,
    img: row.img,
    quantity: row.quantity,
    base_unit: effectiveBase,
    units_per_strip: row.units_per_strip != null ? Number(row.units_per_strip) : null,
    units_per_box: row.units_per_box != null ? Number(row.units_per_box) : null,
    strip_price_cents: row.strip_price_cents != null ? Number(row.strip_price_cents) : null,
    strip_price: row.strip_price_cents != null ? (row.strip_price_cents / 100).toFixed(2) : null,
    box_price_cents: row.box_price_cents != null ? Number(row.box_price_cents) : null,
    box_price: row.box_price_cents != null ? (row.box_price_cents / 100).toFixed(2) : null,
    default_sale_unit: row.default_sale_unit || 'base',
    stock_display: formatStockPacks(row.quantity, row.units_per_box, row.units_per_strip, effectiveBase),
    pack_display: formatStockPacks(row.quantity, row.units_per_box, row.units_per_strip, effectiveBase)
  };
}
function byId(id) { return product(db.prepare(`${productQuery} WHERE p.id = ?`).get(id)); }
function validId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid product ID.');
  return id;
}

app.get('/', (_req, res) => res.send('Inventory API'));
app.get('/products', (_req, res) => {
  try { res.json(db.prepare(productQuery).all().map(product)); }
  catch (error) { console.error(error); res.sendStatus(500); }
});
app.get('/product/:productId', (req, res) => {
  try { res.json(byId(validId(req.params.productId))); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/product/sku', (req, res) => {
  const barcode = Number(req.body.skuCode);
  if (!Number.isSafeInteger(barcode)) return res.json({});
  try { res.json(product(db.prepare(`${productQuery} WHERE p.barcode = ?`).get(barcode)) || {}); }
  catch (error) { console.error(error); res.sendStatus(500); }
});

app.post('/product', (req, res) => upload(req, res, error => {
  if (error) return res.status(400).json({ error: 'Upload Error', message: error.message });
  try {
    const body = req.body;
    const id = body.id === '' || body.id == null ? null : validId(body.id);
    const existing = id ? byId(id) : null;
    if (id && !existing) return res.sendStatus(404);

    const barcodeInput = String(body.barcode ?? '').trim();
    const barcode = barcodeInput === '' ? null : Number(barcodeInput);
    const quantity = (body.quantity === '' || body.quantity === undefined || body.quantity === null)
      ? (existing ? Number(existing.quantity) : 0)
      : Number(body.quantity);
    const minStock = body.minStock !== undefined ? Number(body.minStock || 0) : (existing ? Number(existing.minStock || 0) : 0);
    const priceCents = cents(body.price);
    if ((barcode !== null && (!Number.isSafeInteger(barcode) || barcode < 0)) || !Number.isSafeInteger(quantity) || quantity < 0 ||
        !Number.isSafeInteger(minStock) || minStock < 0 || !body.name) {
      return res.status(400).json({ error: 'Invalid product', message: 'Barcode, price and stock must be valid non-negative numbers.' });
    }
    if (!id && body.quick_add === '1') {
      const sameName = db.prepare('SELECT id FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))').get(String(body.name));
      if (sameName) {
        return res.status(409).json({ error: 'Medicine already exists', message: 'A medicine with this exact name is already registered. Select it from the purchase search.' });
      }
    }

    if (barcode !== null) {
      const dupBarcode = id
        ? db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(barcode, id)
        : db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
      if (dupBarcode) {
        return res.status(409).json({ error: 'Duplicate barcode', message: 'A product with this barcode already exists.' });
      }
    }
    let image = req.file ? sanitizeFilename(req.file.filename) : sanitizeFilename(body.img || '');
    if (body.remove === '1' && !req.file) image = '';

    const baseUnitInput = body.base_unit !== undefined ? String(body.base_unit || '').trim() : (existing ? existing.base_unit : null);
    const baseUnit = baseUnitInput ? validator.escape(baseUnitInput) : null;

    let unitsPerStrip = null;
    if (body.units_per_strip !== undefined && body.units_per_strip !== null && String(body.units_per_strip).trim() !== '') {
      unitsPerStrip = Number(body.units_per_strip);
      if (!Number.isSafeInteger(unitsPerStrip) || unitsPerStrip < 2) {
        return res.status(400).json({ error: 'Invalid units per strip', message: 'Units per strip must be an integer greater than 1.' });
      }
    } else if (existing && existing.units_per_strip && body.units_per_strip === undefined) {
      unitsPerStrip = existing.units_per_strip;
    }

    let unitsPerBox = null;
    if (body.units_per_box !== undefined && body.units_per_box !== null && String(body.units_per_box).trim() !== '') {
      unitsPerBox = Number(body.units_per_box);
      if (!Number.isSafeInteger(unitsPerBox) || unitsPerBox < 2) {
        return res.status(400).json({ error: 'Invalid units per box', message: 'Units per box must be an integer greater than 1.' });
      }
    } else if (existing && existing.units_per_box && body.units_per_box === undefined) {
      unitsPerBox = existing.units_per_box;
    }

    let stripPriceCents = null;
    if (body.strip_price !== undefined && body.strip_price !== null && String(body.strip_price).trim() !== '') {
      stripPriceCents = cents(body.strip_price);
      if (stripPriceCents < 0) return res.status(400).json({ error: 'Invalid strip price', message: 'Strip price cannot be negative.' });
    } else if (body.strip_price_cents !== undefined && body.strip_price_cents !== null && String(body.strip_price_cents).trim() !== '') {
      stripPriceCents = Number(body.strip_price_cents);
    } else if (existing && existing.strip_price_cents && body.strip_price === undefined) {
      stripPriceCents = existing.strip_price_cents;
    }

    let boxPriceCents = null;
    if (body.box_price !== undefined && body.box_price !== null && String(body.box_price).trim() !== '') {
      boxPriceCents = cents(body.box_price);
      if (boxPriceCents < 0) return res.status(400).json({ error: 'Invalid box price', message: 'Box price cannot be negative.' });
    } else if (body.box_price_cents !== undefined && body.box_price_cents !== null && String(body.box_price_cents).trim() !== '') {
      boxPriceCents = Number(body.box_price_cents);
    } else if (existing && existing.box_price_cents && body.box_price === undefined) {
      boxPriceCents = existing.box_price_cents;
    }

    let defaultSaleUnit = 'base';
    if (body.default_sale_unit) {
      const dUnit = String(body.default_sale_unit).trim().toLowerCase();
      if (dUnit === 'box') {
        if (!unitsPerBox) return res.status(400).json({ error: 'Invalid default sale unit', message: 'Cannot set default unit to Box without units_per_box configured.' });
        defaultSaleUnit = 'box';
      } else if (dUnit === 'strip') {
        if (!unitsPerStrip) return res.status(400).json({ error: 'Invalid default sale unit', message: 'Cannot set default unit to Strip without units_per_strip configured.' });
        defaultSaleUnit = 'strip';
      } else {
        defaultSaleUnit = 'base';
      }
    } else if (existing && existing.default_sale_unit && body.default_sale_unit === undefined) {
      defaultSaleUnit = existing.default_sale_unit;
    }

    const expirationDate = body.expirationDate !== undefined
      ? validator.escape(String(body.expirationDate || ''))
      : (existing ? (existing.expirationDate || '') : '');

    const fields = {
      barcode, name: validator.escape(String(body.name)), priceCents,
      expirationDate,
      category: validator.escape(String(body.category || (existing ? existing.category : ''))),
      supplier: validator.escape(String(body.supplier || (existing ? existing.supplier : ''))),
      stock: body.stock === 'on' ? 0 : 1, minStock, image, quantity,
      baseUnit, unitsPerStrip, unitsPerBox, stripPriceCents, boxPriceCents, defaultSaleUnit
    };
    let savedProductId = id;
    transaction(() => {
      let productId = id;
      const savedBarcode = barcode === null
        ? Number(db.prepare('SELECT COALESCE(MAX(barcode), 1000000000) + 1 AS barcode FROM products').get().barcode)
        : barcode;
      if (id) {
        db.prepare(`UPDATE products SET barcode=?, name=?, price_cents=?, expiration_date=?, category=?,
          supplier=?, stock_tracked=?, min_stock=?, img=?, base_unit=?, units_per_strip=?, units_per_box=?,
          strip_price_cents=?, box_price_cents=?, default_sale_unit=? WHERE id=?`).run(
          savedBarcode, fields.name, fields.priceCents, fields.expirationDate, fields.category,
          fields.supplier, fields.stock, fields.minStock, fields.image, fields.baseUnit,
          fields.unitsPerStrip, fields.unitsPerBox, fields.stripPriceCents, fields.boxPriceCents,
          fields.defaultSaleUnit, id);
        db.prepare('UPDATE inventory SET quantity=? WHERE product_id=?').run(quantity, id);

        if (fields.expirationDate && fields.expirationDate !== existing.expirationDate) {
          const newIso = moment(fields.expirationDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM-DD');
          const pBatches = db.prepare('SELECT id FROM inventory_batches WHERE product_id = ?').all(id);
          if (pBatches.length === 1) {
            db.prepare('UPDATE inventory_batches SET expiry_date = ? WHERE id = ?').run(newIso, pBatches[0].id);
          } else if (pBatches.length === 0 && quantity > 0) {
            db.prepare(`INSERT INTO inventory_batches (product_id, batch_number, expiry_date, initial_quantity, quantity_available, unit_cost_cents, received_date)
              VALUES (?, 'INITIAL', ?, ?, ?, 0, date('now'))`).run(id, newIso, quantity, quantity);
          }
          const auditUserId = body.userId || (req.user && req.user.id) || null;
          audit(auditUserId, 'UPDATE_PRODUCT_EXPIRY', 'products', id, {
            old_expiry: existing.expirationDate,
            new_expiry: fields.expirationDate
          });
        }
      } else {
        productId = Number(db.prepare(`INSERT INTO products
          (barcode,name,price_cents,expiration_date,category,supplier,stock_tracked,min_stock,img,base_unit,units_per_strip,units_per_box,strip_price_cents,box_price_cents,default_sale_unit)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(savedBarcode, fields.name, fields.priceCents,
          fields.expirationDate, fields.category, fields.supplier, fields.stock, fields.minStock, fields.image,
          fields.baseUnit, fields.unitsPerStrip, fields.unitsPerBox, fields.stripPriceCents, fields.boxPriceCents,
          fields.defaultSaleUnit).lastInsertRowid);
        db.prepare('INSERT INTO inventory(product_id,quantity) VALUES (?,?)').run(productId, quantity);
      }
      savedProductId = productId;
      if (!existing || Number(existing.quantity) !== quantity) {
        db.prepare(`INSERT INTO stock_adjustments(product_id,before_quantity,after_quantity,reason)
          VALUES (?,?,?,?)`).run(productId, existing ? Number(existing.quantity) : 0, quantity, id ? 'Product edit' : 'Initial stock');
      }
    });
    if (body.remove === '1' && existing && existing.img && !req.file) {
      const oldFile = path.join(uploads, sanitizeFilename(existing.img));
      try { fs.unlinkSync(oldFile); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') console.error(unlinkError); }
    }
    res.status(200).json({ id: savedProductId, product: byId(savedProductId) });
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) {
      return res.status(409).json({ error: 'Duplicate barcode', message: 'A product with this barcode already exists.' });
    }
    if (/Invalid|non-negative|Money/.test(error.message)) return res.status(400).json({ error: 'Invalid product', message: error.message });
    console.error(error);
    res.status(500).json({ error: 'Product save failed', message: 'Product was not saved.' });
  }
}));

app.delete('/product/:productId', (req, res) => {
  try {
    const id = validId(req.params.productId);
    transaction(() => {
      db.prepare('DELETE FROM stock_adjustments WHERE product_id=?').run(id);
      db.prepare('DELETE FROM inventory WHERE product_id=?').run(id);
      if (db.prepare('DELETE FROM products WHERE id=?').run(id).changes !== 1) throw new Error('Product not found.');
    });
    res.sendStatus(200);
  } catch (error) {
    res.status(/FOREIGN KEY constraint/.test(error.message) ? 409 : 400).json({ error: 'Product delete failed', message: error.message });
  }
});

app.get('/batches/:productId', (req, res) => {
  try {
    const productId = validId(req.params.productId);
    const prod = byId(productId);
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    let batches = db.prepare(`
      SELECT b.id, b.product_id, b.supplier_id, b.purchase_id, b.batch_number,
             b.expiry_date, b.initial_quantity, b.quantity_available, b.unit_cost_cents,
             b.received_date, s.name as supplier_name
      FROM inventory_batches b
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.product_id = ?
      ORDER BY b.expiry_date ASC, b.id ASC
    `).all(productId);

    if (batches.length === 0 && Number(prod.quantity) > 0) {
      const formattedExpiry = prod.expirationDate
        ? moment(prod.expirationDate, ['DD-MMM-YYYY', 'YYYY-MM-DD']).format('YYYY-MM-DD')
        : moment().add(1, 'year').format('YYYY-MM-DD');
      const ins = db.prepare(`
        INSERT INTO inventory_batches (product_id, batch_number, expiry_date, initial_quantity, quantity_available, unit_cost_cents, received_date)
        VALUES (?, 'INITIAL', ?, ?, ?, 0, date('now'))
      `).run(productId, formattedExpiry, Number(prod.quantity), Number(prod.quantity));
      batches = db.prepare(`
        SELECT b.id, b.product_id, b.supplier_id, b.purchase_id, b.batch_number,
               b.expiry_date, b.initial_quantity, b.quantity_available, b.unit_cost_cents,
               b.received_date, '' as supplier_name
        FROM inventory_batches b
        WHERE b.id = ?
      `).all(ins.lastInsertRowid);
    }

    res.json({ product: prod, batches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/batch/:batchId', (req, res) => {
  try {
    const batchId = validId(req.params.batchId);
    const existingBatch = db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId);
    if (!existingBatch) return res.status(404).json({ error: 'Batch not found' });

    const batchNumber = String(req.body.batch_number ?? existingBatch.batch_number).trim();
    if (!batchNumber) return res.status(400).json({ error: 'Invalid batch', message: 'Batch number cannot be empty.' });

    const rawExpiry = String(req.body.expiry_date ?? existingBatch.expiry_date ?? '').trim();
    if (!rawExpiry) return res.status(400).json({ error: 'Invalid batch', message: 'Expiry date is required.' });

    const m = moment(rawExpiry, ['YYYY-MM-DD', 'DD-MMM-YYYY', 'DD/MM/YYYY'], true);
    if (!m.isValid()) {
      return res.status(400).json({ error: 'Invalid batch', message: 'Invalid expiry date format. Expected YYYY-MM-DD or DD-MMM-YYYY.' });
    }
    if (m.year() < 1990 || m.year() > 2100) {
      return res.status(400).json({ error: 'Invalid batch', message: 'Expiry year must be between 1990 and 2100.' });
    }

    const isoDate = m.format('YYYY-MM-DD');
    const legacyDate = m.format('DD-MMM-YYYY');
    const isPast = m.isSameOrBefore(moment(), 'day');

    const dup = db.prepare(`
      SELECT id FROM inventory_batches
      WHERE product_id = ? AND batch_number = ? AND expiry_date = ? AND id != ?
    `).get(existingBatch.product_id, batchNumber, isoDate, batchId);
    if (dup) {
      return res.status(409).json({ error: 'Duplicate batch', message: 'A batch with this batch number and expiry date already exists for this medicine.' });
    }

    const currentCost = Number(existingBatch.unit_cost_cents || 0);
    let newUnitCostCents = currentCost;
    let costWasSet = false;
    let customTotalCostCents = null;

    if ((req.body.unit_cost !== undefined && req.body.unit_cost !== null && String(req.body.unit_cost).trim() !== '') ||
        (req.body.pack_cost !== undefined && req.body.pack_cost !== null && String(req.body.pack_cost).trim() !== '')) {
      const canManageProducts = req.authUser && (req.authUser._id === 1 || req.authUser.perm_products === 1);
      if (!canManageProducts) {
        return res.status(403).json({ error: 'Permission denied', message: 'Only authorized users can set batch cost.' });
      }

      if (currentCost > 0) {
        const attemptedCost = Math.round(parseFloat(req.body.unit_cost || req.body.pack_cost) * 100);
        if (attemptedCost !== currentCost) {
          return res.status(400).json({ error: 'Cost locked', message: 'Cannot modify cost for a batch that already has a known cost.' });
        }
      } else {
        const rawCost = req.body.unit_cost || req.body.pack_cost;
        const parsedCost = parseFloat(rawCost);
        if (isNaN(parsedCost) || parsedCost <= 0) {
          return res.status(400).json({ error: 'Invalid cost', message: 'Batch cost must be a positive number.' });
        }
        const costStr = String(rawCost).trim();
        const parts = costStr.split('.');
        if (parts.length === 2 && parts[1].length > 2) {
          return res.status(400).json({ error: 'Invalid cost', message: 'Batch cost cannot have more than 2 decimal places.' });
        }

        const packMultiplier = Number(req.body.pack_multiplier || 1);
        if (packMultiplier > 1 && req.body.pack_cost) {
          const packCostCents = Math.round(parsedCost * 100);
          newUnitCostCents = Math.round(packCostCents / packMultiplier);
          customTotalCostCents = Math.round((packCostCents * existingBatch.quantity_available) / packMultiplier);
        } else {
          newUnitCostCents = Math.round(parsedCost * 100);
          customTotalCostCents = existingBatch.quantity_available * newUnitCostCents;
        }
        costWasSet = true;
      }
    }

    let updatedProduct;
    transaction(() => {
      if (costWasSet) {
        const batchTotalCost = customTotalCostCents != null ? customTotalCostCents : (existingBatch.quantity_available * newUnitCostCents);
        db.prepare(`
          UPDATE inventory_batches
          SET batch_number = ?, expiry_date = ?, unit_cost_cents = ?,
              total_cost_cents = ?, initial_quantity = ?, costed_units = 0, cumulative_cost_cents = 0, cost_known = 1
          WHERE id = ?
        `).run(
          batchNumber, isoDate, newUnitCostCents,
          batchTotalCost,
          existingBatch.quantity_available,
          batchId
        );
      } else {
        db.prepare('UPDATE inventory_batches SET batch_number = ?, expiry_date = ? WHERE id = ?')
          .run(batchNumber, isoDate, batchId);
      }

      const activeBatches = db.prepare(`
        SELECT expiry_date FROM inventory_batches
        WHERE product_id = ? AND quantity_available > 0
        ORDER BY expiry_date ASC, id ASC
      `).all(existingBatch.product_id);

      let earliestExpiry = legacyDate;
      if (activeBatches.length > 0) {
        earliestExpiry = moment(activeBatches[0].expiry_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']).format('DD-MMM-YYYY');
      } else {
        const anyBatches = db.prepare(`
          SELECT expiry_date FROM inventory_batches
          WHERE product_id = ?
          ORDER BY expiry_date ASC, id ASC
        `).all(existingBatch.product_id);
        if (anyBatches.length > 0) {
          earliestExpiry = moment(anyBatches[0].expiry_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']).format('DD-MMM-YYYY');
        }
      }

      db.prepare('UPDATE products SET expiration_date = ? WHERE id = ?')
        .run(earliestExpiry, existingBatch.product_id);

      const userId = req.body.userId || (req.user && req.user.id) || null;
      audit(
        userId,
        'UPDATE_BATCH',
        'inventory_batches',
        batchId,
        {
          product_id: existingBatch.product_id,
          old_batch_number: existingBatch.batch_number,
          new_batch_number: batchNumber,
          old_expiry: existingBatch.expiry_date,
          new_expiry: isoDate,
          earliest_product_expiry: earliestExpiry,
          is_past_expiry: isPast,
        }
      );
      if (costWasSet) {
        audit(
          userId,
          'SET_BATCH_COST',
          'inventory_batches',
          batchId,
          {
            product_id: existingBatch.product_id,
            batch_number: batchNumber,
            old_cost_cents: 0,
            new_cost_cents: newUnitCostCents,
          }
        );
      }
      console.log(`[AUDIT] Batch ${batchId} updated: product=${existingBatch.product_id}, batch=${batchNumber}, expiry=${isoDate} (was ${existingBatch.expiry_date}), earliest_expiry=${earliestExpiry}${costWasSet ? `, cost_set=${newUnitCostCents}` : ''}`);

      updatedProduct = byId(existingBatch.product_id);
    });

    res.json({
      success: true,
      message: isPast ? 'Batch updated. Warning: expiry date is in the past.' : 'Batch updated successfully.',
      warning: isPast ? 'Expiry date is in the past. This batch will be marked expired.' : null,
      batch: db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId),
      product: updatedProduct
    });
  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({ error: 'Batch update failed', message: error.message });
  }
});

// Used inside the same SQLite transaction as the sale and its item records.
app.validateBasket = function (items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Sale has no items.');
  const quantities = new Map();
  const lines = [];
  for (const item of items) {
    const id = validId(item.id);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid sale quantity.');
    const current = byId(id);
    if (!current) throw new Error(`Product ${id} does not exist.`);

    // Server-derived multiplier and tier price (Condition C4)
    const unitName = item.sale_unit || item.unit || 'base';
    const { unit: resolvedUnit, multiplier } = resolveUnitMultiplier(current, unitName);
    const expectedPriceCents = resolveTierPriceCents(current, resolvedUnit);

    if (cents(item.price) !== expectedPriceCents) {
      throw new Error(`Price changed for ${current.name}. Refresh the basket.`);
    }

    let expiryStr = current.expirationDate;
    if (!expiryStr) {
      const earliestBatch = db.prepare('SELECT expiry_date FROM inventory_batches WHERE product_id = ? AND quantity_available > 0 ORDER BY expiry_date ASC LIMIT 1').get(id);
      if (earliestBatch) expiryStr = moment(earliestBatch.expiry_date, ['YYYY-MM-DD', 'DD-MMM-YYYY']).format('DD-MMM-YYYY');
    }
    const expiry = moment.utc(expiryStr, 'DD-MMM-YYYY', true).utcOffset(300, true);
    if (!expiry.isValid() || expiry.isSameOrBefore(moment().utcOffset(300), 'day')) {
      throw new Error(`${current.name} is expired or has an invalid expiry date.`);
    }

    const baseQuantity = quantity * multiplier;
    quantities.set(id, (quantities.get(id) || 0) + baseQuantity);
    lines.push({
      id,
      quantity,
      sale_unit: resolvedUnit,
      pack_multiplier: multiplier,
      base_quantity: baseQuantity,
      productName: current.name,
      priceCents: expectedPriceCents
    });
  }

  // Combined multi-line stock check across all lines of the same medicine
  for (const [id, totalBaseQty] of quantities) {
    const current = byId(id);
    if (current.stock === 1 && Number(current.quantity) < totalBaseQty) {
      throw new Error(`Insufficient stock for ${current.name}.`);
    }
  }
  return { quantities, lines };
};

app.deductBasket = function (quantities, saleId = null) {
  let index = 0;
  for (const [id, quantity] of quantities) {
    const current = byId(id);
    if (current.stock !== 1) {
      if (saleId) {
        db.prepare(`
          INSERT OR IGNORE INTO sale_batch_cogs (sale_id, product_id, batch_id, quantity, unit_cost_cents, cost_cents, cost_known)
          VALUES (?, ?, NULL, ?, NULL, NULL, 0)
        `).run(saleId, id, quantity);
      }
      continue;
    }
    const result = db.prepare('UPDATE inventory SET quantity=quantity-? WHERE product_id=? AND quantity>=?').run(quantity, id, quantity);
    if (result.changes !== 1) throw new Error(`Insufficient stock for ${current.name}.`);

    // FEFO batch deduction (First Expired First Out) in base units
    const batches = db.prepare('SELECT * FROM inventory_batches WHERE product_id = ? AND quantity_available > 0 ORDER BY expiry_date ASC, id ASC').all(id);
    let remaining = quantity;
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity_available, remaining);
      remaining -= take;

      let cogsCostCents = null;
      let costKnown = 0;
      let unitCostToRecord = null;

      if (b.total_cost_cents != null && Number(b.total_cost_cents) > 0 && b.initial_quantity > 0) {
        costKnown = 1;
        const kOld = Number(b.costed_units || 0);
        const kNew = kOld + take;
        cogsCostCents = calcCostAllocation(kOld, kNew, Number(b.total_cost_cents), Number(b.initial_quantity));
        const newCumulative = calcCumulativeCost(kNew, Number(b.total_cost_cents), Number(b.initial_quantity));
        unitCostToRecord = b.unit_cost_cents != null && Number(b.unit_cost_cents) > 0
          ? Number(b.unit_cost_cents)
          : Math.round(Number(b.total_cost_cents) / Number(b.initial_quantity));

        db.prepare(`
          UPDATE inventory_batches
          SET quantity_available = quantity_available - ?,
              costed_units = ?,
              cumulative_cost_cents = ?
          WHERE id = ?
        `).run(take, kNew, newCumulative, b.id);
      } else {
        // Fallback for older batches without total_cost_cents
        const hasKnownCost = b.unit_cost_cents != null && Number(b.unit_cost_cents) > 0;
        costKnown = hasKnownCost ? 1 : 0;
        unitCostToRecord = hasKnownCost ? Number(b.unit_cost_cents) : null;
        cogsCostCents = hasKnownCost ? Math.round(take * Number(b.unit_cost_cents)) : null;

        db.prepare(`
          UPDATE inventory_batches
          SET quantity_available = quantity_available - ?,
              costed_units = costed_units + ?,
              cumulative_cost_cents = cumulative_cost_cents + ?
          WHERE id = ?
        `).run(take, take, cogsCostCents || 0, b.id);
      }

      if (saleId) {
        db.prepare(`
          INSERT OR IGNORE INTO sale_batch_cogs (sale_id, product_id, batch_id, quantity, unit_cost_cents, cost_cents, cost_known)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(saleId, id, b.id, take, unitCostToRecord, cogsCostCents, costKnown);
      }
    }

    if (remaining > 0 && saleId) {
      db.prepare(`
        INSERT OR IGNORE INTO sale_batch_cogs (sale_id, product_id, batch_id, quantity, unit_cost_cents, cost_cents, cost_known)
        VALUES (?, ?, NULL, ?, NULL, NULL, 0)
      `).run(saleId, id, remaining);
    }

    if (++index === 1 && process.env.APPNAME === 'PharmaSpotTest' &&
        process.env.PHARMASPOT_TEST_SALE_FAILPOINT === 'after_first_stock') process.kill(process.pid, 'SIGKILL');
  }
};

module.exports = app;
