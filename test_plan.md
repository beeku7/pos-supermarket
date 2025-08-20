# Test Plan

This document outlines the testing strategy for the supermarket POS application.  The goal is to achieve
at least 80 % coverage of core business logic through a combination of unit tests, integration tests and
end‑to‑end (E2E) tests.  The tests are implemented using **Jest** and **SuperTest** for the backend and
**Playwright** (suggested) for the frontend, although only backend examples are provided in this repository.

## Unit tests

* **Models and calculations** – verify helper functions that compute tax, apply discounts, round totals
  according to Indian cash rounding rules and split tenders.  Edge cases include zero‑rate items,
  mixed GST slabs, weight‑based items and negative stock guards.
* **Validation** – ensure that incoming API payloads are validated: quantities cannot be negative,
  discounts cannot exceed configured limits and manager overrides are enforced when required.
* **Authentication** – test user login, PIN verification and role‑based access control.

## Integration tests

* **Database interactions** – test that creating, updating and deleting entities via the API persists
  correctly in the SQLite database.  Use an isolated test database file for each run.  Example cases:
  * Create a new item with barcodes and tax, then fetch it by ID.
  * Place a purchase order, receive goods and verify that batches are created and stock ledger entries are
    recorded.
  * Generate a daily Z report and compare totals against inserted receipts.
* **Error handling** – verify that the API responds with appropriate HTTP status codes and messages when
  referencing non‑existent carts, items or receipts.

## End‑to‑end tests (E2E)

### 1. Scan → Discount → Split Pay

This test exercises a typical sale:

1. **Start** a new cart via `/api/checkout/start` and obtain a `cartId`.
2. **Scan** two existing items by posting their barcodes to `/api/checkout/scan`; verify that the cart
   contains the expected number of lines and that tax amounts are computed.
3. **Apply** a percentage discount (e.g. 10 %) to the entire cart via `/api/checkout/discount`.
4. **Complete** the sale via `/api/checkout/complete` using a split payment (e.g. half UPI, half cash).
5. **Assert** that the resulting receipt totals match the cart totals, that two payment records exist and
   that stock ledger entries have been created with negative quantities.

An example implementation is provided in `checkout.e2e.test.ts`.

### 2. Price‑embedded barcode (produce)

For weighable products sold via price‑embedded barcodes, the system must parse the barcode according to
configured patterns (e.g. a 20‑digit barcode where digits 3–7 encode the item code and digits 8–12 encode
the weight).  The E2E test steps are:

1. **Configure** a price‑embedded barcode pattern in settings (e.g. `YYAAAAWWWWWCC` where `AA` is the
   item code and `WWWWW` is the weight in grams).
2. **Create** a weighable item with `isWeighable=true`.
3. **Scan** a price‑embedded barcode (e.g. `2012340015009` meaning item 1234 with 0.150 kg).
4. **Verify** that the cart line quantity is interpreted as 0.15 kg and that the price is `mrp × 0.15`.
5. **Complete** the sale and check that the stock ledger for that batch reflects the correct quantity
   deduction.

### 3. Return by receipt

Handling returns requires reversing tax and updating stock:

1. **Complete** an initial sale and record the `receiptNumber`.
2. **Initiate** a return by posting to `/api/checkout/return` with the `receiptNumber` and selecting the
   lines to return.
3. **Verify** that the API creates a new receipt with negative quantities, that the taxes are reversed
   appropriately and that the refund uses the original payment methods.
4. **Check** that stock ledger entries are created with positive quantities for the returned items.

## Additional considerations

* **Offline queue** – simulate network loss by disconnecting the API server during a sale, queueing
  transactions locally and then reconnecting to verify that queued receipts are synchronised without
  duplication.
* **Concurrency** – test that simultaneous scans from two terminals do not result in duplicate receipt
  numbers or inconsistent stock counts.
* **Performance** – ensure that adding an item to a cart takes less than 200 ms on modest hardware by
  measuring response times under load.