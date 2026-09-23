const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// GET all bid securities optionally filtered by opportunity_id or status
router.get('/', authenticate, requirePermission('bid_securities', 'view'), async (req, res) => {
  const { opportunity_id, business_profile_id, status } = req.query;

  try {
    let queryText = `
      SELECT bs.*, 
             o.opportunity_number, o.tender_name, o.title as tender_title, o.tender_source,
             bp.business_name,
             c.business_name as customer_name
      FROM bid_securities bs
      LEFT JOIN opportunities o ON bs.opportunity_id = o.id
      LEFT JOIN business_profiles bp ON bs.business_profile_id = bp.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND bs.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND bs.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (opportunity_id) {
      params.push(String(opportunity_id));
      queryText += ` AND bs.opportunity_id::text = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(String(business_profile_id));
      queryText += ` AND (bs.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND LOWER(bs.status) = LOWER($${params.length})`;
    }

    queryText += ` ORDER BY bs.expiry_date ASC, bs.created_at DESC`;

    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for safe date parsing
function parseSafeDateInput(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return null;
    return dStr.toISOString().split('T')[0];
  }
  const str = String(dStr).trim();
  if (str.includes('/')) {
    const parts = str.split(/[\s,]+/)[0].split('/');
    if (parts.length === 3) {
      // DD/MM/YYYY -> YYYY-MM-DD
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  if (str.includes('-')) {
    const parts = str.split(/[\s,T]+/)[0].split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      } else if (parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
  }
  return str.split('T')[0].split(' ')[0];
}

// POST create new Bid Security
// Mandatory: 1. Account Title, 2. Beneficiary, 3. Instrument Type, 4. Instrument Number, 5. Amount, 6. Expiry Date
router.post('/', authenticate, requirePermission('bid_securities', 'add'), async (req, res) => {
  const {
    business_profile_id,
    opportunity_id,
    bid_id,
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    amount,
    issue_date,
    expiry_date,
    bank_name,
    bank_branch,
    comments
  } = req.body;

  // Validate 6 mandatory fields
  if (!account_title || !beneficiary || !instrument_type || !instrument_number || !amount || !expiry_date) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: Account Title, Beneficiary, Instrument Type (PO/CDR), Instrument Number, Amount, and Expiry Date are all mandatory.'
    });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    // Verify opportunity and resolve business_profile_id safely
    let targetBizProfileId = business_profile_id;
    if (!targetBizProfileId && opportunity_id) {
      try {
        const oppRes = await db.query(`SELECT business_profile_id, tenant_id FROM opportunities WHERE id::text = $1`, [String(opportunity_id)]);
        if (oppRes.rows.length > 0) {
          targetBizProfileId = oppRes.rows[0]?.business_profile_id;
          if ((!tenantId || tenantId === 'a0000000-0000-0000-0000-000000000001') && oppRes.rows[0]?.tenant_id) {
            tenantId = oppRes.rows[0].tenant_id;
          }
        }
      } catch (e) {}
    }

    let cleanOppId = null;
    if (opportunity_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(opportunity_id).trim());
      if (isUuid) {
        cleanOppId = String(opportunity_id).trim();
      } else {
        console.warn('[BID SECURITY CREATE WARNING]: Invalid non-UUID opportunity_id received:', opportunity_id);
        return res.status(400).json({
          success: false,
          message: `Invalid opportunity ID format: "${opportunity_id}". Must be a valid PostgreSQL UUID.`
        });
      }
    }

    // If still null, find the first business profile for this tenant
    if (!targetBizProfileId) {
      try {
        const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id::text = $1 ORDER BY created_at ASC LIMIT 1`, [String(tenantId)]);
        targetBizProfileId = bpRes.rows[0]?.id;
      } catch (e) {}
    }

    // Enforce dynamic Bid Security / CDR quota leverage according to subscription
    if (req.user?.role !== 'SuperAdmin') {
      try {
        const tenantRow = await db.query(`SELECT subscription_plan, bid_security_limit, status FROM tenants WHERE id = $1`, [tenantId]);
        if (tenantRow.rows.length > 0) {
          const tnt = tenantRow.rows[0];
          if (tnt.status === 'Suspended') {
            return res.status(403).json({ success: false, message: 'Your organization workspace is suspended due to pending subscription payment.' });
          }
          const bsLimit = tnt.bid_security_limit;
          const isUnlimited = (bsLimit === 'unlimited' || bsLimit === -1 || bsLimit === null || bsLimit === 'Unlimited' || tnt.subscription_plan === 'Advance' || tnt.subscription_plan === 'Enterprise');
          if (!isUnlimited) {
            const maxAllowed = parseInt(bsLimit, 10) || 10;
            const countRes = await db.query(`SELECT COUNT(*) FROM bid_securities WHERE tenant_id = $1`, [tenantId]);
            const currentCount = parseInt(countRes.rows[0]?.count || 0, 10);
            if (currentCount >= maxAllowed) {
              return res.status(402).json({
                success: false,
                quotaExceeded: true,
                message: `Bid Security Quota Reached: Your organization subscription package allows ${maxAllowed} Bid Securities / CDRs (${currentCount} registered). Please upgrade your subscription plan or contact administrator.`
              });
            }
          }
        }
      } catch (quotaErr) {
        console.warn('Bid security quota check warning:', quotaErr.message);
      }
    }

    // If still null, fallback to any available business profile in the system
    if (!targetBizProfileId) {
      try {
        const anyBp = await db.query(`SELECT id FROM business_profiles ORDER BY created_at ASC LIMIT 1`);
        targetBizProfileId = anyBp.rows[0]?.id;
      } catch (e) {}
    }

    const cleanIssueDate = parseSafeDateInput(issue_date) || new Date();
    // In Pakistani banking, CDRs are valid for 90 or 120 days. Ensure not-null constraint is satisfied.
    const cleanExpiryDate = parseSafeDateInput(expiry_date) || new Date(cleanIssueDate.getTime() + 90 * 86400000);

    let secCols = [
      'tenant_id', 'business_profile_id', 'opportunity_id', 'bid_id',
      'account_title', 'beneficiary', 'instrument_type', 'instrument_number',
      'amount', 'issue_date', 'expiry_date', 'bank_name', 'bank_branch',
      'status', 'comments'
    ];
    let secVals = [
      tenantId, targetBizProfileId, cleanOppId, bid_id || null,
      account_title, beneficiary, instrument_type, instrument_number,
      parseFloat(amount), cleanIssueDate, cleanExpiryDate, bank_name || null,
      bank_branch || null, 'Active', comments || null
    ];

    if (req.body.instrument_image_url) {
      secCols.push('instrument_image_url');
      secVals.push(req.body.instrument_image_url);
    }

    const placeholders = secVals.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query(
      `INSERT INTO bid_securities (${secCols.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      secVals
    );

    // Also update tender status to 'Ready to submit' if tender was in New / Selected / Under Review / Bid Preparation
    if (cleanOppId) {
      try {
        await db.query(
          `UPDATE opportunities 
           SET status = 'Ready to submit', updated_at = CURRENT_TIMESTAMP 
           WHERE id::text = $1 AND status IN ('New', 'Selected', 'Under Review', 'Bid Preparation', 'Under Evaluation')`,
          [String(cleanOppId)]
        );
      } catch (e) {}
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security attached successfully. Tender is now Ready to Submit.'
    });
  } catch (err) {
    console.error('[BID SECURITY CREATE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error saving bid security: ${err.message}` });
  }
});

// POST release Bid Security (for won after PG/contract, or for lost/withdraw/rejected)
router.post('/:id/release', authenticate, requirePermission('bid_securities', 'edit'), async (req, res) => {
  const { release_date, release_reference, comments } = req.body;

  try {
    // ── Business Rule: If an active Performance Guarantee exists for this
    //    tender/opportunity, releasing the bid security marks it as "PG Submitted"
    //    (not "Released"), because the PG has replaced / covered the bid security.
    const bsRow = await db.query(
      `SELECT opportunity_id, tenant_id FROM bid_securities WHERE id = $1`,
      [req.params.id]
    );
    if (bsRow.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }
    const { opportunity_id, tenant_id } = bsRow.rows[0];

    let newStatus = 'Released';
    if (opportunity_id) {
      const pgCheck = await db.query(
        `SELECT pg.id FROM performance_guarantees pg
         WHERE pg.status = 'Active'
           AND pg.tenant_id = $2
           AND (
             pg.opportunity_id::text = $1
             OR pg.award_letter_id IN (
               SELECT id FROM award_letters WHERE opportunity_id::text = $1
             )
             OR pg.contract_id IN (
               SELECT id FROM contracts WHERE opportunity_id::text = $1
             )
           )
         LIMIT 1`,
        [String(opportunity_id), tenant_id]
      );
      if (pgCheck.rows.length > 0) {
        newStatus = 'PG Submitted';
      }
    }
    // ─────────────────────────────────────────────────────────────────

    const result = await db.query(
      `UPDATE bid_securities 
       SET status = $1, 
           release_date = $2, 
           release_reference = $3, 
           comments = COALESCE(comments, '') || ' | ' || $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [
        newStatus,
        release_date || new Date(),
        release_reference || 'Handover Letter',
        comments || 'Released to client file',
        req.params.id
      ]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: newStatus === 'PG Submitted'
        ? 'Bid Security marked as PG Submitted — an active Performance Guarantee exists for this tender.'
        : 'Bid Security has been successfully marked as RELEASED.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// PUT update Bid Security details
router.put('/:id', authenticate, requirePermission('bid_securities', 'edit'), async (req, res) => {
  const {
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    amount,
    expiry_date,
    bank_name,
    bank_branch,
    status,
    department_diary_number,
    recovery_letter_date,
    recovery_letter_ref,
    comments
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE bid_securities
       SET account_title = COALESCE($1, account_title),
           beneficiary = COALESCE($2, beneficiary),
           instrument_type = COALESCE($3, instrument_type),
           instrument_number = COALESCE($4, instrument_number),
           amount = COALESCE($5, amount),
           expiry_date = COALESCE($6, expiry_date),
           bank_name = COALESCE($7, bank_name),
           bank_branch = COALESCE($8, bank_branch),
           status = COALESCE($9, status),
           department_diary_number = COALESCE($10, department_diary_number),
           recovery_letter_date = COALESCE($11, recovery_letter_date),
           recovery_letter_ref = COALESCE($12, recovery_letter_ref),
           comments = COALESCE($13, comments),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $14
       RETURNING *`,
      [
        account_title || null,
        beneficiary || null,
        instrument_type || null,
        instrument_number || null,
        amount !== undefined ? parseFloat(amount) : null,
        expiry_date || null,
        bank_name || null,
        bank_branch || null,
        status || null,
        department_diary_number || null,
        recovery_letter_date || null,
        recovery_letter_ref || null,
        comments || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security updated successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET generate official CDR refund / return request letter
router.get('/:id/recovery-letter', authenticate, requirePermission('bid_securities', 'view'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT bs.*, 
              o.opportunity_number, o.tender_name, o.title as tender_title, o.tender_source, o.status as tender_status,
              bp.business_name, bp.legal_name, bp.address as bp_address, bp.ntn as bp_ntn,
              c.business_name as procuring_agency, c.department_name
       FROM bid_securities bs
       JOIN opportunities o ON bs.opportunity_id = o.id
       JOIN business_profiles bp ON bs.business_profile_id = bp.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE bs.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }

    const row = result.rows[0];
    const letterRef = `REF/${row.business_name.substring(0, 3).toUpperCase()}/CDR-RET/${Date.now().toString().slice(-5)}`;
    
    // Automatically update recovery letter metadata
    await db.query(
      `UPDATE bid_securities SET recovery_letter_date = CURRENT_DATE, recovery_letter_ref = $1 WHERE id = $2`,
      [letterRef, req.params.id]
    );

    res.json({
      success: true,
      data: {
        letterReference: letterRef,
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        recipient: {
          title: 'The Purchase / Procurement Officer',
          department: row.department_name || row.procuring_agency || 'Procuring Authority',
          organization: row.procuring_agency || 'Government Department'
        },
        sender: {
          companyName: row.legal_name || row.business_name,
          address: row.bp_address || 'Pakistan',
          ntn: row.bp_ntn
        },
        subject: `APPLICATION FOR RELEASE / RETURN OF EARNEST MONEY (BID SECURITY) - TENDER NO: ${row.opportunity_number}`,
        tenderDetails: {
          tenderNumber: row.opportunity_number,
          tenderName: row.tender_name || row.tender_title,
          instrumentType: row.instrument_type,
          instrumentNumber: row.instrument_number,
          bankName: row.bank_name,
          amountPKR: row.amount,
          issueDate: row.issue_date,
          expiryDate: row.expiry_date,
          diaryReference: row.department_diary_number || 'Under Department Diary'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 10. INTELLIGENT INSTRUMENT PARSER (Pay Order & CDR Auto-Fill Engine)
// Specialized for Pakistani Banking Instruments (HBL, MCB, ABL, UBL, Meezan, BOP, NBP, etc.)
// ============================================================================

function parsePakistaniBankingInstrument(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      instrument_type: 'PO',
      instrument_number: '',
      bank_name: '',
      bank_branch: '',
      amount: '',
      date: '',
      expiry_date: '',
      beneficiary: '',
      confidence: 0
    };
  }

  const text = rawText.replace(/\r\n/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let detectedType = 'PO';
  let detectedNumber = '';
  let detectedBank = '';
  let detectedBranch = '';
  let detectedAmount = '';
  let detectedDate = '';
  let detectedBeneficiary = '';

  // 1. Detect Instrument Type across all Pakistani banks
  if (/\b(CDR|C\.D\.R|CALL\s*DEPOSIT|CALL\s*DEPOSIT\s*RECEIPT)\b/i.test(text)) {
    detectedType = 'CDR';
  } else if (/\b(BANK\s*GUARANTEE|GUARANTEE\s*BOND|B\.G\.)\b/i.test(text)) {
    detectedType = 'BG';
  } else if (/\b(CASHIER'?S?\s*CHEQUE|PAY\s*ORDER|P\.O\.?\s*NO|DEMAND\s*DRAFT)\b/i.test(text)) {
    detectedType = 'PO';
  } else {
    detectedType = 'PO';
  }

  // 2. Detect Issuing Bank (Universal across all commercial and Islamic banks in Pakistan)
  const bankPatterns = [
    { name: 'Meezan Bank Limited', regex: /\b(MEEZAN\s*BANK|MEEZAN)\b/i },
    { name: 'United Bank Limited (UBL)', regex: /\b(UNITED\s*BANK|UBL|UBL\s*AMEEN)\b/i },
    { name: 'Habib Bank Limited (HBL)', regex: /\b(HABIB\s*BANK|HBL)\b/i },
    { name: 'MCB Bank Limited', regex: /\b(MCB|MUSLIM\s*COMMERCIAL\s*BANK)\b/i },
    { name: 'Allied Bank Limited (ABL)', regex: /\b(ALLIED\s*BANK|ABL)\b/i },
    { name: 'National Bank of Pakistan (NBP)', regex: /\b(NATIONAL\s*BANK\s*OF\s*PAKISTAN|NBP)\b/i },
    { name: 'The Bank of Punjab (BOP)', regex: /\b(BANK\s*OF\s*PUNJAB|BOP)\b/i },
    { name: 'Bank Alfalah Limited', regex: /\b(BANK\s*ALFALAH|ALFALAH)\b/i },
    { name: 'Faysal Bank Limited', regex: /\b(FAYSAL\s*BANK)\b/i },
    { name: 'Askari Bank Limited', regex: /\b(ASKARI\s*BANK)\b/i },
    { name: 'Standard Chartered Bank', regex: /\b(STANDARD\s*CHARTERED)\b/i },
    { name: 'Dubai Islamic Bank', regex: /\b(DUBAI\s*ISLAMIC)\b/i },
    { name: 'Bank Al Habib Limited', regex: /\b(BANK\s*AL\s*HABIB|AL\s*HABIB)\b/i },
    { name: 'Soneri Bank Limited', regex: /\b(SONERI\s*BANK)\b/i },
    { name: 'JS Bank Limited', regex: /\b(JS\s*BANK)\b/i },
    { name: 'Habib Metropolitan Bank', regex: /\b(HABIB\s*METROPOLITAN|HABIBMETRO)\b/i },
    { name: 'Sindh Bank Limited', regex: /\b(SINDH\s*BANK)\b/i },
    { name: 'The Bank of Khyber (BOK)', regex: /\b(BANK\s*OF\s*KHYBER|BOK)\b/i },
    { name: 'Al Baraka Bank', regex: /\b(AL\s*BARAKA)\b/i }
  ];

  for (const b of bankPatterns) {
    if (b.regex.test(text)) {
      detectedBank = b.name;
      break;
    }
  }

  // Detect Branch from issuing branch lines, branch parenthesis, or labeled fields
  const branchIssuingMatch = text.match(/ISSUING\s*BRANCH\s*[:.-]?\s*([^\n\r]+)/i);
  const branchParenMatch = text.match(/\(([0-9]{3,5})\)\s*([A-Za-z0-9\s,\.\-]{3,60}(?:BRANCH|LAHORE|KARACHI|ISLAMABAD|RAWALPINDI|PESHAWAR|QUETTA|MULTAN|FAISALABAD))/i);
  const branchStandardMatch = text.match(/(?:Branch|Br\.?)\s*[:.-]?\s*([A-Za-z0-9\s,\-]{3,50})/i);

  if (branchIssuingMatch && branchIssuingMatch[1]) {
    detectedBranch = branchIssuingMatch[1].replace(/(?:NOT\s+OVER|DATE|CHEQUE|TEL).*$/i, '').trim();
  } else if (branchParenMatch) {
    detectedBranch = `(${branchParenMatch[1]}) ${branchParenMatch[2].trim()}`;
  } else if (branchStandardMatch && branchStandardMatch[1]) {
    const rawBr = branchStandardMatch[1].split('\n')[0].replace(/(?:Date|Code|Tel|Ph).*$/i, '').trim();
    if (rawBr.length > 2) detectedBranch = rawBr;
  }

  // 3. Detect Instrument Number (e.g. PO.0243.6526558, Cheque No. IB 01520607, CDR # 445566, Ref No 1520607)
  const poPrefixedMatch = text.match(/\b(PO\.?[0-9]{3,5}\.?[0-9]{5,10})\b/i);
  const chequeIbMatch = text.match(/CHEQUE\s*NO\.?\s*(?:IB\s*)?([0-9]{6,12})/i);
  const stationeryMatch = text.match(/(?:STATIONERY|REF)\s*(?:\/REF)?\s*NO\.?\s*[:.-]?\s*([0-9]{6,12})/i);
  const labeledNoMatch = text.match(/(?:CDR|PO|P\.O\.?|PAY\s*ORDER|INSTRUMENT|CHEQUE|CHQ|RECEIPT)\s*(?:NO\.?|#)?\s*[:.-]?\s*([A-Za-z0-9\.\-\/]{5,22})/i);

  if (poPrefixedMatch) {
    detectedNumber = poPrefixedMatch[1].trim();
  } else if (chequeIbMatch) {
    detectedNumber = chequeIbMatch[1].trim();
  } else if (labeledNoMatch && /\d/.test(labeledNoMatch[1])) {
    detectedNumber = labeledNoMatch[1].trim();
  } else if (stationeryMatch) {
    detectedNumber = stationeryMatch[1].trim();
  } else {
    // Look for MICR sequence "06526558" or standalone 6-9 digit number
    const micrQuotesMatch = text.match(/["“⑈']\s*([0-9]{6,10})\s*["”⑈']/);
    if (micrQuotesMatch) {
      detectedNumber = micrQuotesMatch[1];
    } else {
      const numCandidates = text.match(/\b([0-9]{6,10})\b/g);
      if (numCandidates && numCandidates.length > 0) {
        detectedNumber = numCandidates[0];
      }
    }
  }

  // 4. Detect Amount (Numeric PKR) with asterisk/bracket bounding support
  // e.g. NOT OVER RS. ***2,400,000.00***, PKR *270,000.00*, Rs. 1,250,000/=
  const notOverMatch = text.match(/NOT\s+OVER\s+RS\.?\s*[*=\s]*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?)/i);
  const pkrAsteriskMatch = text.match(/(?:PKR|RS\.?|AMOUNT)\s*[:.-]?\s*[*=\s]*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?)/i);

  if (pkrAsteriskMatch && pkrAsteriskMatch[1]) {
    detectedAmount = pkrAsteriskMatch[1].replace(/,/g, '');
  } else if (notOverMatch && notOverMatch[1]) {
    detectedAmount = notOverMatch[1].replace(/,/g, '');
  } else {
    const commaNums = text.match(/\b([1-9][0-9]{0,2}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?)\b/g);
    if (commaNums && commaNums.length > 0) {
      detectedAmount = commaNums[0].replace(/,/g, '');
    }
  }

  // 5. Detect Date (Supports both 8-Box and 6-Box separated digits, and standard DD/MM/YYYY)
  // Format A: 8-digit spaced boxes e.g. "1 0 0 7 2 0 2 6" or "1 0 | 0 7 | 2 0 2 6" -> 10/07/2026
  const box8Match = text.match(/\b([0-3])\s*([0-9])[\s\|\.\-\/]+([0-1])\s*([0-9])[\s\|\.\-\/]+(2)\s*(0)\s*([2-3])\s*([0-9])\b/);
  // Format B: 6-digit spaced boxes e.g. "2 0 0 7 2 6" or "2 0 | 0 7 | 2 6" -> 20/07/2026
  const box6Match = text.match(/\b([0-3])\s*([0-9])[\s\|\.\-\/]+([0-1])\s*([0-9])[\s\|\.\-\/]+([2-3])\s*([0-9])\b/);
  // Format C: Standard slashed/hyphenated/dotted DD/MM/YYYY
  const standardDateMatch = text.match(/\b([0-3]?[0-9][\/\-\.][0-1]?[0-9][\/\-\.](?:20)?[2-3][0-9])\b/);

  if (box8Match) {
    const dd = `${box8Match[1]}${box8Match[2]}`;
    const mm = `${box8Match[3]}${box8Match[4]}`;
    const yyyy = `${box8Match[5]}${box8Match[6]}${box8Match[7]}${box8Match[8]}`;
    detectedDate = `${dd}/${mm}/${yyyy}`;
  } else if (box6Match) {
    const dd = `${box6Match[1]}${box6Match[2]}`;
    const mm = `${box6Match[3]}${box6Match[4]}`;
    const yyyy = `20${box6Match[5]}${box6Match[6]}`;
    detectedDate = `${dd}/${mm}/${yyyy}`;
  } else if (standardDateMatch) {
    const rawD = standardDateMatch[1].replace(/[\-\.]/g, '/');
    const parts = rawD.split('/');
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      let yyyy = parts[2];
      if (yyyy.length === 2) yyyy = '20' + yyyy;
      detectedDate = `${dd}/${mm}/${yyyy}`;
    }
  } else {
    // Format D: Month name format e.g. 15 Aug 2026 or 15-August-2026
    const monthWordMatch = text.match(/\b([0-3]?[0-9])[\s\-\/]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s\-\/,]+((?:20)?[2-3][0-9])\b/i);
    if (monthWordMatch) {
      const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const mIdx = monthNames.indexOf(monthWordMatch[2].toLowerCase().slice(0, 3));
      if (mIdx !== -1) {
        const dd = monthWordMatch[1].padStart(2, '0');
        const mm = String(mIdx + 1).padStart(2, '0');
        let yyyy = monthWordMatch[3];
        if (yyyy.length === 2) yyyy = '20' + yyyy;
        detectedDate = `${dd}/${mm}/${yyyy}`;
      }
    }
  }

  // Standard validity: 6 months (180 days) from issue date in Pakistan
  let calculatedExpiry = '';
  if (detectedDate) {
    const p = detectedDate.split('/');
    if (p.length === 3) {
      const dObj = new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      if (!isNaN(dObj.getTime())) {
        const expObj = new Date(dObj.getTime() + 180 * 86400000);
        calculatedExpiry = `${String(expObj.getDate()).padStart(2, '0')}/${String(expObj.getMonth() + 1).padStart(2, '0')}/${expObj.getFullYear()}`;
      }
    }
  }

  // 6. Detect Beneficiary / Payee (handles two-tier printed payee lines common in Pakistani banks)
  const payToMatch = text.match(/Pay\s+to\s+([\s\S]{4,180}?)(?:or\s+Order|Rupees|PKR|RS\.|\*\*\*|\n\s*\n)/i);
  const altBeneMatch = text.match(/(?:IN\s+FAVOU?R\s+OF|ACCOUNT\s+OF|FAVOURING|BENEFICIARY|M\/S|MESSRS)\s*[:.-]?\s*([A-Za-z0-9\s,\.\-\(\)\/\&]{4,150})/i);

  if (payToMatch && payToMatch[1]) {
    let rawBene = payToMatch[1]
      .replace(/\r?\n/g, ' ')
      .replace(/[*"“]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check if the line right before "Pay to" has the first half of the title
    const beforePayToMatch = text.match(/(?:^|\n)([^\n\r]*\b(?:DIRECTOR|OFFICER|CHAIRMAN|SECRETARY|SUPERINTENDENT|ENGINEER|COMMISSIONER|HOSPITAL|UNIVERSITY|AUTHORITY|DEPARTMENT|MINISTRY|M\/S|LIMITED|PVT|COMPANY|INSPECTOR|MANAGER)[^\n\r]*)\s*\n\s*Pay\s+to/i);
    if (beforePayToMatch && beforePayToMatch[1]) {
      const prefixTitle = beforePayToMatch[1].replace(/[*"“]/g, '').trim();
      if (prefixTitle.length > 3) {
        rawBene = `${prefixTitle} ${rawBene}`.replace(/\s+/g, ' ');
      }
    }

    if (!/^(ORDER|CALL|DEPOSIT|RECEIPT|CASH|BEARER)\b/i.test(rawBene) && rawBene.length > 3) {
      detectedBeneficiary = rawBene;
    }
  } else if (altBeneMatch && altBeneMatch[1]) {
    let rawBene = altBeneMatch[1].split('\n')[0].replace(/(?:OR\s+ORDER|OR\s+BEARER|RUPEES|RS|PKR|THE\s+SUM).*$/i, '').trim();
    if (!/^(ORDER|CALL|DEPOSIT|RECEIPT|CASH|BEARER)\b/i.test(rawBene) && rawBene.length > 3) {
      detectedBeneficiary = rawBene;
    }
  }

  let confidenceScore = 0;
  if (detectedBank) confidenceScore += 25;
  if (detectedNumber) confidenceScore += 25;
  if (detectedAmount) confidenceScore += 25;
  if (detectedDate) confidenceScore += 15;
  if (detectedBeneficiary) confidenceScore += 10;

  return {
    instrument_type: detectedType,
    instrument_number: detectedNumber,
    bank_name: detectedBank + (detectedBranch ? ` - ${detectedBranch}` : ''),
    bank_branch: detectedBranch,
    amount: detectedAmount ? Number(detectedAmount).toLocaleString() : '',
    raw_amount: detectedAmount ? parseFloat(detectedAmount) : 0,
    date: detectedDate,
    expiry_date: calculatedExpiry || detectedDate,
    beneficiary: detectedBeneficiary,
    confidence: confidenceScore,
    raw_text_snippet: text.slice(0, 300)
  };
}

router.post('/parse-instrument', authenticate, async (req, res) => {
  try {
    const { text, image, filename } = req.body;
    let ocrText = text || '';

    // If client supplied extracted text from Tesseract
    const parsedData = parsePakistaniBankingInstrument(ocrText);

    res.json({
      success: true,
      data: parsedData,
      message: parsedData.confidence > 0 
        ? `Instrument parsed successfully (${parsedData.confidence}% confidence)`
        : 'Parsing completed with low confidence. Please verify fields.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.parsePakistaniBankingInstrument = parsePakistaniBankingInstrument;
module.exports = router;

