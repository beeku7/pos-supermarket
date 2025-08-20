import React, { useEffect, useMemo, useState } from "react";

const API = "http://localhost:3000";
const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const INR = (n: number) => fmt.format(Number(n || 0));

type Item = { id: number; name: string; sku: string };
type StockRow = { id: number; sku: string; name: string; onHand: number; avgCost: number; stockValue: number };

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<Item | null>(null);

  const [qty, setQty] = useState<number>(0);
  const [cost, setCost] = useState<number>(0);
  const [reference, setReference] = useState<string>("");

  const [adjDelta, setAdjDelta] = useState<number>(0);
  const [adjReason, setAdjReason] = useState<string>("");

  const [rows, setRows] = useState<StockRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [allowNegative, setAllowNegative] = useState<boolean>(true);

  useEffect(() => {
    refreshStock();
    getSetting();
  }, []);

  async function getSetting() {
    try {
      const r = await fetch(`${API}/api/settings/stock`);
      const j = await r.json();
      setAllowNegative(!!j.allowNegativeStock);
    } catch {}
  }
  async function saveSetting(v: boolean) {
    setAllowNegative(v);
    try {
      await fetch(`${API}/api/settings/stock`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowNegativeStock: v }),
      });
    } catch {}
  }

  async function refreshStock() {
    try {
      const r = await fetch(`${API}/api/inventory/stock_on_hand`);
      setRows(await r.json());
    } catch (e: any) {
      setMsg("Load stock failed: " + (e?.message ?? e));
    }
  }

  async function doSearch() {
    setMsg("");
    try {
      const r = await fetch(`${API}/api/items?query=${encodeURIComponent(search.trim())}`);
      setItems(await r.json());
    } catch (e: any) {
      setMsg("Search failed: " + (e?.message ?? e));
    }
  }

  async function receive() {
    if (!sel) return setMsg("Select an item first.");
    if (qty <= 0) return setMsg("Quantity must be > 0.");
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API}/api/inventory/receive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: sel.id, quantity: qty, unitCost: cost, reference }),
      });
      if (!r.ok) throw new Error(await r.text());
      setQty(0); setCost(0); setReference("");
      await refreshStock();
      setMsg("Stock received ✅");
    } catch (e: any) {
      setMsg("Receive failed: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    if (!sel) return setMsg("Select an item first.");
    if (!adjDelta) return setMsg("Enter delta (±).");
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API}/api/inventory/adjust`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: sel.id, delta: adjDelta, reason: adjReason }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAdjDelta(0); setAdjReason("");
      await refreshStock();
      setMsg("Adjustment saved ✅");
    } catch (e: any) {
      setMsg("Adjust failed: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const totalValue = useMemo(() => rows.reduce((s, r) => s + Number(r.stockValue || 0), 0), [rows]);

  return (
    <div style={S.page}>
      <header style={S.header}>
        <h2 style={{ margin: 0 }}>Inventory</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={allowNegative} onChange={e => saveSetting(e.target.checked)} />
          Allow negative inventory
        </label>
      </header>

      <section style={S.card}>
        <h3>Receive stock</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search item…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doSearch()} style={S.input}/>
          <button onClick={doSearch} style={S.btn}>Search</button>
          <select value={sel?.id ?? ''} onChange={e => setSel(items.find(i => i.id === Number(e.target.value)) || null)} style={S.input}>
            <option value="">Select an item…</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
          </select>
        </div>

        {sel && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 10 }}>
            <div><label>Quantity</label><input type="number" value={qty} onChange={e=>setQty(Number(e.target.value))} style={S.input}/></div>
            <div><label>Unit Cost (₹)</label><input type="number" step="0.01" value={cost} onChange={e=>setCost(Number(e.target.value))} style={S.input}/></div>
            <div><label>Reference</label><input value={reference} onChange={e=>setReference(e.target.value)} style={S.input}/></div>
            <div style={{ display:'flex', alignItems:'end' }}><button onClick={receive} disabled={busy} style={S.btnPrimary}>Receive</button></div>
          </div>
        )}
      </section>

      <section style={S.card}>
        <h3>Adjust stock</h3>
        {!sel ? <div style={{ color:"#666" }}>Select an item above to adjust.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <div><label>Delta (±)</label><input type="number" value={adjDelta} onChange={e=>setAdjDelta(Number(e.target.value))} style={S.input}/></div>
            <div><label>Reason</label><input value={adjReason} onChange={e=>setAdjReason(e.target.value)} style={S.input}/></div>
            <div style={{ display:'flex', alignItems:'end' }}><button onClick={adjust} disabled={busy} style={S.btn}>Save Adjustment</button></div>
          </div>
        )}
      </section>

      <section style={S.card}>
        <h3>Stock on hand</h3>
        <div style={{ overflow: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr><th>SKU</th><th>Name</th><th style={{textAlign:'right'}}>On Hand</th><th style={{textAlign:'right'}}>Avg Cost</th><th style={{textAlign:'right'}}>Value</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td style={{textAlign:'right'}}>{r.onHand}</td>
                  <td style={{textAlign:'right'}}>{INR(r.avgCost)}</td>
                  <td style={{textAlign:'right'}}>{INR(r.stockValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ textAlign: "right", marginTop: 8, fontWeight: 700 }}>
          Total value: {INR(totalValue)}
        </div>
      </section>

      {msg && <div style={{ marginTop: 8, color: "#444" }}>{msg}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: 16, maxWidth: 1100, margin: "0 auto", fontFamily: "Inter, Arial, sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  card: { background: "#fff", border: "1px solid #e5e5e5", borderRadius: 10, padding: 14, marginBottom: 12 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc", width: "100%" },
  btn: { padding: "10px 14px", border: "1px solid #cfd2d7", background: "#fff", borderRadius: 8, cursor: "pointer" },
  btnPrimary: { padding: "10px 14px", border: "none", background: "#2563eb", color: "#fff", borderRadius: 8, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse" },
};
