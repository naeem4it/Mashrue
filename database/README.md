# Mashrue (mashrue.com) - Database Architecture & Migration Guide

Target Database: **`mashrueDB`** (PostgreSQL 16 / 18)

---

## 📁 SQL Files Included

1. **[`01_schema_init.sql`](file:///d:/mashrue/CodeBase/database/01_schema_init.sql)**:
   * Creates UUID & Crypto extensions.
   * Initializes all 24 relational tables + multi-tenant indexes.
   * Includes `vector_documents` table for future AI RAG search.
2. **[`02_seed_data.sql`](file:///d:/mashrue/CodeBase/database/02_seed_data.sql)**:
   * Seeds primary tenant: `Alpha Group Pakistan`.
   * Seeds 3 business profiles: `ABC Pvt Ltd`, `XYZ Enterprises`, `Company 3 Trading`.
   * Seeds admin user: `Muhammad Naeem Khan` (`naeem@mashrue.com`).
   * Seeds sample customer (*WAPDA*), supplier (*Siemens Pakistan*), active tender (`TND-2026-8812`), cost sheet, and validated FBR invoice.
3. **[`setup_database.bat`](file:///d:/mashrue/CodeBase/database/setup_database.bat)**:
   * Automated 1-click batch runner to execute both SQL scripts directly against `mashrueDB`.

---

## 🛠️ How to Execute the Scripts on `mashrueDB`

### Option A: Using Command Prompt / Terminal
Open your Command Prompt or PowerShell and run:

```bash
# 1. Run Schema Creation
psql -U postgres -d mashrueDB -f "d:\mashrue\CodeBase\database\01_schema_init.sql"

# 2. Run Sample Seed Data
psql -U postgres -d mashrueDB -f "d:\mashrue\CodeBase\database\02_seed_data.sql"
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
