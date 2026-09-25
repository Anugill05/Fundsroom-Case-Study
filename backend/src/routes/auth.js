const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const { signToken } = require("../utils/jwt");
const { requireFields, isValidEmail, isValidPassword, isOneOf, firstError } = require("../utils/validate");

const router = express.Router();

// POST /auth/register  (kept for convenience/testing; in production you'd
// likely restrict registration to Admins via a protected endpoint instead)
router.post("/register", async (req, res) => {
  const { email, password, role, location } = req.body;

  const err = firstError(
    requireFields(req.body, ["email", "password", "role"]),
    email !== undefined ? isValidEmail(email) : null,
    password !== undefined ? isValidPassword(password) : null,
    role !== undefined ? isOneOf(role, ["ADMIN", "OPERATIONS", "SALES"], "role") : null
  );
  if (err) return res.status(400).json({ error: err });

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash, role, location: location || null },
  });

  return res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const err = requireFields(req.body, ["email", "password"]);
  if (err) return res.status(400).json({ error: err });

  const normalizedEmail = String(email).trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
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