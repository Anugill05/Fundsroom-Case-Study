// Small, dependency-free validation helpers shared by every route.
// Each helper returns an error message string when invalid, or null when
// the value is fine — so routes can do: `const err = isPositiveInt(qty, "quantity"); if (err) return res.status(400).json({ error: err });`

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fails if any of `fields` is missing/empty/whitespace-only in `body`.
// Returns null if all present, or an error message listing what's missing.
function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) {
    return `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required`;
  }
  return null;
}

// Value must be a whole number > 0 (after Number() coercion).
function isPositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return `${label} must be a positive integer`;
  }
  return null;
}

// Value must be a whole number >= 0 (after Number() coercion).
function isNonNegativeInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return `${label} must be a non-negative integer`;
  }
  return null;
}

// Value must be a non-empty (after trim) string, within an optional max length.
function isNonEmptyString(value, label, maxLen = 200) {
  if (typeof value !== "string" || value.trim() === "") {
    return `${label} must be a non-empty string`;
  }
  if (value.trim().length > maxLen) {
    return `${label} must be ${maxLen} characters or fewer`;
  }
  return null;
}

function isValidEmail(value) {
  if (typeof value !== "string" || !EMAIL_RE.test(value.trim())) {
    return "email must be a valid email address";
  }
  return null;
}

function isValidPassword(value, minLen = 8) {
  if (typeof value !== "string" || value.length < minLen) {
    return `password must be at least ${minLen} characters`;
  }
  return null;
}

function isOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    return `${label} must be one of ${allowed.join(", ")}`;
  }
  return null;
}

// Runs a list of validators (each a () => string|null) and returns the
// first error found, or null if everything passed. Keeps route handlers
// from turning into a wall of repeated `if (err) return res...` blocks.
function firstError(...checks) {
  for (const check of checks) {
    if (check) return check;
  }
  return null;
}

module.exports = {
  requireFields,
  isPositiveInt,
  isNonNegativeInt,
  isNonEmptyString,
  isValidEmail,
  isValidPassword,
  isOneOf,
  firstError,
};