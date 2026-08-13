# Architecture

> 🇸🇦 نبذة معمارية — تشرح كيف بُني النظام ولماذا اتُّخذت قراراته الأساسية.
> English summary in [README.md](README.md).

## Principle: the backend is the only source of truth

The frontend never computes a business number. It renders what the API returns. Every
duty, fee, commission and balance is produced server-side, so the web app, the printed
invoice, the Excel export and the desktop build can never disagree.

```
┌────────────┐   JSON    ┌──────────────────────────────┐
│ PWA / .exe │ ────────► │ FastAPI                       │
│  (render   │ ◄──────── │  routers → calc.py → SQLModel │
│   only)    │  numbers  │            (single truth)     │
└────────────┘           └──────────────────────────────┘
```

---

## 1. Calculation engine (`backend/app/calc.py`)

### Ordered formula pipeline

`FORMULA_SPECS` is an **ordered** list of `(key, label, excel_ref, doc, default_expr)`.
Each formula is evaluated in sequence and its result becomes a variable available to the
formulas after it — mirroring how the original spreadsheet's columns depended on each
other left-to-right.

```
syrian_actual → tax_advance → consumption_fee → iraqi_actual → two_party_expense
  → duties_only → fee_adjust → fees_total → commission → invested_capital
  → cash_in → cod_due → sender_debt → collected_actual → remaining → grand_total
```

### Safe evaluation

`safe_eval` parses each expression and walks the AST against an explicit node allowlist.
Anything outside it — attribute access, subscripts, comprehensions, arbitrary calls —
raises before evaluation. Only `min`, `max`, `round`, `abs` are callable, and every name
must exist in the supplied variable dict.

If a user-edited formula is invalid at runtime, the engine falls back to the shipped
default for that key instead of failing the whole request.

### Version freezing — the core accounting guarantee

| What changes | Effect on already-registered shipments |
|---|---|
| A formula | none |
| A constant (tax rate, commission, minimum fee) | none |
| An item's Syrian/Iraqi duty per ton | none |
| Item's membership of the 10% consumption tier | none |
| The 10% tier's rate | none |

Two mechanisms produce this:

1. **Config versions.** Saving settings writes a new immutable `CalcVersion` row. Shipments
   store `calc_version_id` at creation and are always recomputed against that snapshot.
2. **Value snapshots.** Values that live outside the config — per-item duty rates and the
   consumption-tier flag — are copied onto the shipment row when it is registered
   (`_freeze_item_rates`, `_freeze_special`).

A one-time backfill migration froze rates onto pre-existing shipments so historical
numbers stopped tracking the live item table without changing what they displayed.

The deliberate exception: changing a shipment's **item** re-pulls that item's rates,
because the user changed the thing being described.

---

## 2. Authorization (`core/security.py`, `routers/shipments.py`)

Three layers, all server-side:

1. **Role gate** — FastAPI dependencies (`admin_only`, `admin_or_accountant`, `can_register`)
   reject the request before the handler runs.
2. **Field allowlist** — each role has a permitted field set (`BROKER_FIELDS`,
   `DEST_FIELDS`, `ACCOUNTANT_FIELDS`, …). Keys outside it are dropped from the patch
   rather than rejected, so a partially-permitted update still succeeds for what is allowed.
3. **Row scoping** — `_visible()` narrows every query by city; mutations additionally
   re-assert ownership by ID so a known identifier cannot bypass a filtered list.

| Role | Scope |
|---|---|
| `admin` | everything |
| `supervisor` | operations + accounting, no user management |
| `accountant` | financial states, delivery/collection, reports |
| `collector` | registration only, own city, cannot export or touch exported shipments |
| `broker` | customs-clearance fields only |
| `branch` | own city's inbound/outbound |

---

## 3. Ledger accounting (`routers/mahmoud.py`)

An independent manual accounting module, deliberately decoupled from shipments.

- **No stored balances.** `balance = Σ charges − (Σ payments + Σ expenses)`, always derived.
- **Per-currency isolation.** Totals, running balances and outstanding/credit figures are
  computed per currency; USD and EUR never combine into one number anywhere in the UI.
- **Void, never delete.** Entries carry `is_void`, `void_reason`, `voided_by`, `voided_at`,
  and every edit or void writes a row to `MTxnAudit` with before/after values.
- **Credit balances allowed.** A payment may exceed what is owed, producing a negative
  (credit) balance rather than an error.

### Automatic reconciliation

Charges can be pulled from exported shipments. When a shipment's payment terms or
collection status later shift responsibility between the destination office and the
sender, the already-registered charge is reconciled: the old entry is voided *with the
reason recorded* and a corrected entry issued. Transitions that the business treats as
manual (e.g. switching to cash) are **not** auto-adjusted — instead the discrepancy is
surfaced in the UI with a one-click sync, so the books never drift silently.

---

## 4. Data layer (`core/database.py`)

Supports SQLite (file on a persistent volume) and PostgreSQL from the same code path.

Lightweight forward-only migrations run at startup: a declarative map of
`table → [(column, DDL)]` adds columns that don't exist yet, with optional backfill logic
attached to specific columns. One-time data migrations are guarded by marker rows in the
`setting` table so they never re-run.

## 5. Backup & restore (`backup.py`, `routers/backup.py`)

- **Snapshot:** `VACUUM INTO` produces a transactionally consistent copy — a plain file
  read can capture a torn database if a write is in flight.
- **Schedule:** fixed hourly slots in Damascus time, with the last completed slot persisted
  in the database. Restarts and redeploys therefore cannot reset the timer, and a missed
  slot is caught up on the next tick. *(The previous implementation slept for the interval
  and lost its countdown on every deploy — it never fired.)*
- **Restore:** SQLite header check → `PRAGMA integrity_check` → required-table check →
  automatic pre-restore safety copy → swap via SQLite's backup API → migrations re-run.

## 6. Frontend (`frontend/`)

Vanilla JS, no build step — the app is served directly by FastAPI.

- **Rendering:** small `v*()` view functions render into `#view`; column registries
  (`REPORT_COLS`, `INVOICE_COLS`, `BROKER_COLS`) drive tables, printing and Excel export
  from one definition.
- **State:** per-view state (active tab, folder depth, filter values) is preserved across
  navigation so returning from a form lands exactly where you left.
- **Print:** dedicated print stylesheets, admin-selectable columns, and rounded
  whole-number figures whose totals are summed *after* rounding so the printed total always
  equals the printed rows.
- **Offline:** service worker uses network-first for the app shell (so deployments land
  immediately) and cache fallback when offline; API requests are never cached.
