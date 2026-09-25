# Mini Operations ERP

A full-stack operations management system covering inventory tracking, work orders, internal stock transfers, and customer order reservations. Built with Express, PostgreSQL, and React.

## Features

- JWT authentication with role-based access control (Admin, Operations, Sales)
- Inventory tracking with physical, reserved, and available stock, scoped by item, location, and batch
- Work order creation with automatic shortage detection against available stock
- Internal stock transfers with a Requested → Dispatched → Received workflow
- Customer order reservations with transaction-safe overselling prevention
- Per-location access restriction for Operations/Sales users
- Ops Pulse dashboard with live KPIs, inventory risk radar, and activity stream
- Automated test suite covering the core business rules and concurrency guarantees

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Authentication | JWT, bcryptjs |
| Frontend | React, Vite, React Router |
| Testing | Jest, Supertest |

## Project Structure

```text
full stack learning and researching project/
├── backend/                  Express API, PostgreSQL data layer, tests, seed data
├── frontend/                 React application
├── ER_DIAGRAM.md             Database schema
├── postman_collection.json   API reference collection
├── docker-compose.yml        Postgres + API + frontend, containerized
├── README.md                 This file
```

## Prerequisites

- Node.js 18+
- Docker (optional, for the containerized setup)

## Getting Started

### Option A — Local, no Docker

```bash
cd backend
npm install
cp .env.example .env
npm run dev:local
```

Boots a temporary PostgreSQL instance, seeds demo accounts, and starts the API on `http://localhost:4000`. Data is not persisted between runs.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The UI runs at `http://localhost:5173`.

### Option B — Docker

```bash
docker compose up --build
```

UI: `http://localhost:8080` · API: `http://localhost:4000`

### Option C — Existing PostgreSQL instance

```bash
cd backend
npm install
cp .env.example .env   # set DATABASE_URL to your PostgreSQL instance
npm run seed
npm run dev
```

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Demo Accounts

Password for all accounts: `password123`

| Email | Role | Location |
|---|---|---|
| `admin@erp.com` | ADMIN | — |
| `ops@erp.com` | OPERATIONS | `WAREHOUSE-A` |
| `sales@erp.com` | SALES | — |

## Demo Dataset

`npm run seed` provisions minimal data for exploring the app. For demos and presentations, `npm run seed:demo` (or `npm run dev:local:demo` to boot and seed in one step) loads a richer, internally consistent dataset: 3 locations, 9 items, and a full spread of inventory, work orders, transfers, and customer orders.

| Email | Role | Location |
|---|---|---|
| `admin@erp.com` | ADMIN | — |
| `ops@erp.com` | OPERATIONS | Pune-Plant |
| `priya.ops@erp.com` | OPERATIONS | Chennai-Warehouse |
| `arjun.ops@erp.com` | OPERATIONS | Noida-DC |
| `sales@erp.com` | SALES | — |
| `neha.sales@erp.com` | SALES | — |

Re-running this script is safe — it rebuilds inventory, work orders, transfers, and customer orders, and upserts users without changing credentials.

## Environment Variables

**Backend**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `PORT` | API port (default `4000`) |

**Frontend**

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the backend API |

## Database

PostgreSQL with foreign keys and unique constraints enforced at the schema level. The data layer self-migrates on connect (`CREATE TABLE IF NOT EXISTS`), so no separate migration step is required. Overselling and double-dispatch/receive are prevented by wrapping each operation in a transaction with conditional `UPDATE ... WHERE` statements, relying on row-level locking for correctness under concurrent requests.

See [ER_DIAGRAM.md](ER_DIAGRAM.md) for the full schema.

## Testing

```bash
cd backend
npm test
```

Boots a temporary PostgreSQL instance automatically — no external database required.

Covers:

1. Overselling is rejected for inventory reservations, including under concurrent requests
2. Transfers cannot exceed available stock
3. Destination inventory changes only after receipt
4. A transfer cannot be received twice
5. Unauthorized users cannot perform restricted operations
6. Duplicate inventory transactions are rejected
7. Operations users are restricted to their assigned location

## API Documentation

Import `postman_collection.json` into Postman or a compatible client to explore the API.

## Business Rules

- `availableQty = physicalQty - reservedQty`
- Inventory updates are protected by transactional conditional updates
- Transfer source inventory is reduced on dispatch, not on request
- Destination inventory increases only after receipt
- Cancelling a customer order releases its reserved stock
- Work order creation computes shortage automatically against available stock
- Operations/Sales users with an assigned location are restricted to that location; Admins are unrestricted

## Notes

- Run backend and frontend in separate terminals for local development.
- Keep database credentials in `backend/.env`; do not commit them.
- Any managed PostgreSQL provider (Supabase, Neon, RDS, etc.) is supported for deployment.
