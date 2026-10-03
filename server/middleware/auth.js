/**
 * @file server/middleware/auth.js
 * @description Authentication and Role-Based Access Control (RBAC) middleware.
 * Guards API endpoints and static page access.
 */

/**
 * Ensures user is authenticated via session.
 * Rejects with 401 JSON if not logged in.
 */
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required. Please log in.'
    });
  }
  next();
}

/**
 * Ensures authenticated user has one of the required roles.
 * @param {...string} roles - Allowed roles ('owner', 'staff', 'member')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required. Please log in.'
      });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: Insufficient privileges for this action.'
      });
    }
    next();
  };
}

/**
 * Protects HTML pages served from static directories (/owner, /staff, /member, /shared).
 * Redirects to /login.html if unauthorized.
 */
function protectStaticPages(req, res, next) {
  const urlPath = req.path;
  const user = req.session && req.session.user;

  // Shared authenticated pages
  if (urlPath.startsWith('/shared/')) {
    if (!user) return res.redirect('/login.html');
    return next();
  }

  // Owner pages
  if (urlPath.startsWith('/owner/')) {
    if (!user) return res.redirect('/login.html');
    if (user.role !== 'owner') return res.redirect(user.role === 'staff' ? '/staff/dashboard.html' : '/member/dashboard.html');
    return next();
  }

  // Staff pages
  if (urlPath.startsWith('/staff/')) {
    if (!user) return res.redirect('/login.html');
    if (user.role !== 'staff' && user.role !== 'owner') return res.redirect('/member/dashboard.html');
    return next();
  }

  // Member pages
  if (urlPath.startsWith('/member/')) {
    if (!user) return res.redirect('/login.html');
    return next();
  }

  next();
}

module.exports = {
  requireLogin,
  requireRole,
  protectStaticPages
};
