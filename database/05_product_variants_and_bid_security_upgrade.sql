-- ============================================================================
-- MASHRUE ENTERPRISE BMS - DATABASE UPGRADE 05
-- Script Name: 05_product_variants_and_bid_security_upgrade.sql
-- Classification: 100% Non-Destructive Safe Production Upgrade
-- Description:
--   1. Adds 'sizes' and 'variants' JSONB columns to products_services
--   2. Adds 'item_variant' column to tender_items
--   3. Adds 'issue_date' and 'instrument_image_url' to bid_securities
--   4. Inserts comprehensive Medical Supplies catalog seeds (Syringes, Cannulas, Gloves)
-- ============================================================================

BEGIN;

-- 1. Products & Services: Add sizes and variants
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;

-- 2. Tender Line Items: Add item_variant
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS item_variant VARCHAR(255);

-- 3. Bid Securities: Add issue_date and instrument_image_url
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS issue_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS instrument_image_url TEXT;

-- 4. Seed Medical Consumables & Devices with Pre-Configured Sizes and Variants
-- Inject into tenants if any exist
DO $$
DECLARE
    t_id UUID;
BEGIN
    SELECT id INTO t_id FROM tenants ORDER BY created_at ASC LIMIT 1;
    IF t_id IS NOT NULL THEN
        -- Medical Item 1: Disposable Syringe with Needle
        IF NOT EXISTS (SELECT 1 FROM products_services WHERE sku = 'MED-SYR-001' AND tenant_id = t_id) THEN
            INSERT INTO products_services (
                tenant_id, sku, name, description, unit, item_type,
                hs_code, country_of_origin, cost_price, selling_price,
                current_stock, reorder_level,
                sizes, variants
            ) VALUES (
                t_id,
                'MED-SYR-001',
                'Disposable Syringe with Needle (Sterile Blister Pack)',
                'Medical grade non-pyrogenic disposable syringe with ultra-sharp hypodermic needle. Compliant with ISO 7886-1 standard.',
                'BOX',
                'Product',
                '9018.3100',
                'Pakistan',
                850.00,
                1150.00,
                500,
                50,
                '["1ml (Insulin 100 IU)", "2ml", "3ml (23G)", "5ml (22G)", "10ml (21G)", "20ml", "50ml", "60ml"]'::jsonb,
                '["Luer Lock", "Slip Tip", "Auto-Disable (AD)", "With Needle", "Without Needle", "Blister Pack"]'::jsonb
            );
        END IF;

        -- Medical Item 2: IV Cannula / Intravenous Catheter
        IF NOT EXISTS (SELECT 1 FROM products_services WHERE sku = 'MED-CAN-002' AND tenant_id = t_id) THEN
            INSERT INTO products_services (
                tenant_id, sku, name, description, unit, item_type,
                hs_code, country_of_origin, cost_price, selling_price,
                current_stock, reorder_level,
                sizes, variants
            ) VALUES (
                t_id,
                'MED-CAN-002',
                'IV Cannula with Injection Port and Wings',
                'Sterile intravenous catheter with port, radio-opaque Teflon/FEP cannula, sharp Japanese back-cut needle for smooth vein access.',
                'BOX',
                'Product',
                '9018.3900',
                'Pakistan',
                1200.00,
                1600.00,
                400,
                40,
                '["14G (Orange)", "16G (Grey)", "18G (Green)", "20G (Pink)", "22G (Blue)", "24G (Yellow)", "26G (Violet)"]'::jsonb,
                '["With Injection Port & Wings", "Without Port (Straight)", "Pen-Type", "Safety Shielded"]'::jsonb
            );
        END IF;

        -- Medical Item 3: Sterile Surgical Latex Gloves
        IF NOT EXISTS (SELECT 1 FROM products_services WHERE sku = 'MED-GLV-003' AND tenant_id = t_id) THEN
            INSERT INTO products_services (
                tenant_id, sku, name, description, unit, item_type,
                hs_code, country_of_origin, cost_price, selling_price,
                current_stock, reorder_level,
                sizes, variants
            ) VALUES (
                t_id,
                'MED-GLV-003',
                'Surgical & Examination Latex Gloves (Sterile)',
                'Pre-powdered and powder-free sterile surgical gloves, anatomical shape, beaded cuff, CE and ISO certified.',
                'BOX',
                'Product',
                '4015.1900',
                'Pakistan',
                2200.00,
                2800.00,
                300,
                30,
                '["Size 6.0", "Size 6.5", "Size 7.0", "Size 7.5", "Size 8.0", "Size 8.5"]'::jsonb,
                '["Sterile Powder-Free", "Sterile Powdered", "Nitrile Blue Examination", "Heavy Duty Latex"]'::jsonb
            );
        END IF;

        -- Medical Item 4: Absorbent Cotton Gauze Than
        IF NOT EXISTS (SELECT 1 FROM products_services WHERE sku = 'MED-GAU-004' AND tenant_id = t_id) THEN
            INSERT INTO products_services (
                tenant_id, sku, name, description, unit, item_type,
                hs_code, country_of_origin, cost_price, selling_price,
                current_stock, reorder_level,
                sizes, variants
            ) VALUES (
                t_id,
                'MED-GAU-004',
                'Absorbent Cotton Surgical Gauze (B.P. Standard)',
                '100% bleached woven cotton gauze cloth, highly absorbent, free from optical whiteners, BP standard specifications.',
                'ROLL',
                'Product',
                '3005.9090',
                'Pakistan',
                1450.00,
                1950.00,
                150,
                20,
                '["1m x 20m Than", "1m x 30m Than", "1m x 40m Than", "7.5cm x 5m Bandage", "10cm x 5m Bandage"]'::jsonb,
                '["Sterile Roll", "Non-Sterile Absorbent", "Roller Bandage", "Gauze Swab Pack 10x10cm"]'::jsonb
            );
        END IF;

        -- Medical Item 5: Surgical Suture with Needle
        IF NOT EXISTS (SELECT 1 FROM products_services WHERE sku = 'MED-SUT-005' AND tenant_id = t_id) THEN
            INSERT INTO products_services (
                tenant_id, sku, name, description, unit, item_type,
                hs_code, country_of_origin, cost_price, selling_price,
                current_stock, reorder_level,
                sizes, variants
            ) VALUES (
                t_id,
                'MED-SUT-005',
                'Surgical Suture with Needle (Sterile Foil Pack)',
                'Absorbable and non-absorbable synthetic surgical sutures with stainless steel atraumatic needle.',
                'BOX',
                'Product',
                '3006.1000',
                'Pakistan',
                3500.00,
                4600.00,
                100,
                15,
                '["Size 0", "Size 1", "Size 2-0", "Size 3-0", "Size 4-0", "Size 5-0", "Size 6-0"]'::jsonb,
                '["Polyglactin (Vicryl)", "Polypropylene (Prolene)", "Silk Braided", "Chromic Catgut", "Round Bodied Needle", "Cutting Needle"]'::jsonb
            );
        END IF;
    END IF;
END $$;

COMMIT;
