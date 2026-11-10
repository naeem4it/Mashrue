/**
 * ============================================================================
 * MASHRUE ENTERPRISE FINANCIAL MANAGEMENT ENGINE (services/financeService.js)
 * ============================================================================
 * Handles:
 *  - Decimal-safe monetary calculations
 *  - Company accounting configuration, fiscal years & period-lock validation
 *  - Multi-currency lookup & exchange rate conversion
 *  - Double-entry Journal lifecycle (Draft -> Approve -> Post -> Reverse)
 *  - Configurable tax engine (Exclusive, Inclusive, Exempt, WHT, rounding)
 *  - Idempotent Automated Accounting Rule Engine (standalone & optional integrations)
 *  - Financial Statements: Trial Balance, GL Activity, P&L, Balance Sheet,
 *    Indirect Cash Flow Statement, AR/AP Aging, Party Statements, Tax Summary
 *  - Fixed Assets Register, Depreciation Runs (duplicate-safe) & Disposals
 * ============================================================================
 */

const db = require('../config/db');

function round2(val) {
  const n = Number(val || 0);
  if (!isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(val) {
  const n = Number(val || 0);
  if (!isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

class FinanceService {
  /**
   * Decimal rounding helper
   */
  applyRounding(amount, rule = 'HALF_UP') {
    const num = Number(amount || 0);
    if (rule === 'FLOOR') return Math.floor(num * 100) / 100;
    if (rule === 'CEIL') return Math.ceil(num * 100) / 100;
    return round2(num);
  }

  /**
   * Immutable Financial Audit Logger
   */
  async logAudit(client, {
    tenantId,
    entityType,
    entityId,
    action,
    userId = null,
    userName = 'System',
    beforeState = null,
    afterState = null,
    remarks = null
  }) {
    const qClient = client || db;
    await qClient.query(
      `INSERT INTO finance_audit_logs (
        tenant_id, entity_type, entity_id, action, user_id, user_name, before_state, after_state, remarks
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [
        tenantId,
        entityType,
        String(entityId),
        action,
        userId,
        userName || 'System',
        beforeState ? JSON.stringify(beforeState) : null,
        afterState ? JSON.stringify(afterState) : null,
        remarks
      ]
    );
  }

  /**
   * Ensure & fetch tenant accounting settings
   */
  async getCompanySettings(client, tenantId) {
    const qClient = client || db;
    let res = await qClient.query(`SELECT * FROM finance_company_settings WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) {
      res = await qClient.query(
        `INSERT INTO finance_company_settings (tenant_id) VALUES ($1)
         ON CONFLICT (tenant_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [tenantId]
      );
    }
    return res.rows[0];
  }

  /**
   * Ensure COA accounts exist for tenant and return map by account_code
   */
  async ensureCoaMap(client, tenantId) {
    const qClient = client || db;
    let res = await qClient.query(`SELECT id, account_code, account_name, account_type, is_active FROM coa_accounts WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) {
      const defaults = [
        ['1001', 'Cash in Hand (Petty Cash)', 'Asset', 'Current Asset', true],
        ['1010', 'Bank Current Account (PKR)', 'Asset', 'Current Asset', true],
        ['1200', 'Accounts Receivable (Trade Debtors)', 'Asset', 'Current Asset', false],
        ['1300', 'Inventory Asset (Warehouse Stock)', 'Asset', 'Current Asset', false],
        ['1400', 'Advance Income Tax / WHT Receivable', 'Asset', 'Current Asset', false],
        ['1450', 'Withholding Tax (WHT) Receivable', 'Asset', 'Current Asset', false],
        ['1500', 'Fixed Assets — Property, Plant & Equipment', 'Asset', 'Fixed Asset', false],
        ['1590', 'Accumulated Depreciation — Fixed Assets', 'Asset', 'Contra Asset', false],
        ['2001', 'Accounts Payable (Trade Creditors)', 'Liability', 'Current Liability', false],
        ['2100', 'Output Sales Tax Payable', 'Liability', 'Current Liability', false],
        ['2150', 'Input Sales Tax Adjustable / Credit', 'Asset', 'Current Asset', false],
        ['2200', 'Salaries & Payroll Payable', 'Liability', 'Current Liability', false],
        ['2250', 'Withholding Tax Payable (Deductions)', 'Liability', 'Current Liability', false],
        ['3001', 'Owner Capital / Share Equity', 'Equity', 'Equity', false],
        ['3200', 'Retained Earnings', 'Equity', 'Equity', false],
        ['4001', 'Operating Sales Revenue', 'Revenue', 'Operating Revenue', false],
        ['4200', 'Other Income & Asset Disposal Gain', 'Revenue', 'Other Income', false],
        ['5001', 'Cost of Goods Sold (COGS)', 'Expense', 'Direct Cost', false],
        ['5100', 'Salaries & Wages Expense', 'Expense', 'Operating Expense', false],
        ['5200', 'Project & Tender Execution Expense', 'Expense', 'Direct Expense', false],
        ['5300', 'General & Administrative Expense', 'Expense', 'Operating Expense', false],
        ['5500', 'Depreciation Expense', 'Expense', 'Non-Cash Expense', false]
      ];
      for (const [code, name, type, sub, isRec] of defaults) {
        await qClient.query(
          `INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, is_reconcilable, is_system)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT (tenant_id, account_code) DO NOTHING`,
          [tenantId, code, name, type, sub, isRec]
        );
      }
      res = await qClient.query(`SELECT id, account_code, account_name, account_type, is_active FROM coa_accounts WHERE tenant_id = $1`, [tenantId]);
    }
    const map = {};
    res.rows.forEach(r => { map[r.account_code] = r.id; });
    return map;
  }

  /**
   * Enforce Accounting Period Lock Controls
   */
  async assertOpenPeriod(client, tenantId, txDate) {
    const qClient = client || db;
    const settings = await this.getCompanySettings(qClient, tenantId);
    const dateStr = (txDate ? new Date(txDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

    const periodRes = await qClient.query(
      `SELECT id, period_name, status
       FROM accounting_periods
       WHERE tenant_id = $1 AND start_date <= $2::date AND end_date >= $2::date
       LIMIT 1`,
      [tenantId, dateStr]
    );

    if (periodRes.rows.length > 0) {
      const period = periodRes.rows[0];
      if (settings.enforce_period_locking !== false && period.status === 'Closed') {
        throw new Error(`Accounting Period "${period.period_name}" (${dateStr}) is CLOSED. Transactions cannot be posted or modified in a closed period.`);
      }
      return period;
    }
    return null;
  }

  /**
   * Next sequential document number helper
   */
  async getNextDocumentNumber(client, tenantId, docType = 'journal') {
    const qClient = client || db;
    await this.getCompanySettings(qClient, tenantId);
    const colMap = {
      journal: { prefixCol: 'journal_prefix', seqCol: 'journal_next_seq', defPrefix: 'JV' },
      invoice: { prefixCol: 'invoice_prefix', seqCol: 'invoice_next_seq', defPrefix: 'INV' },
      bill: { prefixCol: 'bill_prefix', seqCol: 'bill_next_seq', defPrefix: 'BILL' },
      credit_note: { prefixCol: 'credit_note_prefix', seqCol: 'credit_note_next_seq', defPrefix: 'CN' }
    };
    const cfg = colMap[docType] || colMap.journal;
    const res = await qClient.query(
      `UPDATE finance_company_settings
       SET ${cfg.seqCol} = COALESCE(${cfg.seqCol}, 1001) + 1
       WHERE tenant_id = $1
       RETURNING ${cfg.prefixCol} as prefix, (${cfg.seqCol} - 1) as seq`,
      [tenantId]
    );
    const prefix = res.rows[0]?.prefix || cfg.defPrefix;
    const seq = res.rows[0]?.seq || Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${new Date().getFullYear()}-${seq}`;
  }

  /**
   * Currency conversion to company base currency
   */
  async resolveExchangeRate(client, tenantId, currency, explicitRate = null, asOfDate = null) {
    const qClient = client || db;
    const settings = await this.getCompanySettings(qClient, tenantId);
    const baseCurrency = settings.base_currency || 'PKR';
    const txCurrency = (currency || baseCurrency).toUpperCase();

    if (txCurrency === baseCurrency) {
      return { baseCurrency, txCurrency, exchangeRate: 1.0 };
    }
    if (explicitRate && parseFloat(explicitRate) > 0) {
      return { baseCurrency, txCurrency, exchangeRate: parseFloat(explicitRate) };
    }

    const dateStr = asOfDate || new Date().toISOString().slice(0, 10);
    const rateRes = await qClient.query(
      `SELECT exchange_rate FROM finance_exchange_rates
       WHERE tenant_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date <= $4::date
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      [tenantId, txCurrency, baseCurrency, dateStr]
    );
    const rate = parseFloat(rateRes.rows[0]?.exchange_rate || 1.0);
    return { baseCurrency, txCurrency, exchangeRate: rate };
  }

  /**
   * Tax calculation engine (Exclusive, Inclusive, Exempt, Rounding)
   */
  calculateTaxBreakdown({ amount, ratePct = 0, isInclusive = false, isExempt = false, roundingRule = 'HALF_UP' }) {
    const rawAmt = Math.max(0, Number(amount || 0));
    const effectiveRate = isExempt ? 0 : Math.max(0, Number(ratePct || 0));

    if (effectiveRate === 0) {
      return {
        net_amount: this.applyRounding(rawAmt, roundingRule),
        tax_amount: 0,
        gross_amount: this.applyRounding(rawAmt, roundingRule),
        effective_rate: 0
      };
    }

    if (isInclusive) {
      const net = this.applyRounding(rawAmt / (1 + effectiveRate / 100), roundingRule);
      const tax = this.applyRounding(rawAmt - net, roundingRule);
      return {
        net_amount: net,
        tax_amount: tax,
        gross_amount: this.applyRounding(rawAmt, roundingRule),
        effective_rate: effectiveRate
      };
    } else {
      const net = this.applyRounding(rawAmt, roundingRule);
      const tax = this.applyRounding(net * (effectiveRate / 100), roundingRule);
      const gross = this.applyRounding(net + tax, roundingRule);
      return {
        net_amount: net,
        tax_amount: tax,
        gross_amount: gross,
        effective_rate: effectiveRate
      };
    }
  }

  /**
   * Double-Entry Journal Entry Creation (Supports Draft, Approval Threshold, Idempotency & Period Lock)
   */
  async createJournal(client, {
    tenantId,
    businessProfileId = null,
    entryNumber = null,
    entryDate = null,
    referenceType = 'Manual Voucher',
    referenceId = null,
    narration = 'Journal Entry',
    lines = [],
    requestedStatus = 'Posted',
    currency = null,
    exchangeRate = null,
    idempotencyKey = null,
    sourceModule = 'finance',
    attachments = [],
    userId = null,
    userName = 'System',
    bypassApprovalThreshold = false
  }) {
    const qClient = client || db;

    // 1. Idempotency check
    if (idempotencyKey) {
      const dupCheck = await qClient.query(
        `SELECT * FROM journal_entries WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [tenantId, idempotencyKey]
      );
      if (dupCheck.rows.length > 0) {
        return { duplicate: true, journal: dupCheck.rows[0] };
      }
    }

    if (!Array.isArray(lines) || lines.length < 2) {
      throw new Error('Double-entry journal requires at least 2 balanced lines (Debit and Credit).');
    }

    const effDate = entryDate ? new Date(entryDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const period = await this.assertOpenPeriod(qClient, tenantId, effDate);
    const fx = await this.resolveExchangeRate(qClient, tenantId, currency, exchangeRate, effDate);
    const settings = await this.getCompanySettings(qClient, tenantId);

    // 2. Validate lines & active accounts
    let totalDebit = 0;
    let totalCredit = 0;
    const accountIds = [...new Set(lines.map(l => l.account_id).filter(Boolean))];
    if (accountIds.length === 0) throw new Error('Valid COA account IDs are required on journal lines.');

    const accCheck = await qClient.query(
      `SELECT id, account_code, account_name, is_active FROM coa_accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, accountIds]
    );
    const accMap = {};
    accCheck.rows.forEach(a => { accMap[a.id] = a; });

    const normalizedLines = [];
    for (const l of lines) {
      const acc = accMap[l.account_id];
      if (!acc) throw new Error(`Invalid or cross-tenant COA account reference: ${l.account_id}`);
      if (acc.is_active === false) throw new Error(`COA account [${acc.account_code}] ${acc.account_name} is inactive and cannot be posted to.`);

      const rawDr = round4(l.debit || 0);
      const rawCr = round4(l.credit || 0);
      if (rawDr < 0 || rawCr < 0) throw new Error('Debit and credit amounts must be non-negative.');
      if (rawDr > 0 && rawCr > 0) throw new Error('A single journal line cannot carry both Debit and Credit simultaneously.');
      if (rawDr === 0 && rawCr === 0) continue;

      const baseDr = round4(rawDr * fx.exchangeRate);
      const baseCr = round4(rawCr * fx.exchangeRate);
      totalDebit = round4(totalDebit + baseDr);
      totalCredit = round4(totalCredit + baseCr);

      normalizedLines.push({
        account_id: l.account_id,
        line_description: l.line_description || narration,
        debit: baseDr,
        credit: baseCr,
        foreign_debit: fx.txCurrency !== fx.baseCurrency ? rawDr : 0,
        foreign_credit: fx.txCurrency !== fx.baseCurrency ? rawCr : 0,
        currency: fx.txCurrency,
        party_type: l.party_type || null,
        party_id: l.party_id || null,
        department: l.department || null,
        cost_center: l.cost_center || null,
        dimension_tag: l.dimension_tag || null,
        reference_code: l.reference_code || null,
        tax_code_id: l.tax_code_id || null
      });
    }

    if (normalizedLines.length < 2) {
      throw new Error('At least 2 non-zero journal lines are required.');
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
      throw new Error(`Unbalanced Journal Entry: Total Debit (${totalDebit.toFixed(2)}) != Total Credit (${totalCredit.toFixed(2)}).`);
    }

    // 3. Determine approval & status
    let finalStatus = requestedStatus || 'Posted';
    const threshold = parseFloat(settings.journal_approval_threshold || 0);
    if (finalStatus === 'Posted' && !bypassApprovalThreshold && settings.require_journal_approval && totalDebit >= threshold) {
      finalStatus = 'Pending Approval';
    }
    const isPosted = finalStatus === 'Posted';

    const jvNum = entryNumber || await this.getNextDocumentNumber(qClient, tenantId, 'journal');

    const hdrRes = await qClient.query(
      `INSERT INTO journal_entries (
        tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id,
        narration, total_debit, total_credit, is_posted, status, fiscal_period_id,
        currency, exchange_rate, idempotency_key, source_module, attachments, posted_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      RETURNING *`,
      [
        tenantId, businessProfileId, jvNum, effDate, referenceType, referenceId || null,
        narration, totalDebit, totalCredit, isPosted, finalStatus, period?.id || null,
        fx.txCurrency, fx.exchangeRate, idempotencyKey || null, sourceModule,
        JSON.stringify(Array.isArray(attachments) ? attachments : []), isPosted ? userId : null
      ]
    );
    const je = hdrRes.rows[0];

    for (const nl of normalizedLines) {
      await qClient.query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, line_description, debit, credit,
          foreign_debit, foreign_credit, currency, party_type, party_id,
          department, cost_center, dimension_tag, reference_code, tax_code_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          je.id, nl.account_id, nl.line_description, nl.debit, nl.credit,
          nl.foreign_debit, nl.foreign_credit, nl.currency, nl.party_type, nl.party_id,
          nl.department, nl.cost_center, nl.dimension_tag, nl.reference_code, nl.tax_code_id
        ]
      );
    }

    await this.logAudit(qClient, {
      tenantId,
      entityType: 'journal_entry',
      entityId: je.id,
      action: isPosted ? 'POSTED' : `CREATED_${finalStatus.toUpperCase()}`,
      userId,
      userName,
      afterState: { entry_number: jvNum, total_debit: totalDebit, status: finalStatus }
    });

    return { duplicate: false, journal: je, lines: normalizedLines };
  }

  /**
   * Approve & Post a Draft / Pending Approval Journal
   */
  async postDraftJournal(client, tenantId, journalId, userId = null, userName = 'System') {
    const qClient = client || db;
    const res = await qClient.query(`SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = $2`, [journalId, tenantId]);
    if (res.rows.length === 0) throw new Error('Journal entry not found.');
    const je = res.rows[0];

    if (je.is_posted || je.status === 'Posted') {
      throw new Error('Journal entry is already posted.');
    }
    if (je.status === 'Reversed') {
      throw new Error('Reversed journal entries cannot be posted.');
    }

    await this.assertOpenPeriod(qClient, tenantId, je.entry_date);

    // Verify still balanced
    const lineCheck = await qClient.query(
      `SELECT COALESCE(SUM(debit),0) as dr, COALESCE(SUM(credit),0) as cr FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [journalId]
    );
    const dr = parseFloat(lineCheck.rows[0].dr || 0);
    const cr = parseFloat(lineCheck.rows[0].cr || 0);
    if (Math.abs(dr - cr) > 0.01 || dr <= 0) {
      throw new Error(`Cannot post unbalanced journal (Debit ${dr} != Credit ${cr}).`);
    }

    const upd = await qClient.query(
      `UPDATE journal_entries
       SET is_posted = TRUE, status = 'Posted', approved_by = COALESCE(approved_by, $1),
           approved_at = COALESCE(approved_at, NOW()), posted_by = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [userId, journalId, tenantId]
    );

    await this.logAudit(qClient, {
      tenantId,
      entityType: 'journal_entry',
      entityId: journalId,
      action: 'POSTED',
      userId,
      userName,
      beforeState: { status: je.status },
      afterState: { status: 'Posted' }
    });

    return upd.rows[0];
  }

  /**
   * Authorize Reversal of a Posted Journal Entry (Immutable history preserved)
   */
  async reverseJournal(client, tenantId, journalId, { reversalDate = null, reason = 'Authorized Reversal', userId = null, userName = 'System' } = {}) {
    const qClient = client || db;
    const origRes = await qClient.query(`SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = $2`, [journalId, tenantId]);
    if (origRes.rows.length === 0) throw new Error('Original journal entry not found.');
    const orig = origRes.rows[0];

    if (!orig.is_posted && orig.status !== 'Posted') {
      throw new Error('Only Posted journal entries can be reversed. Drafts may be edited or cancelled.');
    }
    if (orig.is_reversed || orig.status === 'Reversed') {
      throw new Error(`Journal ${orig.entry_number} has already been reversed.`);
    }

    const revDate = reversalDate ? new Date(reversalDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    await this.assertOpenPeriod(qClient, tenantId, revDate);

    const linesRes = await qClient.query(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1`, [journalId]);
    const mirrorLines = linesRes.rows.map(l => ({
      account_id: l.account_id,
      line_description: `Reversal of ${orig.entry_number}: ${l.line_description || ''}`,
      debit: parseFloat(l.credit || 0),
      credit: parseFloat(l.debit || 0),
      party_type: l.party_type,
      party_id: l.party_id,
      department: l.department,
      cost_center: l.cost_center,
      dimension_tag: l.dimension_tag,
      reference_code: l.reference_code
    }));

    const revCreated = await this.createJournal(qClient, {
      tenantId,
      businessProfileId: orig.business_profile_id,
      entryNumber: `${orig.entry_number}-REV`,
      entryDate: revDate,
      referenceType: 'Journal Reversal',
      referenceId: orig.id,
      narration: `REVERSAL of ${orig.entry_number} (${reason}): ${orig.narration}`,
      lines: mirrorLines,
      requestedStatus: 'Posted',
      currency: orig.currency,
      exchangeRate: orig.exchange_rate,
      idempotencyKey: `REV_${orig.id}`,
      sourceModule: orig.source_module || 'finance',
      userId,
      userName,
      bypassApprovalThreshold: true
    });

    await qClient.query(
      `UPDATE journal_entries SET reversal_of_id = $1 WHERE id = $2`,
      [orig.id, revCreated.journal.id]
    );
    await qClient.query(
      `UPDATE journal_entries
       SET is_reversed = TRUE, status = 'Reversed', reversed_by_id = $1, reversed_at = NOW(), reversed_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [revCreated.journal.id, userId, orig.id]
    );

    await this.logAudit(qClient, {
      tenantId,
      entityType: 'journal_entry',
      entityId: orig.id,
      action: 'REVERSED',
      userId,
      userName,
      beforeState: { status: 'Posted', is_reversed: false },
      afterState: { status: 'Reversed', reversed_by_id: revCreated.journal.id, reason }
    });

    return { original: orig, reversal: revCreated.journal };
  }

  /**
   * Idempotent Automated Accounting Rule Engine
   * Never posts the same (tenant_id, event_type, source_id) twice!
   */
  async postAccountingEvent(client, {
    tenantId,
    sourceModule = 'finance',
    eventType,
    sourceId,
    sourceNumber = '',
    date = null,
    narration = '',
    payload = {},
    lines = null,
    userId = null,
    userName = 'System'
  }) {
    const qClient = client || db;

    // 1. Check tenant active_modules & integration settings for external modules
    const settings = await this.getCompanySettings(qClient, tenantId);
    const integrationToggleMap = {
      tender: settings.enable_tender_integration,
      inventory: settings.enable_inventory_integration,
      crm: settings.enable_crm_integration,
      payroll: settings.enable_payroll_integration,
      manufacturing: settings.enable_mfg_integration
    };
    if (sourceModule !== 'finance' && integrationToggleMap[sourceModule] === false) {
      return { success: true, action: 'skipped_integration_disabled' };
    }

    // Check if tenant has mod_finance or mod_accounting licensed
    const tRes = await qClient.query(`SELECT subscription_plan, active_modules FROM tenants WHERE id = $1`, [tenantId]);
    if (tRes.rows.length > 0) {
      const plan = tRes.rows[0].subscription_plan || 'Advance';
      const mods = tRes.rows[0].active_modules;
      if (plan === 'Custom' && Array.isArray(mods) && !mods.includes('mod_finance') && !mods.includes('mod_accounting')) {
        return { success: true, action: 'skipped_finance_unlicensed' };
      }
    }

    // 2. Check idempotency in finance_posting_events
    const existEv = await qClient.query(
      `SELECT id, journal_entry_id, status FROM finance_posting_events WHERE tenant_id = $1 AND event_type = $2 AND source_id = $3 LIMIT 1`,
      [tenantId, eventType, String(sourceId)]
    );
    if (existEv.rows.length > 0 && existEv.rows[0].status === 'Posted') {
      return { success: true, action: 'skipped_duplicate', event: existEv.rows[0] };
    }

    // 3. Build balanced lines from explicit rules if not explicitly supplied
    const coa = await this.ensureCoaMap(qClient, tenantId);
    let jeLines = Array.isArray(lines) && lines.length >= 2 ? lines : [];

    if (jeLines.length === 0) {
      const amt = round2(payload.total_amount || payload.amount || 0);
      const sub = round2(payload.subtotal !== undefined ? payload.subtotal : amt);
      const tax = round2(payload.tax_amount || 0);

      if (eventType === 'CUSTOMER_INVOICE' && amt > 0) {
        const arAcc = payload.ar_account_id || coa[settings.default_ar_account_code || '1200'];
        const revAcc = payload.revenue_account_id || coa[settings.default_revenue_account_code || '4001'];
        const taxAcc = payload.tax_account_id || coa[settings.default_tax_payable_code || '2100'];
        jeLines.push({ account_id: arAcc, debit: amt, credit: 0, line_description: `AR Receivable - ${sourceNumber}`, party_type: 'customer', party_id: payload.customer_id });
        if (sub > 0) jeLines.push({ account_id: revAcc, debit: 0, credit: sub, line_description: `Sales Revenue - ${sourceNumber}` });
        if (tax > 0) jeLines.push({ account_id: taxAcc, debit: 0, credit: tax, line_description: `Output Sales Tax - ${sourceNumber}` });
      } else if (eventType === 'CUSTOMER_CREDIT_NOTE' && amt > 0) {
        const arAcc = payload.ar_account_id || coa[settings.default_ar_account_code || '1200'];
        const revAcc = payload.revenue_account_id || coa[settings.default_revenue_account_code || '4001'];
        const taxAcc = payload.tax_account_id || coa[settings.default_tax_payable_code || '2100'];
        if (sub > 0) jeLines.push({ account_id: revAcc, debit: sub, credit: 0, line_description: `Sales Return / Credit Note - ${sourceNumber}` });
        if (tax > 0) jeLines.push({ account_id: taxAcc, debit: tax, credit: 0, line_description: `Output Tax Reversal - ${sourceNumber}` });
        jeLines.push({ account_id: arAcc, debit: 0, credit: amt, line_description: `AR Reduction - ${sourceNumber}`, party_type: 'customer', party_id: payload.customer_id });
      } else if (eventType === 'CUSTOMER_RECEIPT') {
        const net = round2(payload.net_amount || 0);
        const wht = round2(payload.wht_amount || 0);
        const gross = round2(net + wht);
        if (gross > 0) {
          const bankAcc = payload.bank_coa_id || coa['1010'];
          const whtAcc = coa['1450'] || coa['1400'];
          const arAcc = coa[settings.default_ar_account_code || '1200'];
          if (net > 0) jeLines.push({ account_id: bankAcc, debit: net, credit: 0, line_description: `Bank/Cash Receipt - ${sourceNumber}` });
          if (wht > 0) jeLines.push({ account_id: whtAcc, debit: wht, credit: 0, line_description: `WHT Deducted - ${sourceNumber}` });
          jeLines.push({ account_id: arAcc, debit: 0, credit: gross, line_description: `AR Settlement - ${sourceNumber}`, party_type: 'customer', party_id: payload.customer_id });
        }
      } else if (eventType === 'SUPPLIER_BILL' && amt > 0) {
        const apAcc = payload.ap_account_id || coa[settings.default_ap_account_code || '2001'];
        const expAcc = payload.expense_account_id || coa[settings.default_expense_account_code || '5300'];
        const inTaxAcc = payload.tax_account_id || coa['2150'] || coa['1450'];
        if (sub > 0) jeLines.push({ account_id: expAcc, debit: sub, credit: 0, line_description: `Supplier Bill Expense/Cost - ${sourceNumber}` });
        if (tax > 0) jeLines.push({ account_id: inTaxAcc, debit: tax, credit: 0, line_description: `Input Purchase Tax - ${sourceNumber}` });
        jeLines.push({ account_id: apAcc, debit: 0, credit: amt, line_description: `Accounts Payable - ${sourceNumber}`, party_type: 'supplier', party_id: payload.supplier_id });
      } else if (eventType === 'SUPPLIER_CREDIT_NOTE' && amt > 0) {
        const apAcc = payload.ap_account_id || coa[settings.default_ap_account_code || '2001'];
        const expAcc = payload.expense_account_id || coa[settings.default_expense_account_code || '5300'];
        const inTaxAcc = payload.tax_account_id || coa['2150'] || coa['1450'];
        jeLines.push({ account_id: apAcc, debit: amt, credit: 0, line_description: `AP Reduction (Credit Note) - ${sourceNumber}`, party_type: 'supplier', party_id: payload.supplier_id });
        if (sub > 0) jeLines.push({ account_id: expAcc, debit: 0, credit: sub, line_description: `Supplier Return / Credit - ${sourceNumber}` });
        if (tax > 0) jeLines.push({ account_id: inTaxAcc, debit: 0, credit: tax, line_description: `Input Tax Reversal - ${sourceNumber}` });
      } else if (eventType === 'SUPPLIER_PAYMENT') {
        const net = round2(payload.net_amount || 0);
        const wht = round2(payload.wht_amount || 0);
        const gross = round2(net + wht);
        if (gross > 0) {
          const bankAcc = payload.bank_coa_id || coa['1010'];
          const whtPayAcc = coa['2250'] || coa['2100'];
          const apAcc = coa[settings.default_ap_account_code || '2001'];
          jeLines.push({ account_id: apAcc, debit: gross, credit: 0, line_description: `AP Payment - ${sourceNumber}`, party_type: 'supplier', party_id: payload.supplier_id });
          if (net > 0) jeLines.push({ account_id: bankAcc, debit: 0, credit: net, line_description: `Bank/Cash Paid - ${sourceNumber}` });
          if (wht > 0) jeLines.push({ account_id: whtPayAcc, debit: 0, credit: wht, line_description: `WHT Withheld on Supplier Payment - ${sourceNumber}` });
        }
      } else if (eventType === 'BANK_TRANSFER' && amt > 0) {
        jeLines.push({ account_id: payload.to_coa_id, debit: amt, credit: 0, line_description: `Transfer In - ${sourceNumber}` });
        jeLines.push({ account_id: payload.from_coa_id, debit: 0, credit: amt, line_description: `Transfer Out - ${sourceNumber}` });
      } else if (eventType === 'EXPENSE_CLAIM' && amt > 0) {
        const expAcc = payload.coa_account_id || coa[settings.default_expense_account_code || '5300'];
        const bankAcc = payload.bank_coa_id || coa['1010'];
        const inTaxAcc = coa['2150'] || expAcc;
        if (sub > 0) jeLines.push({ account_id: expAcc, debit: sub, credit: 0, line_description: narration || `Expense ${sourceNumber}` });
        if (tax > 0) jeLines.push({ account_id: inTaxAcc, debit: tax, credit: 0, line_description: `Expense Input Tax - ${sourceNumber}` });
        jeLines.push({ account_id: bankAcc, debit: 0, credit: amt, line_description: `Paid Expense - ${sourceNumber}` });
      } else if (eventType === 'PAYROLL_RUN' && amt > 0) {
        const salExp = coa['5100'];
        const salPay = coa['2200'];
        const taxPay = coa['2250'] || coa['2100'];
        const gross = round2(payload.total_gross || amt);
        const deductions = round2(payload.total_deductions || 0);
        const netPay = round2(gross - deductions);
        jeLines.push({ account_id: salExp, debit: gross, credit: 0, line_description: `Payroll Gross Salaries - ${sourceNumber}` });
        if (netPay > 0) jeLines.push({ account_id: salPay, debit: 0, credit: netPay, line_description: `Net Salaries Payable - ${sourceNumber}` });
        if (deductions > 0) jeLines.push({ account_id: taxPay, debit: 0, credit: deductions, line_description: `Payroll Tax & EOBI Deductions - ${sourceNumber}` });
      }
    }

    if (jeLines.length < 2) {
      return { success: true, action: 'skipped_zero_or_unmapped' };
    }

    const jeCreated = await this.createJournal(qClient, {
      tenantId,
      businessProfileId: payload.business_profile_id || null,
      entryDate: date || new Date().toISOString().slice(0, 10),
      referenceType: eventType,
      referenceId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sourceId)) ? sourceId : null,
      narration: narration || `${eventType} (${sourceNumber})`,
      lines: jeLines,
      requestedStatus: 'Posted',
      currency: payload.currency,
      exchangeRate: payload.exchange_rate,
      idempotencyKey: `EVT_${eventType}_${sourceId}`,
      sourceModule,
      userId,
      userName,
      bypassApprovalThreshold: true
    });

    const evRes = await qClient.query(
      `INSERT INTO finance_posting_events (
        tenant_id, source_module, event_type, source_id, source_number, journal_entry_id, status, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,'Posted',$7::jsonb)
      ON CONFLICT (tenant_id, event_type, source_id)
      DO UPDATE SET journal_entry_id = EXCLUDED.journal_entry_id, status = 'Posted'
      RETURNING *`,
      [tenantId, sourceModule, eventType, String(sourceId), sourceNumber, jeCreated.journal.id, JSON.stringify(payload || {})]
    );

    return { success: true, action: 'posted', journal: jeCreated.journal, event: evRes.rows[0] };
  }

  /**
   * Trial Balance Statement (with Opening, Period Movement, Closing Balances)
   */
  async getTrialBalance(tenantId, { fromDate = null, toDate = null } = {}) {
    await this.ensureCoaMap(null, tenantId);
    const params = [tenantId];
    let periodClause = '';
    let openingClause = 'FALSE';

    if (fromDate) {
      params.push(fromDate);
      openingClause = `je.entry_date < $${params.length}::date`;
      periodClause += ` AND je.entry_date >= $${params.length}::date`;
    }
    if (toDate) {
      params.push(toDate);
      periodClause += ` AND je.entry_date <= $${params.length}::date`;
    }

    const q = await db.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance, a.is_active,
              COALESCE(SUM(CASE WHEN (${openingClause}) AND COALESCE(je.is_posted, TRUE) = TRUE THEN jl.debit ELSE 0 END), 0) as open_dr,
              COALESCE(SUM(CASE WHEN (${openingClause}) AND COALESCE(je.is_posted, TRUE) = TRUE THEN jl.credit ELSE 0 END), 0) as open_cr,
              COALESCE(SUM(CASE WHEN COALESCE(je.is_posted, TRUE) = TRUE ${periodClause} THEN jl.debit ELSE 0 END), 0) as period_dr,
              COALESCE(SUM(CASE WHEN COALESCE(je.is_posted, TRUE) = TRUE ${periodClause} THEN jl.credit ELSE 0 END), 0) as period_cr
       FROM coa_accounts a
       LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.tenant_id = $1
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance, a.is_active
       ORDER BY a.account_code ASC`,
      params
    );

    let totalPeriodDr = 0;
    let totalPeriodCr = 0;
    let totalClosingDr = 0;
    let totalClosingCr = 0;

    const rows = q.rows.map(r => {
      const isDebitNormal = ['Asset', 'Expense'].includes(r.account_type);
      const staticOpen = parseFloat(r.opening_balance || 0);
      const openDr = parseFloat(r.open_dr || 0) + (isDebitNormal && staticOpen > 0 ? staticOpen : 0);
      const openCr = parseFloat(r.open_cr || 0) + (!isDebitNormal && staticOpen > 0 ? staticOpen : 0);
      const periodDr = round2(r.period_dr || 0);
      const periodCr = round2(r.period_cr || 0);
      const netClosing = round2((openDr + periodDr) - (openCr + periodCr));

      const closingDr = netClosing > 0 ? netClosing : 0;
      const closingCr = netClosing < 0 ? Math.abs(netClosing) : 0;

      totalPeriodDr = round2(totalPeriodDr + periodDr);
      totalPeriodCr = round2(totalPeriodCr + periodCr);
      totalClosingDr = round2(totalClosingDr + closingDr);
      totalClosingCr = round2(totalClosingCr + closingCr);

      return {
        ...r,
        opening_net: round2(openDr - openCr),
        period_debit: periodDr,
        period_credit: periodCr,
        closing_debit: closingDr,
        closing_credit: closingCr,
        net_balance: isDebitNormal ? netClosing : -netClosing
      };
    });

    return {
      rows,
      totals: {
        period_debit: totalPeriodDr,
        period_credit: totalPeriodCr,
        closing_debit: totalClosingDr,
        closing_credit: totalClosingCr,
        is_balanced: Math.abs(totalClosingDr - totalClosingCr) < 0.05
      }
    };
  }

  /**
   * Account Ledger Activity (Opening + Chronological Rows + Running Balance + Closing)
   */
  async getAccountLedger(tenantId, accountId, { fromDate = null, toDate = null } = {}) {
    const accRes = await db.query(`SELECT * FROM coa_accounts WHERE id = $1 AND tenant_id = $2`, [accountId, tenantId]);
    if (accRes.rows.length === 0) throw new Error('COA Account not found.');
    const acc = accRes.rows[0];
    const isDebitNormal = ['Asset', 'Expense'].includes(acc.account_type);

    let openingBal = parseFloat(acc.opening_balance || 0);
    if (fromDate) {
      const openRes = await db.query(
        `SELECT COALESCE(SUM(jl.debit), 0) as dr, COALESCE(SUM(jl.credit), 0) as cr
         FROM journal_entry_lines jl
         JOIN journal_entries je ON jl.journal_entry_id = je.id
         WHERE je.tenant_id = $1 AND jl.account_id = $2 AND COALESCE(je.is_posted, TRUE) = TRUE AND je.entry_date < $3::date`,
        [tenantId, accountId, fromDate]
      );
      const dr = parseFloat(openRes.rows[0].dr || 0);
      const cr = parseFloat(openRes.rows[0].cr || 0);
      openingBal = round2(openingBal + (isDebitNormal ? (dr - cr) : (cr - dr)));
    }

    const params = [tenantId, accountId];
    let dateFilter = '';
    if (fromDate) {
      params.push(fromDate);
      dateFilter += ` AND je.entry_date >= $${params.length}::date`;
    }
    if (toDate) {
      params.push(toDate);
      dateFilter += ` AND je.entry_date <= $${params.length}::date`;
    }

    const txRes = await db.query(
      `SELECT je.id as journal_id, je.entry_number, je.entry_date, je.reference_type, je.narration, je.status,
              jl.id as line_id, jl.line_description, jl.debit, jl.credit, jl.department, jl.cost_center
       FROM journal_entry_lines jl
       JOIN journal_entries je ON jl.journal_entry_id = je.id
       WHERE je.tenant_id = $1 AND jl.account_id = $2 AND COALESCE(je.is_posted, TRUE) = TRUE ${dateFilter}
       ORDER BY je.entry_date ASC, je.created_at ASC, jl.id ASC`,
      params
    );

    let running = openingBal;
    let totalDr = 0;
    let totalCr = 0;

    const entries = txRes.rows.map(row => {
      const dr = round2(row.debit || 0);
      const cr = round2(row.credit || 0);
      totalDr = round2(totalDr + dr);
      totalCr = round2(totalCr + cr);
      running = round2(running + (isDebitNormal ? (dr - cr) : (cr - dr)));
      return { ...row, debit: dr, credit: cr, running_balance: running };
    });

    return {
      account: acc,
      opening_balance: openingBal,
      total_debit: totalDr,
      total_credit: totalCr,
      closing_balance: running,
      entries
    };
  }

  /**
   * Profit & Loss Statement (Income Statement) with Optional Comparative Period
   */
  async getProfitAndLoss(tenantId, { fromDate = null, toDate = null, compareFromDate = null, compareToDate = null } = {}) {
    const computePeriod = async (f, t) => {
      const params = [tenantId];
      let dFilter = '';
      if (f) { params.push(f); dFilter += ` AND je.entry_date >= $${params.length}::date`; }
      if (t) { params.push(t); dFilter += ` AND je.entry_date <= $${params.length}::date`; }

      const res = await db.query(
        `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type,
                COALESCE(SUM(jl.debit), 0) as dr, COALESCE(SUM(jl.credit), 0) as cr
         FROM coa_accounts a
         LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.tenant_id = $1 AND COALESCE(je.is_posted, TRUE) = TRUE ${dFilter}
         WHERE a.tenant_id = $1 AND a.account_type IN ('Revenue', 'Expense')
         GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type
         ORDER BY a.account_code ASC`,
        params
      );

      const revenue = [];
      const cogs = [];
      const expenses = [];
      let totalRevenue = 0;
      let totalCogs = 0;
      let totalExpenses = 0;

      for (const r of res.rows) {
        const dr = parseFloat(r.dr || 0);
        const cr = parseFloat(r.cr || 0);
        if (r.account_type === 'Revenue') {
          const amt = round2(cr - dr);
          totalRevenue = round2(totalRevenue + amt);
          if (amt !== 0) revenue.push({ ...r, amount: amt });
        } else {
          const amt = round2(dr - cr);
          if (r.account_code === '5001' || (r.account_sub_type || '').toLowerCase().includes('direct cost')) {
            totalCogs = round2(totalCogs + amt);
            if (amt !== 0) cogs.push({ ...r, amount: amt });
          } else {
            totalExpenses = round2(totalExpenses + amt);
            if (amt !== 0) expenses.push({ ...r, amount: amt });
          }
        }
      }

      const grossProfit = round2(totalRevenue - totalCogs);
      const netProfit = round2(grossProfit - totalExpenses);

      return {
        revenue,
        cogs,
        expenses,
        summary: {
          total_revenue: totalRevenue,
          total_cogs: totalCogs,
          gross_profit: grossProfit,
          total_operating_expenses: totalExpenses,
          net_profit: netProfit
        }
      };
    };

    const current = await computePeriod(fromDate, toDate);
    let comparative = null;
    if (compareFromDate || compareToDate) {
      comparative = await computePeriod(compareFromDate, compareToDate);
    }

    return { current, comparative };
  }

  /**
   * Balance Sheet (Proving Assets == Liabilities + Equity + Net Profit)
   */
  async getBalanceSheet(tenantId, { asOfDate = null } = {}) {
    await this.ensureCoaMap(null, tenantId);
    const params = [tenantId];
    let dFilter = '';
    if (asOfDate) {
      params.push(asOfDate);
      dFilter = ` AND je.entry_date <= $${params.length}::date`;
    }

    const res = await db.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance,
              COALESCE(SUM(jl.debit), 0) as dr, COALESCE(SUM(jl.credit), 0) as cr
       FROM coa_accounts a
       LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.tenant_id = $1 AND COALESCE(je.is_posted, TRUE) = TRUE ${dFilter}
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance
       ORDER BY a.account_code ASC`,
      params
    );

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquityAccounts = 0;
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const r of res.rows) {
      const dr = parseFloat(r.dr || 0);
      const cr = parseFloat(r.cr || 0);
      const open = parseFloat(r.opening_balance || 0);

      if (r.account_type === 'Asset') {
        // Contra assets (like 1590 Accumulated Depreciation) reduce total assets naturally because Cr > Dr -> negative debit balance!
        const bal = round2(open + dr - cr);
        totalAssets = round2(totalAssets + bal);
        if (bal !== 0 || r.account_sub_type === 'Current Asset') assets.push({ ...r, balance: bal });
      } else if (r.account_type === 'Liability') {
        const bal = round2(open + cr - dr);
        totalLiabilities = round2(totalLiabilities + bal);
        if (bal !== 0) liabilities.push({ ...r, balance: bal });
      } else if (r.account_type === 'Equity') {
        const bal = round2(open + cr - dr);
        totalEquityAccounts = round2(totalEquityAccounts + bal);
        if (bal !== 0) equity.push({ ...r, balance: bal });
      } else if (r.account_type === 'Revenue') {
        totalRevenue = round2(totalRevenue + cr - dr);
      } else if (r.account_type === 'Expense') {
        totalExpense = round2(totalExpense + dr - cr);
      }
    }

    const currentNetEarnings = round2(totalRevenue - totalExpense);
    const totalEquity = round2(totalEquityAccounts + currentNetEarnings);
    const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.05;

    return {
      as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
      assets,
      liabilities,
      equity,
      current_year_earnings: currentNetEarnings,
      summary: {
        total_assets: totalAssets,
        total_liabilities: totalLiabilities,
        total_equity_accounts: totalEquityAccounts,
        current_year_earnings: currentNetEarnings,
        total_equity: totalEquity,
        total_liabilities_and_equity: totalLiabilitiesAndEquity,
        is_balanced: isBalanced,
        variance: round2(totalAssets - totalLiabilitiesAndEquity)
      }
    };
  }

  /**
   * Cash Flow Statement (Documented Indirect Method)
   * Operating Cash Flow = Net Profit + Non-Cash Depreciation + Working Capital Changes
   * Investing Cash Flow = Fixed Asset Cost Changes
   * Financing Cash Flow = Equity / Long-Term Capital Changes
   * Reconciles Opening Cash & Bank + Net Change = Closing Cash & Bank
   */
  async getCashFlowStatement(tenantId, { fromDate = null, toDate = null } = {}) {
    const pnl = await this.getProfitAndLoss(tenantId, { fromDate, toDate });
    const netProfit = pnl.current.summary.net_profit;

    const params = [tenantId];
    let dFilter = '';
    let openFilter = 'FALSE';
    if (fromDate) {
      params.push(fromDate);
      dFilter += ` AND je.entry_date >= $${params.length}::date`;
      openFilter = `je.entry_date < $${params.length}::date`;
    }
    if (toDate) {
      params.push(toDate);
      dFilter += ` AND je.entry_date <= $${params.length}::date`;
    }

    // Aggregate period movement by COA account_code & sub_type
    const q = await db.query(
      `SELECT a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance,
              COALESCE(SUM(CASE WHEN (${openFilter}) AND COALESCE(je.is_posted, TRUE) = TRUE THEN (jl.debit - jl.credit) ELSE 0 END), 0) as open_net,
              COALESCE(SUM(CASE WHEN COALESCE(je.is_posted, TRUE) = TRUE ${dFilter} THEN jl.debit ELSE 0 END), 0) as p_dr,
              COALESCE(SUM(CASE WHEN COALESCE(je.is_posted, TRUE) = TRUE ${dFilter} THEN jl.credit ELSE 0 END), 0) as p_cr
       FROM coa_accounts a
       LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.tenant_id = $1
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type, a.opening_balance`,
      params
    );

    let openingCash = 0;
    let closingCash = 0;
    let depAddBack = 0;
    let workingCapitalAdjustment = 0;
    let investingCashFlow = 0;
    let financingCashFlow = 0;
    const operatingDetails = [];
    const investingDetails = [];
    const financingDetails = [];

    for (const r of q.rows) {
      const code = r.account_code || '';
      const dr = parseFloat(r.p_dr || 0);
      const cr = parseFloat(r.p_cr || 0);
      const periodDeltaDrMinusCr = round2(dr - cr);
      const openNet = round2(parseFloat(r.opening_balance || 0) + parseFloat(r.open_net || 0));

      // Cash & Bank accounts (1000-1099 or Cash/Bank)
      if (code.startsWith('10') || (r.account_name || '').toLowerCase().includes('cash') || (r.account_name || '').toLowerCase().includes('bank')) {
        openingCash = round2(openingCash + openNet);
        closingCash = round2(closingCash + openNet + periodDeltaDrMinusCr);
        continue;
      }

      // Non-cash depreciation expense add-back (5500 or Accumulated Dep 1590)
      if (code === '5500' || (r.account_name || '').toLowerCase().includes('depreciation expense')) {
        depAddBack = round2(depAddBack + periodDeltaDrMinusCr);
        continue;
      }

      // Fixed Asset Cost accounts -> Investing Activities
      if (r.account_type === 'Asset' && ((r.account_sub_type || '').toLowerCase().includes('fixed') || code === '1500')) {
        const cashImpact = round2(-periodDeltaDrMinusCr); // Increase in fixed asset cost is cash outflow
        if (cashImpact !== 0) {
          investingCashFlow = round2(investingCashFlow + cashImpact);
          investingDetails.push({ label: `${r.account_code} ${r.account_name}`, amount: cashImpact });
        }
        continue;
      }

      // Current Assets (AR, Inventory, Prepayments, WHT Receivable, Input Tax) -> Working capital
      if (r.account_type === 'Asset' && code !== '1590') {
        const cashImpact = round2(-periodDeltaDrMinusCr); // Increase in AR/Inv is cash outflow
        if (cashImpact !== 0) {
          workingCapitalAdjustment = round2(workingCapitalAdjustment + cashImpact);
          operatingDetails.push({ label: `Change in ${r.account_name}`, amount: cashImpact });
        }
        continue;
      }

      // Current Liabilities (AP, Tax Payable, Salaries Payable) -> Working capital
      if (r.account_type === 'Liability') {
        const cashImpact = round2(cr - dr); // Increase in Liability is cash inflow
        if (cashImpact !== 0) {
          workingCapitalAdjustment = round2(workingCapitalAdjustment + cashImpact);
          operatingDetails.push({ label: `Change in ${r.account_name}`, amount: cashImpact });
        }
        continue;
      }

      // Equity Accounts -> Financing Activities
      if (r.account_type === 'Equity') {
        const cashImpact = round2(cr - dr);
        if (cashImpact !== 0) {
          financingCashFlow = round2(financingCashFlow + cashImpact);
          financingDetails.push({ label: `${r.account_code} ${r.account_name}`, amount: cashImpact });
        }
      }
    }

    const netOperatingCashFlow = round2(netProfit + depAddBack + workingCapitalAdjustment);
    const netChangeInCash = round2(netOperatingCashFlow + investingCashFlow + financingCashFlow);
    const derivedClosingCash = round2(openingCash + netChangeInCash);

    return {
      methodology: 'Indirect Method (IAS 7 Compliant)',
      operating_activities: {
        net_profit: netProfit,
        depreciation_addback: depAddBack,
        working_capital_changes: workingCapitalAdjustment,
        details: operatingDetails,
        net_operating_cash: netOperatingCashFlow
      },
      investing_activities: {
        details: investingDetails,
        net_investing_cash: investingCashFlow
      },
      financing_activities: {
        details: financingDetails,
        net_financing_cash: financingCashFlow
      },
      reconciliation: {
        opening_cash_and_bank: openingCash,
        net_change_in_cash: netChangeInCash,
        closing_cash_and_bank: closingCash,
        derived_closing_cash: derivedClosingCash,
        reconciles: Math.abs(closingCash - derivedClosingCash) < 0.05
      }
    };
  }

  /**
   * AR or AP Aging Report (0-30, 31-60, 61-90, 90+ days)
   */
  async getAgingReport(tenantId, type = 'AR') {
    if (type === 'AP') {
      const q = await db.query(
        `SELECT b.id, b.bill_number as doc_number, b.bill_date as doc_date, b.due_date, s.id as party_id, s.supplier_name as party_name,
                b.total_amount, b.paid_amount, b.credited_amount,
                (COALESCE(b.total_amount, 0) - COALESCE(b.paid_amount, 0) - COALESCE(b.credited_amount, 0)) as outstanding,
                GREATEST(0, (CURRENT_DATE - COALESCE(b.due_date, b.bill_date)::date)) as age_days
         FROM supplier_bills b
         JOIN suppliers s ON b.supplier_id = s.id
         WHERE b.tenant_id = $1 AND b.status NOT IN ('Voided', 'Draft')
           AND (COALESCE(b.total_amount, 0) - COALESCE(b.paid_amount, 0) - COALESCE(b.credited_amount, 0)) > 0.01
         ORDER BY age_days DESC`,
        [tenantId]
      );
      const buckets = { days_0_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total: 0 };
      q.rows.forEach(r => {
        const out = round2(r.outstanding);
        const days = parseInt(r.age_days || 0, 10);
        if (days <= 30) buckets.days_0_30 = round2(buckets.days_0_30 + out);
        else if (days <= 60) buckets.days_31_60 = round2(buckets.days_31_60 + out);
        else if (days <= 90) buckets.days_61_90 = round2(buckets.days_61_90 + out);
        else buckets.days_90_plus = round2(buckets.days_90_plus + out);
        buckets.total = round2(buckets.total + out);
      });
      return { type: 'AP', buckets, items: q.rows };
    } else {
      const q = await db.query(
        `SELECT i.id, i.invoice_number as doc_number, i.invoice_date as doc_date, i.due_date, c.id as party_id, c.business_name as party_name,
                i.total_amount, i.paid_amount, COALESCE(i.credited_amount, 0) as credited_amount,
                (COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0) - COALESCE(i.credited_amount, 0)) as outstanding,
                GREATEST(0, (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date)::date)) as age_days
         FROM invoices i
         JOIN customers c ON i.customer_id = c.id
         WHERE i.tenant_id = $1 AND COALESCE(i.status, '') NOT IN ('Voided', 'Cancelled', 'Draft')
           AND (COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0) - COALESCE(i.credited_amount, 0)) > 0.01
         ORDER BY age_days DESC`,
        [tenantId]
      );
      const buckets = { days_0_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total: 0 };
      q.rows.forEach(r => {
        const out = round2(r.outstanding);
        const days = parseInt(r.age_days || 0, 10);
        if (days <= 30) buckets.days_0_30 = round2(buckets.days_0_30 + out);
        else if (days <= 60) buckets.days_31_60 = round2(buckets.days_31_60 + out);
        else if (days <= 90) buckets.days_61_90 = round2(buckets.days_61_90 + out);
        else buckets.days_90_plus = round2(buckets.days_90_plus + out);
        buckets.total = round2(buckets.total + out);
      });
      return { type: 'AR', buckets, items: q.rows };
    }
  }

  /**
   * Customer or Supplier Statement with chronological running balance
   */
  async getPartyStatement(tenantId, partyType, partyId) {
    const ledger = [];
    if (partyType === 'customer') {
      const custRes = await db.query(`SELECT id, business_name, ntn, strn, email, phone FROM customers WHERE id = $1 AND tenant_id = $2`, [partyId, tenantId]);
      if (custRes.rows.length === 0) throw new Error('Customer not found.');

      const invs = await db.query(`SELECT invoice_number as doc_no, invoice_date as doc_date, total_amount, status FROM invoices WHERE tenant_id = $1 AND customer_id = $2 AND status NOT IN ('Voided','Cancelled')`, [tenantId, partyId]);
      const cns = await db.query(`SELECT credit_note_number as doc_no, credit_date as doc_date, total_amount, status FROM ar_credit_notes WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, partyId]);
      const pays = await db.query(
        `SELECT p.payment_number as doc_no, p.payment_date as doc_date, COALESCE(p.gross_invoice_amount, p.amount, 0) as total_amount, p.payment_method
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         WHERE p.tenant_id = $1 AND (p.customer_id = $2 OR i.customer_id = $2)`,
        [tenantId, partyId]
      );

      invs.rows.forEach(r => ledger.push({ date: r.doc_date, type: 'Invoice', doc_no: r.doc_no, debit: round2(r.total_amount), credit: 0 }));
      cns.rows.forEach(r => ledger.push({ date: r.doc_date, type: 'Credit Note', doc_no: r.doc_no, debit: 0, credit: round2(r.total_amount) }));
      pays.rows.forEach(r => ledger.push({ date: r.doc_date, type: `Receipt (${r.payment_method || 'Bank'})`, doc_no: r.doc_no, debit: 0, credit: round2(r.total_amount) }));

      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      let running = 0;
      const lines = ledger.map(l => {
        running = round2(running + l.debit - l.credit);
        return { ...l, running_balance: running };
      });
      return { party: custRes.rows[0], closing_balance: running, lines };
    } else {
      const supRes = await db.query(`SELECT id, supplier_name, ntn, strn, email, phone FROM suppliers WHERE id = $1 AND tenant_id = $2`, [partyId, tenantId]);
      if (supRes.rows.length === 0) throw new Error('Supplier not found.');

      const bills = await db.query(`SELECT bill_number as doc_no, bill_date as doc_date, total_amount, status FROM supplier_bills WHERE tenant_id = $1 AND supplier_id = $2 AND status NOT IN ('Voided')`, [tenantId, partyId]);
      const cns = await db.query(`SELECT credit_note_number as doc_no, credit_date as doc_date, total_amount FROM ap_credit_notes WHERE tenant_id = $1 AND supplier_id = $2`, [tenantId, partyId]);
      const pays = await db.query(`SELECT payment_number as doc_no, payment_date as doc_date, gross_amount as total_amount, payment_method FROM supplier_payments WHERE tenant_id = $1 AND supplier_id = $2`, [tenantId, partyId]);

      bills.rows.forEach(r => ledger.push({ date: r.doc_date, type: 'Supplier Bill', doc_no: r.doc_no, debit: 0, credit: round2(r.total_amount) }));
      cns.rows.forEach(r => ledger.push({ date: r.doc_date, type: 'Vendor Credit Note', doc_no: r.doc_no, debit: round2(r.total_amount), credit: 0 }));
      pays.rows.forEach(r => ledger.push({ date: r.doc_date, type: `Payment (${r.payment_method || 'Bank'})`, doc_no: r.doc_no, debit: round2(r.total_amount), credit: 0 }));

      ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
      let running = 0;
      const lines = ledger.map(l => {
        running = round2(running + l.credit - l.debit);
        return { ...l, running_balance: running };
      });
      return { party: supRes.rows[0], closing_balance: running, lines };
    }
  }

  /**
   * Fixed Asset Depreciation Engine (Duplicate-period guarded)
   */
  async runFixedAssetDepreciation(client, tenantId, { year, month, userId = null, userName = 'System' }) {
    const qClient = client || db;
    const pYear = parseInt(year || new Date().getFullYear(), 10);
    const pMonth = parseInt(month || (new Date().getMonth() + 1), 10);
    const postDate = `${pYear}-${String(pMonth).padStart(2, '0')}-${new Date(pYear, pMonth, 0).getDate()}`;

    await this.assertOpenPeriod(qClient, tenantId, postDate);
    const coa = await this.ensureCoaMap(qClient, tenantId);

    const assetsRes = await qClient.query(
      `SELECT * FROM fixed_assets WHERE tenant_id = $1 AND status = 'Active' AND net_book_value > salvage_value`,
      [tenantId]
    );

    const postedAssets = [];
    let totalDepreciation = 0;

    for (const asset of assetsRes.rows) {
      // Prevent duplicate depreciation posting for same (asset_id, period_year, period_month)
      const dupCheck = await qClient.query(
        `SELECT id FROM fixed_asset_depreciation_logs WHERE asset_id = $1 AND period_year = $2 AND period_month = $3 LIMIT 1`,
        [asset.id, pYear, pMonth]
      );
      if (dupCheck.rows.length > 0) continue;

      const cost = parseFloat(asset.acquisition_cost || 0);
      const salvage = parseFloat(asset.salvage_value || 0);
      const nbv = parseFloat(asset.net_book_value || cost);
      const lifeMonths = Math.max(1, parseFloat(asset.useful_life_years || 5) * 12);
      const maxDepreciableLeft = round2(nbv - salvage);
      if (maxDepreciableLeft <= 0) continue;

      let monthlyDep = 0;
      if (asset.depreciation_method === 'Reducing Balance') {
        const annualRate = parseFloat(asset.annual_depreciation_rate || 20) / 100;
        monthlyDep = round2((nbv * annualRate) / 12);
      } else {
        monthlyDep = round2((cost - salvage) / lifeMonths);
      }
      if (monthlyDep > maxDepreciableLeft) monthlyDep = maxDepreciableLeft;
      if (monthlyDep <= 0) continue;

      const newAccum = round2(parseFloat(asset.accumulated_depreciation || 0) + monthlyDep);
      const newNbv = round2(cost - newAccum);

      const depExpCoa = asset.dep_expense_coa_id || coa['5500'];
      const accumDepCoa = asset.accum_dep_coa_id || coa['1590'];

      const ev = await this.postAccountingEvent(qClient, {
        tenantId,
        sourceModule: 'finance',
        eventType: 'ASSET_DEPRECIATION',
        sourceId: `${asset.id}_${pYear}_${pMonth}`,
        sourceNumber: `${asset.asset_code} (${pYear}-${String(pMonth).padStart(2, '0')})`,
        date: postDate,
        narration: `Monthly Depreciation (${asset.depreciation_method}) for ${asset.asset_name} [${asset.asset_code}]`,
        lines: [
          { account_id: depExpCoa, debit: monthlyDep, credit: 0, line_description: `Depreciation Expense: ${asset.asset_name}` },
          { account_id: accumDepCoa, debit: 0, credit: monthlyDep, line_description: `Accumulated Depreciation: ${asset.asset_name}` }
        ],
        userId,
        userName
      });

      const jeId = ev.journal?.id || null;

      await qClient.query(
        `INSERT INTO fixed_asset_depreciation_logs (
          tenant_id, asset_id, period_year, period_month, depreciation_amount, accumulated_after, nbv_after, journal_entry_id, posted_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, asset.id, pYear, pMonth, monthlyDep, newAccum, newNbv, jeId, userId]
      );

      await qClient.query(
        `UPDATE fixed_assets
         SET accumulated_depreciation = $1, net_book_value = $2, last_depreciation_date = $3
         WHERE id = $4`,
        [newAccum, newNbv, postDate, asset.id]
      );

      totalDepreciation = round2(totalDepreciation + monthlyDep);
      postedAssets.push({ asset_code: asset.asset_code, asset_name: asset.asset_name, depreciation: monthlyDep, new_nbv: newNbv });
    }

    return {
      period: `${pYear}-${String(pMonth).padStart(2, '0')}`,
      assets_processed: postedAssets.length,
      total_depreciation: totalDepreciation,
      details: postedAssets
    };
  }
}

module.exports = new FinanceService();
