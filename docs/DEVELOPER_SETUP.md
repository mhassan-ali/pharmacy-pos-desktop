# Developer Setup

## Verified Environment

Multi Medicos 1.5.5 is release-verified on Windows 10/11 x64 with Node.js 24.x, npm 11.x, Electron 43.8.4, and Electron Forge 8.0.1.

```powershell
# Clone the repository
git clone https://github.com/mhassan-ali/pharmacy-pos-desktop.git
Set-Location pharmacy-pos-desktop

# Install dependencies reproducibly
npm ci

# Run Jest unit tests
npm test -- --runInBand

# Launch the desktop app in development mode
npm start
```

`npm start` launches the Electron main process (`start.js`). It boots the local loopback Express server (`server.js`), waits for it to listen, and opens `index.html`. Do not start a separate backend server process.

## Automated Verification Suites

The repository contains isolated unit, integration, and UI test scripts. All scripts automatically create isolated temporary application-data directories (`TEST_APPDATA`) and clean them up upon exit:

```powershell
# Unit tests
npm test -- --runInBand

# Authentication, roles, and default replacement
node scripts/test-users.js
node scripts/test-default-replacement.js

# Sales, crash rollback, retry safety, and Khata
node scripts/test-sales.js
node scripts/test-sale-crash.js
node scripts/test-transaction-history.js

# Suppliers, purchases, and discount percentages
node scripts/test-simple-supplier-purchase.js
node scripts/test-task2-purchase-discount.js

# Pack sizes, conversions, and stock math
node scripts/test-pack-sizes.js

# COGS, profit calculations, and Report Center
node scripts/test-profit-and-reports.js

# Double-entry ledger integrity and trial balance
node scripts/test-enterprise-system.js

# Backup, restore staging, and safety copies
node scripts/test-offline-backup.js
node scripts/test-pending-restore.js

# WCAG AA contrast audit across light and dark themes
node scripts/test-contrast-audit.js

# End-to-end Electron UI test runners
node scripts/run-pack-sizes-ui-test.js
node scripts/run-supplier-purchase-ui-test.js
node scripts/run-transaction-ui-test.js

# Headless screenshot capture runner
node scripts/capture-screenshots.js
```

> [!CAUTION]
> Never point tests or automation at `%APPDATA%\PharmaSpot` from a real client installation. Always use `TEST_APPDATA` or the automated runners in `scripts/`.

## Packaging and Windows Installer

```powershell
# Create unpacked application binaries under out/
npm run package

# Create Squirrel.Windows installer setup package
npm run make:win
```

`npm run make:win` outputs:
```text
out/make/squirrel.windows/x64/Multi-Medicos-1.5.5-Setup.exe
```

The `out/` build directory is generated and excluded from git.

## Debugging Guidelines

- API route handlers reside in `api/` and share the SQLite connection exported by `api/sqlite.js`.
- Pack calculation helpers reside in `api/pack-helpers.js`.
- The renderer uses jQuery and communicates with the local API via helpers in `assets/js/pos.js` and `assets/js/enterprise.js`.
- Set `PHARMASPOT_DISABLE_RELOADER=1` when running headless Electron tests to prevent file-watcher reloads.
- Pass an explicit `PORT` (e.g., `PORT=43210`) when running parallel integration tests.
