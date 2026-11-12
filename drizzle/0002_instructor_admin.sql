-- Instructor administration product (Phase A).
-- Additive only: marketplace tables are untouched. All instants are epoch milliseconds (UTC).
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL UNIQUE,
 business_name TEXT NOT NULL,
 contact_email TEXT NOT NULL DEFAULT '',
 timezone TEXT NOT NULL DEFAULT 'Europe/London',
 transmission TEXT NOT NULL DEFAULT 'manual' CHECK (transmission IN ('manual','automatic','both')),
 lesson_minutes INTEGER NOT NULL DEFAULT 60 CHECK (lesson_minutes BETWEEN 30 AND 240),
 lesson_price_pence INTEGER NOT NULL DEFAULT 0 CHECK (lesson_price_pence >= 0),
 buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (buffer_minutes BETWEEN 0 AND 120),
 notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (notice_hours BETWEEN 0 AND 336),
 horizon_days INTEGER NOT NULL DEFAULT 56 CHECK (horizon_days BETWEEN 1 AND 365),
 slot_step_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_step_minutes IN (15,30,60)),
 cancellation_notice_hours INTEGER NOT NULL DEFAULT 48 CHECK (cancellation_notice_hours BETWEEN 0 AND 336),
 policy_version_id TEXT,
 auto_confirm INTEGER NOT NULL DEFAULT 0,
 reminder_offsets TEXT NOT NULL DEFAULT '48,24',
 service_area TEXT NOT NULL DEFAULT '',
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE TABLE policy_versions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 version INTEGER NOT NULL,
 notice_hours INTEGER NOT NULL,
 policy_text TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 UNIQUE (workspace_id, version)
);
CREATE TABLE working_hours (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 start_time TEXT NOT NULL,
 end_time TEXT NOT NULL CHECK (end_time > start_time)
);
CREATE INDEX working_hours_ws ON working_hours(workspace_id, weekday);
CREATE TABLE availability_exceptions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 day TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('closed','hours')),
 start_time TEXT,
 end_time TEXT,
 note TEXT NOT NULL DEFAULT '',
 CHECK (kind = 'closed' OR (start_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX exceptions_ws ON availability_exceptions(workspace_id, day);
CREATE TABLE time_blocks (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
 kind TEXT NOT NULL DEFAULT 'blocked' CHECK (kind IN ('blocked','holiday')),
 reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX blocks_ws ON time_blocks(workspace_id, start_ms);
CREATE TABLE learner_records (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT,
 name TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '',
 preferred_minutes INTEGER,
 transmission TEXT NOT NULL DEFAULT 'manual' CHECK (transmission IN ('manual','automatic')),
 pickup_location TEXT NOT NULL DEFAULT '',
 availability_notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 marketing_opt_in INTEGER NOT NULL DEFAULT 0,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX learner_user_per_ws ON learner_records(workspace_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX learner_user ON learner_records(user_id);
-- Private instructor notes. Never joined into learner-facing queries.
CREATE TABLE learner_notes (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 body TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_ms INTEGER NOT NULL,
 accepted_ms INTEGER,
 accepted_by TEXT,
 revoked_ms INTEGER,
 created_ms INTEGER NOT NULL
);
CREATE TABLE lesson_series (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 conflict_mode TEXT NOT NULL CHECK (conflict_mode IN ('all_or_nothing','skip_conflicts')),
 skipped TEXT NOT NULL DEFAULT '[]',
 created_ms INTEGER NOT NULL
);
CREATE TABLE lessons (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 series_id TEXT REFERENCES lesson_series(id),
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
 status TEXT NOT NULL CHECK (status IN ('requested','confirmed','completed','cancelled','no_show','declined')),
 transmission TEXT NOT NULL DEFAULT 'manual',
 pickup_location TEXT NOT NULL DEFAULT '',
 price_pence INTEGER NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
 payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','waived')),
 payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','card','other')),
 paid_ms INTEGER,
 policy_version_id TEXT REFERENCES policy_versions(id),
 outside_hours INTEGER NOT NULL DEFAULT 0,
 late_cancellation INTEGER NOT NULL DEFAULT 0,
 cancel_reason TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 created_role TEXT NOT NULL CHECK (created_role IN ('instructor','learner')),
 revision INTEGER NOT NULL DEFAULT 1,
 change_id TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE INDEX lessons_ws_time ON lessons(workspace_id, start_ms);
CREATE INDEX lessons_learner ON lessons(learner_id, start_ms);
-- Short-lived reservation while a learner reviews details and cancellation terms.
CREATE TABLE slot_holds (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
 expires_ms INTEGER NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE INDEX holds_ws ON slot_holds(workspace_id, start_ms);
CREATE TABLE lesson_events (
 id TEXT PRIMARY KEY,
 lesson_id TEXT NOT NULL REFERENCES lessons(id),
 workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 action TEXT NOT NULL,
 from_status TEXT,
 to_status TEXT,
 detail TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE INDEX lesson_events_lesson ON lesson_events(lesson_id, created_ms);
CREATE TABLE skills (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 area TEXT NOT NULL,
 name TEXT NOT NULL,
 position INTEGER NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE lesson_reports (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 lesson_id TEXT NOT NULL UNIQUE REFERENCES lessons(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 skills TEXT NOT NULL DEFAULT '[]',
 observations TEXT NOT NULL DEFAULT '',
 next_goals TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
 published_ms INTEGER,
 updated_ms INTEGER NOT NULL
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 workspace_id TEXT,
 lesson_id TEXT,
 lesson_revision INTEGER,
 payload TEXT NOT NULL DEFAULT '{}',
 run_at_ms INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 max_attempts INTEGER NOT NULL DEFAULT 5,
 lease_until_ms INTEGER,
 last_error TEXT,
 result TEXT,
 created_ms INTEGER NOT NULL,
 finished_ms INTEGER
);
CREATE INDEX jobs_due ON jobs(status, run_at_ms);
CREATE INDEX jobs_lesson ON jobs(lesson_id, status);
CREATE TABLE messages (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 workspace_id TEXT,
 lesson_id TEXT,
 channel TEXT NOT NULL DEFAULT 'email',
 category TEXT NOT NULL DEFAULT 'transactional' CHECK (category IN ('transactional','marketing')),
 template TEXT NOT NULL,
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','previewed','failed','skipped')),
 provider TEXT,
 provider_id TEXT,
 redirected_to TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 created_ms INTEGER NOT NULL,
 sent_ms INTEGER
);
CREATE INDEX messages_ws ON messages(workspace_id, created_ms);
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY,
 workspace_id TEXT,
 actor_id TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 action TEXT NOT NULL,
 subject_type TEXT NOT NULL,
 subject_id TEXT,
 detail TEXT NOT NULL DEFAULT '{}',
 created_ms INTEGER NOT NULL
);
CREATE INDEX audit_ws ON audit_log(workspace_id, created_ms);
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY,
 window_start_ms INTEGER NOT NULL,
 count INTEGER NOT NULL
);
-- Atomic overlap protection. Application checks give friendly messages; these
-- triggers are the final guard, so concurrent requests cannot both succeed.
CREATE TRIGGER lessons_conflict_insert BEFORE INSERT ON lessons WHEN NEW.status IN ('requested','confirmed') BEGIN
 SELECT RAISE(ABORT, 'lesson_conflict') WHERE EXISTS (
  SELECT 1 FROM lessons l JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE l.workspace_id = NEW.workspace_id AND l.id <> NEW.id AND l.status IN ('requested','confirmed')
  AND l.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND l.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_held') WHERE EXISTS (
  SELECT 1 FROM slot_holds h JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE h.workspace_id = NEW.workspace_id AND h.expires_ms > CAST(strftime('%s','now') AS INTEGER) * 1000
  AND h.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND h.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_blocked') WHERE EXISTS (
  SELECT 1 FROM time_blocks b WHERE b.workspace_id = NEW.workspace_id AND b.start_ms < NEW.end_ms AND b.end_ms > NEW.start_ms);
END;
CREATE TRIGGER lessons_conflict_update BEFORE UPDATE OF start_ms, end_ms, status ON lessons WHEN NEW.status IN ('requested','confirmed') BEGIN
 SELECT RAISE(ABORT, 'lesson_conflict') WHERE EXISTS (
  SELECT 1 FROM lessons l JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE l.workspace_id = NEW.workspace_id AND l.id <> NEW.id AND l.status IN ('requested','confirmed')
  AND l.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND l.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_held') WHERE (NEW.start_ms <> OLD.start_ms OR NEW.end_ms <> OLD.end_ms) AND EXISTS (
  SELECT 1 FROM slot_holds h JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE h.workspace_id = NEW.workspace_id AND h.expires_ms > CAST(strftime('%s','now') AS INTEGER) * 1000
  AND h.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND h.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_blocked') WHERE (NEW.start_ms <> OLD.start_ms OR NEW.end_ms <> OLD.end_ms) AND EXISTS (
  SELECT 1 FROM time_blocks b WHERE b.workspace_id = NEW.workspace_id AND b.start_ms < NEW.end_ms AND b.end_ms > NEW.start_ms);
END;
CREATE TRIGGER holds_conflict_insert BEFORE INSERT ON slot_holds BEGIN
 SELECT RAISE(ABORT, 'lesson_conflict') WHERE EXISTS (
  SELECT 1 FROM lessons l JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE l.workspace_id = NEW.workspace_id AND l.status IN ('requested','confirmed')
  AND l.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND l.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_held') WHERE EXISTS (
  SELECT 1 FROM slot_holds h JOIN workspaces w ON w.id = NEW.workspace_id
  WHERE h.workspace_id = NEW.workspace_id AND h.id <> NEW.id AND h.expires_ms > CAST(strftime('%s','now') AS INTEGER) * 1000
  AND h.start_ms < NEW.end_ms + w.buffer_minutes * 60000 AND h.end_ms > NEW.start_ms - w.buffer_minutes * 60000);
 SELECT RAISE(ABORT, 'lesson_blocked') WHERE EXISTS (
  SELECT 1 FROM time_blocks b WHERE b.workspace_id = NEW.workspace_id AND b.start_ms < NEW.end_ms AND b.end_ms > NEW.start_ms);
END;
CREATE TRIGGER blocks_conflict_insert BEFORE INSERT ON time_blocks BEGIN
 SELECT RAISE(ABORT, 'block_has_lesson') WHERE EXISTS (
  SELECT 1 FROM lessons l WHERE l.workspace_id = NEW.workspace_id AND l.status IN ('requested','confirmed')
  AND l.start_ms < NEW.end_ms AND l.end_ms > NEW.start_ms);
END;
-- A published report cannot be edited in place; the instructor must withdraw it to draft first.
CREATE TRIGGER reports_published_immutable BEFORE UPDATE ON lesson_reports WHEN OLD.status = 'published' AND NEW.status = 'published' BEGIN
 SELECT RAISE(ABORT, 'report_published');
END;
