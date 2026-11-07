# Changelog

## 1.5.5 (Feature Update) - 2026-11-07

- **Pack Sizes (Box / Strip / Unit):**
  - Added configurable multi-unit hierarchy (`units_per_box`, `units_per_strip`, `base_unit`) across products, sales, and purchases.
  - Implemented exact integer-cost allocation without fractional rounding drift (`api/pack-helpers.js`).
  - Added multi-unit selector directly in the POS cart for instant switching between Box, Strip, and single Tablet/Capsule/Bottle.
  - Preserved seamless backward compatibility for legacy products without pack configurations.
- **Purchases & Trade Discounts:**
  - Added supplier trade discount percentage (`discount_percent`) to purchase lines.
  - Implemented live unit cost preview (`= 500 Tablets, cost PKR 7.60 per Tablet`) calculating diluted costs including bonus quantities.
- **Redesigned Product & Purchase Modals:**
  - Redesigned Add/Edit Medicine form with intuitive "Single item" vs "In strips / boxes" tabs and live pack calculation summary.
  - Upgraded Purchase modal with responsive medicine cards, unit selectors, and live cost summaries.
- **True Profit & Loss with Batch COGS:**
  - Introduced `sale_batch_cogs` table to track exact Cost of Goods Sold for every batch deducted via FEFO.
  - Segregated legacy sales without known cost records, protecting profit margins from artificial distortion.
  - Built comprehensive Profit & Loss report showing Net Sales, Cost of Goods Sold, Gross Profit, Operating Expenses, and Net Profit.
- **Executive Dashboard:**
  - Added real-time cards for Customer Receivables (Khata), Supplier Payables, Monthly Sales, Gross Profit, Expenses, and Net Profit.
  - Added 12-month visual performance chart tracking Sales, Expenses, and Net Profit.
- **Report Center Fixes:**
  - Resolved report selection and display routing across all report types.
  - Fixed Top / Dead stock report to display resolved medicine brand names and category titles.
- **WCAG 2.1 AA Compliant Dark Theme:**
  - Built universal theme engine with instant toggle in the top navigation bar (`#theme-toggle`).
  - Achieved full WCAG AA contrast compliance across all screens, modals, tables, and charts.
  - Enforced strict white paper styling on receipts and printed invoices for thermal and A4 printers.
- **Documentation & Real Screenshots:**
  - Complete rewrite of `README.md` with beginner-friendly guides, verified worked examples, and architecture diagrams.
  - Generated 13 real application screenshots in light and dark modes using isolated demo data.

## 1.5.5 (Initial Release) - 2026-10-27

- Rebranded the Windows desktop application and installer as Multi Medicos while preserving the `PharmaSpot` data path for upgrades.
- Added first-run owner creation, stronger credential/session handling, user management, and role enforcement.
- Added SQLite-backed suppliers, purchases, batches, FEFO stock movement, returns, expenses, customer Khata, payments, and double-entry accounting.
- Added cash, credit, and mixed-payment sales with atomic stock/accounting updates and duplicate/retry protection.
- Simplified supplier and purchase workflows and retained the customized green pharmacy UI.
- Hid Ledger and Cashbook screens while preserving their accounting records and calculations.
- Added integrity-checked in-app backup and restart-safe restore with a retained safety copy.
- Added isolated integration and Electron UI verification scripts plus Windows Squirrel packaging.

See [release notes](docs/RELEASE-NOTES-1.5.5.md) for artifact-specific information.
