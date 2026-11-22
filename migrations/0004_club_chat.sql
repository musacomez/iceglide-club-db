CREATE TABLE IF NOT EXISTS club_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_at TEXT,
  hidden_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_club_chat_visible
ON club_chat_messages(id) WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_chat_author_time
ON club_chat_messages(author_id, created_at);
