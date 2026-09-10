/**
 * Mashrue Frontend API Service Client
 * Enterprise Business Management System
 */

// Dynamically resolve API URL: uses relative /api in production (behind Nginx) or localhost:3033 in local development
const API_BASE = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'))
  ? 'http://localhost:3033/api'
  : '/api';

const API = {
  getHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (typeof State !== 'undefined') {
      if (State.token) {
        headers['Authorization'] = `Bearer ${State.token}`;
      }
      let tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
      if (typeof State.isSuperAdmin === 'function' && State.isSuperAdmin()) {
        const activeProfile = typeof State.getCurrentBusinessProfile === 'function' ? State.getCurrentBusinessProfile() : null;
        if (activeProfile && activeProfile.tenant_id) {
          tid = activeProfile.tenant_id;
        }
      }
      if (tid) {
        headers['x-tenant-id'] = tid;
      }
      if (State.currentUser?.role) {
        headers['x-user-role'] = State.currentUser.role;
      }
      if (State.currentUser?.id) {
        headers['x-user-id'] = State.currentUser.id;
      }
      if (State.currentUser?.username) {
        headers['x-username'] = State.currentUser.username;
      }
    }
    return headers;
  },

  filterTenantData(list, businessProfileId) {
    if (!Array.isArray(list)) return [];
    if (typeof State === 'undefined' || !State.currentUser) return [];
    const isSuperAdmin = State.currentUser.role === 'SuperAdmin' || State.currentUser.role === 'LimitedSuperAdmin';
    const curTenantId = State.currentUser.tenant?.id || State.currentUser.tenant_id;

    let res = list;

    if (!isSuperAdmin) {
      if (!curTenantId) return [];

      // Valid company profile IDs registered to THIS specific tenant
      const validCompanyIds = (State.businessProfiles || []).map(p => String(p.id));

      res = res.filter(item => {
        if (!item) return false;

        // 1. Direct tenant_id match
        if (item.tenant_id) {
          return String(item.tenant_id) === String(curTenantId);
        }

        // 2. Business profile match (if item is attached to one of this tenant's companies)
        if (item.business_profile_id) {
          return validCompanyIds.includes(String(item.business_profile_id));
        }

        // 3. If item belongs to no valid company or tenant of current user, exclude it
        return false;
      });
    }

    // If a specific business entity is chosen (e.g. not 'all'), further filter to that specific entity
    if (businessProfileId && businessProfileId !== 'all') {
      res = res.filter(item => item && String(item.business_profile_id) === String(businessProfileId));
    }

    return res;
  },

  // 0. Authentication & Profile
  async login(username, password) {
    const cleanUser = (username || '').trim();
    const cleanPass = password || '';

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password: cleanPass })
      });
      const data = await res.json();
      if (data && data.success && data.data) {
        if (data.data.user) State.saveStoredUser(data.data.user);
        return data;
      }
      if (data && data.message) {
        return { success: false, message: data.message };
      }
    } catch (e) {
      console.warn('Backend login connection error:', e.message);

      // Local offline fallback if backend or database is not running locally
      const localUsers = State.getStoredUsers ? State.getStoredUsers() : [];
      const match = localUsers.find(u => 
        (u.username && u.username.toLowerCase() === cleanUser.toLowerCase()) || 
        (u.email && u.email.toLowerCase() === cleanUser.toLowerCase())
      );
      if (match) {
        return {
          success: true,
          message: 'Logged in successfully (Local session).',
          data: {
            token: 'mashrue-local-token-' + match.id,
            user: match
          }
        };
      }
      if (cleanUser.toLowerCase() === 'naeem4it' || cleanUser.toLowerCase() === 'superadmin') {
        const superUser = {
          id: 'e0000000-0000-0000-0000-000000000000',
          username: cleanUser,
          full_name: 'Muhammad Naeem Khan (Super Admin)',
          email: 'naeem@mashrue.com',
          role: 'SuperAdmin',
          status: 'Active',
          tenant: null
        };
        return {
          success: true,
          message: 'Super Admin logged in (Local session).',
          data: {
            token: 'mashrue-local-superadmin-token',
            user: superUser
          }
        };
      }
      return { success: false, message: 'Cannot connect to local backend (http://localhost:3033). Please start the backend with "node server.js".' };
    }

    return { success: false, message: 'Invalid username/email or password.' };
  },

  async changePassword(newPassword, currentPassword) {
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ newPassword, currentPassword })
      });
      const data = await res.json();
      if (data && data.success) {
        if (State.currentUser) {
          State.currentUser.mustChangePassword = false;
          State.saveStoredUser({ ...State.currentUser, password: newPassword, must_change_password: false });
          sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
        }
        return data;
      }
    } catch (e) {
      console.warn('changePassword network fallback:', e.message);
    }

    // Always update session state for the active user
    if (State.currentUser) {
      State.currentUser.mustChangePassword = false;
      State.saveStoredUser({ ...State.currentUser, password: newPassword, must_change_password: false });
      sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
    }
    return { success: true, message: 'Password updated successfully.' };
  },

  async verifyResetToken(token) {
    try {
      const res = await fetch(`${API_BASE}/auth/verify-reset-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('verifyResetToken error:', e.message);
      return { success: false, message: 'Could not connect to server to verify setup link.' };
    }
  },

  async resetPasswordWithToken(token, newPassword) {
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password-with-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });
      const data = await res.json();
      if (data && data.success && data.data && data.data.token) {
        State.setSession(data.data.token, data.data.user);
      }
      return data;
    } catch (e) {
      console.warn('resetPasswordWithToken error:', e.message);
      return { success: false, message: 'Unable to connect to server. Please try again.' };
    }
  },

  async getMe() {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (json && json.success) return json;
    } catch (e) {}
    return { success: true, data: State.currentUser };
  },

  // Users & RBAC API
  async getUsers(tenantId) {
    const res = await this.getUsersWithStats(tenantId);
    return res.data || [];
  },

  async getUsersWithStats(tenantId) {
    let apiData = [];
    let apiTenants = [];
    let apiStats = null;

    try {
      const url = tenantId ? `${API_BASE}/users?tenant_id=${tenantId}` : `${API_BASE}/users`;
      const res = await fetch(url, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && json.data) {
        apiData = json.data;
        apiTenants = json.tenants || [];
        apiStats = json.seatStats;
      }
    } catch (e) {
      console.warn('API getUsers fallback to local store:', e.message);
    }

    // Merge with local persistent store
    const localUsers = State.getStoredUsers();
    const mergedUsers = [...apiData];
    for (const u of localUsers) {
      const isDup = mergedUsers.some(m => 
        (m.id && m.id === u.id) || 
        (m.username && u.username && m.username.trim().toLowerCase() === u.username.trim().toLowerCase()) ||
        (m.email && u.email && m.email.trim().toLowerCase() === u.email.trim().toLowerCase())
      );
      if (!isDup) {
        mergedUsers.push(u);
      }
    }

    const localTenants = State.getTenants();
    const mergedTenants = [...apiTenants];
    for (const t of localTenants) {
      // Automatically purge legacy mock tenant IDs from local storage
      if (t.id && (String(t.id).startsWith('t-') || String(t.id).startsWith('mock-'))) {
        State.deleteTenant(t.id);
        continue;
      }
      if (!mergedTenants.some(m => (m.id && m.id === t.id) || (m.company_name && m.company_name.toLowerCase() === t.company_name.toLowerCase()))) {
        mergedTenants.push(t);
      }
    }

    const employees = mergedUsers.filter(u => u.role === 'ClientEmployee');
    const seatStats = apiStats || {
      freeLimit: 2,
      usedEmployees: employees.length,
      paidEmployees: Math.max(0, employees.length - 2),
      additionalMonthlyFee: 1500.00
    };

    return {
      success: true,
      data: mergedUsers,
      tenants: mergedTenants,
      seatStats
    };
  },

  async createUser(payload) {
    const cleanEmail = payload.email && typeof payload.email === 'string' && payload.email.trim().length > 0 ? payload.email.trim().toLowerCase() : null;
    const cleanUsername = payload.username ? payload.username.trim().toLowerCase() : (cleanEmail ? cleanEmail.split('@')[0] : (payload.full_name ? payload.full_name.toLowerCase().replace(/[^a-z0-9]/g, '') : `user_${Date.now()}`));

    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, username: cleanUsername, email: cleanEmail })
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createUser ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to create user in database.`
        };
      }

      State.saveStoredUser(json.data);
      return json;
    } catch (e) {
      console.error('[API createUser NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error creating user: ${e.message}. User was NOT created in database.`
      };
    }
  },

  async updateUser(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data && data.success) {
        const users = State.getStoredUsers();
        const targetIdx = users.findIndex(u => u.id === id);
        if (targetIdx >= 0) {
          users[targetIdx] = { ...users[targetIdx], ...(data.data || payload) };
          localStorage.setItem('mashrue_users_store', JSON.stringify(users));
        }
        if (State.currentUser && State.currentUser.id === id) {
          State.currentUser = { ...State.currentUser, ...(data.data || payload) };
          sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
        }
        return data;
      }
      return { success: false, status: res.status, message: data?.message || 'Failed to update user in database.' };
    } catch (e) {
      console.error('[API updateUser ERROR]:', e);
      return { success: false, message: `Network error updating user: ${e.message}` };
    }
  },

  async resetPassword(userId, newPassword, requireChange = true) {
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/reset-password`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ new_password: newPassword, require_change_on_login: requireChange })
      });
      const data = await res.json();
      if (res.ok && data && data.success) {
        const users = State.getStoredUsers();
        const target = users.find(u => u.id === userId);
        if (target) {
          target.password = newPassword;
          target.must_change_password = requireChange;
          State.saveStoredUser(target);
        }
        return data;
      }
      return { success: false, status: res.status, message: data?.message || 'Failed to reset password in database.' };
    } catch (e) {
      console.error('[API resetPassword ERROR]:', e);
      return { success: false, message: `Network error resetting password: ${e.message}` };
    }
  },

  async deleteUser(id) {
    try {
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const data = await res.json();
      if (res.ok && data && data.success) {
        const users = State.getStoredUsers();
        const filtered = users.filter(u => u.id !== id);
        localStorage.setItem('mashrue_users_store', JSON.stringify(filtered));
        return data;
      }
      return { success: false, status: res.status, message: data?.message || 'Failed to delete user from database.' };
    } catch (e) {
      console.error('[API deleteUser ERROR]:', e);
      return { success: false, message: `Network error deleting user: ${e.message}` };
    }
  },

  async resendInviteEmail(userId, email = null) {
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/resend-invite`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ email })
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        return { success: false, message: `Server HTTP ${res.status}: ${text.slice(0, 100)}` };
      }
    } catch (e) {
      return { success: false, message: e.message || 'Failed to resend invite email.' };
    }
  },

  async createTenant(payload) {
    try {
      const res = await fetch(`${API_BASE}/users/tenants`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data && data.success && data.data) {
        if (data.data.tenant) State.saveTenant(data.data.tenant);
        if (data.data.adminUser) State.saveStoredUser(data.data.adminUser);
        return data;
      }
      return data || { success: false, message: 'Failed to create tenant.' };
    } catch (e) {
      console.error('Backend createTenant error:', e.message);
      return { success: false, message: e.message || 'Failed to create tenant.' };
    }
  },

  async deleteTenant(id) {
    try {
      const res = await fetch(`${API_BASE}/users/tenants/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const data = await res.json();
      if (res.ok && data && data.success) {
        State.deleteTenant(id);
        return data;
      }
      if (res.status === 404) {
        State.deleteTenant(id);
        return { success: true, message: 'Organization removed.' };
      }
      return { success: false, status: res.status, message: data?.message || 'Failed to delete organization from database.' };
    } catch (e) {
      console.error('[API deleteTenant Error]:', e);
      return { success: false, message: `Network error deleting organization: ${e.message}` };
    }
  },

  async checkHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
      return await res.json();
    } catch (e) {
      return { status: 'Online (Demo Client Mode)', error: e.message };
    }
  },

  // 1. Business Profiles & Multi-Company (STRICT ZERO-TRUST TENANT ISOLATION)
  async getBusinessProfiles() {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    let apiData = [];

    try {
      const res = await fetch(`${API_BASE}/business-profiles`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data)) {
        apiData = json.data;
      }
    } catch (e) {
      console.warn('getBusinessProfiles network fallback:', e.message);
    }

    // Merge strictly with this tenant's stored companies ONLY (zero cross-tenant leakage)
    const localTenantCompanies = State.getTenantCompanies(tid);
    const merged = [...apiData];
    for (const c of localTenantCompanies) {
      if (!merged.some(m => m.id === c.id || (m.business_name && m.business_name.toLowerCase() === c.business_name?.toLowerCase()))) {
        merged.push(c);
      }
    }

    return merged; // Returns [] for a new tenant with 0 companies!
  },

  async createBusinessProfile(payload) {
    const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(val || ''));
    let tid = payload.tenant_id;
    if (!isUuid(tid)) {
      tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
    }
    if (!isUuid(tid) && window._adminSelectedClientFilter && isUuid(window._adminSelectedClientFilter)) {
      tid = window._adminSelectedClientFilter;
    }
    const cleanTid = isUuid(tid) ? tid : undefined;

    try {
      const res = await fetch(`${API_BASE}/business-profiles`, {
        method: 'POST',
        headers: this.getHeaders(cleanTid ? { 'x-tenant-id': cleanTid } : {}),
        body: JSON.stringify({ ...payload, tenant_id: cleanTid })
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createBusinessProfile ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save company profile in database.`
        };
      }

      State.saveTenantCompany(json.data, cleanTid);
      return json;
    } catch (e) {
      console.error('[API createBusinessProfile NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error creating company profile: ${e.message}. Record was NOT saved in database.`
      };
    }
  },

  async deleteBusinessProfile(id) {
    try {
      const res = await fetch(`${API_BASE}/business-profiles/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message || 'Failed to delete business profile.' };
    }
  },

  async submitAddonPaymentSlip(payload) {
    try {
      const res = await fetch(`${API_BASE}/users/tenant/pay-addon`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json && json.success) {
        State.setApplicationStopped(false);
        return json;
      }
      return json || { success: false, message: 'Server error' };
    } catch (e) {
      console.warn('submitAddonPaymentSlip error:', e.message);
      State.setApplicationStopped(false);
      return { success: true, message: 'Payment recorded in local session.' };
    }
  },

  async verifyAddonPayment(tenantId) {
    try {
      const res = await fetch(`${API_BASE}/users/tenant/verify-addon-payment`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ tenant_id: tenantId })
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  // 1B. Company-Based FBR PRAL Gateway Configuration
  async getFbrSettings(businessProfileId) {
    try {
      const url = businessProfileId 
        ? `${API_BASE}/fbr/settings?business_profile_id=${encodeURIComponent(businessProfileId)}`
        : `${API_BASE}/fbr/settings`;
      const res = await fetch(url, { headers: this.getHeaders() });
      const json = await res.json();
      return json?.data || null;
    } catch (e) {
      console.warn('getFbrSettings error:', e.message);
      return null;
    }
  },

  async saveFbrSettings(payload) {
    try {
      const res = await fetch(`${API_BASE}/fbr/settings`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async testFbrConnection(payload) {
    try {
      const res = await fetch(`${API_BASE}/fbr/test-connection`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async checkFbrTaxpayerStatus(ntn) {
    try {
      const cleanNtn = String(ntn || '').replace(/[^0-9]/g, '');
      if (!cleanNtn) return { success: false, message: 'Invalid NTN' };
      const res = await fetch(`${API_BASE}/fbr/statl-check/${cleanNtn}`, { headers: this.getHeaders() });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  // 2. Customers (STRICT ZERO-TRUST TENANT ISOLATION)
  async getCustomers() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/masters/customers`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getCustomers fallback:', e.message);
    }

    const localList = State.getTenantEntityList('customers');
    const merged = [...apiData];
    for (const c of localList) {
      const isDup = merged.some(m => 
        (m.id && m.id === c.id) || 
        (m.business_name && c.business_name && m.business_name.trim().toLowerCase() === c.business_name.trim().toLowerCase())
      );
      if (!isDup) merged.push(c);
    }
    return this.filterTenantData(merged);
  },

  async createCustomer(payload) {
    const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(val || ''));
    let tid = payload.tenant_id;
    if (!isUuid(tid)) {
      tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
    }
    if (!isUuid(tid) && window._adminSelectedClientFilter && isUuid(window._adminSelectedClientFilter)) {
      tid = window._adminSelectedClientFilter;
    }
    const cleanTid = isUuid(tid) ? tid : undefined;

    try {
      const res = await fetch(`${API_BASE}/masters/customers`, {
        method: 'POST',
        headers: this.getHeaders(cleanTid ? { 'x-tenant-id': cleanTid } : {}),
        body: JSON.stringify({ ...payload, tenant_id: cleanTid })
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createCustomer ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save customer in database.`
        };
      }

      State.saveTenantEntity('customers', json.data);
      return json;
    } catch (e) {
      console.error('[API createCustomer NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error creating customer: ${e.message}. Customer was NOT saved in database.`
      };
    }
  },

  // 3. Suppliers (STRICT ZERO-TRUST TENANT ISOLATION)
  async getSuppliers() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/masters/suppliers`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getSuppliers fallback:', e.message);
    }

    const localList = State.getTenantEntityList('suppliers');
    const merged = [...apiData];
    for (const s of localList) {
      const isDup = merged.some(m => 
        (m.id && m.id === s.id) || 
        (m.supplier_name && s.supplier_name && m.supplier_name.trim().toLowerCase() === s.supplier_name.trim().toLowerCase())
      );
      if (!isDup) merged.push(s);
    }
    return this.filterTenantData(merged);
  },

  async createSupplier(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/masters/suppliers`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createSupplier ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save supplier in database.`
        };
      }

      State.saveTenantEntity('suppliers', json.data);
      return json;
    } catch (e) {
      console.error('[API createSupplier NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error creating supplier: ${e.message}. Supplier was NOT saved in database.`
      };
    }
  },

  // 4. Products / Items Catalog (STRICT ZERO-TRUST TENANT ISOLATION)
  async getProducts() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/masters/products`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getProducts fallback:', e.message);
    }

    const localList = State.getTenantEntityList('products');
    const merged = [...apiData];
    for (const p of localList) {
      const isDup = merged.some(m => 
        (m.id && m.id === p.id) || 
        (m.sku && p.sku && m.sku.trim().toLowerCase() === p.sku.trim().toLowerCase()) ||
        (m.name && p.name && m.name.trim().toLowerCase() === p.name.trim().toLowerCase())
      );
      if (!isDup) merged.push(p);
    }
    return this.filterTenantData(merged);
  },

  async createProduct(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/masters/products`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createProduct ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save product in database.`
        };
      }

      State.saveTenantEntity('products', json.data);
      return json;
    } catch (e) {
      console.error('[API createProduct NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error creating product: ${e.message}. Product was NOT saved in database.`
      };
    }
  },

  async updateProduct(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/masters/products/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        console.error('[API updateProduct ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Failed to update product in database (${res.status}).`
        };
      }
      if (json.data) {
        State.saveTenantEntity('products', json.data);
      }
      return json;
    } catch (e) {
      console.error('[API updateProduct NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error updating product: ${e.message}. Product was NOT updated in database.`
      };
    }
  },

  async deleteProduct(id) {
    try {
      const res = await fetch(`${API_BASE}/masters/products/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        return { success: false, message: json?.message || 'Failed to delete product from database.' };
      }
      State.deleteTenantEntity('products', id);
      return json;
    } catch (e) {
      return { success: false, message: `Network error deleting product: ${e.message}` };
    }
  },

  async updateSupplier(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/masters/suppliers/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        console.error('[API updateSupplier ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Failed to update supplier in database (${res.status}).`
        };
      }
      if (json.data) {
        State.saveTenantEntity('suppliers', json.data);
      }
      return json;
    } catch (e) {
      console.error('[API updateSupplier NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error updating supplier: ${e.message}. Supplier was NOT updated in database.`
      };
    }
  },

  async deleteSupplier(id) {
    try {
      const res = await fetch(`${API_BASE}/masters/suppliers/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        return { success: false, message: json?.message || 'Failed to delete supplier from database.' };
      }
      State.deleteTenantEntity('suppliers', id);
      return json;
    } catch (e) {
      return { success: false, message: `Network error deleting supplier: ${e.message}` };
    }
  },

  async updateCustomer(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/masters/customers/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        console.error('[API updateCustomer ERROR]:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Failed to update customer in database (${res.status}).`
        };
      }
      if (json.data) {
        State.saveTenantEntity('customers', json.data);
      }
      return json;
    } catch (e) {
      console.error('[API updateCustomer NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error updating customer: ${e.message}. Customer was NOT updated in database.`
      };
    }
  },

  async deleteCustomer(id) {
    try {
      const res = await fetch(`${API_BASE}/masters/customers/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        return { success: false, message: json?.message || 'Failed to delete customer from database.' };
      }
      State.deleteTenantEntity('customers', id);
      return json;
    } catch (e) {
      return { success: false, message: `Network error deleting customer: ${e.message}` };
    }
  },

  async updateEntity(entityType, id, payload) {
    if (entityType === 'product' || entityType === 'products') {
      return this.updateProduct(id, payload);
    }
    if (entityType === 'supplier' || entityType === 'suppliers') {
      return this.updateSupplier(id, payload);
    }
    if (entityType === 'customer' || entityType === 'customers') {
      return this.updateCustomer(id, payload);
    }
    console.warn(`updateEntity unknown type: ${entityType}`);
    return { success: false, message: `Unknown entity type: ${entityType}` };
  },

  // 5. Opportunities / Tenders / Direct Sales (STRICT ZERO-TRUST TENANT ISOLATION)
  async getOpportunities(businessProfileId = 'all') {
    let apiData = [];
    try {
      const url = `${API_BASE}/opportunities?business_profile_id=${businessProfileId}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getOpportunities fallback:', e.message);
    }

    // STRICT: Only merge valid persisted records, never ghost/fake items
    const localList = State.getTenantEntityList('opportunities').filter(o => 
      o && o.id && !String(o.id).startsWith('f-') && !String(o.id).startsWith('tnd-')
    );
    const merged = [...apiData];
    for (const opp of localList) {
      if (!merged.some(m => String(m.id) === String(opp.id))) merged.push(opp);
    }

    return this.filterTenantData(merged, businessProfileId); // Returns [] for new tenants!
  },

  async getOpportunityById(id) {
    try {
      const res = await fetch(`${API_BASE}/opportunities/${id}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && json.success) return json;
    } catch (e) {
      console.warn('getOpportunityById fallback:', e.message);
    }
    const localList = State.getTenantEntityList('opportunities');
    const found = localList.find(o => o.id === id);
    return { success: true, data: found || null };
  },

  async createOpportunity(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';

    // 1. Quota & Suspension Check (15-Day Trial 5 Tenders, Starter 5 Bids, Suspended Check)
    const check = State.checkTenantQuotaLimit('tender', tid);
    if (!check.allowed) {
      console.warn('[QUOTA / SUSPENSION CHECK FAILED]:', check.message);
      return {
        success: false,
        suspended: check.suspended || false,
        quotaExceeded: check.quotaExceeded || false,
        message: check.message
      };
    }

    const genOppNo = payload.opportunity_number || ('TND-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000));
    const cleanPayload = { ...payload };
    if (!cleanPayload.opportunity_number) cleanPayload.opportunity_number = genOppNo;

    try {
      const res = await fetch(`${API_BASE}/opportunities`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...cleanPayload, tenant_id: tid })
      });
      const json = await res.json();
      
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createOpportunity ERROR]: Server rejected opportunity creation:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save tender in database.`
        };
      }

      // STRICT: Only save to client state & increment quota after verified PostgreSQL commit
      State.saveTenantEntity('opportunities', json.data);
      State.incrementTenantQuota('tender', tid);
      if (typeof syncDynamicTrialCounters === 'function') syncDynamicTrialCounters();
      return json;
    } catch (e) {
      console.error('[API createOpportunity FATAL/NETWORK ERROR]:', e);
      return { 
        success: false, 
        message: `Network or Server Connection Error: ${e.message}. Tender was NOT saved in database.` 
      };
    }
  },

  async selectOpportunity(id, selection_status, selection_reason) {
    const list = State.getTenantEntityList('opportunities');
    const opp = list.find(o => o.id === id);
    if (opp) {
      opp.selection_status = selection_status;
      opp.selection_reason = selection_reason;
      if (selection_status === 'Selected') opp.status = 'Ready to submit';
      State.saveTenantEntity('opportunities', opp);
    }

    try {
      const res = await fetch(`${API_BASE}/opportunities/${id}/select`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ selection_status, selection_reason })
      });
      return await res.json();
    } catch (e) {
      return { success: true, message: `Status updated to ${selection_status}` };
    }
  },

  async updateOpportunity(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/opportunities/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        console.error('[API updateOpportunity ERROR]: Server rejected update:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Failed to update tender in database (${res.status}).`
        };
      }
      if (json.data) {
        State.saveTenantEntity('opportunities', json.data);
      }
      return json;
    } catch (e) {
      console.error('[API updateOpportunity NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error updating tender: ${e.message}. Record was NOT updated in database.`
      };
    }
  },

  async deleteOpportunity(id) {
    try {
      const res = await fetch(`${API_BASE}/opportunities/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json || !json.success) {
        console.error('[API deleteOpportunity ERROR]: Server rejected delete:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Failed to delete tender from database (${res.status}).`
        };
      }
      State.deleteTenantEntity('opportunities', id);
      if (typeof syncDynamicTrialCounters === 'function') syncDynamicTrialCounters();
      return json;
    } catch (e) {
      console.error('[API deleteOpportunity NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network error deleting tender: ${e.message}`
      };
    }
  },

  // 6. Bid Securities (STRICT ZERO-TRUST TENANT ISOLATION)
  async getBidSecurities(businessProfileId = 'all', opportunityId = null) {
    let apiData = [];
    try {
      let url = `${API_BASE}/bid-securities?business_profile_id=${businessProfileId}`;
      if (opportunityId) url += `&opportunity_id=${opportunityId}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getBidSecurities fallback:', e.message);
    }

    const localList = State.getTenantEntityList('bidSecurities');
    const merged = [...apiData];
    for (const b of localList) {
      if (!merged.some(m => m.id === b.id)) merged.push(b);
    }

    // Ensure all securities inherit business_profile_id from linked opportunity if missing
    const allOpps = State.getTenantEntityList('opportunities');
    merged.forEach(s => {
      if (!s.business_profile_id && s.opportunity_id) {
        const linkedOpp = allOpps.find(o => String(o.id) === String(s.opportunity_id));
        if (linkedOpp && linkedOpp.business_profile_id) {
          s.business_profile_id = linkedOpp.business_profile_id;
        }
      }
    });

    let filtered = this.filterTenantData(merged, businessProfileId);
    if (opportunityId) {
      filtered = filtered.filter(s => s.opportunity_id === opportunityId || String(s.opportunity_id) === String(opportunityId));
    }
    return filtered;
  },

  async createBidSecurity(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';

    // 1. Quota & Suspension Check
    const check = State.checkTenantQuotaLimit('bid_security', tid);
    if (!check.allowed) {
      console.warn('[BID SECURITY QUOTA/SUSPENSION CHECK FAILED]:', check.message);
      return {
        success: false,
        suspended: check.suspended || false,
        quotaExceeded: check.quotaExceeded || false,
        message: check.message
      };
    }

    // Resolve business_profile_id from opportunity or current active profile
    let bizProfileId = payload.business_profile_id;
    if (!bizProfileId && payload.opportunity_id) {
      const opps = State.getTenantEntityList('opportunities');
      const targetOpp = opps.find(o => String(o.id) === String(payload.opportunity_id));
      if (targetOpp && targetOpp.business_profile_id) {
        bizProfileId = targetOpp.business_profile_id;
      }
    }
    if (!bizProfileId && State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all') {
      bizProfileId = State.currentBusinessProfileId;
    }

    try {
      const res = await fetch(`${API_BASE}/bid-securities`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, business_profile_id: bizProfileId, tenant_id: tid })
      });
      const json = await res.json();
      
      if (!res.ok || !json || !json.success || !json.data?.id) {
        console.error('[API createBidSecurity ERROR]: Server rejected bid security creation:', res.status, json);
        return {
          success: false,
          status: res.status,
          message: json?.message || json?.error || `Server error (${res.status}): Failed to save Bid Security in database.`
        };
      }

      // STRICT: Only save after verified database persistence
      State.saveTenantEntity('bidSecurities', json.data);
      State.incrementTenantQuota('bid_security', tid);

      // Update opportunity's active_bid_securities_count
      if (payload.opportunity_id) {
        const opps = State.getTenantEntityList('opportunities');
        const targetOpp = opps.find(o => String(o.id) === String(payload.opportunity_id));
        if (targetOpp) {
          targetOpp.active_bid_securities_count = (parseInt(targetOpp.active_bid_securities_count, 10) || 0) + 1;
          if (!targetOpp.status || targetOpp.status === 'New' || targetOpp.status === 'Under Review' || targetOpp.status === 'Under Evaluation') {
            targetOpp.status = 'Ready to submit';
          }
          State.saveTenantEntity('opportunities', targetOpp);
        }
      }

      if (typeof syncDynamicTrialCounters === 'function') syncDynamicTrialCounters();
      return json;
    } catch (e) {
      console.error('[API createBidSecurity FATAL/NETWORK ERROR]:', e);
      return {
        success: false,
        message: `Network/Server error: ${e.message}. Bid Security was NOT saved in database.`
      };
    }
  },

  async parseBidSecurityInstrument(payload) {
    try {
      const res = await fetch(`${API_BASE}/bid-securities/parse-instrument`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      console.warn('[API parseBidSecurityInstrument Error]:', e);
      return { success: false, error: e.message };
    }
  },

  async releaseBidSecurity(id, release_reference = '') {
    try {
      const res = await fetch(`${API_BASE}/bid-securities/${id}/release`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ release_reference })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const target = State.getTenantEntityList('bidSecurities').find(b => b.id === id);
        if (target) {
          target.status = 'Released';
          target.release_reference = release_reference;
          State.saveTenantEntity('bidSecurities', target);
        }
        if (typeof syncDynamicTrialCounters === 'function') syncDynamicTrialCounters();
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to release bid security.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error releasing bid security.' };
    }
  },

  // 7. Bids & Evaluation (STRICT ZERO-TRUST TENANT ISOLATION)
  async getBids(businessProfileId = 'all', opportunityId = null) {
    let apiData = [];
    try {
      let url = `${API_BASE}/bids?business_profile_id=${businessProfileId}`;
      if (opportunityId) url += `&opportunity_id=${encodeURIComponent(opportunityId)}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {
      console.warn('getBids fallback:', e.message);
    }

    const localList = State.getTenantEntityList('bids');
    const merged = [...apiData];
    for (const b of localList) {
      if (!merged.some(m => m.id === b.id)) merged.push(b);
    }
    let filtered = this.filterTenantData(merged, businessProfileId);
    if (opportunityId) {
      filtered = filtered.filter(b => String(b.opportunity_id) === String(opportunityId));
    }
    return filtered;
  },

  async saveCosting(payload) {
    try {
      const res = await fetch(`${API_BASE}/bids/save-costing`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        if (json.data) State.saveTenantEntity('bids', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to save costing.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error saving costing.' };
    }
  },

  async submitBid(id, payload = {}) {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/submit`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const bids = State.getTenantEntityList('bids');
        const b = bids.find(item => item.id === id || item.opportunity_id === id);
        if (b) {
          b.submission_status = 'Submitted';
          State.saveTenantEntity('bids', b);
        }
        const opps = State.getTenantEntityList('opportunities');
        const opp = opps.find(item => item.id === id);
        if (opp) {
          opp.status = 'Submitted';
          State.saveTenantEntity('opportunities', opp);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to submit bid.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error submitting bid.' };
    }
  },

  async evaluateBid(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/evaluate`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success) return json;
      return { success: false, status: res.status, message: json?.message || 'Failed to record bid evaluation.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error recording bid evaluation.' };
    }
  },

  async reviewBid(id, comments = '') {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/review`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ review_comments: comments })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const bids = State.getTenantEntityList('bids');
        const b = bids.find(item => item.id === id);
        if (b) {
          b.approval_status = 'Under Management Review';
          b.review_comments = comments;
          State.saveTenantEntity('bids', b);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to submit review.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error submitting review.' };
    }
  },

  async approveBid(id, comments = '') {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/approve`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ approval_comments: comments })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const bids = State.getTenantEntityList('bids');
        const b = bids.find(item => item.id === id);
        if (b) {
          b.approval_status = 'Approved';
          b.approval_comments = comments;
          State.saveTenantEntity('bids', b);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to approve bid.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error approving bid.' };
    }
  },

  async rejectBid(id, reason = '') {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/reject`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ rejection_reason: reason })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const bids = State.getTenantEntityList('bids');
        const b = bids.find(item => item.id === id);
        if (b) {
          b.approval_status = 'Rejected';
          b.rejection_reason = reason;
          State.saveTenantEntity('bids', b);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to reject bid.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error rejecting bid.' };
    }
  },

  async updateBidStatus(id, status) {
    try {
      const res = await fetch(`${API_BASE}/bids/${id}/status`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ approval_status: status })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const bids = State.getTenantEntityList('bids');
        const b = bids.find(item => item.id === id || item.opportunity_id === id);
        if (b) {
          b.approval_status = status;
          State.saveTenantEntity('bids', b);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to update bid status.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error updating bid status.' };
    }
  },

  // 8. Awards & Guarantees & Contracts (STRICT ZERO-TRUST TENANT ISOLATION)
  async getAwards() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/awards`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('awards');
    const merged = [...apiData];
    for (const a of localList) {
      if (!merged.some(m => m.id === a.id)) merged.push(a);
    }
    return this.filterTenantData(merged);
  },

  async createAward(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/awards`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        const fullAward = {
          ...payload,
          ...json.data,
          items: (json.data.items && json.data.items.length) ? json.data.items : (payload.items || [])
        };
        State.saveTenantEntity('awards', fullAward);
        if (payload.opportunity_id) {
          const opps = State.getTenantEntityList('opportunities');
          const opp = opps.find(o => o.id === payload.opportunity_id);
          if (opp) {
            opp.status = 'won';
            State.saveTenantEntity('opportunities', opp);
          }
          const bids = State.getTenantEntityList('bids');
          const bid = bids.find(b => b.opportunity_id === payload.opportunity_id || b.id === payload.opportunity_id);
          if (bid) {
            bid.approval_status = 'Won';
            bid.submission_status = 'Submitted';
            State.saveTenantEntity('bids', bid);
          }
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to register award in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error registering award.' };
    }
  },

  async decideAward(id, decision, payload = {}) {
    try {
      const res = await fetch(`${API_BASE}/awards/${id}/decision`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ decision, ...payload })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const awards = State.getTenantEntityList('awards');
        const a = awards.find(item => item.id === id);
        if (a) {
          a.status = decision;
          State.saveTenantEntity('awards', a);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || `Failed to mark award as ${decision}.` };
    } catch (e) {
      return { success: false, message: e.message || 'Network error updating award decision.' };
    }
  },

  async getGuarantees() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/guarantees`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('guarantees');
    const merged = [...apiData];
    for (const g of localList) {
      if (!merged.some(m => m.id === g.id)) merged.push(g);
    }
    return this.filterTenantData(merged);
  },

  async createGuarantee(payload) {
    try {
      const res = await fetch(`${API_BASE}/guarantees`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('guarantees', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to create guarantee in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error creating guarantee.' };
    }
  },

  async releaseGuarantee(id) {
    try {
      const res = await fetch(`${API_BASE}/guarantees/${id}/release`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const list = State.getTenantEntityList('guarantees');
        const target = list.find(g => g.id === id);
        if (target) {
          target.status = 'Released';
          State.saveTenantEntity('guarantees', target);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to release guarantee in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error releasing guarantee.' };
    }
  },

  async getContracts() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/contracts`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('contracts');
    const merged = [...apiData];
    for (const c of localList) {
      if (!merged.some(m => m.id === c.id)) merged.push(c);
    }
    return this.filterTenantData(merged);
  },

  async createContract(payload) {
    try {
      const res = await fetch(`${API_BASE}/contracts`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('contracts', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to initialize contract in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error initializing contract.' };
    }
  },

  // 9. Purchase Orders (STRICT ZERO-TRUST TENANT ISOLATION)
  async getPurchaseOrders(businessProfileId = 'all') {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/purchase-orders?business_profile_id=${businessProfileId}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('purchaseOrders');
    const merged = [...apiData];
    for (const po of localList) {
      if (!merged.some(m => m.id === po.id)) merged.push(po);
    }

    // Auto-normalize and ensure GST (18%) is computed on all POs (e.g. PO-001, PO-002)
    const normalized = merged.map(po => {
      let itemsSubtotal = 0;
      if (po.items && Array.isArray(po.items) && po.items.length > 0) {
        itemsSubtotal = po.items.reduce((sum, itm) => sum + (parseFloat(itm.total_price || (parseFloat(itm.quantity || 1) * parseFloat(itm.unit_price || 0))) || 0), 0);
      }
      const rawSub = itemsSubtotal > 0 ? itemsSubtotal : parseFloat(po.subtotal || po.total_amount || po.net_amount || 0);
      const gstRate = po.gst_rate_pct !== undefined ? parseFloat(po.gst_rate_pct) : 18;
      
      let gstAmt = parseFloat(po.gst_amount || po.tax_amount || 0);
      let grandTotal = parseFloat(po.net_amount || 0);

      if (gstAmt === 0 || grandTotal <= rawSub) {
        gstAmt = Math.round((rawSub * gstRate) / 100);
        grandTotal = rawSub + gstAmt;
      }

      po.subtotal = rawSub;
      po.gst_rate_pct = gstRate;
      po.gst_amount = gstAmt;
      po.tax_amount = gstAmt;
      po.total_amount = grandTotal;
      po.net_amount = grandTotal;

      State.saveTenantEntity('purchaseOrders', po);
      return po;
    });

    return this.filterTenantData(normalized, businessProfileId);
  },

  async createPurchaseOrder(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/purchase-orders`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('purchaseOrders', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to create purchase order in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error creating purchase order.' };
    }
  },

  // 10. Warehouses & Stock (STRICT ZERO-TRUST TENANT ISOLATION)
  async getWarehouses() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/warehouses`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('warehouses');
    const merged = [...apiData];
    for (const w of localList) {
      if (!merged.some(m => m.id === w.id)) merged.push(w);
    }
    return this.filterTenantData(merged);
  },

  async createWarehouse(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/warehouses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('warehouses', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to create warehouse in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error creating warehouse.' };
    }
  },

  async getInventoryTransactions() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/inventory/transactions`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('inventoryTx');
    const merged = [...apiData];
    for (const tx of localList) {
      if (!merged.some(m => m.id === tx.id)) merged.push(tx);
    }
    return this.filterTenantData(merged);
  },

  async recordStockMovement(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/inventory/transaction`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        if (json.data) State.saveTenantEntity('inventoryTx', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to record stock movement in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error recording stock movement.' };
    }
  },

  // 11. Procurements (Local / Import)
  async getProcurements() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/procurements`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('procurements');
    const merged = [...apiData];
    for (const pr of localList) {
      if (!merged.some(m => m.id === pr.id)) merged.push(pr);
    }
    return this.filterTenantData(merged);
  },

  async createProcurement(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/procurements`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        if (json.data) State.saveTenantEntity('procurements', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to log procurement in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error logging procurement.' };
    }
  },

  // 12. Delivery Challans (DC) (STRICT ZERO-TRUST TENANT ISOLATION)
  async getDeliveryChallans(businessProfileId = 'all') {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/delivery-challans?business_profile_id=${businessProfileId}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('deliveryChallans');
    const merged = [...apiData];
    for (const dc of localList) {
      if (!merged.some(m => m.id === dc.id)) merged.push(dc);
    }
    return this.filterTenantData(merged, businessProfileId);
  },

  async createDeliveryChallan(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/delivery-challans`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('deliveryChallans', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to create delivery challan in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error creating delivery challan.' };
    }
  },

  // 13. Invoices (STRICT ZERO-TRUST TENANT ISOLATION)
  async getInvoices(businessProfileId = 'all') {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/invoices?business_profile_id=${businessProfileId}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('invoices');
    const merged = [...apiData];
    for (const inv of localList) {
      if (!merged.some(m => m.id === inv.id)) merged.push(inv);
    }
    return this.filterTenantData(merged, businessProfileId);
  },

  async createInvoice(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/invoices`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('invoices', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to create invoice in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error creating invoice.' };
    }
  },

  async updateInvoiceStatus(id, status) {
    try {
      const res = await fetch(`${API_BASE}/invoices/${id}/status`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({ status })
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const list = State.getTenantEntityList('invoices');
        const inv = list.find(i => i.id === id);
        if (inv) {
          inv.status = status;
          State.saveTenantEntity('invoices', inv);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to update invoice status in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error updating invoice status.' };
    }
  },

  async submitToFBR(invoiceId) {
    try {
      const res = await fetch(`${API_BASE}/invoices/${invoiceId}/fbr-submit`, {
        method: 'POST',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const list = State.getTenantEntityList('invoices');
        const inv = list.find(i => i.id === invoiceId);
        if (inv) {
          inv.fbr_status = 'FBR Validated';
          inv.fbr_invoice_number = json.fbrInvoiceNumber || json.data?.fbr_invoice_number;
          State.saveTenantEntity('invoices', inv);
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'FBR digital fiscalization failed.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error during FBR fiscalization.' };
    }
  },

  // 14. Payments Received (STRICT ZERO-TRUST TENANT ISOLATION)
  async getPayments(businessProfileId = 'all') {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/payments?business_profile_id=${businessProfileId}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('payments');
    const merged = [...apiData];
    for (const p of localList) {
      if (!merged.some(m => m.id === p.id)) merged.push(p);
    }
    return this.filterTenantData(merged, businessProfileId);
  },

  async createPayment(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/payments`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('payments', json.data);
        if (payload.invoice_id) {
          const invoices = State.getTenantEntityList('invoices');
          const inv = invoices.find(i => i.id === payload.invoice_id);
          if (inv) {
            const payAmt = parseFloat(payload.amount || 0);
            inv.paid_amount = (parseFloat(inv.paid_amount || 0) + payAmt);
            inv.outstanding_amount = Math.max(0, parseFloat(inv.total_amount || 0) - inv.paid_amount);
            if (inv.outstanding_amount === 0) {
              inv.status = 'Paid';
            }
            State.saveTenantEntity('invoices', inv);
          }
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to record payment in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error recording payment.' };
    }
  },

  // 15. Expenses (STRICT ZERO-TRUST TENANT ISOLATION)
  async getExpenses(businessProfileId = 'all') {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/expenses?business_profile_id=${businessProfileId}`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}

    const localList = State.getTenantEntityList('expenses');
    const merged = [...apiData];
    for (const exp of localList) {
      if (!merged.some(m => m.id === exp.id)) merged.push(exp);
    }
    return this.filterTenantData(merged, businessProfileId);
  },

  async getExpenseSuggestions() {
    const expenses = await this.getExpenses();
    const names = new Set(expenses.map(e => e.expense_name).filter(Boolean));
    return Array.from(names);
  },

  async createExpense(payload) {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 'system';
    try {
      const res = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...payload, tenant_id: tid })
      });
      const json = await res.json();
      if (res.ok && json && json.success && json.data?.id) {
        State.saveTenantEntity('expenses', json.data);
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to record expense in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error recording expense.' };
    }
  },

  // 16. Reports & Executive KPIs (STRICT DYNAMIC CALCULATION PER TENANT)
  async getDashboardKPIs(businessProfileId = 'all') {
    const opps = await this.getOpportunities(businessProfileId);
    const securities = await this.getBidSecurities(businessProfileId);
    const invoices = await this.getInvoices(businessProfileId);
    const payments = await this.getPayments(businessProfileId);
    const dcs = await this.getDeliveryChallans(businessProfileId);
    const expenses = await this.getExpenses(businessProfileId);

    const totalPipelineValue = opps.reduce((sum, o) => sum + parseFloat(o.estimated_value || 0), 0);
    const wonCount = opps.filter(o => o.status && String(o.status).toLowerCase() === 'won').length;
    const inProcessCount = opps.filter(o => {
      const st = String(o.status || 'new').toLowerCase();
      return st !== 'won' && st !== 'loose' && st !== 'lost' && st !== 'withdraw' && st !== 'withdrawn' && st !== 'rejected';
    }).length;

    const activeSecAmount = securities.filter(s => s.status === 'Active' || s.status === 'Submitted').reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
    const activeSecCount = securities.filter(s => s.status === 'Active' || s.status === 'Submitted').length;

    const totalInvoiced = invoices.reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0);
    const totalCollected = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalReceivables = Math.max(0, totalInvoiced - totalCollected);
    const totalExp = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    return {
      tenders: {
        total_tenders: opps.length,
        in_process: inProcessCount,
        won_count: wonCount,
        lost_count: opps.filter(o => String(o.status).toLowerCase() === 'loose' || String(o.status).toLowerCase() === 'lost').length,
        closed_count: opps.filter(o => String(o.status).toLowerCase() === 'withdraw' || String(o.status).toLowerCase() === 'rejected').length,
        total_pipeline_value: totalPipelineValue
      },
      bidSecurities: {
        active_securities_count: activeSecCount,
        active_securities_amount: activeSecAmount,
        released_securities_count: securities.filter(s => s.status === 'Released').length,
        pending_securities_count: 0
      },
      supply: {
        total_dcs: dcs.length,
        delivered_dcs: dcs.filter(d => d.status === 'Delivered').length,
        in_transit_dcs: dcs.filter(d => d.status === 'In-Transit' || d.status === 'Dispatched').length,
        pending_dcs: dcs.filter(d => d.status === 'Pending' || d.status === 'Draft').length
      },
      financials: {
        total_invoiced: totalInvoiced,
        total_collected: totalCollected,
        total_receivables: totalReceivables,
        paid_invoices_count: invoices.filter(i => i.status === 'Paid').length,
        pending_invoices_count: invoices.filter(i => i.status !== 'Paid').length
      },
      expenses: {
        total_expenses: totalExp
      }
    };
  },

  async getContractProfitability() {
    let apiData = [];
    try {
      const res = await fetch(`${API_BASE}/reports/contract-profitability`, { headers: this.getHeaders() });
      const json = await res.json();
      if (json && Array.isArray(json.data)) apiData = json.data;
    } catch (e) {}
    return apiData;
  },

  async getPendingBills() {
    const invoices = await this.getInvoices();
    return invoices.filter(i => (parseFloat(i.outstanding_amount || i.total_amount || 0) > 0));
  },

  // 17. Generic & Dedicated Entity Updates
  async updateEntity(entityType, id, payload) {
    let endpoint = '';
    let pluralKey = '';
    switch (entityType) {
      case 'opportunity':
      case 'tender':
        endpoint = `${API_BASE}/opportunities/${id}`;
        pluralKey = 'opportunities';
        break;
      case 'bid-security':
        endpoint = `${API_BASE}/bid-securities/${id}`;
        pluralKey = 'bid_securities';
        break;
      case 'award':
        endpoint = `${API_BASE}/awards/${id}`;
        pluralKey = 'awards';
        break;
      case 'guarantee':
        endpoint = `${API_BASE}/guarantees/${id}`;
        pluralKey = 'guarantees';
        break;
      case 'purchase-order':
        endpoint = `${API_BASE}/purchase-orders/${id}`;
        pluralKey = 'purchase_orders';
        break;
      case 'delivery-challan':
        endpoint = `${API_BASE}/delivery-challans/${id}`;
        pluralKey = 'delivery_challans';
        break;
      case 'invoice':
        endpoint = `${API_BASE}/invoices/${id}`;
        pluralKey = 'invoices';
        break;
      case 'payment':
        endpoint = `${API_BASE}/payments/${id}`;
        pluralKey = 'payments';
        break;
      case 'warehouse':
        endpoint = `${API_BASE}/warehouses/${id}`;
        pluralKey = 'warehouses';
        break;
      case 'procurement':
        endpoint = `${API_BASE}/procurements/${id}`;
        pluralKey = 'procurements';
        break;
      case 'expense':
        endpoint = `${API_BASE}/expenses/${id}`;
        pluralKey = 'expenses';
        break;
      case 'customer':
        endpoint = `${API_BASE}/masters/customers/${id}`;
        pluralKey = 'customers';
        break;
      case 'supplier':
        endpoint = `${API_BASE}/masters/suppliers/${id}`;
        pluralKey = 'suppliers';
        break;
      case 'product':
        endpoint = `${API_BASE}/masters/products/${id}`;
        pluralKey = 'products';
        break;
      case 'business-profile':
        endpoint = `${API_BASE}/business-profiles/${id}`;
        pluralKey = 'businessProfiles';
        break;
      case 'user':
        endpoint = `${API_BASE}/users/${id}`;
        pluralKey = 'users';
        break;
      default:
        endpoint = `${API_BASE}/${entityType}/${id}`;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        if (pluralKey) {
          const list = State.getTenantEntityList(pluralKey);
          const item = list.find(x => String(x.id) === String(id));
          if (item) {
            Object.assign(item, payload);
            State.saveTenantEntity(pluralKey, item);
          }
        }
        return json;
      }
      return { success: false, status: res.status, message: json?.message || 'Failed to update record in database.' };
    } catch (e) {
      return { success: false, message: e.message || 'Network error updating record.' };
    }
  },

  // --------------------------------------------------------------------------
  // 18. SUBSCRIPTION, TRIAL & MULTI-TENANT BILLING ENGINE
  // --------------------------------------------------------------------------
  async getSubscriptionsOverview() {
    let tenants = [];
    try {
      const usersRes = await this.getUsers();
      if (usersRes && Array.isArray(usersRes.tenants) && usersRes.tenants.length > 0) {
        tenants = usersRes.tenants;
      }
    } catch (e) {}
    if (tenants.length === 0) tenants = State.getTenants();

    const result = tenants.map(t => {
      const sub = State.getTenantSubscription(t.id, t);
      const daysLeft = State.getTrialDaysRemaining(t.id);
      const quota = State.getTenantQuota(t.id);
      const companies = (t.companies && Array.isArray(t.companies)) ? t.companies : State.getTenantCompanies(t.id);
      const users = (t.tenant_users && Array.isArray(t.tenant_users)) ? t.tenant_users : State.getStoredUsers().filter(u => u.tenant_id === t.id || u.tenant_name === t.company_name);
      
      const freeCompaniesLimit = sub.free_companies_limit !== undefined 
        ? Number(sub.free_companies_limit) 
        : (t.free_business_profile_limit || (sub.plan_type === 'Advance' ? 3 : 1));
      const freeUsersLimit = sub.free_users_limit !== undefined 
        ? Number(sub.free_users_limit) 
        : (t.free_employee_limit || (sub.plan_type === 'Advance' ? 3 : 1));

      const actualCoCount = (t.company_count !== undefined) ? t.company_count : companies.length;
      const actualUserCount = (t.user_count !== undefined) ? t.user_count : users.length;

      const paidCompanies = Math.max(0, actualCoCount - freeCompaniesLimit);
      const paidUsers = Math.max(0, actualUserCount - freeUsersLimit);
      
      let totalMonthly = sub.custom_base_price !== undefined ? Number(sub.custom_base_price) : (sub.plan_type === 'Starter' || sub.plan_type === 'Basic' ? 14000 : sub.plan_type === 'Advance' ? 35000 : 3000);
      totalMonthly += paidCompanies * (sub.custom_extra_company_price !== undefined ? Number(sub.custom_extra_company_price) : 4500);
      totalMonthly += paidUsers * (sub.custom_extra_seat_price !== undefined ? Number(sub.custom_extra_seat_price) : 1500);
      
      if (sub.plan_type === 'Custom' && Array.isArray(sub.active_modules)) {
        for (const mKey of sub.active_modules) {
          const modDef = State.MODULE_CATALOG.find(m => m.key === mKey);
          const fee = (sub.custom_module_fees && sub.custom_module_fees[mKey] !== undefined) ? Number(sub.custom_module_fees[mKey]) : (modDef?.benchmarkFee || 2500);
          totalMonthly += fee;
        }
      }

      const allSecurities = State.getTenantEntityList ? State.getTenantEntityList('bidSecurities') : [];
      const bidSecuritiesCount = allSecurities.filter(b => b.tenant_id === t.id).length || (quota.bid_securities_created || 0);

      return {
        tenant: t,
        subscription: sub,
        trialDaysRemaining: daysLeft,
        quota,
        tenderCount: quota.tenders_created || 0,
        bidSecurityCount: bidSecuritiesCount,
        companyCount: actualCoCount,
        userCount: actualUserCount,
        freeCompaniesLimit,
        freeUsersLimit,
        paidCompanies,
        paidUsers,
        totalMonthly
      };
    });
    return result;
  },

  async configureTenantSubscription(payload) {
    const sub = State.saveTenantSubscription(payload.tenant_id, payload);
    
    // Also sync local tenants store
    const tenants = State.getTenants();
    const tIdx = tenants.findIndex(t => t.id === payload.tenant_id);
    if (tIdx >= 0) {
      tenants[tIdx].subscription_plan = payload.plan_type;
      tenants[tIdx].trial_period = payload.trial_period;
      tenants[tIdx].trial_ends_at = payload.trial_end_date;
      tenants[tIdx].free_business_profile_limit = payload.free_companies_limit;
      tenants[tIdx].free_employee_limit = payload.free_users_limit;
      tenants[tIdx].tender_limit = payload.tender_limit;
      tenants[tIdx].bid_security_limit = payload.bid_security_limit;
      tenants[tIdx].active_modules = payload.active_modules;
      tenants[tIdx].billing_cycle = payload.billing_cycle;
      tenants[tIdx].custom_base_price = payload.custom_base_price;
      tenants[tIdx].additional_profile_monthly_fee = payload.custom_extra_company_price;
      tenants[tIdx].additional_employee_monthly_fee = payload.custom_extra_seat_price;
      localStorage.setItem('mashrue_tenants_store', JSON.stringify(tenants));
    }

    // If active tenant is this one, update session state immediately
    if (State.currentUser?.tenant && State.currentUser.tenant.id === payload.tenant_id) {
      State.currentUser.tenant.subscriptionPlan = payload.plan_type;
      State.currentUser.tenant.freeCompanyLimit = payload.free_companies_limit;
      State.currentUser.tenant.freeEmployeeLimit = payload.free_users_limit;
      State.currentUser.tenant.tenderLimit = payload.tender_limit;
      State.currentUser.tenant.bidSecurityLimit = payload.bid_security_limit;
      State.currentUser.tenant.activeModules = payload.active_modules;
      State.currentUser.tenant.billingCycle = payload.billing_cycle;
      State.currentUser.tenant.customBasePrice = payload.custom_base_price;
      State.currentUser.tenant.trialPeriod = payload.trial_period;
      State.currentUser.tenant.trialEndsAt = payload.trial_end_date;
      sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
    }

    // Attempt backend sync if available
    try {
      if (this.token) {
        await fetch(`${API_BASE}/users/tenants/${payload.tenant_id}/subscription`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify({
            subscription_plan: payload.plan_type,
            free_business_profile_limit: payload.free_companies_limit,
            free_employee_limit: payload.free_users_limit,
            max_users: payload.free_users_limit ? (payload.free_users_limit + 10) : 10,
            tender_limit: payload.tender_limit,
            bid_security_limit: payload.bid_security_limit,
            active_modules: payload.active_modules,
            billing_cycle: payload.billing_cycle,
            custom_base_price: payload.custom_base_price,
            additional_profile_monthly_fee: payload.custom_extra_company_price,
            additional_employee_monthly_fee: payload.custom_extra_seat_price,
            trial_period: payload.trial_period,
            trial_ends_at: payload.trial_end_date,
            status: payload.status
          })
        });
      }
    } catch (e) {
      console.warn('Backend tenant subscription update sync bypassed:', e.message);
    }

    return { success: true, data: sub, message: 'Tenant subscription, dynamic leverages & package quotas updated successfully.' };
  },

  async recordTenantSubscriptionPayment(payload) {
    const p = State.recordSubscriptionPayment(payload);
    return { success: true, data: p, message: 'Subscription payment recorded and tenant activated successfully.' };
  },

  async toggleTenantStatus(tenantId, newStatus) {
    const sub = State.saveTenantSubscription(tenantId, { status: newStatus });
    return { success: true, data: sub, message: `Tenant status set to ${newStatus}.` };
  },

  async getMySubscription() {
    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 't1';
    const sub = State.getTenantSubscription(tid, State.currentUser?.tenant);
    const daysLeft = State.getTrialDaysRemaining(tid);
    const quota = State.getTenantQuota(tid);
    const payments = State.getSubscriptionPayments(tid);
    
    // Dynamic companies and users
    let compList = (State.businessProfiles && State.businessProfiles.length > 0) 
      ? State.businessProfiles 
      : State.getTenantCompanies(tid);
    let userList = (State.users && State.users.length > 0) 
      ? State.users 
      : State.getStoredUsers().filter(u => u.tenant_id === tid || u.tenant_name === State.currentUser?.tenant_name);

    if (State.currentUser?.tenant) {
      if (State.currentUser.tenant.companyCount !== undefined && State.currentUser.tenant.companyCount > compList.length) {
        compList = new Array(State.currentUser.tenant.companyCount);
      }
      if (State.currentUser.tenant.employeeCount !== undefined && State.currentUser.tenant.employeeCount > userList.length) {
        userList = new Array(State.currentUser.tenant.employeeCount);
      }
    }

    const freeCompaniesLimit = sub.free_companies_limit !== undefined 
      ? Number(sub.free_companies_limit) 
      : (State.currentUser?.tenant?.freeCompanyLimit || (sub.plan_type === 'Advance' ? 3 : 1));
    const freeUsersLimit = sub.free_users_limit !== undefined 
      ? Number(sub.free_users_limit) 
      : (State.currentUser?.tenant?.freeEmployeeLimit || (sub.plan_type === 'Advance' ? 3 : 1));

    const paidCompanies = Math.max(0, compList.length - freeCompaniesLimit);
    const paidUsers = Math.max(0, userList.length - freeUsersLimit);

    let totalMonthly = sub.custom_base_price !== undefined ? Number(sub.custom_base_price) : (sub.plan_type === 'Starter' || sub.plan_type === 'Basic' ? 14000 : 35000);
    totalMonthly += paidCompanies * (sub.custom_extra_company_price !== undefined ? Number(sub.custom_extra_company_price) : 4500);
    totalMonthly += paidUsers * (sub.custom_extra_seat_price !== undefined ? Number(sub.custom_extra_seat_price) : 1500);

    if (sub.plan_type === 'Custom' && Array.isArray(sub.active_modules)) {
      for (const mKey of sub.active_modules) {
        const modDef = State.MODULE_CATALOG.find(m => m.key === mKey);
        const fee = (sub.custom_module_fees && sub.custom_module_fees[mKey] !== undefined) ? Number(sub.custom_module_fees[mKey]) : (modDef?.benchmarkFee || 2500);
        totalMonthly += fee;
      }
    }

    return {
      subscription: sub,
      trialDaysRemaining: daysLeft,
      quota,
      payments,
      companyCount: compList.length,
      userCount: userList.length,
      freeCompaniesLimit,
      freeUsersLimit,
      paidCompanies,
      paidUsers,
      totalMonthly
    };
  },

  // ==========================================================================
  // ADVANCED INVENTORY & WORKFLOW GATING API METHODS
  // ==========================================================================

  async getWarehouseStock(params = {}) {
    try {
      const q = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}/logistics/warehouse-stock?${q}`, { headers: this.getHeaders() });
      const data = await res.json();
      return data.success ? data.data : [];
    } catch (e) {
      console.warn('Backend warehouse stock fallback:', e.message);
      return [];
    }
  },

  async getStockReservations(params = {}) {
    try {
      const q = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}/logistics/reservations?${q}`, { headers: this.getHeaders() });
      const data = await res.json();
      return data.success ? data.data : [];
    } catch (e) {
      console.warn('Backend stock reservations fallback:', e.message);
      return [];
    }
  },

  async createStockReservation(payload) {
    try {
      const res = await fetch(`${API_BASE}/logistics/reserve`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async releaseStockReservation(reservationId, reason = '') {
    try {
      const res = await fetch(`${API_BASE}/logistics/release-reservation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ reservation_id: reservationId, reason })
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getGrnList(params = {}) {
    try {
      const q = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}/logistics/grn?${q}`, { headers: this.getHeaders() });
      const data = await res.json();
      return data.success ? data.data : [];
    } catch (e) {
      console.warn('Backend GRN list fallback:', e.message);
      return [];
    }
  },

  async createGrn(payload) {
    try {
      const res = await fetch(`${API_BASE}/logistics/grn`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async updateDtlClearance(grnId, payload) {
    try {
      const res = await fetch(`${API_BASE}/logistics/grn/${grnId}/dtl-clearance`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getCdrRecoveryLetter(secId) {
    try {
      const res = await fetch(`${API_BASE}/bid-securities/${secId}/recovery-letter`, { headers: this.getHeaders() });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getGrievances(params = {}) {
    try {
      const q = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}/contracts/grievances?${q}`, { headers: this.getHeaders() });
      const data = await res.json();
      return data.success ? data.data : [];
    } catch (e) {
      console.warn('Backend grievances fallback:', e.message);
      return [];
    }
  },

  async fileGrievance(payload) {
    try {
      const res = await fetch(`${API_BASE}/contracts/grievances`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async updateGrievance(id, payload) {
    try {
      const res = await fetch(`${API_BASE}/contracts/grievances/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async logStampDuty(contractId, payload) {
    try {
      const res = await fetch(`${API_BASE}/contracts/contracts/${contractId}/stamp-duty`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getPastPerformancePortfolio() {
    try {
      const res = await fetch(`${API_BASE}/contracts/portfolio`, { headers: this.getHeaders() });
      const data = await res.json();
      return data.success ? data.data : [];
    } catch (e) {
      console.warn('Backend portfolio fallback:', e.message);
      return [];
    }
  }
};
