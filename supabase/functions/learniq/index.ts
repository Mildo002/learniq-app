// LearnIQ – serverová funkcia (verify_jwt vypnuté – vlastné overenie):
//  • školený: token z pozvánky / spoločného odkazu → kód z e-mailu → relačný token (x-lq-token), štúdium, test
//  • tím školiteľa: JWT prihláseného používateľa + členstvo v lq_staff (pozvánky, potvrdenie výsledku, PDF, ponuky)
//  • denná úloha: {"a":"cron"} + x-cron-secret (pg_cron) → návrhy cenových ponúk 30 pracovných dní pred koncom platnosti
import { createClient } from "npm:@supabase/supabase-js@2";
import { protocolPdf, offerPdf, fmtDate, fmtDateTime, eur, type Tenant } from "./pdf.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lq-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class Fail extends Error { constructor(m: string, public status = 400) { super(m); } }
const must = <T>(v: T | null | undefined, m: string, status = 404): T => { if (v == null) throw new Fail(m, status); return v; };

/* ---------------- pomocné ---------------- */
const enc = new TextEncoder();
async function sha(s: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const rand = (n = 32) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const clean = (s: unknown, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, m = "Neplatný identifikátor") => { const s = String(v ?? ""); if (!UUID.test(s)) throw new Fail(m); return s; };
const tok = (v: unknown) => { const s = String(v ?? ""); if (!/^[a-f0-9]{24,80}$/.test(s)) throw new Fail("Neplatný odkaz", 404); return s; };

/* dátumy a pracovné dni (Slovensko) */
function localToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const parseD = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoD = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return isoD(d); };
function addMonths(s: string, n: number) {
  const d = parseD(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return isoD(d);
}
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoD(new Date(Date.UTC(y, month - 1, day)));
}
function isHoliday(s: string) {
  const y = Number(s.slice(0, 4)), md = s.slice(5);
  if (["01-01", "01-06", "05-01", "07-05", "08-29", "11-01", "12-24", "12-25", "12-26"].includes(md)) return true;
  if (["05-08", "09-15"].includes(md) && y !== 2026) return true; // v roku 2026 výnimočne pracovné dni
  const e = easter(y);
  return s === addDays(e, -2) || s === addDays(e, 1);
}
const isWorkday = (s: string) => { const w = parseD(s).getUTCDay(); return w !== 0 && w !== 6 && !isHoliday(s); };
function addWorkdays(s: string, n: number) { let d = s, k = 0; while (k < n) { d = addDays(d, 1); if (isWorkday(d)) k++; } return d; }

/* adresa aplikácie pre odkazy v e-mailoch */
const DEFAULT_APP = "https://learniq-seven.vercel.app";
function appUrl(req: Request, body: Record<string, unknown>) {
  const env = Deno.env.get("LEARNIQ_APP_URL");
  if (env) return env.replace(/\/+$/, "");
  const cand = String(body.app || req.headers.get("origin") || "");
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(cand)) return cand;
  return DEFAULT_APP;
}

/* ---------------- e-mail (Resend) ---------------- */
const emailReady = () => !!Deno.env.get("RESEND_API_KEY");
async function sendMail(t: Tenant, to: string[], subject: string, html: string, attachments: { filename: string; content: Uint8Array }[] = []) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, reason: "email_off" };
  const addr = Deno.env.get("LEARNIQ_FROM_ADDRESS") || "learniq@keylo.sk";
  const fromName = t.name.replace(/[<>"]/g, "");
  const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${addr}>`, to, subject, html: mailLayout(t, html),
      ...(t.email ? { reply_to: t.email } : {}),
      ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: b64(a.content) })) } : {}),
    }),
  });
  if (!res.ok) { console.error("Resend", res.status, await res.text()); return { ok: false, reason: "email_error" }; }
  return { ok: true };
}
function mailLayout(t: Tenant, inner: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1c24">
  <div style="border-top:5px solid ${t.color};padding:18px 0 6px"><b style="font-size:17px">${escHtml(t.name)}</b></div>
  <div style="font-size:15px;line-height:1.5">${inner}</div>
  <p style="color:#777;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:10px">${escHtml(t.name)}${t.nip_number ? ` · oprávnenie NIP č. ${escHtml(t.nip_number)}` : ""}${t.email ? ` · ${escHtml(t.email)}` : ""}${t.phone ? ` · ${escHtml(t.phone)}` : ""}<br>E-learning BOZP v aplikácii LearnIQ</p></div>`;
}
const button = (href: string, label: string, color: string) =>
  `<p style="margin:22px 0"><a href="${escHtml(href)}" style="background:${color};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escHtml(label)}</a></p>`;

/* ---------------- spoločné načítanie ---------------- */
const TENANT_COLS = "id,name,ico,dic,ic_dph,address,email,phone,web,nip_number,rep_name,rep_cert,color,study_time_limit,test_time_limit,test_minutes,require_confirm,pass_percent,otp_required,max_attempts,validity_months,notice_workdays,price_a,price_b,vat_payer,vat_rate,offer_valid_days,offer_note,active";
async function tenantById(id: string) {
  const { data } = await db.from("lq_tenants").select(TENANT_COLS).eq("id", id).single();
  const t = must(data, "Školiteľ neexistuje");
  if (!t.active) throw new Fail("Školiteľ momentálne nie je aktívny", 403);
  return t as Tenant & Record<string, any>;
}
const brand = (t: any) => ({ name: t.name, color: t.color, nip_number: t.nip_number, email: t.email, phone: t.phone, web: t.web });
function topicMinutes(tp: any, kind: string) { return kind === "A" ? tp.min_a : tp.min_b; }

/** HTML témy pre školeného: odstráni žlté miesta „doplniť podľa objednávateľa“, zvyšok ponechá. */
function participantHtml(html: string) {
  return html
    .replace(/<mark>([\s\S]*?)<\/mark>/g, (_m, inner: string) => {
      const txt = inner.replace(/<[^>]+>/g, "");
      return /\.\.\.|…|doplniť|iba ak sa týka|výber pre objednávateľa/i.test(txt) ? "" : inner;
    })
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "");
}

/* ======================================================================
   ŠKOLENÝ
   ====================================================================== */
async function openLink(body: any) {
  if (body.inv) {
    const { data: en } = await db.from("lq_enrollments").select("id,tenant_id,session_id,email,first_name,last_name,company,status").eq("invite_token", tok(body.inv)).maybeSingle();
    const e = must(en, "Odkaz na školenie neplatí. Požiadajte školiteľa o nový.");
    const { data: s } = await db.from("lq_sessions").select("id,kind,customer_id,protocol_no,due_on,status").eq("id", e.session_id).single();
    return { kind: "inv" as const, scope: `inv:${body.inv}`, enrollment: e, session: s!, tenant: await tenantById(e.tenant_id) };
  }
  if (body.ses) {
    const { data: s } = await db.from("lq_sessions").select("id,tenant_id,kind,customer_id,protocol_no,due_on,status,open_link_enabled").eq("open_token", tok(body.ses)).maybeSingle();
    const ss = must(s, "Odkaz na školenie neplatí. Požiadajte školiteľa o nový.");
    if (!ss.open_link_enabled) throw new Fail("Spoločný odkaz na toto školenie je vypnutý. Požiadajte školiteľa o osobnú pozvánku.", 403);
    return { kind: "ses" as const, scope: `ses:${body.ses}`, enrollment: null, session: ss, tenant: await tenantById(ss.tenant_id) };
  }
  throw new Fail("Chýba odkaz na školenie");
}

async function pOpen(body: any) {
  const l = await openLink(body);
  const { data: c } = await db.from("lq_customers").select("name").eq("id", l.session.customer_id).single();
  if (l.session.status !== "otvorene" && !(l.enrollment && ["vyhovel", "nevyhovel"].includes(l.enrollment.status))) throw new Fail("Toto školenie je už uzavreté.", 403);
  return {
    tenant: brand(l.tenant), otp: l.tenant.otp_required, email_ready: emailReady(),
    session: { kind: l.session.kind, customer: c?.name, protocol_no: l.session.protocol_no, due_on: l.session.due_on },
    prefill: l.enrollment ? { email: l.enrollment.email, first_name: l.enrollment.first_name, last_name: l.enrollment.last_name, company: l.enrollment.company || c?.name } : { company: c?.name },
  };
}

function identity(body: any) {
  const email = clean(body.email, 200).toLowerCase(), first = clean(body.first_name, 80), last = clean(body.last_name, 80), company = clean(body.company, 200);
  if (!isEmail(email)) throw new Fail("Zadajte platný e-mail.");
  if (first.length < 2 || last.length < 2) throw new Fail("Zadajte meno a priezvisko.");
  if (company.length < 2) throw new Fail("Zadajte firmu, v ktorej pracujete.");
  return { email, first, last, company };
}

async function pCode(body: any) {
  const l = await openLink(body);
  const id = identity(body);
  if (l.enrollment && l.enrollment.email !== id.email) throw new Fail("Tento odkaz bol vytvorený pre inú e-mailovú adresu. Zadajte e-mail, na ktorý vám prišla pozvánka.");
  if (!l.tenant.otp_required) return { token: await finishVerify(l, id), skipped: true };
  if (!emailReady()) throw new Fail("Odosielanie e-mailov ešte nie je nastavené. Kontaktujte školiteľa.", 503);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("lq_codes").select("id", { count: "exact", head: true }).eq("scope", l.scope).eq("email", id.email).gt("created_at", since);
  if ((count || 0) >= 5) throw new Fail("Príliš veľa pokusov. Skúste to o hodinu.", 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await db.from("lq_codes").insert({ scope: l.scope, email: id.email, code_hash: await sha(`${code}:${l.scope}:${id.email}`), data: id, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
  const r = await sendMail(l.tenant, [id.email], `Overovací kód: ${code}`,
    `<p>Dobrý deň, ${escHtml(id.first)},</p><p>váš kód na overenie totožnosti pred školením BOZP je:</p>
     <p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:16px 0">${code}</p>
     <p>Kód platí 15 minút. Ak ste o kód nežiadali, e-mail ignorujte.</p>`);
  if (!r.ok) throw new Fail("E-mail s kódom sa nepodarilo odoslať. Skúste to znova.", 502);
  return { sent: true };
}

async function pVerify(body: any) {
  const l = await openLink(body);
  const id = identity(body);
  if (l.enrollment && l.enrollment.email !== id.email) throw new Fail("Tento odkaz bol vytvorený pre inú e-mailovú adresu.");
  const code = String(body.code ?? "").replace(/\D/g, "");
  const { data: rows } = await db.from("lq_codes").select("*").eq("scope", l.scope).eq("email", id.email).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) throw new Fail("Kód vypršal. Požiadajte o nový.");
  if (row.tries >= 5) throw new Fail("Príliš veľa nesprávnych pokusov. Požiadajte o nový kód.", 429);
  if (row.code_hash !== await sha(`${code}:${l.scope}:${id.email}`)) {
    await db.from("lq_codes").update({ tries: row.tries + 1 }).eq("id", row.id);
    throw new Fail("Nesprávny kód.");
  }
  await db.from("lq_codes").delete().eq("scope", l.scope).eq("email", id.email);
  return { token: await finishVerify(l, id) };
}

async function finishVerify(l: Awaited<ReturnType<typeof openLink>>, id: ReturnType<typeof identity>) {
  const s = l.session;
  if (s.status !== "otvorene") throw new Fail("Toto školenie je už uzavreté.", 403);
  let enrollmentId: string;
  if (l.enrollment) {
    enrollmentId = l.enrollment.id;
    const upd: Record<string, unknown> = { first_name: id.first, last_name: id.last, company: id.company, verified_at: new Date().toISOString() };
    if (l.enrollment.status === "pozvany") upd.status = "overeny";
    await db.from("lq_enrollments").update(upd).eq("id", enrollmentId);
    // nesúlad s evidenciou zamestnanca sa zaznamená (vidí ho školiteľ)
    const { data: emp } = await db.from("lq_enrollments").select("employee_id").eq("id", enrollmentId).single();
    if (emp?.employee_id) {
      const { data: e } = await db.from("lq_employees").select("first_name,last_name").eq("id", emp.employee_id).single();
      if (e && norm(`${e.first_name} ${e.last_name}`) !== norm(`${id.first} ${id.last}`)) {
        await db.from("lq_audit").insert({ tenant_id: l.tenant.id, action: "identita_nesulad", ref: enrollmentId, data: { evidencia: `${e.first_name} ${e.last_name}`, zadane: `${id.first} ${id.last}` } });
      }
    }
  } else {
    // spoločný odkaz: zamestnanec zákazníka podľa e-mailu (alebo nový), potom zaradenie do školenia
    const { data: emps } = await db.from("lq_employees").select("id").eq("tenant_id", l.tenant.id).eq("customer_id", s.customer_id).ilike("email", id.email).limit(1);
    let empId = emps?.[0]?.id as string | undefined;
    if (!empId) {
      const { data: ne, error } = await db.from("lq_employees").insert({ tenant_id: l.tenant.id, customer_id: s.customer_id, first_name: id.first, last_name: id.last, email: id.email }).select("id").single();
      if (error) throw new Fail("Zamestnanca sa nepodarilo zaevidovať.");
      empId = ne!.id;
    }
    const { data: ex } = await db.from("lq_enrollments").select("id,status").eq("session_id", s.id).eq("email", id.email).maybeSingle();
    if (ex) {
      enrollmentId = ex.id;
      await db.from("lq_enrollments").update({ first_name: id.first, last_name: id.last, company: id.company, verified_at: new Date().toISOString(), ...(ex.status === "pozvany" ? { status: "overeny" } : {}) }).eq("id", ex.id);
    } else {
      const { data: ne, error } = await db.from("lq_enrollments").insert({ tenant_id: l.tenant.id, session_id: s.id, employee_id: empId, email: id.email, first_name: id.first, last_name: id.last, company: id.company }).select("id").single();
      if (error) throw new Fail("Zaradenie do školenia sa nepodarilo.");
      enrollmentId = ne!.id;
      await db.from("lq_enrollments").update({ status: "overeny", verified_at: new Date().toISOString() }).eq("id", enrollmentId);
    }
  }
  const token = rand(32);
  await db.from("lq_ptokens").insert({ token_hash: await sha(token), enrollment_id: enrollmentId, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
  await db.from("lq_audit").insert({ tenant_id: l.tenant.id, action: "identita_overena", ref: enrollmentId, data: { email: id.email, meno: `${id.first} ${id.last}`, firma: id.company, kod: l.tenant.otp_required } });
  return token;
}

/** Relácia školeného z hlavičky x-lq-token. */
async function participant(req: Request) {
  const t = req.headers.get("x-lq-token") || "";
  if (!/^[a-f0-9]{64}$/.test(t)) throw new Fail("Prihlásenie vypršalo. Otvorte znova odkaz z pozvánky.", 401);
  const { data: pt } = await db.from("lq_ptokens").select("enrollment_id,expires_at").eq("token_hash", await sha(t)).maybeSingle();
  if (!pt || new Date(pt.expires_at) < new Date()) throw new Fail("Prihlásenie vypršalo. Otvorte znova odkaz z pozvánky.", 401);
  const { data: e } = await db.from("lq_enrollments").select("*").eq("id", pt.enrollment_id).single();
  const en = must(e, "Zaradenie neexistuje", 401);
  const { data: s } = await db.from("lq_sessions").select("*").eq("id", en.session_id).single();
  const tenant = await tenantById(en.tenant_id);
  const { data: topics } = await db.from("lq_topics").select("id,position,title,min_a,min_b").eq("tenant_id", en.tenant_id).order("position");
  const list = (topics || []).filter((tp) => topicMinutes(tp, s!.kind) > 0);
  return { en, s: s!, tenant, topics: list };
}

async function pState(req: Request) {
  const p = await participant(req);
  await autoSubmit(p);
  const [{ data: prog }, { data: atts }, { data: cust }] = await Promise.all([
    db.from("lq_progress").select("topic_id,active_seconds,done_at").eq("enrollment_id", p.en.id),
    db.from("lq_attempts").select("id,no,started_at,deadline_at,submitted_at,correct,total,percent,passed,confirmed_at,signed_at").eq("enrollment_id", p.en.id).order("no"),
    db.from("lq_customers").select("name").eq("id", p.s.customer_id).single(),
  ]);
  const { data: en } = await db.from("lq_enrollments").select("status,protocol_sent_at").eq("id", p.en.id).single();
  const topics = p.topics.map((tp) => {
    const pr = (prog || []).find((x) => x.topic_id === tp.id);
    return { id: tp.id, position: tp.position, title: tp.title, minutes: topicMinutes(tp, p.s.kind), seconds: pr?.active_seconds || 0, done: !!pr?.done_at };
  });
  const allDone = topics.every((x) => x.done);
  const attempts = (atts || []).map((a) => ({ id: a.id, no: a.no, deadline_at: a.deadline_at, submitted: !!a.submitted_at, correct: a.correct, total: a.total, percent: a.percent, passed: a.passed, confirmed: !!a.confirmed_at, signed: !!a.signed_at }));
  const open = attempts.find((a) => !a.submitted) || null;
  const anyPassed = attempts.some((a) => a.passed && a.confirmed);
  const waiting = attempts.some((a) => a.submitted && !a.confirmed);
  const t = p.tenant;
  return {
    tenant: brand(t),
    me: { first_name: p.en.first_name, last_name: p.en.last_name, email: p.en.email, company: p.en.company },
    session: { kind: p.s.kind, protocol_no: p.s.protocol_no, customer: cust?.name, due_on: p.s.due_on, status: p.s.status },
    rules: { study_time_limit: t.study_time_limit, test_time_limit: t.test_time_limit, test_minutes: t.test_minutes, pass_percent: t.pass_percent, max_attempts: t.max_attempts, require_confirm: t.require_confirm },
    status: en?.status, protocol_sent: !!en?.protocol_sent_at, topics, attempts, open_attempt: open?.id || null,
    sign_attempt: ((x) => (x && !x.signed ? x.id : null))([...attempts].reverse().find((a) => a.submitted)),
    can_test: allDone && !open && !anyPassed && !waiting && attempts.length < t.max_attempts && p.s.status === "otvorene",
  };
}

async function pTopic(req: Request, body: any) {
  const p = await participant(req);
  const id = uuid(body.topic);
  const idx = p.topics.findIndex((x) => x.id === id);
  if (idx < 0) throw new Fail("Téma neexistuje");
  // poradie: ďalšia téma až po dokončení predchádzajúcej
  if (idx > 0) {
    const { data: prev } = await db.from("lq_progress").select("done_at").eq("enrollment_id", p.en.id).eq("topic_id", p.topics[idx - 1].id).maybeSingle();
    if (!prev?.done_at) throw new Fail("Najprv dokončite predchádzajúcu tému.", 403);
  }
  const { data: tp } = await db.from("lq_topics").select("id,position,title,html").eq("id", id).single();
  const now = new Date().toISOString();
  await db.from("lq_progress").upsert({ enrollment_id: p.en.id, topic_id: id, tenant_id: p.en.tenant_id, last_beat: now }, { onConflict: "enrollment_id,topic_id", ignoreDuplicates: false });
  if (!p.en.study_started_at || p.en.status === "overeny") {
    await db.from("lq_enrollments").update({ ...(p.en.study_started_at ? {} : { study_started_at: now }), ...(p.en.status === "overeny" ? { status: "studuje" } : {}) }).eq("id", p.en.id);
  }
  const { data: pr } = await db.from("lq_progress").select("active_seconds,done_at").eq("enrollment_id", p.en.id).eq("topic_id", id).single();
  let html = participantHtml(tp!.html);
  if (tp!.position === 10 && p.s.rules_text) {
    html += `<h3>Vnútorné predpisy a riziká u vášho zamestnávateľa</h3>` + p.s.rules_text.split(/\n{2,}/).map((x: string) => `<p>${escHtml(x).replace(/\n/g, "<br>")}</p>`).join("");
  }
  const minutes = topicMinutes(p.topics[idx], p.s.kind);
  return { id, position: tp!.position, title: tp!.title, html, minutes, seconds: pr?.active_seconds || 0, done: !!pr?.done_at, last: idx === p.topics.length - 1, next: p.topics[idx + 1]?.id || null };
}

async function pBeat(req: Request, body: any) {
  const p = await participant(req);
  const id = uuid(body.topic);
  const { data: pr } = await db.from("lq_progress").select("active_seconds,last_beat,done_at").eq("enrollment_id", p.en.id).eq("topic_id", id).maybeSingle();
  if (!pr) throw new Fail("Najprv otvorte tému.");
  const now = Date.now();
  const gap = pr.last_beat ? (now - new Date(pr.last_beat).getTime()) / 1000 : 0;
  // iba aktívne štúdium: signál najviac každých 15 s, medzera nad 90 s sa nezapočíta
  if (gap < 15) return { seconds: pr.active_seconds };
  const add = gap <= 90 ? Math.min(Math.round(gap), 60) : 0;
  const seconds = pr.active_seconds + add;
  await db.from("lq_progress").update({ active_seconds: seconds, last_beat: new Date(now).toISOString() }).eq("enrollment_id", p.en.id).eq("topic_id", id);
  return { seconds };
}

async function pDone(req: Request, body: any) {
  const p = await participant(req);
  const id = uuid(body.topic);
  const tp = must(p.topics.find((x) => x.id === id), "Téma neexistuje");
  const { data: pr } = await db.from("lq_progress").select("active_seconds,done_at").eq("enrollment_id", p.en.id).eq("topic_id", id).maybeSingle();
  if (!pr) throw new Fail("Najprv otvorte tému.");
  const need = topicMinutes(tp, p.s.kind) * 60;
  if (p.tenant.study_time_limit && pr.active_seconds < need - 10) {
    throw new Fail(`Téma ešte nie je odštudovaná. Zostáva približne ${Math.ceil((need - pr.active_seconds) / 60)} min.`, 409);
  }
  if (!pr.done_at) await db.from("lq_progress").update({ done_at: new Date().toISOString() }).eq("enrollment_id", p.en.id).eq("topic_id", id);
  const { count } = await db.from("lq_progress").select("topic_id", { count: "exact", head: true }).eq("enrollment_id", p.en.id).not("done_at", "is", null);
  const all = (count || 0) >= p.topics.length;
  if (all && !p.en.study_done_at) await db.from("lq_enrollments").update({ study_done_at: new Date().toISOString(), status: "test" }).eq("id", p.en.id);
  return { done: true, all };
}

function shuffle<T>(a: T[]) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }

/** Náhodný test: 20 otázok, z každého okruhu jedna náhodná (z 15 variantov); bez opakovania rovnakého znenia, poradie odpovedí premiešané. */
async function generateTest(tenantId: string, avoid: Set<string>) {
  const { data } = await db.from("lq_questions").select("id,slot,topic_no,text,options,correct").eq("tenant_id", tenantId).eq("active", true);
  const pool = data || [];
  const used = new Set<string>();
  const pick: typeof pool = [];
  const take = (cands: typeof pool, n: number) => {
    const fresh = shuffle(cands.filter((q) => !used.has(norm(q.text)) && !avoid.has(norm(q.text))));
    const rest = shuffle(cands.filter((q) => !used.has(norm(q.text)) && avoid.has(norm(q.text))));
    for (const q of [...fresh, ...rest]) { if (n <= 0) break; if (used.has(norm(q.text))) continue; used.add(norm(q.text)); pick.push(q); n--; }
    return n;
  };
  // štruktúra schváleného testu: otázka č. N vždy z okruhu N (1–5 = témy 2–6, 6–20 = ostatné témy)
  const slots = [...new Set(pool.map((q) => q.slot))].sort((a, b) => a - b);
  if (slots.length < 20) throw new Fail("V banke otázok nie je dosť okruhov (treba 20).", 500);
  for (const s of slots.slice(0, 20)) if (take(pool.filter((q) => q.slot === s), 1) > 0) throw new Fail("V banke otázok chýba otázka pre okruh " + s + ".", 500);
  return pick.map((q) => {
    const order = shuffle([0, 1, 2]);
    return { id: q.id, slot: q.slot, topic: q.topic_no, text: q.text, options: order.map((k) => q.options[k]), correct: order.indexOf(q.correct) };
  });
}
const publicQuestions = (qs: any[]) => qs.map((q) => ({ text: q.text, options: q.options }));

async function pTestStart(req: Request) {
  const p = await participant(req);
  if (p.s.status !== "otvorene") throw new Fail("Školenie je uzavreté.", 403);
  const { data: atts } = await db.from("lq_attempts").select("*").eq("enrollment_id", p.en.id).order("no");
  const open = (atts || []).find((a) => !a.submitted_at);
  if (open) return { attempt: open.id, questions: publicQuestions(open.questions), answers: open.answers, deadline_at: open.deadline_at };
  const { count } = await db.from("lq_progress").select("topic_id", { count: "exact", head: true }).eq("enrollment_id", p.en.id).not("done_at", "is", null);
  if ((count || 0) < p.topics.length) throw new Fail("Test sa sprístupní po dokončení všetkých tém.", 403);
  if ((atts || []).some((a) => a.submitted_at && !a.confirmed_at)) throw new Fail("Váš test čaká na potvrdenie vyhodnotenia.", 409);
  if ((atts || []).some((a) => a.passed)) throw new Fail("Test ste už úspešne absolvovali.", 409);
  if ((atts || []).length >= p.tenant.max_attempts) throw new Fail("Vyčerpali ste počet pokusov. Kontaktujte školiteľa.", 403);
  const avoid = new Set<string>((atts || []).flatMap((a) => (a.questions as any[]).map((q) => norm(q.text))));
  const questions = await generateTest(p.en.tenant_id, avoid);
  const deadline = p.tenant.test_time_limit ? new Date(Date.now() + p.tenant.test_minutes * 60_000).toISOString() : null;
  const { data: a, error } = await db.from("lq_attempts").insert({
    tenant_id: p.en.tenant_id, enrollment_id: p.en.id, no: (atts || []).length + 1, questions, answers: questions.map(() => null), deadline_at: deadline,
  }).select("id").single();
  if (error) throw new Fail("Test sa nepodarilo pripraviť. Skúste to znova.");
  await db.from("lq_enrollments").update({ status: "test" }).eq("id", p.en.id);
  return { attempt: a!.id, questions: publicQuestions(questions), answers: questions.map(() => null), deadline_at: deadline };
}

async function pAnswer(req: Request, body: any) {
  const p = await participant(req);
  const { data: a } = await db.from("lq_attempts").select("id,answers,deadline_at,submitted_at").eq("id", uuid(body.attempt)).eq("enrollment_id", p.en.id).maybeSingle();
  const at = must(a, "Test neexistuje");
  if (at.submitted_at) throw new Fail("Test je už odovzdaný.", 409);
  if (at.deadline_at && Date.now() > new Date(at.deadline_at).getTime() + 15_000) throw new Fail("Čas na test uplynul.", 409);
  const i = Number(body.i), c = body.choice === null ? null : Number(body.choice);
  const answers = [...(at.answers as (number | null)[])];
  if (!Number.isInteger(i) || i < 0 || i >= answers.length || (c !== null && ![0, 1, 2].includes(c))) throw new Fail("Neplatná odpoveď");
  answers[i] = c;
  await db.from("lq_attempts").update({ answers }).eq("id", at.id).is("submitted_at", null);
  return { ok: true };
}

async function evaluate(attemptId: string) {
  const { data: a } = await db.from("lq_attempts").select("*").eq("id", attemptId).single();
  if (!a || a.submitted_at) return a;
  const t = await tenantById(a.tenant_id);
  const qs = a.questions as any[], ans = a.answers as (number | null)[];
  const correct = qs.reduce((n, q, i) => n + (ans[i] === q.correct ? 1 : 0), 0);
  const percent = Math.round((correct / qs.length) * 10000) / 100;
  const passed = percent >= t.pass_percent;
  const { data: upd } = await db.from("lq_attempts").update({ submitted_at: new Date().toISOString(), correct, total: qs.length, percent, passed, app_passed: passed })
    .eq("id", attemptId).is("submitted_at", null).select("*").single();
  if (!upd) return a;
  await db.from("lq_enrollments").update({ status: "vyhodnotene" }).eq("id", a.enrollment_id);
  // automatické potvrdenie až po podpise školeného (p_sign); pri potvrdzovaní školiteľom upozorníme tím
  if (t.require_confirm) await notifyStaff(t, a.enrollment_id, upd).catch((er) => console.error("notify", er));
  return upd;
}
async function autoSubmit(p: Awaited<ReturnType<typeof participant>>) {
  const { data: open } = await db.from("lq_attempts").select("id,deadline_at").eq("enrollment_id", p.en.id).is("submitted_at", null);
  for (const o of open || []) if (o.deadline_at && Date.now() > new Date(o.deadline_at).getTime() + 15_000) await evaluate(o.id);
}

/** PNG podpisu z data URL / base64: kontrola formátu a veľkosti. */
function pngBytes(v: unknown) {
  const b64 = String(v ?? "").replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 400_000) throw new Fail("Podpis sa nepodarilo uložiť (neplatný obrázok).");
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  if (u.length < 100 || u[0] !== 0x89 || u[1] !== 0x50 || u[2] !== 0x4e || u[3] !== 0x47) throw new Fail("Podpis sa nepodarilo uložiť (neplatný obrázok).");
  return u;
}

async function pSign(req: Request, body: any) {
  const p = await participant(req);
  const { data: a } = await db.from("lq_attempts").select("id,submitted_at,signed_at,confirmed_at").eq("id", uuid(body.attempt)).eq("enrollment_id", p.en.id).maybeSingle();
  const at = must(a, "Test neexistuje");
  if (!at.submitted_at) throw new Fail("Najprv odovzdajte test.", 409);
  if (at.signed_at) return { ok: true, already: true };
  const bytes = pngBytes(body.png);
  const path = `${p.en.tenant_id}/podpisy/${p.en.id}_${at.id}.png`;
  const { error } = await db.storage.from("learniq").upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Fail("Podpis sa nepodarilo uložiť. Skúste to znova.", 500);
  await db.from("lq_attempts").update({ signature_path: path, signed_at: new Date().toISOString() }).eq("id", at.id).is("signed_at", null);
  await db.from("lq_audit").insert({ tenant_id: p.en.tenant_id, action: "podpis_skoleneho", ref: at.id });
  let confirmed = false;
  if (!p.tenant.require_confirm && !at.confirmed_at) {
    await confirmAttempt(at.id, null); // automatické vyhodnotenie aplikáciou
    confirmed = true;
  } else if (at.confirmed_at) {
    await buildAndSendProtocol(p.en.id).catch((er) => console.error(er)); // podpis doplnený po potvrdení → nový protokol
  }
  return { ok: true, confirmed };
}

/** E-mail tímu školiteľa: test čaká na potvrdenie. */
async function notifyStaff(t: Tenant & Record<string, any>, enrollmentId: string, a: any) {
  const [{ data: en }, { data: staff }] = await Promise.all([
    db.from("lq_enrollments").select("first_name,last_name,email,session_id").eq("id", enrollmentId).single(),
    db.from("lq_staff").select("email").eq("tenant_id", t.id),
  ]);
  const to = [...new Set((staff || []).map((x) => x.email).filter(Boolean))] as string[];
  if (!to.length || !en) return;
  const { data: s } = await db.from("lq_sessions").select("protocol_no").eq("id", en.session_id).single();
  const app = (Deno.env.get("LEARNIQ_APP_URL") || DEFAULT_APP).replace(/\/+$/, "");
  await sendMail(t, to, `Test čaká na potvrdenie – ${en.first_name} ${en.last_name} (${a.passed ? "vyhovel" : "nevyhovel"})`,
    `<p>${escHtml(`${en.first_name} ${en.last_name}`)} (${escHtml(en.email)}) odovzdal(a) záverečný test v školení ${escHtml(s?.protocol_no || "")}.</p>
     <p>Vyhodnotenie aplikácie: <b>${a.correct} z ${a.total} (${Math.round(Number(a.percent))} %) – ${a.passed ? "vyhovel" : "nevyhovel"}</b>.</p>
     <p>Po vašom potvrdení sa vytvorí protokol a automaticky odošle školenému.</p>${button(`${app}/#/`, "Skontrolovať a potvrdiť", t.color)}`);
}

async function aSignature(req: Request, body: any) {
  const st = await staffOf(req, uuid(body.tenant));
  if (body.remove === true) {
    await db.from("lq_staff").update({ signature_path: null }).eq("tenant_id", body.tenant).eq("user_id", st.user.id);
    return { ok: true };
  }
  const bytes = pngBytes(body.png);
  const path = `${body.tenant}/podpisy/staff_${st.user.id}.png`;
  const { error } = await db.storage.from("learniq").upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Fail("Podpis sa nepodarilo uložiť.", 500);
  await db.from("lq_staff").update({ signature_path: path }).eq("tenant_id", body.tenant).eq("user_id", st.user.id);
  return { ok: true, path };
}

async function readSignature(path: string | null | undefined, tenantId: string) {
  if (!path || !path.startsWith(`${tenantId}/podpisy/`)) return null;
  const { data } = await db.storage.from("learniq").download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

async function pSubmit(req: Request, body: any) {
  const p = await participant(req);
  const { data: a } = await db.from("lq_attempts").select("id").eq("id", uuid(body.attempt)).eq("enrollment_id", p.en.id).maybeSingle();
  must(a, "Test neexistuje");
  const r = await evaluate(a!.id);
  return { correct: r.correct, total: r.total, percent: r.percent, passed: r.passed, pending: p.tenant.require_confirm, attempt: r.id };
}

/* ======================================================================
   POTVRDENIE VÝSLEDKU → PDF → E-MAIL
   ====================================================================== */
async function confirmAttempt(attemptId: string, staff: { user_id: string; full_name: string; cert_no: string | null } | null, note?: string, verdict?: boolean | null) {
  const { data: a } = await db.from("lq_attempts").select("*").eq("id", attemptId).single();
  const at = must(a, "Test neexistuje");
  if (!at.submitted_at) throw new Fail("Test ešte nie je odovzdaný.", 409);
  if (at.confirmed_at) throw new Fail("Výsledok už bol potvrdený.", 409);
  const t = await tenantById(at.tenant_id);
  const appPassed = at.app_passed ?? at.passed;
  const passed = verdict == null ? appPassed : verdict;
  if (passed !== appPassed && (!staff || !note || note.length < 3)) throw new Fail("Pri zmene výsledku aplikácie doplňte poznámku s dôvodom.");
  const confirmed_name = staff?.full_name || t.rep_name || t.name;
  const confirmed_cert = staff?.cert_no || t.rep_cert || null;
  const { data: upd } = await db.from("lq_attempts").update({
    confirmed_by: staff?.user_id || null, confirmed_name, confirmed_cert, confirmed_at: new Date().toISOString(), note: note || null,
    passed, app_passed: appPassed,
  }).eq("id", attemptId).is("confirmed_at", null).select("*").single();
  if (!upd) throw new Fail("Výsledok už bol potvrdený.", 409);
  const { data: en } = await db.from("lq_enrollments").select("*").eq("id", upd.enrollment_id).single();
  const { data: s } = await db.from("lq_sessions").select("*").eq("id", en!.session_id).single();
  let valid_until: string | null = null;
  const done = localToday();
  if (upd.passed) {
    valid_until = addMonths(done, t.validity_months);
    if (en!.employee_id) await db.from("lq_employees").update({ last_training_on: done, last_kind: s!.kind, valid_until, offered_for: null }).eq("id", en!.employee_id);
  }
  await db.from("lq_enrollments").update({ status: upd.passed ? "vyhovel" : "nevyhovel" }).eq("id", en!.id);
  await db.from("lq_audit").insert({ tenant_id: t.id, actor: staff?.user_id || null, action: "vysledok_potvrdeny", ref: upd.id, data: { passed: upd.passed, app_passed: appPassed, zmenene: passed !== appPassed, correct: upd.correct, meno: confirmed_name, poznamka: note || null } });
  const mail = await buildAndSendProtocol(en!.id, valid_until);
  return { passed: upd.passed, valid_until, ...mail };
}

async function protocolBytes(enrollmentId: string, validUntil?: string | null) {
  const { data: en } = await db.from("lq_enrollments").select("*").eq("id", enrollmentId).single();
  const e = must(en, "Zaradenie neexistuje");
  const t = await tenantById(e.tenant_id);
  const [{ data: s }, { data: atts }, { data: prog }, { data: topics }] = await Promise.all([
    db.from("lq_sessions").select("*").eq("id", e.session_id).single(),
    db.from("lq_attempts").select("*").eq("enrollment_id", e.id).order("no"),
    db.from("lq_progress").select("*").eq("enrollment_id", e.id),
    db.from("lq_topics").select("id,position,title,min_a,min_b").eq("tenant_id", e.tenant_id).order("position"),
  ]);
  const { data: c } = await db.from("lq_customers").select("name,ico,address,email").eq("id", s!.customer_id).single();
  const last = [...(atts || [])].reverse().find((a) => a.confirmed_at) || must((atts || []).at(-1), "Test neexistuje");
  let vu = validUntil;
  if (vu === undefined || vu === null) {
    if (last.passed && e.employee_id) { const { data: emp } = await db.from("lq_employees").select("valid_until").eq("id", e.employee_id).single(); vu = emp?.valid_until || null; }
  }
  let evaluatorSig: Uint8Array | null = null;
  if (last.confirmed_by) {
    const { data: stf } = await db.from("lq_staff").select("signature_path").eq("tenant_id", e.tenant_id).eq("user_id", last.confirmed_by).maybeSingle();
    evaluatorSig = await readSignature(stf?.signature_path, e.tenant_id);
  }
  const employeeSig = await readSignature(last.signature_path, e.tenant_id);
  const bytes = await protocolPdf({
    tenant: t, customer: c!, session: s!,
    enrollment: { id: e.id, first_name: e.first_name || "", last_name: e.last_name || "", email: e.email, company: e.company, position: e.position, verified_at: e.verified_at, study_started_at: e.study_started_at, study_done_at: e.study_done_at },
    topics: (topics || []).filter((tp) => topicMinutes(tp, s!.kind) > 0).map((tp) => {
      const pr = (prog || []).find((x) => x.topic_id === tp.id);
      return { position: tp.position, title: tp.title, minutes: topicMinutes(tp, s!.kind), seconds: pr?.active_seconds || 0, started_at: pr?.started_at, done_at: pr?.done_at };
    }),
    attempt: { ...last, answers: last.answers, questions: last.questions, percent: Number(last.percent) },
    attempts: (atts || []).map((a) => ({ no: a.no, submitted_at: a.submitted_at, correct: a.correct, total: a.total, passed: a.passed, app_passed: a.app_passed })),
    valid_until: vu,
    signatures: { employee: employeeSig, employee_at: last.signed_at, evaluator: evaluatorSig },
  });
  return { bytes, e, t, s: s!, c: c!, passed: !!last.passed };
}

async function buildAndSendProtocol(enrollmentId: string, validUntil?: string | null) {
  const { bytes, e, t, s, c, passed } = await protocolBytes(enrollmentId, validUntil);
  const path = `${t.id}/protokoly/${s.protocol_no.replace(/\//g, "-")}_${e.id}.pdf`;
  await db.storage.from("learniq").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  await db.from("lq_enrollments").update({ protocol_path: path }).eq("id", e.id);
  const fname = `Protokol_BOZP_${s.protocol_no.replace(/\//g, "-")}_${(e.last_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]/g, "")}.pdf`;
  const to = [e.email];
  const html = passed
    ? `<p>Dobrý deň, ${escHtml(e.first_name)},</p><p>úspešne ste absolvovali oboznámenie v oblasti BOZP. V prílohe je váš protokol – záznam o oboznámení, test s vyhodnotením a výpis z e-learningu.</p><p>Výsledok potvrdil(a) ${escHtml(t.rep_name || t.name)}.</p>`
    : `<p>Dobrý deň, ${escHtml(e.first_name)},</p><p>v záverečnom teste ste tentoraz nevyhoveli. V prílohe je test s vyhodnotením. Overenie zopakujete v náhradnom termíne – ozve sa vám školiteľ. Dovtedy nesmiete samostatne vykonávať prácu, na ktorú sa oboznámenie vzťahuje.</p>`;
  const r = await sendMail(t, to, passed ? `Protokol o oboznámení BOZP – ${e.first_name} ${e.last_name}` : `Výsledok testu BOZP – ${e.first_name} ${e.last_name}`, html, [{ filename: fname, content: bytes }]);
  if (r.ok) {
    await db.from("lq_enrollments").update({ protocol_sent_at: new Date().toISOString() }).eq("id", e.id);
    if (c.email && c.email.toLowerCase() !== e.email) {
      await sendMail(t, [c.email], `Protokol BOZP – ${e.first_name} ${e.last_name} (${passed ? "vyhovel" : "nevyhovel"})`,
        `<p>Dobrý deň,</p><p>zamestnanec ${escHtml(`${e.first_name} ${e.last_name}`)} ukončil e-learning BOZP s výsledkom <b>${passed ? "vyhovel" : "nevyhovel"}</b>. Protokol je v prílohe.</p>`, [{ filename: fname, content: bytes }]);
    }
  }
  return { emailed: r.ok, email_reason: r.ok ? null : r.reason, path };
}

/* ======================================================================
   TÍM ŠKOLITEĽA (prihlásený používateľ)
   ====================================================================== */
async function staffUser(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) throw new Fail("Nie ste prihlásený", 401);
  const { data: pa } = await db.from("lq_platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return { user, platform: !!pa };
}
async function staffOf(req: Request, tenantId: string, admin = false) {
  const u = await staffUser(req);
  const { data: st } = await db.from("lq_staff").select("user_id,role,full_name,cert_no,email").eq("tenant_id", uuid(tenantId)).eq("user_id", u.user.id).maybeSingle();
  if (!st) throw new Fail("Nemáte prístup k tomuto školiteľovi", 403);
  if (admin && st.role !== "spravca") throw new Fail("Túto akciu smie iba správca školiteľa", 403);
  await tenantById(tenantId);
  return { ...u, staff: st };
}

async function findOrCreateUser(email: string, name: string) {
  const { data: id } = await db.rpc("lq_find_user", { p_email: email });
  if (id) return id as string;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) throw new Fail("Účet sa nepodarilo vytvoriť: " + (error?.message || ""), 500);
  return data.user.id;
}
async function loginLink(email: string, app: string) {
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) throw new Fail("Odkaz na prihlásenie sa nepodarilo vytvoriť.", 500);
  return `${app}/#/pozvanka?t=${encodeURIComponent(data.properties.hashed_token)}`;
}

async function aInviteStaff(req: Request, body: any) {
  const tenantId = uuid(body.tenant);
  const u = await staffUser(req);
  if (!u.platform) await staffOf(req, tenantId, true);
  const t = await tenantById(tenantId);
  const email = clean(body.email, 200).toLowerCase(), name = clean(body.name, 120), role = body.role === "spravca" ? "spravca" : "skolitel";
  if (!isEmail(email)) throw new Fail("Zadajte platný e-mail.");
  if (name.length < 3) throw new Fail("Zadajte meno a priezvisko.");
  const userId = await findOrCreateUser(email, name);
  const { data: ex } = await db.from("lq_staff").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!ex) await db.from("lq_staff").insert({ tenant_id: tenantId, user_id: userId, role, full_name: name, email, cert_no: clean(body.cert, 60) || null });
  const link = await loginLink(email, appUrl(req, body));
  const r = await sendMail(t, [email], `Prístup do LearnIQ – ${t.name}`,
    `<p>Dobrý deň, ${escHtml(name)},</p><p>${escHtml(t.name)} vám vytvoril(a) prístup do aplikácie <b>LearnIQ</b> (e-learning BOZP) ako ${role === "spravca" ? "správcovi" : "školiteľovi"}.</p>
     <p>Kliknite na tlačidlo a nastavte si heslo. Odkaz platí obmedzený čas.</p>${button(link, "Nastaviť heslo a prihlásiť sa", t.color)}`);
  await db.from("lq_audit").insert({ tenant_id: tenantId, actor: u.user.id, action: "pozvanka_timu", ref: userId, data: { email, role } });
  return { link, emailed: r.ok, existed: !!ex };
}

async function aCreateTenant(req: Request, body: any) {
  const u = await staffUser(req);
  if (!u.platform) throw new Fail("Nového školiteľa zakladá iba správca aplikácie", 403);
  const name = clean(body.name, 200);
  if (name.length < 2) throw new Fail("Zadajte názov firmy školiteľa.");
  const { data: t, error } = await db.from("lq_tenants").insert({ name, email: clean(body.admin_email, 200).toLowerCase() || null, created_by: u.user.id }).select("id").single();
  if (error) throw new Fail("Školiteľa sa nepodarilo založiť.");
  await db.rpc("lq_clone_template", { t: t!.id });
  await db.from("lq_audit").insert({ tenant_id: t!.id, actor: u.user.id, action: "skolitel_zalozeny", ref: t!.id });
  let invite = null;
  if (body.admin_email) invite = await aInviteStaff(req, { tenant: t!.id, email: body.admin_email, name: body.admin_name, role: "spravca", app: body.app });
  return { tenant: t!.id, invite };
}

async function aSendInvites(req: Request, body: any) {
  const sid = uuid(body.session);
  const { data: s } = await db.from("lq_sessions").select("*").eq("id", sid).single();
  const ss = must(s, "Školenie neexistuje");
  await staffOf(req, ss.tenant_id);
  const t = await tenantById(ss.tenant_id);
  if (ss.status !== "otvorene") throw new Fail("Školenie je uzavreté.");
  let q = db.from("lq_enrollments").select("id,email,first_name,invite_token,status").eq("session_id", sid).in("status", ["pozvany", "overeny", "studuje", "test"]);
  if (Array.isArray(body.ids) && body.ids.length) q = q.in("id", body.ids.map((x: unknown) => uuid(x)));
  const { data: list } = await q;
  const app = appUrl(req, body);
  const { data: c } = await db.from("lq_customers").select("name").eq("id", ss.customer_id).single();
  let sent = 0;
  const links: { id: string; email: string; link: string }[] = [];
  for (const e of list || []) {
    const link = `${app}/kurz.html#i=${e.invite_token}`;
    links.push({ id: e.id, email: e.email, link });
    if (!emailReady()) continue;
    const r = await sendMail(t, [e.email], `Školenie BOZP – ${c?.name || ""}`,
      `<p>Dobrý deň${e.first_name ? `, ${escHtml(e.first_name)}` : ""},</p>
       <p>zamestnávateľ ${escHtml(c?.name || "")} vás prihlásil na ${ss.kind === "A" ? "vstupné" : "opakované"} oboznámenie v oblasti bezpečnosti a ochrany zdravia pri práci formou e-learningu.</p>
       <p>Školenie absolvujete na mobile alebo počítači. Na začiatku overíte svoj e-mail kódom, potom prejdete témy a na záver vyplníte test. Protokol vám príde e-mailom.</p>
       ${ss.due_on ? `<p>Absolvujte ho, prosím, do <b>${fmtDate(ss.due_on)}</b>.</p>` : ""}
       ${button(link, "Začať školenie", t.color)}<p style="color:#777;font-size:13px">Odkaz je osobný – neposielajte ho ďalej.</p>`);
    if (r.ok) { sent++; await db.from("lq_enrollments").update({ invited_at: new Date().toISOString() }).eq("id", e.id); }
  }
  return { sent, links, email_ready: emailReady() };
}

async function aConfirm(req: Request, body: any) {
  const { data: a } = await db.from("lq_attempts").select("id,tenant_id").eq("id", uuid(body.attempt)).single();
  const at = must(a, "Test neexistuje");
  const st = await staffOf(req, at.tenant_id);
  const verdict = body.verdict === "vyhovel" ? true : body.verdict === "nevyhovel" ? false : null;
  return await confirmAttempt(at.id, { user_id: st.user.id, full_name: st.staff.full_name || st.user.email || "", cert_no: st.staff.cert_no }, clean(body.note, 300) || undefined, verdict);
}

async function aProtocol(req: Request, body: any) {
  const { data: e } = await db.from("lq_enrollments").select("id,tenant_id,protocol_path").eq("id", uuid(body.enrollment)).single();
  const en = must(e, "Zaradenie neexistuje");
  await staffOf(req, en.tenant_id);
  if (body.resend) return await buildAndSendProtocol(en.id);
  let path = en.protocol_path;
  if (!path) throw new Fail("Protokol ešte nie je vytvorený – výsledok najprv potvrďte.", 409);
  const { data: url } = await db.storage.from("learniq").createSignedUrl(path, 600, { download: true });
  return { url: url?.signedUrl };
}

async function offerData(offerId: string) {
  const { data: o } = await db.from("lq_offers").select("*").eq("id", offerId).single();
  const of = must(o, "Ponuka neexistuje");
  const t = await tenantById(of.tenant_id);
  const { data: c } = await db.from("lq_customers").select("name,ico,address,contact_name,email").eq("id", of.customer_id).single();
  return { of, t, c: c! };
}
async function aOffer(req: Request, body: any) {
  const { of, t, c } = await offerData(uuid(body.offer));
  const st = await staffOf(req, of.tenant_id, body.send === true);
  const bytes = await offerPdf({ tenant: t, customer: c, offer: of });
  const path = `${t.id}/ponuky/${of.number}.pdf`;
  await db.storage.from("learniq").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (body.send === true) {
    if (of.status !== "navrh") throw new Fail("Ponuka už bola vybavená.", 409);
    if (!c.email) throw new Fail("Zákazník nemá e-mail. Doplňte ho v karte zákazníka.");
    const r = await sendMail(t, [c.email], `Cenová ponuka ${of.number} – školenie BOZP`,
      `<p>Dobrý deň${c.contact_name ? `, ${escHtml(c.contact_name)}` : ""},</p>
       <p>blíži sa koniec platnosti oboznámenia BOZP u ${of.count} ${of.count === 1 ? "zamestnanca" : "zamestnancov"} (najskôr ${fmtDate(of.earliest_due)}). V prílohe posielame cenovú ponuku na opakované oboznámenie formou e-learningu – spolu <b>${eur(of.total)}</b>.</p>
       <p>Ak ponuku prijímate, stačí odpovedať na tento e-mail. Zamestnancom potom pošleme osobné odkazy na školenie.</p>`,
      [{ filename: `Cenova_ponuka_${of.number}.pdf`, content: bytes }]);
    if (!r.ok) throw new Fail(r.reason === "email_off" ? "Odosielanie e-mailov ešte nie je nastavené (chýba kľúč RESEND_API_KEY)." : "E-mail sa nepodarilo odoslať.", 503);
    await db.from("lq_offers").update({ status: "odoslana", approved_by: st.user.id, approved_at: new Date().toISOString(), sent_at: new Date().toISOString(), pdf_path: path }).eq("id", of.id);
    await db.from("lq_audit").insert({ tenant_id: t.id, actor: st.user.id, action: "ponuka_odoslana", ref: of.id, data: { number: of.number, total: of.total } });
    return { sent: true };
  }
  const { data: url } = await db.storage.from("learniq").createSignedUrl(path, 600);
  return { url: url?.signedUrl };
}

/* ======================================================================
   DENNÁ ÚLOHA: návrhy cenových ponúk pred koncom platnosti
   ====================================================================== */
async function dailyOffers(onlyTenant?: string) {
  const today = localToday();
  let tq = db.from("lq_tenants").select(TENANT_COLS).eq("active", true);
  if (onlyTenant) tq = tq.eq("id", onlyTenant);
  const { data: tenants } = await tq;
  let created = 0;
  for (const t of tenants || []) {
    const limit = addWorkdays(today, t.notice_workdays);
    const { data: emps } = await db.from("lq_employees").select("id,customer_id,first_name,last_name,valid_until,offered_for")
      .eq("tenant_id", t.id).eq("active", true).not("valid_until", "is", null).lte("valid_until", limit);
    const due = (emps || []).filter((e) => e.offered_for !== e.valid_until);
    if (!due.length) continue;
    const byCustomer = new Map<string, typeof due>();
    for (const e of due) byCustomer.set(e.customer_id, [...(byCustomer.get(e.customer_id) || []), e]);
    const newOffers: string[] = [];
    for (const [cid, list] of byCustomer) {
      list.sort((a, b) => a.valid_until.localeCompare(b.valid_until));
      const { data: o, error } = await db.from("lq_offers").insert({
        tenant_id: t.id, customer_id: cid, kind: "B",
        items: list.map((e) => ({ employee_id: e.id, name: `${e.first_name} ${e.last_name}`, valid_until: e.valid_until })),
        unit_price: t.price_b, vat_rate: t.vat_payer ? t.vat_rate : 0,
        earliest_due: list[0].valid_until, valid_until: addDays(today, t.offer_valid_days), note: t.offer_note,
      }).select("number").single();
      if (error) { console.error(error); continue; }
      for (const e of list) await db.from("lq_employees").update({ offered_for: e.valid_until }).eq("id", e.id);
      newOffers.push(o!.number); created++;
    }
    if (newOffers.length) {
      const { data: admins } = await db.from("lq_staff").select("email").eq("tenant_id", t.id).eq("role", "spravca");
      const to = (admins || []).map((x) => x.email).filter(Boolean) as string[];
      const app = (Deno.env.get("LEARNIQ_APP_URL") || DEFAULT_APP).replace(/\/+$/, "");
      if (to.length) await sendMail(t as Tenant, to, `LearnIQ: ${newOffers.length} ${newOffers.length === 1 ? "nová cenová ponuka čaká" : "nové cenové ponuky čakajú"} na schválenie`,
        `<p>Blíži sa koniec platnosti oboznámenia BOZP (do ${t.notice_workdays} pracovných dní). Aplikácia pripravila návrhy cenových ponúk:</p><ul>${newOffers.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul><p>Skontrolujte ich a odošlite zákazníkom.</p>${button(`${app}/#/ponuky`, "Otvoriť ponuky", t.color)}`);
    }
  }
  return { created, today };
}

/* ======================================================================
   SMEROVANIE
   ====================================================================== */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Fail("Iba POST", 405);
    const body = await req.json().catch(() => ({}));
    switch (body.a) {
      case "p_open": return json(await pOpen(body));
      case "p_code": return json(await pCode(body));
      case "p_verify": return json(await pVerify(body));
      case "p_state": return json(await pState(req));
      case "p_topic": return json(await pTopic(req, body));
      case "p_beat": return json(await pBeat(req, body));
      case "p_done": return json(await pDone(req, body));
      case "p_test": return json(await pTestStart(req));
      case "p_answer": return json(await pAnswer(req, body));
      case "p_submit": return json(await pSubmit(req, body));
      case "p_sign": return json(await pSign(req, body));
      case "a_signature": return json(await aSignature(req, body));
      case "a_status": { await staffUser(req); return json({ email_ready: emailReady() }); }
      case "a_invite_staff": return json(await aInviteStaff(req, body));
      case "a_create_tenant": return json(await aCreateTenant(req, body));
      case "a_invites": return json(await aSendInvites(req, body));
      case "a_confirm": return json(await aConfirm(req, body));
      case "a_protocol": return json(await aProtocol(req, body));
      case "a_offer": return json(await aOffer(req, body));
      case "a_daily": { const st = await staffOf(req, uuid(body.tenant), true); return json(await dailyOffers(st.staff ? uuid(body.tenant) : undefined)); }
      case "cron": {
        const { data } = await db.from("lq_secrets").select("value").eq("key", "cron").single();
        if (!data || req.headers.get("x-cron-secret") !== data.value) throw new Fail("Neoprávnený prístup", 401);
        return json(await dailyOffers());
      }
      default: throw new Fail("Neznáma požiadavka", 400);
    }
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Nastala chyba na serveri. Skúste to znova." }, 500);
  }
});
