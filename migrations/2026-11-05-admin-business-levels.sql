BEGIN;

ALTER TABLE public.pins
  ADD COLUMN IF NOT EXISTS admin_level_bonus INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.adjust_pin_level_bonus(
  p_pin_id BIGINT,
  p_delta INTEGER
)
RETURNS INTEGER
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pins
  SET admin_level_bonus = GREATEST(0, LEAST(99, COALESCE(admin_level_bonus, 0) + p_delta))
  WHERE id = p_pin_id
  RETURNING admin_level_bonus;
$$;

REVOKE ALL ON FUNCTION public.adjust_pin_level_bonus(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_pin_level_bonus(BIGINT, INTEGER) TO service_role;

COMMIT;
