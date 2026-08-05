-- Webhook replay / idempotency guard.
-- Payment providers deliver events at-least-once, and a captured event can be
-- replayed by anyone who has seen it. Recording each (provider, event_id) once
-- makes activatePlan effectively idempotent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_unique
  ON webhook_events (provider, event_id);
