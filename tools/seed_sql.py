"""Zo supabase/seed/kurz_01_1.json vyrobí migráciu so šablónou kurzu 01.1 (témy, minúty, 300 otázok s kľúčom)."""
import json, sys, re
d = json.load(open(sys.argv[1], encoding="utf-8"))
MIN_A = [5, 25, 60, 15, 15, 15, 10, 15, 45, 35, 0]
MIN_B = [5, 15, 35, 10, 10, 10, 5, 10, 35, 30, 15]
def q(s):  # bezpečný literál
    tag = "$lq$"
    assert tag not in s
    return f"{tag}{s}{tag}"
out = ["-- LearnIQ – šablóna kurzu 01.1 podľa podkladov Keylo (Obsah školenia, Testy 15 variantov, Kľúč). Vygenerované tools/seed_sql.py.",
       "truncate lq_tpl_topics; truncate lq_tpl_questions restart identity;"]
def mini(h):
    h = re.sub(r'<colgroup>.*?</colgroup>', '', h)
    h = re.sub(r'>\s+<', '><', h)
    return h.replace(' class="odd"', '').replace(' class="header"', '')
for t in d["topics"]:
    t["html"] = mini(t["html"])
for i, t in enumerate(d["topics"]):
    out.append(f"insert into lq_tpl_topics values ({i+1}, {q(t['title'])}, {MIN_A[i]}, {MIN_B[i]}, {q(t['html'])});")
rows = []
for x in d["questions"]:
    topic = x["slot"] + 1 if x["slot"] <= 5 else None
    rows.append(f"({x['slot']}, {topic if topic else 'null'}, {x['variant']}, {q(x['text'])}, {q(json.dumps(x['options'], ensure_ascii=False))}::jsonb, {x['correct']})")
out.append("insert into lq_tpl_questions (slot, topic_no, variant, text, options, correct) values\n" + ",\n".join(rows) + ";")
out.append("""
-- Prvý školiteľ: Keylo s.r.o., správca aplikácie a jeho správca = účet keylo@keylo.sk
do $$
declare t uuid; u uuid;
begin
  select id into u from auth.users where email = 'keylo@keylo.sk';
  select id into t from lq_tenants where name = 'Keylo s.r.o.';
  if t is null then
    insert into lq_tenants (name, email, web, created_by) values ('Keylo s.r.o.', 'keylo@keylo.sk', 'keylo.sk', u) returning id into t;
  end if;
  perform lq_clone_template(t);
  if u is not null then
    insert into lq_platform_admins values (u) on conflict do nothing;
    insert into lq_staff (tenant_id, user_id, role, full_name, email)
    values (t, u, 'spravca', 'Keylo – správca', 'keylo@keylo.sk') on conflict do nothing;
  end if;
end $$;""")
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(out) + "\n")
print("ok", len(d["topics"]), "tém,", len(d["questions"]), "otázok")
