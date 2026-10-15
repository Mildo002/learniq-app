-- LearnIQ 0004: vlastnoručné podpisy (školený po teste, školiteľ v profile)
-- Obrázky podpisov sú v súkromnom úložisku `learniq` (<tenant>/podpisy/...), cesty zapisuje iba server.

alter table lq_attempts add column if not exists signature_path text;
alter table lq_attempts add column if not exists signed_at timestamptz;
alter table lq_staff add column if not exists signature_path text;

-- Cestu k podpisu člena tímu mení iba server (edge funkcia so service role, auth.uid() je null)
create or replace function lq_guard_staff() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.user_id is distinct from old.user_id then
    raise exception 'Nepovolená zmena';
  end if;
  if auth.uid() is not null and new.role is distinct from old.role then
    if not lq_is_admin(old.tenant_id) then raise exception 'Rolu mení iba správca školiteľa'; end if;
    if old.user_id = auth.uid() then raise exception 'Sám sebe rolu nezmeníte'; end if;
  end if;
  if auth.uid() is not null and new.signature_path is distinct from old.signature_path then
    raise exception 'Podpis sa ukladá iba cez aplikáciu';
  end if;
  return new;
end $$;
revoke all on function lq_guard_staff() from public, anon, authenticated;
