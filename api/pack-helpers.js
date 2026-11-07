/**
 * Pure helper functions for pack sizes, integer cost allocation, and stock display.
 * Conserves single-paisa precision using exact integer arithmetic (no floating point).
 */

function formatUnitName(count, unitName) {
  if (!unitName) return '';
  const u = String(unitName).trim();
  if (!u) return '';
  if (count === 1) return `${count} ${u}`;

  const lower = u.toLowerCase();
  if (lower === 'box') return `${count} Boxes`;
  if (lower === 'strip') return `${count} Strips`;
  if (lower === 'tablet') return `${count} Tablets`;
  if (lower === 'capsule') return `${count} Capsules`;
  if (lower === 'bottle') return `${count} Bottles`;
  if (lower === 'sachet') return `${count} Sachets`;
  if (lower === 'ampoule' || lower === 'ampule') return `${count} Ampoules`;
  if (lower === 'vial') return `${count} Vials`;
  if (lower === 'pack') return `${count} Packs`;
  if (lower === 'piece') return `${count} Pieces`;
  if (lower === 'tube') return `${count} Tubes`;
  if (lower === 'inhaler' || lower === 'inhalation') return `${count} Inhalers`;
  if (lower === 'suppository') return `${count} Suppositories`;

  // Mass, volume, metric abbreviations or already plural words
  const uninflected = ['ml', 'mg', 'g', 'kg', 'l', 'iu', 'mcg', 'oz', 'cc', 'drops'];
  if (uninflected.includes(lower)) return `${count} ${u}`;

  if (lower.endsWith('s')) return `${count} ${u}`;
  return `${count} ${u}s`;
}

function formatStockPacks(baseQty, unitsPerBox, unitsPerStrip, baseUnitName) {
  if (baseQty == null || isNaN(baseQty)) return '0';
  const isNeg = baseQty < 0;
  let remaining = Math.abs(Math.round(baseQty));

  const boxSize = Number(unitsPerBox);
  const stripSize = Number(unitsPerStrip);
  const hasBox = Number.isSafeInteger(boxSize) && boxSize > 1;
  const hasStrip = Number.isSafeInteger(stripSize) && stripSize > 1;
  const hasPackLevel = hasBox || hasStrip;

  const rawBase = baseUnitName ? String(baseUnitName).trim() : '';
  // Treat base_unit as unset when no pack levels exist and it was default 'Tablet' or empty
  const effectiveBase = (!hasPackLevel && (!rawBase || rawBase.toLowerCase() === 'tablet')) ? '' : rawBase;
  const hasBaseUnit = Boolean(effectiveBase);

  // Condition C3: Products without pack settings show stock exactly as today ("Stock: 16", no unit word)
  if (!hasBox && !hasStrip && !hasBaseUnit) {
    return String(baseQty);
  }

  const parts = [];

  if (hasBox) {
    const boxes = Math.floor(remaining / boxSize);
    if (boxes > 0) {
      parts.push(formatUnitName(boxes, 'Box'));
      remaining %= boxSize;
    }
  }

  if (hasStrip) {
    const strips = Math.floor(remaining / stripSize);
    if (strips > 0) {
      parts.push(formatUnitName(strips, 'Strip'));
      remaining %= stripSize;
    }
  }

  if (remaining > 0 || parts.length === 0) {
    const unitLabel = effectiveBase || (hasPackLevel ? 'Tablet' : 'Unit');
    parts.push(formatUnitName(remaining, unitLabel));
  }

  const result = parts.join(' + ');
  return isNeg ? `-${result}` : result;
}

/**
 * Pure integer rounding: floor((2 * k * C + Q) / (2 * Q))
 * Exactly evaluates to C when k === Q. Zero floating point drift.
 */
function calcCumulativeCost(k, totalCostCents, initialQty) {
  if (!totalCostCents || !initialQty || k <= 0) return 0;
  if (k >= initialQty) return totalCostCents;

  const kNum = BigInt(Math.max(0, Math.floor(k)));
  const cNum = BigInt(Math.max(0, Math.floor(totalCostCents)));
  const qNum = BigInt(Math.max(1, Math.floor(initialQty)));

  const numerator = (2n * kNum * cNum) + qNum;
  const denominator = 2n * qNum;
  return Number(numerator / denominator);
}

function calcCostAllocation(kOld, kNew, totalCostCents, initialQty) {
  const oldCost = calcCumulativeCost(kOld, totalCostCents, initialQty);
  const newCost = calcCumulativeCost(kNew, totalCostCents, initialQty);
  return Math.max(0, newCost - oldCost);
}

function adjustBatchStock(batch, deltaQty, unitCostOverrideCents = null) {
  const delta = Math.floor(Number(deltaQty));
  if (delta === 0) {
    return {
      deltaQty: 0,
      costDeltaCents: 0,
      newTotalCost: Number(batch.total_cost_cents || 0),
      newInitialQty: Number(batch.initial_quantity || 0),
      newQuantityAvailable: Number(batch.quantity_available || 0)
    };
  }

  const totalCost = Number(batch.total_cost_cents || 0);
  const initialQty = Number(batch.initial_quantity || 0);
  const costedUnits = Number(batch.costed_units || 0);
  const cumCost = Number(batch.cumulative_cost_cents || 0);
  const unsoldUnits = Math.max(1, initialQty - costedUnits);
  const remainingCost = Math.max(0, totalCost - cumCost);

  let costDeltaCents = 0;
  let newTotalCost = totalCost;
  let newInitialQty = initialQty;

  if (delta < 0) {
    const removeQty = Math.min(Math.abs(delta), Number(batch.quantity_available || 0));
    costDeltaCents = calcCostAllocation(0, removeQty, remainingCost, unsoldUnits);
    newTotalCost = Math.max(cumCost, totalCost - costDeltaCents);
    newInitialQty = Math.max(costedUnits, initialQty - removeQty);
  } else {
    const effectiveUnitCost = unitCostOverrideCents != null
      ? unitCostOverrideCents
      : (unsoldUnits > 0 ? Math.round(remainingCost / unsoldUnits) : Number(batch.unit_cost_cents || 0));
    costDeltaCents = delta * effectiveUnitCost;
    newTotalCost = totalCost + costDeltaCents;
    newInitialQty = initialQty + delta;
  }

  return {
    deltaQty: delta,
    costDeltaCents,
    newTotalCost,
    newInitialQty,
    newQuantityAvailable: Number(batch.quantity_available || 0) + delta
  };
}

function resolveUnitMultiplier(product, unitName) {
  if (!unitName) return { unit: 'base', multiplier: 1 };
  const raw = String(unitName).trim().toLowerCase();
  const baseName = (product.base_unit || '').trim().toLowerCase();

  if (raw === 'base' || raw === 'unit' || (baseName && raw === baseName)) {
    return { unit: 'base', multiplier: 1 };
  }

  if (raw === 'box') {
    const boxSize = Number(product.units_per_box);
    if (!Number.isSafeInteger(boxSize) || boxSize < 2) {
      throw new Error(`Product ${product.name} does not have a Box pack configuration.`);
    }
    return { unit: 'box', multiplier: boxSize };
  }

  if (raw === 'strip') {
    const stripSize = Number(product.units_per_strip);
    if (!Number.isSafeInteger(stripSize) || stripSize < 2) {
      throw new Error(`Product ${product.name} does not have a Strip pack configuration.`);
    }
    return { unit: 'strip', multiplier: stripSize };
  }

  throw new Error(`Invalid unit "${unitName}" for medicine ${product.name}.`);
}

function resolveTierPriceCents(product, unitName) {
  const resolved = resolveUnitMultiplier(product, unitName);
  const basePriceCents = Number(product.price_cents != null ? product.price_cents : Math.round(Number(product.price || 0) * 100));

  if (resolved.unit === 'box') {
    if (product.box_price_cents != null) return Number(product.box_price_cents);
    return basePriceCents * resolved.multiplier;
  }

  if (resolved.unit === 'strip') {
    if (product.strip_price_cents != null) return Number(product.strip_price_cents);
    return basePriceCents * resolved.multiplier;
  }

  return basePriceCents;
}

module.exports = {
  formatUnitName,
  formatStockPacks,
  calcCumulativeCost,
  calcCostAllocation,
  adjustBatchStock,
  resolveUnitMultiplier,
  resolveTierPriceCents
};
