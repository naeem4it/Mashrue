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

  isPrimaryAdmin() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin()) return true;
    if (this.currentUser.isPrimaryAdmin !== undefined) {
      return Boolean(this.currentUser.isPrimaryAdmin);
    }
    if (this.currentUser.is_primary_admin !== undefined) {
      return Boolean(this.currentUser.is_primary_admin);
    }
    return this.isCreatedBySuperAdmin();
  },

  isCreatedBySuperAdmin() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin()) return true;
    if (this.currentUser.isPrimaryAdmin !== undefined) {
      return Boolean(this.currentUser.isPrimaryAdmin);
    }
    if (this.currentUser.is_primary_admin !== undefined) {
      return Boolean(this.currentUser.is_primary_admin);
    }
    if (this.currentUser.role === 'ClientEmployee' || this.currentUser.role === 'ReadOnly') {
      return false;
    }
    if (this.currentUser.isCreatedBySuperAdmin !== undefined) {
      return Boolean(this.currentUser.isCreatedBySuperAdmin);
    }
    if (this.currentUser.is_created_by_super_admin !== undefined) {
      return Boolean(this.currentUser.is_created_by_super_admin);
    }
    const creatorRole = this.currentUser.creatorRole || this.currentUser.creator_role;
    if (creatorRole === 'SuperAdmin') return true;
    const cb = this.currentUser.createdBy || this.currentUser.created_by;
    if (!cb && (this.currentUser.role === 'ClientAdmin' || this.currentUser.role === 'CompanyAdmin')) {
      return true;
    }
    return false;
  },

  isClientEmployee() {
    return this.currentUser && (this.currentUser.role === 'ClientEmployee' || this.currentUser.role === 'BidManager' || this.currentUser.role === 'ReadOnly');
  },

  isReadOnly() {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return false;
    return this.currentUser.role === 'ReadOnly' || this.currentUser.is_read_only === true;
  },

  hasPermission(module, action = 'view') {
    if (!this.currentUser) return false;
    if (this.isSuperAdmin() || this.isClientAdmin()) return true;
    const cleanMod = String(module).toLowerCase().replace(/-/g, '_');
    const perms = this.currentUser.permissions || {};
    const modPerms = perms[cleanMod] || perms[module] || perms[module.replace(/_/g, '-')] || {};
    return Boolean(modPerms[action]);
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
      const freeLimit = sub.free_companies_limit !== undefined ? Number(sub.free_companies_limit) : ((tenant && (tenant.free_business_profile_limit || tenant.freeCompanyLimit)) || (sub.plan_type === 'Advance' ? 3 : 1));

      if (!this.isSuperAdmin() && companyCount >= freeLimit) {
        if (typeof openQuotaUpgradeModal === 'function') {
          openQuotaUpgradeModal('company');
        } else {
          const tEl = document.getElementById('quota-upgrade-title');
          const dEl = document.getElementById('quota-upgrade-desc');
          if (tEl) tEl.innerText = '🏢 Business Entity Limit Reached';
          if (dEl) dEl.innerHTML = `Your current plan includes up to <strong>${freeLimit} Business Entities</strong>. Additional company profiles require an active subscription upgrade (PKR 4,500/mo) or Advance Plan.`;
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

  deleteTenant(tenantId) {
    if (!tenantId) return;
    const list = this.getTenants();
    const filtered = list.filter(t => t.id !== tenantId && t.company_name?.toLowerCase() !== String(tenantId).toLowerCase());
    localStorage.setItem('mashrue_tenants_store', JSON.stringify(filtered));

    // Also clean up any cached entities for this tenant
    localStorage.removeItem(`mashrue_companies_${tenantId}`);
    localStorage.removeItem(`mashrue_subscription_${tenantId}`);
    localStorage.removeItem(`mashrue_quota_${tenantId}`);
    const prefix = `mashrue_data_${tenantId}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
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
    const list = raw ? JSON.parse(raw) : [];
    // Automatically filter out any legacy unconfirmed ghost items
    return list.filter(item => item && item.id && !String(item.id).startsWith('f-') && !String(item.id).startsWith('bs-'));
  },

  saveTenantEntity(entityKey, record, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const list = this.getTenantEntityList(entityKey, tid);
    const existingIdx = list.findIndex(item => String(item.id) === String(record.id));
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...record };
    } else {
      list.unshift(record);
    }
    localStorage.setItem(`mashrue_data_${tid}_${entityKey}`, JSON.stringify(list));
  },

  deleteTenantEntity(entityKey, id, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'system';
    const list = this.getTenantEntityList(entityKey, tid);
    const filtered = list.filter(item => String(item.id) !== String(id));
    localStorage.setItem(`mashrue_data_${tid}_${entityKey}`, JSON.stringify(filtered));
  },

  removeTenantEntity(entityKey, id, tenantId) {
    return this.deleteTenantEntity(entityKey, id, tenantId);
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
      includedCompanies: 3,
      includedUsers: 3,
      includedBids: 'Unlimited',
      bidsModel: 'Unlimited Bids',
      billingCycles: {
        monthly: { key: 'monthly', name: 'Per Month', months: 1, price: 35000, effectivePerMonth: 35000, savings: 0, savingsPct: '0%' },
        quarterly: { key: 'quarterly', name: 'Quarterly (3 Months)', months: 3, price: 99000, effectivePerMonth: 33000, savings: 6000, savingsPct: '5.7%' },
        bi_annually: { key: 'bi_annually', name: 'Bi-Annually (6 Months)', months: 6, price: 195500, effectivePerMonth: 32583, savings: 14500, savingsPct: '6.9%' },
        annually: { key: 'annually', name: 'Annually (12 Months)', months: 12, price: 390000, effectivePerMonth: 32500, savings: 30000, savingsPct: '7.1%', isBestValue: true }
      },
      features: ['Unlimited Bids & Tenders', '3 Company Profiles Included', '3 User Seats Included', 'Full Commercial Bidding Hub', 'Bid Securities & CDR Registry', 'Costing Sheets & Margin Control', 'Supply Chain, POs & Delivery Challans', 'Multi-Warehouse Inventory & SKUs', 'FBR Digital Invoicing & PRAL POS', 'Financial KPIs & Expense Management', 'Save up to PKR 30,000 on Annual Billing']
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

  getTenantSubscription(tenantId, tenantObj = null) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 't1';
    const curTenant = (this.currentUser?.tenant && (this.currentUser.tenant.id === tid || !tenantId)) 
      ? this.currentUser.tenant 
      : null;
    const tData = tenantObj || (this.getTenants ? this.getTenants().find(t => t.id === tid) : null) || curTenant;

    const rawPlan = tData?.subscriptionPlan || tData?.subscription_plan || curTenant?.subscriptionPlan || curTenant?.subscription_plan || 'Advance';
    const planType = (rawPlan === 'Standard' || rawPlan === 'Basic') ? 'Starter' : rawPlan;
    const tenantDbStatus = tData?.status || curTenant?.status || 'Active';
    const isSuspended = (tenantDbStatus === 'Suspended');
    const isTrial = (tenantDbStatus === 'Trial' || (!isSuspended && (tData?.is_trial === true || tData?.isTrial === true)));

    // Dynamic leveraged limits extracted directly from organization data (DB / live tenant contract)
    const dynamicFreeCompanies = (tData?.freeCompanyLimit !== undefined && tData?.freeCompanyLimit !== null)
      ? Number(tData.freeCompanyLimit)
      : (tData?.free_business_profile_limit !== undefined && tData?.free_business_profile_limit !== null
        ? Number(tData.free_business_profile_limit)
        : (planType === 'Advance' ? 3 : 1));

    const dynamicFreeUsers = (tData?.freeEmployeeLimit !== undefined && tData?.freeEmployeeLimit !== null)
      ? Number(tData.freeEmployeeLimit)
      : (tData?.free_employee_limit !== undefined && tData?.free_employee_limit !== null
        ? Number(tData.free_employee_limit)
        : (planType === 'Advance' ? 3 : 1));

    const dynamicTenderLimit = (tData?.tenderLimit !== undefined && tData?.tenderLimit !== null)
      ? tData.tenderLimit
      : (tData?.tender_limit !== undefined && tData?.tender_limit !== null
        ? tData.tender_limit
        : (planType === 'Advance' || planType === 'Enterprise' ? 'unlimited' : 5));

    const dynamicBidSecurityLimit = (tData?.bidSecurityLimit !== undefined && tData?.bidSecurityLimit !== null)
      ? tData.bidSecurityLimit
      : (tData?.bid_security_limit !== undefined && tData?.bid_security_limit !== null
        ? tData.bid_security_limit
        : (planType === 'Advance' || planType === 'Enterprise' ? 'unlimited' : 10));

    const isUnlimitedTenders = (
      dynamicTenderLimit === 'unlimited' || 
      dynamicTenderLimit === -1 || 
      dynamicTenderLimit === 'Unlimited' ||
      (dynamicTenderLimit === null && (planType === 'Advance' || planType === 'Enterprise'))
    );
    const isUnlimitedCdrs = (
      dynamicBidSecurityLimit === 'unlimited' || 
      dynamicBidSecurityLimit === -1 || 
      dynamicBidSecurityLimit === 'Unlimited' ||
      (dynamicBidSecurityLimit === null && (planType === 'Advance' || planType === 'Enterprise'))
    );

    const dynamicModules = Array.isArray(tData?.activeModules || tData?.active_modules)
      ? (tData.activeModules || tData.active_modules)
      : ['mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi'];

    const dynamicBillingCycle = tData?.billingCycle || tData?.billing_cycle || 'monthly';
    const dynamicBasePrice = Number(tData?.customBasePrice || tData?.custom_base_price || (planType === 'Starter' ? 14000 : 35000));

    let trialDays = 15;
    const trialPeriodStr = tData?.trialPeriod || tData?.trial_period || curTenant?.trialPeriod || curTenant?.trial_period || '15 Days';
    if (trialPeriodStr === '1 Month') trialDays = 30;
    else if (trialPeriodStr === '2 Months') trialDays = 60;
    else if (trialPeriodStr === '3 Months') trialDays = 90;

    const rawTrialEndsAt = tData?.trialEndsAt || tData?.trial_ends_at || curTenant?.trialEndsAt || curTenant?.trial_ends_at;
    const now = new Date();
    const trialEnd = rawTrialEndsAt
      ? new Date(rawTrialEndsAt)
      : new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const trialEndStr = trialEnd.toISOString().split('T')[0];

    const raw = localStorage.getItem(`mashrue_sub_${tid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Synchronize limits, plan, leverages, and status from live database/tenant source
      parsed.plan_type = planType;
      parsed.status = isSuspended ? 'Suspended' : (isTrial ? 'Trial' : 'Active');
      parsed.is_trial = isTrial;
      parsed.free_companies_limit = dynamicFreeCompanies;
      parsed.free_users_limit = dynamicFreeUsers;
      parsed.tender_limit = dynamicTenderLimit;
      parsed.bid_security_limit = dynamicBidSecurityLimit;
      parsed.is_unlimited_tenders = isUnlimitedTenders;
      parsed.is_unlimited_cdrs = isUnlimitedCdrs;
      parsed.trial_tender_limit = isUnlimitedTenders ? 'unlimited' : dynamicTenderLimit;
      parsed.trial_bid_security_limit = isUnlimitedCdrs ? 'unlimited' : dynamicBidSecurityLimit;
      parsed.active_modules = dynamicModules;
      parsed.billing_cycle = dynamicBillingCycle;
      parsed.custom_base_price = dynamicBasePrice;
      parsed.trial_period = trialPeriodStr;
      parsed.trial_days = trialDays;
      parsed.trial_end_date = trialEndStr;
      parsed.current_period_end = trialEndStr;

      localStorage.setItem(`mashrue_sub_${tid}`, JSON.stringify(parsed));
      return parsed;
    }

    const defaultSub = {
      tenant_id: tid,
      plan_type: planType,
      status: isSuspended ? 'Suspended' : (isTrial ? 'Trial' : 'Active'),
      is_trial: isTrial,
      trial_days: trialDays,
      trial_period: trialPeriodStr,
      trial_start_date: now.toISOString().split('T')[0],
      trial_end_date: trialEndStr,
      current_period_start: now.toISOString().split('T')[0],
      current_period_end: trialEndStr,
      billing_cycle: dynamicBillingCycle,
      free_companies_limit: dynamicFreeCompanies,
      free_users_limit: dynamicFreeUsers,
      tender_limit: dynamicTenderLimit,
      bid_security_limit: dynamicBidSecurityLimit,
      is_unlimited_tenders: isUnlimitedTenders,
      is_unlimited_cdrs: isUnlimitedCdrs,
      custom_base_price: dynamicBasePrice,
      custom_extra_company_price: 4500,
      custom_extra_seat_price: 1500,
      trial_tender_limit: isUnlimitedTenders ? 'unlimited' : dynamicTenderLimit,
      trial_bid_security_limit: isUnlimitedCdrs ? 'unlimited' : dynamicBidSecurityLimit,
      starter_tender_limit: 5,
      is_personal_reference_trial: (trialDays > 15),
      personal_reference_note: '',
      active_modules: dynamicModules,
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
    const raw = localStorage.getItem(`mashrue_payments_${tid}`);
    return raw ? JSON.parse(raw) : [];
  },

  recordSubscriptionPayment(paymentData) {
    const tid = paymentData.tenant_id;
    const payments = this.getSubscriptionPayments(tid);
    const newPayment = {
      id: 'REC-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000),
      ...paymentData,
      created_at: new Date().toISOString()
    };
    payments.unshift(newPayment);
    localStorage.setItem(`mashrue_payments_${tid}`, JSON.stringify(payments));

    const sub = this.getTenantSubscription(paymentData.tenant_id);
    const addMonths = Number(paymentData.extension_months || 1);
    const curEnd = new Date(sub.current_period_end || sub.trial_end_date || new Date());
    curEnd.setMonth(curEnd.getMonth() + addMonths);

    this.saveTenantSubscription(tid, {
      status: 'Active',
      is_trial: false,
      current_period_end: curEnd.toISOString().split('T')[0],
      trial_end_date: curEnd.toISOString().split('T')[0],
      last_payment_date: new Date().toISOString().split('T')[0],
      last_payment_reference: paymentData.reference_number
    });

    return newPayment;
  },

  getTenantQuota(tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    try {
      const raw = localStorage.getItem(`mashrue_quota_${tid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}

    const opps = this.getTenantEntityList ? this.getTenantEntityList('opportunities') : [];
    const oppCount = Array.isArray(opps) ? opps.filter(o => o && o.tenant_id === tid).length : 0;

    const secs = this.getTenantEntityList ? this.getTenantEntityList('bidSecurities') : [];
    const secCount = Array.isArray(secs) ? secs.filter(b => b && b.tenant_id === tid).length : 0;

    const initial = {
      tenant_id: tid,
      tenders_created: oppCount,
      bid_securities_created: secCount,
      cycle_start: new Date().toISOString().split('T')[0]
    };
    try {
      localStorage.setItem(`mashrue_quota_${tid}`, JSON.stringify(initial));
    } catch (e) {}
    return initial;
  },

  incrementTenantQuota(type, tenantId) {
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id || 'default';
    const quota = this.getTenantQuota(tid);
    if (type === 'tender') {
      quota.tenders_created = (quota.tenders_created || 0) + 1;
      this.liveTendersCount = quota.tenders_created;
      if (this.currentUser?.tenant) this.currentUser.tenant.tenderCount = quota.tenders_created;
    }
    if (type === 'bid_security') {
      quota.bid_securities_created = (quota.bid_securities_created || 0) + 1;
      this.liveCdrsCount = quota.bid_securities_created;
      if (this.currentUser?.tenant) this.currentUser.tenant.cdrCount = quota.bid_securities_created;
    }
    localStorage.setItem(`mashrue_quota_${tid}`, JSON.stringify(quota));
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

    // 2. Dynamic Tender Leverage Check
    if (actionType === 'tender') {
      const isUnlimited = (
        sub.is_unlimited_tenders ||
        sub.tender_limit === 'unlimited' ||
        sub.tender_limit === -1 ||
        sub.trial_tender_limit === 'unlimited'
      );
      if (!isUnlimited) {
        // Sanitize: Check real persisted tenders in entity list
        const realOpps = (this.getTenantEntityList ? this.getTenantEntityList('opportunities', tid) : [])
          .filter(o => o && o.id && !String(o.id).startsWith('f-') && !String(o.id).startsWith('tnd-'));
        const used = Math.min(quota.tenders_created || 0, realOpps.length);
        const maxLimit = parseInt(sub.tender_limit || sub.trial_tender_limit || sub.starter_tender_limit || 5, 10);
        if (used >= maxLimit) {
          return {
            allowed: false,
            quotaExceeded: true,
            current: used,
            limit: maxLimit,
            message: `Your organization's tender quota limit has been reached (${used}/${maxLimit} Tenders). Please contact your administrator or upgrade plan for unlimited tender bidding.`
          };
        }
      }
    }

    // 3. Dynamic Bid Security / CDR Leverage Check
    if (actionType === 'bid_security') {
      const isUnlimited = (
        sub.is_unlimited_cdrs ||
        sub.bid_security_limit === 'unlimited' ||
        sub.bid_security_limit === -1 ||
        sub.trial_bid_security_limit === 'unlimited'
      );
      if (!isUnlimited) {
        const list = this.getTenantEntityList ? this.getTenantEntityList('bidSecurities') : [];
        const used = list.filter(b => b.tenant_id === tid).length || (quota.bid_securities_created || 0);
        const maxLimit = parseInt(sub.bid_security_limit || sub.trial_bid_security_limit || 10, 10);
        if (used >= maxLimit) {
          return {
            allowed: false,
            quotaExceeded: true,
            current: used,
            limit: maxLimit,
            message: `Your organization's Bid Security / CDR quota limit has been reached (${used}/${maxLimit} items). Please contact your administrator or upgrade plan for unlimited entries.`
          };
        }
      }
    }

    return { allowed: true };
  },

  isModuleActiveForTenant(moduleKey, tenantId) {
    if (this.isSuperAdmin()) return true;
    const sub = this.getTenantSubscription(tenantId);
    if (Array.isArray(sub.active_modules) && sub.active_modules.length > 0) {
      return sub.active_modules.includes(moduleKey);
    }
    if (sub.is_trial || sub.plan_type === 'Advance' || sub.plan_type === 'Enterprise') return true;
    if (sub.plan_type === 'Starter' || sub.plan_type === 'Basic') {
      return ['mod_tenders', 'mod_quotations', 'mod_fbr_invoicing'].includes(moduleKey);
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
  },

  isApplicationStopped(tenantId) {
    if (this.isSuperAdmin()) return false;
    const tid = tenantId || this.currentUser?.tenant?.id || this.currentUser?.tenant_id;
    if (this.currentUser?.tenant?.pendingPaidCompanyPayment || this.currentUser?.tenant?.applicationStopped) {
      return true;
    }
    const sub = this.getTenantSubscription(tid);
    if (sub?.pending_paid_company_payment || sub?.status === 'Payment_Pending') {
      return true;
    }
    return false;
  },

  setApplicationStopped(stopped, amountDue) {
    if (this.currentUser?.tenant) {
      this.currentUser.tenant.pendingPaidCompanyPayment = Boolean(stopped);
      this.currentUser.tenant.applicationStopped = Boolean(stopped);
      if (amountDue) this.currentUser.tenant.pendingPaidCompanyAmount = amountDue;
    }
    const tid = this.currentUser?.tenant?.id || this.currentUser?.tenant_id;
    if (tid) {
      this.saveTenantSubscription(tid, {
        pending_paid_company_payment: Boolean(stopped),
        status: stopped ? 'Payment_Pending' : 'Active'
      });
    }
  }
};
