import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Transfers() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ sourceLocation: "", destLocation: "", itemId: "", quantity: "" });

  async function load() {
    try {
      setRows(await api.getTransfers());
      setItems(await api.getItems());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createTransfer({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity) });
      setForm({ sourceLocation: "", destLocation: "", itemId: "", quantity: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function dispatch(id) {
    setError("");
    try { await api.dispatchTransfer(id); load(); } catch (err) { setError(err.message); }
  }
  async function receive(id) {
    setError("");
    try { await api.receiveTransfer(id); load(); } catch (err) { setError(err.message); }
  }

  const canAct = user.role === "ADMIN" || user.role === "OPERATIONS";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory movement</p>
          <h1>Internal Transfers</h1>
        </div>
        <span className="pill">{user.role}</span>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Item</th><th>Source</th><th>Dest</th><th>Qty</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td><td>{r.item?.name}</td><td>{r.sourceLocation}</td><td>{r.destLocation}</td>
                  <td>{r.quantity}</td><td><span className="status-badge">{r.status}</span></td>
                  <td>
                    {canAct && r.status === "REQUESTED" && <button className="secondary" onClick={() => dispatch(r.id)}>Dispatch</button>}
                    {canAct && r.status === "DISPATCHED" && <button className="secondary" onClick={() => receive(r.id)}>Receive</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canAct && (
        <section className="panel form-panel">
          <h2>Request transfer</h2>
          <form onSubmit={handleSubmit} className="stacked-form">
            <label>Source location<input required value={form.sourceLocation} onChange={(e) => setForm({ ...form, sourceLocation: e.target.value })} /></label>
            <label>Destination location<input required value={form.destLocation} onChange={(e) => setForm({ ...form, destLocation: e.target.value })} /></label>
            <label>
              Item
              <select required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
                <option value="">Select</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label>Quantity<input required type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
            <button type="submit" className="primary">Request Transfer</button>
          </form>
        </section>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
