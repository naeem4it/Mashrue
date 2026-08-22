/**
 * Global App State Management
 * Handles Authentication, Session, RBAC, Tenant and Multi-Company state
 */

const State = {
  currentBusinessProfileId: 'all', // 'all' or specific profile UUID
  businessProfiles: [],
  token: localStorage.getItem('mashrue_token') || null,
  currentUser: JSON.parse(localStorage.getItem('mashrue_user') || 'null'),
  activeView: 'dashboard',

  // Session persistence
  setSession(token, user) {
    this.token = token;
    this.currentUser = user;
    if (token) {
      localStorage.setItem('mashrue_token', token);
      localStorage.setItem('mashrue_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('mashrue_token');
      localStorage.removeItem('mashrue_user');
    }
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user } }));
  },

  clearSession() {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem('mashrue_token');
    localStorage.removeItem('mashrue_user');
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user: null } }));
  },

  isLoggedIn() {
    return Boolean(this.token && this.currentUser);
  },

  isSuperAdmin() {
    return this.currentUser && (this.currentUser.role === 'SuperAdmin' || this.currentUser.role === 'LimitedSuperAdmin');
  },

  isClientAdmin() {
    return this.currentUser && (this.currentUser.role === 'ClientAdmin' || this.currentUser.role === 'CompanyAdmin');
  },

  isClientEmployee() {
    return this.currentUser && (this.currentUser.role === 'ClientEmployee' || this.currentUser.role === 'BidManager');
  },

  canSeeBiddingPrices() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return true;
    return this.currentUser.canSeeBiddingPrices !== false;
  },

  hasPermission(moduleName, action = 'view') {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return true;
    const perms = this.currentUser.permissions || {};
    const modulePerms = perms[moduleName] || {};
    return Boolean(modulePerms[action]);
  },

  setBusinessProfile(id) {
    this.currentBusinessProfileId = id;
    window.dispatchEvent(new CustomEvent('businessProfileChanged', { detail: { id } }));
  },

  getCurrentBusinessProfile() {
    if (this.currentBusinessProfileId === 'all') {
      return { business_name: 'All Business Entities', ntn: 'Consolidated View' };
    }
    return this.businessProfiles.find(b => b.id === this.currentBusinessProfileId) || { business_name: 'Primary Entity', ntn: 'N/A' };
  },

  // Persistent Local Registry for seamless offline/hybrid operation
  getTenants() {
    const raw = localStorage.getItem('mashrue_tenants_store');
    return raw ? JSON.parse(raw) : [
      { id: 't1', company_name: 'Alpha Group PK', subdomain: 'alphagroup', subscription_plan: 'Standard', user_count: 2, company_count: 2, status: 'Active' }
    ];
  },

  saveTenant(tenant) {
    const list = this.getTenants();
    const existingIdx = list.findIndex(t => t.id === tenant.id || t.company_name?.toLowerCase() === tenant.company_name?.toLowerCase());
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...tenant };
    } else {
      list.unshift(tenant);
    }
    localStorage.setItem('mashrue_tenants_store', JSON.stringify(list));
  },

  getStoredUsers() {
    const raw = localStorage.getItem('mashrue_users_store');
    return raw ? JSON.parse(raw) : [
      { id: 'u1', username: 'naeem4it', full_name: 'Muhammad Naeem Khan', email: 'naeem@mashrue.com', role: 'SuperAdmin', tenant_name: 'System Level', status: 'Active', can_see_bidding_prices: true, password: 'Password123!' },
      { id: 'u2', username: 'alphaclient', full_name: 'Alpha Client Administrator', email: 'admin@alphagroup.pk', role: 'ClientAdmin', tenant_name: 'Alpha Group PK', tenant_id: 't1', status: 'Active', can_see_bidding_prices: true, password: 'Password123!', must_change_password: false },
      { id: 'u3', username: 'tariq_ops', full_name: 'Tariq Javed (Operations)', email: 'tariq@alphagroup.pk', role: 'ClientEmployee', tenant_name: 'Alpha Group PK', tenant_id: 't1', status: 'Active', can_see_bidding_prices: false, password: 'Password123!' }
    ];
  },

  saveStoredUser(user) {
    const list = this.getStoredUsers();
    const existingIdx = list.findIndex(u => (u.id && u.id === user.id) || (u.email && u.email.toLowerCase() === user.email.toLowerCase()) || (u.username && u.username.toLowerCase() === user.username.toLowerCase()));
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...user };
    } else {
      list.push(user);
    }
    localStorage.setItem('mashrue_users_store', JSON.stringify(list));
  },

  // Strict Tenant-Isolated Company Storage (Zero cross-tenant data leakage)
  getTenantCompanies(tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const raw = localStorage.getItem(`mashrue_companies_${tid}`);
    return raw ? JSON.parse(raw) : [];
  },

  saveTenantCompany(company, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const list = this.getTenantCompanies(tid);
    const existingIdx = list.findIndex(c => c.id === company.id || c.business_name?.toLowerCase() === company.business_name?.toLowerCase());
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...company };
    } else {
      list.push(company);
    }
    localStorage.setItem(`mashrue_companies_${tid}`, JSON.stringify(list));
  },

  // Generic Tenant-Scoped Master & Transaction Entity Storage (Zero Cross-Tenant Leakage)
  getTenantEntityList(entityKey, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const raw = localStorage.getItem(`mashrue_data_${tid}_${entityKey}`);
    return raw ? JSON.parse(raw) : [];
  },

  saveTenantEntity(entityKey, record, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const list = this.getTenantEntityList(entityKey, tid);
    const existingIdx = list.findIndex(item => item.id === record.id);
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...record };
    } else {
      list.unshift(record);
    }
    localStorage.setItem(`mashrue_data_${tid}_${entityKey}`, JSON.stringify(list));
  },

  // --------------------------------------------------------------------------
  // SUBSCRIPTION & TRIAL PERIOD ENGINE
  // --------------------------------------------------------------------------
  MODULE_CATALOG: [
    { key: 'mod_tenders', name: 'Commercial Tenders & Bidding Hub', benchmarkFee: 3000, icon: '📑', desc: 'PPRA, DGP, RFQ, LPQ bidding pipeline & tender details' },
    { key: 'mod_quotations', name: 'Direct Sales & Quotations', benchmarkFee: 2000, icon: '💼', desc: 'Quotation builder, direct client pricing, master records' },
    { key: 'mod_bid_security', name: 'Bid Securities & CDR Registry', benchmarkFee: 2500, icon: '🏦', desc: 'CDRs, POs, Bank Guarantees, expiry alerts, release gate' },
    { key: 'mod_costing_eval', name: 'Costing Sheets & Margin Control', benchmarkFee: 2500, icon: '🧮', desc: 'Direct costs, landed charges, margin calculator, approval flow' },
    { key: 'mod_supply_dc', name: 'Supply Chain, POs & Delivery Challans', benchmarkFee: 2500, icon: '🚚', desc: 'PO registry, 3PL Delivery Challans, tracking numbers' },
    { key: 'mod_inventory', name: 'Multi-Warehouse Inventory & SKUs', benchmarkFee: 2500, icon: '📦', desc: 'Stock movement logs, SKU item catalog, reorder levels' },
    { key: 'mod_fbr_invoicing', name: 'Invoicing & FBR Digital Integration', benchmarkFee: 3000, icon: '🧾', desc: 'Sales Invoices, FBR PRAL Digital Invoicing, QR code stamping' },
    { key: 'mod_finance_kpi', name: 'Payments, Expenses & Financial KPIs', benchmarkFee: 2000, icon: '📊', desc: 'Cheque vouchers, 13-category expenses, profit analytics' }
  ],

  getTenantSubscription(tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 't1';
    const raw = localStorage.getItem(`mashrue_sub_${tid}`);
    if (raw) return JSON.parse(raw);

    // Default Starter Setup for tenants
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 Days default trial

    const defaultSub = {
      tenant_id: tid,
      plan_type: 'Advance', // 'Basic', 'Advance', 'Custom'
      status: 'Trial', // 'Trial', 'Active', 'PendingPayment', 'Suspended'
      is_trial: true,
      trial_days: 30,
      trial_start_date: now.toISOString().split('T')[0],
      trial_end_date: trialEnd.toISOString().split('T')[0],
      current_period_start: now.toISOString().split('T')[0],
      current_period_end: trialEnd.toISOString().split('T')[0],
      custom_base_price: 14000,
      custom_extra_company_price: 2500,
      custom_extra_seat_price: 1500,
      active_modules: ['mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi'],
      custom_module_fees: {},
      last_payment_date: null,
      last_payment_reference: null
    };

    localStorage.setItem(`mashrue_sub_${tid}`, JSON.stringify(defaultSub));
    return defaultSub;
  },

  saveTenantSubscription(tenantId, subData) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 't1';
    const current = this.getTenantSubscription(tid);
    const updated = { ...current, ...subData, tenant_id: tid, updated_at: new Date().toISOString() };
    localStorage.setItem(`mashrue_sub_${tid}`, JSON.stringify(updated));
    return updated;
  },

  getSubscriptionPayments(tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'all';
    const raw = localStorage.getItem('mashrue_subscription_payments');
    const all = raw ? JSON.parse(raw) : [];
    if (tid === 'all') return all;
    return all.filter(p => p.tenant_id === tid);
  },

  recordSubscriptionPayment(paymentData) {
    const raw = localStorage.getItem('mashrue_subscription_payments');
    const all = raw ? JSON.parse(raw) : [];
    const newPayment = {
      id: 'spay-' + Date.now(),
      created_at: new Date().toISOString(),
      ...paymentData
    };
    all.unshift(newPayment);
    localStorage.setItem('mashrue_subscription_payments', JSON.stringify(all));

    // Update tenant's active subscription status to 'Active' (Paid) and extend renewal date
    const sub = this.getTenantSubscription(paymentData.tenant_id);
    const currentEnd = new Date(sub.current_period_end || new Date());
    const extensionMonths = paymentData.extension_months || 1;
    currentEnd.setMonth(currentEnd.getMonth() + extensionMonths);

    this.saveTenantSubscription(paymentData.tenant_id, {
      status: 'Active',
      is_trial: false,
      current_period_end: currentEnd.toISOString().split('T')[0],
      last_payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0],
      last_payment_reference: paymentData.reference_number || 'N/A'
    });

    return newPayment;
  },

  getTenantQuota(tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    const ym = new Date().toISOString().slice(0, 7); // e.g. "2026-08"
    const raw = localStorage.getItem(`mashrue_quota_${tid}_${ym}`);
    return raw ? JSON.parse(raw) : { month: ym, tenders_created: 0, quotes_created: 0 };
  },

  incrementTenantQuota(type, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    const ym = new Date().toISOString().slice(0, 7);
    const quota = this.getTenantQuota(tid);
    if (type === 'tender') quota.tenders_created = (quota.tenders_created || 0) + 1;
    if (type === 'quote') quota.quotes_created = (quota.quotes_created || 0) + 1;
    localStorage.setItem(`mashrue_quota_${tid}_${ym}`, JSON.stringify(quota));
    return quota;
  },

  isModuleActiveForTenant(moduleKey, tenantId) {
    if (this.isSuperAdmin()) return true;
    const sub = this.getTenantSubscription(tenantId);
    if (sub.plan_type === 'Advance') return true;
    if (sub.plan_type === 'Basic') {
      return ['mod_tenders', 'mod_quotations', 'mod_fbr_invoicing'].includes(moduleKey);
    }
    if (sub.plan_type === 'Custom') {
      return Array.isArray(sub.active_modules) && sub.active_modules.includes(moduleKey);
    }
    return true;
  },

  isTenantSuspended(tenantId) {
    if (this.isSuperAdmin()) return false;
    const sub = this.getTenantSubscription(tenantId);
    return sub.status === 'Suspended';
  },

  getTrialDaysRemaining(tenantId) {
    const sub = this.getTenantSubscription(tenantId);
    if (!sub.is_trial || sub.status !== 'Trial') return 0;
    const today = new Date();
    const end = new Date(sub.trial_end_date);
    const diffTime = end.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }
};
