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
  'reports',       // Executive Reports & Analytics
  'tender_radar',  // Module 2: PPRA / EPADS Tender Notification Radar
  'crm',           // Module 5: Customer Resource Management
  'accounting',    // Module 6: Financial COA & Double-Entry GL
  'tax_compliance',// Module 10: Taxation, WHT CPR & FBR Annex-C
  'hrm',           // Module 7: Core Human Resource Management
  'payroll',       // Module 8: Payroll, Section 149 Slabs & EOBI
  'manufacturing'  // Module 9: BOM & Production Work Orders
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

/**
 * Autonomous Module Licensing Gatekeeper (requireModuleLicense)
 * Verifies if the authenticated tenant has an active license for the requested commercial module.
 * Includes strict Zero-Disruption Grandfathering:
 *  - SuperAdmin always bypasses.
 *  - Advance/Enterprise plans or legacy tenants without explicit deactivation default to allowed.
 *
 * @param {string} moduleKey (e.g. 'mod_tenders', 'mod_notifications', 'mod_crm', 'mod_finance', 'mod_hrm', 'mod_payroll', 'mod_manufacturing', 'mod_tax_compliance')
 */
function requireModuleLicense(moduleKey) {
  const MODULE_TO_PERM_MAP = {
    mod_tenders: 'opportunities',
    mod_tender_radar: 'tender_radar',
    mod_notifications: 'tender_radar',
    mod_quotations: 'bids',
    mod_bid_security: 'bid_securities',
    mod_costing_eval: 'bids',
    mod_supply_dc: 'delivery_challans',
    mod_inventory: 'inventory',
    mod_stock_transfers: 'stock_transfers',
    mod_fbr_invoicing: 'invoices',
    mod_finance_kpi: 'reports',
    mod_crm: 'crm',
    mod_accounting: 'accounting',
    mod_finance: 'accounting',
    mod_tax_compliance: 'tax_compliance',
    mod_hrm: 'hrm',
    mod_payroll: 'payroll',
    mod_manufacturing: 'manufacturing'
  };

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required.' });
    }

    // SuperAdmin always has full access
    if (req.user.role === 'SuperAdmin' || req.user.isSuperAdmin) {
      return next();
    }

    const tenant = req.user.tenant;
    if (tenant) {
      const plan = tenant.subscriptionPlan || 'Advance';
      const activeModules = Array.isArray(tenant.activeModules) ? tenant.activeModules : null;

      const TENDER_SUITE_KEYS = [
        'mod_tenders', 'mod_quotations', 'mod_bid_security',
        'mod_costing_eval', 'mod_supply_dc', 'mod_fbr_invoicing', 'mod_finance_kpi'
      ];
      const hasLicense = activeModules.includes(moduleKey) ||
        (TENDER_SUITE_KEYS.includes(moduleKey) && activeModules.includes('mod_tenders')) ||
        ((moduleKey === 'mod_finance' || moduleKey === 'mod_accounting') && (activeModules.includes('mod_finance') || activeModules.includes('mod_accounting'))) ||
        ((moduleKey === 'mod_tender_radar' || moduleKey === 'mod_notifications') && (activeModules.includes('mod_tender_radar') || activeModules.includes('mod_notifications')));

      if (plan === 'Custom' && activeModules && activeModules.length > 0 && !hasLicense) {
        return res.status(403).json({
          success: false,
          module_unlicensed: true,
          module_key: moduleKey,
          message: `Module '${moduleKey}' is not included in your organization's active modular subscription. Please upgrade or enable this module.`
        });
      }
    }

    // Enforce User-Level Module Assignment for non-Admin employees
    const isTenantAdmin = (req.user.role === 'ClientAdmin' || req.user.role === 'CompanyAdmin');
    if (!isTenantAdmin && req.user.permissions && Object.keys(req.user.permissions).length > 0) {
      const permKey = MODULE_TO_PERM_MAP[moduleKey] || moduleKey.replace(/^mod_/, '');
      const hyphenKey = permKey.replace(/_/g, '-');
      const userModPerm = req.user.permissions[permKey] || req.user.permissions[hyphenKey] || req.user.permissions[moduleKey];

      // If the Tenant Admin explicitly set view: false for this module on this user, block access
      if (userModPerm && userModPerm.view === false) {
        return res.status(403).json({
          success: false,
          user_module_restricted: true,
          module_key: moduleKey,
          message: `Access denied. Your organization administrator has not granted your user account access to '${moduleKey}'.`
        });
      }
    }

    next();
  };
}

module.exports = {
  BUSINESS_MODULES,
  RESTRICTED_ADMIN_MODULES,
  normalizeModuleName,
  getEqualRightsPermissions,
  resolveTenantId,
  requireRoles,
  requirePermission,
  requireModuleLicense,
  sanitizePrices
};
