-- LearnIQ – e-learning BOZP (koncept Keylo). Tabuľky s predponou lq_ v spoločnej databáze Keylo.
-- Každý školiteľ (tenant) je prísne oddelený: všetko stráži RLS cez lq_is_staff() / lq_is_admin().
-- Školený (účastník) nemá účet v databáze – pracuje iba cez serverovú funkciu learniq s vlastným tokenom.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ===================== Školitelia (firmy, ktoré školia) =====================
create table lq_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),     -- obchodné meno (PDF, e-maily, stránka školeného)
  ico text, dic text, ic_dph text, address text, email text, phone text, web text,
  nip_number text,                                                     -- číslo oprávnenia NIP na výchovu a vzdelávanie
  rep_name text,                                                       -- odborný zástupca
  rep_cert text,                                                       -- číslo osvedčenia odborného zástupcu
  color text not null default '#8b5cf6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- podmienky školenia
  study_time_limit boolean not null default true,                      -- minimálny čas štúdia každej témy
  test_time_limit boolean not null default true,                       -- časový limit testu
  test_minutes int not null default 30 check (test_minutes between 5 and 180),
  require_confirm boolean not null default true,                       -- výsledok potvrdzuje osoba s osvedčením
  pass_percent int not null default 75 check (pass_percent between 75 and 100),
  otp_required boolean not null default true,                          -- overenie totožnosti kódom z e-mailu
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  validity_months int not null default 36 check (validity_months between 6 and 60),
  notice_workdays int not null default 30 check (notice_workdays between 5 and 90),
  -- cenník pre automatické cenové ponuky
  price_a numeric(10,2) check (price_a >= 0), price_b numeric(10,2) check (price_b >= 0),
  vat_payer boolean not null default false,
  vat_rate numeric(4,2) not null default 23 check (vat_rate between 0 and 30),
  offer_valid_days int not null default 30 check (offer_valid_days between 1 and 180),
  offer_note text,
  active boolean not null default true,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table lq_platform_admins (user_id uuid primary key references auth.users on delete cascade);

create table lq_staff (
  tenant_id uuid not null references lq_tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'skolitel' check (role in ('spravca', 'skolitel')),
  full_name text not null default '',
  email text,
  cert_no text,                                                        -- osvedčenie (kto potvrdzuje výsledky)
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on lq_staff (user_id);

-- ===================== Kontrolné funkcie (RLS) =====================
create or replace function lq_is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lq_platform_admins where user_id = auth.uid())
$$;
create or replace function lq_is_staff(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lq_staff s join lq_tenants x on x.id = s.tenant_id
                 where s.tenant_id = t and s.user_id = auth.uid() and x.active)
$$;
create or replace function lq_is_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lq_staff s join lq_tenants x on x.id = s.tenant_id
                 where s.tenant_id = t and s.user_id = auth.uid() and s.role = 'spravca' and x.active)
$$;
revoke execute on function lq_is_platform_admin(), lq_is_staff(uuid), lq_is_admin(uuid) from public, anon;
grant execute on function lq_is_platform_admin(), lq_is_staff(uuid), lq_is_admin(uuid) to authenticated;

alter table lq_tenants enable row level security;
alter table lq_platform_admins enable row level security;
alter table lq_staff enable row level security;

create policy lq_tenants_read on lq_tenants for select to authenticated
  using (lq_is_staff(id) or lq_is_platform_admin());
create policy lq_tenants_update on lq_tenants for update to authenticated
  using (lq_is_admin(id) or lq_is_platform_admin()) with check (lq_is_admin(id) or lq_is_platform_admin());
create policy lq_platform_admins_self on lq_platform_admins for select to authenticated
  using (user_id = (select auth.uid()));
create policy lq_staff_read on lq_staff for select to authenticated
  using (lq_is_staff(tenant_id) or lq_is_platform_admin());
create policy lq_staff_update on lq_staff for update to authenticated
  using (lq_is_admin(tenant_id) or user_id = (select auth.uid()))
  with check (lq_is_admin(tenant_id) or user_id = (select auth.uid()));
create policy lq_staff_delete on lq_staff for delete to authenticated
  using (lq_is_admin(tenant_id) and user_id <> (select auth.uid()));

-- Aktívny stav školiteľa mení iba správca aplikácie; rolu a prepojenie člena tímu nemožno podvrhnúť
create or replace function lq_guard_tenant() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.active is distinct from old.active and not lq_is_platform_admin() and auth.uid() is not null then
    raise exception 'Stav školiteľa mení iba správca aplikácie';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Nepovolená zmena';
  end if;
  return new;
end $$;
create trigger lq_tenants_guard before update on lq_tenants for each row execute function lq_guard_tenant();

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
  return new;
end $$;
create trigger lq_staff_guard before update on lq_staff for each row execute function lq_guard_staff();

-- ===================== Obsah kurzu (každý školiteľ má vlastnú kópiu) =====================
create table lq_topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references lq_tenants on delete cascade,
  position int not null check (position between 1 and 50),
  title text not null,
  min_a int not null default 0 check (min_a between 0 and 600),       -- minúty pri vstupnom oboznámení (0 = téma sa nepreberá)
  min_b int not null default 0 check (min_b between 0 and 600),       -- minúty pri opakovanom oboznámení
  html text not null default '',
  updated_at timestamptz not null default now(),
  unique (tenant_id, position)
);
create table lq_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references lq_tenants on delete cascade,
  slot int not null check (slot between 1 and 20),                    -- 1–5 = témy 2–6 (právne predpisy), 6–20 ostatné
  topic_no int,
  variant int,
  text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 3),
  correct int not null check (correct between 0 and 2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on lq_questions (tenant_id, slot);

-- Šablóna (podklady Keylo) – iba server ju kopíruje novému školiteľovi
create table lq_tpl_topics (position int primary key, title text not null, min_a int not null, min_b int not null, html text not null);
create table lq_tpl_questions (id serial primary key, slot int not null, topic_no int, variant int, text text not null, options jsonb not null, correct int not null);

-- ===================== Zákazníci a ich zamestnanci =====================
create table lq_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references lq_tenants on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  ico text, dic text, address text, contact_name text, email text, phone text, note text,
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create table lq_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  first_name text not null, last_name text not null,
  email text, position text,
  last_training_on date, last_kind text check (last_kind in ('A', 'B')),
  valid_until date,                                                    -- do kedy platí oboznámenie
  offered_for date,                                                    -- termín, na ktorý už vznikla cenová ponuka
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (customer_id, tenant_id) references lq_customers (id, tenant_id) on delete restrict
);
create index on lq_employees (tenant_id, customer_id);
create index on lq_employees (tenant_id, valid_until);

-- ===================== Školenia (termíny) a školení =====================
create table lq_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  kind text not null check (kind in ('A', 'B')),
  protocol_no text,                                                    -- číslo školiaceho protokolu (automaticky)
  place text not null default 'e-learning',
  starts_on date not null default current_date,
  due_on date,                                                         -- dokedy treba školenie absolvovať
  lektor_name text,
  rules_text text,                                                     -- vnútorné predpisy a riziká objednávateľa (téma 10)
  open_token text unique,                                              -- spoločný odkaz pre zamestnancov zákazníka
  open_link_enabled boolean not null default false,
  status text not null default 'otvorene' check (status in ('otvorene', 'uzavrete')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (customer_id, tenant_id) references lq_customers (id, tenant_id) on delete restrict
);
create index on lq_sessions (tenant_id, created_at desc);

create table lq_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  employee_id uuid,
  invite_token text unique,
  email text not null,
  first_name text, last_name text, company text, position text,
  status text not null default 'pozvany'
    check (status in ('pozvany', 'overeny', 'studuje', 'test', 'vyhodnotene', 'vyhovel', 'nevyhovel')),
  verified_at timestamptz,
  study_started_at timestamptz, study_done_at timestamptz,
  protocol_path text, protocol_sent_at timestamptz,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (session_id, email),
  foreign key (session_id, tenant_id) references lq_sessions (id, tenant_id) on delete restrict,
  foreign key (employee_id, tenant_id) references lq_employees (id, tenant_id) on delete restrict
);
create index on lq_enrollments (tenant_id, status);
create index on lq_enrollments (employee_id);

create table lq_progress (
  enrollment_id uuid not null references lq_enrollments on delete cascade,
  topic_id uuid not null references lq_topics on delete restrict,
  tenant_id uuid not null references lq_tenants on delete cascade,
  active_seconds int not null default 0,
  started_at timestamptz not null default now(),
  last_beat timestamptz,
  done_at timestamptz,
  primary key (enrollment_id, topic_id)
);
create index on lq_progress (topic_id);
create index on lq_progress (tenant_id);

create table lq_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references lq_tenants on delete cascade,
  enrollment_id uuid not null references lq_enrollments on delete restrict,
  no int not null,
  questions jsonb not null,                                            -- zadanie vrátane správnych odpovedí (archív 10 rokov)
  answers jsonb not null default '[]',
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  correct int, total int, percent numeric(5,2), passed boolean,
  confirmed_by uuid references auth.users on delete set null,
  confirmed_name text, confirmed_cert text, confirmed_at timestamptz,
  note text,
  unique (enrollment_id, no)
);
create index on lq_attempts (tenant_id, submitted_at desc);
create unique index lq_attempts_one_open on lq_attempts (enrollment_id) where submitted_at is null;

-- ===================== Cenové ponuky (pripomienky termínov) =====================
create table lq_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  number text,
  kind text not null default 'B' check (kind in ('A', 'B')),
  items jsonb not null default '[]',                                   -- [{employee_id, name, valid_until}]
  count int not null default 0,
  unit_price numeric(10,2), vat_rate numeric(4,2), total_net numeric(12,2), total_vat numeric(12,2), total numeric(12,2),
  earliest_due date,
  valid_until date,
  status text not null default 'navrh' check (status in ('navrh', 'odoslana', 'zamietnuta')),
  note text,
  pdf_path text,
  approved_by uuid references auth.users on delete set null, approved_at timestamptz, sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (customer_id, tenant_id) references lq_customers (id, tenant_id) on delete restrict
);
create index on lq_offers (tenant_id, status);
create index on lq_offers (customer_id);

-- ===================== Iba server (bez pravidiel RLS) =====================
create table lq_ptokens (                                                -- relácie školených (odtlačok tokenu)
  token_hash text primary key,
  enrollment_id uuid not null references lq_enrollments on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on lq_ptokens (enrollment_id);
create table lq_codes (                                                  -- overovacie kódy z e-mailu
  id uuid primary key default gen_random_uuid(),
  scope text not null,                                                 -- invite:<token> alebo session:<token>
  email text not null,
  code_hash text not null,
  data jsonb,
  tries int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on lq_codes (scope, email);
create table lq_counters (tenant_id uuid not null references lq_tenants on delete cascade, kind text not null, year int not null, n int not null default 0, primary key (tenant_id, kind, year));
create table lq_secrets (key text primary key, value text not null);
insert into lq_secrets values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict do nothing;

create table lq_audit (
  id bigserial primary key,
  tenant_id uuid references lq_tenants on delete cascade,
  actor uuid, action text not null, ref uuid, data jsonb,
  at timestamptz not null default now()
);
create index on lq_audit (tenant_id, at desc);

-- ===================== RLS: dáta školiteľa vidí iba jeho tím =====================
do $$
declare t text;
begin
  foreach t in array array['lq_topics','lq_questions','lq_customers','lq_employees','lq_sessions',
                           'lq_enrollments','lq_progress','lq_attempts','lq_offers','lq_audit',
                           'lq_tpl_topics','lq_tpl_questions','lq_ptokens','lq_codes','lq_counters','lq_secrets'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- obsah kurzu: číta celý tím, mení správca
create policy lq_topics_read on lq_topics for select to authenticated using (lq_is_staff(tenant_id));
create policy lq_topics_write on lq_topics for all to authenticated using (lq_is_admin(tenant_id)) with check (lq_is_admin(tenant_id));
create policy lq_questions_read on lq_questions for select to authenticated using (lq_is_staff(tenant_id));
create policy lq_questions_write on lq_questions for all to authenticated using (lq_is_admin(tenant_id)) with check (lq_is_admin(tenant_id));
-- zákazníci, zamestnanci, školenia: celý tím
create policy lq_customers_all on lq_customers for all to authenticated using (lq_is_staff(tenant_id)) with check (lq_is_staff(tenant_id));
create policy lq_employees_all on lq_employees for all to authenticated using (lq_is_staff(tenant_id)) with check (lq_is_staff(tenant_id));
create policy lq_sessions_all on lq_sessions for all to authenticated using (lq_is_staff(tenant_id)) with check (lq_is_staff(tenant_id));
-- školení: tím ich pozýva a vidí; priebeh a test zapisuje iba server
create policy lq_enrollments_read on lq_enrollments for select to authenticated using (lq_is_staff(tenant_id));
create policy lq_enrollments_insert on lq_enrollments for insert to authenticated with check (lq_is_staff(tenant_id) and status = 'pozvany');
create policy lq_enrollments_delete on lq_enrollments for delete to authenticated
  using (lq_is_staff(tenant_id) and status in ('pozvany', 'overeny'));
create policy lq_progress_read on lq_progress for select to authenticated using (lq_is_staff(tenant_id));
create policy lq_attempts_read on lq_attempts for select to authenticated using (lq_is_staff(tenant_id));
-- ponuky: tím číta, správca upravuje návrh (schválenie a odoslanie robí server)
create policy lq_offers_read on lq_offers for select to authenticated using (lq_is_staff(tenant_id));
create policy lq_offers_update on lq_offers for update to authenticated using (lq_is_admin(tenant_id) and status = 'navrh') with check (lq_is_admin(tenant_id) and status in ('navrh', 'zamietnuta'));
create policy lq_audit_read on lq_audit for select to authenticated using (lq_is_admin(tenant_id));

-- Školenie, zamestnanec a ponuka nemôžu „preskočiť“ k inému školiteľovi
create or replace function lq_guard_tenant_id() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'Záznam nemožno presunúť k inému školiteľovi'; end if;
  return new;
end $$;
create trigger lq_customers_tid before update on lq_customers for each row execute function lq_guard_tenant_id();
create trigger lq_employees_tid before update on lq_employees for each row execute function lq_guard_tenant_id();
create trigger lq_sessions_tid before update on lq_sessions for each row execute function lq_guard_tenant_id();
create trigger lq_offers_tid before update on lq_offers for each row execute function lq_guard_tenant_id();
create trigger lq_topics_tid before update on lq_topics for each row execute function lq_guard_tenant_id();
create trigger lq_questions_tid before update on lq_questions for each row execute function lq_guard_tenant_id();

-- Ponuku z aplikácie možno iba upraviť (cena, poznámka) alebo zamietnuť; sumy sa prepočítajú
create or replace function lq_offer_recalc() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and (new.items is distinct from old.items or new.customer_id is distinct from old.customer_id
     or new.number is distinct from old.number or new.approved_by is distinct from old.approved_by
     or new.sent_at is distinct from old.sent_at or new.pdf_path is distinct from old.pdf_path) then
    raise exception 'Túto časť ponuky nemožno meniť';
  end if;
  new.count := coalesce(jsonb_array_length(new.items), 0);
  new.total_net := round(coalesce(new.unit_price, 0) * new.count, 2);
  new.total_vat := round(new.total_net * coalesce(new.vat_rate, 0) / 100, 2);
  new.total := new.total_net + new.total_vat;
  return new;
end $$;
create trigger lq_offers_recalc before insert or update on lq_offers for each row execute function lq_offer_recalc();

-- ===================== Čísla protokolov a ponúk, tokeny odkazov =====================
create or replace function lq_next_number(t uuid, k text) returns int
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from (now() at time zone 'Europe/Bratislava'))::int; v int;
begin
  insert into lq_counters (tenant_id, kind, year, n) values (t, k, y, 1)
  on conflict (tenant_id, kind, year) do update set n = lq_counters.n + 1
  returning n into v;
  return v;
end $$;
revoke execute on function lq_next_number(uuid, text) from public, anon, authenticated;

create or replace function lq_session_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.protocol_no := extract(year from now())::int || '/' || lpad(lq_next_number(new.tenant_id, 'protokol')::text, 3, '0');
  new.open_token := encode(extensions.gen_random_bytes(18), 'hex');
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.status := 'otvorene';
  return new;
end $$;
create trigger lq_sessions_defaults before insert on lq_sessions for each row execute function lq_session_defaults();

create or replace function lq_enrollment_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.invite_token := encode(extensions.gen_random_bytes(18), 'hex');
  new.email := lower(btrim(new.email));
  if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Neplatný e-mail'; end if;
  return new;
end $$;
create trigger lq_enrollments_defaults before insert on lq_enrollments for each row execute function lq_enrollment_defaults();

create or replace function lq_offer_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.number := 'CP-' || extract(year from now())::int || '-' || lpad(lq_next_number(new.tenant_id, 'ponuka')::text, 3, '0');
  return new;
end $$;
create trigger lq_offers_defaults before insert on lq_offers for each row execute function lq_offer_defaults();

revoke all on function lq_session_defaults(), lq_enrollment_defaults(), lq_offer_defaults(), lq_offer_recalc(),
  lq_guard_tenant_id(), lq_guard_tenant(), lq_guard_staff() from public, anon, authenticated;

-- ===================== Nový školiteľ s kópiou obsahu kurzu (iba správca aplikácie) =====================
create or replace function lq_clone_template(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select name into nm from lq_tenants where id = t;
  insert into lq_topics (tenant_id, position, title, min_a, min_b, html)
  select t, position, title, min_a, min_b, replace(html, 'Keylo s.r.o.', nm) from lq_tpl_topics
  on conflict (tenant_id, position) do nothing;
  if not exists (select 1 from lq_questions where tenant_id = t) then
    insert into lq_questions (tenant_id, slot, topic_no, variant, text, options, correct)
    select t, slot, topic_no, variant, text, options, correct from lq_tpl_questions order by id;
  end if;
end $$;
revoke execute on function lq_clone_template(uuid) from public, anon, authenticated;

create or replace function lq_create_tenant(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not lq_is_platform_admin() then raise exception 'Nového školiteľa zakladá iba správca aplikácie'; end if;
  insert into lq_tenants (name, created_by) values (btrim(p_name), auth.uid()) returning id into t;
  perform lq_clone_template(t);
  insert into lq_audit (tenant_id, actor, action, ref) values (t, auth.uid(), 'skolitel_zalozeny', t);
  return t;
end $$;
revoke execute on function lq_create_tenant(text) from public, anon;
grant execute on function lq_create_tenant(text) to authenticated;

-- Obnova obsahu kurzu zo šablóny (iba správca školiteľa) – nové otázky / témy, ktoré ešte nemá
create or replace function lq_reset_course(t uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not lq_is_admin(t) then raise exception 'Iba správca'; end if;
  perform lq_clone_template(t);
end $$;
revoke execute on function lq_reset_course(uuid) from public, anon;
grant execute on function lq_reset_course(uuid) to authenticated;

-- ===================== Úložisko PDF (protokoly, ponuky) – iba server, tím cez podpísaný odkaz =====================
insert into storage.buckets (id, name, public) values ('learniq', 'learniq', false) on conflict (id) do nothing;
create or replace function lq_storage_staff(obj text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p text := split_part(obj, '/', 1);
begin
  if p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return lq_is_staff(p::uuid);
end $$;
revoke execute on function lq_storage_staff(text) from public, anon;
grant execute on function lq_storage_staff(text) to authenticated;
create policy lq_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'learniq' and lq_storage_staff(name));

-- ===================== Spevnenie existujúcich tabuliek Keylo =====================
-- Účet školiteľa LearnIQ nie je klient ani tím Keylo – nesmie čítať technikov, prístroje ani profily tímu Keylo.
alter policy technicians_read on technicians using (is_staff() or my_client_id() is not null);
alter policy instruments_read on instruments using (is_staff() or my_client_id() is not null);
alter policy profiles_team_visible on profiles
  using ((is_staff() or my_client_id() is not null) and role = any (array['admin'::user_role, 'technik'::user_role]));
