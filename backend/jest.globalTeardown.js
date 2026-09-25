module.exports = async function globalTeardown() {
  const pg = global.__EMBEDDED_PG__;
  if (pg) {
    await pg.stop();
  }
};
