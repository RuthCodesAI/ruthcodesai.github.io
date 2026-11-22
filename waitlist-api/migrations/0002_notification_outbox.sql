CREATE TABLE waitlist_notification_outbox (
    event_id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    signup_email TEXT NOT NULL COLLATE NOCASE UNIQUE
        REFERENCES waitlist_signups(email) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'leased', 'sent', 'review')),
    queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
    next_attempt_at INTEGER DEFAULT (unixepoch()),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    first_attempt_at INTEGER,
    lease_token TEXT,
    lease_until INTEGER,
    sent_at INTEGER,
    provider_message_id TEXT,
    CHECK (state <> 'pending' OR next_attempt_at IS NOT NULL),
    CHECK ((attempts = 0) = (first_attempt_at IS NULL)),
    CHECK (
        (state = 'leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
        (state <> 'leased' AND lease_token IS NULL AND lease_until IS NULL)
    ),
    CHECK ((state = 'sent') = (sent_at IS NOT NULL))
);

CREATE INDEX waitlist_notification_due
    ON waitlist_notification_outbox(next_attempt_at, event_id) WHERE state = 'pending';
CREATE INDEX waitlist_notification_expiring
    ON waitlist_notification_outbox(lease_until, event_id) WHERE state = 'leased';

-- A duplicate signup is a no-op at the parent table and never fires this trigger.
CREATE TRIGGER waitlist_signup_enqueue_notification
AFTER INSERT ON waitlist_signups
BEGIN
    INSERT INTO waitlist_notification_outbox(signup_email) VALUES (NEW.email);
END;
