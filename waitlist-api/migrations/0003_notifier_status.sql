-- The private Workspace trigger updates this heartbeat when it polls for work.
CREATE TABLE waitlist_notifier_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_poll_at INTEGER NOT NULL
);
