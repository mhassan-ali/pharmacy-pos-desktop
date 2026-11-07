# Multi Medicos - Windows Installation Guide

Multi Medicos is a self-contained, offline Windows pharmacy application. The client computer does not require Node.js, npm, Git, SQLite, or an external database server.

## System Requirements

- **Operating System:** Windows 10 or 11 (64-bit).
- **Permissions:** Standard local user installation permissions.
- **Disk Space:** Approximately 500 MB of free storage.
- **Source:** An official setup file obtained from GitHub Releases or your system administrator.

## Installation on a New Computer

1. Download `Multi-Medicos-1.5.5-Setup.exe` from the official releases page.
2. Verify the SHA-256 checksum against published release notes and close any running Multi Medicos processes.
3. Run `Multi-Medicos-1.5.5-Setup.exe`.
   - **SmartScreen Notice:** Because this community distribution is unsigned, Windows SmartScreen may display an **"Unknown publisher"** alert. Click **More info**, then click **Run anyway**. Do not disable Windows Defender or security protections.
4. Launch **Multi Medicos** from your desktop or Start Menu shortcut.
5. On the initial startup screen, enter an **Owner Username** and a secure **Password** containing **at least 12 characters**, then click **Create Owner Account**.

A fresh installation contains clean schema and accounting definitions. It ships with no default credentials, no development databases, and no demo medicines.

## Initial Pharmacy Setup

1. **Configure Store Identity:** Open **Settings** (gear icon) to set your pharmacy name, address, phone number, and receipt footer text.
2. **Add Categories:** Click **Categories (+)** to create categories such as *Tablets & Capsules*, *Syrups*, *Injections*, etc.
3. **Add Suppliers:** Go to **Suppliers → Add Supplier** to register your medicine distributors and their credit terms (e.g., Net 30).
4. **Add Medicines:**
   - **Single Unit Items (Syrups, Injections, Drops):** Choose **Single item**, select the unit (Bottle, Ampoule, Tube), and enter the selling price.
   - **Pack Items (Blister Packs, Tablets, Capsules):** Choose **In strips / boxes**. Enter units per strip (e.g., 10), strips per box (e.g., 10), box retail price, strip retail price, and single tablet price.
5. **Enter Purchases:** Open **Purchases → New Purchase**. Select the supplier, enter the invoice number, search the medicine, choose the purchase unit (Box or Strip), quantity, purchase cost, supplier discount %, batch number, and expiry date. The system displays a live unit cost preview (e.g., `= 500 Tablets, cost PKR 7.60 per Tablet`).
6. **Receive Goods:** Mark the purchase as **Received** when stock physically arrives. Aggregate inventory and FEFO batch balances update automatically.
7. **Register Customers for Khata:** Add regular customers under **Customer Khata** with phone numbers and credit limits before recording credit or mixed sales.

## Customer Khata (Udhaar)

When a customer wishes to buy on credit, select their name in the POS customer dropdown before completing the sale. You can accept partial cash or mark the entire bill as credit. The outstanding balance is recorded under **Customer Khata**, where you can print statements and record payment collections.

## Backup Workflow

1. Click **File → Backup**.
2. Select a secure destination outside `%APPDATA%\PharmaSpot` (preferably an encrypted external USB drive).
3. Wait for the confirmation message: **Backup Successful**.

> [!TIP]
> Perform a backup at the end of every business day and always before installing application updates.

## Restore Workflow

1. Click **File → Restore** and select your Multi Medicos backup archive (`.zip`).
2. Confirm the restore prompt.
3. Multi Medicos validates archive integrity, stages the database, moves existing live data to a dated safety folder (`PharmaSpot-before-restore-*`), and restarts the application.
4. Verify your store settings, medicines, stock counts, and customer balances.

## Updating an Existing Installation

> [!WARNING]
> **Database migrations are one-way.**
> When upgrading, the SQLite schema is automatically migrated to support new features. **Never downgrade to an older software version after using a newer one.**
>
> 1. Always create a verified backup using **File → Backup** before updating.
> 2. Close Multi Medicos completely.
> 3. Run the newer `Multi-Medicos-<version>-Setup.exe` installer.
> 4. Launch Multi Medicos and confirm existing records.

Updates continue using your existing data folder:
```text
%APPDATA%\PharmaSpot\
```
Do not rename or delete this folder during an upgrade.

## Safe Uninstallation

1. Create a backup via **File → Backup** and save it to external storage.
2. Close the application.
3. Uninstall Multi Medicos via **Windows Settings → Apps → Installed apps**.
4. The `%APPDATA%\PharmaSpot` folder is preserved by default to protect your pharmacy data.
