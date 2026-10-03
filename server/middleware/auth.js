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
      error: 'Authentication required. Please log in.',
      code: 'UNAUTHORIZED'
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
        error: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED'
      });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient privileges for this action.',
        code: 'FORBIDDEN'
      });
    }
    next();
  };
}

/**
 * Ensures staff user has access to a specific operational domain or is an owner.
 * @param {...string} areas - e.g. 'shop', 'bar', 'booking', 'general'
 */
function requireArea(...areas) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        error: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED'
      });
    }
    const user = req.session.user;
    if (user.role === 'owner') return next();
    if (user.role === 'staff') {
      const userArea = user.assigned_area || 'general';
      if (userArea === 'general' || areas.includes(userArea)) {
        return next();
      }
      return res.status(403).json({
        error: `Forbidden: Staff area '${userArea}' does not have access to this module.`,
        code: 'AREA_FORBIDDEN'
      });
    }
    return res.status(403).json({
      error: 'Forbidden: Insufficient permissions.',
      code: 'FORBIDDEN'
    });
  };
}

/**
 * Protects HTML pages served from static directories (/owner, /staff, /member).
 * Unauthenticated requests are redirected to /shared/login.html.
 */
function protectStaticPages(req, res, next) {
  const urlPath = req.path;
  const user = req.session && req.session.user;

  // Unprotected static public files
  if (
    urlPath === '/' ||
    urlPath === '/index.html' ||
    urlPath === '/shared/login.html' ||
    urlPath === '/shared/contact.html' ||
    urlPath.startsWith('/css/') ||
    urlPath.startsWith('/js/') ||
    urlPath.startsWith('/images/') ||
    urlPath.startsWith('/api/') ||
    urlPath === '/favicon.ico'
  ) {
    return next();
  }

  // Owner pages
  if (urlPath.startsWith('/owner/')) {
    if (!user) return res.redirect('/shared/login.html');
    if (user.role !== 'owner') {
      return res.redirect(user.role === 'staff' ? '/staff/dashboard.html' : '/member/dashboard.html');
    }
    return next();
  }

  // Staff pages
  if (urlPath.startsWith('/staff/')) {
    if (!user) return res.redirect('/shared/login.html');
    if (user.role !== 'staff' && user.role !== 'owner') {
      return res.redirect('/member/dashboard.html');
    }
    return next();
  }

  // Member pages
  if (urlPath.startsWith('/member/')) {
    if (!user) return res.redirect('/shared/login.html');
    return next();
  }

  next();
}

module.exports = {
  requireLogin,
  requireRole,
  requireArea,
  protectStaticPages
};
