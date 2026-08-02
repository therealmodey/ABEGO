-- Admin control-plane persistence: app config, notification rules, experiments, admin notes

-- Key-value app configuration (AI engine config, feature flags — read by the user app)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,            -- JSON
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER              -- admin user id
);

-- Notification automation rules (admin-managed, persisted state)
CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  body TEXT,
  sent INTEGER DEFAULT 0,
  open_rate REAL DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A/B experiments registry
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Running',  -- Running | Winning | Paused | Complete
  variants INTEGER DEFAULT 2,
  users INTEGER DEFAULT 0,
  lift TEXT DEFAULT '—',
  conf INTEGER DEFAULT 0,
  winner TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin notes on users
CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  admin_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (admin_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_notes(user_id);

-- ---- Seeds (idempotent) ----

-- 8 notification rules (design parity — now real persisted state)
INSERT OR IGNORE INTO notification_rules (id, name, trigger, body, sent, open_rate, enabled) VALUES
  (1, 'Evening unwind',      'stress > 0.7 · 7-10pm',          'Your evening wind-down is ready. 5 minutes to a calmer night.', 82400, 48, 1),
  (2, 'Sleep prep',          'pre-sleep window · no session',  'Twilight Descent is queued for tonight.',                       41800, 52, 1),
  (3, 'Morning intent',      'wake window · streak > 3',       'Set your intention. Start today grounded.',                      24600, 38, 1),
  (4, 'Streak protect',      'streak at risk · 8pm',           'Keep your streak alive — one short session before bed.',         12100, 61, 1),
  (5, 'Weekly insight',      'sunday 6pm',                     'Your week in breaths — see your progress.',                      9400, 44, 1),
  (6, 'Program suggestion',  'AI match > 0.8',                 'A journey matched to your pattern is ready.',                    7200, 42, 1),
  (7, 'Comeback',            'inactive 7d',                    'Your calm is waiting. Pick up where you left off.',              5800, 18, 0),
  (8, 'Premium teaser',      'free · 10+ sessions',            'Unlock every journey with AURA Plus.',                           4100, 22, 0);

-- 6 experiments (design parity; exp_039 is the featured one)
INSERT OR IGNORE INTO experiments (id, name, days, status, variants, users, lift, conf, winner) VALUES
  ('exp_041', 'Onboarding: 1 breath before signup', 6,  'Running',  2, 8420,  '+3.1%',  62, NULL),
  ('exp_040', 'Evening push copy v3',               9,  'Running',  3, 14100, '+6.8%',  88, NULL),
  ('exp_039', 'AI aggression 0.7 vs 0.5',           21, 'Winning',  2, 20180, '+12.6%', 99, NULL),
  ('exp_038', 'Paywall after 5th session',          14, 'Winning',  2, 11300, '+9.2%',  96, NULL),
  ('exp_037', 'Haptic intensity curve',             4,  'Paused',   2, 3900,  '−0.4%',  22, NULL),
  ('exp_036', 'Sleep story narrator B',             30, 'Complete', 2, 18240, '+4.4%',  94, 'B');

-- Default AI engine config (published baseline — user app reads this)
INSERT OR IGNORE INTO app_config (key, value) VALUES ('ai_config', json('{
  "version": "aura-2.4.1",
  "sliders": { "stress_sensitivity": 0.68, "adaptation_speed": 0.45, "hr_weight": 0.72, "history_weight": 0.34, "exploration": 0.12 },
  "flags": { "auto_pacing": true, "hrv_coherence": true, "cross_session": true, "emotion_ambience": false, "llm_guidance": false }
}'));
