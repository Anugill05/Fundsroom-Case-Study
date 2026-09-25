import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Login from "./pages/Login";
import Inventory from "./pages/Inventory";
import WorkOrders from "./pages/WorkOrders";
import Transfers from "./pages/Transfers";
import Orders from "./pages/Orders";
import Dashboard from "./pages/Dashboard";

function Protected({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Overview" },
  { to: "/inventory", label: "Inventory" },
  { to: "/workorders", label: "Work Orders" },
  { to: "/transfers", label: "Transfers" },
  { to: "/orders", label: "Orders" },
];

function Sidebar() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">M</div>
        <div>
          <div className="brand-title">Mini Ops ERP</div>
          <div className="brand-subtitle">Operations desk</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "sidebar-link is-active" : "sidebar-link")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="account-chip">
          <span className="account-avatar">{user.email[0].toUpperCase()}</span>
          <span>
            <strong>{user.email.split("@")[0]}</strong>
            <small>{user.role.toLowerCase()}</small>
          </span>
        </span>
        <button className="logout-button" onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <div className={user ? "app-shell with-sidebar" : "app-shell"}>
      <Sidebar />
      <div className="main-area">
        <main className="content">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
            <Route path="/workorders" element={<Protected><WorkOrders /></Protected>} />
            <Route path="/transfers" element={<Protected><Transfers /></Protected>} />
            <Route path="/orders" element={<Protected><Orders /></Protected>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
