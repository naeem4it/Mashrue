/**
 * Mashrue (mashrue.com) — Coming Soon Landing Page Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  initCountdown();
});

/**
 * 1. Live Countdown Timer to Q4 2026
 */
function initCountdown() {
  // Target Launch Date: November 15, 2026
  const targetDate = new Date('2026-11-15T00:00:00+05:00').getTime();

  function updateTimer() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance <= 0) {
      document.getElementById('cd-days').textContent = '00';
      document.getElementById('cd-hours').textContent = '00';
      document.getElementById('cd-mins').textContent = '00';
      document.getElementById('cd-secs').textContent = '00';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');

    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minsEl = document.getElementById('cd-mins');
    const secsEl = document.getElementById('cd-secs');

    if (daysEl) daysEl.textContent = pad(days);
    if (hoursEl) hoursEl.textContent = pad(hours);
    if (minsEl) minsEl.textContent = pad(minutes);
    if (secsEl) secsEl.textContent = pad(seconds);
  }

  updateTimer();
  setInterval(updateTimer, 1000);
}

/**
 * 2. VIP Early Access Form Submission Handler
 */
function handleEarlyAccessSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('lead-name').value.trim();
  const email = document.getElementById('lead-email').value.trim();
  const company = document.getElementById('lead-company').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const submitBtn = document.getElementById('submit-btn');

  if (!name || !email || !company || !phone) {
    alert('Please fill in all required fields.');
    return;
  }

  // Visual loading state
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ Confirming Reservation...</span>';

  const leadData = {
    name,
    email,
    company,
    phone,
    timestamp: new Date().toISOString(),
    source: 'mashrue.com_coming_soon'
  };

  // 1. Save to local browser storage
  try {
    const existingLeads = JSON.parse(localStorage.getItem('mashrue_early_access_leads') || '[]');
    existingLeads.push(leadData);
    localStorage.setItem('mashrue_early_access_leads', JSON.stringify(existingLeads));
  } catch (e) {
    console.warn('LocalStorage error:', e);
  }

  // 2. Simulate or execute API forward (if backend endpoint exists)
  setTimeout(() => {
    // Hide form, show confirmation alert
    const form = document.getElementById('early-access-form');
    const successMsg = document.getElementById('form-success-msg');

    if (form) form.style.display = 'none';
    if (successMsg) successMsg.style.display = 'flex';

    console.log('✅ Lead captured successfully:', leadData);
  }, 900);
}
