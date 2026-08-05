-- Seed: reference content only.
--
-- SECURITY: no admin account is seeded here. Shipping a known email/password
-- pair in the repo means anyone reading it owns every deployment that ran the
-- seed. Create the first admin instead with:
--
--   node scripts/bootstrap-admin.mjs you@example.com 'a-strong-password'
--
-- and run the SQL it prints against your database.

-- Program library (from design screen 13)
INSERT OR IGNORE INTO programs (slug, title, category, tag, intents, duration_min, inhale, hold, exhale, cycles, phase, is_premium, is_new, sort_order) VALUES
  ('first-breath',      'First Breath',      'beginner',   'Intro',   'calm',              3,  4, 2, 4,  6, 'inhale', 0, 0, 1),
  ('box-breathing',     'Box Breathing',     'beginner',   'Calm',    'calm,focus,stress', 5,  4, 4, 4,  8, 'hold',   0, 0, 2),
  ('478-unwind',        '4-7-8 Unwind',      'deep_calm',  'Stress',  'stress,sleep,calm', 10, 4, 7, 8,  12,'exhale', 1, 1, 3),
  ('alternate-nostril', 'Alternate Nostril', 'deep_calm',  'Balance', 'focus,calm,stress', 8,  5, 3, 6,  10,'idle',   1, 0, 4),
  ('twilight-descent',  'Twilight Descent',  'sleep_prep', 'Sleep',   'sleep,calm',        15, 4, 6, 9,  14,'hold',   1, 0, 5),
  ('body-scan',         'Body Scan',         'sleep_prep', 'Release', 'sleep,stress,calm', 12, 5, 4, 8,  12,'exhale', 1, 0, 6);
