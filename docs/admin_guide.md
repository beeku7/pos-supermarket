# Admin Guide

This guide provides instructions for system administrators to set up, configure and maintain the POS
application.  It assumes familiarity with basic command‑line tools and access to the server or terminal
where the application is deployed.

## Installation

1. **Clone** the repository and change into the project directory.
2. **Create** a `.env` file in `pos/backend` based on `.env.example` and adjust values for your store:
   * `DATABASE_URL` – path to the SQLite database.  For production use, point this to a persistent
     location (e.g. `/var/lib/pos/pos.db`).
   * `STORE_NAME`, `STORE_GSTIN`, `STORE_ADDRESS`, `PLACE_OF_SUPPLY` – populate with your business
     details.  These values appear on printed receipts.
   * `UPI_VPA` and `UPI_PAYER_NAME` – used to generate UPI QR codes on receipts.
3. **Install** dependencies:
   ```bash
   cd pos/backend
   npm install
   ```
4. **Run** database migrations and seed data:
   ```bash
   npm run prisma -- migrate deploy
   npm run seed
   ```
5. **Start** the backend server:
   ```bash
   npm run dev
   ```
6. **Build** and start the frontend:
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

Alternatively, use the provided `docker-compose.yml` to run both services together (see below).

## Users and Roles

The system ships with three predefined roles:

| Role       | Description                                      |
|-----------|--------------------------------------------------|
| Admin     | Full access to all modules including settings and backups |
| Supervisor| Can approve overrides, returns and adjustments    |
| Cashier   | Restricted to sales operations                    |

Create users via the **Admin → Users** section of the UI or using API calls.  Each user should have a
password and an optional PIN for quick approvals.

## GST Settings

India’s GST system requires correct classification of goods and services into tax slabs (0 %, 5 %, 12 %,
18 %, 28 % plus cess).  Use the **Taxes** section to manage rates and assign them to items.  The
application computes CGST and SGST for intra‑state sales and IGST for inter‑state transactions based on
the configured `PLACE_OF_SUPPLY` and the customer’s state.  Ensure that your store’s **GSTIN** and
**Place of Supply** are entered correctly in settings; these values appear on receipts.

## Backups and Maintenance

* **Automatic backups** – the Docker image includes a cron job that performs daily backups of the
  SQLite database into the `/backups` directory.  Adjust the schedule by editing `crontab` in the
  container or by using your host’s scheduling mechanism.
* **Manual backup** – click **Admin → Backups → Export** to download a copy of the database.
* **Restore** – to restore from a backup, stop the backend, replace the database file with the backup
  copy and restart the service.
* **Vacuum/Analyze** – SQLite benefits from occasional `VACUUM` and `ANALYZE` commands to reclaim disk
  space and optimise query plans.  The backend exposes a `/api/admin/maintenance` endpoint to perform
  these tasks; run it during off‑peak hours.

## Hardware Setup

* **Receipt Printer** – connect your 58 mm or 80 mm ESC/POS compatible thermal printer via USB or
  Bluetooth.  In Electron deployments the backend uses the `escpos` library to detect printers and
  render receipts.  Configure the default printer under **Settings → Devices**.
* **Cash Drawer** – most drawers connect to the printer’s kick‑port.  Enable the “Kick drawer” option
  in settings to send the pulse after printing.
* **Barcode Scanner** – plug your scanner into a USB port; ensure it is configured as a keyboard wedge
  (default mode).  The cashier input field will receive scanned codes automatically.
* **Weighing Scale** (optional) – connect an RS‑232 or USB scale.  Configure the scale’s port in
  settings; weight values will be read automatically when adding weighable items.

## Synchronisation

In a multi‑terminal setup the application can synchronise data with a central server.  The sync layer
implements a **push/pull** model using change logs and conflict resolution.  Configure the sync URL and
credentials under **Settings → Sync**.  Transactions are queued locally when offline and pushed once a
connection is available, ensuring no data loss.

## Environment Variables

Store secrets such as payment gateway keys in environment variables rather than the database.  Provide a
`.env` file alongside your docker compose or systemd service to load these values at runtime.