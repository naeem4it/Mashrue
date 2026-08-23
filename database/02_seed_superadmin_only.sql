-- ============================================================================
-- Mashrue (mashrue.com) - Enterprise Business Management System
-- Production SuperAdmin Seed Script (Clean Database Setup)
-- Target DB: mashrueDB
-- ============================================================================

-- Enable required core extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Insert or Update Primary Super Admin User (naeem4it)
-- Password: Password123! (Bcrypt Hash with pgcrypto / blowfish)
INSERT INTO users (
    id,
    tenant_id,
    username,
    full_name,
    email,
    password_hash,
    role,
    status,
    must_change_password,
    can_see_bidding_prices,
    permissions,
    created_at,
    updated_at
)
VALUES (
    'e0000000-0000-0000-0000-000000000000',
    NULL,
    'naeem4it',
    'Muhammad Naeem Khan (Super Admin)',
    'naeem@mashrue.com',
    crypt('Password123!', gen_salt('bf', 10)),
    'SuperAdmin',
    'Active',
    FALSE,
    TRUE,
    '{}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    password_hash = crypt('Password123!', gen_salt('bf', 10)),
    role = 'SuperAdmin',
    status = 'Active',
    tenant_id = NULL,
    updated_at = CURRENT_TIMESTAMP;

-- Alternatively resolve conflict if username or email already exists under a different UUID
INSERT INTO users (
    id,
    tenant_id,
    username,
    full_name,
    email,
    password_hash,
    role,
    status,
    must_change_password,
    can_see_bidding_prices,
    permissions
)
SELECT 
    uuid_generate_v4(),
    NULL,
    'naeem4it',
    'Muhammad Naeem Khan (Super Admin)',
    'naeem@mashrue.com',
    crypt('Password123!', gen_salt('bf', 10)),
    'SuperAdmin',
    'Active',
    FALSE,
    TRUE,
    '{}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE LOWER(username) = 'naeem4it' OR LOWER(email) = 'naeem@mashrue.com'
);

-- Output verification notice
DO $$
BEGIN
    RAISE NOTICE '✅ Super Admin (username: naeem4it) configured successfully in mashrueDB.';
END $$;
