-- Seed: initial admin account (email: admin@aura.app / password: Admin123!)
-- Change the password immediately in production.
INSERT OR IGNORE INTO users (email, password_hash, role, status) VALUES
  ('admin@aura.app', 'pbkdf2$100000$ZESD5J+Pal22T4tB3a4Qdg==$zu7kU0lmC5zvZNP6isiOA96N/vu/pYedqjgkeyrSqLk=', 'admin', 'active');

INSERT OR IGNORE INTO profiles (user_id, display_name, onboarded)
  SELECT id, 'AURA Admin', 1 FROM users WHERE email = 'admin@aura.app';

INSERT OR IGNORE INTO subscriptions (user_id, plan, status)
  SELECT id, 'premium', 'active' FROM users WHERE email = 'admin@aura.app';

-- Program library (from design screen 13)
INSERT OR IGNORE INTO programs (slug, title, category, tag, intents, duration_min, inhale, hold, exhale, cycles, phase, is_premium, is_new, sort_order) VALUES
  ('first-breath',      'First Breath',      'beginner',   'Intro',   'calm',              3,  4, 2, 4,  6, 'inhale', 0, 0, 1),
  ('box-breathing',     'Box Breathing',     'beginner',   'Calm',    'calm,focus,stress', 5,  4, 4, 4,  8, 'hold',   0, 0, 2),
  ('478-unwind',        '4-7-8 Unwind',      'deep_calm',  'Stress',  'stress,sleep,calm', 10, 4, 7, 8,  12,'exhale', 1, 1, 3),
  ('alternate-nostril', 'Alternate Nostril', 'deep_calm',  'Balance', 'focus,calm,stress', 8,  5, 3, 6,  10,'idle',   1, 0, 4),
  ('twilight-descent',  'Twilight Descent',  'sleep_prep', 'Sleep',   'sleep,calm',        15, 4, 6, 9,  14,'hold',   1, 0, 5),
  ('body-scan',         'Body Scan',         'sleep_prep', 'Release', 'sleep,stress,calm', 12, 5, 4, 8,  12,'exhale', 1, 0, 6);
