BEGIN;

CREATE TABLE IF NOT EXISTS public.pin_likes (
  pin_id BIGINT NOT NULL REFERENCES public.pins(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pin_id, user_id)
);

CREATE INDEX IF NOT EXISTS pin_likes_pin_id_idx ON public.pin_likes (pin_id);
ALTER TABLE public.pin_likes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_pin_engagement(
  p_pin_ids BIGINT[],
  p_viewer_id BIGINT DEFAULT NULL
)
RETURNS TABLE (pin_id BIGINT, like_count BIGINT, liked_by_viewer BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT requested.pin_id,
         COUNT(likes.user_id)::BIGINT AS like_count,
         COALESCE(BOOL_OR(likes.user_id = p_viewer_id), FALSE) AS liked_by_viewer
  FROM UNNEST(p_pin_ids) AS requested(pin_id)
  LEFT JOIN public.pin_likes AS likes ON likes.pin_id = requested.pin_id
  GROUP BY requested.pin_id;
$$;

REVOKE ALL ON FUNCTION public.get_pin_engagement(BIGINT[], BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pin_engagement(BIGINT[], BIGINT) TO service_role;

COMMIT;
