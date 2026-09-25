require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

async function main() {
  const password = await bcrypt.hash("password123", 10);

  await db.user.upsert({
    where: { email: "admin@erp.com" },
    update: {},
    create: { email: "admin@erp.com", passwordHash: password, role: "ADMIN" },
  });

  await db.user.upsert({
    where: { email: "ops@erp.com" },
    update: {},
    create: { email: "ops@erp.com", passwordHash: password, role: "OPERATIONS", location: "WAREHOUSE-A" },
  });

  await db.user.upsert({
    where: { email: "sales@erp.com" },
    update: {},
    create: { email: "sales@erp.com", passwordHash: password, role: "SALES" },
  });

  let item = await db.item.findFirst({ where: { name: "Steel Bolt M8", category: "Hardware" } });
  if (!item) {
    item = await db.item.create({ data: { name: "Steel Bolt M8", category: "Hardware" } });
  }

  await db.inventory.upsert({
    where: { itemId_location_batch: { itemId: item.id, location: "WAREHOUSE-A", batch: "B001" } },
    update: {},
    create: { itemId: item.id, location: "WAREHOUSE-A", batch: "B001", physicalQty: 100, reservedQty: 0 },
  });

  await db.inventory.upsert({
    where: { itemId_location_batch: { itemId: item.id, location: "WAREHOUSE-B", batch: "B002" } },
    update: {},
    create: { itemId: item.id, location: "WAREHOUSE-B", batch: "B002", physicalQty: 40, reservedQty: 0 },
  });

  console.log("Seed complete.");
  console.log("Login with: admin@erp.com / ops@erp.com / sales@erp.com, password: password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
