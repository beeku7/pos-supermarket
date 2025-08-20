# Architecture Overview and Rationale

## Local‑first vs online‑only

Supermarkets in India often experience unreliable connectivity and need to continue billing even during
network outages.  An **offline‑first** architecture ensures that sales, returns and inventory updates can be
recorded locally and synchronised when a connection becomes available.  SQLite is a perfect fit for this
scenario: it is a **small, fast and reliable** database engine that emphasises **economy, efficiency and
independence**【366647749549088†L39-L60】.  Unlike client/server databases, SQLite thrives at the edge of the network
and provides fast and reliable data services to applications with dodgy connectivity【366647749549088†L54-L60】.

An online‑only system would require constant connectivity to a central server (e.g. PostgreSQL) and add
latency to every scan and payment.  With a local database the cashier UI remains responsive (<200 ms per
scan) and only the finalised transactions need to be synchronised.  Background sync can be implemented
using a change‑log and CouchDB replication; conflicts are resolved via timestamps.

## Technology options

| Option  | Stack                                           | Pros                                                       | Cons                                                      |
|--------|--------------------------------------------------|-----------------------------------------------------------|-----------------------------------------------------------|
| **A**  | Electron + React/TypeScript UI, Node.js + SQLite | *Offline‑first*; easy integration with USB printers,
  scanners and scales; single codebase; packaging via Electron; SQLite emphasises independence and simplicity【366647749549088†L39-L60】. | Larger desktop footprint; requires packaging; sync logic must be implemented. |
| **B**  | React SPA + Node/NestJS + PostgreSQL (PWA)       | Familiar web stack; can scale to multiple stores; service worker for offline caching. | Browser security limits access to hardware; offline support is limited to caching (no local writes); printers require third‑party bridges. |
| **C**  | Django/DRF + PostgreSQL + React (PWA)            | Mature framework with built‑in admin; Python has good reporting libraries. | Same hardware limitations as option B; mixing Python and JavaScript increases complexity. |

### Chosen architecture

Option **A** (Electron + React + SQLite) is chosen because it provides the best balance of offline
capability, hardware integration and developer productivity.  Electron allows us to package a desktop
application that can access native drivers (ESC/POS printers, scales, cash drawers) while still using a
modern React UI.  The Node.js backend runs alongside the UI and stores data in a local SQLite file.

### Synchronisation strategy

Each terminal maintains its own SQLite database.  A **sync service** monitors the change‑log (e.g.
using triggers or timestamp columns) and periodically replicates changes to a central CouchDB server.
During conflict resolution the “last write wins” strategy is used for non‑financial data, while sales
transactions are appended with unique receipt numbers to prevent duplication.  Sync intervals and batch
sizes are configurable.  If CouchDB is unavailable, transactions are queued until it resumes.

## Database Schema (ERD)

The data model covers items, barcodes, categories, taxes, customers, vendors, purchasing, stock, receipts,
payments, users and settings.  Relationships are shown below:

* **Item** – belongs to a **Category** and a **Tax** rate.  Has many **Barcode**s and **Batch**es.
* **Barcode** – maps an EAN/UPC code to an **Item**.
* **Batch** – represents a quantity of an **Item** with a manufacture and expiry date; linked to a
  **GoodsReceipt** for valuation.
* **StockLedger** – records all stock movements (purchases, sales, returns, adjustments) with references.
* **PurchaseOrder** → **PurchaseOrderLine** → **GoodsReceipt** – flows for ordering and receiving stock.
* **Receipt** → **ReceiptLine** – records sales and returns; linked to **Payment** and optionally a
  **Customer**.
* **Payment** – split payments referencing **PaymentMethod** (cash, card, UPI, wallets, gift cards).
* **User** and **Role** – manage authentication and access control; **AuditLog** records sensitive actions.
* **Setting** – key/value configuration for GSTIN, store details and sync parameters.

Refer to `prisma/schema.prisma` for full field definitions and to `prisma/init.sql` for the SQL migration.

## API Design

The REST API follows resource‑oriented principles and is documented in `openapi.yml`.  Key endpoints include:

* **/api/items** – CRUD operations for items, including bulk import/export.
* **/api/checkout** – start a session, scan/add items (by barcode or SKU), apply discounts, hold/resume and
  complete the sale.  Completing the sale generates a receipt, updates the stock ledger and records
  payments.
* **/api/payments** – capture, refund and void payments.  UPI intents and QR codes are handled by the
  client.
* **/api/reports** – daily Z/X reports, sales by item/category, stock on hand and GST summaries.
* **/api/admin** – user management, devices, backups and settings.

All endpoints return JSON and use HTTP status codes for error signalling.  Monetary amounts are returned as
numbers representing rupees with paise precision.  Authentication is handled via HTTP basic auth or JWT
(depending on the deployment).

## Rationale for SQLite

SQLite provides a self‑contained, serverless SQL database engine that excels in embedded and edge
applications.  The **Appropriate Uses for SQLite** document notes that SQLite emphasises economy,
efficiency, reliability and independence, making it ideal for devices that must operate without expert
human support【366647749549088†L39-L60】.  It thrives at the edge of the network and provides fast and reliable
service even under poor connectivity【366647749549088†L54-L60】.  For a small supermarket with only a few terminals
and tens of thousands of SKUs, SQLite’s performance is more than sufficient and avoids the operational
overhead of a client/server database.

## Conclusion

The proposed architecture leverages a local database for speed and resilience, a modern React/Electron
front‑end for usability, and a Node.js backend with Prisma for type‑safe data access.  The system meets the
functional requirements for sales, inventory, promotions, reporting and GST compliance while remaining
scalable to multiple stores via an optional synchronisation layer.