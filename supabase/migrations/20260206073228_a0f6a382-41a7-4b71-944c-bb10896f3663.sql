-- Change defaults for new users: Autopilot ON, Approval OFF
ALTER TABLE public.user_settings 
  ALTER COLUMN autopilot_mode SET DEFAULT true,
  ALTER COLUMN approval_mode SET DEFAULT false;

-- Add pricing plan column
ALTER TABLE public.user_settings
  ADD COLUMN plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN posts_this_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN billing_period_start TIMESTAMP WITH TIME ZONE DEFAULT now();