import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";

const activeStatuses = new Set(["ASSIGNED", "IN_PROGRESS"]);

function Metric({ label, value, note, tone = "blue" }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </article>
  );
}

function RiskBar({ value }) {
  const width = Math.min(100, Math.max(8, value));
  return (
    <div className="risk-track" aria-label={`${value}% risk`}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const [data, setData] = useState({ inventory: [], orders: [], transfers: [], workOrders: [] });
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  async function load() {
    setError("");
    try {
      const [inventory, orders, transfers, workOrders] = await Promise.all([
        api.getInventory(), api.getOrders(), api.getTransfers(), api.getWorkOrders(),
      ]);
      setData({ inventory, orders, transfers, workOrders });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    const inventoryUnits = data.inventory.reduce((sum, row) => sum + Number(row.availableQty || 0), 0);
    const reservedUnits = data.inventory.reduce((sum, row) => sum + Number(row.reservedQty || 0), 0);
    const openOrders = data.orders.filter((row) => row.status === "RESERVED");
    const activeWorkOrders = data.workOrders.filter((row) => activeStatuses.has(row.status));
    const inTransit = data.transfers.filter((row) => row.status === "DISPATCHED");
    const risks = data.inventory
      .map((row) => {
        const physical = Number(row.physicalQty || 0);
        const available = Number(row.availableQty || 0);
        const risk = physical === 0 ? 100 : Math.round(((physical - available) / physical) * 100);
        return { ...row, risk, available };
      })
      .filter((row) => row.risk >= 50 || row.available <= 5)
      .sort((a, b) => b.risk - a.risk);

    return { inventoryUnits, reservedUnits, openOrders, activeWorkOrders, inTransit, risks };
  }, [data]);

  const activity = useMemo(() => [
    ...data.orders.map((row) => ({ id: `order-${row.id}`, type: "Order", title: `${row.item?.name || "Item"} reserved`, detail: `${row.quantity} units at ${row.location}`, status: row.status, rank: row.id })),
    ...data.transfers.map((row) => ({ id: `transfer-${row.id}`, type: "Transfer", title: `${row.item?.name || "Item"} moved`, detail: `${row.sourceLocation} -> ${row.destLocation}`, status: row.status, rank: row.id })),
    ...data.workOrders.map((row) => ({ id: `work-${row.id}`, type: "Work order", title: `${row.item?.name || "Item"} production`, detail: `${row.requiredQty} units at ${row.location}`, status: row.status, rank: row.id })),
  ].sort((a, b) => b.rank - a.rank).slice(0, 6), [data]);

  const attention = useMemo(() => {
    const items = summary.risks.slice(0, 2).map((row) => ({
      id: `risk-${row.id}`,
      priority: row.risk >= 80 ? "Urgent" : "Watch",
      title: `${row.item} is running low`,
      detail: `${row.available} available at ${row.location}`,
      href: "/inventory",
    }));
    if (summary.inTransit.length) {
      items.push({
        id: "transfers",
        priority: "Next",
        title: "Receive stock in transit",
        detail: `${summary.inTransit.length} transfer${summary.inTransit.length > 1 ? "s" : ""} waiting at destination`,
        href: "/transfers",
      });
    }
    if (summary.openOrders.length) {
      items.push({
        id: "orders",
        priority: "Today",
        title: "Customer orders need a look",
        detail: `${summary.openOrders.length} reservation${summary.openOrders.length > 1 ? "s" : ""} open`,
        href: "/orders",
      });
    }
    return items.slice(0, 4);
  }, [summary]);

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">{today} · Good morning, {user.email.split("@")[0]}</p>
          <h1>Ops Pulse</h1>
          <p className="hero-copy">A live read on stock, fulfillment, and production flow.</p>
        </div>
        <div className="hero-actions">
          <span className="live-indicator"><i /> Live workspace</span>
          <button className="refresh-button" onClick={load} aria-label="Refresh dashboard">Refresh</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="metric-grid" aria-label="Operations summary">
        <Metric label="Available units" value={summary.inventoryUnits} note={`${summary.reservedUnits} reserved across stock`} tone="blue" />
        <Metric label="Orders to fulfill" value={summary.openOrders.length} note="Customer reservations open" tone="coral" />
        <Metric label="Work in motion" value={summary.activeWorkOrders.length} note="Assigned or in progress" tone="green" />
        <Metric label="Transfers in transit" value={summary.inTransit.length} note="Awaiting destination receipt" tone="gold" />
      </section>

      <section className="dashboard-grid">
        <article className="panel risk-panel">
          <div className="section-heading">
            <div><p className="eyebrow">Decision support</p><h2>Inventory risk radar</h2></div>
            <span className="section-count">{summary.risks.length} signals</span>
          </div>
          {summary.risks.length === 0 ? (
            <div className="empty-state"><strong>Stock looks healthy</strong><span>No inventory is currently near a shortage threshold.</span></div>
          ) : (
            <div className="risk-list">
              {summary.risks.slice(0, 5).map((row) => (
                <div className="risk-row" key={row.id}>
                  <div className="risk-copy"><strong>{row.item}</strong><span>{row.location} / {row.batch}</span></div>
                  <div className="risk-meter"><RiskBar value={row.risk} /><small>{row.available} available</small></div>
                  <span className={`risk-label ${row.risk >= 80 ? "critical" : "watch"}`}>{row.risk >= 80 ? "Critical" : "Watch"}</span>
                </div>
              ))}
            </div>
          )}
          <Link className="text-link" to="/inventory">Open inventory <span aria-hidden="true">-&gt;</span></Link>
        </article>

        <article className="panel flow-panel">
          <div className="section-heading"><div><p className="eyebrow">Throughput</p><h2>Workflow health</h2></div><span className="pulse-dot" /></div>
          <div className="flow-list">
            <div className="flow-item"><span className="flow-icon coral">01</span><div><strong>Customer orders</strong><span>{summary.openOrders.length ? `${summary.openOrders.length} waiting for fulfillment` : "No open reservations"}</span></div><Link to="/orders">View</Link></div>
            <div className="flow-item"><span className="flow-icon green">02</span><div><strong>Production floor</strong><span>{summary.activeWorkOrders.length ? `${summary.activeWorkOrders.length} jobs underway` : "No active work orders"}</span></div><Link to="/workorders">View</Link></div>
            <div className="flow-item"><span className="flow-icon gold">03</span><div><strong>Internal logistics</strong><span>{summary.inTransit.length ? `${summary.inTransit.length} shipments in transit` : "All transfers received"}</span></div><Link to="/transfers">View</Link></div>
          </div>
        </article>
      </section>

      <section className="panel attention-panel">
        <div className="section-heading"><div><p className="eyebrow">A useful starting point</p><h2>Today's attention</h2></div><span className="updated-label">Prioritized from live data</span></div>
        {attention.length === 0 ? <div className="empty-state"><strong>Nothing asking for your attention</strong><span>The operation looks calm. A rare and beautiful thing.</span></div> : <div className="attention-list">{attention.map((item) => <Link className="attention-item" to={item.href} key={item.id}><span className={`attention-priority ${item.priority.toLowerCase()}`}>{item.priority}</span><span className="attention-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="attention-arrow">-&gt;</span></Link>)}</div>}
      </section>

      <section className="panel activity-panel">
        <div className="section-heading"><div><p className="eyebrow">System stream</p><h2>Recent activity</h2></div><span className="updated-label">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading"}</span></div>
        {activity.length === 0 ? <div className="empty-state"><strong>Activity will appear here</strong><span>Create an order, transfer, or work order to start the stream.</span></div> : <div className="activity-list">{activity.map((event) => <div className="activity-row" key={event.id}><span className="activity-type">{event.type}</span><div><strong>{event.title}</strong><span>{event.detail}</span></div><span className="status-badge">{event.status}</span></div>)}</div>}
      </section>
    </div>
  );
}
