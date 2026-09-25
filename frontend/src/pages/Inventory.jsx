import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function Inventory() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    itemName: "", category: "", location: "", batch: "", physicalQty: "",
  });
  // A fresh idempotency key per pending submission. If the same request is
  // accidentally fired twice (double-click, network retry), the backend's
  // (reference, type) unique constraint rejects the duplicate instead of
  // double-counting stock. A new key is only generated after success.
  const [submissionRef, setSubmissionRef] = useState(() => crypto.randomUUID());

  async function load() {
    try {
      setRows(await api.getInventory());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await api.addInventory({ ...form, physicalQty: Number(form.physicalQty), reference: submissionRef });
      setForm({ itemName: "", category: "", location: "", batch: "", physicalQty: "" });
      setSubmissionRef(crypto.randomUUID()); // new key for the next distinct submission
      load();
    } catch (err) {
      setError(err.message); // keep the same submissionRef so a retry of THIS attempt is deduped
    }
  }

  const canEdit = user.role === "ADMIN" || user.role === "OPERATIONS";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Inventory</h1>
        </div>
        <span className="pill">{user.role}</span>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Category</th><th>Location</th><th>Batch</th>
                <th>Physical</th><th>Reserved</th><th>Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.item}</td><td>{r.category}</td><td>{r.location}</td><td>{r.batch}</td>
                  <td>{r.physicalQty}</td><td>{r.reservedQty}</td><td>{r.availableQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit && (
        <section className="panel form-panel">
          <h2>Add inventory</h2>
          <form onSubmit={handleSubmit} className="stacked-form">
            <label>Item name<input required value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} /></label>
            <label>Category<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
            <label>Location<input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <label>Batch<input required value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} /></label>
            <label>Physical qty<input required type="number" min="0" value={form.physicalQty} onChange={(e) => setForm({ ...form, physicalQty: e.target.value })} /></label>
            <button type="submit" className="primary">Add / Top up stock</button>
          </form>
        </section>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
