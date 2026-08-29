const https = require('https');

/**
 * ============================================================================
 * MASHRUE ENTERPRISE EMAIL SERVICE (Dedicated Resend.com Engine)
 * ============================================================================
 * - Uses Resend HTTPS REST API (Port 443 - zero firewall/port blocking)
 * - Clean, unified, consistent architecture
 * - Built-in automatic fallback sender (welcome@mashrue.com -> onboarding@resend.dev)
 */

const RESEND_CONFIG = {
  apiKey: (process.env.RESEND_API_KEY || '').trim(),
  fromEmail: (process.env.FROM_EMAIL || 'welcome@mashrue.com').trim(),
  fromName: (process.env.SMTP_FROM_NAME || 'Mashrue Platform').trim(),
  frontendUrl: (process.env.FRONTEND_URL || 'https://mashrue.com').trim()
};

/**
 * Low-level Resend HTTPS API Caller
 */
function postToResend({ to, subject, html, text, from }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_CONFIG.apiKey) {
      return reject(new Error('RESEND_API_KEY is not configured'));
    }

    const payload = JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || 'Please view this email in an HTML-compatible client.'
    });

    const req = https.request(
      {
        hostname: 'api.resend.com',
        port: 443,
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_CONFIG.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, messageId: parsed.id, from });
            } else {
              reject(new Error(`Resend Error (${res.statusCode}): ${parsed.message || data}`));
            }
          } catch (e) {
            reject(new Error(`Resend Response Parse Error: ${data}`));
          }
        });
      }
    );

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Resend API request timed out (10s)'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Universal Resend Email Dispatcher
 */
async function sendEmail({ to, subject, html, text, from }) {
  const primaryFrom = from || `${RESEND_CONFIG.fromName} <${RESEND_CONFIG.fromEmail}>`;

  try {
    const res = await postToResend({ to, subject, html, text, from: primaryFrom });
    console.log(`✅ [Resend] Successfully delivered email to ${to} (Message ID: ${res.messageId})`);
    return { success: true, messageId: res.messageId, provider: 'resend' };
  } catch (err) {
    console.warn(`⚠️ [Resend] Primary sender (${primaryFrom}) error:`, err.message);

    // Automatic fallback sender (onboarding@resend.dev) if custom domain is in verification
    if (!from || from === primaryFrom) {
      try {
        const fallbackFrom = `${RESEND_CONFIG.fromName} <onboarding@resend.dev>`;
        const fallbackRes = await postToResend({ to, subject, html, text, from: fallbackFrom });
        console.log(`✅ [Resend Sandbox] Delivered email to ${to} (Message ID: ${fallbackRes.messageId})`);
        return { success: true, messageId: fallbackRes.messageId, provider: 'resend-sandbox' };
      } catch (fallbackErr) {
        console.error(`❌ [Resend Sandbox] Fallback error:`, fallbackErr.message);
        return { success: false, error: `${err.message} | Sandbox: ${fallbackErr.message}` };
      }
    }

    return { success: false, error: err.message };
  }
}

/**
 * Builds and dispatches branded Welcome / Password Setup Email
 */
async function sendWelcomeUserEmail({ toEmail, fullName, username, resetToken, role, companyName }) {
  const frontendUrl = RESEND_CONFIG.frontendUrl;
  const setupUrl = `${frontendUrl}/#set-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(toEmail)}`;

  const subject = `Welcome to Mashrue - Set Up Your Account Password`;

  const roleLabels = {
    SuperAdmin: 'Super Administrator',
    ClientAdmin: 'Client Administrator',
    CompanyAdmin: 'Company Administrator',
    ClientEmployee: 'Team Member / Employee',
    ReadOnly: 'Read-Only Member'
  };
  const roleDisplay = roleLabels[role] || role || 'User';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Mashrue</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #334155;
      margin: 0;
      padding: 0;
    }
    .wrapper {
      width: 100%;
      background-color: #0b1120;
      padding: 40px 15px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #1e3a8a 0%, #0284c7 100%);
      padding: 35px 30px;
      text-align: center;
      color: #ffffff;
    }
    .logo-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 6px 14px;
      border-radius: 30px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .header h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 14px;
      opacity: 0.9;
    }
    .content {
      padding: 35px 30px;
      line-height: 1.6;
    }
    .greeting {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    .info-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin: 22px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px dashed #e2e8f0;
      font-size: 14px;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #64748b;
      font-weight: 500;
    }
    .info-val {
      color: #0f172a;
      font-weight: 700;
    }
    .btn-container {
      text-align: center;
      margin: 30px 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      padding: 14px 34px;
      border-radius: 10px;
      box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.4);
    }
    .security-note {
      background-color: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 14px 16px;
      border-radius: 0 8px 8px 0;
      font-size: 13px;
      color: #1e40af;
      margin: 24px 0 10px 0;
    }
    .footer {
      background-color: #f1f5f9;
      padding: 25px 30px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
    }
    .footer a {
      color: #0284c7;
      text-decoration: none;
    }
    .raw-link {
      word-break: break-all;
      font-size: 12px;
      color: #0284c7;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-badge">MASHRUE.COM</div>
        <h1>Welcome to Mashrue</h1>
        <p>B2B Tender, Bidding & FBR Digital Invoicing SaaS Platform</p>
      </div>

      <div class="content">
        <div class="greeting">Hello ${fullName || 'Valued User'},</div>
        <p>
          An account has been created for you on the <strong>Mashrue</strong> platform by the System Administrator. 
          To activate your account and start managing tenders, bids, and FBR-compliant invoices, please set your password using the link below:
        </p>

        <div class="info-card">
          <div class="info-row">
            <span class="info-label">Full Name:</span>
            <span class="info-val">${fullName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Username:</span>
            <span class="info-val">${username}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Registered Email:</span>
            <span class="info-val">${toEmail}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Assigned Role:</span>
            <span class="info-val">${roleDisplay}</span>
          </div>
          ${companyName ? `
          <div class="info-row">
            <span class="info-label">Company / Tenant:</span>
            <span class="info-val">${companyName}</span>
          </div>` : ''}
        </div>

        <div class="btn-container">
          <a href="${setupUrl}" class="btn" target="_blank">Set / Change Your Password</a>
        </div>

        <div class="security-note">
          <strong>Security Notice:</strong> This password setup link is valid for <strong>72 hours</strong>. 
          Your new password must be 8-20 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.
        </div>

        <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
          If the button above does not work, copy and paste this link into your browser:
          <br>
          <a href="${setupUrl}" class="raw-link">${setupUrl}</a>
        </p>
      </div>

      <div class="footer">
        <p style="margin: 0 0 8px 0;">
          Need assistance? Contact support at <a href="mailto:support@mashrue.com">support@mashrue.com</a>
        </p>
        <p style="margin: 0;">
          &copy; ${new Date().getFullYear()} Mashrue SaaS Platform (mashrue.com). All rights reserved.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const text = `
Welcome to Mashrue!

Hello ${fullName || 'User'},

An account has been created for you on the Mashrue platform.
To activate your account and set your password, please open the following link in your browser:

${setupUrl}

Account Details:
- Name: ${fullName}
- Username: ${username}
- Email: ${toEmail}
- Role: ${roleDisplay}
${companyName ? `- Company: ${companyName}` : ''}

Security Notice: This link expires in 72 hours.

Best regards,
The Mashrue Team
https://mashrue.com
`;

  return await sendEmail({
    to: toEmail,
    subject,
    html,
    text
  });
}

/**
 * Builds and dispatches Password Reset Email
 */
async function sendPasswordResetEmail({ toEmail, fullName, resetToken }) {
  const frontendUrl = RESEND_CONFIG.frontendUrl;
  const resetUrl = `${frontendUrl}/#reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(toEmail)}`;

  const subject = `Reset Your Mashrue Account Password`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0f172a; margin:0; padding:0; }
    .wrapper { width:100%; background:#0b1120; padding:40px 15px; }
    .container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; }
    .header { background:linear-gradient(135deg, #1e3a8a 0%, #0284c7 100%); padding:30px; text-align:center; color:#ffffff; }
    .content { padding:30px; line-height:1.6; color:#334155; }
    .btn { display:inline-block; background:#2563eb; color:#ffffff !important; text-decoration:none; font-weight:700; padding:12px 30px; border-radius:8px; margin:20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h2>Password Reset Request</h2>
      </div>
      <div class="content">
        <p>Hello ${fullName || 'User'},</p>
        <p>We received a request to reset your password for your Mashrue account.</p>
        <p style="text-align:center;">
          <a href="${resetUrl}" class="btn" target="_blank">Reset Your Password</a>
        </p>
        <p style="font-size:13px; color:#64748b;">If you did not request this, you can safely ignore this email.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const text = `
Hello ${fullName || 'User'},

To reset your password, visit:
${resetUrl}

If you did not request this, please ignore this email.
`;

  return await sendEmail({
    to: toEmail,
    subject,
    html,
    text
  });
}

module.exports = {
  EMAIL_CONFIG: RESEND_CONFIG,
  sendEmail,
  sendWelcomeUserEmail,
  sendPasswordResetEmail
};
