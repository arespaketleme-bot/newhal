-- Daily login rewards and one-time referral rewards for NewHal
CREATE TABLE IF NOT EXISTS newhal_points_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason VARCHAR(32) NOT NULL CHECK (reason IN ('daily_login', 'referral')),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
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
