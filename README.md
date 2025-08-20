# POS Supermarket Application

This repository contains a complete offline‑first POS (point‑of‑sale) system for a small Indian supermarket.  It
includes a Node.js/Prisma backend with SQLite, a React frontend optimised for keyboard use, seed data, an
OpenAPI specification and comprehensive documentation.  The system supports GST compliance, multiple
payment methods (cash, card, UPI, wallets), basic inventory/purchasing and simple promotion rules. .

## Architecture Overview

See the `report.md` for an in‑depth explanation of the design decisions.  In summary, the application is
implemented as a **local‑first desktop** application using Electron (for desktop) and React/TypeScript.  A
Node.js backend with a SQLite database runs locally inside the Electron process or as a separate service.
SQLite emphasises economy, efficiency and independence, making it well suited for devices at the edge of the
network【366647749549088†L39-L60】.  Data synchronisation to a central server (e.g. CouchDB) is optional and can be
configured in settings.

## Running locally

The project is organised into two subdirectories:

* `backend` – Express server with Prisma ORM and SQLite database.
* `frontend` – React application built with Vite.

### Prerequisites

* Node.js 18 or later
* npm or Yarn

### Backend

```bash
cd pos/backend
cp .env.example .env            # update values as needed
npm install                     # install dependencies
npx prisma migrate deploy       # create SQLite schema
npm run seed                    # insert sample data
npm run dev                     # start the API server on http://localhost:3000
```

### Frontend

```bash
cd pos/frontend
npm install                     # install dependencies
npm run dev                     # start the development server on http://localhost:5173
```

Open http://localhost:5173 in your browser (Chromium or Electron) to access the cashier interface.

### Docker Compose

To run the entire stack in containers, use the provided compose file:

```bash
cd pos/docker
cp ../backend/.env.example .env  # optional: override environment variables
docker compose up --build
```

This will start CouchDB for optional synchronisation, the backend on port **3000** and the frontend on
port **5173**.

### Windows/macOS/Linux notes

* **Windows** – Use WSL2 or Docker Desktop for a smooth Linux environment.  USB devices (scanners,
  printers) may require additional drivers.  When running outside Docker, set `DATABASE_URL` to
  `file:./data/pos.db` and ensure the `data` directory is writable.
* **macOS** – Node and Docker installation are straightforward via Homebrew.  For USB scales or
  printers, install appropriate drivers and grant serial port permissions.
* **Linux** – No special steps are needed; ensure that the `udev` rules for USB devices (e.g. scanners and
  printers) allow user access.  When running in production, configure systemd services for the backend
  and frontend.

## Documentation

* `report.md` – architecture rationale, database ERD and design justification.
* `openapi.yml` – OpenAPI 3.1 specification of the REST API.
* `docs/admin_guide.md` – guide for administrators (installation, backups, hardware).
* `docs/cashier_quick_start.md` – quick start for cashiers (shortcuts, workflows).
* `escpos_templates/` – printer templates and sample receipts.
* `test_plan.md` – outlines the testing strategy and critical end‑to‑end flows.

## Next steps

This repository provides a solid foundation for a production‑ready POS system.  To complete the remaining
features described in the specification, consider implementing:

* **Electron packaging** – wrap the frontend and backend into a single desktop application with auto‑update.
* **Purchasing and stock adjustments** – expose APIs and UI for purchase orders, goods receipts and
  stock ledger.
* **Promotions and loyalty** – add more complex promotion types and a simple loyalty program.
* **Multi‑store support** – synchronise to a central database and implement store‑level price lists.

Feel free to customise and extend the code to fit your store’s workflows.  Contributions are welcome!