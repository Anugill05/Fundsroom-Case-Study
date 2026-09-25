// Boots a real, temporary PostgreSQL server for the Jest run (no Docker, no
// external `postgres` install needed), and points the app at it before any
// test file (and therefore ../src/db.js) is required.
//
// The test suite needs a real database reachable at test time. This boots
// a temporary PostgreSQL server automatically so `npm test` needs no manual
// database setup.
// `embedded-postgres` downloads an actual Postgres binary for your platform
// once (cached afterwards under node_modules/@embedded-postgres/<platform>)
// and runs it as a normal user process on a throwaway port, so tests stay
// self-contained. If your network blocks that one-time download, use
// `docker compose up -d postgres` instead and point DATABASE_URL at it.
const EmbeddedPostgres = require("embedded-postgres").default;
const path = require("path");

module.exports = async function globalSetup() {
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(__dirname, ".pgdata-test"),
    user: "postgres",
    password: "postgres",
    port: 54329,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("mini_ops_erp_test");

  // Keep the instance around so globalTeardown can stop it. Jest runs
  // globalSetup/globalTeardown in the same parent process, so this global
  // survives between the two.
  global.__EMBEDDED_PG__ = pg;

  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:54329/mini_ops_erp_test";
};
