const db = require('./config/db');

async function migratePerformanceGuarantees() {
  try {
    await db.query(`
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS business_profile_id UUID;
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS account_title VARCHAR(255) DEFAULT '';
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(255) DEFAULT '';
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS instrument_type VARCHAR(100) DEFAULT 'BG';
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS instrument_number VARCHAR(100);
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255);
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS release_reference VARCHAR(100);
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS comments TEXT;
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS instrument_image_url TEXT;
      ALTER TABLE performance_guarantees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      UPDATE performance_guarantees SET instrument_number = guarantee_number WHERE instrument_number IS NULL;
      UPDATE performance_guarantees SET comments = remarks WHERE comments IS NULL;
      UPDATE performance_guarantees SET instrument_image_url = document_url WHERE instrument_image_url IS NULL;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS remarks TEXT;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS title VARCHAR(255);
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_required BOOLEAN DEFAULT TRUE;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_rate_pct NUMERIC(5, 4) DEFAULT 0.2500;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_amount NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_challan_no VARCHAR(100);
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_paid_date DATE;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_doc_url TEXT;
    `);
    console.log('✅ performance_guarantees & contracts columns migrated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migratePerformanceGuarantees();
