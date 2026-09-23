/**
 * Mashrue (mashrue.com) - Enterprise Business Management System
 * Comprehensive Controller, Authentication, RBAC & Dynamic View Renderer
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

let pendingPaidCompanyPayload = null;
let pendingPaidEmployeePayload = null;

function initCustomDateTimePickers() {
  try {
    // Standardize any native date inputs to text so DD/MM/YYYY works cleanly
    document.querySelectorAll('input[type="date"]').forEach(el => {
      try {
        el.type = 'text';
        el.classList.add('date-picker');
        if (!el.placeholder) el.placeholder = 'DD/MM/YYYY';
      } catch (e) {}
    });

    if (typeof flatpickr !== 'undefined') {
      flatpickr('.date-picker', {
        dateFormat: 'd/m/Y',
        allowInput: true,
        monthSelectorType: 'dropdown',
        prevArrow: '<span style="font-weight:700;">&larr;</span>',
        nextArrow: '<span style="font-weight:700;">&rarr;</span>'
      });
      flatpickr('.datetime-picker', {
        enableTime: false,
        dateFormat: 'd/m/Y',
        allowInput: true
      });
    }
  } catch (e) {
    console.warn('[Calendar Picker Init Warning]:', e.message);
  }
}
window.initCustomDateTimePickers = initCustomDateTimePickers;

/**
 * Universal Search on All Visible Columns across Any Data Table
 * Filters table rows in real-time matching query against any visible column text.
 */
function filterTableVisibleColumns(tableSelector, query) {
  const table = typeof tableSelector === 'string' ? document.querySelector(tableSelector) : tableSelector;
  if (!table) return;

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  const cleanQuery = (query || '').toLowerCase().trim();

  let matchedCount = 0;
  let totalDataRows = 0;

  rows.forEach(row => {
    // Skip no-search-match row or super-admin header divider rows
    if (row.classList.contains('no-search-match-row')) return;
    if (row.querySelector('td[colspan]')) return;

    totalDataRows++;

    if (!cleanQuery) {
      row.style.display = '';
      matchedCount++;
      return;
    }

    // Search across ALL visible cells in this row
    const cells = row.querySelectorAll('td');
    let rowText = '';
    cells.forEach(cell => {
      // Exclude pure button actions text to avoid noise
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('button, .edit-btn, .danger-btn, .secondary-btn, .primary-btn, .modal-close-btn').forEach(b => b.remove());
      rowText += ' ' + (clone.innerText || clone.textContent || '');
    });

    if (rowText.toLowerCase().includes(cleanQuery)) {
      row.style.display = '';
      matchedCount++;
    } else {
      row.style.display = 'none';
    }
  });

  // Handle "No matching records" feedback row
  let noMatchRow = tbody.querySelector('.no-search-match-row');
  if (cleanQuery && matchedCount === 0 && totalDataRows > 0) {
    if (!noMatchRow) {
      const colCount = table.querySelectorAll('thead th').length || 8;
      noMatchRow = document.createElement('tr');
      noMatchRow.className = 'no-search-match-row';
      noMatchRow.innerHTML = `
        <td colspan="${colCount}" style="text-align:center; padding:24px 16px; color:#64748b; background:#f8fafc; font-size:0.85rem;">
          🔍 No records matching "<strong>${cleanQuery}</strong>" found across visible columns.
        </td>
      `;
      tbody.appendChild(noMatchRow);
    } else {
      noMatchRow.style.display = '';
      const strong = noMatchRow.querySelector('strong');
      if (strong) strong.innerText = cleanQuery;
    }
  } else if (noMatchRow) {
    noMatchRow.style.display = 'none';
  }
}
window.filterTableVisibleColumns = filterTableVisibleColumns;

function autoEnhanceDataTablesWithUniversalSearch() {
  const tables = document.querySelectorAll('.data-table, table.table');
  tables.forEach((tbl, idx) => {
    // Generate or get table ID
    if (!tbl.id) tbl.id = `auto-search-table-${idx + 1}`;
    
    // Find closest card or container
    const card = tbl.closest('.card') || tbl.closest('.card-body')?.parentElement;
    if (!card) return;
    
    const cardHeader = card.querySelector('.card-header');
    if (!cardHeader) return;
    
    // Check if universal search input already exists
    if (cardHeader.querySelector('.table-universal-search-input')) return;
    
    // Ensure flex layout on card header
    cardHeader.style.display = 'flex';
    cardHeader.style.justifyContent = 'space-between';
    cardHeader.style.alignItems = 'center';
    cardHeader.style.flexWrap = 'wrap';
    cardHeader.style.gap = '10px';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'table-universal-search-wrap';
    searchWrap.style.cssText = 'display:inline-flex; align-items:center; position:relative; min-width:230px; margin-left:auto;';
    searchWrap.innerHTML = `
      <input type="text" 
             class="form-input table-universal-search-input" 
             placeholder="🔍 Search all columns..." 
             style="font-size:0.8rem; padding:5px 28px 5px 10px; width:100%; border-radius:var(--radius-sm); border:1px solid #cbd5e1; background:#ffffff; box-shadow:0 1px 2px rgba(0,0,0,0.05);" 
             oninput="filterTableVisibleColumns('#${tbl.id}', this.value)">
      <span style="position:absolute; right:8px; pointer-events:none; font-size:0.8rem; color:#94a3b8;">🔍</span>
    `;
    cardHeader.appendChild(searchWrap);
  });
}
window.autoEnhanceDataTablesWithUniversalSearch = autoEnhanceDataTablesWithUniversalSearch;

// Enterprise Non-blocking Toast Notification Engine
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Strict Policy: Never display raw technical error messages to the user.
  // Log the actual error for diagnosis and display a standard user-friendly notice.
  let displayMessage = message;
  if (type === 'error' || type === 'danger') {
    console.error('[Application Error Logged]:', message);
    displayMessage = 'There is an error please contact to your administrator.';
  }

  const icons = {
    success: '✓',
    error: '✕',
    danger: '✕',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type === 'danger' ? 'error' : type}`;
  toast.innerHTML = `
    <span style="font-size: 1.1rem; font-weight: 800;">${icons[type] || 'ℹ️'}</span>
    <span style="flex: 1; line-height: 1.4;">${displayMessage}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// Global client error logging and graceful notification
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[Global Client Error Logged]:', event.error || event.message, event.filename, event.lineno);
    if (typeof showToast === 'function') {
      showToast(event.message || 'Client Exception', 'error');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled Promise Rejection Logged]:', event.reason);
    if (typeof showToast === 'function') {
      showToast(event.reason?.message || 'Unhandled Rejection', 'error');
    }
  });
}

// Universal Currency & Formatting Helpers
function formatCurrency(amount, currency = 'PKR', forceShow = false) {
  if (!forceShow && typeof State !== 'undefined' && State.canSeeBiddingPrices && !State.canSeeBiddingPrices()) {
    return '🔒 [Hidden]';
  }
  const num = parseFloat(amount || 0);
  const formatted = isNaN(num) ? '0' : num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const curr = currency || 'PKR';
  if (curr === 'USD') return `$ ${formatted}`;
  if (curr === 'EUR') return `€ ${formatted}`;
  if (curr === 'GBP') return `£ ${formatted}`;
  return `${curr} ${formatted}`;
}

function parseCurrency(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  return parseFloat(clean) || 0;
}

function formatCurrencyInput(el) {
  if (!el) return;
  const raw = el.value.replace(/[^0-9.]/g, '');
  if (!raw) return;
  const parts = raw.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  el.value = parts.join('.');
}

function formatPhoneNumberInput(el) {
  if (!el) return;
  let val = el.value.replace(/[^\d+]/g, '');
  if (val.startsWith('03') && val.length > 4) {
    val = val.slice(0, 4) + '-' + val.slice(4, 11);
  } else if (val.startsWith('+923') && val.length > 5) {
    val = val.slice(0, 5) + ' ' + val.slice(5, 12);
  }
  el.value = val;
}

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr || dateStr === 'N/A' || dateStr === 'null' || dateStr === 'undefined') return 'N/A';
  if (typeof dateStr === 'string') {
    const trimmed = dateStr.trim();
    // If it's already DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
      return `${String(dmyMatch[1]).padStart(2, '0')}/${String(dmyMatch[2]).padStart(2, '0')}/${dmyMatch[3]}`;
    }
    // If it starts with YYYY-MM-DD or YYYY/MM/DD (e.g. ISO string 2026-08-11T19:00:00.000Z)
    const ymdMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymdMatch) {
      return `${String(ymdMatch[3]).padStart(2, '0')}/${String(ymdMatch[2]).padStart(2, '0')}/${ymdMatch[1]}`;
    }
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return String(dateStr);
  }
}

function formatDateTimeDDMMYYYY(dateStr) {
  return formatDateDDMMYYYY(dateStr);
}

function sendEmailVerificationLink(inputId) {
  const emailInput = document.getElementById(inputId);
  if (!emailInput || !emailInput.value || !emailInput.checkValidity()) {
    alert('Please enter a valid official email address first.');
    return;
  }
  const email = emailInput.value.trim();
  const statusEl = document.getElementById(`${inputId}-verify-status`);
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerText = `✓ Verification link sent to ${email}. Check inbox to verify.`;
  }
  showToast(`Verification link sent to ${email}`, 'success');
}

function handleTenderSourceChange(val) {
  const container = document.getElementById('tender-source-other-container');
  const otherInput = document.getElementById('tender-source-other');
  if (container) {
    const isOther = (val === 'OTHER' || val === 'Others' || (typeof val === 'string' && val.startsWith('OTHER')));
    container.style.display = isOther ? 'block' : 'none';
    if (isOther && otherInput) {
      otherInput.focus();
    }
  }
}

async function handleUpdateTenderStatus(oppId, newStatus, encodedTitle = '', estVal = 0) {
  if (!newStatus) return;
  const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'Tender';

  if (newStatus.toLowerCase() === 'won') {
    const confirmWon = confirm(`Are you sure you want to mark "${title}" as WON?`);
    if (!confirmWon) return;

    await API.updateOpportunity(oppId, { status: 'Won', selection_status: 'Selected' });
    showToast(`🏆 Tender "${title}" successfully marked as WON!`, 'success');
    
    const awardChoice = confirm('Would you like to register the formal Letter of Award (LOA) now?');
    if (awardChoice) {
      promptAwardLetterModal(oppId, encodeURIComponent(title));
    }
  } else if (newStatus.toLowerCase() === 'lost' || newStatus.toLowerCase() === 'loose') {
    promptTenderLossModal(oppId, encodeURIComponent(title), estVal);
    return;
  } else {
    await API.updateOpportunity(oppId, { status: newStatus });
    showToast(`✓ Tender status updated to "${newStatus}"`, 'success');
  }

  // Update in local cached opportunity if cockpit modal is open
  const openCockpit = document.getElementById('modal-tender-360-cockpit');
  if (openCockpit && openCockpit.classList.contains('open')) {
    openTender360Cockpit(oppId);
  }
  await renderActiveView();
}

function toggleCustomerOtherTerms(val) {
  const container = document.getElementById('cust-other-terms-container');
  if (container) {
    container.style.display = (val === 'Other') ? 'block' : 'none';
    if (val === 'Other') {
      document.getElementById('cust-other-terms')?.focus();
    }
  }
}

// --------------------------------------------------------------------------
// INVITATION / SET PASSWORD FROM EMAIL LINK HANDLER
// --------------------------------------------------------------------------

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.innerText = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.innerText = '👁️';
  }
}

async function checkAndHandleSetPasswordUrl() {
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  
  let token = null;
  let email = null;

  // Check in URL hash: #set-password?token=...&email=...
  if (hash.includes('token=')) {
    const queryPart = hash.includes('?') ? hash.substring(hash.indexOf('?')) : hash;
    const hashParams = new URLSearchParams(queryPart.replace(/^#/, ''));
    token = hashParams.get('token');
    email = hashParams.get('email');
  }

  // Check in URL query params: ?token=...
  if (!token && search.includes('token=')) {
    const searchParams = new URLSearchParams(search);
    token = searchParams.get('token');
    email = searchParams.get('email');
  }

  if (token) {
    const loginView = document.getElementById('login-view');
    const appContainer = document.getElementById('app-container');
    if (loginView) loginView.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';

    const tokenInput = document.getElementById('set-password-token-input');
    if (tokenInput) tokenInput.value = token;

    const errorBox = document.getElementById('set-password-error-msg');
    const successBox = document.getElementById('set-password-success-msg');
    const nameEl = document.getElementById('set-password-display-name');
    const emailEl = document.getElementById('set-password-display-email');
    const avatarEl = document.getElementById('set-password-avatar-letter');

    if (errorBox) { errorBox.style.display = 'none'; errorBox.innerText = ''; }
    if (successBox) { successBox.style.display = 'none'; successBox.innerText = ''; }

    // Clear password inputs to prevent browser autofill
    const npInput = document.getElementById('set-new-password');
    const cpInput = document.getElementById('set-confirm-password');
    if (npInput) npInput.value = '';
    if (cpInput) cpInput.value = '';

    openModal('modal-set-password');

    // Verify token with backend
    try {
      const res = await API.verifyResetToken(token);
      if (res && res.success && res.data) {
        const user = res.data;
        if (nameEl) nameEl.innerText = user.fullName || user.username || 'User';
        if (emailEl) emailEl.innerText = `${user.email || email || ''} • (${user.role || 'Member'})`;
        if (avatarEl) avatarEl.innerText = (user.fullName || user.username || 'U').charAt(0).toUpperCase();
      } else {
        if (errorBox) {
          errorBox.innerText = (res && res.message) ? res.message : 'Invalid or expired password setup link.';
          errorBox.style.display = 'block';
        }
      }
    } catch (e) {
      if (errorBox) {
        errorBox.innerText = 'Unable to verify setup link. Please contact administrator.';
        errorBox.style.display = 'block';
      }
    }
    return true;
  }
  return false;
}

async function submitSetPasswordTokenForm() {
  const tokenInput = document.getElementById('set-password-token-input');
  const newPassInput = document.getElementById('set-new-password');
  const confirmPassInput = document.getElementById('set-confirm-password');
  const errorBox = document.getElementById('set-password-error-msg');
  const successBox = document.getElementById('set-password-success-msg');
  const submitBtn = document.getElementById('btn-submit-set-password');

  const token = tokenInput ? tokenInput.value : '';
  const newPass = newPassInput ? newPassInput.value : '';
  const confirmPass = confirmPassInput ? confirmPassInput.value : '';

  if (errorBox) { errorBox.style.display = 'none'; errorBox.innerText = ''; }
  if (successBox) { successBox.style.display = 'none'; successBox.innerText = ''; }

  if (!newPass || !confirmPass) {
    if (errorBox) {
      errorBox.innerText = 'Please enter and confirm your new password.';
      errorBox.style.display = 'block';
    }
    return;
  }

  if (newPass !== confirmPass) {
    if (errorBox) {
      errorBox.innerText = 'New password and confirmation password do not match.';
      errorBox.style.display = 'block';
    }
    return;
  }

  // Password Policy check
  if (newPass.length < 8 || newPass.length > 20) {
    if (errorBox) {
      errorBox.innerText = 'Password must be between 8 and 20 characters.';
      errorBox.style.display = 'block';
    }
    return;
  }
  if (!/[A-Z]/.test(newPass)) {
    if (errorBox) {
      errorBox.innerText = 'Password must contain at least one uppercase letter (A-Z).';
      errorBox.style.display = 'block';
    }
    return;
  }
  if (!/[a-z]/.test(newPass)) {
    if (errorBox) {
      errorBox.innerText = 'Password must contain at least one lowercase letter (a-z).';
      errorBox.style.display = 'block';
    }
    return;
  }
  if (!/[0-9]/.test(newPass)) {
    if (errorBox) {
      errorBox.innerText = 'Password must contain at least one numeric digit (0-9).';
      errorBox.style.display = 'block';
    }
    return;
  }
  if (!/[^A-Za-z0-9]/.test(newPass)) {
    if (errorBox) {
      errorBox.innerText = 'Password must contain at least one special character (!@#$%^&*).';
      errorBox.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = '⏳ Setting Password...';
  }

  try {
    const res = await API.resetPasswordWithToken(token, newPass);
    if (res && res.success) {
      if (successBox) {
        successBox.innerText = '✓ Password set successfully! Redirecting into Mashrue...';
        successBox.style.display = 'block';
      }
      showToast('🎉 Password set successfully! Welcome to Mashrue.', 'success');

      // Clear hash/query string from URL
      window.history.replaceState({}, document.title, window.location.pathname);

      setTimeout(async () => {
        closeModal('modal-set-password');
        // Clear login fields
        const uInput = document.getElementById('login-username');
        const pInput = document.getElementById('login-password');
        if (uInput) uInput.value = '';
        if (pInput) pInput.value = '';
        await initApp();
      }, 1000);
    } else {
      if (errorBox) {
        errorBox.innerText = (res && res.message) ? res.message : 'Failed to set password. Link may have expired.';
        errorBox.style.display = 'block';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = '🚀 Set Password & Launch App';
      }
    }
  } catch (err) {
    if (errorBox) {
      errorBox.innerText = 'An unexpected error occurred. Please try again.';
      errorBox.style.display = 'block';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = '🚀 Set Password & Launch App';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
});

// Also listen to hash changes for set-password links
window.addEventListener('hashchange', async () => {
  if (window.location.hash.includes('token=')) {
    await checkAndHandleSetPasswordUrl();
  }
});

async function initApp() {
  const loginView = document.getElementById('login-view');
  const appContainer = document.getElementById('app-container');

  // Check for Set Password Token in URL (from email link)
  const isSetPasswordFlow = await checkAndHandleSetPasswordUrl();
  if (isSetPasswordFlow) {
    return;
  }

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
      sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
    }
  } catch (e) {
    console.warn('Profile refresh fallback:', e.message);
  }

  // 2. First-Time Mandatory Password Change Interceptor
  if (State.currentUser && State.currentUser.mustChangePassword) {
    openModal('modal-force-password');
  }

  // 3. Fetch Business Profiles for active user/tenant
  try {
    State.businessProfiles = await API.getBusinessProfiles();
  } catch (e) {
    console.warn('getBusinessProfiles failed:', e.message);
  }
  try {
    populateBusinessSwitcher();
  } catch (e) {
    console.warn('populateBusinessSwitcher failed:', e.message);
  }
  try {
    updateHeaderUserProfile();
  } catch (e) {
    console.warn('updateHeaderUserProfile failed:', e.message);
  }
  try {
    renderDynamicSidebarNavigation();
  } catch (e) {
    console.warn('renderDynamicSidebarNavigation failed:', e.message);
  }

  // 4. Client Admin Onboarding Interceptor (If 0 companies configured and not changing password)
  try {
    if (State.isClientAdmin() && (!State.businessProfiles || State.businessProfiles.length === 0) && !State.currentUser?.mustChangePassword) {
      openModal('modal-onboard-company');
    }
  } catch (e) {
    console.warn('Onboarding modal check failed:', e.message);
  }

  // 5. Render Current Active View
  try {
    await renderActiveView();
  } catch (e) {
    console.error('renderActiveView failed during initApp:', e.message);
  }

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
window.handleUserLogin = handleUserLogin;

function fillLoginCredentials(username, password) {
  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');
  if (u) u.value = username;
  if (p) p.value = password;
  const err = document.getElementById('login-error-msg');
  if (err) err.style.display = 'none';
  showToast(`Autofilled credentials for: ${username}`, 'info', 2000);
}
window.fillLoginCredentials = fillLoginCredentials;

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.innerText = '🔒';
  } else {
    input.type = 'password';
    if (btn) btn.innerText = '👁️';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function handleUserLogout() {
  State.clearSession();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
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
      sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));

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

  // Insert/Update Trial & Subscription Status Pill in Header dynamically
  renderHeaderSubStatusPill();
  syncDynamicTrialCounters();
}

function renderHeaderSubStatusPill(overrideTenders, overrideCdrs) {
  const headerActions = document.querySelector('.header-actions');
  const existingPill = document.getElementById('header-sub-status-pill');
  if (State.isSuperAdmin()) {
    if (existingPill) existingPill.remove();
    return;
  }
  if (!headerActions) return;

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
  let quota = {};
  try {
    quota = (typeof State.getTenantQuota === 'function' ? State.getTenantQuota(tid) : {}) || {};
  } catch (e) {
    quota = {};
  }
  const daysLeft = State.getTrialDaysRemaining(tid);

  if (sub.status === 'Suspended') {
    subStatusPill.innerHTML = `
      <span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-weight:700; padding:6px 12px; cursor:pointer;" onclick="switchView('my-subscription')">
        ⛔ Subscription Suspended
      </span>
    `;
    return;
  }

  const isUnlimitedTenders = (sub.is_unlimited_tenders || sub.tender_limit === 'unlimited' || sub.tender_limit === -1 || sub.trial_tender_limit === 'unlimited' || sub.plan_type === 'Advance');
  const isUnlimitedCdrs = (sub.is_unlimited_cdrs || sub.bid_security_limit === 'unlimited' || sub.bid_security_limit === -1 || sub.trial_bid_security_limit === 'unlimited' || sub.plan_type === 'Advance');

  const liveTenders = (overrideTenders !== undefined) ? overrideTenders : (State.liveTendersCount !== undefined ? State.liveTendersCount : (quota?.tenders_created || 0));
  const liveCdrs = (overrideCdrs !== undefined) ? overrideCdrs : (State.liveCdrsCount !== undefined ? State.liveCdrsCount : (quota?.bid_securities_created || 0));

  const tendersText = isUnlimitedTenders 
    ? `<span>📑 <strong>${liveTenders}</strong> Tenders (Unlimited)</span>` 
    : `<span>📑 <strong>${liveTenders}/${sub.tender_limit || sub.trial_tender_limit || 5}</strong> Tenders</span>`;

  const cdrsText = isUnlimitedCdrs 
    ? `<span>🏦 <strong>${liveCdrs}</strong> CDRs (Unlimited)</span>` 
    : `<span>🏦 <strong>${liveCdrs}/${sub.bid_security_limit || sub.trial_bid_security_limit || 10}</strong> CDRs</span>`;

  const entitySeatsText = `🏢 ${sub.free_companies_limit || 1} Cos &bull; 👥 ${sub.free_users_limit || 1} Seats`;

  if (sub.is_trial && sub.status === 'Trial') {
    subStatusPill.innerHTML = `
      <span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-weight:700; padding:6px 12px; cursor:pointer; display:flex; align-items:center; gap:8px;" onclick="switchView('my-subscription')" title="${sub.plan_type} (${daysLeft}d Trial) | ${entitySeatsText}">
        <span>⏳ <strong>${daysLeft}d</strong> Trial</span>
        <span style="font-weight:400; color:#3b82f6;">|</span>
        ${tendersText}
        <span style="font-weight:400; color:#3b82f6;">|</span>
        ${cdrsText}
        <span style="font-weight:400; color:#3b82f6;">|</span>
        <span style="font-size: 0.74rem; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${entitySeatsText}</span>
      </span>
    `;
  } else {
    const cycleText = sub.billing_cycle ? (sub.billing_cycle.charAt(0).toUpperCase() + sub.billing_cycle.slice(1).replace('_', '-')) : 'Monthly';
    const isPro = (sub.plan_type === 'Advance' || sub.plan_type === 'Enterprise');
    const badgeBg = isPro ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : '#f0fdf4';
    const badgeColor = isPro ? '#065f46' : '#166534';
    const borderColor = isPro ? '#6ee7b7' : '#86efac';
    const tagBg = isPro ? '#a7f3d0' : '#bbf7d0';
    const tagColor = isPro ? '#064e3b' : '#14532d';

    subStatusPill.innerHTML = `
      <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${borderColor}; font-weight: 700; padding: 6px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 1px 3px rgba(16,185,129,0.12);" onclick="switchView('my-subscription')" title="${sub.plan_type} Plan (${cycleText}) | ${entitySeatsText}">
        <span style="font-size: 0.95rem;">${isPro ? '⚡' : '✓'}</span>
        <span><strong>${sub.plan_type} Plan</strong></span>
        <span style="font-weight: 400; opacity: 0.6;">|</span>
        ${tendersText}
        <span style="font-weight: 400; opacity: 0.6;">|</span>
        ${cdrsText}
        <span style="font-weight: 400; opacity: 0.6;">|</span>
        <span style="font-size: 0.76rem; background: ${tagBg}; color: ${tagColor}; padding: 2px 7px; border-radius: 4px; font-weight: 700;">${entitySeatsText}</span>
      </span>
    `;
  }
}

async function syncDynamicTrialCounters() {
  const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
  if (!tid || State.isSuperAdmin()) return;

  try {
    const [opps, secs] = await Promise.all([
      API.getOpportunities('all'),
      API.getBidSecurities('all')
    ]);
    const tendersCount = Array.isArray(opps) ? opps.length : 0;
    const cdrsCount = Array.isArray(secs) ? secs.length : 0;

    State.liveTendersCount = tendersCount;
    State.liveCdrsCount = cdrsCount;
    if (State.currentUser?.tenant) {
      State.currentUser.tenant.tenderCount = tendersCount;
      State.currentUser.tenant.cdrCount = cdrsCount;
    }

    renderHeaderSubStatusPill(tendersCount, cdrsCount);
  } catch (e) {
    console.warn('syncDynamicTrialCounters:', e.message);
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

  // 2. Change Password (Visible ONLY to Super Admin and Primary Client Admin created by Super Admin)
  const canChangePassword = isSuper || (typeof State.isCreatedBySuperAdmin === 'function' ? State.isCreatedBySuperAdmin() : false);
  if (canChangePassword) {
    itemsHTML += `
      <li>
        <a class="user-dropdown-item" onclick="closeUserDropdown(); openChangePasswordModal();">
          <span class="item-icon">🔑</span>
          <span>Change Password</span>
        </a>
      </li>
    `;
  }

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

// --------------------------------------------------------------------------
// CENTRALIZED PASSWORD VALIDATOR & POLICY ENFORCER
// --------------------------------------------------------------------------
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8 || password.length > 20) {
    return { valid: false, message: 'Password length must be between 8 and 20 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one numeric digit (0-9).' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}
window.validatePasswordStrength = validatePasswordStrength;

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

  const check = validatePasswordStrength(newPass);
  if (!check.valid) {
    if (errBox) {
      errBox.innerText = `⚠️ ${check.message}`;
      errBox.style.display = 'block';
    }
    return;
  }

  if (newPass !== confPass) {
    if (errBox) {
      errBox.innerText = '⚠️ Password confirmation does not match. Please verify.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await API.changePassword(newPass);
    if (res && res.success) {
      closeModal('modal-change-password');
      showToast('✓ Password updated successfully! Your new password is active.', 'success');
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

async function handleFirstPasswordChange() {
  const newPass = document.getElementById('force-new-password')?.value;
  const confPass = document.getElementById('force-confirm-password')?.value;
  const errBox = document.getElementById('force-password-error-msg');

  const check = validatePasswordStrength(newPass);
  if (!check.valid) {
    if (errBox) {
      errBox.innerText = `⚠️ ${check.message}`;
      errBox.style.display = 'block';
    }
    return;
  }

  if (newPass !== confPass) {
    if (errBox) {
      errBox.innerText = '⚠️ Password confirmation does not match. Please verify.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await API.changePassword(newPass);
    if (res && res.success) {
      closeModal('modal-force-password');
      if (State.currentUser) State.currentUser.mustChangePassword = false;
      sessionStorage.setItem('mashrue_user', JSON.stringify(State.currentUser));
      showToast('✓ Permanent password set successfully!', 'success');
      await initApp();
    } else {
      if (errBox) {
        errBox.innerText = res.message || 'Failed to set password.';
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
window.handleFirstPasswordChange = handleFirstPasswordChange;

function renderDynamicSidebarNavigation() {
  const container = document.getElementById('dynamic-sidebar-container');
  if (!container) return;

  const isSuper = State.isSuperAdmin();
  const isAdmin = State.isClientAdmin();

  // Navigation schema with permissions & modular subscription keys
  const coreLinks = [
    { view: 'dashboard', icon: '📊', label: 'Dashboard & KPIs', perm: 'dashboard', always: true },
    { view: 'opportunities', icon: '📑', label: 'Tenders & Quotations', perm: 'opportunities', moduleKey: 'mod_tenders' },
    { view: 'bid-securities', icon: '🛡️', label: 'Bid Security Registry', perm: 'bid-securities', moduleKey: 'mod_bid_security' },
    { view: 'costing', icon: '💰', label: 'Costing & Margin', perm: 'costing', moduleKey: 'mod_costing_eval' },
    { view: 'approvals', icon: '⚖️', label: 'Bid Approvals', perm: 'approvals', moduleKey: 'mod_costing_eval' },
    { view: 'awards', icon: '🏆', label: 'Awards & Guarantees', perm: 'awards', moduleKey: 'mod_tenders' },
    { view: 'purchase-orders', icon: '📦', label: 'Purchase Orders (PO)', perm: 'purchase-orders', moduleKey: 'mod_supply_dc' },
    { view: 'delivery-challans', icon: '🚚', label: 'Supply & Challan (DC)', perm: 'delivery-challans', moduleKey: 'mod_supply_dc' },
    { view: 'invoices', icon: '🧾', label: 'Invoices & FBR PRAL', perm: 'invoices', moduleKey: 'mod_fbr_invoicing' },
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
    { view: 'business-profiles', icon: '🏢', label: 'Companies & Profiles', adminOnly: true },
    { view: 'users', icon: '👤', label: isSuper ? 'Tenants & Users' : 'Users & RBAC', adminOnly: true },
    { view: 'subscriptions', icon: '👑', label: 'Subscriptions & Billing', isSuperOnly: true },
    { view: 'my-subscription', icon: '💳', label: 'My Plan & Billing', isClientAdminOnly: true },
    { view: 'settings', icon: '⚙️', label: 'Settings & FBR', adminOnly: true, moduleKey: 'mod_fbr_invoicing' }
  ];

  const filterLinks = (list) => {
    return list.filter(item => {
      try {
        if (item.isSuperOnly && !isSuper) return false;
        if (item.isClientAdminOnly && (isSuper || !isAdmin)) return false;
        if (item.always) return true;
        if (item.moduleKey && typeof State.isModuleActiveForTenant === 'function' && !State.isModuleActiveForTenant(item.moduleKey)) return false;
        if (isSuper || isAdmin) return true;
        if (item.view === 'business-profiles' || item.view === 'users') return true;
        if (item.adminOnly) return false;
        return typeof State.hasPermission === 'function' ? State.hasPermission(item.perm, 'view') : true;
      } catch (e) {
        return true;
      }
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

  const profiles = State.businessProfiles || [];
  let optionsHtml = `<option value="all">🏢 All Business Entities (Consolidated)</option>`;

  if (profiles.length > 0) {
    optionsHtml += profiles.map(p => `
      <option value="${p.id}" ${State.currentBusinessProfileId === p.id ? 'selected' : ''}>${p.business_name} (${p.ntn || 'NTN Pending'})</option>
    `).join('');
  }

  optionsHtml += `<option value="__add_new_entity__" style="color:#2563eb; font-weight:700;">➕ + Add New Business Entity...</option>`;
  switcher.innerHTML = optionsHtml;
}

// --------------------------------------------------------------------------
// MAIN DYNAMIC VIEW ROUTER
// --------------------------------------------------------------------------
async function renderActiveView() {
  const contentArea = document.getElementById('main-content');
  const viewTitle = document.getElementById('view-title');
  const viewSubtitle = document.getElementById('view-subtitle');

  if (!contentArea) return;

  // Keep dynamic trial counters (Tenders & CDRs) refreshed
  syncDynamicTrialCounters();

  const currentProfile = State.getCurrentBusinessProfile();
  const isAdmin = State.isSuperAdmin() || State.isClientAdmin();

  // Screen permission mapping
  const viewPermMap = {
    'opportunities': 'opportunities',
    'bid-securities': 'bid-securities',
    'costing': 'costing',
    'approvals': 'approvals',
    'awards': 'awards',
    'purchase-orders': 'purchase-orders',
    'delivery-challans': 'delivery-challans',
    'invoices': 'invoices',
    'payments': 'payments',
    'inventory': 'inventory',
    'expenses': 'expenses',
    'reports': 'reports',
    'customers': 'customers',
    'suppliers': 'suppliers',
    'products': 'inventory',
    'business-profiles': 'settings',
    'users': 'users',
    'settings': 'settings'
  };

  if (State.isApplicationStopped()) {
    openModal('modal-trial-paid-company-stop');
    viewTitle.innerText = '🛑 Application Access Paused';
    viewSubtitle.innerText = 'Paid Company Add-on Payment Required';
    contentArea.innerHTML = `
      <div class="card" style="text-align:center; padding:50px 24px; max-width:600px; margin:40px auto; border-top:5px solid #dc2626; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.08);">
        <div style="font-size:3.5rem; margin-bottom:12px;">🛑</div>
        <h3 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin-bottom:8px;">Application Access Paused</h3>
        <p style="font-size:0.92rem; color:#475569; line-height:1.6; margin-bottom:20px;">
          You added an additional company profile (PKR 4,500/month) while on your Free Trial. Because your organization is on a trial period, application access is paused until payment for this company profile is completed.
        </p>
        <button class="primary-btn" onclick="openModal('modal-trial-paid-company-stop')" style="margin:0 auto; padding:12px 24px; font-weight:700; background:#059669;">
          💳 Submit Payment & Resume Access
        </button>
      </div>
    `;
    return;
  }

  const reqPerm = viewPermMap[State.activeView];
  if (reqPerm && !State.hasPermission(reqPerm, 'view')) {
    viewTitle.innerText = '⛔ Access Restricted';
    viewSubtitle.innerText = 'Screen Permission Revoked';
    contentArea.innerHTML = `
      <div class="card" style="text-align:center; padding:50px 24px; max-width:560px; margin:40px auto; border-top:4px solid #ef4444; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.08);">
        <div style="font-size:3.5rem; margin-bottom:12px;">🔒</div>
        <h3 style="font-size:1.3rem; font-weight:800; color:#1e293b; margin-bottom:8px;">Screen Access Restricted</h3>
        <p style="font-size:0.9rem; color:#64748b; line-height:1.6; margin-bottom:24px;">
          You do not have permission to view the <strong>${State.activeView.replace(/-/g, ' ').toUpperCase()}</strong> module.<br>
          Please contact your <strong>Tenant Administrator</strong> to grant rights to this screen.
        </p>
        <button class="primary-btn" onclick="switchView('dashboard')" style="margin:0 auto; padding:10px 20px;">📊 Return to Dashboard</button>
      </div>
    `;
    return;
  }

  try {
    switch (State.activeView) {
      case 'dashboard':
        viewTitle.innerText = 'Executive KPI Dashboard';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderDashboardHTML();
        break;

      case 'opportunities':
        viewTitle.innerText = 'Tenders & Quotations Pipeline';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderOpportunitiesHTML();
        break;

      case 'bid-securities':
        viewTitle.innerText = 'Bid Security Registry';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderBidSecuritiesHTML();
        break;

      case 'costing':
        viewTitle.innerText = 'Costing & Margin Calculator';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderCostingCalculatorHTML();
        setupCostingCalculator();
        break;

      case 'approvals':
        viewTitle.innerText = 'Bid Governance & Approvals';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderApprovalsHTML();
        break;

      case 'awards':
        viewTitle.innerText = 'Awards & Performance Guarantees';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderAwardsHTML();
        break;

      case 'purchase-orders':
        viewTitle.innerText = 'Purchase Orders (PO)';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderPurchaseOrdersHTML();
        break;

      case 'delivery-challans':
        viewTitle.innerText = 'Supply & Delivery Challans (DC)';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderDeliveryChallansHTML();
        break;

      case 'invoices':
        viewTitle.innerText = 'Invoices & FBR PRAL Hub';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderInvoicesHTML();
        break;

      case 'payments':
        viewTitle.innerText = 'Payments Received';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderPaymentsHTML();
        break;

      case 'inventory':
        viewTitle.innerText = 'Warehouse Stock & Inventory';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderInventoryHTML();
        break;

      case 'expenses':
        viewTitle.innerText = 'Expenses & Overhead Ledger';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderExpensesHTML();
        break;

      case 'reports':
        viewTitle.innerText = 'Management Reporting & Analytics';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderReportsHTML();
        break;

      case 'customers':
        viewTitle.innerText = 'Customer Directory';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderCustomersHTML();
        break;

      case 'suppliers':
        viewTitle.innerText = 'Supplier & Vendor Registry';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderSuppliersHTML();
        break;

      case 'products':
        viewTitle.innerText = 'Product & Item SKU Catalog';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderProductsHTML();
        break;

      case 'business-profiles':
        viewTitle.innerText = 'Companies & Business Profiles';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderBusinessProfilesHTML();
        break;

      case 'users':
        viewTitle.innerText = 'User Management & RBAC';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderUsersHTML();
        break;

      case 'subscriptions':
        viewTitle.innerText = 'Platform Subscriptions & Billing';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderSuperAdminSubscriptionsHTML();
        break;

      case 'my-subscription':
        viewTitle.innerText = 'Organization Subscription & Plan';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderMySubscriptionHTML();
        break;

      case 'settings':
        viewTitle.innerText = 'System Settings & FBR Digital Invoicing';
        viewSubtitle.innerText = '';
        contentArea.innerHTML = await renderSettingsHTML();
        break;

      default:
        contentArea.innerHTML = `<div class="card"><div class="card-body"><h3>View not found</h3></div></div>`;
    }

    try {
      if (typeof initCustomDateTimePickers === 'function') initCustomDateTimePickers();
      if (typeof autoEnhanceDataTablesWithUniversalSearch === 'function') autoEnhanceDataTablesWithUniversalSearch();
    } catch (enhErr) {
      console.warn('[View Enhancement Notice]:', enhErr.message);
    }
  } catch (err) {
    console.error(`Error rendering active view (${State.activeView}):`, err);
    contentArea.innerHTML = `
      <div class="card" style="text-align:center; padding:50px 24px; max-width:600px; margin:40px auto; border-top:4px solid #f59e0b; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.08);">
        <div style="font-size:3rem; margin-bottom:12px;">⚠️</div>
        <h3 style="font-size:1.3rem; font-weight:800; color:#1e293b; margin-bottom:8px;">Temporarily Unable to Load View</h3>
        <p style="font-size:0.9rem; color:#64748b; line-height:1.6; margin-bottom:20px;">
          An unexpected issue occurred while rendering <strong>${State.activeView.toUpperCase()}</strong>: ${err.message || 'Unknown error'}.
        </p>
        <div style="display:flex; justify-content:center; gap:12px;">
          <button class="primary-btn" onclick="renderActiveView()" style="padding:10px 20px;">🔄 Try Again</button>
          <button class="secondary-btn" onclick="switchView('dashboard')" style="padding:10px 20px;">📊 Go to Dashboard</button>
        </div>
      </div>
    `;
  }
}

// --------------------------------------------------------------------------
// 1. DASHBOARD VIEW
// --------------------------------------------------------------------------
async function renderDashboardHTML() {
  const [kpis, opps, pendingBills, securities] = await Promise.all([
    API.getDashboardKPIs(State.currentBusinessProfileId),
    API.getOpportunities(State.currentBusinessProfileId),
    API.getPendingBills(),
    API.getBidSecurities(State.currentBusinessProfileId)
  ]);

  const tendersKPI = kpis?.tenders || { total_tenders: 0, in_process: 0, won_count: 0, total_pipeline_value: 0 };
  const secKPI = kpis?.bidSecurities || { active_securities_count: 0, active_securities_amount: 0 };
  const finKPI = kpis?.financials || { total_invoiced: 0, total_collected: 0, total_receivables: 0 };

  const canSeePrices = State.canSeeBiddingPrices();

  const pipelineVal = parseFloat(tendersKPI.total_pipeline_value || 0);
  const pipelineDisplay = !canSeePrices
    ? '🔒 [Hidden]'
    : (pipelineVal >= 1000000 
      ? `PKR ${(pipelineVal / 1000000).toFixed(1)}M` 
      : `PKR ${pipelineVal.toLocaleString()}`);

  const secVal = parseFloat(secKPI.active_securities_amount || 0);
  const secDisplay = !canSeePrices
    ? '🔒 [Hidden]'
    : (secVal >= 1000000 
      ? `PKR ${(secVal / 1000000).toFixed(1)}M` 
      : (secVal >= 1000 ? `PKR ${(secVal / 1000).toFixed(0)}k` : `PKR ${secVal.toLocaleString()}`));

  const collectedVal = parseFloat(finKPI.total_collected || 0);
  const collectedDisplay = !canSeePrices
    ? '🔒 [Hidden]'
    : (collectedVal >= 1000000 
      ? `PKR ${(collectedVal / 1000000).toFixed(1)}M` 
      : `PKR ${collectedVal.toLocaleString()}`);

  const invoicedVal = parseFloat(finKPI.total_invoiced || 0);
  const invoicedDisplay = !canSeePrices
    ? '🔒 [Hidden]'
    : (invoicedVal >= 1000000 
      ? `PKR ${(invoicedVal / 1000000).toFixed(1)}M` 
      : `PKR ${invoicedVal.toLocaleString()}`);

  const recVal = parseFloat(finKPI.total_receivables || 0);
  const recDisplay = !canSeePrices
    ? '🔒 [Hidden]'
    : (recVal >= 1000000 
      ? `PKR ${(recVal / 1000000).toFixed(1)}M` 
      : `PKR ${recVal.toLocaleString()}`);
  // Determine Subscription Notification Banner
  const tid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
  const sub = State.getTenantSubscription(tid);
  const isSuper = State.isSuperAdmin();
  let subscriptionBanner = '';

  if (!isSuper) {
    if (sub.status === 'Suspended') {
      subscriptionBanner = `
        <div style="background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); color: #ffffff; border-radius: var(--radius-md); padding: 14px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(153, 27, 27, 0.25); border-left: 5px solid #f87171;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="font-size: 1.8rem; background: rgba(255,255,255,0.18); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">⛔</div>
            <div>
              <strong style="font-size: 0.98rem; color: #fecaca; letter-spacing: 0.3px;">SUBSCRIPTION SUSPENDED</strong>
              <div style="font-size: 0.83rem; color: #fee2e2; margin-top: 3px;">
                Your organization workspace is suspended due to pending subscription payment. Please clear outstanding dues to resume full operations.
              </div>
            </div>
          </div>
          <button class="primary-btn" style="background: #ef4444; border: 1px solid #f87171; color: #ffffff; font-weight: 600; font-size: 0.8rem; padding: 6px 14px; white-space: nowrap;" onclick="switchView('my-subscription')">
            💳 Pay & Reactivate &rarr;
          </button>
        </div>
      `;
    } else if (sub.is_trial && sub.status === 'Trial') {
      const daysLeft = State.getTrialDaysRemaining(tid);
      const isUnlimitedTenders = (sub.is_unlimited_tenders || sub.tender_limit === 'unlimited' || sub.tender_limit === -1 || sub.trial_tender_limit === 'unlimited');
      const isUnlimitedCdrs = (sub.is_unlimited_cdrs || sub.bid_security_limit === 'unlimited' || sub.bid_security_limit === -1 || sub.trial_bid_security_limit === 'unlimited');
      const coLimit = sub.free_companies_limit || 1;
      const userLimit = sub.free_users_limit || 1;

      subscriptionBanner = `
        <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #ffffff; border-radius: var(--radius-md); padding: 14px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(30, 58, 138, 0.2); border-left: 5px solid #60a5fa;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="font-size: 1.8rem; background: rgba(255,255,255,0.18); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">⏳</div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 0.98rem; color: #bfdbfe; letter-spacing: 0.3px;">${(sub.plan_type || 'ORGANIZATION').toUpperCase()} FREE TRIAL (${daysLeft} DAYS REMAINING)</strong>
                <span class="badge" style="background: #3b82f6; color: #ffffff; font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; font-weight: 700;">TRIAL</span>
              </div>
              <div style="font-size: 0.83rem; color: #e2e8f0; margin-top: 3px;">
                Active trial leverages: <strong>${isUnlimitedTenders ? 'Unlimited Tenders' : `${sub.tender_limit || 5} Tenders`}</strong> &bull; <strong>${isUnlimitedCdrs ? 'Unlimited CDRs' : `${sub.bid_security_limit || 10} CDRs`}</strong> &bull; <strong>${coLimit} Business Entities</strong> &bull; <strong>${userLimit} User Seats</strong>. Upgrade anytime to lock in organization license.
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="primary-btn" style="background: #3b82f6; border: 1px solid #60a5fa; color: #ffffff; font-weight: 600; font-size: 0.8rem; padding: 6px 14px; white-space: nowrap;" onclick="openModal('modal-quota-upgrade')">
              🚀 Upgrade Plan &rarr;
            </button>
          </div>
        </div>
      `;
    } else {
      const isPro = (sub.plan_type === 'Advance' || sub.plan_type === 'Enterprise');
      const isUnlimitedTenders = (sub.is_unlimited_tenders || sub.tender_limit === 'unlimited' || sub.tender_limit === -1 || sub.trial_tender_limit === 'unlimited' || isPro);
      const isUnlimitedCdrs = (sub.is_unlimited_cdrs || sub.bid_security_limit === 'unlimited' || sub.bid_security_limit === -1 || sub.trial_bid_security_limit === 'unlimited' || isPro);
      const coLimit = sub.free_companies_limit || (isPro ? 3 : 1);
      const userLimit = sub.free_users_limit || (isPro ? 3 : 1);

      subscriptionBanner = `
        <div style="background: linear-gradient(135deg, ${isPro ? '#064e3b 0%, #065f46 100%' : '#0f766e 0%, #115e59 100%'}); color: #ffffff; border-radius: var(--radius-md); padding: 14px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(6, 95, 70, 0.2); border-left: 5px solid ${isPro ? '#34d399' : '#2dd4bf'};">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="font-size: 1.8rem; background: rgba(255,255,255,0.18); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">${isPro ? '⚡' : '🏢'}</div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 0.98rem; color: #a7f3d0; letter-spacing: 0.3px;">${(sub.plan_type || 'ORGANIZATION').toUpperCase()} PLAN ACTIVE</strong>
                <span class="badge" style="background: #10b981; color: #ffffff; font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; font-weight: 700;">${isPro ? 'PRO TIER' : 'ACTIVE'}</span>
              </div>
              <div style="font-size: 0.83rem; color: #e2e8f0; margin-top: 3px;">
                Active organization leverages: <strong>${isUnlimitedTenders ? 'Unlimited Commercial Tenders & Bidding' : `${sub.tender_limit || 5} Tenders Included`}</strong> &bull; <strong>${isUnlimitedCdrs ? 'Unlimited Bid Securities (CDRs)' : `${sub.bid_security_limit || 10} Bid Securities`}</strong> &bull; <strong>${coLimit} Free Business Entities</strong> &bull; <strong>${userLimit} Free User Seats</strong>. All subscribed modules active.
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="primary-btn" style="background: #10b981; border: 1px solid #34d399; color: #ffffff; font-weight: 600; font-size: 0.8rem; padding: 6px 14px; white-space: nowrap;" onclick="switchView('my-subscription')">
              💳 View Plan & Entitlements &rarr;
            </button>
          </div>
        </div>
      `;
    }
  }

  return `
    ${subscriptionBanner}
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

    <!-- Active Pipeline Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">📑 Active Tenders & Bidding Status</div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${State.hasPermission('opportunities', 'add') && !State.isReadOnly() ? `<button class="primary-btn" style="padding:4px 12px; font-size:0.8rem;" onclick="openNewTenderModal()">+ Register New Tender</button>` : ''}
          <button class="secondary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="navigateToView('opportunities')">View Full Pipeline &rarr;</button>
        </div>
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
            ` : opps.slice(0, 5).map(o => {
              // ── 3-state Bid Security badge: PG Submitted / Attached / Missing ──
              const linkedSec = Array.isArray(securities) && securities.find(
                s => s.opportunity_id === o.id || String(s.opportunity_id) === String(o.id)
              );
              const secStatus = linkedSec?.status || null;
              const isPGSubmitted = secStatus === 'PG Submitted';
              const hasAttachedSecurity = (parseInt(o.active_bid_securities_count, 10) > 0) ||
                (linkedSec && (secStatus === 'Active' || secStatus === 'Submitted' || secStatus === 'PG Submitted' || !secStatus));
              // ─────────────────────────────────────────────────────────────────
              return `
              <tr>
                <td>
                  <strong>${o.tender_name || o.title}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${o.opportunity_number || ('TND-' + (o.id ? String(o.id).slice(-4) : '2026'))} | ${o.external_tender_number || 'Direct Sales / RFP'}</span>
                </td>
                <td><span class="pill-source">${o.tender_source || 'PPRA'}</span></td>
                <td><strong>${o.customer_name || 'Govt Department / Client'}</strong><br><span style="font-size:0.72rem; color:var(--text-muted);">${o.customer_org_type || o.customer_type || 'Government Department'}</span></td>
                <td>
                  ${State.canSeeBiddingPrices() 
                    ? `<strong>${formatCurrency(o.estimated_value, o.currency || 'PKR')}</strong>` 
                    : `<span class="badge badge-hold">🔒 Masked</span>`}
                </td>
                <td>
                  ${isPGSubmitted
                    ? `<button type="button" class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; cursor:pointer; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:4px;" onclick="openAttachedBidSecurityModal('${o.id}')" title="Bid Security absorbed in Performance Guarantee">🏦 PG Submitted</button>`
                    : hasAttachedSecurity
                    ? `<button type="button" class="badge badge-active" style="cursor:pointer; border:none;" onclick="openAttachedBidSecurityModal('${o.id}')" title="Click to view attached Bid Security details">🛡️ Attached</button>`
                    : `<button type="button" class="danger-btn" style="padding:3px 8px; font-size:0.75rem; cursor:pointer;" onclick="promptAttachBidSecurity('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}', '${o.opportunity_number || ''}', ${parseFloat(o.estimated_value || 0)}, '${encodeURIComponent(o.customer_name || '')}')" title="Click to attach Bid Security">⚠️ Missing (+ Attach)</button>`
                  }
                </td>
                <td><span class="badge badge-${(o.status || 'new').toLowerCase().replace(/\s+/g, '')}">${o.status}</span></td>
                <td>
                  <div style="display:flex; gap:4px;">
                    <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#0f172a; color:white;" onclick="openTenderDiaryModal('${o.id}')" title="Open Tender Activity Diary & Timeline">📜 Diary</button>
                    <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="openTender360Cockpit('${o.id}')">Cockpit</button>
                  </div>
                </td>
              </tr>
            `}).join('')}
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
  const [oppsRaw, securities] = await Promise.all([
    API.getOpportunities(State.currentBusinessProfileId),
    API.getBidSecurities(State.currentBusinessProfileId)
  ]);
  const opps = Array.isArray(oppsRaw) ? [...oppsRaw] : [];
  opps.sort((a, b) => {
    const parseSortDate = (dStr) => {
      if (!dStr) return 0;
      if (typeof dStr === 'string' && dStr.includes('/')) {
        const parts = dStr.split('/');
        if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime() || 0;
      }
      return new Date(dStr).getTime() || 0;
    };
    const dateA = parseSortDate(a.opening_date) || parseSortDate(a.closing_date) || parseSortDate(a.created_at);
    const dateB = parseSortDate(b.opening_date) || parseSortDate(b.closing_date) || parseSortDate(b.created_at);
    return dateB - dateA;
  });
  const isAdmin = State.currentUser?.role === 'CompanyAdmin' || State.isClientAdmin();

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="tab-btn active" onclick="filterTendersBySource('all', this)">All Sources</button>
        <button class="tab-btn" onclick="filterTendersBySource('PPRA (Federal)', this)">PPRA (Federal)</button>
        <button class="tab-btn" onclick="filterTendersBySource('PPRA (Punjab)', this)">PPRA (Punjab)</button>
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
              <th>Opening & Closing Date</th>
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
            ` : opps.map(o => {
              // ── 3-state Bid Security badge: PG Submitted / Attached / Missing ──
              const linkedSec = Array.isArray(securities) && securities.find(
                s => s.opportunity_id === o.id || String(s.opportunity_id) === String(o.id)
              );
              const secStatus = linkedSec?.status || null;
              const isPGSubmitted = secStatus === 'PG Submitted';
              const hasAttachedSecurity = (parseInt(o.active_bid_securities_count, 10) > 0) || 
                (linkedSec && (secStatus === 'Active' || secStatus === 'Submitted' || secStatus === 'PG Submitted' || !secStatus));
              // ─────────────────────────────────────────────────────────────────
              return `
              <tr data-source="${o.tender_source || 'PPRA (Federal)'}">
                <td>
                  <strong>${o.tender_name || o.title}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${o.opportunity_number || ''} ${o.external_tender_number ? `(${o.external_tender_number})` : ''}</span>
                  ${State.isSuperAdmin() ? `<br><span class="badge" style="font-size:0.7rem; background:#f1f5f9; color:#475569; margin-top:2px;">👤 ${o.client_admin_name || o.tenant_name || 'System'}</span>` : ''}
                </td>
                <td><span class="pill-source">${o.tender_source || 'PPRA (Federal)'}</span></td>
                <td>
                  <strong>${o.customer_name || 'N/A'}</strong><br>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${o.customer_org_type || 'Government'}</span>
                </td>
                <td>
                  ${o.opening_date ? `<span style="font-weight:700; color:#0284c7; display:block;">📂 Open: ${formatDateDDMMYYYY(o.opening_date)}</span>` : ''}
                  <span style="font-size:0.75rem; color:var(--text-muted);">⌛ Close: ${formatDateDDMMYYYY(o.closing_date)}</span>
                </td>
                <td class="amount-cell">
                  ${State.canSeeBiddingPrices() 
                    ? `<strong>${formatCurrency(o.estimated_value, o.currency || 'PKR')}</strong>` 
                    : `<span class="badge badge-hold" title="Price visibility masked for this employee">🔒 Masked</span>`}
                </td>
                <td>
                  ${isPGSubmitted
                    ? `<button type="button" class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; cursor:pointer; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:4px;" onclick="openAttachedBidSecurityModal('${o.id}')" title="Bid Security absorbed in Performance Guarantee">🏦 PG Submitted</button>`
                    : hasAttachedSecurity
                    ? `<button type="button" class="badge badge-active" style="cursor:pointer; border:none;" onclick="openAttachedBidSecurityModal('${o.id}')" title="Click to view attached Bid Security details">🛡️ Attached</button>`
                    : `<button type="button" class="danger-btn" style="padding:2px 8px; font-size:0.72rem; cursor:pointer;" onclick="promptAttachBidSecurity('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}', '${o.opportunity_number || ''}', ${parseFloat(o.estimated_value || 0)}, '${encodeURIComponent(o.customer_name || '')}')" title="Click to attach Bid Security">⚠️ Missing (+ Attach)</button>`
                  }
                </td>
                <td>
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <span class="badge badge-${(o.status || 'new').toLowerCase().replace(/\s+/g, '')}">${o.status}</span>
                    <select class="form-select" style="font-size:0.7rem; padding:2px 4px; border-radius:4px; height:24px; min-width:90px;" onchange="handleUpdateTenderStatus('${o.id}', this.value, '${encodeURIComponent(o.tender_name || o.title)}', ${parseFloat(o.estimated_value || 0)})" title="Update Tender Lifecycle Status">
                      <option value="" disabled selected>Change Status...</option>
                      <option value="New">New</option>
                      <option value="Under Evaluation">Under Evaluation</option>
                      <option value="Ready to submit">Ready to submit</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Won">🏆 Won</option>
                      <option value="Lost">❌ Lost</option>
                      <option value="Technical Disqualified">Disqualified</option>
                      <option value="Withdrawn">Withdrawn</option>
                    </select>
                  </div>
                </td>
                <td>
                  <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
                    <!-- 360 Cockpit Action & Diary -->
                    <button class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#0f172a; color:#ffffff; font-weight:700; border-color:#1e293b;" onclick="openTender360Cockpit('${o.id}')" title="Open Full 360 Project Cockpit">
                      🌐 360° Cockpit
                    </button>
                    <button class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#3b82f6; color:#ffffff; font-weight:600; border-color:#2563eb;" onclick="openTenderDiaryModal('${o.id}')" title="Open Chronological Tender Diary & Timeline">
                      📜 Diary
                    </button>

                    <button class="edit-btn" onclick="openEditTenderModal('${o.id}')" title="Edit Tender Details & Line Items">✏️ Edit</button>

                    <button class="danger-btn" style="padding:3px 7px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="handleDeleteOpportunity('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}')" title="Delete Tender Record">🗑️</button>

                    <!-- Single Clean Action Dropdown -->
                    <select class="form-select" style="font-size:0.72rem; padding:2px 6px; border-radius:4px; height:24px; min-width:92px; font-weight:600; background:#f8fafc; color:#0f172a;" onchange="handleTenderActionSelect('${o.id}', this.value, '${encodeURIComponent(o.tender_name || o.title)}', ${parseFloat(o.estimated_value || 0)})" title="Select Action for this Tender">
                      <option value="" disabled selected>Actions ▾</option>
                      <option value="Won">🏆 Mark as Won</option>
                      <option value="Lost">❌ Mark as Lost</option>
                      <option value="Under Evaluation">🔍 Under Evaluation</option>
                      <option value="Ready to submit">📋 Ready to Submit</option>
                      <option value="Submitted">🚀 Submit Bid</option>
                      <option value="Technical Disqualified">⚠️ Disqualified</option>
                      <option value="Award">📜 + Award LOA</option>
                      <option value="Edit">✏️ Edit Scope</option>
                    </select>
                  </div>
                </td>
              </tr>
            `}).join('')}
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
    if (source === 'all') {
      r.style.display = '';
    } else {
      const rowSrc = (r.getAttribute('data-source') || '').toLowerCase();
      const targetSrc = source.toLowerCase();
      r.style.display = (rowSrc === targetSrc || rowSrc.includes(targetSrc)) ? '' : 'none';
    }
  });
}

async function handleTenderActionSelect(oppId, action, encodedTitle, estVal) {
  if (!action) return;
  const title = decodeURIComponent(encodedTitle || '');
  switch (action) {
    case 'Won':
      await handleUpdateTenderStatus(oppId, 'Won', title, estVal);
      break;
    case 'Lost':
      await handleUpdateTenderStatus(oppId, 'Lost', title, estVal);
      break;
    case 'Award':
      promptAwardLetterModal(oppId, title);
      break;
    case 'Submitted':
      await handleBidSubmission(oppId);
      break;
    case 'Edit':
      openEditTenderModal(oppId);
      break;
    default:
      await handleUpdateTenderStatus(oppId, action, title, estVal);
      break;
  }
}

async function handleBidSubmission(oppId) {
  try {
    const res = await API.submitBid(oppId);
    if (res && res.success === false && res.message) {
      alert(`⚠️ ${res.message}`);
      return;
    }
    showToast('🚀 Bid submitted successfully! Forwarded to Bid Approvals.', 'success');
    alert('🚀 Bid / Quotation submitted successfully! Status changed to Submitted.');
    await renderActiveView();
  } catch (err) {
    alert(`Submission notice: ${err.message}`);
  }
}

async function handleTenderSelection(oppId, status) {
  try {
    if (API.selectOpportunity) {
      await API.selectOpportunity(oppId, status, 'Selected for submission');
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
      <button class="primary-btn" onclick="openNewBidSecurityModal()">+ Add Bid Security</button>
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
              <th>Bid Security Date</th>
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
                <td><strong>${formatCurrency(s.amount, 'PKR')}</strong></td>
                <td>${s.bank_name || 'Corporate Branch'}</td>
                <td>${formatDateDDMMYYYY(s.expiry_date)}</td>
                <td>
                  <span class="badge badge-${(s.status || 'active').toLowerCase()}">${s.status || 'Active'}</span>
                </td>
                <td>
                  <div class="action-buttons-group">
                    ${!State.isReadOnly() && State.hasPermission('bid-securities', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('bid-security', '${s.id}')">✏️ Edit</button>` : ''}
                    ${s.status === 'Active' ? `
                      ${!State.isReadOnly() && State.hasPermission('bid-securities', 'edit') ? `<button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="handleReleaseBidSecurity('${s.id}')">🔓 Release</button>` : ''}
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
        <div class="kpi-value">${formatCurrency(totalAwardValue, 'PKR')}</div>
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
              <th>Awarded Amount</th>
              <th>Item-Level Breakdown</th>
              <th>Stamp Duty (0.25%)</th>
              <th>Acceptance & Deadline</th>
              <th>Status</th>
              <th>Workflow Actions</th>
            </tr>
          </thead>
          <tbody>
            ${awards.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏆 <strong>No Award Letters recorded yet.</strong><br>
                  <span style="font-size:0.85rem;">When a tender or quotation is Won, record the official Letter of Award (LOA) with partial/full item quantities.</span>
                </td>
              </tr>
            ` : awards.map(a => {
              const childPOs = pos.filter(p => p.award_letter_id === a.id || p.opportunity_id === a.opportunity_id);
              const itemsCount = (a.items && a.items.length) ? a.items.length : 1;
              const awardedItemsCount = (a.items && a.items.length) ? a.items.filter(i => i.is_awarded !== false).length : 1;
              const oppGates = a.opportunity_workflow_gates || a.workflow_gates;
              let gatesObj = oppGates;
              if (typeof gatesObj === 'string') {
                try { gatesObj = JSON.parse(gatesObj); } catch (_) { gatesObj = null; }
              }
              const isSdRequired = a.stamp_duty_required !== false && 
                (gatesObj ? (gatesObj.requires_stamp_duty !== false && gatesObj.requires_stamp_duty !== 'false' && gatesObj.requires_stamp_duty !== 0) : true) && 
                (a.stamp_duty_status !== 'Not Required') && 
                (parseFloat(a.stamp_duty_amount || 0) > 0 || (a.stamp_duty_pct !== undefined && parseFloat(a.stamp_duty_pct) > 0));
              const stampDutyAmt = isSdRequired ? (parseFloat(a.stamp_duty_amount) || Math.round((parseFloat(a.award_amount) || 0) * (parseFloat(a.stamp_duty_pct || 0.25) / 100))) : 0;
              const isSdPaid = (a.stamp_duty_status === 'Paid');

              return `
                <tr>
                  <td>
                    <strong>${a.award_number}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${formatDateDDMMYYYY(a.award_date)}</span>
                  </td>
                  <td>
                    <strong>${a.opportunity_number ? `<span style="color:var(--primary); font-family:monospace;">[${a.opportunity_number}]</span> ` : ''}${a.tender_name || 'Won Project'}</strong><br>
                    <span style="font-size:0.78rem; color:#475569;">${a.customer_name || 'Government Client'}</span>
                  </td>
                  <td>
                    <strong style="color:#059669; font-size:0.95rem;">${formatCurrency(a.award_amount, 'PKR')}</strong>
                  </td>
                  <td>
                    <span class="badge ${awardedItemsCount === itemsCount ? 'badge-won' : 'badge-sec-attached'}">
                      ${awardedItemsCount} of ${itemsCount} Item(s) Awarded
                    </span><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${childPOs.length} Child PO(s) generated</span>
                  </td>
                  <td>
                    ${!isSdRequired ? `
                      <span class="badge" style="font-size:0.75rem; background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;">Stamp Duty Not Applied</span>
                    ` : (isSdPaid ? `
                      <span class="badge badge-won" style="font-size:0.75rem;">✓ Paid (Challan: ${a.stamp_duty_challan_no || 'Verified'})</span>
                    ` : `
                      <span class="badge badge-loss" style="font-size:0.75rem; ${!State.isReadOnly() ? 'cursor:pointer;' : ''}" ${!State.isReadOnly() ? `onclick="openStampDutyModal('${a.id}', '${a.award_number}', ${stampDutyAmt})"` : ''} title="Record Stamp Duty E-Challan">
                        ⚠️ Unpaid: ${formatCurrency(stampDutyAmt, 'PKR')} ${!State.isReadOnly() ? '(+ Pay)' : ''}
                      </span>
                    `)}
                  </td>
                  <td>
                    <span style="font-size:0.82rem;">
                      ${a.acceptance_deadline ? `Deadline: <strong>${formatDateDDMMYYYY(a.acceptance_deadline)}</strong>` : 'Standard (10 Days)'}
                    </span>
                  </td>
                  <td>
                    <span class="badge badge-${a.status === 'Accepted' ? 'won' : (a.status === 'Rejected' ? 'loose' : 'new')}">
                      ${a.status || 'Pending'}
                    </span>
                  </td>
                  <td>
                    <div class="action-buttons-group">
                      ${!State.isReadOnly() && State.hasPermission('purchase-orders', 'add') ? `
                        <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem; background:#0284c7;" onclick="openNewPOModal('${a.id}')" title="Issue new PO against this Award">
                          📦 + Create PO
                        </button>
                      ` : ''}
                      ${!State.isReadOnly() && State.hasPermission('awards', 'edit') ? `
                        <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="promptAttachPBGForAward('${a.id}', '${a.award_number}', ${parseFloat(a.award_amount || 0)})" title="Issue Performance Bank Guarantee">
                          🏦 PBG
                        </button>
                        <button class="edit-btn" onclick="openEditEntityModal('award', '${a.id}')">✏️ Edit</button>
                      ` : ''}
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
        <div class="card-title">🏦 Bank Performance Guarantees (PBG / Performance Bonds) Registry</div>
        ${!State.isReadOnly() && State.hasPermission('awards', 'add') ? `<button class="primary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="promptAttachPBGForAward()">+ Issue Performance Guarantee</button>` : ''}
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
              <th>Performance Guarantee Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${guarantees.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:45px 20px; color:var(--text-muted);">
                  <div style="font-size:2.2rem; margin-bottom:8px;">🏦</div>
                  <strong style="font-size:1.05rem; color:var(--text-primary); display:block; margin-bottom:4px;">No Performance Guarantees Registered</strong>
                  <p style="font-size:0.85rem; margin:0 auto; max-width:480px;">No Bank Guarantees, CDRs, or Performance Bonds found. Click <strong>+ Issue Performance Guarantee</strong> above to register an instrument.</p>
                </td>
              </tr>
            ` : guarantees.map(g => `
              <tr>
                <td>
                  <strong>${g.instrument_type || 'BG'} #${g.instrument_number || g.guarantee_number || 'N/A'}</strong><br>
                  <span style="font-size:0.75rem; color:var(--text-muted);">${g.contract_number || g.award_number || g.tender_title || g.opportunity_title || ''}</span>
                </td>
                <td>${g.account_title || '-'}</td>
                <td><strong>${g.beneficiary || g.customer_name || '-'}</strong></td>
                <td><strong style="color:#059669;">${formatCurrency(g.amount, 'PKR')}</strong></td>
                <td>${g.bank_name || g.bank_branch || '-'}</td>
                <td>${formatDateDDMMYYYY(g.expiry_date)}</td>
                <td>
                  <span class="badge badge-${(g.status || 'Active').toLowerCase() === 'active' ? 'active' : 'released'}">${g.status || 'Active'}</span>
                </td>
                <td>
                  <div class="action-buttons-group">
                    ${!State.isReadOnly() && State.hasPermission('awards', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('guarantee', '${g.id}')">✏️ Edit</button>` : ''}
                    ${g.status === 'Active' ? `
                      ${!State.isReadOnly() && State.hasPermission('awards', 'edit') ? `<button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="handleReleaseGuarantee('${g.id}')">🔓 Release</button>` : ''}
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
        <div class="kpi-value">${formatCurrency(totalPOValue, 'PKR')}</div>
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
        ${!State.isReadOnly() && State.hasPermission('purchase-orders', 'add') ? `<button class="primary-btn" onclick="openNewPOModal()">+ Create Purchase Order</button>` : ''}
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
                    <strong style="color:#0284c7; font-size:0.95rem;">${formatCurrency(po.net_amount || po.total_amount || 0, 'PKR')}</strong>
                    <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                      Subtotal: ${formatCurrency(po.subtotal || (parseFloat(po.net_amount || po.total_amount || 0) / 1.18), 'PKR')}<br>
                      <span style="color:#059669; font-weight:600;">+ 18% GST: ${formatCurrency(po.gst_amount || po.tax_amount || (parseFloat(po.net_amount || po.total_amount || 0) - parseFloat(po.subtotal || 0)), 'PKR')}</span>
                    </div>
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
                      <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem; background:#0284c7; color:white; font-weight:700;" onclick="open3WayMatchModal('${po.id}', '')" title="Audit 3-Way Match: PO vs DC/GRN vs Invoices">
                        🔍 3-Way Match
                      </button>
                      ${!State.isReadOnly() && State.hasPermission('delivery-challans', 'add') ? `
                        <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem; background:#059669;" onclick="promptCreateDCForPO('${po.id}', '${po.po_number}')" title="Generate Delivery Challan for this PO">
                          🚚 Dispatch DC
                        </button>
                      ` : ''}
                      ${!State.isReadOnly() && State.hasPermission('purchase-orders', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('purchase-order', '${po.id}')">✏️ Edit</button>` : ''}
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
        <div class="kpi-value">${formatCurrency(totalFreightPaid, 'PKR')}</div>
        <div class="kpi-subtext">Borne logistics expense</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
        <div class="kpi-title">Customs & Handling Paid</div>
        <div class="kpi-value">${formatCurrency(totalCustomsPaid, 'PKR')}</div>
        <div class="kpi-subtext">Port clearance expense</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🚚 Supply Delivery Challans (Warehouse & Drop-Shipments)</div>
        ${!State.isReadOnly() && State.hasPermission('delivery-challans', 'add') ? `<button class="primary-btn" onclick="openNewDCModal()">+ Dispatch New Delivery Challan</button>` : ''}
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
                      ${formatCurrency(dc.freight_cost_contractor || dc.delivery_cost || 0, 'PKR')}
                    </span>
                    ${dc.customs_handling_cost && parseFloat(dc.customs_handling_cost) > 0 ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">+ ${formatCurrency(dc.customs_handling_cost, 'PKR')} Customs</span>` : ''}
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
                      <button type="button" class="secondary-btn" style="padding:3px 7px; font-size:0.75rem; background:#0f172a; color:white;" onclick="printDeliveryChallan('${dc.id}')" title="Print Official A4 Letterhead Delivery Challan">
                        🖨️ Print DC
                      </button>
                      ${!State.isReadOnly() && State.hasPermission('invoices', 'add') ? `
                        <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem; background:#059669;" onclick="promptGenerateInvoiceFromDC('${dc.id}', '${dc.dc_number}', '${dc.customer_name}')" title="Generate commercial invoice for this DC">
                          🧾 Invoice
                        </button>
                      ` : ''}
                      ${!isDelivered && !State.isReadOnly() && State.hasPermission('delivery-challans', 'edit') ? `
                        <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="promptRecordCustomerGRN('${dc.id}', '${dc.dc_number}')" title="Record Signed GRN">
                          📋 GRN
                        </button>
                      ` : ''}
                      ${!State.isReadOnly() && State.hasPermission('delivery-challans', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('delivery-challan', '${dc.id}')">✏️ Edit</button>` : ''}
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
        <div class="kpi-value">${formatCurrency(totalBilled, 'PKR')}</div>
        <div class="kpi-subtext">${invoices.length} Invoices Generated</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Total Payments Collected</div>
        <div class="kpi-value">${formatCurrency(totalPaid, 'PKR')}</div>
        <div class="kpi-subtext">Realized Cash Inflow</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #ef4444;">
        <div class="kpi-title">Outstanding Receivables</div>
        <div class="kpi-value">${formatCurrency(totalReceivable, 'PKR')}</div>
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pos.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; padding:24px; color:var(--text-muted);">
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
                    <strong style="color:#0284c7; font-size:0.95rem;">${formatCurrency(poVal, 'PKR')}</strong>
                    <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                      Subtotal: ${formatCurrency(p.subtotal || (poVal / 1.18), 'PKR')}<br>
                      <span style="color:#059669; font-weight:600;">+ 18% GST: ${formatCurrency(p.gst_amount || p.tax_amount || (poVal - parseFloat(p.subtotal || (poVal / 1.18))), 'PKR')}</span>
                    </div>
                  </td>
                  <td>
                    <strong>${formatCurrency(poInvoicedTotal, 'PKR')}</strong>
                    <div style="font-size:0.72rem; color:#64748b;">${billedPct}% of PO Billed (${poInvs.length} Invs)</div>
                  </td>
                  <td>
                    <strong style="color:#059669;">${formatCurrency(poPaidTotal, 'PKR')}</strong>
                    <div style="font-size:0.72rem; color:#64748b;">${paidPct}% Collected</div>
                  </td>
                  <td>
                    <strong style="color:${poOutstanding > 0 ? '#dc2626' : '#64748b'};">${formatCurrency(poOutstanding, 'PKR')}</strong>
                  </td>
                  <td>
                    <span style="color:#b45309; font-weight:600;">${formatCurrency(poDirectCost, 'PKR')}</span>
                  </td>
                  <td>
                    <strong style="color:${poNetProfit >= 0 ? '#059669' : '#dc2626'}; font-size:0.9rem;">
                      ${formatCurrency(poNetProfit, 'PKR')}
                    </strong>
                    <span class="badge ${poNetProfit >= 0 ? 'badge-won' : 'badge-withdraw'}" style="font-size:0.7rem; margin-left:4px;">${State.canSeeBiddingPrices() ? `${poMarginPct}%` : '🔒'}</span>
                  </td>
                  <td>
                    ${!State.isReadOnly() && State.hasPermission('invoices', 'add') ? `
                      <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem; background:#0284c7; white-space:nowrap;" onclick="openNewInvoiceModal('${p.id}')">
                        🧾 Issue Invoice
                      </button>
                    ` : '<span style="color:#94a3b8; font-size:0.75rem;">View Only</span>'}
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
        <div style="display:flex; gap:8px;">
          ${!State.isReadOnly() && State.hasPermission('invoices', 'add') ? `<button class="primary-btn" style="background:#0284c7;" onclick="openNewInvoiceModal()">🧾 Generate Invoice</button>` : ''}
          ${!State.isReadOnly() && State.hasPermission('payments', 'add') ? `<button class="secondary-btn" onclick="openNewPaymentModal()">💵 Record Cheque Payment</button>` : ''}
        </div>
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
                <td><strong>${formatCurrency(inv.total_amount, 'PKR')}</strong></td>
                <td style="color:#059669; font-weight:600;">${formatCurrency(inv.paid_amount || 0, 'PKR')}</td>
                <td style="color:#dc2626; font-weight:700;">${formatCurrency(inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0)), 'PKR')}</td>
                <td>
                  ${!State.isReadOnly() && State.hasPermission('invoices', 'edit') ? `
                    <select style="font-size:0.75rem; padding:2px 4px; border-radius:4px; border:1px solid var(--border);" onchange="handleInvoiceStatusChange('${inv.id}', this.value)">
                      <option value="Submitted" ${inv.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Reinvoicing" ${inv.status === 'Reinvoicing' ? 'selected' : ''}>Reinvoicing</option>
                      <option value="Pending" ${inv.status === 'Pending' ? 'selected' : ''}>Pending</option>
                      <option value="Hold" ${inv.status === 'Hold' ? 'selected' : ''}>Hold</option>
                      <option value="Paid" ${inv.status === 'Paid' ? 'selected' : ''}>Paid</option>
                    </select>
                  ` : `<span class="badge badge-active">${inv.status || 'Submitted'}</span>`}
                </td>
                <td>
                  ${inv.fbr_status === 'FBR Validated' ? `
                    <span class="badge badge-fbr">✓ Validated</span>
                  ` : `
                    ${!State.isReadOnly() && State.hasPermission('invoices', 'edit') ? `<button class="secondary-btn" style="padding:2px 6px; font-size:0.72rem;" onclick="handleFBRSubmit('${inv.id}')">Submit FBR</button>` : `<span style="font-size:0.75rem; color:var(--text-muted);">Unvalidated</span>`}
                  `}
                </td>
                <td>
                  <div class="action-buttons-group">
                    <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#0284c7; color:white; font-weight:700;" onclick="open3WayMatchModal('${inv.purchase_order_id || ''}', '${inv.id}')" title="Audit 3-Way Match for this Invoice">
                      🔍 3-Way Match
                    </button>
                    <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#7c3aed; color:white; font-weight:600;" onclick="openViewInvoiceModal('${inv.id}')" title="View full invoice details">
                      👁️ View
                    </button>
                    ${!State.isReadOnly() && State.hasPermission('invoices', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('invoice', '${inv.id}')">✏️ Edit</button>` : ''}
                    ${!State.isReadOnly() && State.hasPermission('payments', 'add') ? `
                      <button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="promptRecordPaymentForInvoice('${inv.id}', '${inv.invoice_number}', '${inv.outstanding_amount !== undefined ? inv.outstanding_amount : (parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0))}')">💵 Pay</button>
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
      ${!State.isReadOnly() && State.hasPermission('payments', 'add') ? `<button class="primary-btn" onclick="openNewPaymentModal()">+ Record Cheque Receipt</button>` : ''}
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
                <td><strong style="color:#059669; font-size:0.95rem;">${formatCurrency(p.amount, 'PKR')}</strong></td>
                <td>${p.payment_date}</td>
                <td>
                  ${!State.isReadOnly() && State.hasPermission('payments', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('payment', '${p.id}')">✏️ Edit</button>` : ''}
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
        ${!State.isReadOnly() && State.hasPermission('inventory', 'add') ? `<button class="secondary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="openNewWarehouseModal()">+ Add Warehouse</button>` : ''}
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
                  ${!State.isReadOnly() && State.hasPermission('inventory', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('warehouse', '${w.id}')">✏️ Edit</button>` : ''}
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
                <td><strong>${formatCurrency(pr.total_landed_cost, 'PKR')}</strong></td>
                <td><span class="badge badge-won">${pr.status}</span></td>
                <td>
                  ${!State.isReadOnly() && State.hasPermission('inventory', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('procurement', '${pr.id}')">✏️ Edit</button>` : ''}
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
// EXPENSES & OVERHEAD LEDGER WITH MASTER CATEGORIES CATALOG (DYNAMIC)
// --------------------------------------------------------------------------

let _activeExpenseTab = 'ledger';
let _activeExpenseCatFilterTier = 'all';

function switchExpenseTab(tab) {
  _activeExpenseTab = tab;
  renderActiveView();
}

function filterCategoryCatalogByTier(tier) {
  _activeExpenseCatFilterTier = tier;
  renderActiveView();
}

async function renderExpensesHTML() {
  const [expenses, categories, opps] = await Promise.all([
    API.getExpenses(State.currentBusinessProfileId),
    API.getExpenseCategories(),
    API.getOpportunities(State.currentBusinessProfileId).catch(() => [])
  ]);
  _cachedExpenseCategories = categories;
  _cachedExpenseOpportunities = opps || [];

  // Segregate by 3 Tiers
  const tier1Expenses = expenses.filter(e => e.expense_tier === 'Tier 1 - Tender Direct' || e.expense_type === 'Tender Expense' || e.expense_type === 'Quotation Expense' || e.opportunity_id);
  const tier2Expenses = expenses.filter(e => e.expense_tier === 'Tier 2 - PO Execution' || e.purchase_order_id || e.delivery_challan_id);
  const tier3Expenses = expenses.filter(e => !tier1Expenses.includes(e) && !tier2Expenses.includes(e));

  const totalAll = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier1 = tier1Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier2 = tier2Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalTier3 = tier3Expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  // Group categories by tier
  const tier1Cats = categories.filter(c => c.tier === 'Tier 1 - Tender Direct');
  const tier2Cats = categories.filter(c => c.tier === 'Tier 2 - PO Execution');
  const tier3Cats = categories.filter(c => c.tier === 'Tier 3 - General Overheads');

  const filteredCategories = _activeExpenseCatFilterTier === 'all' 
    ? categories 
    : categories.filter(c => c.tier === _activeExpenseCatFilterTier);

  return `
    <!-- Top 3-Tier KPI Summary Cards -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Expenditures</div>
        <div class="kpi-value">${formatCurrency(totalAll, 'PKR')}</div>
        <div class="kpi-subtext">${expenses.length} Logged Transactions</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #0284c7;">
        <div class="kpi-title">🎯 Tier 1: Tender & Bidding Direct</div>
        <div class="kpi-value">${formatCurrency(totalTier1, 'PKR')}</div>
        <div class="kpi-subtext">${tier1Cats.length} Master Categories (${tier1Expenses.length} Logged)</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">🚚 Tier 2: PO Logistics & Freight</div>
        <div class="kpi-value">${formatCurrency(totalTier2, 'PKR')}</div>
        <div class="kpi-subtext">${tier2Cats.length} Master Categories (${tier2Expenses.length} Logged)</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #64748b;">
        <div class="kpi-title">🏢 Tier 3: General Overheads</div>
        <div class="kpi-value">${formatCurrency(totalTier3, 'PKR')}</div>
        <div class="kpi-subtext">${tier3Cats.length} Master Categories (${tier3Expenses.length} Logged)</div>
      </div>
    </div>

    <!-- Navigation Sub-Tabs & Actions Header -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <div style="display: inline-flex; background: #e2e8f0; padding: 4px; border-radius: 8px; gap: 4px;">
        <button type="button" class="btn-tab-toggle ${_activeExpenseTab === 'ledger' ? 'active' : ''}" onclick="switchExpenseTab('ledger')" style="padding: 7px 18px; font-size: 0.88rem; font-weight: 700; border-radius: 6px; border: none; cursor: pointer; ${_activeExpenseTab === 'ledger' ? 'background: #ffffff; color: var(--primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : 'background: transparent; color: #475569;'}">
          💳 3-Tier Expenditure Ledger (${expenses.length})
        </button>
        <button type="button" class="btn-tab-toggle ${_activeExpenseTab === 'categories' ? 'active' : ''}" onclick="switchExpenseTab('categories')" style="padding: 7px 18px; font-size: 0.88rem; font-weight: 700; border-radius: 6px; border: none; cursor: pointer; ${_activeExpenseTab === 'categories' ? 'background: #ffffff; color: var(--primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : 'background: transparent; color: #475569;'}">
          📁 Master Expense Categories (${categories.length} in DB)
        </button>
      </div>

      <div style="display: flex; gap: 8px;">
        <button class="secondary-btn" onclick="openAddExpenseCategoryModal()" style="font-size: 0.85rem; font-weight: 600;">
          ➕ + Add Expense Category
        </button>
        ${!State.isReadOnly() && State.hasPermission('expenses', 'add') ? `
          <button class="primary-btn" onclick="openExpenseModal()" style="font-size: 0.85rem; font-weight: 600;">
            💳 + Record Expenditure
          </button>
        ` : ''}
      </div>
    </div>

    ${_activeExpenseTab === 'ledger' ? `
      <!-- TAB 1: 3-TIER EXPENDITURE TRANSACTIONS LEDGER -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">💳 3-Tier Company & Project Expenditure Ledger</div>
          <div style="display:flex; gap:8px;">
            <button class="secondary-btn" style="font-size:0.78rem; padding:4px 10px;" onclick="switchExpenseTab('categories')">View All ${categories.length} Categories in DB</button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tender Name</th>
                <th>Expense Title / Details</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Paid To</th>
                <th>Classification / Tier</th>
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

                const matchedOpp = (_cachedExpenseOpportunities || []).find(o => o.id === e.opportunity_id) ||
                                   (State.opportunities || []).find(o => o.id === e.opportunity_id);
                const tenderTitle = e.tender_name || e.opportunity_title || matchedOpp?.tender_name || matchedOpp?.title || '';
                const tenderRef = e.opportunity_number || matchedOpp?.opportunity_number || '';
                let tenderDisplay = '';
                if (tenderTitle) {
                  tenderDisplay = `
                    <div style="line-height:1.35;">
                      <strong style="color:#0f172a; font-size:0.88rem; font-weight:700;">${escapeHtml(tenderTitle)}</strong>
                      ${tenderRef ? `<br><span style="font-size:0.73rem; color:var(--primary); font-weight:600;">${escapeHtml(tenderRef)}</span>` : ''}
                    </div>
                  `;
                } else if (e.po_number) {
                  tenderDisplay = `
                    <div style="line-height:1.35;">
                      <strong style="color:#059669; font-size:0.86rem; font-weight:700;">PO: ${escapeHtml(e.po_number)}</strong>
                      ${e.customer_name ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(e.customer_name)}</span>` : ''}
                    </div>
                  `;
                } else if (isTier1) {
                  tenderDisplay = `
                    <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.75rem;">🎯 Tender Direct (General / Unassigned)</span>
                  `;
                } else {
                  tenderDisplay = `<span style="color:#64748b; font-size:0.82rem; font-style:italic;">General Overhead (No Tender)</span>`;
                }

                let classificationHtml = tierBadge;
                if (e.po_number || e.purchase_order_id) {
                  classificationHtml += `<br><span style="font-size:0.72rem; color:#059669; font-weight:600;">PO: ${escapeHtml(e.po_number || 'PO Ref')}</span>`;
                } else if (e.contract_number) {
                  classificationHtml += `<br><span style="font-size:0.72rem; color:#2563eb; font-weight:600;">CNT: ${escapeHtml(e.contract_number)}</span>`;
                }

                return `
                  <tr>
                    <td>${tenderDisplay}</td>
                    <td>
                      <strong>${escapeHtml(e.expense_name || e.category)}</strong><br>
                      <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(e.remarks || e.notes || '')}</span>
                    </td>
                    <td>
                      <span class="badge badge-sec-attached" style="font-size:0.72rem;">${escapeHtml(e.category)}</span>
                    </td>
                    <td>
                      <strong style="color:#b45309; font-size:0.92rem;">${formatCurrency(e.amount, 'PKR')}</strong>
                    </td>
                    <td>${e.expense_date || 'Today'}</td>
                    <td><strong>${escapeHtml(e.paid_to || 'Vendor')}</strong></td>
                    <td>${classificationHtml}</td>
                    <td><span class="pill-source" style="font-size:0.72rem;">${escapeHtml(e.payment_mode || 'Online')}</span></td>
                    <td>
                      ${!State.isReadOnly() && State.hasPermission('expenses', 'edit') ? `<button class="edit-btn" onclick="openEditEntityModal('expense', '${e.id}')">✏️ Edit</button>` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Quick Category Directory Panel directly visible on the Main Screen -->
      <div class="card" style="margin-top: 20px; background: #f8fafc; border: 1px solid #e2e8f0;">
        <div class="card-header" style="background: transparent; border-bottom: 1px solid #e2e8f0;">
          <div>
            <h3 style="font-size: 0.96rem; font-weight: 700; color: #1e293b; margin: 0;">
              📁 Configured Expense Categories Directory (${categories.length} Categories in Database)
            </h3>
            <span style="font-size: 0.78rem; color: #64748b;">Click any category below to immediately record an expenditure under that specific classification</span>
          </div>
          <button class="secondary-btn" style="font-size: 0.8rem; padding: 4px 10px;" onclick="openAddExpenseCategoryModal()">➕ Add Custom Category</button>
        </div>
        <div style="padding: 16px;">
          <!-- Tier 1 -->
          <div style="margin-bottom: 14px;">
            <div style="font-size: 0.82rem; font-weight: 700; color: #0369a1; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              <span>🎯 Tier 1: Tender & Quotation Pre-Bid Direct Expenses</span>
              <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.7rem;">${tier1Cats.length} Categories</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${tier1Cats.map(c => `
                <button type="button" class="btn-category-chip" onclick="openExpenseModal('Tier 1 - Tender Direct', '', '', '${c.name.replace(/'/g, "\\'")}')" style="background: #ffffff; border: 1px solid #bae6fd; color: #0369a1; padding: 4px 10px; border-radius: 14px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s;" title="${c.description || c.name}">
                  + ${c.name}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Tier 2 -->
          <div style="margin-bottom: 14px;">
            <div style="font-size: 0.82rem; font-weight: 700; color: #92400e; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              <span>🚚 Tier 2: PO & Delivery Execution Logistics Costs</span>
              <span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.7rem;">${tier2Cats.length} Categories</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${tier2Cats.map(c => `
                <button type="button" class="btn-category-chip" onclick="openExpenseModal('Tier 2 - PO Execution', '', '', '${c.name.replace(/'/g, "\\'")}')" style="background: #ffffff; border: 1px solid #fde68a; color: #92400e; padding: 4px 10px; border-radius: 14px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s;" title="${c.description || c.name}">
                  + ${c.name}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Tier 3 -->
          <div>
            <div style="font-size: 0.82rem; font-weight: 700; color: #334155; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              <span>🏢 Tier 3: General Business & Administrative Overheads</span>
              <span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.7rem;">${tier3Cats.length} Categories</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${tier3Cats.map(c => `
                <button type="button" class="btn-category-chip" onclick="openExpenseModal('Tier 3 - General Overheads', '', '', '${c.name.replace(/'/g, "\\'")}')" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 14px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s;" title="${c.description || c.name}">
                  + ${c.name}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    ` : `
      <!-- TAB 2: MASTER EXPENSE CATEGORIES & TIERS CATALOG -->
      <div class="card">
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div>
            <div class="card-title">📁 Master Expense Categories Catalog (${filteredCategories.length})</div>
            <div style="font-size: 0.8rem; color: #64748b;">Configured standard and custom expense classifications stored in database</div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button class="filter-chip ${_activeExpenseCatFilterTier === 'all' ? 'active' : ''}" onclick="filterCategoryCatalogByTier('all')">All Tiers (${categories.length})</button>
            <button class="filter-chip ${_activeExpenseCatFilterTier === 'Tier 1 - Tender Direct' ? 'active' : ''}" onclick="filterCategoryCatalogByTier('Tier 1 - Tender Direct')">🎯 Tier 1 (${tier1Cats.length})</button>
            <button class="filter-chip ${_activeExpenseCatFilterTier === 'Tier 2 - PO Execution' ? 'active' : ''}" onclick="filterCategoryCatalogByTier('Tier 2 - PO Execution')">🚚 Tier 2 (${tier2Cats.length})</button>
            <button class="filter-chip ${_activeExpenseCatFilterTier === 'Tier 3 - General Overheads' ? 'active' : ''}" onclick="filterCategoryCatalogByTier('Tier 3 - General Overheads')">🏢 Tier 3 (${tier3Cats.length})</button>
            <button class="primary-btn" style="font-size: 0.8rem; padding: 5px 12px;" onclick="openAddExpenseCategoryModal()">➕ Add Category</button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 180px;">Tier & Classification</th>
                <th style="width: 250px;">Category Name</th>
                <th>Description / Expenditure Scope</th>
                <th style="width: 140px;">Logged Activity</th>
                <th style="width: 100px; text-align: center;">Status</th>
                <th style="width: 140px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredCategories.map(c => {
                const catExpenses = expenses.filter(e => e.category === c.name || (e.expense_tier === c.tier && e.expense_name === c.name));
                const catTotal = catExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

                let tierBadge = `<span class="badge" style="background:#f1f5f9; color:#475569;">🏢 Tier 3: Overhead</span>`;
                if (c.tier === 'Tier 1 - Tender Direct') {
                  tierBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1;">🎯 Tier 1: Tender Direct</span>`;
                } else if (c.tier === 'Tier 2 - PO Execution') {
                  tierBadge = `<span class="badge" style="background:#fef3c7; color:#92400e;">🚚 Tier 2: PO Logistics</span>`;
                }

                return `
                  <tr>
                    <td>${tierBadge}</td>
                    <td>
                      <strong style="color: #1e293b; font-size: 0.88rem;">${c.name}</strong>
                    </td>
                    <td style="color: #64748b; font-size: 0.82rem;">
                      ${c.description || 'Standard business expenditure classification'}
                    </td>
                    <td>
                      ${catExpenses.length > 0 ? `
                        <strong style="color: #b45309; font-size: 0.84rem;">${formatCurrency(catTotal, 'PKR')}</strong><br>
                        <span style="font-size: 0.72rem; color: #64748b;">${catExpenses.length} transaction${catExpenses.length > 1 ? 's' : ''}</span>
                      ` : `<span style="color: #94a3b8; font-size: 0.78rem;">No transactions yet</span>`}
                    </td>
                    <td style="text-align: center;">
                      <span class="badge badge-won" style="font-size: 0.72rem;">Active</span>
                    </td>
                    <td style="text-align: right;">
                      <button class="primary-btn" style="padding: 4px 8px; font-size: 0.74rem; font-weight: 600;" onclick="openExpenseModal('${c.tier}', '', '', '${c.name.replace(/'/g, "\\'")}')">
                        💳 Log Expense
                      </button>
                      ${c.tenant_id ? `
                        <button class="edit-btn" style="padding: 4px 6px; font-size: 0.74rem;" onclick="openEditExpenseCategoryModal('${c.id}')">✏️</button>
                        <button class="withdraw-btn" style="padding: 4px 6px; font-size: 0.74rem;" onclick="deleteExpenseCategory('${c.id}')">🗑️</button>
                      ` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
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
          <div class="kpi-value">${formatCurrency(totalContractVal, 'PKR')}</div>
          <div class="kpi-subtext">Executed Project Volume</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Net Realized Profit</div>
          <div class="kpi-value">${formatCurrency(totalNetProfit, 'PKR')}</div>
          <div class="kpi-subtext">After all direct & logistics expenses</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Average Net Margin</div>
          <div class="kpi-value">${State.canSeeBiddingPrices() ? (profitability.length > 0 ? (profitability.reduce((s, p) => s + parseFloat(p.profit_margin_pct || 0), 0) / profitability.length).toFixed(1) : 0) + '%' : '🔒'}</div>
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
                  <td><strong>${formatCurrency(p.contract_value, 'PKR')}</strong></td>
                  <td>${formatCurrency(p.invoiced_amount, 'PKR')}</td>
                  <td style="color:#059669; font-weight:600;">${formatCurrency(p.received_payment, 'PKR')}</td>
                  <td style="color:#dc2626;">${formatCurrency(p.allocated_expenses, 'PKR')}</td>
                  <td><strong style="color:#059669; font-size:0.95rem;">${formatCurrency(p.net_profit, 'PKR')}</strong></td>
                  <td><span class="badge badge-won">${State.canSeeBiddingPrices() ? `${p.profit_margin_pct}%` : '🔒'}</span></td>
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
          <div class="kpi-value">${formatCurrency(totalReceivables, 'PKR')}</div>
          <div class="kpi-subtext">${pendingBills.length} Pending Invoices</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Current (0–30 Days)</div>
          <div class="kpi-value">${formatCurrency(pendingBills.filter(b => (b.days_outstanding || 0) <= 30).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">Within standard credit term</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">Overdue (31–60 Days)</div>
          <div class="kpi-value">${formatCurrency(pendingBills.filter(b => (b.days_outstanding || 0) > 30 && (b.days_outstanding || 0) <= 60).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">Follow-up reminder stage</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #b91c1c;">
          <div class="kpi-title">Critical (60+ Days)</div>
          <div class="kpi-value">${formatCurrency(pendingBills.filter(b => (b.days_outstanding || 0) > 60).reduce((s, b) => s + parseFloat(b.outstanding_amount || 0), 0), 'PKR')}</div>
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
                    <td>${formatCurrency(b.total_amount, 'PKR')}</td>
                    <td><strong style="color:#dc2626; font-size:0.95rem;">${formatCurrency(b.outstanding_amount, 'PKR')}</strong></td>
                    <td>${agingBadge}</td>
                    <td><span class="badge badge-fbr">✓ Validated</span></td>
                    <td>
                      ${!State.isReadOnly() && State.hasPermission('payments', 'add') ? `
                        <button class="primary-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="promptRecordPaymentForInvoice('${b.id || ''}', '${b.invoice_number}', '${b.outstanding_amount}')">💵 Pay</button>
                      ` : ''}
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
          <div class="kpi-value">${formatCurrency(100000000, 'PKR')}</div>
          <div class="kpi-subtext">Approved Corporate Facility</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #ef4444;">
          <div class="kpi-title">Active Blocked Securities</div>
          <div class="kpi-value">${formatCurrency(totalActiveSecurities, 'PKR')}</div>
          <div class="kpi-subtext">Under Active Bidding & PBG</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #10b981;">
          <div class="kpi-title">Available Bank Credit Line</div>
          <div class="kpi-value">${formatCurrency(100000000 - totalActiveSecurities, 'PKR')}</div>
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
                <th>Amount</th>
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
                  <td><strong>${formatCurrency(s.amount, 'PKR')}</strong></td>
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
          <div class="kpi-value">${formatCurrency(procurements.length > 0 ? (procurements.reduce((s, p) => s + parseFloat(p.total_landed_cost || 0), 0) / procurements.length) : 0, 'PKR')}</div>
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
          <div class="kpi-value">${formatCurrency(opps.filter(o => o.status === 'won').reduce((s, o) => s + parseFloat(o.estimated_value || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">Contracted Project Value</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #dc2626;">
          <div class="kpi-title">Lost Tenders Volume</div>
          <div class="kpi-value">${formatCurrency(opps.filter(o => o.status === 'loose').reduce((s, o) => s + parseFloat(o.estimated_value || 0), 0), 'PKR')}</div>
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
                <th>Winning Bid</th>
                <th>Our Bid</th>
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
                  <td>${formatCurrency(ev.competitor_bid_amount || 0, 'PKR')}</td>
                  <td>${formatCurrency(ev.our_bid_amount || 0, 'PKR')}</td>
                  <td><strong style="color:#dc2626;">${formatCurrency(ev.variance_amount || 0, 'PKR')}</strong></td>
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
          <div class="kpi-value">${formatCurrency(expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">${expenses.length} Logged Items</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #0284c7;">
          <div class="kpi-title">🎯 Tier 1: Tender Pre-Bid Direct</div>
          <div class="kpi-value">${formatCurrency(expenses.filter(e => e.expense_tier === 'Tier 1 - Tender Direct' || e.opportunity_id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">Gifting, Samples, Lab Testing, Travel</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
          <div class="kpi-title">🚚 Tier 2: PO Logistics & Freight</div>
          <div class="kpi-value">${formatCurrency(expenses.filter(e => e.expense_tier === 'Tier 2 - PO Execution' || e.purchase_order_id || e.delivery_challan_id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0), 'PKR')}</div>
          <div class="kpi-subtext">3PL Freight, Customs, Port Demurrage</div>
        </div>
        <div class="kpi-card" style="border-left: 4px solid #64748b;">
          <div class="kpi-title">🏢 Tier 3: General Overheads</div>
          <div class="kpi-value">${formatCurrency(expenses.filter(e => e.expense_tier === 'Tier 3 - General Overheads' || (!e.opportunity_id && !e.purchase_order_id && !e.delivery_challan_id)).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0), 'PKR')}</div>
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
                <th>Amount</th>
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
                  <td><strong style="color:#b45309;">${formatCurrency(e.amount, 'PKR')}</strong></td>
                  <td>${e.paid_to || 'Vendor'}</td>
                  <td>${e.opportunity_number || e.po_number || 'General Overhead'}</td>
                  <td>${e.expense_date || 'Today'}</td>
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
                  <td><strong>System Admin</strong></td>
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
  let customers = await API.getCustomers();
  const isSuper = State.isSuperAdmin();

  let clientAdmins = [];
  if (isSuper) {
    try {
      const uRes = await API.getUsersWithStats();
      const allUsers = uRes?.data || State.getStoredUsers() || [];
      clientAdmins = allUsers.filter(u => u.role === 'ClientAdmin' || u.role === 'CompanyAdmin');
    } catch (e) {}
  }

  const selectedFilter = window._adminSelectedClientFilter || 'all';
  if (isSuper && selectedFilter !== 'all') {
    customers = customers.filter(c => String(c.tenant_id) === String(selectedFilter));
  }

  const renderCustomerRow = (c) => `
    <tr>
      <td>
        <strong>${c.business_name}</strong><br>
        <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${c.customer_code || 'CUST-' + (c.id ? c.id.slice(0, 6) : 'AUTO')}</span>
        ${isSuper ? `<br><span class="badge" style="font-size:0.7rem; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; margin-top:2px;">👤 ${c.client_admin_name || c.tenant_name || 'System Primary'}</span>` : ''}
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
        <div style="display:flex; gap:6px; align-items:center;">
          ${State.hasPermission('customers', 'edit') ? `
            <button class="edit-btn" onclick="openEditCustomerModal('${c.id}')" title="Edit Customer Details">✏️ Edit</button>
            <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="toggleCustomerStatus('${c.id}', '${c.status}')" title="Toggle Active / Inactive">
              ${c.status === 'Inactive' ? '✓' : '⛔'}
            </button>
          ` : ''}
          ${State.hasPermission('customers', 'delete') ? `
            <button class="danger-btn" style="background:#fee2e2; color:#b91c1c; border:1px solid #f87171; padding:4px 10px; font-weight:700; border-radius:4px; font-size:0.75rem; cursor:pointer;" onclick="deleteCustomerItem('${c.id}', '${encodeURIComponent(c.business_name)}')" title="Delete Customer">🗑️ Delete</button>
          ` : ''}
          ${(!State.hasPermission('customers', 'edit') && !State.hasPermission('customers', 'delete')) ? '<span style="font-size:0.75rem; color:#94a3b8;">👁️ View Only</span>' : ''}
        </div>
      </td>
    </tr>
  `;

  let tableBodyHTML = '';
  if (isSuper && selectedFilter === 'all' && clientAdmins.length > 0) {
    const groups = {};
    customers.forEach(c => {
      const key = c.tenant_id || 'system';
      if (!groups[key]) {
        const admin = clientAdmins.find(ca => String(ca.tenant?.id || ca.tenant_id) === String(key));
        groups[key] = {
          adminName: c.client_admin_name || (admin ? (admin.full_name || admin.username) : 'System Primary'),
          orgName: c.tenant_name || (admin?.tenant?.company_name || admin?.tenant?.organization_name || 'System Default'),
          items: []
        };
      }
      groups[key].items.push(c);
    });

    if (customers.length === 0) {
      tableBodyHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
            🏛️ <strong>No customers registered yet.</strong>
          </td>
        </tr>
      `;
    } else {
      tableBodyHTML = Object.values(groups).map(g => `
        <tr style="background:#f1f5f9; border-top:2px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
          <td colspan="9" style="padding:10px 16px; font-weight:800; font-size:0.88rem; color:#0f172a;">
            👤 Client Admin: <span style="color:#2563eb;">${g.adminName}</span> | 🏢 Organization: <span style="color:#475569;">${g.orgName}</span>
            <span class="badge badge-sec-attached" style="margin-left:10px;">${g.items.length} Registered Customers</span>
          </td>
        </tr>
        ${g.items.map(c => renderCustomerRow(c)).join('')}
      `).join('');
    }
  } else {
    tableBodyHTML = customers.length === 0 ? `
      <tr>
        <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
          🏛️ <strong>No customers registered yet.</strong><br>
          <span style="font-size:0.85rem;">Click the <strong>+ Register Customer</strong> button above to register your first client department or commercial buyer.</span>
        </td>
      </tr>
    ` : customers.map(c => renderCustomerRow(c)).join('');
  }

  return `
    <!-- Super Admin Client Filter Bar -->
    ${isSuper ? `
      <div class="card" style="background:linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%); border:1px solid #bae6fd; padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:1.6rem;">👑</span>
          <div>
            <div style="font-weight:800; color:#0369a1; font-size:0.95rem;">Super Admin View — Customers Grouped by Client Admin</div>
            <div style="font-size:0.78rem; color:#0284c7;">Filter by Client Admin created by Super Admin or view consolidated registry</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:0.82rem; font-weight:700; color:#0f172a; white-space:nowrap;">Client Admin Filter:</label>
          <select class="form-select" style="font-size:0.82rem; font-weight:600; min-width:240px; border:1px solid #7dd3fc; background:#fff; padding:6px 10px; border-radius:6px;" onchange="setAdminClientFilter(this.value)">
            <option value="all" ${selectedFilter === 'all' ? 'selected' : ''}>🌐 All Client Admins (Grouped View)</option>
            ${clientAdmins.map(ca => {
              const cTid = ca.tenant?.id || ca.tenant_id;
              const orgName = ca.tenant?.company_name || ca.tenant?.organization_name || ca.tenant_name || 'Client Workspace';
              return `<option value="${cTid}" ${selectedFilter === cTid ? 'selected' : ''}>👤 ${ca.full_name || ca.username} (${orgName})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
    ` : ''}

    <!-- Top KPI Highlights -->
    <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
      <div class="kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="kpi-title">Total Registered Buyers</div>
        <div class="kpi-value">${customers.length}</div>
        <div class="kpi-subtext">Government departments & commercial clients</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #3b82f6;">
        <div class="kpi-title">Government Entities</div>
        <div class="kpi-value">${customers.filter(c => (c.customer_type || c.org_type || '').includes('Government')).length}</div>
        <div class="kpi-subtext">Public sector departments & autonomous bodies</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">Active Accounts</div>
        <div class="kpi-value">${customers.filter(c => c.status !== 'Inactive').length}</div>
        <div class="kpi-subtext">Eligible for tender bidding</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">👥 Customer Accounts Directory</div>
        ${State.hasPermission('customers', 'add') ? '<button class="primary-btn" onclick="openNewCustomerModal()">+ Register Customer</button>' : ''}
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
            ${tableBodyHTML}
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
  let suppliers = await API.getSuppliers();
  const isSuper = State.isSuperAdmin();

  let clientAdmins = [];
  if (isSuper) {
    try {
      const uRes = await API.getUsersWithStats();
      const allUsers = uRes?.data || State.getStoredUsers() || [];
      clientAdmins = allUsers.filter(u => u.role === 'ClientAdmin' || u.role === 'CompanyAdmin');
    } catch (e) {}
  }

  const selectedFilter = window._adminSelectedClientFilter || 'all';
  if (isSuper && selectedFilter !== 'all') {
    suppliers = suppliers.filter(s => String(s.tenant_id) === String(selectedFilter));
  }

  const intlCount = suppliers.filter(s => s.supplier_type === 'International Supplier' || s.origin === 'International').length;
  const localCount = suppliers.length - intlCount;

  const renderSupplierRow = (s) => {
    const isIntl = (s.supplier_type === 'International Supplier' || s.origin === 'International');
    return `
      <tr>
        <td>
          <strong>${s.supplier_name}</strong><br>
          <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${s.supplier_code || 'SUP-' + (s.id ? s.id.slice(0, 6) : 'AUTO')}</span>
          ${isSuper ? `<br><span class="badge" style="font-size:0.7rem; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; margin-top:2px;">👤 ${s.client_admin_name || s.tenant_name || 'System Primary'}</span>` : ''}
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
          <div style="display:flex; gap:6px; align-items:center;">
            ${State.hasPermission('suppliers', 'edit') ? `
              <button class="edit-btn" onclick="openEditSupplierModal('${s.id}')" title="Edit Supplier Details">✏️ Edit</button>
              <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="toggleSupplierStatus('${s.id}', '${s.status}')" title="Toggle Active / Inactive">
                ${s.status === 'Inactive' ? '✓' : '⛔'}
              </button>
            ` : ''}
            ${State.hasPermission('suppliers', 'delete') ? `
              <button class="danger-btn" style="background:#fee2e2; color:#b91c1c; border:1px solid #f87171; padding:4px 10px; font-weight:700; border-radius:4px; font-size:0.75rem; cursor:pointer;" onclick="deleteSupplierItem('${s.id}', '${encodeURIComponent(s.supplier_name)}')" title="Delete Supplier">🗑️ Delete</button>
            ` : ''}
            ${(!State.hasPermission('suppliers', 'edit') && !State.hasPermission('suppliers', 'delete')) ? '<span style="font-size:0.75rem; color:#94a3b8;">👁️ View Only</span>' : ''}
          </div>
        </td>
      </tr>
    `;
  };

  let tableBodyHTML = '';
  if (isSuper && selectedFilter === 'all' && clientAdmins.length > 0) {
    const groups = {};
    suppliers.forEach(s => {
      const key = s.tenant_id || 'system';
      if (!groups[key]) {
        const admin = clientAdmins.find(ca => String(ca.tenant?.id || ca.tenant_id) === String(key));
        groups[key] = {
          adminName: s.client_admin_name || (admin ? (admin.full_name || admin.username) : 'System Primary'),
          orgName: s.tenant_name || (admin?.tenant?.company_name || admin?.tenant?.organization_name || 'System Default'),
          items: []
        };
      }
      groups[key].items.push(s);
    });

    if (suppliers.length === 0) {
      tableBodyHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
            🏭 <strong>No suppliers registered yet.</strong>
          </td>
        </tr>
      `;
    } else {
      tableBodyHTML = Object.values(groups).map(g => `
        <tr style="background:#f1f5f9; border-top:2px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
          <td colspan="9" style="padding:10px 16px; font-weight:800; font-size:0.88rem; color:#0f172a;">
            👤 Client Admin: <span style="color:#2563eb;">${g.adminName}</span> | 🏢 Organization: <span style="color:#475569;">${g.orgName}</span>
            <span class="badge badge-sec-attached" style="margin-left:10px;">${g.items.length} Registered Suppliers</span>
          </td>
        </tr>
        ${g.items.map(s => renderSupplierRow(s)).join('')}
      `).join('');
    }
  } else {
    tableBodyHTML = suppliers.length === 0 ? `
      <tr>
        <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
          🏭 <strong>No suppliers registered yet.</strong><br>
          <span style="font-size:0.85rem;">Click the <strong>+ Register Supplier</strong> button above to add your local and international manufacturers, OEMs, and stockists.</span>
        </td>
      </tr>
    ` : suppliers.map(s => renderSupplierRow(s)).join('');
  }

  return `
    <!-- Super Admin Client Filter Bar -->
    ${isSuper ? `
      <div class="card" style="background:linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%); border:1px solid #bae6fd; padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:1.6rem;">👑</span>
          <div>
            <div style="font-weight:800; color:#0369a1; font-size:0.95rem;">Super Admin View — Suppliers Grouped by Client Admin</div>
            <div style="font-size:0.78rem; color:#0284c7;">Filter by Client Admin created by Super Admin or view consolidated registry</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:0.82rem; font-weight:700; color:#0f172a; white-space:nowrap;">Client Admin Filter:</label>
          <select class="form-select" style="font-size:0.82rem; font-weight:600; min-width:240px; border:1px solid #7dd3fc; background:#fff; padding:6px 10px; border-radius:6px;" onchange="setAdminClientFilter(this.value)">
            <option value="all" ${selectedFilter === 'all' ? 'selected' : ''}>🌐 All Client Admins (Grouped View)</option>
            ${clientAdmins.map(ca => {
              const cTid = ca.tenant?.id || ca.tenant_id;
              const orgName = ca.tenant?.company_name || ca.tenant?.organization_name || ca.tenant_name || 'Client Workspace';
              return `<option value="${cTid}" ${selectedFilter === cTid ? 'selected' : ''}>👤 ${ca.full_name || ca.username} (${orgName})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
    ` : ''}

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
        ${State.hasPermission('suppliers', 'add') ? '<button class="primary-btn" onclick="openNewSupplierModal()">+ Register Supplier</button>' : ''}
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
            ${tableBodyHTML}
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
  let products = await API.getProducts();
  const suppliers = await API.getSuppliers();
  const isSuper = State.isSuperAdmin();

  let clientAdmins = [];
  if (isSuper) {
    try {
      const uRes = await API.getUsersWithStats();
      const allUsers = uRes?.data || State.getStoredUsers() || [];
      clientAdmins = allUsers.filter(u => u.role === 'ClientAdmin' || u.role === 'CompanyAdmin');
    } catch (e) {}
  }

  // Filter if super admin selected a specific client
  const selectedFilter = window._adminSelectedClientFilter || 'all';
  if (isSuper && selectedFilter !== 'all') {
    products = products.filter(p => String(p.tenant_id) === String(selectedFilter));
  }

  const totalStockItems = products.reduce((sum, p) => sum + (parseFloat(p.current_stock) || 0), 0);
  const reorderAlerts = products.filter(p => (parseFloat(p.current_stock) || 0) <= (parseFloat(p.reorder_level) || 10)).length;

  // Helper to render a single product row
  const renderProductRow = (p) => {
    const sup = suppliers.find(s => s.id === p.default_supplier_id || s.id === p.supplier_id);
    const isLowStock = (parseFloat(p.current_stock) || 0) <= (parseFloat(p.reorder_level) || 10);
    const costPrice = parseFloat(p.cost_price || 0);
    const sellingPrice = parseFloat(p.selling_price || 0);
    const isLoss = (costPrice > 0 && sellingPrice > 0 && sellingPrice < costPrice);
    const lossAmt = costPrice - sellingPrice;
    const lossPct = costPrice > 0 ? ((lossAmt / costPrice) * 100).toFixed(1) : '0';

    let expiryPill = '';
    if (p.expiry_date) {
      const expDate = new Date(p.expiry_date);
      const now = new Date();
      const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) {
        expiryPill = `<span class="badge badge-withdraw" style="font-size:0.7rem; background:#fee2e2; color:#b91c1c;">🔴 Expired (${p.expiry_date})</span>`;
      } else if (daysLeft <= 60) {
        expiryPill = `<span class="badge badge-hold" style="font-size:0.7rem; background:#fef3c7; color:#92400e;">🟡 Expiring in ${daysLeft}d</span>`;
      } else {
        expiryPill = `<span class="badge badge-won" style="font-size:0.7rem;">🟢 Fresh (Exp: ${p.expiry_date})</span>`;
      }
    }

    return `
      <tr class="${isLoss ? 'loss-row' : ''}">
        <td>
          <strong><code>${p.sku || 'SKU'}</code></strong>
          ${isSuper ? `<br><span class="badge" style="font-size:0.7rem; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; margin-top:2px;">👤 ${p.client_admin_name || p.tenant_name || 'System Primary'}</span>` : ''}
        </td>
        <td>
          <strong>${p.name}</strong>${p.specifications ? ` <span style="display:inline-block; font-size:0.75rem; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:4px;">${p.specifications}</span>` : ''}<br>
          <span style="font-size:0.75rem; color:var(--text-muted);">${p.description ? p.description : ''}</span>
        </td>
        <td>
          <span class="badge badge-sec-attached">${p.item_type || 'Product'}</span><br>
          <span style="font-size:0.8rem; font-weight:600;">${p.unit || 'PCS'}</span>
        </td>
        <td>
          <span style="font-size:0.8rem; font-weight:600; color:#1e293b;">
            ${p.batch_number || p.batch_no ? `<code>Batch: ${p.batch_number || p.batch_no}</code><br>` : '<span style="color:#94a3b8; font-size:0.75rem;">Standard Lot</span><br>'}
          </span>
          ${expiryPill || '<span style="font-size:0.75rem; color:#64748b;">No Expiry</span>'}
        </td>
        <td>
          <span style="font-weight:600;">${formatCurrency(costPrice, 'PKR')}</span><br>
          ${p.cost_price_foreign && p.currency && p.currency !== 'PKR' ? `<span style="font-size:0.72rem; color:var(--text-muted);">${p.currency} ${parseFloat(p.cost_price_foreign).toLocaleString()}</span>` : ''}
        </td>
        <td>
          <strong class="${isLoss ? 'loss-text' : ''}">${formatCurrency(sellingPrice, 'PKR')}</strong>
          ${isLoss ? `<br><span class="badge badge-loss" title="Loss detected: Selling Price is lower than Landed Cost Price!">⚠️ Loss: -${formatCurrency(lossAmt, 'PKR')} (-${lossPct}%)</span>` : ''}
        </td>
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
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="edit-btn" onclick="openEditProductModal('${p.id}')" title="Edit Item Details">✏️ Edit</button>
            <button class="danger-btn" style="background:#fee2e2; color:#b91c1c; border:1px solid #f87171; padding:4px 10px; font-weight:700; border-radius:4px; font-size:0.75rem; cursor:pointer;" onclick="deleteProductItem('${p.id}', '${encodeURIComponent(p.name)}')" title="Delete Item">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `;
  };

  // Group by client admin if Super Admin and viewing 'all'
  let tableBodyHTML = '';
  if (isSuper && selectedFilter === 'all' && clientAdmins.length > 0) {
    const groups = {};
    products.forEach(p => {
      const key = p.tenant_id || 'system';
      if (!groups[key]) {
        const admin = clientAdmins.find(ca => String(ca.tenant?.id || ca.tenant_id) === String(key));
        groups[key] = {
          adminName: p.client_admin_name || (admin ? (admin.full_name || admin.username) : 'System Primary'),
          orgName: p.tenant_name || (admin?.tenant?.company_name || admin?.tenant?.organization_name || 'System Default'),
          items: []
        };
      }
      groups[key].items.push(p);
    });

    if (products.length === 0) {
      tableBodyHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
            📦 <strong>No products or items in catalog yet.</strong>
          </td>
        </tr>
      `;
    } else {
      tableBodyHTML = Object.values(groups).map(g => `
        <tr style="background:#f1f5f9; border-top:2px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
          <td colspan="9" style="padding:10px 16px; font-weight:800; font-size:0.88rem; color:#0f172a;">
            👤 Client Admin: <span style="color:#2563eb;">${g.adminName}</span> | 🏢 Organization: <span style="color:#475569;">${g.orgName}</span>
            <span class="badge badge-sec-attached" style="margin-left:10px;">${g.items.length} Registered Items</span>
          </td>
        </tr>
        ${g.items.map(p => renderProductRow(p)).join('')}
      `).join('');
    }
  } else {
    tableBodyHTML = products.length === 0 ? `
      <tr>
        <td colspan="9" style="text-align:center; padding:36px 20px; color:#64748b;">
          📦 <strong>No products or items in catalog yet.</strong><br>
          <span style="font-size:0.85rem;">Click the <strong>+ Add Master Item</strong> button above to register your inventory items, electrical equipment, and SKUs.</span>
        </td>
      </tr>
    ` : products.map(p => renderProductRow(p)).join('');
  }

  return `
    <!-- Super Admin Client Filter Bar -->
    ${isSuper ? `
      <div class="card" style="background:linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%); border:1px solid #bae6fd; padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:1.6rem;">👑</span>
          <div>
            <div style="font-weight:800; color:#0369a1; font-size:0.95rem;">Super Admin View — Items Grouped by Client Admin</div>
            <div style="font-size:0.78rem; color:#0284c7;">Filter by Client Admin created by Super Admin or view consolidated registry</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:0.82rem; font-weight:700; color:#0f172a; white-space:nowrap;">Client Admin Filter:</label>
          <select class="form-select" style="font-size:0.82rem; font-weight:600; min-width:240px; border:1px solid #7dd3fc; background:#fff; padding:6px 10px; border-radius:6px;" onchange="setAdminClientFilter(this.value)">
            <option value="all" ${selectedFilter === 'all' ? 'selected' : ''}>🌐 All Client Admins (Grouped View)</option>
            ${clientAdmins.map(ca => {
              const cTid = ca.tenant?.id || ca.tenant_id;
              const orgName = ca.tenant?.company_name || ca.tenant?.organization_name || ca.tenant_name || 'Client Workspace';
              return `<option value="${cTid}" ${selectedFilter === cTid ? 'selected' : ''}>👤 ${ca.full_name || ca.username} (${orgName})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
    ` : ''}

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
              <th>Batch & Shelf Life Expiry</th>
              <th>Landed Cost Price</th>
              <th>Benchmark Selling Rate</th>
              <th>Current Stock</th>
              <th>Preferred Supplier</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tableBodyHTML}
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
  const isSuper = State.isSuperAdmin();
  const allowedLimit = (profiles[0] && profiles[0].free_business_profile_limit) ? parseInt(profiles[0].free_business_profile_limit, 10) : (State.currentUser?.tenant?.freeCompanyLimit || 2);

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0;">🏢 Companies & Business Profiles</h2>
        <p style="font-size:0.85rem; color:#64748b; margin:4px 0 0 0;">Manage your registered legal entities, NTN/STRN, and invoicing business units.</p>
      </div>
      <button class="primary-btn" onclick="openNewCompanyModal()">+ Add Company Profile</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🏢 Configured Companies (${profiles.length} Active Profiles)</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              ${isSuper ? '<th>Client Workspace</th>' : ''}
              <th>Business Name & Abbrev</th>
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
                <td colspan="${isSuper ? 9 : 8}" style="text-align:center; padding:36px 20px; color:#64748b;">
                  🏢 <strong>No business entities configured yet.</strong><br>
                  <span style="font-size:0.85rem;">Click the <strong>+ Add Company Profile</strong> button above to register your organization's first company profile.</span>
                </td>
              </tr>
            ` : profiles.map((p, idx) => `
              <tr>
                ${isSuper ? `<td><span class="badge" style="background:#f1f5f9; color:#475569; font-weight:600;">${p.tenant_company_name || 'Primary Workspace'}</span></td>` : ''}
                <td>
                  <strong>${p.business_name}</strong>
                  ${p.abbreviation ? `<span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:700; font-size:0.75rem; margin-left:6px;">${p.abbreviation}</span>` : ''}
                </td>
                <td>${p.legal_name || p.business_name}</td>
                <td><strong>${p.ntn || 'N/A'}</strong></td>
                <td>${p.strn || 'N/A'}</td>
                <td>${p.city || 'Lahore'}</td>
                <td><span class="badge ${p.fbr_enabled ? 'badge-fbr' : 'badge-withdraw'}">${p.fbr_enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                  ${idx < allowedLimit ? `<span class="badge badge-won">Plan Included</span>` : `<span class="badge badge-hold">Add-on (PKR 4,500/mo)</span>`}
                </td>
                <td>
                  <div style="display:flex; gap:6px;">
                    <button class="edit-btn" onclick="openEditCompanyModal('${p.id}')">✏️ Edit</button>
                    ${State.isSuperAdmin() ? `
                      <button class="delete-btn" style="padding:3px 8px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="handleDeleteCompany('${p.id}', '${encodeURIComponent(p.business_name)}')" title="Delete Company Profile">🗑️ Delete</button>
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

// --------------------------------------------------------------------------
// 16. USERS & RBAC VIEW
// --------------------------------------------------------------------------
// 16. USERS & RBAC VIEW
// --------------------------------------------------------------------------
async function renderUsersHTML() {
  const isSuper = State.isSuperAdmin();
  const res = await API.getUsersWithStats();
  const rawUsers = (res && res.data && res.data.length > 0) ? res.data : State.getStoredUsers();
  const currentTid = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
  const currentUserId = State.currentUser?.id;

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
    // SUPER ADMIN VIEW: 2 DEDICATED HIERARCHICAL GRIDS (Company Grid & User Grid)
    return `
      <!-- Super Admin Header & Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <span class="seat-counter-badge" style="background:#eff6ff; color:#1d4ed8; border-color:#93c5fd; font-size:0.9rem; padding:6px 14px;">
            👑 <strong>Super Admin Control Hub</strong> (Full Platform Management)
          </span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="primary-btn" onclick="openNewTenantModal()">
            🏢 + Provision New Client Admin &amp; Tenant
          </button>
          <button class="secondary-btn" onclick="openCreateUserModal('SuperAdmin')">
            👑 + Add System Super Admin
          </button>
        </div>
      </div>

      <!-- ========================================================= -->
      <!-- GRID 1: COMPANY GRID (Client Admin -> His Companies)     -->
      <!-- ========================================================= -->
      <div class="card" style="margin-bottom: 28px;">
        <div class="card-header" style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:14px 20px;">
          <div>
            <div class="card-title" style="font-size:1.05rem; font-weight:700; color:#0f172a;">
              🏢 1. Client Companies Grid (Grouped by Client Admin)
            </div>
            <span style="font-size:0.8rem; color:#64748b;">
              Lists each Client Admin created by Super Admin. Click <strong>➕ Expand</strong> to see companies registered under that Client Admin.
            </span>
          </div>
          <span class="badge badge-won" style="font-size:0.8rem;">${tenants.length} Client Admin Accounts</span>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="width: 45px;"></th>
                <th>Client Admin (Created by Super Admin)</th>
                <th>Client Organization</th>
                <th>Subdomain</th>
                <th>Plan Tier</th>
                <th>Companies</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${tenants.length === 0 ? `
                <tr>
                  <td colspan="8" style="text-align:center; padding:32px; color:#64748b;">
                    No Client Admins provisioned yet. Click <strong>+ Provision New Client Admin &amp; Tenant</strong> above.
                  </td>
                </tr>
              ` : tenants.map((t, idx) => {
                const tenantCompanies = t.companies || [];
                const clientAdmin = (t.tenant_users || []).find(u => u.role === 'ClientAdmin' || u.role === 'CompanyAdmin') || (t.tenant_users || [])[0];
                const adminName = clientAdmin ? (clientAdmin.full_name || clientAdmin.username) : (t.company_name || 'Client Admin');
                const adminUsername = clientAdmin?.username || '';
                const compExpId = `comp-grid-exp-${t.id || idx}`;

                return `
                  <tr style="background:#ffffff;">
                    <td>
                      <button class="secondary-btn" style="padding:2px 7px; font-size:0.75rem; font-weight:700; border-radius:4px; min-width:32px;" onclick="toggleTenantExpand('${compExpId}', this)" title="Expand / Collapse Companies">
                        ➕
                      </button>
                    </td>
                    <td>
                      <strong>${adminName}</strong>
                      ${adminUsername ? `<br><code style="font-size:0.75rem; color:#475569;">${adminUsername}</code>` : ''}
                    </td>
                    <td><span style="font-weight:600; color:#1e293b;">${t.company_name || t.name}</span></td>
                    <td><span class="pill-source">${t.subdomain || 'app'}.mashrue.com</span></td>
                    <td><span class="badge badge-won">${t.subscription_plan || 'Advance'}</span></td>
                    <td><span class="badge badge-sec-attached">${tenantCompanies.length} Registered</span></td>
                    <td><span class="badge ${t.status === 'Active' ? 'badge-won' : 'badge-withdraw'}">${t.status || 'Active'}</span></td>
                    <td>
                      <div style="display: flex; gap: 6px; align-items: center;">
                        <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="toggleTenantExpand('${compExpId}', this)">
                          🏢 View Companies (${tenantCompanies.length})
                        </button>
                        ${State.isSuperAdmin() && t.id !== 'a0000000-0000-0000-0000-000000000001' ? `
                          <button class="delete-btn" style="padding:4px 9px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="handleDeleteTenant('${t.id}', '${encodeURIComponent(t.company_name || t.name)}')" title="Permanently delete organization and all child data">
                            🗑️ Delete Org
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>

                  <!-- Collapsible Child Row: Companies under this Client Admin -->
                  <tr id="${compExpId}" style="display:none; background:#f8fafc;">
                    <td colspan="8" style="padding: 16px 20px; border-bottom: 2px solid #cbd5e1;">
                      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                          <div style="font-size: 0.92rem; font-weight: 700; color: #0f172a;">
                            🏢 Companies Registered under ${adminName} (${t.company_name || t.name})
                          </div>
                          <span style="font-size: 0.75rem; color: #64748b;">Super Admin has rights to delete companies</span>
                        </div>

                        ${tenantCompanies.length === 0 ? `
                          <div style="padding: 16px; font-size: 0.85rem; color: #64748b; background: #f8fafc; border-radius: 6px; text-align: center;">
                            🏢 No companies created by this Client Admin yet.
                          </div>
                        ` : `
                          <table class="data-table" style="font-size: 0.82rem; margin: 0;">
                            <thead>
                              <tr style="background: #f1f5f9;">
                                <th>Company / Business Name</th>
                                <th>Legal Name</th>
                                <th>NTN</th>
                                <th>STRN</th>
                                <th>City</th>
                                <th>FBR PRAL</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${tenantCompanies.map(c => `
                                <tr>
                                  <td><strong>${c.business_name}</strong></td>
                                  <td>${c.legal_name || c.business_name}</td>
                                  <td><code>${c.ntn || 'N/A'}</code></td>
                                  <td><code>${c.strn || 'N/A'}</code></td>
                                  <td>${c.city || 'Lahore'}</td>
                                  <td><span class="badge ${c.fbr_enabled ? 'badge-fbr' : 'badge-withdraw'}">${c.fbr_enabled ? 'Enabled' : 'Disabled'}</span></td>
                                  <td>
                                    <button class="delete-btn" style="padding:3px 8px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="handleDeleteCompany('${c.id}', '${encodeURIComponent(c.business_name)}')" title="Delete Company Profile">🗑️ Delete Company</button>
                                  </td>
                                </tr>
                              `).join('')}
                            </tbody>
                          </table>
                        `}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ========================================================= -->
      <!-- GRID 2: USER GRID (Client Admin -> Users He Created)      -->
      <!-- ========================================================= -->
      <div class="card">
        <div class="card-header" style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:14px 20px;">
          <div>
            <div class="card-title" style="font-size:1.05rem; font-weight:700; color:#0f172a;">
              👥 2. Client Users Grid (Grouped by Client Admin)
            </div>
            <span style="font-size:0.8rem; color:#64748b;">
              Lists each Client Admin created by Super Admin. Click <strong>➕ Expand</strong> to see sub-users and employees created under him.
            </span>
          </div>
          <span class="badge badge-sec-attached" style="font-size:0.8rem;">${userList.length} Total Users in System</span>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="width: 45px;"></th>
                <th>Client Admin (Created by Super Admin)</th>
                <th>Client Organization</th>
                <th>Admin Email</th>
                <th>Sub-Users Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tenants.length === 0 ? `
                <tr>
                  <td colspan="7" style="text-align:center; padding:32px; color:#64748b;">
                    No Client Admins provisioned yet.
                  </td>
                </tr>
              ` : tenants.map((t, idx) => {
                const tenantUsers = t.tenant_users || userList.filter(u => String(u.tenant_id) === String(t.id));
                const clientAdmin = tenantUsers.find(u => u.role === 'ClientAdmin' || u.role === 'CompanyAdmin') || tenantUsers[0];
                const adminName = clientAdmin ? (clientAdmin.full_name || clientAdmin.username) : (t.company_name || 'Client Admin');
                const adminUsername = clientAdmin?.username || '';
                const adminEmail = clientAdmin?.email || '—';
                const subUsers = tenantUsers.filter(u => !clientAdmin || String(u.id) !== String(clientAdmin.id));
                const userExpId = `user-grid-exp-${t.id || idx}`;

                return `
                  <tr style="background:#ffffff;">
                    <td>
                      <button class="secondary-btn" style="padding:2px 7px; font-size:0.75rem; font-weight:700; border-radius:4px; min-width:32px;" onclick="toggleTenantExpand('${userExpId}', this)" title="Expand / Collapse Users">
                        ➕
                      </button>
                    </td>
                    <td>
                      <strong>${adminName}</strong>
                      ${adminUsername ? `<br><code style="font-size:0.75rem; color:#475569;">${adminUsername}</code>` : ''}
                    </td>
                    <td><span style="font-weight:600; color:#1e293b;">${t.company_name || t.name}</span></td>
                    <td>${adminEmail}</td>
                    <td><span class="badge badge-sec-attached">${subUsers.length} Sub-Users</span></td>
                    <td><span class="badge ${clientAdmin?.status === 'Active' ? 'badge-won' : 'badge-withdraw'}">${clientAdmin?.status || 'Active'}</span></td>
                    <td>
                      <div style="display:flex; gap:6px;">
                        <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="toggleTenantExpand('${userExpId}', this)">
                          👥 View Users (${subUsers.length})
                        </button>
                        ${clientAdmin ? `
                          <button class="edit-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="openEditUserModal('${clientAdmin.id}')" title="Edit Admin">✏️</button>
                          <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="openResetPasswordModal('${clientAdmin.id}', '${clientAdmin.username}')" title="Reset Password">🔑</button>
                        ` : ''}
                        ${State.isSuperAdmin() && t.id !== 'a0000000-0000-0000-0000-000000000001' ? `
                          <button class="delete-btn" style="padding:4px 9px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="handleDeleteTenant('${t.id}', '${encodeURIComponent(t.company_name || t.name)}')" title="Permanently delete organization and all child data">
                            🗑️
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>

                  <!-- Collapsible Child Row: Users created by this Client Admin -->
                  <tr id="${userExpId}" style="display:none; background:#f8fafc;">
                    <td colspan="7" style="padding: 16px 20px; border-bottom: 2px solid #cbd5e1;">
                      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                          <div style="font-size: 0.92rem; font-weight: 700; color: #0f172a;">
                            👥 Sub-Users &amp; Employees Created by ${adminName} (${subUsers.length})
                          </div>
                        </div>

                        ${subUsers.length === 0 ? `
                          <div style="padding: 16px; font-size: 0.85rem; color: #64748b; background: #f8fafc; border-radius: 6px; text-align: center;">
                            👥 No sub-users / employees created by this Client Admin yet.
                          </div>
                        ` : `
                          <table class="data-table" style="font-size: 0.82rem; margin: 0;">
                            <thead>
                              <tr style="background: #f1f5f9;">
                                <th>Full Name</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Bidding Prices</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${subUsers.map(u => {
                                const canDelete = (String(u.id) !== String(currentUserId)) && (u.role !== 'SuperAdmin');
                                return `
                                  <tr>
                                    <td><strong>${u.full_name || u.username}</strong></td>
                                    <td><code>${u.username}</code></td>
                                    <td>${u.email || '<span style="color:#94a3b8; font-style:italic;">No email</span>'}</td>
                                    <td>
                                      <span class="badge ${u.role === 'ClientAdmin' ? 'badge-won' : 'badge-sec-attached'}">
                                        ${u.role}
                                      </span>
                                    </td>
                                    <td><span class="badge ${u.status === 'Active' ? 'badge-won' : 'badge-withdraw'}">${u.status || 'Active'}</span></td>
                                    <td>
                                      <span class="badge ${u.can_see_bidding_prices !== false ? 'badge-won' : 'badge-hold'}">
                                        ${u.can_see_bidding_prices !== false ? 'Visible' : 'Masked'}
                                      </span>
                                    </td>
                                    <td>
                                      <div style="display:flex; gap:4px;">
                                        <button class="edit-btn" style="padding:2px 6px; font-size:0.72rem;" onclick="openEditUserModal('${u.id}')">✏️ Edit</button>
                                        <button class="secondary-btn" style="padding:2px 6px; font-size:0.72rem;" onclick="openResetPasswordModal('${u.id}', '${u.username}')">🔑 Pass</button>
                                        ${canDelete ? `
                                          <button class="delete-btn" style="padding:2px 6px; font-size:0.72rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="deleteUserAction('${u.id}', '${u.full_name || u.username}')" title="Delete User">🗑️ Delete</button>
                                        ` : ''}
                                      </div>
                                    </td>
                                  </tr>
                                `;
                              }).join('')}
                            </tbody>
                          </table>
                        `}
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

  const freeSeatLimit = res?.seatStats?.freeLimit || State.currentUser?.tenant?.freeEmployeeLimit || 3;
  const totalOrgUsers = userList.length;
  const paidEmployeeSeats = Math.max(0, totalOrgUsers - freeSeatLimit);
  const additionalSeatFee = res?.seatStats?.additionalMonthlyFee || 1500.00;

  const companyCount = res?.seatStats?.companyCount !== undefined 
    ? res.seatStats.companyCount 
    : (State.businessProfiles?.length || 1);
  const freeCompanyLimit = res?.seatStats?.freeCompanyLimit || State.currentUser?.tenant?.freeCompanyLimit || 2;

  const isCurrentUserPrimaryAdmin = (typeof State.isPrimaryAdmin === 'function') 
    ? State.isPrimaryAdmin() 
    : ((typeof State.isCreatedBySuperAdmin === 'function') ? State.isCreatedBySuperAdmin() : false);
  const canAddUsers = isSuper || isCurrentUserPrimaryAdmin;

  // CLIENT ADMIN VIEW: Tenant Employee Management & Granular RBAC
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <span class="seat-counter-badge">
          👥 Users: <strong>${totalOrgUsers} / ${freeSeatLimit} Free Used</strong>
        </span>
        <span class="seat-counter-badge" style="background:#f0fdf4; color:#166534; border-color:#bbf7d0;">
          🏢 Companies: <strong>${companyCount} / ${freeCompanyLimit} Created</strong>
        </span>
        ${paidEmployeeSeats > 0 ? `
          <span class="badge badge-hold" style="padding: 5px 10px;">
            💰 ${paidEmployeeSeats} Paid Seat(s) active (+PKR ${(paidEmployeeSeats * additionalSeatFee).toLocaleString()}/mo)
          </span>
        ` : ''}
      </div>
      ${canAddUsers ? `
        <button class="primary-btn" onclick="openCreateUserModal('ClientEmployee')">
          👤 + Add Employee User
        </button>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">👥 Organization Users &amp; Access Control (${userList.length})</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role / Rights</th>
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
                  <span style="font-size:0.85rem;">Click the <strong>+ Add Employee User</strong> button above to invite your team members (${freeSeatLimit} Free Seats included).</span>
                </td>
              </tr>
            ` : userList.map(u => {
              const compAccessNames = (u.business_access && u.business_access.length > 0)
                ? u.business_access.map(b => b.name).join(', ')
                : 'All Assigned Companies';

              const roleBadge = (u.role === 'ClientAdmin' || u.role === 'CompanyAdmin')
                ? '<span class="badge badge-won">👑 Tenant Admin</span>'
                : (u.role === 'ReadOnly'
                  ? '<span class="badge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">👁️ Read-Only</span>'
                  : '<span class="badge badge-ready">⚙️ Configurable</span>');

              const fullNameDisplay = u.full_name || u.fullName || u.name || u.username || '—';
              const isSelf = String(u.id) === String(currentUserId);

              // Strict RBAC:
              // - Only the user created by Super Admin (or SuperAdmin) can edit other users
              // - He CANNOT edit himself
              // - Sub-users cannot edit any users or change passwords
              // - Primary Tenant Admin (e.g. Ahmed) can NEVER be edited, reset, or deleted by any user in the tenant
              const isTargetPrimaryAdmin = Boolean(u.is_primary_admin || u.isPrimaryAdmin || (u.role === 'ClientAdmin' && u.is_created_by_super_admin));
              const canEdit = !isSelf && (isSuper || (isCurrentUserPrimaryAdmin && !isTargetPrimaryAdmin));
              const canResetPass = !isSelf && (isSuper || (isCurrentUserPrimaryAdmin && !isTargetPrimaryAdmin));
              const canDelete = !isSelf && u.role !== 'SuperAdmin' && (isSuper || (isCurrentUserPrimaryAdmin && !isTargetPrimaryAdmin));
              const hasActions = canEdit || canResetPass || canDelete;

              return `
                <tr>
                  <td><strong>${fullNameDisplay}</strong></td>
                  <td><code>${u.username || '—'}</code></td>
                  <td>${u.email || '<span style="color:#94a3b8; font-style:italic;">No email</span>'}</td>
                  <td>${roleBadge}</td>
                  <td>
                    <span class="badge ${u.can_see_bidding_prices !== false ? 'badge-won' : 'badge-hold'}">
                      ${u.can_see_bidding_prices !== false ? '🔓 Visible' : '🔒 Masked (Hidden)'}
                    </span>
                  </td>
                  <td><span style="font-size: 0.82rem; color: #475569;">${compAccessNames}</span></td>
                  <td><span class="badge badge-active">${u.status || 'Active'}</span></td>
                  <td>
                    ${hasActions ? `
                      <div class="action-buttons-group">
                        ${canEdit ? `<button class="edit-btn" onclick="openEditUserModal('${u.id}')" title="Edit Screen Rights & Permissions">✏️ Edit</button>` : ''}
                        ${canResetPass ? `<button class="secondary-btn" style="padding:4px 8px; font-size:0.78rem;" onclick="openResetPasswordModal('${u.id}', '${fullNameDisplay}')" title="Reset Password">🔑 Pass</button>` : ''}
                        ${canDelete ? `
                          <button class="delete-btn" style="padding:4px 8px; font-size:0.78rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="deleteUserAction('${u.id}', '${fullNameDisplay}')" title="Delete User">🗑️ Delete</button>
                        ` : ''}
                      </div>
                    ` : (isTargetPrimaryAdmin ? `
                      <span class="badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.75rem; border:1px solid #bfdbfe;">👑 Primary Admin</span>
                    ` : `
                      <span class="badge" style="background:#f1f5f9; color:#64748b; font-size:0.75rem; border:1px solid #cbd5e1;">👁️ View Only</span>
                    `)}
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
// FBR PRAL DIGITAL INVOICING GATEWAY CONFIGURATION (COMPANY-BASED)
// --------------------------------------------------------------------------
let _selectedFbrCompanyId = null;

async function renderSettingsHTML() {
  const profiles = State.businessProfiles || [];

  if (profiles.length === 0) {
    return `
      <div class="card" style="text-align:center; padding:40px 20px;">
        <div style="font-size:3rem; margin-bottom:12px;">🏢</div>
        <h3 style="font-weight:700; color:#0f172a; margin-bottom:8px;">No Business Entities Configured</h3>
        <p style="color:#64748b; max-width:500px; margin:0 auto 20px auto; font-size:0.9rem;">
          To configure FBR PRAL Digital Invoicing, you must first register at least one company or business entity for your organization.
        </p>
        <div>
          <button class="primary-btn" onclick="openNewCompanyModal()">➕ + Register First Business Entity</button>
        </div>
      </div>
    `;
  }

  // Determine active company for FBR configuration
  if (!_selectedFbrCompanyId || !profiles.some(p => p.id === _selectedFbrCompanyId)) {
    _selectedFbrCompanyId = (State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all') 
      ? State.currentBusinessProfileId 
      : profiles[0].id;
  }

  const selectedCompany = profiles.find(p => p.id === _selectedFbrCompanyId) || profiles[0];
  const fbrData = (await API.getFbrSettings(selectedCompany.id)) || {};

  const isEnabled = (fbrData.fbr_enabled !== undefined) ? Boolean(fbrData.fbr_enabled) : Boolean(selectedCompany.fbr_enabled);
  const currentEnv = fbrData.environment || selectedCompany.fbr_environment || 'Sandbox';
  const sellerNtn = fbrData.sellerNtn || selectedCompany.fbr_seller_ntn || selectedCompany.ntn || '';
  const posId = fbrData.posId || selectedCompany.fbr_pos_id || 'POS-01';
  const bearerToken = fbrData.bearerToken || selectedCompany.fbr_bearer_token || '';

  const sandboxPostUrl = 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb';
  const prodPostUrl = 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata';
  const activeEndpoint = currentEnv === 'Production' ? prodPostUrl : sandboxPostUrl;

  return `
    <!-- Top Company Switcher Bar for FBR Settings -->
    <div class="card" style="margin-bottom: 20px; border-left: 4px solid #2563eb;">
      <div class="card-body" style="padding: 16px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
          <div>
            <div style="font-size:0.78rem; text-transform:uppercase; font-weight:700; color:#64748b; letter-spacing:0.5px;">Active Organization / Tenant Scope</div>
            <div style="font-size:1.1rem; font-weight:800; color:#0f172a;">🏢 Company-Specific FBR Digital Invoicing Configuration</div>
            <div style="font-size:0.82rem; color:#64748b; margin-top:2px;">Select a company from your organization below to configure its independent FBR PRAL Digital Invoicing credentials.</div>
          </div>
          <div style="min-width: 280px;">
            <label class="form-label" style="font-weight:700; font-size:0.8rem; margin-bottom:4px; color:#1e293b;">Select Company / Business Entity:</label>
            <select class="form-select" id="fbr-settings-company-select" style="font-weight:600; padding:8px 12px; border:2px solid #2563eb; background:#f8fafc;" onchange="onFbrSettingsCompanyChanged(this.value)">
              ${profiles.map(p => `
                <option value="${p.id}" ${p.id === selectedCompany.id ? 'selected' : ''}>
                  🏢 ${p.business_name} (${p.ntn || 'NTN Pending'}) ${p.fbr_enabled ? '✓ [FBR Active]' : ''}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Company Badge & Overview Strip -->
    <div class="card" style="margin-bottom: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);">
      <div class="card-body" style="padding: 14px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:42px; height:42px; border-radius:8px; background:#2563eb; color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:800;">
              ${(selectedCompany.abbreviation || selectedCompany.business_name || 'CO').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:800; font-size:1.05rem; color:#0f172a;">${selectedCompany.business_name}</div>
              <div style="font-size:0.8rem; color:#64748b;">
                <strong>Legal Name:</strong> ${selectedCompany.legal_name || selectedCompany.business_name} | 
                <strong>City:</strong> ${selectedCompany.city || 'Lahore'}
              </div>
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span class="badge badge-sec-attached" style="font-size:0.8rem; padding:5px 10px;">
              NTN: <strong>${selectedCompany.ntn || 'N/A'}</strong>
            </span>
            <span class="badge badge-sec-attached" style="font-size:0.8rem; padding:5px 10px;">
              STRN: <strong>${selectedCompany.strn || 'N/A'}</strong>
            </span>
            <span id="fbr-active-status-badge" class="badge ${isEnabled ? 'badge-won' : 'badge-withdraw'}" style="font-size:0.8rem; padding:5px 10px;">
              ${isEnabled ? '✓ FBR PRAL Enabled' : '⏸️ FBR Disabled'}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Configuration Card -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">⚙️ PRAL Digital Invoicing Gateway Parameters for ${selectedCompany.business_name}</div>
        <span style="font-size:0.8rem; color:#64748b;">PRAL Rule 2024 / S.R.O. 1525(I)/2023 Compliant</span>
      </div>
      <div class="card-body">
        <form id="form-fbr-settings" onsubmit="event.preventDefault(); saveFbrCompanySettings();">
          <input type="hidden" id="fbr-config-company-id" value="${selectedCompany.id}">

          <!-- Activation Toggle -->
          <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:14px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700; color:#1e40af; font-size:0.95rem;">Enable Automatic FBR Digital Invoicing</div>
              <div style="font-size:0.82rem; color:#3b82f6;">When enabled, newly finalized sales invoices for ${selectedCompany.business_name} will automatically transmit to PRAL with QR code generation.</div>
            </div>
            <div>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="fbr-enabled-toggle" ${isEnabled ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;">
                <span style="font-weight:700; font-size:0.9rem; color:#1e40af;">Active</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <!-- FBR Environment -->
            <div class="form-group">
              <label class="form-label" style="font-weight:700;">FBR Gateway Environment <span class="required">*</span></label>
              <select class="form-select" id="fbr-env-select" onchange="onFbrEnvChanged(this.value)">
                <option value="Sandbox" ${currentEnv === 'Sandbox' ? 'selected' : ''}>🧪 Sandbox (Testing & Validation Environment)</option>
                <option value="Production" ${currentEnv === 'Production' ? 'selected' : ''}>🚀 Production (Live Commercial Invoicing Gateway)</option>
              </select>
              <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">
                Endpoint: <code id="fbr-endpoint-display" style="color:#2563eb;">${activeEndpoint}</code>
              </div>
            </div>

            <!-- Seller NTN with STATL Verify -->
            <div class="form-group">
              <label class="form-label" style="font-weight:700;">Seller NTN (Registration Number) <span class="required">*</span></label>
              <div style="display:flex; gap:8px;">
                <input type="text" class="form-input" id="fbr-seller-ntn" value="${sellerNtn}" placeholder="e.g. 492019-1" style="font-weight:600;">
                <button type="button" class="secondary-btn" style="white-space:nowrap; padding:6px 12px;" onclick="verifyFbrTaxpayerStatl()">
                  🔍 STATL Check
                </button>
              </div>
              <div id="fbr-statl-result" style="font-size:0.78rem; margin-top:4px; display:none;"></div>
            </div>
          </div>

          <div class="form-row">
            <!-- POS ID / Station Identifier -->
            <div class="form-group">
              <label class="form-label" style="font-weight:700;">POS / Terminal Identifier</label>
              <input type="text" class="form-input" id="fbr-pos-id" value="${posId}" placeholder="e.g. POS-01 or HQ-BILLING-01">
              <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">Assigned by FBR e-invoicing portal or internal terminal code.</div>
            </div>

            <!-- PRAL Bearer Token -->
            <div class="form-group">
              <label class="form-label" style="font-weight:700;">PRAL Bearer Token / API Secret Key</label>
              <div style="display:flex; gap:8px;">
                <input type="password" class="form-input" id="fbr-bearer-token" value="${bearerToken}" placeholder="Enter PRAL Bearer Token..." style="font-family:monospace;">
                <button type="button" class="secondary-btn" style="padding:6px 12px;" onclick="toggleFbrTokenVisibility()">
                  👁️
                </button>
              </div>
              <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">Obtained from FBR e-Services portal for this NTN.</div>
            </div>
          </div>

          <!-- Connection Diagnostic Alert Box -->
          <div id="fbr-test-result-box" style="display:none; padding:12px 16px; border-radius:8px; margin-bottom:20px; font-size:0.88rem;"></div>

          <!-- Form Buttons -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:24px; padding-top:18px; border-top:1px solid #e2e8f0;">
            <button type="button" class="secondary-btn" id="btn-fbr-test-conn" onclick="testFbrGatewayConnection()" style="padding:9px 16px;">
              ⚡ Test Gateway Connection & Ping
            </button>
            <button type="submit" class="primary-btn" id="btn-fbr-save-config" style="padding:9px 22px; font-weight:700;">
              💾 Save Configuration for ${selectedCompany.business_name}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function onFbrSettingsCompanyChanged(companyId) {
  _selectedFbrCompanyId = companyId;
  const contentArea = document.getElementById('main-content');
  if (contentArea) {
    contentArea.innerHTML = await renderSettingsHTML();
  }
}

function onFbrEnvChanged(env) {
  const disp = document.getElementById('fbr-endpoint-display');
  if (disp) {
    disp.innerText = env === 'Production'
      ? 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata'
      : 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb';
  }
}

function toggleFbrTokenVisibility() {
  const input = document.getElementById('fbr-bearer-token');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

async function verifyFbrTaxpayerStatl() {
  const ntnInput = document.getElementById('fbr-seller-ntn');
  const resultBox = document.getElementById('fbr-statl-result');
  const ntn = ntnInput?.value?.trim();
  if (!ntn) {
    alert('Please enter Seller NTN to verify.');
    return;
  }

  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<span style="color:#2563eb;">⏳ Querying PRAL STATL register...</span>';
  }

  const res = await API.checkFbrTaxpayerStatus(ntn);
  if (res && res.success && res.data) {
    const d = res.data;
    resultBox.innerHTML = `
      <span style="color:#10b981; font-weight:700;">✓ STATL Status: ${d.STATUS || 'Active'}</span> | 
      <span style="color:#475569;">Type: ${d.REGISTRATION_TYPE || 'Registered'} (Reg: ${d.REGISTRATION_NO || ntn})</span>
    `;
  } else {
    resultBox.innerHTML = `<span style="color:#ef4444;">⚠️ Could not verify NTN: ${res.message || 'Check NTN format'}</span>`;
  }
}

async function testFbrGatewayConnection() {
  const env = document.getElementById('fbr-env-select')?.value || 'Sandbox';
  const token = document.getElementById('fbr-bearer-token')?.value?.trim();
  const ntn = document.getElementById('fbr-seller-ntn')?.value?.trim();
  const posId = document.getElementById('fbr-pos-id')?.value?.trim();
  const resultBox = document.getElementById('fbr-test-result-box');
  const testBtn = document.getElementById('btn-fbr-test-conn');

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = '<span>⏳ Pinging Gateway...</span>';
  }

  try {
    const res = await API.testFbrConnection({
      environment: env,
      bearer_token: token,
      seller_ntn: ntn,
      pos_id: posId
    });

    if (resultBox) {
      resultBox.style.display = 'block';
      if (res && res.success) {
        resultBox.style.background = '#f0fdf4';
        resultBox.style.border = '1px solid #86efac';
        resultBox.style.color = '#166534';
        resultBox.innerHTML = `
          <strong>${res.status || 'Connected'}:</strong> ${res.message}<br>
          <span style="font-size:0.78rem; opacity:0.85;">Ping latency: ${res.responseTimeMs || 90}ms | Endpoint: <code>${res.gatewayUrl}</code></span>
        `;
      } else {
        resultBox.style.background = '#fef2f2';
        resultBox.style.border = '1px solid #fca5a5';
        resultBox.style.color = '#991b1b';
        resultBox.innerHTML = `<strong>Gateway Warning:</strong> ${res.message || 'Connection test failed.'}`;
      }
    }
  } catch (e) {
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.style.background = '#fef2f2';
      resultBox.style.border = '1px solid #fca5a5';
      resultBox.style.color = '#991b1b';
      resultBox.innerHTML = `<strong>Error:</strong> ${e.message}`;
    }
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = '<span>⚡ Test Gateway Connection & Ping</span>';
    }
  }
}

async function saveFbrCompanySettings() {
  const compId = document.getElementById('fbr-config-company-id')?.value;
  const isEnabled = document.getElementById('fbr-enabled-toggle')?.checked;
  const env = document.getElementById('fbr-env-select')?.value || 'Sandbox';
  const ntn = document.getElementById('fbr-seller-ntn')?.value?.trim();
  const posId = document.getElementById('fbr-pos-id')?.value?.trim();
  const token = document.getElementById('fbr-bearer-token')?.value?.trim();
  const saveBtn = document.getElementById('btn-fbr-save-config');

  if (!compId) {
    alert('Error: No company selected.');
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>⏳ Saving Gateway Configuration...</span>';
  }

  try {
    const payload = {
      business_profile_id: compId,
      fbr_enabled: Boolean(isEnabled),
      environment: env,
      seller_ntn: ntn,
      pos_id: posId,
      bearer_token: token
    };

    const res = await API.saveFbrSettings(payload);
    if (res && res.success) {
      showToast(res.message || '✓ FBR PRAL Gateway settings saved successfully!', 'success');
      // Refresh business profiles in local state
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      const contentArea = document.getElementById('main-content');
      if (contentArea) {
        contentArea.innerHTML = await renderSettingsHTML();
      }
    } else {
      alert(`Failed to save settings: ${res?.message || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`Error saving FBR settings: ${e.message}`);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span>💾 Save Configuration</span>';
    }
  }
}

// --------------------------------------------------------------------------
// COSTING CALCULATOR & BID GOVERNANCE ENGINE
// --------------------------------------------------------------------------
let _selectedCostingOpportunity = null;

async function renderCostingCalculatorHTML() {
  if (!State.canSeeBiddingPrices()) {
    return `
      <div class="card" style="text-align: center; padding: 60px 24px; max-width: 580px; margin: 40px auto; border-top: 4px solid #f59e0b; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
        <div style="font-size: 3.5rem; margin-bottom: 12px;">🔒</div>
        <h3 style="font-size: 1.3rem; font-weight: 800; color: #1e293b; margin-bottom: 8px;">Commercial Pricing Restricted</h3>
        <p style="font-size: 0.9rem; color: #64748b; line-height: 1.6; margin-bottom: 24px;">
          Your account is configured with <strong>Price Visibility Masked</strong>.<br>
          Commercial pricing, supplier rates, costing markups, and bid estimation calculators are hidden from your role.
        </p>
        <button class="primary-btn" onclick="switchView('opportunities')" style="margin: 0 auto; padding: 10px 20px;">📑 Go to Tenders Pipeline</button>
      </div>
    `;
  }

  const customers = await API.getCustomers();
  const tenders = await API.getOpportunities(State.currentBusinessProfileId);

  return `
    <!-- Top Filter Bar: Customer Wise, Cascading Tender Wise, Date Range -->
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-body" style="padding: 14px 18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="font-weight:700; color:#0f172a; font-size:0.92rem; display:flex; align-items:center; gap:6px;">
            <span>🔍 Costing Filters:</span>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; flex:1; justify-content:flex-end;">
            <!-- Customer Filter -->
            <div style="min-width: 180px;">
              <select class="form-select" id="costing-filter-customer" style="font-size:0.8rem; padding:5px 8px;" onchange="onCostingCustomerChanged(this.value)">
                <option value="all">-- All Customers --</option>
                ${customers.map(c => `<option value="${c.id}">${c.business_name}</option>`).join('')}
              </select>
            </div>

            <!-- Cascading Tender Filter -->
            <div style="min-width: 220px;">
              <select class="form-select" id="costing-filter-tender" style="font-size:0.8rem; padding:5px 8px;" onchange="onCostingTenderChanged(this.value)">
                <option value="all">-- All Tenders & Quotations --</option>
                ${tenders.map(t => `<option value="${t.id}" data-customer="${t.customer_id || ''}" data-val="${t.estimated_value || 0}" data-closing="${t.closing_date || ''}">[${t.opportunity_number || 'TND'}] ${t.tender_name || t.title}</option>`).join('')}
              </select>
            </div>

            <!-- Date Range Filters -->
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:#64748b;">From:</span>
              <input type="date" class="form-input" id="costing-filter-from" style="font-size:0.8rem; padding:4px 6px;" onchange="filterCostingTendersByDate()">
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:#64748b;">To:</span>
              <input type="date" class="form-input" id="costing-filter-to" style="font-size:0.8rem; padding:4px 6px;" onchange="filterCostingTendersByDate()">
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Selected Tender Scope & Telemetry Card (Shown upon selection) -->
    <div id="costing-selected-tender-details" style="display:none; margin-bottom: 20px;"></div>

    <!-- Empty State Guide -->
    <div id="costing-empty-state" style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:var(--radius-md); padding:24px 20px; text-align:center; margin-bottom:20px;">
      <div style="font-size:1.8rem; margin-bottom:8px;">👈 📑</div>
      <strong style="font-size:0.95rem; color:#1e293b; display:block; margin-bottom:4px;">Please Select a Tender Above</strong>
      <span style="font-size:0.84rem; color:#64748b;">Choose an active tender or quotation from the dropdown above to load its commercial scope, itemized lines, and calculate landed direct costs & margins.</span>
    </div>

    <!-- Live Landed Price Warning Alert -->
    <div id="costing-loss-warning" style="display:none; background:#fef2f2; border:1px solid #f87171; color:#991b1b; border-radius:var(--radius-md); padding:12px 16px; margin-bottom:16px;">
      ⚠️ <strong>Loss Alert:</strong> Recommended Bid Submission Price is lower than Landed Direct Cost. Negative profit margin detected!
    </div>

    <div class="calc-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">💰 Direct Cost Breakdown</div>
          <span id="costing-tender-title-badge" class="badge badge-won" style="display:none;"></span>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Supplier / Product Cost (<span class="calc-currency-label">PKR</span>)</label>
            <input type="text" class="form-input cost-calc-input" id="calc-sup-cost" value="0" placeholder="0" oninput="formatCurrencyInput(this)">
          </div>
          <div class="form-group">
            <label class="form-label">Logistics & 3PL Freight (<span class="calc-currency-label">PKR</span>)</label>
            <input type="text" class="form-input cost-calc-input" id="calc-log-cost" value="0" placeholder="0" oninput="formatCurrencyInput(this)">
          </div>
          <div class="form-group">
            <label class="form-label">Labor & Site Commissioning (<span class="calc-currency-label">PKR</span>)</label>
            <input type="text" class="form-input cost-calc-input" id="calc-lab-cost" value="0" placeholder="0" oninput="formatCurrencyInput(this)">
          </div>
          <div class="form-group">
            <label class="form-label">Allocated Overhead (<span class="calc-currency-label">PKR</span>)</label>
            <input type="text" class="form-input cost-calc-input" id="calc-ovh-cost" value="0" placeholder="0" oninput="formatCurrencyInput(this)">
          </div>
          <div class="form-group">
            <label class="form-label">Tender Expenses & Bid Security (<span class="calc-currency-label">PKR</span>)</label>
            <input type="text" class="form-input cost-calc-input" id="calc-exp-cost" value="0" placeholder="0" oninput="formatCurrencyInput(this)">
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
            <span>Total Direct Landed Cost:</span>
            <strong id="disp-total-cost">PKR 0</strong>
          </div>
          <div class="calc-row">
            <span>Markup Rate:</span>
            <strong id="disp-markup-rate">18.5%</strong>
          </div>
          <div class="calc-row">
            <span>Projected Gross Profit:</span>
            <strong id="disp-profit-amt" style="color:#10b981;">PKR 0</strong>
          </div>
          <div class="calc-row">
            <span>Gross Profit Margin %:</span>
            <strong id="disp-margin-pct">15.6%</strong>
          </div>
        </div>

        <div class="calc-total-box">
          <span style="font-size:0.85rem; text-transform:uppercase; color:#94a3b8;">Recommended Bid Submission Price</span>
          <div class="calc-final-price" id="disp-final-bid-price">PKR 0</div>
        </div>

        <div style="margin-top: 14px;">
          <button type="button" class="primary-btn" style="width:100%; justify-content:center; padding:10px;" onclick="saveCostingSheetForSelectedTender()">
            💾 Save & Submit for Governance Approval
          </button>
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
  const sup = parseCurrency(document.getElementById('calc-sup-cost')?.value);
  const log = parseCurrency(document.getElementById('calc-log-cost')?.value);
  const lab = parseCurrency(document.getElementById('calc-lab-cost')?.value);
  const ovh = parseCurrency(document.getElementById('calc-ovh-cost')?.value);
  const exp = parseCurrency(document.getElementById('calc-exp-cost')?.value);
  const markup = parseFloat(document.getElementById('calc-markup-pct')?.value || 0);

  const totalCost = sup + log + lab + ovh + exp;
  const profit = (totalCost * markup) / 100;
  const finalPrice = totalCost + profit;
  const marginPct = finalPrice > 0 ? ((profit / finalPrice) * 100) : (markup < 0 ? markup : 0);
  const isLoss = profit < 0 || finalPrice < totalCost || markup < 0;

  const totalCostEl = document.getElementById('disp-total-cost');
  const markupRateEl = document.getElementById('disp-markup-rate');
  const profitAmtEl = document.getElementById('disp-profit-amt');
  const marginPctEl = document.getElementById('disp-margin-pct');
  const finalPriceEl = document.getElementById('disp-final-bid-price');

  if (totalCostEl) totalCostEl.innerText = formatCurrency(totalCost, 'PKR');
  if (markupRateEl) {
    markupRateEl.innerText = `${markup}%`;
    markupRateEl.className = markup < 0 ? 'loss-text' : '';
  }
  if (profitAmtEl) {
    if (isLoss) {
      profitAmtEl.innerText = `-PKR ${Math.abs(profit).toLocaleString()} (Loss)`;
      profitAmtEl.style.color = '#dc2626';
      profitAmtEl.style.fontWeight = '800';
    } else {
      profitAmtEl.innerText = formatCurrency(profit, 'PKR');
      profitAmtEl.style.color = '#10b981';
      profitAmtEl.style.fontWeight = '700';
    }
  }
  if (marginPctEl) {
    if (isLoss) {
      marginPctEl.innerText = `-${Math.abs(marginPct).toFixed(1)}% (Negative Margin)`;
      marginPctEl.style.color = '#dc2626';
      marginPctEl.style.fontWeight = '800';
    } else {
      marginPctEl.innerText = `${marginPct.toFixed(1)}%`;
      marginPctEl.style.color = '#0f172a';
      marginPctEl.style.fontWeight = '700';
    }
  }
  if (finalPriceEl) {
    finalPriceEl.innerText = formatCurrency(finalPrice, 'PKR');
    if (isLoss) {
      finalPriceEl.style.color = '#dc2626';
      finalPriceEl.style.borderColor = '#f87171';
    } else {
      finalPriceEl.style.color = '';
      finalPriceEl.style.borderColor = '';
    }
  }

  const warnEl = document.getElementById('costing-loss-warning');
  if (warnEl) {
    if (isLoss) {
      warnEl.className = 'loss-alert-box';
      warnEl.innerHTML = `⚠️ <strong>Loss Alert:</strong> Recommended Bid Submission Price (${formatCurrency(finalPrice, 'PKR')}) is lower than Landed Direct Cost (${formatCurrency(totalCost, 'PKR')}). Projected Loss: <span class="loss-text">-PKR ${Math.abs(profit).toLocaleString()} (-${Math.abs(marginPct).toFixed(1)}% margin)</span>!`;
      warnEl.style.display = 'flex';
    } else {
      warnEl.style.display = 'none';
    }
  }
}

function onCostingCustomerChanged(customerId) {
  const tenderSelect = document.getElementById('costing-filter-tender');
  if (!tenderSelect) return;
  const options = tenderSelect.querySelectorAll('option');

  options.forEach(opt => {
    if (opt.value === 'all') {
      opt.style.display = 'block';
      return;
    }
    const custId = opt.dataset.customer;
    if (customerId === 'all' || custId === customerId) {
      opt.style.display = 'block';
    } else {
      opt.style.display = 'none';
    }
  });

  tenderSelect.value = 'all';
  onCostingTenderChanged('all');
}

async function onCostingTenderChanged(tenderId) {
  const badge = document.getElementById('costing-tender-title-badge');
  const emptyState = document.getElementById('costing-empty-state');
  const detailsContainer = document.getElementById('costing-selected-tender-details');

  if (!tenderId || tenderId === 'all') {
    _selectedCostingOpportunity = null;
    if (badge) badge.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    if (detailsContainer) {
      detailsContainer.style.display = 'none';
      detailsContainer.innerHTML = '';
    }
    // Reset inputs
    ['calc-sup-cost', 'calc-log-cost', 'calc-lab-cost', 'calc-ovh-cost', 'calc-exp-cost'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '0';
    });
    const markupEl = document.getElementById('calc-markup-pct');
    if (markupEl) markupEl.value = '18.5';
    recalculateCostSheet();
    return;
  }

  // Fetch full opportunity with items, securities, etc.
  let target = null;
  try {
    const res = await API.getOpportunityById(tenderId);
    if (res && res.data) target = res.data;
  } catch (e) {}

  if (!target) {
    const opps = await API.getOpportunities(State.currentBusinessProfileId || 'all');
    target = opps.find(o => String(o.id) === String(tenderId));
  }

  if (!target) {
    const allOpps = await API.getOpportunities('all');
    target = allOpps.find(o => String(o.id) === String(tenderId));
  }

  if (!target) {
    showToast('Tender details could not be retrieved', 'warning');
    return;
  }

  _selectedCostingOpportunity = target;

  if (badge) {
    badge.innerText = `Selected: [${target.opportunity_number || 'TND'}] ${target.tender_name || target.title}`;
    badge.style.display = 'inline-block';
  }
  if (emptyState) emptyState.style.display = 'none';

  // Update currency labels
  const currency = target.currency || 'PKR';
  document.querySelectorAll('.calc-currency-label').forEach(el => el.innerText = currency);

  // Retrieve customer name, business profile name
  let customerName = target.customer_name || '';
  let profileName = target.business_name || '';
  try {
    const [customers, profiles] = await Promise.all([
      API.getCustomers(),
      API.getBusinessProfiles()
    ]);
    const cust = customers.find(c => String(c.id) === String(target.customer_id));
    const prof = profiles.find(p => String(p.id) === String(target.business_profile_id));
    if (cust) customerName = cust.business_name;
    if (prof) profileName = prof.business_name;
  } catch (e) {}
  if (!customerName) customerName = target.customer_name || 'Customer Organization';
  if (!profileName) profileName = target.business_name || 'Submitting Entity';

  // Check for saved costing (bids)
  let savedCosting = null;
  try {
    const bids = await API.getBids(State.currentBusinessProfileId || 'all', target.id);
    if (Array.isArray(bids) && bids.length > 0) {
      savedCosting = bids[0];
    }
  } catch (e) {}

  // Check for bid securities
  let securities = [];
  try {
    securities = (await API.getBidSecurities(State.currentBusinessProfileId || 'all', target.id)) || [];
  } catch (e) {}
  const activeSec = securities.find(s => s.status === 'Active' || s.status === 'Submitted') || securities[0];
  const secAmount = activeSec ? parseFloat(activeSec.amount || 0) : 0;

  // Retrieve line items
  const items = target.items || target.tender_items || [];
  const itemsTotalSum = items.reduce((sum, itm) => {
    const qty = parseFloat(itm.quantity || 1);
    const up = parseFloat(itm.estimated_unit_price || itm.unit_price || 0);
    return sum + (parseFloat(itm.estimated_total_price || (qty * up)) || 0);
  }, 0);

  const estVal = parseFloat(target.estimated_value || itemsTotalSum || 0);

  // Render Selected Tender Scope & Telemetry Card
  if (detailsContainer) {
    detailsContainer.style.display = 'block';
    detailsContainer.innerHTML = `
      <div class="card" style="border: 1px solid #93c5fd; background: linear-gradient(to bottom, #ffffff, #f0f7ff); box-shadow: 0 4px 15px -3px rgba(59, 130, 246, 0.08); margin-bottom: 20px;">
        <div class="card-header" style="background: rgba(239, 246, 255, 0.6); padding: 12px 18px; border-bottom: 1px solid #dbeafe; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.4rem;">📑</span>
            <div>
              <div style="font-size: 1.05rem; font-weight: 800; color: #1e3a8a;">
                ${target.opportunity_number ? `[${target.opportunity_number}] ` : ''}${target.tender_name || target.title}
              </div>
              <div style="font-size: 0.78rem; color: #475569; display:flex; gap:12px; flex-wrap:wrap; margin-top:2px;">
                <span><strong>Customer:</strong> ${customerName}</span>
                <span>•</span>
                <span><strong>Submitting Entity:</strong> ${profileName}</span>
                <span>•</span>
                <span><strong>Source:</strong> ${target.tender_source || 'PPRA'}</span>
                ${target.external_tender_number ? `<span>•</span><span><strong>Ref:</strong> ${target.external_tender_number}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge badge-${(target.status || 'new').toLowerCase().replace(/\s+/g, '')}" style="font-size:0.8rem; padding:4px 10px;">
              ${target.status || 'New'}
            </span>
            ${savedCosting ? `
              <span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #86efac; font-size:0.75rem; padding:4px 8px; font-weight:700;">
                ✓ Saved Costing Loaded (${savedCosting.bid_number || 'Sheet'})
              </span>
            ` : `
              <span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:0.75rem; padding:4px 8px; font-weight:600;">
                ✨ New Costing Estimation
              </span>
            `}
          </div>
        </div>

        <div class="card-body" style="padding: 16px 18px;">
          <!-- Telemetry Chips -->
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px;">
            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.72rem; text-transform:uppercase; color:#64748b; font-weight:700;">Estimated Tender Value</div>
              <div style="font-size:1.1rem; font-weight:800; color:#0f172a; margin-top:2px;">
                ${currency} ${estVal.toLocaleString()}
              </div>
            </div>

            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.72rem; text-transform:uppercase; color:#64748b; font-weight:700;">Submission Deadline</div>
              <div style="font-size:0.92rem; font-weight:700; color:#1e293b; margin-top:3px;">
                📅 ${formatDateDDMMYYYY(target.closing_date)}
              </div>
            </div>

            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.72rem; text-transform:uppercase; color:#64748b; font-weight:700;">Bid Security / CDR</div>
              <div style="font-size:0.92rem; font-weight:700; color:${secAmount > 0 ? '#0284c7' : '#64748b'}; margin-top:3px;">
                🛡️ ${secAmount > 0 ? `${currency} ${secAmount.toLocaleString()} (${activeSec.bank_name || 'Bank CDR'})` : 'No CDR Attached'}
              </div>
            </div>

            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.72rem; text-transform:uppercase; color:#64748b; font-weight:700;">Scope Breakdown</div>
              <div style="font-size:0.92rem; font-weight:700; color:#0f172a; margin-top:3px;">
                📦 ${items.length > 0 ? `${items.length} Scope Line Item(s)` : 'Lump Sum Scope'}
              </div>
            </div>
          </div>

          <!-- Itemized Scope Table -->
          ${items.length > 0 ? `
            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
              <div style="padding:8px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.82rem; font-weight:700; color:#334155;">📦 Tender Scope & Technical Items (${items.length}):</span>
                <span style="font-size:0.78rem; color:#64748b;">Items Total: <strong>${currency} ${itemsTotalSum.toLocaleString()}</strong></span>
              </div>
              <div class="table-responsive" style="max-height: 200px; overflow-y: auto;">
                <table class="data-table" style="font-size:0.8rem; margin-bottom:0;">
                  <thead>
                    <tr style="background:#f8fafc;">
                      <th style="width:40px;">#</th>
                      <th>Item Scope / Description</th>
                      <th>Specification / Size</th>
                      <th style="text-align:right;">Quantity</th>
                      <th>Unit</th>
                      <th style="text-align:right;">Est. Unit Price</th>
                      <th style="text-align:right;">Total (${currency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map((itm, idx) => {
                      const q = parseFloat(itm.quantity || 1);
                      const up = parseFloat(itm.estimated_unit_price || itm.unit_price || 0);
                      const tot = parseFloat(itm.estimated_total_price || (q * up)) || 0;
                      return `
                        <tr>
                          <td style="color:#64748b;">${idx + 1}</td>
                          <td><strong>${itm.item_name || itm.item_description || 'Scope Item'}</strong></td>
                          <td style="color:#64748b;">${itm.item_size || itm.size || itm.specifications || '-'}</td>
                          <td style="text-align:right; font-weight:600;">${q.toLocaleString()}</td>
                          <td>${itm.unit || 'PCS'}</td>
                          <td style="text-align:right;">${up > 0 ? up.toLocaleString() : '-'}</td>
                          <td style="text-align:right; font-weight:700;">${tot > 0 ? tot.toLocaleString() : '-'}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : `
            <div style="font-size:0.82rem; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px;">
              ℹ️ Lump-sum tender opportunity: <strong>${target.tender_name || target.title}</strong> (Est. Value: ${currency} ${estVal.toLocaleString()})
            </div>
          `}
        </div>
      </div>
    `;
  }

  // Populate Direct Cost Breakdown inputs
  const supEl = document.getElementById('calc-sup-cost');
  const logEl = document.getElementById('calc-log-cost');
  const labEl = document.getElementById('calc-lab-cost');
  const ovhEl = document.getElementById('calc-ovh-cost');
  const expEl = document.getElementById('calc-exp-cost');
  const markupEl = document.getElementById('calc-markup-pct');

  if (savedCosting) {
    if (supEl) supEl.value = Math.round(parseFloat(savedCosting.supplier_cost_total || 0)).toLocaleString();
    if (logEl) logEl.value = Math.round(parseFloat(savedCosting.logistics_cost_total || 0)).toLocaleString();
    if (labEl) labEl.value = Math.round(parseFloat(savedCosting.labor_cost_total || 0)).toLocaleString();
    if (ovhEl) ovhEl.value = Math.round(parseFloat(savedCosting.overhead_cost_total || 0)).toLocaleString();
    if (expEl) expEl.value = Math.round(parseFloat(savedCosting.tender_expense_total || 0)).toLocaleString();
    if (markupEl) markupEl.value = parseFloat(savedCosting.desired_markup_pct || 18.5);
  } else {
    // Determine supplier cost: use items total if available, otherwise 70% of estimated value
    const calculatedSupCost = itemsTotalSum > 0 ? itemsTotalSum : Math.round(estVal * 0.70);
    const calculatedExp = (secAmount > 0 ? secAmount : Math.round(estVal * 0.02));

    if (supEl) supEl.value = calculatedSupCost.toLocaleString();
    if (logEl) logEl.value = Math.round(estVal * 0.06).toLocaleString();
    if (labEl) labEl.value = Math.round(estVal * 0.05).toLocaleString();
    if (ovhEl) ovhEl.value = Math.round(estVal * 0.03).toLocaleString();
    if (expEl) expEl.value = calculatedExp.toLocaleString();
    if (markupEl) markupEl.value = '18.5';
  }

  recalculateCostSheet();
  showToast(`✓ Loaded data for ${target.opportunity_number || 'Tender'} (${currency} ${estVal.toLocaleString()})`, 'info');
}

function filterCostingTendersByDate() {
  const fromDate = document.getElementById('costing-filter-from')?.value;
  const toDate = document.getElementById('costing-filter-to')?.value;
  const tenderSelect = document.getElementById('costing-filter-tender');
  if (!tenderSelect) return;

  const options = tenderSelect.querySelectorAll('option');
  options.forEach(opt => {
    if (opt.value === 'all') return;
    const closing = opt.dataset.closing;
    if (!closing) return;
    const d = new Date(closing);
    let match = true;
    if (fromDate && d < new Date(fromDate)) match = false;
    if (toDate && d > new Date(toDate + 'T23:59:59')) match = false;
    opt.style.display = match ? 'block' : 'none';
  });
}

async function saveCostingSheetForSelectedTender() {
  const sup = parseCurrency(document.getElementById('calc-sup-cost')?.value);
  const log = parseCurrency(document.getElementById('calc-log-cost')?.value);
  const lab = parseCurrency(document.getElementById('calc-lab-cost')?.value);
  const ovh = parseCurrency(document.getElementById('calc-ovh-cost')?.value);
  const exp = parseCurrency(document.getElementById('calc-exp-cost')?.value);
  const markup = parseFloat(document.getElementById('calc-markup-pct')?.value || 0);

  const oppId = _selectedCostingOpportunity?.id || (document.getElementById('costing-filter-tender')?.value !== 'all' ? document.getElementById('costing-filter-tender')?.value : null);
  const oppTitle = _selectedCostingOpportunity?.tender_name || _selectedCostingOpportunity?.title || 'Tender Project';
  const oppNumber = _selectedCostingOpportunity?.opportunity_number || 'TND-2026';

  const payload = {
    opportunity_id: oppId,
    business_profile_id: State.currentBusinessProfileId !== 'all' ? State.currentBusinessProfileId : (_selectedCostingOpportunity?.business_profile_id || null),
    bid_number: `BID-${Date.now().toString().slice(-6)}`,
    tender_name: oppTitle,
    opportunity_title: oppTitle,
    opportunity_number: oppNumber,
    supplier_cost_total: sup,
    logistics_cost_total: log,
    labor_cost_total: lab,
    overhead_cost_total: ovh,
    tender_expense_total: exp,
    desired_markup_pct: markup,
    approval_status: 'Pending Review'
  };

  const res = await API.saveCosting(payload);
  if (!res || !res.success) {
    alert(`⚠️ Failed to save costing: ${res?.message || 'Database error. Record was NOT saved.'}`);
    return;
  }
  showToast('✓ Costing sheet saved & submitted for Bid Governance Review!', 'success');
  switchView('approvals');
}

// --------------------------------------------------------------------------
// 15. BID GOVERNANCE & APPROVALS VIEW
// --------------------------------------------------------------------------
async function renderApprovalsHTML() {
  const bids = await API.getBids(State.currentBusinessProfileId);
  const opps = await API.getOpportunities(State.currentBusinessProfileId);

  // Merge any submitted opportunities into bids list if a bid entry isn't already created
  for (const opp of opps) {
    if (opp.status === 'Submitted' || opp.selection_status === 'Selected' || opp.status === 'Ready to submit') {
      const existing = bids.find(b => b.opportunity_id === opp.id || b.id === opp.id);
      if (!existing) {
        bids.push({
          id: opp.id,
          opportunity_id: opp.id,
          bid_number: 'BID-' + (opp.opportunity_number || opp.id.slice(0, 6)),
          tender_name: opp.tender_name || opp.title,
          opportunity_number: opp.opportunity_number,
          supplier_cost_total: parseFloat(opp.estimated_value || 0),
          final_bid_price: parseFloat(opp.estimated_value || 0),
          desired_markup_pct: 20,
          gross_margin_pct: 20,
          approval_status: opp.status === 'Submitted' ? 'Submitted' : 'Pending Review'
        });
      }
    }
  }

  const isSuper = State.isSuperAdmin();
  const isAdmin = State.isClientAdmin();

  const submitted = bids.filter(b => !b.approval_status || b.approval_status === 'Submitted' || b.approval_status === 'Pending Review' || b.approval_status === 'Under Management Review');
  const wonBids = bids.filter(b => b.approval_status === 'Won' || b.approval_status === 'won' || b.approval_status === 'Approved');
  const lostBids = bids.filter(b => b.approval_status === 'Loose' || b.approval_status === 'loose' || b.approval_status === 'Lost' || b.approval_status === 'Rejected');
  const withdrawnBids = bids.filter(b => b.approval_status === 'Withdraw' || b.approval_status === 'withdraw' || b.approval_status === 'Withdrawn');

  return `
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom:20px;">
      <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
        <div class="kpi-title">Submitted / In Review</div>
        <div class="kpi-value">${submitted.length}</div>
        <div class="kpi-subtext">Awaiting tender outcome</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #10b981;">
        <div class="kpi-title">🏆 Won / Awarded</div>
        <div class="kpi-value">${wonBids.length}</div>
        <div class="kpi-subtext">LOA issued / Ready for PO</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #ef4444;">
        <div class="kpi-title">❌ Lost Bids (Loose)</div>
        <div class="kpi-value">${lostBids.length}</div>
        <div class="kpi-subtext">L1 competitor capture</div>
      </div>
      <div class="kpi-card" style="border-left: 4px solid #64748b;">
        <div class="kpi-title">⚠️ Withdrawn Bids</div>
        <div class="kpi-value">${withdrawnBids.length}</div>
        <div class="kpi-subtext">Withdrawn from bidding</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">⚖️ Commercial Bid Governance & Approval Hub (Won / Loose / Withdraw)</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">
          Authority: <strong>${isSuper ? 'Super Admin' : (isAdmin ? 'Client Administrator (Sign-off Authority)' : 'Bid Manager')}</strong>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Bid & Tender Ref #</th>
              <th>Total Direct Cost</th>
              <th>Markup %</th>
              <th>Final Submission Price</th>
              <th>Gross Margin %</th>
              <th>Outcome Status</th>
              <th>Governance Actions</th>
            </tr>
          </thead>
          <tbody>
            ${bids.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:36px 20px; color:#64748b;">
                  ⚖️ <strong>No bids currently submitted for governance approval.</strong><br>
                  <span style="font-size:0.85rem;">Submit a tender in the <strong>Tenders & Quotations</strong> module or save a costing sheet to initiate a bid review workflow.</span>
                </td>
              </tr>
            ` : bids.map(b => {
              const rawStatus = b.approval_status || 'Submitted';
              let normStatus = 'Submitted';
              let badgeColor = '#d97706';
              let borderColor = '#f59e0b';
              let bgPill = '#fef3c7';

              if (rawStatus === 'Won' || rawStatus === 'won' || rawStatus === 'Approved') {
                normStatus = 'Won';
                badgeColor = '#059669';
                borderColor = '#10b981';
                bgPill = '#ecfdf5';
              } else if (rawStatus === 'Loose' || rawStatus === 'loose' || rawStatus === 'Lost' || rawStatus === 'Rejected') {
                normStatus = 'Loose';
                badgeColor = '#dc2626';
                borderColor = '#ef4444';
                bgPill = '#fef2f2';
              } else if (rawStatus === 'Withdraw' || rawStatus === 'withdraw' || rawStatus === 'Withdrawn') {
                normStatus = 'Withdraw';
                badgeColor = '#475569';
                borderColor = '#64748b';
                bgPill = '#f1f5f9';
              }

              const oppId = b.opportunity_id || b.id;
              const tenderTitle = (b.tender_name || b.opportunity_title || 'Tender Project');
              const encodedTitle = encodeURIComponent(tenderTitle);

              const directCost = (parseFloat(b.supplier_cost_total || 0) + parseFloat(b.logistics_cost_total || 0) + parseFloat(b.labor_cost_total || 0) + parseFloat(b.overhead_cost_total || 0) + parseFloat(b.tender_expense_total || 0));
              const markup = parseFloat(b.desired_markup_pct || 20);
              const finalPrice = parseFloat(b.final_bid_price || (directCost + (directCost * markup / 100)));
              const grossMargin = parseFloat(b.gross_margin_pct || (finalPrice > 0 ? ((finalPrice - directCost) / finalPrice * 100) : (markup < 0 ? markup : 0)));
              const isBidLoss = (finalPrice < directCost || grossMargin < 0 || markup < 0);
              const lossVal = directCost - finalPrice;

              return `
                <tr class="${isBidLoss ? 'loss-row' : ''}">
                  <td>
                    <strong>${b.bid_number || 'BID-' + b.id}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${tenderTitle} (${b.opportunity_number || ''})</span>
                  </td>
                  <td>${formatCurrency(directCost, 'PKR')}</td>
                  <td><strong class="${markup < 0 ? 'loss-text' : ''}">${markup}%</strong></td>
                  <td>
                    <strong class="${isBidLoss ? 'loss-text' : ''}" style="color:${isBidLoss ? '#dc2626' : '#0f172a'};">${formatCurrency(finalPrice, 'PKR')}</strong>
                    ${isBidLoss ? `<br><span class="badge badge-loss" style="font-size:0.68rem; margin-top:2px;">⚠️ Loss: -${formatCurrency(lossVal, 'PKR')}</span>` : ''}
                  </td>
                  <td>
                    <span class="badge ${isBidLoss ? 'badge-loss' : (grossMargin >= 15 ? 'badge-won' : 'badge-hold')}">
                      ${isBidLoss ? '⚠️ ' : ''}${grossMargin.toFixed(1)}%
                    </span>
                  </td>
                  <td>
                    <select class="form-select" style="font-size:0.78rem; padding:4px 8px; border-radius:4px; font-weight:700; width:auto; display:inline-block; border-color:${borderColor}; color:${badgeColor}; background:${bgPill};" onchange="handleUpdateBidApprovalStatus('${b.id}', '${oppId}', this.value, '${encodedTitle}', ${finalPrice})">
                      <option value="Submitted" ${normStatus === 'Submitted' ? 'selected' : ''}>⏳ Submitted</option>
                      <option value="Won" ${normStatus === 'Won' ? 'selected' : ''}>🏆 Won (+ LOA)</option>
                      <option value="Loose" ${normStatus === 'Loose' ? 'selected' : ''}>❌ Loose</option>
                      <option value="Withdraw" ${normStatus === 'Withdraw' ? 'selected' : ''}>⚠️ Withdraw</option>
                    </select>
                  </td>
                  <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                      ${normStatus !== 'Won' ? `
                        <button type="button" class="primary-btn" style="padding:3px 8px; font-size:0.75rem; background:#059669; font-weight:700;" onclick="promptWonBid('${oppId}', '${encodedTitle}')" title="Record Letter of Award (LOA) with Partial/Full Item Scope">
                          🏆 Won (+ LOA)
                        </button>
                      ` : `
                        <span class="badge badge-won" style="font-size:0.75rem; padding:3px 6px;">✓ Awarded LOA</span>
                      `}
                      ${normStatus !== 'Loose' ? `
                        <button type="button" class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#fef2f2; color:#dc2626;" onclick="promptTenderLossModal('${oppId}', '${encodedTitle}', ${finalPrice})" title="Record Tender Loss & Benchmark">
                          ❌ Loose
                        </button>
                      ` : ''}
                      ${normStatus !== 'Withdraw' ? `
                        <button type="button" class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#f8fafc; color:#475569;" onclick="handleWithdrawBidAction('${oppId}', '${encodedTitle}')" title="Withdraw Bid">
                          ⚠️ Withdraw
                        </button>
                      ` : ''}
                      ${oppId ? `<button type="button" class="secondary-btn" style="padding:3px 7px; font-size:0.75rem;" onclick="openTender360Cockpit('${oppId}')" title="View 360 Cockpit">🌐 Cockpit</button>` : ''}
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

async function handleUpdateBidApprovalStatus(bidId, oppId, newStatus, encodedTitle, estVal) {
  if (newStatus === 'Won' || newStatus === 'won') {
    promptWonBid(oppId || bidId, encodedTitle);
    return;
  } else if (newStatus === 'Loose' || newStatus === 'loose') {
    promptTenderLossModal(oppId || bidId, encodedTitle, estVal || 0);
    return;
  } else if (newStatus === 'Withdraw' || newStatus === 'withdraw') {
    await handleWithdrawBidAction(oppId || bidId, encodedTitle);
    return;
  } else {
    try {
      await API.updateBidStatus(bidId, newStatus);
      showToast(`Bid status set to ${newStatus}.`, 'info');
      await renderActiveView();
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  }
}

async function handleWithdrawBidAction(oppId, encodedTitle) {
  const tName = decodeURIComponent(encodedTitle || 'Tender');
  const reason = prompt(`Enter reason for withdrawing bid on '${tName}':`, 'Commercial withdrawal / customer specification revised.');
  if (reason !== null) {
    try {
      await API.evaluateBid(oppId, { evaluation_status: 'withdraw', loss_reason: reason, remarks: reason });
      showToast(`✓ Bid on '${tName}' marked as Withdrawn.`, 'warning');
      await renderActiveView();
    } catch (err) {
      alert(`Failed to withdraw bid: ${err.message}`);
    }
  }
}

// --------------------------------------------------------------------------
// IN-PLACE QUICK-ADD & MODAL STACKING ENGINE
// --------------------------------------------------------------------------

let _quickAddContext = null;
let _quickAddContextStack = [];
window._quickAddContextStack = _quickAddContextStack;

function openQuickAddModal(entityType, targetSelectId) {
  const ctx = {
    entityType,
    targetSelectId
  };
  _quickAddContext = ctx;
  _quickAddContextStack.push(ctx);

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
      openNewCompanyModal();
      break;
    default:
      console.warn('Unknown quick add entity type:', entityType);
      return;
  }

  const modalEl = document.getElementById(modalId);
  if (modalEl) {
    modalEl.classList.add('modal-nested');
    modalEl.classList.add('open');
    if (!_modalStack.includes(modalId)) {
      _modalStack.push(modalId);
    }
    const depth = _modalStack.indexOf(modalId) + 1;
    modalEl.style.zIndex = 1100 + (depth * 50);
  }
}
window.openQuickAddModal = openQuickAddModal;

async function handleQuickAddCompletion(entityType, createdItem) {
  if (!createdItem) return;

  // Retrieve and pop matching context from stack to preserve parent quick-add contexts
  let ctx = null;
  const ctxIdx = _quickAddContextStack.findLastIndex 
    ? _quickAddContextStack.findLastIndex(c => c.entityType === entityType || (entityType === 'product' && c.entityType === 'item')) 
    : -1;
  if (ctxIdx !== -1) {
    ctx = _quickAddContextStack.splice(ctxIdx, 1)[0];
  } else if (_quickAddContextStack.length > 0) {
    ctx = _quickAddContextStack.pop();
  } else {
    ctx = _quickAddContext;
  }
  _quickAddContext = _quickAddContextStack.length > 0 
    ? _quickAddContextStack[_quickAddContextStack.length - 1] 
    : ctx;

  const targetSelectId = ctx?.targetSelectId;
  const targetSelect = targetSelectId ? document.getElementById(targetSelectId) : null;

  // 1. Refresh all matching customer select dropdowns in DOM
  if (entityType === 'customer') {
    let customers = [];
    try {
      customers = await API.getCustomers();
    } catch (e) {
      console.warn('handleQuickAddCompletion getCustomers error:', e);
    }
    if (!Array.isArray(customers)) customers = [];

    if (createdItem && createdItem.id) {
      const idx = customers.findIndex(c => String(c.id) === String(createdItem.id));
      if (idx >= 0) {
        customers[idx] = { ...customers[idx], ...createdItem };
      } else {
        customers.unshift(createdItem);
      }
    }
    State.customers = customers;

    const allSelects = document.querySelectorAll('select[id*="customer"], select#tender-customer');
    allSelects.forEach(sel => {
      const isTarget = (sel.id === targetSelectId || sel.id === 'tender-customer');
      const curVal = isTarget ? createdItem.id : (sel.value || '');

      sel.innerHTML = `<option value="">-- Select Customer / Department --</option>` + 
        customers.map(c => {
          const cName = c.business_name || c.name || 'Registered Customer';
          const cType = c.customer_type || c.org_type || 'Customer';
          const isSel = (String(c.id) === String(curVal)) ? 'selected' : '';
          return `<option value="${c.id}" ${isSel}>${cName} (${cType})</option>`;
        }).join('');

      if (curVal) sel.value = curVal;
    });

    const tenderCustSelect = document.getElementById('tender-customer');
    if (tenderCustSelect && createdItem && createdItem.id) {
      tenderCustSelect.value = createdItem.id;
      tenderCustSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (entityType === 'supplier') {
    const suppliers = await API.getSuppliers();
    State.suppliers = suppliers;
    document.querySelectorAll('select[id*="supplier"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = `<option value="">-- Select Preferred Supplier --</option>` + suppliers.map(s => `<option value="${s.id}">${s.supplier_name} (${s.country || 'Pakistan'})</option>`).join('');
      if (curVal) sel.value = curVal;
    });

    const prodSup = document.getElementById('prod-supplier-select') || document.getElementById('prod-supplier');
    if (prodSup && createdItem && createdItem.id) {
      prodSup.value = createdItem.id;
    }
  } else if (entityType === 'product' || entityType === 'item') {
    const products = await API.getProducts();
    window._cachedProducts = products;
    State.products = products;
    
    // Update all product select dropdowns across the application and in tender line items
    document.querySelectorAll('select.tnd-item-product, select[id*="item-select"], select[id*="product-select"], .tender-item-sku-select').forEach(sel => {
      const prevVal = sel.value;
      sel.innerHTML = `<option value="">-- Custom Scope Item --</option>` + products.map(p => {
        const stockVal = parseFloat(p.current_stock || 0);
        const stockText = stockVal % 1 === 0 ? stockVal : stockVal.toFixed(2);
        return `<option value="${p.id}" data-name="${p.name}" data-desc="${p.description || ''}" data-unit="${p.unit || 'PCS'}" data-selling="${p.selling_price || 0}">
          ${p.name} (Stock: ${stockText})
        </option>`;
      }).join('');
      if (prevVal) sel.value = prevVal;
    });

    // Auto-select in the active/empty or last row of tender items
    const itemSelects = document.querySelectorAll('.tnd-item-product');
    if (createdItem && createdItem.id && itemSelects.length > 0) {
      let targetRowSelect = null;
      itemSelects.forEach(s => {
        if (!s.value || s.value === '') targetRowSelect = s;
      });
      if (!targetRowSelect) targetRowSelect = itemSelects[itemSelects.length - 1];
      if (targetRowSelect) {
        targetRowSelect.value = createdItem.id;
        const row = targetRowSelect.closest('tr');
        if (row) {
          const rIndex = parseInt(row.getAttribute('data-index') || 0, 10);
          if (typeof onTenderProductSelect === 'function') {
            onTenderProductSelect(rIndex, createdItem.id);
          }
        }
      }
    }
  } else if (entityType === 'warehouse') {
    const warehouses = await API.getWarehouses();
    State.warehouses = warehouses;
    document.querySelectorAll('select[id*="warehouse"]').forEach(sel => {
      const curVal = (sel.id === targetSelectId) ? createdItem.id : sel.value;
      sel.innerHTML = `<option value="">-- Select Warehouse --</option>` + warehouses.map(w => `<option value="${w.id}">${w.warehouse_name} (${w.city || 'Location'})</option>`).join('');
      if (curVal) sel.value = curVal;
    });
  } else if (entityType === 'company' || entityType === 'businessProfile') {
    let profiles = [];
    try {
      profiles = await API.getBusinessProfiles();
      State.businessProfiles = profiles;
    } catch (e) {
      console.warn('handleQuickAddCompletion getBusinessProfiles error:', e);
    }
    if (!Array.isArray(profiles)) profiles = [];

    document.querySelectorAll('select[id*="business-profile"], select#tender-business-profile, select#user-profile-id').forEach(sel => {
      sel.innerHTML = profiles.map(p => {
        const isSel = (createdItem && String(p.id) === String(createdItem.id)) ? 'selected' : '';
        return `<option value="${p.id}" ${isSel}>${p.business_name} ${p.abbreviation ? `(${p.abbreviation})` : ''}</option>`;
      }).join('');
      if (createdItem && createdItem.id) {
        sel.value = createdItem.id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const tenderBizSelect = document.getElementById('tender-business-profile');
    if (tenderBizSelect && createdItem && createdItem.id) {
      tenderBizSelect.value = createdItem.id;
      tenderBizSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (typeof populateBusinessSwitcher === 'function') {
      populateBusinessSwitcher();
    }
  }
}
window.handleQuickAddCompletion = handleQuickAddCompletion;

const _modalStack = [];
window._modalStack = _modalStack;

function openModal(id) {
  if (id === 'modal-add-expense') {
    openExpenseModal();
    return;
  }
  if (id === 'modal-add-bid-security' && !window._isOpeningBidSecurityWithContext) {
    if (typeof openNewBidSecurityModal === 'function') {
      openNewBidSecurityModal();
      return;
    }
  }
  if (id === 'modal-add-payment' && !window._isOpeningPaymentWithContext) {
    if (typeof openNewPaymentModal === 'function') {
      openNewPaymentModal();
      return;
    }
  }
  if (id === 'modal-create-tenant') {
    if (typeof openNewTenantModal === 'function') {
      openNewTenantModal();
      return;
    }
  }
  const el = document.getElementById(id);
  if (el) {
    // Keep stack order: remove if already present, then push to top
    const existingIdx = _modalStack.indexOf(id);
    if (existingIdx !== -1) {
      _modalStack.splice(existingIdx, 1);
    }
    _modalStack.push(id);

    // Dynamic z-index layering based on modal stack depth
    const depth = _modalStack.length;
    const baseZ = 1100;
    const computedZ = baseZ + (depth * 50);

    const initialInlineZ = parseInt(el.getAttribute('data-base-z') || el.style.zIndex, 10);
    if (initialInlineZ >= 9000) {
      if (!el.getAttribute('data-base-z')) {
        el.setAttribute('data-base-z', initialInlineZ);
      }
      el.style.zIndex = Math.max(initialInlineZ, computedZ + 9000);
    } else {
      el.style.zIndex = computedZ;
    }

    if (depth > 1) {
      el.classList.add('modal-nested');
    }

    el.classList.add('open');
    try {
      if (typeof initCustomDateTimePickers === 'function') {
        initCustomDateTimePickers();
      }
      if (typeof autoEnhanceDataTablesWithUniversalSearch === 'function') {
        autoEnhanceDataTablesWithUniversalSearch();
      }
    } catch (e) {}
    const resetScroll = () => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
      const scrollables = el.querySelectorAll('.modal-card, .modal-body, .modal-content, .table-responsive, form, .modal-scroll-area');
      scrollables.forEach(c => {
        c.scrollTop = 0;
        c.scrollLeft = 0;
      });
    };
    resetScroll();
    requestAnimationFrame(resetScroll);
    setTimeout(resetScroll, 40);
  }
}

function openQuotaUpgradeModal(type = 'tender') {
  const titleEl = document.getElementById('quota-upgrade-title');
  const descEl = document.getElementById('quota-upgrade-desc');
  if (type === 'company' || type === 'entity') {
    if (titleEl) titleEl.innerText = '🏢 Business Entity Limit Reached';
    if (descEl) descEl.innerHTML = 'You have reached your allowed company limit. Additional company entities can be added for PKR 4,500/month or with a plan upgrade.';
  } else {
    if (titleEl) titleEl.innerText = '⚡ Monthly Limit Reached';
    if (descEl) descEl.innerHTML = 'You have reached the limit of <strong>10 Tenders / Quotes</strong> included in your <strong>Basic Plan</strong> this month.';
  }
  openModal('modal-quota-upgrade');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    el.classList.remove('modal-nested');
    const baseZ = el.getAttribute('data-base-z');
    if (baseZ) {
      el.style.zIndex = baseZ;
    } else {
      el.style.zIndex = '';
    }

    // Automatically clean & reset forms in this modal so lingering data never persists
    try {
      const forms = el.querySelectorAll('form');
      forms.forEach(f => {
        try { f.reset(); } catch (_) {}
      });

      // Clear hidden edit-id inputs
      const editInputs = el.querySelectorAll('input[type="hidden"]');
      editInputs.forEach(inp => {
        if (inp.id && (inp.id.endsWith('-edit-id') || inp.id === 'newuser-id' || inp.id === 'exp-cat-id' || inp.id === 'sec-id')) {
          inp.value = '';
        }
      });

      // Clear file inputs and file name displays
      const fileInputs = el.querySelectorAll('input[type="file"]');
      fileInputs.forEach(fi => { fi.value = ''; });
      const fileDisplays = el.querySelectorAll('.file-name-display, [id$="-file-display"], [id$="-file-name"], [id$="-file-badge"]');
      fileDisplays.forEach(fd => { fd.innerText = ''; fd.innerHTML = ''; });

      // Hide autocomplete suggestion dropdowns
      const suggestions = el.querySelectorAll('[id$="-suggestions"], .autocomplete-dropdown');
      suggestions.forEach(s => { s.style.display = 'none'; });
    } catch (resetErr) {
      console.warn('Form reset on closeModal:', resetErr);
    }
  }

  const idx = _modalStack.indexOf(id);
  if (idx !== -1) {
    _modalStack.splice(idx, 1);
  }

  // Also clean up quick-add context stack if closing a quick-add modal without saving
  if (Array.isArray(window._quickAddContextStack) && window._quickAddContextStack.length > 0) {
    const modalToEntity = {
      'modal-add-supplier': 'supplier',
      'modal-add-product': 'product',
      'modal-add-customer': 'customer',
      'modal-add-warehouse': 'warehouse',
      'modal-add-company': 'company'
    };
    const entity = modalToEntity[id];
    if (entity) {
      const top = window._quickAddContextStack[window._quickAddContextStack.length - 1];
      if (top && (top.entityType === entity || (entity === 'product' && top.entityType === 'item'))) {
        window._quickAddContextStack.pop();
        window._quickAddContext = window._quickAddContextStack.length > 0 
          ? window._quickAddContextStack[window._quickAddContextStack.length - 1] 
          : null;
      }
    }
  }
}

function navigateToView(view) {
  const item = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (item) item.click();
}

function promptAddNewTenderSource() {
  const newSource = prompt('Enter New Custom Tender Source or Procurement Portal Name:\n(e.g., WAPDA e-Portal, K-Electric Procurement, NHA e-Bidding, Civil Aviation Authority)');
  if (!newSource || !newSource.trim()) return;
  const cleanSource = newSource.trim();
  const select = document.getElementById('tender-source');
  if (select) {
    let existingOpt = Array.from(select.options).find(opt => opt.value.toLowerCase() === cleanSource.toLowerCase());
    if (!existingOpt) {
      existingOpt = document.createElement('option');
      existingOpt.value = cleanSource;
      existingOpt.innerText = `🌐 ${cleanSource}`;
      select.insertBefore(existingOpt, select.querySelector('option[value="OTHER"]') || select.firstChild);
    }
    select.value = cleanSource;
    handleTenderSourceChange(cleanSource);
    showToast(`✓ Added "${cleanSource}" as active Tender Source`, 'success');
  }
}

function calculateTenderBidSecurityFromPct() {
  const estVal = parseCurrency(document.getElementById('tender-est-value')?.value || '0');
  const pctSelect = document.getElementById('tender-sec-pct-select');
  const customWrapper = document.getElementById('tender-sec-pct-custom-wrapper');
  const customInput = document.getElementById('tender-sec-pct-custom');
  const calcDisplay = document.getElementById('tender-sec-amount-calc');

  let pct = 2;
  if (pctSelect && pctSelect.value === 'custom') {
    if (customWrapper) customWrapper.style.display = 'inline-flex';
    pct = parseFloat(customInput?.value || 2);
  } else if (pctSelect && pctSelect.value) {
    if (customWrapper) customWrapper.style.display = 'none';
    pct = parseFloat(pctSelect.value);
  }

  const calcAmount = (estVal * pct) / 100;
  if (calcDisplay) {
    calcDisplay.innerText = `${pct}% = PKR ${Math.round(calcAmount).toLocaleString()}`;
  }
  return calcAmount;
}

function applyTenderBidSecurityPct(val) {
  calculateTenderBidSecurityFromPct();
}

function updateTenderCurrencyLabels(currency = 'PKR') {
  const cleanCurr = currency || 'PKR';
  window._currentTenderCurrency = cleanCurr;
  const labels = document.querySelectorAll('#modal-add-tender .currency-label, .tender-currency-label');
  labels.forEach(el => {
    el.innerText = cleanCurr;
  });
}
window.updateTenderCurrencyLabels = updateTenderCurrencyLabels;

function applyBidSecurityModalPct(pct) {
  const oppId = document.getElementById('sec-opportunity-id')?.value;
  let estVal = 0;
  if (oppId && window._cachedOpportunities) {
    const opp = window._cachedOpportunities.find(o => String(o.id) === String(oppId));
    if (opp) estVal = parseFloat(opp.estimated_value || 0);
  }
  if (!estVal) {
    const amtField = document.getElementById('sec-amount');
    estVal = parseCurrency(amtField?.value || 0);
  }
  if (estVal > 0) {
    const calc = Math.round((estVal * pct) / 100);
    const amtField = document.getElementById('sec-amount');
    if (amtField) {
      amtField.value = calc.toLocaleString();
      formatCurrencyInput(amtField);
    }
    const hint = document.getElementById('sec-calc-basis-hint');
    if (hint) hint.innerHTML = `Calculated <strong>${pct}%</strong> of PKR ${estVal.toLocaleString()} = <strong>PKR ${calc.toLocaleString()}</strong>`;
    showToast(`✓ Bid Security set to ${pct}% (PKR ${calc.toLocaleString()})`, 'info');
  } else {
    showToast('Please select a tender first to auto-calculate %', 'warning');
  }
}

let _tenderLineItems = [];

async function openNewTenderModal() {
  try {
    const form = document.getElementById('form-add-tender');
    if (form) form.reset();

    const editIdEl = document.getElementById('tender-edit-id');
    if (editIdEl) editIdEl.value = '';

    const nameEl = document.getElementById('tender-name');
    if (nameEl) {
      nameEl.readOnly = false;
      nameEl.style.backgroundColor = '';
      nameEl.style.cursor = '';
      nameEl.removeAttribute('title');
    }

    const modal = document.getElementById('modal-add-tender');
    if (modal) {
      const title = modal.querySelector('h2');
      if (title) title.innerHTML = '📑 Register New Tender / Opportunity';
    }

    const otherContainer = document.getElementById('tender-source-other-container');
    if (otherContainer) otherContainer.style.display = 'none';

    // Parallelize data fetching for lightning fast load
    let customers = [];
    let profiles = [];
    try {
      const [cRes, pRes, prRes] = await Promise.all([
        API.getCustomers(),
        API.getBusinessProfiles(),
        API.getProducts()
      ]);
      customers = cRes || [];
      profiles = pRes || [];
      window._cachedProducts = prRes || [];
      window._cachedCustomers = customers;
    } catch (e) {
      console.warn('Fallback loading options:', e.message);
    }

    const custSelect = document.getElementById('tender-customer');
    const profSelect = document.getElementById('tender-business-profile');
    const currSelect = document.getElementById('tender-currency');

    if (custSelect) {
      custSelect.innerHTML = customers.length === 0 
        ? '<option value="">-- No Customers Registered --</option>' 
        : customers.map(c => `<option value="${c.id}">${c.business_name || c.name} (${c.customer_type || c.org_type || 'Customer'})</option>`).join('');
    }
    if (profSelect) {
      if (profiles.length === 0) {
        profSelect.innerHTML = '<option value="">-- No Business Profiles (Click + to Add) --</option>';
      } else {
        profSelect.innerHTML = profiles.map(p => {
          const isSel = (String(p.id) === String(State.currentBusinessProfileId) || profiles.length === 1) ? 'selected' : '';
          return `<option value="${p.id}" ${isSel}>${p.business_name} ${p.abbreviation ? `(${p.abbreviation})` : ''}</option>`;
        }).join('');
      }
    }
    if (currSelect) {
      currSelect.value = 'PKR';
      updateTenderCurrencyLabels('PKR');
    }

    // Initialize workflow gating checklist to standard defaults
    const gateBid = document.getElementById('gate-bid-security');
    const gatePbg = document.getElementById('gate-performance-guarantee');
    const gateStamp = document.getElementById('gate-stamp-duty');
    const gateDtl = document.getElementById('gate-dtl-inspection');
    const gateFbr = document.getElementById('gate-fbr-e-invoice');
    const gateDiary = document.getElementById('gate-diary-tracking');

    if (gateBid) gateBid.checked = true;
    if (gatePbg) gatePbg.checked = true;
    if (gateStamp) gateStamp.checked = true;
    if (gateDtl) gateDtl.checked = false;
    if (gateFbr) gateFbr.checked = true;
    if (gateDiary) gateDiary.checked = true;

    _tenderLineItems = [];
    const tbody = document.getElementById('tender-items-tbody');
    if (tbody) tbody.innerHTML = '';
    if (typeof addTenderItemRow === 'function') addTenderItemRow();

    const exemptEl = document.getElementById('tender-gst-exempt');
    const inclusiveEl = document.getElementById('tender-gst-inclusive');
    const rateEl = document.getElementById('tender-gst-rate');
    if (exemptEl) exemptEl.checked = false;
    if (inclusiveEl) inclusiveEl.checked = false;
    if (rateEl) rateEl.value = '18';

    if (typeof recalculateTenderItemsSum === 'function') recalculateTenderItemsSum();
    if (typeof calculateTenderBidSecurityFromPct === 'function') calculateTenderBidSecurityFromPct();
    if (typeof initCustomDateTimePickers === 'function') {
      try { initCustomDateTimePickers(); } catch (e) {}
    }

    openModal('modal-add-tender');
  } catch (err) {
    console.error('Error opening Tender modal:', err);
    openModal('modal-add-tender');
  }
}
window.openNewTenderModal = openNewTenderModal;

async function openEditTenderModal(id) {
  if (!id) {
    showToast('Invalid Tender ID.', 'danger');
    return;
  }

  try {
    // 1. Fetch full opportunity record with line items from API or fallback
    let o = null;
    try {
      const res = await API.getOpportunityById(id);
      if (res && res.data) o = res.data;
    } catch (e) {
      console.warn('API.getOpportunityById fallback:', e.message);
    }

    if (!o) {
      const opps = await API.getOpportunities(State.currentBusinessProfileId || 'all');
      o = opps.find(item => String(item.id) === String(id));
    }

    if (!o) {
      const allOpps = await API.getOpportunities('all');
      o = allOpps.find(item => String(item.id) === String(id));
    }

    if (!o) {
      showToast('Tender record could not be found.', 'warning');
      return;
    }

    let customers = [], profiles = [];
    try {
      const [cRes, pRes, prRes] = await Promise.all([
        API.getCustomers(),
        API.getBusinessProfiles(),
        API.getProducts()
      ]);
      customers = cRes || [];
      profiles = pRes || [];
      window._cachedProducts = prRes || [];
      window._cachedCustomers = customers;
    } catch (refErr) {
      console.warn('Edit modal references warning:', refErr.message);
    }

    const form = document.getElementById('form-add-tender');
    if (form) form.reset();

    let editIdEl = document.getElementById('tender-edit-id');
    if (!editIdEl) {
      editIdEl = document.createElement('input');
      editIdEl.type = 'hidden';
      editIdEl.id = 'tender-edit-id';
      if (form) form.appendChild(editIdEl);
    }
    editIdEl.value = o.id;

    const modal = document.getElementById('modal-add-tender');
    if (modal) {
      const title = modal.querySelector('h2');
      if (title) title.innerHTML = `✏️ Edit Tender: ${o.opportunity_number || ''} - ${o.tender_name || o.title || ''}`;
    }

    const nameEl = document.getElementById('tender-name');
    if (nameEl) {
      nameEl.value = o.tender_name || o.title || '';
      nameEl.readOnly = true;
      nameEl.style.backgroundColor = '#f1f5f9';
      nameEl.style.cursor = 'not-allowed';
      nameEl.title = 'Tender Name is fixed in edit mode to preserve audit trail and contract references.';
    }
    
    const srcSelect = document.getElementById('tender-source');
    const otherContainer = document.getElementById('tender-source-other-container');
    const otherInput = document.getElementById('tender-source-other');
    
    const standardSources = ['PPRA (Federal)', 'PPRA (Punjab)', 'DGP', 'RFQ', 'LPQ', 'OTHER', 'DIRECT SALES'];
    if (standardSources.includes(o.tender_source)) {
      if (srcSelect) srcSelect.value = o.tender_source;
      if (otherContainer) otherContainer.style.display = (o.tender_source === 'OTHER') ? 'block' : 'none';
    } else {
      if (srcSelect) srcSelect.value = 'OTHER';
      if (otherContainer) otherContainer.style.display = 'block';
      if (otherInput) otherInput.value = (o.tender_source || '').replace(/^OTHER:\s*/, '');
    }

    const oppNoEl = document.getElementById('tender-opp-no');
    if (oppNoEl) oppNoEl.value = o.opportunity_number || '';

    const extNoEl = document.getElementById('tender-ext-no');
    if (extNoEl) extNoEl.value = o.external_tender_number || '';
    
    const currSelect = document.getElementById('tender-currency');
    if (currSelect) {
      currSelect.value = o.currency || 'PKR';
    }
    if (typeof updateTenderCurrencyLabels === 'function') {
      updateTenderCurrencyLabels(o.currency || 'PKR');
    }

    const custSelect = document.getElementById('tender-customer');
    if (custSelect && customers.length > 0) {
      custSelect.innerHTML = customers.map(c => `<option value="${c.id}" ${String(c.id) === String(o.customer_id) ? 'selected' : ''}>${c.business_name} (${c.customer_type || c.org_type || 'Customer'})</option>`).join('');
    }

    const profSelect = document.getElementById('tender-business-profile');
    if (profSelect && profiles.length > 0) {
      profSelect.innerHTML = profiles.map(p => `<option value="${p.id}" ${String(p.id) === String(o.business_profile_id) ? 'selected' : ''}>${p.business_name} ${p.abbreviation ? `(${p.abbreviation})` : ''}</option>`).join('');
    }

    const estValEl = document.getElementById('tender-est-value');
    if (estValEl) estValEl.value = o.estimated_value ? Number(o.estimated_value).toLocaleString() : '0';

    const closingDateVal = (o.closing_date && o.closing_date !== 'N/A') ? formatDateDDMMYYYY(o.closing_date) : '';
    const openingDateVal = (o.opening_date && o.opening_date !== 'N/A') ? formatDateDDMMYYYY(o.opening_date) : '';
    
    const closingEl = document.getElementById('tender-closing-date');
    if (closingEl) closingEl.value = (closingDateVal === 'N/A' ? '' : closingDateVal);

    const openingEl = document.getElementById('tender-opening-date');
    if (openingEl) openingEl.value = (openingDateVal === 'N/A' ? '' : openingDateVal);

    const descEl = document.getElementById('tender-description');
    if (descEl) descEl.value = o.description || '';

    const exemptEl = document.getElementById('tender-gst-exempt');
    const inclusiveEl = document.getElementById('tender-gst-inclusive');
    const rateEl = document.getElementById('tender-gst-rate');
    if (exemptEl) exemptEl.checked = Boolean(o.is_gst_exempt);
    if (inclusiveEl) inclusiveEl.checked = Boolean(o.is_gst_inclusive);
    if (rateEl) rateEl.value = o.gst_rate_pct !== undefined ? o.gst_rate_pct : 18;

    // Populate workflow gating checklist from tender record
    let g = o.workflow_gates;
    if (typeof g === 'string') {
      try { g = JSON.parse(g); } catch (e) { g = null; }
    }
    if (!g) {
      g = {
        requires_bid_security: true,
        requires_performance_guarantee: true,
        requires_stamp_duty: true,
        requires_dtl_inspection: false,
        requires_fbr_e_invoice: true,
        requires_diary_tracking: true
      };
    }

    const gateBid = document.getElementById('gate-bid-security');
    const gatePbg = document.getElementById('gate-performance-guarantee');
    const gateStamp = document.getElementById('gate-stamp-duty');
    const gateDtl = document.getElementById('gate-dtl-inspection');
    const gateFbr = document.getElementById('gate-fbr-e-invoice');
    const gateDiary = document.getElementById('gate-diary-tracking');

    if (gateBid) gateBid.checked = g.requires_bid_security !== false;
    if (gatePbg) gatePbg.checked = g.requires_performance_guarantee !== false;
    if (gateStamp) gateStamp.checked = g.requires_stamp_duty !== false;
    if (gateDtl) gateDtl.checked = g.requires_dtl_inspection === true;
    if (gateFbr) gateFbr.checked = g.requires_fbr_e_invoice !== false;
    if (gateDiary) gateDiary.checked = g.requires_diary_tracking !== false;

    _tenderLineItems = [];
    const tbody = document.getElementById('tender-items-tbody');
    if (tbody) tbody.innerHTML = '';
    
    const items = o.items || o.tender_items || [];
    if (Array.isArray(items) && items.length > 0) {
      items.forEach(itm => {
        addTenderItemRow(itm);
      });
    } else {
      addTenderItemRow({
        item_description: o.tender_name || o.title || 'Scope Item',
        quantity: 1,
        unit: 'LOT',
        estimated_unit_price: o.estimated_value || 0
      });
    }

    try { recalculateTenderItemsSum(); } catch (e) {}
    try { calculateTenderBidSecurityFromPct(); } catch (e) {}
    try { initCustomDateTimePickers(); } catch (e) {}

    openModal('modal-add-tender');
  } catch (modalErr) {
    console.error('Error opening Edit Tender modal:', modalErr);
    showToast('Notice opening edit modal: ' + modalErr.message, 'warning');
    openModal('modal-add-tender');
  }
}

function addTenderItemRow(initialData = null) {
  const tbody = document.getElementById('tender-items-tbody');
  if (!tbody) return;
  const rowIndex = _tenderLineItems.length;
  const products = window._cachedProducts || [];

  const rowId = `tnd-row-${rowIndex}`;

  // Check if product was selected and has predefined sizes and variants
  const initialProdId = initialData?.product_service_id || initialData?.product_id || '';
  const selectedProd = products.find(p => String(p.id) === String(initialProdId));

  let prodSizes = [];
  if (selectedProd && selectedProd.sizes) {
    prodSizes = typeof selectedProd.sizes === 'string' ? JSON.parse(selectedProd.sizes || '[]') : selectedProd.sizes;
  }
  let prodVariants = [];
  if (selectedProd && selectedProd.variants) {
    prodVariants = typeof selectedProd.variants === 'string' ? JSON.parse(selectedProd.variants || '[]') : selectedProd.variants;
  }

  const currentSize = initialData?.item_size || initialData?.size || initialData?.specifications || '';
  const currentVariant = initialData?.item_variant || initialData?.variant || '';

  const rowHtml = `
    <tr id="${rowId}" data-index="${rowIndex}">
      <td>
        <select class="form-select tnd-item-product" style="font-size:0.78rem; padding:4px 6px;" onchange="onTenderProductSelect(${rowIndex}, this.value)">
          <option value="">-- Custom Scope Item --</option>
          ${products.map(p => {
            const stockVal = parseFloat(p.current_stock || 0);
            const stockText = stockVal % 1 === 0 ? stockVal : stockVal.toFixed(2);
            return `<option value="${p.id}" ${(initialData && (initialData.product_service_id === p.id || initialData.product_id === p.id)) ? 'selected' : ''} data-name="${p.name}" data-spec="${p.specifications || p.size || ''}" data-desc="${p.description || ''}" data-unit="${p.unit || 'PCS'}" data-selling="${p.selling_price || 0}" data-cost="${p.cost_price || 0}">${p.name} (Stock: ${stockText})</option>`;
          }).join('')}
        </select>
      </td>
      <td>
        <input type="text" class="form-input tnd-item-desc" required placeholder="Item Scope / Technical Description" style="font-size:0.78rem; padding:4px 6px;" value="${initialData?.item_description || initialData?.item_name || ''}" oninput="recalculateTenderItemsSum()">
      </td>
      <td class="tnd-size-cell">
        ${(Array.isArray(prodSizes) && prodSizes.length > 0) ? `
          <select class="form-select tnd-item-size" style="font-size:0.78rem; padding:4px 6px;">
            <option value="">-- Select Size --</option>
            ${prodSizes.map(s => `<option value="${s}" ${currentSize === s ? 'selected' : ''}>${s}</option>`).join('')}
            ${(currentSize && !prodSizes.includes(currentSize)) ? `<option value="${currentSize}" selected>${currentSize}</option>` : ''}
          </select>
        ` : `
          <input type="text" class="form-input tnd-item-size" placeholder="Size / Spec" style="font-size:0.78rem; padding:4px 6px;" value="${currentSize}">
        `}
      </td>
      <td class="tnd-variant-cell">
        ${(Array.isArray(prodVariants) && prodVariants.length > 0) ? `
          <select class="form-select tnd-item-variant" style="font-size:0.78rem; padding:4px 6px;">
            <option value="">-- Select Variant --</option>
            ${prodVariants.map(v => `<option value="${v}" ${currentVariant === v ? 'selected' : ''}>${v}</option>`).join('')}
            ${(currentVariant && !prodVariants.includes(currentVariant)) ? `<option value="${currentVariant}" selected>${currentVariant}</option>` : ''}
          </select>
        ` : `
          <input type="text" class="form-input tnd-item-variant" placeholder="Variant / Type" style="font-size:0.78rem; padding:4px 6px;" value="${currentVariant}">
        `}
      </td>
      <td>
        <input type="number" class="form-input tnd-item-qty" required min="1" step="1" value="${initialData?.quantity || 1}" style="min-width:95px; width:100%; font-size:0.85rem; padding:4px 6px; text-align:center; font-weight:700;" oninput="recalculateTenderItemsSum()">
      </td>
      <td>
        <input list="uom-datalist" type="text" class="form-input tnd-item-unit" value="${initialData?.unit || 'PCS'}" style="font-size:0.78rem; padding:4px 6px;" placeholder="e.g. PCS, Nos">
      </td>
      <td>
        <input type="text" class="form-input tnd-item-price" placeholder="0" style="font-size:0.78rem; padding:4px 6px;" value="${initialData?.estimated_unit_price ? Number(initialData.estimated_unit_price).toLocaleString() : (initialData?.unit_price ? Number(initialData.unit_price).toLocaleString() : '0')}" oninput="formatCurrencyInput(this); recalculateTenderItemsSum();">
      </td>
      <td>
        <strong class="tnd-item-total" style="font-size:0.8rem; color:#0f172a; display:block; padding:4px 0;">${initialData?.estimated_total_price ? Number(initialData.estimated_total_price).toLocaleString() : '0'}</strong>
      </td>
      <td style="text-align:center;">
        <button type="button" class="danger-btn" style="padding:2px 6px; font-size:0.75rem;" onclick="deleteTenderItemRow(${rowIndex})" title="Remove item">&times;</button>
      </td>
    </tr>
  `;

  tbody.insertAdjacentHTML('beforeend', rowHtml);
  _tenderLineItems.push({
    index: rowIndex,
    product_service_id: initialData?.product_service_id || null,
    item_description: initialData?.item_description || '',
    item_size: currentSize,
    item_variant: currentVariant,
    quantity: initialData?.quantity || 1,
    unit: initialData?.unit || 'PCS',
    estimated_unit_price: initialData?.estimated_unit_price || 0,
    estimated_total_price: initialData?.estimated_total_price || 0
  });

  recalculateTenderItemsSum();
}

function onTenderProductSelect(rowIndex, productId) {
  const row = document.getElementById(`tnd-row-${rowIndex}`);
  if (!row) return;

  const products = window._cachedProducts || [];
  const prod = products.find(p => p.id === productId);

  const descInput = row.querySelector('.tnd-item-desc');
  const sizeCell = row.querySelector('.tnd-size-cell');
  const variantCell = row.querySelector('.tnd-variant-cell');
  const unitInput = row.querySelector('.tnd-item-unit');
  const priceInput = row.querySelector('.tnd-item-price');

  if (prod) {
    // 1. Fix Item Description: display specification / description instead of product name
    if (descInput) {
      descInput.value = prod.description || prod.specifications || prod.name;
    }

    // 2. Dynamic Sizes dropdown
    let prodSizes = [];
    if (prod.sizes) {
      prodSizes = typeof prod.sizes === 'string' ? JSON.parse(prod.sizes || '[]') : prod.sizes;
    }
    if (sizeCell) {
      if (Array.isArray(prodSizes) && prodSizes.length > 0) {
        sizeCell.innerHTML = `
          <select class="form-select tnd-item-size" style="font-size:0.78rem; padding:4px 6px;">
            <option value="">-- Select Size --</option>
            ${prodSizes.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        `;
      } else {
        sizeCell.innerHTML = `
          <input type="text" class="form-input tnd-item-size" placeholder="Size / Spec" style="font-size:0.78rem; padding:4px 6px;" value="${prod.specifications || prod.size || ''}">
        `;
      }
    }

    // 3. Dynamic Variants dropdown
    let prodVariants = [];
    if (prod.variants) {
      prodVariants = typeof prod.variants === 'string' ? JSON.parse(prod.variants || '[]') : prod.variants;
    }
    if (variantCell) {
      if (Array.isArray(prodVariants) && prodVariants.length > 0) {
        variantCell.innerHTML = `
          <select class="form-select tnd-item-variant" style="font-size:0.78rem; padding:4px 6px;">
            <option value="">-- Select Variant --</option>
            ${prodVariants.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        `;
      } else {
        variantCell.innerHTML = `
          <input type="text" class="form-input tnd-item-variant" placeholder="Variant / Type" style="font-size:0.78rem; padding:4px 6px;" value="">
        `;
      }
    }

    // 4. Unit & Price auto-fill
    if (unitInput) unitInput.value = prod.unit || 'PCS';
    if (priceInput) {
      priceInput.value = prod.selling_price ? Number(prod.selling_price).toLocaleString() : '0';
      formatCurrencyInput(priceInput);
    }
  } else {
    // Revert to open inputs if Custom Scope Item chosen
    if (sizeCell) {
      sizeCell.innerHTML = `<input type="text" class="form-input tnd-item-size" placeholder="Size / Spec" style="font-size:0.78rem; padding:4px 6px;">`;
    }
    if (variantCell) {
      variantCell.innerHTML = `<input type="text" class="form-input tnd-item-variant" placeholder="Variant / Type" style="font-size:0.78rem; padding:4px 6px;">`;
    }
  }

  recalculateTenderItemsSum();
}

function deleteTenderItemRow(rowIndex) {
  const row = document.getElementById(`tnd-row-${rowIndex}`);
  if (row) row.remove();

  const remainingRows = document.querySelectorAll('#tender-items-tbody tr');
  if (remainingRows.length === 0) {
    addTenderItemRow();
  } else {
    recalculateTenderItemsSum();
  }
}

function handleTenderGSTToggles(type) {
  const exempt = document.getElementById('tender-gst-exempt');
  const inclusive = document.getElementById('tender-gst-inclusive');
  const rateWrapper = document.getElementById('tender-gst-rate-wrapper');

  if (type === 'exempt' && exempt?.checked) {
    if (inclusive) inclusive.checked = false;
    if (rateWrapper) rateWrapper.style.opacity = '0.4';
  } else if (type === 'inclusive' && inclusive?.checked) {
    if (exempt) exempt.checked = false;
    if (rateWrapper) rateWrapper.style.opacity = '1';
  } else {
    if (rateWrapper) rateWrapper.style.opacity = '1';
  }

  recalculateTenderItemsSum();
}

function recalculateTenderItemsSum() {
  const rows = document.querySelectorAll('#tender-items-tbody tr');
  let subtotal = 0;
  let hasLossAlert = false;

  rows.forEach(row => {
    const qtyInput = row.querySelector('.tnd-item-qty');
    const priceInput = row.querySelector('.tnd-item-price');
    const totalEl = row.querySelector('.tnd-item-total');
    const prodSelect = row.querySelector('.tnd-item-product');

    const qty = parseFloat(qtyInput?.value || 0);
    const unitPrice = parseCurrency(priceInput?.value || '0');
    const lineTotal = qty * unitPrice;

    if (totalEl) totalEl.innerText = lineTotal.toLocaleString();
    subtotal += lineTotal;

    if (prodSelect && prodSelect.value) {
      const opt = prodSelect.selectedOptions[0];
      const costPrice = parseFloat(opt?.getAttribute('data-cost') || 0);
      if (costPrice > 0 && unitPrice > 0 && unitPrice < costPrice) {
        hasLossAlert = true;
      }
    }
  });

  const isExempt = document.getElementById('tender-gst-exempt')?.checked || false;
  const isInclusive = document.getElementById('tender-gst-inclusive')?.checked || false;
  const gstRateInput = document.getElementById('tender-gst-rate');
  const gstRate = parseFloat(gstRateInput?.value || 18);

  let gstAmount = 0;
  let grandTotal = subtotal;

  if (isExempt) {
    gstAmount = 0;
    grandTotal = subtotal;
  } else if (isInclusive) {
    gstAmount = subtotal - (subtotal / (1 + (gstRate / 100)));
    grandTotal = subtotal;
  } else {
    gstAmount = (subtotal * gstRate) / 100;
    grandTotal = subtotal + gstAmount;
  }

  const subtotalDisp = document.getElementById('tender-items-subtotal-disp');
  const gstRateDisp = document.getElementById('tender-gst-rate-disp');
  const gstAmountDisp = document.getElementById('tender-gst-amount-disp');
  const grandTotalDisp = document.getElementById('tender-grand-total-disp');

  if (subtotalDisp) subtotalDisp.innerText = Math.round(subtotal).toLocaleString();
  if (gstRateDisp) gstRateDisp.innerText = isExempt ? 'Exempt' : `${gstRate}%`;
  if (gstAmountDisp) gstAmountDisp.innerText = Math.round(gstAmount).toLocaleString();
  if (grandTotalDisp) grandTotalDisp.innerText = Math.round(grandTotal).toLocaleString();

  const estValInput = document.getElementById('tender-est-value');
  if (estValInput && subtotal > 0) {
    estValInput.value = Math.round(grandTotal).toLocaleString();
  }

  const warningEl = document.getElementById('tender-price-warning');
  if (warningEl) {
    warningEl.style.display = hasLossAlert ? 'block' : 'none';
  }

  calculateTenderBidSecurityFromPct();
}

function handleTenderSourceChange(val) {
  const container = document.getElementById('tender-source-other-container');
  if (container) {
    container.style.display = (val === 'OTHER' || val.startsWith('OTHER')) ? 'block' : 'none';
  }
}

async function submitNewTenderForm() {
  const editId = document.getElementById('tender-edit-id')?.value;
  const tenderName = document.getElementById('tender-name')?.value?.trim();
  let source = document.getElementById('tender-source')?.value || 'PPRA (Federal)';
  const customSource = document.getElementById('tender-source-other')?.value?.trim();
  if ((source === 'OTHER' || source.startsWith('OTHER')) && customSource) {
    source = `OTHER: ${customSource}`;
  }
  const oppNo = document.getElementById('tender-opp-no')?.value?.trim();
  const extNo = document.getElementById('tender-ext-no')?.value?.trim();
  const currency = document.getElementById('tender-currency')?.value || 'PKR';
  const custId = document.getElementById('tender-customer')?.value;
  const bizId = document.getElementById('tender-business-profile')?.value;
  const estVal = parseCurrency(document.getElementById('tender-est-value')?.value);
  const closing = document.getElementById('tender-closing-date')?.value;
  const opening = document.getElementById('tender-opening-date')?.value;
  const desc = document.getElementById('tender-description')?.value;

  if (!tenderName) {
    alert('Tender Name is mandatory');
    return;
  }

  const submitBtn = document.querySelector('#form-add-tender button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving Tender...</span>';
  }

  try {
    const existingOpps = await API.getOpportunities(bizId || 'all');
    const isDup = existingOpps.some(o => 
      o.tender_name?.toLowerCase().trim() === tenderName.toLowerCase() && 
      (!custId || String(o.customer_id) === String(custId)) &&
      String(o.id) !== String(editId || '')
    );
    if (isDup) {
      alert(`⚠️ Duplicate Tender Error:\nA tender named "${tenderName}" is already registered for this customer.`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>💾 Save Tender Record</span>';
      }
      return;
    }

    const rows = document.querySelectorAll('#tender-items-tbody tr');
    const items = [];
    rows.forEach(row => {
      const prodId = row.querySelector('.tnd-item-product')?.value || null;
      const itemDesc = row.querySelector('.tnd-item-desc')?.value?.trim();
      const itemSize = row.querySelector('.tnd-item-size')?.value?.trim() || '';
      const itemVariant = row.querySelector('.tnd-item-variant')?.value?.trim() || '';
      const qty = parseFloat(row.querySelector('.tnd-item-qty')?.value || 1);
      const unit = row.querySelector('.tnd-item-unit')?.value || 'PCS';
      const unitPrice = parseCurrency(row.querySelector('.tnd-item-price')?.value);

      if (itemDesc) {
        items.push({
          product_service_id: prodId,
          item_name: itemDesc,
          item_description: itemDesc,
          item_size: itemSize,
          size: itemSize,
          item_variant: itemVariant,
          variant: itemVariant,
          quantity: qty,
          unit: unit,
          estimated_unit_price: unitPrice,
          estimated_total_price: qty * unitPrice
        });
      }
    });

    const isExempt = document.getElementById('tender-gst-exempt')?.checked || false;
    const isInclusive = document.getElementById('tender-gst-inclusive')?.checked || false;
    const gstRate = parseFloat(document.getElementById('tender-gst-rate')?.value || 18);
    const itemsSubtotal = items.reduce((acc, itm) => acc + (itm.estimated_total_price || 0), 0);

    const workflowGates = {
      requires_bid_security: document.getElementById('gate-bid-security')?.checked !== false,
      requires_performance_guarantee: document.getElementById('gate-performance-guarantee')?.checked !== false,
      requires_stamp_duty: document.getElementById('gate-stamp-duty')?.checked !== false,
      requires_dtl_inspection: document.getElementById('gate-dtl-inspection')?.checked === true,
      requires_fbr_e_invoice: document.getElementById('gate-fbr-e-invoice')?.checked !== false,
      requires_diary_tracking: document.getElementById('gate-diary-tracking')?.checked !== false
    };

    const payload = {
      tender_name: tenderName,
      title: tenderName,
      opportunity_number: oppNo || ('TND-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)),
      external_tender_number: extNo || undefined,
      tender_source: source,
      currency: currency,
      customer_id: custId,
      business_profile_id: bizId,
      estimated_value: estVal,
      closing_date: closing,
      opening_date: opening,
      description: desc,
      items: items,
      is_gst_exempt: isExempt,
      is_gst_inclusive: isInclusive,
      gst_rate_pct: isExempt ? 0 : gstRate,
      subtotal: itemsSubtotal,
      workflow_gates: workflowGates
    };

    if (editId) {
      const res = await API.updateOpportunity(editId, payload);
      if (!res || !res.success) {
        console.error('[UPDATE TENDER FAILED]:', res);
        alert(`❌ Failed to update tender in database:\n\n${res?.message || res?.error || 'Unknown error occurred while updating.'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Tender Record</span>';
        }
        return;
      }
      closeModal('modal-add-tender');
      showToast('✓ Tender Record and scope items updated successfully in database!', 'success');
      await renderActiveView();
    } else {
      const res = await API.createOpportunity(payload);

      if (!res || !res.success || !res.data?.id) {
        console.error('[CREATE TENDER FAILED]:', res);
        const errMsg = res?.message || res?.error || 'Database rejected the tender record.';
        alert(`❌ Tender NOT saved in database!\n\nReason: ${errMsg}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Tender Record</span>';
        }
        return; // CRITICAL: NEVER close modal, NEVER show success toast unless verified saved in database
      }

      closeModal('modal-add-tender');
      showToast('✓ Tender Record saved successfully in database!', 'success');

      const createdId = res.data.id;
      const createdNo = res.data.opportunity_number || oppNo || 'TND-2026';
      
      // Prompt mandatory Bid Security modal with verified database UUID
      promptAttachBidSecurity(createdId, encodeURIComponent(tenderName), createdNo, estVal, '');
      await renderActiveView();
    }
  } catch (err) {
    alert(`Error saving tender: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save Tender Record</span>';
    }
  }
}
window.submitNewTenderForm = submitNewTenderForm;

function handleTenderCustomerChange(custId) {
  // Workflow gates are managed exclusively per tender, not inherited or overridden by customer selection
  if (!custId) return;
}
window.handleTenderCustomerChange = handleTenderCustomerChange;

async function handleTenderSecuritySearch(query) {
  const suggestionsBox = document.getElementById('sec-opp-suggestions');
  if (!suggestionsBox) return;

  const allOpps = await API.getOpportunities(State.currentBusinessProfileId);
  // Filter tenders missing active bid security
  const missingSecurityOpps = allOpps.filter(o => !o.active_bid_securities_count || o.active_bid_securities_count === 0);

  const cleanQuery = (query || '').toLowerCase().trim();
  const matched = cleanQuery 
    ? missingSecurityOpps.filter(o => 
        (o.tender_name && o.tender_name.toLowerCase().includes(cleanQuery)) ||
        (o.title && o.title.toLowerCase().includes(cleanQuery)) ||
        (o.opportunity_number && o.opportunity_number.toLowerCase().includes(cleanQuery)) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(cleanQuery))
      )
    : missingSecurityOpps;

  if (matched.length === 0) {
    suggestionsBox.innerHTML = `
      <div style="padding:10px; color:#64748b; font-size:0.8rem; text-align:center;">
        No tenders missing bid security found matching "${query || ''}"
      </div>
    `;
    suggestionsBox.style.display = 'block';
    return;
  }

  suggestionsBox.innerHTML = matched.map(o => `
    <div class="autocomplete-item" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background 0.2s;" 
         onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'"
         onclick="selectTenderForSecurity('${o.id}', '${encodeURIComponent(o.tender_name || o.title)}', '${o.opportunity_number || ''}', ${parseFloat(o.estimated_value || 0)}, '${encodeURIComponent(o.customer_name || '')}')">
      <div style="font-weight:700; font-size:0.85rem; color:#0f172a;">
        [${o.opportunity_number || 'TND'}] ${o.tender_name || o.title}
      </div>
      <div style="font-size:0.75rem; color:#64748b; display:flex; justify-content:space-between; margin-top:2px;">
        <span>Customer: <strong>${o.customer_name || 'Open Market'}</strong></span>
        <span style="color:#2563eb; font-weight:600;">Est: ${formatCurrency(o.estimated_value, o.currency || 'PKR')}</span>
      </div>
    </div>
  `).join('');
  suggestionsBox.style.display = 'block';
}

function selectTenderForSecurity(oppId, tenderNameEnc, oppNo, estVal, customerNameEnc) {
  const tenderName = decodeURIComponent(tenderNameEnc || '');
  const customerName = decodeURIComponent(customerNameEnc || '');
  
  const idEl = document.getElementById('sec-opportunity-id');
  const titleEl = document.getElementById('sec-opp-title');
  if (idEl) idEl.value = oppId;
  if (titleEl) titleEl.value = oppNo ? `[${oppNo}] ${tenderName}` : tenderName;
  
  // Suggested 2% earnest money
  if (estVal > 0) {
    const suggestedAmt = Math.round(estVal * 0.02);
    const amtEl = document.getElementById('sec-amount');
    if (amtEl) amtEl.value = suggestedAmt.toLocaleString();
  }

  // Pre-fill beneficiary with Customer
  if (customerName) {
    const benEl = document.getElementById('sec-beneficiary');
    if (benEl && !benEl.value) benEl.value = customerName;
  }

  // Pre-fill default account title with current company
  const currentProfile = State.getCurrentBusinessProfile();
  if (currentProfile && currentProfile.business_name && currentProfile.business_name !== 'All Business Entities') {
    const accEl = document.getElementById('sec-account-title');
    if (accEl && !accEl.value) accEl.value = currentProfile.business_name;
  }

  const suggestionsBox = document.getElementById('sec-opp-suggestions');
  if (suggestionsBox) suggestionsBox.style.display = 'none';
}

function openNewBidSecurityModal(oppId = null, tenderNameDecoded = '', oppNo = '', estVal = 0, custNameDecoded = '') {
  window._isOpeningBidSecurityWithContext = true;
  try {
    const form = document.getElementById('form-add-bid-security');
    if (form) form.reset();

    if (typeof clearInstrumentFile === 'function') clearInstrumentFile();

    const secIdEl = document.getElementById('sec-id');
    if (secIdEl) secIdEl.value = '';

    const oppIdEl = document.getElementById('sec-opportunity-id');
    const titleEl = document.getElementById('sec-opp-title');
    const amtEl = document.getElementById('sec-amount');
    const benEl = document.getElementById('sec-beneficiary');
    const accEl = document.getElementById('sec-account-title');
    const noEl = document.getElementById('sec-instrument-no');
    const bankEl = document.getElementById('sec-bank');
    const branchEl = document.getElementById('sec-branch');
    const valDaysEl = document.getElementById('sec-validity-days');
    const marginEl = document.getElementById('sec-margin-pct');
    const chargesEl = document.getElementById('sec-charges');
    const remarksEl = document.getElementById('sec-remarks');

    if (noEl) noEl.value = '';
    if (bankEl) bankEl.value = '';
    if (branchEl) branchEl.value = '';
    if (valDaysEl) valDaysEl.value = '120';
    if (marginEl) marginEl.value = '100';
    if (chargesEl) chargesEl.value = '';
    if (remarksEl) remarksEl.value = '';

    const issueDateEl = document.getElementById('sec-issue-date');
    if (issueDateEl) issueDateEl.value = new Date().toISOString().slice(0, 10);
    const expiryDateEl = document.getElementById('sec-expiry-date');
    if (expiryDateEl) {
      const expD = new Date();
      expD.setDate(expD.getDate() + 120);
      expiryDateEl.value = expD.toISOString().slice(0, 10);
    }

    if (oppId) {
      // FIX: tenderNameDecoded / custNameDecoded arrive already URI-encoded from the
      // caller (onclick passes encodeURIComponent values). Pass them directly to
      // selectTenderForSecurity which will call decodeURIComponent internally.
      // Do NOT re-encode here — that causes double-encoding (e.g. Mayo%2520Hospital).
      selectTenderForSecurity(oppId, tenderNameDecoded || '', oppNo, estVal, custNameDecoded || '');
      if (titleEl) {
        titleEl.readOnly = true;
        titleEl.style.backgroundColor = '#f8fafc';
      }
      // Beneficiary must always remain editable so the user can correct auto-filled values
      if (benEl) {
        benEl.readOnly = false;
        benEl.style.backgroundColor = '';
      }
    } else {
      if (oppIdEl) oppIdEl.value = '';
      if (titleEl) {
        titleEl.value = '';
        titleEl.readOnly = false;
        titleEl.style.backgroundColor = '';
      }
      if (amtEl) amtEl.value = '';
      if (benEl) {
        benEl.value = '';
        benEl.readOnly = false;
        benEl.style.backgroundColor = '';
      }
      const currentProfile = State.getCurrentBusinessProfile();
      if (currentProfile && currentProfile.business_name && currentProfile.business_name !== 'All Business Entities') {
        if (accEl) accEl.value = currentProfile.business_name;
      }
    }

    const suggestionsBox = document.getElementById('sec-opp-suggestions');
    if (suggestionsBox) suggestionsBox.style.display = 'none';

    try { initCustomDateTimePickers(); } catch (e) {}
    openModal('modal-add-bid-security');
  } finally {
    window._isOpeningBidSecurityWithContext = false;
  }
}
window.openNewBidSecurityModal = openNewBidSecurityModal;

function promptAttachBidSecurity(oppId, tenderNameDecoded, oppNo = '', estVal = 0, custNameDecoded = '') {
  openNewBidSecurityModal(oppId, tenderNameDecoded, oppNo, estVal, custNameDecoded);
}
window.promptAttachBidSecurity = promptAttachBidSecurity;

async function openAttachedBidSecurityModal(oppId) {
  let matched = [];
  try {
    const securities = await API.getBidSecurities('all', oppId);
    matched = (securities || []).filter(s => s.opportunity_id === oppId || String(s.opportunity_id) === String(oppId));
  } catch (e) {
    matched = [];
  }

  if (matched.length === 0) {
    const localSecurities = State.getTenantEntityList('bidSecurities');
    matched = localSecurities.filter(s => s.opportunity_id === oppId || String(s.opportunity_id) === String(oppId));
  }
  
  const content = document.getElementById('view-bid-security-content');
  if (!content) return;

  if (matched.length === 0) {
    content.innerHTML = `
      <div style="text-align:center; padding:24px 16px; color:#64748b;">
        🛡️ <strong>No active bid security instrument linked to this tender.</strong><br>
        <span style="font-size:0.82rem; margin-top:6px; display:inline-block;">Click <em>+ Add Bid Security</em> to attach an earnest money instrument.</span>
      </div>
    `;
  } else {
    content.innerHTML = matched.map(s => `
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong style="font-size:1rem; color:#0f172a;">${s.instrument_type || 'CDR / Bank Guarantee'} #${s.instrument_number || s.security_number || 'N/A'}</strong>
          <span class="badge badge-${(s.status || 'active').toLowerCase()}">${s.status || 'Active'}</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:0.83rem;">
          <div><span style="color:#64748b;">Account Title:</span> <strong>${s.account_title || 'N/A'}</strong></div>
          <div><span style="color:#64748b;">Beneficiary:</span> <strong>${s.beneficiary || 'N/A'}</strong></div>
          <div><span style="color:#64748b;">Amount:</span> <strong style="color:#10b981;">PKR ${parseFloat(s.amount || 0).toLocaleString()}</strong></div>
          <div><span style="color:#64748b;">Bid Security Date:</span> <strong>${formatDateDDMMYYYY(s.expiry_date) || s.expiry_date || 'N/A'}</strong></div>
          <div style="grid-column: span 2;"><span style="color:#64748b;">Bank & Branch:</span> <strong>${s.bank_name || 'N/A'} ${s.bank_branch ? `(${s.bank_branch})` : ''}</strong></div>
          ${s.comments ? `<div style="grid-column: span 2;"><span style="color:#64748b;">Remarks:</span> <em>${s.comments}</em></div>` : ''}
        </div>
        <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
          <button class="edit-btn" onclick="closeModal('modal-view-bid-security'); openEditEntityModal('bid-security', '${s.id}');">✏️ Edit Instrument</button>
          ${s.status === 'Active' ? `<button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="closeModal('modal-view-bid-security'); handleReleaseBidSecurity('${s.id}');">🔓 Release Instrument</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  openModal('modal-view-bid-security');
}

function openTenderDetailsModal(oppId) {
  openTender360Cockpit(oppId);
}

let _currentInstrumentDataUrl = null;

function handleInstrumentFileSelect(event) {
  const file = event.target.files?.[0];
  if (file) {
    processInstrumentFile(file);
  }
}
window.handleInstrumentFileSelect = handleInstrumentFileSelect;

function handleInstrumentDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('sec-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#2563eb';
    dropzone.style.background = '#eff6ff';
  }
}
window.handleInstrumentDragOver = handleInstrumentDragOver;

function handleInstrumentDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('sec-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#94a3b8';
    dropzone.style.background = '#f8fafc';
  }
}
window.handleInstrumentDragLeave = handleInstrumentDragLeave;

function handleInstrumentDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('sec-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#94a3b8';
    dropzone.style.background = '#f8fafc';
  }
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    processInstrumentFile(file);
  }
}
window.handleInstrumentDrop = handleInstrumentDrop;

function clearInstrumentFile() {
  _currentInstrumentDataUrl = null;
  const fileInput = document.getElementById('sec-instrument-file');
  if (fileInput) fileInput.value = '';

  const preview = document.getElementById('sec-preview-container');
  if (preview) preview.style.display = 'none';

  const statusEl = document.getElementById('sec-scan-status');
  if (statusEl) statusEl.style.display = 'none';

  const imgEl = document.getElementById('sec-preview-img');
  if (imgEl) imgEl.src = '';
}
window.clearInstrumentFile = clearInstrumentFile;

async function processInstrumentFile(file) {
  if (!file) return;

  const statusEl = document.getElementById('sec-scan-status');
  const statusText = document.getElementById('sec-scan-status-text');
  const previewContainer = document.getElementById('sec-preview-container');
  const previewImg = document.getElementById('sec-preview-img');
  const previewFilename = document.getElementById('sec-preview-filename');
  const previewMatchTag = document.getElementById('sec-preview-match-tag');

  // 1. Read file as Data URL for local preview & persistence
  const reader = new FileReader();
  reader.onload = async (e) => {
    _currentInstrumentDataUrl = e.target.result;
    if (previewImg && file.type.startsWith('image/')) {
      previewImg.src = _currentInstrumentDataUrl;
      previewImg.style.display = 'block';
    } else if (previewImg) {
      previewImg.style.display = 'none';
    }
    if (previewFilename) previewFilename.innerText = file.name;
    if (previewContainer) previewContainer.style.display = 'flex';
  };
  reader.readAsDataURL(file);

  // 2. Trigger OCR if Tesseract is loaded and it's an image
  if (statusEl) statusEl.style.display = 'block';
  if (statusText) statusText.innerText = 'Scanning & reading instrument scan with OCR...';

  let rawExtractedText = '';
  try {
    if (typeof Tesseract !== 'undefined' && file.type.startsWith('image/')) {
      const ocrResult = await Tesseract.recognize(file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && statusText) {
            const pct = Math.round((m.progress || 0) * 100);
            statusText.innerText = `Extracting instrument text with OCR (${pct}%)...`;
          }
        }
      });
      rawExtractedText = ocrResult?.data?.text || '';
    }
  } catch (ocrErr) {
    console.warn('[OCR Engine Warning]:', ocrErr.message);
  }

  // 3. Send extracted text and file metadata to Backend Banking Instrument Parser
  try {
    if (statusText) statusText.innerText = 'Analyzing Pakistani banking instrument data...';
    const parseRes = await API.parseBidSecurityInstrument({
      raw_text: rawExtractedText,
      filename: file.name
    });

    if (parseRes && parseRes.success && parseRes.data) {
      const d = parseRes.data;
      if (d.instrument_type) {
        const typeEl = document.getElementById('sec-instrument-type');
        if (typeEl) typeEl.value = d.instrument_type;
      }
      if (d.instrument_number) {
        const noEl = document.getElementById('sec-instrument-no');
        if (noEl) noEl.value = d.instrument_number;
      }
      if (d.bank_name) {
        const bankEl = document.getElementById('sec-bank-name');
        if (bankEl) {
          bankEl.value = d.bank_branch ? `${d.bank_name} (${d.bank_branch})` : d.bank_name;
        }
      }
      if (d.amount && d.amount > 0) {
        const amtEl = document.getElementById('sec-amount');
        if (amtEl) {
          amtEl.value = Number(d.amount).toLocaleString();
          formatCurrencyInput(amtEl);
        }
      }
      if (d.date) {
        const dateEl = document.getElementById('sec-expiry-date');
        if (dateEl) {
          dateEl.value = d.date;
          try { initCustomDateTimePickers(); } catch (e) {}
        }
      }
      if (d.beneficiary) {
        const benEl = document.getElementById('sec-beneficiary');
        if (benEl && (!benEl.value || benEl.value.trim() === '')) {
          benEl.value = d.beneficiary;
        }
      }

      if (previewMatchTag) {
        previewMatchTag.innerText = `✨ Successfully extracted: ${d.instrument_type || 'Instrument'} #${d.instrument_number || ''} ${d.bank_name ? `(${d.bank_name})` : ''} - PKR ${d.amount ? Number(d.amount).toLocaleString() : ''}`;
      }
      showToast(`✓ Auto-populated from instrument: ${d.instrument_type || 'PO/CDR'} #${d.instrument_number || ''}`, 'success');
    } else {
      if (previewMatchTag) previewMatchTag.innerText = 'Scan uploaded. Please verify or fill remaining fields.';
    }
  } catch (parseErr) {
    console.warn('[Instrument Parsing Error]:', parseErr.message);
    if (previewMatchTag) previewMatchTag.innerText = 'Scan uploaded. Please fill details manually.';
  } finally {
    if (statusEl) statusEl.style.display = 'none';
  }
}
window.processInstrumentFile = processInstrumentFile;

async function submitBidSecurityForm() {
  let oppId = document.getElementById('sec-opportunity-id')?.value;
  const oppTitleInput = document.getElementById('sec-opp-title')?.value || '';
  const accountTitle = document.getElementById('sec-account-title')?.value;
  const beneficiary = document.getElementById('sec-beneficiary')?.value;
  const instrumentType = document.getElementById('sec-instrument-type')?.value;
  const instrumentNo = document.getElementById('sec-instrument-no')?.value;
  const amount = parseCurrency(document.getElementById('sec-amount')?.value);
  const expiryDate = document.getElementById('sec-expiry-date')?.value;
  const bankName = document.getElementById('sec-bank-name')?.value;
  const comments = document.getElementById('sec-comments')?.value;

  if (!accountTitle || !beneficiary || !instrumentType || !instrumentNo || !amount || !expiryDate) {
    alert('All first 6 fields are mandatory (Account Title, Beneficiary, Instrument Type, Instrument Number, Amount, Bid Security Date).');
    return;
  }

  // If oppId was not set (e.g. user typed directly into input), resolve from oppTitleInput
  if (!oppId && oppTitleInput.trim()) {
    try {
      const allOpps = await API.getOpportunities(State.currentBusinessProfileId);
      const cleanTitle = oppTitleInput.toLowerCase().trim();
      const matched = allOpps.find(o => 
        (o.opportunity_number && cleanTitle.includes(o.opportunity_number.toLowerCase())) ||
        (o.tender_name && cleanTitle.includes(o.tender_name.toLowerCase())) ||
        (o.title && cleanTitle.includes(o.title.toLowerCase()))
      );
      if (matched) {
        oppId = matched.id;
      }
    } catch (e) {}
  }

  let bizProfileId = document.getElementById('sec-business-profile-id')?.value;
  if (!bizProfileId && oppId) {
    const opps = State.getTenantEntityList('opportunities');
    const opp = opps.find(o => String(o.id) === String(oppId));
    if (opp?.business_profile_id) bizProfileId = opp.business_profile_id;
  }
  if (!bizProfileId && State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all') {
    bizProfileId = State.currentBusinessProfileId;
  }

  const res = await API.createBidSecurity({
    opportunity_id: oppId,
    business_profile_id: bizProfileId,
    account_title: accountTitle,
    beneficiary: beneficiary,
    instrument_type: instrumentType,
    instrument_number: instrumentNo,
    amount: amount,
    expiry_date: expiryDate,
    bank_name: bankName,
    comments: comments,
    instrument_image_url: _currentInstrumentDataUrl || null
  });

  if (!res || !res.success || !res.data?.id) {
    console.error('[ATTACH BID SECURITY FAILED]:', res);
    alert(`❌ Bid Security NOT saved in database!\n\nReason: ${res?.message || res?.error || 'Database rejected bid security record.'}`);
    return;
  }

  if (oppId) {
    const opps = State.getTenantEntityList('opportunities');
    const target = opps.find(o => String(o.id) === String(oppId));
    if (target) {
      target.active_bid_securities_count = (parseInt(target.active_bid_securities_count, 10) || 0) + 1;
      target.status = 'Ready to submit';
      State.saveTenantEntity('opportunities', target);
    }
  }

  clearInstrumentFile();
  closeModal('modal-add-bid-security');
  showToast('✓ Bid Security successfully saved in database! Tender is now Ready to Submit.', 'success');
  await renderActiveView();
}

async function handleReleaseBidSecurity(id) {
  const ref = prompt('Enter release reference number or letter note:', 'Release Handover Form # 104');
  if (ref) {
    const res = await API.releaseBidSecurity(id, ref);
    if (!res || res.success === false) {
      alert(`⚠️ Failed to release Bid Security: ${res?.message || 'Database error'}`);
      return;
    }
    // ── Business Rule: backend auto-detects PG and sets status accordingly ──
    const finalStatus = res?.data?.status || 'Released';
    if (finalStatus === 'PG Submitted') {
      alert('🏦 Bid Security marked as PG Submitted — an active Performance Guarantee exists for this tender. The bid security is now covered by the PG.');
    } else {
      alert('✓ Bid Security has been marked as Released in database.');
    }
    // ────────────────────────────────────────────────────────────────────────
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
    const subRes = await API.submitBid(bid.id, { submission_method: 'Online Portal' });
    if (!subRes || subRes.success === false) {
      alert(`⚠️ Failed to submit bid: ${subRes?.message || 'Database error'}`);
      return;
    }
    alert('✓ Bid submitted successfully with attached Bid Security!');
  } else {
    const subRes = await API.updateEntity('opportunity', oppId, { status: 'Submitted', stage: 'Submitted' });
    if (!subRes || subRes.success === false) {
      alert(`⚠️ Failed to mark tender as submitted: ${subRes?.message || 'Database error'}`);
      return;
    }
    alert('✓ Bid submitted successfully with attached Bid Security!');
  }
  await renderActiveView();
}

function promptWonBid(oppId, tenderNameDecoded) {
  promptAwardLetterModal(oppId, tenderNameDecoded);
}

let _cachedAwardTenderItems = [];
let _currentAwardRequiresStampDuty = true;

async function promptAwardLetterModal(oppId, tenderNameDecoded) {
  const form = document.getElementById('form-add-award');
  if (form) form.reset();
  const remEl = document.getElementById('award-remarks');
  if (remEl) remEl.value = '';

  let name = tenderNameDecoded || '';
  try {
    name = decodeURIComponent(tenderNameDecoded);
  } catch (_) {}
  document.getElementById('award-opp-id').value = oppId;

  // Fetch live line items & tender details for this opportunity
  let oppNumber = '';
  let items = [];
  let oppWorkflowGates = null;
  let targetOpp = null;
  try {
    const oppDetails = await API.getOpportunityById(oppId);
    if (oppDetails && oppDetails.data) {
      targetOpp = oppDetails.data;
      oppNumber = oppDetails.data.opportunity_number || '';
      oppWorkflowGates = oppDetails.data.workflow_gates || null;
      if (oppDetails.data.items && oppDetails.data.items.length > 0) {
        items = oppDetails.data.items;
      }
    }
  } catch (e) {
    console.warn('Could not fetch opp details from API:', e.message);
  }

  if (!targetOpp) {
    const opps = State.getTenantEntityList('opportunities') || [];
    targetOpp = opps.find(o => String(o.id) === String(oppId) || String(o.opportunity_number) === String(oppId));
  }
  if (!targetOpp) {
    try {
      const allOpps = await API.getOpportunities('all');
      if (Array.isArray(allOpps)) {
        targetOpp = allOpps.find(o => String(o.id) === String(oppId) || String(o.opportunity_number) === String(oppId));
      }
    } catch (_) {}
  }

  const bids = State.getTenantEntityList('bids') || [];
  let targetBid = bids.find(b => String(b.opportunity_id) === String(oppId) || String(b.id) === String(oppId));
  if (!targetBid) {
    try {
      const allBids = await API.getBids('all');
      if (Array.isArray(allBids)) {
        targetBid = allBids.find(b => String(b.opportunity_id) === String(oppId) || String(b.id) === String(oppId));
      }
    } catch (_) {}
  }

  if (!oppNumber && targetOpp) oppNumber = targetOpp.opportunity_number || '';
  if (!oppWorkflowGates && targetOpp) {
    oppWorkflowGates = targetOpp.workflow_gates || null;
  }

  let gates = oppWorkflowGates;
  if (typeof gates === 'string') {
    try { gates = JSON.parse(gates); } catch (_) { gates = null; }
  }

  const requiresStampDuty = gates ? (gates.requires_stamp_duty !== false && gates.requires_stamp_duty !== 'false' && gates.requires_stamp_duty !== 0) : true;
  _currentAwardRequiresStampDuty = requiresStampDuty;

  const sdGroup = document.getElementById('award-stamp-duty-group');
  const finRow = document.getElementById('award-financials-row');
  const sdPctInput = document.getElementById('award-stamp-duty-pct');
  const sdAmtInput = document.getElementById('award-stamp-duty-amount');

  if (!requiresStampDuty) {
    if (sdGroup) sdGroup.style.display = 'none';
    if (finRow) finRow.style.gridTemplateColumns = '1fr 1fr';
    if (sdPctInput) { sdPctInput.value = '0'; sdPctInput.required = false; }
    if (sdAmtInput) { sdAmtInput.value = '0'; sdAmtInput.required = false; }
  } else {
    if (sdGroup) sdGroup.style.display = 'block';
    if (finRow) finRow.style.gridTemplateColumns = '1fr 1fr 1fr';
    if (sdPctInput) { sdPctInput.value = '0.25'; sdPctInput.required = true; }
  }

  const oppTitleEl = document.getElementById('award-opp-title');
  if (oppTitleEl) {
    oppTitleEl.innerHTML = `${oppNumber ? `<span style="color:var(--primary); font-family:monospace;">[${oppNumber}]</span> ` : ''}${targetOpp?.tender_name || targetOpp?.title || name}`;
  }

  const cleanCode = (oppNumber || name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25);
  document.getElementById('award-no').value = `LOA-${cleanCode || 'GOVT'}-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
  document.getElementById('award-date').value = new Date().toISOString().slice(0, 10);
  
  const d = new Date();
  d.setDate(d.getDate() + 10);
  document.getElementById('award-deadline').value = d.toISOString().slice(0, 10);

  const fallbackVal = parseFloat(
    targetOpp?.estimated_value || 
    targetOpp?.budget_amount || 
    targetBid?.final_bid_price || 
    targetBid?.final_price || 
    targetBid?.supplier_cost_total || 
    0
  );

  if (!items || items.length === 0) {
    if (targetOpp && targetOpp.items && targetOpp.items.length > 0) {
      items = targetOpp.items;
    } else if (targetBid && targetBid.items && targetBid.items.length > 0) {
      items = targetBid.items;
    } else {
      items = [
        {
          id: 'it-1',
          item_name: targetOpp?.tender_name || targetOpp?.title || name,
          item_description: targetOpp?.tender_name || targetOpp?.title || name,
          quantity: 1,
          unit: 'LOT',
          estimated_unit_price: fallbackVal
        }
      ];
    }
  }

  if (items.length === 1) {
    const currentRate = parseFloat(items[0].estimated_unit_price || items[0].unit_price || items[0].rate || 0);
    if (currentRate === 0 && fallbackVal > 0) {
      const q = parseFloat(items[0].quantity) || 1;
      items[0].estimated_unit_price = fallbackVal / q;
    }
  }

  _cachedAwardTenderItems = items;

  const tbody = document.getElementById('award-items-tbody');
  if (tbody) {
    tbody.innerHTML = items.map((it, idx) => {
      const tenderQty = parseFloat(it.quantity || it.tender_quantity || 1);
      let itemRate = parseFloat(it.estimated_unit_price || it.unit_price || it.awarded_unit_price || it.rate || 0);
      if (itemRate === 0 && items.length === 1 && fallbackVal > 0) {
        itemRate = fallbackVal / tenderQty;
      }
      return `
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
          <span style="font-weight: 600;">${tenderQty} ${it.unit || 'PCS'}</span>
          <input type="hidden" id="award-item-tender-qty-${idx}" value="${tenderQty}">
          <input type="hidden" id="award-item-unit-${idx}" value="${it.unit || 'PCS'}">
        </td>
        <td>
          <input type="number" class="form-input" id="award-item-qty-${idx}" value="${tenderQty}" min="0" step="any" style="width: 100px; padding: 4px 6px; font-weight:700;" oninput="updateAwardItemsTotal()">
        </td>
        <td>${it.unit || 'PCS'}</td>
        <td>
          <input type="number" class="form-input" id="award-item-rate-${idx}" value="${itemRate}" min="0" step="any" style="width: 130px; padding: 4px 6px;" oninput="updateAwardItemsTotal()">
        </td>
        <td>
          <strong id="award-item-total-${idx}" style="color: #059669;">PKR ${(tenderQty * itemRate).toLocaleString()}</strong>
        </td>
      </tr>
    `;
    }).join('');
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

  updateAwardStampDutyCalc();
  calculatePBGRequirement();
}

function updateAwardStampDutyCalc() {
  if (!_currentAwardRequiresStampDuty) {
    const sdInput = document.getElementById('award-stamp-duty-amount');
    if (sdInput) sdInput.value = '0';
    const sdPct = document.getElementById('award-stamp-duty-pct');
    if (sdPct) sdPct.value = '0';
    return;
  }
  const amt = parseFloat(document.getElementById('award-amount')?.value || 0);
  const pct = parseFloat(document.getElementById('award-stamp-duty-pct')?.value || 0.25);
  const sdAmt = Math.round((amt * pct) / 100);
  const sdInput = document.getElementById('award-stamp-duty-amount');
  if (sdInput) sdInput.value = sdAmt.toLocaleString();
}

function calculatePBGRequirement(pct) {
  const pbgSelect = document.getElementById('award-pbg-pct');
  const selectedPct = parseFloat(pct !== undefined ? pct : (pbgSelect?.value || 10));
  const awardAmt = parseFloat(document.getElementById('award-amount')?.value || 0);
  const pbgAmt = Math.round((awardAmt * selectedPct) / 100);
  const pbgDisplay = document.getElementById('award-pbg-amount-display');
  if (pbgDisplay) {
    if (selectedPct > 0) {
      pbgDisplay.innerText = `PBG Required: PKR ${pbgAmt.toLocaleString()} (${selectedPct}% of Award Value)`;
    } else {
      pbgDisplay.innerText = 'No PBG required for this contract';
    }
  }
}

async function submitAwardLetterForm() {
  const oppId = document.getElementById('award-opp-id')?.value;
  const awardNo = document.getElementById('award-no')?.value;
  const awardDate = document.getElementById('award-date')?.value;
  const awardAmount = document.getElementById('award-amount')?.value;
  let deadline = document.getElementById('award-deadline')?.value || null;
  if (deadline && (!/^\d{4}-\d{2}-\d{2}/.test(deadline) || isNaN(new Date(deadline).getTime()))) {
    deadline = null;
  }
  const pbgPct = document.getElementById('award-pbg-pct')?.value;
  let stampDutyPct = 0;
  let stampDutyAmt = 0;
  let stampDutyStatus = 'Not Required';
  let stampDutyRequired = false;

  if (_currentAwardRequiresStampDuty) {
    stampDutyPct = parseFloat(document.getElementById('award-stamp-duty-pct')?.value || 0.25);
    stampDutyAmt = parseCurrency(document.getElementById('award-stamp-duty-amount')?.value);
    stampDutyStatus = 'Unpaid';
    stampDutyRequired = true;
  }

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
    opportunity_number: targetOpp?.opportunity_number,
    tender_name: targetOpp?.title || targetOpp?.tender_name || 'Won Tender',
    customer_id: targetCust?.id,
    customer_name: targetCust?.business_name || 'Government Department',
    award_number: awardNo,
    award_date: awardDate,
    award_amount: parseFloat(awardAmount),
    acceptance_deadline: deadline,
    status: 'Accepted',
    pbg_required_pct: parseFloat(pbgPct || 10),
    stamp_duty_required: stampDutyRequired,
    stamp_duty_pct: stampDutyPct,
    stamp_duty_amount: stampDutyAmt,
    stamp_duty_status: stampDutyStatus,
    items: awardItems,
    remarks: remarks
  });

  if (!res || !res.success || !res.data?.id) {
    console.error('[AWARD REGISTRATION FAILED]:', res);
    alert(`⚠️ Failed to record Letter of Award: ${res?.message || res?.error || 'Database error. Record was NOT saved.'}`);
    return;
  }

  // Automatically initialize contract
  await API.createContract({
    opportunity_id: oppId,
    award_letter_id: res.data.id,
    customer_id: targetCust?.id,
    contract_number: 'CNT-' + awardNo.replace('LOA-', ''),
    contract_value: parseFloat(awardAmount),
    start_date: awardDate,
    status: 'Active',
    stamp_duty_required: stampDutyRequired,
    stamp_duty_rate_pct: stampDutyPct,
    stamp_duty_amount: stampDutyAmt
  });

  closeModal('modal-add-award');
  showToast(`✓ Letter of Award ${awardNo} recorded & accepted in database. Contract initialized!`, 'success');

  // Prompt PBG Modal if PBG % > 0
  if (parseFloat(pbgPct) > 0) {
    const pbgVal = (parseFloat(awardAmount) * parseFloat(pbgPct)) / 100;
    promptAttachPBGForAward(res.data?.id || 'al-new', awardNo, pbgVal);
  } else {
    navigateToView('awards');
  }
}

function openStampDutyModal(awardId, awardNo, amount) {
  const form = document.getElementById('form-record-stamp-duty');
  if (form) form.reset();

  const awardEl = document.getElementById('sd-award-id');
  const awardNoEl = document.getElementById('sd-award-no');
  const amtEl = document.getElementById('sd-amount');
  const dateEl = document.getElementById('sd-paid-date');
  const chnEl = document.getElementById('sd-challan-no');
  const bankEl = document.getElementById('sd-bank');

  if (awardEl) awardEl.value = awardId;
  if (awardNoEl) awardNoEl.value = awardNo;
  if (amtEl) amtEl.value = (parseFloat(amount) || 0).toLocaleString();
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  if (chnEl) chnEl.value = 'CHN-32A-' + Math.floor(100000 + Math.random() * 900000);
  if (bankEl) bankEl.value = 'National Bank of Pakistan (NBP) Main Branch';

  openModal('modal-record-stamp-duty');
}

async function submitStampDutyPayment() {
  const awardId = document.getElementById('sd-award-id')?.value;
  const challanNo = document.getElementById('sd-challan-no')?.value;
  const paidDate = document.getElementById('sd-paid-date')?.value;
  const amount = parseCurrency(document.getElementById('sd-amount')?.value);
  const bank = document.getElementById('sd-bank')?.value;

  if (!challanNo || !paidDate || amount <= 0) {
    alert('Challan Number, Payment Date, and Amount Paid are mandatory.');
    return;
  }

  const payload = {
    stamp_duty_status: 'Paid',
    stamp_duty_challan_no: challanNo,
    stamp_duty_paid_date: paidDate,
    stamp_duty_amount: amount,
    stamp_duty_bank: bank
  };

  const res = await API.recordAwardStampDuty(awardId, payload);
  if (!res || !res.success) {
    console.error('[STAMP DUTY PAYMENT FAILED]:', res);
    alert(`❌ Failed to record Stamp Duty in database:\n${res?.message || res?.error || 'Server error'}`);
    return;
  }

  const awards = State.getTenantEntityList('awards');
  const award = awards.find(a => a.id === awardId);
  if (award) {
    award.stamp_duty_status = 'Paid';
    award.stamp_duty_challan_no = challanNo;
    award.stamp_duty_paid_date = paidDate;
    award.stamp_duty_amount = amount;
    award.stamp_duty_bank = bank;
    State.saveTenantEntity('awards', award);
  }

  closeModal('modal-record-stamp-duty');
  showToast(`✓ Stamp Duty E-Challan #${challanNo} recorded as Paid in database!`, 'success');
  await renderActiveView();
}

// ============================================================================
// PERFORMANCE GUARANTEE (PBG) CONTROLLER & DRAG-AND-DROP SCANNER
// Replicating Bid Security screen architecture & field structure (Separate DB entity)
// ============================================================================
let _currentPBGInstrumentDataUrl = null;
let _currentPBGBasisValue = 0;

function handlePBGInstrumentFileSelect(event) {
  const file = event.target.files?.[0];
  if (file) {
    processPBGInstrumentFile(file);
  }
}
window.handlePBGInstrumentFileSelect = handlePBGInstrumentFileSelect;

function handlePBGInstrumentDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('pbg-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#2563eb';
    dropzone.style.background = '#eff6ff';
  }
}
window.handlePBGInstrumentDragOver = handlePBGInstrumentDragOver;

function handlePBGInstrumentDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('pbg-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#94a3b8';
    dropzone.style.background = '#f8fafc';
  }
}
window.handlePBGInstrumentDragLeave = handlePBGInstrumentDragLeave;

function handlePBGInstrumentDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('pbg-upload-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = '#94a3b8';
    dropzone.style.background = '#f8fafc';
  }
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    processPBGInstrumentFile(file);
  }
}
window.handlePBGInstrumentDrop = handlePBGInstrumentDrop;

function clearPBGInstrumentFile() {
  _currentPBGInstrumentDataUrl = null;
  const fileInput = document.getElementById('pbg-instrument-file');
  if (fileInput) fileInput.value = '';

  const preview = document.getElementById('pbg-preview-container');
  if (preview) preview.style.display = 'none';

  const statusEl = document.getElementById('pbg-scan-status');
  if (statusEl) statusEl.style.display = 'none';

  const imgEl = document.getElementById('pbg-preview-img');
  if (imgEl) imgEl.src = '';
}
window.clearPBGInstrumentFile = clearPBGInstrumentFile;

async function processPBGInstrumentFile(file) {
  if (!file) return;

  const statusEl = document.getElementById('pbg-scan-status');
  const statusText = document.getElementById('pbg-scan-status-text');
  const previewContainer = document.getElementById('pbg-preview-container');
  const previewImg = document.getElementById('pbg-preview-img');
  const previewFilename = document.getElementById('pbg-preview-filename');
  const previewMatchTag = document.getElementById('pbg-preview-match-tag');

  const reader = new FileReader();
  reader.onload = async (e) => {
    _currentPBGInstrumentDataUrl = e.target.result;
    if (previewImg && file.type.startsWith('image/')) {
      previewImg.src = _currentPBGInstrumentDataUrl;
      previewImg.style.display = 'block';
    } else if (previewImg) {
      previewImg.style.display = 'none';
    }
    if (previewFilename) previewFilename.innerText = file.name;
    if (previewContainer) previewContainer.style.display = 'flex';
  };
  reader.readAsDataURL(file);

  if (statusEl) statusEl.style.display = 'block';
  if (statusText) statusText.innerText = 'Scanning & reading PBG instrument with OCR...';

  let rawExtractedText = '';
  try {
    if (typeof Tesseract !== 'undefined' && file.type.startsWith('image/')) {
      const ocrResult = await Tesseract.recognize(file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && statusText) {
            const pct = Math.round((m.progress || 0) * 100);
            statusText.innerText = `Extracting instrument text with OCR (${pct}%)...`;
          }
        }
      });
      rawExtractedText = ocrResult?.data?.text || '';
    }
  } catch (ocrErr) {
    console.warn('[OCR PBG Warning]:', ocrErr.message);
  }

  try {
    if (statusText) statusText.innerText = 'Analyzing Pakistani banking guarantee data...';
    const parseRes = await API.parseBidSecurityInstrument({
      raw_text: rawExtractedText,
      filename: file.name
    });

    if (parseRes && parseRes.success && parseRes.data) {
      const d = parseRes.data;
      if (d.instrument_type) {
        const typeEl = document.getElementById('pg-instrument-type');
        if (typeEl) typeEl.value = d.instrument_type === 'PO' || d.instrument_type === 'CDR' ? d.instrument_type : 'BG';
      }
      if (d.instrument_number) {
        const noEl = document.getElementById('pg-number');
        if (noEl) noEl.value = d.instrument_number;
      }
      if (d.bank_name) {
        const bankEl = document.getElementById('pg-bank');
        if (bankEl) {
          bankEl.value = d.bank_branch ? `${d.bank_name} (${d.bank_branch})` : d.bank_name;
        }
      }
      if (d.amount && d.amount > 0) {
        const amtEl = document.getElementById('pg-amount');
        if (amtEl) {
          amtEl.value = Number(d.amount).toLocaleString();
          formatCurrencyInput(amtEl);
        }
      }
      if (d.date) {
        const dateEl = document.getElementById('pg-expiry');
        if (dateEl) {
          dateEl.value = d.date;
          try { initCustomDateTimePickers(); } catch (e) {}
        }
      }
      if (d.beneficiary) {
        const benEl = document.getElementById('pg-beneficiary');
        if (benEl && (!benEl.value || benEl.value.trim() === '')) {
          benEl.value = d.beneficiary;
        }
      }

      if (previewMatchTag) {
        previewMatchTag.innerText = `✨ Successfully extracted: ${d.instrument_type || 'PBG'} #${d.instrument_number || ''} ${d.bank_name ? `(${d.bank_name})` : ''} - PKR ${d.amount ? Number(d.amount).toLocaleString() : ''}`;
      }
      showToast(`✓ Auto-populated from guarantee: ${d.instrument_type || 'PBG'} #${d.instrument_number || ''}`, 'success');
    } else {
      if (previewMatchTag) previewMatchTag.innerText = 'Scan uploaded. Please verify or fill remaining fields.';
    }
  } catch (parseErr) {
    console.warn('[PBG Parsing Error]:', parseErr.message);
    if (previewMatchTag) previewMatchTag.innerText = 'Scan uploaded. Please fill details manually.';
  } finally {
    if (statusEl) statusEl.style.display = 'none';
  }
}
window.processPBGInstrumentFile = processPBGInstrumentFile;

async function handlePBGTargetSearch(query) {
  const suggestionsBox = document.getElementById('pg-target-suggestions');
  if (!suggestionsBox) return;

  const [awards, contracts, opps] = await Promise.all([
    API.getAwards().catch(() => []),
    API.getContracts().catch(() => []),
    API.getOpportunities(State.currentBusinessProfileId).catch(() => [])
  ]);

  const candidates = [];

  // Add Awards
  (awards || []).forEach(a => {
    candidates.push({
      targetType: 'award',
      id: a.id,
      awardId: a.id,
      contractId: null,
      oppId: a.opportunity_id || null,
      bizProfileId: a.business_profile_id || null,
      refNo: a.award_number || 'LOA',
      title: a.tender_name || a.opportunity_title || 'Won Award',
      customerName: a.customer_name || '',
      totalVal: parseFloat(a.award_amount || 0)
    });
  });

  // Add Contracts
  (contracts || []).forEach(c => {
    candidates.push({
      targetType: 'contract',
      id: c.id,
      awardId: c.award_letter_id || null,
      contractId: c.id,
      oppId: c.opportunity_id || null,
      bizProfileId: c.business_profile_id || null,
      refNo: c.contract_number || 'CNT',
      title: c.title || c.tender_name || 'Contract Agreement',
      customerName: c.customer_name || '',
      totalVal: parseFloat(c.contract_value || 0)
    });
  });

  // Add Won Tenders that don't have awards yet
  (opps || []).filter(o => o.stage === 'Won' || o.status === 'Won').forEach(o => {
    if (!candidates.some(c => c.oppId === o.id)) {
      candidates.push({
        targetType: 'opportunity',
        id: o.id,
        awardId: null,
        contractId: null,
        oppId: o.id,
        bizProfileId: o.business_profile_id || null,
        refNo: o.opportunity_number || 'TND',
        title: o.tender_name || o.title || 'Won Tender',
        customerName: o.customer_name || '',
        totalVal: parseFloat(o.estimated_value || 0)
      });
    }
  });

  const cleanQuery = (query || '').toLowerCase().trim();
  const matched = cleanQuery 
    ? candidates.filter(c => 
        c.refNo.toLowerCase().includes(cleanQuery) ||
        c.title.toLowerCase().includes(cleanQuery) ||
        c.customerName.toLowerCase().includes(cleanQuery)
      )
    : candidates;

  if (matched.length === 0) {
    suggestionsBox.innerHTML = `
      <div style="padding:10px; color:#64748b; font-size:0.8rem; text-align:center;">
        No awards, contracts, or won tenders found matching "${query || ''}"
      </div>
    `;
    suggestionsBox.style.display = 'block';
    return;
  }

  suggestionsBox.innerHTML = matched.slice(0, 10).map(c => `
    <div class="autocomplete-item" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background 0.2s;" 
         onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'"
         onclick="selectTargetForPBG('${c.targetType}', '${c.id}', '${encodeURIComponent(c.title)}', '${encodeURIComponent(c.refNo)}', ${c.totalVal}, '${encodeURIComponent(c.customerName)}', '${c.oppId || ''}', '${c.bizProfileId || ''}')">
      <div style="font-weight:700; font-size:0.85rem; color:#0f172a;">
        [${c.refNo}] ${c.title}
      </div>
      <div style="font-size:0.75rem; color:#64748b; display:flex; justify-content:space-between; margin-top:2px;">
        <span>Customer: <strong>${c.customerName || 'Department'}</strong></span>
        <span style="color:#059669; font-weight:600;">Value: ${formatCurrency(c.totalVal, 'PKR')}</span>
      </div>
    </div>
  `).join('');
  suggestionsBox.style.display = 'block';
}
window.handlePBGTargetSearch = handlePBGTargetSearch;

function selectTargetForPBG(targetType, id, titleEnc, refNoEnc, totalVal, customerNameEnc, oppId = '', bizProfileId = '') {
  const title = decodeURIComponent(titleEnc || '');
  const refNo = decodeURIComponent(refNoEnc || '');
  const customerName = decodeURIComponent(customerNameEnc || '');

  const titleEl = document.getElementById('pg-target-title');
  if (titleEl) titleEl.value = refNo ? `[${refNo}] ${title}` : title;

  const contractIdEl = document.getElementById('pg-contract-id');
  const awardIdEl = document.getElementById('pg-award-id');
  const oppIdEl = document.getElementById('pg-opportunity-id');
  const bizEl = document.getElementById('pg-business-profile-id');

  if (targetType === 'contract') {
    if (contractIdEl) contractIdEl.value = id;
  } else if (targetType === 'award') {
    if (awardIdEl) awardIdEl.value = id;
    if (contractIdEl) contractIdEl.value = id;
  } else if (targetType === 'opportunity') {
    if (oppIdEl) oppIdEl.value = id;
  }
  if (oppId && oppIdEl) oppIdEl.value = oppId;
  if (bizProfileId && bizEl) bizEl.value = bizProfileId;

  _currentPBGBasisValue = totalVal || 0;
  const basisHint = document.getElementById('pg-calc-basis-hint');
  if (basisHint) {
    basisHint.innerText = _currentPBGBasisValue > 0
      ? `Based on value: ${formatCurrency(_currentPBGBasisValue, 'PKR')} — use % buttons above to calculate`
      : 'Based on award / contract value';
  }

  // Only the title and IDs are pre-filled. All instrument fields (Beneficiary,
  // Account Title, Instrument No, Amount, Bank, Date) must be entered by the user.

  const suggestionsBox = document.getElementById('pg-target-suggestions');
  if (suggestionsBox) suggestionsBox.style.display = 'none';
}
window.selectTargetForPBG = selectTargetForPBG;

function applyPBGModalPct(pct) {
  if (!_currentPBGBasisValue || _currentPBGBasisValue <= 0) {
    alert('Please select an Award, Contract, or Won Tender first to calculate the percentage amount.');
    return;
  }
  const calculatedAmt = Math.round(_currentPBGBasisValue * (pct / 100));
  const amtEl = document.getElementById('pg-amount');
  if (amtEl) {
    amtEl.value = calculatedAmt.toLocaleString();
    formatCurrencyInput(amtEl);
  }
}
window.applyPBGModalPct = applyPBGModalPct;

function promptAttachPBGForAward(awardId, awardNo = '', pbgAmount = 0, oppId = '', custName = '', totalVal = 0) {
  clearPBGInstrumentFile();

  // Reset the full form first so no stale values remain
  const form = document.getElementById('form-add-guarantee');
  if (form) form.reset();
  const bsChk = document.getElementById('pg-bid-security-included');
  if (bsChk) bsChk.checked = false;
  clearPBGInstrumentFile();

  const contractIdEl = document.getElementById('pg-contract-id');
  const awardIdEl    = document.getElementById('pg-award-id');
  const oppIdEl      = document.getElementById('pg-opportunity-id');
  const bizProfileIdEl = document.getElementById('pg-business-profile-id');
  const titleEl      = document.getElementById('pg-target-title');

  // CRITICAL: Clear contractIdEl first — awardId is NOT a contract_id!
  if (contractIdEl) contractIdEl.value = '';
  if (awardIdEl)    awardIdEl.value    = awardId || '';
  if (oppIdEl)      oppIdEl.value      = oppId   || '';
  if (bizProfileIdEl) bizProfileIdEl.value = '';

  // Look up matching award in state/cache to resolve contract, opp, and bizProfile IDs
  if (awardId) {
    try {
      const awards = State.getTenantEntityList('awards') || [];
      const matchedAward = awards.find(a => String(a.id) === String(awardId));
      if (matchedAward) {
        if (!awardNo && matchedAward.award_number) awardNo = matchedAward.award_number;
        if (!oppId && matchedAward.opportunity_id) {
          oppId = matchedAward.opportunity_id;
          if (oppIdEl) oppIdEl.value = oppId;
        }
        if (matchedAward.business_profile_id && bizProfileIdEl) {
          bizProfileIdEl.value = matchedAward.business_profile_id;
        }
        if (!totalVal && matchedAward.award_amount) totalVal = parseFloat(matchedAward.award_amount);
        if (matchedAward.contract_id && contractIdEl) {
          contractIdEl.value = matchedAward.contract_id;
        }
      }
      if (contractIdEl && !contractIdEl.value) {
        const contracts = State.getTenantEntityList('contracts') || [];
        const matchedContract = contracts.find(c => String(c.award_letter_id) === String(awardId));
        if (matchedContract) contractIdEl.value = matchedContract.id;
      }
    } catch (e) {}
  }

  // Only pre-fill the Award / Tender title field — everything else is left blank
  // for the user to enter from the actual physical instrument.
  if (awardNo) {
    if (titleEl) titleEl.value = `[${awardNo}] Award Letter`;
  } else {
    if (titleEl) titleEl.value = '';
  }

  // Store the basis value so the % auto-calculate buttons work when clicked
  _currentPBGBasisValue = totalVal || (pbgAmount ? pbgAmount * 10 : 0);
  const basisHint = document.getElementById('pg-calc-basis-hint');
  if (basisHint) {
    basisHint.innerText = _currentPBGBasisValue > 0
      ? `Based on value: ${formatCurrency(_currentPBGBasisValue, 'PKR')} — use % buttons above to calculate`
      : 'Based on award / contract value';
  }

  try { initCustomDateTimePickers(); } catch (e) {}
  openModal('modal-add-guarantee');
}
window.promptAttachPBGForAward = promptAttachPBGForAward;

async function submitPerformanceGuaranteeForm() {
  let contractId = document.getElementById('pg-contract-id')?.value || null;
  let awardId = document.getElementById('pg-award-id')?.value || null;
  let oppId = document.getElementById('pg-opportunity-id')?.value || null;
  let bizProfileId = document.getElementById('pg-business-profile-id')?.value || null;
  const targetTitle = document.getElementById('pg-target-title')?.value || '';

  // Crucial guard: If contractId was mistakenly set to awardId, null it out
  if (contractId && contractId === awardId) {
    contractId = null;
  }

  // Fallback target resolution if user typed title manually without selecting suggestion
  if (!awardId && !contractId && targetTitle.trim()) {
    try {
      const awards = State.getTenantEntityList('awards') || [];
      const cleanTitle = targetTitle.toLowerCase().trim();
      const matchedAward = awards.find(a => 
        (a.award_number && cleanTitle.includes(a.award_number.toLowerCase())) ||
        (a.opportunity_number && cleanTitle.includes(a.opportunity_number.toLowerCase())) ||
        (a.tender_name && cleanTitle.includes(a.tender_name.toLowerCase()))
      );
      if (matchedAward) {
        awardId = matchedAward.id;
        oppId = oppId || matchedAward.opportunity_id;
        bizProfileId = bizProfileId || matchedAward.business_profile_id;
        if (matchedAward.contract_id) contractId = matchedAward.contract_id;
      }
    } catch (e) {}
  }

  const accountTitle = document.getElementById('pg-account-title')?.value;
  const beneficiary = document.getElementById('pg-beneficiary')?.value;
  const instrumentType = document.getElementById('pg-instrument-type')?.value;
  const instrumentNo = document.getElementById('pg-number')?.value;
  const amount = parseCurrency(document.getElementById('pg-amount')?.value);
  const expiryDate = document.getElementById('pg-expiry')?.value;
  const bankName = document.getElementById('pg-bank')?.value || 'Meezan Bank Ltd Corporate Branch';
  const remarks = document.getElementById('pg-remarks')?.value;

  // Exact 6 mandatory fields matching Bid Security
  if (!accountTitle || !beneficiary || !instrumentType || !instrumentNo || !amount || !expiryDate) {
    alert('All first 6 fields are mandatory (Account Title, Beneficiary, Instrument Type, Instrument Number, Amount, Performance Guarantee Date).');
    return;
  }

  if (!bizProfileId && State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all') {
    bizProfileId = State.currentBusinessProfileId;
  }

  // ── Read the "Bid Security Included in PG" checkbox ─────────────────────
  const bidSecurityIncluded = document.getElementById('pg-bid-security-included')?.checked || false;
  // ─────────────────────────────────────────────────────────────────────────

  const res = await API.createGuarantee({
    contract_id: contractId || null,
    award_letter_id: awardId || null,
    opportunity_id: oppId || null,
    business_profile_id: bizProfileId || null,
    account_title: accountTitle,
    beneficiary: beneficiary,
    instrument_type: instrumentType,
    instrument_number: instrumentNo,
    guarantee_number: instrumentNo,
    amount: amount,
    expiry_date: expiryDate,
    bank_name: bankName,
    bank_branch: bankName,
    comments: remarks,
    remarks: remarks,
    instrument_image_url: _currentPBGInstrumentDataUrl || null,
    status: 'Active',
    bid_security_included: bidSecurityIncluded  // ← business rule flag
  });

  if (!res || !res.success || !res.data?.id) {
    console.error('[ATTACH PERFORMANCE GUARANTEE FAILED]:', res);
    alert(`❌ Performance Guarantee NOT saved in database!\n\nReason: ${res?.message || res?.error || 'Database rejected guarantee record.'}`);
    return;
  }

  clearPBGInstrumentFile();
  // Reset the bid security included checkbox for next use
  const bsChk = document.getElementById('pg-bid-security-included');
  if (bsChk) bsChk.checked = false;
  closeModal('modal-add-guarantee');
  const pgToastMsg = bidSecurityIncluded
    ? `✓ Performance Guarantee ${instrumentNo} issued! Bid Security marked as 🏦 PG Submitted.`
    : `✓ Performance Guarantee ${instrumentNo} issued successfully in database!`;
  showToast(pgToastMsg, 'success');
  await renderActiveView();
}
window.submitPerformanceGuaranteeForm = submitPerformanceGuaranteeForm;

async function handleAwardDecision(awardId, decision) {
  await API.decideAward(awardId, decision);
  showToast(`Award Letter marked as ${decision}.`, 'info');
  await renderActiveView();
}
window.handleAwardDecision = handleAwardDecision;

async function handleReleaseGuarantee(id) {
  const ref = prompt('Enter release reference number or letter note:', 'PBG Release & Handover Certificate # 205');
  if (ref) {
    const res = await API.releaseGuarantee(id, {
      release_reference: ref,
      comments: `Released: ${ref}`,
      release_date: new Date().toISOString().split('T')[0]
    });
    if (!res || res.success === false) {
      alert(`⚠️ Failed to release Performance Guarantee: ${res?.message || 'Database error'}`);
      return;
    }
    showToast('✓ Performance Guarantee has been marked as Released in database.', 'success');
    await renderActiveView();
  }
}
window.handleReleaseGuarantee = handleReleaseGuarantee;

// --------------------------------------------------------------------------
// MULTI-PURCHASE ORDER (1 AWARD -> N POs) ENGINE (WITH UNIVERSAL GST)
// --------------------------------------------------------------------------

let _cachedPOAward = null;
let _cachedPOAwardItems = [];

async function openNewPOModal(preselectedAwardId) {
  // Fully reset the form so no stale data from a previous session shows
  const form = document.getElementById('form-add-po');
  if (form) form.reset();

  // Clear all IDs and display elements
  ['po-award-id','po-opp-id','po-cust-id','po-number','po-date',
   'po-deadline','po-delivery-location','po-department','po-remarks',
   'po-subtotal-amount','po-gst-amount','po-total-amount'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });

  const refEl  = document.getElementById('po-award-ref-display');
  const custEl = document.getElementById('po-cust-name-display');
  if (refEl)  refEl.innerText = '';
  if (custEl) custEl.innerText = '';

  const infoPanel = document.getElementById('po-award-info-panel');
  if (infoPanel) infoPanel.style.display = 'none';

  const searchEl = document.getElementById('po-award-search');
  if (searchEl) { searchEl.value = ''; searchEl.readOnly = false; }

  const suggestionsEl = document.getElementById('po-award-suggestions');
  if (suggestionsEl) suggestionsEl.style.display = 'none';

  const tbody = document.getElementById('po-allocation-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px; font-size:0.85rem;">\u2190 Select an Award above to load item quantities</td></tr>`;

  _cachedPOAward = null;
  _cachedPOAwardItems = [];

  // If opened from Awards screen with a specific award pre-selected, load it immediately
  if (preselectedAwardId) {
    const awards = await API.getAwards();
    const selectedAward = awards.find(a => String(a.id) === String(preselectedAwardId));
    if (selectedAward) {
      if (searchEl) {
        searchEl.value = `[${selectedAward.award_number}] ${selectedAward.tender_name || 'Award Letter'}`;
        searchEl.readOnly = true;
      }
      await selectAwardForPO(selectedAward);
    }
  }

  openModal('modal-add-po');
}

// ── Award search autocomplete for PO modal ───────────────────────────────────
async function handlePOAwardSearch(query) {
  const suggestionsBox = document.getElementById('po-award-suggestions');
  if (!suggestionsBox) return;

  let awards = [];
  try { awards = await API.getAwards(); } catch (e) { awards = State.getTenantEntityList('awards') || []; }

  const eligible = awards.filter(a => a.status === 'Accepted' || a.status === 'Pending' || !a.status);
  const cleanQuery = (query || '').toLowerCase().trim();
  const matched = cleanQuery
    ? eligible.filter(a =>
        (a.award_number  && a.award_number.toLowerCase().includes(cleanQuery)) ||
        (a.tender_name   && a.tender_name.toLowerCase().includes(cleanQuery))  ||
        (a.customer_name && a.customer_name.toLowerCase().includes(cleanQuery))
      )
    : eligible;

  if (matched.length === 0) {
    suggestionsBox.innerHTML = `<div style="padding:10px; color:#64748b; font-size:0.8rem; text-align:center;">No accepted awards found${cleanQuery ? ` for "${query}"` : ''}.</div>`;
    suggestionsBox.style.display = 'block';
    return;
  }

  suggestionsBox.innerHTML = matched.slice(0, 10).map(a => `
    <div class="autocomplete-item" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background 0.2s;"
         onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'"
         onclick="selectAwardForPOById('${a.id}')">
      <div style="font-weight:700; font-size:0.85rem; color:#0f172a;">
        [${a.award_number || 'LOA'}] ${a.tender_name || 'Award Letter'}
      </div>
      <div style="font-size:0.75rem; color:#64748b; display:flex; justify-content:space-between; margin-top:2px;">
        <span>Customer: <strong>${a.customer_name || 'Government Client'}</strong></span>
        <span style="color:#059669; font-weight:600;">${formatCurrency(a.award_amount || a.contract_value || 0, 'PKR')}</span>
      </div>
    </div>
  `).join('');
  suggestionsBox.style.display = 'block';
}
window.handlePOAwardSearch = handlePOAwardSearch;

async function selectAwardForPOById(awardId) {
  const suggestionsBox = document.getElementById('po-award-suggestions');
  if (suggestionsBox) suggestionsBox.style.display = 'none';

  let awards = [];
  try { awards = await API.getAwards(); } catch (e) { awards = State.getTenantEntityList('awards') || []; }
  const award = awards.find(a => String(a.id) === String(awardId));
  if (!award) return;

  const searchEl = document.getElementById('po-award-search');
  if (searchEl) searchEl.value = `[${award.award_number}] ${award.tender_name || 'Award Letter'}`;

  await selectAwardForPO(award);
}
window.selectAwardForPOById = selectAwardForPOById;

// ── Populate all PO fields after an award is chosen ─────────────────────────
async function selectAwardForPO(selectedAward) {
  _cachedPOAward = selectedAward;

  let targetCustId = selectedAward.customer_id || '';
  let targetBizId  = selectedAward.business_profile_id || '';
  if (!targetCustId && selectedAward.opportunity_id) {
    const allOpps    = State.getTenantEntityList('opportunities');
    const matchedOpp = allOpps.find(o => String(o.id) === String(selectedAward.opportunity_id));
    if (matchedOpp) {
      if (matchedOpp.customer_id)         targetCustId = matchedOpp.customer_id;
      if (matchedOpp.business_profile_id) targetBizId  = matchedOpp.business_profile_id;
    }
  }

  document.getElementById('po-award-id').value = selectedAward.id;
  document.getElementById('po-opp-id').value   = selectedAward.opportunity_id || '';
  document.getElementById('po-cust-id').value  = targetCustId;

  const refEl  = document.getElementById('po-award-ref-display');
  const custEl = document.getElementById('po-cust-name-display');
  if (refEl)  refEl.innerText  = `${selectedAward.award_number} (${selectedAward.tender_name || 'Project'})`;
  if (custEl) custEl.innerText = `Customer: ${selectedAward.customer_name || 'Government Client'}`;

  const infoPanel = document.getElementById('po-award-info-panel');
  if (infoPanel) infoPanel.style.display = 'block';

  // Compute PO sequence from existing POs for this award
  const existingPOs = State.getTenantEntityList('purchaseOrders');
  const childPOs    = existingPOs.filter(p =>
    p.award_letter_id === selectedAward.id ||
    p.opportunity_id  === selectedAward.opportunity_id
  );
  const nextPoSeq = childPOs.length + 1;

  // Only pre-fill PO number (auto-sequence) — all other fields left blank for manual entry
  document.getElementById('po-number').value   = `PO-${String(nextPoSeq).padStart(3, '0')}`;
  document.getElementById('po-date').value     = '';
  document.getElementById('po-deadline').value = '';

  const gstRateInput = document.getElementById('po-gst-rate');
  if (gstRateInput) gstRateInput.value = '18';

  // Build items allocation table
  let awardItems = selectedAward.items || [];
  if (awardItems.length === 0) {
    awardItems = [{
      id: 'ai-default-1',
      item_name: selectedAward.tender_name || 'Supply',
      awarded_quantity: 1,
      unit: 'LOT',
      awarded_unit_price: parseFloat(selectedAward.awarded_value || selectedAward.contract_value || 0)
    }];
  }
  _cachedPOAwardItems = awardItems.filter(i => i.is_awarded !== false);

  const tbody = document.getElementById('po-allocation-tbody');
  if (tbody) {
    tbody.innerHTML = _cachedPOAwardItems.map((it, idx) => {
      let priorAllocated = 0;
      childPOs.forEach(p => {
        if (p.items && Array.isArray(p.items)) {
          const match = p.items.find(pi => pi.item_name === it.item_name || pi.award_item_id === it.id);
          if (match) priorAllocated += parseFloat(match.quantity || 0);
        }
      });

      const maxRemaining    = Math.max(0, (parseFloat(it.awarded_quantity || it.quantity || 1) - priorAllocated));
      const defaultAllocate = maxRemaining > 0 ? maxRemaining : 0;
      const rate            = parseFloat(it.awarded_unit_price || it.unit_price || 0);

      return `
        <tr>
          <td>
            <strong>${it.item_name || it.item_description}</strong><br>
            <span style="font-size:0.75rem; color:#64748b;">Awarded Spec Item</span>
            <input type="hidden" id="po-item-name-${idx}"     value="${escapeHtml(it.item_name || it.item_description || '')}">
            <input type="hidden" id="po-item-award-id-${idx}" value="${it.id || ''}">
            <input type="hidden" id="po-item-prod-id-${idx}"  value="${it.product_service_id || ''}">
            <input type="hidden" id="po-item-unit-${idx}"     value="${it.unit || 'PCS'}">
          </td>
          <td>${parseFloat(it.awarded_quantity || it.quantity || 1).toLocaleString()} ${it.unit || 'PCS'}</td>
          <td style="color:#2563eb; font-weight:600;">${priorAllocated.toLocaleString()}</td>
          <td>
            <input type="number" class="form-input" id="po-item-qty-${idx}"
                   value="${defaultAllocate}" min="0" max="${maxRemaining + priorAllocated}" step="any"
                   style="width:90px; padding:4px 6px; font-weight:700;"
                   oninput="recalculatePOMarginsAndTotals()">
          </td>
          <td>
            <input type="number" class="form-input" id="po-item-rate-${idx}"
                   value="${rate}" step="any" readonly
                   style="width:110px; padding:4px 6px; background:#f8fafc; font-size:0.8rem;">
          </td>
          <td id="po-item-subtotal-${idx}" style="font-weight:700; text-align:right;">
            PKR ${(defaultAllocate * rate).toLocaleString()}
          </td>
        </tr>
      `;
    }).join('');
  }

  recalculatePOMarginsAndTotals();
}
window.selectAwardForPO = selectAwardForPO;


function recalculatePOMarginsAndTotals() {
  let subtotalSum = 0;
  _cachedPOAwardItems.forEach((it, idx) => {
    const qty = parseFloat(document.getElementById(`po-item-qty-${idx}`)?.value || 0);
    const rate = parseFloat(document.getElementById(`po-item-rate-${idx}`)?.value || 0);
    const lineTotal = qty * rate;
    subtotalSum += lineTotal;

    const lineTotalEl = document.getElementById(`po-item-subtotal-${idx}`);
    if (lineTotalEl) lineTotalEl.innerText = 'PKR ' + lineTotal.toLocaleString();
  });

  const gstRate = parseFloat(document.getElementById('po-gst-rate')?.value || 18);
  const gstAmount = (subtotalSum * gstRate) / 100;
  const grandTotal = subtotalSum + gstAmount;

  const subtotalEl = document.getElementById('po-subtotal-amount');
  const gstAmtEl = document.getElementById('po-gst-amount');
  const totalEl = document.getElementById('po-total-amount');

  if (subtotalEl) subtotalEl.value = 'PKR ' + subtotalSum.toLocaleString();
  if (gstAmtEl) gstAmtEl.value = 'PKR ' + gstAmount.toLocaleString();
  if (totalEl) totalEl.value = 'PKR ' + grandTotal.toLocaleString();
}

async function submitCreatePOForm() {
  const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  const awardId = document.getElementById('po-award-id')?.value;
  const oppId = document.getElementById('po-opp-id')?.value;
  let custId = document.getElementById('po-cust-id')?.value;
  const poNumber = document.getElementById('po-number')?.value;
  const poDate = document.getElementById('po-date')?.value;
  const deadline = document.getElementById('po-deadline')?.value;
  const location = document.getElementById('po-delivery-location')?.value;
  const department = document.getElementById('po-department')?.value;
  const terms = document.getElementById('po-payment-terms')?.value;
  const remarks = document.getElementById('po-remarks')?.value;

  const subtotal = parseCurrency(document.getElementById('po-subtotal-amount')?.value);
  const gstRate = parseFloat(document.getElementById('po-gst-rate')?.value || 18);
  const gstAmount = parseCurrency(document.getElementById('po-gst-amount')?.value);
  const grandTotal = parseCurrency(document.getElementById('po-total-amount')?.value);

  if (!poNumber || !deadline || !location || grandTotal <= 0) {
    alert('PO Number, Delivery Deadline, Delivery Site Location, and at least 1 item allocation with positive value are mandatory.');
    return;
  }

  // Fallback resolution if custId is blank or not a UUID
  if (!isUuid(custId) && _cachedPOAward) {
    if (isUuid(_cachedPOAward.customer_id)) {
      custId = _cachedPOAward.customer_id;
    } else if (oppId) {
      const allOpps = State.getTenantEntityList('opportunities');
      const matchedOpp = allOpps.find(o => String(o.id) === String(oppId));
      if (matchedOpp && isUuid(matchedOpp.customer_id)) {
        custId = matchedOpp.customer_id;
      }
    }
  }

  // Safely resolve customer details
  const allCustomers = State.getTenantEntityList('customers') || [];
  const cust = allCustomers.find(c => String(c.id) === String(custId));
  const customerName = cust?.business_name || cust?.customer_name || _cachedPOAward?.customer_name || 'Customer Account';

  // Collect item allocations for this PO
  const poItems = [];
  let totalAllocatedUnits = 0;

  _cachedPOAwardItems.forEach((it, idx) => {
    const qtyInput = document.getElementById(`po-item-qty-${idx}`);
    const itemName = document.getElementById(`po-item-name-${idx}`)?.value || it.item_name || 'Supply Item';
    const awardItemId = document.getElementById(`po-item-award-id-${idx}`)?.value;
    const prodId = document.getElementById(`po-item-prod-id-${idx}`)?.value;
    const unit = document.getElementById(`po-item-unit-${idx}`)?.value || it.unit || 'PCS';
    const rate = parseFloat(document.getElementById(`po-item-rate-${idx}`)?.value || it.unit_price || it.awarded_unit_price || 0);

    if (qtyInput) {
      const qty = parseFloat(qtyInput.value) || 0;
      if (qty > 0) {
        totalAllocatedUnits += qty;
        poItems.push({
          award_item_id: (awardItemId && isUuid(awardItemId)) ? awardItemId : null,
          product_service_id: (prodId && isUuid(prodId)) ? prodId : null,
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

  let bizProfileId = _cachedPOAward?.business_profile_id;
  if (!isUuid(bizProfileId) && oppId) {
    const allOpps = State.getTenantEntityList('opportunities');
    const matchedOpp = allOpps.find(o => String(o.id) === String(oppId));
    if (matchedOpp && isUuid(matchedOpp.business_profile_id)) {
      bizProfileId = matchedOpp.business_profile_id;
    }
  }
  if (!isUuid(bizProfileId) && isUuid(State.currentBusinessProfileId)) {
    bizProfileId = State.currentBusinessProfileId;
  }

  const res = await API.createPurchaseOrder({
    business_profile_id: isUuid(bizProfileId) ? bizProfileId : undefined,
    award_letter_id: awardId,
    contract_id: _cachedPOAward?.contract_id || null,
    award_number: _cachedPOAward?.award_number || 'Award LOA',
    opportunity_id: oppId,
    customer_id: custId,
    customer_name: customerName,
    po_number: poNumber,
    po_date: poDate,
    delivery_deadline: deadline,
    delivery_location: location,
    department_name: department,
    payment_terms: terms,
    subtotal: subtotal,
    gst_rate_pct: gstRate,
    gst_amount: gstAmount,
    total_amount: grandTotal,
    net_amount: grandTotal,
    items: poItems,
    status: 'Issued',
    remarks: remarks
  });

  if (!res || !res.success || !res.data?.id) {
    alert(`⚠️ Failed to issue Purchase Order: ${res?.message || 'Database error. Record was NOT saved.'}`);
    return;
  }

  closeModal('modal-add-po');
  showToast(`✓ Purchase Order ${poNumber} issued and saved in database! Total Value: PKR ${grandTotal.toLocaleString()}`, 'success');
  navigateToView('purchase-orders');
}

// --------------------------------------------------------------------------
// PRINTABLE DELIVERY CHALLAN (A4 LETTERHEAD FORMAT)
// --------------------------------------------------------------------------

async function printDeliveryChallan(dcId) {
  const dcs = await API.getDeliveryChallans(State.currentBusinessProfileId);
  const dc = dcs.find(d => d.id === dcId);
  if (!dc) {
    alert('Delivery Challan not found.');
    return;
  }

  const currentProfile = State.getCurrentBusinessProfile() || {};
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const po = pos.find(p => p.id === dc.purchase_order_id || p.po_number === dc.po_number);

  const container = document.getElementById('dc-printable-area');
  if (!container) return;

  const items = dc.items && dc.items.length > 0 ? dc.items : [
    { item_name: dc.item_description || 'Scope Delivery Scope Item', quantity: dc.dispatched_quantity || 1, unit: dc.unit || 'PCS' }
  ];

  container.innerHTML = `
    <div class="lh-header-block">
      <div>
        <div class="lh-company-title">${currentProfile.business_name || 'MASHRUE ENTERPRISE'}</div>
        <div class="lh-company-meta">
          <strong>NTN:</strong> ${currentProfile.ntn || '901920-3'} | <strong>STRN:</strong> ${currentProfile.strn || '03-09-9920-001'}<br>
          ${currentProfile.address || 'Corporate Headquarters, Commercial Zone, Lahore, Pakistan'}<br>
          <strong>Tel:</strong> ${currentProfile.phone || '+92 42 35870011'} | <strong>Email:</strong> ${currentProfile.email || 'info@company.pk'}
        </div>
      </div>
      <div class="lh-doc-badge">
        <div class="lh-doc-title">DELIVERY CHALLAN</div>
        <div style="font-size: 14px; font-weight: 800; color: #0284c7; margin-top:2px;"># ${dc.dc_number}</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Dispatch Date: <strong>${dc.delivery_date || dc.dispatch_date || new Date().toISOString().slice(0, 10)}</strong></div>
      </div>
    </div>

    <div class="lh-meta-grid">
      <div>
        <strong style="color:#0f172a; text-transform:uppercase;">Customer / Consignee:</strong><br>
        <span style="font-size:13px; font-weight:700; color:#0f172a;">${dc.customer_name || 'Government Department'}</span><br>
        <strong>Destination Site:</strong> ${dc.destination_site || 'Central Grid Station / Client Store'}<br>
        <strong>Department:</strong> ${po?.department_name || dc.department || 'Procurement & Stores Directorate'}
      </div>
      <div>
        <strong style="color:#0f172a; text-transform:uppercase;">Reference & Logistics:</strong><br>
        <strong>Purchase Order #:</strong> ${dc.po_number || po?.po_number || 'PO-001'}<br>
        <strong>Contract / LOA #:</strong> ${po?.award_number || 'LOA-WAPDA-2026'}<br>
        <strong>Carrier / Transporter:</strong> ${dc.logistics_provider || dc.carrier_name || 'TCS Freight / Dedicated Hired Trailer'}<br>
        <strong>Vehicle # / Bilty #:</strong> ${dc.vehicle_number || 'TKL-8819'} / ${dc.tracking_number || dc.bilty_number || 'BL-99120'}
      </div>
    </div>

    <table class="lh-table">
      <thead>
        <tr>
          <th style="width: 36px; text-align: center;">#</th>
          <th>Item Description / Technical Scope</th>
          <th style="width: 90px; text-align: center;">Ordered Qty</th>
          <th style="width: 100px; text-align: center;">Dispatched Qty</th>
          <th style="width: 70px; text-align: center;">Unit</th>
          <th style="width: 120px; text-align: center;">Remarks / QC Pass</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((it, idx) => `
          <tr>
            <td style="text-align:center; font-weight:600;">${idx + 1}</td>
            <td>
              <strong>${it.item_name || it.item_description || 'Scope Item'}</strong>
            </td>
            <td style="text-align:center; font-weight:600; color:#64748b;">${it.ordered_quantity || it.quantity || '-'}</td>
            <td style="text-align:center; font-weight:800; color:#059669; font-size:13px;">${it.quantity || it.dispatched_quantity || 1}</td>
            <td style="text-align:center;">${it.unit || 'PCS'}</td>
            <td style="text-align:center; font-size:11px; color:#059669;">✓ Verified & Inspected</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:20px; font-size:11.5px; color:#475569;">
      <strong>Terms of Delivery:</strong> Goods received in sound condition and as per customer specifications. Any discrepancy must be reported within 48 hours of receipt.
    </div>

    <div class="lh-sign-grid">
      <div class="lh-sign-box">
        Prepared & Dispatched By<br>
        <span style="font-size:10px; color:#64748b;">(Warehouse / Logistics Officer)</span>
      </div>
      <div class="lh-sign-box">
        Transport Carrier / Driver<br>
        <span style="font-size:10px; color:#64748b;">(Signature & CNIC)</span>
      </div>
      <div class="lh-sign-box" style="border-top: 1.5px solid #0f172a;">
        Received in Good Order By<br>
        <span style="font-size:10px; color:#64748b;">(Consignee Official Stamp & Signature)</span>
      </div>
    </div>
  `;

  openModal('modal-print-dc');
}

function executeDCPrint() {
  window.print();
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
  const form = document.getElementById('form-add-dc');
  if (form) form.reset();

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
    if (warehouses && warehouses.length > 0) {
      whSelect.innerHTML = warehouses.map(w => `<option value="${w.id}">${w.warehouse_name} (${w.city})</option>`).join('');
    } else {
      whSelect.innerHTML = '<option value="22000000-0000-0000-0000-000000000001">Central Warehouse - Kot Lakhpat (Lahore)</option>';
    }
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
  const originLocEl = document.getElementById('dc-origin-location');
  if (originLocEl) originLocEl.value = '';
  handleDCDeliveryModeChanged('Own Warehouse');

  document.getElementById('dc-logistics-provider').value = '';
  document.getElementById('dc-tracking').value = '';
  document.getElementById('dc-vehicle').value = '';
  document.getElementById('dc-driver').value = '';
  document.getElementById('dc-freight-cost').value = '';
  document.getElementById('dc-customs-cost').value = '';
  document.getElementById('dc-remarks').value = '';

  openModal('modal-add-dc');
}

async function promptCreateDCForPO(poId, poNumber) {
  await openNewDCModal(poId);
}

function handleDCDeliveryModeChanged(mode) {
  const whContainer = document.getElementById('dc-wh-container');
  const supContainer = document.getElementById('dc-sup-container');

  if (mode === 'Direct Drop-Shipment') {
    if (whContainer) whContainer.style.display = 'none';
    if (supContainer) supContainer.style.display = 'block';
  } else {
    if (whContainer) whContainer.style.display = 'block';
    if (supContainer) supContainer.style.display = 'none';
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
    business_profile_id: _cachedDCPO?.business_profile_id || State.currentBusinessProfileId || null,
    po_number: _cachedDCPO?.po_number || 'PO Ref',
    opportunity_id: _cachedDCPO?.opportunity_id || null,
    customer_id: _cachedDCPO?.customer_id || null,
    customer_name: _cachedDCPO?.customer_name || 'Customer Account',
    dc_number: dcNumber,
    delivery_date: delDate,
    delivery_mode: mode,
    warehouse_id: mode === 'Own Warehouse' ? (whId || null) : null,
    warehouse_name: mode === 'Own Warehouse' ? (targetWh?.warehouse_name || 'Central Warehouse') : null,
    supplier_id: mode === 'Direct Drop-Shipment' ? (supId || null) : null,
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

  if (!res || !res.success || !res.data?.id) {
    alert(`⚠️ Failed to create Delivery Challan: ${res?.message || 'Database error. Record was NOT saved.'}`);
    return;
  }

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
      delivery_challan_id: res.data.id,
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

    const res = await API.createInvoice({
      business_profile_id: targetDC?.business_profile_id || targetPO?.business_profile_id || State.currentBusinessProfileId || undefined,
      delivery_challan_id: dcId,
      dc_number: dcNumber,
      purchase_order_id: targetDC?.purchase_order_id || null,
      po_number: targetDC?.po_number || null,
      customer_id: cust?.id || targetDC?.customer_id,
      customer_name: cust?.business_name || customerName,
      invoice_number: invNum,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      subtotal: calculatedSubtotal,
      tax_amount: taxAmount,
      total_amount: totalInvoiceAmount,
      paid_amount: 0,
      outstanding_amount: totalInvoiceAmount,
      status: 'Submitted',
      fbr_integration_required: true
    });

    if (!res || !res.success || !res.data?.id) {
      alert(`⚠️ Failed to generate invoice: ${res?.message || 'Database error. Record was NOT saved.'}`);
      return;
    }

    alert(`✓ Invoice ${res.data.invoice_number || invNum} generated and recorded in database!`);
    navigateToView('invoices');
  }
}

let _cachedInvoicePO = null;
let _cachedInvoicePOs = [];

async function openNewInvoiceModal(preselectedPoId) {
  const form = document.getElementById('form-add-invoice');
  if (form) form.reset();

  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  _cachedInvoicePOs = pos || [];

  if (_cachedInvoicePOs.length === 0) {
    alert('No approved Purchase Orders available to invoice. Please issue a Purchase Order first.');
    navigateToView('purchase-orders');
    return;
  }

  const initialPoId = preselectedPoId || _cachedInvoicePOs[0]?.id;

  const poSelect = document.getElementById('inv-po-select');
  if (poSelect) {
    poSelect.innerHTML = _cachedInvoicePOs.map(p => `
      <option value="${p.id}" ${p.id === initialPoId ? 'selected' : ''}>
        ${p.po_number} - ${p.customer_name || 'Customer'} (PKR ${parseFloat(p.net_amount || p.total_amount || 0).toLocaleString()})
      </option>
    `).join('');
    poSelect.value = initialPoId;
  }

  await handleInvoicePOChanged(initialPoId);

  document.getElementById('inv-number').value = 'INV-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
  document.getElementById('inv-date').value = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 30);
  document.getElementById('inv-due-date').value = due.toISOString().slice(0, 10);
  document.getElementById('inv-gst-rate').value = '18';
  document.getElementById('inv-diary-no').value = '';
  document.getElementById('inv-dealing-officer').value = '';
  document.getElementById('inv-remarks').value = '';

  openModal('modal-add-invoice');
}

async function handleInvoicePOChanged(poId) {
  const selectedPO = _cachedInvoicePOs.find(p => String(p.id) === String(poId)) || _cachedInvoicePOs[0];
  _cachedInvoicePO = selectedPO;
  if (!selectedPO) return;

  // Set hidden metadata
  const custIdEl = document.getElementById('inv-cust-id');
  const oppIdEl = document.getElementById('inv-opp-id');
  const contractIdEl = document.getElementById('inv-contract-id');
  const custNameEl = document.getElementById('inv-customer-name');
  const tenderNameEl = document.getElementById('inv-tender-name');
  const siteEl = document.getElementById('inv-delivery-site');

  if (custIdEl) custIdEl.value = selectedPO.customer_id || '';
  if (oppIdEl) oppIdEl.value = selectedPO.opportunity_id || '';
  if (contractIdEl) contractIdEl.value = selectedPO.contract_id || '';

  // Customer Name in readonly mode
  if (custNameEl) {
    custNameEl.value = selectedPO.customer_name || 'Customer Account';
    custNameEl.readOnly = true;
    custNameEl.style.backgroundColor = '#f8fafc';
    custNameEl.style.fontWeight = '600';
  }

  // Resolve Linked Tender / Opportunity in readonly mode
  let tenderName = selectedPO.tender_name || selectedPO.opportunity_title || '';
  if (!tenderName && selectedPO.opportunity_id) {
    const allOpps = State.getTenantEntityList('opportunities') || [];
    const matchedOpp = allOpps.find(o => String(o.id) === String(selectedPO.opportunity_id));
    if (matchedOpp) {
      tenderName = matchedOpp.tender_name || matchedOpp.title || '';
    }
  }
  if (!tenderName && selectedPO.award_letter_id) {
    const allAwards = State.getTenantEntityList('awards') || [];
    const matchedAward = allAwards.find(a => String(a.id) === String(selectedPO.award_letter_id));
    if (matchedAward) {
      tenderName = matchedAward.tender_name || '';
    }
  }
  if (!tenderName) {
    tenderName = selectedPO.po_number ? `Project PO: ${selectedPO.po_number}` : 'Direct Commercial Project';
  }

  if (tenderNameEl) {
    tenderNameEl.value = tenderName;
    tenderNameEl.readOnly = true;
    tenderNameEl.style.backgroundColor = '#f8fafc';
    tenderNameEl.style.fontWeight = '600';
    tenderNameEl.style.color = '#0369a1';
  }

  // Delivery Site in readonly mode
  if (siteEl) {
    siteEl.value = selectedPO.delivery_location || 'Designated Customer Site';
    siteEl.readOnly = true;
    siteEl.style.backgroundColor = '#f8fafc';
  }

  // Find linked Delivery Challans
  const dcs = State.getTenantEntityList('deliveryChallans') || [];
  const linkedDCs = dcs.filter(d => String(d.purchase_order_id) === String(selectedPO.id) || d.po_number === selectedPO.po_number);
  const dcSelect = document.getElementById('inv-dc-select');
  if (dcSelect) {
    dcSelect.innerHTML = `<option value="">-- Direct PO Invoicing (No DC Attached) --</option>` +
      linkedDCs.map(d => `<option value="${d.id}">${d.dc_number} (${d.status || 'Dispatched'} - ${d.delivery_date ? d.delivery_date.slice(0,10) : 'Date'})</option>`).join('');
    dcSelect.value = '';
  }

  // Calculate remaining unbilled balance for this PO
  const invoices = State.getTenantEntityList('invoices') || [];
  const poInvoices = invoices.filter(inv => String(inv.purchase_order_id) === String(selectedPO.id) || inv.po_number === selectedPO.po_number);
  const totalBilled = poInvoices.reduce((sum, inv) => sum + (parseFloat(inv.total_amount) || 0), 0);
  const poNetValue = parseFloat(selectedPO.net_amount || selectedPO.total_amount || 0);
  const remainingUnbilled = Math.max(0, poNetValue - totalBilled);

  // Compute subtotal (excluding 18% GST)
  const gstRate = parseFloat(document.getElementById('inv-gst-rate')?.value || 18);
  const suggestedSubtotal = Math.round((remainingUnbilled > 0 ? remainingUnbilled : poNetValue) / (1 + (gstRate / 100)));

  const subtotalInput = document.getElementById('inv-subtotal');
  if (subtotalInput) subtotalInput.value = suggestedSubtotal > 0 ? suggestedSubtotal : 0;

  const unbilledBadge = document.getElementById('inv-unbilled-badge');
  if (unbilledBadge) {
    unbilledBadge.innerText = `Unbilled Remaining PO: PKR ${remainingUnbilled.toLocaleString()}`;
  }

  // Clear discretionary fields
  const diaryEl = document.getElementById('inv-diary-no');
  if (diaryEl) diaryEl.value = '';
  const officerEl = document.getElementById('inv-dealing-officer');
  if (officerEl) officerEl.value = '';
  const remarksEl = document.getElementById('inv-remarks');
  if (remarksEl) remarksEl.value = '';

  calculateInvoiceNetTotals();
}

function handleInvoiceDCChanged(dcId) {
  if (!dcId) return;
  const dcs = State.getTenantEntityList('deliveryChallans') || [];
  const targetDC = dcs.find(d => d.id === dcId);
  if (!targetDC) return;

  if (targetDC.items && Array.isArray(targetDC.items) && targetDC.items.length > 0) {
    let dcSubtotal = 0;
    targetDC.items.forEach(dci => {
      const matchPOItem = _cachedInvoicePO?.items?.find(pi => pi.item_name === dci.item_name || pi.id === dci.purchase_order_item_id);
      const unitRate = parseFloat(matchPOItem?.unit_price || 0);
      dcSubtotal += (parseFloat(dci.quantity) || 1) * unitRate;
    });
    if (dcSubtotal > 0) {
      document.getElementById('inv-subtotal').value = dcSubtotal;
      calculateInvoiceNetTotals();
    }
  }
}

function calculateInvoiceNetTotals() {
  const subtotal = parseFloat(document.getElementById('inv-subtotal')?.value || 0);
  const gstRate = parseFloat(document.getElementById('inv-gst-rate')?.value || 18);
  const gstAmount = Math.round((subtotal * gstRate) / 100);
  const totalPayable = subtotal + gstAmount;

  const gstAmtEl = document.getElementById('inv-gst-amount');
  const totalEl = document.getElementById('inv-total-amount');

  if (gstAmtEl) gstAmtEl.value = 'PKR ' + gstAmount.toLocaleString();
  if (totalEl) totalEl.value = 'PKR ' + totalPayable.toLocaleString();
}

async function submitGenerateInvoiceForm() {
  const poId = document.getElementById('inv-po-select')?.value;
  const dcId = document.getElementById('inv-dc-select')?.value || null;
  const invNumber = document.getElementById('inv-number')?.value?.trim();
  const invDate = document.getElementById('inv-date')?.value;
  const dueDate = document.getElementById('inv-due-date')?.value;
  const subtotal = parseFloat(document.getElementById('inv-subtotal')?.value || 0);
  const gstRate = parseFloat(document.getElementById('inv-gst-rate')?.value || 18);
  const gstAmount = Math.round((subtotal * gstRate) / 100);
  const totalAmount = subtotal + gstAmount;
  const diaryNo = document.getElementById('inv-diary-no')?.value?.trim();
  const officerName = document.getElementById('inv-dealing-officer')?.value?.trim();
  const remarks = document.getElementById('inv-remarks')?.value?.trim();

  if (!poId || !invNumber || !invDate || !dueDate || subtotal <= 0) {
    alert('Purchase Order, Invoice Number, Dates, and a positive Subtotal amount are mandatory.');
    return;
  }

  const selectedPO = _cachedInvoicePO || _cachedInvoicePOs.find(p => p.id === poId);
  const dcs = State.getTenantEntityList('deliveryChallans') || [];
  const selectedDC = dcId ? dcs.find(d => d.id === dcId) : null;

  const res = await API.createInvoice({
    business_profile_id: selectedPO?.business_profile_id || State.currentBusinessProfileId || undefined,
    purchase_order_id: poId,
    po_number: selectedPO?.po_number || null,
    delivery_challan_id: dcId || null,
    dc_number: selectedDC?.dc_number || null,
    opportunity_id: selectedPO?.opportunity_id || null,
    contract_id: selectedPO?.contract_id || null,
    customer_id: selectedPO?.customer_id,
    customer_name: selectedPO?.customer_name || 'Customer Account',
    invoice_number: invNumber,
    invoice_date: invDate,
    due_date: dueDate,
    subtotal: subtotal,
    tax_amount: gstAmount,
    total_amount: totalAmount,
    paid_amount: 0,
    outstanding_amount: totalAmount,
    status: 'Submitted',
    fbr_integration_required: true,
    submission_diary_no: diaryNo || null,
    dealing_officer_name: officerName || null,
    remarks: remarks || null
  });

  if (!res || !res.success || !res.data?.id) {
    alert(`⚠️ Failed to generate invoice: ${res?.message || 'Database error. Record was NOT saved.'}`);
    return;
  }

  closeModal('modal-add-invoice');
  showToast(`✓ Commercial Tax Invoice ${invNumber} generated! Total: PKR ${totalAmount.toLocaleString()}`, 'success');
  await renderActiveView();
}

async function handleInvoiceStatusChange(id, newStatus) {
  const res = await API.updateInvoiceStatus(id, newStatus);
  if (!res || res.success === false) {
    alert(`⚠️ Failed to update invoice status: ${res?.message || 'Database error'}`);
    return;
  }
  alert(`Invoice status updated to ${newStatus}`);
  await renderActiveView();
}

async function handleFBRSubmit(invoiceId) {
  const res = await API.submitToFBR(invoiceId);
  if (!res || res.success === false) {
    alert(`⚠️ FBR Submission Failed: ${res?.message || 'Gateway error'}`);
    return;
  }
  alert(`Invoice validated with PRAL FBR! FBR Invoice #: ${res.fbrInvoiceNumber || res.data?.fbr_invoice_number}`);
  await renderActiveView();
}

async function openNewPaymentModal(preselectedInvoiceId = null, invoiceNumber = '', outstanding = 0) {
  window._isOpeningPaymentWithContext = true;
  try {
    const form = document.getElementById('form-add-payment');
    if (form) form.reset();

    const invSelect = document.getElementById('pay-invoice-select');
    const invoices = State.getTenantEntityList('invoices') || (await API.getInvoices(State.currentBusinessProfileId)) || [];
    
    // Unpaid invoices
    const unpaidInvoices = (invoices || []).filter(inv => {
      const out = parseFloat(inv.outstanding_amount ?? inv.total_amount ?? 0);
      return out > 0 || String(inv.id) === String(preselectedInvoiceId);
    });

    if (unpaidInvoices.length === 0 && !preselectedInvoiceId) {
      alert('No invoices with an outstanding balance available to record payment.');
      return;
    }

    if (invSelect) {
      if (preselectedInvoiceId) {
        invSelect.innerHTML = `<option value="${preselectedInvoiceId}" data-out="${outstanding}" selected>${invoiceNumber || 'Selected Invoice'} (Outstanding: PKR ${parseFloat(outstanding).toLocaleString()})</option>`;
      } else {
        invSelect.innerHTML = `<option value="">-- Select Invoice with Outstanding Balance --</option>` +
          unpaidInvoices.map(inv => {
            const out = parseFloat(inv.outstanding_amount ?? inv.total_amount ?? 0);
            return `<option value="${inv.id}" data-out="${out}">${inv.invoice_number} - ${inv.customer_name || 'Customer'} (Outstanding: PKR ${out.toLocaleString()})</option>`;
          }).join('');
      }
    }

    const grossEl = document.getElementById('pay-gross-amount');
    const amtEl = document.getElementById('pay-amount');
    const dateEl = document.getElementById('pay-date');
    const methodEl = document.getElementById('pay-method');
    const checkNoEl = document.getElementById('pay-check-no');
    const checkFromEl = document.getElementById('pay-check-from');
    const bankAccEl = document.getElementById('pay-bank-acc');
    const certNoEl = document.getElementById('pay-cert-no');
    const whtPctEl = document.getElementById('pay-wht-pct');
    const whtAmtEl = document.getElementById('pay-wht-amount');
    const stWhtEl = document.getElementById('pay-st-wht');
    const ldEl = document.getElementById('pay-ld-penalties');

    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
    if (methodEl) methodEl.value = 'Cheque';
    if (checkNoEl) checkNoEl.value = '';
    if (checkFromEl) checkFromEl.value = '';
    if (bankAccEl) bankAccEl.value = '';
    if (certNoEl) certNoEl.value = '';
    if (whtPctEl) whtPctEl.value = '4.5';
    if (whtAmtEl) whtAmtEl.value = '';
    if (stWhtEl) stWhtEl.value = '0';
    if (ldEl) ldEl.value = '0';

    if (preselectedInvoiceId && outstanding > 0) {
      if (grossEl) grossEl.value = outstanding;
      if (amtEl) amtEl.value = outstanding;
      if (typeof calculatePaymentNetBreakdown === 'function') {
        calculatePaymentNetBreakdown();
      }
    } else {
      if (grossEl) grossEl.value = '';
      if (amtEl) amtEl.value = '';
    }

    openModal('modal-add-payment');
  } finally {
    window._isOpeningPaymentWithContext = false;
  }
}
window.openNewPaymentModal = openNewPaymentModal;

function promptRecordPaymentForInvoice(invoiceId, invoiceNumber, outstanding) {
  openNewPaymentModal(invoiceId, invoiceNumber, outstanding);
}
window.promptRecordPaymentForInvoice = promptRecordPaymentForInvoice;

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

  const res = await API.createPayment({
    invoice_id: invoiceId,
    amount: amount,
    payment_date: date,
    check_no: checkNo,
    check_from: checkFrom,
    bank_account: bankAcc,
    reference_number: ref
  });

  if (!res || !res.success || !res.data?.id) {
    alert(`⚠️ Failed to log payment: ${res?.message || 'Database error. Record was NOT saved.'}`);
    return;
  }

  closeModal('modal-add-payment');
  alert('✓ Cheque Payment logged and invoice balance deducted in database.');
  navigateToView('payments');
}

// --------------------------------------------------------------------------
// MASTER DATA MODAL CONTROLLERS & FORM HANDLERS (PHASE 1)
// --------------------------------------------------------------------------

// 1. CUSTOMER CONTROLLERS
async function openNewCustomerModal() {
  const form = document.getElementById('form-add-customer');
  if (form) form.reset();
  const editEl = document.getElementById('cust-edit-id');
  if (editEl) editEl.value = '';
  const codeEl = document.getElementById('cust-code');
  if (codeEl) codeEl.value = 'CUST-' + Math.floor(1000 + Math.random() * 9000);
  const otherTermsCont = document.getElementById('cust-other-terms-container');
  if (otherTermsCont) otherTermsCont.style.display = 'none';
  const delBtn = document.getElementById('btn-delete-customer-modal');
  if (delBtn) delBtn.style.display = 'none';

  const modal = document.getElementById('modal-add-customer');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '🏢 Register New Customer Organization';
  }
  openModal('modal-add-customer');
}

async function openEditCustomerModal(id) {
  const customers = await API.getCustomers();
  const c = customers.find(item => String(item.id) === String(id));
  if (!c) return;

  document.getElementById('cust-edit-id').value = c.id;
  document.getElementById('cust-code').value = c.customer_code || 'CUST-PK-' + String(c.id).slice(0, 4);
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
  
  const terms = c.payment_terms || 'Net 30 Days';
  const termsSelect = document.getElementById('cust-terms');
  const otherTermsInput = document.getElementById('cust-other-terms');
  const standardTerms = ['100% Advance Payment', 'Net 30 Days', 'Net 60 Days', 'Letter of Credit (LC)', 'Cash on Delivery (COD)', 'Milestone / Progressive Billing'];

  if (standardTerms.includes(terms)) {
    if (termsSelect) termsSelect.value = terms;
    toggleCustomerOtherTerms(terms);
  } else {
    if (termsSelect) termsSelect.value = 'Other';
    toggleCustomerOtherTerms('Other');
    if (otherTermsInput) otherTermsInput.value = terms;
  }

  document.getElementById('cust-credit-limit').value = c.credit_limit || '';
  document.getElementById('cust-status').value = c.status || 'Active';
  document.getElementById('cust-bank-name').value = c.bank_name || '';
  document.getElementById('cust-bank-iban').value = c.bank_iban || '';
  document.getElementById('cust-notes').value = c.notes || '';

  const delBtn = document.getElementById('btn-delete-customer-modal');
  if (delBtn) delBtn.style.display = 'inline-block';

  const modal = document.getElementById('modal-add-customer');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '✏️ Edit Customer Organization';
  }
  openModal('modal-add-customer');
}

async function handleModalDeleteCustomer() {
  const editId = document.getElementById('cust-edit-id')?.value;
  const name = document.getElementById('cust-name')?.value?.trim();
  if (!editId) return;
  closeModal('modal-add-customer');
  await deleteCustomerItem(editId, encodeURIComponent(name || 'this customer'));
}
window.handleModalDeleteCustomer = handleModalDeleteCustomer;

async function submitNewCustomerForm() {
  const editId = document.getElementById('cust-edit-id')?.value;
  const code = document.getElementById('cust-code')?.value;
  const name = document.getElementById('cust-name')?.value?.trim();
  const orgType = document.getElementById('cust-org-type')?.value;
  const dept = document.getElementById('cust-department')?.value?.trim();
  const ntn = document.getElementById('cust-ntn')?.value?.trim();
  const strn = document.getElementById('cust-strn')?.value?.trim();
  const city = document.getElementById('cust-city')?.value?.trim();
  const province = document.getElementById('cust-province')?.value?.trim();
  const address = document.getElementById('cust-address')?.value?.trim();
  const delAddress = document.getElementById('cust-delivery-address')?.value?.trim();
  const contact = document.getElementById('cust-contact')?.value?.trim();
  const phone = document.getElementById('cust-phone')?.value?.trim();
  const email = document.getElementById('cust-email')?.value?.trim();
  
  const rawTerms = document.getElementById('cust-terms')?.value;
  const otherTerms = document.getElementById('cust-other-terms')?.value?.trim();
  const terms = (rawTerms === 'Other' && otherTerms) ? otherTerms : (rawTerms || 'Net 30 Days');

  const limit = parseCurrency(document.getElementById('cust-credit-limit')?.value);
  const status = document.getElementById('cust-status')?.value || 'Active';
  const bankName = document.getElementById('cust-bank-name')?.value?.trim();
  const bankIban = document.getElementById('cust-bank-iban')?.value?.trim();
  const notes = document.getElementById('cust-notes')?.value?.trim();

  if (!name) {
    alert('Customer Organization / Company Name is mandatory.');
    return;
  }

  const submitBtn = document.querySelector('#form-add-customer button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving Customer...</span>';
  }

  try {
    // Pre-flight duplicate check
    const existing = await API.getCustomers();
    const isDup = existing.some(c => 
      c.business_name?.toLowerCase().trim() === name.toLowerCase() && 
      String(c.id) !== String(editId || '')
    );
    if (isDup) {
      alert(`⚠️ Duplicate Customer Error:\nA customer named "${name}" is already registered.`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>💾 Save Customer Master</span>';
      }
      return;
    }

    let chosenTenantId = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
    if (typeof State.isSuperAdmin === 'function' && State.isSuperAdmin()) {
      const activeProfile = typeof State.getCurrentBusinessProfile === 'function' ? State.getCurrentBusinessProfile() : null;
      if (activeProfile && activeProfile.tenant_id) {
        chosenTenantId = activeProfile.tenant_id;
      }
    }

    const payload = {
      customer_code: code || 'CUST-' + Math.floor(1000 + Math.random() * 9000),
      business_name: name,
      customer_type: orgType,
      org_type: orgType,
      department_name: dept,
      ntn: ntn,
      strn: strn,
      city: city || 'Lahore',
      province: province || 'Punjab',
      country: 'Pakistan',
      address: address,
      delivery_address: delAddress,
      contact_person: contact,
      phone: phone,
      email: email,
      payment_terms: terms,
      credit_limit: limit,
      status: status,
      bank_name: bankName,
      bank_iban: bankIban,
      notes: notes
    };

    if (chosenTenantId) {
      payload.tenant_id = chosenTenantId;
    }

    let created = null;
    if (editId) {
      const updateRes = await API.updateEntity('customer', editId, payload);
      if (updateRes && updateRes.success === false) {
        alert(`⚠️ Failed to update customer: ${updateRes.message || updateRes.error || 'Server error'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Customer Master</span>';
        }
        return;
      }
      created = { id: editId, ...payload };
      showToast('✓ Customer record updated successfully.', 'success');
    } else {
      const res = await API.createCustomer(payload);
      if (!res || res.success === false || !res.data?.id) {
        alert(`⚠️ Failed to save customer: ${res?.message || res?.error || 'Validation or server error. Record was NOT saved in database.'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Customer Master</span>';
        }
        return;
      }
      created = res.data;
      showToast('✓ Customer registered and saved in database successfully.', 'success');
    }

    closeModal('modal-add-customer');
    await handleQuickAddCompletion('customer', created);
    await renderActiveView();
  } catch (err) {
    alert(`Error saving customer: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save Customer Master</span>';
    }
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
  const form = document.getElementById('form-add-supplier');
  if (form) form.reset();
  const editEl = document.getElementById('sup-edit-id');
  if (editEl) editEl.value = '';
  const codeEl = document.getElementById('sup-code');
  if (codeEl) codeEl.value = 'SUP-INT-' + Math.floor(1000 + Math.random() * 9000);
  const typeEl = document.getElementById('sup-type');
  if (typeEl) typeEl.value = 'International Supplier';
  handleSupplierTypeChanged('International Supplier');

  const delBtn = document.getElementById('btn-delete-supplier-modal');
  if (delBtn) delBtn.style.display = 'none';

  const modal = document.getElementById('modal-add-supplier');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '🏭 Register Sourcing Partner / OEM Supplier';
  }
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

  const delBtn = document.getElementById('btn-delete-supplier-modal');
  if (delBtn) delBtn.style.display = 'inline-block';

  const modal = document.getElementById('modal-add-supplier');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '✏️ Edit Sourcing Partner / Supplier';
  }
  openModal('modal-add-supplier');
}

async function handleModalDeleteSupplier() {
  const editId = document.getElementById('sup-edit-id')?.value;
  const name = document.getElementById('sup-name')?.value?.trim();
  if (!editId) return;
  closeModal('modal-add-supplier');
  await deleteSupplierItem(editId, encodeURIComponent(name || 'this supplier'));
}
window.handleModalDeleteSupplier = handleModalDeleteSupplier;

async function submitNewSupplierForm() {
  const editId = document.getElementById('sup-edit-id')?.value;
  const code = document.getElementById('sup-code')?.value;
  const name = document.getElementById('sup-name')?.value?.trim();
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

  const submitBtn = document.querySelector('#form-add-supplier button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving Supplier...</span>';
  }

  try {
    // Pre-flight duplicate check
    const existing = await API.getSuppliers();
    const isDup = existing.some(s => 
      s.supplier_name?.toLowerCase().trim() === name.toLowerCase() && 
      String(s.id) !== String(editId || '')
    );
    if (isDup) {
      alert(`⚠️ Duplicate Supplier Error:\nA supplier named "${name}" is already registered.`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>💾 Save Sourcing Partner</span>';
      }
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
      const updateRes = await API.updateEntity('supplier', editId, payload);
      if (updateRes && updateRes.success === false) {
        alert(`⚠️ Failed to update supplier: ${updateRes.message || updateRes.error || 'Server error'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Sourcing Partner</span>';
        }
        return;
      }
      created = { id: editId, ...payload };
      showToast('✓ Supplier details updated successfully.', 'success');
    } else {
      const res = await API.createSupplier(payload);
      if (!res || res.success === false || !res.data?.id) {
        alert(`⚠️ ${res?.message || res?.error || 'Failed to save supplier in database.'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Sourcing Partner</span>';
        }
        return;
      }
      created = res.data;
      showToast('✓ Supplier registered and saved in database successfully.', 'success');
    }

    closeModal('modal-add-supplier');
    await handleQuickAddCompletion('supplier', created);
    await renderActiveView();
  } catch (err) {
    alert(`Error saving supplier: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save Sourcing Partner</span>';
    }
  }
}

async function toggleSupplierStatus(id, currentStatus) {
  const newStatus = (currentStatus === 'Inactive') ? 'Active' : 'Inactive';
  await API.updateEntity('supplier', id, { status: newStatus });
  await renderActiveView();
}

// 3. PRODUCT & MASTER SKU CONTROLLERS
function checkProductSellingPriceMargin() {
  const cost = parseCurrency(document.getElementById('prod-cost-pkr')?.value);
  const selling = parseCurrency(document.getElementById('prod-selling-price')?.value);
  const warnEl = document.getElementById('prod-price-warning');
  const msgEl = document.getElementById('prod-price-warning-msg');
  const sellingInput = document.getElementById('prod-selling-price');

  if (cost > 0 && selling > 0 && selling < cost) {
    const loss = cost - selling;
    const lossPct = ((loss / cost) * 100).toFixed(1);
    if (warnEl) {
      warnEl.style.display = 'flex';
      warnEl.className = 'loss-alert-box';
    }
    if (msgEl) {
      msgEl.innerHTML = `<strong>Loss Alert:</strong> Selling Price (<span class="loss-text">PKR ${selling.toLocaleString()}</span>) is lower than Landed Cost Price (PKR ${cost.toLocaleString()}). Loss: <span class="loss-text">-PKR ${loss.toLocaleString()} (-${lossPct}% negative margin)</span>!`;
    }
    if (sellingInput) {
      sellingInput.classList.add('loss-text');
      sellingInput.style.borderColor = '#ef4444';
      sellingInput.style.backgroundColor = '#fef2f2';
    }
  } else {
    if (warnEl) warnEl.style.display = 'none';
    if (sellingInput) {
      sellingInput.classList.remove('loss-text');
      sellingInput.style.borderColor = '';
      sellingInput.style.backgroundColor = '';
    }
  }
}

const PAKISTAN_CUSTOMS_HS_CATALOG = [
  { keyword: 'syringe', code: '9018.3100', desc: 'Syringes, with or without needles (Medical Devices)' },
  { keyword: 'needle', code: '9018.3900', desc: 'Needles, catheters, cannulae (Medical)' },
  { keyword: 'catheter', code: '9018.3900', desc: 'Needles, catheters, cannulae (Medical)' },
  { keyword: 'cannula', code: '9018.3900', desc: 'Needles, catheters, cannulae (Medical)' },
  { keyword: 'glove', code: '4015.1900', desc: 'Surgical & examination gloves of rubber' },
  { keyword: 'paper', code: '4802.5600', desc: 'Paper sheets/rims, 40-150g/m2 (A4/Legal)' },
  { keyword: 'rim', code: '4802.5600', desc: 'Paper sheets/rims, 40-150g/m2 (A4/Legal)' },
  { keyword: 'transformer', code: '8504.2200', desc: 'Liquid dielectric transformers 650kVA-10MVA' },
  { keyword: 'laptop', code: '8471.3000', desc: 'Portable automatic data processing machines' },
  { keyword: 'computer', code: '8471.5000', desc: 'Digital processing units / Desktop / Servers' },
  { keyword: 'server', code: '8471.5000', desc: 'Digital processing units / Desktop / Servers' },
  { keyword: 'monitor', code: '8528.5200', desc: 'Computer monitors & display units' },
  { keyword: 'cable', code: '8544.4990', desc: 'Electric conductors & cables <= 1000V' },
  { keyword: 'wire', code: '8544.4990', desc: 'Electric conductors & cables <= 1000V' },
  { keyword: 'breaker', code: '8536.2000', desc: 'Automatic circuit breakers <= 1000V' },
  { keyword: 'switchgear', code: '8536.2000', desc: 'Electrical switchgear and protection' },
  { keyword: 'medicine', code: '3004.9099', desc: 'Medicaments & pharmaceuticals' },
  { keyword: 'tablet', code: '3004.9099', desc: 'Medicaments & pharmaceutical formulations' },
  { keyword: 'disinfectant', code: '3808.9400', desc: 'Disinfectants & antiseptic chemical solutions' },
  { keyword: 'mask', code: '6307.9090', desc: 'Face masks, protective PPE articles' },
  { keyword: 'ppe', code: '6307.9090', desc: 'Protective gear, overalls & PPE articles' }
];

let _currentProductSizes = [];
let _currentProductVariants = [];

function renderProductSizesBadges() {
  const container = document.getElementById('prod-sizes-tags-container');
  if (!container) return;
  if (!_currentProductSizes || _currentProductSizes.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8; font-size:0.75rem; padding:2px 4px;">No sizes defined yet (e.g. 5ml, 10ml, or S, M, L)</span>';
    return;
  }
  container.innerHTML = _currentProductSizes.map((sz, idx) => `
    <span style="display:inline-flex; align-items:center; gap:4px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:12px;">
      ${sz}
      <button type="button" onclick="removeProductSizeTag(${idx})" style="background:none; border:none; color:#dc2626; font-weight:700; cursor:pointer; padding:0 2px; line-height:1;" title="Remove size">&times;</button>
    </span>
  `).join('');
}
window.renderProductSizesBadges = renderProductSizesBadges;

function renderProductVariantsBadges() {
  const container = document.getElementById('prod-variants-tags-container');
  if (!container) return;
  if (!_currentProductVariants || _currentProductVariants.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8; font-size:0.75rem; padding:2px 4px;">No variants defined yet (e.g. Luer Lock, White, Blue)</span>';
    return;
  }
  container.innerHTML = _currentProductVariants.map((vr, idx) => `
    <span style="display:inline-flex; align-items:center; gap:4px; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:12px;">
      ${vr}
      <button type="button" onclick="removeProductVariantTag(${idx})" style="background:none; border:none; color:#dc2626; font-weight:700; cursor:pointer; padding:0 2px; line-height:1;" title="Remove variant">&times;</button>
    </span>
  `).join('');
}
window.renderProductVariantsBadges = renderProductVariantsBadges;

function addProductSizeTag(customVal) {
  const input = document.getElementById('prod-size-input');
  const val = (customVal !== undefined ? customVal : input?.value)?.trim();
  if (val && !_currentProductSizes.includes(val)) {
    _currentProductSizes.push(val);
    renderProductSizesBadges();
  }
  if (input) input.value = '';
}
window.addProductSizeTag = addProductSizeTag;

function removeProductSizeTag(idx) {
  if (idx >= 0 && idx < _currentProductSizes.length) {
    _currentProductSizes.splice(idx, 1);
    renderProductSizesBadges();
  }
}
window.removeProductSizeTag = removeProductSizeTag;

function addProductVariantTag(customVal) {
  const input = document.getElementById('prod-variant-input');
  const val = (customVal !== undefined ? customVal : input?.value)?.trim();
  if (val && !_currentProductVariants.includes(val)) {
    _currentProductVariants.push(val);
    renderProductVariantsBadges();
  }
  if (input) input.value = '';
}
window.addProductVariantTag = addProductVariantTag;

function removeProductVariantTag(idx) {
  if (idx >= 0 && idx < _currentProductVariants.length) {
    _currentProductVariants.splice(idx, 1);
    renderProductVariantsBadges();
  }
}
window.removeProductVariantTag = removeProductVariantTag;

function applyProductPreset(presetType) {
  if (presetType === 'syringe') {
    _currentProductSizes = ['1ml', '2ml', '3ml', '5ml', '10ml', '20ml', '50ml', '60ml'];
    _currentProductVariants = ['Standard Luer Slip', 'Luer Lock', 'Auto-Disable (AD)', 'Insulin 100IU', 'Safety Needle'];
  } else if (presetType === 'cannula') {
    _currentProductSizes = ['14G (Orange)', '16G (Grey)', '18G (Green)', '20G (Pink)', '22G (Blue)', '24G (Yellow)', '26G (Violet)'];
    _currentProductVariants = ['With Port & Wings', 'Without Port', 'Safety IV Cannula', 'Pen-like'];
  } else if (presetType === 'gloves') {
    _currentProductSizes = ['6.0', '6.5', '7.0', '7.5', '8.0', '8.5'];
    _currentProductVariants = ['Latex Powdered', 'Latex Powder-Free', 'Nitrile Examination', 'Sterile Surgical'];
  } else if (presetType === 'gauze') {
    _currentProductSizes = ['5cm x 5cm', '7.5cm x 7.5cm', '10cm x 10cm', '10cm x 5m (Roll)', '15cm x 5m (Roll)'];
    _currentProductVariants = ['Sterile 8-Ply', 'Sterile 12-Ply', 'Non-Sterile Gauze Swab', 'X-Ray Detectable'];
  } else if (presetType === 'shirt' || presetType === 'apparel') {
    _currentProductSizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
    _currentProductVariants = ['White', 'Navy Blue', 'Black', 'Sky Blue', 'Grey', 'Light Green (OT Scrub)'];
  }
  renderProductSizesBadges();
  renderProductVariantsBadges();
  showToast(`✓ Applied ${presetType.toUpperCase()} sizes & variants preset.`, 'info');
}
window.applyProductPreset = applyProductPreset;

function autoSuggestHsCode() {
  const prodName = (document.getElementById('prod-name')?.value || '').toLowerCase().trim();
  const prodSpec = (document.getElementById('prod-spec')?.value || '').toLowerCase().trim();
  const fullText = `${prodName} ${prodSpec}`;

  if (!fullText.trim()) {
    showToast('Please enter Product Name first to auto-lookup HS Code', 'info');
    return;
  }

  const match = PAKISTAN_CUSTOMS_HS_CATALOG.find(item => fullText.includes(item.keyword));
  if (match) {
    const hsInput = document.getElementById('prod-hs-code');
    if (hsInput) {
      hsInput.value = match.code;
      showToast(`✓ HS Code ${match.code} matched for "${match.keyword}" (${match.desc})`, 'success');
    }
  } else {
    showToast('No exact keyword match in quick catalog. Pick standard 8-digit HS Code from dropdown.', 'info');
  }
}

function onHsCodeInput(val) {
  if (val && val.includes(' - ')) {
    const code = val.split(' - ')[0].trim();
    const hsInput = document.getElementById('prod-hs-code');
    if (hsInput) hsInput.value = code;
  }
}

function setAdminClientFilter(tenantId) {
  window._adminSelectedClientFilter = tenantId;
  renderActiveView();
}
window.setAdminClientFilter = setAdminClientFilter;

async function openNewProductModal() {
  const form = document.getElementById('form-add-product');
  if (form) form.reset();

  _currentProductSizes = [];
  _currentProductVariants = [];
  renderProductSizesBadges();
  renderProductVariantsBadges();

  const suppliers = await API.getSuppliers();
  const supSelect = document.getElementById('prod-supplier-select') || document.getElementById('prod-supplier');
  if (supSelect) {
    supSelect.innerHTML = `<option value="">— None (Open Sourcing) —</option>` + suppliers.map(s => `
      <option value="${s.id}">${s.supplier_name} (${s.country || 'Pakistan'})</option>
    `).join('');
  }

  const editEl = document.getElementById('prod-edit-id');
  if (editEl) editEl.value = '';
  const skuEl = document.getElementById('prod-sku');
  const now = new Date();
  const yyyymm = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
  if (skuEl) skuEl.value = `SKU-${yyyymm}-${Math.floor(1000 + Math.random() * 9000)}`;
  const nameEl = document.getElementById('prod-name');
  if (nameEl) nameEl.value = '';
  const specEl = document.getElementById('prod-spec');
  if (specEl) specEl.value = '';
  const typeEl = document.getElementById('prod-type');
  if (typeEl) typeEl.value = 'Product';
  const unitEl = document.getElementById('prod-unit');
  if (unitEl) unitEl.value = 'PCS';
  const batchEl = document.getElementById('prod-batch-no');
  if (batchEl) batchEl.value = '';
  const hsEl = document.getElementById('prod-hs-code');
  if (hsEl) hsEl.value = '';
  const taxEl = document.getElementById('prod-tax-cat');
  if (taxEl) taxEl.value = '18% Standard Sales Tax';
  const stockEl = document.getElementById('prod-current-stock');
  if (stockEl) stockEl.value = '0';
  const reorderEl = document.getElementById('prod-reorder-level');
  if (reorderEl) reorderEl.value = '5';
  const costEl = document.getElementById('prod-cost-pkr') || document.getElementById('prod-cost-price');
  if (costEl) costEl.value = '';
  const sellEl = document.getElementById('prod-selling-price');
  if (sellEl) sellEl.value = '';
  const expEl = document.getElementById('prod-expiry-date');
  if (expEl) expEl.value = '';
  const descEl = document.getElementById('prod-description');
  if (descEl) descEl.value = '';

  const delBtn = document.getElementById('btn-delete-product-modal');
  if (delBtn) delBtn.style.display = 'none';

  const modal = document.getElementById('modal-add-product');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '📦 Register Master Product / Item SKU';
  }

  checkProductSellingPriceMargin();
  openModal('modal-add-product');
}

async function openEditProductModal(id) {
  const products = await API.getProducts();
  const suppliers = await API.getSuppliers();
  const p = products.find(item => String(item.id) === String(id));
  if (!p) return;

  const supSelect = document.getElementById('prod-supplier-select') || document.getElementById('prod-supplier');
  if (supSelect) {
    supSelect.innerHTML = `<option value="">— None (Open Sourcing) —</option>` + suppliers.map(s => `
      <option value="${s.id}" ${(s.id === p.default_supplier_id || s.id === p.supplier_id) ? 'selected' : ''}>
        ${s.supplier_name} (${s.country || 'Pakistan'})
      </option>
    `).join('');
  }

  document.getElementById('prod-edit-id').value = p.id;
  document.getElementById('prod-sku').value = p.sku || '';
  document.getElementById('prod-name').value = p.name || '';
  const specEl = document.getElementById('prod-spec');
  if (specEl) specEl.value = p.specifications || p.spec || '';
  document.getElementById('prod-type').value = p.item_type || 'Product';
  document.getElementById('prod-unit').value = p.unit || 'PCS';
  const batchEl = document.getElementById('prod-batch-no');
  if (batchEl) batchEl.value = p.batch_number || p.batch_no || '';
  const hsEl = document.getElementById('prod-hs-code');
  if (hsEl) hsEl.value = p.hs_code || '';
  const taxEl = document.getElementById('prod-tax-cat');
  if (taxEl) taxEl.value = p.tax_category || '18% Standard Sales Tax';
  const stockEl = document.getElementById('prod-current-stock');
  if (stockEl) stockEl.value = (p.current_stock !== undefined && p.current_stock !== null) ? p.current_stock : 0;
  const reorderEl = document.getElementById('prod-reorder-level');
  if (reorderEl) reorderEl.value = (p.reorder_level !== undefined && p.reorder_level !== null) ? p.reorder_level : 5;
  const costEl = document.getElementById('prod-cost-pkr') || document.getElementById('prod-cost-price');
  if (costEl) costEl.value = p.cost_price ? Number(p.cost_price).toLocaleString() : '';
  const sellEl = document.getElementById('prod-selling-price');
  if (sellEl) sellEl.value = p.selling_price ? Number(p.selling_price).toLocaleString() : '';
  const expEl = document.getElementById('prod-expiry-date');
  if (expEl) expEl.value = p.expiry_date || '';
  const descEl = document.getElementById('prod-description');
  if (descEl) descEl.value = p.description || '';

  // Load Sizes & Variants
  try {
    if (p.sizes) {
      _currentProductSizes = typeof p.sizes === 'string' ? JSON.parse(p.sizes || '[]') : [...p.sizes];
    } else if (p.specifications) {
      _currentProductSizes = [p.specifications];
    } else {
      _currentProductSizes = [];
    }
  } catch (e) {
    _currentProductSizes = [];
  }

  try {
    if (p.variants) {
      _currentProductVariants = typeof p.variants === 'string' ? JSON.parse(p.variants || '[]') : [...p.variants];
    } else {
      _currentProductVariants = [];
    }
  } catch (e) {
    _currentProductVariants = [];
  }

  renderProductSizesBadges();
  renderProductVariantsBadges();

  const delBtn = document.getElementById('btn-delete-product-modal');
  if (delBtn) delBtn.style.display = 'inline-block';

  const modal = document.getElementById('modal-add-product');
  if (modal) {
    const title = modal.querySelector('h2');
    if (title) title.innerHTML = '✏️ Edit Master Product SKU';
  }

  checkProductSellingPriceMargin();
  openModal('modal-add-product');
}

async function handleModalDeleteProduct() {
  const editId = document.getElementById('prod-edit-id')?.value;
  const name = document.getElementById('prod-name')?.value?.trim();
  if (!editId) return;
  closeModal('modal-add-product');
  await deleteProductItem(editId, encodeURIComponent(name || 'this item'));
}
window.handleModalDeleteProduct = handleModalDeleteProduct;

async function submitNewProductForm() {
  const editId = document.getElementById('prod-edit-id')?.value;
  const sku = document.getElementById('prod-sku')?.value?.trim();
  const name = document.getElementById('prod-name')?.value?.trim();
  const spec = document.getElementById('prod-spec')?.value?.trim() || '';
  const type = document.getElementById('prod-type')?.value || 'Product';
  const unit = document.getElementById('prod-unit')?.value?.trim() || 'PCS';
  const batchNo = document.getElementById('prod-batch-no')?.value?.trim() || '';
  const hsCode = document.getElementById('prod-hs-code')?.value?.trim() || '';
  const taxCat = document.getElementById('prod-tax-cat')?.value || '18% Standard Sales Tax';
  const supplierId = document.getElementById('prod-supplier-select')?.value || document.getElementById('prod-supplier')?.value || null;
  const currentStock = parseFloat(document.getElementById('prod-current-stock')?.value || 0);
  const reorder = parseFloat(document.getElementById('prod-reorder-level')?.value || 5);
  const costInput = document.getElementById('prod-cost-pkr') || document.getElementById('prod-cost-price');
  const cost = parseCurrency(costInput?.value || 0);
  const priceInput = document.getElementById('prod-selling-price');
  const price = parseCurrency(priceInput?.value || 0);
  const expDate = document.getElementById('prod-expiry-date')?.value || null;
  const desc = document.getElementById('prod-description')?.value?.trim() || '';

  if (!sku || !name || isNaN(cost)) {
    alert('SKU, Item Name, and Landed Cost Price are mandatory.');
    return;
  }

  const submitBtn = document.querySelector('#form-add-product button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving Product...</span>';
  }

  try {
    // Pre-flight duplicate check (skip self if editing)
    const existing = await API.getProducts();
    const isDup = existing.some(p => 
      String(p.id) !== String(editId || '') && (
        (p.sku && sku && p.sku.toLowerCase().trim() === sku.toLowerCase().trim()) ||
        (p.name && name && p.name.toLowerCase().trim() === name.toLowerCase().trim() && (p.specifications || '') === spec)
      )
    );
    if (isDup) {
      alert(`⚠️ Duplicate Product Error:\nAn item with SKU "${sku}" or name "${name}" is already registered in your catalog.`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>💾 Save Master Product</span>';
      }
      return;
    }

    const payload = {
      sku: sku,
      name: name,
      specifications: spec,
      sizes: _currentProductSizes,
      variants: _currentProductVariants,
      item_type: type,
      unit: unit,
      batch_number: batchNo,
      batch_no: batchNo,
      hs_code: hsCode,
      tax_category: taxCat,
      default_supplier_id: supplierId,
      current_stock: currentStock,
      reorder_level: reorder,
      cost_price: cost,
      selling_price: price || cost,
      expiry_date: expDate,
      description: desc
    };

    let created = null;
    if (editId) {
      const res = await API.updateProduct(editId, payload);
      if (!res || res.success === false) {
        alert(`⚠️ Failed to update product: ${res?.message || 'Server error'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Master Product</span>';
        }
        return;
      }
      created = res.data || { id: editId, ...payload };
      showToast('✓ Master Product SKU updated successfully.', 'success');
    } else {
      const res = await API.createProduct(payload);
      if (!res || res.success === false || !res.data?.id) {
        alert(`⚠️ ${res?.message || res?.error || 'Failed to save product in database.'}`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save Master Product</span>';
        }
        return;
      }
      created = res.data;
      showToast('✓ Master Product SKU registered into Catalog in database.', 'success');
    }

    closeModal('modal-add-product');
    window._cachedProducts = null;
    State.products = await API.getProducts();
    await handleQuickAddCompletion('product', created);
    await renderActiveView();
  } catch (err) {
    alert(`Error saving product: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save Master Product</span>';
    }
  }
}

async function deleteProductItem(id, encodedName) {
  const name = decodeURIComponent(encodedName || 'this item');
  if (!confirm(`Are you sure you want to delete "${name}" from the product catalog?`)) {
    return;
  }
  try {
    await API.deleteProduct(id);
    showToast(`✓ "${name}" deleted from catalog.`, 'success');
    await renderActiveView();
  } catch (err) {
    alert(`Error deleting item: ${err.message}`);
  }
}

async function deleteCustomerItem(id, encodedName) {
  const name = decodeURIComponent(encodedName || 'this customer');
  if (!confirm(`Are you sure you want to delete customer "${name}"?`)) {
    return;
  }
  try {
    await API.deleteCustomer(id);
    showToast(`✓ Customer "${name}" deleted.`, 'success');
    await renderActiveView();
  } catch (err) {
    alert(`Error deleting customer: ${err.message}`);
  }
}

async function deleteSupplierItem(id, encodedName) {
  const name = decodeURIComponent(encodedName || 'this supplier');
  if (!confirm(`Are you sure you want to delete supplier "${name}"?`)) {
    return;
  }
  try {
    await API.deleteSupplier(id);
    showToast(`✓ Supplier "${name}" deleted.`, 'success');
    await renderActiveView();
  } catch (err) {
    alert(`Error deleting supplier: ${err.message}`);
  }
}

async function handleDeleteOpportunity(id, encodedName) {
  const name = decodeURIComponent(encodedName || 'this tender');
  if (!confirm(`Are you sure you want to delete tender "${name}"? This will also remove associated line items and bid securities.`)) {
    return;
  }
  try {
    await API.deleteOpportunity(id);
    showToast(`✓ Tender "${name}" deleted successfully.`, 'success');
    await renderActiveView();
  } catch (err) {
    alert(`Error deleting tender: ${err.message}`);
  }
}

// 3B. WAREHOUSE MASTER CONTROLLERS
function openNewWarehouseModal() {
  const form = document.getElementById('form-add-warehouse');
  if (form) form.reset();
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
    const res = await API.updateEntity('warehouse', editId, payload);
    if (!res || res.success === false) {
      alert(`⚠️ Failed to update warehouse: ${res?.message || 'Server error'}`);
      return;
    }
    created = res.data || { id: editId, ...payload };
    alert('✓ Warehouse details updated.');
  } else {
    const res = await API.createWarehouse(payload);
    if (!res || !res.success || !res.data?.id) {
      alert(`⚠️ Failed to create warehouse: ${res?.message || 'Database error'}`);
      return;
    }
    created = res.data;
    alert('✓ Warehouse location created in database.');
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

// --------------------------------------------------------------------------
// EXPENDITURE MODAL DYNAMIC HANDLERS (3-TIER ENGINE)
// --------------------------------------------------------------------------

const EXPENSE_CATEGORIES_BY_TIER = {
  'Tier 1 - Tender Direct': [
    'Tender / Bidding Document Fee',
    'Lab Sample Testing & Certification',
    'Sample Procurement & Fabrication',
    'Site Pre-Bid Survey / Inspection & Fuel',
    'Bid Security Guarantee Bank Processing Fee',
    'Courier & Dispatch Charges for Bids',
    'Technical Consultant / Specialist Fee',
    'Client Pre-Bid Meeting Refreshments & Travel',
    'Other Pre-Bid Direct Expense'
  ],
  'Tier 2 - PO Execution': [
    'Hired Freight / Trailer Transport',
    '3PL Logistics & Courier (TCS / Leopard / M&P)',
    'Loading & Unloading Labor',
    'Port Customs Clearance & Handling Charges',
    'Transit Insurance & Security',
    'Warehouse Storage & Material Handling',
    'Packaging & Palletization Supplies',
    'Site Installation & Field Assembly Labor',
    'QC Third-Party Inspection at Delivery',
    'Other Execution & Logistics Expense'
  ],
  'Tier 3 - General Overheads': [
    'Head Office Rent',
    'Office Utilities (Electricity, Gas, Water)',
    'Staff Salaries & Wages',
    'Office Internet & Telephone',
    'Stationery & Printing Supplies',
    'Company Vehicle Fuel & Routine Maintenance',
    'Bank Charges & Account Maintenance',
    'Legal & Tax Advisory Fees',
    'Software & ERP Subscriptions',
    'Office Refreshments & Hospitality',
    'Miscellaneous General Expense'
  ]
};

let _cachedExpenseOpportunities = [];
let _cachedExpenseSuggestions = [];
let _cachedExpenseCategories = [];

async function loadExpenseCategories() {
  try {
    _cachedExpenseCategories = await API.getExpenseCategories();
  } catch (e) {
    _cachedExpenseCategories = [];
  }
  return _cachedExpenseCategories;
}

async function openExpenseModal(presetTier = 'Tier 3 - General Overheads', presetOppId = '', presetPoId = '', presetCategory = '') {
  const el = document.getElementById('modal-add-expense');
  if (!el) return;

  const tierEl = document.getElementById('exp-tier');
  const nameEl = document.getElementById('exp-name');
  const oppIdEl = document.getElementById('exp-opportunity-id');
  const poIdEl = document.getElementById('exp-po-id');
  const searchEl = document.getElementById('exp-linked-search');
  const amountEl = document.getElementById('exp-amount');
  const dateEl = document.getElementById('exp-date');
  const paidToEl = document.getElementById('exp-paid-to');
  const modeEl = document.getElementById('exp-mode');
  const remarksEl = document.getElementById('exp-remarks');
  const badgeEl = document.getElementById('exp-linked-selected-badge');
  const menuEl = document.getElementById('exp-linked-dropdown');

  if (tierEl) tierEl.value = presetTier;
  if (nameEl) nameEl.value = presetCategory || '';
  if (oppIdEl) oppIdEl.value = presetOppId;
  if (poIdEl) poIdEl.value = presetPoId;
  if (searchEl) searchEl.value = '';
  if (amountEl) amountEl.value = '';
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (paidToEl) paidToEl.value = '';
  if (modeEl) modeEl.value = 'Online Bank Transfer';
  if (remarksEl) remarksEl.value = '';
  if (badgeEl) { badgeEl.style.display = 'none'; badgeEl.innerHTML = ''; }
  if (menuEl) menuEl.style.display = 'none';

  // Open modal visual
  el.classList.add('open');

  // Populate Company / Business Profile
  try {
    const profiles = (State.businessProfiles && State.businessProfiles.length > 0)
      ? State.businessProfiles
      : await API.getBusinessProfiles();
    const bpSelect = document.getElementById('exp-business-profile');
    if (bpSelect && profiles && profiles.length > 0) {
      bpSelect.innerHTML = profiles.map(p => {
        const isSelected = (State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all')
          ? p.id === State.currentBusinessProfileId
          : false;
        return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.business_name || p.legal_name || p.company_name || 'Business Profile')}</option>`;
      }).join('');
      if (!bpSelect.value && profiles[0]) {
        bpSelect.value = profiles[0].id;
      }
    }
  } catch (e) {}

  try {
    await loadExpenseCategories();
    _cachedExpenseOpportunities = await API.getOpportunities(State.currentBusinessProfileId);
    _cachedExpenseSuggestions = await API.getExpenseSuggestions();
  } catch (e) {
    _cachedExpenseOpportunities = [];
    _cachedExpenseSuggestions = [];
  }

  // Populate Tender / Quotation dropdown
  const oppSelect = document.getElementById('exp-opportunity-select');
  if (oppSelect) {
    oppSelect.innerHTML = `<option value="">-- Select Tender / Quotation (Optional) --</option>` +
      (_cachedExpenseOpportunities || []).map(o => `
        <option value="${o.id}" ${o.id === presetOppId ? 'selected' : ''}>
          ${escapeHtml(o.opportunity_number || 'TND')} - ${escapeHtml(o.tender_name || o.title || 'Untitled Tender')}
        </option>
      `).join('');
    if (presetOppId) oppSelect.value = presetOppId;
  }

  // Populate PO list for Tier 2
  try {
    const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
    const poSelect = document.getElementById('exp-po-select');
    if (poSelect) {
      poSelect.innerHTML = `<option value="">-- Select Purchase Order (PO) --</option>` +
        pos.map(p => `<option value="${p.id}" ${p.id === presetPoId ? 'selected' : ''}>${p.po_number} - ${p.customer_name || 'Customer'} (PKR ${parseFloat(p.net_amount || p.total_amount || 0).toLocaleString()})</option>`).join('');
    }
  } catch (e) {}

  handleExpenseTierChange(presetTier, presetCategory);

  if (presetOppId) {
    const matched = _cachedExpenseOpportunities.find(o => o.id === presetOppId);
    if (matched) {
      selectLinkedOpportunity(matched.id, `${matched.opportunity_number || 'TND'} - ${matched.tender_name || matched.title || 'Project'}`, matched.opportunity_number);
    }
  }
}

function handleExpenseTierChange(tier, presetCategory = '') {
  const selectedTier = tier || document.getElementById('exp-tier')?.value || 'Tier 3 - General Overheads';
  const groupLinked = document.getElementById('group-exp-linked');
  const groupPOSelect = document.getElementById('group-exp-po-select');
  const catSelect = document.getElementById('exp-category');
  const linkedLabel = document.getElementById('exp-linked-label');
  const linkedSearch = document.getElementById('exp-linked-search');

  // Populate categories dynamically from database cache
  let categories = (_cachedExpenseCategories || []).filter(c => c.tier === selectedTier && c.is_active !== false);
  
  // Fallback to static if cache not loaded yet
  if (categories.length === 0 && EXPENSE_CATEGORIES_BY_TIER[selectedTier]) {
    categories = EXPENSE_CATEGORIES_BY_TIER[selectedTier].map(name => ({ name, tier: selectedTier }));
  }

  if (catSelect) {
    let optionsHtml = categories.map(c => `
      <option value="${c.name}" ${(presetCategory && c.name === presetCategory) ? 'selected' : ''}>
        ${c.name}
      </option>
    `).join('');
    optionsHtml += `<option value="__ADD_NEW__" style="font-weight:700; color:var(--primary);">➕ + Add New Custom Category...</option>`;
    catSelect.innerHTML = optionsHtml;
    
    if (presetCategory) {
      catSelect.value = presetCategory;
    }
  }

  if (selectedTier === 'Tier 1 - Tender Direct') {
    if (groupLinked) groupLinked.style.display = 'block';
    if (groupPOSelect) groupPOSelect.style.display = 'none';
    if (linkedLabel) linkedLabel.innerText = 'Link to Specific Tender / Quotation (Optional)';
    if (linkedSearch) linkedSearch.placeholder = 'Type to search tender by title or tender #...';
  } else if (selectedTier === 'Tier 2 - PO Execution') {
    if (groupLinked) groupLinked.style.display = 'none';
    if (groupPOSelect) groupPOSelect.style.display = 'block';
  } else {
    // Tier 3 - General Overheads
    if (groupLinked) groupLinked.style.display = 'none';
    if (groupPOSelect) groupPOSelect.style.display = 'none';
  }
}

function handleExpenseCategorySelected(cat) {
  if (cat === '__ADD_NEW__') {
    const currentTier = document.getElementById('exp-tier')?.value || 'Tier 3 - General Overheads';
    openAddExpenseCategoryModal(currentTier);
    return;
  }
  const nameEl = document.getElementById('exp-name');
  if (nameEl && (!nameEl.value || cat)) {
    nameEl.value = cat;
  }
}

function openAddExpenseCategoryModal(presetTier = 'Tier 3 - General Overheads') {
  const form = document.getElementById('form-add-expense-category');
  if (form) form.reset();
  const tierSelect = document.getElementById('exp-cat-tier');
  const nameInput = document.getElementById('exp-cat-name');
  const descInput = document.getElementById('exp-cat-desc');
  const idInput = document.getElementById('exp-cat-id');
  const titleEl = document.getElementById('modal-exp-cat-title');

  if (titleEl) titleEl.innerText = '📁 Add Master Expense Category';
  if (idInput) idInput.value = '';
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (tierSelect && presetTier) tierSelect.value = presetTier;

  openModal('modal-add-expense-category');
}

function openEditExpenseCategoryModal(id) {
  const cat = (_cachedExpenseCategories || []).find(c => c.id === id);
  if (!cat) return;

  const tierSelect = document.getElementById('exp-cat-tier');
  const nameInput = document.getElementById('exp-cat-name');
  const descInput = document.getElementById('exp-cat-desc');
  const idInput = document.getElementById('exp-cat-id');
  const titleEl = document.getElementById('modal-exp-cat-title');

  if (titleEl) titleEl.innerText = '📁 Edit Master Expense Category';
  if (idInput) idInput.value = cat.id;
  if (nameInput) nameInput.value = cat.name;
  if (descInput) descInput.value = cat.description || '';
  if (tierSelect) tierSelect.value = cat.tier;

  openModal('modal-add-expense-category');
}

async function submitExpenseCategoryForm() {
  const id = document.getElementById('exp-cat-id')?.value;
  const tier = document.getElementById('exp-cat-tier')?.value;
  const name = document.getElementById('exp-cat-name')?.value?.trim();
  const description = document.getElementById('exp-cat-desc')?.value?.trim();

  if (!name || !tier) {
    alert('Category Name and Tier are required.');
    return;
  }

  if (id) {
    const res = await API.updateExpenseCategory(id, { tier, name, description });
    if (res && res.success) {
      showToast('✓ Expense category updated in database.', 'success');
    }
  } else {
    const res = await API.createExpenseCategory({ tier, name, description });
    if (res && res.success) {
      showToast(`✓ Master category "${name}" added to database!`, 'success');
    }
  }

  closeModal('modal-add-expense-category');
  await loadExpenseCategories();

  // If the expense modal is open, refresh the dropdown with the new category selected
  const expModal = document.getElementById('modal-add-expense');
  if (expModal && expModal.classList.contains('open')) {
    handleExpenseTierChange(tier, name);
    const nameEl = document.getElementById('exp-name');
    if (nameEl) nameEl.value = name;
  } else {
    await renderActiveView();
  }
}

async function deleteExpenseCategory(id) {
  if (confirm('Are you sure you want to remove this expense category?')) {
    await API.deleteExpenseCategory(id);
    showToast('Expense category deactivated.', 'info');
    await loadExpenseCategories();
    await renderActiveView();
  }
}

function handleExpensePOSelected(poId) {
  const poIdEl = document.getElementById('exp-po-id');
  if (poIdEl) poIdEl.value = poId;
}

function openLinkedDropdown() {
  const linkedSearch = document.getElementById('exp-linked-search');
  filterLinkedOpportunities(linkedSearch?.value || '');
}

function filterLinkedOpportunities(query = '') {
  const menuEl = document.getElementById('exp-linked-dropdown');
  if (!menuEl) return;

  const q = (query || '').toLowerCase().trim();
  let list = _cachedExpenseOpportunities || [];

  if (q) {
    list = list.filter(o => 
      (o.opportunity_number && o.opportunity_number.toLowerCase().includes(q)) ||
      (o.tender_name && o.tender_name.toLowerCase().includes(q)) ||
      (o.title && o.title.toLowerCase().includes(q)) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    menuEl.innerHTML = `<div class="searchable-empty-state">No matching projects/tenders found.</div>`;
    menuEl.style.display = 'block';
    return;
  }

  menuEl.innerHTML = list.map(o => {
    const oppNum = o.opportunity_number || 'TND-2026';
    const title = o.tender_name || o.title || 'Untitled Project';
    const client = o.customer_name || 'Client';
    const val = parseFloat(o.estimated_value || 0).toLocaleString();
    const safeDisplay = `${oppNum} - ${title}`.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
      <div class="searchable-dropdown-item" onclick="selectLinkedOpportunity('${o.id}', '${safeDisplay}', '${oppNum}')">
        <div class="searchable-item-title">
          <span><strong>${oppNum}</strong> - ${title}</span>
          <span class="badge badge-active" style="font-size:0.7rem;">Project</span>
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

function handleExpenseOpportunitySelected(val) {
  const oppIdEl = document.getElementById('exp-opportunity-id');
  if (oppIdEl) oppIdEl.value = val || '';
}
window.handleExpenseOpportunitySelected = handleExpenseOpportunitySelected;

// Close searchable dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrapper = document.getElementById('exp-searchable-wrapper');
  const menuEl = document.getElementById('exp-linked-dropdown');
  if (wrapper && menuEl && !wrapper.contains(e.target)) {
    menuEl.style.display = 'none';
  }
});

async function submitGeneralExpenseForm() {
  const tier = document.getElementById('exp-tier')?.value || 'Tier 3 - General Overheads';
  const name = document.getElementById('exp-name')?.value?.trim();
  const oppId = document.getElementById('exp-opportunity-select')?.value || document.getElementById('exp-opportunity-id')?.value;
  const poId = document.getElementById('exp-po-id')?.value || document.getElementById('exp-po-select')?.value;
  const cat = document.getElementById('exp-category')?.value;
  const amount = parseCurrency(document.getElementById('exp-amount')?.value);
  const date = document.getElementById('exp-date')?.value;
  const paidTo = document.getElementById('exp-paid-to')?.value;
  const mode = document.getElementById('exp-mode')?.value;
  const remarks = document.getElementById('exp-remarks')?.value;

  if (!amount || amount <= 0) {
    alert('Please enter a valid expenditure amount.');
    document.getElementById('exp-amount')?.focus();
    return;
  }

  if (!date) {
    alert('Expense Date is mandatory.');
    return;
  }

  let linkedOpp = null;
  if (oppId) {
    linkedOpp = (_cachedExpenseOpportunities || []).find(o => o.id === oppId);
  }

  let linkedPO = null;
  if (poId) {
    try {
      const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
      linkedPO = pos.find(p => p.id === poId);
    } catch (e) {}
  }

  const bpSelectVal = document.getElementById('exp-business-profile')?.value;
  const bpId = (bpSelectVal && bpSelectVal !== 'all')
    ? bpSelectVal
    : (State.currentBusinessProfileId === 'all' ? null : State.currentBusinessProfileId);

  const payload = {
    business_profile_id: bpId || null,
    expense_tier: tier,
    expense_type: tier === 'Tier 1 - Tender Direct' ? 'Tender Expense' : (tier === 'Tier 2 - PO Execution' ? 'PO Logistics' : 'General Expense'),
    expense_name: name || cat || 'General Business Expense',
    category: cat || 'Administrative Expenses',
    amount: amount,
    expense_date: date,
    paid_to: paidTo || 'Vendor / Petty Cash',
    payment_mode: mode || 'Online Bank Transfer',
    opportunity_id: oppId || linkedPO?.opportunity_id || null,
    opportunity_number: linkedOpp?.opportunity_number || linkedPO?.award_number || null,
    purchase_order_id: poId || null,
    po_number: linkedPO?.po_number || null,
    tender_name: linkedOpp?.tender_name || linkedOpp?.title || null,
    remarks: remarks,
    notes: remarks
  };

  const res = await API.createExpense(payload);
  if (!res || !res.success || !res.data?.id) {
    alert(`⚠️ Failed to record expenditure: ${res?.message || res?.error || 'Database error. Record was NOT saved.'}`);
    return;
  }

  closeModal('modal-add-expense');
  showToast(`✓ Expenditure of PKR ${amount.toLocaleString()} recorded and saved in database!`, 'success');

  await renderActiveView();
}

function syncCompanyAbbrevAndPrefix(nameInputId, abbrevInputId, prefixInputId, triggerSource = 'name') {
  const nameEl = document.getElementById(nameInputId);
  const abbrevEl = document.getElementById(abbrevInputId);
  const prefixEl = document.getElementById(prefixInputId);
  if (!prefixEl) return;

  if (triggerSource === 'name' && nameEl) {
    const raw = nameEl.value.trim();
    if (!raw) {
      if (abbrevEl && (!abbrevEl.dataset.custom || abbrevEl.dataset.custom === 'false')) abbrevEl.value = '';
      prefixEl.value = '';
      return;
    }
    // Clean company name and extract acronym
    const words = raw.split(/\s+/).filter(w => {
      const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !['pvt', 'ltd', 'limited', 'private', '(pvt)', '(pvt.)', '(ltd)', '(limited)'].includes(clean);
    });

    let generatedAbbrev = '';
    if (words.length >= 2) {
      generatedAbbrev = words.map(w => w.charAt(0)).join('').toUpperCase().slice(0, 5);
    } else if (words.length === 1) {
      generatedAbbrev = words[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    } else {
      generatedAbbrev = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
    }

    if (abbrevEl && (!abbrevEl.dataset.custom || abbrevEl.dataset.custom === 'false')) {
      abbrevEl.value = generatedAbbrev;
    }
    const finalCode = (abbrevEl && abbrevEl.value.trim()) ? abbrevEl.value.trim().toUpperCase() : generatedAbbrev;
    if (finalCode) {
      prefixEl.value = `INV-${finalCode}`;
    }
  } else if (triggerSource === 'abbrev' && abbrevEl) {
    abbrevEl.dataset.custom = 'true';
    const code = abbrevEl.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    abbrevEl.value = code;
    if (code) {
      prefixEl.value = `INV-${code}`;
    } else if (nameEl && nameEl.value.trim()) {
      abbrevEl.dataset.custom = 'false';
      syncCompanyAbbrevAndPrefix(nameInputId, abbrevInputId, prefixInputId, 'name');
    } else {
      prefixEl.value = '';
    }
  }
}
window.syncCompanyAbbrevAndPrefix = syncCompanyAbbrevAndPrefix;

function openNewCompanyModal() {
  const form = document.getElementById('form-add-company');
  if (form) form.reset();
  const editEl = document.getElementById('comp-edit-id');
  if (editEl) editEl.value = '';
  const abbrevEl = document.getElementById('comp-abbrev');
  if (abbrevEl) abbrevEl.dataset.custom = 'false';
  const prefixEl = document.getElementById('comp-inv-prefix');
  if (prefixEl) prefixEl.value = '';
  const titleEl = document.getElementById('modal-add-company-title');
  if (titleEl) titleEl.innerText = '🏢 Configure Company / Business Profile';

  openModal('modal-add-company');
}

async function openEditCompanyModal(id) {
  const profiles = State.businessProfiles || (await API.getBusinessProfiles());
  const p = profiles.find(item => String(item.id) === String(id));
  if (!p) return;

  const form = document.getElementById('form-add-company');
  if (form) form.reset();

  const editEl = document.getElementById('comp-edit-id');
  if (editEl) editEl.value = p.id;
  const titleEl = document.getElementById('modal-add-company-title');
  if (titleEl) titleEl.innerText = `✏️ Edit Business Profile: ${p.business_name}`;

  document.getElementById('comp-name').value = p.business_name || '';
  document.getElementById('comp-abbrev').value = p.abbreviation || '';
  document.getElementById('comp-legal').value = p.legal_name || '';
  document.getElementById('comp-ntn').value = p.ntn || '';
  document.getElementById('comp-strn').value = p.strn || '';
  document.getElementById('comp-city').value = p.city || 'Lahore';
  document.getElementById('comp-email').value = p.email || '';
  document.getElementById('comp-inv-prefix').value = p.invoice_prefix || 'INV';
  document.getElementById('comp-fbr').value = p.fbr_enabled ? 'true' : 'false';

  openModal('modal-add-company');
}

async function submitNewCompanyForm() {
  const editId = document.getElementById('comp-edit-id')?.value?.trim();
  const name = document.getElementById('comp-name')?.value?.trim();
  const legal = document.getElementById('comp-legal')?.value?.trim();
  const abbrev = document.getElementById('comp-abbrev')?.value?.trim();
  const ntnRaw = document.getElementById('comp-ntn')?.value?.trim();
  const strnRaw = document.getElementById('comp-strn')?.value?.trim();
  const email = document.getElementById('comp-email')?.value?.trim();
  const city = document.getElementById('comp-city')?.value?.trim();
  const invPrefix = document.getElementById('comp-inv-prefix')?.value?.trim();
  const fbr = document.getElementById('comp-fbr')?.value;

  if (!name || !legal) {
    alert('Business Display Name and Full Legal Name are mandatory.');
    return;
  }

  const ntn = (ntnRaw || '').replace(/\D/g, '');
  const strn = (strnRaw || '').replace(/\D/g, '');

  if (!ntn) {
    alert('National Tax # (NTN) is mandatory and must contain numeric digits only.');
    return;
  }
  if (!strn) {
    alert('Sales Tax # (STRN) is mandatory and must contain numeric digits only.');
    return;
  }
  if (!email || !document.getElementById('comp-email')?.checkValidity()) {
    alert('Please provide a valid official email address.');
    return;
  }

  const payload = {
    business_name: name,
    legal_name: legal,
    abbreviation: abbrev,
    ntn: ntn,
    strn: strn,
    email: email,
    city: city || 'Lahore',
    invoice_prefix: invPrefix || 'INV',
    fbr_enabled: fbr === 'true'
  };

  let targetTenantId = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
  if (typeof State.isSuperAdmin === 'function' && State.isSuperAdmin()) {
    const activeProfile = typeof State.getCurrentBusinessProfile === 'function' ? State.getCurrentBusinessProfile() : null;
    if (activeProfile && activeProfile.tenant_id) {
      targetTenantId = activeProfile.tenant_id;
    }
  }
  if (targetTenantId) payload.tenant_id = targetTenantId;

  try {
    if (editId) {
      await API.updateEntity('business-profile', editId, payload);
      closeModal('modal-add-company');
      showToast(`✓ Business profile "${name}" updated successfully!`, 'success');
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      await renderActiveView();
      return;
    }

    const res = await API.createBusinessProfile(payload);
    
    if (res && res.requires_payment_confirmation) {
      pendingPaidCompanyPayload = payload;
      const warningMsgEl = document.getElementById('paid-company-warning-msg');
      if (warningMsgEl) {
        warningMsgEl.innerText = res.message || 'You are exceeding your limit. Are you sure you want to create a company for 4,500/month?';
      }
      openModal('modal-paid-company-warning');
      return;
    }

    if (!res || res.success === false || !res.data?.id) {
      alert(`⚠️ ${res?.message || res?.error || 'Failed to create business profile in database.'}`);
      return;
    }

    closeModal('modal-add-company');

    if (res && res.application_stopped) {
      // Created paid company while on trial: Stop application until paid!
      State.setApplicationStopped(true, res.amount_due || 4500);
      openModal('modal-trial-paid-company-stop');
      showToast('⚠️ Application access paused. Payment of PKR 4,500 required for the additional company profile.', 'error');
      return;
    }

    const created = res.data;

    if (res && res.billingNotice) {
      showToast(`${res.billingNotice.notice} (Plan: ${res.billingNotice.chargePerMonth})`, 'info');
    } else {
      showToast(`✓ Business profile registered in database! Verification link automatically dispatched to ${email}`, 'success');
    }

    State.businessProfiles = await API.getBusinessProfiles();
    populateBusinessSwitcher();

    if (_quickAddContext && (_quickAddContext.entityType === 'company' || _quickAddContext.entityType === 'businessProfile')) {
      await handleQuickAddCompletion('company', created);
    } else {
      navigateToView('business-profiles');
    }
  } catch (err) {
    showToast(`Error creating company profile: ${err.message}`, 'error');
  }
}

async function confirmAndCreatePaidCompany() {
  if (!pendingPaidCompanyPayload) {
    closeModal('modal-paid-company-warning');
    return;
  }
  const payload = { ...pendingPaidCompanyPayload, confirm_paid: true };
  pendingPaidCompanyPayload = null;
  closeModal('modal-paid-company-warning');

  try {
    const res = await API.createBusinessProfile(payload);
    if (!res || res.success === false || !res.data?.id) {
      alert(`⚠️ ${res?.message || res?.error || 'Failed to create business profile in database.'}`);
      return;
    }

    closeModal('modal-add-company');

    if (res && res.application_stopped) {
      // Created paid company while on trial: Stop application until paid!
      State.setApplicationStopped(true, res.amount_due || 4500);
      openModal('modal-trial-paid-company-stop');
      showToast('⚠️ Application access paused. Payment of PKR 4,500 required for the additional company profile.', 'error');
      return;
    }

    const created = res.data;
    if (res && res.billingNotice) {
      showToast(`✓ Company registered in database! Added to subscription billing: ${res.billingNotice.chargePerMonth}`, 'info');
    } else {
      showToast('✓ Business profile registered in database successfully!', 'success');
    }

    State.businessProfiles = await API.getBusinessProfiles();
    populateBusinessSwitcher();

    if (_quickAddContext && (_quickAddContext.entityType === 'company' || _quickAddContext.entityType === 'businessProfile')) {
      await handleQuickAddCompletion('company', created);
    } else {
      navigateToView('business-profiles');
    }
  } catch (err) {
    showToast(`Error creating paid company profile: ${err.message}`, 'error');
  }
}

async function submitAddonPaymentSlip() {
  const method = document.getElementById('pay-addon-method')?.value;
  const ref = document.getElementById('pay-addon-ref')?.value?.trim();

  if (!ref) {
    alert('Please enter a valid transaction reference number or slip ID.');
    return;
  }

  const btn = document.getElementById('btn-submit-addon-pay');
  if (btn) btn.innerText = 'Submitting...';

  try {
    const res = await API.submitAddonPaymentSlip({
      reference_number: ref,
      payment_method: method,
      remarks: 'Paid company profile add-on payment slip submitted by client'
    });

    if (res && res.success) {
      closeModal('modal-trial-paid-company-stop');
      State.setApplicationStopped(false);
      showToast('✓ Payment verified! Application access resumed.', 'success');
      await renderActiveView();
      updateHeaderUserProfile();
    } else {
      alert(res.message || 'Payment submission failed. Please check details.');
    }
  } catch (e) {
    alert(`Error submitting payment: ${e.message}`);
  } finally {
    if (btn) btn.innerText = '✓ Submit Payment Proof & Resume Access';
  }
}

async function submitOnboardCompanyForm() {
  const name = document.getElementById('onboard-comp-name')?.value?.trim();
  const legal = document.getElementById('onboard-comp-legal')?.value?.trim();
  const abbrev = document.getElementById('onboard-comp-abbrev')?.value?.trim();
  const ntnRaw = document.getElementById('onboard-comp-ntn')?.value?.trim();
  const strnRaw = document.getElementById('onboard-comp-strn')?.value?.trim();
  const email = document.getElementById('onboard-comp-email')?.value?.trim();
  const city = document.getElementById('onboard-comp-city')?.value?.trim();
  const invPrefix = document.getElementById('onboard-comp-prefix')?.value?.trim();
  const fbrCheckbox = document.getElementById('onboard-comp-fbr');

  if (!name || !legal) {
    alert('Business Display Name and Full Legal Name are mandatory.');
    return;
  }

  const ntn = (ntnRaw || '').replace(/\D/g, '');
  const strn = (strnRaw || '').replace(/\D/g, '');

  if (!ntn) {
    alert('National Tax # (NTN) is mandatory and must contain numeric digits only.');
    return;
  }
  if (!strn) {
    alert('Sales Tax # (STRN) is mandatory and must contain numeric digits only.');
    return;
  }
  if (!email || !document.getElementById('onboard-comp-email')?.checkValidity()) {
    alert('Please enter a valid official email address.');
    return;
  }

  const calculatedPrefix = invPrefix || (abbrev ? `INV-${abbrev.toUpperCase()}` : 'INV');
  const payload = {
    business_name: name,
    legal_name: legal,
    abbreviation: abbrev,
    ntn: ntn,
    strn: strn,
    email: email,
    city: city || 'Lahore',
    invoice_prefix: calculatedPrefix,
    fbr_enabled: fbrCheckbox ? fbrCheckbox.checked : false
  };

  try {
    const res = await API.createBusinessProfile(payload);
    closeModal('modal-onboard-company');
    showToast(`✓ First Business Profile registered! Email verification link dispatched to ${email}`, 'success');

    State.businessProfiles = await API.getBusinessProfiles();
    populateBusinessSwitcher();

    if (payload.fbr_enabled) {
      showToast('🇵🇰 FBR PRAL Gateway enabled. You can configure API keys anytime from Settings / Invoices.', 'info');
    }
    await renderActiveView();
  } catch (err) {
    showToast(`Error registering company: ${err.message}`, 'error');
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
      { name: 'status', label: 'Workflow Status', type: 'select', options: ['New', 'Selected', 'Under Evaluation', 'Under Review', 'Ready to submit', 'Submitted', 'Won', 'Lost', 'Technical Disqualified', 'Withdrawn'] },
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
      { name: 'account_title', label: 'Account Title *', type: 'text', required: true },
      { name: 'beneficiary', label: 'Beneficiary *', type: 'text', required: true },
      { name: 'instrument_type', label: 'Instrument Type *', type: 'select', options: ['BG', 'PO', 'CDR', 'Insurance Bond', 'Other'], required: true },
      { name: 'instrument_number', label: 'Instrument Number *', type: 'text', required: true, fallbackField: 'guarantee_number' },
      { name: 'amount', label: 'Amount (PKR) *', type: 'number', required: true },
      { name: 'bank_name', label: 'Issuing Bank & Branch', type: 'text', fallbackField: 'bank_branch' },
      { name: 'expiry_date', label: 'Performance Guarantee Date *', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Released', 'Encashment Claimed'] },
      { name: 'comments', label: 'Comments / Remarks', type: 'textarea', colSpan: 2, fallbackField: 'remarks' }
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
      { name: 'due_date', label: 'Payment Due Date', type: 'date' },
      { name: 'status', label: 'Invoice Status', type: 'select', options: ['Submitted', 'Reinvoicing', 'Pending', 'Hold', 'Paid'] },
      { name: 'payment_terms', label: 'Payment Terms', type: 'text' },
      { name: 'total_amount', label: 'Total Invoice Amount (PKR) *', type: 'number', required: true },
      { name: 'tax_amount', label: 'GST / Sales Tax Amount (PKR)', type: 'number' },
      { name: 'subtotal', label: 'Subtotal Excl. Tax (PKR)', type: 'number' },
      { name: 'submission_diary_no', label: 'Submission Diary / Dispatch Ref #', type: 'text' },
      { name: 'submission_diary_date', label: 'Submission Diary Date', type: 'date' },
      { name: 'dealing_officer_name', label: 'Dealing Officer Name', type: 'text' },
      { name: 'department_section', label: 'Department / Section', type: 'text' },
      { name: 'dtl_clearance_ref', label: 'DTL Clearance Ref', type: 'text' },
      { name: 'notes', label: 'Remarks / Notes', type: 'textarea', colSpan: 2 }
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
      { 
        name: 'opportunity_id', 
        label: 'Linked Tender / Quotation (Optional)', 
        type: 'select', 
        options: async () => {
          const opps = await API.getOpportunities();
          return [
            { value: '', label: '-- None (General Overhead) --' },
            ...(opps || []).map(o => ({
              value: o.id,
              label: `${o.opportunity_number || 'TND'} - ${o.tender_name || o.title || 'Tender'}`
            }))
          ];
        },
        colSpan: 2 
      },
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
      { name: 'abbreviation', label: 'Abbreviation / Short Code', type: 'text' },
      { name: 'legal_name', label: 'Legal Name *', type: 'text', required: true },
      { name: 'email', label: 'Official Email', type: 'text' },
      { name: 'ntn', label: 'National Tax Number (NTN) *', type: 'text', required: true },
      { name: 'strn', label: 'Sales Tax Registration (STRN) *', type: 'text', required: true },
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

// --------------------------------------------------------------------------
// View Invoice Modal
// --------------------------------------------------------------------------
async function openViewInvoiceModal(invoiceId) {
  let inv = null;
  try {
    const list = await API.getInvoices(State.currentBusinessProfileId);
    if (Array.isArray(list)) {
      inv = list.find(i => String(i.id) === String(invoiceId));
    }
  } catch (e) {
    console.error('openViewInvoiceModal: fetch error', e);
  }

  if (!inv) {
    showToast('Invoice record not found.', 'error');
    return;
  }

  const fmt = (v) => formatCurrency(parseFloat(v || 0), 'PKR');
  const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Header strip
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val || '—'; };
  el('view-inv-title', `Invoice — ${inv.invoice_number}`);
  el('view-inv-number', inv.invoice_number);

  const statusColors = { Paid: '#059669', Submitted: '#0284c7', Pending: '#d97706', Hold: '#dc2626', Reinvoicing: '#7c3aed' };
  const statusEl = document.getElementById('view-inv-status-badge');
  if (statusEl) statusEl.innerHTML = `<span style="background:${statusColors[inv.status] || '#64748b'}; color:white; padding:3px 10px; border-radius:20px; font-size:0.78rem; font-weight:700;">${inv.status || 'Submitted'}</span>`;

  const fbrEl = document.getElementById('view-inv-fbr-badge');
  if (fbrEl) fbrEl.innerHTML = inv.fbr_status === 'FBR Validated'
    ? `<span style="background:#059669; color:white; padding:3px 10px; border-radius:20px; font-size:0.78rem; font-weight:700;">✓ Validated</span>`
    : `<span style="background:#6b7280; color:white; padding:3px 10px; border-radius:20px; font-size:0.78rem; font-weight:700;">Unvalidated</span>`;

  const totalEl = document.getElementById('view-inv-total');
  if (totalEl) totalEl.textContent = fmt(inv.total_amount);

  // Detail grid
  el('view-inv-customer', inv.customer_name);
  const podc = document.getElementById('view-inv-po-dc');
  if (podc) podc.innerHTML = `<strong>${inv.po_number || 'PO Ref'}</strong>${inv.dc_number ? `<br><span style="font-size:0.8rem; color:#64748b;">${inv.dc_number}</span>` : ''}`;
  el('view-inv-date', fmtDate(inv.invoice_date));
  el('view-inv-due-date', fmtDate(inv.due_date));
  el('view-inv-payment-terms', inv.payment_terms);
  el('view-inv-delivery-site', inv.delivery_site || inv.client_site || '—');

  // Financial breakdown
  const totalAmt = parseFloat(inv.total_amount || 0);
  const gstAmt = parseFloat(inv.tax_amount || inv.gst_amount || 0);
  const subtotalAmt = parseFloat(inv.subtotal || inv.subtotal_amount || (totalAmt - gstAmt) || 0);
  const paidAmt = parseFloat(inv.paid_amount || 0);
  const outstanding = inv.outstanding_amount !== undefined ? parseFloat(inv.outstanding_amount) : (totalAmt - paidAmt);
  el('view-inv-subtotal', fmt(subtotalAmt));
  el('view-inv-gst', fmt(gstAmt));
  el('view-inv-billed', fmt(totalAmt));
  const outstandingEl = document.getElementById('view-inv-outstanding');
  if (outstandingEl) outstandingEl.textContent = fmt(outstanding);

  // Submission / Tracking
  el('view-inv-diary-no', inv.submission_diary_no);
  el('view-inv-diary-date', fmtDate(inv.submission_diary_date));
  el('view-inv-dealing-officer', inv.dealing_officer_name);
  el('view-inv-dept', inv.department_section);
  el('view-inv-dtl', inv.dtl_clearance_ref);

  // Remarks
  const remarksSection = document.getElementById('view-inv-remarks-section');
  const remarksEl = document.getElementById('view-inv-remarks');
  const hasRemarks = !!(inv.notes || inv.remarks);
  if (remarksSection) remarksSection.style.display = hasRemarks ? '' : 'none';
  if (remarksEl) remarksEl.textContent = inv.notes || inv.remarks || '';

  // Edit shortcut button
  const editBtn = document.getElementById('view-inv-edit-btn');
  if (editBtn) {
    const canEdit = !State.isReadOnly() && State.hasPermission('invoices', 'edit');
    editBtn.style.display = canEdit ? '' : 'none';
    editBtn.onclick = () => { closeModal('modal-view-invoice'); openEditEntityModal('invoice', invoiceId); };
  }

  // Print button
  const printBtn = document.getElementById('view-inv-print-btn');
  if (printBtn) {
    printBtn.onclick = () => printInvoice(inv);
  }

  openModal('modal-view-invoice');
}

// --------------------------------------------------------------------------
// Print Invoice — Opens professional tax invoice in new window → Save as PDF
// --------------------------------------------------------------------------
function printInvoice(inv) {
  const bp = State.getCurrentBusinessProfile() || {};
  const fmt = (v) => `PKR ${parseFloat(v || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const totalAmt   = parseFloat(inv.total_amount || 0);
  const taxAmt     = parseFloat(inv.tax_amount || inv.gst_amount || 0);
  const subtotal   = parseFloat(inv.subtotal || inv.subtotal_amount || (totalAmt - taxAmt) || 0);
  const paidAmt    = parseFloat(inv.paid_amount || 0);
  const outstanding = inv.outstanding_amount !== undefined
    ? parseFloat(inv.outstanding_amount)
    : (totalAmt - paidAmt);
  const gstRate    = subtotal > 0 ? ((taxAmt / subtotal) * 100).toFixed(0) : '18';

  const statusBg = { Paid: '#059669', Submitted: '#0284c7', Pending: '#d97706', Hold: '#dc2626', Reinvoicing: '#7c3aed' };
  const sColor = statusBg[inv.status] || '#64748b';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${inv.invoice_number}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', Arial, sans-serif;
      font-size: 12px;
      color: #1e293b;
      background: #f1f5f9;
    }
    .page {
      background: white;
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 14mm 16mm;
      position: relative;
    }
    /* ── Header ── */
    .inv-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #0284c7;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .company-block h1 {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
    }
    .company-block .tagline {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
    }
    .company-block .tax-ids {
      margin-top: 6px;
      font-size: 10.5px;
      color: #334155;
      line-height: 1.6;
    }
    .inv-title-block {
      text-align: right;
    }
    .inv-title-block h2 {
      font-size: 22px;
      font-weight: 800;
      color: #0284c7;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .inv-title-block .inv-num {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 4px;
    }
    .inv-title-block .status-pill {
      display: inline-block;
      background: ${sColor};
      color: white;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 20px;
      margin-top: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    /* ── FBR Banner ── */
    .fbr-banner {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
      color: white;
      padding: 7px 14px;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      font-size: 10px;
    }
    .fbr-banner strong { font-size: 11px; }
    .fbr-validated { color: #34d399; font-weight: 700; }
    /* ── Bill To / Invoice Meta ── */
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .meta-box {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .meta-box h4 {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.8px;
      margin-bottom: 5px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
    }
    .meta-box p {
      font-size: 11px;
      line-height: 1.7;
      color: #1e293b;
    }
    .meta-box p strong { font-weight: 700; font-size: 12px; color: #0f172a; }
    /* ── Amount Summary Cards ── */
    .amount-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .amount-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      text-align: center;
    }
    .amount-card.highlight { background: #f0f9ff; border-color: #bae6fd; }
    .amount-card.paid-card { background: #f0fdf4; border-color: #a7f3d0; }
    .amount-card.due-card  { background: #fff1f2; border-color: #fecdd3; }
    .amount-card .label { font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .amount-card .value { font-size: 13px; font-weight: 800; color: #0f172a; margin-top: 3px; }
    .amount-card.highlight .value { color: #0284c7; }
    .amount-card.paid-card .value { color: #059669; }
    .amount-card.due-card .value  { color: #dc2626; }
    /* ── Charges Table ── */
    .charges-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 11px;
    }
    .charges-table thead tr {
      background: #0284c7;
      color: white;
    }
    .charges-table thead th {
      padding: 8px 10px;
      text-align: left;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .charges-table thead th:last-child { text-align: right; }
    .charges-table tbody tr { border-bottom: 1px solid #f1f5f9; }
    .charges-table tbody tr:nth-child(even) { background: #f8fafc; }
    .charges-table tbody td { padding: 9px 10px; }
    .charges-table tfoot tr { background: #f8fafc; font-weight: 700; }
    .charges-table tfoot td { padding: 8px 10px; border-top: 2px solid #0284c7; }
    .charges-table .gst-row { color: #d97706; }
    .charges-table .total-row { font-size: 13px; color: #0284c7; }
    .text-right { text-align: right; }
    /* ── Submission Tracking ── */
    .tracking-section {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
    }
    .tracking-section h4 {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 5px;
    }
    .tracking-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .tracking-item .t-label {
      font-size: 9px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .tracking-item .t-value {
      font-size: 11px;
      font-weight: 600;
      color: #1e293b;
      margin-top: 1px;
    }
    /* ── Remarks ── */
    .remarks-box {
      background: #fefce8;
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 9px 12px;
      margin-bottom: 14px;
      font-size: 11px;
      color: #78350f;
    }
    .remarks-box strong { font-size: 10px; text-transform: uppercase; display: block; margin-bottom: 3px; color: #92400e; }
    /* ── Footer ── */
    .inv-footer {
      position: absolute;
      bottom: 10mm;
      left: 16mm;
      right: 16mm;
      border-top: 2px solid #e2e8f0;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      color: #94a3b8;
    }
    .signature-block {
      display: flex;
      gap: 60px;
    }
    .sig-item {
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #94a3b8;
      width: 120px;
      margin: 28px auto 4px;
      font-size: 9px;
      color: #64748b;
    }
    /* ── Print ── */
    @media print {
      body { background: white; }
      .page { margin: 0; padding: 10mm 14mm; box-shadow: none; }
      .no-print { display: none !important; }
    }
    /* ── Screen-only print button ── */
    .print-bar {
      background: #0f172a;
      color: white;
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'Inter', Arial, sans-serif;
      font-size: 13px;
    }
    .print-btn {
      background: #0284c7;
      color: white;
      border: none;
      padding: 8px 22px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Inter', Arial, sans-serif;
    }
    .print-btn:hover { background: #0369a1; }
    .pdf-btn {
      background: #059669;
      color: white;
      border: none;
      padding: 8px 22px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      margin-left: 8px;
      font-family: 'Inter', Arial, sans-serif;
    }
    .pdf-btn:hover { background: #047857; }
  </style>
</head>
<body>

  <!-- Screen-only toolbar (hidden during print) -->
  <div class="print-bar no-print">
    <span>🧾 ${inv.invoice_number} &nbsp;|&nbsp; ${inv.customer_name}</span>
    <span>
      <button class="print-btn" onclick="window.print()">🖨️ Print</button>
      <button class="pdf-btn" onclick="window.print()">📄 Save as PDF</button>
    </span>
  </div>

  <div class="page">

    <!-- ── HEADER ── -->
    <div class="inv-header">
      <div class="company-block">
        <h1>${bp.business_name || bp.legal_name || 'Business Entity'}</h1>
        <div class="tagline">${bp.tagline || 'Commercial Tax Invoice — FBR PRAL Compliant'}</div>
        <div class="tax-ids">
          ${bp.ntn ? `<span><strong>NTN:</strong> ${bp.ntn}</span>&nbsp;&nbsp;` : ''}
          ${bp.strn ? `<span><strong>STRN:</strong> ${bp.strn}</span><br>` : ''}
          ${bp.address || bp.city ? `<span>${[bp.address, bp.city].filter(Boolean).join(', ')}</span>` : ''}
        </div>
      </div>
      <div class="inv-title-block">
        <h2>Tax Invoice</h2>
        <div class="inv-num">${inv.invoice_number}</div>
        <div><span class="status-pill">${inv.status || 'Submitted'}</span></div>
      </div>
    </div>

    <!-- ── FBR BANNER ── -->
    <div class="fbr-banner">
      <span>🏛️ <strong>Federal Board of Revenue (FBR) — PRAL Digital Tax Invoice</strong> &nbsp;|&nbsp; Sales Tax Act 1990</span>
      <span>${inv.fbr_status === 'FBR Validated'
        ? '<span class="fbr-validated">✓ FBR Validated</span>'
        : '<span style="color:#fca5a5;">⚠ Pending Validation</span>'
      }</span>
    </div>

    <!-- ── BILL TO + INVOICE META ── -->
    <div class="meta-grid">
      <div class="meta-box">
        <h4>Bill To</h4>
        <p>
          <strong>${inv.customer_name || '—'}</strong><br>
          ${inv.customer_org_type ? `${inv.customer_org_type}<br>` : ''}
          ${inv.delivery_site || inv.client_site || ''}
        </p>
      </div>
      <div class="meta-box">
        <h4>Invoice Details</h4>
        <p>
          <strong>Invoice Date:</strong> ${fmtDate(inv.invoice_date)}<br>
          <strong>Due Date:</strong> ${fmtDate(inv.due_date)}<br>
          ${inv.payment_terms ? `<strong>Payment Terms:</strong> ${inv.payment_terms}<br>` : ''}
          <strong>PO Ref:</strong> ${inv.po_number || '—'}<br>
          ${inv.dc_number ? `<strong>DC / Challan:</strong> ${inv.dc_number}` : ''}
        </p>
      </div>
    </div>

    <!-- ── AMOUNT SUMMARY CARDS ── -->
    <div class="amount-cards">
      <div class="amount-card">
        <div class="label">Subtotal (Excl. Tax)</div>
        <div class="value">${fmt(subtotal)}</div>
      </div>
      <div class="amount-card">
        <div class="label">GST ${gstRate}%</div>
        <div class="value" style="color:#d97706;">${fmt(taxAmt)}</div>
      </div>
      <div class="amount-card highlight">
        <div class="label">Total Invoiced</div>
        <div class="value">${fmt(totalAmt)}</div>
      </div>
      <div class="amount-card paid-card">
        <div class="label">Amount Received</div>
        <div class="value">${fmt(paidAmt)}</div>
      </div>
    </div>

    <!-- ── CHARGES TABLE ── -->
    <table class="charges-table">
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th style="width:45%">Description / Particulars</th>
          <th style="width:20%" class="text-right">Rate (PKR)</th>
          <th style="width:10%" class="text-right">GST %</th>
          <th style="width:20%" class="text-right">Amount (PKR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <strong>Supply / Services</strong><br>
            <span style="color:#64748b; font-size:10px;">As per PO: ${inv.po_number || 'N/A'} ${inv.dc_number ? `| DC: ${inv.dc_number}` : ''}</span>
          </td>
          <td class="text-right">${fmt(subtotal)}</td>
          <td class="text-right">${gstRate}%</td>
          <td class="text-right">${fmt(subtotal)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="gst-row">
          <td colspan="4" class="text-right">Sales Tax / GST @ ${gstRate}%</td>
          <td class="text-right">${fmt(taxAmt)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="4" class="text-right" style="font-size:13px;">TOTAL PAYABLE</td>
          <td class="text-right" style="font-size:14px;">${fmt(totalAmt)}</td>
        </tr>
        ${outstanding > 0 ? `
        <tr style="color:#dc2626;">
          <td colspan="4" class="text-right">Outstanding Balance</td>
          <td class="text-right"><strong>${fmt(outstanding)}</strong></td>
        </tr>` : `
        <tr style="color:#059669;">
          <td colspan="4" class="text-right">✓ Fully Paid</td>
          <td class="text-right"><strong>${fmt(paidAmt)}</strong></td>
        </tr>`}
      </tfoot>
    </table>

    <!-- ── SUBMISSION TRACKING ── -->
    ${(inv.submission_diary_no || inv.dealing_officer_name || inv.department_section || inv.dtl_clearance_ref) ? `
    <div class="tracking-section">
      <h4>📋 Submission &amp; Dispatch Tracking</h4>
      <div class="tracking-grid">
        ${inv.submission_diary_no ? `
        <div class="tracking-item">
          <div class="t-label">Diary / Dispatch Ref</div>
          <div class="t-value">${inv.submission_diary_no}</div>
        </div>` : ''}
        ${inv.submission_diary_date ? `
        <div class="tracking-item">
          <div class="t-label">Submission Date</div>
          <div class="t-value">${fmtDate(inv.submission_diary_date)}</div>
        </div>` : ''}
        ${inv.dealing_officer_name ? `
        <div class="tracking-item">
          <div class="t-label">Dealing Officer</div>
          <div class="t-value">${inv.dealing_officer_name}</div>
        </div>` : ''}
        ${inv.department_section ? `
        <div class="tracking-item">
          <div class="t-label">Department / Section</div>
          <div class="t-value">${inv.department_section}</div>
        </div>` : ''}
        ${inv.dtl_clearance_ref ? `
        <div class="tracking-item">
          <div class="t-label">DTL Clearance Ref</div>
          <div class="t-value">${inv.dtl_clearance_ref}</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <!-- ── REMARKS ── -->
    ${inv.notes || inv.remarks ? `
    <div class="remarks-box">
      <strong>Remarks / Notes</strong>
      ${inv.notes || inv.remarks}
    </div>` : ''}

    <!-- ── SIGNATURE FOOTER ── -->
    <div class="inv-footer">
      <div style="line-height:1.8;">
        <div>Generated by: Mashrue Enterprise BMS</div>
        <div>Printed: ${new Date().toLocaleString('en-PK')}</div>
      </div>
      <div class="signature-block">
        <div class="sig-item">
          <div class="sig-line">Prepared By</div>
        </div>
        <div class="sig-item">
          <div class="sig-line">Authorized Signatory</div>
        </div>
        <div class="sig-item">
          <div class="sig-line">Received By (Customer)</div>
        </div>
      </div>
    </div>

  </div><!-- /.page -->

  <script>
    // Auto-trigger print after fonts load
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 600);
    });
  </script>
</body>
</html>`;

  const printWin = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (!printWin) {
    showToast('Popup blocked. Please allow popups for this site to print invoices.', 'warning');
    return;
  }
  printWin.document.write(html);
  printWin.document.close();
}

async function openEditEntityModal(entityType, id) {
  const schema = ENTITY_SCHEMAS[entityType];
  if (!schema) {
    showToast(`Edit configuration for ${entityType} is not available.`, 'error');
    return;
  }

  // Fetch or find record from API or local State fallback
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
    const pluralKeyMap = {
      opportunity: 'opportunities',
      'bid-security': 'bid_securities',
      award: 'awards',
      guarantee: 'guarantees',
      'purchase-order': 'purchase_orders',
      'delivery-challan': 'delivery_challans',
      invoice: 'invoices',
      payment: 'payments',
      warehouse: 'warehouses',
      procurement: 'procurements',
      expense: 'expenses',
      customer: 'customers',
      supplier: 'suppliers',
      product: 'products',
      'business-profile': 'businessProfiles',
      user: 'users'
    };
    const key = pluralKeyMap[entityType];
    if (key && State.getTenantEntityList) {
      const localList = State.getTenantEntityList(key);
      record = localList.find(item => String(item.id) === String(id));
    }
  }

  if (!record) {
    record = { id: id };
  }

  // Set modal title & hidden inputs
  const titleEl = document.getElementById('edit-modal-title');
  const typeInput = document.getElementById('edit-entity-type');
  const idInput = document.getElementById('edit-entity-id');
  const container = document.getElementById('edit-fields-container');

  if (titleEl) titleEl.innerHTML = `✏️ Edit ${schema.title}`;
  if (typeInput) typeInput.value = entityType;
  if (idInput) idInput.value = id;

  if (!container) return;

  // Render form fields
  const fieldsHTMLArr = await Promise.all(schema.fields.map(async f => {
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
      const rawOpts = typeof f.options === 'function' ? await f.options() : (f.options || []);
      const optionsHTML = rawOpts.map(opt => {
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
          <textarea class="form-textarea" id="${fieldId}" name="${f.name}" rows="3" ${f.required ? 'required' : ''}>${val}</textarea>
        </div>
      `;
    } else {
      return `
        <div class="form-group" style="${colStyle}">
          <label class="form-label">${f.label}</label>
          <input type="${f.type || 'text'}" class="form-input" id="${fieldId}" name="${f.name}" value="${val}" ${f.required ? 'required' : ''} ${f.type === 'number' ? 'step="any"' : ''}>
        </div>
      `;
    }
  }));

  const fieldsHTML = fieldsHTMLArr.join('');

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
    showToast('Missing entity information for update.', 'error');
    return;
  }

  // Collect values
  const payload = {};
  for (const f of schema.fields) {
    const el = document.getElementById(`edit-field-${f.name}`);
    if (el) {
      if (f.required && !el.value.trim()) {
        showToast(`${f.label.replace('*', '').trim()} is required.`, 'warning');
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
    showToast(`✓ ${schema.title} updated successfully!`, 'success');
    await renderActiveView();
  } catch (err) {
    console.error('Update error:', err);
    showToast(`Failed to update record: ${err.message}`, 'error');
  }
}

// --------------------------------------------------------------------------
// PAID LIMIT ACTION HANDLERS
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// RBAC USER & EMPLOYEE ACTION HANDLERS
// --------------------------------------------------------------------------

function applyRbacPreset(presetType) {
  const toggles = document.querySelectorAll('.perm-toggle');
  toggles.forEach(t => {
    const act = t.dataset.action;
    if (presetType === 'full') {
      t.checked = true;
    } else if (presetType === 'readonly') {
      t.checked = (act === 'view');
    } else if (presetType === 'revoke') {
      t.checked = false;
    }
  });
}

function handleEqualRightsToggle(checked) {
  if (checked) {
    applyRbacPreset('full');
  }
}
window.handleEqualRightsToggle = handleEqualRightsToggle;

function openCreateUserModal(defaultRole = 'ClientEmployee') {
  const form = document.getElementById('form-create-user');
  if (form) form.reset();

  const titleEl = document.getElementById('modal-create-user-title');
  const roleSelect = document.getElementById('newuser-role');
  const passInput = document.getElementById('newuser-password');
  const passLabel = document.getElementById('label-newuser-password');
  const passGuide = document.getElementById('box-newuser-password-guide');
  const saveBtn = document.getElementById('btn-save-user');
  const companyContainer = document.getElementById('newuser-company-checkboxes');
  const eqToggle = document.getElementById('newuser-equal-rights');

  if (eqToggle) {
    eqToggle.checked = false;
    const parentBox = eqToggle.closest('div[style*="background: #eff6ff"]') || eqToggle.parentElement?.parentElement;
    if (parentBox) parentBox.style.display = 'block';
  }

  document.getElementById('newuser-id').value = '';
  document.getElementById('newuser-fullname').value = '';
  document.getElementById('newuser-username').value = '';
  document.getElementById('newuser-email').value = '';
  document.getElementById('newuser-can-see-prices').checked = true;

  if (passInput) {
    passInput.value = 'Password123!';
    passInput.required = true;
  }
  if (passLabel) passLabel.innerText = 'Initial Password *';
  if (passGuide) passGuide.style.display = 'block';
  if (saveBtn) saveBtn.innerText = '💾 Save User / Employee';
  if (roleSelect) {
    if (State.isSuperAdmin && State.isSuperAdmin()) {
      roleSelect.innerHTML = `
        <option value="ClientEmployee">Client Employee (Custom Configurable Access)</option>
        <option value="ReadOnly">Read Only (View Permitted Screens - No Create / Edit / Delete)</option>
        <option value="CompanyAdmin">Company Admin (Single Company Administrator)</option>
        <option value="ClientAdmin">Client Admin (Full Tenant Admin)</option>
        <option value="SuperAdmin">Super Admin (System Owner)</option>
      `;
    } else {
      roleSelect.innerHTML = `
        <option value="ClientEmployee" selected>Client Employee (Custom Configurable Access)</option>
        <option value="ReadOnly">Read Only (View Permitted Screens - No Create / Edit / Delete)</option>
      `;
    }
    const safeRole = (defaultRole === 'SuperAdmin' && !State.isSuperAdmin()) ? 'ClientEmployee' : defaultRole;
    roleSelect.value = safeRole;

    const updateEmailRequirement = (r) => {
      const emailInput = document.getElementById('newuser-email');
      const emailLabel = document.querySelector('label[for="newuser-email"]') || emailInput?.previousElementSibling;
      const isAdminRole = (r === 'ClientAdmin' || r === 'CompanyAdmin' || r === 'SuperAdmin');
      if (emailInput) {
        emailInput.required = isAdminRole;
        emailInput.placeholder = isAdminRole ? 'admin@company.pk * (Required)' : 'employee@company.pk (Optional)';
      }
      if (emailLabel) {
        emailLabel.innerText = isAdminRole ? 'Official Email Address *' : 'Email Address (Optional)';
      }
    };

    updateEmailRequirement(safeRole);
    roleSelect.onchange = (e) => {
      handleUserRoleChange(e.target.value);
      updateEmailRequirement(e.target.value);
    };
  }
  if (titleEl) {
    titleEl.innerText = defaultRole === 'SuperAdmin' && State.isSuperAdmin() ? '👑 Add Super Admin User' : '👤 Add New User / Employee';
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

  // Apply default full access
  applyRbacPreset(defaultRole === 'ReadOnly' ? 'readonly' : 'full');
  handleUserRoleSelection(defaultRole);
  openModal('modal-create-user');
}

function openEditUserModal(userId) {
  if (String(userId) === String(State.currentUser?.id) && !State.isSuperAdmin()) {
    alert('⚠️ Security Rule: Administrators cannot edit their own account or permissions from User Management.');
    return;
  }
  if (!State.isSuperAdmin() && !State.isCreatedBySuperAdmin()) {
    alert('⚠️ Forbidden: Only the organization administrator created by Super Admin has permission to edit users.');
    return;
  }

  const users = State.getStoredUsers ? State.getStoredUsers() : [];
  const u = users.find(user => user.id === userId) || { id: userId };

  if (!State.isSuperAdmin() && (u.is_primary_admin || u.isPrimaryAdmin || (u.role === 'ClientAdmin' && u.is_created_by_super_admin))) {
    alert('⚠️ Security Policy: The Primary Organization Administrator created by Super Admin cannot be edited.');
    return;
  }

  const titleEl = document.getElementById('modal-create-user-title');
  const roleSelect = document.getElementById('newuser-role');
  const passInput = document.getElementById('newuser-password');
  const passLabel = document.getElementById('label-newuser-password');
  const passGuide = document.getElementById('box-newuser-password-guide');
  const saveBtn = document.getElementById('btn-save-user');
  const companyContainer = document.getElementById('newuser-company-checkboxes');
  const eqToggle = document.getElementById('newuser-equal-rights');

  if (eqToggle) {
    eqToggle.checked = false;
    const parentBox = eqToggle.closest('div[style*="background: #eff6ff"]') || eqToggle.parentElement?.parentElement;
    if (parentBox) parentBox.style.display = 'none';
  }

  document.getElementById('newuser-id').value = u.id || userId;
  document.getElementById('newuser-fullname').value = u.full_name || '';
  document.getElementById('newuser-username').value = u.username || '';
  document.getElementById('newuser-email').value = u.email || '';
  document.getElementById('newuser-can-see-prices').checked = (u.can_see_bidding_prices !== false);

  if (passInput) {
    passInput.value = '';
    passInput.required = false;
  }
  if (passLabel) passLabel.innerText = 'New Password (Leave blank to keep unchanged)';
  if (passGuide) passGuide.style.display = 'block';
  if (saveBtn) saveBtn.innerText = '💾 Update User Rights & Permissions';
  
  if (roleSelect) {
    if (State.isSuperAdmin && State.isSuperAdmin()) {
      roleSelect.innerHTML = `
        <option value="ClientEmployee">Client Employee (Custom Configurable Access)</option>
        <option value="ReadOnly">Read Only (View Permitted Screens - No Create / Edit / Delete)</option>
        <option value="CompanyAdmin">Company Admin (Single Company Administrator)</option>
        <option value="ClientAdmin">Client Admin (Full Tenant Admin)</option>
        <option value="SuperAdmin">Super Admin (System Owner)</option>
      `;
    } else {
      roleSelect.innerHTML = `
        <option value="ClientEmployee">Client Employee (Custom Configurable Access)</option>
        <option value="ReadOnly">Read Only (View Permitted Screens - No Create / Edit / Delete)</option>
        <option value="CompanyAdmin">Company Admin (Single Company Administrator)</option>
        <option value="ClientAdmin">Client Admin (Full Tenant Admin)</option>
      `;
    }
    const targetRole = u.role || 'ClientEmployee';
    roleSelect.value = (targetRole === 'SuperAdmin' && !State.isSuperAdmin()) ? 'ClientEmployee' : targetRole;
  }
  if (titleEl) {
    titleEl.innerText = `✏️ Edit Rights & Permissions: ${u.full_name || u.username || 'User'}`;
  }

  // Populate company checkboxes
  if (companyContainer) {
    if (State.businessProfiles && State.businessProfiles.length > 0) {
      const assignedIds = Array.isArray(u.business_access) 
        ? u.business_access.map(b => typeof b === 'object' ? b.id : b)
        : (Array.isArray(u.business_profile_ids) ? u.business_profile_ids : []);

      companyContainer.innerHTML = State.businessProfiles.map(p => {
        const isAssigned = (assignedIds.length === 0 || assignedIds.includes(p.id));
        return `
          <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; cursor:pointer;">
            <input type="checkbox" class="user-company-checkbox permissions-checkbox" value="${p.id}" ${isAssigned ? 'checked' : ''}>
            <span>🏢 ${p.business_name}</span>
          </label>
        `;
      }).join('');
    } else {
      companyContainer.innerHTML = '<span style="font-size:0.8rem; color:#64748b;">All configured companies accessible.</span>';
    }
  }

  // Populate matrix checkboxes from user permissions
  const toggles = document.querySelectorAll('.perm-toggle');
  toggles.forEach(t => {
    const mod = t.dataset.module;
    const act = t.dataset.action;
    if (u.permissions && u.permissions[mod] && u.permissions[mod][act] !== undefined) {
      t.checked = Boolean(u.permissions[mod][act]);
    } else {
      if (u.role === 'ReadOnly') {
        t.checked = (act === 'view');
      } else {
        t.checked = (act === 'view' || act === 'add');
      }
    }
  });

  handleUserRoleSelection(u.role || 'ClientEmployee');
  openModal('modal-create-user');
}

function handleUserRoleSelection(role) {
  const matrixContainer = document.getElementById('rbac-matrix-container');
  if (!matrixContainer) return;

  if (role === 'SuperAdmin' || role === 'ClientAdmin') {
    matrixContainer.style.display = 'none'; // Admins have full access
  } else if (role === 'ReadOnly') {
    matrixContainer.style.display = 'block';
    applyRbacPreset('readonly');
  } else {
    matrixContainer.style.display = 'block'; // Employees have granular configurable access
  }
}

async function submitCreateUserForm() {
  const userId = document.getElementById('newuser-id')?.value?.trim();
  const fullname = document.getElementById('newuser-fullname')?.value?.trim();
  const username = document.getElementById('newuser-username')?.value?.trim();
  const email = document.getElementById('newuser-email')?.value?.trim();
  const password = document.getElementById('newuser-password')?.value;
  const role = document.getElementById('newuser-role')?.value || 'ClientEmployee';
  const canSeePrices = document.getElementById('newuser-can-see-prices')?.checked;
  const equalRights = document.getElementById('newuser-equal-rights')?.checked;

  if (!State.isSuperAdmin() && (role === 'SuperAdmin' || role === 'LimitedSuperAdmin')) {
    alert('⚠️ Permission Denied: Client Administrators cannot assign or create Super Admin accounts.');
    return;
  }

  if (!fullname) {
    alert('Full name is required.');
    return;
  }

  if (!userId && !password) {
    alert('Password is required for new user accounts.');
    return;
  }

  if (password) {
    const passCheck = validatePasswordStrength(password);
    if (!passCheck.valid) {
      alert(`⚠️ Password Requirement:\n${passCheck.message}`);
      return;
    }
  }

  const submitBtn = document.querySelector('#form-create-user button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Saving User Permissions...</span>';
  }

  try {
    const effectiveUsername = (username || (email ? email.split('@')[0] : fullname.toLowerCase().replace(/[^a-z0-9]/g, '')) || `user_${Date.now()}`).toLowerCase();
    const effectiveEmail = email ? email.trim().toLowerCase() : null;

    // Gather granular screen permissions
    const permissions = {};
    const toggles = document.querySelectorAll('.perm-toggle');
    toggles.forEach(t => {
      const mod = t.dataset.module;
      const act = t.dataset.action;
      if (!permissions[mod]) permissions[mod] = {};
      permissions[mod][act] = (role === 'ReadOnly' && (act === 'add' || act === 'edit')) ? false : t.checked;
    });

    // Gather selected company IDs
    const compCheckboxes = document.querySelectorAll('.user-company-checkbox:checked');
    const businessProfileIds = Array.from(compCheckboxes).map(c => c.value);

    const payload = {
      full_name: fullname,
      username: effectiveUsername,
      email: effectiveEmail,
      role,
      can_see_bidding_prices: canSeePrices,
      equal_rights: Boolean(equalRights),
      permissions,
      business_profile_ids: businessProfileIds
    };
    if (password) payload.password = password;

    if (userId) {
      // Edit mode: Update existing user
      const res = await API.updateUser(userId, payload);
      closeModal('modal-create-user');
      alert(`✓ User rights and permissions for '${fullname}' updated successfully!`);
      await renderActiveView();
      renderDynamicSidebarNavigation();
    } else {
      // Create mode: Check duplicates & register
      const userRes = await API.getUsersWithStats();
      const existingUsers = (userRes && userRes.data) ? userRes.data : (State.getStoredUsers ? State.getStoredUsers() : []);
      const isDup = existingUsers.some(u => 
        (effectiveUsername && u.username && u.username.toLowerCase().trim() === effectiveUsername.toLowerCase().trim()) ||
        (effectiveEmail && u.email && u.email.toLowerCase().trim() === effectiveEmail.toLowerCase().trim())
      );
      if (isDup) {
        alert(`⚠️ Duplicate User Error:\nA user with username "${effectiveUsername}" ${effectiveEmail ? `or email "${effectiveEmail}"` : ''} is already registered.`);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>💾 Save User / Employee</span>';
        }
        return;
      }

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
        alert(`✓ ${role} '${fullname}' registered successfully with customized permissions!`);
        await renderActiveView();
        renderDynamicSidebarNavigation();
      } else {
        alert(`Error: ${data.message}`);
      }
    }
  } catch (err) {
    alert(`Failed to save user permissions: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>💾 Save User / Employee</span>';
    }
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

  const passCheck = validatePasswordStrength(newPass);
  if (!passCheck.valid) {
    alert(`⚠️ Password Requirement:\n${passCheck.message}`);
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

async function deleteUserAction(userId, userName) {
  if (!userId) return;

  const users = State.getStoredUsers ? State.getStoredUsers() : [];
  const u = users.find(user => user.id === userId);
  if (!State.isSuperAdmin() && (u?.is_primary_admin || u?.isPrimaryAdmin || (u?.role === 'ClientAdmin' && u?.is_created_by_super_admin))) {
    alert('⚠️ Security Policy: The Primary Organization Administrator created by Super Admin cannot be deleted.');
    return;
  }

  if (!confirm(`Are you sure you want to permanently delete user "${userName || userId}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await API.deleteUser(userId);
    if (res && res.success) {
      alert(`✓ ${res.message || 'User deleted successfully.'}`);
      await renderActiveView();
    } else {
      alert(res.message || 'Failed to delete user.');
    }
  } catch (err) {
    alert(`Error deleting user: ${err.message}`);
  }
}
window.deleteUserAction = deleteUserAction;

function toggleTenantExpand(expRowId, btnEl) {
  const row = document.getElementById(expRowId);
  if (!row) return;
  if (row.style.display === 'none' || !row.style.display) {
    row.style.display = 'table-row';
    if (btnEl) btnEl.innerHTML = '➖';
  } else {
    row.style.display = 'none';
    if (btnEl) btnEl.innerHTML = '➕';
  }
}
window.toggleTenantExpand = toggleTenantExpand;

async function handleDeleteCompany(companyId, companyName) {
  if (!companyId) return;
  const decodedName = decodeURIComponent(companyName || companyId);
  if (!confirm(`Are you sure you want to permanently delete company profile "${decodedName}"?\n\nThis will remove this business profile from the client organization.`)) {
    return;
  }

  try {
    const res = await API.deleteBusinessProfile(companyId);
    if (res && res.success) {
      alert(`✓ ${res.message || 'Company deleted successfully.'}`);
      State.businessProfiles = await API.getBusinessProfiles();
      populateBusinessSwitcher();
      await renderActiveView();
    } else {
      alert(res.message || 'Failed to delete company.');
    }
  } catch (err) {
    alert(`Error deleting company: ${err.message}`);
  }
}
window.handleDeleteCompany = handleDeleteCompany;

async function handleDeleteTenant(tenantId, tenantName) {
  if (!tenantId) return;
  const decodedName = decodeURIComponent(tenantName || tenantId);

  // Safety confirmation
  const confirmMsg = `⚠️ CRITICAL WARNING: Permanent Deletion of Organization!\n\nAre you sure you want to permanently delete the entire organization "${decodedName}"?\n\nThis will irreversibly delete ALL child data:\n• All users (Client Admins & Employees)\n• All registered companies & NTN/STRN profiles\n• All commercial tenders & RFP records\n• All costing sheets, bids & bid evaluations\n• All attached Bid Securities, CDRs & Bank Guarantees\n• All purchase orders, delivery challans & invoices\n\nClick OK to permanently delete.`;

  if (!confirm(confirmMsg)) {
    return;
  }

  showToast(`⏳ Deleting organization "${decodedName}" and all child records...`, 'info', 3000);

  try {
    const res = await API.deleteTenant(tenantId);
    if (res && res.success) {
      showToast(`✓ Organization "${decodedName}" and all child data deleted permanently.`, 'success', 5000);
      await renderActiveView();
    } else {
      showToast(res.message || 'There is an error please contact to your administrator.', 'error');
    }
  } catch (err) {
    console.error('[handleDeleteTenant Error]:', err);
    showToast('There is an error please contact to your administrator.', 'error');
  }
}
window.handleDeleteTenant = handleDeleteTenant;

async function handleResendInviteEmail(userId, userName, userEmail) {
  if (!userId) return;
  if (!confirm(`Resend activation / welcome email to ${userEmail || userName} via Resend.com?`)) {
    return;
  }

  showToast('⏳ Dispatching activation email via Resend.com...', 'info', 2500);

  try {
    const res = await API.resendInviteEmail(userId, userEmail);
    if (res && res.success) {
      alert(`✓ ${res.message || 'Activation email sent successfully!'}`);
      showToast('✓ Email sent successfully via Resend!', 'success');
    } else {
      alert(`⚠️ ${res.message || 'Failed to dispatch email.'}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
window.handleResendInviteEmail = handleResendInviteEmail;

function openNewTenantModal() {
  const el = document.getElementById('modal-create-tenant');
  if (el) {
    const form = el.querySelector('form');
    if (form) form.reset();
    const inputs = el.querySelectorAll('input, select, textarea');
    inputs.forEach(i => {
      if (i.id === 'tenant-plan') i.value = 'Advance';
      else if (i.id === 'tenant-trial-period') i.value = '15 Days';
      else if (i.id === 'tenant-free-companies') i.value = '2';
      else if (i.id === 'tenant-free-users') i.value = '2';
      else if (i.tagName === 'SELECT') i.selectedIndex = 0;
      else i.value = '';
    });
  }
  openModal('modal-create-tenant');
}
window.openNewTenantModal = openNewTenantModal;

async function submitCreateTenantForm() {
  const nameInput = document.getElementById('tenant-company-name');
  const slugInput = document.getElementById('tenant-subdomain');
  const planInput = document.getElementById('tenant-plan');
  const trialInput = document.getElementById('tenant-trial-period');
  const freeCompaniesInput = document.getElementById('tenant-free-companies');
  const freeUsersInput = document.getElementById('tenant-free-users');
  const adminNameInput = document.getElementById('tenant-admin-name');
  const adminEmailInput = document.getElementById('tenant-admin-email');
  const adminPasswordInput = document.getElementById('tenant-admin-password');

  const name = nameInput?.value?.trim();
  const slug = slugInput?.value?.trim();
  const plan = planInput?.value || 'Advance';
  const trialPeriod = trialInput?.value || '15 Days';
  const freeCompanies = parseInt(freeCompaniesInput?.value || '2', 10);
  const freeUsers = parseInt(freeUsersInput?.value || '2', 10);
  const adminName = adminNameInput?.value?.trim();
  const adminEmail = adminEmailInput?.value?.trim();
  const adminPassword = adminPasswordInput?.value;

  if (!name || !adminEmail || !adminPassword) {
    alert('Company name, admin email, and password are required.');
    return;
  }

  const passCheck = validatePasswordStrength(adminPassword);
  if (!passCheck.valid) {
    alert(`⚠️ Admin Password Requirement:\n${passCheck.message}`);
    return;
  }

  const payload = {
    company_name: name,
    subdomain: slug,
    subscription_plan: plan,
    trial_period: trialPeriod,
    free_business_profile_limit: freeCompanies,
    free_employee_limit: freeUsers,
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

      alert(res.message || `✓ Tenant '${name}' provisioned successfully with Client Admin '${adminEmail}'!`);
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
        <button class="primary-btn" onclick="openNewTenantModal()">🏢 + Provision New Tenant</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tenant Organization</th>
              <th>Plan Tier & Cycle</th>
              <th>Status / Trial Timer</th>
              <th>Quotas (Tenders & CDRs)</th>
              <th>Agreed Fee</th>
              <th>Companies & Seats</th>
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

              const cycleLabel = sub.billing_cycle ? (sub.billing_cycle.charAt(0).toUpperCase() + sub.billing_cycle.slice(1).replace('_', '-')) : 'Monthly';
              const planBadge = (sub.plan_type === 'Advance') 
                ? `<span class="badge badge-won">Advance (${cycleLabel})</span>` 
                : (sub.plan_type === 'Starter' || sub.plan_type === 'Basic')
                  ? '<span class="badge badge-ready">Starter Plan</span>' 
                  : '<span class="badge" style="background:#f3e8ff; color:#7e22ce;">Custom Plan</span>';

              const isUnlimitedTenders = (
                sub.tender_limit === 'unlimited' || 
                sub.tender_limit === -1 || 
                sub.is_unlimited_tenders ||
                sub.plan_type === 'Advance' || 
                sub.plan_type === 'Enterprise'
              );
              const isUnlimitedCdrs = (
                sub.bid_security_limit === 'unlimited' || 
                sub.bid_security_limit === -1 || 
                sub.is_unlimited_cdrs ||
                sub.plan_type === 'Advance' || 
                sub.plan_type === 'Enterprise'
              );

              const tenderQuotaDisplay = isUnlimitedTenders 
                ? `📑 ${o.tenderCount} / ∞ (Unlimited)` 
                : `📑 ${o.tenderCount} / ${sub.tender_limit || 5} Tenders`;

              const bidSecQuotaDisplay = isUnlimitedCdrs 
                ? `🏦 ${o.bidSecurityCount} / ∞ (Unlimited)` 
                : `🏦 ${o.bidSecurityCount} / ${sub.bid_security_limit || 10} CDRs`;

              const renewalDateDisplay = sub.trial_end_date || sub.current_period_end || (o.tenant.trial_ends_at ? o.tenant.trial_ends_at.split('T')[0].split(' ')[0] : 'N/A');

              return `
                <tr>
                  <td>
                    <strong>${o.tenant.company_name}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${o.tenant.subdomain}.mashrue.com</span>
                  </td>
                  <td>${planBadge}</td>
                  <td>${statusBadge}</td>
                  <td>
                    <span style="font-size:0.78rem; font-weight:600; color:#1e293b;">${tenderQuotaDisplay}</span><br>
                    <span style="font-size:0.75rem; color:#64748b;">${bidSecQuotaDisplay}</span>
                  </td>
                  <td>
                    <strong>PKR ${o.totalMonthly.toLocaleString()}</strong><br>
                    <span style="font-size:0.72rem; color:var(--text-muted);">Base: PKR ${(sub.custom_base_price || (sub.plan_type === 'Starter' ? 14000 : 35000)).toLocaleString()}</span>
                  </td>
                  <td>
                    <span style="font-size:0.8rem;">
                      🏢 ${o.companyCount} / ${o.freeCompaniesLimit} Inc. ${o.paidCompanies > 0 ? `(+${o.paidCompanies} paid)` : ''}<br>
                      👥 ${o.userCount} / ${o.freeUsersLimit} Inc. ${o.paidUsers > 0 ? `(+${o.paidUsers} paid)` : ''}
                    </span>
                  </td>
                  <td>
                    <span style="font-size:0.82rem; font-weight:600;">${renewalDateDisplay}</span>
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

  const isStarter = sub.plan_type === 'Starter' || sub.plan_type === 'Basic';
  const isTrial = sub.is_trial || sub.status === 'Trial';

  const isUnlimitedTenders = (
    sub.tender_limit === 'unlimited' || 
    sub.tender_limit === -1 || 
    sub.is_unlimited_tenders ||
    sub.plan_type === 'Advance' || 
    sub.plan_type === 'Enterprise'
  );
  const isUnlimitedCdrs = (
    sub.bid_security_limit === 'unlimited' || 
    sub.bid_security_limit === -1 || 
    sub.is_unlimited_cdrs ||
    sub.plan_type === 'Advance' || 
    sub.plan_type === 'Enterprise'
  );

  let statusBadge = '';
  if (sub.status === 'Suspended') {
    statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-size:0.85rem; padding:6px 12px;">⛔ Account Suspended (Pending Payment)</span>';
  } else if (sub.is_trial && sub.status === 'Trial') {
    const trialName = (sub.trial_period && sub.trial_period !== '15 Days') ? `${sub.trial_period} Free Trial` : '15-Day Free Trial';
    statusBadge = `<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-size:0.85rem; padding:6px 12px;">⏳ ${trialName}: ${data.trialDaysRemaining} Days Remaining</span>`;
  } else {
    statusBadge = '<span class="badge badge-won" style="font-size:0.85rem; padding:6px 12px;">✓ Active Subscription (Paid)</span>';
  }

  const tenderLimitVal = isUnlimitedTenders ? 'Unlimited' : (sub.tender_limit || 5);
  const tenderQuotaMax = tenderLimitVal;
  const tendersUsed = quota.tenders_created || 0;
  const tenderPct = isUnlimitedTenders ? 100 : Math.min(100, (tendersUsed / (parseInt(tenderLimitVal, 10) || 1)) * 100);

  const allSecurities = State.getTenantEntityList ? State.getTenantEntityList('bidSecurities') : [];
  const secUsed = (State.liveCdrsCount !== undefined) 
    ? State.liveCdrsCount 
    : (allSecurities.filter(b => b.tenant_id === (sub.tenant_id || State.currentUser?.tenant_id)).length || (quota.bid_securities_created || 0));
  const secLimitVal = isUnlimitedCdrs ? 'Unlimited' : (sub.bid_security_limit || 10);
  const secQuotaMax = secLimitVal;
  const secPct = isUnlimitedCdrs ? 100 : Math.min(100, (secUsed / (parseInt(secLimitVal, 10) || 1)) * 100);

  const cycleName = sub.billing_cycle ? (sub.billing_cycle.charAt(0).toUpperCase() + sub.billing_cycle.slice(1).replace('_', '-')) : 'Monthly';
  const renewalDate = sub.trial_end_date || sub.current_period_end || (State.currentUser?.tenant?.trialEndsAt ? State.currentUser.tenant.trialEndsAt.split('T')[0] : 'N/A');
  const isAlreadyAdvance = (sub.plan_type === 'Advance' || sub.plan_type === 'Enterprise');

  return `
    <!-- Top Plan Overview Banner -->
    <div class="card" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; margin-bottom: 20px; border: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
        <div>
          <div style="font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Current Subscription Plan</div>
          <h2 style="font-size: 1.8rem; font-weight: 800; color: #38bdf8; margin: 4px 0 8px;">${sub.plan_type} Tier</h2>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            ${statusBadge}
            <span style="font-size: 0.85rem; color: #cbd5e1;">Billing Cycle: <strong>${cycleName}</strong> | Expiry / Renewal: <strong>${renewalDate}</strong></span>
          </div>
        </div>
        <div style="text-align: right; background: rgba(255,255,255,0.06); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 0.8rem; color: #94a3b8;">Contracted Plan Rate:</div>
          <div style="font-size: 1.6rem; font-weight: 800; color: #4ade80;">PKR ${(sub.custom_base_price || (isStarter ? 14000 : 35000)).toLocaleString()} <span style="font-size:0.8rem; color:#94a3b8;">/ period</span></div>
          ${isAlreadyAdvance ? `
            <button class="primary-btn" style="margin-top: 8px; font-size: 0.82rem; padding: 6px 14px;" onclick="openModal('modal-quota-upgrade')">⚡ Extend or Manage Plan</button>
          ` : `
            <button class="primary-btn" style="margin-top: 8px; font-size: 0.82rem; padding: 6px 14px;" onclick="openModal('modal-quota-upgrade')">🚀 Upgrade to Advance Plan</button>
          `}
        </div>
      </div>
    </div>

    <!-- Usage & Quota Meters Grid -->
    <div class="kpi-grid" style="grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px;">
      <!-- Tender Quota Meter -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>📑 Commercial Tenders</span>
          <span style="color: var(--primary); font-weight: 800;">${tendersUsed} / ${tenderQuotaMax}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          ${isUnlimitedTenders ? `Unlimited Bidding Included in ${sub.plan_type} Plan` : `${tenderLimitVal} Bids Included in Contract`}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${tenderPct}%; height: 100%; background: ${(!isUnlimitedTenders && tendersUsed >= parseInt(tenderLimitVal, 10)) ? '#ef4444' : '#0284c7'};"></div>
        </div>
        ${(!isUnlimitedTenders && tendersUsed >= parseInt(tenderLimitVal, 10)) ? `<div style="font-size:0.74rem; color:#ef4444; font-weight:700; margin-top:6px;">⚠️ Quota reached (${tenderLimitVal} Tenders)</div>` : ''}
      </div>

      <!-- Bid Security Quota Meter -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>🏦 Bid Securities & CDRs</span>
          <span style="color: #0891b2; font-weight: 800;">${secUsed} / ${secQuotaMax}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          ${isUnlimitedCdrs ? `Unlimited CDR Registry Included in ${sub.plan_type} Plan` : `${secLimitVal} CDRs Included in Contract`}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${secPct}%; height: 100%; background: ${(!isUnlimitedCdrs && secUsed >= parseInt(secLimitVal, 10)) ? '#ef4444' : '#0891b2'};"></div>
        </div>
        ${(!isUnlimitedCdrs && secUsed >= parseInt(secLimitVal, 10)) ? `<div style="font-size:0.74rem; color:#ef4444; font-weight:700; margin-top:6px;">⚠️ Quota reached (${secLimitVal} Items)</div>` : ''}
      </div>

      <!-- Multi-Company Quota -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>🏢 Company Profiles</span>
          <span style="color: #059669; font-weight: 800;">${data.companyCount} / ${data.freeCompaniesLimit}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          Included free in plan ${data.paidCompanies > 0 ? `(+${data.paidCompanies} extra)` : ''}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(100, (data.companyCount / (data.freeCompaniesLimit || 1)) * 100)}%; height: 100%; background: #059669;"></div>
        </div>
      </div>

      <!-- Employee Seats -->
      <div class="card" style="margin-bottom: 0;">
        <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>👥 User Seats</span>
          <span style="color: #8b5cf6; font-weight: 800;">${data.userCount} / ${data.freeUsersLimit}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">
          Included user seats ${data.paidUsers > 0 ? `(+${data.paidUsers} extra)` : ''}
        </div>
        <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(100, (data.userCount / (data.freeUsersLimit || 1)) * 100)}%; height: 100%; background: #8b5cf6;"></div>
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
                  No subscription payment receipts logged yet. Free 15-day trial or active billing period in progress.
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
function openPublicPricingModal() {
  openModal('modal-public-pricing');
}
window.openPublicPricingModal = openPublicPricingModal;

function switchPublicPricingFreq(freq, btn) {
  const container = document.getElementById('public-pricing-frequency-tabs');
  if (container) {
    container.querySelectorAll('.freq-tab-btn').forEach(b => {
      b.style.background = 'rgba(255,255,255,0.08)';
      b.style.color = '#cbd5e1';
      b.style.borderColor = 'rgba(255,255,255,0.15)';
    });
  }
  if (btn) {
    btn.style.background = '#2563eb';
    btn.style.color = '#ffffff';
    btn.style.borderColor = 'transparent';
  }

  const saveBadge = document.getElementById('public-pricing-advance-save-badge');
  if (saveBadge) {
    if (freq === 'quarterly') {
      saveBadge.innerHTML = '✨ <strong>Save PKR 6,000</strong> on Quarterly billing';
    } else if (freq === 'bi_annually') {
      saveBadge.innerHTML = '✨ <strong>Save PKR 14,500</strong> on Bi-Annual billing';
    } else if (freq === 'annually') {
      saveBadge.innerHTML = '🔥 <strong>Save up to PKR 30,000</strong> on Annual billing';
    } else {
      saveBadge.innerHTML = '💡 Switch to Quarterly or Annual to save up to PKR 30,000';
    }
  }
}
window.switchPublicPricingFreq = switchPublicPricingFreq;

function onTenderLimitSelectChanged(val) {
  const customInput = document.getElementById('sub-custom-tender-limit');
  if (customInput) {
    customInput.style.display = (val === 'custom') ? 'block' : 'none';
  }
}
window.onTenderLimitSelectChanged = onTenderLimitSelectChanged;

function onBidSecLimitSelectChanged(val) {
  const customInput = document.getElementById('sub-custom-bid-sec-limit');
  if (customInput) {
    customInput.style.display = (val === 'custom') ? 'block' : 'none';
  }
}
window.onBidSecLimitSelectChanged = onBidSecLimitSelectChanged;

function openConfigureSubscriptionModal(tenantId) {
  const sub = State.getTenantSubscription(tenantId);
  const tenant = State.getTenants().find(t => t.id === tenantId) || { company_name: 'Tenant' };

  document.getElementById('sub-tenant-id').value = tenantId;
  document.getElementById('sub-tenant-name-display').innerText = tenant.company_name;
  
  // Set Plan Radio
  const normalizedPlan = (sub.plan_type === 'Basic' || sub.plan_type === 'Starter') ? 'Starter' : sub.plan_type;
  const radios = document.getElementsByName('sub-plan-choice');
  radios.forEach(r => { r.checked = (r.value === normalizedPlan); });

  // Set Billing Cycle Radio for Advance Plan
  const cycleRadios = document.getElementsByName('sub-billing-cycle');
  const activeCycle = sub.billing_cycle || 'monthly';
  cycleRadios.forEach(r => { r.checked = (r.value === activeCycle); });

  // Set Dynamic Quota Limits
  const tenderSelect = document.getElementById('sub-tender-limit-select');
  const customTenderInput = document.getElementById('sub-custom-tender-limit');
  const rawTenderLim = String(sub.tender_limit !== undefined ? sub.tender_limit : (normalizedPlan === 'Advance' ? 'unlimited' : '5'));
  if (tenderSelect) {
    const hasOpt = ['unlimited', '5', '10', '20', '50'].includes(rawTenderLim);
    if (hasOpt) {
      tenderSelect.value = rawTenderLim;
      if (customTenderInput) { customTenderInput.style.display = 'none'; customTenderInput.value = ''; }
    } else {
      tenderSelect.value = 'custom';
      if (customTenderInput) { customTenderInput.style.display = 'block'; customTenderInput.value = rawTenderLim; }
    }
  }

  const bidSecSelect = document.getElementById('sub-bid-sec-limit-select');
  const customBidSecInput = document.getElementById('sub-custom-bid-sec-limit');
  const rawBidSecLim = String(sub.bid_security_limit !== undefined ? sub.bid_security_limit : (normalizedPlan === 'Advance' ? 'unlimited' : '10'));
  if (bidSecSelect) {
    const hasOpt = ['unlimited', '3', '10', '25', '50'].includes(rawBidSecLim);
    if (hasOpt) {
      bidSecSelect.value = rawBidSecLim;
      if (customBidSecInput) { customBidSecInput.style.display = 'none'; customBidSecInput.value = ''; }
    } else {
      bidSecSelect.value = 'custom';
      if (customBidSecInput) { customBidSecInput.style.display = 'block'; customBidSecInput.value = rawBidSecLim; }
    }
  }

  // Set Included Companies & Seats (Custom per client)
  const incCoInput = document.getElementById('sub-included-companies');
  if (incCoInput) {
    incCoInput.value = sub.free_companies_limit !== undefined 
      ? sub.free_companies_limit 
      : (tenant.free_business_profile_limit || (normalizedPlan === 'Advance' ? 3 : 1));
  }

  const incUsersInput = document.getElementById('sub-included-users');
  if (incUsersInput) {
    incUsersInput.value = sub.free_users_limit !== undefined 
      ? sub.free_users_limit 
      : (tenant.free_employee_limit || (normalizedPlan === 'Advance' ? 3 : 1));
  }

  // Set Custom Prices
  document.getElementById('sub-custom-base-price').value = sub.custom_base_price !== undefined ? sub.custom_base_price : (normalizedPlan === 'Starter' ? 14000 : 35000);
  document.getElementById('sub-custom-extra-company').value = sub.custom_extra_company_price !== undefined ? sub.custom_extra_company_price : 4500;
  document.getElementById('sub-custom-extra-seat').value = sub.custom_extra_seat_price !== undefined ? sub.custom_extra_seat_price : 1500;

  // Set Trial Duration & Expiry Date
  const trialSelect = document.getElementById('sub-trial-duration');
  if (trialSelect) {
    let dVal = String(sub.trial_days || 15);
    if (sub.trial_period === '3 Months') dVal = '90';
    else if (sub.trial_period === '2 Months') dVal = '60';
    else if (sub.trial_period === '1 Month') dVal = '30';
    else if (sub.trial_period === '15 Days') dVal = '15';
    const hasOpt = Array.from(trialSelect.options).some(o => o.value === dVal);
    trialSelect.value = sub.is_trial ? (hasOpt ? dVal : 'custom') : 'none';
  }
  document.getElementById('sub-trial-end-date').value = sub.trial_end_date || new Date().toISOString().split('T')[0];

  const noteInput = document.getElementById('sub-personal-reference-note');
  if (noteInput) noteInput.value = sub.personal_reference_note || '';

  // Render Modular Checkboxes
  renderSubModulesChecklist(sub);
  onPlanSelectionChanged(normalizedPlan, false);
  recalcSubscriptionBillPreview();

  openModal('modal-configure-subscription');
}

function renderSubModulesChecklist(sub) {
  const container = document.getElementById('sub-modules-checklist');
  if (!container) return;

  const activeKeys = sub.active_modules || ['mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi'];

  container.innerHTML = State.MODULE_CATALOG.map(m => {
    const isChecked = activeKeys.includes(m.key);
    const customFee = (sub.custom_module_fees && sub.custom_module_fees[m.key] !== undefined) ? sub.custom_module_fees[m.key] : m.benchmarkFee;
    return `
      <div style="border: 1px solid var(--border); background: #ffffff; padding: 10px 12px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between;">
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

function onPlanSelectionChanged(planType, resetLimits = true) {
  const modulesContainer = document.getElementById('sub-modules-selector-container');
  const cycleContainer = document.getElementById('sub-billing-cycle-container');
  const basePriceInput = document.getElementById('sub-custom-base-price');
  const incCoInput = document.getElementById('sub-included-companies');
  const incUsersInput = document.getElementById('sub-included-users');
  const tenderSelect = document.getElementById('sub-tender-limit-select');
  const bidSecSelect = document.getElementById('sub-bid-sec-limit-select');

  if (resetLimits) {
    if (planType === 'Advance') {
      if (incCoInput) incCoInput.value = 3;
      if (incUsersInput) incUsersInput.value = 3;
      if (tenderSelect) { tenderSelect.value = 'unlimited'; onTenderLimitSelectChanged('unlimited'); }
      if (bidSecSelect) { bidSecSelect.value = 'unlimited'; onBidSecLimitSelectChanged('unlimited'); }
    } else if (planType === 'Starter' || planType === 'Basic') {
      if (incCoInput) incCoInput.value = 1;
      if (incUsersInput) incUsersInput.value = 1;
      if (tenderSelect) { tenderSelect.value = '5'; onTenderLimitSelectChanged('5'); }
      if (bidSecSelect) { bidSecSelect.value = '10'; onBidSecLimitSelectChanged('10'); }
    }
  }

  if (planType === 'Custom') {
    if (cycleContainer) cycleContainer.style.display = 'none';
    if (basePriceInput && (!basePriceInput.value || basePriceInput.value === '35000' || basePriceInput.value === '14000')) {
      basePriceInput.value = 3000;
    }
  } else if (planType === 'Starter' || planType === 'Basic') {
    if (cycleContainer) cycleContainer.style.display = 'none';
    if (basePriceInput) basePriceInput.value = 14000;
  } else {
    if (cycleContainer) cycleContainer.style.display = 'block';
    
    // Check cycle radio
    let selectedCycle = 'monthly';
    const cycleRadios = document.getElementsByName('sub-billing-cycle');
    cycleRadios.forEach(r => { if (r.checked) selectedCycle = r.value; });
    onBillingCycleChanged(selectedCycle);
  }
  recalcSubscriptionBillPreview();
}

function onBillingCycleChanged(cycleKey) {
  const basePriceInput = document.getElementById('sub-custom-base-price');
  if (!basePriceInput) return;

  if (cycleKey === 'quarterly') {
    basePriceInput.value = 99000;
  } else if (cycleKey === 'bi_annually') {
    basePriceInput.value = 195500;
  } else if (cycleKey === 'annually') {
    basePriceInput.value = 390000;
  } else {
    basePriceInput.value = 35000;
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
  const incCo = Number(document.getElementById('sub-included-companies')?.value || (selectedPlan === 'Advance' ? 3 : 1));
  const incUsers = Number(document.getElementById('sub-included-users')?.value || (selectedPlan === 'Advance' ? 3 : 1));
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

  if (breakdownEl) breakdownEl.innerText = `${selectedPlan} Tier Base: PKR ${basePrice.toLocaleString()} (${incCo} Companies & ${incUsers} Seats Included)`;
  if (totalEl) totalEl.innerText = `PKR ${total.toLocaleString()}`;
}

async function submitConfigureSubscriptionForm() {
  const tenantId = document.getElementById('sub-tenant-id')?.value;
  const radios = document.getElementsByName('sub-plan-choice');
  let selectedPlan = 'Advance';
  radios.forEach(r => { if (r.checked) selectedPlan = r.value; });

  let selectedCycle = 'monthly';
  const cycleRadios = document.getElementsByName('sub-billing-cycle');
  cycleRadios.forEach(r => { if (r.checked) selectedCycle = r.value; });

  // Read dynamic leverages
  const tenderSel = document.getElementById('sub-tender-limit-select')?.value || 'unlimited';
  const customTenderVal = document.getElementById('sub-custom-tender-limit')?.value;
  const tenderLimit = (tenderSel === 'custom') ? (parseInt(customTenderVal, 10) || 5) : (tenderSel === 'unlimited' ? 'unlimited' : parseInt(tenderSel, 10));

  const bidSecSel = document.getElementById('sub-bid-sec-limit-select')?.value || 'unlimited';
  const customBidSecVal = document.getElementById('sub-custom-bid-sec-limit')?.value;
  const bidSecLimit = (bidSecSel === 'custom') ? (parseInt(customBidSecVal, 10) || 10) : (bidSecSel === 'unlimited' ? 'unlimited' : parseInt(bidSecSel, 10));

  const incCo = parseInt(document.getElementById('sub-included-companies')?.value, 10) || (selectedPlan === 'Advance' ? 3 : 1);
  const incUsers = parseInt(document.getElementById('sub-included-users')?.value, 10) || (selectedPlan === 'Advance' ? 3 : 1);

  const basePrice = Number(document.getElementById('sub-custom-base-price')?.value || (selectedPlan === 'Starter' ? 14000 : 35000));
  const extraCoPrice = Number(document.getElementById('sub-custom-extra-company')?.value || 4500);
  const extraSeatPrice = Number(document.getElementById('sub-custom-extra-seat')?.value || 1500);

  const trialDuration = document.getElementById('sub-trial-duration')?.value;
  const isTrial = (trialDuration !== 'none');
  const trialEndDate = document.getElementById('sub-trial-end-date')?.value || new Date().toISOString().split('T')[0];
  const refNote = document.getElementById('sub-personal-reference-note')?.value || '';

  const activeModules = [];
  const customModuleFees = {};

  const checkboxes = document.querySelectorAll('.sub-mod-checkbox:checked');
  if (checkboxes.length > 0) {
    checkboxes.forEach(cb => {
      activeModules.push(cb.value);
      const feeInput = document.querySelector(`.sub-mod-fee-input[data-mod="${cb.value}"]`);
      customModuleFees[cb.value] = Number(feeInput?.value || 0);
    });
  } else if (selectedPlan === 'Starter' || selectedPlan === 'Basic') {
    activeModules.push('mod_tenders', 'mod_quotations', 'mod_fbr_invoicing');
  } else {
    activeModules.push('mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi');
  }

  let trialPeriodName = '15 Days';
  if (trialDuration === '30') trialPeriodName = '1 Month';
  else if (trialDuration === '60') trialPeriodName = '2 Months';
  else if (trialDuration === '90') trialPeriodName = '3 Months';
  else if (trialDuration === 'custom') trialPeriodName = 'Custom';
  else if (trialDuration === 'none') trialPeriodName = 'None';

  const payload = {
    tenant_id: tenantId,
    plan_type: selectedPlan,
    subscription_plan: selectedPlan,
    billing_cycle: selectedCycle,
    status: isTrial ? 'Trial' : 'Active',
    is_trial: isTrial,
    trial_days: isTrial ? (trialDuration === 'custom' ? 30 : parseInt(trialDuration, 10)) : 0,
    trial_period: trialPeriodName,
    trial_end_date: trialEndDate,
    trial_ends_at: trialEndDate,
    current_period_end: trialEndDate,
    tender_limit: tenderLimit,
    bid_security_limit: bidSecLimit,
    trial_tender_limit: tenderLimit,
    trial_bid_security_limit: bidSecLimit,
    starter_tender_limit: (tenderLimit === 'unlimited' ? 'unlimited' : tenderLimit),
    personal_reference_note: refNote,
    is_personal_reference_trial: (isTrial && ['30', '60', '90', 'custom'].includes(trialDuration)),
    free_companies_limit: incCo,
    free_business_profile_limit: incCo,
    free_users_limit: incUsers,
    free_employee_limit: incUsers,
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
      showToast(res.message || 'Subscription saved successfully.', 'success');
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

  const base = sub.custom_base_price !== undefined ? sub.custom_base_price : (sub.plan_type === 'Starter' || sub.plan_type === 'Basic' ? 14000 : 35000);
  document.getElementById('pay-amount-received').value = base;
  document.getElementById('pay-monthly-fee-display').innerText = `Agreed Subscription Fee: PKR ${base.toLocaleString()}`;
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
  alert('🎉 Upgrade request submitted to Mashrue Support! You will be contacted shortly for plan adjustment.');
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
  await API.evaluateBid(oppId, evalPayload);

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
    await API.releaseBidSecurity(sec.id, 'Auto-Release on Tender Loss (' + (grievanceTrack || stage) + ')');
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

    <!-- Quick Tender Outcome / Status Action Bar -->
    <div style="background:#ffffff; border:1px solid var(--border); border-radius:var(--radius-md); padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:0.85rem; font-weight:700; color:#334155;">Tender Outcome & Lifecycle Status:</span>
        <span class="badge badge-${(opp.status || 'new').toLowerCase().replace(/\s+/g, '')}" style="font-size:0.85rem; padding:4px 10px;">${opp.status || 'New'}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <select class="form-select" style="font-size:0.82rem; padding:4px 8px; width:auto; border-radius:4px;" onchange="handleUpdateTenderStatus('${opp.id}', this.value, '${encodeURIComponent(opp.tender_name || opp.title)}', ${parseFloat(opp.estimated_value || 0)})">
          <option value="" disabled selected>Change Status...</option>
          <option value="New" ${opp.status === 'New' ? 'selected' : ''}>New</option>
          <option value="Under Evaluation" ${opp.status === 'Under Evaluation' ? 'selected' : ''}>Under Evaluation</option>
          <option value="Ready to submit" ${opp.status === 'Ready to submit' ? 'selected' : ''}>Ready to submit</option>
          <option value="Submitted" ${opp.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
          <option value="Won" ${opp.status === 'Won' || opp.status === 'won' ? 'selected' : ''}>🏆 Won</option>
          <option value="Lost" ${opp.status === 'Lost' || opp.status === 'loose' ? 'selected' : ''}>❌ Lost</option>
          <option value="Technical Disqualified" ${opp.status === 'Technical Disqualified' ? 'selected' : ''}>Disqualified</option>
          <option value="Withdrawn" ${opp.status === 'Withdrawn' ? 'selected' : ''}>Withdrawn</option>
        </select>
        <button type="button" class="secondary-btn" style="padding:4px 10px; font-size:0.8rem; background:#ffffff; color:#0f172a; border:1px solid #cbd5e1; font-weight:600;" onclick="closeModal('modal-tender-360-cockpit'); openEditTenderModal('${opp.id}')" title="Edit Tender Scope & Line Items">✏️ Edit Tender</button>
        <button type="button" class="primary-btn" style="padding:4px 10px; font-size:0.8rem; background:#059669;" onclick="handleUpdateTenderStatus('${opp.id}', 'Won', '${encodeURIComponent(opp.tender_name || opp.title)}')">🏆 Mark Won</button>
        <button type="button" class="danger-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="handleUpdateTenderStatus('${opp.id}', 'Lost', '${encodeURIComponent(opp.tender_name || opp.title)}', ${parseFloat(opp.estimated_value || 0)})">❌ Mark Lost</button>
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

// ============================================================================
// DYNAMIC WORKFLOW GATING, DEDUCTIONS, INVENTORY & PORTFOLIO EXTENSIONS
// ============================================================================

// 1. Live Payment Deduction Calculation
function calculatePaymentNetBreakdown(fromWhtAmount = false) {
  const gross = parseFloat(document.getElementById('pay-gross-amount')?.value || 0);
  const whtPctEl = document.getElementById('pay-wht-pct');
  const whtAmtEl = document.getElementById('pay-wht-amount');
  const stWht = parseFloat(document.getElementById('pay-st-wht')?.value || 0);
  const ld = parseFloat(document.getElementById('pay-ld-penalties')?.value || 0);
  const netEl = document.getElementById('pay-amount');

  if (!netEl) return;

  let itWht = 0;
  if (fromWhtAmount) {
    itWht = parseFloat(whtAmtEl?.value || 0);
    if (gross > 0 && whtPctEl) {
      whtPctEl.value = ((itWht / gross) * 100).toFixed(2);
    }
  } else {
    const pct = parseFloat(whtPctEl?.value || 0);
    itWht = (gross * pct) / 100;
    if (whtAmtEl) whtAmtEl.value = Math.round(itWht);
  }

  const net = Math.max(0, gross - itWht - stWht - ld);
  netEl.value = Math.round(net);
}

// 2. GRN Inspection Logic
function calculateGrnAcceptedQty() {
  const total = parseFloat(document.getElementById('grn-total-qty')?.value || 0);
  const rejected = parseFloat(document.getElementById('grn-rejected-qty')?.value || 0);
  const acceptedEl = document.getElementById('grn-accepted-qty');
  if (acceptedEl) {
    acceptedEl.value = Math.max(0, total - rejected);
  }
}

function toggleGrnDtlFields(checked) {
  const fields = document.getElementById('grn-dtl-fields');
  if (fields) fields.style.display = checked ? 'grid' : 'none';
}

function openGrnModal(dcId, poId) {
  const form = document.getElementById('form-grn-inspection');
  if (form) form.reset();
  
  const dcIdEl = document.getElementById('grn-dc-id');
  const poIdEl = document.getElementById('grn-po-id');
  const dateEl = document.getElementById('grn-date');
  const numEl = document.getElementById('grn-number');

  if (dcIdEl) dcIdEl.value = dcId || '';
  if (poIdEl) poIdEl.value = poId || '';
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (numEl) numEl.value = `GRN-${Date.now().toString().slice(-6)}`;

  toggleGrnDtlFields(false);
  openModal('modal-grn-inspection');
}

async function submitGrnInspectionForm() {
  const dcId = document.getElementById('grn-dc-id')?.value;
  const poId = document.getElementById('grn-po-id')?.value;
  const grnNo = document.getElementById('grn-number')?.value;
  const inspDate = document.getElementById('grn-date')?.value;
  const totalQty = parseFloat(document.getElementById('grn-total-qty')?.value || 0);
  const acceptedQty = parseFloat(document.getElementById('grn-accepted-qty')?.value || 0);
  const rejectedQty = parseFloat(document.getElementById('grn-rejected-qty')?.value || 0);
  const dtlReq = document.getElementById('grn-dtl-required')?.checked || false;
  const dtlSample = document.getElementById('grn-dtl-sample')?.value || '';
  const dtlReport = document.getElementById('grn-dtl-report')?.value || '';
  const dtlStatus = document.getElementById('grn-dtl-status')?.value || 'Pending';
  const remarks = document.getElementById('grn-remarks')?.value || '';

  const res = await API.createGrn({
    delivery_challan_id: dcId || null,
    purchase_order_id: poId || null,
    grn_number: grnNo,
    inspection_date: inspDate,
    total_received_qty: totalQty,
    accepted_qty: acceptedQty,
    rejected_qty: rejectedQty,
    dtl_required: dtlReq,
    dtl_sample_code: dtlSample,
    dtl_report_number: dtlReport,
    dtl_status: dtlStatus,
    remarks
  });

  if (res.success) {
    showToast(res.message || 'GRN & Inspection recorded successfully.', 'success');
    closeModal('modal-grn-inspection');
    if (typeof refreshCurrentView === 'function') refreshCurrentView();
  } else {
    showToast(res.message || 'Failed to save GRN', 'error');
  }
}

// 3. Official CDR Recovery Request Letter Generator
async function openCdrRecoveryLetterModal(securityId) {
  const res = await API.getCdrRecoveryLetter(securityId);
  if (!res.success) {
    showToast(res.message || 'Unable to generate CDR letter', 'error');
    return;
  }

  const d = res.data;
  const container = document.getElementById('cdr-letter-printable-area');
  if (!container) return;

  container.innerHTML = `
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h2 style="font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0;">${d.sender.companyName}</h2>
        <div style="font-size: 0.85rem; color: #475569;">${d.sender.address}</div>
        ${d.sender.ntn ? `<div style="font-size: 0.82rem; color: #64748b;"><strong>NTN:</strong> ${d.sender.ntn}</div>` : ''}
      </div>
      <div style="text-align: right; font-size: 0.85rem;">
        <div><strong>Ref:</strong> ${d.letterReference}</div>
        <div><strong>Date:</strong> ${d.date}</div>
      </div>
    </div>

    <div style="margin-bottom: 20px; font-size: 0.9rem;">
      <div><strong>To:</strong></div>
      <div>${d.recipient.title}</div>
      <div>${d.recipient.department}</div>
      <div>${d.recipient.organization}</div>
    </div>

    <div style="margin-bottom: 18px; font-weight: 700; text-decoration: underline; font-size: 0.95rem;">
      ${d.subject}
    </div>

    <div style="font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 20px;">
      <p>Dear Sir / Madam,</p>
      <p>With reference to the subject tender captioned above, we had submitted our bid along with the mandatory Call Deposit Receipt (CDR) / Earnest Money instrument as per procurement guidelines.</p>
      
      <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin: 14px 0;">
        <table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; width: 35%; color: #64748b;"><strong>Tender Reference:</strong></td><td><strong>${d.tenderDetails.tenderNumber}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;"><strong>Tender Description:</strong></td><td>${d.tenderDetails.tenderName}</td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;"><strong>Instrument Type & No:</strong></td><td><strong>${d.tenderDetails.instrumentType} - ${d.tenderDetails.instrumentNumber}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;"><strong>Issuing Bank:</strong></td><td>${d.tenderDetails.bankName}</td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;"><strong>Instrument Amount:</strong></td><td><strong style="color: #059669;">PKR ${parseFloat(d.tenderDetails.amountPKR).toLocaleString()}</strong></td></tr>
          <tr><td style="padding: 4px 0; color: #64748b;"><strong>Instrument Validity:</strong></td><td>${formatDateDDMMYYYY(d.tenderDetails.expiryDate)}</td></tr>
        </table>
      </div>

      <p>Since the financial / technical evaluation stage of the aforementioned tender has concluded, we respectfully request your office to kindly release and return our original Call Deposit Receipt (CDR) at your earliest convenience to facilitate our bank reconciliation.</p>
      <p>Thanking you in anticipation for your prompt cooperation.</p>
    </div>

    <div style="margin-top: 40px; display: flex; justify-content: space-between;">
      <div style="font-size: 0.85rem;">
        <div>Yours faithfully,</div>
        <div style="margin-top: 35px; font-weight: 700;">For ${d.sender.companyName}</div>
        <div style="color: #64748b;">Authorized Signatory & Official Stamp</div>
      </div>
    </div>
  `;

  openModal('modal-cdr-recovery-letter');
}

function printCdrRecoveryLetter() {
  const content = document.getElementById('cdr-letter-printable-area');
  if (!content) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>CDR Return Request Letter</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; }
        </style>
      </head>
      <body>${content.innerHTML}</body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// 4. Stock Reservation Engine
async function openStockReservationModal(poId = '', oppId = '') {
  const form = document.getElementById('form-stock-reservation');
  if (form) form.reset();

  const whSelect = document.getElementById('res-warehouse-select');
  const prodSelect = document.getElementById('res-product-select');

  if (whSelect && Array.isArray(State.warehouses)) {
    whSelect.innerHTML = State.warehouses.map(w => `<option value="${w.id}">${w.warehouse_name} (${w.city || 'Lahore'})</option>`).join('');
  }

  if (prodSelect && Array.isArray(State.products)) {
    prodSelect.innerHTML = State.products.map(p => `<option value="${p.id}">${p.name} [SKU: ${p.sku || 'N/A'}] - Stock: ${p.current_stock || 0} ${p.unit || 'PCS'}</option>`).join('');
  }

  updateReservationProductStock();
  openModal('modal-stock-reservation');
}

function updateReservationProductStock() {
  const prodSelect = document.getElementById('res-product-select');
  const disp = document.getElementById('res-avail-stock-disp');
  if (!prodSelect || !disp) return;

  const prodId = prodSelect.value;
  const prod = (State.products || []).find(p => String(p.id) === String(prodId));
  disp.textContent = prod ? `${prod.current_stock || 0} ${prod.unit || 'PCS'}` : '0 PCS';
}

async function submitStockReservationForm() {
  const whId = document.getElementById('res-warehouse-select')?.value;
  const prodId = document.getElementById('res-product-select')?.value;
  const batch = document.getElementById('res-batch-no')?.value || 'STANDARD';
  const qty = parseFloat(document.getElementById('res-qty')?.value || 0);

  const res = await API.createStockReservation({
    warehouse_id: whId,
    product_id: prodId,
    batch_number: batch,
    reserved_quantity: qty
  });

  if (res.success) {
    showToast(res.message || 'Stock reserved successfully.', 'success');
    closeModal('modal-stock-reservation');
  } else {
    showToast(res.message || 'Failed to reserve stock', 'error');
  }
}

// 5. Past Performance Credential Dossier
async function openPortfolioDossierModal() {
  const list = await API.getPastPerformancePortfolio();
  const container = document.getElementById('portfolio-printable-area');
  if (!container) return;

  container.innerHTML = `
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;">🏆 Past Performance & Executed Contracts Dossier</h2>
        <div style="font-size: 0.82rem; color: #64748b;">Official Pre-Qualification & Experience Credential Register</div>
      </div>
      <div style="font-size: 0.82rem; color: #475569;">
        Total Executed Contracts: <strong>${list.length}</strong>
      </div>
    </div>

    <table class="data-table" style="font-size: 0.82rem; width: 100%;">
      <thead>
        <tr style="background: #f1f5f9;">
          <th>Contract / Project #</th>
          <th>Executing Entity</th>
          <th>Client & Department</th>
          <th>Project Title</th>
          <th>Contract Value</th>
          <th>Invoiced</th>
          <th>Collected</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${list.length === 0 ? `
          <tr><td colspan="8" style="text-align: center; padding: 18px; color: #64748b;">No executed contracts recorded yet.</td></tr>
        ` : list.map(c => `
          <tr>
            <td><strong>${c.contract_number}</strong></td>
            <td><span class="badge badge-sec-attached">${c.executing_company || 'Active Profile'}</span></td>
            <td><strong>${c.client_name}</strong><br><span style="font-size: 0.72rem; color: #64748b;">${c.department_name || c.client_type || ''}</span></td>
            <td>${c.project_title || c.opportunity_number || 'Contract Delivery'}</td>
            <td><strong style="color: #0f172a;">PKR ${parseFloat(c.contract_value || 0).toLocaleString()}</strong></td>
            <td><strong style="color: #0284c7;">PKR ${parseFloat(c.total_invoiced || 0).toLocaleString()}</strong></td>
            <td><strong style="color: #059669;">PKR ${parseFloat(c.total_collected || 0).toLocaleString()}</strong></td>
            <td><span class="badge badge-won">${c.contract_status || 'Completed'}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  openModal('modal-portfolio-dossier');
}

function printPortfolioDossier() {
  const content = document.getElementById('portfolio-printable-area');
  if (!content) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>Past Performance Portfolio Dossier</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
          th { background: #f1f5f9; }
        </style>
      </head>
      <body>${content.innerHTML}</body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// 6. Public Portal Revealing Soon Overlay Handler
function openRevealingSoonModal(featureName = 'Upcoming Module') {
  const tagEl = document.getElementById('revealing-feature-tag');
  const titleEl = document.getElementById('revealing-title');
  const descEl = document.getElementById('revealing-desc');

  if (tagEl) tagEl.textContent = `✨ Mashrue: ${featureName}`;
  if (titleEl) titleEl.textContent = 'Revealing soon';
  if (descEl) {
    if (featureName.includes('Pricing')) {
      descEl.textContent = 'Our dynamic, transparent subscription packages and custom modular plans for enterprise bidding are being unveiled shortly.';
    } else if (featureName.includes('Contact')) {
      descEl.textContent = 'Our 24/7 dedicated enterprise onboarding desk and hotline will be accessible directly through the portal in our upcoming release.';
    } else {
      descEl.textContent = 'We are crafting an exceptional, AI-augmented procurement experience. This section will be unlocked in our upcoming platform release.';
    }
  }

  openModal('modal-revealing-soon');
}
window.openRevealingSoonModal = openRevealingSoonModal;

// ============================================================================
// 7. TENDER ACTIVITY DIARY & CHRONOLOGICAL TIMELINE ENGINE
// ============================================================================
async function openTenderDiaryModal(opportunityId) {
  const opps = await API.getOpportunities(State.currentBusinessProfileId);
  const opp = (opps || []).find(o => String(o.id) === String(opportunityId)) || { id: opportunityId, tender_name: 'Tender' };

  const titleEl = document.getElementById('tender-diary-title');
  const subtitleEl = document.getElementById('tender-diary-subtitle');
  const containerEl = document.getElementById('tender-diary-timeline-container');
  const oppIdInput = document.getElementById('diary-opp-id');

  if (oppIdInput) oppIdInput.value = opportunityId;
  if (titleEl) titleEl.innerText = `📜 Tender Activity Diary: ${opp.tender_name || opp.title || 'Tender'}`;
  if (subtitleEl) subtitleEl.innerText = `Tender Ref: ${opp.opportunity_number || 'N/A'} | Client: ${opp.customer_name || 'Government Client'} | Status: ${opp.status || 'Active'}`;

  renderTenderDiaryTimeline(opportunityId, opp);
  openModal('modal-tender-diary');
}
window.openTenderDiaryModal = openTenderDiaryModal;

function renderTenderDiaryTimeline(oppId, oppData) {
  const containerEl = document.getElementById('tender-diary-timeline-container');
  if (!containerEl) return;

  // 1. Gather system events from opportunity state
  const events = [];

  if (oppData) {
    events.push({
      date: oppData.created_at || oppData.submission_date || '2026-08-01',
      title: '📑 Tender Registered in Mashrue',
      category: 'Registration',
      icon: '📑',
      color: '#0284c7',
      details: `Opportunity created with source "${oppData.tender_source || 'PPRA'}" and initial estimated value ${formatCurrency(oppData.estimated_value || 0, 'PKR')}.`,
      user: oppData.created_by_name || 'Bid Manager'
    });

    if (oppData.closing_date) {
      events.push({
        date: oppData.closing_date,
        title: '⏰ Bid Submission Deadline Gate',
        category: 'Deadline',
        icon: '⏰',
        color: '#d97706',
        details: `Official submission cutoff set to ${oppData.closing_date}. Compliance checklist verified.`,
        user: 'System Workflow Gate'
      });
    }

    if (oppData.status === 'Won' || oppData.status === 'won') {
      events.push({
        date: oppData.updated_at || '2026-08-20',
        title: '🏆 Contract Awarded (Won Tender)',
        category: 'Award',
        icon: '🏆',
        color: '#059669',
        details: `Technical & financial bid won! LOA issuance enabled for child Purchase Orders and PBG.`,
        user: 'Executive Committee'
      });
    }
  }

  // 2. Load custom diary notes from localStorage
  const storageKey = `mashrue_tender_diary_${oppId}`;
  let customNotes = [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) customNotes = JSON.parse(raw);
  } catch (e) {
    customNotes = [];
  }

  customNotes.forEach(n => {
    events.push({
      date: n.date || new Date().toISOString().slice(0, 10),
      time: n.time || '',
      title: n.category || 'Diary Memo',
      category: n.category || 'Memo',
      icon: getCategoryIcon(n.category),
      color: getCategoryColor(n.category),
      details: n.note,
      user: n.author || State.currentUser?.full_name || 'User',
      isCustom: true,
      id: n.id
    });
  });

  // Sort events chronologically (latest on top)
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (events.length === 0) {
    containerEl.innerHTML = `
      <div style="text-align:center; padding:30px; color:#64748b;">
        📜 No diary events logged yet. Use the box above to log your first pre-bid meeting or query note.
      </div>
    `;
    return;
  }

  containerEl.innerHTML = `
    <div style="position: relative; padding-left: 28px; border-left: 3px solid #e2e8f0; margin-left: 14px;">
      ${events.map(ev => `
        <div style="position: relative; margin-bottom: 22px;">
          <!-- Node dot icon -->
          <div style="position: absolute; left: -42px; top: 0; width: 28px; height: 28px; border-radius: 50%; background: ${ev.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
            ${ev.icon}
          </div>

          <!-- Card Content -->
          <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: #0f172a; font-size: 0.92rem;">${ev.title}</strong>
                <span class="badge" style="background: ${ev.color}15; color: ${ev.color}; font-size: 0.72rem; font-weight: 700;">${ev.category}</span>
              </div>
              <span style="font-size: 0.76rem; color: #64748b; font-weight: 600;">
                📅 ${ev.date} ${ev.time ? `• ${ev.time}` : ''}
              </span>
            </div>
            <p style="font-size: 0.84rem; color: #334155; margin: 4px 0 6px 0; line-height: 1.45;">
              ${ev.details}
            </p>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #94a3b8;">
              <span>👤 Logged by: <strong>${ev.user}</strong></span>
              ${ev.isCustom ? `
                <button type="button" style="background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.74rem;" onclick="deleteTenderDiaryEntry('${oppId}', '${ev.id}')">🗑️ Remove Memo</button>
              ` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function getCategoryIcon(cat) {
  switch (cat) {
    case 'Client Meeting': return '🤝';
    case 'Pre-Bid Query': return '❓';
    case 'Sample Submission': return '🧪';
    case 'Site Visit': return '📍';
    case 'Competitor Intel': return '🕵️';
    case 'Internal Review': return '🏢';
    default: return '📝';
  }
}

function getCategoryColor(cat) {
  switch (cat) {
    case 'Client Meeting': return '#0284c7';
    case 'Pre-Bid Query': return '#8b5cf6';
    case 'Sample Submission': return '#10b981';
    case 'Site Visit': return '#f59e0b';
    case 'Competitor Intel': return '#dc2626';
    case 'Internal Review': return '#64748b';
    default: return '#0284c7';
  }
}

function submitTenderDiaryEntry() {
  const oppId = document.getElementById('diary-opp-id')?.value;
  const noteInput = document.getElementById('diary-note-input');
  const catSelect = document.getElementById('diary-category-select');

  if (!oppId || !noteInput || !noteInput.value.trim()) {
    showToast('Please enter note text before logging memo', 'warning');
    return;
  }

  const storageKey = `mashrue_tender_diary_${oppId}`;
  let notes = [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) notes = JSON.parse(raw);
  } catch (e) {
    notes = [];
  }

  const now = new Date();
  const newEntry = {
    id: 'memo-' + Date.now(),
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    category: catSelect ? catSelect.value : 'Client Meeting',
    note: noteInput.value.trim(),
    author: State.currentUser?.full_name || State.currentUser?.username || 'Employee'
  };

  notes.unshift(newEntry);
  localStorage.setItem(storageKey, JSON.stringify(notes));

  noteInput.value = '';
  showToast('✓ Tender diary memo logged successfully!', 'success');

  // Re-render timeline
  openTenderDiaryModal(oppId);
}
window.submitTenderDiaryEntry = submitTenderDiaryEntry;

function deleteTenderDiaryEntry(oppId, memoId) {
  const storageKey = `mashrue_tender_diary_${oppId}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      let notes = JSON.parse(raw);
      notes = notes.filter(n => n.id !== memoId);
      localStorage.setItem(storageKey, JSON.stringify(notes));
      showToast('Diary memo removed', 'info');
      openTenderDiaryModal(oppId);
    }
  } catch (e) {}
}
window.deleteTenderDiaryEntry = deleteTenderDiaryEntry;

// ============================================================================
// 8. AUTOMATED 3-WAY MATCH VERIFICATION ENGINE (PO ➔ DC/GRN ➔ INVOICE)
// ============================================================================
async function open3WayMatchModal(poId = '', invoiceId = '') {
  const pos = await API.getPurchaseOrders(State.currentBusinessProfileId);
  const dcs = await API.getDeliveryChallans(State.currentBusinessProfileId);
  const invoices = await API.getInvoices(State.currentBusinessProfileId);

  // Find target PO & matched records
  let targetPO = (pos || []).find(p => String(p.id) === String(poId));
  let targetInv = (invoices || []).find(i => String(i.id) === String(invoiceId));

  if (!targetPO && targetInv) {
    targetPO = (pos || []).find(p => String(p.id) === String(targetInv.purchase_order_id) || p.po_number === targetInv.po_number);
  }
  if (!targetPO && pos.length > 0) {
    targetPO = pos[0];
  }

  if (!targetPO) {
    showToast('No active Purchase Order found to execute 3-way match reconciliation', 'warning');
    return;
  }

  const childDCs = (dcs || []).filter(d => String(d.purchase_order_id) === String(targetPO.id) || d.po_number === targetPO.po_number);
  const childInvs = (invoices || []).filter(i => String(i.purchase_order_id) === String(targetPO.id) || i.po_number === targetPO.po_number);

  const bodyEl = document.getElementById('threeway-match-body');
  const badgeEl = document.getElementById('threeway-match-summary-badge');
  if (!bodyEl) return;

  const poVal = parseFloat(targetPO.net_amount || targetPO.total_amount || 0);
  const totalBilled = childInvs.reduce((sum, inv) => sum + (parseFloat(inv.total_amount) || 0), 0);
  const totalFreightPaid = childDCs.reduce((sum, dc) => sum + (parseFloat(dc.freight_cost_contractor || dc.delivery_cost || 0)), 0);

  // Reconcile items (from PO items array)
  const poItems = (targetPO.items && targetPO.items.length > 0) ? targetPO.items : [
    { description: targetPO.tender_name || 'Award Scope Equipment', quantity: 1, unit_price: poVal, uom: 'LOT' }
  ];

  let hasQuantityDiscrepancy = false;
  let hasPriceDiscrepancy = false;

  const itemRows = poItems.map((item, idx) => {
    const orderedQty = parseFloat(item.quantity || 1);
    const poRate = parseFloat(item.unit_price || (poVal / orderedQty));

    // Calculate delivered quantity across DCs
    let deliveredQty = 0;
    let grnVerifiedCount = 0;
    childDCs.forEach(dc => {
      if (dc.items && dc.items.length > 0) {
        const matchingLine = dc.items.find(i => i.item_id === item.id || i.description === item.description);
        if (matchingLine) deliveredQty += parseFloat(matchingLine.dispatched_qty || matchingLine.quantity || 0);
      } else {
        deliveredQty += (orderedQty / Math.max(1, childDCs.length));
      }
      if (dc.status === 'GRN Received' || dc.status === 'Delivered') grnVerifiedCount++;
    });

    // Calculate billed quantity across Invoices
    let billedQty = 0;
    let billedRate = poRate;
    childInvs.forEach(inv => {
      if (inv.items && inv.items.length > 0) {
        const matchingLine = inv.items.find(i => i.item_id === item.id || i.description === item.description);
        if (matchingLine) {
          billedQty += parseFloat(matchingLine.quantity || 0);
          billedRate = parseFloat(matchingLine.unit_price || billedRate);
        }
      } else {
        billedQty += (orderedQty / Math.max(1, childInvs.length));
      }
    });

    const isQtyMatch = (deliveredQty >= orderedQty) && (billedQty <= deliveredQty);
    const isPriceMatch = (Math.abs(billedRate - poRate) < 1);

    if (!isQtyMatch) hasQuantityDiscrepancy = true;
    if (!isPriceMatch) hasPriceDiscrepancy = true;

    let lineAuditBadge = `<span class="badge badge-won" style="font-size:0.75rem;">✓ 100% 3-Way Matched</span>`;
    if (!isPriceMatch) {
      lineAuditBadge = `<span class="badge badge-withdraw" style="font-size:0.75rem; background:#fee2e2; color:#b91c1c;">⚠️ Price Mismatch</span>`;
    } else if (deliveredQty < orderedQty) {
      lineAuditBadge = `<span class="badge badge-hold" style="font-size:0.75rem; background:#fef3c7; color:#92400e;">⏳ Partial Delivery (${deliveredQty}/${orderedQty})</span>`;
    } else if (billedQty > deliveredQty) {
      lineAuditBadge = `<span class="badge badge-loss" style="font-size:0.75rem;">⚠️ Overbilled (> Delivered)</span>`;
    }

    return `
      <tr>
        <td>
          <strong>${item.description || item.name || `Line Item #${idx + 1}`}</strong><br>
          <span style="font-size:0.72rem; color:var(--text-muted);">${item.uom || 'PCS'}</span>
        </td>
        <td>
          <strong>${orderedQty.toLocaleString()}</strong><br>
          <span style="font-size:0.75rem; color:#0284c7;">@ ${formatCurrency(poRate, 'PKR')}</span>
        </td>
        <td>
          <strong style="color:${deliveredQty >= orderedQty ? '#059669' : '#d97706'};">${deliveredQty.toLocaleString()}</strong><br>
          <span style="font-size:0.72rem; color:var(--text-muted);">${childDCs.length} DC(s) • ${grnVerifiedCount} GRNs</span>
        </td>
        <td>
          <strong style="color:${billedQty <= deliveredQty ? '#059669' : '#dc2626'};">${billedQty.toLocaleString()}</strong><br>
          <span style="font-size:0.75rem; color:#475569;">@ ${formatCurrency(billedRate, 'PKR')}</span>
        </td>
        <td>
          ${lineAuditBadge}
        </td>
      </tr>
    `;
  }).join('');

  const isFullMatch = !hasQuantityDiscrepancy && !hasPriceDiscrepancy;

  bodyEl.innerHTML = `
    <!-- Top PO Header Card -->
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
        <div>
          <span class="pill-source" style="background:#e0f2fe; color:#0369a1; font-weight:700;">Purchase Order: ${targetPO.po_number}</span>
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin: 6px 0 2px 0;">${targetPO.customer_name || 'Customer Account'}</h3>
          <span style="font-size: 0.78rem; color: #64748b;">📍 Destination: ${targetPO.delivery_location || 'Customer Site'} | Award Ref: ${targetPO.award_number || 'Won LOA'}</span>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.76rem; color: #64748b; text-transform: uppercase; font-weight: 600;">PO Contract Value:</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #0284c7;">${formatCurrency(poVal, 'PKR')}</div>
        </div>
      </div>
    </div>

    <!-- 3-Way Milestone Funnel Summary -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 20px;">
      <div style="background: #f8fafc; border: 2px solid #0284c7; border-radius: 8px; padding: 14px; text-align: center;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #0369a1; text-transform: uppercase;">1. PO Contract (Ordered)</span>
        <div style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin: 4px 0;">${formatCurrency(poVal, 'PKR')}</div>
        <span style="font-size: 0.75rem; color: #64748b;">${poItems.length} Authorized Line Item(s)</span>
      </div>

      <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 14px; text-align: center;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #166534; text-transform: uppercase;">2. Physical Delivery (DC / GRN)</span>
        <div style="font-size: 1.15rem; font-weight: 800; color: #15803d; margin: 4px 0;">${childDCs.length} Challan(s) Dispatched</div>
        <span style="font-size: 0.75rem; color: #64748b;">Freight Paid: ${formatCurrency(totalFreightPaid, 'PKR')}</span>
      </div>

      <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 14px; text-align: center;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #1e40af; text-transform: uppercase;">3. Commercial Invoices (Billed)</span>
        <div style="font-size: 1.15rem; font-weight: 800; color: #2563eb; margin: 4px 0;">${formatCurrency(totalBilled, 'PKR')}</div>
        <span style="font-size: 0.75rem; color: #64748b;">${childInvs.length} Invoices Generated</span>
      </div>
    </div>

    <!-- Line Item Level 3-Way Reconciliation Table -->
    <div class="card" style="margin-bottom: 0;">
      <div class="card-header" style="background:#f8fafc;">
        <div class="card-title" style="font-size:0.9rem;">📊 Line-by-Line 3-Way Matching Matrix</div>
      </div>
      <div class="table-responsive">
        <table class="data-table" style="font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Line Item & UOM</th>
              <th>1. PO Ordered</th>
              <th>2. DC Delivered & GRN</th>
              <th>3. Commercial Billed</th>
              <th>Audit Status</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (badgeEl) {
    badgeEl.innerHTML = isFullMatch
      ? `<span class="badge badge-won" style="font-size:0.85rem; padding:6px 14px;">✅ 100% 3-Way Matched & Verified (Audit Ready)</span>`
      : `<span class="badge badge-hold" style="font-size:0.85rem; padding:6px 14px; background:#fef3c7; color:#92400e;">⚠️ Discrepancy / Partial Fulfillment Detected</span>`;
  }

  openModal('modal-3way-match');
}
window.open3WayMatchModal = open3WayMatchModal;

// Global Modal & Controller Exposure
window.openEditTenderModal = openEditTenderModal;
window.openEditCustomerModal = openEditCustomerModal;
window.openEditSupplierModal = openEditSupplierModal;
window.openEditProductModal = openEditProductModal;
window.openEditCompanyModal = openEditCompanyModal;
window.openNewCompanyModal = openNewCompanyModal;
window.openEditUserModal = openEditUserModal;
window.openEditEntityModal = openEditEntityModal;
window.openViewInvoiceModal = openViewInvoiceModal;
window.printInvoice = printInvoice;
window.submitUniversalEdit = submitUniversalEdit;
window.submitNewCompanyForm = submitNewCompanyForm;
window.submitNewCustomerForm = submitNewCustomerForm;
window.submitNewSupplierForm = submitNewSupplierForm;
window.submitNewProductForm = submitNewProductForm;
window.submitNewTenderForm = submitNewTenderForm;
window.submitCreateUserForm = submitCreateUserForm;
window.submitOnboardCompanyForm = submitOnboardCompanyForm;
window.syncCompanyAbbrevAndPrefix = syncCompanyAbbrevAndPrefix;



