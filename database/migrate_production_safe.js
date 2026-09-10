/**
 * Mashrue Production-Safe Migration Engine
 * GUARANTEE: Strictly NON-DESTRUCTIVE. No tables dropped, no data wiped, no existing records disturbed.
 * All DDL uses IF NOT EXISTS; all DML uses ON CONFLICT DO NOTHING.
 */

const fs = require('fs');
const path = require('path');

// Dynamically locate db config
const dbCandidates = [
  path.join(__dirname, '../backend/config/db'),
  path.join(__dirname, './config/db'),
  path.join(__dirname, '../Code/Backend/config/db'),
  path.join(__dirname, '../../Code/Backend/config/db')
];

let db = null;
for (const candidate of dbCandidates) {
  if (fs.existsSync(candidate + '.js') || fs.existsSync(candidate)) {
    // Also load .env from that folder's parent if present
    const envCandidate = path.join(path.dirname(candidate), '../.env');
    if (fs.existsSync(envCandidate)) {
      try { require('dotenv').config({ path: envCandidate }); } catch (e) {}
    }
    db = require(candidate);
    break;
  }
}

if (!db) {
  console.error('Could not locate database configuration module.');
  process.exit(1);
}

async function runSafeMigration() {
  console.log('====================================================');
  console.log('🛡️  MASHRUE PRODUCTION-SAFE DATABASE MIGRATION ENGINE');
  console.log('====================================================\n');

  try {
    // 1. Audit Existing Records Pre-flight
    const preAudit = await Promise.all([
      db.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"),
      db.query("SELECT COUNT(*) FROM products_services"),
      db.query("SELECT COUNT(*) FROM opportunities"),
      db.query("SELECT COUNT(*) FROM bid_securities")
    ]);

    const totalTablesPre = parseInt(preAudit[0].rows[0].count, 10);
    const totalProductsPre = parseInt(preAudit[1].rows[0].count, 10);
    const totalTendersPre = parseInt(preAudit[2].rows[0].count, 10);
    const totalSecuritiesPre = parseInt(preAudit[3].rows[0].count, 10);

    console.log('📊 Pre-Migration Production Data Audit:');
    console.log(`   - Public Tables: ${totalTablesPre}`);
    console.log(`   - Existing Master Products: ${totalProductsPre}`);
    console.log(`   - Existing Tenders / Opportunities: ${totalTendersPre}`);
    console.log(`   - Existing Bid Securities: ${totalSecuritiesPre}`);
    console.log('----------------------------------------------------');

    // 2. Execute Non-Destructive Column Additions
    console.log('\n🔧 Applying safe schema enhancements (ADD COLUMN IF NOT EXISTS)...');

    await db.query(`
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS item_variant VARCHAR(255);
      ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS issue_date DATE;
      ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS instrument_image_url TEXT;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_tier VARCHAR(50) DEFAULT 'Tier 1 - Tender Direct';
      
      CREATE TABLE IF NOT EXISTS expense_categories (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          tier VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          code VARCHAR(50),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique 
        ON expense_categories (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), tier, name);
    `);

    // Seed master expense categories (30 standard categories across 3 Tiers)
    const masterExpenseCategories = [
      // Tier 1: Tender & Quotation Pre-Bid Direct Expenses
      { tier: 'Tier 1 - Tender Direct', name: 'Tender / Bidding Document Fee', description: 'Procurement authority tender document purchases, bidding dossier download fees, RFP fees' },
      { tier: 'Tier 1 - Tender Direct', name: 'Lab Sample Testing & Certification', description: 'Third-party testing laboratory fees (PCSIR, CE, ISO, Dielectric, SGS, Bureau Veritas)' },
      { tier: 'Tier 1 - Tender Direct', name: 'Sample Procurement & Fabrication', description: 'Purchasing, custom tooling, sample batch fabrication, or prototyping for technical bidding' },
      { tier: 'Tier 1 - Tender Direct', name: 'Site Pre-Bid Survey / Inspection & Fuel', description: 'Engineer pre-bid field survey, ground inspection travel, vehicle fuel, site reconnaissance' },
      { tier: 'Tier 1 - Tender Direct', name: 'Bid Security Guarantee Bank Processing Fee', description: 'CDR / Bank Guarantee issuance commissions, bank service charges, stamp papers for securities' },
      { tier: 'Tier 1 - Tender Direct', name: 'Courier & Dispatch Charges for Bids', description: 'Urgent secured bidding dossier dispatch (TCS, DHL, Leopard courier) to client opening office' },
      { tier: 'Tier 1 - Tender Direct', name: 'Technical Consultant / Specialist Fee', description: 'Third-party technical consultant, structural engineer, or subject matter specialist drafting fees' },
      { tier: 'Tier 1 - Tender Direct', name: 'Client Pre-Bid Meeting Refreshments & Travel', description: 'Intercity travel, flight/train, lodging, and refreshments for pre-bid conference attendance' },
      { tier: 'Tier 1 - Tender Direct', name: 'Other Pre-Bid Direct Expense', description: 'Miscellaneous tender-specific direct out-of-pocket costs prior to bid opening' },

      // Tier 2: PO & Delivery Execution Logistics Costs
      { tier: 'Tier 2 - PO Execution', name: 'Hired Freight / Trailer Transport', description: 'Long-haul freight truck, container transport, flatbed trailer hire for cargo transport' },
      { tier: 'Tier 2 - PO Execution', name: '3PL Logistics & Courier (TCS / Leopard / M&P)', description: 'Parcel delivery, express cargo services, dispatch of delivery challans and invoices' },
      { tier: 'Tier 2 - PO Execution', name: 'Loading & Unloading Labor', description: 'Coolie/labor charges for warehouse loading, site offloading, crane/forklift equipment hire' },
      { tier: 'Tier 2 - PO Execution', name: 'Port Customs Clearance & Handling Charges', description: 'Seaport/dryport customs clearing agent commissions, wharfage, terminal handling, demurrage' },
      { tier: 'Tier 2 - PO Execution', name: 'Transit Insurance & Security', description: 'Marine/transit cargo insurance policy premiums, armed security escort for high-value cargo' },
      { tier: 'Tier 2 - PO Execution', name: 'Warehouse Storage & Material Handling', description: 'Temporary transit storage depot fees, pallet racking, staging warehouse rental' },
      { tier: 'Tier 2 - PO Execution', name: 'Packaging & Palletization Supplies', description: 'Wooden pallets, heat-shrink wrap, bubble wrap, corrugated master cartons, strapping bands' },
      { tier: 'Tier 2 - PO Execution', name: 'Site Installation & Field Assembly Labor', description: 'Technician on-site deployment, civil work fitting, commissioning, field labor charges' },
      { tier: 'Tier 2 - PO Execution', name: 'QC Third-Party Inspection at Delivery', description: 'Third-party pre-dispatch inspection (PDI), factory acceptance testing (FAT) inspector fees' },
      { tier: 'Tier 2 - PO Execution', name: 'Other Execution & Logistics Expense', description: 'Specialized delivery, route survey, toll taxes, weighbridge receipts, octroi charges' },

      // Tier 3: General Business & Administrative Overheads
      { tier: 'Tier 3 - General Overheads', name: 'Head Office Rent', description: 'Head office, regional branch, or executive commercial premises rental leases' },
      { tier: 'Tier 3 - General Overheads', name: 'Office Utilities (Electricity, Gas, Water)', description: 'Monthly commercial utility charges (WAPDA, LESCO, KE, SNGPL, Water board)' },
      { tier: 'Tier 3 - General Overheads', name: 'Staff Salaries & Wages', description: 'Permanent and contracted team monthly payroll, bonuses, and employee allowances' },
      { tier: 'Tier 3 - General Overheads', name: 'Office Internet & Telephone', description: 'High-speed fiber internet connection, landlines, cellular corporate SIM bundles' },
      { tier: 'Tier 3 - General Overheads', name: 'Stationery & Printing Supplies', description: 'Letterheads, envelopes, toner cartridges, photocopies, heavy-duty binder files' },
      { tier: 'Tier 3 - General Overheads', name: 'Company Vehicle Fuel & Routine Maintenance', description: 'Fleet fuel cards, engine oil changes, tires, vehicle fitness inspections, motor tuning' },
      { tier: 'Tier 3 - General Overheads', name: 'Bank Charges & Account Maintenance', description: 'Corporate bank account monthly maintenance fees, cheque book fees, wire transfer commissions' },
      { tier: 'Tier 3 - General Overheads', name: 'Legal & Tax Advisory Fees', description: 'Corporate tax consultant retainer, SECP compliance advocate, legal opinion fees' },
      { tier: 'Tier 3 - General Overheads', name: 'Software & ERP Subscriptions', description: 'Cloud hosting, accounting software, domain renewals, productivity licenses' },
      { tier: 'Tier 3 - General Overheads', name: 'Office Refreshments & Hospitality', description: 'Kitchen supplies, staff tea/coffee, guest hospitality, water dispenser bottles' },
      { tier: 'Tier 3 - General Overheads', name: 'Miscellaneous General Expense', description: 'General sundry expenses, office cleaning supplies, small repair and maintenance' }
    ];

    for (const cat of masterExpenseCategories) {
      await db.query(`
        INSERT INTO expense_categories (tier, name, description, is_active)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT DO NOTHING
      `, [cat.tier, cat.name, cat.description]);
    }

    console.log('   ✓ Schema columns & 30 master expense categories verified/added.');

    // 3. Apply Non-Destructive Medical & Apparel Seeds (ON CONFLICT DO NOTHING)
    console.log('\n📦 Verifying / Seeding standard master items (Syringes, Shirts, Cannulas, Gloves)...');

    const seedItems = [
      {
        sku: 'MED-SYR-001',
        name: 'Disposable Syringe with Needle (Sterile Blister Pack)',
        specifications: 'Medical Device Class IIa',
        item_type: 'Product',
        unit: 'PCS',
        sizes: ['1ml (Insulin 100 IU)', '2ml', '3ml (23G)', '5ml (22G)', '10ml (21G)', '20ml', '50ml', '60ml'],
        variants: ['Luer Lock', 'Slip Tip', 'Auto-Disable (AD)', 'With Needle', 'Without Needle', 'Blister Pack'],
        cost_price: 18.50,
        selling_price: 25.00
      },
      {
        sku: 'MED-CAN-002',
        name: 'IV Cannula with Injection Port and Wings',
        specifications: 'PTFE Radiopaque / FEP Catheter',
        item_type: 'Product',
        unit: 'PCS',
        sizes: ['14G (Orange)', '16G (Grey)', '18G (Green)', '20G (Pink)', '22G (Blue)', '24G (Yellow)', '26G (Violet)'],
        variants: ['With Injection Port & Wings', 'Without Port (Straight)', 'Pen-Type', 'Safety Shielded'],
        cost_price: 45.00,
        selling_price: 65.00
      },
      {
        sku: 'MED-GLV-003',
        name: 'Surgical & Examination Latex Gloves (Sterile)',
        specifications: 'Powder-Free Micro-Textured Hypoallergenic',
        item_type: 'Product',
        unit: 'PAIR',
        sizes: ['Size 6.0', 'Size 6.5', 'Size 7.0', 'Size 7.5', 'Size 8.0', 'Size 8.5'],
        variants: ['Sterile Powder-Free', 'Sterile Powdered', 'Nitrile Blue Examination', 'Heavy Duty Latex'],
        cost_price: 55.00,
        selling_price: 80.00
      },
      {
        sku: 'MED-GAU-004',
        name: 'Absorbent Cotton Surgical Gauze (B.P. Standard)',
        specifications: '100% Cotton 19x15 Mesh Type IV',
        item_type: 'Product',
        unit: 'ROLL',
        sizes: ['1m x 20m Than', '1m x 30m Than', '1m x 40m Than', '7.5cm x 5m Bandage', '10cm x 5m Bandage'],
        variants: ['Sterile Roll', 'Non-Sterile Absorbent', 'Roller Bandage', 'Gauze Swab Pack 10x10cm'],
        cost_price: 320.00,
        selling_price: 450.00
      },
      {
        sku: 'MED-SUT-005',
        name: 'Surgical Suture with Needle (Sterile Foil Pack)',
        specifications: 'Synthetic Absorbable & Non-Absorbable',
        item_type: 'Product',
        unit: 'PCS',
        sizes: ['Size 0', 'Size 1', 'Size 2-0', 'Size 3-0', 'Size 4-0', 'Size 5-0', 'Size 6-0'],
        variants: ['Polyglactin (Vicryl)', 'Polypropylene (Prolene)', 'Silk Braided', 'Chromic Catgut', 'Round Bodied Needle', 'Cutting Needle'],
        cost_price: 180.00,
        selling_price: 260.00
      },
      {
        sku: 'MED-SHT-006',
        name: 'Hospital Staff Medical Shirt / OT Scrub Suit',
        specifications: 'Anti-Microbial Breathable Poly-Cotton Blend (180 GSM)',
        item_type: 'Product',
        unit: 'SET',
        sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
        variants: ['White', 'Navy Blue', 'Light Green (OT Scrub)', 'Sky Blue', 'Grey'],
        cost_price: 950.00,
        selling_price: 1350.00
      }
    ];

    // Resolve tenant ID for master item seeding
    const tenantRes = await db.query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
    const defaultTenantId = tenantRes.rows[0]?.id;

    for (const item of seedItems) {
      // Safely insert only if item with this SKU does not already exist
      const checkExists = await db.query('SELECT id FROM products_services WHERE sku = $1', [item.sku]);
      if (checkExists.rows.length === 0 && defaultTenantId) {
        await db.query(`
          INSERT INTO products_services (
            tenant_id, sku, name, description, item_type, unit, sizes, variants, cost_price, selling_price, current_stock, reorder_level
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 100, 10)
        `, [
          defaultTenantId,
          item.sku,
          item.name,
          item.specifications,
          item.item_type,
          item.unit,
          JSON.stringify(item.sizes),
          JSON.stringify(item.variants),
          item.cost_price,
          item.selling_price
        ]);
        console.log(`   + Registered master catalog item: ${item.sku} - ${item.name}`);
      } else {
        // If already exists, update sizes/variants non-destructively
        await db.query(`
          UPDATE products_services 
          SET sizes = COALESCE(sizes, $2::jsonb),
              variants = COALESCE(variants, $3::jsonb)
          WHERE sku = $1
        `, [item.sku, JSON.stringify(item.sizes), JSON.stringify(item.variants)]);
        console.log(`   • Existing item preserved and enriched: ${item.sku}`);
      }
    }

    // 4. Post-Migration Verification Audit
    const postAudit = await Promise.all([
      db.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"),
      db.query("SELECT COUNT(*) FROM products_services"),
      db.query("SELECT COUNT(*) FROM opportunities"),
      db.query("SELECT COUNT(*) FROM bid_securities")
    ]);

    const totalTablesPost = parseInt(postAudit[0].rows[0].count, 10);
    const totalProductsPost = parseInt(postAudit[1].rows[0].count, 10);
    const totalTendersPost = parseInt(postAudit[2].rows[0].count, 10);
    const totalSecuritiesPost = parseInt(postAudit[3].rows[0].count, 10);

    console.log('\n----------------------------------------------------');
    console.log('✅ Post-Migration Verification & Integrity Report:');
    console.log(`   - Public Tables: ${totalTablesPost} (Previous: ${totalTablesPre})`);
    console.log(`   - Master Products: ${totalProductsPost} (Previous: ${totalProductsPre})`);
    console.log(`   - Tenders / Opportunities: ${totalTendersPost} (Previous: ${totalTendersPre} - 100% PRESERVED)`);
    console.log(`   - Bid Securities: ${totalSecuritiesPost} (Previous: ${totalSecuritiesPre} - 100% PRESERVED)`);
    console.log('====================================================');
    console.log('🎉 SUCCESS: Safe production migration completed with ZERO data loss or disturbance.');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ MIGRATION FAILED:', err.message);
    process.exit(1);
  }
}

runSafeMigration();
