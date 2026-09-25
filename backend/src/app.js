const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const itemRoutes = require("./routes/items");
const inventoryRoutes = require("./routes/inventory");
const workOrderRoutes = require("./routes/workorders");
const transferRoutes = require("./routes/transfers");
const orderRoutes = require("./routes/orders");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "ok", message: "Mini Ops ERP API" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/items", itemRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/workorders", workOrderRoutes);
app.use("/transfers", transferRoutes);
app.use("/orders", orderRoutes);

// Central error handler (catches anything not already handled in a route)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

module.exports = app;
