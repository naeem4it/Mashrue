/**
 * RBAC & Permission Middleware
 * Protects routes based on user role, module rights, tenant data isolation, and pricing masking.
 */

// 1. Canonical Business Modules
const BUSINESS_MODULES = [
  'customers',
  'suppliers',
  'opportunities', // Commercial Tenders
  'bids',          // Quotations, Costing & Approvals
  'bid_securities',// Bid Securities & CDRs
  'awards',        // Awards & Performance Guarantees
  'purchase_orders',
  'inventory',     // Warehouse stock & items
  'delivery_challans', // Supply & Challans
  'invoices',      // Sales Invoices & FBR
  'payments',      // Payments & Cheques
  'expenses',      // Expense Vouchers
  'reports'        // Executive Reports & Analytics
];

// 2. Restricted Administrative Modules (Accessible only to SuperAdmin & TenantAdmin)
const RESTRICTED_ADMIN_MODULES = [
  'users',
  'tenants',
  'subscription'
];

/**
 * Normalizes module names to support both hyphen and underscore variants
 * e.g. 'bid-securities' <-> 'bid_securities'
 */
function normalizeModuleName(mod) {
  if (!mod) return '';
  const clean = String(mod).toLowerCase().replace(/-/g, '_');
  if (clean === 'tenders') return 'opportunities';
  if (clean === 'quotations' || clean === 'costing' || clean === 'approvals') return 'bids';
  return clean;
}

/**
 * Generates an Equal Rights permission dictionary.
 * New User Permissions = Tenant Admin Permissions - Restricted User Management Permissions
 * Grants complete access to all business modules (view, add, edit, delete),
 * but explicitly revokes administrative permissions over users, tenants, and billing.
 */
function getEqualRightsPermissions() {
  const perms = {};
  for (const mod of BUSINESS_MODULES) {
    perms[mod] = { view: true, add: true, edit: true, delete: true };
    // Also store hyphenated alias for frontend backwards-compatibility
    const hyphenated = mod.replace(/_/g, '-');
    if (hyphenated !== mod) {
      perms[hyphenated] = { view: true, add: true, edit: true, delete: true };
    }
  }

  // Explicitly deny restricted administrative modules
  for (const adminMod of RESTRICTED_ADMIN_MODULES) {
    perms[adminMod] = { view: false, add: false, edit: false, delete: false, manage_permissions: false };
  }

  return perms;
}

/**
 * Server-Side Tenant ID Resolver (Zero Client Trust)
 * Strictly derives tenant ID from the verified JWT (req.user.tenantId).
 * NEVER trusts client-supplied tenant IDs in headers ('x-tenant-id') or body.
 * Only SuperAdmin is permitted to filter by req.query.tenant_id.
 */
function resolveTenantId(req) {
  if (!req.user) return null;

  if (req.user.role === 'SuperAdmin') {
    if (req.query?.tenant_id && req.query.tenant_id !== 'all') {
      return req.query.tenant_id;
    }
    return null; // Global SuperAdmin scope
  }

  return req.user.tenantId || req.user.tenant_id;
}

/**
 * Restricts route to specific user roles
 * @param  {...string} allowedRoles (e.g. 'SuperAdmin', 'ClientAdmin')
 */
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required.' });
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
 * Restricts route to users with granular module permission (view, add, edit, delete, manage_permissions).
 * SuperAdmin & ClientAdmin (Tenant Admin) bypass granular module restrictions for their tenant.
 * ClientEmployees are strictly verified against req.user.permissions[module][action].
 * Normal users can NEVER access restricted administrative modules.
 * 
 * @param {string} moduleName (e.g. 'customers', 'suppliers', 'opportunities', 'invoices')
 * @param {'view'|'add'|'edit'|'delete'|'manage_permissions'} action
 */
function requirePermission(moduleName, action = 'view') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required.' });
    }

    // SuperAdmin always has full platform access
    if (req.user.role === 'SuperAdmin') {
      return next();
    }

    const normMod = normalizeModuleName(moduleName);

    // Tenant Admin (ClientAdmin / CompanyAdmin) has full access to business modules within their tenant
    const isTenantAdmin = (req.user.role === 'ClientAdmin' || req.user.role === 'CompanyAdmin');
    if (isTenantAdmin) {
      // Tenant Admins can access all business modules and tenant user management
      return next();
    }

    // Normal users (ClientEmployee, ReadOnly, etc.) are strictly checked
    if (RESTRICTED_ADMIN_MODULES.includes(normMod)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Administrative module '${moduleName}' is restricted to organization administrators.`
      });
    }

    const userPermissions = req.user.permissions || {};
    const modPerms = userPermissions[normMod] || userPermissions[moduleName] || userPermissions[moduleName.replace(/_/g, '-')] || {};

    const hasPermission = Boolean(modPerms[action]);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have '${action}' permission on module '${moduleName}'. Contact your organization administrator.`
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
  BUSINESS_MODULES,
  RESTRICTED_ADMIN_MODULES,
  normalizeModuleName,
  getEqualRightsPermissions,
  resolveTenantId,
  requireRoles,
  requirePermission,
  sanitizePrices
};
