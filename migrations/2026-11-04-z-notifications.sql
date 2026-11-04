-- NewHal in-app notifications for new followers and private messages
CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('follow', 'message')),
  entity_id BIGINT REFERENCES direct_messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_notifications_recipient_idx
  ON user_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
