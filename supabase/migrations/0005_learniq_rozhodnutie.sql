-- LearnIQ 0005: rozhodnutie hodnotiteľa VYHOVEL / NEVYHOVEL
-- `passed` = konečný výsledok (po potvrdení hodnotiteľom), `app_passed` = pôvodné vyhodnotenie aplikáciou.
-- Zapisuje iba server (tím nemá UPDATE na lq_attempts).
alter table lq_attempts add column if not exists app_passed boolean;
update lq_attempts set app_passed = passed where app_passed is null and submitted_at is not null;
