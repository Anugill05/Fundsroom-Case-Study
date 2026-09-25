const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");
const { authorize, enforceOwnLocation } = require("../middleware/authorize");
const { requireFields, isNonEmptyString, isPositiveInt, firstError } = require("../utils/validate");

const router = express.Router();
router.use(requireAuth);

// GET /transfers
router.get("/", async (req, res) => {
  const rows = await prisma.transfer.findMany({
    include: { item: true },
    orderBy: { id: "asc" },
  });
  res.json(rows);
});

// POST /transfers  - request a transfer (Operations/Admin)
router.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  // An OPERATIONS user can only request a transfer OUT of their own
  // assigned location, not any warehouse.
  enforceOwnLocation((req) => req.body.sourceLocation),
  async (req, res) => {
  const { sourceLocation, destLocation, itemId, quantity } = req.body;

  const err = firstError(
    requireFields(req.body, ["sourceLocation", "destLocation", "itemId", "quantity"]),
    sourceLocation !== undefined ? isNonEmptyString(sourceLocation, "sourceLocation", 60) : null,
    destLocation !== undefined ? isNonEmptyString(destLocation, "destLocation", 60) : null,
    itemId !== undefined ? isPositiveInt(itemId, "itemId") : null,
    quantity !== undefined ? isPositiveInt(quantity, "quantity") : null
  );
  if (err) return res.status(400).json({ error: err });

  const qty = Number(quantity);
  const cleanSource = sourceLocation.trim();
  const cleanDest = destLocation.trim();

  if (cleanSource === cleanDest) {
    return res.status(400).json({ error: "sourceLocation and destLocation must differ" });
  }

  const item = await prisma.item.findUnique({ where: { id: Number(itemId) } });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const transfer = await prisma.transfer.create({
    data: { sourceLocation: cleanSource, destLocation: cleanDest, itemId: Number(itemId), quantity: qty, status: "REQUESTED" },
  });
  res.status(201).json(transfer);
});

// POST /transfers/:id/dispatch  - reduces SOURCE inventory.
// Test 2: cannot transfer more than available inventory.
router.post("/:id/dispatch", authorize("ADMIN", "OPERATIONS"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.findUnique({ where: { id } });
      if (!transfer) throw Object.assign(new Error("Transfer not found"), { status: 404 });
      if (transfer.status !== "REQUESTED") {
        throw Object.assign(
          new Error(`Transfer cannot be dispatched from status '${transfer.status}'`),
          { status: 409 }
        );
      }

      // Reduce available source inventory across matching batches (FIFO),
      // using a conditional UPDATE so concurrent dispatches can never push
      // physicalQty below reservedQty (i.e. never oversell available stock).
      let remaining = transfer.quantity;
      const sourceRows = await tx.inventory.findMany({
        where: { itemId: transfer.itemId, location: transfer.sourceLocation },
        orderBy: { id: "asc" },
      });

      for (const row of sourceRows) {
        if (remaining <= 0) break;
        const available = row.physicalQty - row.reservedQty;
        if (available <= 0) continue;
        const take = Math.min(available, remaining);

        const updateResult = await tx.inventory.updateMany({
          where: {
            id: row.id,
            physicalQty: { gte: row.reservedQty + take }, // re-checked at write time
          },
          data: { physicalQty: { decrement: take } },
        });

        if (updateResult.count === 1) {
          remaining -= take;
          await tx.inventoryTransaction.create({
            data: {
              inventoryId: row.id,
              type: "TRANSFER_OUT",
              quantity: take,
              reference: `TRANSFER:${transfer.id}:${row.id}`,
            },
          });
        }
      }

      if (remaining > 0) {
        // Not enough available stock at source — abort, nothing is committed.
        throw Object.assign(
          new Error("Insufficient available stock at source location for this transfer"),
          { status: 409 }
        );
      }

      return tx.transfer.update({
        where: { id },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
      });
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /transfers/:id/receive  - increases DESTINATION inventory.
// Test 3: destination stock increases only after receipt.
// Test 4: same transfer cannot be received twice.
router.post("/:id/receive", authorize("ADMIN", "OPERATIONS"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Atomic status flip: only succeeds if currently DISPATCHED. This is
      // what makes double-receive impossible even under concurrent requests.
      const updateResult = await tx.transfer.updateMany({
        where: { id, status: "DISPATCHED" },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });

      if (updateResult.count === 0) {
        const existing = await tx.transfer.findUnique({ where: { id } });
        if (!existing) throw Object.assign(new Error("Transfer not found"), { status: 404 });
        throw Object.assign(
          new Error(`Transfer already ${existing.status.toLowerCase()} — cannot receive again`),
          { status: 409 }
        );
      }

      const transfer = await tx.transfer.findUnique({ where: { id } });

      const destRow = await tx.inventory.upsert({
        where: {
          itemId_location_batch: {
            itemId: transfer.itemId,
            location: transfer.destLocation,
            batch: `TRANSFER-${transfer.id}`,
          },
        },
        update: { physicalQty: { increment: transfer.quantity } },
        create: {
          itemId: transfer.itemId,
          location: transfer.destLocation,
          batch: `TRANSFER-${transfer.id}`,
          physicalQty: transfer.quantity,
          reservedQty: 0,
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: destRow.id,
          type: "TRANSFER_IN",
          quantity: transfer.quantity,
          reference: `TRANSFER:${transfer.id}:RECEIVE`,
        },
      });

      return transfer;
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;