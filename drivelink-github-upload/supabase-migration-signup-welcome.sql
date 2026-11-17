-- One-time welcome email for new accounts (send-signup-welcome edge function).
-- Two nullable columns; existing rows stay NULL. The function's scheduled run
-- only looks at accounts created after its LAUNCH date, so this never emails
-- the existing user base.
alter table public.users
  add column if not exists welcome_claimed_at timestamptz,
  add column if not exists welcome_sent_at timestamptz;

-- Schedule (run after the function is deployed):
-- select cron.schedule('send-signup-welcome', '*/10 * * * *', $$
--   select net.http_post(
--     url := 'https://ykzovtfwcjkaigwznrsi.supabase.co/functions/v1/send-signup-welcome',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
--     body := '{}'::jsonb
--   );
-- $$);
