-- Supabase Schema for newhal

-- 1. users tablosu
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  google_id VARCHAR UNIQUE,
  name VARCHAR,
  email VARCHAR,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. categories tablosu
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  icon VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- İlk kategorilerin eklenmesi
INSERT INTO categories (name, icon) VALUES 
  ('Genel', '📦'),
  ('Sebze & Meyve', '🥦'),
  ('Bakliyat', '🌾'),
  ('Kuru Gıda', '🏪'),
  ('Balık', '🐟'),
  ('Et & Tavuk', '🥩');

-- 3. pins tablosu
CREATE TABLE IF NOT EXISTS pins (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR NOT NULL,
  address VARCHAR NOT NULL,
  phone VARCHAR,
  website VARCHAR,
  email VARCHAR,
  lat FLOAT8 NOT NULL,
  lng FLOAT8 NOT NULL,
  category VARCHAR DEFAULT 'Genel',
  status VARCHAR DEFAULT 'pending',
  reject_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- 4. pin_comments tablosu
CREATE TABLE IF NOT EXISTS pin_comments (
  id BIGSERIAL PRIMARY KEY,
  pin_id BIGINT REFERENCES pins(id) ON DELETE CASCADE,
  nickname VARCHAR,
  ip VARCHAR,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. reports tablosu
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  pin_id BIGINT REFERENCES pins(id) ON DELETE CASCADE,
  ip VARCHAR,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. chat_messages tablosu
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  nickname VARCHAR,
  ip VARCHAR,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. logs tablosu
CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. site_stats tablosu (ziyaret sayacı)
CREATE TABLE IF NOT EXISTS site_stats (
  id BIGSERIAL PRIMARY KEY,
  visits BIGINT DEFAULT 0
);

-- Başlangıç sayacını ekle
INSERT INTO site_stats (id, visits) VALUES (1, 0);

-- 9. Güvenlik: tablolar sadece sunucunun gizli anahtarıyla erişilebilir.
-- Kural (policy) eklenmediği için herkese açık anahtar hiçbir satırı göremez/değiştiremez.
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_comments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_stats     ENABLE ROW LEVEL SECURITY;

-- 11. Kullanıcı takibi ve özel mesajlar
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS user_follows_following_idx ON user_follows (following_id, created_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id),
  CHECK (char_length(btrim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx ON direct_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_idx ON direct_messages (recipient_id, created_at DESC);
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('follow', 'message', 'announcement')),
  entity_id BIGINT REFERENCES direct_messages(id) ON DELETE CASCADE,
  title VARCHAR(120),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_notifications_recipient_idx
  ON user_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- 12. Para Puan ve tek seferlik referans ödülleri
CREATE TABLE IF NOT EXISTS newhal_points_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason VARCHAR(32) NOT NULL CHECK (reason IN ('daily_login', 'referral', 'admin_credit')),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_by VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS newhal_points_ledger_user_idx
  ON newhal_points_ledger (user_id, created_at DESC);
ALTER TABLE newhal_points_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS newhal_referrals (
  referred_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referred_id <> referrer_id)
);
CREATE INDEX IF NOT EXISTS newhal_referrals_referrer_idx
  ON newhal_referrals (referrer_id, created_at DESC);
ALTER TABLE newhal_referrals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION newhal_award_daily_login(p_user_id BIGINT, p_day_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE inserted_id BIGINT;
BEGIN
  IF p_day_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid day key';
  END IF;
  INSERT INTO newhal_points_ledger (user_id, amount, reason, idempotency_key)
  VALUES (p_user_id, 100, 'daily_login', 'login:' || p_user_id::TEXT || ':' || p_day_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION newhal_award_referral(p_referrer_id BIGINT, p_referred_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE referral_id BIGINT;
BEGIN
  IF p_referrer_id = p_referred_id THEN
    RETURN FALSE;
  END IF;
  INSERT INTO newhal_referrals (referrer_id, referred_id)
  VALUES (p_referrer_id, p_referred_id)
  ON CONFLICT (referred_id) DO NOTHING
  RETURNING referred_id INTO referral_id;
  IF referral_id IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO newhal_points_ledger (user_id, amount, reason, idempotency_key)
  VALUES (p_referrer_id, 100, 'referral', 'referral:' || p_referred_id::TEXT)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION newhal_award_daily_login(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION newhal_award_referral(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION newhal_award_daily_login(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION newhal_award_referral(BIGINT, BIGINT) TO service_role;

-- 10. Ürünler ve fotoğraflar
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS sells    JSONB DEFAULT '[]'::jsonb,   -- sattığı ürünler
  ADD COLUMN IF NOT EXISTS seeks    JSONB DEFAULT '[]'::jsonb,   -- aradığı ürünler
  ADD COLUMN IF NOT EXISTS images   JSONB DEFAULT '[]'::jsonb,   -- fotoğraf adresleri
  ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- Fotoğraf deposu: herkes okuyabilir, yükleme sadece sunucu üzerinden
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pin-images', 'pin-images', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
