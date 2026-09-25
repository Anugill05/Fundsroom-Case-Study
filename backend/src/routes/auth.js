const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const { signToken } = require("../utils/jwt");

const router = express.Router();

// POST /auth/register  (kept for convenience/testing; in production you'd
// likely restrict registration to Admins via a protected endpoint instead)
router.post("/register", async (req, res) => {
  const { email, password, role, location } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: "email, password and role are required" });
  }
  if (!["ADMIN", "OPERATIONS", "SALES"].includes(role)) {
    return res.status(400).json({ error: "role must be ADMIN, OPERATIONS or SALES" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, role, location: location || null },
  });

  return res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, location: user.location },
  });
});

module.exports = router;
