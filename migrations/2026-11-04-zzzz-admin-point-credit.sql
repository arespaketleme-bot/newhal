-- Allow admin point credits and record which admin issued them.
ALTER TABLE newhal_points_ledger
  DROP CONSTRAINT IF EXISTS newhal_points_ledger_reason_check;
ALTER TABLE newhal_points_ledger
  ADD CONSTRAINT newhal_points_ledger_reason_check
  CHECK (reason IN ('daily_login', 'referral', 'admin_credit'));
ALTER TABLE newhal_points_ledger
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(80);
