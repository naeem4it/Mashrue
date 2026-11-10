/**
 * ============================================================================
 * MASHRUE TAXGUARD MODULE — DATABASE MIGRATION (migrate_tax_compliance_module.js)
 * ============================================================================
 * Preserves & hardens existing TaxGuard tables:
 *   tax_jurisdictions, tax_withholding_rules, tax_withholding_deductions,
 *   tax_monthly_returns
 *
 * Adds:
 *   - Safe uniqueness on tax_monthly_returns (tenant_id, tax_month, tax_year, jurisdiction_code)
 *   - Return lifecycle lock fields (filed_at, filed_by, locked_at, amended_count)
 *   - tax_audit_logs table for statutory compliance traceability
 *   - Seeds default Federal & Provincial Sales Tax Jurisdictions + Sec 153 WHT Rules
 * ============================================================================
 */

const db = require('./config/db');

async function migrateTaxComplianceModule() {
  console.log('================================================================');
  console.log('🇵🇰 RUNNING MASHRUE TAXGUARD DATABASE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Deduplicate any historical duplicate monthly returns safely before creating UNIQUE index
    await client.query(`
      DELETE FROM tax_monthly_returns a
      USING tax_monthly_returns b
      WHERE a.id < b.id
        AND a.tenant_id = b.tenant_id
        AND a.tax_month = b.tax_month
        AND a.tax_year = b.tax_year
        AND COALESCE(a.jurisdiction_code, 'FBR_FED') = COALESCE(b.jurisdiction_code, 'FBR_FED');
    `);

    await client.query(`
      ALTER TABLE tax_monthly_returns ADD COLUMN IF NOT EXISTS filed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE tax_monthly_returns ADD COLUMN IF NOT EXISTS filed_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tax_monthly_returns ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE tax_monthly_returns ADD COLUMN IF NOT EXISTS amended_count INT DEFAULT 0;
      ALTER TABLE tax_monthly_returns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_monthly_returns_period') THEN
          ALTER TABLE tax_monthly_returns
            ADD CONSTRAINT uq_tax_monthly_returns_period UNIQUE (tenant_id, tax_month, tax_year, jurisdiction_code);
        END IF;
      END $$;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_jurisdictions_code') THEN
          ALTER TABLE tax_jurisdictions
            ADD CONSTRAINT uq_tax_jurisdictions_code UNIQUE (tenant_id, jurisdiction_code);
        END IF;
      END $$;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_wht_rules_code') THEN
          ALTER TABLE tax_withholding_rules
            ADD CONSTRAINT uq_tax_wht_rules_code UNIQUE (tenant_id, section_code);
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS tax_audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entity_type VARCHAR(60) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        action VARCHAR(60) NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(150),
        details JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Seed default Tax Jurisdictions & Section 153 Rules if missing for tenants
    const tenants = await client.query(`SELECT id FROM tenants`);
    const defJurisdictions = [
      ['FBR_FED', 'Federal Board of Revenue (FBR GST Goods)', 'Goods Sales Tax', 18.0, 4.0, 0.0],
      ['PRA', 'Punjab Revenue Authority (PRA Services)', 'Services Tax', 16.0, 0.0, 5.0],
      ['SRB', 'Sindh Revenue Board (SRB Services)', 'Services Tax', 13.0, 0.0, 0.0],
      ['KPRA', 'Khyber Pakhtunkhwa Revenue Authority', 'Services Tax', 15.0, 0.0, 0.0],
      ['BRA', 'Balochistan Revenue Authority', 'Services Tax', 15.0, 0.0, 0.0]
    ];
    const defWhtRules = [
      ['153(1)(a) Goods', 5.0, 10.0, 75000, 'Supply of Goods (Corporate / Company 5%, Non-Filer Double)'],
      ['153(1)(b) Services', 9.0, 18.0, 30000, 'Rendering of Services (Company 9%, Non-Filer Double)'],
      ['153(1)(c) Contracts', 7.5, 15.0, 0, 'Execution of Works & Turnkey Contracts'],
      ['153(1)(a) Dist/Pharma', 1.0, 2.0, 75000, 'Authorized Distributors & Pharmaceutical Supply']
    ];

    for (const t of tenants.rows) {
      for (const [code, auth, type, stdR, furR, redR] of defJurisdictions) {
        await client.query(
          `INSERT INTO tax_jurisdictions (tenant_id, jurisdiction_code, authority_name, tax_type, standard_rate, further_tax_rate, reduced_rate, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT (tenant_id, jurisdiction_code) DO NOTHING`,
          [t.id, code, auth, type, stdR, furR, redR]
        );
      }
      for (const [sec, filerR, nonFilerR, thresh, desc] of defWhtRules) {
        await client.query(
          `INSERT INTO tax_withholding_rules (tenant_id, section_code, filer_rate, non_filer_rate, threshold_amount, description, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT (tenant_id, section_code) DO NOTHING`,
          [t.id, sec, filerR, nonFilerR, thresh, desc]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅ Mashrue TaxGuard database migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ TaxGuard migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateTaxComplianceModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrateTaxComplianceModule };

