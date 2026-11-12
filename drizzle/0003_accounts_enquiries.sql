-- Google sign-in accounts, server-side sessions and public website enquiries.
CREATE TABLE users (
 id TEXT PRIMARY KEY,               -- 'google:<sub>'
 provider TEXT NOT NULL,
 email TEXT NOT NULL,
 email_verified INTEGER NOT NULL DEFAULT 0,
 name TEXT NOT NULL DEFAULT '',
 created_ms INTEGER NOT NULL,
 last_login_ms INTEGER NOT NULL
);
CREATE INDEX users_email ON users(email);
-- Only a SHA-256 hash of each session token is stored.
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 expires_ms INTEGER NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
-- One-time OAuth state (CSRF), PKCE verifier and nonce. Consumed on callback.
CREATE TABLE oauth_states (
 state_hash TEXT PRIMARY KEY,
 code_verifier TEXT NOT NULL,
 nonce TEXT NOT NULL,
 next_path TEXT NOT NULL DEFAULT '/account',
 expires_ms INTEGER NOT NULL
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
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE INDEX enquiries_ws ON enquiries(workspace_id, status, created_ms);
