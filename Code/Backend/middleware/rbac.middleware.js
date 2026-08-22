/**
 * RBAC & Permission Middleware
 * Protects routes based on user role, module rights, and scrubs sensitive pricing.
 */

/**
 * Restricts route to specific user roles
 * @param  {...string} allowedRoles (e.g. 'SuperAdmin', 'ClientAdmin')
 */
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.user.role === 'SuperAdmin') {
      return next(); // SuperAdmin always has full access
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`
      });
    }

    next();
  };
}

/**
 * Restricts route to users with granular module permission (view, add, edit, delete)
 * SuperAdmin & ClientAdmin bypass granular module restrictions for their tenant.
 * ClientEmployees are strictly verified against req.user.permissions[module][action].
 * 
 * @param {string} moduleName (e.g. 'opportunities', 'bids', 'inventory', 'invoices')
 * @param {'view'|'add'|'edit'|'delete'} action
 */
function requirePermission(moduleName, action = 'view') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // SuperAdmin and ClientAdmin have full module access within their scope
    if (req.user.role === 'SuperAdmin' || req.user.role === 'ClientAdmin' || req.user.role === 'CompanyAdmin') {
      return next();
    }

    // For ClientEmployees, verify granular permissions
    const userPermissions = req.user.permissions || {};
    const modulePerms = userPermissions[moduleName] || {};

    if (!modulePerms[action]) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have '${action}' permission on module '${moduleName}'. Contact your administrator.`
      });
    }

    next();
  };
}

/**
 * Sanitizes bidding and financial prices from data arrays or objects if user cannot see bidding prices
 * @param {any} data
 * @param {boolean} canSeePrices
 */
function sanitizePrices(data, canSeePrices) {
  if (canSeePrices) return data;
  if (!data) return data;

  const maskFields = [
    'estimated_value_pkr', 'budget_pkr', 'margin_pkr', 'margin_percentage',
    'bid_amount_pkr', 'financial_quote_pkr', 'base_cost_pkr', 'unit_cost',
    'total_cost', 'cost_price', 'bidding_amount', 'profit_margin', 'unit_price'
  ];

  const maskItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const masked = { ...item };
    for (const field of maskFields) {
      if (masked[field] !== undefined && masked[field] !== null) {
        masked[field] = null;
        masked[`${field}_masked`] = true;
      }
    }
    return masked;
  };

  if (Array.isArray(data)) {
    return data.map(maskItem);
  }
  return maskItem(data);
}

module.exports = {
  requireRoles,
  requirePermission,
  sanitizePrices
};
