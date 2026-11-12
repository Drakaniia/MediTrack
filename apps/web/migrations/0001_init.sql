-- MediTract Web — initial schema (Cloudflare D1 / SQLite).
--
-- Forward-only. Once this file has been applied to a shared database it must
-- never be edited (not even a comment): add 0002_*.sql instead. Applied with
-- `wrangler d1 migrations apply` (see `pnpm web:migrate`).
--
-- Conventions
--   ids ............ TEXT, crypto.randomUUID() unless noted
--   timestamps ..... ISO-8601 UTC with milliseconds: 2026-11-12T02:55:53.123Z
--   dates .......... ISO YYYY-MM-DD, facility-local calendar dates (expiry, received_on)
--   booleans ....... INTEGER 0/1
--   *_lower ........ case-folded copy used for uniqueness and lookup
--   soft delete .... items/batches carry deleted_at; "Trash" is a view over those rows
--   history ........ event/history tables snapshot names (item_name, batch_number …) and
--                    use nullable FKs with ON DELETE SET NULL, so purging a row from the
--                    Trash never destroys history.
--   expiry class ... NEVER stored. Safe / Near Expiry / Urgent / Expired are computed at
--                    read time from `expiry`, today (facility timezone) and the thresholds
--                    in `settings` (see shared/expiry.ts).
--   stock safety ... batches.qty has CHECK (qty >= 0); every stock write goes through
--                    one DB.batch() that also appends stock_movements and audit_log rows.

-- ─── Identity & access ────────────────────────────────────────────────────

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  email TEXT,
  email_lower TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'inventory', 'pharmacist', 'nurse', 'health_admin')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  disabled_at TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- `id` is the hex SHA-256 of (token + SESSION_PEPPER); the raw token only ever lives in the cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- bucket = 'user:<username_lower>|ip:<ip>' or 'ip:<ip>'
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1))
);
CREATE INDEX idx_login_attempts_bucket ON login_attempts (bucket, attempted_at);

-- ─── Configuration ────────────────────────────────────────────────────────

-- Flat key → JSON value. Keys and defaults are defined in shared/settings.ts.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id)
);

-- Monotonic counters, e.g. name = 'request:2026' → next REQ-2026-NNNN.
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ─── Inventory ────────────────────────────────────────────────────────────

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories (id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  pack_unit TEXT NOT NULL DEFAULT '',
  pack_size INTEGER CHECK (pack_size IS NULL OR pack_size > 0),
  supplier TEXT NOT NULL DEFAULT '',
  sku TEXT,
  barcode TEXT,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  has_expiry INTEGER NOT NULL DEFAULT 1 CHECK (has_expiry IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users (id),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_items_identity ON items (lower(name), lower(strength)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_items_sku ON items (lower(sku)) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_items_barcode ON items (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_items_name ON items (lower(name));
CREATE INDEX idx_items_category ON items (category_id);
CREATE INDEX idx_items_deleted ON items (deleted_at);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items (id),
  -- Short opaque QR payload: 10 chars of Crockford base32, globally unique.
  code TEXT NOT NULL UNIQUE,
  batch_number TEXT NOT NULL,
  batch_number_lower TEXT NOT NULL,
  -- Optional manufacturer barcode specific to this lot (the item may carry its own).
  barcode TEXT,
  -- NULL = no expiry (equipment/consumables). Only items with has_expiry = 0 may have NULL.
  expiry TEXT CHECK (expiry IS NULL OR expiry GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  qty INTEGER NOT NULL CHECK (qty >= 0),
  initial_qty INTEGER NOT NULL CHECK (initial_qty >= 0),
  received_on TEXT NOT NULL CHECK (received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  supplier TEXT NOT NULL DEFAULT '',
  -- 'disposed' = written off through the disposal flow. "Quarantined" is derived:
  -- status = 'active' AND qty > 0 AND expiry < today.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposed_at TEXT,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users (id),
  -- 1 when the batch was trashed because its item was trashed (restored with the item).
  deleted_with_item INTEGER NOT NULL DEFAULT 0 CHECK (deleted_with_item IN (0, 1)),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_batches_item_number ON batches (item_id, batch_number_lower) WHERE deleted_at IS NULL;
CREATE INDEX idx_batches_item ON batches (item_id);
CREATE INDEX idx_batches_expiry ON batches (expiry);
CREATE INDEX idx_batches_barcode ON batches (barcode);
-- FEFO: earliest expiry first, NULL (no expiry) last, then earliest received, then batch number.
CREATE INDEX idx_batches_fefo ON batches (item_id, expiry, received_on, batch_number_lower)
  WHERE deleted_at IS NULL AND status = 'active' AND qty > 0;

-- Append-only ledger of every quantity change. One row per batch touched. Source of
-- truth for item history, monthly per-batch reports, the stock-movement and
-- low-stock-trend charts.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  item_id TEXT REFERENCES items (id) ON DELETE SET NULL,
  batch_id TEXT REFERENCES batches (id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receive', 'dispense', 'undo_dispense', 'dispose', 'adjust')),
  qty_delta INTEGER NOT NULL CHECK (qty_delta <> 0),
  qty_after INTEGER NOT NULL CHECK (qty_after >= 0),
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ref_type TEXT CHECK (ref_type IS NULL OR ref_type IN ('dispensing_record', 'disposal', 'request')),
  ref_id TEXT,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_movements_item_at ON stock_movements (item_id, at);
CREATE INDEX idx_movements_batch ON stock_movements (batch_id);
CREATE INDEX idx_movements_at ON stock_movements (at);

-- ─── Requests, dispensing & disposal ──────────────────────────────────────

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  -- Human-friendly id, REQ-2026-0141, allocated from counters ('request:<year>').
  code TEXT NOT NULL UNIQUE,
  item_id TEXT REFERENCES items (id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  dispensed_qty INTEGER NOT NULL DEFAULT 0 CHECK (dispensed_qty >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'ready', 'claimed', 'denied', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'queue' CHECK (source IN ('queue', 'quick_deduct')),
  reason TEXT NOT NULL DEFAULT '',
  requestor_name TEXT NOT NULL DEFAULT '',
  requestor_ref TEXT NOT NULL DEFAULT '',
  requestor_email TEXT NOT NULL DEFAULT '',
  requested_by TEXT REFERENCES users (id),
  denied_reason TEXT
    CHECK (denied_reason IS NULL OR denied_reason IN ('Out of Stock', 'Not Available', 'Duplicate Request', 'Other')),
  denied_note TEXT NOT NULL DEFAULT '',
  board_position INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  claimed_at TEXT,
  archived_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_requests_status ON requests (status, board_position);
CREATE INDEX idx_requests_item ON requests (item_id);
CREATE INDEX idx_requests_submitted ON requests (submitted_at);

CREATE TABLE request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_request_events_request ON request_events (request_id, at);

-- One hand-over (queue dispense or Quick Deduct). May span several batches (dispensing_lines).
CREATE TABLE dispensing_records (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES requests (id) ON DELETE SET NULL,
  item_id TEXT REFERENCES items (id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty > 0),
  source TEXT NOT NULL CHECK (source IN ('queue', 'quick_deduct')),
  recipient_name TEXT NOT NULL DEFAULT '',
  dispensed_by TEXT NOT NULL REFERENCES users (id),
  dispensed_by_name TEXT NOT NULL,
  dispensed_at TEXT NOT NULL,
  -- Quick Deduct undo: quantities go back to the batches and the record is kept, marked undone.
  undone_at TEXT,
  undone_by TEXT REFERENCES users (id),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_dispensing_at ON dispensing_records (dispensed_at);
CREATE INDEX idx_dispensing_item ON dispensing_records (item_id, dispensed_at);
CREATE INDEX idx_dispensing_request ON dispensing_records (request_id);

CREATE TABLE dispensing_lines (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES dispensing_records (id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES batches (id) ON DELETE SET NULL,
  batch_number TEXT NOT NULL,
  expiry TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX idx_dispensing_lines_record ON dispensing_lines (record_id);
CREATE INDEX idx_dispensing_lines_batch ON dispensing_lines (batch_id);

-- Write-off of a whole batch's remaining stock (expired, damaged, recalled, other).
CREATE TABLE disposals (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES batches (id) ON DELETE SET NULL,
  item_id TEXT REFERENCES items (id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  expiry TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  reason TEXT NOT NULL CHECK (reason IN ('expired', 'damaged', 'recalled', 'other')),
  note TEXT NOT NULL DEFAULT '',
  disposed_by TEXT NOT NULL REFERENCES users (id),
  disposed_by_name TEXT NOT NULL,
  disposed_at TEXT NOT NULL
);
CREATE INDEX idx_disposals_at ON disposals (disposed_at);
CREATE INDEX idx_disposals_batch ON disposals (batch_id);

-- ─── Alerts, notifications & push ─────────────────────────────────────────

-- One row per alert-worthy event, shared by every user. Per-user read/dismiss state lives
-- in notification_state. dedupe_key makes generation idempotent, e.g.
-- 'batch:<id>:urgent' or 'lowstock:<item_id>:2026-11-12'.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('near_expiry', 'urgent', 'expired', 'low_stock')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  item_id TEXT REFERENCES items (id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES batches (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE TABLE notification_state (
  notification_id TEXT NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX idx_notification_state_user ON notification_state (user_id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Last class a batch was notified about, so the same transition is never re-sent.
CREATE TABLE alert_state (
  batch_id TEXT PRIMARY KEY REFERENCES batches (id) ON DELETE CASCADE,
  last_class TEXT NOT NULL CHECK (last_class IN ('safe', 'near_expiry', 'urgent', 'expired')),
  notified_at TEXT NOT NULL
);

CREATE TABLE low_stock_state (
  item_id TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  is_low INTEGER NOT NULL CHECK (is_low IN (0, 1)),
  notified_at TEXT NOT NULL
);

-- Idempotency for scheduled work: one row per (job, facility-local date).
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  run_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  summary TEXT,
  UNIQUE (job, run_date)
);

-- ─── Audit ────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  before TEXT,
  after TEXT,
  ip TEXT
);
CREATE INDEX idx_audit_at ON audit_log (at);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, at);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
