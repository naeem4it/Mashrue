# Mashrue (mashrue.com) - Database Architecture & Migration Guide

Target Database: **`mashrueDB`** (PostgreSQL 16 / 18)

---

## 📁 SQL Files Included

1. **[`01_schema_init.sql`](file:///d:/mashrue/CodeBase/database/01_schema_init.sql)**:
   * Creates UUID & Crypto extensions.
   * Initializes all 24 relational tables + multi-tenant indexes.
   * Includes `vector_documents` table for future AI RAG search.
2. **[`02_seed_superadmin_only.sql`](file:///d:/mashrue/CodeBase/database/02_seed_superadmin_only.sql)** *(Recommended for Production)*:
   * Provisions ONLY the primary Super Admin user: `naeem4it` (`Password123!`).
   * No dummy tenants, fake tenders, or sample invoices.
3. **[`02_seed_data.sql`](file:///d:/mashrue/CodeBase/database/02_seed_data.sql)** *(Optional Demo Data)*:
   * Seeds demo tenant (`Alpha Group Pakistan`), business profiles, sample tenders, cost sheets, and invoices.
4. **[`setup_database.bat`](file:///d:/mashrue/CodeBase/database/setup_database.bat)**:
   * Automated 1-click batch runner with interactive choice (Clean SuperAdmin or Full Demo).

---

## 🛠️ How to Execute the Scripts on `mashrueDB`

### Option A: Clean Setup with ONLY Super Admin (Production)
```bash
# 1. Run Schema Creation
psql -U postgres -d mashrueDB -f "01_schema_init.sql"

# 2. Seed ONLY Super Admin (naeem4it / Password123!)
psql -U postgres -d mashrueDB -f "02_seed_superadmin_only.sql"
```

### Option B: Using pgAdmin 4 (GUI)
1. Open **pgAdmin 4**.
2. Expand **Servers** -> **PostgreSQL 16/18** -> **Databases** -> **`mashrueDB`**.
3. Right-click on **`mashrueDB`** and select **Query Tool**.
4. Open and execute [`01_schema_init.sql`](file:///d:/mashrue/CodeBase/database/01_schema_init.sql).
5. Open and execute [`02_seed_data.sql`](file:///d:/mashrue/CodeBase/database/02_seed_data.sql).

### Option C: Using Windows Batch Script
Simply double-click **`setup_database.bat`** in `d:\mashrue\CodeBase\database`.

---

## 📊 Summary of Database Tables Created

| Category | Table Name | Key Purpose |
| :--- | :--- | :--- |
| **Multi-Tenant** | `tenants` | Customer tenant account isolation (`Alpha Group PK`) |
| **Business Profiles** | `business_profiles` | Multiple sub-entities under one user (`ABC Pvt Ltd`, `XYZ`, `Company 3`) |
| **User Access** | `users`, `user_business_access` | RBAC roles & user-to-business permissions |
| **Stakeholders** | `customers`, `suppliers` | Customer NTN/STRN & supplier rating registry |
| **Catalog** | `products_services` | Products, services, SKUs, cost vs selling prices |
| **Tender Pipeline** | `opportunities`, `opportunity_requirements` | External tender tracking, deadlines, compliance |
| **Costing Engine** | `bids`, `bid_items`, `supplier_quotations`, `tender_expenses` | Cost calculations in PKR (Freight, Labor, Guarantees, Markup, Margin %) |
| **Governance** | `bid_approvals`, `bid_submissions`, `bid_evaluations` | Multi-level approval (Finance/Mgmt), submission proof, won/lost analytics |
| **FBR Fiscalization**| `sales_orders`, `invoices`, `fbr_settings`, `fbr_submissions`, `fbr_submission_attempts`, `payments` | Sales orders, invoices with FBR status, retry logs, payment allocation |
| **Audit & AI** | `audit_logs`, `vector_documents` | Immutable change logs & vector embeddings for AI document search |

---
*Product Owner*: Muhammad Naeem Khan  
*Website*: [mashrue.com](https://mashrue.com)
