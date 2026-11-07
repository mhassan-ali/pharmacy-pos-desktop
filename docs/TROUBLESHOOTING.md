# Troubleshooting

## Development Install Fails

Confirm `node --version` reports Node.js 24.x and `npm --version` reports npm 11.x. From the repository root, run `npm ci`. If a previous dependency folder is corrupted, remove only `node_modules` and rerun `npm ci`; do not touch `%APPDATA%\PharmaSpot`.

## `node:sqlite` Cannot be Found

The backend uses Node's native built-in SQLite engine (`node:sqlite`). Older Node.js versions (e.g., Node 18 or 20) do not provide the required `DatabaseSync` API. Install **Node.js 24 x64**. Packaged desktop applications use Electron's bundled runtime and do not require system Node.js.

## Electron Opens No Window

Run `npm start` from a PowerShell terminal to inspect startup logs.
- Terminate any orphaned `electron.exe` or `Multi Medicos.exe` processes via Task Manager or `Stop-Process -Name electron -Force`.
- Check whether antivirus software quarantined project binaries.
- If an explicit `PORT` was set and is already occupied, clear the environment variable or choose an open port.

## Owner Setup or Login Screen is Unexpected

A fresh database displays **Create Owner Account** and requires a password of at least 12 characters. If a standard login screen appears with a pre-existing username, your Windows profile already contains existing Multi Medicos / PharmaSpot data. Do not guess credentials or delete the folder without taking a backup first.

## SQLite Initialization Fails

Verify that the Windows user account has full read/write permissions for `%APPDATA%\PharmaSpot`, that the disk has sufficient free space, and that no external SQLite browser has locked `pharmacy.sqlite`. Never manually copy a live `.sqlite` file while the application is active in WAL mode; use the in-app **File → Backup** feature.

## Existing Data Missing After an Update

Close the application and verify whether Windows launched it under a different Windows user profile. The default data path is `%APPDATA%\PharmaSpot`. Check whether a prior backup exists before attempting reinstallation.

## Backup or Restore Fails

- **Backup:** Use **File → Backup** while the application is running normally and select a writable destination outside the live data folder (e.g., an external drive).
- **Restore:** Multi Medicos verifies archive structure and SQLite database integrity before staging the restore. On application restart, the existing data is moved to a safety folder named `PharmaSpot-before-restore-*` beside your data folder. Keep this folder until restored records are verified.

## Financial Reports / Cost Data Return Permission Denied

Viewing product purchase costs, supplier invoice histories, and the Profit & Loss report requires financial permissions. Standard cashier accounts without `perm_transactions` cannot access `/api/reports/profit-loss`. Log in as the Owner account (`user_id = 1`) or grant transaction permissions to the cashier profile.

## Pack Sizes Show Incorrect Values

Ensure that the unit hierarchy is configured logically:
- A medicine's `units_per_box` must be greater than or equal to `units_per_strip`.
- Example: If a box has 10 strips and each strip has 10 tablets, enter `10` for Strips/Box and `10` for Units/Strip (Units/Box becomes `100` automatically).
- When entering a purchase, verify whether you selected **Box** or **Strip** in the Purchase Unit dropdown.

## Theme Toggle Does Not Switch Colors

Theme preferences are persisted in `electron-store`. If the theme appears stuck, click the moon/sun icon in the top navigation bar (`#theme-toggle`) or restart the application. Dark mode applies WCAG 2.1 AA contrast styles across all views while strictly keeping receipt previews pure white.

## Installer or SmartScreen Warning

The 1.5.5 installer is unsigned. Windows SmartScreen may show an unknown-publisher warning. Obtain the installer from the official release page, compare its SHA-256 checksum with published release notes, click **More info**, and select **Run anyway**. Do not disable Windows security.

## Reporting an Issue Safely

When reporting an issue on GitHub:
- Include reproduction steps, expected vs. actual behavior, Windows version, and sanitized logs.
- **Never upload live `pharmacy.sqlite` files, backups, customer phone numbers, supplier records, or financial statements.**
