// Rich demo dataset for showing the app to a client/stakeholder.
// `npm run seed` (the original script) gives you the bare minimum needed to
// log in and click around; this gives you a populated, internally-consistent
// operation across 3 locations so the dashboard, risk radar, and tables
// don't look empty on a pitch call.
//
// Safe to re-run: it wipes and rebuilds every transactional table
// (inventory, work orders, transfers, customer orders) each time, and
// upserts users so existing logins/passwords are untouched.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const LOCATIONS = {
  PUNE: "Pune-Plant",
  CHENNAI: "Chennai-Warehouse",
  NOIDA: "Noida-DC",
};

async function upsertUser({ email, role, location }) {
  const passwordHash = await bcrypt.hash("password123", 10);
  return db.user.upsert({
    where: { email },
    update: { role, location: location || null },
    create: { email, passwordHash, role, location: location || null },
  });
}

async function upsertItem(name, category) {
  const existing = await db.item.findFirst({ where: { name, category } });
  if (existing) return existing;
  return db.item.create({ data: { name, category } });
}

async function upsertInventory({ itemId, location, batch, physicalQty, reservedQty }) {
  return db.inventory.upsert({
    where: { itemId_location_batch: { itemId, location, batch } },
    update: { physicalQty, reservedQty },
    create: { itemId, location, batch, physicalQty, reservedQty },
  });
}

async function main() {
  console.log("Wiping transactional data (inventory, work orders, transfers, orders)...");
  await db.inventoryTransaction.deleteMany();
  await db.customerOrder.deleteMany();
  await db.transfer.deleteMany();
  await db.workOrder.deleteMany();
  await db.inventory.deleteMany();
  await db.item.deleteMany();

  console.log("Seeding users...");
  const admin = await upsertUser({ email: "admin@erp.com", role: "ADMIN" });
  const ops = await upsertUser({ email: "ops@erp.com", role: "OPERATIONS", location: LOCATIONS.PUNE });
  const sales = await upsertUser({ email: "sales@erp.com", role: "SALES" });
  const priyaOps = await upsertUser({ email: "priya.ops@erp.com", role: "OPERATIONS", location: LOCATIONS.CHENNAI });
  const arjunOps = await upsertUser({ email: "arjun.ops@erp.com", role: "OPERATIONS", location: LOCATIONS.NOIDA });
  const nehaSales = await upsertUser({ email: "neha.sales@erp.com", role: "SALES" });
  void admin;

  console.log("Seeding items...");
  const bolt = await upsertItem("M8 Steel Bolt", "Hardware");
  const nut = await upsertItem("M6 Hex Nut", "Hardware");
  const bearing = await upsertItem("Ball Bearing 608ZZ", "Hardware");
  const arduino = await upsertItem("Arduino Uno R3", "Electronics");
  const motor = await upsertItem("12V DC Gear Motor", "Electronics");
  const cell = await upsertItem("Li-ion 18650 Cell", "Electronics");
  const box = await upsertItem("Corrugated Box - Medium", "Packaging");
  const bubbleWrap = await upsertItem("Bubble Wrap Roll 50m", "Packaging");
  const conveyor = await upsertItem("Conveyor Belt Unit - Assembled", "Finished Goods");

  console.log("Seeding inventory across 3 locations...");
  await upsertInventory({ itemId: bolt.id, location: LOCATIONS.PUNE, batch: "B-101", physicalQty: 800, reservedQty: 220 });
  await upsertInventory({ itemId: bolt.id, location: LOCATIONS.CHENNAI, batch: "B-102", physicalQty: 150, reservedQty: 40 });
  await upsertInventory({ itemId: nut.id, location: LOCATIONS.PUNE, batch: "B-201", physicalQty: 1200, reservedQty: 300 });
  await upsertInventory({ itemId: bearing.id, location: LOCATIONS.PUNE, batch: "B-301", physicalQty: 60, reservedQty: 45 }); // low stock
  await upsertInventory({ itemId: bearing.id, location: LOCATIONS.NOIDA, batch: "B-302", physicalQty: 25, reservedQty: 10 });
  await upsertInventory({ itemId: arduino.id, location: LOCATIONS.CHENNAI, batch: "B-401", physicalQty: 90, reservedQty: 35 });
  await upsertInventory({ itemId: motor.id, location: LOCATIONS.CHENNAI, batch: "B-501", physicalQty: 40, reservedQty: 38 }); // critical
  await upsertInventory({ itemId: cell.id, location: LOCATIONS.PUNE, batch: "B-601", physicalQty: 500, reservedQty: 120 });
  await upsertInventory({ itemId: cell.id, location: LOCATIONS.NOIDA, batch: "B-602", physicalQty: 70, reservedQty: 65 }); // critical
  await upsertInventory({ itemId: box.id, location: LOCATIONS.NOIDA, batch: "B-701", physicalQty: 2000, reservedQty: 400 });
  await upsertInventory({ itemId: bubbleWrap.id, location: LOCATIONS.NOIDA, batch: "B-801", physicalQty: 85, reservedQty: 20 });
  await upsertInventory({ itemId: conveyor.id, location: LOCATIONS.PUNE, batch: "B-901", physicalQty: 18, reservedQty: 12 });
  // Inventory received from already-completed transfers (see below) -- these
  // sit at the destination location under a TRANSFER-<id> batch, same
  // convention the real /transfers/:id/receive endpoint uses.
  const boltAtChennaiFromTransfer = await upsertInventory({ itemId: bolt.id, location: LOCATIONS.CHENNAI, batch: "TRANSFER-1", physicalQty: 50, reservedQty: 0 });
  const boxAtPuneFromTransfer = await upsertInventory({ itemId: box.id, location: LOCATIONS.PUNE, batch: "TRANSFER-4", physicalQty: 300, reservedQty: 0 });
  void boltAtChennaiFromTransfer;
  void boxAtPuneFromTransfer;

  console.log("Seeding work orders...");
  await db.workOrder.create({ data: { location: LOCATIONS.PUNE, itemId: bearing.id, requiredQty: 50, assignedUserId: ops.id, status: "IN_PROGRESS" } });
  await db.workOrder.create({ data: { location: LOCATIONS.PUNE, itemId: bolt.id, requiredQty: 300, assignedUserId: ops.id, status: "ASSIGNED" } });
  await db.workOrder.create({ data: { location: LOCATIONS.CHENNAI, itemId: arduino.id, requiredQty: 60, assignedUserId: priyaOps.id, status: "IN_PROGRESS" } });
  await db.workOrder.create({ data: { location: LOCATIONS.CHENNAI, itemId: motor.id, requiredQty: 45, assignedUserId: priyaOps.id, status: "ASSIGNED" } });
  await db.workOrder.create({ data: { location: LOCATIONS.NOIDA, itemId: cell.id, requiredQty: 20, assignedUserId: arjunOps.id, status: "COMPLETED" } });
  await db.workOrder.create({ data: { location: LOCATIONS.NOIDA, itemId: box.id, requiredQty: 500, assignedUserId: arjunOps.id, status: "COMPLETED" } });

  console.log("Seeding internal transfers...");
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000);
  await db.transfer.create({ data: { sourceLocation: LOCATIONS.PUNE, destLocation: LOCATIONS.CHENNAI, itemId: bolt.id, quantity: 50, status: "RECEIVED", dispatchedAt: hoursAgo(30), receivedAt: hoursAgo(26) } });
  await db.transfer.create({ data: { sourceLocation: LOCATIONS.CHENNAI, destLocation: LOCATIONS.PUNE, itemId: arduino.id, quantity: 15, status: "DISPATCHED", dispatchedAt: hoursAgo(4) } });
  await db.transfer.create({ data: { sourceLocation: LOCATIONS.PUNE, destLocation: LOCATIONS.NOIDA, itemId: cell.id, quantity: 40, status: "REQUESTED" } });
  await db.transfer.create({ data: { sourceLocation: LOCATIONS.NOIDA, destLocation: LOCATIONS.PUNE, itemId: box.id, quantity: 300, status: "RECEIVED", dispatchedAt: hoursAgo(50), receivedAt: hoursAgo(48) } });
  await db.transfer.create({ data: { sourceLocation: LOCATIONS.CHENNAI, destLocation: LOCATIONS.NOIDA, itemId: bearing.id, quantity: 10, status: "DISPATCHED", dispatchedAt: hoursAgo(2) } });

  console.log("Seeding customer orders (reservations)...");
  const reserved = (itemId, location, quantity, createdBy) =>
    db.customerOrder.create({ data: { itemId, location, quantity, status: "RESERVED", createdByUserId: createdBy.id } });

  await reserved(bolt.id, LOCATIONS.PUNE, 150, sales);
  await reserved(bolt.id, LOCATIONS.PUNE, 70, nehaSales);
  await reserved(bolt.id, LOCATIONS.CHENNAI, 40, sales);
  await reserved(nut.id, LOCATIONS.PUNE, 300, nehaSales);
  await reserved(bearing.id, LOCATIONS.PUNE, 45, sales);
  await reserved(bearing.id, LOCATIONS.NOIDA, 10, nehaSales);
  await reserved(arduino.id, LOCATIONS.CHENNAI, 35, sales);
  await reserved(motor.id, LOCATIONS.CHENNAI, 38, nehaSales);
  await reserved(cell.id, LOCATIONS.PUNE, 120, sales);
  await reserved(cell.id, LOCATIONS.NOIDA, 65, nehaSales);
  await reserved(box.id, LOCATIONS.NOIDA, 400, sales);
  await reserved(bubbleWrap.id, LOCATIONS.NOIDA, 20, nehaSales);
  await reserved(conveyor.id, LOCATIONS.PUNE, 12, sales);
  // One cancelled order, so the "cancel releases reservation" behavior
  // (Live Verification change 3) has an example to point at.
  await db.customerOrder.create({ data: { itemId: nut.id, location: LOCATIONS.PUNE, quantity: 80, status: "CANCELLED", createdByUserId: nehaSales.id } });

  console.log("\nDemo dataset loaded: 3 locations, 9 items, 6 work orders, 5 transfers, 14 customer orders.");
  console.log("Log in with any of (password for all: password123):");
  console.log("  admin@erp.com        (ADMIN, unrestricted)");
  console.log("  ops@erp.com          (OPERATIONS, Pune-Plant)");
  console.log("  priya.ops@erp.com    (OPERATIONS, Chennai-Warehouse)");
  console.log("  arjun.ops@erp.com    (OPERATIONS, Noida-DC)");
  console.log("  sales@erp.com        (SALES)");
  console.log("  neha.sales@erp.com   (SALES)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
