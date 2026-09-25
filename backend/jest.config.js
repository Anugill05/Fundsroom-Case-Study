module.exports = {
  testEnvironment: "node",
  setupFiles: ["dotenv/config"],
  globalSetup: "./jest.globalSetup.js",
  globalTeardown: "./jest.globalTeardown.js",
  testTimeout: 30000,
};
