-- PostgreSQL schema (Neon) for the instructor admin product. Mirrors the SQLite
-- migrations 0002 and 0003. Instants are epoch milliseconds (BIGINT, UTC).
--
-- Double-booking protection: under PostgreSQL's default READ COMMITTED isolation
-- two transactions could each check "no overlap" and both insert. Every booking
-- trigger therefore first takes a transaction-scoped advisory lock for the
-- workspace, so overlap checks for one instructor run one at a time and each
-- sees the other's committed rows.
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
 created_ms BIGINT NOT NULL,
 updated_ms BIGINT NOT NULL
);
CREATE TABLE policy_versions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 version INTEGER NOT NULL,
 notice_hours INTEGER NOT NULL,
 policy_text TEXT NOT NULL,
 created_ms BIGINT NOT NULL,
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
 start_ms BIGINT NOT NULL,
 end_ms BIGINT NOT NULL CHECK (end_ms > start_ms),
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
 created_ms BIGINT NOT NULL,
 updated_ms BIGINT NOT NULL
);
CREATE UNIQUE INDEX learner_user_per_ws ON learner_records(workspace_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX learner_user ON learner_records(user_id);
CREATE TABLE learner_notes (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 body TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_ms BIGINT NOT NULL
);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 token_hash TEXT NOT NULL UNIQUE,
 expires_ms BIGINT NOT NULL,
 accepted_ms BIGINT,
 accepted_by TEXT,
 revoked_ms BIGINT,
 created_ms BIGINT NOT NULL
);
CREATE TABLE lesson_series (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 conflict_mode TEXT NOT NULL CHECK (conflict_mode IN ('all_or_nothing','skip_conflicts')),
 skipped TEXT NOT NULL DEFAULT '[]',
 created_ms BIGINT NOT NULL
);
CREATE TABLE lessons (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 series_id TEXT REFERENCES lesson_series(id),
 start_ms BIGINT NOT NULL,
 end_ms BIGINT NOT NULL CHECK (end_ms > start_ms),
 status TEXT NOT NULL CHECK (status IN ('requested','confirmed','completed','cancelled','no_show','declined')),
 transmission TEXT NOT NULL DEFAULT 'manual',
 pickup_location TEXT NOT NULL DEFAULT '',
 price_pence INTEGER NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
 payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','waived')),
 payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','card','other')),
 paid_ms BIGINT,
 policy_version_id TEXT REFERENCES policy_versions(id),
 outside_hours INTEGER NOT NULL DEFAULT 0,
 late_cancellation INTEGER NOT NULL DEFAULT 0,
 cancel_reason TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 created_role TEXT NOT NULL CHECK (created_role IN ('instructor','learner')),
 revision INTEGER NOT NULL DEFAULT 1,
 change_id TEXT NOT NULL,
 created_ms BIGINT NOT NULL,
 updated_ms BIGINT NOT NULL
);
CREATE INDEX lessons_ws_time ON lessons(workspace_id, start_ms);
CREATE INDEX lessons_learner ON lessons(learner_id, start_ms);
CREATE TABLE slot_holds (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 learner_id TEXT NOT NULL REFERENCES learner_records(id),
 start_ms BIGINT NOT NULL,
 end_ms BIGINT NOT NULL CHECK (end_ms > start_ms),
 expires_ms BIGINT NOT NULL,
 created_ms BIGINT NOT NULL
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
 created_ms BIGINT NOT NULL
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
 published_ms BIGINT,
 updated_ms BIGINT NOT NULL
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 workspace_id TEXT,
 lesson_id TEXT,
 lesson_revision INTEGER,
 payload TEXT NOT NULL DEFAULT '{}',
 run_at_ms BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 max_attempts INTEGER NOT NULL DEFAULT 5,
 lease_until_ms BIGINT,
 last_error TEXT,
 result TEXT,
 created_ms BIGINT NOT NULL,
 finished_ms BIGINT
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
 created_ms BIGINT NOT NULL,
 sent_ms BIGINT
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
 created_ms BIGINT NOT NULL
);
CREATE INDEX audit_ws ON audit_log(workspace_id, created_ms);
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY,
 window_start_ms BIGINT NOT NULL,
 count INTEGER NOT NULL
);
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 email TEXT NOT NULL,
 email_verified INTEGER NOT NULL DEFAULT 0,
 name TEXT NOT NULL DEFAULT '',
 created_ms BIGINT NOT NULL,
 last_login_ms BIGINT NOT NULL
);
CREATE INDEX users_email ON users(email);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 expires_ms BIGINT NOT NULL,
 created_ms BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE oauth_states (
 state_hash TEXT PRIMARY KEY,
 code_verifier TEXT NOT NULL,
 nonce TEXT NOT NULL,
 next_path TEXT NOT NULL DEFAULT '/account',
 expires_ms BIGINT NOT NULL
);
CREATE TABLE enquiries (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT,
 name TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '',
 area TEXT NOT NULL DEFAULT '',
 package TEXT NOT NULL DEFAULT '',
 experience TEXT NOT NULL DEFAULT '',
 preferred_times TEXT NOT NULL DEFAULT '',
 message TEXT NOT NULL DEFAULT '',
 contact_consent INTEGER NOT NULL DEFAULT 0,
 marketing_opt_in INTEGER NOT NULL DEFAULT 0,
 source TEXT NOT NULL DEFAULT 'website',
 status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','closed')),
 learner_id TEXT REFERENCES learner_records(id),
 instructor_note TEXT NOT NULL DEFAULT '',
 created_ms BIGINT NOT NULL,
 updated_ms BIGINT NOT NULL
);
CREATE INDEX enquiries_ws ON enquiries(workspace_id, status, created_ms);

-- ---------- booking guards ----------
CREATE FUNCTION lane_now_ms() RETURNS BIGINT LANGUAGE sql VOLATILE AS $$ SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint $$;
CREATE FUNCTION lane_lock_workspace(ws TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtext('lane-workspace:' || ws)); END $$;
-- Checks shared by lessons and holds. self_id excludes the row being changed.
CREATE FUNCTION lane_check_slot(ws TEXT, s BIGINT, e BIGINT, self_id TEXT, check_holds BOOLEAN, check_blocks BOOLEAN) RETURNS void LANGUAGE plpgsql AS $$
DECLARE buf BIGINT;
BEGIN
 SELECT buffer_minutes::bigint * 60000 INTO buf FROM workspaces WHERE id = ws;
 IF EXISTS (SELECT 1 FROM lessons l WHERE l.workspace_id = ws AND l.id <> self_id AND l.status IN ('requested','confirmed') AND l.start_ms < e + buf AND l.end_ms > s - buf) THEN
  RAISE EXCEPTION 'lesson_conflict';
 END IF;
 IF check_holds AND EXISTS (SELECT 1 FROM slot_holds h WHERE h.workspace_id = ws AND h.id <> self_id AND h.expires_ms > lane_now_ms() AND h.start_ms < e + buf AND h.end_ms > s - buf) THEN
  RAISE EXCEPTION 'lesson_held';
 END IF;
 IF check_blocks AND EXISTS (SELECT 1 FROM time_blocks b WHERE b.workspace_id = ws AND b.start_ms < e AND b.end_ms > s) THEN
  RAISE EXCEPTION 'lesson_blocked';
 END IF;
END $$;
CREATE FUNCTION lessons_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE moved BOOLEAN;
BEGIN
 PERFORM lane_lock_workspace(NEW.workspace_id);
 moved := TG_OP = 'INSERT' OR NEW.start_ms <> OLD.start_ms OR NEW.end_ms <> OLD.end_ms;
 PERFORM lane_check_slot(NEW.workspace_id, NEW.start_ms, NEW.end_ms, NEW.id, moved, moved);
 RETURN NEW;
END $$;
CREATE TRIGGER lessons_conflict_insert BEFORE INSERT ON lessons FOR EACH ROW WHEN (NEW.status IN ('requested','confirmed')) EXECUTE FUNCTION lessons_guard();
CREATE TRIGGER lessons_conflict_update BEFORE UPDATE OF start_ms, end_ms, status ON lessons FOR EACH ROW WHEN (NEW.status IN ('requested','confirmed')) EXECUTE FUNCTION lessons_guard();
CREATE FUNCTION holds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM lane_lock_workspace(NEW.workspace_id);
 PERFORM lane_check_slot(NEW.workspace_id, NEW.start_ms, NEW.end_ms, NEW.id, true, true);
 RETURN NEW;
END $$;
CREATE TRIGGER holds_conflict_insert BEFORE INSERT ON slot_holds FOR EACH ROW EXECUTE FUNCTION holds_guard();
CREATE FUNCTION blocks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM lane_lock_workspace(NEW.workspace_id);
 IF EXISTS (SELECT 1 FROM lessons l WHERE l.workspace_id = NEW.workspace_id AND l.status IN ('requested','confirmed') AND l.start_ms < NEW.end_ms AND l.end_ms > NEW.start_ms) THEN
  RAISE EXCEPTION 'block_has_lesson';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blocks_conflict_insert BEFORE INSERT ON time_blocks FOR EACH ROW EXECUTE FUNCTION blocks_guard();
-- A published report cannot be edited in place; withdraw it to draft first.
CREATE FUNCTION reports_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'report_published'; END $$;
CREATE TRIGGER reports_published_immutable BEFORE UPDATE ON lesson_reports FOR EACH ROW WHEN (OLD.status = 'published' AND NEW.status = 'published') EXECUTE FUNCTION reports_guard();
