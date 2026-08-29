// Purge legacy persistent localStorage authentication tokens so browser does not auto-login
try {
  localStorage.removeItem('mashrue_token');
  localStorage.removeItem('mashrue_user');
} catch (e) {}

const State = {
  currentBusinessProfileId: 'all', // 'all' or specific profile UUID
  businessProfiles: [],
  token: sessionStorage.getItem('mashrue_token') || null,
  currentUser: JSON.parse(sessionStorage.getItem('mashrue_user') || 'null'),
  activeView: 'dashboard',

  // Session-scoped persistence: Automatically destroyed when browser or tab is closed
  setSession(token, user) {
    this.token = token;
    this.currentUser = user;
    if (token) {
      sessionStorage.setItem('mashrue_token', token);
      sessionStorage.setItem('mashrue_user', JSON.stringify(user));
    } else {
      sessionStorage.removeItem('mashrue_token');
      sessionStorage.removeItem('mashrue_user');
    }
    // Also remove from localStorage to guarantee no auto-login
    try {
      localStorage.removeItem('mashrue_token');
      localStorage.removeItem('mashrue_user');
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user } }));
  },

  clearSession() {
    this.token = null;
    this.currentUser = null;
    try {
      sessionStorage.removeItem('mashrue_token');
      sessionStorage.removeItem('mashrue_user');
      sessionStorage.clear();
      localStorage.removeItem('mashrue_token');
      localStorage.removeItem('mashrue_user');
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user: null } }));
  },

  isLoggedIn() {
    return Boolean(this.token && this.currentUser);
  },

  isSuperAdmin() {
    if (!this.currentUser) return false;
    return (
      this.currentUser.role === 'SuperAdmin' || 
      this.currentUser.role === 'LimitedSuperAdmin'
    );
  },

  isClientAdmin() {
    return this.currentUser && (this.currentUser.role === 'ClientAdmin' || this.currentUser.role === 'CompanyAdmin');
  },

  isClientEmployee() {
    return this.currentUser && (this.currentUser.role === 'ClientEmployee' || this.currentUser.role === 'BidManager' || this.currentUser.role === 'ReadOnly');
  },

  isReadOnly() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return false;
    return this.currentUser.role === 'ReadOnly' || this.currentUser.is_read_only === true;
  },

  canSeeBiddingPrices() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return true;
    if (this.currentUser.can_see_bidding_prices !== undefined) {
      return this.currentUser.can_see_bidding_prices === true || this.currentUser.can_see_bidding_prices === 'true';
    }
    if (this.currentUser.canSeeBiddingPrices !== undefined) {
      return this.currentUser.canSeeBiddingPrices === true || this.currentUser.canSeeBiddingPrices === 'true';
    }
    return true;
  },

  hasPermission(moduleName, action = 'view') {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return true;

    // Read-only user cannot add, edit, or delete anything
    if (this.isReadOnly() && (action === 'add' || action === 'edit' || action === 'delete')) {
      return false;
    }

    const perms = this.currentUser.permissions || {};
    const modulePerms = perms[moduleName] || {};

    if (modulePerms[action] !== undefined) {
      return Boolean(modulePerms[action]);
    }

    // Default: view is allowed unless explicitly false, add/edit allowed unless ReadOnly
    if (action === 'view') return true;
    return !this.isReadOnly();
  },

  setBusinessProfile(id) {
    if (id === '__add_new_entity__') {
      const switcher = document.getElementById('business-select');
      if (switcher) switcher.value = this.currentBusinessProfileId;

      const tenant = this.currentUser?.tenant;
      const sub = this.getTenantSubscription(tenant?.id || this.currentUser?.tenant_id);
      const companyCount = this.businessProfiles ? this.businessProfiles.length : 0;
      const freeLimit = sub.free_companies_limit !== undefined ? Number(sub.free_companies_limit) : ((tenant && (tenant.free_business_profile_limit || tenant.freeCompanyLimit)) || (sub.plan_type === 'Advance' ? 2 : 1));

      if (!this.isSuperAdmin() && companyCount >= freeLimit) {
        if (typeof openQuotaUpgradeModal === 'function') {
          openQuotaUpgradeModal('company');
        } else {
          const tEl = document.getElementById('quota-upgrade-title');
          const dEl = document.getElementById('quota-upgrade-desc');
          if (tEl) tEl.innerText = '🏢 Business Entity Limit Reached';
          if (dEl) dEl.innerHTML = `Your current plan includes up to <strong>${freeLimit} Business Entities</strong>. Additional company profiles require an active subscription upgrade (PKR 2,500/mo) or Advance Plan.`;
          if (typeof openModal === 'function') {
            openModal('modal-quota-upgrade');
          } else {
            alert('Subscription limit reached. Please upgrade your plan to add more business profiles.');
          }
        }
        return;
      }

      if (typeof openNewCompanyModal === 'function') {
        openNewCompanyModal();
      } else if (typeof openModal === 'function') {
        openModal('modal-add-company');
      }
      return;
    }

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
    return raw ? JSON.parse(raw) : [];
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
    return raw ? JSON.parse(raw) : [];
  },

  saveStoredUser(user) {
    if (!user) return;
    const list = this.getStoredUsers();
    const existingIdx = list.findIndex(u => 
      (u.id && user.id && u.id === user.id) || 
      (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase()) || 
      (u.username && user.username && u.username.toLowerCase() === user.username.toLowerCase())
    );
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
  PRICING_PLANS: {
    STARTER: {
      key: 'Starter',
      name: 'Starter Plan',
      basePriceMonthly: 14000,
      includedCompanies: 1,
      includedUsers: 1,
      includedBids: 5,
      bidsModel: '5 Bids Included (Per-bid charges for additional)',
      features: ['5 Bids Included per cycle', 'Single User License (1 Seat)', '1 Registered Company Profile', 'Per-bid charges for additional bids', 'FBR PRAL Certified Invoicing', 'Standard Support']
    },
    ADVANCE: {
      key: 'Advance',
      name: 'Advance Plan',
      includedCompanies: 2,
      includedUsers: 3,
      includedBids: 'Unlimited',
      bidsModel: 'Unlimited Bids',
      billingCycles: {
        monthly: { key: 'monthly', name: 'Per Month', months: 1, price: 35000, effectivePerMonth: 35000, savings: 0, savingsPct: '0%' },
        quarterly: { key: 'quarterly', name: 'Quarterly (3 Months)', months: 3, price: 99000, effectivePerMonth: 33000, savings: 6000, savingsPct: '5.7%' },
        bi_annually: { key: 'bi_annually', name: 'Bi-Annually (6 Months)', months: 6, price: 195500, effectivePerMonth: 32583, savings: 14500, savingsPct: '6.9%' },
        annually: { key: 'annually', name: 'Annually (12 Months)', months: 12, price: 390000, effectivePerMonth: 32500, savings: 30000, savingsPct: '7.1%', isBestValue: true }
      },
      features: ['Unlimited Bids & Tenders', '2 Company Profiles Included', '3 User Seats Included', 'Full Commercial Bidding Hub', 'Bid Securities & CDR Registry', 'Costing Sheets & Margin Control', 'Supply Chain, POs & Delivery Challans', 'Multi-Warehouse Inventory & SKUs', 'FBR Digital Invoicing & PRAL POS', 'Financial KPIs & Expense Management', 'Save up to PKR 30,000 on Annual Billing']
    },
    TRIAL_15: {
      key: 'Trial_15',
      name: '15-Day Free Trial',
      days: 15,
      price: 0,
      includedCompanies: 1,
      includedUsers: 1,
      maxTenders: 5,
      maxBidSecurities: 3,
      features: ['Full Application Access (All Modules)', '5 Tender Opportunities', '3 Bid Security / CDR Items', '1 Company Profile & 1 Admin Seat', 'Personal Reference Extended Trial (Up to 3 Months upon discussion)', 'No Credit Card Required']
    }
  },

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
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure canonical quotas exist for trial / Starter
      if (parsed.trial_tender_limit === undefined) parsed.trial_tender_limit = 5;
      if (parsed.trial_bid_security_limit === undefined) parsed.trial_bid_security_limit = 3;
      return parsed;
    }

    // Default 15-Day Free Trial Setup for newly provisioned tenants
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 Days default trial

    const defaultSub = {
      tenant_id: tid,
      plan_type: 'Advance', // Default feature tier during trial is full Advance access
      status: 'Trial', // 'Trial', 'Active', 'PendingPayment', 'Suspended'
      is_trial: true,
      trial_days: 15,
      trial_start_date: now.toISOString().split('T')[0],
      trial_end_date: trialEnd.toISOString().split('T')[0],
      current_period_start: now.toISOString().split('T')[0],
      current_period_end: trialEnd.toISOString().split('T')[0],
      billing_cycle: 'monthly', // 'monthly', 'quarterly', 'bi_annually', 'annually'
      free_companies_limit: 2,
      free_users_limit: 3,
      custom_base_price: 35000,
      custom_extra_company_price: 2500,
      custom_extra_seat_price: 1500,
      trial_tender_limit: 5,
      trial_bid_security_limit: 3,
      starter_tender_limit: 5,
      is_personal_reference_trial: false,
      personal_reference_note: '',
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

    // Also sync limits and plan to tenant record in store
    if (subData.free_companies_limit !== undefined || subData.free_users_limit !== undefined || subData.plan_type) {
      const tenants = this.getTenants();
      const tIdx = tenants.findIndex(t => t.id === tid);
      if (tIdx >= 0) {
        if (subData.free_companies_limit !== undefined) tenants[tIdx].free_business_profile_limit = subData.free_companies_limit;
        if (subData.free_users_limit !== undefined) tenants[tIdx].free_employee_limit = subData.free_users_limit;
        if (subData.plan_type) tenants[tIdx].subscription_plan = subData.plan_type;
        localStorage.setItem('mashrue_tenants_store', JSON.stringify(tenants));
      }
    }

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
      billing_cycle: paymentData.billing_cycle || sub.billing_cycle || 'monthly',
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
    return raw ? JSON.parse(raw) : { month: ym, tenders_created: 0, quotes_created: 0, bid_securities_created: 0 };
  },

  incrementTenantQuota(type, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    const ym = new Date().toISOString().slice(0, 7);
    const quota = this.getTenantQuota(tid);
    if (type === 'tender') quota.tenders_created = (quota.tenders_created || 0) + 1;
    if (type === 'quote') quota.quotes_created = (quota.quotes_created || 0) + 1;
    if (type === 'bid_security') quota.bid_securities_created = (quota.bid_securities_created || 0) + 1;
    localStorage.setItem(`mashrue_quota_${tid}_${ym}`, JSON.stringify(quota));
    return quota;
  },

  checkTenantQuotaLimit(actionType, tenantId) {
    if (this.isSuperAdmin()) return { allowed: true };
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    const sub = this.getTenantSubscription(tid);
    const quota = this.getTenantQuota(tid);

    // 1. Suspension Check
    if (sub.status === 'Suspended') {
      return {
        allowed: false,
        suspended: true,
        message: 'Your organization workspace is suspended due to pending subscription payment. Please contact Super Admin.'
      };
    }

    // 2. 15-Day Free Trial Quota Check (Full App with 5 Tenders, 3 Bid Securities)
    if (sub.is_trial || sub.status === 'Trial') {
      if (actionType === 'tender') {
        const used = quota.tenders_created || 0;
        const maxLimit = sub.trial_tender_limit || 5;
        if (used >= maxLimit) {
          return {
            allowed: false,
            quotaExceeded: true,
            current: used,
            limit: maxLimit,
            message: `15-Day Free Trial quota reached (${used}/${maxLimit} Tenders). Upgrade to Advance Plan for Unlimited Tenders.`
          };
        }
      }
      if (actionType === 'bid_security') {
        const list = this.getTenantEntityList ? this.getTenantEntityList('bidSecurities') : [];
        const used = list.filter(b => b.tenant_id === tid).length || (quota.bid_securities_created || 0);
        const maxLimit = sub.trial_bid_security_limit || 3;
        if (used >= maxLimit) {
          return {
            allowed: false,
            quotaExceeded: true,
            current: used,
            limit: maxLimit,
            message: `15-Day Free Trial quota reached (${used}/${maxLimit} Bid Securities / CDRs). Upgrade to Advance Plan for unlimited entries.`
          };
        }
      }
    }

    // 3. Starter Plan Quota (5 Bids per cycle + per bid charges)
    if (sub.plan_type === 'Starter' || sub.plan_type === 'Basic') {
      if (actionType === 'tender') {
        const used = quota.tenders_created || 0;
        const maxLimit = sub.starter_tender_limit || 5;
        if (used >= maxLimit) {
          return {
            allowed: false,
            quotaExceeded: true,
            current: used,
            limit: maxLimit,
            message: `Starter Plan includes 5 bids per cycle (${used}/${maxLimit} used). Please top-up per-bid quota or upgrade to Advance Plan for Unlimited Bids.`
          };
        }
      }
    }

    return { allowed: true };
  },

  isModuleActiveForTenant(moduleKey, tenantId) {
    if (this.isSuperAdmin()) return true;
    const sub = this.getTenantSubscription(tenantId);
    if (sub.is_trial || sub.plan_type === 'Advance') return true; // Full application during trial and Advance
    if (sub.plan_type === 'Starter' || sub.plan_type === 'Basic') {
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
