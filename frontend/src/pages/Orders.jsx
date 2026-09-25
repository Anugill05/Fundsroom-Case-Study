import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Orders() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ itemId: "", location: "", quantity: "" });

  async function load() {
    try {
      setRows(await api.getOrders());
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
      await api.createOrder({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity) });
      setForm({ itemId: "", location: "", quantity: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancel(id) {
    setError("");
    try { await api.cancelOrder(id); load(); } catch (err) { setError(err.message); }
  }

  const canCreate = user.role === "ADMIN" || user.role === "SALES";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Customer-facing</p>
          <h1>Customer Orders</h1>
        </div>
        <span className="pill">{user.role}</span>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Item</th><th>Location</th><th>Qty</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td><td>{r.item?.name}</td><td>{r.location}</td><td>{r.quantity}</td><td><span className="status-badge">{r.status}</span></td>
                  <td>{r.status === "RESERVED" && canCreate && <button className="secondary" onClick={() => cancel(r.id)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canCreate && (
        <section className="panel form-panel">
          <h2>Reserve stock</h2>
          <form onSubmit={handleSubmit} className="stacked-form">
            <label>
              Item
              <select required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
                <option value="">Select</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label>Location<input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <label>Quantity<input required type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
            <button type="submit" className="primary">Reserve Stock</button>
          </form>
        </section>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
