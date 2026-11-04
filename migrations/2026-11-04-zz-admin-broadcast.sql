-- Extend in-app notifications to support admin announcements
ALTER TABLE user_notifications ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS title VARCHAR(120);
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications
  ADD CONSTRAINT user_notifications_type_check
  CHECK (type IN ('follow', 'message', 'announcement'));
