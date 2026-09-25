// Usage: authorize("ADMIN", "OPERATIONS")
// Must run after requireAuth so req.user is populated.
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Role '${req.user.role}' is not permitted to perform this action`,
      });
    }
    next();
  };
}

// Optional helper for the "restrict user to assigned location" scenario.
// A user with no `location` set (e.g. Admin) is treated as unrestricted.
function enforceOwnLocation(getLocationFromRequest) {
  return (req, res, next) => {
    const userLocation = req.user?.location;
    if (!userLocation) return next(); // unrestricted user (e.g. Admin)

    const targetLocation = getLocationFromRequest(req);
    if (targetLocation && targetLocation !== userLocation) {
      return res.status(403).json({
        error: `User is restricted to location '${userLocation}'`,
      });
    }
    next();
  };
}

module.exports = { authorize, enforceOwnLocation };
