# Architecture

## Startup and Desktop Process

`package.json` points Electron at `start.js`. The main process initializes `@electron/remote`, `electron-store`, handles Squirrel install/update events through `installers/setupEvents.js`, and applies any verified pending restore through `installers/pendingRestore.js`. It then requires `server.js`, waits for `server.ready`, and creates a maximized `BrowserWindow` that loads `index.html`.

The renderer entry, `renderer.js`, exposes jQuery and loads the POS, product-search, checkout, theme toggle, and enterprise modules. The desktop application uses local Node integration and does not load a hosted web application.

## Frontend to Backend Communication

`server.js` binds Express to `127.0.0.1`, normally on port `3210`. If that default port is busy and no explicit test port was requested, it automatically selects an available loopback port. Requests are JSON/form-encoded, rate-limited, origin-checked, and protected by `api/users.js` authorization before business routes execute.

The main route groups are:

- `api/inventory.js`: medicines, barcode/SKU lookup, stock levels, batch editing, and product images
- `api/pack-helpers.js`: pure pack size calculations, integer cost allocation, and stock string formatting
- `api/customers.js` and `api/categories.js`: customer and category master data
- `api/suppliers.js` and `api/purchases.js`: supplier accounts, purchases, receiving, discount %, and returns
- `api/transactions.js`: held orders, completed sales, invoice detail, and sales returns
- `api/reports.js`: Report Center, COGS-based Profit & Loss, sales, stock valuation, expiry, and dead stock
- `api/ledger.js`: customer Khata statements, supplier payments, opening balances, journals, and dashboard totals
- `api/expenses.js`: expense categories, daily expense entries, and cashbook summaries
- `api/settings.js`: store identity, currency symbol, and receipt logo
- `api/users.js`: first-owner setup, login/logout, sessions, roles, and user management

## SQLite Initialization and Durability

`server.js` sets `APPDATA` and `APPNAME`; `api/sqlite.js` opens:

```text
%APPDATA%\PharmaSpot\server\databases\pharmacy.sqlite
```

The database connection is managed by Node's built-in `node:sqlite` (`DatabaseSync`). It initializes tables and indexes idempotently, applies additive schema migrations across versions, and seeds only standard accounting metadata (chart-of-accounts and default expense categories). It does not seed developer credentials, demo medicines, suppliers, or sales.

SQLite operates with the following durability configuration:
- `PRAGMA foreign_keys = ON;`
- `PRAGMA journal_mode = WAL;` (Write-Ahead Logging for high concurrency)
- `PRAGMA synchronous = FULL;` (Crash safety and durable disk commits)
- `PRAGMA busy_timeout = 5000;`

The exported `transaction(work)` helper uses `BEGIN IMMEDIATE`, commits on completion, and safely rolls back on any error. Application monetary values are stored as integer cents to avoid floating-point rounding errors.

## Inventory, Batches, and Pack Sizes

### Pack Hierarchy & Unit Conversions
Medicines support flexible pack packaging configured via `products`:
- `base_unit`: the atomic unit name (e.g., `Tablet`, `Capsule`, `Bottle`, `Ampoule`). Defaults to `NULL` for legacy items.
- `units_per_strip`: number of atomic units in a strip (e.g., 10).
- `units_per_box`: number of atomic units in a full box (e.g., 100).
- `strip_price_cents` & `box_price_cents`: independent retail prices for strips and boxes.
- `default_sale_unit`: preferred unit selected when an item is added to cart (`box`, `strip`, or `base`).

When selling or purchasing, `api/pack-helpers.js` converts pack quantities to underlying atomic base units without fractional rounding errors:
$$\text{Base Quantity} = \text{Packs} \times \text{Multiplier}$$

### Receiving Purchases
Receiving a purchase in `api/purchases.js`:
1. Validates that the invoice has not already been received.
2. Applies supplier trade discount percentages to calculate the true line total.
3. Calculates exact unit cost per base unit down to the single paisa.
4. Creates records in `purchase_items` and `inventory_batches`.
5. Atomically increments aggregate stock in `inventory`.
6. Records inventory movements and posts balanced double-entry journal lines.

### POS Checkout & FEFO Stock Allocation
Completing a sale in `api/transactions.js`:
1. Verifies payload hash and unique sale identifier to prevent duplicate billing.
2. Validates total amounts, payment methods, and customer credit limits.
3. Deducts stock from `inventory_batches` using First-Expiry-First-Out (FEFO) ordering.
4. Records cost breakdown entries in `sale_batch_cogs` for each deducted batch.
5. Writes `sales` and `sale_items` records.
6. Updates customer receivables for credit (*Khata*) sales portions.
7. Posts revenue, cash, and accounts receivable journal entries.

## Cost of Goods Sold (COGS) & Profit Accounting

Multi Medicos derives gross profit using batch-level Cost of Goods Sold stored in `sale_batch_cogs`:
- **Costed Sales:** Sales where every item's cost is tracked via received batches (`cost_known = 1`).
- **Uncosted Sales:** Sales of legacy items without historical cost records. These are segregated and excluded from profit percentages to prevent artificial inflation.
- **Gross Profit:** $\text{Net Costed Sales} - \text{COGS (adjusted for returns to stock)}$.
- **Net Profit:** $\text{Gross Profit} - \text{Operating Expenses}$.

## Double-Entry Accounting Foundation

The database maintains a chart of accounts, journal entries, journal lines, party balances, payment allocations, expenses, and cashbook records. Operating transactions automatically generate balanced debit and credit entries. While raw General Ledger and Cashbook pages are hidden to keep the pharmacy interface simple, their underlying ledger tables power the Executive Dashboard, Customer Khata, Supplier Statements, and Report Center.

## Backup and Restore Flow

- **Backup:** Handled via the File menu controller (`menuController.js`). Uses `node:sqlite` online backup API, runs SQLite integrity checks, includes receipt logo uploads, and outputs a SHA-256 checksum-verified `.zip` archive.
- **Restore:** Validates archive structure and checksums, extracts files to an isolated sibling staging directory, and writes `restore-pending.json`. On the next application launch, `installers/pendingRestore.js` archives current data to a dated `PharmaSpot-before-restore-*` folder, applies the staged files, and rolls back if database verification fails.

## Packaging and Upgrade Identity

`forge.config.js` packages the application with Electron Forge and Squirrel.Windows:
- `package.json.name` intentionally remains `PharmaSpot` so existing user data at `%APPDATA%\PharmaSpot` is preserved across updates.
- User-facing window titles, shortcuts, metadata, and the installer are branded **Multi Medicos**.
- Database migrations are purely additive and idempotent, ensuring existing databases upgrade smoothly without manual intervention.
