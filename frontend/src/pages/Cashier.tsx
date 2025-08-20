import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

const API_BASE = "http://localhost:3000";

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const INR = (n: unknown) => inrFmt.format(Number(n ?? 0));
const toNum = (v: unknown) => (v == null ? 0 : typeof v === "number" ? v : Number(v));
const clamp2 = (n: number) => Math.max(0, Math.round(n * 100) / 100);

type Item = { id: number; name: string; sku: string; mrp?: string | number };
type CartLine = {
  itemId: number; quantity: number; unitPrice: number | string;
  discount?: number | string; lineDiscount?: number | string;
  taxAmount?: number | string; lineTax?: number | string;
  lineTotal: number | string; taxRateId?: number | null; name?: string;
  item?: { name: string };
};
type Cart = { id: string; lines: CartLine[] };
type EditState = null | { index: number; qty: number; unitPrice: number; discount: number; name: string; };
type Density = "comfortable" | "dense";
type Tender = { method: "CASH" | "UPI" | "CARD" | "WALLET"; amount: number; reference?: string };

export default function Cashier() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>("");
  const [lastReceiptNo, setLastReceiptNo] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem("pos_density") as Density) || "comfortable");

  // NEW: settings
  const [settings, setSettings] = useState<Record<string, string>>({});
  const upiVpa = settings.UPI_VPA || "beeku7@ibl";
  const storeName = settings.STORE_NAME || "Your Store";

  // Payment drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [upiAmount, setUpiAmount] = useState<number>(0);
  const [upiQR, setUpiQR] = useState<string>("");

  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/api/checkout/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
          fetch(`${API_BASE}/api/admin/settings`),
        ]);
        const c: Cart = await cRes.json();
        const setMap: Record<string, string> = await sRes.json();
        setCart(c);
        setSettings(setMap);
      } catch (e: any) {
        setMsg("Startup failed: " + (e?.message ?? String(e)));
      }
    })();

    const savedReceipt = localStorage.getItem("pos_last_receipt");
    if (savedReceipt) setLastReceiptNo(savedReceipt);

    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key === "P" || ev.key === "p") && ev.shiftKey) { ev.preventDefault(); openLastReceipt(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const densityVars: React.CSSProperties = {
    ["--row-h" as any]: density === "dense" ? "36px" : "48px",
    ["--cell-pad" as any]: density === "dense" ? "6px 8px" : "10px 10px",
    ["--font-sm" as any]: density === "dense" ? "13px" : "14.5px",
    ["--font-md" as any]: density === "dense" ? "14px" : "16px",
  };
  function setDensityPersist(next: Density) { setDensity(next); localStorage.setItem("pos_density", next); }

  const subtotal = useMemo(() => (cart?.lines ?? []).reduce((s, l) => s + toNum(l.unitPrice) * toNum(l.quantity), 0), [cart]);
  const discountTotal = useMemo(() => (cart?.lines ?? []).reduce((s, l) => s + (toNum(l.discount) || toNum(l.lineDiscount)), 0), [cart]);
  const taxTotal = useMemo(() => (cart?.lines ?? []).reduce((s, l) => s + (toNum(l.taxAmount) || toNum(l.lineTax)), 0), [cart]);
  const grandTotal = useMemo(() => (cart?.lines ?? []).reduce((s, l) => s + toNum(l.lineTotal), 0), [cart]);
  const cgst = useMemo(() => taxTotal / 2, [taxTotal]); const sgst = useMemo(() => taxTotal / 2, [taxTotal]);

  const paidTotal = useMemo(() => tenders.reduce((s, t) => s + toNum(t.amount), 0), [tenders]);
  const due = Math.max(0, Math.round((toNum(grandTotal) - paidTotal) * 100) / 100);
  const change = Math.max(0, Math.round((paidTotal - toNum(grandTotal)) * 100) / 100);

  // default UPI amount follows Due (or total if 0 tenders)
  useEffect(() => { setUpiAmount(due || toNum(grandTotal)); }, [grandTotal, due]);

  // Build UPI intent URL + QR with settings (VPA + store name)
  useEffect(() => {
    const amt = clamp2(upiAmount || 0);
    const pa = upiVpa;
    const pn = encodeURIComponent(storeName);
    const tn = encodeURIComponent(`POS Sale ${cart?.id ?? ""}`);
    const am = amt.toFixed(2);
    const url = `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setUpiQR).catch(() => setUpiQR(""));
  }, [upiAmount, cart?.id, upiVpa, storeName]);

  async function search() {
    setBusy(true); setMsg("");
    try {
      const q = encodeURIComponent(query.trim());
      const r = await fetch(`${API_BASE}/api/items?query=${q}`);
      if (!r.ok) throw new Error(await r.text());
      const data: Item[] = await r.json();
      setResults(data); if (!data.length) setMsg("No items found.");
    } catch (e: any) { setMsg("Search error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  async function addItem(it: Item) {
    if (!cart) return; setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/checkout/add`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cart.id, itemId: it.id, qty: 1 }),
      });
      if (!r.ok) throw new Error(await r.text());
      const updated: Cart = await r.json();
      setCart(updated); setResults([]); setQuery(""); scanRef.current?.focus();
    } catch (e: any) { setMsg("Add error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  async function updateLineQty(index: number, newQty: number) {
    if (!cart) return; setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/checkout/updateLine`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cart.id, lineIndex: index, quantity: newQty }),
      });
      if (!r.ok) throw new Error(await r.text());
      setCart(await r.json());
    } catch (e: any) { setMsg("Update error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  async function removeLine(index: number) {
    if (!cart) return; setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/checkout/removeLine`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cart.id, lineIndex: index }),
      });
      if (!r.ok) throw new Error(await r.text());
      setCart(await r.json());
    } catch (e: any) { setMsg("Remove error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  function openEditFor(index: number) {
    if (!cart) return;
    const l = cart.lines[index];
    setEdit({ index, qty: toNum(l.quantity), unitPrice: toNum(l.unitPrice), discount: toNum(l.discount) || toNum(l.lineDiscount), name: l.name ?? l.item?.name ?? `Item #${l.itemId}` });
  }

  async function saveEdit() {
    if (!cart || !edit) return;
    const { index, qty, unitPrice, discount } = edit;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/checkout/updateLine`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cart.id, lineIndex: index, quantity: qty, unitPrice, discount }),
      });
      if (!r.ok) throw new Error(await r.text());
      setCart(await r.json()); setEdit(null);
    } catch (e: any) { setMsg("Edit error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  function openDrawer() { setTenders([]); setDrawerOpen(true); }
  function addCash(amount: number) { if (!amount || amount <= 0) return; setTenders((t) => [...t, { method: "CASH", amount: clamp2(amount) }]); }
  function addUpi(amount: number) { if (!amount || amount <= 0) return; const ref = `UPI${Date.now().toString().slice(-6)}`; setTenders((t) => [...t, { method: "UPI", amount: clamp2(amount), reference: ref }]); }
  function removeTender(i: number) { setTenders((t) => t.filter((_, idx) => idx !== i)); }

  async function completeWithTenders() {
    if (!cart) return; if (tenders.reduce((s, t) => s + toNum(t.amount), 0) <= 0) { setMsg("No payments added."); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/checkout/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId: cart.id, payments: tenders }) });
      if (!r.ok) throw new Error(await r.text());
      const receipt = await r.json();
      const num: string = receipt?.receiptNumber ?? receipt?.number ?? receipt?.id ?? "";
      if (num) { setLastReceiptNo(num); localStorage.setItem("pos_last_receipt", num); }
      setMsg(`Sale done ✅ Receipt: ${num || "OK"}`);
      setDrawerOpen(false); setTenders([]);

      const r2 = await fetch(`${API_BASE}/api/checkout/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      setCart(await r2.json()); setResults([]); setQuery(""); scanRef.current?.focus();
    } catch (e: any) { setMsg("Payment error: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  }

  function openLastReceipt() {
    if (!lastReceiptNo) { setMsg("No receipt to print yet."); return; }
    const url = `${API_BASE}/api/receipts/${encodeURIComponent(lastReceiptNo)}/print`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const displayName = (l: CartLine) => l.name ?? l.item?.name ?? `(Item #${l.itemId})`;

  return (
    <div style={{ ...styles.shell, ...(densityVars as any) }}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.headerTitle}>Cashier</div>
          <div style={styles.toggleWrap}>
            <button onClick={() => setDensityPersist("comfortable")} style={{ ...styles.toggleBtn, ...(density === "comfortable" ? styles.toggleActive : {}) }}>Comfortable</button>
            <button onClick={() => setDensityPersist("dense")} style={{ ...styles.toggleBtn, ...(density === "dense" ? styles.toggleActive : {}) }}>Dense</button>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.grid}>
          {/* LEFT: Cart */}
          <section style={styles.leftPane}>
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>Cart</h3>
              {(cart?.lines?.length ?? 0) === 0 ? (
                <div style={styles.empty}>No items yet.</div>
              ) : (
                <>
                  <div style={styles.table}>
                    <div style={styles.thead}>
                      <div style={{ ...styles.th, flex: 3 }}>Item</div>
                      <div style={{ ...styles.th, flex: 1, textAlign: "right" }}>Qty</div>
                      <div style={{ ...styles.th, flex: 1, textAlign: "right" }}>Rate</div>
                      <div style={{ ...styles.th, flex: 1, textAlign: "right" }}>Disc</div>
                      <div style={{ ...styles.th, flex: 1, textAlign: "right" }}>Tax</div>
                      <div style={{ ...styles.th, flex: 1.2, textAlign: "right" }}>Amount</div>
                      <div style={{ ...styles.th, width: 160, textAlign: "right" }}>Actions</div>
                    </div>
                    {(cart!.lines || []).map((l, idx) => {
                      const qty = toNum(l.quantity), rate = toNum(l.unitPrice), disc = toNum(l.discount) || toNum(l.lineDiscount);
                      const tax = toNum(l.taxAmount) || toNum(l.lineTax), amt = toNum(l.lineTotal);
                      return (
                        <div key={idx} style={styles.tr}>
                          <div style={{ ...styles.td, flex: 3 }}>{displayName(l)}</div>
                          <div style={{ ...styles.td, flex: 1, textAlign: "right" }}>{qty}</div>
                          <div style={{ ...styles.td, flex: 1, textAlign: "right" }}>{INR(rate)}</div>
                          <div style={{ ...styles.td, flex: 1, textAlign: "right" }}>{disc ? `- ${INR(disc)}` : INR(0)}</div>
                          <div style={{ ...styles.td, flex: 1, textAlign: "right" }}>{INR(tax)}</div>
                          <div style={{ ...styles.td, flex: 1.2, textAlign: "right", fontWeight: 600 }}>{INR(amt)}</div>
                          <div style={{ ...styles.td, width: 160, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button title="–1" style={styles.iconBtn} onClick={() => updateLineQty(idx, toNum(l.quantity) - 1)}>–</button>
                            <button title="+1" style={styles.iconBtn} onClick={() => updateLineQty(idx, toNum(l.quantity) + 1)}>+</button>
                            <button title="Edit" style={styles.iconBtn} onClick={() => openEditFor(idx)}>Edit</button>
                            <button title="Remove" style={{ ...styles.iconBtn, color: "#b91c1c", borderColor: "#e5baba" }} onClick={() => removeLine(idx)}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={styles.totalsBox}>
                    <div style={styles.totRow}><div>Subtotal</div><div>{INR(subtotal)}</div></div>
                    <div style={styles.totRow}><div>Discount</div><div>{discountTotal ? `- ${INR(discountTotal)}` : INR(0)}</div></div>
                    <div style={styles.totRow}><div>CGST</div><div>{INR(cgst)}</div></div>
                    <div style={styles.totRow}><div>SGST</div><div>{INR(sgst)}</div></div>
                    <div style={{ ...styles.totRow, fontWeight: 800, fontSize: "var(--font-md)" }}><div>Total</div><div>{INR(grandTotal)}</div></div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* RIGHT: Scan/Search + Results */}
          <section style={styles.rightPane}>
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>Scan or Search</h3>
              <input ref={scanRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Scan barcode or type name/SKU… then Enter" style={{ ...styles.searchInput, fontSize: "var(--font-md)" }} autoFocus />
              <button onClick={search} disabled={busy} style={styles.primaryBtn}>{busy ? "Searching…" : "Search"}</button>
            </div>

            {results.length > 0 && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitle}>Results</h3>
                <div style={styles.list}>
                  {results.map((it) => (
                    <div key={it.id} style={styles.row}>
                      <div style={{ flex: 1 }}>
                        <div style={styles.itemName}>{it.name}</div>
                        <div style={styles.itemMeta}>SKU: {it.sku} {typeof it.mrp !== "undefined" ? `· MRP ${INR(it.mrp)}` : ""}</div>
                      </div>
                      <button style={styles.smallBtn} onClick={() => addItem(it)} disabled={busy}>Add</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {msg && (
              <div style={styles.card}>
                <div style={styles.status}>
                  {msg} {lastReceiptNo && (<>— <a href={`${API_BASE}/api/receipts/${lastReceiptNo}/print`} target="_blank" rel="noreferrer">View / Print</a></>)}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer style={styles.footer}>
        <div style={{ fontSize: "var(--font-md)", fontWeight: 700 }}>
          Items: {(cart?.lines?.length ?? 0)} &nbsp; | &nbsp; Total: {INR(Number(grandTotal.toFixed(2)))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={openLastReceipt} disabled={!lastReceiptNo} title={lastReceiptNo ? `Shift+P to quick print` : "No recent receipt"} style={{ ...styles.secondaryBtn, opacity: lastReceiptNo ? 1 : 0.6, cursor: lastReceiptNo ? "pointer" : "not-allowed" }}>
            Print Last Receipt
          </button>
          <button onClick={openDrawer} disabled={busy || !cart || (cart.lines?.length ?? 0) === 0} style={styles.payBtn}>
            Take Cash & Complete
          </button>
        </div>
      </footer>

      {/* Edit modal as before... */}

      {/* PAYMENT DRAWER */}
      {drawerOpen && (
        <div style={styles.drawerBackdrop} onClick={() => setDrawerOpen(false)}>
          <aside style={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div style={{ fontWeight: 700 }}>Payments</div>
              <button style={styles.iconBtn} onClick={() => setDrawerOpen(false)}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              {/* Cash */}
              <section style={styles.payCard}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Cash</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={styles.quickBtn} onClick={() => addCash(due)}>Exact {INR(due)}</button>
                  <button style={styles.quickBtn} onClick={() => addCash(100)}>₹100</button>
                  <button style={styles.quickBtn} onClick={() => addCash(500)}>₹500</button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input type="number" step="0.01" min={0} placeholder="Custom cash" onKeyDown={(e) => { if (e.key === "Enter") { const v = Number((e.target as HTMLInputElement).value); addCash(v); (e.target as HTMLInputElement).value = ""; } }} style={styles.input} />
                  <button style={styles.smallBtn} onClick={(e) => { const input = (e.currentTarget.previousSibling as HTMLInputElement); const v = Number(input?.value); addCash(v); if (input) input.value = ""; }}>Add</button>
                </div>
              </section>

              {/* UPI with settings */}
              <section style={styles.payCard}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>UPI ({upiVpa})</div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div>
                    {upiQR ? <img src={upiQR} alt="UPI QR" style={{ width: 220, height: 220, border: "1px solid #eee", borderRadius: 8 }} /> :
                      <div style={{ width: 220, height: 220, border: "1px dashed #ccc", borderRadius: 8, display: "grid", placeItems: "center", color: "#666" }}>QR</div>}
                    <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>Customer scans. Amount is pre-filled.</div>
                  </div>

                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 13, color: "#444" }}>Amount (₹)</label>
                    <input type="number" step="0.01" min={0} value={upiAmount} onChange={(e) => setUpiAmount(Number(e.target.value))} style={styles.input} />
                    <button style={styles.primaryBtn} onClick={() => addUpi(upiAmount)}>Mark UPI Paid</button>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  UPI link: <code>upi://pay?pa={upiVpa}&amp;pn={encodeURIComponent(storeName)}&amp;am={upiAmount.toFixed(2)}&amp;cu=INR</code>
                </div>
              </section>

              {/* Added tenders & Summary same as before... */}
              {/* ... */}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { height: "100vh", display: "flex", flexDirection: "column", fontFamily: "Inter, Arial, sans-serif", background: "#f8f8f8" },
  header: { background: "#222", padding: "10px 12px", color: "#fff" },
  headerInner: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerTitle: { fontWeight: 700, fontSize: 18 },
  toggleWrap: { display: "inline-flex", background: "rgba(255,255,255,0.1)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.25)" },
  toggleBtn: { padding: "6px 10px", fontSize: 13, color: "#fff", background: "transparent", border: "none", cursor: "pointer" },
  toggleActive: { background: "#fff", color: "#111" },
  main: { flex: 1, overflow: "auto", padding: 16, width: "100%", margin: "0 auto", maxWidth: 1280 },
  grid: { display: "grid", gap: 16, gridTemplateColumns: "1.2fr 1fr" },
  leftPane: { display: "flex", flexDirection: "column", gap: 16 },
  rightPane: { display: "flex", flexDirection: "column", gap: 16 },
  card: { background: "#fff", border: "1px solid #e5e5e5", borderRadius: 10, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" },
  sectionTitle: { margin: "0 0 12px 0", fontSize: "var(--font-md)" },
  searchInput: { padding: "12px 14px", borderRadius: 8, border: "1px solid #ccc", outline: "none", marginBottom: 10 },
  primaryBtn: { padding: "10px 14px", fontSize: "var(--font-sm)", borderRadius: 8, border: "none", cursor: "pointer", background: "#2563eb", color: "#fff", fontWeight: 600 },
  secondaryBtn: { padding: "10px 14px", fontSize: "var(--font-sm)", borderRadius: 8, border: "1px solid #cfd2d7", background: "#fff", fontWeight: 600 },
  smallBtn: { padding: "8px 12px", fontSize: "var(--font-sm)", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: "#fff" },
  list: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflow: "auto" },
  row: { display: "flex", gap: 12, alignItems: "center", padding: "var(--cell-pad)", border: "1px solid #eee", borderRadius: 8, background: "#fff", minHeight: "var(--row-h)", fontSize: "var(--font-sm)" },
  table: { display: "flex", flexDirection: "column", gap: 6 },
  thead: { display: "flex", gap: 8, padding: "8px 10px", borderBottom: "1px solid #eee", color: "#444", background: "#fafafa", borderRadius: 8, fontSize: "var(--font-sm)" },
  th: { fontWeight: 700 },
  tr: { display: "flex", gap: 8, padding: "var(--cell-pad)", border: "1px solid #eee", borderRadius: 8, alignItems: "center", background: "#fff", minHeight: "var(--row-h)" },
  td: { fontSize: "var(--font-sm)" },
  totalsBox: { marginTop: 10, borderTop: "1px dashed #e3e3e3", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--font-sm)" },
  totRow: { display: "flex", justifyContent: "space-between" },
  empty: { color: "#666", fontSize: "var(--font-sm)" },
  status: { color: "#444", fontSize: "var(--font-sm)" },
  footer: { position: "sticky", bottom: 0, background: "#fff", borderTop: "1px solid #e5e5e5", padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  payBtn: { padding: "12px 16px", fontSize: "var(--font-md)", borderRadius: 10, border: "none", cursor: "pointer", background: "#0a7", color: "#fff", fontWeight: 700 },
  iconBtn: { padding: "6px 10px", fontSize: "var(--font-sm)", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" },
  // Drawer
  drawerBackdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", justifyContent: "flex-end", zIndex: 60 },
  drawer: { height: "100%", width: 460, background: "#fff", boxShadow: "-10px 0 30px rgba(0,0,0,.25)", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  drawerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  payCard: { border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" },
  quickBtn: { padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: "var(--font-sm)" },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc", width: "100%", marginRight: 4 },
  itemName: { fontWeight: 600 },
  itemMeta: { color: "#666", fontSize: "var(--font-sm)" },
};
