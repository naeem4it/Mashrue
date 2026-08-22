/**
 * Mashrue (mashrue.com) - Enterprise Business Management System
 * Comprehensive Controller, Authentication, RBAC & Dynamic View Renderer
 */

let pendingPaidCompanyPayload = null;
let pendingPaidEmployeePayload = null;

// Enterprise Non-blocking Toast Notification Engine
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.innerHTML = `
    <span style="font-size: 1.1rem; font-weight: 800;">${icons[type] || 'ℹ️'}</span>
    <span style="flex: 1; line-height: 1.4;">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
});

async function initApp() {
  const loginView = document.getElementById('login-view');
  const appContainer = document.getElementById('app-container');

  // Check Authentication Status
  if (!State.isLoggedIn()) {
    if (loginView) loginView.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    return;
  }

  // User is logged in - show application container
  if (loginView) loginView.style.display = 'none';
  if (appContainer) appContainer.style.display = 'flex';

  // 1. Refresh User Profile from API
  try {
    const meRes = await API.getMe();
    if (meRes && meRes.success && meRes.data) {
      State.currentUser = { ...State.currentUser, ...meRes.data };
      localStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
    }
  } catch (e) {
    console.warn('Profile refresh fallback:', e.message);
  }

  // 2. First-Time Mandatory Password Change Interceptor
  if (State.currentUser && State.currentUser.mustChangePassword) {
    openModal('modal-force-password');
  }

  // 3. Fetch Business Profiles for active user/tenant
  State.businessProfiles = await API.getBusinessProfiles();
  populateBusinessSwitcher();
  updateHeaderUserProfile();
  renderDynamicSidebarNavigation();

  // 4. Client Admin Onboarding Interceptor (If 0 companies configured and not changing password)
  if (State.isClientAdmin() && (!State.businessProfiles || State.businessProfiles.length === 0) && !State.currentUser.mustChangePassword) {
    openModal('modal-onboard-company');
  }

  // 5. Render Current Active View
  await renderActiveView();

  // 6. Listen for Business Profile change events
  window.addEventListener('businessProfileChanged', () => {
    renderActiveView();
  });
}

// --------------------------------------------------------------------------
// AUTHENTICATION & LOGIN HANDLERS
// --------------------------------------------------------------------------

async function handleUserLogin() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error-msg');
  const submitBtn = document.getElementById('login-submit-btn');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!username || !password) {
    if (errorBox) {
      errorBox.innerText = 'Please enter your username/email and password.';
      errorBox.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Signing In...</span>';
  }
  if (errorBox) errorBox.style.display = 'none';

  try {
    const res = await API.login(username, password);

    if (res && res.success && res.data) {
      State.setSession(res.data.token, res.data.user);
      if (usernameInput) usernameInput.value = '';
      if (passwordInput) passwordInput.value = '';
      await initApp();
    } else {
      if (errorBox) {
        errorBox.innerText = res.message || 'Invalid username or password.';
        errorBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorBox) {
      errorBox.innerText = 'Unable to connect to server. Please check your connection.';
      errorBox.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀 Sign In</span>';
    }
  }
}

function fillLoginCredentials(username, password) {
  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');
  if (u) u.value = username;
  if (p) p.value = password;
  const err = document.getElementById('login-error-msg');
  if (err) err.style.display = 'none';
}

function handleUserLogout() {
  State.clearSession();
  const loginView = document.getElementById('login-view');
  const appContainer = document.getElementById('app-container');
  if (loginView) loginView.style.display = 'flex';
  if (appContainer) appContainer.style.display = 'none';
  window.location.reload();
}

async function handleFirstPasswordChange() {
  const newPass = document.getElementById('force-new-password').value;
  const confPass = document.getElementById('force-confirm-password').value;
  const errBox = document.getElementById('force-password-error-msg');

  if (newPass !== confPass) {
    if (errBox) {
      errBox.innerText = 'Passwords do not match. Please verify.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (newPass.length < 6) {
    if (errBox) {
      errBox.innerText = 'Password must be at least 6 characters long.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await API.changePassword(newPass);
    if (res && res.success) {
      closeModal('modal-force-password');
      State.currentUser.mustChangePassword = false;
      localStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));

      // After password change, if Client Admin has no companies, guide to 1st company creation
      if (State.isClientAdmin() && (!State.businessProfiles || State.businessProfiles.length === 0)) {
        openModal('modal-onboard-company');
      } else {
        alert('✅ Password changed successfully. Welcome to Mashrue BMS!');
        renderActiveView();
      }
    } else {
      if (errBox) {
        errBox.innerText = res.message || 'Failed to update password.';
        errBox.style.display = 'block';
      }
    }
  } catch (e) {
    if (errBox) {
      errBox.innerText = e.message;
      errBox.style.display = 'block';
    }
  }
}

function updateHeaderUserProfile() {
  const u = State.currentUser;
  if (!u) return;

  const headerName = document.getElementById('header-user-name');
  const headerRole = document.getElementById('header-user-role');
  const headerAvatar = document.getElementById('header-user-avatar');
  const sidebarName = document.getElementById('sidebar-user-name');
  const sidebarRole = document.getElementById('sidebar-user-role');
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');

  const dropdownName = document.getElementById('dropdown-user-fullname');
  const dropdownEmail = document.getElementById('dropdown-user-email');
  const dropdownRole = document.getElementById('dropdown-user-role');

  if (u.username === 'naeem4it' || u.email === 'naeem@mashrue.com') {
    u.role = 'SuperAdmin';
    u.tenant = null;
  }

  const initials = (u.fullName || u.username || 'User')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'MN';

  let displayRole = 'Client Employee';
  if (u.role === 'SuperAdmin') displayRole = 'Super Admin (System Owner)';
  else if (u.role === 'LimitedSuperAdmin') displayRole = 'Super Admin (Limited)';
  else if (u.role === 'ClientAdmin' || u.role === 'CompanyAdmin') displayRole = `Tenant Admin (${u.tenant?.name || 'Primary'})`;

  if (headerName) headerName.innerText = u.fullName || u.username;
  if (headerRole) headerRole.innerText = displayRole;
  if (headerAvatar) headerAvatar.innerText = initials;

  if (dropdownName) dropdownName.innerText = u.fullName || u.username;
  if (dropdownEmail) dropdownEmail.innerText = u.email || `${u.username}@company.pk`;
  if (dropdownRole) dropdownRole.innerText = displayRole;

  if (sidebarName) sidebarName.innerText = u.fullName || u.username;
  if (sidebarRole) sidebarRole.innerText = displayRole;
  if (sidebarAvatar) sidebarAvatar.innerText = initials;

  // Render role-gated items in user dropdown menu
  renderUserDropdownMenu();

  // Insert/Update Trial & Subscription Status Pill in Header
  const headerActions = document.querySelector('.header-actions');
  const existingPill = document.getElementById('header-sub-status-pill');
  if (State.isSuperAdmin()) {
    if (existingPill) existingPill.remove();
  } else if (headerActions) {
    let subStatusPill = existingPill;
    if (!subStatusPill) {
      subStatusPill = document.createElement('div');
      subStatusPill.id = 'header-sub-status-pill';
      subStatusPill.style.display = 'flex';
      subStatusPill.style.alignItems = 'center';
      headerActions.insertBefore(subStatusPill, headerActions.firstChild);
    }

    const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
    const sub = State.getTenantSubscription(tid);
    const daysLeft = State.getTrialDaysRemaining(tid);

    if (sub.status === 'Suspended') {
      subStatusPill.innerHTML = `
        <span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-weight:700; padding:6px 12px; cursor:pointer;" onclick="switchView('my-subscription')">
          ⛔ Subscription Suspended
        </span>
      `;
    } else if (sub.is_trial && sub.status === 'Trial') {
      subStatusPill.innerHTML = `
        <span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-weight:700; padding:6px 12px; cursor:pointer;" onclick="switchView('my-subscription')">
          ⏳ ${sub.plan_type} Trial: <strong>${daysLeft} Days Left</strong>
        </span>
      `;
    } else {
      subStatusPill.innerHTML = `
        <span class="badge badge-won" style="padding:6px 12px; cursor:pointer;" onclick="switchView('my-subscription')">
          ✓ ${sub.plan_type} Plan (Active)
        </span>
      `;
    }
  }
}

// --------------------------------------------------------------------------
// USER ACCOUNT DROPDOWN & MODALS (ROLE-BASED VISIBILITY)
// --------------------------------------------------------------------------

function toggleUserDropdown(event) {
  if (event) event.stopPropagation();
  const container = document.getElementById('user-dropdown-container');
  if (container) {
    container.classList.toggle('open');
  }
}

function closeUserDropdown() {
  const container = document.getElementById('user-dropdown-container');
  if (container) {
    container.classList.remove('open');
  }
}

// Global click listener to auto-close user dropdown on outside click
document.addEventListener('click', (e) => {
  const container = document.getElementById('user-dropdown-container');
  if (container && !container.contains(e.target)) {
    closeUserDropdown();
  }
});

function renderUserDropdownMenu() {
  const listEl = document.getElementById('user-dropdown-list');
  if (!listEl) return;

  const isSuper = State.isSuperAdmin();
  const isClientAdmin = State.isClientAdmin();
  const canAccessFBR = isSuper || isClientAdmin || State.hasPermission('settings', 'view');

  let itemsHTML = '';

  // 1. User Profile (Visible to ALL roles)
  itemsHTML += `
    <li>
      <a class="user-dropdown-item" onclick="closeUserDropdown(); openUserProfileModal();">
        <span class="item-icon">👤</span>
        <span>User Profile</span>
      </a>
    </li>
  `;

  // 2. Change Password (Visible to ALL roles)
  itemsHTML += `
    <li>
      <a class="user-dropdown-item" onclick="closeUserDropdown(); openChangePasswordModal();">
        <span class="item-icon">🔑</span>
        <span>Change Password</span>
      </a>
    </li>
  `;

  // 3. My Plan & Subscription (Visible ONLY for ClientAdmin / Tenant Admin, or SuperAdmin hub)
  if (isClientAdmin) {
    itemsHTML += `
      <li>
        <a class="user-dropdown-item" onclick="closeUserDropdown(); switchView('my-subscription');">
          <span class="item-icon">💳</span>
          <span>My Plan & Subscription</span>
        </a>
      </li>
    `;
  } else if (isSuper) {
    itemsHTML += `
      <li>
        <a class="user-dropdown-item" onclick="closeUserDropdown(); switchView('subscriptions');">
          <span class="item-icon">👑</span>
          <span>Subscriptions Hub</span>
        </a>
      </li>
    `;
  }

  // 4. FBR Settings (Visible to ClientAdmin / Admin with settings permission)
  if (canAccessFBR) {
    itemsHTML += `
      <li>
        <a class="user-dropdown-item" onclick="closeUserDropdown(); switchView('settings');">
          <span class="item-icon">⚙️</span>
          <span>FBR Settings & Gateway</span>
        </a>
      </li>
    `;
  }

  // Divider + Logout Action
  itemsHTML += `
    <div class="user-dropdown-divider"></div>
    <li>
      <a class="user-dropdown-item danger-item" onclick="closeUserDropdown(); handleUserLogout();">
        <span class="item-icon">🚪</span>
        <span>Sign Out / Logout</span>
      </a>
    </li>
  `;

  listEl.innerHTML = itemsHTML;
}

function openUserProfileModal() {
  const u = State.currentUser;
  if (!u) return;

  const initials = (u.fullName || u.username || 'User')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'MN';

  let displayRole = 'Client Employee';
  if (u.role === 'SuperAdmin') displayRole = 'Super Admin (System Owner)';
  else if (u.role === 'LimitedSuperAdmin') displayRole = 'Super Admin (Limited)';
  else if (u.role === 'ClientAdmin' || u.role === 'CompanyAdmin') displayRole = 'Client Admin (Tenant Administrator)';

  const avatarEl = document.getElementById('modal-profile-avatar');
  const nameEl = document.getElementById('modal-profile-fullname');
  const emailEl = document.getElementById('modal-profile-email');
  const roleBadgeEl = document.getElementById('modal-profile-role-badge');
  const usernameEl = document.getElementById('modal-profile-username');
  const tenantEl = document.getElementById('modal-profile-tenant');
  const statusEl = document.getElementById('modal-profile-status');
  const priceAccessEl = document.getElementById('modal-profile-price-access');
  const permissionsSummaryEl = document.getElementById('modal-profile-permissions-summary');

  if (avatarEl) avatarEl.innerText = initials;
  if (nameEl) nameEl.innerText = u.fullName || u.username;
  if (emailEl) emailEl.innerText = u.email || `${u.username}@company.pk`;
  if (roleBadgeEl) roleBadgeEl.innerText = displayRole;
  if (usernameEl) usernameEl.innerText = u.username;
  if (tenantEl) tenantEl.innerText = u.tenant?.name || u.tenant_name || 'Mashrue Enterprise';
  if (statusEl) statusEl.innerText = u.status || 'Active';

  const canSeePrices = State.canSeeBiddingPrices();
  if (priceAccessEl) {
    priceAccessEl.innerHTML = canSeePrices 
      ? '<span style="color:#059669; font-weight:700;">🔓 Unmasked (Cost Price & Profit Margins Visible)</span>'
      : '<span style="color:#dc2626; font-weight:700;">🔒 Masked (Restricted to Commercial Admin)</span>';
  }

  if (permissionsSummaryEl) {
    if (u.role === 'SuperAdmin' || u.role === 'ClientAdmin' || u.role === 'CompanyAdmin') {
      permissionsSummaryEl.innerHTML = `
        <strong>Full Administrative Privileges:</strong> Complete read, write, financial approvals, FBR fiscalization, and tenant configuration access.
      `;
    } else {
      const perms = u.permissions || {};
      const activeModules = Object.keys(perms).filter(k => perms[k]?.view);
      permissionsSummaryEl.innerHTML = `
        <strong>Assigned Operational Modules:</strong> ${activeModules.length > 0 ? activeModules.join(', ') : 'Standard Workflow Access'}<br>
        <span style="font-size:0.75rem; color:#64748b;">(Managed and configured by your Organization Administrator)</span>
      `;
    }
  }

  openModal('modal-user-profile');
}

function openChangePasswordModal() {
  const newPassEl = document.getElementById('user-new-password');
  const confPassEl = document.getElementById('user-confirm-password');
  const errBox = document.getElementById('user-change-password-error-msg');

  if (newPassEl) newPassEl.value = '';
  if (confPassEl) confPassEl.value = '';
  if (errBox) {
    errBox.innerText = '';
    errBox.style.display = 'none';
  }

  openModal('modal-change-password');
}

async function submitUserChangePasswordForm() {
  const newPass = document.getElementById('user-new-password')?.value;
  const confPass = document.getElementById('user-confirm-password')?.value;
  const errBox = document.getElementById('user-change-password-error-msg');

  if (!newPass || newPass.length < 6) {
    if (errBox) {
      errBox.innerText = 'New password must be at least 6 characters long.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (newPass !== confPass) {
    if (errBox) {
      errBox.innerText = 'Password confirmation does not match. Please verify.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await API.changePassword(newPass);
    if (res && res.success) {
      closeModal('modal-change-password');
      alert('✅ Password updated successfully! Your new password is now active.');
    } else {
      if (errBox) {
        errBox.innerText = res.message || 'Failed to update password.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = `Error: ${err.message}`;
      errBox.style.display = 'block';
    }
  }
}

function renderDynamicSidebarNavigation() {
  const container = document.getElementById('dynamic-sidebar-container');
  if (!container) return;

  const isSuper = State.isSuperAdmin();
  const isAdmin = State.isClientAdmin();

  // Navigation schema with permissions & modular subscription keys
  const coreLinks = [
    { view: 'dashboard', icon: '📊', label: 'Dashboard & KPIs', perm: 'dashboard', always: true },
    { view: 'opportunities', icon: '📑', label: 'Tenders & Quotations', perm: 'opportunities', moduleKey: 'mod_tenders', badge: '3' },
    { view: 'bid-securities', icon: '🛡️', label: 'Bid Security Registry', perm: 'bid-securities', moduleKey: 'mod_bid_security', badge: '2', badgeBg: '#4338ca' },
    { view: 'costing', icon: '💰', label: 'Costing & Margin', perm: 'costing', moduleKey: 'mod_costing_eval' },
    { view: 'approvals', icon: '⚖️', label: 'Bid Approvals', perm: 'approvals', moduleKey: 'mod_costing_eval' },
    { view: 'awards', icon: '🏆', label: 'Awards & Guarantees', perm: 'awards', moduleKey: 'mod_tenders' },
    { view: 'purchase-orders', icon: '📦', label: 'Purchase Orders (PO)', perm: 'purchase-orders', moduleKey: 'mod_supply_dc' },
    { view: 'delivery-challans', icon: '🚚', label: 'Supply & Challan (DC)', perm: 'delivery-challans', moduleKey: 'mod_supply_dc' },
    { view: 'invoices', icon: '🧾', label: 'Invoices & FBR PRAL', perm: 'invoices', moduleKey: 'mod_fbr_invoicing', badge: 'PRAL', badgeBg: '#10b981' },
    { view: 'payments', icon: '💵', label: 'Payments Received', perm: 'payments', moduleKey: 'mod_finance_kpi' }
  ];

  const supplyLinks = [
    { view: 'inventory', icon: '🏬', label: 'Warehouse & Stock', perm: 'inventory', moduleKey: 'mod_inventory' },
    { view: 'expenses', icon: '💳', label: 'Expenses & Overheads', perm: 'expenses', moduleKey: 'mod_finance_kpi' },
    { view: 'reports', icon: '📈', label: 'Executive Reports', perm: 'reports', moduleKey: 'mod_finance_kpi' }
  ];

  const adminLinks = [
    { view: 'customers', icon: '👥', label: 'Customer Directory', perm: 'customers' },
    { view: 'suppliers', icon: '🏭', label: 'Supplier Directory', perm: 'suppliers' },
    { view: 'products', icon: '📦', label: 'Item & SKU Catalog', perm: 'products', moduleKey: 'mod_inventory' },
    { view: 'business-profiles', icon: '🏢', label: 'Companies & Profiles', adminOnly: true, badge: '2 Free', badgeBg: '#f59e0b' },
    { view: 'users', icon: '👤', label: isSuper ? 'Tenants & Users' : 'Users & RBAC', adminOnly: true },
    { view: 'subscriptions', icon: '👑', label: 'Subscriptions & Billing', isSuperOnly: true, badge: 'Hub', badgeBg: '#1e40af' },
    { view: 'my-subscription', icon: '💳', label: 'My Plan & Billing', isClientAdminOnly: true },
    { view: 'settings', icon: '⚙️', label: 'Settings & FBR', adminOnly: true, moduleKey: 'mod_fbr_invoicing' }
  ];

  const filterLinks = (list) => {
    return list.filter(item => {
      if (item.isSuperOnly && !isSuper) return false;
      if (item.isClientAdminOnly && (isSuper || !isAdmin)) return false;
      if (item.always) return true;
      if (item.moduleKey && !State.isModuleActiveForTenant(item.moduleKey)) return false;
      if (isSuper || isAdmin) return true;
      if (item.adminOnly) return false;
      return State.hasPermission(item.perm, 'view');
    });
  };

  const visibleCore = filterLinks(coreLinks);
  const visibleSupply = filterLinks(supplyLinks);
  const visibleAdmin = filterLinks(adminLinks);

  const renderNavSection = (label, items) => {
    if (items.length === 0) return '';
    return `
      <div class="nav-section-label" style="padding-top: 8px;">${label}</div>
      <nav class="sidebar-nav">
        ${items.map(item => `
          <a class="nav-item ${State.activeView === item.view ? 'active' : ''}" data-view="${item.view}" onclick="switchView('${item.view}')">
            <span class="icon">${item.icon}</span>
            <span>${item.label}</span>
            ${item.badge ? `<span class="badge-count" style="${item.badgeBg ? 'background:' + item.badgeBg + '; color:#fff;' : ''}">${item.badge}</span>` : ''}
          </a>
        `).join('')}
      </nav>
    `;
  };

  container.innerHTML = `
    ${renderNavSection('Core Business Workflow', visibleCore)}
    ${renderNavSection('Supply Chain & Financials', visibleSupply)}
    ${renderNavSection(isSuper ? 'Global System Administration' : 'Registries & Administration', visibleAdmin)}
  `;
}

function switchView(viewName) {
  State.activeView = viewName;
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.dataset.view === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  renderActiveView();
}

function populateBusinessSwitcher() {
  const switcher = document.getElementById('business-select');
  if (!switcher) return;

  if (!State.businessProfiles || State.businessProfiles.length === 0) {
    switcher.innerHTML = `<option value="none">🏢 (No Company Profile Configured)</option>`;
    return;
  }

  switcher.innerHTML = `
    <option value="all">🏢 All Business Entities (Consolidated)</option>
    ${State.businessProfiles.map(p => `
      <option value="${p.id}" ${State.currentBusinessProfileId === p.id ? 'selected' : ''}>${p.business_name} (${p.ntn || 'NTN Pending'})</option>
    `).join('')}
  `;
}

// --------------------------------------------------------------------------
// MAIN DYNAMIC VIEW ROUTER
// --------------------------------------------------------------------------
async function renderActiveView() {
  const contentArea = document.getElementById('main-content');
  const viewTitle = document.getElementById('view-title');
  const viewSubtitle = document.getElementById('view-subtitle');

  if (!contentArea) return;

  const currentProfile = State.getCurrentBusinessProfile();
  const isAdmin = State.currentUser.role === 'CompanyAdmin';

  switch (State.activeView) {
    case 'dashboard':
      viewTitle.innerText = 'Executive KPI Dashboard';
      viewSubtitle.innerText = `Full lifecycle metrics for ${currentProfile.business_name} (Amounts in PKR)`;
      contentArea.innerHTML = await renderDashboardHTML();
      break;

    case 'opportunities':
      viewTitle.innerText = 'Tenders & Direct Quotations Pipeline';
      viewSubtitle.innerText = `PPRA, DGP, RFQ, LPQ & Direct Sales Opportunities | Pricing View: ${isAdmin ? '🔓 Admin Unlocked' : '🔒 Masked'}`;
      contentArea.innerHTML = await renderOpportunitiesHTML();
      break;

    case 'bid-securities':
      viewTitle.innerText = 'Mandatory Bid Security Registry';
      viewSubtitle.innerText = 'Track Earnest Money Instruments (PO, CDR, Bank Guarantees) & Release Workflows';
      contentArea.innerHTML = await renderBidSecuritiesHTML();
      break;

    case 'costing':
      viewTitle.innerText = 'Interactive Bid Costing & Estimation Engine';
      viewSubtitle.innerText = 'Live itemized pricing, direct costs, markup %, and margin calculation';
      contentArea.innerHTML = renderCostingCalculatorHTML();
      setupCostingCalculator();
      break;

    case 'approvals':
      viewTitle.innerText = 'Bid Governance & Approvals';
      viewSubtitle.innerText = 'Multi-tier review workflow (Bid Manager Review & Management Sign-Off)';
      contentArea.innerHTML = await renderApprovalsHTML();
      break;

    case 'awards':
      viewTitle.innerText = 'Award Letters & Performance Guarantees';
      viewSubtitle.innerText = 'Post-Win LOA acceptance and Performance Bond release management';
      contentArea.innerHTML = await renderAwardsHTML();
      break;

    case 'purchase-orders':
      viewTitle.innerText = 'Purchase Orders (PO) Management';
      viewSubtitle.innerText = 'Customer POs, Delivery Deadlines, and Authorization for Delivery Challans';
      contentArea.innerHTML = await renderPurchaseOrdersHTML();
      break;

    case 'delivery-challans':
      viewTitle.innerText = 'Supply & Delivery Challans (DC)';
      viewSubtitle.innerText = 'PO-backed dispatches, warehouse stock deduction, and 3PL / Hired logistics tracking';
      contentArea.innerHTML = await renderDeliveryChallansHTML();
      break;

    case 'invoices':
      viewTitle.innerText = 'Invoicing & Pakistan FBR Fiscalization Hub';
      viewSubtitle.innerText = 'Post-DC Invoicing (Submitted, Reinvoicing, Pending, Hold, Paid) & PRAL Integration';
      contentArea.innerHTML = await renderInvoicesHTML();
      break;

    case 'payments':
      viewTitle.innerText = 'Payments Received & Cheque Drawer';
      viewSubtitle.innerText = 'Record Cheques, Bank Transfers, and reconcile Outstanding Invoice Balances';
      contentArea.innerHTML = await renderPaymentsHTML();
      break;

    case 'inventory':
      viewTitle.innerText = 'Warehouse Stock & Inventory Control';
      viewSubtitle.innerText = 'Live multi-warehouse stock levels, Stock In/Out logs, and Local/Import procurement';
      contentArea.innerHTML = await renderInventoryHTML();
      break;

    case 'expenses':
      viewTitle.innerText = 'Company Expense & Overhead Ledger';
      viewSubtitle.innerText = '13 standard expense categories linked to Tenders, Contracts, or Departments';
      contentArea.innerHTML = await renderExpensesHTML();
      break;

    case 'reports':
      viewTitle.innerText = 'Management Reporting & Analytics';
      viewSubtitle.innerText = 'Contract-wise Profitability and Pending Bills Aging analysis';
      contentArea.innerHTML = await renderReportsHTML();
      break;

    case 'customers':
      viewTitle.innerText = 'Customer & Client Directory';
      viewSubtitle.innerText = 'Government, Semi-Government, Autonomous, MNC & Private client accounts';
      contentArea.innerHTML = await renderCustomersHTML();
      break;

    case 'suppliers':
      viewTitle.innerText = 'Supplier & Vendor Registry';
      viewSubtitle.innerText = 'Local and International suppliers, ratings, and contact information';
      contentArea.innerHTML = await renderSuppliersHTML();
      break;

    case 'products':
      viewTitle.innerText = 'Product & Item SKU Catalog';
      viewSubtitle.innerText = 'Master item list with stock balances and auto-population for Tenders';
      contentArea.innerHTML = await renderProductsHTML();
      break;

    case 'business-profiles':
      viewTitle.innerText = 'Companies & Business Profiles';
      viewSubtitle.innerText = 'Multi-Company Tenant Configuration (Up to 2 Companies Free)';
      contentArea.innerHTML = await renderBusinessProfilesHTML();
      break;

    case 'users':
      viewTitle.innerText = 'User Management & Role-Based Access Control';
      viewSubtitle.innerText = 'SuperAdmin, CompanyAdmin, BidManager, Procurement, Warehouse & Finance Roles';
      contentArea.innerHTML = await renderUsersHTML();
      break;

    case 'subscriptions':
      viewTitle.innerText = '👑 Platform Subscriptions & Billing Hub';
      viewSubtitle.innerText = 'Manage tenant tiers, flexible free trials (15d–3mo), custom price overrides, and payment verification';
      contentArea.innerHTML = await renderSuperAdminSubscriptionsHTML();
      break;

    case 'my-subscription':
      viewTitle.innerText = '💳 Organization Subscription & Plan';
      viewSubtitle.innerText = 'Current tier details, trial timer, quota progress meters, and agreed custom pricing breakdown';
      contentArea.innerHTML = await renderMySubscriptionHTML();
      break;

    case 'settings':
      viewTitle.innerText = 'System Settings & FBR Configuration';
      viewSubtitle.innerText = 'PRAL Digital Invoicing API keys, POS IDs, and Tenant Parameters';
      contentArea.innerHTML = renderSettingsHTML();
      break;

    default:
      contentArea.innerHTML = `<div class="card"><div class="card-body"><h3>View not found</h3></div></div>`;
  }
}

// --------------------------------------------------------------------------
// 1. DASHBOARD VIEW
// --------------------------------------------------------------------------
async function renderDashboardHTML() {
  const kpis = await API.getDashboardKPIs(State.currentBusinessProfileId);
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const pendingBills = await API.getPendingBills();

  const tendersKPI = kpis?.tenders || { total_tenders: 0, in_process: 0, won_count: 0, total_pipeline_value: 0 };
  const secKPI = kpis?.bidSecurities || { active_securities_count: 0, active_securities_amount: 0 };
  const finKPI = kpis?.financials || { total_invoiced: 0, total_collected: 0, total_receivables: 0 };

  const pipelineVal = parseFloat(tendersKPI.total_pipeline_value || 0);
  const pipelineDisplay = pipelineVal >= 1000000 
    ? `PKR ${(pipelineVal / 1000000).toFixed(1)}M` 
    : `PKR ${pipelineVal.toLocaleString()}`;

  const secVal = parseFloat(secKPI.active_securities_amount || 0);
  const secDisplay = secVal >= 1000000 
    ? `PKR ${(secVal / 1000000).toFixed(1)}M` 
    : (secVal >= 1000 ? `PKR ${(secVal / 1000).toFixed(0)}k` : `PKR ${secVal.toLocaleString()}`);

  const collectedVal = parseFloat(finKPI.total_collected || 0);
  const collectedDisplay = collectedVal >= 1000000 
    ? `PKR ${(collectedVal / 1000000).toFixed(1)}M` 
    : `PKR ${collectedVal.toLocaleString()}`;

  const invoicedVal = parseFloat(finKPI.total_invoiced || 0);
  const invoicedDisplay = invoicedVal >= 1000000 
    ? `PKR ${(invoicedVal / 1000000).toFixed(1)}M` 
    : `PKR ${invoicedVal.toLocaleString()}`;

  const recVal = parseFloat(finKPI.total_receivables || 0);
  const recDisplay = recVal >= 1000000 
    ? `PKR ${(recVal / 1000000).toFixed(1)}M` 
    : `PKR ${recVal.toLocaleString()}`;

  return `
    <div class="kpi-grid">
      <div class="kpi-card blue">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Tenders Pipeline</span>
          <div class="kpi-card-icon">📑</div>
        </div>
        <div class="kpi-card-value">${pipelineDisplay}</div>
        <div class="kpi-card-sub">${tendersKPI.in_process || 0} In Process | ${tendersKPI.won_count || 0} Won</div>
      </div>

      <div class="kpi-card purple">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Active Bid Securities</span>
          <div class="kpi-card-icon">🛡️</div>
        </div>
        <div class="kpi-card-value">${secDisplay}</div>
        <div class="kpi-card-sub">${secKPI.active_securities_count || 0} Active CDR/PO Instruments</div>
      </div>

      <div class="kpi-card green">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Payment Collected</span>
          <div class="kpi-card-icon">💵</div>
        </div>
        <div class="kpi-card-value">${collectedDisplay}</div>
        <div class="kpi-card-sub">Invoiced: ${invoicedDisplay}</div>
      </div>

      <div class="kpi-card amber">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Pending Receivables</span>
          <div class="kpi-card-icon">⏳</div>
        </div>
        <div class="kpi-card-value">${recDisplay}</div>
        <div class="kpi-card-sub">Outstanding Bills to Collect</div>
      </div>
    </div>

    <!-- Quick Action Bar -->
    <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
      <button class="primary-btn" onclick="openNewTenderModal()"><span style="font-size:1.1rem;">+</span> Register New Tender</button>
      <button class="secondary-btn" onclick="openNewCustomerModal()">+ Add Customer</button>
      <button class="secondary-btn" onclick="openNewSupplierModal()">+ Add Supplier</button>
      <button class="secondary-btn" onclick="openModal('modal-add-payment')">💵 Record Cheque Payment</button>
      <button class="secondary-btn" onclick="openModal('modal-add-expense')">💳 Log Expense</button>
    </div>

    <!-- Active Pipeline Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">📑 Active Tenders & Bidding Status</div>
        <button class="secondary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="navigateToView('opportunities')">View Full Pipeline &rarr;</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tender Name / Title</th>
              <th>Source</th>
              <th>Customer</th>
              <th>Est. Value</th>
              <th>Bid Security</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${opps.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.9rem;">
                  No active tenders registered for this business entity yet.<br>
                  <span style="font-size:0.8rem; color:#94a3b8;">Click "<strong>+ Register New Tender</strong>" above to start bidding.</span>
                </td>
              </tr>
            ` : opps.slice(0, 5).map(o => `
              <tr>
                <td>
                  <strong>${o.tender_name || o.title}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${o.opportunity_number} | ${o.external_tender_number || 'Direct'}</span>
                </td>
                <td><span class="pill-source">${o.tender_source || 'PPRA'}</span></td>
                <td>${o.customer_name || 'Open Market'}<br><span style="font-size:0.72rem; color:var(--text-muted);">${o.customer_org_type || ''}</span></td>
                <td>
                  ${State.canSeeBiddingPrices() 
                    ? `<strong>PKR ${parseFloat(o.estimated_value || 0).toLocaleString()}</strong>` 
                    : `<span class="badge badge-hold">🔒 Masked</span>`}
                </td>
                <td>
                  ${o.active_bid_securities_count > 0 
                    ? `<span class="badge badge-active">🛡️ Attached</span>` 
                    : `<span class="badge badge-loose" title="Mandatory before submission">⚠️ Missing</span>`}
                </td>
                <td><span class="badge badge-${(o.status || 'new').toLowerCase().replace(/\s+/g, '')}">${o.status}</span></td>
                <td>
                  <button class="secondary-btn" style="padding:4px 8px; font-size:0.78rem;" onclick="openTenderDetailsModal('${o.id}')">Manage</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 2. OPPORTUNITIES & TENDERS VIEW (WITH 360 COCKPIT & LOSS LIFECYCLE)
// --------------------------------------------------------------------------
async function renderOpportunitiesHTML() {
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const isAdmin = State.currentUser.role === 'CompanyAdmin';

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="tab-btn active" onclick="filterTendersBySource('all', this)">All Sources</button>
        <button class="tab-btn" onclick="filterTendersBySource('PPRA', this)">PPRA</button>
        <button class="tab-btn" onclick="filterTendersBySource('DGP', this)">DGP</button>
        <button class="tab-btn" onclick="filterTendersBySource('RFQ', this)">RFQ</button>
        <button class="tab-btn" onclick="filterTendersBySource('LPQ', this)">LPQ</button>
        <button class="tab-btn" onclick="filterTendersBySource('DIRECT SALES', this)">Direct Sales / Quotations</button>
      </div>
      <button class="primary-btn" onclick="openNewTenderModal()">+ Register New Tender</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📑 Commercial Tenders & Bidding Control Hub</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">
          Pricing Visibility: <strong>${isAdmin ? 'Company Admin (Visible)' : 'Bid Manager (Masked)'}</strong>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="tenders-table">
          <thead>
            <tr>
              <th>Tender Name / Ref #</th>
              <th>Source</th>
              <th>Customer & Org Type</th>
              <th>Deadline</th>
              <th class="amount-header">Est. Value</th>
              <th>Bid Security Gate</th>
              <th>Status</th>
              <th>Workflow Actions & 360° View</th>
            </tr>
          </thead>
          <tbody>
            ${opps.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:#64748b;">
                  📑 <strong>No tenders or quotations registered yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Register New Tender</strong> button above to register your first commercial bidding opportunity.</span>
                </td>
              </tr>
            ` : opps.map(o => `
              <tr data-source="${o.tender_source || 'PPRA'}">
                <td>
                  <strong>${o.tender_name || o.title}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${o.opportunity_number} ${o.external_tender_number ? `(${o.external_tender_number})` : ''}</span>
                </td>
                <td><span class="pill-source">${o.tender_source || 'PPRA'}</span></td>
                <td>
                  <strong>${o.customer_name || 'N/A'}</strong><br>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${o.customer_org_type || 'Government'}</span>
                </td>
                <td>${o.closing_date ? new Date(o.closing_date).toLocaleDateString() : 'Open'}</td>
                <td class="amount-cell">
                  ${State.canSeeBiddingPrices() 
                    ? `<strong>PKR ${parseFloat(o.estimated_value || 0).toLocaleString()}</strong>` 
                    : `<span class="badge badge-hold" title="Price visibility masked for this employee">🔒 Masked</span>`}
                </td>
                <td>
                  ${o.active_bid_securities_count > 0 
                    ? `<span class="badge badge-active">🛡️ Attached</span>` 
                    : `<button class="danger-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="promptAttachBidSecurity('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}')">+ Attach Security</button>`}
                </td>
                <td><span class="badge badge-${(o.status || 'new').toLowerCase().replace(/\s+/g, '')}">${o.status}</span></td>
                <td>
                  <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
                    <!-- 360 Cockpit Action -->
                    <button class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#0f172a; color:#ffffff; font-weight:700; border-color:#1e293b;" onclick="openTender360Cockpit('${o.id}')" title="Open Full 360 Project Cockpit">
                      🌐 360° Cockpit
                    </button>

                    <button class="edit-btn" onclick="openEditEntityModal('opportunity', '${o.id}')">✏️</button>

                    ${o.selection_status !== 'Selected' && o.status === 'New' ? `
                      <button class="secondary-btn" style="padding:3px 6px; font-size:0.75rem; background:#ecfdf5; color:#059669;" onclick="handleTenderSelection('${o.id}', 'Selected')">✓ Select</button>
                      <button class="secondary-btn" style="padding:3px 6px; font-size:0.75rem; background:#fef2f2; color:#dc2626;" onclick="handleTenderSelection('${o.id}', 'Rejected')">✗</button>
                    ` : ''}
                    
                    ${o.status === 'Ready to submit' ? `
                      <button class="primary-btn" style="padding:3px 7px; font-size:0.75rem;" onclick="handleBidSubmission('${o.id}')">🚀 Submit</button>
                    ` : ''}

                    ${o.status === 'Submitted' ? `
                      <button class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#ecfdf5; color:#059669; font-weight:700;" onclick="promptWonBid('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}')">🏆 Won</button>
                      <button class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#fef2f2; color:#dc2626;" onclick="promptTenderLossModal('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}', ${parseFloat(o.estimated_value || 0)})">❌ Lose</button>
                    ` : ''}

                    ${o.status === 'won' ? `
                      <button class="primary-btn" style="padding:3px 7px; font-size:0.75rem; background:#059669;" onclick="promptAwardLetterModal('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}')">+ Award LOA</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function filterTendersBySource(source, btnEl) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const rows = document.querySelectorAll('#tenders-table tbody tr');
  rows.forEach(r => {
    if (source === 'all' || r.dataset.source.toUpperCase() === source.toUpperCase()) {
      r.style.display = '';
    } else {
      r.style.display = 'none';
    }
  });
}

async function handleBidSubmission(oppId) {
  const curProf = State.getCurrentBusinessProfile();
  if (curProf && !curProf.fbr_enabled) {
    const warnEl = document.getElementById('fbr-warning-text');
    if (warnEl) {
      warnEl.innerText = `FBR Digital Invoicing integration credentials are not configured for '${curProf.business_name}'. Would you like to configure your FBR PRAL Gateway now or proceed with internal quotation submission?`;
    }
    openModal('modal-fbr-warning');
    return;
  }

  try {
    if (API.submitBid) {
      await API.submitBid(oppId);
    }
    alert('🚀 Bid / Quotation submitted successfully!');
    await renderActiveView();
  } catch (err) {
    alert(`Submission notice: ${err.message}`);
  }
}

async function handleTenderSelection(oppId, status) {
  try {
    if (API.selectTender) {
      await API.selectTender(oppId, status);
    }
    alert(`✓ Tender marked as ${status}.`);
    await renderActiveView();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// 3. BID SECURITIES VIEW (MANDATORY ENTITY)
// --------------------------------------------------------------------------
async function renderBidSecuritiesHTML() {
  const securities = await API.getBidSecurities(State.currentBusinessProfileId);

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <p style="color:var(--text-muted); font-size:0.9rem;">
        Without a valid instrument (PO / CDR / Bank Guarantee), tenders cannot be completed or submitted.
      </p>
      <button class="primary-btn" onclick="openModal('modal-add-bid-security')">+ Add Bid Security</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🛡️ Bid Security / Earnest Money Instruments Registry</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Instrument Type & No</th>
              <th>Account Title</th>
              <th>Beneficiary</th>
              <th>Amount (PKR)</th>
              <th>Bank & Branch</th>
              <th>Expiry Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${securities.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:45px 20px; color:var(--text-muted);">
                  <div style="font-size:2.2rem; margin-bottom:8px;">🛡️</div>
                  <strong style="font-size:1.05rem; color:var(--text-primary); display:block; margin-bottom:4px;">No Bid Security Instruments Registered</strong>
                  <p style="font-size:0.85rem; margin:0 auto; max-width:480px;">No CDRs, POs, or Bank Guarantees found for your organization. Click <strong>+ Add Bid Security</strong> above to register an earnest money instrument.</p>
                </td>
              </tr>
            ` : securities.map(s => `
              <tr>
                <td>
                  <strong>${s.instrument_type} #${s.instrument_number}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${s.opportunity_number || ''}</span>
                </td>
                <td>${s.account_title}</td>
                <td><strong>${s.beneficiary}</strong></td>
                <td><strong>PKR ${parseFloat(s.amount).toLocaleString()}</strong></td>
                <td>${s.bank_name || 'Corporate Branch'}</td>
                <td>${s.expiry_date}</td>
                <td>
                  <span class="badge badge-${(s.status || 'active').toLowerCase()}">${s.status || 'Active'}</span>
                </td>
                <td>
                  <div class="action-buttons-group">
                    <button class="edit-btn" onclick="openEditEntityModal('bid-security', '${s.id}')">✏️ Edit</button>
                    ${s.status === 'Active' ? `
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="handleReleaseBidSecurity('${s.id}')">🔓 Release</button>
                    ` : `<span style="font-size:0.75rem; color:var(--text-muted);">Released / Closed</span>`}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 4. AWARDS, PARTIAL ITEM AWARDS & GUARANTEES VIEW (WON TENDER FLOW)
// --------------------------------------------------------------------------
async function renderAwardsHTML() {
  const awards = await API.getAwards();
  const guarantees = await API.getGuarantees();
  const contracts = await API.getContracts();
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);

  const totalAwardValue = awards.reduce((sum, a) => sum + (parseFloat(a.award_amount) || 0), 0);
  const activeGuarantees = guarantees.filter(g => g.status === 'Active');

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Total Won Awards (LOA)</div>
        <div class="kpi-value">${awards.length}</div>
        <div class="kpi-subtext">Issued by public/private clients</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Awarded Value</div>
        <div class="kpi-value">PKR ${totalAwardValue.toLocaleString()}</div>
        <div class="kpi-subtext">Consolidated contract revenue</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
        <div class="kpi-title">Child Purchase Orders</div>
        <div class="kpi-value">${pos.length} Issued</div>
        <div class="kpi-subtext">Multi-PO fulfillment tracking</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Active Guarantees (PBG)</div>
        <div class="kpi-value">${activeGuarantees.length}</div>
        <div class="kpi-subtext">Performance security instruments</div>
      </div>
    </div>

    <!-- Awards / LOA Table -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-header">
        <div class="card-title">🏆 Letters of Award (LOA) & Item-Level Allocations</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Award / LOA #</th>
              <th>Won Tender & Customer</th>
              <th>Awarded Amount (PKR)</th>
              <th>Item-Level Breakdown</th>
              <th>Acceptance & Deadline</th>
              <th>Status</th>
              <th>Workflow Actions</th>
            </tr>
          </thead>
          <tbody>
            ${awards.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏆 <strong>No Award Letters recorded yet.</strong><br>
                  <span style="font-size:0.85rem;">When a tender or quotation is Won, record the official Letter of Award (LOA) with partial/full item quantities.</span>
                </td>
              </tr>
            ` : awards.map(a => {
              const childPOs = pos.filter(p => p.award_letter_id === a.id || p.opportunity_id === a.opportunity_id);
              const itemsCount = (a.items && a.items.length) ? a.items.length : 1;
              const awardedItemsCount = (a.items && a.items.length) ? a.items.filter(i => i.is_awarded !== false).length : 1;

              return `
                <tr>
                  <td>
                    <strong>${a.award_number}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${a.award_date}</span>
                  </td>
                  <td>
                    <strong>${a.tender_name || a.opportunity_number || 'Won Project'}</strong><br>
                    <span style="font-size:0.78rem; color:#475569;">${a.customer_name || 'Government Department'}</span>
                  </td>
                  <td>
                    <strong style="color:#059669; font-size:0.95rem;">PKR ${parseFloat(a.award_amount).toLocaleString()}</strong>
                  </td>
                  <td>
                    <span class="badge ${awardedItemsCount === itemsCount ? 'badge-won' : 'badge-sec-attached'}">
                      ${awardedItemsCount} of ${itemsCount} Item(s) Awarded
                    </span><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${childPOs.length} Child PO(s) generated</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      ${a.acceptance_deadline ? `Deadline: <strong>${a.acceptance_deadline}</strong>` : 'Standard (10 Days)'}
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-${a.status === 'Accepted' ? 'won' : (a.status === 'Rejected' ? 'loose' : 'new')}">
                      ${a.status || 'Pending'}
                    </span>
                  </td>
                  <td>
                    <div class="action-buttons-group">
                      <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem; background:#0284c7;" onclick="openNewPOModal('${a.id}')" title="Issue new PO against this Award">
                        📦 + Create PO
                      </button>
                      <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="promptAttachPBGForAward('${a.id}', '${a.award_number}', ${parseFloat(a.award_amount || 0)})" title="Issue Performance Bank Guarantee">
                        🏦 PBG
                      </button>
                      <button class="edit-btn" onclick="openEditEntityModal('award', '${a.id}')">✏️ Edit</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Performance Guarantees (PBG) Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">🏦 Bank Performance Guarantees (PBG / Performance Bonds)</div>
        <button class="primary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="openModal('modal-add-guarantee')">+ Issue Performance Guarantee</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Guarantee / PBG No</th>
              <th>Contract / Award Ref</th>
              <th>Issuing Bank & Branch</th>
              <th>Amount (PKR)</th>
              <th>Expiry Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${guarantees.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏦 <strong>No Performance Guarantees issued yet.</strong><br>
                  <span style="font-size:0.85rem;">Public tenders require a 5% to 10% Performance Bank Guarantee (PBG) upon LOA acceptance before PO execution.</span>
                </td>
              </tr>
            ` : guarantees.map(g => `
              <tr>
                <td><strong>${g.guarantee_number}</strong></td>
                <td>${g.contract_number || g.award_number || 'Contract Award'}</td>
                <td>${g.bank_name || 'Bank Guarantee Branch'}</td>
                <td><strong style="color:#059669;">PKR ${parseFloat(g.amount).toLocaleString()}</strong></td>
                <td>${g.expiry_date}</td>
                <td><span class="badge badge-${g.status === 'Active' ? 'active' : 'released'}">${g.status}</span></td>
                <td>
                  <div class="action-buttons-group">
                    <button class="edit-btn" onclick="openEditEntityModal('guarantee', '${g.id}')">✏️ Edit</button>
                    ${g.status === 'Active' ? `
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="handleReleaseGuarantee('${g.id}')">🔓 Release</button>
                    ` : `<span style="font-size:0.75rem; color:var(--text-muted);">Released</span>`}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 5. PURCHASE ORDERS VIEW (MULTI-PO HIERARCHY & EXECUTION ENGINE)
// --------------------------------------------------------------------------
async function renderPurchaseOrdersHTML() {
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const dcs = await API.getDeliveryChallans(State.currentBusinessProfileId);
  const awards = await API.getAwards();

  const totalPOValue = pos.reduce((sum, p) => sum + (parseFloat(p.net_amount || p.total_amount) || 0), 0);

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Active POs</div>
        <div class="kpi-value">${pos.length}</div>
        <div class="kpi-subtext">Issued supply commitments</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Total PO Value Under Execution</div>
        <div class="kpi-value">PKR ${totalPOValue.toLocaleString()}</div>
        <div class="kpi-subtext">Committed contract volume</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
        <div class="kpi-title">Supply Challans (DCs) Generated</div>
        <div class="kpi-value">${dcs.length} Challans</div>
        <div class="kpi-subtext">Warehouse & drop shipments</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">Parent Awards Covered</div>
        <div class="kpi-value">${awards.length} Awards</div>
        <div class="kpi-subtext">Multi-PO distribution active</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📦 Customer Purchase Orders (1 Award ➔ N POs Engine)</div>
        <button class="primary-btn" onclick="openNewPOModal()">+ Create Purchase Order</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>PO # & Award Ref</th>
              <th>Customer & Delivery Site</th>
              <th>PO Date & Deadline</th>
              <th>Item Allocations</th>
              <th>Total Net Value</th>
              <th>Fulfillment (DCs)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pos.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:#64748b;">
                  📦 <strong>No Purchase Orders issued yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Create Purchase Order</strong> button above or go to Awards to issue POs with partial quantities.</span>
                </td>
              </tr>
            ` : pos.map(po => {
              const matchedDCs = dcs.filter(d => d.purchase_order_id === po.id || d.po_number === po.po_number);
              const itemsCount = (po.items && po.items.length) ? po.items.length : 1;

              return `
                <tr>
                  <td>
                    <strong>${po.po_number}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${po.award_number || 'Award LOA Ref'}</span>
                  </td>
                  <td>
                    <strong>${po.customer_name || 'Customer Account'}</strong><br>
                    <span style="font-size:0.75rem; color:#475569;">📍 ${po.delivery_location || 'Designated Customer Site'}</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      <strong>Date:</strong> ${po.po_date || 'Today'}<br>
                      <strong>Due:</strong> <span style="color:#d97706;">${po.delivery_deadline || 'As per Schedule'}</span>
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-sec-attached">${itemsCount} Item Line(s)</span><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${po.department_name || ''}</span>
                  </td>
                  <td>
                    <strong style="color:#0284c7; font-size:0.95rem;">PKR ${parseFloat(po.net_amount || po.total_amount || 0).toLocaleString()}</strong>
                  </td>
                  <td>
                    <span class="badge ${matchedDCs.length > 0 ? 'badge-won' : 'badge-hold'}">
                      ${matchedDCs.length} DC(s) Issued
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-${po.status === 'Completed' ? 'won' : (po.status === 'In Delivery' ? 'ready' : 'new')}">
                      ${po.status || 'Issued'}
                    </span>
                  </td>
                  <td>
                    <div class="action-buttons-group">
                      <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem; background:#059669;" onclick="promptCreateDCForPO('${po.id}', '${po.po_number}')" title="Generate Delivery Challan for this PO">
                        🚚 Dispatch DC
                      </button>
                      <button class="edit-btn" onclick="openEditEntityModal('purchase-order', '${po.id}')">✏️ Edit</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 6. SUPPLY / DELIVERY CHALLANS (DC) & LOGISTICS VIEW (DUAL-MODE & FREIGHT)
// --------------------------------------------------------------------------
async function renderDeliveryChallansHTML() {
  const dcs = await API.getDeliveryChallans(State.currentBusinessProfileId);
  const warehouses = await API.getWarehouses();
  const suppliers = await API.getSuppliers();

  const totalFreightPaid = dcs.reduce((sum, d) => sum + (parseFloat(d.freight_cost_contractor || d.delivery_cost || 0)), 0);
  const totalCustomsPaid = dcs.reduce((sum, d) => sum + (parseFloat(d.customs_handling_cost || 0)), 0);
  const grnReceivedCount = dcs.filter(d => d.status === 'GRN Received' || d.status === 'Delivered').length;

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Dispatches (DCs)</div>
        <div class="kpi-value">${dcs.length}</div>
        <div class="kpi-subtext">Issued Delivery Challans</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Delivered & GRN Received</div>
        <div class="kpi-value">${grnReceivedCount} / ${dcs.length}</div>
        <div class="kpi-subtext">Verified at customer site</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Contractor Freight Paid</div>
        <div class="kpi-value">PKR ${totalFreightPaid.toLocaleString()}</div>
        <div class="kpi-subtext">Borne logistics expense</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">Customs & Handling Paid</div>
        <div class="kpi-value">PKR ${totalCustomsPaid.toLocaleString()}</div>
        <div class="kpi-subtext">Port clearance expense</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🚚 Supply Delivery Challans (Warehouse & Drop-Shipments)</div>
        <button class="primary-btn" onclick="openNewDCModal()">+ Dispatch New Delivery Challan</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>DC # & PO Ref</th>
              <th>Customer & Destination Site</th>
              <th>Fulfillment Mode & Origin</th>
              <th>Carrier, Vehicle & Bilty</th>
              <th>Dispatched Items</th>
              <th>Contractor Freight Paid</th>
              <th>Date & GRN</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${dcs.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🚚 <strong>No Delivery Challans generated yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Dispatch New Delivery Challan</strong> button above or go to Purchase Orders to execute a delivery.</span>
                </td>
              </tr>
            ` : dcs.map(dc => {
              const isDropShip = dc.delivery_mode === 'Direct Drop-Shipment';
              const itemsCount = (dc.items && dc.items.length) ? dc.items.length : 1;
              const isDelivered = dc.status === 'Delivered' || dc.status === 'GRN Received';

              return `
                <tr>
                  <td>
                    <strong>${dc.dc_number}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${dc.po_number || 'PO Ref'}</span>
                  </td>
                  <td>
                    <strong>${dc.customer_name || 'Customer'}</strong><br>
                    <span style="font-size:0.75rem; color:#475569;">📍 ${dc.destination_site || 'Customer Site'}</span>
                  </td>
                  <td>
                    <span class="pill-source" style="${isDropShip ? 'background:#fef3c7; color:#92400e;' : 'background:#e0f2fe; color:#0369a1;'}">
                      ${isDropShip ? '🌐 Direct Drop-Ship' : '🏬 Own Warehouse'}
                    </span><br>
                    <span style="font-size:0.78rem; font-weight:600;">${dc.origin_location || dc.warehouse_name || 'Central Depot'}</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      <strong>${dc.logistics_provider || dc.delivery_method || '3PL'}</strong><br>
                      ${dc.tracking_number || dc.bilty_number ? `<code>Bilty: ${dc.tracking_number || dc.bilty_number}</code><br>` : ''}
                      ${dc.vehicle_number ? `<span style="font-size:0.75rem; color:var(--text-muted);">🚛 ${dc.vehicle_number}</span>` : ''}
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-sec-attached">${itemsCount} Item Line(s)</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem; font-weight:700; color:#b45309;">
                      PKR ${parseFloat(dc.freight_cost_contractor || dc.delivery_cost || 0).toLocaleString()}
                    </span>
                    ${dc.customs_handling_cost && parseFloat(dc.customs_handling_cost) > 0 ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">+ PKR ${parseFloat(dc.customs_handling_cost).toLocaleString()} Customs</span>` : ''}
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      ${dc.delivery_date || 'Today'}<br>
                      ${dc.grn_number ? `<strong style="color:#059669; font-size:0.75rem;">GRN: ${dc.grn_number}</strong>` : ''}
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-${isDelivered ? 'won' : 'ready'}">
                      ${dc.status || 'Dispatched'}
                    </span>
                  </td>
                  <td>
                    <div class="action-buttons-group">
                      <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem; background:#059669;" onclick="promptGenerateInvoiceFromDC('${dc.id}', '${dc.dc_number}', '${dc.customer_name}')" title="Generate commercial invoice for this DC">
                        🧾 Invoice
                      </button>
                      ${!isDelivered ? `
                        <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="promptRecordCustomerGRN('${dc.id}', '${dc.dc_number}')" title="Record Signed GRN">
                          📋 GRN
                        </button>
                      ` : ''}
                      <button class="edit-btn" onclick="openEditEntityModal('delivery-challan', '${dc.id}')">✏️ Edit</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 7. INVOICING, DYNAMIC PO PAYMENT RECONCILIATION & FBR FISCALIZATION VIEW
// --------------------------------------------------------------------------
async function renderInvoicesHTML() {
  const invoices = await API.getInvoices(State.currentBusinessProfileId);
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const expenses = await API.getExpenses(State.currentBusinessProfileId);

  const totalBilled = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_amount) || 0), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + (parseFloat(inv.paid_amount) || 0), 0);
  const totalReceivable = invoices.reduce((sum, inv) => sum + (parseFloat(inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0))) || 0), 0);
  const fbrCount = invoices.filter(inv => inv.fbr_status === 'FBR Validated').length;

  return `
    <!-- Top Financial KPI Summary Cards -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Invoiced (Billed)</div>
        <div class="kpi-value">PKR ${totalBilled.toLocaleString()}</div>
        <div class="kpi-subtext">${invoices.length} Invoices Generated</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Total Payments Collected</div>
        <div class="kpi-value">PKR ${totalPaid.toLocaleString()}</div>
        <div class="kpi-subtext">Realized Cash Inflow</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #ef4444;">
        <div class="kpi-title">Outstanding Receivables</div>
        <div class="kpi-value">PKR ${totalReceivable.toLocaleString()}</div>
        <div class="kpi-subtext">Pending Customer Dues</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">FBR PRAL Validated</div>
        <div class="kpi-value">${fbrCount} / ${invoices.length}</div>
        <div class="kpi-subtext">Digital Tax Fiscalization</div>
      </div>
    </div>

    <!-- Dynamic PO Payment Reconciliation Engine (1 PO -> N Invoices -> N Payments) -->
    <div class="card" style="margin-bottom: 20px; border-top: 3px solid #0284c7;">
      <div class="card-header">
        <div class="card-title">📊 Dynamic PO Payment Reconciliation Hub (1 PO ➔ N Invoices ➔ N Payments)</div>
      </div>
      <div class="table-responsive">
        <table class="data-table" style="font-size: 0.85rem;">
          <thead>
            <tr>
              <th>PO # & Award Ref</th>
              <th>Customer & Delivery Site</th>
              <th>PO Contract Value</th>
              <th>Total Invoiced (Billed)</th>
              <th>Total Collected</th>
              <th>Pending Receivable</th>
              <th>PO Direct Expenses</th>
              <th>Net Profit Margin</th>
            </tr>
          </thead>
          <tbody>
            ${pos.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">
                  No active Purchase Orders to reconcile.
                </td>
              </tr>
            ` : pos.map(p => {
              const poInvs = invoices.filter(inv => inv.purchase_order_id === p.id || inv.po_number === p.po_number);
              const poInvoicedTotal = poInvs.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0);
              const poPaidTotal = poInvs.reduce((s, i) => s + (parseFloat(i.paid_amount) || 0), 0);
              const poOutstanding = poInvoicedTotal - poPaidTotal;

              const poExps = expenses.filter(e => e.purchase_order_id === p.id || e.po_number === p.po_number || e.opportunity_id === p.opportunity_id);
              const poDirectCost = poExps.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              const poVal = parseFloat(p.net_amount || p.total_amount || 0);
              const poNetProfit = poPaidTotal - poDirectCost;
              const poMarginPct = poPaidTotal > 0 ? ((poNetProfit / poPaidTotal) * 100).toFixed(1) : '0.0';

              const billedPct = poVal > 0 ? Math.min(100, (poInvoicedTotal / poVal) * 100).toFixed(0) : 0;
              const paidPct = poInvoicedTotal > 0 ? Math.min(100, (poPaidTotal / poInvoicedTotal) * 100).toFixed(0) : 0;

              return `
                <tr>
                  <td>
                    <strong>${p.po_number}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${p.award_number || 'Award LOA'}</span>
                  </td>
                  <td>
                    <strong>${p.customer_name || 'Customer'}</strong><br>
                    <span style="font-size:0.72rem; color:#475569;">📍 ${p.delivery_location || 'Site'}</span>
                  </td>
                  <td>
                    <strong style="color:#0284c7;">PKR ${poVal.toLocaleString()}</strong>
                  </td>
                  <td>
                    <strong>PKR ${poInvoicedTotal.toLocaleString()}</strong>
                    <div style="font-size:0.72rem; color:#64748b;">${billedPct}% of PO Billed (${poInvs.length} Invs)</div>
                  </td>
                  <td>
                    <strong style="color:#059669;">PKR ${poPaidTotal.toLocaleString()}</strong>
                    <div style="font-size:0.72rem; color:#64748b;">${paidPct}% Collected</div>
                  </td>
                  <td>
                    <strong style="color:${poOutstanding > 0 ? '#dc2626' : '#64748b'};">PKR ${poOutstanding.toLocaleString()}</strong>
                  </td>
                  <td>
                    <span style="color:#b45309; font-weight:600;">PKR ${poDirectCost.toLocaleString()}</span>
                  </td>
                  <td>
                    <strong style="color:${poNetProfit >= 0 ? '#059669' : '#dc2626'}; font-size:0.9rem;">
                      PKR ${poNetProfit.toLocaleString()}
                    </strong>
                    <span class="badge ${poNetProfit >= 0 ? 'badge-won' : 'badge-withdraw'}" style="font-size:0.7rem; margin-left:4px;">${poMarginPct}%</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Commercial Invoices Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">🧾 Commercial Invoices & FBR Tax Registry</div>
        <button class="primary-btn" onclick="openModal('modal-add-payment')">💵 Record Cheque Payment</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>PO & DC Reference</th>
              <th>Customer</th>
              <th>Invoice Date</th>
              <th>Total Amount</th>
              <th>Paid Amount</th>
              <th>Outstanding</th>
              <th>Status</th>
              <th>FBR PRAL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td><strong>${inv.invoice_number}</strong></td>
                <td>
                  <strong>${inv.po_number || 'PO Ref'}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${inv.dc_number || 'Direct Delivery'}</span>
                </td>
                <td>${inv.customer_name}</td>
                <td>${inv.invoice_date}</td>
                <td><strong>PKR ${parseFloat(inv.total_amount).toLocaleString()}</strong></td>
                <td style="color:#059669; font-weight:600;">PKR ${parseFloat(inv.paid_amount || 0).toLocaleString()}</td>
                <td style="color:#dc2626; font-weight:700;">PKR ${parseFloat(inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0))).toLocaleString()}</td>
                <td>
                  <select style="font-size:0.75rem; padding:2px 4px; border-radius:4px; border:1px solid var(--border);" onchange="handleInvoiceStatusChange('${inv.id}', this.value)">
                    <option value="Submitted" ${inv.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                    <option value="Reinvoicing" ${inv.status === 'Reinvoicing' ? 'selected' : ''}>Reinvoicing</option>
                    <option value="Pending" ${inv.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Hold" ${inv.status === 'Hold' ? 'selected' : ''}>Hold</option>
                    <option value="Paid" ${inv.status === 'Paid' ? 'selected' : ''}>Paid</option>
                  </select>
                </td>
                <td>
                  ${inv.fbr_status === 'FBR Validated' ? `
                    <span class="badge badge-fbr">✓ Validated</span>
                  ` : `
                    <button class="secondary-btn" style="padding:2px 6px; font-size:0.72rem;" onclick="handleFBRSubmit('${inv.id}')">Submit FBR</button>
                  `}
                </td>
                <td>
                  <div class="action-buttons-group">
                    <button class="edit-btn" onclick="openEditEntityModal('invoice', '${inv.id}')">✏️ Edit</button>
                    <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="promptRecordPaymentForInvoice('${inv.id}', '${inv.invoice_number}', '${inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0))}')">💵 Pay</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 8. PAYMENTS RECEIVED VIEW
// --------------------------------------------------------------------------
async function renderPaymentsHTML() {
  const payments = await API.getPayments(State.currentBusinessProfileId);

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <p style="color:var(--text-muted); font-size:0.9rem;">
        Cheque details (Check No, Check From, Invoice Number) are tracked and automatically deducted from customer balance.
      </p>
      <button class="primary-btn" onclick="openModal('modal-add-payment')">+ Record Cheque Receipt</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">💵 Payment Receipt & Cheque Drawer</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Invoice Ref</th>
              <th>Customer</th>
              <th>Cheque Number</th>
              <th>Cheque From</th>
              <th>Deposited Bank Account</th>
              <th>Amount Received</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td><strong>${p.payment_number}</strong></td>
                <td>${p.invoice_number}</td>
                <td>${p.customer_name}</td>
                <td><strong style="color:var(--primary);">${p.check_no || 'Direct Transfer'}</strong></td>
                <td>${p.check_from || p.customer_name}</td>
                <td>${p.bank_account || 'Primary Bank Account'}</td>
                <td><strong style="color:#059669; font-size:0.95rem;">PKR ${parseFloat(p.amount).toLocaleString()}</strong></td>
                <td>${p.payment_date}</td>
                <td>
                  <button class="edit-btn" onclick="openEditEntityModal('payment', '${p.id}')">✏️ Edit</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 9. WAREHOUSE & STOCK MANAGEMENT VIEW
// --------------------------------------------------------------------------
async function renderInventoryHTML() {
  const warehouses = await API.getWarehouses();
  const transactions = await API.getInventoryTransactions();
  const procurements = await API.getProcurements();

  return `
    <div class="kpi-grid">
      <div class="kpi-card blue">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Active Warehouses</span>
          <div class="kpi-card-icon">🏬</div>
        </div>
        <div class="kpi-card-value">${warehouses.length}</div>
        <div class="kpi-card-sub">Central & Regional Facilities</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-card-header">
          <span class="kpi-card-title">Stock Movements</span>
          <div class="kpi-card-icon">📦</div>
        </div>
        <div class="kpi-card-value">${transactions.length}</div>
        <div class="kpi-card-sub">Audited Transactions</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px;">
      <div class="card-header">
        <div class="card-title">🏬 Warehouse Locations</div>
        <button class="secondary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="openNewWarehouseModal()">+ Add Warehouse</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Warehouse Name</th>
              <th>Location & City</th>
              <th>Manager</th>
              <th>Contact</th>
              <th>Activity Count</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${warehouses.map(w => `
              <tr>
                <td><strong>${w.warehouse_name}</strong></td>
                <td>${w.location || ''}, ${w.city}</td>
                <td>${w.manager_name || 'Warehouse Staff'}</td>
                <td>${w.contact_phone || '042-3581920'}</td>
                <td><span class="badge badge-ready">${w.total_tx_count || 0} Movements</span></td>
                <td>
                  <button class="edit-btn" onclick="openEditEntityModal('warehouse', '${w.id}')">✏️ Edit</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🚢 Local Procurement & Import Landed Cost Tracker</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Procurement #</th>
              <th>Type</th>
              <th>Supplier</th>
              <th>Origin Country</th>
              <th>Currency</th>
              <th>Total Landed Cost</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${procurements.map(pr => `
              <tr>
                <td><strong>${pr.procurement_number}</strong></td>
                <td><span class="pill-source">${pr.procurement_type}</span></td>
                <td>${pr.supplier_name}</td>
                <td>${pr.origin_country || 'Pakistan'}</td>
                <td>${pr.currency || 'PKR'}</td>
                <td><strong>PKR ${parseFloat(pr.total_landed_cost).toLocaleString()}</strong></td>
                <td><span class="badge badge-won">${pr.status}</span></td>
                <td>
                  <button class="edit-btn" onclick="openEditEntityModal('procurement', '${pr.id}')">✏️ Edit</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 10. 3-TIER EXPENSES & OVERHEADS LEDGER (TENDER DIRECT, PO LOGISTICS & OVERHEADS)
// --------------------------------------------------------------------------
async function renderExpensesHTML() {
  const expenses = await API.getExpenses(State.currentBusinessProfileId);

  // Segregate by 3 Tiers
  const tier1Expenses = expenses.filter(e => e.expense_tier === 'Tier 1 - Tender Direct' || e.expense_type === 'Tender Expense' || e.expense_type === 'Quotation Expense' || e.opportunity_id);
  const tier2Expenses = expenses.filter(e => e.expense_tier === 'Tier 2 - PO Execution' || e.purchase_order_id || e.delivery_challan_id);
  const tier3Expenses = expenses.filter(e => !tier1Expenses.includes(e) && !tier2Expenses.includes(e));

  const totalAll = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier1 = tier1Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier2 = tier2Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier3 = tier3Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return `
    <!-- Top 3-Tier KPI Summary Cards -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Expenditures</div>
        <div class="kpi-value">PKR ${totalAll.toLocaleString()}</div>
        <div class="kpi-subtext">${expenses.length} Logged Transactions</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #0284c7;">
        <div class="kpi-title">🎯 Tier 1: Tender & Bidding Direct</div>
        <div class="kpi-value">PKR ${totalTier1.toLocaleString()}</div>
        <div class="kpi-subtext">Gifting, Samples, Testing, Bidding Travel</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">🚚 Tier 2: PO Logistics & Freight</div>
        <div class="kpi-value">PKR ${totalTier2.toLocaleString()}</div>
        <div class="kpi-subtext">3PL Freight, Customs, Port Demurrage</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #64748b;">
        <div class="kpi-title">🏢 Tier 3: General Overheads</div>
        <div class="kpi-value">PKR ${totalTier3.toLocaleString()}</div>
        <div class="kpi-subtext">Salaries, Rent, Utilities, Admin</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">💳 3-Tier Company & Project Expenditure Ledger</div>
        <button class="primary-btn" onclick="openExpenseModal()">+ Record Expenditure</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tier & Classification</th>
              <th>Expense Title / Details</th>
              <th>Category</th>
              <th>Amount (PKR)</th>
              <th>Date</th>
              <th>Paid To</th>
              <th>Attributed Project / PO</th>
              <th>Payment Mode</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${expenses.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:36px 20px; color:var(--text-muted);">
                  💳 <strong>No expenditures recorded yet.</strong><br>
                  <span style="font-size:0.85rem;">Click <strong>+ Record Expenditure</strong> above to log Tier 1 pre-bid expenses, Tier 2 logistics, or Tier 3 overheads.</span>
                </td>
              </tr>
            ` : expenses.map(e => {
              const isTier1 = tier1Expenses.includes(e);
              const isTier2 = tier2Expenses.includes(e);

              let tierBadge = `<span class="badge" style="background:#f1f5f9; color:#475569;">🏢 Tier 3: Overhead</span>`;
              if (isTier1) {
                tierBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1;">🎯 Tier 1: Tender Direct</span>`;
              } else if (isTier2) {
                tierBadge = `<span class="badge" style="background:#fef3c7; color:#92400e;">🚚 Tier 2: PO Logistics</span>`;
              }

              const projectRef = e.opportunity_number ? `
                <strong style="color:var(--primary); font-size:0.82rem;">${e.opportunity_number}</strong><br>
                <span style="font-size:0.72rem; color:var(--text-muted);">${e.tender_name || e.opportunity_title || ''}</span>
              ` : (e.po_number || e.purchase_order_id ? `
                <strong style="color:#059669; font-size:0.82rem;">PO: ${e.po_number || 'PO Ref'}</strong><br>
                <span style="font-size:0.72rem; color:var(--text-muted);">${e.notes || ''}</span>
              ` : `<span style="color:var(--text-muted); font-size:0.78rem;">General Overhead</span>`);

              return `
                <tr>
                  <td>${tierBadge}</td>
                  <td>
                    <strong>${e.expense_name || e.category}</strong><br>
                    <span style="font-size:0.72rem; color:var(--text-muted);">${e.remarks || e.notes || ''}</span>
                  </td>
                  <td>
                    <span class="badge badge-sec-attached" style="font-size:0.72rem;">${e.category}</span>
                  </td>
                  <td>
                    <strong style="color:#b45309; font-size:0.92rem;">PKR ${parseFloat(e.amount).toLocaleString()}</strong>
                  </td>
                  <td>${e.expense_date || 'Today'}</td>
                  <td><strong>${e.paid_to || 'Vendor'}</strong></td>
                  <td>${projectRef}</td>
                  <td><span class="pill-source" style="font-size:0.72rem;">${e.payment_mode || 'Online'}</span></td>
                  <td>
                    <button class="edit-btn" onclick="openEditEntityModal('expense', '${e.id}')">✏️ Edit</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 11. 6 EXECUTIVE MANAGEMENT REPORTS & AUDIT TRAIL ENGINE (PHASE 6)
// --------------------------------------------------------------------------
let _activeReportTab = 'profitability';

async function switchReportTab(tabId) {
  _activeReportTab = tabId;
  await renderActiveView();
}

async function renderReportsHTML() {
  const profitability = await API.getContractProfitability();
  const pendingBills = await API.getPendingBills();
  const securities = await API.getBidSecurities(State.currentBusinessProfileId);
  const suppliers = await API.getSuppliers();
  const procurements = await API.getProcurements();
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const evals = State.getTenantEntityList('bidEvaluations');
  const expenses = await API.getExpenses(State.currentBusinessProfileId);
  const auditLogs = State.getTenantEntityList('auditLogs');

  // Summary Metrics
  const totalContractVal = profitability.reduce((s, p) => s + (parseFloat(p.contract_value) || 0), 0);
  const totalNetProfit = profitability.reduce((s, p) => s + (parseFloat(p.net_profit) || 0), 0);
  const totalReceivables = pendingBills.reduce((s, b) => s + (parseFloat(b.outstanding_amount) || 0), 0);
  const totalActiveSecurities = securities.filter(s => s.status === 'Active').reduce((s, sc) => s + (parseFloat(sc.amount) || 0), 0);
  const wonOppsCount = opps.filter(o => o.status === 'won').length;
  const lostOppsCount = opps.filter(o => o.status === 'loose').length;
  const winRatePct = (wonOppsCount + lostOppsCount) > 0 ? ((wonOppsCount / (wonOppsCount + lostOppsCount)) * 100).toFixed(1) : '66.7';

  return `
    <!-- Top Executive Navigation Tabs -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="tab-btn ${_activeReportTab === 'profitability' ? 'active' : ''}" onclick="switchReportTab('profitability')">📊 1. Contract Profitability</button>
        <button class="tab-btn ${_activeReportTab === 'aging' ? 'active' : ''}" onclick="switchReportTab('aging')">⏳ 2. Receivables Aging</button>
        <button class="tab-btn ${_activeReportTab === 'securities' ? 'active' : ''}" onclick="switchReportTab('securities')">🏦 3. Bank Line & EMD</button>
        <button class="tab-btn ${_activeReportTab === 'suppliers' ? 'active' : ''}" onclick="switchReportTab('suppliers')">🌐 4. Supplier Fulfillment</button>
        <button class="tab-btn ${_activeReportTab === 'winloss' ? 'active' : ''}" onclick="switchReportTab('winloss')">📉 5. Win/Loss Intelligence</button>
        <button class="tab-btn ${_activeReportTab === 'expenses' ? 'active' : ''}" onclick="switchReportTab('expenses')">💳 6. 3-Tier Expenses</button>
        <button class="tab-btn ${_activeReportTab === 'audit' ? 'active' : ''}" onclick="switchReportTab('audit')">📜 Audit Trail</button>
      </div>
      <button class="secondary-btn" style="padding:6px 12px; font-size:0.82rem;" onclick="window.print()">🖨️ Print / Export PDF</button>
    </div>

    ${_activeReportTab === 'profitability' ? `
      <!-- REPORT 1: CONTRACT-WISE PROFITABILITY STATEMENT -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid var(--primary);">
          <div class="kpi-title">Total Contracts Value</div>
          <div class="kpi-value">PKR ${totalContractVal.toLocaleString()}</div>
          <div class="kpi-subtext">Executed Project Volume</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Net Realized Profit</div>
          <div class="kpi-value">PKR ${totalNetProfit.toLocaleString()}</div>
          <div class="kpi-subtext">After all direct & logistics expenses</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Average Net Margin</div>
          <div class="kpi-value">${profitability.length > 0 ? (profitability.reduce((s, p) => s + parseFloat(p.profit_margin_pct || 0), 0) / profitability.length).toFixed(1) : 0}%</div>
          <div class="kpi-subtext">Gross to Net margin retention</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
          <div class="kpi-title">Active Contracts</div>
          <div class="kpi-value">${profitability.length} Contracts</div>
          <div class="kpi-subtext">Under active billing & execution</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Report 1: Contract-Wise Profitability Statement (Revenue – COGS – Logistics – Pre-Bid = Net Profit)</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Contract / Project #</th>
                <th>Customer & Site</th>
                <th>Contract Value</th>
                <th>Invoiced Amount</th>
                <th>Cash Collected</th>
                <th>Attributed Expenses</th>
                <th>Net Profit</th>
                <th>Net Margin %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${profitability.map(p => `
                <tr>
                  <td><strong>${p.contract_number}</strong></td>
                  <td>${p.customer_name}</td>
                  <td><strong>PKR ${parseFloat(p.contract_value).toLocaleString()}</strong></td>
                  <td>PKR ${parseFloat(p.invoiced_amount).toLocaleString()}</td>
                  <td style="color:#059669; font-weight:600;">PKR ${parseFloat(p.received_payment).toLocaleString()}</td>
                  <td style="color:#dc2626;">PKR ${parseFloat(p.allocated_expenses).toLocaleString()}</td>
                  <td><strong style="color:#059669; font-size:0.95rem;">PKR ${parseFloat(p.net_profit).toLocaleString()}</strong></td>
                  <td><span class="badge badge-won">${p.profit_margin_pct}%</span></td>
                  <td><span class="badge badge-active">${p.contract_status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'aging' ? `
      <!-- REPORT 2: PENDING CUSTOMER BILLS & RECEIVABLES AGING -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid #ef4444;">
          <div class="kpi-title">Total Outstanding Dues</div>
          <div class="kpi-value">PKR ${totalReceivables.toLocaleString()}</div>
          <div class="kpi-subtext">${pendingBills.length} Pending Invoices</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Current (0–30 Days)</div>
          <div class="kpi-value">PKR ${pendingBills.filter(b => (b.days_outstanding || 0) <= 30).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Within standard credit term</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Overdue (31–60 Days)</div>
          <div class="kpi-value">PKR ${pendingBills.filter(b => (b.days_outstanding || 0) > 30 && (b.days_outstanding || 0) <= 60).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Follow-up reminder stage</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #b91c1c;">
          <div class="kpi-title">Critical (60+ Days)</div>
          <div class="kpi-value">PKR ${pendingBills.filter(b => (b.days_outstanding || 0) > 60).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Escalation required</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">⏳ Report 2: Pending Customer Bills & Receivables Aging Analysis</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer & Organization</th>
                <th>Invoice Date</th>
                <th>Total Invoiced</th>
                <th>Outstanding Due</th>
                <th>Aging Category</th>
                <th>FBR PRAL</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${pendingBills.map(b => {
                const days = b.days_outstanding || 1;
                let agingBadge = `<span class="badge badge-won">0–30 Days</span>`;
                if (days > 60) {
                  agingBadge = `<span class="badge badge-withdraw" style="background:#fee2e2; color:#b91c1c;">${days} Days (Critical)</span>`;
                } else if (days > 30) {
                  agingBadge = `<span class="badge badge-hold" style="background:#fef3c7; color:#92400e;">${days} Days (Overdue)</span>`;
                }

                return `
                  <tr>
                    <td><strong>${b.invoice_number}</strong></td>
                    <td>
                      <strong>${b.customer_name}</strong><br>
                      <span style="font-size:0.72rem; color:var(--text-muted);">${b.customer_org_type || 'Government Department'}</span>
                    </td>
                    <td>${b.invoice_date}</td>
                    <td>PKR ${parseFloat(b.total_amount).toLocaleString()}</td>
                    <td><strong style="color:#dc2626; font-size:0.95rem;">PKR ${parseFloat(b.outstanding_amount).toLocaleString()}</strong></td>
                    <td>${agingBadge}</td>
                    <td><span class="badge badge-fbr">✓ Validated</span></td>
                    <td>
                      <button class="primary-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="promptRecordPaymentForInvoice('${b.id || ''}', '${b.invoice_number}', '${b.outstanding_amount}')">💵 Pay</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'securities' ? `
      <!-- REPORT 3: BID SECURITY & BANK LINE UTILIZATION REPORT -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
          <div class="kpi-title">Bank Credit Guarantee Limit</div>
          <div class="kpi-value">PKR 100,000,000</div>
          <div class="kpi-subtext">Approved Corporate Facility</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #ef4444;">
          <div class="kpi-title">Active Blocked Securities</div>
          <div class="kpi-value">PKR ${totalActiveSecurities.toLocaleString()}</div>
          <div class="kpi-subtext">Under Active Bidding & PBG</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Available Bank Credit Line</div>
          <div class="kpi-value">PKR ${(100000000 - totalActiveSecurities).toLocaleString()}</div>
          <div class="kpi-subtext">Ready for new tender CDRs</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
          <div class="kpi-title">Total Securities Issued</div>
          <div class="kpi-value">${securities.length} Instruments</div>
          <div class="kpi-subtext">CDR / BG Instruments</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🏦 Report 3: Bid Security, CDR Exposure & Bank Guarantee Utilization Ledger</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Security / CDR #</th>
                <th>Instrument Type</th>
                <th>Issuing Bank</th>
                <th>Amount (PKR)</th>
                <th>Tender Ref</th>
                <th>Expiry Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${securities.map(s => `
                <tr>
                  <td><strong>${s.security_number}</strong></td>
                  <td><span class="pill-source">${s.security_type || 'CDR / Bank Guarantee'}</span></td>
                  <td>${s.bank_name}</td>
                  <td><strong>PKR ${parseFloat(s.amount).toLocaleString()}</strong></td>
                  <td>${s.opportunity_number || 'Tender Bidding'}</td>
                  <td>${s.expiry_date}</td>
                  <td>
                    <span class="badge ${s.status === 'Active' ? 'badge-active' : 'badge-won'}">${s.status}</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'suppliers' ? `
      <!-- REPORT 4: SUPPLIER PERFORMANCE & DELIVERY FULFILLMENT -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid var(--primary);">
          <div class="kpi-title">Registered Suppliers</div>
          <div class="kpi-value">${suppliers.length} Vendors</div>
          <div class="kpi-subtext">Local & Global OEM Partners</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
          <div class="kpi-title">International Sourcing</div>
          <div class="kpi-value">${suppliers.filter(s => s.supplier_type === 'International Sourcing' || (s.country && s.country !== 'Pakistan')).length} Vendors</div>
          <div class="kpi-subtext">UAE, China, Germany, USA, UK</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Procurements Logged</div>
          <div class="kpi-value">${procurements.length} Orders</div>
          <div class="kpi-subtext">Total Landed Volume</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Average Landed Cost</div>
          <div class="kpi-value">PKR ${procurements.length > 0 ? (procurements.reduce((s, p) => s + parseFloat(p.total_landed_cost || 0), 0) / procurements.length).toLocaleString() : '0'}</div>
          <div class="kpi-subtext">Including customs & freight</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🌐 Report 4: Supplier Performance, Incoterms & International Procurement Fulfillment</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Supplier Name</th>
                <th>Type & Country</th>
                <th>Origin Port / City</th>
                <th>Incoterms</th>
                <th>Currency</th>
                <th>SWIFT / IBAN</th>
                <th>Rating</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${suppliers.map(s => `
                <tr>
                  <td><strong>${s.supplier_name}</strong></td>
                  <td>
                    <span class="pill-source">${s.supplier_type || 'Local'}</span><br>
                    <span style="font-size:0.75rem;">🌍 ${s.country || 'Pakistan'}</span>
                  </td>
                  <td>${s.origin_port || 'Karachi Port'}</td>
                  <td><span class="badge badge-sec-attached">${s.incoterms || 'FOB'}</span></td>
                  <td><strong>${s.currency || 'PKR'}</strong></td>
                  <td><code>${s.swift_code || s.bank_iban || '-'}</code></td>
                  <td>⭐ ${s.rating || '4.8'} / 5.0</td>
                  <td><span class="badge badge-won">${s.status || 'Active'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'winloss' ? `
      <!-- REPORT 5: WIN / LOSS & COMPETITOR INTELLIGENCE ANALYSIS -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid var(--primary);">
          <div class="kpi-title">Bidding Win Rate</div>
          <div class="kpi-value" style="color:#059669;">${winRatePct}%</div>
          <div class="kpi-subtext">${wonOppsCount} Won vs ${lostOppsCount} Lost</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Total Won Volume</div>
          <div class="kpi-value">PKR ${opps.filter(o => o.status === 'won').reduce((s, o) => s + parseFloat(o.estimated_value || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Contracted Project Value</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #dc2626;">
          <div class="kpi-title">Lost Tenders Volume</div>
          <div class="kpi-value">PKR ${opps.filter(o => o.status === 'loose').reduce((s, o) => s + parseFloat(o.estimated_value || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Competitor Capture</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Evaluations Tracked</div>
          <div class="kpi-value">${evals.length} Evaluations</div>
          <div class="kpi-subtext">With competitor benchmarking</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📉 Report 5: Win/Loss Analysis, Competitor Benchmarking & Grievance Ledger</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tender Reference</th>
                <th>Outcome / Stage</th>
                <th>Winning Competitor</th>
                <th>Winning Bid (PKR)</th>
                <th>Our Bid (PKR)</th>
                <th>Price Gap / Variance</th>
                <th>Grievance Status</th>
                <th>Evaluation Date</th>
              </tr>
            </thead>
            <tbody>
              ${evals.length === 0 ? `
                <tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">No competitor evaluations logged yet. Record a tender loss to populate benchmarking.</td></tr>
              ` : evals.map(ev => `
                <tr>
                  <td><strong>${ev.opportunity_id || 'Tender Ref'}</strong></td>
                  <td><span class="badge badge-withdraw">${ev.disqualification_stage || ev.loss_reason || 'Lost'}</span></td>
                  <td><strong>${ev.competitor_name || 'L1 Competitor'}</strong></td>
                  <td>PKR ${parseFloat(ev.competitor_bid_amount || 0).toLocaleString()}</td>
                  <td>PKR ${parseFloat(ev.our_bid_amount || 0).toLocaleString()}</td>
                  <td><strong style="color:#dc2626;">PKR ${parseFloat(ev.variance_amount || 0).toLocaleString()}</strong></td>
                  <td>
                    ${ev.grievance_filed ? `<span class="badge badge-hold">⚖️ ${ev.grievance_status || 'Under Review'}</span>` : '<span style="color:#64748b;">None</span>'}
                  </td>
                  <td>${ev.evaluation_date || 'Today'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'expenses' ? `
      <!-- REPORT 6: 3-TIER EXPENSE BREAKDOWN & COST ATTRIBUTION -->
      <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="kpi-card" style="border-left: 4px solid var(--primary);">
          <div class="kpi-title">Total Company Expenses</div>
          <div class="kpi-value">PKR ${expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">${expenses.length} Logged Items</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #0284c7;">
          <div class="kpi-title">🎯 Tier 1: Tender Pre-Bid Direct</div>
          <div class="kpi-value">PKR ${expenses.filter(e => e.expense_tier === 'Tier 1 - Tender Direct' || e.opportunity_id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Gifting, Samples, Lab Testing, Travel</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">🚚 Tier 2: PO Logistics & Freight</div>
          <div class="kpi-value">PKR ${expenses.filter(e => e.expense_tier === 'Tier 2 - PO Execution' || e.purchase_order_id || e.delivery_challan_id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">3PL Freight, Customs, Port Demurrage</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #64748b;">
          <div class="kpi-title">🏢 Tier 3: General Overheads</div>
          <div class="kpi-value">PKR ${expenses.filter(e => e.expense_tier === 'Tier 3 - General Overheads' || (!e.opportunity_id && !e.purchase_order_id && !e.delivery_challan_id)).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toLocaleString()}</div>
          <div class="kpi-subtext">Salaries, Rent, Utilities, Admin</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">💳 Report 6: 3-Tier Expense Breakdown & Project Cost Attribution Statement</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tier & Stage</th>
                <th>Expense Category</th>
                <th>Expense Title</th>
                <th>Amount (PKR)</th>
                <th>Paid To / Vendor</th>
                <th>Attributed Project / PO</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${expenses.map(e => `
                <tr>
                  <td><span class="badge badge-sec-attached">${e.expense_tier || e.expense_type || 'Direct'}</span></td>
                  <td><strong>${e.category}</strong></td>
                  <td>${e.expense_name}</td>
                  <td><strong style="color:#b45309;">PKR ${parseFloat(e.amount).toLocaleString()}</strong></td>
                  <td>${e.paid_to || 'Vendor'}</td>
                  <td>${e.opportunity_number || e.po_number || 'General Overhead'}</td>
                  <td>${e.expense_date}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${_activeReportTab === 'audit' ? `
      <!-- SYSTEM AUDIT TRAIL LEDGER -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📜 Immutable System Audit Trail & State Machine Transitions</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action Type</th>
                <th>Entity Type</th>
                <th>Entity Reference / ID</th>
                <th>Initiated By User</th>
                <th>Transition Summary</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.length === 0 ? `
                <tr>
                  <td>${new Date().toLocaleString()}</td>
                  <td><span class="badge badge-won">STATE_INIT</span></td>
                  <td>Tender & Sourcing Engine</td>
                  <td><code>SYS-INIT-2026</code></td>
                  <td><strong>naeem4it (SuperAdmin)</strong></td>
                  <td>Workflow engine initialized with 3-tier expenses and multi-PO distribution.</td>
                </tr>
              ` : auditLogs.map(l => `
                <tr>
                  <td>${new Date(l.created_at).toLocaleString()}</td>
                  <td><span class="badge badge-sec-attached">${l.action_type || 'UPDATE'}</span></td>
                  <td><strong>${l.entity_type}</strong></td>
                  <td><code>${l.entity_id || '-'}</code></td>
                  <td>${l.user_email || 'System User'}</td>
                  <td>${l.description || 'State transition verified.'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
}

// --------------------------------------------------------------------------
// 12. CUSTOMERS VIEW (SEPARATE DEDICATED SCREEN)
// --------------------------------------------------------------------------
async function renderCustomersHTML() {
  const customers = await API.getCustomers();

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <p style="color:var(--text-muted); font-size:0.9rem;">
        Government, Semi-Government, Autonomous, MNC & Private client accounts with NTN/STRN.
      </p>
      <button class="primary-btn" onclick="openModal('modal-add-customer')">+ Add New Customer</button>
    </div>

    <!-- Quick Master Stats -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Customer Accounts</div>
        <div class="kpi-value">${customers.length}</div>
        <div class="kpi-subtext">Registered buyers & agencies</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Government & Autonomous</div>
        <div class="kpi-value">${customers.filter(c => (c.org_type || c.customer_type || '').includes('Government') || (c.org_type || c.customer_type || '').includes('Autonomous')).length}</div>
        <div class="kpi-subtext">PPRA & DGP public clients</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">MNC & Private Corporate</div>
        <div class="kpi-value">${customers.filter(c => (c.org_type || c.customer_type || '').includes('MNC') || (c.org_type || c.customer_type || '').includes('Private')).length}</div>
        <div class="kpi-subtext">Direct commercial buyers</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Active Accounts</div>
        <div class="kpi-value">${customers.filter(c => c.status !== 'Inactive').length}</div>
        <div class="kpi-subtext">Eligible for tender bidding</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">👥 Customer Accounts Directory</div>
        <button class="primary-btn" onclick="openNewCustomerModal()">+ Register Customer</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Customer Name & Code</th>
              <th>Organization Type</th>
              <th>Department / Wing</th>
              <th>Tax Info (NTN/STRN)</th>
              <th>City & Province</th>
              <th>Payment Terms & Limit</th>
              <th>Contact Person</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${customers.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏛️ <strong>No customers registered yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Register Customer</strong> button above to register your first client department or commercial buyer.</span>
                </td>
              </tr>
            ` : customers.map(c => `
              <tr>
                <td>
                  <strong>${c.business_name}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${c.customer_code || 'CUST-' + (c.id ? c.id.slice(0, 6) : 'AUTO')}</span>
                </td>
                <td><span class="pill-source">${c.customer_type || c.org_type || 'Government Department'}</span></td>
                <td>${c.department_name || c.department || '—'}</td>
                <td>
                  <span style="font-size:0.82rem;">
                    <strong>NTN:</strong> ${c.ntn || 'N/A'}<br>
                    ${c.strn ? `<strong style="font-size:0.75rem; color:var(--text-muted);">STRN:</strong> ${c.strn}` : ''}
                  </span>
                </td>
                <td>${c.city || 'Lahore'}${c.province ? `, ${c.province}` : ''}</td>
                <td>
                  <span style="font-size:0.82rem;">
                    ${c.payment_terms || 'Net 30'}<br>
                    ${c.credit_limit ? `<strong style="color:#059669; font-size:0.75rem;">Limit: PKR ${Number(c.credit_limit).toLocaleString()}</strong>` : ''}
                  </span>
                </td>
                <td>
                  <span style="font-size:0.82rem;">
                    <strong>${c.contact_person || '—'}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${c.phone || c.email || ''}</span>
                  </span>
                </td>
                <td>
                  <span class="badge ${c.status === 'Inactive' ? 'badge-withdraw' : 'badge-won'}">
                    ${c.status || 'Active'}
                  </span>
                </td>
                <td>
                  <div style="display:flex; gap:6px;">
                    <button class="edit-btn" onclick="openEditCustomerModal('${c.id}')" title="Edit Customer Details">✏️ Edit</button>
                    <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="toggleCustomerStatus('${c.id}', '${c.status}')" title="Toggle Active / Inactive">
                      ${c.status === 'Inactive' ? '✓' : '⛔'}
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 13. SUPPLIERS VIEW (LOCAL & INTERNATIONAL PROCUREMENT REGISTRY)
// --------------------------------------------------------------------------
async function renderSuppliersHTML() {
  const suppliers = await API.getSuppliers();
  const intlCount = suppliers.filter(s => s.supplier_type === 'International Supplier' || s.origin === 'International').length;
  const localCount = suppliers.length - intlCount;

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Registered Vendors</div>
        <div class="kpi-value">${suppliers.length}</div>
        <div class="kpi-subtext">Approved OEMs & vendors</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
        <div class="kpi-title">International Suppliers (Import)</div>
        <div class="kpi-value">${intlCount}</div>
        <div class="kpi-subtext">Foreign OEMs & trading partners</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Local Suppliers (Pakistan)</div>
        <div class="kpi-value">${localCount}</div>
        <div class="kpi-subtext">Domestic manufacturers & distributors</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">5-Star Premier Partners</div>
        <div class="kpi-value">${suppliers.filter(s => (s.rating || 5) >= 5).length}</div>
        <div class="kpi-subtext">Top-rated fulfillment partners</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🏭 Local & International Supplier Registry</div>
        <button class="primary-btn" onclick="openNewSupplierModal()">+ Register Supplier</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Supplier Name & Code</th>
              <th>Type & Country of Origin</th>
              <th>Origin Port & Currency</th>
              <th>Commercial Terms (Incoterms)</th>
              <th>Rating</th>
              <th>Bank & SWIFT Code</th>
              <th>Contact Person & Info</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${suppliers.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏭 <strong>No suppliers registered yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Register Supplier</strong> button above to add your local and international manufacturers, OEMs, and stockists.</span>
                </td>
              </tr>
            ` : suppliers.map(s => {
              const isIntl = (s.supplier_type === 'International Supplier' || s.origin === 'International');
              return `
                <tr>
                  <td>
                    <strong>${s.supplier_name}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${s.supplier_code || 'SUP-' + (s.id ? s.id.slice(0, 6) : 'AUTO')}</span>
                  </td>
                  <td>
                    <span class="pill-source" style="${isIntl ? 'background:#e0e7ff; color:#3730a3;' : ''}">
                      ${isIntl ? '🌐 Import (Intl)' : '🇵🇰 Local (PK)'}
                    </span><br>
                    <span style="font-size:0.8rem; font-weight:600;">${s.country || 'Pakistan'}</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      <strong>${s.origin_port_city || s.city || 'Karachi Port'}</strong><br>
                      <span class="badge badge-sec-attached">${s.currency || 'PKR'}</span>
                    </span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      <strong>${s.incoterms || 'FOB'}</strong> | ${s.payment_terms || 'Net 30'}<br>
                      <span style="font-size:0.75rem; color:var(--text-muted);">${s.product_categories || 'General Supply'}</span>
                    </span>
                  </td>
                  <td>
                    <span style="color:#f59e0b; font-size:0.95rem;">${'★'.repeat(s.rating || 5)}</span>
                  </td>
                  <td>
                    <span style="font-size:0.78rem;">
                      ${s.bank_name ? `<strong>${s.bank_name}</strong><br>` : ''}
                      ${s.bank_swift ? `<code>SWIFT: ${s.bank_swift}</code>` : (s.bank_iban ? `<code>IBAN: ${s.bank_iban.slice(0, 10)}...</code>` : '—')}
                    </span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      <strong>${s.contact_person || '—'}</strong><br>
                      <span style="font-size:0.75rem; color:var(--text-muted);">${s.phone || s.email || ''}</span>
                    </span>
                  </td>
                  <td>
                    <span class="badge ${s.status === 'Inactive' ? 'badge-withdraw' : 'badge-won'}">
                      ${s.status || 'Active'}
                    </span>
                  </td>
                  <td>
                    <div style="display:flex; gap:6px;">
                      <button class="edit-btn" onclick="openEditSupplierModal('${s.id}')" title="Edit Supplier Details">✏️ Edit</button>
                      <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="toggleSupplierStatus('${s.id}', '${s.status}')" title="Toggle Active / Inactive">
                        ${s.status === 'Inactive' ? '✓' : '⛔'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 14. PRODUCTS / ITEMS MASTER CATALOG VIEW
// --------------------------------------------------------------------------
async function renderProductsHTML() {
  const products = await API.getProducts();
  const suppliers = await API.getSuppliers();
  const totalStockItems = products.reduce((sum, p) => sum + (parseFloat(p.current_stock) || 0), 0);
  const reorderAlerts = products.filter(p => (parseFloat(p.current_stock) || 0) <= (parseFloat(p.reorder_level) || 10)).length;

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Master Catalog SKUs</div>
        <div class="kpi-value">${products.length}</div>
        <div class="kpi-subtext">Registered product lines</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Total Units in Stock</div>
        <div class="kpi-value">${totalStockItems.toLocaleString()}</div>
        <div class="kpi-subtext">Consolidated warehouse balance</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid ${reorderAlerts > 0 ? '#ef4444' : '#10b981'};">
        <div class="kpi-title">Reorder Level Alerts</div>
        <div class="kpi-value">${reorderAlerts}</div>
        <div class="kpi-subtext">${reorderAlerts > 0 ? 'Low stock items requiring PO' : 'All items sufficiently stocked'}</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">Active Sourcing Partners</div>
        <div class="kpi-value">${suppliers.length}</div>
        <div class="kpi-subtext">Mapped OEM suppliers</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">📦 Master Product & Item SKU Catalog</div>
        <button class="primary-btn" onclick="openNewProductModal()">+ Add Master Item</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>SKU / Item Code</th>
              <th>Item Name & Specifications</th>
              <th>Type & UOM</th>
              <th>Country & HS Code</th>
              <th>Landed Cost Price</th>
              <th>Benchmark Selling Rate</th>
              <th>Current Stock</th>
              <th>Preferred Supplier</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${products.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
                  📦 <strong>No products or items in catalog yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Add Master Item</strong> button above to register your inventory items, electrical equipment, and SKUs.</span>
                </td>
              </tr>
            ` : products.map(p => {
              const sup = suppliers.find(s => s.id === p.default_supplier_id || s.id === p.supplier_id);
              const isLowStock = (parseFloat(p.current_stock) || 0) <= (parseFloat(p.reorder_level) || 10);
              return `
                <tr>
                  <td><strong><code>${p.sku || 'SKU'}</code></strong></td>
                  <td>
                    <strong>${p.name}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${p.description ? p.description.slice(0, 50) + '...' : ''}</span>
                  </td>
                  <td>
                    <span class="badge badge-sec-attached">${p.item_type || 'Product'}</span><br>
                    <span style="font-size:0.8rem; font-weight:600;">${p.unit || 'PCS'}</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      ${p.country_of_origin || 'Pakistan'}<br>
                      ${p.hs_code ? `<code>HS: ${p.hs_code}</code>` : ''}
                    </span>
                  </td>
                  <td>
                    <span style="font-weight:600;">PKR ${parseFloat(p.cost_price || 0).toLocaleString()}</span><br>
                    ${p.cost_price_foreign && p.currency && p.currency !== 'PKR' ? `<span style="font-size:0.72rem; color:var(--text-muted);">${p.currency} ${parseFloat(p.cost_price_foreign).toLocaleString()}</span>` : ''}
                  </td>
                  <td><strong>PKR ${parseFloat(p.selling_price || 0).toLocaleString()}</strong></td>
                  <td>
                    <span class="badge ${isLowStock ? 'badge-withdraw' : 'badge-won'}">
                      ${p.current_stock || 0} ${p.unit || 'PCS'}
                    </span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem; font-weight:600; color:var(--primary);">
                      ${sup ? sup.supplier_name : (p.supplier_name || '—')}
                    </span>
                  </td>
                  <td>
                    <button class="edit-btn" onclick="openEditProductModal('${p.id}')">✏️ Edit</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 15. BUSINESS PROFILES & MULTI-COMPANY VIEW
// --------------------------------------------------------------------------
async function renderBusinessProfilesHTML() {
  const profiles = await API.getBusinessProfiles();

  return `
    <div class="company-limit-banner">
      <div>
        <strong>Multi-Company Policy:</strong> You can configure up to <strong>2 companies for free</strong>. Additional company profiles incur <strong>PKR 2,500/month</strong>.
      </div>
      <button class="secondary-btn" style="background:white;" onclick="openModal('modal-add-company')">+ Add Company Profile</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🏢 Configured Companies (${profiles.length} Active Profiles)</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Business Name</th>
              <th>Legal Entity Name</th>
              <th>NTN</th>
              <th>STRN</th>
              <th>City</th>
              <th>FBR PRAL</th>
              <th>Tier Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${profiles.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏢 <strong>No business entities configured yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Add Company Profile</strong> button above to register your organization's first company profile.</span>
                </td>
              </tr>
            ` : profiles.map((p, idx) => `
              <tr>
                <td><strong>${p.business_name}</strong></td>
                <td>${p.legal_name || p.business_name}</td>
                <td>${p.ntn || 'N/A'}</td>
                <td>${p.strn || 'N/A'}</td>
                <td>${p.city || 'Lahore'}</td>
                <td><span class="badge ${p.fbr_enabled ? 'badge-fbr' : 'badge-withdraw'}">${p.fbr_enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                  ${idx < 2 ? `<span class="badge badge-won">Free Tier Included</span>` : `<span class="badge badge-hold">Paid Add-on (PKR 2,500/mo)</span>`}
                </td>
                <td>
                  <button class="edit-btn" onclick="openEditEntityModal('business-profile', '${p.id}')">✏️ Edit</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 16. USERS & RBAC VIEW
// --------------------------------------------------------------------------
async function renderUsersHTML() {
  const isSuper = State.isSuperAdmin();
  const res = await API.getUsersWithStats();
  const rawUsers = (res && res.data && res.data.length > 0) ? res.data : State.getStoredUsers();
  const currentTid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;

  // Strict Tenant Scoping: Client Admin only sees their own tenant's users
  const userList = isSuper ? rawUsers : rawUsers.filter(u => {
    const uTid = u.tenant?.id || u.tenant_id;
    return (uTid && uTid === currentTid) || (u.tenant_name && u.tenant_name === State.currentUser?.tenant_name) || u.id === State.currentUser?.id;
  });

  const tenants = (res && res.tenants && res.tenants.length > 0) ? res.tenants : State.getTenants();

  const seatStats = res?.seatStats || {
    freeLimit: 2,
    usedEmployees: userList.filter(u => u.role === 'ClientEmployee').length,
    paidEmployees: Math.max(0, userList.filter(u => u.role === 'ClientEmployee').length - 2),
    additionalMonthlyFee: 1500.00
  };

  if (isSuper) {
    // SUPER ADMIN VIEW: Global Tenants & System Users
    return `
      <!-- Super Admin Quick Stats & Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <span class="seat-counter-badge" style="background:#eff6ff; color:#1d4ed8; border-color:#93c5fd;">
            👑 <strong>Super Admin Mode</strong> (Full Access to All Tenants & Modules)
          </span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="primary-btn" onclick="openModal('modal-create-tenant')">
            🏢 + Provision New Tenant & Admin
          </button>
          <button class="secondary-btn" onclick="openCreateUserModal('SuperAdmin')">
            👑 + Add System Super Admin
          </button>
        </div>
      </div>

      <!-- Tenants Overview Card -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <div class="card-title">🏢 Active Tenant Organizations (${tenants.length})</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tenant Organization</th>
                <th>Subdomain</th>
                <th>Plan Tier</th>
                <th>Companies</th>
                <th>Users</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tenants.map(t => `
                <tr>
                  <td><strong>${t.company_name || t.name}</strong></td>
                  <td><span class="pill-source">${t.subdomain || 'app'}.mashrue.com</span></td>
                  <td><span class="badge badge-won">${t.subscription_plan || 'Standard'}</span></td>
                  <td>${t.company_count || 1} / 2 Free</td>
                  <td>${t.user_count || 1} Active</td>
                  <td><span class="badge badge-sec-attached">${t.status || 'Active'}</span></td>
                  <td>
                    <button class="secondary-btn" style="padding:4px 8px; font-size:0.78rem;" onclick="alert('Manage Tenant: ${t.company_name}')">Manage</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- All System Users Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">👥 All System Users (${userList.length})</div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>User Full Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Tenant Organization</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${userList.map(u => `
                <tr>
                  <td><strong>${u.full_name || u.username}</strong></td>
                  <td><code>${u.username}</code></td>
                  <td>${u.email}</td>
                  <td>
                    <span class="badge ${u.role === 'SuperAdmin' ? 'badge-sec-missing' : u.role === 'ClientAdmin' ? 'badge-won' : 'badge-sec-attached'}">
                      ${u.role}
                    </span>
                  </td>
                  <td>${u.tenant_name || u.tenant?.name || 'System / Platform'}</td>
                  <td><span class="badge ${u.status === 'Active' ? 'badge-won' : 'badge-withdraw'}">${u.status || 'Active'}</span></td>
                  <td>
                    <button class="edit-btn" onclick="openResetPasswordModal('${u.id}', '${u.username}')">🔑 Reset Pass</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // CLIENT ADMIN VIEW: Tenant Employee Management & Granular RBAC
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <span class="seat-counter-badge">
          👥 Employee Seats: <strong>${seatStats.usedEmployees} / ${seatStats.freeLimit} Free Used</strong>
        </span>
        ${seatStats.paidEmployees > 0 ? `
          <span class="badge badge-hold" style="padding: 5px 10px;">
            💰 ${seatStats.paidEmployees} Paid Seat(s) active (+PKR ${(seatStats.paidEmployees * seatStats.additionalMonthlyFee).toLocaleString()}/mo)
          </span>
        ` : ''}
      </div>
      <button class="primary-btn" onclick="openCreateUserModal('ClientEmployee')">
        👤 + Add Employee User
      </button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">👥 Organization Employees & Access Control (${userList.length})</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Bidding Prices</th>
              <th>Company Access</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${userList.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:#64748b;">
                  👥 <strong>No employee users added yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Add Employee User</strong> button above to invite your team members (2 Free Seats included).</span>
                </td>
              </tr>
            ` : userList.map(u => {
              const compAccessNames = (u.business_access && u.business_access.length > 0)
                ? u.business_access.map(b => b.name).join(', ')
                : 'All Assigned Companies';

              return `
                <tr>
                  <td><strong>${u.full_name}</strong></td>
                  <td><code>${u.username || '—'}</code></td>
                  <td>${u.email}</td>
                  <td><span class="badge ${u.role === 'ClientAdmin' || u.role === 'CompanyAdmin' ? 'badge-won' : 'badge-ready'}">${u.role === 'ClientAdmin' ? 'Tenant Admin' : 'Employee'}</span></td>
                  <td>
                    <span class="badge ${u.can_see_bidding_prices !== false ? 'badge-won' : 'badge-hold'}">
                      ${u.can_see_bidding_prices !== false ? '🔓 Visible' : '🔒 Masked (Hidden)'}
                    </span>
                  </td>
                  <td><span style="font-size: 0.82rem; color: #475569;">${compAccessNames}</span></td>
                  <td><span class="badge badge-active">${u.status || 'Active'}</span></td>
                  <td>
                    <div class="action-buttons-group">
                      <button class="edit-btn" onclick="openResetPasswordModal('${u.id}', '${u.full_name}')" title="Reset Password">🔑 Reset Pass</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 17. SETTINGS & FBR CONFIGURATION
// --------------------------------------------------------------------------
function renderSettingsHTML() {
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">⚙️ FBR PRAL Digital Invoicing Gateway Configuration</div>
      </div>
      <div class="card-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">FBR Environment</label>
            <select class="form-select">
              <option value="Sandbox" selected>Sandbox Gateway (https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb)</option>
              <option value="Production">Production Live Gateway (https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Seller NTN</label>
            <input type="text" class="form-input" value="492019-1">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">PRAL Bearer Token</label>
          <input type="password" class="form-input" value="pral_sec_token_992019842">
        </div>
        <button class="primary-btn">💾 Save Gateway Configuration</button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// COSTING CALCULATOR SETUP
// --------------------------------------------------------------------------
function renderCostingCalculatorHTML() {
  return `
    <div class="calc-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">💰 Direct Cost Breakdown</div>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Supplier / Product Cost (PKR)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-sup-cost" value="10000000">
          </div>
          <div class="form-group">
            <label class="form-label">Logistics & 3PL Freight (PKR)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-log-cost" value="800000">
          </div>
          <div class="form-group">
            <label class="form-label">Labor & Site Commissioning (PKR)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-lab-cost" value="700000">
          </div>
          <div class="form-group">
            <label class="form-label">Allocated Overhead (PKR)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-ovh-cost" value="500000">
          </div>
          <div class="form-group">
            <label class="form-label">Tender Expenses & Bid Security (PKR)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-exp-cost" value="290000">
          </div>
          <div class="form-group">
            <label class="form-label">Desired Markup (%)</label>
            <input type="number" class="form-input cost-calc-input" id="calc-markup-pct" value="18.5" step="0.5">
          </div>
        </div>
      </div>

      <div class="calc-summary-panel">
        <div>
          <h3 style="font-size:1.2rem; font-weight:700; margin-bottom:16px;">Live Margin & Price Summary</h3>
          <div class="calc-row">
            <span>Total Estimated Cost:</span>
            <strong id="disp-total-cost">PKR 12,290,000</strong>
          </div>
          <div class="calc-row">
            <span>Markup Rate:</span>
            <strong id="disp-markup-rate">18.5%</strong>
          </div>
          <div class="calc-row">
            <span>Projected Gross Profit:</span>
            <strong id="disp-profit-amt" style="color:#10b981;">PKR 2,273,650</strong>
          </div>
          <div class="calc-row">
            <span>Gross Profit Margin %:</span>
            <strong id="disp-margin-pct">15.6%</strong>
          </div>
        </div>

        <div class="calc-total-box">
          <span style="font-size:0.85rem; text-transform:uppercase; color:#94a3b8;">Recommended Bid Submission Price</span>
          <div class="calc-final-price" id="disp-final-bid-price">PKR 14,563,650</div>
        </div>
      </div>
    </div>
  `;
}

function setupCostingCalculator() {
  const inputs = document.querySelectorAll('.cost-calc-input');
  inputs.forEach(input => {
    input.addEventListener('input', recalculateCostSheet);
  });
  recalculateCostSheet();
}

function recalculateCostSheet() {
  const sup = parseFloat(document.getElementById('calc-sup-cost')?.value || 0);
  const log = parseFloat(document.getElementById('calc-log-cost')?.value || 0);
  const lab = parseFloat(document.getElementById('calc-lab-cost')?.value || 0);
  const ovh = parseFloat(document.getElementById('calc-ovh-cost')?.value || 0);
  const exp = parseFloat(document.getElementById('calc-exp-cost')?.value || 0);
  const markup = parseFloat(document.getElementById('calc-markup-pct')?.value || 0);

  const totalCost = sup + log + lab + ovh + exp;
  const profit = (totalCost * markup) / 100;
  const finalPrice = totalCost + profit;
  const marginPct = finalPrice > 0 ? ((profit / finalPrice) * 100) : 0;

  const totalCostEl = document.getElementById('disp-total-cost');
  const markupRateEl = document.getElementById('disp-markup-rate');
  const profitAmtEl = document.getElementById('disp-profit-amt');
  const marginPctEl = document.getElementById('disp-margin-pct');
  const finalPriceEl = document.getElementById('disp-final-bid-price');

  if (totalCostEl) totalCostEl.innerText = `PKR ${totalCost.toLocaleString()}`;
  if (markupRateEl) markupRateEl.innerText = `${markup}%`;
  if (profitAmtEl) profitAmtEl.innerText = `PKR ${profit.toLocaleString()}`;
  if (marginPctEl) marginPctEl.innerText = `${marginPct.toFixed(1)}%`;
  if (finalPriceEl) finalPriceEl.innerText = `PKR ${finalPrice.toLocaleString()}`;
}

// --------------------------------------------------------------------------
// IN-PLACE QUICK-ADD & MODAL STACKING ENGINE
// --------------------------------------------------------------------------

let _quickAddContext = null;

function openQuickAddModal(entityType, targetSelectId) {
  _quickAddContext = {
    entityType,
    targetSelectId
  };

  let modalId = '';
  switch (entityType) {
    case 'customer':
      modalId = 'modal-add-customer';
      openNewCustomerModal();
      break;
    case 'supplier':
      modalId = 'modal-add-supplier';
      openNewSupplierModal();
      break;
    case 'product':
    case 'item':
      modalId = 'modal-add-product';
      openNewProductModal();
      break;
    case 'warehouse':
      modalId = 'modal-add-warehouse';
      openNewWarehouseModal();
      break;
    case 'company':
    case 'businessProfile':
      modalId = 'modal-add-company';
      openModal('modal-add-company');
      break;
    default:
      console.warn('Unknown quick add entity type:', entityType);
      return;
  }

  const modalEl = document.getElementById(modalId);
  if (modalEl) {
    modalEl.classList.add('modal-nested');
    modalEl.classList.add('open');
  }
}

async function handleQuickAddCompletion(entityType, createdItem) {
  if (!createdItem) return;

  const targetSelectId = _quickAddContext?.targetSelectId;
  const targetSelect = targetSelectId ? document.getElementById(targetSelectId) : null;

  // 1. Refresh all matching select dropdowns in DOM
  if (entityType === 'customer') {
    const customers = await API.getCustomers();
    document.querySelectorAll('select[id*="customer"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = customers.map(c => `<option value="${c.id}">${c.business_name} (${c.customer_type || c.org_type || 'Customer'})</option>`).join('');
      if (curVal) sel.value = curVal;
    });
  } else if (entityType === 'supplier') {
    const suppliers = await API.getSuppliers();
    document.querySelectorAll('select[id*="supplier"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = `<option value="">-- Select Preferred Supplier --</option>` + suppliers.map(s => `<option value="${s.id}">${s.supplier_name} (${s.country || 'Pakistan'})</option>`).join('');
      if (curVal) sel.value = curVal;
    });
  } else if (entityType === 'product' || entityType === 'item') {
    const products = await API.getProducts();
    document.querySelectorAll('select[id*="item-select"], select[id*="product-select"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = `<option value="">-- Choose item to auto-fill --</option>` + products.map(p => `
        <option value="${p.id}" data-name="${p.name}" data-desc="${p.description || ''}" data-unit="${p.unit || 'PCS'}" data-price="${p.selling_price || 0}">
          ${p.name} (Stock: ${p.current_stock || 0} ${p.unit})
        </option>
      `).join('');
      if (curVal) sel.value = curVal;
    });
  } else if (entityType === 'warehouse') {
    const warehouses = await API.getWarehouses();
    document.querySelectorAll('select[id*="warehouse"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = `<option value="">-- Select Warehouse --</option>` + warehouses.map(w => `<option value="${w.id}">${w.warehouse_name} (${w.city || 'Location'})</option>`).join('');
      if (curVal) sel.value = curVal;
    });
  } else if (entityType === 'company' || entityType === 'businessProfile') {
    const profiles = await API.getBusinessProfiles();
    document.querySelectorAll('select[id*="business-profile"], select[id*="company"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = profiles.map(p => `<option value="${p.id}">${p.business_name}</option>`).join('');
      if (curVal) sel.value = curVal;
    });
  }

  // 2. Set newly created item value and trigger change event
  if (targetSelect) {
    targetSelect.value = createdItem.id;
    targetSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Apply pulse highlight animation
    targetSelect.classList.remove('quick-add-highlight');
    void targetSelect.offsetWidth;
    targetSelect.classList.add('quick-add-highlight');
    setTimeout(() => targetSelect.classList.remove('quick-add-highlight'), 2200);
  }

  _quickAddContext = null;
}

function openModal(id) {
  if (id === 'modal-add-expense') {
    openExpenseModal();
    return;
  }
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    el.classList.remove('modal-nested');
  }
}

function navigateToView(view) {
  const item = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (item) item.click();
}

async function openNewTenderModal() {
  const customers = await API.getCustomers();
  const profiles = await API.getBusinessProfiles();
  const products = await API.getProducts();

  const custSelect = document.getElementById('tender-customer');
  const profSelect = document.getElementById('tender-business-profile');
  const itemSelect = document.getElementById('tender-item-select');

  if (custSelect) {
    custSelect.innerHTML = customers.map(c => `<option value="${c.id}">${c.business_name} (${c.org_type})</option>`).join('');
  }
  if (profSelect) {
    profSelect.innerHTML = profiles.map(p => `<option value="${p.id}">${p.business_name}</option>`).join('');
  }
  if (itemSelect) {
    itemSelect.innerHTML = `<option value="">-- Choose item to auto-fill --</option>` + products.map(p => `
      <option value="${p.id}" data-name="${p.name}" data-desc="${p.description || ''}" data-unit="${p.unit || 'PCS'}" data-price="${p.selling_price || 0}">
        ${p.name} (Stock: ${p.current_stock || 0} ${p.unit})
      </option>
    `).join('');
  }

  openModal('modal-add-tender');
}

function autoPopulateTenderItemDetails(productId) {
  const itemSelect = document.getElementById('tender-item-select');
  if (!itemSelect) return;
  const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
  if (!selectedOpt || !selectedOpt.value) return;

  const name = selectedOpt.dataset.name;
  const desc = selectedOpt.dataset.desc;
  const unit = selectedOpt.dataset.unit;
  const price = selectedOpt.dataset.price;

  const descEl = document.getElementById('tender-item-desc');
  const unitEl = document.getElementById('tender-item-unit');
  const priceEl = document.getElementById('tender-item-price');

  if (descEl) descEl.value = desc || name;
  if (unitEl) unitEl.value = unit;
  if (priceEl) priceEl.value = price;
}

async function submitNewTenderForm() {
  const tenderName = document.getElementById('tender-name')?.value;
  const source = document.getElementById('tender-source')?.value;
  const custId = document.getElementById('tender-customer')?.value;
  const bizId = document.getElementById('tender-business-profile')?.value;
  const estVal = document.getElementById('tender-est-value')?.value;
  const closing = document.getElementById('tender-closing-date')?.value;
  const desc = document.getElementById('tender-description')?.value;

  const itemSelect = document.getElementById('tender-item-select');
  const itemDesc = document.getElementById('tender-item-desc')?.value;
  const itemQty = document.getElementById('tender-item-qty')?.value;
  const itemUnit = document.getElementById('tender-item-unit')?.value;
  const itemPrice = document.getElementById('tender-item-price')?.value;

  if (!tenderName) {
    alert('Tender Name is mandatory');
    return;
  }

  const items = [];
  if (itemDesc) {
    items.push({
      product_service_id: itemSelect?.value || null,
      item_name: tenderName,
      item_description: itemDesc,
      quantity: parseFloat(itemQty || 1),
      unit: itemUnit || 'PCS',
      estimated_unit_price: parseFloat(itemPrice || 0)
    });
  }

  const res = await API.createOpportunity({
    tender_name: tenderName,
    title: tenderName,
    tender_source: source,
    customer_id: custId,
    business_profile_id: bizId,
    estimated_value: estVal,
    closing_date: closing,
    description: desc,
    items: items
  });

  closeModal('modal-add-tender');

  // Immediately prompt mandatory Bid Security modal
  promptAttachBidSecurity(res.data?.id || 'new-opp', tenderName);
}

function promptAttachBidSecurity(oppId, tenderNameDecoded) {
  const name = decodeURIComponent(tenderNameDecoded);
  document.getElementById('sec-opportunity-id').value = oppId;
  document.getElementById('sec-opp-title').value = name;
  openModal('modal-add-bid-security');
}

async function submitBidSecurityForm() {
  const oppId = document.getElementById('sec-opportunity-id')?.value;
  const accountTitle = document.getElementById('sec-account-title')?.value;
  const beneficiary = document.getElementById('sec-beneficiary')?.value;
  const instrumentType = document.getElementById('sec-instrument-type')?.value;
  const instrumentNo = document.getElementById('sec-instrument-no')?.value;
  const amount = document.getElementById('sec-amount')?.value;
  const expiryDate = document.getElementById('sec-expiry-date')?.value;
  const bankName = document.getElementById('sec-bank-name')?.value;
  const comments = document.getElementById('sec-comments')?.value;

  if (!accountTitle || !beneficiary || !instrumentType || !instrumentNo || !amount || !expiryDate) {
    alert('All first 6 fields are mandatory (Account Title, Beneficiary, Instrument Type, Instrument Number, Amount, Expiry Date).');
    return;
  }

  await API.createBidSecurity({
    opportunity_id: oppId,
    account_title: accountTitle,
    beneficiary: beneficiary,
    instrument_type: instrumentType,
    instrument_number: instrumentNo,
    amount: amount,
    expiry_date: expiryDate,
    bank_name: bankName,
    comments: comments
  });

  closeModal('modal-add-bid-security');
  alert('Bid Security successfully attached! Tender is now Ready to Submit.');
  await renderActiveView();
}

async function handleReleaseBidSecurity(id) {
  const ref = prompt('Enter release reference number or letter note:', 'Release Handover Form # 104');
  if (ref) {
    await API.releaseBidSecurity(id, ref);
    alert('Bid Security has been marked as Released.');
    await renderActiveView();
  }
}

async function handleTenderSelection(id, status) {
  const reason = prompt(`Enter remarks for marking tender as ${status}:`, status === 'Selected' ? 'Approved by Bid Committee' : 'Unfavorable payment terms');
  if (reason !== null) {
    await API.selectOpportunity(id, status, reason);
    await renderActiveView();
  }
}

async function handleBidSubmission(oppId) {
  const res = await API.getBids(State.currentBusinessProfileId);
  const bid = res.find(b => b.opportunity_id === oppId);
  if (bid) {
    await API.submitBid(bid.id, { submission_method: 'Online Portal' });
    alert('Bid submitted successfully with attached Bid Security!');
  } else {
    // Demo auto-submit
    alert('Bid submitted successfully with attached Bid Security!');
  }
  await renderActiveView();
}

function promptWonBid(oppId, tenderNameDecoded) {
  promptAwardLetterModal(oppId, tenderNameDecoded);
}

let _cachedAwardTenderItems = [];

async function promptAwardLetterModal(oppId, tenderNameDecoded) {
  const name = decodeURIComponent(tenderNameDecoded);
  document.getElementById('award-opp-id').value = oppId;
  const oppTitleEl = document.getElementById('award-opp-title');
  if (oppTitleEl) oppTitleEl.innerText = name;
  document.getElementById('award-no').value = 'LOA-' + (name.slice(0, 5).toUpperCase().replace(/[^A-Z]/g, 'WAPDA')) + '-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900);
  document.getElementById('award-date').value = new Date().toISOString().slice(0, 10);
  
  const d = new Date();
  d.setDate(d.getDate() + 10);
  document.getElementById('award-deadline').value = d.toISOString().slice(0, 10);

  // Fetch line items for this opportunity
  const opps = State.getTenantEntityList('opportunities');
  const targetOpp = opps.find(o => o.id === oppId);
  const bids = State.getTenantEntityList('bids');
  const targetBid = bids.find(b => b.opportunity_id === oppId);

  let items = [];
  if (targetOpp && targetOpp.items && targetOpp.items.length > 0) {
    items = targetOpp.items;
  } else if (targetBid && targetBid.items && targetBid.items.length > 0) {
    items = targetBid.items;
  } else {
    items = [
      {
        id: 'it-1',
        item_name: name,
        item_description: name + ' (Primary Scope / Lot 1)',
        quantity: 1,
        unit: 'LOT',
        estimated_unit_price: parseFloat(targetOpp?.estimated_value || 14500000)
      }
    ];
  }
  _cachedAwardTenderItems = items;

  const tbody = document.getElementById('award-items-tbody');
  if (tbody) {
    tbody.innerHTML = items.map((it, idx) => `
      <tr id="award-row-${idx}">
        <td style="text-align: center;">
          <input type="checkbox" id="award-item-check-${idx}" checked onchange="updateAwardItemsTotal()">
        </td>
        <td>
          <strong>${it.item_name || it.item_description || 'Item Scope'}</strong>
          <input type="hidden" id="award-item-name-${idx}" value="${(it.item_name || it.item_description || '').replace(/"/g, '&quot;')}">
          <input type="hidden" id="award-item-prod-id-${idx}" value="${it.product_service_id || ''}">
        </td>
        <td>
          <span style="font-weight: 600;">${it.quantity || 1} ${it.unit || 'PCS'}</span>
          <input type="hidden" id="award-item-tender-qty-${idx}" value="${it.quantity || 1}">
          <input type="hidden" id="award-item-unit-${idx}" value="${it.unit || 'PCS'}">
        </td>
        <td>
          <input type="number" class="form-input" id="award-item-qty-${idx}" value="${it.quantity || 1}" min="0" max="${it.quantity || 999999}" step="any" style="width: 100px; padding: 4px 6px;" oninput="updateAwardItemsTotal()">
        </td>
        <td>${it.unit || 'PCS'}</td>
        <td>
          <input type="number" class="form-input" id="award-item-rate-${idx}" value="${it.estimated_unit_price || it.unit_price || 0}" min="0" step="any" style="width: 130px; padding: 4px 6px;" oninput="updateAwardItemsTotal()">
        </td>
        <td>
          <strong id="award-item-total-${idx}" style="color: #059669;">PKR ${((it.quantity || 1) * (it.estimated_unit_price || it.unit_price || 0)).toLocaleString()}</strong>
        </td>
      </tr>
    `).join('');
  }

  updateAwardItemsTotal();
  openModal('modal-add-award');
}

function updateAwardItemsTotal() {
  let grandTotal = 0;
  _cachedAwardTenderItems.forEach((it, idx) => {
    const isChecked = document.getElementById(`award-item-check-${idx}`)?.checked;
    const qtyInput = document.getElementById(`award-item-qty-${idx}`);
    const rateInput = document.getElementById(`award-item-rate-${idx}`);
    const totalEl = document.getElementById(`award-item-total-${idx}`);

    if (isChecked && qtyInput && rateInput) {
      const qty = parseFloat(qtyInput.value) || 0;
      const rate = parseFloat(rateInput.value) || 0;
      const lineTotal = qty * rate;
      grandTotal += lineTotal;
      if (totalEl) totalEl.innerText = `PKR ${lineTotal.toLocaleString()}`;
      if (qtyInput) qtyInput.disabled = false;
      if (rateInput) rateInput.disabled = false;
    } else {
      if (totalEl) totalEl.innerText = 'PKR 0 (Lost / Dropped)';
      if (qtyInput) qtyInput.disabled = true;
      if (rateInput) rateInput.disabled = true;
    }
  });

  const amtInput = document.getElementById('award-amount');
  if (amtInput) amtInput.value = grandTotal;
}

function calculatePBGRequirement(pct) {
  // Visual helper
}

async function submitAwardLetterForm() {
  const oppId = document.getElementById('award-opp-id')?.value;
  const awardNo = document.getElementById('award-no')?.value;
  const awardDate = document.getElementById('award-date')?.value;
  const awardAmount = document.getElementById('award-amount')?.value;
  const deadline = document.getElementById('award-deadline')?.value;
  const pbgPct = document.getElementById('award-pbg-pct')?.value;
  const remarks = document.getElementById('award-remarks')?.value;

  if (!awardNo || !awardAmount || parseFloat(awardAmount) <= 0) {
    alert('Award Number and at least one Awarded Item with positive value are mandatory.');
    return;
  }

  // Collect item-level awards
  const awardItems = [];
  _cachedAwardTenderItems.forEach((it, idx) => {
    const isChecked = document.getElementById(`award-item-check-${idx}`)?.checked;
    const itemName = document.getElementById(`award-item-name-${idx}`)?.value;
    const prodId = document.getElementById(`award-item-prod-id-${idx}`)?.value;
    const tenderQty = parseFloat(document.getElementById(`award-item-tender-qty-${idx}`)?.value || 1);
    const unit = document.getElementById(`award-item-unit-${idx}`)?.value;
    const awardedQty = isChecked ? parseFloat(document.getElementById(`award-item-qty-${idx}`)?.value || 0) : 0;
    const awardedRate = isChecked ? parseFloat(document.getElementById(`award-item-rate-${idx}`)?.value || 0) : 0;

    awardItems.push({
      id: 'ai-' + Date.now() + '-' + idx,
      product_service_id: prodId || null,
      item_name: itemName,
      item_description: itemName,
      tender_quantity: tenderQty,
      bid_quantity: tenderQty,
      awarded_quantity: awardedQty,
      unit: unit || 'PCS',
      awarded_unit_price: awardedRate,
      awarded_total_price: awardedQty * awardedRate,
      is_awarded: Boolean(isChecked && awardedQty > 0)
    });
  });

  const opps = State.getTenantEntityList('opportunities');
  const targetOpp = opps.find(o => o.id === oppId);
  const customers = await API.getCustomers();
  const targetCust = customers.find(c => c.id === targetOpp?.customer_id) || customers[0];

  const res = await API.createAward({
    opportunity_id: oppId,
    tender_name: targetOpp?.title || targetOpp?.tender_name || 'Won Tender',
    customer_id: targetCust?.id,
    customer_name: targetCust?.business_name || 'Government Department',
    award_number: awardNo,
    award_date: awardDate,
    award_amount: parseFloat(awardAmount),
    acceptance_deadline: deadline,
    status: 'Accepted',
    pbg_required_pct: parseFloat(pbgPct || 10),
    items: awardItems,
    remarks: remarks
  });

  // Automatically initialize contract
  await API.createContract({
    opportunity_id: oppId,
    award_letter_id: res.data?.id || 'al-' + Date.now(),
    customer_id: targetCust?.id,
    contract_number: 'CNT-' + awardNo.replace('LOA-', ''),
    contract_value: parseFloat(awardAmount),
    start_date: awardDate,
    status: 'Active'
  });

  closeModal('modal-add-award');
  alert(`✓ Letter of Award ${awardNo} recorded & accepted. Contract initialized!`);

  // Prompt PBG Modal if PBG % > 0
  if (parseFloat(pbgPct) > 0) {
    const pbgVal = (parseFloat(awardAmount) * parseFloat(pbgPct)) / 100;
    promptAttachPBGForAward(res.data?.id || 'al-new', awardNo, pbgVal);
  } else {
    navigateToView('awards');
  }
}

function promptAttachPBGForAward(awardId, awardNo, pbgAmount) {
  document.getElementById('pg-contract-id').value = awardId;
  document.getElementById('pg-contract-no').value = awardNo;
  document.getElementById('pg-number').value = 'PBG-' + (awardNo.replace(/[^0-9]/g, '') || '2026') + '-' + Math.floor(100 + Math.random() * 900);
  document.getElementById('pg-bank').value = 'Meezan Bank Ltd Corporate Branch';
  document.getElementById('pg-amount').value = pbgAmount || 1450000;
  
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  document.getElementById('pg-expiry').value = d.toISOString().slice(0, 10);
  
  openModal('modal-add-guarantee');
}

async function submitPerformanceGuaranteeForm() {
  const contractId = document.getElementById('pg-contract-id')?.value;
  const contractNo = document.getElementById('pg-contract-no')?.value;
  const number = document.getElementById('pg-number')?.value;
  const bank = document.getElementById('pg-bank')?.value;
  const amount = document.getElementById('pg-amount')?.value;
  const expiry = document.getElementById('pg-expiry')?.value;

  if (!number || !bank || !amount || !expiry) {
    alert('PBG Number, Issuing Bank, Amount, and Expiry Date are mandatory.');
    return;
  }

  await API.createGuarantee({
    contract_id: contractId,
    award_letter_id: contractId,
    contract_number: contractNo,
    guarantee_number: number,
    bank_name: bank,
    amount: parseFloat(amount),
    expiry_date: expiry,
    status: 'Active'
  });

  closeModal('modal-add-guarantee');
  alert(`✓ Performance Guarantee ${number} issued successfully.`);
  navigateToView('awards');
}

async function handleAwardDecision(awardId, decision) {
  await API.decideAward(awardId, decision);
  alert(`Award Letter marked as ${decision}.`);
  await renderActiveView();
}

async function handleReleaseGuarantee(id) {
  if (confirm('Are you sure you want to release this Performance Guarantee upon contract completion?')) {
    await API.releaseGuarantee(id);
    alert('Performance Guarantee successfully released!');
    await renderActiveView();
  }
}

// --------------------------------------------------------------------------
// MULTI-PURCHASE ORDER (1 AWARD -> N POs) ENGINE
// --------------------------------------------------------------------------

let _cachedPOAward = null;
let _cachedPOAwardItems = [];

async function openNewPOModal(preselectedAwardId) {
  const awards = await API.getAwards();
  const acceptedAwards = awards.filter(a => a.status === 'Accepted' || !a.status || a.status === 'Pending');

  if (acceptedAwards.length === 0) {
    alert('No Accepted Award Letters available. Please record an Award Letter first.');
    navigateToView('awards');
    return;
  }

  const selectedAward = preselectedAwardId ? awards.find(a => a.id === preselectedAwardId) : acceptedAwards[0];
  _cachedPOAward = selectedAward;

  document.getElementById('po-award-id').value = selectedAward.id;
  document.getElementById('po-opp-id').value = selectedAward.opportunity_id || '';
  document.getElementById('po-cust-id').value = selectedAward.customer_id || '';

  const refEl = document.getElementById('po-award-ref-display');
  const custEl = document.getElementById('po-cust-name-display');
  if (refEl) refEl.innerText = `${selectedAward.award_number} (${selectedAward.tender_name || 'Project'})`;
  if (custEl) custEl.innerText = `Customer: ${selectedAward.customer_name || 'Government Client'}`;

  // Query existing POs for this award to compute allocated quantities
  const existingPOs = State.getTenantEntityList('purchaseOrders');
  const childPOs = existingPOs.filter(p => p.award_letter_id === selectedAward.id || p.opportunity_id === selectedAward.opportunity_id);

  // Set default PO # (e.g. PO-001, PO-002)
  const nextPoSeq = childPOs.length + 1;
  document.getElementById('po-number').value = `PO-${String(nextPoSeq).padStart(3, '0')}`;
  document.getElementById('po-date').value = new Date().toISOString().slice(0, 10);
  
  const d = new Date();
  d.setDate(d.getDate() + 30);
  document.getElementById('po-deadline').value = d.toISOString().slice(0, 10);
  document.getElementById('po-delivery-location').value = 'Central Warehouse / Client Site (Sheikhupura Road)';
  document.getElementById('po-department').value = selectedAward.customer_name ? `${selectedAward.customer_name} Engineering Wing` : 'Procurement Directorate';

  // Build items list with prior allocation tracking
  let awardItems = selectedAward.items || [];
  if (awardItems.length === 0) {
    awardItems = [
      {
        id: 'ai-default-1',
        item_name: selectedAward.tender_name || 'Electrical & Hardware Supply',
        awarded_quantity: 1,
        unit: 'LOT',
        awarded_unit_price: parseFloat(selectedAward.award_amount || 0),
        is_awarded: true
      }
    ];
  }
  _cachedPOAwardItems = awardItems.filter(i => i.is_awarded !== false);

  const tbody = document.getElementById('po-allocation-tbody');
  if (tbody) {
    tbody.innerHTML = _cachedPOAwardItems.map((it, idx) => {
      // Calculate how much was already allocated in prior POs
      let priorAllocated = 0;
      childPOs.forEach(p => {
        if (p.items && Array.isArray(p.items)) {
          const match = p.items.find(pi => pi.item_name === it.item_name || pi.award_item_id === it.id);
          if (match) priorAllocated += parseFloat(match.quantity || 0);
        }
      });

      const awardedQty = parseFloat(it.awarded_quantity || it.quantity || 1);
      const availableQty = Math.max(0, awardedQty - priorAllocated);
      const defaultPOQty = availableQty; // Default to allocating remaining balance

      return `
        <tr id="po-row-${idx}">
          <td>
            <strong>${it.item_name || it.item_description || 'Item Scope'}</strong>
            <input type="hidden" id="po-item-name-${idx}" value="${(it.item_name || it.item_description || '').replace(/"/g, '&quot;')}">
            <input type="hidden" id="po-item-award-id-${idx}" value="${it.id || ''}">
            <input type="hidden" id="po-item-prod-id-${idx}" value="${it.product_service_id || ''}">
            <input type="hidden" id="po-item-unit-${idx}" value="${it.unit || 'PCS'}">
          </td>
          <td>${awardedQty} ${it.unit || 'PCS'}</td>
          <td style="color:#64748b;">${priorAllocated} ${it.unit || 'PCS'}</td>
          <td>
            <span class="badge ${availableQty > 0 ? 'badge-won' : 'badge-withdraw'}">
              ${availableQty} ${it.unit || 'PCS'}
            </span>
            <input type="hidden" id="po-item-avail-qty-${idx}" value="${availableQty}">
          </td>
          <td>
            <input type="number" class="form-input" id="po-item-qty-${idx}" value="${defaultPOQty}" min="0" max="${availableQty}" step="any" style="width: 100px; padding: 4px 6px; font-weight: 700;" oninput="updatePOAllocationTotal(${idx})">
          </td>
          <td>
            <span style="font-weight: 600;">PKR ${parseFloat(it.awarded_unit_price || it.unit_price || 0).toLocaleString()}</span>
            <input type="hidden" id="po-item-rate-${idx}" value="${it.awarded_unit_price || it.unit_price || 0}">
          </td>
          <td>
            <strong id="po-item-total-${idx}" style="color: #0284c7;">PKR ${(defaultPOQty * parseFloat(it.awarded_unit_price || it.unit_price || 0)).toLocaleString()}</strong>
          </td>
        </tr>
      `;
    }).join('');
  }

  updatePOAllocationTotal();
  openModal('modal-add-po');
}

function updatePOAllocationTotal(changedIdx) {
  let poGrandTotal = 0;

  _cachedPOAwardItems.forEach((it, idx) => {
    const qtyInput = document.getElementById(`po-item-qty-${idx}`);
    const availQty = parseFloat(document.getElementById(`po-item-avail-qty-${idx}`)?.value || 0);
    const rate = parseFloat(document.getElementById(`po-item-rate-${idx}`)?.value || 0);
    const totalEl = document.getElementById(`po-item-total-${idx}`);

    if (qtyInput) {
      let qty = parseFloat(qtyInput.value) || 0;
      if (qty > availQty) {
        qtyInput.style.borderColor = '#ef4444';
        qtyInput.style.background = '#fef2f2';
        alert(`Allocation Error: Cannot allocate ${qty} units. Maximum remaining available quantity for "${it.item_name}" is ${availQty} units.`);
        qty = availQty;
        qtyInput.value = availQty;
      } else {
        qtyInput.style.borderColor = 'var(--border)';
        qtyInput.style.background = '#ffffff';
      }

      const lineTotal = qty * rate;
      poGrandTotal += lineTotal;
      if (totalEl) totalEl.innerText = `PKR ${lineTotal.toLocaleString()}`;
    }
  });

  const totInput = document.getElementById('po-total-amount');
  if (totInput) totInput.value = poGrandTotal;
}

async function submitCreatePOForm() {
  const awardId = document.getElementById('po-award-id')?.value;
  const oppId = document.getElementById('po-opp-id')?.value;
  const custId = document.getElementById('po-cust-id')?.value;
  const poNumber = document.getElementById('po-number')?.value;
  const poDate = document.getElementById('po-date')?.value;
  const deadline = document.getElementById('po-deadline')?.value;
  const location = document.getElementById('po-delivery-location')?.value;
  const department = document.getElementById('po-department')?.value;
  const terms = document.getElementById('po-payment-terms')?.value;
  const totalAmount = document.getElementById('po-total-amount')?.value;
  const remarks = document.getElementById('po-remarks')?.value;

  if (!poNumber || !deadline || !location || parseFloat(totalAmount || 0) <= 0) {
    alert('PO Number, Delivery Deadline, Delivery Site Location, and at least 1 item allocation with positive value are mandatory.');
    return;
  }

  // Collect item allocations for this PO
  const poItems = [];
  let totalAllocatedUnits = 0;

  _cachedPOAwardItems.forEach((it, idx) => {
    const qtyInput = document.getElementById(`po-item-qty-${idx}`);
    const itemName = document.getElementById(`po-item-name-${idx}`)?.value;
    const awardItemId = document.getElementById(`po-item-award-id-${idx}`)?.value;
    const prodId = document.getElementById(`po-item-prod-id-${idx}`)?.value;
    const unit = document.getElementById(`po-item-unit-${idx}`)?.value;
    const rate = parseFloat(document.getElementById(`po-item-rate-${idx}`)?.value || 0);

    if (qtyInput) {
      const qty = parseFloat(qtyInput.value) || 0;
      if (qty > 0) {
        totalAllocatedUnits += qty;
        poItems.push({
          id: 'poi-' + Date.now() + '-' + idx,
          award_item_id: awardItemId || null,
          product_service_id: prodId || null,
          item_name: itemName,
          item_description: itemName,
          awarded_quantity: parseFloat(it.awarded_quantity || it.quantity || qty),
          quantity: qty,
          unit: unit || 'PCS',
          unit_price: rate,
          total_price: qty * rate
        });
      }
    }
  });

  if (poItems.length === 0) {
    alert('Please allocate at least one item quantity for this Purchase Order.');
    return;
  }

  const customers = await API.getCustomers();
  const cust = customers.find(c => c.id === custId) || { business_name: 'Customer Account' };

  await API.createPurchaseOrder({
    award_letter_id: awardId,
    award_number: _cachedPOAward?.award_number || 'Award LOA',
    opportunity_id: oppId,
    customer_id: custId,
    customer_name: cust.business_name || _cachedPOAward?.customer_name || 'Customer Account',
    po_number: poNumber,
    po_date: poDate,
    delivery_deadline: deadline,
    delivery_location: location,
    department_name: department,
    payment_terms: terms,
    total_amount: parseFloat(totalAmount),
    net_amount: parseFloat(totalAmount),
    items: poItems,
    status: 'Issued',
    remarks: remarks
  });

  closeModal('modal-add-po');
  alert(`✓ Purchase Order ${poNumber} issued successfully against ${_cachedPOAward?.award_number}! Total Value: PKR ${parseFloat(totalAmount).toLocaleString()}`);
  navigateToView('purchase-orders');
}

async function handleEvaluateBidDirect(oppId, status) {
  const reason = prompt(`Enter reason for ${status}:`, status === 'loose' ? 'Competitor was lower in price' : 'Withdrawn due to spec revision');
  if (reason !== null) {
    alert(`Tender marked as ${status.toUpperCase()}. Please release the Bid Security instrument.`);
    navigateToView('bid-securities');
  }
}

// --------------------------------------------------------------------------
// DUAL-MODE DELIVERY & PHASED DELIVERY CHALLAN (1 PO -> N DCs) ENGINE
// --------------------------------------------------------------------------

let _cachedDCPO = null;
let _cachedDCPOItems = [];

async function openNewDCModal(preselectedPoId) {
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const warehouses = await API.getWarehouses();
  const suppliers = await API.getSuppliers();

  const poSelect = document.getElementById('dc-po-select');
  const whSelect = document.getElementById('dc-warehouse-select');
  const supSelect = document.getElementById('dc-supplier-select');

  if (pos.length === 0) {
    alert('No approved Purchase Orders available. Please issue a Purchase Order before creating a Delivery Challan.');
    navigateToView('purchase-orders');
    return;
  }

  if (poSelect) {
    poSelect.innerHTML = pos.map(p => `
      <option value="${p.id}" ${p.id === preselectedPoId ? 'selected' : ''}>
        ${p.po_number} - ${p.customer_name || 'Customer'} (PKR ${parseFloat(p.net_amount || p.total_amount || 0).toLocaleString()})
      </option>
    `).join('');
  }

  if (whSelect) {
    whSelect.innerHTML = warehouses.map(w => `<option value="${w.id}">${w.warehouse_name} (${w.city})</option>`).join('');
  }

  if (supSelect) {
    supSelect.innerHTML = suppliers.map(s => `<option value="${s.id}">${s.supplier_name} (${s.country || 'Pakistan'})</option>`).join('');
  }

  const initialPoId = preselectedPoId || pos[0]?.id;
  await handleDCPOSSelected(initialPoId);

  document.getElementById('dc-edit-id').value = '';
  document.getElementById('dc-number').value = 'DC-CE-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('dc-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('dc-delivery-mode').value = 'Own Warehouse';
  handleDCDeliveryModeChanged('Own Warehouse');

  document.getElementById('dc-logistics-provider').value = 'Bilal Cargo / 22-Wheeler Fleet';
  document.getElementById('dc-tracking').value = 'BLT-LHR-' + Math.floor(10000 + Math.random() * 90000);
  document.getElementById('dc-vehicle').value = 'TK-' + Math.floor(1000 + Math.random() * 9000) + ' (Flatbed)';
  document.getElementById('dc-driver').value = 'Muhammad Arshad (0302-8819201)';
  document.getElementById('dc-freight-cost').value = '75000';
  document.getElementById('dc-customs-cost').value = '0';
  document.getElementById('dc-remarks').value = 'Lot 1 Supply. Requires site inspection certificate on delivery.';

  openModal('modal-add-dc');
}

async function promptCreateDCForPO(poId, poNumber) {
  await openNewDCModal(poId);
}

function handleDCDeliveryModeChanged(mode) {
  const whContainer = document.getElementById('dc-wh-container');
  const supContainer = document.getElementById('dc-sup-container');
  const originInput = document.getElementById('dc-origin-location');

  if (mode === 'Direct Drop-Shipment') {
    if (whContainer) whContainer.style.display = 'none';
    if (supContainer) supContainer.style.display = 'block';
    if (originInput) originInput.value = 'Port Qasim Terminal 2 / Supplier Factory Direct';
  } else {
    if (whContainer) whContainer.style.display = 'block';
    if (supContainer) supContainer.style.display = 'none';
    if (originInput) originInput.value = 'Central Warehouse (Sheikhupura Road Depot)';
  }
}

async function handleDCPOSSelected(poId) {
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const selectedPO = pos.find(p => p.id === poId) || pos[0];
  _cachedDCPO = selectedPO;

  if (!selectedPO) return;

  const destSite = document.getElementById('dc-destination-site');
  if (destSite) {
    destSite.value = selectedPO.delivery_location || `${selectedPO.customer_name} Designated Site`;
  }

  // Query existing DCs for this PO to compute remaining undelivered quantities
  const dcs = State.getTenantEntityList('deliveryChallans');
  const priorDCs = dcs.filter(d => d.purchase_order_id === selectedPO.id || d.po_number === selectedPO.po_number);

  let poItems = selectedPO.items || [];
  if (poItems.length === 0) {
    poItems = [
      {
        id: 'poi-default-1',
        item_name: selectedPO.po_number + ' Material Scope',
        quantity: 1,
        unit: 'LOT',
        unit_price: parseFloat(selectedPO.net_amount || selectedPO.total_amount || 0)
      }
    ];
  }
  _cachedDCPOItems = poItems;

  const tbody = document.getElementById('dc-dispatch-items-tbody');
  if (tbody) {
    tbody.innerHTML = poItems.map((it, idx) => {
      // Calculate how much was already delivered in prior DCs
      let priorDelivered = 0;
      priorDCs.forEach(d => {
        if (d.items && Array.isArray(d.items)) {
          const match = d.items.find(di => di.item_name === it.item_name || di.purchase_order_item_id === it.id);
          if (match) priorDelivered += parseFloat(match.quantity || 0);
        }
      });

      const totalOrderedQty = parseFloat(it.quantity || 1);
      const remainingQty = Math.max(0, totalOrderedQty - priorDelivered);
      const defaultDispatchQty = remainingQty;

      return `
        <tr id="dc-item-row-${idx}">
          <td>
            <strong>${it.item_name || it.item_description || 'Item Specification'}</strong>
            <input type="hidden" id="dc-item-name-${idx}" value="${(it.item_name || it.item_description || '').replace(/"/g, '&quot;')}">
            <input type="hidden" id="dc-item-poi-id-${idx}" value="${it.id || ''}">
            <input type="hidden" id="dc-item-prod-id-${idx}" value="${it.product_service_id || ''}">
            <input type="hidden" id="dc-item-unit-${idx}" value="${it.unit || 'PCS'}">
          </td>
          <td>${totalOrderedQty} ${it.unit || 'PCS'}</td>
          <td style="color:#64748b;">${priorDelivered} ${it.unit || 'PCS'}</td>
          <td>
            <span class="badge ${remainingQty > 0 ? 'badge-won' : 'badge-withdraw'}">
              ${remainingQty} ${it.unit || 'PCS'}
            </span>
            <input type="hidden" id="dc-item-remain-qty-${idx}" value="${remainingQty}">
          </td>
          <td>
            <input type="number" class="form-input" id="dc-item-dispatch-qty-${idx}" value="${defaultDispatchQty}" min="0" max="${remainingQty}" step="any" style="width: 100px; padding: 4px 6px; font-weight: 700; color: #166534;" oninput="validateDCDispatchQty(${idx})">
          </td>
          <td>${it.unit || 'PCS'}</td>
        </tr>
      `;
    }).join('');
  }
}

function validateDCDispatchQty(idx) {
  const input = document.getElementById(`dc-item-dispatch-qty-${idx}`);
  const maxQty = parseFloat(document.getElementById(`dc-item-remain-qty-${idx}`)?.value || 0);
  if (!input) return;

  let val = parseFloat(input.value) || 0;
  if (val > maxQty) {
    alert(`Quantity Alert: Cannot dispatch ${val} units. Remaining undelivered quantity for this item is ${maxQty} units.`);
    input.value = maxQty;
  }
}

async function submitDeliveryChallanForm() {
  const poId = document.getElementById('dc-po-select')?.value;
  const delDate = document.getElementById('dc-date')?.value;
  const mode = document.getElementById('dc-delivery-mode')?.value;
  const whId = document.getElementById('dc-warehouse-select')?.value;
  const supId = document.getElementById('dc-supplier-select')?.value;
  const dcNumber = document.getElementById('dc-number')?.value || 'DC-' + Date.now();
  const originLoc = document.getElementById('dc-origin-location')?.value;
  const destSite = document.getElementById('dc-destination-site')?.value;
  const provider = document.getElementById('dc-logistics-provider')?.value;
  const tracking = document.getElementById('dc-tracking')?.value;
  const vehicle = document.getElementById('dc-vehicle')?.value;
  const driver = document.getElementById('dc-driver')?.value;
  const freightCost = parseFloat(document.getElementById('dc-freight-cost')?.value || 0);
  const customsCost = parseFloat(document.getElementById('dc-customs-cost')?.value || 0);
  const remarks = document.getElementById('dc-remarks')?.value;

  if (!poId || !destSite || !provider) {
    alert('Purchase Order, Destination Customer Site, and Logistics Carrier are mandatory.');
    return;
  }

  // Collect dispatched items
  const dcItems = [];
  _cachedDCPOItems.forEach((it, idx) => {
    const qtyInput = document.getElementById(`dc-item-dispatch-qty-${idx}`);
    const itemName = document.getElementById(`dc-item-name-${idx}`)?.value;
    const poiId = document.getElementById(`dc-item-poi-id-${idx}`)?.value;
    const prodId = document.getElementById(`dc-item-prod-id-${idx}`)?.value;
    const unit = document.getElementById(`dc-item-unit-${idx}`)?.value;

    if (qtyInput) {
      const qty = parseFloat(qtyInput.value) || 0;
      if (qty > 0) {
        dcItems.push({
          id: 'dci-' + Date.now() + '-' + idx,
          purchase_order_item_id: poiId || null,
          product_service_id: prodId || null,
          item_name: itemName,
          ordered_quantity: parseFloat(it.quantity || qty),
          quantity: qty,
          unit: unit || 'PCS'
        });
      }
    }
  });

  if (dcItems.length === 0) {
    alert('Please dispatch at least one item quantity for this Delivery Challan.');
    return;
  }

  const warehouses = await API.getWarehouses();
  const targetWh = warehouses.find(w => w.id === whId) || warehouses[0];
  const suppliers = await API.getSuppliers();
  const targetSup = suppliers.find(s => s.id === supId) || suppliers[0];

  const totalLogisticsCost = freightCost + customsCost;

  const res = await API.createDeliveryChallan({
    purchase_order_id: poId,
    po_number: _cachedDCPO?.po_number || 'PO Ref',
    opportunity_id: _cachedDCPO?.opportunity_id || null,
    customer_id: _cachedDCPO?.customer_id || null,
    customer_name: _cachedDCPO?.customer_name || 'Customer Account',
    dc_number: dcNumber,
    delivery_date: delDate,
    delivery_mode: mode,
    warehouse_id: mode === 'Own Warehouse' ? whId : null,
    warehouse_name: mode === 'Own Warehouse' ? (targetWh?.warehouse_name || 'Central Warehouse') : null,
    supplier_id: mode === 'Direct Drop-Shipment' ? supId : null,
    supplier_name: mode === 'Direct Drop-Shipment' ? (targetSup?.supplier_name || 'OEM Supplier') : null,
    origin_location: originLoc,
    destination_site: destSite,
    delivery_method: '3PL Heavy Logistics',
    logistics_provider: provider,
    tracking_number: tracking,
    bilty_number: tracking,
    vehicle_number: vehicle,
    driver_name: driver,
    freight_cost_contractor: freightCost,
    customs_handling_cost: customsCost,
    delivery_cost: totalLogisticsCost,
    items: dcItems,
    status: 'Dispatched',
    remarks: remarks
  });

  // Automated Inventory Stock Decrement for 'Own Warehouse' mode
  if (mode === 'Own Warehouse') {
    const products = State.getTenantEntityList('products');
    dcItems.forEach(dci => {
      if (dci.product_service_id) {
        const p = products.find(prod => prod.id === dci.product_service_id);
        if (p) {
          p.current_stock = Math.max(0, (parseFloat(p.current_stock) || 0) - dci.quantity);
          State.saveTenantEntity('products', p);
        }
      }
    });
  }

  // Automated Contractor Freight Expense Logging (Tier-2 PO Execution Expense)
  if (totalLogisticsCost > 0) {
    const expPayload = {
      expense_type: 'Project Direct',
      category: 'Logistics, 3PL Freight & Truck Hire',
      expense_name: `Freight for DC ${dcNumber} (${provider})`,
      amount: totalLogisticsCost,
      expense_date: delDate,
      opportunity_id: _cachedDCPO?.opportunity_id || null,
      purchase_order_id: poId,
      delivery_challan_id: res.data?.id || 'dc-' + Date.now(),
      paid_to: provider,
      payment_mode: 'Cheque / Online IBFT',
      notes: `Contractor-borne logistics expense for dispatching ${dcNumber} to ${destSite}. Deducted from project net profit.`
    };
    await API.createExpense(expPayload);
  }

  closeModal('modal-add-dc');
  alert(`✓ Delivery Challan ${dcNumber} created and dispatched! Freight of PKR ${totalLogisticsCost.toLocaleString()} logged as direct PO project expense.`);
  navigateToView('delivery-challans');
}

async function promptRecordCustomerGRN(dcId, dcNumber) {
  const grn = prompt(`Enter Customer Goods Received Note (GRN / Acceptance Certificate #) for ${dcNumber}:`, `GRN-WAPDA-${Math.floor(1000 + Math.random() * 9000)}`);
  if (grn) {
    const today = new Date().toISOString().slice(0, 10);
    await API.updateEntity('delivery-challan', dcId, {
      grn_number: grn,
      grn_date: today,
      status: 'GRN Received'
    });
    alert(`✓ Customer GRN ${grn} recorded. Delivery Challan marked as Verified & Delivered. Ready for Invoicing!`);
    await renderActiveView();
  }
}

async function promptGenerateInvoiceFromDC(dcId, dcNumber, customerName) {
  const dcs = State.getTenantEntityList('deliveryChallans');
  const targetDC = dcs.find(d => d.id === dcId);
  const pos = State.getTenantEntityList('purchaseOrders');
  const targetPO = pos.find(p => p.id === targetDC?.purchase_order_id || p.po_number === targetDC?.po_number);

  let calculatedSubtotal = 0;
  if (targetDC && targetDC.items && targetDC.items.length > 0) {
    targetDC.items.forEach(dci => {
      const matchPOItem = targetPO?.items?.find(pi => pi.item_name === dci.item_name || pi.id === dci.purchase_order_item_id);
      const unitRate = parseFloat(matchPOItem?.unit_price || 0);
      calculatedSubtotal += dci.quantity * unitRate;
    });
  }
  if (calculatedSubtotal === 0) {
    calculatedSubtotal = parseFloat(targetPO?.net_amount || 14500000);
  }

  const taxAmount = (calculatedSubtotal * 18) / 100; // 18% Sales Tax standard
  const totalInvoiceAmount = calculatedSubtotal + taxAmount;
  const invNum = `INV-CE-${Date.now().toString().slice(-4)}`;

  if (confirm(`Generate Commercial Tax Invoice for Delivery Challan ${dcNumber} (${customerName})?\nSubtotal: PKR ${calculatedSubtotal.toLocaleString()}\nGST (18%): PKR ${taxAmount.toLocaleString()}\nTotal Payable: PKR ${totalInvoiceAmount.toLocaleString()}`)) {
    const customers = await API.getCustomers();
    const cust = customers.find(c => c.id === targetDC?.customer_id || c.business_name.includes(customerName.slice(0, 8))) || customers[0];

    await API.createInvoice({
      delivery_challan_id: dcId,
      dc_number: dcNumber,
      purchase_order_id: targetDC?.purchase_order_id || null,
      po_number: targetDC?.po_number || null,
      customer_id: cust?.id,
      customer_name: cust?.business_name || customerName,
      invoice_number: invNum,
      invoice_date: new Date().toISOString().slice(0, 10),
      subtotal: calculatedSubtotal,
      tax_amount: taxAmount,
      total_amount: totalInvoiceAmount,
      paid_amount: 0,
      outstanding_amount: totalInvoiceAmount,
      status: 'Submitted',
      fbr_integration_required: true
    });

    alert(`✓ Invoice ${invNum} generated and ready for FBR digital fiscalization!`);
    navigateToView('invoices');
  }
}

async function handleInvoiceStatusChange(id, newStatus) {
  await API.updateInvoiceStatus(id, newStatus);
  alert(`Invoice status updated to ${newStatus}`);
  await renderActiveView();
}

async function handleFBRSubmit(invoiceId) {
  const res = await API.submitToFBR(invoiceId);
  alert(`Invoice validated with PRAL FBR! FBR Invoice #: ${res.fbrInvoiceNumber}`);
  await renderActiveView();
}

async function promptRecordPaymentForInvoice(invoiceId, invoiceNumber, outstanding) {
  const invSelect = document.getElementById('pay-invoice-select');
  if (invSelect) {
    invSelect.innerHTML = `<option value="${invoiceId}" data-out="${outstanding}" selected>${invoiceNumber} (Outstanding: PKR ${parseFloat(outstanding).toLocaleString()})</option>`;
  }
  document.getElementById('pay-amount').value = outstanding;
  openModal('modal-add-payment');
}

async function submitPaymentForm() {
  const invoiceId = document.getElementById('pay-invoice-select')?.value;
  const amount = document.getElementById('pay-amount')?.value;
  const date = document.getElementById('pay-date')?.value;
  const checkNo = document.getElementById('pay-check-no')?.value;
  const checkFrom = document.getElementById('pay-check-from')?.value;
  const bankAcc = document.getElementById('pay-bank-acc')?.value;
  const ref = document.getElementById('pay-ref')?.value;

  if (!amount || !invoiceId) {
    alert('Invoice and Amount are mandatory.');
    return;
  }

  await API.createPayment({
    invoice_id: invoiceId,
    amount: amount,
    payment_date: date,
    check_no: checkNo,
    check_from: checkFrom,
    bank_account: bankAcc,
    reference_number: ref
  });

  closeModal('modal-add-payment');
  alert('Cheque Payment logged and invoice balance deducted.');
  navigateToView('payments');
}

// --------------------------------------------------------------------------
// MASTER DATA MODAL CONTROLLERS & FORM HANDLERS (PHASE 1)
// --------------------------------------------------------------------------

// 1. CUSTOMER CONTROLLERS
async function openNewCustomerModal() {
  document.getElementById('cust-edit-id').value = '';
  document.getElementById('cust-code').value = 'CUST-PK-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-department').value = '';
  document.getElementById('cust-ntn').value = '';
  document.getElementById('cust-strn').value = '';
  document.getElementById('cust-city').value = 'Lahore';
  document.getElementById('cust-address').value = '';
  document.getElementById('cust-delivery-address').value = '';
  document.getElementById('cust-contact').value = '';
  document.getElementById('cust-phone').value = '';
  document.getElementById('cust-email').value = '';
  document.getElementById('cust-credit-limit').value = '';
  document.getElementById('cust-bank-name').value = '';
  document.getElementById('cust-bank-iban').value = '';
  document.getElementById('cust-notes').value = '';
  openModal('modal-add-customer');
}

async function openEditCustomerModal(id) {
  const customers = await API.getCustomers();
  const c = customers.find(item => item.id === id);
  if (!c) return;

  document.getElementById('cust-edit-id').value = c.id;
  document.getElementById('cust-code').value = c.customer_code || 'CUST-PK-' + c.id.slice(0, 4);
  document.getElementById('cust-name').value = c.business_name || '';
  document.getElementById('cust-org-type').value = c.customer_type || c.org_type || 'Government Department';
  document.getElementById('cust-department').value = c.department_name || c.department || '';
  document.getElementById('cust-ntn').value = c.ntn || '';
  document.getElementById('cust-strn').value = c.strn || '';
  document.getElementById('cust-city').value = c.city || 'Lahore';
  document.getElementById('cust-province').value = c.province || 'Punjab';
  document.getElementById('cust-address').value = c.address || '';
  document.getElementById('cust-delivery-address').value = c.delivery_address || '';
  document.getElementById('cust-contact').value = c.contact_person || '';
  document.getElementById('cust-phone').value = c.phone || '';
  document.getElementById('cust-email').value = c.email || '';
  document.getElementById('cust-terms').value = c.payment_terms || 'Net 30';
  document.getElementById('cust-credit-limit').value = c.credit_limit || '';
  document.getElementById('cust-status').value = c.status || 'Active';
  document.getElementById('cust-bank-name').value = c.bank_name || '';
  document.getElementById('cust-bank-iban').value = c.bank_iban || '';
  document.getElementById('cust-notes').value = c.notes || '';

  openModal('modal-add-customer');
}

async function submitNewCustomerForm() {
  const editId = document.getElementById('cust-edit-id')?.value;
  const code = document.getElementById('cust-code')?.value;
  const name = document.getElementById('cust-name')?.value;
  const orgType = document.getElementById('cust-org-type')?.value;
  const dept = document.getElementById('cust-department')?.value;
  const ntn = document.getElementById('cust-ntn')?.value;
  const strn = document.getElementById('cust-strn')?.value;
  const city = document.getElementById('cust-city')?.value;
  const province = document.getElementById('cust-province')?.value;
  const address = document.getElementById('cust-address')?.value;
  const delAddress = document.getElementById('cust-delivery-address')?.value;
  const contact = document.getElementById('cust-contact')?.value;
  const phone = document.getElementById('cust-phone')?.value;
  const email = document.getElementById('cust-email')?.value;
  const terms = document.getElementById('cust-terms')?.value;
  const limit = document.getElementById('cust-credit-limit')?.value;
  const status = document.getElementById('cust-status')?.value || 'Active';
  const bankName = document.getElementById('cust-bank-name')?.value;
  const bankIban = document.getElementById('cust-bank-iban')?.value;
  const notes = document.getElementById('cust-notes')?.value;

  if (!name) {
    alert('Customer Name is mandatory.');
    return;
  }

  const payload = {
    customer_code: code || 'CUST-' + Math.floor(1000 + Math.random() * 9000),
    business_name: name,
    customer_type: orgType,
    org_type: orgType,
    department_name: dept,
    ntn: ntn,
    strn: strn,
    city: city,
    province: province,
    address: address,
    delivery_address: delAddress,
    contact_person: contact,
    phone: phone,
    email: email,
    payment_terms: terms,
    credit_limit: parseFloat(limit || 0),
    status: status,
    bank_name: bankName,
    bank_iban: bankIban,
    notes: notes
  };

  let created = null;
  if (editId) {
    await API.updateEntity('customer', editId, payload);
    created = { id: editId, ...payload };
    alert('✓ Customer record updated successfully.');
  } else {
    const res = await API.createCustomer(payload);
    created = (res && res.data) ? res.data : { id: 'cust-' + Date.now(), ...payload };
    alert('✓ Customer registered successfully.');
  }

  closeModal('modal-add-customer');
  if (_quickAddContext && _quickAddContext.entityType === 'customer') {
    await handleQuickAddCompletion('customer', created);
  } else {
    await renderActiveView();
  }
}

async function toggleCustomerStatus(id, currentStatus) {
  const newStatus = (currentStatus === 'Inactive') ? 'Active' : 'Inactive';
  await API.updateEntity('customer', id, { status: newStatus });
  await renderActiveView();
}

// 2. SUPPLIER CONTROLLERS (LOCAL & INTERNATIONAL)
function handleSupplierTypeChanged(type) {
  const countrySelect = document.getElementById('sup-country');
  const currencySelect = document.getElementById('sup-currency');
  const portInput = document.getElementById('sup-origin-port');
  
  if (type === 'Local Supplier') {
    if (countrySelect) countrySelect.value = 'Pakistan';
    if (currencySelect) currencySelect.value = 'PKR';
    if (portInput && !portInput.value) portInput.value = 'Karachi Port';
  } else {
    if (countrySelect && countrySelect.value === 'Pakistan') countrySelect.value = 'United Arab Emirates';
    if (currencySelect && currencySelect.value === 'PKR') currencySelect.value = 'USD';
    if (portInput && (portInput.value === 'Karachi Port' || !portInput.value)) portInput.value = 'Jebel Ali Port';
  }
}

async function openNewSupplierModal() {
  document.getElementById('sup-edit-id').value = '';
  document.getElementById('sup-code').value = 'SUP-INT-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('sup-name').value = '';
  document.getElementById('sup-type').value = 'International Supplier';
  handleSupplierTypeChanged('International Supplier');
  document.getElementById('sup-ntn').value = '';
  document.getElementById('sup-strn').value = '';
  document.getElementById('sup-contact').value = '';
  document.getElementById('sup-phone').value = '';
  document.getElementById('sup-email').value = '';
  document.getElementById('sup-bank-name').value = '';
  document.getElementById('sup-bank-iban').value = '';
  document.getElementById('sup-bank-swift').value = '';
  document.getElementById('sup-categories').value = '';
  document.getElementById('sup-notes').value = '';
  openModal('modal-add-supplier');
}

async function openEditSupplierModal(id) {
  const suppliers = await API.getSuppliers();
  const s = suppliers.find(item => item.id === id);
  if (!s) return;

  document.getElementById('sup-edit-id').value = s.id;
  document.getElementById('sup-code').value = s.supplier_code || 'SUP-' + s.id.slice(0, 4);
  document.getElementById('sup-name').value = s.supplier_name || '';
  document.getElementById('sup-type').value = s.supplier_type || (s.origin === 'International' ? 'International Supplier' : 'Local Supplier');
  document.getElementById('sup-country').value = s.country || 'Pakistan';
  document.getElementById('sup-origin-port').value = s.origin_port_city || s.city || '';
  document.getElementById('sup-currency').value = s.currency || 'PKR';
  document.getElementById('sup-incoterms').value = s.incoterms || 'FOB';
  document.getElementById('sup-rating').value = s.rating || 5;
  document.getElementById('sup-ntn').value = s.ntn || '';
  document.getElementById('sup-strn').value = s.strn || '';
  document.getElementById('sup-terms').value = s.payment_terms || 'Net 30';
  document.getElementById('sup-contact').value = s.contact_person || '';
  document.getElementById('sup-phone').value = s.phone || '';
  document.getElementById('sup-email').value = s.email || '';
  document.getElementById('sup-bank-name').value = s.bank_name || '';
  document.getElementById('sup-bank-iban').value = s.bank_iban || '';
  document.getElementById('sup-bank-swift').value = s.bank_swift || '';
  document.getElementById('sup-categories').value = s.product_categories || '';
  document.getElementById('sup-notes').value = s.notes || '';

  openModal('modal-add-supplier');
}

async function submitNewSupplierForm() {
  const editId = document.getElementById('sup-edit-id')?.value;
  const code = document.getElementById('sup-code')?.value;
  const name = document.getElementById('sup-name')?.value;
  const type = document.getElementById('sup-type')?.value;
  const country = document.getElementById('sup-country')?.value;
  const originPort = document.getElementById('sup-origin-port')?.value;
  const currency = document.getElementById('sup-currency')?.value;
  const incoterms = document.getElementById('sup-incoterms')?.value;
  const rating = document.getElementById('sup-rating')?.value;
  const ntn = document.getElementById('sup-ntn')?.value;
  const strn = document.getElementById('sup-strn')?.value;
  const terms = document.getElementById('sup-terms')?.value;
  const contact = document.getElementById('sup-contact')?.value;
  const phone = document.getElementById('sup-phone')?.value;
  const email = document.getElementById('sup-email')?.value;
  const bankName = document.getElementById('sup-bank-name')?.value;
  const bankIban = document.getElementById('sup-bank-iban')?.value;
  const bankSwift = document.getElementById('sup-bank-swift')?.value;
  const categories = document.getElementById('sup-categories')?.value;
  const notes = document.getElementById('sup-notes')?.value;

  if (!name) {
    alert('Supplier / OEM Name is mandatory.');
    return;
  }

  const payload = {
    supplier_code: code || 'SUP-' + Math.floor(1000 + Math.random() * 9000),
    supplier_name: name,
    supplier_type: type,
    origin: type.includes('International') ? 'International' : 'Local',
    country: country,
    origin_port_city: originPort,
    currency: currency,
    incoterms: incoterms,
    rating: parseInt(rating || 5, 10),
    ntn: ntn,
    strn: strn,
    payment_terms: terms,
    contact_person: contact,
    phone: phone,
    email: email,
    bank_name: bankName,
    bank_iban: bankIban,
    bank_swift: bankSwift,
    product_categories: categories,
    status: 'Active',
    notes: notes
  };

  let created = null;
  if (editId) {
    await API.updateEntity('supplier', editId, payload);
    created = { id: editId, ...payload };
    alert('✓ Supplier details updated successfully.');
  } else {
    const res = await API.createSupplier(payload);
    created = (res && res.data) ? res.data : { id: 'sup-' + Date.now(), ...payload };
    alert('✓ Supplier registered successfully.');
  }

  closeModal('modal-add-supplier');
  if (_quickAddContext && _quickAddContext.entityType === 'supplier') {
    await handleQuickAddCompletion('supplier', created);
  } else {
    await renderActiveView();
  }
}

async function toggleSupplierStatus(id, currentStatus) {
  const newStatus = (currentStatus === 'Inactive') ? 'Active' : 'Inactive';
  await API.updateEntity('supplier', id, { status: newStatus });
  await renderActiveView();
}

// 3. PRODUCT & MASTER SKU CONTROLLERS
async function openNewProductModal() {
  const suppliers = await API.getSuppliers();
  const supSelect = document.getElementById('prod-supplier-select');
  if (supSelect) {
    supSelect.innerHTML = `<option value="">-- Select Preferred Supplier --</option>` + suppliers.map(s => `
      <option value="${s.id}">${s.supplier_name} (${s.country || 'Pakistan'})</option>
    `).join('');
  }

  document.getElementById('prod-edit-id').value = '';
  document.getElementById('prod-sku').value = 'SKU-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('prod-name').value = '';
  document.getElementById('prod-type').value = 'Product';
  document.getElementById('prod-unit').value = 'PCS';
  document.getElementById('prod-hs-code').value = '';
  document.getElementById('prod-country').value = 'Pakistan';
  document.getElementById('prod-reorder-level').value = '10';
  document.getElementById('prod-currency').value = 'PKR';
  document.getElementById('prod-cost-pkr').value = '';
  document.getElementById('prod-selling-price').value = '';
  document.getElementById('prod-description').value = '';

  openModal('modal-add-product');
}

async function openEditProductModal(id) {
  const products = await API.getProducts();
  const suppliers = await API.getSuppliers();
  const p = products.find(item => item.id === id);
  if (!p) return;

  const supSelect = document.getElementById('prod-supplier-select');
  if (supSelect) {
    supSelect.innerHTML = `<option value="">-- Select Preferred Supplier --</option>` + suppliers.map(s => `
      <option value="${s.id}" ${(s.id === p.default_supplier_id || s.id === p.supplier_id) ? 'selected' : ''}>
        ${s.supplier_name} (${s.country || 'Pakistan'})
      </option>
    `).join('');
  }

  document.getElementById('prod-edit-id').value = p.id;
  document.getElementById('prod-sku').value = p.sku || '';
  document.getElementById('prod-name').value = p.name || '';
  document.getElementById('prod-type').value = p.item_type || 'Product';
  document.getElementById('prod-unit').value = p.unit || 'PCS';
  document.getElementById('prod-hs-code').value = p.hs_code || '';
  document.getElementById('prod-country').value = p.country_of_origin || 'Pakistan';
  document.getElementById('prod-reorder-level').value = p.reorder_level || 10;
  document.getElementById('prod-currency').value = p.currency || 'PKR';
  document.getElementById('prod-cost-pkr').value = p.cost_price || '';
  document.getElementById('prod-selling-price').value = p.selling_price || '';
  document.getElementById('prod-description').value = p.description || '';

  openModal('modal-add-product');
}

async function submitNewProductForm() {
  const editId = document.getElementById('prod-edit-id')?.value;
  const sku = document.getElementById('prod-sku')?.value;
  const name = document.getElementById('prod-name')?.value;
  const type = document.getElementById('prod-type')?.value;
  const unit = document.getElementById('prod-unit')?.value;
  const hsCode = document.getElementById('prod-hs-code')?.value;
  const country = document.getElementById('prod-country')?.value;
  const supplierId = document.getElementById('prod-supplier-select')?.value;
  const reorder = document.getElementById('prod-reorder-level')?.value;
  const currency = document.getElementById('prod-currency')?.value;
  const cost = document.getElementById('prod-cost-pkr')?.value;
  const price = document.getElementById('prod-selling-price')?.value;
  const desc = document.getElementById('prod-description')?.value;

  if (!sku || !name || !cost) {
    alert('SKU, Item Name, and Landed Cost Price are mandatory.');
    return;
  }

  const payload = {
    sku: sku,
    name: name,
    item_type: type,
    unit: unit,
    hs_code: hsCode,
    country_of_origin: country,
    default_supplier_id: supplierId || null,
    reorder_level: parseFloat(reorder || 10),
    currency: currency,
    cost_price: parseFloat(cost || 0),
    selling_price: parseFloat(price || cost),
    description: desc
  };

  let created = null;
  if (editId) {
    await API.updateEntity('product', editId, payload);
    created = { id: editId, ...payload };
    alert('✓ Master Product SKU updated.');
  } else {
    const res = await API.createProduct(payload);
    created = (res && res.data) ? res.data : { id: 'prod-' + Date.now(), ...payload };
    alert('✓ Master Product SKU registered into Catalog.');
  }

  closeModal('modal-add-product');
  if (_quickAddContext && (_quickAddContext.entityType === 'product' || _quickAddContext.entityType === 'item')) {
    await handleQuickAddCompletion('product', created);
  } else {
    await renderActiveView();
  }
}

// 3B. WAREHOUSE MASTER CONTROLLERS
function openNewWarehouseModal() {
  const editEl = document.getElementById('wh-edit-id');
  if (editEl) editEl.value = '';
  const nameEl = document.getElementById('wh-name');
  if (nameEl) nameEl.value = '';
  const cityEl = document.getElementById('wh-city');
  if (cityEl) cityEl.value = 'Lahore';
  const locEl = document.getElementById('wh-location');
  if (locEl) locEl.value = '';
  const mgrEl = document.getElementById('wh-manager');
  if (mgrEl) mgrEl.value = '';
  const phEl = document.getElementById('wh-phone');
  if (phEl) phEl.value = '';
  openModal('modal-add-warehouse');
}

async function submitNewWarehouseForm() {
  const editId = document.getElementById('wh-edit-id')?.value;
  const name = document.getElementById('wh-name')?.value;
  const city = document.getElementById('wh-city')?.value;
  const location = document.getElementById('wh-location')?.value;
  const manager = document.getElementById('wh-manager')?.value;
  const phone = document.getElementById('wh-phone')?.value;

  if (!name) {
    alert('Warehouse Name is mandatory.');
    return;
  }

  const payload = {
    warehouse_name: name,
    city: city || 'Lahore',
    location: location || null,
    manager_name: manager || null,
    contact_phone: phone || null
  };

  let created = null;
  if (editId) {
    await API.updateEntity('warehouse', editId, payload);
    created = { id: editId, ...payload };
    alert('✓ Warehouse details updated.');
  } else {
    const res = await API.createWarehouse(payload);
    created = (res && res.data) ? res.data : { id: 'wh-' + Date.now(), ...payload };
    alert('✓ Warehouse location created.');
  }

  closeModal('modal-add-warehouse');
  if (_quickAddContext && _quickAddContext.entityType === 'warehouse') {
    await handleQuickAddCompletion('warehouse', created);
  } else {
    await renderActiveView();
  }
}

// --------------------------------------------------------------------------
// EXPENDITURE MODAL DYNAMIC HANDLERS (GENERAL, TENDER, QUOTATION)
// --------------------------------------------------------------------------

let _cachedExpenseOpportunities = [];
let _cachedExpenseSuggestions = [];

async function openExpenseModal() {
  const el = document.getElementById('modal-add-expense');
  if (!el) return;

  // Reset basic inputs
  const typeEl = document.getElementById('exp-type');
  const nameEl = document.getElementById('exp-name');
  const oppIdEl = document.getElementById('exp-opportunity-id');
  const searchEl = document.getElementById('exp-linked-search');
  const catEl = document.getElementById('exp-category');
  const amountEl = document.getElementById('exp-amount');
  const dateEl = document.getElementById('exp-date');
  const paidToEl = document.getElementById('exp-paid-to');
  const modeEl = document.getElementById('exp-mode');
  const remarksEl = document.getElementById('exp-remarks');
  const badgeEl = document.getElementById('exp-linked-selected-badge');
  const menuEl = document.getElementById('exp-linked-dropdown');

  if (typeEl) typeEl.value = 'General Expense';
  if (nameEl) nameEl.value = '';
  if (oppIdEl) oppIdEl.value = '';
  if (searchEl) searchEl.value = '';
  if (catEl) catEl.value = 'Courier & Logistics';
  if (amountEl) amountEl.value = '';
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (paidToEl) paidToEl.value = '';
  if (modeEl) modeEl.value = 'Cash';
  if (remarksEl) remarksEl.value = '';
  if (badgeEl) { badgeEl.style.display = 'none'; badgeEl.innerHTML = ''; }
  if (menuEl) menuEl.style.display = 'none';

  // Open modal visual
  el.classList.add('open');

  // Load opportunities & previous expense names asynchronously
  try {
    _cachedExpenseOpportunities = await API.getOpportunities(State.currentBusinessProfileId);
    _cachedExpenseSuggestions = await API.getExpenseSuggestions();
  } catch (e) {
    _cachedExpenseOpportunities = [];
    _cachedExpenseSuggestions = [];
  }

  // Populate Autocomplete datalist for General Expense
  populateExpenseNameSuggestions();

  // Apply initial type visibility
  handleExpenseTypeChange();
}

function populateExpenseNameSuggestions() {
  const datalist = document.getElementById('exp-name-datalist');
  if (!datalist) return;

  // Curated common business expense names + user previously entered expense names
  const defaultSuggestions = [
    'Office Stationery & Printing',
    'Lab Testing - Dielectric Breakdown Sample',
    'Transformer Oil Lab Testing & Certification',
    'Technical Proposal Dispatch via Courier',
    'Bid Security Guarantee Bank Processing Fee',
    'Site Inspection Visits & Generator Fuel',
    'Head Office Electricity & Utility Bill',
    'Staff Monthly Salaries & Overtime',
    'Corporate Client Meeting Refreshments',
    'Warehouse Storage Rent',
    'Company Vehicle Routine Maintenance',
    'Legal & Tax Advisory Retainership'
  ];

  const combined = Array.from(new Set([...(_cachedExpenseSuggestions || []), ...defaultSuggestions]));
  datalist.innerHTML = combined.map(name => `<option value="${name.replace(/"/g, '&quot;')}"></option>`).join('');
}

function handleExpenseTypeChange() {
  const type = document.getElementById('exp-type')?.value || 'General Expense';
  const groupName = document.getElementById('group-exp-name');
  const groupLinked = document.getElementById('group-exp-linked');
  const linkedLabel = document.getElementById('exp-linked-label');
  const linkedSearch = document.getElementById('exp-linked-search');
  const oppIdEl = document.getElementById('exp-opportunity-id');
  const badgeEl = document.getElementById('exp-linked-selected-badge');
  const menuEl = document.getElementById('exp-linked-dropdown');

  if (oppIdEl) oppIdEl.value = '';
  if (linkedSearch) linkedSearch.value = '';
  if (badgeEl) { badgeEl.style.display = 'none'; badgeEl.innerHTML = ''; }
  if (menuEl) menuEl.style.display = 'none';

  if (type === 'General Expense') {
    if (groupName) groupName.style.display = 'block';
    if (groupLinked) groupLinked.style.display = 'none';
  } else if (type === 'Tender Expense') {
    if (groupName) groupName.style.display = 'none';
    if (groupLinked) groupLinked.style.display = 'block';
    if (linkedLabel) linkedLabel.innerText = 'Select Tender *';
    if (linkedSearch) linkedSearch.placeholder = 'Type to search tender by title or tender #...';
  } else if (type === 'Quotation Expense') {
    if (groupName) groupName.style.display = 'none';
    if (groupLinked) groupLinked.style.display = 'block';
    if (linkedLabel) linkedLabel.innerText = 'Select Quotation *';
    if (linkedSearch) linkedSearch.placeholder = 'Type to search quotation by title or quotation #...';
  }
}

function getFilteredOpportunitiesForActiveType(query = '') {
  const type = document.getElementById('exp-type')?.value || 'General Expense';
  const q = (query || '').toLowerCase().trim();

  let list = _cachedExpenseOpportunities || [];

  if (type === 'Tender Expense') {
    // Filter tenders (all tenders or those not strictly direct sales quotation)
    const tenders = list.filter(o => 
      (o.tender_source !== 'DIRECT SALES' && o.tender_type !== 'Direct Sales / Quotation' && !(o.opportunity_number || '').startsWith('QTN'))
    );
    list = tenders.length > 0 ? tenders : list;
  } else if (type === 'Quotation Expense') {
    // Filter direct sales / quotations
    const quotations = list.filter(o => 
      (o.tender_source === 'DIRECT SALES' || o.tender_type === 'Direct Sales / Quotation' || (o.opportunity_number || '').startsWith('QTN'))
    );
    list = quotations.length > 0 ? quotations : list;
  }

  if (q) {
    list = list.filter(o => 
      (o.opportunity_number && o.opportunity_number.toLowerCase().includes(q)) ||
      (o.tender_name && o.tender_name.toLowerCase().includes(q)) ||
      (o.title && o.title.toLowerCase().includes(q)) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(q))
    );
  }

  return list;
}

function openLinkedDropdown() {
  const linkedSearch = document.getElementById('exp-linked-search');
  filterLinkedOpportunities(linkedSearch?.value || '');
}

function filterLinkedOpportunities(query = '') {
  const menuEl = document.getElementById('exp-linked-dropdown');
  if (!menuEl) return;

  const type = document.getElementById('exp-type')?.value || 'General Expense';
  const isQuotation = type === 'Quotation Expense';
  const items = getFilteredOpportunitiesForActiveType(query);

  if (items.length === 0) {
    menuEl.innerHTML = `<div class="searchable-empty-state">No matching ${isQuotation ? 'quotations' : 'tenders'} found.</div>`;
    menuEl.style.display = 'block';
    return;
  }

  menuEl.innerHTML = items.map(o => {
    const oppNum = o.opportunity_number || (isQuotation ? 'QTN-2026' : 'TND-2026');
    const title = o.tender_name || o.title || 'Untitled Project';
    const client = o.customer_name || 'Client';
    const val = parseFloat(o.estimated_value || 0).toLocaleString();
    const safeDisplay = `${oppNum} - ${title}`.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
      <div class="searchable-dropdown-item" onclick="selectLinkedOpportunity('${o.id}', '${safeDisplay}', '${oppNum}')">
        <div class="searchable-item-title">
          <span><strong>${oppNum}</strong> - ${title}</span>
          <span class="badge ${isQuotation ? 'badge-won' : 'badge-active'}" style="font-size:0.7rem;">${isQuotation ? 'Quotation' : 'Tender'}</span>
        </div>
        <div class="searchable-item-sub">
          🏢 ${client} &nbsp;|&nbsp; 💰 Est. PKR ${val} &nbsp;|&nbsp; Status: ${o.status || 'Active'}
        </div>
      </div>
    `;
  }).join('');

  menuEl.style.display = 'block';
}

function selectLinkedOpportunity(id, displayText, oppNum) {
  const oppIdEl = document.getElementById('exp-opportunity-id');
  const searchEl = document.getElementById('exp-linked-search');
  const badgeEl = document.getElementById('exp-linked-selected-badge');
  const menuEl = document.getElementById('exp-linked-dropdown');

  if (oppIdEl) oppIdEl.value = id;
  if (searchEl) searchEl.value = displayText;
  if (menuEl) menuEl.style.display = 'none';

  if (badgeEl) {
    badgeEl.innerHTML = `✓ Linked to: <span style="color:var(--text-main); font-weight:700;">${displayText}</span>`;
    badgeEl.style.display = 'block';
  }
}

// Close searchable dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrapper = document.getElementById('exp-searchable-wrapper');
  const menuEl = document.getElementById('exp-linked-dropdown');
  if (wrapper && menuEl && !wrapper.contains(e.target)) {
    menuEl.style.display = 'none';
  }
});

async function submitGeneralExpenseForm() {
  const type = document.getElementById('exp-type')?.value || 'General Expense';
  const name = document.getElementById('exp-name')?.value?.trim();
  const oppId = document.getElementById('exp-opportunity-id')?.value;
  const cat = document.getElementById('exp-category')?.value;
  const amount = document.getElementById('exp-amount')?.value;
  const date = document.getElementById('exp-date')?.value;
  const paidTo = document.getElementById('exp-paid-to')?.value;
  const mode = document.getElementById('exp-mode')?.value;
  const remarks = document.getElementById('exp-remarks')?.value;

  if (!amount || parseFloat(amount) <= 0) {
    alert('Please enter a valid expenditure amount.');
    document.getElementById('exp-amount')?.focus();
    return;
  }

  if (!date) {
    alert('Date is mandatory.');
    return;
  }

  if (type === 'General Expense' && !name) {
    alert('Expense Name is mandatory for General Expense.');
    document.getElementById('exp-name')?.focus();
    return;
  }

  if (type === 'Tender Expense' && !oppId) {
    alert('Please select a Tender from the searchable dropdown.');
    document.getElementById('exp-linked-search')?.focus();
    return;
  }

  if (type === 'Quotation Expense' && !oppId) {
    alert('Please select a Quotation from the searchable dropdown.');
    document.getElementById('exp-linked-search')?.focus();
    return;
  }

  // Derive display expense name for tender/quotation if not provided
  let finalExpenseName = name;
  let linkedOpp = null;
  if (oppId) {
    linkedOpp = (_cachedExpenseOpportunities || []).find(o => o.id === oppId);
    if (!finalExpenseName && linkedOpp) {
      finalExpenseName = `${cat} - ${linkedOpp.opportunity_number}`;
    }
  }

  const payload = {
    business_profile_id: State.currentBusinessProfileId === 'all' ? null : State.currentBusinessProfileId,
    expense_type: type,
    expense_name: finalExpenseName || cat,
    category: cat,
    amount: parseFloat(amount),
    expense_date: date,
    paid_to: paidTo || 'Company Petty Cash',
    payment_mode: mode || 'Cash',
    opportunity_id: oppId || null,
    opportunity_number: linkedOpp?.opportunity_number || null,
    tender_name: linkedOpp?.tender_name || linkedOpp?.title || null,
    remarks: remarks
  };

  const res = await API.createExpense(payload);

  closeModal('modal-add-expense');
  alert(`✓ ${type} of PKR ${parseFloat(amount).toLocaleString()} recorded successfully!`);

  // Refresh active view or navigate to expenses
  if (State.activeView === 'expenses') {
    await renderActiveView();
  } else {
    navigateToView('expenses');
  }
}

async function submitNewCompanyForm() {
  const name = document.getElementById('comp-name')?.value;
  const legal = document.getElementById('comp-legal')?.value;
  const ntn = document.getElementById('comp-ntn')?.value;
  const city = document.getElementById('comp-city')?.value;
  const invPrefix = document.getElementById('comp-inv-prefix')?.value;
  const fbr = document.getElementById('comp-fbr')?.value;

  if (!name || !legal) {
    alert('Business Name and Legal Name are mandatory');
    return;
  }

  const payload = {
    business_name: name,
    legal_name: legal,
    ntn: ntn,
    city: city,
    invoice_prefix: invPrefix,
    fbr_enabled: fbr === 'true'
  };

  const res = await API.createBusinessProfile(payload);
  const created = (res && res.data) ? res.data : { id: 'bp-' + Date.now(), ...payload };

  closeModal('modal-add-company');
  if (res.billingNotice) {
    alert(`${res.billingNotice.notice}\nPlan charge: ${res.billingNotice.chargePerMonth}`);
  } else {
    alert('Company profile created successfully.');
  }

  State.businessProfiles = await API.getBusinessProfiles();
  populateBusinessSwitcher();

  if (_quickAddContext && (_quickAddContext.entityType === 'company' || _quickAddContext.entityType === 'businessProfile')) {
    await handleQuickAddCompletion('company', created);
  } else {
    navigateToView('business-profiles');
  }
}

// ============================================================================
// UNIVERSAL DYNAMIC EDIT CONTROLLER (ALL LISTING PAGES)
// ============================================================================

const ENTITY_SCHEMAS = {
  opportunity: {
    title: 'Tender / Opportunity',
    fetchFn: () => API.getOpportunities(State.currentBusinessProfileId),
    fields: [
      { name: 'tender_name', label: 'Tender / Project Name *', type: 'text', required: true, fallbackField: 'title' },
      { name: 'tender_source', label: 'Tender Source', type: 'select', options: ['PPRA', 'DGP', 'RFQ', 'LPQ', 'OTHER', 'DIRECT SALES'] },
      { name: 'tender_type', label: 'Tender Type', type: 'select', options: ['Public Tender', 'Limited Tender', 'Direct Sales / Quotation', 'EPB / Trade Portal'] },
      { name: 'external_tender_number', label: 'External Ref #', type: 'text' },
      { name: 'estimated_value', label: 'Estimated Value (PKR) *', type: 'number', required: true },
      { name: 'closing_date', label: 'Closing Date / Deadline *', type: 'date', required: true },
      { name: 'status', label: 'Workflow Status', type: 'select', options: ['New', 'Selected', 'Under Review', 'Ready to submit', 'Submitted', 'won', 'loose', 'withdraw'] },
      { name: 'description', label: 'Description & Scope', type: 'textarea', colSpan: 2 }
    ]
  },
  'bid-security': {
    title: 'Bid Security Instrument',
    fetchFn: () => API.getBidSecurities(State.currentBusinessProfileId),
    fields: [
      { name: 'account_title', label: 'Account Title *', type: 'text', required: true },
      { name: 'beneficiary', label: 'Beneficiary *', type: 'text', required: true },
      { name: 'instrument_type', label: 'Instrument Type *', type: 'select', options: ['PO', 'CDR', 'BG', 'Insurance Bond', 'Other'], required: true },
      { name: 'instrument_number', label: 'Instrument Number *', type: 'text', required: true },
      { name: 'amount', label: 'Amount (PKR) *', type: 'number', required: true },
      { name: 'bank_name', label: 'Issuing Bank & Branch', type: 'text' },
      { name: 'expiry_date', label: 'Expiry Date *', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Submitted', 'Released', 'Encashment Claimed'] },
      { name: 'comments', label: 'Comments / Remarks', type: 'textarea', colSpan: 2 }
    ]
  },
  award: {
    title: 'Letter of Award (LOA)',
    fetchFn: () => API.getAwards(),
    fields: [
      { name: 'award_number', label: 'Award / LOA Number *', type: 'text', required: true },
      { name: 'award_date', label: 'Award Date *', type: 'date', required: true },
      { name: 'award_amount', label: 'Award Value (PKR) *', type: 'number', required: true },
      { name: 'acceptance_deadline', label: 'Acceptance Deadline', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Accepted', 'Rejected'] },
      { name: 'remarks', label: 'Remarks / Conditions', type: 'textarea', colSpan: 2 }
    ]
  },
  guarantee: {
    title: 'Performance Guarantee (PBG)',
    fetchFn: () => API.getGuarantees(),
    fields: [
      { name: 'guarantee_number', label: 'Guarantee / PBG Number *', type: 'text', required: true },
      { name: 'bank_name', label: 'Issuing Bank *', type: 'text', required: true },
      { name: 'amount', label: 'Amount (PKR) *', type: 'number', required: true },
      { name: 'expiry_date', label: 'Expiry Date *', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Released', 'Invoked'] },
      { name: 'remarks', label: 'Remarks', type: 'textarea', colSpan: 2 }
    ]
  },
  'purchase-order': {
    title: 'Purchase Order (PO)',
    fetchFn: () => API.getPurchaseOrders(State.currentBusinessProfileId),
    fields: [
      { name: 'po_number', label: 'PO Number *', type: 'text', required: true },
      { name: 'po_date', label: 'PO Date *', type: 'date', required: true },
      { name: 'delivery_deadline', label: 'Delivery Deadline', type: 'date' },
      { name: 'total_amount', label: 'Net Total Amount (PKR) *', type: 'number', required: true, fallbackField: 'net_amount' },
      { name: 'payment_terms', label: 'Payment Terms', type: 'text' },
      { name: 'status', label: 'PO Status', type: 'select', options: ['Issued', 'Partial DC', 'Fulfilled', 'Cancelled'] }
    ]
  },
  'delivery-challan': {
    title: 'Delivery Challan (DC)',
    fetchFn: () => API.getDeliveryChallans(State.currentBusinessProfileId),
    fields: [
      { name: 'dc_number', label: 'DC Number *', type: 'text', required: true },
      { name: 'delivery_date', label: 'Delivery Date *', type: 'date', required: true },
      { name: 'delivery_method', label: 'Delivery Method', type: 'select', options: ['3PL', 'Hired Delivery', 'Customer Pickup', 'Self Fleet'] },
      { name: 'logistics_provider', label: 'Logistics Provider / Carrier', type: 'text' },
      { name: 'tracking_number', label: 'Tracking / Bilty #', type: 'text' },
      { name: 'driver_name', label: 'Driver / Contact Name', type: 'text' },
      { name: 'driver_contact', label: 'Driver Phone', type: 'text' },
      { name: 'delivery_cost', label: 'Delivery Cost (PKR)', type: 'number' },
      { name: 'status', label: 'DC Status', type: 'select', options: ['Dispatched', 'In_Transit', 'Delivered', 'Returned'] },
      { name: 'remarks', label: 'Remarks', type: 'textarea', colSpan: 2 }
    ]
  },
  invoice: {
    title: 'Invoice',
    fetchFn: () => API.getInvoices(State.currentBusinessProfileId),
    fields: [
      { name: 'invoice_number', label: 'Invoice Number *', type: 'text', required: true },
      { name: 'invoice_date', label: 'Invoice Date *', type: 'date', required: true },
      { name: 'due_date', label: 'Due Date', type: 'date' },
      { name: 'total_amount', label: 'Total Amount (PKR) *', type: 'number', required: true },
      { name: 'status', label: 'Invoice Status', type: 'select', options: ['Submitted', 'Reinvoicing', 'Pending', 'Hold', 'Paid'] },
      { name: 'payment_terms', label: 'Payment Terms', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 }
    ]
  },
  payment: {
    title: 'Payment Receipt',
    fetchFn: () => API.getPayments(State.currentBusinessProfileId),
    fields: [
      { name: 'payment_number', label: 'Receipt / Voucher # *', type: 'text', required: true },
      { name: 'payment_date', label: 'Payment Date *', type: 'date', required: true },
      { name: 'amount', label: 'Amount Paid (PKR) *', type: 'number', required: true },
      { name: 'payment_method', label: 'Payment Method', type: 'select', options: ['Cheque', 'Online', 'Cash', 'PayOrder'] },
      { name: 'check_no', label: 'Cheque / Instrument #', type: 'text' },
      { name: 'check_from', label: 'Issuer / Account Name', type: 'text' },
      { name: 'bank_account', label: 'Deposited In Bank Account', type: 'text' },
      { name: 'reference_number', label: 'Bank Voucher / Ref #', type: 'text' },
      { name: 'notes', label: 'Notes / Remarks', type: 'textarea', colSpan: 2 }
    ]
  },
  warehouse: {
    title: 'Warehouse Location',
    fetchFn: () => API.getWarehouses(),
    fields: [
      { name: 'warehouse_name', label: 'Warehouse Name *', type: 'text', required: true },
      { name: 'warehouse_code', label: 'Warehouse Code', type: 'text' },
      { name: 'location', label: 'Address / Location', type: 'text' },
      { name: 'city', label: 'City *', type: 'text', required: true },
      { name: 'manager_name', label: 'Manager Name', type: 'text' },
      { name: 'contact_phone', label: 'Contact Phone', type: 'text' }
    ]
  },
  procurement: {
    title: 'Procurement Order',
    fetchFn: () => API.getProcurements(),
    fields: [
      { name: 'procurement_number', label: 'Procurement # *', type: 'text', required: true },
      { name: 'origin_country', label: 'Origin Country', type: 'text' },
      { name: 'currency', label: 'Currency', type: 'select', options: ['PKR', 'USD', 'EUR', 'CNY', 'AED'] },
      { name: 'total_landed_cost', label: 'Total Landed Cost *', type: 'number', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Draft', 'Ordered', 'In_Transit', 'Customs_Cleared', 'Received_In_Warehouse'] },
      { name: 'remarks', label: 'Remarks', type: 'textarea', colSpan: 2 }
    ]
  },
  expense: {
    title: 'Expenditure Record',
    fetchFn: () => API.getExpenses(State.currentBusinessProfileId),
    fields: [
      { name: 'expense_type', label: 'Expenditure Type *', type: 'select', options: ['General Expense', 'Tender Expense', 'Quotation Expense'], required: true },
      { name: 'expense_name', label: 'Expense Name / Purpose *', type: 'text', required: true },
      { name: 'category', label: 'Expense Category *', type: 'select', options: [
        'Samples', 'Courier & Logistics', 'Gifting', 'Other Direct Costs', 'Taxes & Duties',
        'Salaries', 'Fuel', 'Maintenance', 'Overheads', 'Utility Bills', 'Warehouse Rent',
        'Refreshments', 'Administrative Expenses'
      ], required: true },
      { name: 'amount', label: 'Amount (PKR) *', type: 'number', required: true },
      { name: 'expense_date', label: 'Expense Date *', type: 'date', required: true },
      { name: 'paid_to', label: 'Paid To / Vendor', type: 'text' },
      { name: 'payment_mode', label: 'Payment Mode', type: 'select', options: ['Cash', 'Online', 'Cheque', 'Company Card'] },
      { name: 'remarks', label: 'Remarks / Description', type: 'textarea', colSpan: 2 }
    ]
  },
  customer: {
    title: 'Customer Account',
    fetchFn: () => API.getCustomers(),
    fields: [
      { name: 'business_name', label: 'Customer / Company Name *', type: 'text', required: true },
      { name: 'org_type', label: 'Organization Type *', type: 'select', options: ['Government', 'Semi-Government', 'Autonomous', 'MNC', 'Private', 'NGO', 'Other'], required: true },
      { name: 'department_name', label: 'Department / Wing', type: 'text' },
      { name: 'ntn', label: 'NTN Number', type: 'text' },
      { name: 'strn', label: 'STRN Number', type: 'text' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'contact_person', label: 'Contact Person', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' }
    ]
  },
  supplier: {
    title: 'Supplier Registry',
    fetchFn: () => API.getSuppliers(),
    fields: [
      { name: 'supplier_name', label: 'Supplier Name *', type: 'text', required: true },
      { name: 'origin', label: 'Origin *', type: 'select', options: ['Local', 'International'], required: true },
      { name: 'country', label: 'Country', type: 'text' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'contact_person', label: 'Contact Person', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'rating', label: 'Rating (1 to 5 Stars)', type: 'select', options: ['5', '4', '3', '2', '1'] },
      { name: 'payment_terms', label: 'Payment Terms', type: 'text' }
    ]
  },
  product: {
    title: 'Product / Item SKU',
    fetchFn: () => API.getProducts(),
    fields: [
      { name: 'name', label: 'Item Name *', type: 'text', required: true },
      { name: 'sku', label: 'SKU / Code', type: 'text' },
      { name: 'unit', label: 'Unit', type: 'text' },
      { name: 'cost_price', label: 'Cost Price (PKR)', type: 'number' },
      { name: 'selling_price', label: 'Selling Price (PKR) *', type: 'number', required: true },
      { name: 'current_stock', label: 'Current Stock', type: 'number' },
      { name: 'reorder_level', label: 'Reorder Level', type: 'number' },
      { name: 'description', label: 'Description', type: 'textarea', colSpan: 2 }
    ]
  },
  'business-profile': {
    title: 'Company / Business Profile',
    fetchFn: () => API.getBusinessProfiles(),
    fields: [
      { name: 'business_name', label: 'Business Display Name *', type: 'text', required: true },
      { name: 'legal_name', label: 'Legal Name *', type: 'text', required: true },
      { name: 'ntn', label: 'National Tax Number (NTN)', type: 'text' },
      { name: 'strn', label: 'Sales Tax Registration (STRN)', type: 'text' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'invoice_prefix', label: 'Invoice Prefix', type: 'text' },
      { name: 'fbr_enabled', label: 'Enable FBR PRAL Gateway', type: 'select', options: [
        { value: 'true', label: 'Yes (Active)' },
        { value: 'false', label: 'No (Skip FBR)' }
      ] }
    ]
  },
  user: {
    title: 'User Account',
    fetchFn: () => (API.getUsers ? API.getUsers() : Promise.resolve([])),
    fields: [
      { name: 'full_name', label: 'Full Name *', type: 'text', required: true },
      { name: 'email', label: 'Email *', type: 'text', required: true },
      { name: 'role', label: 'Role *', type: 'select', options: ['SuperAdmin', 'CompanyAdmin', 'BidManager', 'Procurement', 'Warehouse', 'Finance'], required: true },
      { name: 'status', label: 'Account Status', type: 'select', options: ['Active', 'Inactive', 'Suspended'] }
    ]
  }
};

async function openEditEntityModal(entityType, id) {
  const schema = ENTITY_SCHEMAS[entityType];
  if (!schema) {
    alert(`Edit configuration for ${entityType} is not available.`);
    return;
  }

  // Fetch or find record
  let record = null;
  try {
    const list = await schema.fetchFn();
    if (Array.isArray(list)) {
      record = list.find(item => String(item.id) === String(id));
    }
  } catch (e) {
    console.error('Error fetching entity for edit:', e);
  }

  if (!record) {
    // Fallback search in userList or mock if not found in list
    if (entityType === 'user') {
      const mockUsers = [
        { id: 'u1', full_name: 'Muhammad Naeem Khan', email: 'naeem@mashrue.com', role: 'CompanyAdmin', status: 'Active' },
        { id: 'u2', full_name: 'Tariq Javed', email: 'tariq@mashrue.com', role: 'BidManager', status: 'Active' }
      ];
      record = mockUsers.find(u => String(u.id) === String(id)) || mockUsers[0];
    } else {
      record = { id: id };
    }
  }

  // Set modal title & hidden inputs
  const titleEl = document.getElementById('edit-modal-title');
  const typeInput = document.getElementById('edit-entity-type');
  const idInput = document.getElementById('edit-entity-id');
  const container = document.getElementById('edit-fields-container');

  if (titleEl) titleEl.textContent = `✏️ Edit ${schema.title}`;
  if (typeInput) typeInput.value = entityType;
  if (idInput) idInput.value = id;

  if (!container) return;

  // Render form fields
  const fieldsHTML = schema.fields.map(f => {
    let rawVal = record[f.name];
    if (rawVal === undefined && f.fallbackField) {
      rawVal = record[f.fallbackField];
    }

    let val = rawVal !== undefined && rawVal !== null ? rawVal : '';

    // Format date string to YYYY-MM-DD
    if (f.type === 'date' && val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        val = d.toISOString().split('T')[0];
      }
    }

    const fieldId = `edit-field-${f.name}`;
    const colStyle = f.colSpan === 2 ? 'grid-column: span 2;' : '';

    if (f.type === 'select') {
      const optionsHTML = f.options.map(opt => {
        const optVal = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? opt.label : opt;
        const isSelected = String(val).toLowerCase() === String(optVal).toLowerCase();
        return `<option value="${optVal}" ${isSelected ? 'selected' : ''}>${optLabel}</option>`;
      }).join('');

      return `
        <div class="form-group" style="${colStyle}">
          <label class="form-label">${f.label}</label>
          <select class="form-select" id="${fieldId}" name="${f.name}" ${f.required ? 'required' : ''}>
            ${optionsHTML}
          </select>
        </div>
      `;
    } else if (f.type === 'textarea') {
      return `
        <div class="form-group" style="${colStyle}">
          <label class="form-label">${f.label}</label>
          <textarea class="form-control" id="${fieldId}" name="${f.name}" rows="3" ${f.required ? 'required' : ''}>${val}</textarea>
        </div>
      `;
    } else {
      return `
        <div class="form-group" style="${colStyle}">
          <label class="form-label">${f.label}</label>
          <input type="${f.type || 'text'}" class="form-control" id="${fieldId}" name="${f.name}" value="${val}" ${f.required ? 'required' : ''} ${f.type === 'number' ? 'step="any"' : ''}>
        </div>
      `;
    }
  }).join('');

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 14px;">
      ${fieldsHTML}
    </div>
  `;

  openModal('modal-universal-edit');
}

async function submitUniversalEdit() {
  const entityType = document.getElementById('edit-entity-type')?.value;
  const id = document.getElementById('edit-entity-id')?.value;
  const schema = ENTITY_SCHEMAS[entityType];

  if (!schema || !id) {
    alert('Missing entity information for update.');
    return;
  }

  // Collect values
  const payload = {};
  for (const f of schema.fields) {
    const el = document.getElementById(`edit-field-${f.name}`);
    if (el) {
      if (f.required && !el.value.trim()) {
        alert(`${f.label.replace('*', '').trim()} is required.`);
        el.focus();
        return;
      }
      if (f.type === 'number') {
        payload[f.name] = el.value !== '' ? parseFloat(el.value) : 0;
      } else {
        payload[f.name] = el.value;
      }
    }
  }

  try {
    const res = await API.updateEntity(entityType, id, payload);
    closeModal('modal-universal-edit');
    alert(`✓ ${schema.title} updated successfully!`);
    await renderActiveView();
  } catch (err) {
    console.error('Update error:', err);
    alert(`Failed to update record: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// COMPANY ONBOARDING & PAID LIMIT ACTION HANDLERS
// --------------------------------------------------------------------------

async function submitOnboardCompanyForm() {
  const name = document.getElementById('onboard-comp-name')?.value;
  const legal = document.getElementById('onboard-comp-legal')?.value;
  const ntn = document.getElementById('onboard-comp-ntn')?.value;
  const strn = document.getElementById('onboard-comp-strn')?.value;
  const city = document.getElementById('onboard-comp-city')?.value;
  const prefix = document.getElementById('onboard-comp-prefix')?.value;
  const email = document.getElementById('onboard-comp-email')?.value;
  const fbrEnabled = document.getElementById('onboard-comp-fbr')?.checked;

  if (!name || !legal) {
    alert('Business Display Name and Legal Name are mandatory.');
    return;
  }

  const payload = {
    business_name: name,
    legal_name: legal,
    ntn,
    strn,
    city: city || 'Lahore',
    invoice_prefix: prefix || 'INV',
    email,
    fbr_enabled: Boolean(fbrEnabled)
  };

  try {
    const res = await API.createBusinessProfile(payload);
    if (res && res.success) {
      closeModal('modal-onboard-company');
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      
      if (fbrEnabled) {
        alert('🎉 First Company created! Redirecting to FBR Digital Invoicing Configuration...');
        switchView('settings');
      } else {
        alert('🎉 Welcome! Your first company has been set up successfully.');
        switchView('dashboard');
      }
    } else {
      alert(res.message || 'Failed to create company.');
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function submitNewCompanyForm() {
  const name = document.getElementById('comp-name')?.value;
  const legal = document.getElementById('comp-legal')?.value;
  const ntn = document.getElementById('comp-ntn')?.value;
  const city = document.getElementById('comp-city')?.value;
  const prefix = document.getElementById('comp-inv-prefix')?.value;
  const fbrSelect = document.getElementById('comp-fbr')?.value;

  if (!name || !legal) {
    alert('Business Name and Legal Name are mandatory');
    return;
  }

  const payload = {
    business_name: name,
    legal_name: legal,
    ntn,
    city: city || 'Lahore',
    invoice_prefix: prefix || 'INV',
    fbr_enabled: fbrSelect === 'true'
  };

  try {
    const res = await fetch(`${API_BASE}/business-profiles`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.status === 402 || data.requires_payment_confirmation) {
      pendingPaidCompanyPayload = payload;
      openModal('modal-paid-company-warning');
      return;
    }

    if (data.success) {
      closeModal('modal-add-company');
      alert('✓ Company Profile added successfully!');
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      await renderActiveView();
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (err) {
    alert(`Failed to save company: ${err.message}`);
  }
}

async function confirmAndCreatePaidCompany() {
  if (!pendingPaidCompanyPayload) return;

  try {
    const res = await fetch(`${API_BASE}/business-profiles`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify({ ...pendingPaidCompanyPayload, confirm_paid: true })
    });
    const data = await res.json();

    closeModal('modal-paid-company-warning');
    closeModal('modal-add-company');
    pendingPaidCompanyPayload = null;

    if (data.success) {
      alert('✓ 3rd Company Profile created with paid add-on billing applied!');
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      await renderActiveView();
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// RBAC USER & EMPLOYEE ACTION HANDLERS
// --------------------------------------------------------------------------

function openCreateUserModal(defaultRole = 'ClientEmployee') {
  const titleEl = document.getElementById('modal-create-user-title');
  const roleSelect = document.getElementById('newuser-role');
  const matrixContainer = document.getElementById('rbac-matrix-container');
  const companyContainer = document.getElementById('newuser-company-checkboxes');

  if (roleSelect) roleSelect.value = defaultRole;
  if (titleEl) {
    titleEl.innerText = defaultRole === 'SuperAdmin' ? '👑 Add Super Admin User' : '👤 Add New Employee User';
  }

  // Populate company checkboxes
  if (companyContainer) {
    if (State.businessProfiles && State.businessProfiles.length > 0) {
      companyContainer.innerHTML = State.businessProfiles.map(p => `
        <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; cursor:pointer;">
          <input type="checkbox" class="user-company-checkbox permissions-checkbox" value="${p.id}" checked>
          <span>🏢 ${p.business_name}</span>
        </label>
      `).join('');
    } else {
      companyContainer.innerHTML = '<span style="font-size:0.8rem; color:#64748b;">No individual companies configured yet. User will have access to all.</span>';
    }
  }

  handleUserRoleSelection(defaultRole);
  openModal('modal-create-user');
}

function handleUserRoleSelection(role) {
  const matrixContainer = document.getElementById('rbac-matrix-container');
  if (!matrixContainer) return;

  if (role === 'SuperAdmin' || role === 'ClientAdmin') {
    matrixContainer.style.display = 'none'; // Admins have full access
  } else {
    matrixContainer.style.display = 'block'; // Employees have granular access
  }
}

async function submitCreateUserForm() {
  const fullname = document.getElementById('newuser-fullname')?.value;
  const username = document.getElementById('newuser-username')?.value;
  const email = document.getElementById('newuser-email')?.value;
  const password = document.getElementById('newuser-password')?.value;
  const role = document.getElementById('newuser-role')?.value || 'ClientEmployee';
  const canSeePrices = document.getElementById('newuser-can-see-prices')?.checked;

  if (!fullname || !email || !password) {
    alert('Full name, email, and password are required.');
    return;
  }

  // Gather granular permissions
  const permissions = {};
  const toggles = document.querySelectorAll('.perm-toggle');
  toggles.forEach(t => {
    const mod = t.dataset.module;
    const act = t.dataset.action;
    if (!permissions[mod]) permissions[mod] = {};
    permissions[mod][act] = t.checked;
  });

  // Gather selected company IDs
  const compCheckboxes = document.querySelectorAll('.user-company-checkbox:checked');
  const businessProfileIds = Array.from(compCheckboxes).map(c => c.value);

  const payload = {
    full_name: fullname,
    username: username || email.split('@')[0],
    email,
    password,
    role,
    can_see_bidding_prices: canSeePrices,
    permissions,
    business_profile_ids: businessProfileIds
  };

  try {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.status === 402 || data.requires_payment_confirmation) {
      pendingPaidEmployeePayload = payload;
      openModal('modal-paid-employee-warning');
      return;
    }

    if (data.success) {
      closeModal('modal-create-user');
      alert(`✓ ${role} '${fullname}' registered successfully!`);
      await renderActiveView();
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (err) {
    alert(`Failed to create user: ${err.message}`);
  }
}

async function confirmAndCreatePaidEmployee() {
  if (!pendingPaidEmployeePayload) return;

  try {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify({ ...pendingPaidEmployeePayload, confirm_paid: true })
    });
    const data = await res.json();

    closeModal('modal-paid-employee-warning');
    closeModal('modal-create-user');
    pendingPaidEmployeePayload = null;

    if (data.success) {
      alert('✓ Employee Seat added with paid subscription add-on!');
      await renderActiveView();
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openResetPasswordModal(userId, userName) {
  const idEl = document.getElementById('reset-user-id');
  const nameEl = document.getElementById('reset-user-display-name');
  if (idEl) idEl.value = userId;
  if (nameEl) nameEl.innerText = userName || 'User';
  openModal('modal-reset-password');
}

async function submitResetPasswordForm() {
  const userId = document.getElementById('reset-user-id')?.value;
  const newPass = document.getElementById('reset-new-password')?.value;
  const forceChange = document.getElementById('reset-force-change')?.checked;

  if (!userId || !newPass) {
    alert('User and new password are required.');
    return;
  }

  try {
    const res = await API.resetPassword(userId, newPass, forceChange);
    if (res && res.success) {
      closeModal('modal-reset-password');
      alert(`✓ ${res.message}`);
    } else {
      alert(res.message || 'Failed to reset password.');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function submitCreateTenantForm() {
  const nameInput = document.getElementById('tenant-company-name');
  const slugInput = document.getElementById('tenant-subdomain');
  const planInput = document.getElementById('tenant-plan');
  const adminNameInput = document.getElementById('tenant-admin-name');
  const adminEmailInput = document.getElementById('tenant-admin-email');
  const adminPasswordInput = document.getElementById('tenant-admin-password');

  const name = nameInput?.value?.trim();
  const slug = slugInput?.value?.trim();
  const plan = planInput?.value || 'Standard';
  const adminName = adminNameInput?.value?.trim();
  const adminEmail = adminEmailInput?.value?.trim();
  const adminPassword = adminPasswordInput?.value;

  if (!name || !adminEmail || !adminPassword) {
    alert('Company name, admin email, and password are required.');
    return;
  }

  const payload = {
    company_name: name,
    subdomain: slug,
    subscription_plan: plan,
    admin_name: adminName,
    admin_email: adminEmail,
    admin_password: adminPassword
  };

  try {
    const res = await API.createTenant(payload);
    if (res && res.success) {
      closeModal('modal-create-tenant');
      if (nameInput) nameInput.value = '';
      if (slugInput) slugInput.value = '';
      if (adminNameInput) adminNameInput.value = '';
      if (adminEmailInput) adminEmailInput.value = '';
      if (adminPasswordInput) adminPasswordInput.value = '';

      alert(`✓ Tenant '${name}' provisioned successfully with Client Admin '${adminEmail}'!`);
      await renderActiveView();
    } else {
      alert(res.message || 'Failed to provision tenant.');
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function proceedSubmissionWithoutFBR() {
  alert('ℹ️ Proceeding with internal tender quotation submission without live FBR digital invoice sync.');
}

// --------------------------------------------------------------------------
// 19. SUPER ADMIN SUBSCRIPTION & BILLING HUB
// --------------------------------------------------------------------------
async function renderSuperAdminSubscriptionsHTML() {
  const overview = await API.getSubscriptionsOverview();
  const totalTenants = overview.length;
  const activePaid = overview.filter(o => o.subscription.status === 'Active').length;
  const inTrial = overview.filter(o => o.subscription.status === 'Trial').length;
  const totalMRR = overview.reduce((sum, o) => sum + (o.subscription.status !== 'Suspended' ? o.totalMonthly : 0), 0);

  return `
    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
        <div class="kpi-title">Total Tenant Accounts</div>
        <div class="kpi-value">${totalTenants}</div>
        <div class="kpi-subtext">Registered organizations</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Active Paid Subscriptions</div>
        <div class="kpi-value">${activePaid}</div>
        <div class="kpi-subtext">Verified paying clients</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Free Trials Running</div>
        <div class="kpi-value">${inTrial}</div>
        <div class="kpi-subtext">15-day to 3-month trials</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">Platform MRR (PKR)</div>
        <div class="kpi-value">PKR ${totalMRR.toLocaleString()}</div>
        <div class="kpi-subtext">Total monthly contracted billing</div>
      </div>
    </div>

    <!-- Actions & Tenants Table Card -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">🏢 Tenant Subscriptions, Custom Pricing & Payment Statuses</div>
        <button class="primary-btn" onclick="openModal('modal-create-tenant')">🏢 + Provision New Tenant</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tenant Organization</th>
              <th>Plan Tier</th>
              <th>Status / Trial Timer</th>
              <th>Monthly Fee (Agreed)</th>
              <th>Companies & Seats</th>
              <th>Active Modules</th>
              <th>Renewal Date</th>
              <th>Super Admin Actions</th>
            </tr>
          </thead>
          <tbody>
            ${overview.map(o => {
              const sub = o.subscription;
              let statusBadge = '';
              if (sub.status === 'Suspended') {
                statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171;">⛔ Suspended</span>';
              } else if (sub.is_trial && sub.status === 'Trial') {
                statusBadge = `<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd;">⏳ Trial (${o.trialDaysRemaining}d left)</span>`;
              } else {
                statusBadge = '<span class="badge badge-won">✓ Paid (Active)</span>';
              }

              const planBadge = sub.plan_type === 'Advance' 
                ? '<span class="badge badge-won">Advance Plan</span>' 
                : sub.plan_type === 'Basic' 
                  ? '<span class="badge badge-ready">Basic Plan</span>' 
                  : '<span class="badge" style="background:#f3e8ff; color:#7e22ce;">Custom Plan</span>';

              const activeModCount = sub.plan_type === 'Advance' ? 8 : sub.plan_type === 'Basic' ? 3 : (sub.active_modules?.length || 0);

              return `
                <tr>
                  <td>
                    <strong>${o.tenant.company_name}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${o.tenant.subdomain}.mashrue.com</span>
                  </td>
                  <td>${planBadge}</td>
                  <td>${statusBadge}</td>
                  <td>
                    <strong>PKR ${o.totalMonthly.toLocaleString()}</strong><br>
                    <span style="font-size:0.72rem; color:var(--text-muted);">Base: PKR ${(sub.custom_base_price || 0).toLocaleString()}</span>
                  </td>
                  <td>
                    <span style="font-size:0.8rem;">
                      🏢 ${o.companyCount} Co ${o.paidCompanies > 0 ? `(${o.paidCompanies} paid)` : ''}<br>
                      👥 ${o.userCount} Users ${o.paidUsers > 0 ? `(${o.paidUsers} paid)` : ''}
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-sec-attached">${activeModCount} / 8 Modules</span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem; font-weight:600;">${sub.current_period_end || 'N/A'}</span>
                  </td>
                  <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      <button class="edit-btn" style="padding:4px 8px; font-size:0.78rem;" onclick="openConfigureSubscriptionModal('${o.tenant.id}')" title="Configure Plan, Custom Pricing & Trial">
                        ⚙️ Configure
                      </button>
                      <button class="primary-btn" style="padding:4px 8px; font-size:0.78rem; background:#059669;" onclick="openRecordPaymentModal('${o.tenant.id}')" title="Record Payment & Enable">
                        💳 Payment
                      </button>
                      <button class="secondary-btn" style="padding:4px 8px; font-size:0.78rem; color:${sub.status === 'Suspended' ? '#059669' : '#dc2626'};" onclick="toggleTenantActivation('${o.tenant.id}', '${sub.status}')">
                        ${sub.status === 'Suspended' ? '✓ Activate' : '⛔ Suspend'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 20. CLIENT ADMIN "MY SUBSCRIPTION & BILLING" VIEW
// --------------------------------------------------------------------------
async function renderMySubscriptionHTML() {
  const data = await API.getMySubscription();
  const sub = data.subscription;
  const quota = data.quota;

  let statusBadge = '';
  if (sub.status === 'Suspended') {
    statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-size:0.85rem; padding:6px 12px;">⛔ Account Suspended (Pending Payment)</span>';
  } else if (sub.is_trial && sub.status === 'Trial') {
    statusBadge = `<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-size:0.85rem; padding:6px 12px;">⏳ Free Trial: ${data.trialDaysRemaining} Days Remaining</span>`;
  } else {
    statusBadge = '<span class="badge badge-won" style="font-size:0.85rem; padding:6px 12px;">✓ Active Subscription (Paid)</span>';
  }

  const isBasic = sub.plan_type === 'Basic';
  const tenderQuotaMax = isBasic ? 10 : 'Unlimited';
  const tendersUsed = quota.tenders_created || 0;
  const tenderPct = isBasic ? Math.min(100, (tendersUsed / 10) * 100) : 100;

  const quoteQuotaMax = isBasic ? 10 : 'Unlimited';
  const quotesUsed = quota.quotes_created || 0;
  const quotePct = isBasic ? Math.min(100, (quotesUsed / 10) * 100) : 100;

  return `
    <!-- Top Plan Overview Banner -->
    <div class="card" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; margin-bottom: 20px; border: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
        <div>
          <div style="font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Current Subscription Plan</div>
          <h2 style="font-size: 1.8rem; font-weight: 800; color: #38bdf8; margin: 4px 0 8px;">${sub.plan_type} Tier</h2>
          <div style="display: flex; gap: 10px; align-items: center;">
            ${statusBadge}
            <span style="font-size: 0.85rem; color: #cbd5e1;">Billing Cycle: <strong>Monthly</strong> | Renewal: <strong>${sub.current_period_end || 'N/A'}</strong></span>
          </div>
        </div>
        <div style="text-align: right; background: rgba(255,255,255,0.06); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 0.8rem; color: #94a3b8;">Total Agreed Monthly Fee:</div>
          <div style="font-size: 1.6rem; font-weight: 800; color: #4ade80;">PKR ${data.totalMonthly.toLocaleString()} <span style="font-size:0.8rem; color:#94a3b8;">/ mo</span></div>
          <button class="primary-btn" style="margin-top: 8px; font-size: 0.82rem; padding: 6px 14px;" onclick="openModal('modal-quota-upgrade')">🚀 Request Plan Upgrade</button>
        </div>
      </div>
    </div>

    <!-- Usage & Quota Meters Grid -->
    <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
      <!-- Tender Quota Meter -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>📑 Commercial Tenders</span>
          <span style="color: var(--primary);">${tendersUsed} / ${tenderQuotaMax}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">Monthly creation quota</div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${tenderPct}%; height: 100%; background: ${isBasic && tendersUsed >= 10 ? '#ef4444' : '#0284c7'};"></div>
        </div>
        ${isBasic && tendersUsed >= 10 ? '<div style="font-size:0.75rem; color:#ef4444; font-weight:700; margin-top:6px;">⚠️ Monthly limit reached</div>' : ''}
      </div>

      <!-- Multi-Company Quota -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>🏢 Company Profiles</span>
          <span style="color: #059669;">${data.companyCount} Active</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          ${sub.plan_type === 'Advance' ? '2 Free Included' : '1 Free Included'} ${data.paidCompanies > 0 ? `(+PKR ${(data.paidCompanies * (sub.custom_extra_company_price || 2500)).toLocaleString()}/mo)` : ''}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(100, (data.companyCount / (sub.plan_type === 'Advance' ? 2 : 1)) * 100)}%; height: 100%; background: #059669;"></div>
        </div>
      </div>

      <!-- Employee Seats -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>👥 Employee Seats</span>
          <span style="color: #8b5cf6;">${data.userCount} Users</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          ${sub.plan_type === 'Advance' ? '2 Free Seats Included' : '1 Admin Included'} ${data.paidUsers > 0 ? `(+PKR ${(data.paidUsers * (sub.custom_extra_seat_price || 1500)).toLocaleString()}/mo)` : ''}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(100, (data.userCount / (sub.plan_type === 'Advance' ? 3 : 1)) * 100)}%; height: 100%; background: #8b5cf6;"></div>
        </div>
      </div>
    </div>

    <!-- Active Modules Matrix -->
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-header">
        <div class="card-title">📦 Active Subscribed Modules & Scope</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding-top: 10px;">
        ${State.MODULE_CATALOG.map(m => {
          const isActive = State.isModuleActiveForTenant(m.key);
          return `
            <div style="border: 1px solid ${isActive ? '#bbf7d0' : '#e2e8f0'}; background: ${isActive ? '#f0fdf4' : '#f8fafc'}; padding: 14px; border-radius: var(--radius-md);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <span style="font-size: 1.4rem;">${m.icon}</span>
                <span class="badge ${isActive ? 'badge-won' : 'badge-withdraw'}">${isActive ? '✓ Subscribed' : 'Locked'}</span>
              </div>
              <div style="font-weight: 700; color: #1e293b; font-size: 0.9rem; margin-bottom: 4px;">${m.name}</div>
              <div style="font-size: 0.75rem; color: #64748b; line-height: 1.4;">${m.desc}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Payment Receipts & History -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">🧾 Subscription Invoices & Payment Receipts (${data.payments.length})</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Payment Date</th>
              <th>Amount Paid</th>
              <th>Method</th>
              <th>Transaction Slip / Ref #</th>
              <th>Period Extended</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${data.payments.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:30px; color:#64748b;">
                  No subscription payment receipts logged yet. Free trial or initial period active.
                </td>
              </tr>
            ` : data.payments.map(p => `
              <tr>
                <td><strong>${p.id}</strong></td>
                <td>${p.payment_date || new Date(p.created_at).toLocaleDateString()}</td>
                <td><strong>PKR ${Number(p.amount_received || p.amount_paid).toLocaleString()}</strong></td>
                <td><span class="pill-source">${p.payment_method || 'Bank Transfer'}</span></td>
                <td><code>${p.reference_number || 'N/A'}</code></td>
                <td>+${p.extension_months || 1} Month(s)</td>
                <td><span class="badge badge-won">✓ Verified</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 21. SUBSCRIPTION MODAL CONTROLLERS & FORM HANDLERS
// --------------------------------------------------------------------------
function openConfigureSubscriptionModal(tenantId) {
  const sub = State.getTenantSubscription(tenantId);
  const tenant = State.getTenants().find(t => t.id === tenantId) || { company_name: 'Tenant' };

  document.getElementById('sub-tenant-id').value = tenantId;
  document.getElementById('sub-tenant-name-display').innerText = tenant.company_name;
  
  // Set Plan Radio
  const radios = document.getElementsByName('sub-plan-choice');
  radios.forEach(r => { r.checked = (r.value === sub.plan_type); });

  // Set Custom Prices
  document.getElementById('sub-custom-base-price').value = sub.custom_base_price !== undefined ? sub.custom_base_price : (sub.plan_type === 'Basic' ? 4000 : 14000);
  document.getElementById('sub-custom-extra-company').value = sub.custom_extra_company_price !== undefined ? sub.custom_extra_company_price : 2500;
  document.getElementById('sub-custom-extra-seat').value = sub.custom_extra_seat_price !== undefined ? sub.custom_extra_seat_price : 1500;

  // Set Trial Duration
  const trialSelect = document.getElementById('sub-trial-duration');
  trialSelect.value = sub.trial_days ? String(sub.trial_days) : (sub.is_trial ? '30' : 'none');
  document.getElementById('sub-trial-end-date').value = sub.trial_end_date || new Date().toISOString().split('T')[0];

  // Render Modular Checkboxes
  renderSubModulesChecklist(sub);
  onPlanSelectionChanged(sub.plan_type);
  recalcSubscriptionBillPreview();

  openModal('modal-configure-subscription');
}

function renderSubModulesChecklist(sub) {
  const container = document.getElementById('sub-modules-checklist');
  if (!container) return;

  const activeKeys = sub.active_modules || ['mod_tenders', 'mod_quotations', 'mod_fbr_invoicing'];

  container.innerHTML = State.MODULE_CATALOG.map(m => {
    const isChecked = activeKeys.includes(m.key);
    const customFee = (sub.custom_module_fees && sub.custom_module_fees[m.key] !== undefined) ? sub.custom_module_fees[m.key] : m.benchmarkFee;
    return `
      <div style="border: 1px solid var(--border); background: #f8fafc; padding: 10px 12px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; flex: 1;">
          <input type="checkbox" class="sub-mod-checkbox permissions-checkbox" value="${m.key}" ${isChecked ? 'checked' : ''} onchange="recalcSubscriptionBillPreview()">
          <span>${m.icon} ${m.name}</span>
        </label>
        <div style="width: 100px;">
          <input type="number" class="form-input sub-mod-fee-input" data-mod="${m.key}" value="${customFee}" min="0" style="padding: 4px 6px; font-size: 0.8rem; text-align: right;" oninput="recalcSubscriptionBillPreview()">
        </div>
      </div>
    `;
  }).join('');
}

function onPlanSelectionChanged(planType) {
  const modulesContainer = document.getElementById('sub-modules-selector-container');
  const basePriceInput = document.getElementById('sub-custom-base-price');

  if (planType === 'Custom') {
    if (modulesContainer) modulesContainer.style.display = 'block';
    if (basePriceInput && (!basePriceInput.value || basePriceInput.value === '14000' || basePriceInput.value === '4000')) {
      basePriceInput.value = 3000;
    }
  } else {
    if (modulesContainer) modulesContainer.style.display = 'none';
    if (basePriceInput) {
      basePriceInput.value = planType === 'Basic' ? 4000 : 14000;
    }
  }
  recalcSubscriptionBillPreview();
}

function onTrialDurationChanged(val) {
  const dateInput = document.getElementById('sub-trial-end-date');
  if (val === 'none') {
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  } else if (val !== 'custom') {
    const days = parseInt(val, 10);
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    if (dateInput) dateInput.value = end.toISOString().split('T')[0];
  }
}

function recalcSubscriptionBillPreview() {
  const radios = document.getElementsByName('sub-plan-choice');
  let selectedPlan = 'Advance';
  radios.forEach(r => { if (r.checked) selectedPlan = r.value; });

  const basePrice = Number(document.getElementById('sub-custom-base-price')?.value || 0);
  let total = basePrice;

  if (selectedPlan === 'Custom') {
    const checkboxes = document.querySelectorAll('.sub-mod-checkbox:checked');
    checkboxes.forEach(cb => {
      const feeInput = document.querySelector(`.sub-mod-fee-input[data-mod="${cb.value}"]`);
      const fee = Number(feeInput?.value || 0);
      total += fee;
    });
  }

  const breakdownEl = document.getElementById('sub-billing-breakdown-text');
  const totalEl = document.getElementById('sub-calculated-total-display');

  if (breakdownEl) breakdownEl.innerText = `${selectedPlan} Tier Base: PKR ${basePrice.toLocaleString()} + Add-ons`;
  if (totalEl) totalEl.innerText = `PKR ${total.toLocaleString()} / mo`;
}

async function submitConfigureSubscriptionForm() {
  const tenantId = document.getElementById('sub-tenant-id')?.value;
  const radios = document.getElementsByName('sub-plan-choice');
  let selectedPlan = 'Advance';
  radios.forEach(r => { if (r.checked) selectedPlan = r.value; });

  const basePrice = Number(document.getElementById('sub-custom-base-price')?.value || 0);
  const extraCoPrice = Number(document.getElementById('sub-custom-extra-company')?.value || 2500);
  const extraSeatPrice = Number(document.getElementById('sub-custom-extra-seat')?.value || 1500);

  const trialDuration = document.getElementById('sub-trial-duration')?.value;
  const isTrial = (trialDuration !== 'none');
  const trialEndDate = document.getElementById('sub-trial-end-date')?.value || new Date().toISOString().split('T')[0];

  const activeModules = [];
  const customModuleFees = {};

  if (selectedPlan === 'Custom') {
    const checkboxes = document.querySelectorAll('.sub-mod-checkbox:checked');
    checkboxes.forEach(cb => {
      activeModules.push(cb.value);
      const feeInput = document.querySelector(`.sub-mod-fee-input[data-mod="${cb.value}"]`);
      customModuleFees[cb.value] = Number(feeInput?.value || 0);
    });
  } else if (selectedPlan === 'Basic') {
    activeModules.push('mod_tenders', 'mod_quotations', 'mod_fbr_invoicing');
  } else {
    activeModules.push('mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi');
  }

  const payload = {
    tenant_id: tenantId,
    plan_type: selectedPlan,
    status: isTrial ? 'Trial' : 'Active',
    is_trial: isTrial,
    trial_days: isTrial ? (trialDuration === 'custom' ? 30 : parseInt(trialDuration, 10)) : 0,
    trial_end_date: trialEndDate,
    current_period_end: trialEndDate,
    custom_base_price: basePrice,
    custom_extra_company_price: extraCoPrice,
    custom_extra_seat_price: extraSeatPrice,
    active_modules: activeModules,
    custom_module_fees: customModuleFees
  };

  try {
    const res = await API.configureTenantSubscription(payload);
    if (res && res.success) {
      closeModal('modal-configure-subscription');
      alert(`✓ ${res.message}`);
      await renderActiveView();
      renderDynamicSidebarNavigation();
    } else {
      alert(res.message || 'Failed to update subscription.');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

function openRecordPaymentModal(tenantId) {
  const sub = State.getTenantSubscription(tenantId);
  const tenant = State.getTenants().find(t => t.id === tenantId) || { company_name: 'Tenant' };

  document.getElementById('pay-tenant-id').value = tenantId;
  document.getElementById('pay-tenant-name-display').innerText = tenant.company_name;

  const base = sub.custom_base_price !== undefined ? sub.custom_base_price : (sub.plan_type === 'Basic' ? 4000 : 14000);
  document.getElementById('pay-amount-received').value = base;
  document.getElementById('pay-monthly-fee-display').innerText = `Agreed Monthly Fee: PKR ${base.toLocaleString()}`;
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pay-reference-no').value = 'FT-' + Math.floor(100000 + Math.random() * 900000);

  openModal('modal-record-payment');
}

async function submitRecordPaymentForm() {
  const tenantId = document.getElementById('pay-tenant-id')?.value;
  const amount = Number(document.getElementById('pay-amount-received')?.value || 0);
  const method = document.getElementById('pay-method')?.value;
  const refNo = document.getElementById('pay-reference-no')?.value;
  const payDate = document.getElementById('pay-date')?.value;
  const extMonths = Number(document.getElementById('pay-extension-months')?.value || 1);
  const remarks = document.getElementById('pay-remarks')?.value;

  if (!tenantId || !amount || !refNo) {
    alert('Tenant, amount received, and transaction reference are required.');
    return;
  }

  const payload = {
    tenant_id: tenantId,
    amount_received: amount,
    payment_method: method,
    reference_number: refNo,
    payment_date: payDate,
    extension_months: extMonths,
    remarks: remarks
  };

  try {
    const res = await API.recordTenantSubscriptionPayment(payload);
    if (res && res.success) {
      closeModal('modal-record-payment');
      alert(`✓ ${res.message}`);
      await renderActiveView();
      updateHeaderUserProfile();
    } else {
      alert(res.message || 'Failed to record payment.');
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function toggleTenantActivation(tenantId, currentStatus) {
  const newStatus = (currentStatus === 'Suspended') ? 'Active' : 'Suspended';
  const confirmMsg = (newStatus === 'Suspended')
    ? 'Are you sure you want to suspend this tenant? The organization workspace will enter read-only mode.'
    : 'Activate and unlock this tenant organization?';

  if (!confirm(confirmMsg)) return;

  try {
    const res = await API.toggleTenantStatus(tenantId, newStatus);
    if (res && res.success) {
      alert(`✓ ${res.message}`);
      await renderActiveView();
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

function requestPlanUpgradeFromModal() {
  closeModal('modal-quota-upgrade');
  alert('🎉 Upgrade request submitted to Super Admin naeem4it! You will be contacted shortly for plan adjustment.');
}

// --------------------------------------------------------------------------
// 3-TIER EXPENSE ENGINE CONTROLLERS & FORM HANDLERS (PHASE 4)
// --------------------------------------------------------------------------

const EXPENSE_TIER_CATEGORIES = {
  'Tier 1 - Tender Direct': [
    'Sample Product Fabrication & Material Cost',
    'Sample Laboratory Testing & Certification Fees',
    'Tender Bidding Travel, Fuel & Site Visits',
    'Gifting & Client Hospitality',
    'Tender Document / Tender Purchasing Fee',
    'Proposal Printing, Drawing & Documentation',
    'Bank Guarantee / CDR / EMD Bank Charges',
    'Consultancy & Expert Technical Fees'
  ],
  'Tier 2 - PO Execution': [
    '3PL Courier & Heavy Freight Transport',
    'Customs Duty, Clearing & Port Handling',
    'Port Demurrage & Container Detention',
    'Crane, Forklift & Unloading Labor',
    'Site Installation & Commissioning Testing'
  ],
  'Tier 3 - General Overheads': [
    'Salaries & Wages',
    'Head Office Rent',
    'Utility Bills (Electricity/Gas/Internet)',
    'Fuel & Vehicle Maintenance',
    'Office Refreshments & Kitchen',
    'Audit, Legal & Tax Filing Fees',
    'General Administration'
  ]
};

async function openExpenseModal(defaultTier, linkedOpportunityId, linkedPOId) {
  const tier = defaultTier || 'Tier 1 - Tender Direct';
  const tierSelect = document.getElementById('exp-tier');
  if (tierSelect) tierSelect.value = tier;

  document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-name').value = '';
  document.getElementById('exp-paid-to').value = '';
  document.getElementById('exp-remarks').value = '';
  document.getElementById('exp-opportunity-id').value = linkedOpportunityId || '';
  document.getElementById('exp-po-id').value = linkedPOId || '';

  handleExpenseTierChange(tier);

  // Prepopulate POs if Tier 2
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const poSelect = document.getElementById('exp-po-select');
  if (poSelect) {
    poSelect.innerHTML = `<option value="">-- Select Linked PO --</option>` + pos.map(p => `
      <option value="${p.id}" ${p.id === linkedPOId ? 'selected' : ''}>
        ${p.po_number} - ${p.customer_name || 'Customer'} (PKR ${parseFloat(p.net_amount || p.total_amount || 0).toLocaleString()})
      </option>
    `).join('');
  }

  // Prepopulate Tender badge if linkedOpportunityId
  if (linkedOpportunityId) {
    const opps = await API.getOpportunities(State.currentBusinessProfileId);
    const targetOpp = opps.find(o => o.id === linkedOpportunityId);
    if (targetOpp) {
      selectLinkedOpportunity(targetOpp.id, targetOpp.tender_name || targetOpp.opportunity_title, targetOpp.opportunity_number);
    }
  }

  openModal('modal-add-expense');
}

function handleExpenseTierChange(tier) {
  const categorySelect = document.getElementById('exp-category');
  const linkedGroup = document.getElementById('group-exp-linked');
  const poGroup = document.getElementById('group-exp-po-select');

  // Populate dynamic categories for this tier
  const cats = EXPENSE_TIER_CATEGORIES[tier] || EXPENSE_TIER_CATEGORIES['Tier 1 - Tender Direct'];
  if (categorySelect) {
    categorySelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  if (tier === 'Tier 1 - Tender Direct') {
    if (linkedGroup) linkedGroup.style.display = 'block';
    if (poGroup) poGroup.style.display = 'none';
  } else if (tier === 'Tier 2 - PO Execution') {
    if (linkedGroup) linkedGroup.style.display = 'none';
    if (poGroup) poGroup.style.display = 'block';
  } else {
    if (linkedGroup) linkedGroup.style.display = 'none';
    if (poGroup) poGroup.style.display = 'none';
  }
}

function handleExpenseCategorySelected(cat) {
  const nameInput = document.getElementById('exp-name');
  if (nameInput && !nameInput.value) {
    nameInput.value = cat;
  }
}

async function openLinkedDropdown() {
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const dropdown = document.getElementById('exp-linked-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = opps.map(o => `
    <div class="searchable-dropdown-item" onclick="selectLinkedOpportunity('${o.id}', '${(o.tender_name || o.opportunity_title || '').replace(/'/g, "\\'")}', '${o.opportunity_number || ''}')" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border);">
      <strong>${o.opportunity_number || 'Tender'}</strong> - ${o.tender_name || o.opportunity_title || 'Project'}<br>
      <span style="font-size:0.75rem; color:var(--text-muted);">${o.customer_name || 'Client'}</span>
    </div>
  `).join('');
  dropdown.style.display = 'block';
}

function filterLinkedOpportunities(query) {
  const q = (query || '').toLowerCase();
  const dropdown = document.getElementById('exp-linked-dropdown');
  if (!dropdown) return;

  const items = dropdown.getElementsByClassName('searchable-dropdown-item');
  for (let it of items) {
    it.style.display = it.innerText.toLowerCase().includes(q) ? 'block' : 'none';
  }
  dropdown.style.display = 'block';
}

function selectLinkedOpportunity(id, title, number) {
  document.getElementById('exp-opportunity-id').value = id;
  const searchInput = document.getElementById('exp-linked-search');
  if (searchInput) searchInput.value = `${number} - ${title}`;

  const badge = document.getElementById('exp-linked-selected-badge');
  if (badge) {
    badge.innerText = `✓ Linked to Tender: ${number} (${title})`;
    badge.style.display = 'block';
  }

  const dropdown = document.getElementById('exp-linked-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function handleExpensePOSelected(poId) {
  document.getElementById('exp-po-id').value = poId;
}

async function submitGeneralExpenseForm() {
  const tier = document.getElementById('exp-tier')?.value || 'Tier 1 - Tender Direct';
  const date = document.getElementById('exp-date')?.value;
  const oppId = document.getElementById('exp-opportunity-id')?.value;
  const poId = document.getElementById('exp-po-id')?.value;
  const category = document.getElementById('exp-category')?.value;
  const name = document.getElementById('exp-name')?.value;
  const amount = parseFloat(document.getElementById('exp-amount')?.value || 0);
  const paidTo = document.getElementById('exp-paid-to')?.value;
  const mode = document.getElementById('exp-mode')?.value;
  const remarks = document.getElementById('exp-remarks')?.value;

  if (!name || amount <= 0 || !date) {
    alert('Expense Title, Date, and Amount are mandatory.');
    return;
  }

  let oppNumber = null;
  let tenderName = null;
  let poNumber = null;

  if (oppId) {
    const opps = await API.getOpportunities(State.currentBusinessProfileId);
    const o = opps.find(item => item.id === oppId);
    if (o) {
      oppNumber = o.opportunity_number;
      tenderName = o.tender_name || o.opportunity_title;
    }
  }

  if (poId) {
    const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
    const p = pos.find(item => item.id === poId);
    if (p) {
      poNumber = p.po_number;
    }
  }

  await API.createExpense({
    expense_tier: tier,
    expense_type: tier === 'Tier 1 - Tender Direct' ? 'Tender Expense' : (tier === 'Tier 2 - PO Execution' ? 'Project Direct' : 'General Expense'),
    expense_name: name,
    category: category,
    amount: amount,
    expense_date: date,
    paid_to: paidTo || 'Vendor / Petty Cash',
    payment_mode: mode,
    opportunity_id: oppId || null,
    opportunity_number: oppNumber,
    tender_name: tenderName,
    purchase_order_id: poId || null,
    po_number: poNumber,
    notes: remarks,
    remarks: remarks
  });

  closeModal('modal-add-expense');
  alert(`✓ ${tier} expenditure of PKR ${amount.toLocaleString()} recorded successfully!`);
  await renderActiveView();
}

async function updatePayInvoiceOutstanding(invoiceId) {
  const invoices = await API.getInvoices(State.currentBusinessProfileId);
  const inv = invoices.find(i => i.id === invoiceId);
  const meta = document.getElementById('pay-invoice-meta');
  const amtInput = document.getElementById('pay-amount');

  if (!inv) {
    if (meta) meta.style.display = 'none';
    return;
  }

  const outstanding = parseFloat(inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0)));

  if (meta) {
    meta.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>Invoice:</strong> ${inv.invoice_number} (${inv.customer_name || 'Customer'})<br>
          <span style="font-size:0.78rem; color:#64748b;">Total: PKR ${parseFloat(inv.total_amount || 0).toLocaleString()} | Paid: PKR ${parseFloat(inv.paid_amount || 0).toLocaleString()}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:0.75rem; color:#64748b;">Remaining Due:</span><br>
          <strong style="color:#d97706; font-size:1.05rem;">PKR ${outstanding.toLocaleString()}</strong>
        </div>
      </div>
    `;
    meta.style.display = 'block';
  }

  if (amtInput) {
    amtInput.value = outstanding;
  }
}

// --------------------------------------------------------------------------
// TENDER LOSS & GRIEVANCE LIFECYCLE CONTROLLERS (PHASE 5)
// --------------------------------------------------------------------------

function promptTenderLossModal(oppId, tenderName, ourBid) {
  document.getElementById('loss-opp-id').value = oppId;
  document.getElementById('loss-tender-ref').value = decodeURIComponent(tenderName);
  document.getElementById('loss-eval-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('loss-our-bid').value = ourBid || 0;
  document.getElementById('loss-winning-bid').value = '';
  document.getElementById('loss-competitor-name').value = '';
  document.getElementById('loss-variance-display').value = 'PKR 0 (0%)';
  document.getElementById('loss-remarks').value = '';
  document.getElementById('loss-grievance-filed').checked = false;
  toggleGrievanceFields(false);

  openModal('modal-tender-loss-eval');
}

function handleLossStageChanged(stage) {
  const competitorInput = document.getElementById('loss-competitor-name');
  const winningBidInput = document.getElementById('loss-winning-bid');
  if (stage.includes('Technical Disqualification')) {
    if (competitorInput && !competitorInput.value) competitorInput.value = 'Disqualified at Technical Stage';
  } else if (stage.includes('Client Canceled')) {
    if (competitorInput) competitorInput.value = 'N/A (Tender Canceled)';
  }
}

function calculateLossVariance() {
  const ourBid = parseFloat(document.getElementById('loss-our-bid')?.value || 0);
  const winningBid = parseFloat(document.getElementById('loss-winning-bid')?.value || 0);
  const varianceEl = document.getElementById('loss-variance-display');

  if (!varianceEl) return;

  if (ourBid > 0 && winningBid > 0) {
    const diff = ourBid - winningBid;
    const pct = ((diff / ourBid) * 100).toFixed(1);
    if (diff > 0) {
      varianceEl.value = `+ PKR ${diff.toLocaleString()} (+${pct}% Higher)`;
      varianceEl.style.color = '#dc2626';
    } else {
      varianceEl.value = `- PKR ${Math.abs(diff).toLocaleString()} (${pct}%)`;
      varianceEl.style.color = '#059669';
    }
  } else {
    varianceEl.value = 'PKR 0 (0%)';
  }
}

function toggleGrievanceFields(isChecked) {
  const row = document.getElementById('loss-grievance-row');
  if (row) row.style.display = isChecked ? 'grid' : 'none';
}

async function submitTenderLossForm() {
  const oppId = document.getElementById('loss-opp-id')?.value;
  const evalDate = document.getElementById('loss-eval-date')?.value;
  const stage = document.getElementById('loss-stage')?.value;
  const competitor = document.getElementById('loss-competitor-name')?.value;
  const ourBid = parseFloat(document.getElementById('loss-our-bid')?.value || 0);
  const winningBid = parseFloat(document.getElementById('loss-winning-bid')?.value || 0);
  const remarks = document.getElementById('loss-remarks')?.value;
  const grievanceFiled = document.getElementById('loss-grievance-filed')?.checked || false;
  const grievanceTrack = document.getElementById('loss-grievance-track')?.value || '';
  const grievanceStatus = document.getElementById('loss-grievance-status')?.value || '';

  if (!oppId) return;

  // 1. Record Bid Evaluation & Competitor Intelligence
  const evalPayload = {
    opportunity_id: oppId,
    evaluation_status: 'Lost',
    loss_reason: stage,
    competitor_name: competitor,
    competitor_bid_amount: winningBid,
    our_bid_amount: ourBid,
    variance_amount: ourBid - winningBid,
    disqualification_stage: stage,
    grievance_filed: grievanceFiled,
    grievance_tracking_number: grievanceTrack,
    grievance_status: grievanceStatus,
    evaluation_date: evalDate,
    remarks: remarks
  };
  State.saveTenantEntity('bidEvaluations', { id: 'eval-' + Date.now(), ...evalPayload });

  // 2. Update Opportunity status to Lost / Closed
  await API.updateEntity('opportunity', oppId, {
    status: 'loose',
    selection_status: 'Lost',
    stage: 'Lost'
  });

  // 3. Automated Bid Security / CDR Release Trigger (Replenish Available Bank Line)
  const securities = State.getTenantEntityList('bidSecurities');
  const linkedSecs = securities.filter(s => s.opportunity_id === oppId && s.status === 'Active');
  
  for (const sec of linkedSecs) {
    sec.status = 'Released';
    sec.release_date = evalDate;
    sec.release_reference = 'Auto-Release on Tender Loss (' + (grievanceTrack || stage) + ')';
    State.saveTenantEntity('bidSecurities', sec);
  }

  closeModal('modal-tender-loss-eval');
  alert(`✓ Tender marked as Lost (${stage}). ${linkedSecs.length > 0 ? `Linked Bid Security (${linkedSecs[0].security_number || 'CDR'}) has been automatically released back to your bank credit line.` : ''}`);
  await renderActiveView();
}

// --------------------------------------------------------------------------
// CONSOLIDATED TENDER 360° COCKPIT ENGINE (PHASE 5)
// --------------------------------------------------------------------------

async function openTender360Cockpit(oppId) {
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const opp = opps.find(o => o.id === oppId);
  if (!opp) {
    alert('Tender record not found.');
    return;
  }

  const securities = (await API.getBidSecurities(State.currentBusinessProfileId)).filter(s => s.opportunity_id === oppId);
  const awards = (await API.getAwards()).filter(a => a.opportunity_id === oppId);
  const pos = (await API.getPurchaseOrders(State.currentBusinessProfileId)).filter(p => p.opportunity_id === oppId || (awards[0] && p.award_letter_id === awards[0].id));
  const dcs = (await API.getDeliveryChallans(State.currentBusinessProfileId)).filter(d => d.opportunity_id === oppId || pos.some(p => p.id === d.purchase_order_id));
  const invoices = (await API.getInvoices(State.currentBusinessProfileId)).filter(i => pos.some(p => p.id === i.purchase_order_id) || dcs.some(d => d.id === i.delivery_challan_id));
  const expenses = (await API.getExpenses(State.currentBusinessProfileId)).filter(e => e.opportunity_id === oppId || pos.some(p => p.id === e.purchase_order_id));
  const evals = State.getTenantEntityList('bidEvaluations').filter(e => e.opportunity_id === oppId);

  // Financial aggregates
  const contractValue = awards[0] ? parseFloat(awards[0].award_amount || 0) : parseFloat(opp.estimated_value || 0);
  const totalInvoiced = invoices.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0);
  const totalCollected = invoices.reduce((s, i) => s + (parseFloat(i.paid_amount) || 0), 0);
  const totalFreightPaid = dcs.reduce((s, d) => s + (parseFloat(d.freight_cost_contractor || d.delivery_cost || 0)), 0);
  const totalProjectExpenses = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const netProjectProfit = totalCollected - totalProjectExpenses;
  const marginPct = totalCollected > 0 ? ((netProjectProfit / totalCollected) * 100).toFixed(1) : '0.0';

  // Title and subtitle
  document.getElementById('cockpit-title').innerText = `${opp.opportunity_number} - ${opp.tender_name || opp.title}`;
  document.getElementById('cockpit-subtitle').innerText = `Client: ${opp.customer_name || 'Client'} | Status: ${(opp.status || 'New').toUpperCase()} | Estimated: PKR ${parseFloat(opp.estimated_value || 0).toLocaleString()}`;

  const container = document.getElementById('cockpit-body-content');
  if (!container) return;

  container.innerHTML = `
    <!-- Top KPI Telemetry Grid -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Contract Value / Scope</div>
        <div class="kpi-value">PKR ${contractValue.toLocaleString()}</div>
        <div class="kpi-subtext">${pos.length} Active Purchase Orders</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Cash Inflow Collected</div>
        <div class="kpi-value">PKR ${totalCollected.toLocaleString()}</div>
        <div class="kpi-subtext">of PKR ${totalInvoiced.toLocaleString()} Invoiced</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Attributed Project Cost</div>
        <div class="kpi-value">PKR ${totalProjectExpenses.toLocaleString()}</div>
        <div class="kpi-subtext">Freight: PKR ${totalFreightPaid.toLocaleString()}</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid ${netProjectProfit >= 0 ? '#059669' : '#dc2626'};">
        <div class="kpi-title">Net Realized Profit</div>
        <div class="kpi-value" style="color:${netProjectProfit >= 0 ? '#059669' : '#dc2626'};">PKR ${netProjectProfit.toLocaleString()}</div>
        <div class="kpi-subtext">Margin: ${marginPct}%</div>
      </div>
    </div>

    <!-- Interactive 8-Stage Progress Tracker Visual -->
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius-md); padding:14px; margin-bottom:20px;">
      <h4 style="font-size:0.85rem; font-weight:700; color:#475569; margin:0 0 12px 0; text-transform:uppercase; letter-spacing:0.5px;">
        🔄 Complete End-to-End Tender Lifecycle Progression
      </h4>
      <div style="display:grid; grid-template-columns: repeat(8, 1fr); gap:6px; text-align:center; font-size:0.75rem;">
        <div style="padding:8px 4px; background:#e0f2fe; border-radius:4px; border:1px solid #bae6fd; color:#0369a1; font-weight:600;">
          1. Opportunity<br>
          <span style="font-size:0.68rem; color:#0284c7;">✓ Registered</span>
        </div>
        <div style="padding:8px 4px; background:${securities.length > 0 ? '#e0f2fe' : '#f1f5f9'}; border-radius:4px; border:1px solid ${securities.length > 0 ? '#bae6fd' : '#e2e8f0'}; color:${securities.length > 0 ? '#0369a1' : '#64748b'}; font-weight:600;">
          2. Bid Security<br>
          <span style="font-size:0.68rem;">${securities.length > 0 ? '✓ ' + securities[0].status : 'Pending'}</span>
        </div>
        <div style="padding:8px 4px; background:${opp.status === 'Submitted' || opp.status === 'won' ? '#e0f2fe' : '#f1f5f9'}; border-radius:4px; border:1px solid #bae6fd; font-weight:600; color:${opp.status === 'Submitted' || opp.status === 'won' ? '#0369a1' : '#64748b'};">
          3. Bid Submitted<br>
          <span style="font-size:0.68rem;">${opp.status === 'Submitted' || opp.status === 'won' ? '✓ Submitted' : 'Draft'}</span>
        </div>
        <div style="padding:8px 4px; background:${awards.length > 0 ? '#dcfce7' : (opp.status === 'loose' ? '#fee2e2' : '#f1f5f9')}; border-radius:4px; border:1px solid ${awards.length > 0 ? '#bbf7d0' : '#e2e8f0'}; font-weight:600; color:${awards.length > 0 ? '#15803d' : (opp.status === 'loose' ? '#b91c1c' : '#64748b')};">
          4. Award LOA<br>
          <span style="font-size:0.68rem;">${awards.length > 0 ? '✓ Awarded' : (opp.status === 'loose' ? 'Lost' : 'Pending')}</span>
        </div>
        <div style="padding:8px 4px; background:${pos.length > 0 ? '#e0f2fe' : '#f1f5f9'}; border-radius:4px; border:1px solid #bae6fd; font-weight:600; color:${pos.length > 0 ? '#0369a1' : '#64748b'};">
          5. Multi-POs<br>
          <span style="font-size:0.68rem;">${pos.length} PO(s)</span>
        </div>
        <div style="padding:8px 4px; background:${dcs.length > 0 ? '#e0f2fe' : '#f1f5f9'}; border-radius:4px; border:1px solid #bae6fd; font-weight:600; color:${dcs.length > 0 ? '#0369a1' : '#64748b'};">
          6. Supply (DCs)<br>
          <span style="font-size:0.68rem;">${dcs.length} DC(s)</span>
        </div>
        <div style="padding:8px 4px; background:${invoices.length > 0 ? '#e0f2fe' : '#f1f5f9'}; border-radius:4px; border:1px solid #bae6fd; font-weight:600; color:${invoices.length > 0 ? '#0369a1' : '#64748b'};">
          7. Invoices<br>
          <span style="font-size:0.68rem;">${invoices.length} Inv(s)</span>
        </div>
        <div style="padding:8px 4px; background:${totalCollected > 0 ? '#dcfce7' : '#f1f5f9'}; border-radius:4px; border:1px solid #bbf7d0; font-weight:600; color:${totalCollected > 0 ? '#15803d' : '#64748b'};">
          8. Collected<br>
          <span style="font-size:0.68rem;">PKR ${totalCollected.toLocaleString()}</span>
        </div>
      </div>
    </div>

    <!-- Section 1: Award Letter & Performance Bond -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="background:#f8fafc; padding:10px 14px;">
        <div class="card-title" style="font-size:0.92rem;">🏆 Award Letter (LOA) & Performance Guarantee</div>
      </div>
      <div style="padding:14px;">
        ${awards.length === 0 ? `
          <div style="font-size:0.84rem; color:var(--text-muted);">No formal Award Letter logged yet for this tender opportunity.</div>
        ` : awards.map(a => `
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem;">
            <div>
              <strong>Award Letter #:</strong> ${a.award_number} (${a.award_date || 'Date'})<br>
              <strong>Award Value:</strong> <span style="color:#0284c7; font-weight:700;">PKR ${parseFloat(a.award_amount || 0).toLocaleString()}</span>
            </div>
            <div>
              <span class="badge badge-won">${a.status || 'Accepted'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Section 2: Multi-PO Distribution Tree -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="background:#f8fafc; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
        <div class="card-title" style="font-size:0.92rem;">📦 Purchase Orders Issued (${pos.length})</div>
        <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="closeModal('modal-tender-360-cockpit'); openNewPOModal('${awards[0]?.id || ''}')">+ Issue PO</button>
      </div>
      <div class="table-responsive">
        <table class="data-table" style="font-size:0.82rem;">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Delivery Site</th>
              <th>Deadline</th>
              <th>Total Net Amount</th>
              <th>DCs Issued</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${pos.length === 0 ? `
              <tr><td colspan="6" style="text-align:center; padding:14px; color:var(--text-muted);">No POs issued yet.</td></tr>
            ` : pos.map(p => {
              const matchedDCs = dcs.filter(d => d.purchase_order_id === p.id);
              return `
                <tr>
                  <td><strong>${p.po_number}</strong></td>
                  <td>${p.delivery_location || 'Customer Site'}</td>
                  <td>${p.delivery_deadline || 'As per Schedule'}</td>
                  <td><strong style="color:#0284c7;">PKR ${parseFloat(p.net_amount || p.total_amount || 0).toLocaleString()}</strong></td>
                  <td><span class="badge badge-sec-attached">${matchedDCs.length} DC(s)</span></td>
                  <td><span class="badge badge-won">${p.status || 'Issued'}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 3: Phased Supply & Logistics Dispatches (DCs) -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="background:#f8fafc; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
        <div class="card-title" style="font-size:0.92rem;">🚚 Delivery Challans & Contractor Freight (${dcs.length})</div>
        <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="closeModal('modal-tender-360-cockpit'); openNewDCModal('${pos[0]?.id || ''}')">+ Dispatch DC</button>
      </div>
      <div class="table-responsive">
        <table class="data-table" style="font-size:0.82rem;">
          <thead>
            <tr>
              <th>DC #</th>
              <th>Mode & Origin</th>
              <th>Logistics Carrier / Bilty</th>
              <th>Dispatched Items</th>
              <th>Contractor Freight Paid</th>
              <th>GRN / Verified</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${dcs.length === 0 ? `
              <tr><td colspan="7" style="text-align:center; padding:14px; color:var(--text-muted);">No Delivery Challans dispatched yet.</td></tr>
            ` : dcs.map(d => `
              <tr>
                <td><strong>${d.dc_number}</strong></td>
                <td>
                  <span class="pill-source" style="font-size:0.72rem;">${d.delivery_mode || 'Own Warehouse'}</span><br>
                  <span style="font-size:0.72rem;">${d.origin_location || d.warehouse_name || 'Central Warehouse'}</span>
                </td>
                <td>
                  <strong>${d.logistics_provider || '3PL'}</strong><br>
                  ${d.tracking_number ? `<code>${d.tracking_number}</code>` : ''}
                </td>
                <td><span class="badge badge-sec-attached">${(d.items && d.items.length) || 1} Item(s)</span></td>
                <td><strong style="color:#b45309;">PKR ${parseFloat(d.freight_cost_contractor || d.delivery_cost || 0).toLocaleString()}</strong></td>
                <td>${d.grn_number ? `<strong style="color:#059669;">✓ ${d.grn_number}</strong>` : '<span style="color:#64748b;">Pending</span>'}</td>
                <td><span class="badge badge-won">${d.status || 'Dispatched'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 4: 3-Tier Attributed Project Expenses -->
    <div class="card">
      <div class="card-header" style="background:#f8fafc; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
        <div class="card-title" style="font-size:0.92rem;">💳 Direct Attributed Project Expenditures (${expenses.length})</div>
        <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="closeModal('modal-tender-360-cockpit'); openExpenseModal('Tier 1 - Tender Direct', '${oppId}', '${pos[0]?.id || ''}')">+ Log Expense</button>
      </div>
      <div class="table-responsive">
        <table class="data-table" style="font-size:0.82rem;">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Expense Title</th>
              <th>Category</th>
              <th>Amount (PKR)</th>
              <th>Paid To</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${expenses.length === 0 ? `
              <tr><td colspan="6" style="text-align:center; padding:14px; color:var(--text-muted);">No direct project expenses logged yet.</td></tr>
            ` : expenses.map(e => `
              <tr>
                <td><span class="badge badge-pending" style="font-size:0.72rem;">${e.expense_tier || e.expense_type || 'Direct'}</span></td>
                <td><strong>${e.expense_name}</strong></td>
                <td>${e.category}</td>
                <td><strong style="color:#b45309;">PKR ${parseFloat(e.amount).toLocaleString()}</strong></td>
                <td>${e.paid_to || 'Vendor'}</td>
                <td>${e.expense_date || 'Today'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  openModal('modal-tender-360-cockpit');
}



