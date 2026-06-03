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
