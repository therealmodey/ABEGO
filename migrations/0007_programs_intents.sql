-- Migration 0007: reseed the program library with 4 intent-based sections
-- (stress / sleep / focus / calm). Re-categorizes the original 6 reference
-- programs and adds 12 new programs (3 per intent) with real breathing
-- patterns. The Library screen groups by `category` and cross-filters via
-- `intents`, so this single table drives both the sections and the pills.

DELETE FROM programs;

INSERT INTO programs (slug, title, category, tag, intents, duration_min, inhale, hold, exhale, cycles, phase, is_premium, is_new, sort_order) VALUES
  -- ---- STRESS ----
  ('478-unwind',        '4-7-8 Unwind',        'stress', 'Stress', 'stress,sleep,calm',    10, 4, 7, 8, 12, 'exhale', 1, 1, 1),
  ('acute-stress-reset','Acute Stress Reset',   'stress', 'Reset',  'stress,calm',           3, 2, 4, 6,  6,  'exhale', 0, 1, 2),
  ('physiological-sigh', 'Physiological Sigh',  'stress', 'Sigh',   'stress,calm,focus',     4, 4, 1, 4,  8,  'inhale', 0, 1, 3),
  ('527-tension',        '5-2-7 Tension Release','stress','Tension', 'stress,sleep',          8, 5, 2, 7, 10,  'exhale', 1, 0, 4),
  -- ---- SLEEP ----
  ('twilight-descent',  'Twilight Descent',    'sleep',  'Sleep',  'sleep,calm',           15, 4, 6, 9, 14,  'hold',   1, 0, 5),
  ('body-scan',         'Body Scan',           'sleep',  'Release', 'sleep,stress,calm',    12, 5, 4, 8, 12,  'exhale', 1, 0, 6),
  ('drift-off',         'Drift Off',           'sleep',  'Sleep',  'sleep,calm',           12, 4, 7, 8, 12,  'exhale', 1, 1, 7),
  ('night-cap',         'Night Cap',           'sleep',  'Wind down','sleep,calm',          5, 4, 2, 6,  8,  'exhale', 0, 1, 8),
  ('body-lull',         'Body-Lull',           'sleep',  'Deep',   'sleep,calm',           18, 5, 5, 10, 14, 'exhale', 1, 0, 9),
  -- ---- FOCUS ----
  ('box-breathing',     'Box Breathing',       'focus',  'Calm',   'calm,focus,stress',     5, 4, 4, 4,  8,  'hold',   0, 0, 10),
  ('alternate-nostril', 'Alternate Nostril',   'focus',  'Balance', 'focus,calm,stress',     8, 5, 3, 6, 10,  'idle',   1, 0, 11),
  ('pre-work-clarity',  'Pre-Work Clarity',    'focus',  'Clarity', 'focus,calm',            4, 4, 4, 4,  6,  'hold',   0, 1, 12),
  ('sharp-breath',      'Sharp Breath',        'focus',  'Focus',   'focus,stress',          6, 6, 2, 4,  8,  'inhale', 1, 1, 13),
  ('deep-work-20',      'Deep Work 20',        'focus',  'Deep',    'focus,calm',           20, 4, 4, 6, 20,  'hold',   1, 0, 14),
  -- ---- CALM ----
  ('first-breath',      'First Breath',        'calm',   'Intro',   'calm',                  3, 4, 2, 4,  6,  'inhale', 0, 0, 15),
  ('grounding-pause',   'Grounding Pause',     'calm',   'Pause',   'calm,stress',           2, 4, 2, 6,  4,  'exhale', 0, 1, 16),
  ('still-point',       'Still Point',         'calm',   'Steady',  'calm,focus',            7, 5, 5, 5,  8,  'idle',   0, 1, 17),
  ('soft-reset',        'Soft Reset',          'calm',   'Reset',   'calm,sleep',           10, 4, 6, 2, 10,  'hold',   1, 1, 18);
