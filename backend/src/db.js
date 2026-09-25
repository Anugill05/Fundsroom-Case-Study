// PostgreSQL-backed data layer, exposing the same small Prisma-like API the
// routes were already written against (findMany/findFirst/findUnique/create/
// update/updateMany/upsert/deleteMany/$transaction) -- so switching the
// underlying database from MongoDB to a real relational database required
// changing only this file, not the route handlers.
const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/mini_ops_erp";

// Hosted Postgres providers (Neon, Render, Supabase, RDS, etc.) require SSL
// and typically use a certificate chain that Node won't verify by default.
// Local/Docker/embedded-postgres connections never match this pattern, so
// this only kicks in against a real hosted DATABASE_URL.
const needsSsl = /sslmode=require|neon\.tech|render\.com|amazonaws\.com|supabase\.co/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});
let migrated;

// Table + column-name maps. Keys are the camelCase field names the routes
// already use; values are the actual snake_case Postgres column names.
const MODELS = {
  user: {
    table: "users",
    columns: {
      id: "id",
      email: "email",
      passwordHash: "password_hash",
      role: "role",
      location: "location",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  item: {
    table: "items",
    columns: {
      id: "id",
      name: "name",
      category: "category",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  inventory: {
    table: "inventory",
    columns: {
      id: "id",
      itemId: "item_id",
      location: "location",
      batch: "batch",
      physicalQty: "physical_qty",
      reservedQty: "reserved_qty",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  inventoryTransaction: {
    table: "inventory_transactions",
    columns: {
      id: "id",
      inventoryId: "inventory_id",
      type: "type",
      quantity: "quantity",
      reference: "reference",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  workOrder: {
    table: "work_orders",
    columns: {
      id: "id",
      location: "location",
      itemId: "item_id",
      requiredQty: "required_qty",
      assignedUserId: "assigned_user_id",
      status: "status",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  transfer: {
    table: "transfers",
    columns: {
      id: "id",
      sourceLocation: "source_location",
      destLocation: "dest_location",
      itemId: "item_id",
      quantity: "quantity",
      status: "status",
      dispatchedAt: "dispatched_at",
      receivedAt: "received_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  customerOrder: {
    table: "customer_orders",
    columns: {
      id: "id",
      itemId: "item_id",
      location: "location",
      quantity: "quantity",
      status: "status",
      createdByUserId: "created_by_user_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
};

// Shorthand composite-key names the routes use in `where`, e.g.
// `where: { itemId_location_batch: { itemId, location, batch } }`.
const compositeKeys = {
  inventory: { itemId_location_batch: ["itemId", "location", "batch"] },
  inventoryTransaction: { reference_type: ["reference", "type"] },
};

// Same relation shape the Mongo version used, so `include` keeps working.
const relationMap = {
  inventory: { item: ["itemId", "item"] },
  customerOrder: { item: ["itemId", "item"], createdBy: ["createdByUserId", "createdBy"] },
  transfer: { item: ["itemId", "item"] },
  workOrder: { item: ["itemId", "item"], assignedUser: ["assignedUserId", "assignedUser"] },
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATIONS','SALES')),
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  location TEXT NOT NULL,
  batch TEXT NOT NULL,
  physical_qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, location, batch)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reference, type)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  location TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  required_qty INTEGER NOT NULL,
  assigned_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  source_location TEXT NOT NULL,
  dest_location TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  location TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function connect() {
  if (!migrated) {
    migrated = pool.query(SCHEMA_SQL);
  }
  return migrated;
}

// Expands a shorthand composite key (e.g. `itemId_location_batch: {...}`)
// into plain top-level fields, same trick the Mongo version used.
function flatten(model, where = {}) {
  const keys = compositeKeys[model] || {};
  const result = {};
  for (const [field, value] of Object.entries(where)) {
    if (keys[field]) Object.assign(result, value);
    else result[field] = value;
  }
  return result;
}

const OPERATORS = { gt: ">", gte: ">=", lt: "<", lte: "<=" };

function buildWhere(model, where, params) {
  const filter = flatten(model, where);
  const columns = MODELS[model].columns;
  const clauses = [];
  for (const [field, expected] of Object.entries(filter)) {
    const column = columns[field] || field;
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      for (const [operator, value] of Object.entries(expected)) {
        if (operator === "in") {
          params.push(value);
          clauses.push(`${column} = ANY($${params.length})`);
        } else {
          params.push(value);
          clauses.push(`${column} ${OPERATORS[operator] || "="} $${params.length}`);
        }
      }
    } else {
      params.push(expected);
      clauses.push(`${column} = $${params.length}`);
    }
  }
  return clauses;
}

function buildSet(model, data, params) {
  const columns = MODELS[model].columns;
  const clauses = [];
  for (const [field, value] of Object.entries(data)) {
    const column = columns[field] || field;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if (value.increment !== undefined) {
        params.push(value.increment);
        clauses.push(`${column} = ${column} + $${params.length}`);
        continue;
      }
      if (value.decrement !== undefined) {
        params.push(value.decrement);
        clauses.push(`${column} = ${column} - $${params.length}`);
        continue;
      }
    }
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  }
  clauses.push("updated_at = now()");
  return clauses;
}

// Postgres returns snake_case column names; the routes expect camelCase.
function toCamel(model, row) {
  if (!row) return row;
  const columns = MODELS[model].columns;
  const out = {};
  for (const [field, column] of Object.entries(columns)) out[field] = row[column];
  return out;
}

function modelApi(model, executor) {
  const db = () => executor || pool;
  const table = MODELS[model].table;

  async function populate(row, include) {
    if (!row || !include) return row;
    const result = { ...row };
    for (const [relation, [foreignKey]] of Object.entries(relationMap[model] || {})) {
      if (!include[relation]) continue;
      const relatedModel = relation === "item" ? "item" : "user";
      const related = await modelApi(relatedModel, executor).findUnique({ where: { id: row[foreignKey] } });
      result[relation] = include[relation].select && related
        ? Object.fromEntries(Object.keys(include[relation].select).filter((key) => include[relation].select[key]).map((key) => [key, related[key]]))
        : related;
    }
    return result;
  }

  return {
    async findMany({ where, include, orderBy } = {}) {
      await connect();
      const params = [];
      const clauses = buildWhere(model, where, params);
      let sql = `SELECT * FROM ${table}`;
      if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
      if (orderBy) {
        const [field, direction] = Object.entries(orderBy)[0];
        const column = MODELS[model].columns[field] || field;
        sql += ` ORDER BY ${column} ${direction === "desc" ? "DESC" : "ASC"}`;
      }
      const { rows } = await db().query(sql, params);
      return Promise.all(rows.map((row) => populate(toCamel(model, row), include)));
    },
    async findFirst(args = {}) {
      const rows = await this.findMany(args);
      return rows[0] || null;
    },
    async findUnique({ where, include } = {}) {
      await connect();
      const params = [];
      const clauses = buildWhere(model, where, params);
      const sql = `SELECT * FROM ${table}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} LIMIT 1`;
      const { rows } = await db().query(sql, params);
      return populate(toCamel(model, rows[0]), include);
    },
    async create({ data, include } = {}) {
      await connect();
      const columns = MODELS[model].columns;
      const fields = Object.keys(data);
      const params = fields.map((field) => data[field]);
      const columnNames = fields.map((field) => columns[field] || field);
      const placeholders = fields.map((_, i) => `$${i + 1}`);
      const sql = `INSERT INTO ${table} (${columnNames.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const { rows } = await db().query(sql, params);
      return populate(toCamel(model, rows[0]), include);
    },
    async update({ where, data, include } = {}) {
      await connect();
      const params = [];
      const whereClauses = buildWhere(model, where, params);
      const setClauses = buildSet(model, data, params);
      const sql = `UPDATE ${table} SET ${setClauses.join(", ")}${whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : ""} RETURNING *`;
      const { rows } = await db().query(sql, params);
      if (!rows[0]) throw new Error(`${model} not found`);
      return populate(toCamel(model, rows[0]), include);
    },
    async updateMany({ where, data } = {}) {
      await connect();
      const params = [];
      const whereClauses = buildWhere(model, where, params);
      const setClauses = buildSet(model, data, params);
      const sql = `UPDATE ${table} SET ${setClauses.join(", ")}${whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : ""}`;
      const { rowCount } = await db().query(sql, params);
      return { count: rowCount };
    },
    async upsert({ where, update, create, include } = {}) {
      const found = await this.findUnique({ where });
      return found ? this.update({ where, data: update, include }) : this.create({ data: create, include });
    },
    async deleteMany({ where } = {}) {
      await connect();
      const params = [];
      const clauses = buildWhere(model, where, params);
      const sql = `DELETE FROM ${table}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`;
      const { rowCount } = await db().query(sql, params);
      return { count: rowCount };
    },
  };
}

const api = {};
for (const model of Object.keys(MODELS)) api[model] = modelApi(model);

api.$transaction = async (callback) => {
  await connect();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {};
    for (const model of Object.keys(MODELS)) tx[model] = modelApi(model, client);
    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

api.$disconnect = () => pool.end();
api.connect = connect;
module.exports = api;
