const express = require("express");
const prisma = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /items - simple lookup list, used by frontend dropdowns.
router.get("/", async (req, res) => {
  const items = await prisma.item.findMany({ orderBy: { id: "asc" } });
  res.json(items);
});

module.exports = router;
