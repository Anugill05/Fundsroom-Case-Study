const request = require("supertest");
const app = require("../src/app");
const db = require("../src/db");

let adminToken, opsToken, salesToken;
let itemId;

async function resetDb() {
  await db.inventoryTransaction.deleteMany();
  await db.customerOrder.deleteMany();
  await db.transfer.deleteMany();
  await db.workOrder.deleteMany();
  await db.inventory.deleteMany();
  await db.item.deleteMany();
  await db.user.deleteMany();
}

async function registerAndLogin(email, role, location) {
  await request(app).post("/auth/register").send({ email, password: "pass1234", role, location });
  const res = await request(app).post("/auth/login").send({ email, password: "pass1234" });
  return res.body.token;
}

beforeAll(async () => {
  await resetDb();
  adminToken = await registerAndLogin("admin@test.com", "ADMIN");
  opsToken = await registerAndLogin("ops@test.com", "OPERATIONS");
  salesToken = await registerAndLogin("sales@test.com", "SALES");

  const itemRes = await db.item.create({ data: { name: "Widget", category: "General" } });
  itemId = itemRes.id;
});

describe("API root", () => {
  it("returns a JSON health message at GET /", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.message).toMatch(/Mini Ops ERP API/i);
  });
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  // Reset only stock-related tables between tests, keep users/items.
  await db.inventoryTransaction.deleteMany();
  await db.customerOrder.deleteMany();
  await db.transfer.deleteMany();
  await db.workOrder.deleteMany();
  await db.inventory.deleteMany();

  await db.inventory.create({
    data: { itemId, location: "LOC-A", batch: "B1", physicalQty: 100, reservedQty: 0 },
  });
});

describe("Test 1: Cannot reserve more than available inventory", () => {
  it("rejects a single order requesting more than available stock", async () => {
    const res = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ itemId, location: "LOC-A", quantity: 150 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  it("prevents two concurrent reservations from exceeding available stock", async () => {
    // Available = 100. Two requests for 80 each must not both succeed.
    const [resA, resB] = await Promise.all([
      request(app).post("/orders").set("Authorization", `Bearer ${salesToken}`)
        .send({ itemId, location: "LOC-A", quantity: 80 }),
      request(app).post("/orders").set("Authorization", `Bearer ${salesToken}`)
        .send({ itemId, location: "LOC-A", quantity: 50 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one of the two must succeed (201) and the other must fail (409).
    expect(statuses).toEqual([201, 409]);

    const inv = await db.inventory.findFirst({ where: { itemId, location: "LOC-A" } });
    expect(inv.reservedQty).toBeLessThanOrEqual(inv.physicalQty);
  });
});

describe("Test 2: Cannot transfer more than available inventory", () => {
  it("rejects dispatch when quantity exceeds available stock at source", async () => {
    const transferRes = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ sourceLocation: "LOC-A", destLocation: "LOC-B", itemId, quantity: 500 });

    const dispatchRes = await request(app)
      .post(`/transfers/${transferRes.body.id}/dispatch`)
      .set("Authorization", `Bearer ${opsToken}`);

    expect(dispatchRes.status).toBe(409);
    expect(dispatchRes.body.error).toMatch(/insufficient/i);
  });
});

describe("Test 3: Destination stock increases only after transfer receipt", () => {
  it("does not increase destination stock until /receive is called", async () => {
    const transferRes = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ sourceLocation: "LOC-A", destLocation: "LOC-B", itemId, quantity: 30 });
    const transferId = transferRes.body.id;

    await request(app)
      .post(`/transfers/${transferId}/dispatch`)
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);

    let destStock = await db.inventory.findFirst({ where: { itemId, location: "LOC-B" } });
    expect(destStock).toBeNull(); // not yet received

    await request(app)
      .post(`/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);

    destStock = await db.inventory.findFirst({ where: { itemId, location: "LOC-B" } });
    expect(destStock.physicalQty).toBe(30);
  });
});

describe("Test 4: Same transfer cannot be received twice", () => {
  it("rejects a second /receive call on the same transfer", async () => {
    const transferRes = await request(app)
      .post("/transfers")
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ sourceLocation: "LOC-A", destLocation: "LOC-B", itemId, quantity: 10 });
    const transferId = transferRes.body.id;

    await request(app)
      .post(`/transfers/${transferId}/dispatch`)
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);

    await request(app)
      .post(`/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);

    const secondReceive = await request(app)
      .post(`/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${opsToken}`);

    expect(secondReceive.status).toBe(409);
    expect(secondReceive.body.error).toMatch(/already/i);
  });
});

describe("Test 5: Unauthorized user cannot perform restricted operation", () => {
  it("rejects a SALES user creating a Work Order (Admin only)", async () => {
    const res = await request(app)
      .post("/workorders")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ location: "LOC-A", itemId, requiredQty: 5, assignedUserId: 1 });

    expect(res.status).toBe(403);
  });

  it("rejects requests with no auth token at all", async () => {
    const res = await request(app).get("/inventory");
    expect(res.status).toBe(401);
  });
});

describe("Location restriction: an OPERATIONS user can only act on their own assigned location", () => {
  let restrictedOpsToken;

  beforeAll(async () => {
    // Unlike the shared `opsToken` (no location -> unrestricted), this user
    // is assigned to LOC-A specifically, so enforceOwnLocation should kick in.
    restrictedOpsToken = await registerAndLogin("ops-loca@test.com", "OPERATIONS", "LOC-A");
  });

  it("rejects a stock top-up at a location the user isn't assigned to", async () => {
    const res = await request(app)
      .post("/inventory")
      .set("Authorization", `Bearer ${restrictedOpsToken}`)
      .send({ itemName: "Widget", category: "General", location: "LOC-B", batch: "B-restricted", physicalQty: 20 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/restricted to location/i);
  });

  it("allows the same user to act at their own assigned location", async () => {
    const res = await request(app)
      .post("/inventory")
      .set("Authorization", `Bearer ${restrictedOpsToken}`)
      .send({ itemName: "Widget", category: "General", location: "LOC-A", batch: "B-allowed", physicalQty: 20 });

    expect(res.status).toBe(201);
  });
});

describe("Bonus: Duplicate inventory transaction is rejected", () => {
  it("rejects a second /inventory POST that reuses the same idempotency reference", async () => {
    const payload = {
      itemName: "Widget", category: "General", location: "LOC-A", batch: "B1",
      physicalQty: 10, reference: "dup-test-ref-001",
    };

    const first = await request(app)
      .post("/inventory")
      .set("Authorization", `Bearer ${opsToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/inventory")
      .set("Authorization", `Bearer ${opsToken}`)
      .send(payload);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/duplicate/i);
  });
});
