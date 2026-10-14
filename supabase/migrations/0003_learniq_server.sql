-- LearnIQ – pomocné funkcie pre serverovú funkciu learniq a denná kontrola termínov (cenové ponuky).

-- ID účtu podľa e-mailu (pozvánky tímu školiteľa) – iba server (service_role)
create or replace function lq_find_user(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;
revoke execute on function lq_find_user(text) from public, anon, authenticated;
grant execute on function lq_find_user(text) to service_role;
grant execute on function lq_clone_template(uuid) to service_role;

-- Denne o 6:15 (UTC) – návrhy cenových ponúk pre zamestnancov, ktorým o ≤ N pracovných dní končí platnosť oboznámenia
select cron.unschedule('learniq-denne') where exists (select 1 from cron.job where jobname = 'learniq-denne');
select cron.schedule('learniq-denne', '15 6 * * *', $$
  select net.http_post(
    url := 'https://qmkxuirjjuyefcjuxflp.supabase.co/functions/v1/learniq',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.lq_secrets where key = 'cron')),
    body := '{"a":"cron"}'::jsonb,
    timeout_milliseconds := 60000)
$$);
