const db = require('./config/db');

async function migrateUniversalInventory() {
  console.log('Starting Universal Inventory, UOM, and Multi-Batch Schema Migration...');

  try {
    // 1. Extensions
    await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 2. Units of Measure Master (uom_masters)
    await db.query(`
      CREATE TABLE IF NOT EXISTS uom_masters (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        uom_code VARCHAR(30) NOT NULL,
        uom_name VARCHAR(100) NOT NULL,
        uom_type VARCHAR(50) DEFAULT 'Quantity',
        allow_decimal BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, uom_code)
      );
    `);

    // 3. Item Categories & Sub-Categories
    await db.query(`
      CREATE TABLE IF NOT EXISTS item_categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        category_code VARCHAR(50) NOT NULL,
        category_name VARCHAR(150) NOT NULL,
        industry_type VARCHAR(100) DEFAULT 'General Goods',
        description TEXT,
        requires_batch_tracking BOOLEAN DEFAULT FALSE,
        requires_expiry_tracking BOOLEAN DEFAULT FALSE,
        requires_serial_tracking BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, category_name)
      );

      CREATE TABLE IF NOT EXISTS item_sub_categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        category_id UUID NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
        sub_category_code VARCHAR(50) NOT NULL,
        sub_category_name VARCHAR(150) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, category_id, sub_category_name)
      );
    `);

    // 4. Alter products_services
    await db.query(`
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES item_categories(id) ON DELETE SET NULL;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS sub_category_id UUID REFERENCES item_sub_categories(id) ON DELETE SET NULL;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS uom_id UUID REFERENCES uom_masters(id) ON DELETE SET NULL;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS tracking_type VARCHAR(50) DEFAULT 'Standard';
    `);

    // 5. Alter inventory_transactions for Direct Drop-Shipments & Audit trail
    await db.query(`
      ALTER TABLE inventory_transactions ALTER COLUMN warehouse_id DROP NOT NULL;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
    `);

    // 6. Alter delivery_challans and tender_items
    await db.query(`
      ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS origin_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES item_categories(id) ON DELETE SET NULL;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS sub_category_id UUID REFERENCES item_sub_categories(id) ON DELETE SET NULL;
    `);

    // 7. Seed standard UOMs for all tenants
    const tenantsRes = await db.query(`SELECT id FROM tenants`);
    const standardUOMs = [
      { code: 'PCS', name: 'Pieces / Nos', type: 'Quantity', decimal: false },
      { code: 'SET', name: 'Complete Set', type: 'Quantity', decimal: false },
      { code: 'LOT', name: 'Lot / Package', type: 'Quantity', decimal: false },
      { code: 'MTR', name: 'Meters (Length)', type: 'Length', decimal: true },
      { code: 'KG', name: 'Kilograms (Weight)', type: 'Weight', decimal: true },
      { code: 'LTR', name: 'Litres (Volume)', type: 'Volume', decimal: true },
      { code: 'BOX', name: 'Box Pack', type: 'Quantity', decimal: false },
      { code: 'PKT', name: 'Packet / Sachet', type: 'Quantity', decimal: false },
      { code: 'ROLL', name: 'Roll / Coil', type: 'Quantity', decimal: true },
      { code: 'DRUM', name: 'Drum / Barrel', type: 'Volume', decimal: true },
      { code: 'TON', name: 'Metric Ton', type: 'Weight', decimal: true },
      { code: 'VIAL', name: 'Vial / Ampoule', type: 'Quantity', decimal: false },
      { code: 'PAIR', name: 'Pair (Gloves/Shoes)', type: 'Quantity', decimal: false },
      { code: 'CARTON', name: 'Master Carton', type: 'Quantity', decimal: false }
    ];

    const standardTaxonomies = [
      {
        code: 'CAT-ELEC',
        name: 'Electrical & Power Equipment',
        industry: 'Electrical & Power',
        description: 'Transformers, switchgears, cables, transmission line hardware, and meters.',
        requires_serial: true,
        subs: [
          { code: 'SUB-TRF', name: 'Power & Distribution Transformers' },
          { code: 'SUB-SWG', name: 'Switchgears, Breakers & Substations' },
          { code: 'SUB-CBL', name: 'HV/LV Power Cables & Conductors' },
          { code: 'SUB-MTR', name: 'Energy Meters, Relays & CT/PT' },
          { code: 'SUB-SOL', name: 'Solar Panels, Inverters & Batteries' }
        ]
      },
      {
        code: 'CAT-IT',
        name: 'Information Technology & Telecom',
        industry: 'IT & Telecom',
        description: 'Enterprise servers, networking hardware, computing devices, and optics.',
        requires_serial: true,
        subs: [
          { code: 'SUB-SRV', name: 'Enterprise Rack/Blade Servers & SAN Storage' },
          { code: 'SUB-CMP', name: 'Laptops, Workstations & Monitors' },
          { code: 'SUB-NET', name: 'Routers, Managed Switches & Firewalls' },
          { code: 'SUB-OPT', name: 'Fiber Optic Patch Cords & Transceivers' },
          { code: 'SUB-UPS', name: 'Online UPS Systems & Power Banks' }
        ]
      },
      {
        code: 'CAT-CIV',
        name: 'Civil, Mechanical & Construction',
        industry: 'Civil & Construction',
        description: 'Structural steel, piping, valves, heavy equipment, and building materials.',
        requires_serial: false,
        subs: [
          { code: 'SUB-STL', name: 'Deformed Steel Bars & Structural Sections' },
          { code: 'SUB-CMT', name: 'Cement, Aggregates & Ready-Mix' },
          { code: 'SUB-VLV', name: 'Industrial Valves, Actuators & Flanges' },
          { code: 'SUB-PIP', name: 'MS / HDPE Pipes & Conduit Systems' },
          { code: 'SUB-SAF', name: 'Scaffolding, PPE & Site Safety Gear' }
        ]
      },
      {
        code: 'CAT-MED',
        name: 'Medical Devices & Health Supplies',
        industry: 'Medical & Diagnostics',
        description: 'Surgical consumables, diagnostic kits, hospital equipment, and pharmaceuticals.',
        requires_batch: true,
        requires_expiry: true,
        subs: [
          { code: 'SUB-SURG', name: 'Surgical Consumables, Syringes & Cannulas' },
          { code: 'SUB-DIAG', name: 'Diagnostic Reagents, Lab Kits & Strips' },
          { code: 'SUB-DEV', name: 'Medical Equipment, Monitors & Ventilators' },
          { code: 'SUB-FUR', name: 'Hospital Beds & Examination Furniture' },
          { code: 'SUB-PHAR', name: 'Essential Medicines & Infusions' }
        ]
      },
      {
        code: 'CAT-GEN',
        name: 'General Goods, Tools & Consumables',
        industry: 'General Goods',
        description: 'Office stationery, paper, commercial printing, hardware tools, and supplies.',
        requires_batch: false,
        subs: [
          { code: 'SUB-PPR', name: 'Paper Reams, Printing & Legal Sheets' },
          { code: 'SUB-OFF', name: 'Office Supplies, Toners & Stationery' },
          { code: 'SUB-TLS', name: 'Industrial Hand Tools & Machinery Spare Parts' },
          { code: 'SUB-CHM', name: 'Cleaning, Disinfection & Industrial Chemicals' },
          { code: 'SUB-UNI', name: 'Uniforms, Fabrics & Workwear' }
        ]
      }
    ];

    for (const t of tenantsRes.rows) {
      const tenantId = t.id;

      // Seed UOMs
      for (const u of standardUOMs) {
        await db.query(`
          INSERT INTO uom_masters (tenant_id, uom_code, uom_name, uom_type, allow_decimal)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (tenant_id, uom_code) DO UPDATE
          SET uom_name = EXCLUDED.uom_name,
              uom_type = EXCLUDED.uom_type,
              allow_decimal = EXCLUDED.allow_decimal;
        `, [tenantId, u.code, u.name, u.type, u.decimal]);
      }

      // Seed Categories & Subcategories
      for (const cat of standardTaxonomies) {
        const catRes = await db.query(`
          INSERT INTO item_categories (tenant_id, category_code, category_name, industry_type, description, requires_batch_tracking, requires_expiry_tracking, requires_serial_tracking)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (tenant_id, category_name) DO UPDATE
          SET category_code = EXCLUDED.category_code,
              industry_type = EXCLUDED.industry_type,
              description = EXCLUDED.description,
              requires_batch_tracking = EXCLUDED.requires_batch_tracking,
              requires_expiry_tracking = EXCLUDED.requires_expiry_tracking,
              requires_serial_tracking = EXCLUDED.requires_serial_tracking
          RETURNING id;
        `, [tenantId, cat.code, cat.name, cat.industry, cat.description, !!cat.requires_batch, !!cat.requires_expiry, !!cat.requires_serial]);

        const catId = catRes.rows[0].id;

        for (const sub of cat.subs) {
          await db.query(`
            INSERT INTO item_sub_categories (tenant_id, category_id, sub_category_code, sub_category_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, category_id, sub_category_name) DO UPDATE
            SET sub_category_code = EXCLUDED.sub_category_code;
          `, [tenantId, catId, sub.code, sub.name]);
        }
      }

      // Link existing products to default category & UOM
      await db.query(`
        UPDATE products_services p
        SET uom_id = u.id
        FROM uom_masters u
        WHERE u.tenant_id = p.tenant_id AND UPPER(TRIM(u.uom_code)) = UPPER(TRIM(COALESCE(p.unit, 'PCS')))
          AND p.uom_id IS NULL;
      `);

      // Link products to appropriate categories by keyword
      await db.query(`
        UPDATE products_services p
        SET category_id = c.id
        FROM item_categories c
        WHERE c.tenant_id = p.tenant_id AND c.category_code = 'CAT-MED'
          AND p.category_id IS NULL
          AND (p.item_type = 'Medicine' OR p.name ILIKE '%syringe%' OR p.name ILIKE '%cannula%' OR p.name ILIKE '%gauze%' OR p.name ILIKE '%gloves%' OR p.name ILIKE '%suture%');

        UPDATE products_services p
        SET category_id = c.id
        FROM item_categories c
        WHERE c.tenant_id = p.tenant_id AND c.category_code = 'CAT-ELEC'
          AND p.category_id IS NULL
          AND (p.name ILIKE '%transformer%' OR p.name ILIKE '%switchgear%' OR p.name ILIKE '%cable%' OR p.name ILIKE '%relay%' OR p.name ILIKE '%breaker%');

        UPDATE products_services p
        SET category_id = c.id
        FROM item_categories c
        WHERE c.tenant_id = p.tenant_id AND c.category_code = 'CAT-IT'
          AND p.category_id IS NULL
          AND (p.name ILIKE '%server%' OR p.name ILIKE '%laptop%' OR p.name ILIKE '%router%' OR p.name ILIKE '%switch%' OR p.name ILIKE '%monitor%');

        UPDATE products_services p
        SET category_id = c.id
        FROM item_categories c
        WHERE c.tenant_id = p.tenant_id AND c.category_code = 'CAT-GEN'
          AND p.category_id IS NULL;
      `);
    }

    // High performance indexes for category & uom lookups
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_prod_category ON products_services (tenant_id, category_id);
      CREATE INDEX IF NOT EXISTS idx_prod_sub_category ON products_services (tenant_id, sub_category_id);
      CREATE INDEX IF NOT EXISTS idx_prod_uom ON products_services (tenant_id, uom_id);
      CREATE INDEX IF NOT EXISTS idx_uom_tenant ON uom_masters (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_item_cat_tenant ON item_categories (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_item_sub_cat ON item_sub_categories (category_id);
    `);

    console.log('✅ Universal Inventory, 2-Tier Taxonomies, and UOM Master successfully migrated and seeded!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrateUniversalInventory();
