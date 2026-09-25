const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");
const { authorize, enforceOwnLocation } = require("../middleware/authorize");

const router = express.Router();
router.use(requireAuth);

function toAvailable(inv) {
  return {
    id: inv.id,
    item: inv.item?.name,
    itemId: inv.itemId,
    category: inv.item?.category,
    location: inv.location,
    batch: inv.batch,
    physicalQty: inv.physicalQty,
    reservedQty: inv.reservedQty,
    availableQty: inv.physicalQty - inv.reservedQty,
  };
}

// GET /inventory  - list all stock, computed availableQty included
router.get("/", async (req, res) => {
  const rows = await prisma.inventory.findMany({
    include: { item: true },
    orderBy: { id: "asc" },
  });
  res.json(rows.map(toAvailable));
});

// POST /inventory  - create or top-up a stock line (Admin/Operations only)
// Also creates/reuses the Item by name+category if it doesn't exist yet.
router.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  // An OPERATIONS user is only allowed to adjust stock at the location they
  // were seeded/created with. Admins have no `location` set, so they stay
  // unrestricted (see enforceOwnLocation).
  enforceOwnLocation((req) => req.body.location),
  async (req, res) => {
  const { itemName, category, location, batch, physicalQty, reference } = req.body;

  if (!itemName || !category || !location || !batch) {
    return res.status(400).json({ error: "itemName, category, location and batch are required" });
  }
  const qty = Number(physicalQty);
  if (!Number.isInteger(qty) || qty < 0) {
    return res.status(400).json({ error: "physicalQty must be a non-negative integer" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let item = await tx.item.findFirst({ where: { name: itemName, category } });
      if (!item) {
        item = await tx.item.create({ data: { name: itemName, category } });
      }

      // Duplicate inventory transaction guard: if a `reference` is supplied
      // (e.g. an idempotency key from the client), reject if already applied.
      if (reference) {
        const dup = await tx.inventoryTransaction.findUnique({
          where: { reference_type: { reference, type: "ADJUSTMENT" } },
        }).catch(() => null);
        if (dup) {
          throw Object.assign(new Error("Duplicate inventory transaction"), { status: 409 });
        }
      }

      const inv = await tx.inventory.upsert({
        where: { itemId_location_batch: { itemId: item.id, location, batch } },
        update: { physicalQty: { increment: qty } },
        create: { itemId: item.id, location, batch, physicalQty: qty, reservedQty: 0 },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inv.id,
          type: "ADJUSTMENT",
          quantity: qty,
          reference: reference || `ADJ:${inv.id}:${Date.now()}`,
        },
      });

      return tx.inventory.findUnique({ where: { id: inv.id }, include: { item: true } });
    });

    res.status(201).json(toAvailable(result));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
