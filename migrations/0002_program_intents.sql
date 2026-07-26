-- Guided journey fix: programs were filtered by exact display-tag match,
-- so e.g. "Body Scan" (tag: Release) never appeared under the Sleep filter.
-- Add a proper many-to-many intents field (comma-separated lowercase keys)
-- so each program declares every category it belongs to.
ALTER TABLE programs ADD COLUMN intents TEXT NOT NULL DEFAULT '';

UPDATE programs SET intents = 'calm'                WHERE slug = 'first-breath';
UPDATE programs SET intents = 'calm,focus,stress'   WHERE slug = 'box-breathing';
UPDATE programs SET intents = 'stress,sleep,calm'   WHERE slug = '478-unwind';
UPDATE programs SET intents = 'focus,calm,stress'   WHERE slug = 'alternate-nostril';
UPDATE programs SET intents = 'sleep,calm'          WHERE slug = 'twilight-descent';
UPDATE programs SET intents = 'sleep,stress,calm'   WHERE slug = 'body-scan';
