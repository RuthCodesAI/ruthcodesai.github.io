CREATE TABLE waitlist_signups (
    email TEXT NOT NULL PRIMARY KEY COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    consent_version TEXT NOT NULL,
    consent_text TEXT NOT NULL
);
