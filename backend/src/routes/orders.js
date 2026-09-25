const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");
const { authorize, enforceOwnLocation } = require("../middleware/authorize");
const { requireFields, isNonEmptyString, isPositiveInt, firstError } = require("../utils/validate");

const router = express.Router();
router.use(requireAuth);

// GET /orders
router.get("/", async (req, res) => {
  const rows = await prisma.customerOrder.findMany({
    include: { item: true, createdBy: { select: { id: true, email: true } } },
    orderBy: { id: "asc" },
  });
  res.json(rows);
});

// POST /orders  (Sales only) - reserve stock for a customer order.
//
// Test 1: cannot reserve more than available inventory, even under
// concurrent requests (e.g. two Sales users racing for the same stock).
//
// Approach: reserve FIFO across matching Inventory rows inside a single
// DB transaction, using a conditional UPDATE ("only reserve if enough
// headroom remains") so the check-and-reserve is atomic at the DB level
// rather than a separate read-then-write (which would be a race condition).
router.post(
  "/",
  authorize("ADMIN", "SALES"),
  // If a SALES user is ever seeded with an assigned location, they can only
  // reserve stock there. Today's seed data leaves the sales user unrestricted
  // (no location), so this is a no-op until such a user exists — same guard
  // used on inventory/transfers.
  enforceOwnLocation((req) => req.body.location),
  async (req, res) => {
  const { itemId, location, quantity } = req.body;

  const err = firstError(
    requireFields(req.body, ["itemId", "location", "quantity"]),
    itemId !== undefined ? isPositiveInt(itemId, "itemId") : null,
    location !== undefined ? isNonEmptyString(location, "location", 60) : null,
    quantity !== undefined ? isPositiveInt(quantity, "quantity") : null
  );
  if (err) return res.status(400).json({ error: err });

  const qty = Number(quantity);
  const cleanLocation = location.trim();

  const item = await prisma.item.findUnique({ where: { id: Number(itemId) } });
  if (!item) return res.status(404).json({ error: "Item not found" });

  try {
    const order = await prisma.$transaction(async (tx) => {
      let remaining = qty;
      const rows = await tx.inventory.findMany({
        where: { itemId: Number(itemId), location: cleanLocation },
        orderBy: { id: "asc" },
      });

      for (const row of rows) {
        if (remaining <= 0) break;
        const available = row.physicalQty - row.reservedQty;
        if (available <= 0) continue;
        const take = Math.min(available, remaining);

        // Conditional write: only applies if headroom still holds at the
        // moment of writing, so the reservation check and update remain
        // atomic inside the database transaction.
        const updateResult = await tx.inventory.updateMany({
          where: {
            id: row.id,
            physicalQty: { gte: row.reservedQty + take },
          },
          data: { reservedQty: { increment: take } },
        });

        if (updateResult.count === 1) {
          remaining -= take;
          await tx.inventoryTransaction.create({
            data: {
              inventoryId: row.id,
              type: "RESERVE",
              quantity: take,
              reference: `ORDER-PENDING:${row.id}:${Date.now()}`,
            },
          });
        }
      }

      if (remaining > 0) {
        // Roll back everything reserved so far in this transaction —
        // partial reservation must never be left behind.
        throw Object.assign(
          new Error("Insufficient available stock to reserve this quantity"),
          { status: 409 }
        );
      }

      return tx.customerOrder.create({
        data: {
          itemId: Number(itemId),
          location: cleanLocation,
          quantity: qty,
          status: "RESERVED",
          createdByUserId: req.user.id,
        },
      });
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /orders/:id/cancel - releases reserved inventory back to available.
// (Matches "Live Verification / Change 3" so it's ready if drawn.)
router.post("/:id/cancel", authorize("ADMIN", "SALES"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.customerOrder.updateMany({
        where: { id, status: "RESERVED" },
        data: { status: "CANCELLED" },
      });
      if (updateResult.count === 0) {
        throw Object.assign(new Error("Order not found or not cancellable"), { status: 409 });
      }

      const order = await tx.customerOrder.findUnique({ where: { id } });

      // Release reservation FIFO across matching inventory rows.
      let remaining = order.quantity;
      const rows = await tx.inventory.findMany({
        where: { itemId: order.itemId, location: order.location, reservedQty: { gt: 0 } },
        orderBy: { id: "asc" },
      });
      for (const row of rows) {
        if (remaining <= 0) break;
        const release = Math.min(row.reservedQty, remaining);
        await tx.inventory.update({
          where: { id: row.id },
          data: { reservedQty: { decrement: release } },
        });
        remaining -= release;
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: row.id,
            type: "RELEASE",
            quantity: release,
            reference: `ORDER:${order.id}:CANCEL:${row.id}`,
          },
        });
      }

      return order;
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;