import express from 'express';
import cors from 'cors';
import prisma from './prisma';
import { v4 as uuid } from 'uuid';

/** small helpers */
const toNum = (v: any) => (v == null ? 0 : typeof v === 'number' ? v : Number(v));

/** In-memory cart (simple demo) */
interface CartLine {
  itemId: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRateId: number | null;
  taxAmount: number;
  lineTotal: number;
  name?: string;
}
interface Cart {
  id: string;
  lines: CartLine[];
}
const carts: Record<string, Cart> = {};

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  /** Health */
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  /** Items list (supports ?query= or ?search=) */
  app.get('/api/items', async (req, res) => {
    const q = (req.query.query ?? req.query.search ?? '').toString();
    try {
      const items = await prisma.item.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q } },
                { sku: { contains: q } },
                { barcodes: { some: { code: { contains: q } } } },
              ],
            }
          : undefined,
        include: { barcodes: true, tax: true, category: true },
        take: 50,
      });
      res.json(items);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Minimal Items create/read (optional) */
  app.post('/api/items', async (req, res) => {
    try {
      const item = await prisma.item.create({ data: req.body });
      res.status(201).json(item);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/items/:id', async (req, res) => {
    const id = Number(req.params.id);
    const item = await prisma.item.findUnique({
      where: { id },
      include: { barcodes: true, tax: true, category: true },
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  });

  /** Checkout: start -> return full cart object */
  app.post('/api/checkout/start', (_req, res) => {
    const id = uuid();
    const cart: Cart = { id, lines: [] };
    carts[id] = cart;
    res.json(cart);
  });

  /** Checkout: add item { cartId, itemId?, barcode?, qty } -> return cart */
  app.post('/api/checkout/add', async (req, res) => {
    const { cartId, itemId, barcode, qty = 1 } = req.body || {};
    const cart = carts[cartId];
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    // locate item
    let item: any | null = null;
    if (barcode) {
      const bc = await prisma.barcode.findUnique({
        where: { code: String(barcode) },
        include: { item: true },
      });
      item = bc?.item ?? null;
    } else if (itemId) {
      item = await prisma.item.findUnique({ where: { id: Number(itemId) } });
    }
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const unitPrice = toNum(item.mrp);
    let taxAmount = 0;
    let taxRateId: number | null = null;

    if (item.taxId) {
      const tax = await prisma.tax.findUnique({ where: { id: item.taxId } });
      if (tax) {
        taxRateId = tax.id;
        taxAmount = (unitPrice * qty * tax.rate) / 100;
      }
    }

    const line: CartLine = {
      itemId: item.id,
      quantity: Number(qty),
      unitPrice,
      discount: 0,
      taxRateId,
      taxAmount,
      lineTotal: unitPrice * qty + taxAmount,
      name: item.name,
    };

    cart.lines.push(line);
    res.json(cart);
  });

  /** Optional: apply % discount to entire cart */
  app.post('/api/checkout/discount', (req, res) => {
    const { cartId, discountPercent = 0 } = req.body || {};
    const cart = carts[cartId];
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.lines = cart.lines.map((l) => {
      const d = (l.unitPrice * l.quantity) * (Number(discountPercent) / 100);
      const t = l.unitPrice * l.quantity - d + l.taxAmount;
      return { ...l, discount: d, lineTotal: t };
    });
    res.json(cart);
  });

  /**
   * Checkout: complete
   * body: { cartId, payments: [{ method: 'CASH'|'UPI'|'CARD'|'WALLET', amount, reference? }], customerId? }
   */
  app.post('/api/checkout/complete', async (req, res) => {
    const { cartId, payments = [], customerId = null } = req.body || {};
    const cart = carts[cartId];
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    if (!cart.lines.length) return res.status(400).json({ error: 'Cart empty' });

    // totals (matching your working schema fields)
    const totalBeforeDiscount = cart.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const totalDiscount = cart.lines.reduce((s, l) => s + l.discount, 0);
    const totalTax = cart.lines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = cart.lines.reduce((s, l) => s + l.lineTotal, 0);

    // simplified GST split
    const cgst = totalTax / 2;
    const sgst = totalTax / 2;
    const igst = 0;
    const cess = 0;

    const receiptNumber = `R${Date.now()}${Math.floor(Math.random() * 1000)}`;

    try {
      // ensure payment methods exist; connect by id
      const createPayments = [];
      for (const p of payments) {
        const methodName = String(p.method || '').toUpperCase() || 'CASH';
        let pm = await prisma.paymentMethod.findFirst({
          where: { OR: [{ code: methodName }, { name: methodName }] as any },
        });
        if (!pm) {
          try {
            pm = await prisma.paymentMethod.create({
              data: { code: methodName, name: methodName } as any,
            });
          } catch {
            pm = await prisma.paymentMethod.create({
              data: { name: methodName } as any,
            });
          }
        }
        createPayments.push({
          amount: toNum(p.amount),
          reference: p.reference ? String(p.reference) : null,
          status: 'SUCCESS',
          paymentMethod: { connect: { id: pm.id } }, // relation name: paymentMethod
        });
      }

      const receipt = await prisma.receipt.create({
        data: {
          receiptNumber,
          date: new Date(),
          customerId: customerId ?? null,
          totalBeforeDiscount,
          totalDiscount,
          totalTax,
          totalAmount,
          cgst,
          sgst,
          igst,
          cess,
          status: 'COMPLETED',
          lines: {
            create: cart.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discount: l.discount,
              taxAmount: l.taxAmount,
              lineTotal: l.lineTotal,
              taxRateId: l.taxRateId ?? null,
            })),
          },
          payments: { create: createPayments },
        },
        include: {
          lines: true,
          payments: { include: { paymentMethod: true } },
        },
      });

      // stock ledger (out)
      for (const l of cart.lines) {
        await prisma.stockLedger.create({
          data: {
            itemId: l.itemId,
            quantity: -Math.abs(l.quantity),
            unitCost: 0,
            type: 'SALE',
            reference: receipt.receiptNumber,
          },
        });
      }

      delete carts[cartId];
      res.json(receipt);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Payment methods (simple) */
  app.get('/api/payment-methods', async (_req, res) => {
    const methods = await prisma.paymentMethod.findMany();
    res.json(methods);
  });
  app.post('/api/payment-methods', async (req, res) => {
    try {
      const pm = await prisma.paymentMethod.create({ data: req.body });
    res.status(201).json(pm);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Reports: very simple daily Z */
  app.get('/api/reports/daily_z', async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);
    const receipts = await prisma.receipt.findMany({
      where: { date: { gte: start, lte: end }, status: 'COMPLETED' },
      include: { payments: { include: { paymentMethod: true } } },
    });
    const totalSales = receipts.reduce((s, r) => s + toNum(r.totalAmount), 0);
    const paymentSummary: Record<string, number> = {};
    for (const r of receipts) {
      for (const p of r.payments) {
        const key = p.paymentMethod?.name || String(p.paymentMethodId);
        paymentSummary[key] = (paymentSummary[key] || 0) + toNum(p.amount);
      }
    }
    res.json({ date: today, totalSales, paymentSummary });
  });

  // ------------------------------------------------------------------------
  // Option 2: Receipt view endpoints (JSON + plain-text printable)
  // ------------------------------------------------------------------------

  // JSON receipt by receiptNumber
  app.get('/api/receipts/:number', async (req, res) => {
    const number = req.params.number;
    const receipt = await prisma.receipt.findFirst({
      where: { receiptNumber: number },
      include: {
        lines: { include: { item: true } },          // include item details for names
        payments: { include: { paymentMethod: true } }
      },
    });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(receipt);
  });

  // Plain-text (58mm style) printable receipt
  app.get('/api/receipts/:number/plain', async (req, res) => {
    const number = req.params.number;
    const r = await prisma.receipt.findFirst({
      where: { receiptNumber: number },
      include: {
        lines: { include: { item: true } },
        payments: { include: { paymentMethod: true } },
      },
    });
    if (!r) return res.status(404).send('Receipt not found');

    const W = 42; // ~58mm width
    const line = (ch = '-') => ch.repeat(W);
    const pad = (s = '') => (s.length > W ? s.slice(0, W) : s + ' '.repeat(W - s.length));
    const lr = (L = '', R = '') => {
      const l = String(L);
      const rS = String(R);
      const spaces = Math.max(1, W - l.length - rS.length);
      return l + ' '.repeat(spaces) + rS;
    };
    const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
    const inr = (n: any) => fmt.format(Number(n ?? 0));

    let out = '';
    // Header – replace with your store details
    out += pad('My Store') + '\n';
    out += pad('GSTIN: XXABCDE1234F1Z5') + '\n';
    out += pad('Bengaluru, KA') + '\n';
    out += line() + '\n';

    out += pad(`Receipt: ${r.receiptNumber}`) + '\n';
    const when = (r as any).date ?? (r as any).createdAt ?? new Date();
    out += pad(new Date(when).toLocaleString()) + '\n';
    out += line() + '\n';

    out += pad('Items') + '\n';
    r.lines.forEach((L) => {
      const name = L.item?.name ?? `Item #${L.itemId}`;
      out += pad(name) + '\n';
      out += lr(`  ${L.quantity} x ${inr(L.unitPrice)}`, inr(L.lineTotal)) + '\n';
    });
    out += line() + '\n';

    const sub = (r as any).totalBeforeDiscount ?? (r as any).subtotal ?? 0;
    const disc = (r as any).totalDiscount ?? (r as any).discount ?? 0;
    const tax = (r as any).totalTax ?? (r as any).taxTotal ?? 0;
    const total = (r as any).totalAmount ?? (r as any).grandTotal ?? 0;

    out += lr('Subtotal', inr(sub)) + '\n';
    if (disc > 0) out += lr('Discount', `- ${inr(disc)}`) + '\n';
    out += lr('Tax', inr(tax)) + '\n';
    out += line() + '\n';
    out += lr('TOTAL', inr(total)) + '\n';
    out += line() + '\n';

    if (r.payments?.length) {
      out += pad('Payments') + '\n';
      for (const p of r.payments) {
        const name = p.paymentMethod?.name || 'PAY';
        out += lr(`  ${name}`, inr(p.amount)) + '\n';
        if (p.reference) out += pad(`   Ref: ${p.reference}`) + '\n';
      }
      out += line() + '\n';
    }

    out += pad('Thank you! Visit again.') + '\n';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(out);
  });
// Pretty HTML (customer-readable) printable receipt
app.get('/api/receipts/:number/print', async (req, res) => {
  const number = req.params.number;

  // You can set these in .env; we use fallbacks so it works right away.
  const STORE = {
    name: process.env.STORE_NAME || 'My Store',
    address: process.env.STORE_ADDRESS || 'Bengaluru, KA',
    gstin: process.env.STORE_GSTIN || 'XXABCDE1234F1Z5',
    phone: process.env.STORE_PHONE || '',
  };

  // Pull receipt with lines, item names and payment methods
  const r = await prisma.receipt.findFirst({
    where: { receiptNumber: number },
    include: {
      lines: { include: { item: true } },
      payments: { include: { paymentMethod: true } },
    },
  });
  if (!r) {
    res.status(404).send(`<h3 style="font-family:system-ui">Receipt not found</h3>`);
    return;
  }

  const esc = (s: any) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  const INR = (n: any) => fmt.format(Number(n ?? 0));
  const when = (r as any).date ?? (r as any).createdAt ?? new Date();

  const sub = (r as any).totalBeforeDiscount ?? (r as any).subtotal ?? 0;
  const disc = (r as any).totalDiscount ?? (r as any).discount ?? 0;
  const tax = (r as any).totalTax ?? (r as any).taxTotal ?? 0;
  const total = (r as any).totalAmount ?? (r as any).grandTotal ?? 0;

  // Build items rows
  const itemRows = r.lines
    .map((L) => {
      const name = L.item?.name ?? `Item #${L.itemId}`;
      return `
        <tr class="row">
          <td class="left">
            <div class="name">${esc(name)}</div>
            <div class="meta">${L.quantity} × ${INR(L.unitPrice)}</div>
          </td>
          <td class="right">${INR(L.lineTotal)}</td>
        </tr>
      `;
    })
    .join('');

  // Payments rows
  const payRows =
    (r.payments ?? [])
      .map((p) => {
        const method = p.paymentMethod?.name || 'PAYMENT';
        const ref = p.reference ? `<div class="ref">Ref: ${esc(p.reference)}</div>` : '';
        return `
          <tr class="row">
            <td class="left">
              <div class="name">${esc(method)}</div>
              ${ref}
            </td>
            <td class="right">${INR(p.amount)}</td>
          </tr>
        `;
      })
      .join('') || '';

  const cgst = Number((r as any).cgst ?? 0);
  const sgst = Number((r as any).sgst ?? 0);
  const igst = Number((r as any).igst ?? 0);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${esc(r.receiptNumber)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --ink:#111; --muted:#666; --line:#e5e7eb; --bg:#fff; --pill:#0a7;
      --w58: 302px; /* ~58mm */
      --w80: 576px; /* ~80mm */
    }
    html,body{background:#f6f7f9;margin:0;padding:0}
    body{font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:var(--ink);}
    .wrap{max-width:var(--w80); margin:24px auto; padding:0 12px;}
    .paper{
      width:100%; max-width:var(--w80);
      background:var(--bg); border:1px solid var(--line);
      border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.05);
      margin:0 auto; overflow:hidden;
    }
    .head{padding:16px 16px 8px; text-align:center}
    .store{font-weight:800; font-size:20px}
    .sub{color:var(--muted); font-size:12px}
    .sec{padding:12px 16px}
    .hr{height:1px; background:var(--line); margin:4px 0}
    table{width:100%; border-collapse:collapse}
    .row td{padding:8px 0; border-bottom:1px dashed var(--line); vertical-align:top}
    .left{width:70%}
    .right{text-align:right; white-space:nowrap}
    .name{font-weight:600}
    .meta, .ref{color:var(--muted); font-size:12px}
    .totals td{padding:6px 0}
    .grand{font-weight:800; font-size:18px}
    .pill{
      background:var(--pill); color:#fff; border:none; border-radius:8px;
      padding:10px 14px; font-weight:700; cursor:pointer;
    }
    .actions{display:flex; gap:8px; justify-content:flex-end; padding:8px 16px 16px}
    @media print{
      body{background:#fff}
      .wrap{margin:0; padding:0}
      .actions{display:none}
      .paper{border:none; border-radius:0; box-shadow:none}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="actions">
      <button class="pill" onclick="window.print()">Print</button>
    </div>
    <div class="paper">
      <div class="head">
        <div class="store">${esc(STORE.name)}</div>
        <div class="sub">${esc(STORE.address)}</div>
        <div class="sub">GSTIN: ${esc(STORE.gstin)}${STORE.phone ? ' · Ph: ' + esc(STORE.phone) : ''}</div>
      </div>
      <div class="sec">
        <table>
          <tr><td class="left meta">Receipt</td><td class="right meta">${esc(r.receiptNumber)}</td></tr>
          <tr><td class="left meta">Date</td><td class="right meta">${esc(new Date(when).toLocaleString())}</td></tr>
          <tr><td colspan="2"><div class="hr"></div></td></tr>
        </table>
      </div>

      <div class="sec">
        <table>
          ${itemRows}
        </table>
      </div>

      <div class="sec">
        <table class="totals">
          <tr><td class="left">Subtotal</td><td class="right">${INR(sub)}</td></tr>
          ${disc > 0 ? `<tr><td class="left">Discount</td><td class="right">- ${INR(disc)}</td></tr>` : ``}
          <tr><td class="left">Tax</td><td class="right">${INR(tax)}</td></tr>
          ${cgst > 0 || sgst > 0 ? `<tr><td class="left meta">CGST</td><td class="right meta">${INR(cgst)}</td></tr>
          <tr><td class="left meta">SGST</td><td class="right meta">${INR(sgst)}</td></tr>` : ``}
          ${igst > 0 ? `<tr><td class="left meta">IGST</td><td class="right meta">${INR(igst)}</td></tr>` : ``}
          <tr><td colspan="2"><div class="hr"></div></td></tr>
          <tr><td class="left grand">TOTAL</td><td class="right grand">${INR(total)}</td></tr>
        </table>
      </div>

      ${
        (r.payments?.length ?? 0) > 0
          ? `<div class="sec">
              <div class="meta" style="margin-bottom:6px">Payments</div>
              <table>${payRows}</table>
            </div>`
          : ``
      }

      <div class="sec" style="text-align:center; padding-bottom:18px">
        <div class="meta">Thank you! Visit again.</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * Update a line in the in-memory cart.
 * body: { cartId, lineIndex, quantity?, unitPrice?, discount? }
 * - quantity <= 0 will remove the line
 * - recomputes taxAmount & lineTotal using the line's taxRateId
 */
app.post('/api/checkout/updateLine', async (req, res) => {
  try {
    const { cartId, lineIndex, quantity, unitPrice, discount } = req.body || {};
    const cart = carts[cartId];
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    const idx = Number(lineIndex);
    const line = cart.lines[idx];
    if (!line) return res.status(404).json({ error: 'Line not found' });

    // Remove when quantity <= 0
    if (quantity != null && Number(quantity) <= 0) {
      cart.lines.splice(idx, 1);
      return res.json(cart);
    }

    if (quantity != null) line.quantity = Number(quantity);
    if (unitPrice != null) line.unitPrice = Number(unitPrice);
    if (discount != null) line.discount = Number(discount);

    // Recompute tax & totals
    let taxRatePct = 0;
    if (line.taxRateId) {
      const tx = await prisma.tax.findUnique({ where: { id: line.taxRateId } });
      taxRatePct = tx?.rate ?? 0;
    }
    const base = line.unitPrice * line.quantity;
    const taxAmount = (base - (line.discount || 0)) * (taxRatePct / 100);
    line.taxAmount = taxAmount;
    line.lineTotal = base - (line.discount || 0) + taxAmount;

    res.json(cart);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// SETTINGS
app.get('/api/admin/settings', async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json(map);
});

app.put('/api/admin/settings', async (req, res) => {
  const body = req.body as Record<string, string>;
  try {
    const entries = Object.entries(body || {});
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// PAYMENT METHODS CRUD (list/create/update)
app.get('/api/payment-methods', async (_req, res) => {
  const methods = await prisma.paymentMethod.findMany({ orderBy: { code: 'asc' } });
  res.json(methods);
});

app.post('/api/payment-methods', async (req, res) => {
  try {
    const { code, name, active = true } = req.body || {};
    const pm = await prisma.paymentMethod.create({ data: { code, name, active } });
    res.status(201).json(pm);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/payment-methods/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const { name, active } = req.body || {};
    const pm = await prisma.paymentMethod.update({
      where: { code },
      data: { ...(name != null ? { name } : {}), ...(active != null ? { active } : {}) },
    });
    res.json(pm);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


/**
 * Remove a line by index
 * body: { cartId, lineIndex }
 */
app.post('/api/checkout/removeLine', (req, res) => {
  const { cartId, lineIndex } = req.body || {};
  const cart = carts[cartId];
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  const idx = Number(lineIndex);
  if (idx < 0 || idx >= cart.lines.length) {
    return res.status(404).json({ error: 'Line not found' });
  }
  cart.lines.splice(idx, 1);
  res.json(cart);
});
  // ------------------------------------------------------------------------

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`POS backend running on port ${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
