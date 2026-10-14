# Pokyny pre Claude – LearnIQ

- Komunikuj po slovensky, celé rozhranie je po slovensky.
- LearnIQ = e-learning BOZP (činnosť 01.1) ako samostatná aplikácia v koncepte Keylo. Statická PWA bez zostavovania:
  `index.html` + `app.js` (školiteľ, správca, platforma), `kurz.html` + `kurz.js` (školený), `util.js`, `styles.css`, `config.js`.
  Supabase JS z CDN (`cdn.jsdelivr.net`). Žiadny npm ani build krok.
- Pri každej zmene JS/CSS zvýš `APP_VERSION` v `config.js`.
- White-label: viac školiteľov (`lq_tenants`) – každý pod vlastnou firmou. Oddelenie stráži RLS (`lq_is_staff`, `lq_is_admin`,
  `lq_is_platform_admin`), nie obrazovka. Prístup iba pozvánkou (správca školiteľa alebo správca platformy) – žiadna registrácia.

## Infraštruktúra
| Čo | Kde |
|---|---|
| Repozitár | GitHub `keyloproject/LearnIQ`, vetva `main` |
| Hosting | Vercel – projekt `learniq` (push do `main` = nasadenie) |
| Databáza | Supabase projekt Keylo `qmkxuirjjuyefcjuxflp` (tabuľky s predponou `lq_`) |

## Databáza
- Zmeny iba ako nový súbor `supabase/migrations/000N_popis.sql`, aplikovať cez Supabase konektor, skontrolovať `get_advisors`.
- Každá tabuľka má `tenant_id`; školení nemajú účty – pristupujú iba cez edge funkciu (tokeny v `lq_ptokens`, SHA-256).
- Výsledok testu, protokol, odoslanie ponuky robí iba server (tím nemá UPDATE na `lq_attempts` / `lq_enrollments`).
- Šablóna kurzu: `lq_tpl_topics` (11 tém) + `lq_tpl_questions` (300 otázok, 20 okruhov × 15 variantov). Nový školiteľ dostane kópiu.

## Edge funkcia `learniq` (verify_jwt vypnuté – vlastné overenie)
- Školený: `p_open`, `p_code` (6-miestny kód e-mailom), `p_verify`, `p_state`, `p_topic`, `p_beat` (aktívny čas, signál á 30 s),
  `p_done`, `p_test` (náhodný test: z každého okruhu 1 otázka, premiešané odpovede), `p_answer`, `p_submit`.
- Tím: `a_status`, `a_invite_staff` (odkaz `/#/pozvanka?t=<hashed_token>` → verifyOtp → heslo), `a_create_tenant` (iba platforma),
  `a_invites`, `a_confirm` (potvrdenie výsledku → PDF protokol → e-mail školenému + kópia zákazníkovi), `a_protocol`, `a_offer`, `a_daily`.
- `cron`: pg_cron `learniq-denne` 6:15 UTC, hlavička `x-cron-secret` z `lq_secrets` → návrhy CP `notice_workdays` pracovných dní
  pred koncom platnosti (sviatky SR v funkcii), e-mail správcom. Ponuka odíde až po schválení.
- PDF: `pdf.ts` (pdf-lib + DejaVu Sans z jsdelivr). Úložisko `learniq` (súkromné), cesta `<tenant>/protokoly|ponuky/…`.
- Tajomstvá (Supabase → Edge Functions → Secrets, zadáva majiteľ): `RESEND_API_KEY`, `LEARNIQ_FROM_ADDRESS`, `LEARNIQ_APP_URL`.
- Test z databázy: `net.http_post` na `/functions/v1/learniq`, odpoveď v `net._http_response` (čítať v ďalšom dotaze).

## Pracovný postup
1. Zadanie zopakuj vlastnými slovami; ak je nejasné, jedna otázka.
2. Commity po slovensky. Na konci: čo pribudlo, ako to vyskúšať, čo musí urobiť majiteľ.
