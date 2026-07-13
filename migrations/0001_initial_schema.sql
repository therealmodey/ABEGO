-- AURA - Breathing App: initial schema
-- Users & RBAC ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL DEFAULT '',
  goal            TEXT NOT NULL DEFAULT 'relax' CHECK (goal IN ('relax','focus','sleep')),
  baseline_stress INTEGER NOT NULL DEFAULT 5,
  session_length  INTEGER NOT NULL DEFAULT 5,
  prefs_json      TEXT NOT NULL DEFAULT '{}',
  onboarded       INTEGER NOT NULL DEFAULT 0,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Core product entities ------------------------------------------------------
CREATE TABLE IF NOT EXISTS programs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,             -- beginner | deep_calm | sleep_prep
  tag         TEXT NOT NULL DEFAULT '',  -- Intro | Calm | Stress | ...
  duration_min INTEGER NOT NULL,
  inhale      INTEGER NOT NULL,
  hold        INTEGER NOT NULL,
  exhale      INTEGER NOT NULL,
  cycles      INTEGER NOT NULL,
  phase       TEXT NOT NULL DEFAULT 'idle',
  is_premium  INTEGER NOT NULL DEFAULT 0,
  is_new      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id   INTEGER REFERENCES programs(id),
  pattern      TEXT NOT NULL DEFAULT '4-7-8',
  inhale       INTEGER NOT NULL DEFAULT 4,
  hold         INTEGER NOT NULL DEFAULT 7,
  exhale       INTEGER NOT NULL DEFAULT 8,
  cycles_planned  INTEGER NOT NULL DEFAULT 6,
  cycles_done  INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  consistency  REAL NOT NULL DEFAULT 0,   -- 0..100
  calm_delta   INTEGER NOT NULL DEFAULT 0,
  calm_score   INTEGER NOT NULL DEFAULT 0, -- 0..100
  mood_before  TEXT,
  completed    INTEGER NOT NULL DEFAULT 0,
  started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at     DATETIME
);

CREATE TABLE IF NOT EXISTS moods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood       TEXT NOT NULL CHECK (mood IN ('anxious','calm','tired','focused')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Monetization ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','premium')),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due','expired')),
  provider     TEXT CHECK (provider IN ('stripe','paystack')),
  provider_ref TEXT,
  start_date   DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_date     DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id),
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  provider     TEXT NOT NULL CHECK (provider IN ('stripe','paystack')),
  provider_ref TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  description  TEXT NOT NULL DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage metering for feature gating (free-plan limits)
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,               -- YYYY-MM-DD
  metric     TEXT NOT NULL,               -- sessions | ai_suggestions
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, metric)
);

-- Logging / audit ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  meta_json  TEXT NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,              -- role_change | suspend | delete | content_edit ...
  target_type TEXT NOT NULL DEFAULT 'user',
  target_id   INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance: covering indexes for hot query paths ---------------------------
CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_status    ON users(role, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_time   ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_completed ON sessions(user_id, completed, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_moods_user_time      ON moods(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_programs_active      ON programs(active, category, sort_order);
CREATE INDEX IF NOT EXISTS idx_subs_user_status     ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_provider_ref    ON subscriptions(provider_ref);
CREATE INDEX IF NOT EXISTS idx_payments_user_time   ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_activity_user_time   ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_time        ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin_time     ON audit_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_time           ON audit_logs(created_at DESC);
