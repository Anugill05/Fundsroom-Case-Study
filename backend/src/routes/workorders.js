const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { requireFields, isNonEmptyString, isPositiveInt, isOneOf, firstError } = require("../utils/validate");

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

  const err = firstError(
    requireFields(req.body, ["location", "itemId", "requiredQty", "assignedUserId"]),
    location !== undefined ? isNonEmptyString(location, "location", 60) : null,
    itemId !== undefined ? isPositiveInt(itemId, "itemId") : null,
    requiredQty !== undefined ? isPositiveInt(requiredQty, "requiredQty") : null,
    assignedUserId !== undefined ? isPositiveInt(assignedUserId, "assignedUserId") : null
  );
  if (err) return res.status(400).json({ error: err });

  const qty = Number(requiredQty);
  const cleanLocation = location.trim();

  const item = await prisma.item.findUnique({ where: { id: Number(itemId) } });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const assignedUser = await prisma.user.findUnique({ where: { id: Number(assignedUserId) } });
  if (!assignedUser) return res.status(404).json({ error: "Assigned user not found" });

  const workOrder = await prisma.workOrder.create({
    data: {
      location: cleanLocation,
      itemId: Number(itemId),
      requiredQty: qty,
      assignedUserId: Number(assignedUserId),
      status: "ASSIGNED",
    },
  });

  const stockAtLocation = await prisma.inventory.findMany({
    where: { itemId: Number(itemId), location: cleanLocation },
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

  const err = firstError(
    requireFields(req.body, ["status"]),
    status !== undefined ? isOneOf(status, allowed, "status") : null
  );
  if (err) return res.status(400).json({ error: err });

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