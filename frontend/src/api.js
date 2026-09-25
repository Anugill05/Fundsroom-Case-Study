const configuredApiUrl = import.meta.env.VITE_API_URL;
const API_URL = (configuredApiUrl || "http://localhost:4000").replace(/\/$/, "");

function getToken() {
  return localStorage.getItem("token");
}

async function request(path, { method = "GET", body } = {}) {
  if (import.meta.env.PROD && !configuredApiUrl) {
    throw new Error("API is not configured. Add VITE_API_URL to the Vercel frontend project and redeploy.");
  }
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`Cannot reach the API at ${API_URL}. Check VITE_API_URL and the backend deployment.`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 405) {
      throw new Error(`The API rejected ${method} ${path}. VITE_API_URL must be your backend Vercel URL, not the frontend URL.`);
    }
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  getItems: () => request("/items"),
  getInventory: () => request("/inventory"),
  addInventory: (payload) => request("/inventory", { method: "POST", body: payload }),
  getWorkOrders: () => request("/workorders"),
  createWorkOrder: (payload) => request("/workorders", { method: "POST", body: payload }),
  updateWorkOrderStatus: (id, status) =>
    request(`/workorders/${id}/status`, { method: "PATCH", body: { status } }),
  getTransfers: () => request("/transfers"),
  createTransfer: (payload) => request("/transfers", { method: "POST", body: payload }),
  dispatchTransfer: (id) => request(`/transfers/${id}/dispatch`, { method: "POST" }),
  receiveTransfer: (id) => request(`/transfers/${id}/receive`, { method: "POST" }),
  getOrders: () => request("/orders"),
  createOrder: (payload) => request("/orders", { method: "POST", body: payload }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: "POST" }),
};

export { getToken };
