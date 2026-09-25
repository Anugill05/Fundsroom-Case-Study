const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");

const router = express.Router();
router.use(requireAuth);

// GET /workorders
router.get("/", async (req, res) => {
  const rows = await prisma.workOrder.findMany({
    include: { item: true, assignedUser: { select: { id: true, email: true } } },
    orderBy: { id: "asc" },
  });
  res.json(rows);
});

// POST /workorders  (Admin only, per spec)
// Automatically checks material availability at the work order's location
// and returns the computed shortage, if any.
router.post("/", authorize("ADMIN"), async (req, res) => {
  const { location, itemId, requiredQty, assignedUserId } = req.body;

  if (!location || !itemId || !requiredQty || !assignedUserId) {
    return res.status(400).json({
      error: "location, itemId, requiredQty and assignedUserId are required",
    });
  }
  const qty = Number(requiredQty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: "requiredQty must be a positive integer" });
  }

  const item = await prisma.item.findUnique({ where: { id: Number(itemId) } });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const assignedUser = await prisma.user.findUnique({ where: { id: Number(assignedUserId) } });
  if (!assignedUser) return res.status(404).json({ error: "Assigned user not found" });

  const workOrder = await prisma.workOrder.create({
    data: {
      location,
      itemId: Number(itemId),
      requiredQty: qty,
      assignedUserId: Number(assignedUserId),
      status: "ASSIGNED",
    },
  });

  const stockAtLocation = await prisma.inventory.findMany({
    where: { itemId: Number(itemId), location },
  });
  const availableAtLocation = stockAtLocation.reduce(
    (sum, row) => sum + (row.physicalQty - row.reservedQty),
    0
  );
  const shortage = Math.max(0, qty - availableAtLocation);

  res.status(201).json({
    workOrder,
    stockCheck: {
      requiredQty: qty,
      availableAtLocation,
      shortage,
      needsTransfer: shortage > 0,
    },
  });
});

// PATCH /workorders/:id/status  (Operations/Admin can progress a work order)
router.patch("/:id/status", authorize("ADMIN", "OPERATIONS"), async (req, res) => {
  const { status } = req.body;
  const allowed = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(", ")}` });
  }

  try {
    const wo = await prisma.workOrder.update({
      where: { id: Number(req.params.id) },
      data: { status },
    });
    res.json(wo);
  } catch (err) {
    res.status(404).json({ error: "Work order not found" });
  }
});

module.exports = router;
