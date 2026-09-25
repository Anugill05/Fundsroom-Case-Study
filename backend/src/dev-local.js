// Local dev entrypoint that needs neither Docker nor a manually-installed
// PostgreSQL. It boots a real (but temporary) Postgres server, seeds it,
// then starts the API on top of it.
//
// Data lives only as long as this process runs -- stop it (Ctrl+C) and the
// database goes away. That's fine for trying the app out or working through
// the case study locally; for anything you want to persist, use
// `docker compose up` (see README) against a real/persistent PostgreSQL
// instead.
require("dotenv").config();
const { execSync } = require("child_process");
const path = require("path");
const EmbeddedPostgres = require("embedded-postgres").default;

async function main() {
  console.log("Starting a temporary PostgreSQL server (no Docker needed)...");
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(__dirname, "..", ".pgdata-dev"),
    user: "postgres",
    password: "postgres",
    port: 54330,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("mini_ops_erp");
  } catch (err) {
    // Already exists from a previous run of this same dev database -- fine.
  }

  const uri = "postgresql://postgres:postgres@localhost:54330/mini_ops_erp";

  // Point THIS process (and the API it's about to start) at the local DB.
  process.env.DATABASE_URL = uri;

  console.log(`PostgreSQL ready at ${uri}`);

  // SEED_SCRIPT lets you swap in the richer pitch/demo dataset without
  // touching this file: `npm run dev:local:demo` sets it to seed-demo.js.
  const seedScript = process.env.SEED_SCRIPT || "seed.js";
  console.log(`Seeding data via src/${seedScript}...`);

  // Run the seed script as its own process so it uses its own pg Pool,
  // connecting to the same local Postgres over TCP (a real server, not
  // purely in-process) -- this avoids touching the seed scripts.
  execSync(`node src/${seedScript}`, {
    cwd: __dirname + "/..",
    stdio: "inherit",
    env: process.env,
  });

  const shutdown = async () => {
    console.log("\nStopping API and PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  require("./index");
}

main().catch((err) => {
  console.error("Failed to start local dev environment:", err.message);
  console.error(
    "If this is a download/network error, your network may block the " +
      "one-time Postgres binary download -- use `docker compose up` instead (see README)."
  );
  process.exit(1);
});
