# PAGE-BY-PAGE DESIGN SPECIFICATION
**Application:** Mashrue (mashrue.com) — Enterprise Commercial BMS  
**Author:** Senior UI/UX Design Director & Frontend Design Architect  
**Date:** August 2026 | Version: 2.0-Spec  

---

## 1. AUTHENTICATION & ONBOARDING

### 1.1 Sign-In / Login Screen (`#login-view`)
- **Purpose**: Authenticate enterprise users (SuperAdmin, ClientAdmin, Employees) with tenant routing.
- **Primary User**: All platform users.
- **Primary Goal**: Instant, secure access with automated multi-tenant context loading.
- **Primary CTA**: `Sign In` (Dark Slate Gradient `#0f172a` → `#1e293b` with white typography).
- **Layout**: 2-Column Split Hero.
  - *Left Col (60%)*: Enterprise branding, system emblem, live compliance badges (FBR PRAL, Multi-Tenant, Role-Based Access).
  - *Right Col (40%)*: High-contrast elevated dark-slate login card with username/email input, password input, inline error alerts, and demo credential helpers.
- **States**:
  - *Loading*: Button transforms to `⏳ Signing In...` with disabled inputs.
  - *Error*: Localized red alert box (`.login-error-box`) displaying actionable message without page reload.
  - *Success*: Smooth fade transition to `#app-container`.

---

## 2. EXECUTIVE KPI DASHBOARD (`view === 'dashboard'`)
- **Purpose**: Real-time commercial lifecycle metrics, earnest money exposure, receivables, and operational action triggers.
- **Primary User**: Tenant Admin, CFO, Commercial Director.
- **Primary Goal**: Immediate visibility into active bidding pipeline, unattached bid security gates, and cash collection.
- **Primary CTA**: `+ Register New Tender` (`.primary-btn`).
- **Secondary Actions**: `+ Add Customer`, `+ Add Supplier`, `💵 Record Cheque Payment`, `💳 Log Expense`.
- **Layout Structure**:
  1. *Header*: Title, entity context, trial countdown pill, active company switcher, user profile chip.
  2. *KPI Metrics 4-Col Grid*:
     - **Tenders Pipeline**: Total value in PKR Millions (`PKR 1.45M`), breakdown (In-Process / Won).
     - **Active Bid Securities**: Total CDR/PO exposure (`PKR 0` / active count) with security shield icon.
     - **Payment Collected**: Total reconciled payments received vs invoiced amount.
     - **Pending Receivables**: Outstanding bills aging counter.
  3. *Quick Actions Action Bar*: Flex row of primary and secondary quick triggers.
  4. *Active Tenders & Bidding Status Table*: Top 5 priority opportunities with live status tags and direct 360° management buttons.
- **States**:
  - *Empty State*: Clean prompt explaining no tenders registered yet, with direct `+ Register New Tender` button.
  - *Responsive*: 4-col KPI grid on desktop (`>1200px`), 2-col grid on tablet/laptop (`768px-1199px`), 1-col stacked on mobile (`<768px`).

---

## 3. COMMERCIAL TENDERS & QUOTATIONS (`view === 'opportunities'`)
- **Purpose**: Central bidding control hub for public (PPRA, DGP), corporate (RFQ, LPQ), and direct sales opportunities.
- **Primary User**: Commercial Lead, Bid Manager, Sales Operations.
- **Primary CTA**: `+ Register New Tender`.
- **Secondary Actions**: Source filters (`All Sources`, `PPRA`, `DGP`, `RFQ`, `LPQ`, `Direct Sales`), Export CSV.
- **Data Table Architecture**:
  - `Tender Name / Ref #`: Bold title, auto-generated Tender Reference (`TND-2026-XXXX`), external tender ID.
  - `Source`: Color-coded source pill (`PPRA`, `DGP`, `RFQ`, `LPQ`, `Direct`).
  - `Customer & Org Type`: Customer name + sub-text tag (`Government`, `Semi-Govt`, `Autonomous`, `Private`).
  - `Submission Deadline`: Monospace formatted date with countdown badge.
  - `Estimated Value`: Monospace right-aligned PKR currency. Price-masked (`🔒 Masked`) for unauthorized roles.
  - `Bid Security Gate`: `🛡️ Attached` (Green) or `⚠️ Missing` (Amber/Red) indicator.
  - `Status`: Badge indicator (`New`, `Under Review`, `Selected`, `Ready to submit`, `Submitted`, `Won`, `Lost`).
  - `Actions & 360° View`: `🌐 360° Cockpit`, `✏️ Edit`, `✓ Select`, `🚀 Submit`, `🏆 Won`, `❌ Lose`.

---

## 4. 360° PROJECT & TENDER COCKPIT MODAL (`#modal-tender-360`)
- **Purpose**: Full end-to-end panoramic command center linking Tender details, Customer specs, Costing margin, attached Bid Securities, Customer POs, Delivery Challans, and FBR Invoices into a unified tabbed view.
- **Primary User**: Project Lead, Operations Director.
- **Tabs**:
  1. `Overview & Customer Scope`: Full tender requirements, customer contact, and submission timeline.
  2. `Costing & Evaluation`: Direct costs, profit margin %, landed charges, and approval log.
  3. `Bid Security & Earnest Money`: Instrument details, bank name, CDR/PO #, release date.
  4. `Supply & Delivery Challans`: Linked POs, DC tracking numbers, warehouse deduction logs.
  5. `Invoicing & Payments`: Generated FBR PRAL invoice details, payment receipts, and balance dues.

---

## 5. INTERACTIVE BID COSTING CALCULATOR (`view === 'costing'`)
- **Purpose**: Real-time commercial estimation engine calculating item costs, landed charges, margin %, and minimum profitable bid price.
- **Primary User**: Costing Engineer, Commercial Bid Manager.
- **Primary CTA**: `💾 Save Costing Sheet & Submit for Approval`.
- **Layout Structure**:
  - *Left Panel (65%)*: Itemized pricing grid (Item SKU, Supplier Quote, Qty, Unit Cost, Landed Freight %, Customs %, Taxes %).
  - *Right Panel (35%)*: Sticky Margin & Financial Summary Card (Total Direct Cost, Desired Margin %, Net Profit PKR, Final Quotation Price PKR, Profit Health Meter).

---

## 6. MANDATORY BID SECURITY REGISTRY (`view === 'bid-securities'`)
- **Purpose**: Central governance registry for earnest money instruments (CDR, Pay Order, Bank Guarantee) required for tender eligibility.
- **Primary User**: Finance Officer, Bid Manager.
- **Primary CTA**: `+ Attach Bid Security`.
- **Features**: Real-time instrument tracking, issuing bank, expiry alerts, return/release workflows, and mandatory tender attachment gatekeeper.

---

## 7. INVOICING & PAKISTAN FBR PRAL DIGITAL HUB (`view === 'invoices'`)
- **Purpose**: Generation of commercial sales invoices post-delivery challan and direct real-time API integration with Pakistan Federal Board of Revenue (FBR PRAL).
- **Primary User**: Tax Accountant, Finance Lead.
- **Primary CTA**: `+ Generate Invoice from DC`.
- **Key Visuals**:
  - Live FBR Validation badge (`FBR Validated` vs `Pending Submission`).
  - Generated PRAL QR Code preview modal for digital invoice compliance.
  - One-click `🚀 Transmit to FBR` action.

---

## 8. PURCHASE ORDERS & DELIVERY CHALLANS (`view === 'purchase-orders'` & `'delivery-challans'`)
- **Purpose**: Post-award supply-chain execution, warehouse stock reservation, 3PL logistics dispatch tracking, and proof-of-delivery (POD) documentation.
- **Primary User**: Supply Chain Coordinator, Warehouse Manager.
- **Key Visuals**:
  - Linked Tender & Award LOA badges.
  - Multi-warehouse origin selector with in-place `+` Quick-Add modal.
  - Driver & hired vehicle tracking metadata.

---

## 9. MASTER REGISTRIES (CUSTOMERS, SUPPLIERS, ITEM SKUS, WAREHOUSES)
- **Purpose**: Zero-trust tenant-isolated directories with in-place sub-modal quick-add functionality during live biddings.
- **Features**:
  - Dedicated search bars with instantaneous client-side filtering.
  - Universal in-place Quick Add buttons (`+`) integrated across all transaction dropdowns without page refresh or draft loss.
  - Visual pulse highlights (`.quick-add-highlight`) confirming newly created entity selection.

---

## 10. MULTI-COMPANY & RBAC ADMINISTRATION
- **Purpose**: Provisioning company profiles (up to 2 free per tenant), user management, granular module-level permission checkboxes, and subscription billing management.
- **Visibility**: Strictly role-gated to `SuperAdmin` (global platform hub) and `ClientAdmin` (tenant administration). Regular employees receive a streamlined operational interface without billing or administrative clutter.
