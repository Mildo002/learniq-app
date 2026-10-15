// LearnIQ – aplikácia školiteľa (správca, školitelia) a správcu platformy
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY, FN_URL, APP_VERSION } from "./config.js";
import { esc, $, $$, toast, fmtDate, fmtDT, eur, today, daysBetween, plural, icon, ask, sigPad } from "./util.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: false, storageKey: "learniq-auth" } });
const app = $("#app"), dlg = $("#dlg");
let me = null, staff = [], platform = false, T = null, role = null, badge = {}, pushOn = true;

const KIND = { A: "A – vstupné (4 h)", B: "B – opakované (3 h)" };
const STATUS = {
  pozvany: ["pozvaný", ""], overeny: ["overený", "acc"], studuje: ["študuje", "acc"], test: ["test", "acc"],
  vyhodnotene: ["čaká na potvrdenie", "warn"], vyhovel: ["vyhovel", "ok"], nevyhovel: ["nevyhovel", "bad"],
};
const pill = (st) => { const [t, c] = STATUS[st] || [st, ""]; return `<span class="pill ${c}">${esc(t)}</span>`; };
const isAdmin = () => role === "spravca" || platform;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

/* ---------------- serverová funkcia ---------------- */
async function fn(a, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || ""}` },
    body: JSON.stringify({ a, app: location.origin, ...body }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Spojenie zlyhalo.");
  return d;
}
const q = async (p) => { const { data, error } = await p; if (error) throw new Error(dbErr(error)); return data; };
function dbErr(e) {
  const m = e.message || "";
  if (/row-level security|permission denied/i.test(m)) return "Na túto akciu nemáte oprávnenie.";
  if (/duplicate key/i.test(m)) return "Taký záznam už existuje.";
  if (/check constraint/i.test(m)) return "Niektorá hodnota je mimo povoleného rozsahu.";
  return m.replace(/^.*?ERROR:\s*/, "") || "Uloženie zlyhalo.";
}

/* ---------------- dialóg ---------------- */
function modal(html, onSubmit) {
  dlg.innerHTML = `<form method="dialog">${html}</form>`;
  const form = dlg.querySelector("form");
  dlg.showModal();
  form.querySelectorAll("[data-close]").forEach((b) => b.onclick = (e) => { e.preventDefault(); dlg.close(); });
  if (onSubmit) form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter || form.querySelector("[type=submit]");
    if (btn) btn.disabled = true;
    try { const r = await onSubmit(new FormData(form), form, btn); if (r !== false) dlg.close(); }
    catch (er) { toast(er.message, true); }
    finally { if (btn) btn.disabled = false; }
  };
  return form;
}
const acts = (label = "Uložiť", extra = "") => `<div class="acts">${extra}<button class="btn" data-close>Zrušiť</button><button class="btn pri" type="submit">${label}</button></div>`;
function copyBox(v) { return `<div class="copy"><input readonly value="${esc(v)}" data-sel><button class="btn sm" type="button" data-copy="${esc(v)}">${icon("copy")}</button></div>`; }
document.addEventListener("focusin", (e) => { if (e.target.matches?.("[data-sel]")) e.target.select(); });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) { e.preventDefault(); navigator.clipboard?.writeText(b.dataset.copy).then(() => toast("Skopírované."), () => toast("Kopírovanie zlyhalo.", true)); }
});

/* ---------------- inštalácia do mobilu / počítača ---------------- */
let installEvt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $$(".inst").forEach((b) => b.classList.remove("hide")); });
window.addEventListener("appinstalled", () => { installEvt = null; $$(".inst").forEach((b) => b.classList.add("hide")); toast("Aplikácia je nainštalovaná."); });
const installBtn = (cls = "") => standalone() ? "" : `<button class="btn inst ${cls} ${installEvt || isIOS ? "" : "hide"}" type="button" data-install>${icon("down")} Inštalovať aplikáciu</button>`;
document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-install]")) return;
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $$(".inst").forEach((b) => b.classList.add("hide")); return; }
  modal(isIOS
    ? `<h2>Inštalácia na iPhone / iPad</h2><ol style="line-height:1.8"><li>Otvorte túto stránku v <b>Safari</b>.</li><li>Dole ťuknite na <b>Zdieľať</b> (štvorec so šípkou nahor).</li><li>Zvoľte <b>Pridať na plochu</b> a potom <b>Pridať</b>.</li></ol><p class="mut small">Ikona LearnIQ sa objaví na ploche a aplikácia sa otvára na celú obrazovku.</p><div class="acts"><button class="btn pri" data-close>Rozumiem</button></div>`
    : `<h2>Inštalácia aplikácie</h2><p>V prehliadači Chrome alebo Edge otvorte menu <b>⋮</b> a zvoľte <b>Inštalovať aplikáciu</b> / <b>Pridať na plochu</b>.</p><div class="acts"><button class="btn pri" data-close>Rozumiem</button></div>`);
});

/* ---------------- prihlásenie ---------------- */
function authPage(inner) {
  app.innerHTML = `<div class="auth"><div class="card"><img class="logo" src="img/logo-learniq.png" alt="LearnIQ">${inner}
    <div style="margin-top:14px">${installBtn("big")}</div>
    <p class="small mut" style="text-align:center;margin:18px 0 0">LearnIQ ${APP_VERSION} · súčasť aplikácií Keylo</p></div></div>`;
}
function loginScreen() {
  authPage(`<h2 style="text-align:center">Prihlásenie</h2>
    <form id="f"><label class="f"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
    <label class="f"><span>Heslo</span><input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn pri big">Prihlásiť sa</button></form>
    <p class="small mut" style="margin-top:14px">Prístup vytvára iba správca školiteľa alebo správca aplikácie – pošle vám odkaz na nastavenie hesla. Ak ste heslo zabudli, požiadajte ho o nový odkaz.</p>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), btn = e.target.querySelector("button"); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: fd.get("email").trim(), password: fd.get("password") });
    if (error) { btn.disabled = false; return toast(/invalid/i.test(error.message) ? "Nesprávny e-mail alebo heslo." : error.message, true); }
    start();
  };
}
async function inviteScreen(hash) {
  authPage(`<div class="spin"></div>`);
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  const { error } = await sb.auth.verifyOtp({ token_hash: hash, type: "recovery" });
  if (error) {
    authPage(`<h2>Odkaz už neplatí</h2><p class="mut">Odkaz na nastavenie hesla je jednorazový a platí obmedzený čas. Požiadajte správcu o nový.</p><a class="btn big" href="#/">Na prihlásenie</a>`);
    return;
  }
  history.replaceState(null, "", "#/heslo");
  passwordScreen(true);
}
function passwordScreen(first = false) {
  authPage(`<h2>${first ? "Vitajte v LearnIQ" : "Zmena hesla"}</h2><p class="mut">Nastavte si heslo (aspoň 10 znakov). Odporúčame frázu z niekoľkých slov.</p>
    <form id="f"><label class="f"><span>Nové heslo</span><input name="p1" type="password" minlength="10" required autocomplete="new-password"></label>
    <label class="f"><span>Zopakujte heslo</span><input name="p2" type="password" minlength="10" required autocomplete="new-password"></label>
    <button class="btn pri big">Uložiť heslo</button></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("p1") !== fd.get("p2")) return toast("Heslá sa nezhodujú.", true);
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: fd.get("p1") });
    if (error) { btn.disabled = false; return toast(/weak|pwned|leaked|compromised/i.test(error.message) ? "Toto heslo je príliš slabé alebo uniklo na internete. Zvoľte iné." : error.message, true); }
    toast("Heslo je nastavené.");
    location.hash = "#/"; start();
  };
}

/* ---------------- štart a rozloženie ---------------- */
async function start() {
  const h = location.hash;
  const m = h.match(/^#\/pozvanka\?t=([^&]+)/);
  if (m) return inviteScreen(decodeURIComponent(m[1]));
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginScreen();
  me = session.user;
  if (h === "#/heslo") return passwordScreen();
  try {
    const [st, pa] = await Promise.all([
      q(sb.from("lq_staff").select("tenant_id,role,full_name,cert_no,email,signature_path,lq_tenants(name,color,active)").eq("user_id", me.id)),
      q(sb.from("lq_platform_admins").select("user_id").eq("user_id", me.id)),
    ]);
    staff = st; platform = pa.length > 0;
  } catch (e) { return authPage(`<div class="note bad">${esc(e.message)}</div><button class="btn big" id="out">Odhlásiť</button>`), $("#out").onclick = logout; }
  if (!staff.length && !platform) {
    return authPage(`<h2>Bez prístupu</h2><p class="mut">Účet ${esc(me.email)} nie je priradený k žiadnemu školiteľovi. Požiadajte správcu o pozvánku.</p><button class="btn big" id="out">Odhlásiť</button>`), $("#out").onclick = logout;
  }
  await pickTenant(store.get("lq_tenant"));
  pushOn = (await pushState().catch(() => "off")) === "on";
  window.onhashchange = route;
  route();
  markSeen();
  syncPush();
}
async function pickTenant(id) {
  const row = staff.find((s) => s.tenant_id === id) || staff[0];
  let tid = row?.tenant_id || id;
  if (!tid && platform) { const ts = await q(sb.from("lq_tenants").select("id").order("created_at").limit(1)); tid = ts[0]?.id; }
  if (!tid) { T = null; role = null; return; }
  T = (await q(sb.from("lq_tenants").select("*").eq("id", tid).single()));
  role = staff.find((s) => s.tenant_id === tid)?.role || (platform ? "spravca" : null);
  store.set("lq_tenant", tid);
  document.documentElement.style.setProperty("--accent", T.color || "#8b5cf6");
}
async function logout() { await sb.auth.signOut(); location.hash = "#/"; location.reload(); }

async function loadBadges() {
  if (!T) return;
  const [w, o] = await Promise.all([
    sb.from("lq_attempts").select("id", { count: "exact", head: true }).eq("tenant_id", T.id).not("submitted_at", "is", null).is("confirmed_at", null),
    sb.from("lq_offers").select("id", { count: "exact", head: true }).eq("tenant_id", T.id).eq("status", "navrh"),
  ]);
  badge = { wait: w.count || 0, offers: o.count || 0 };
}

const NAV = [
  ["", "home", "Prehľad"], ["skolenia", "cal", "Školenia"], ["zakaznici", "users", "Zákazníci"],
  ["ponuky", "euro", "Ponuky"], ["kurz", "book", "Obsah kurzu"], ["nastavenia", "gear", "Nastavenia"],
];
function shell(cur, inner) {
  const tenants = staff.length > 1 ? `<select id="tsel" style="width:auto;min-height:36px;padding:4px 8px">${staff.map((s) => `<option value="${s.tenant_id}" ${s.tenant_id === T?.id ? "selected" : ""}>${esc(s.lq_tenants?.name)}</option>`).join("")}</select>` : "";
  const cnt = { "": badge.wait, ponuky: badge.offers };
  app.innerHTML = `
    <header class="top"><a class="brand" href="#/"><img src="img/icon-192.png" alt=""><span>${esc(T?.name || "LearnIQ")}</span></a>
      <span class="sp"></span>${installBtn("sm")}${tenants}
      <a class="btn sm ${pushOn ? "" : "warn"}" href="#/profil" id="bell" title="${pushOn ? "Upozornenia sú zapnuté" : "Zapnúť upozornenia"}">${icon("bell")}</a>
      <a class="btn sm" href="#/profil" title="Môj profil">${esc((staff.find((s) => s.tenant_id === T?.id)?.full_name || me.email).split(" ")[0])}</a>
      <button class="btn sm" id="out" title="Odhlásiť">${icon("out")}</button></header>
    <div class="layout"><nav class="nav">
      ${T ? NAV.filter(([k]) => k !== "kurz" || isAdmin()).map(([k, ic, l]) => `<a href="#/${k}" class="${cur === k ? "on" : ""}">${icon(ic)}<span>${l}</span>${cnt[k] ? `<span class="cnt">${cnt[k]}</span>` : ""}</a>`).join("") : ""}
      ${platform ? `<a href="#/platforma" class="${cur === "platforma" ? "on" : ""}">${icon("shield")}<span>Platforma</span></a>` : ""}
    </nav><main class="main">${inner}</main></div>`;
  $("#out").onclick = logout;
  $("#tsel")?.addEventListener("change", async (e) => { await pickTenant(e.target.value); location.hash = "#/"; route(); });
}

async function route() {
  if (dlg.open) dlg.close();
  const [path, arg] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (path === "pozvanka" || path === "heslo") return start();
  const views = { "": vHome, skolenia: vSessions, skolenie: vSession, zakaznici: vCustomers, zakaznik: vCustomer, ponuky: vOffers, kurz: vCourse, nastavenia: vSettings, profil: vProfile, platforma: vPlatform };
  const v = views[path] || vHome;
  if (!T && v !== vPlatform && v !== vProfile) { location.hash = platform ? "#/platforma" : "#/profil"; return; }
  shell(path === "skolenie" ? "skolenia" : path === "zakaznik" ? "zakaznici" : path, `<div class="spin"></div>`);
  try {
    await loadBadges(); shell(path === "skolenie" ? "skolenia" : path === "zakaznik" ? "zakaznici" : path, `<div class="spin"></div>`); await v(arg);
    if (path === "" && !pushOn && store.get("lq_push_hint") !== "0") {
      $(".main").insertAdjacentHTML("afterbegin", `<div class="note warn" id="phint">${icon("bell")} <b>Zapnite si upozornenia</b> – dozviete sa hneď, keď test čaká na potvrdenie, aj pri zhasnutom displeji. <a href="#/profil">Zapnúť</a> · <a href="#" id="phx">Teraz nie</a></div>`);
      $("#phx").onclick = (e) => { e.preventDefault(); store.set("lq_push_hint", "0"); $("#phint").remove(); };
    }
  }
  catch (e) { $(".main").innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
}
const main = (html) => { $(".main").innerHTML = html; };

/* ---------------- platnosť školení ---------------- */
function validity(e) {
  if (!e.valid_until) return { cls: "", txt: "bez záznamu", sort: -1 };
  const d = daysBetween(today(), e.valid_until);
  if (d < 0) return { cls: "bad", txt: `vypršalo ${fmtDate(e.valid_until)}`, sort: 0 };
  if (d <= 60) return { cls: "warn", txt: `do ${fmtDate(e.valid_until)} (${d} ${plural(d, "deň", "dni", "dní")})`, sort: 1 };
  return { cls: "ok", txt: `do ${fmtDate(e.valid_until)}`, sort: 2 };
}

/* ======================================================================
   PREHĽAD
   ====================================================================== */
async function vHome() {
  const lim = new Date(); lim.setDate(lim.getDate() + 60);
  const [waiting, sessions, offers, expiring, st] = await Promise.all([
    q(sb.from("lq_attempts").select("id,no,submitted_at,correct,total,percent,passed,enrollment_id,lq_enrollments(first_name,last_name,email,session_id)").eq("tenant_id", T.id).not("submitted_at", "is", null).is("confirmed_at", null).order("submitted_at")),
    q(sb.from("lq_sessions").select("id", { count: "exact" }).eq("tenant_id", T.id).eq("status", "otvorene")),
    q(sb.from("lq_offers").select("id,number,total,count,earliest_due,lq_customers(name)").eq("tenant_id", T.id).eq("status", "navrh").order("earliest_due")),
    q(sb.from("lq_employees").select("id,first_name,last_name,valid_until,customer_id,lq_customers(name)").eq("tenant_id", T.id).eq("active", true).not("valid_until", "is", null).lte("valid_until", lim.toISOString().slice(0, 10)).order("valid_until").limit(30)),
    fn("a_status").catch(() => ({ email_ready: true })),
  ]);
  main(`
    <div class="hdr"><h1>Prehľad</h1><a class="btn pri" href="#/skolenia?nove=1">${icon("plus")} Nové školenie</a></div>
    ${!st.email_ready ? `<div class="note warn"><b>Odosielanie e-mailov ešte nie je zapnuté.</b> Kódy, pozvánky a protokoly sa zatiaľ neposielajú – odkazy môžete skopírovať a PDF stiahnuť. Majiteľ aplikácie musí nastaviť kľúč RESEND_API_KEY.</div>` : ""}
    ${!T.rep_name ? `<div class="note warn">Doplňte v <a href="#/nastavenia">nastaveniach</a> odborného zástupcu, číslo osvedčenia a oprávnenie NIP – uvádzajú sa v protokoloch.</div>` : ""}
    <div class="grid" style="margin-bottom:16px">
      <a class="stat" href="#/"><b>${waiting.length}</b><span>čaká na potvrdenie</span></a>
      <a class="stat" href="#/skolenia"><b>${sessions.length}</b><span>otvorené školenia</span></a>
      <a class="stat" href="#/ponuky"><b>${offers.length}</b><span>ponuky na schválenie</span></a>
      <a class="stat" href="#/zakaznici"><b>${expiring.length}</b><span>platnosť do 60 dní</span></a>
    </div>
    <div class="card pad0"><div style="padding:14px 16px 4px"><h2>Čaká na vaše potvrdenie</h2><p class="small mut">Aplikácia test vyhodnotila. Ako osoba s osvedčením potvrdíte správnosť – potom sa vytvorí protokol a odošle školenému.</p></div>
      <div class="list">${waiting.length ? waiting.map((a) => `<div><span class="dot ${a.passed ? "ok" : "bad"}"></span>
        <div class="grow"><b>${esc(a.lq_enrollments?.first_name)} ${esc(a.lq_enrollments?.last_name)}</b><span class="small mut">${fmtDT(a.submitted_at)} · ${a.correct}/${a.total} (${Math.round(a.percent)} %) · ${a.passed ? "vyhovel" : "nevyhovel"}</span></div>
        <button class="btn sm pri" data-att="${a.id}">Skontrolovať</button></div>`).join("") : `<div class="empty">Nič nečaká.</div>`}</div></div>
    <div class="card pad0"><div style="padding:14px 16px 4px"><h2>Cenové ponuky na schválenie</h2></div>
      <div class="list">${offers.length ? offers.map((o) => `<a href="#/ponuky?o=${o.id}"><span class="pill warn">návrh</span><div class="grow"><b>${esc(o.lq_customers?.name)}</b><span class="small mut">${esc(o.number)} · ${o.count} ${plural(o.count, "osoba", "osoby", "osôb")} · najskôr ${fmtDate(o.earliest_due)}</span></div><b>${eur(o.total)}</b></a>`).join("") : `<div class="empty">Žiadne nové návrhy. Aplikácia ich pripraví sama ${T.notice_workdays} pracovných dní pred koncom platnosti.</div>`}</div></div>
    <div class="card pad0"><div style="padding:14px 16px 4px"><h2>Končiaca platnosť</h2></div>
      <div class="list">${expiring.length ? expiring.map((e) => { const v = validity(e); return `<a href="#/zakaznik/${e.customer_id}"><span class="dot ${v.cls}"></span><div class="grow"><b>${esc(e.first_name)} ${esc(e.last_name)}</b><span class="small mut">${esc(e.lq_customers?.name)}</span></div><span class="small">${v.txt}</span></a>`; }).join("") : `<div class="empty">V najbližších 60 dňoch nikomu nekončí platnosť.</div>`}</div></div>`);
  $$("[data-att]").forEach((b) => b.onclick = () => attemptDialog(b.dataset.att, () => route()));
}

/* potvrdenie výsledku testu */
async function attemptDialog(id, after) {
  const a = await q(sb.from("lq_attempts").select("*,lq_enrollments(first_name,last_name,email,company)").eq("id", id).single());
  const e = a.lq_enrollments || {};
  const qs = a.questions || [], ans = a.answers || [];
  const mine = staff.find((s) => s.tenant_id === T.id);
  modal(`<h2>Test – ${esc(e.first_name)} ${esc(e.last_name)}</h2>
    <p class="mut small">${esc(e.email)} · ${esc(e.company || "")} · pokus ${a.no} · ${fmtDT(a.submitted_at)}</p>
    <div id="sigbox" class="small mut" style="margin-bottom:10px">${a.signed_at ? "Načítavam podpis…" : `<span class="pill warn">bez podpisu</span> Školený sa po teste ešte nepodpísal. Ak potvrdíte teraz, protokol bude bez jeho podpisu (doplní sa, keď sa podpíše).`}</div>
    <div class="note ${a.passed ? "ok" : "bad"}"><b>${a.correct} z ${a.total} (${Math.round(a.percent)} %) – aplikácia vyhodnotila: ${a.passed ? "VYHOVEL" : "NEVYHOVEL"}</b><br>Hranica úspešnosti ${T.pass_percent} %.</div>
    <div style="max-height:45vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:0 12px">
    ${qs.map((x, i) => `<div class="q"><b class="small">${i + 1}. ${esc(x.text)}</b>${x.options.map((o, k) => `<div class="opt small ${k === x.correct ? "good" : ans[i] === k ? "wrong" : ""}">${ans[i] === k ? "●" : "○"} ${"abc"[k]}) ${esc(o)}</div>`).join("")}${ans[i] == null ? `<div class="small" style="color:var(--bad)">bez odpovede</div>` : ""}</div>`).join("")}</div>
    ${!mine?.signature_path && !a.confirmed_at ? `<p class="small mut" style="margin-top:10px">Tip: v <a href="#/profil">profile</a> si uložte svoj podpis – zobrazí sa v protokole pri potvrdení.</p>` : ""}
    ${a.confirmed_at ? `<p class="note ${a.passed ? "ok" : "bad"}" style="margin-top:12px"><b>Výsledok: ${a.passed ? "VYHOVEL" : "NEVYHOVEL"}</b>${a.app_passed != null && a.app_passed !== a.passed ? ` (zmenené hodnotiteľom, aplikácia: ${a.app_passed ? "vyhovel" : "nevyhovel"})` : ""}<br>Potvrdil(a) ${esc(a.confirmed_name)} ${fmtDT(a.confirmed_at)}.${a.note ? `<br>Poznámka: ${esc(a.note)}` : ""}</p><div class="acts"><button class="btn" data-close>Zavrieť</button></div>` : `
    <label class="f" style="margin-top:12px"><span>Poznámka k vyhodnoteniu (povinná, ak meníte výsledok aplikácie)</span><input name="note" maxlength="300"></label>
    <p class="small mut">Rozhodujete ako <b>${esc(mine?.full_name || me.email)}</b>${mine?.cert_no ? `, osvedčenie č. ${esc(mine.cert_no)}` : ` – <a href="#/profil">doplňte číslo osvedčenia</a>`}. Po výbere sa vytvorí protokol a odošle školenému.</p>
    <div class="verdict"><button class="btn ok" type="submit" data-verdict="vyhovel">✓ VYHOVEL</button><button class="btn no" type="submit" data-verdict="nevyhovel">✗ NEVYHOVEL</button></div>
    <div class="acts"><button class="btn" data-close>Zrušiť</button></div>`}`,
  async (fd, _f, btn) => {
    const verdict = btn?.dataset.verdict;
    if (!verdict) return false;
    const passed = verdict === "vyhovel", note = String(fd.get("note") || "").trim();
    if (passed !== !!a.passed) {
      if (note.length < 3) { toast("Meníte výsledok aplikácie – doplňte poznámku s dôvodom.", true); return false; }
      if (!(await ask(`Aplikácia vyhodnotila ${a.passed ? "VYHOVEL" : "NEVYHOVEL"}. Naozaj chcete výsledok zmeniť na ${passed ? "VYHOVEL" : "NEVYHOVEL"}?`, "Zmeniť výsledok"))) return false;
    }
    const r = await fn("a_confirm", { attempt: id, note, verdict });
    toast(`${passed ? "VYHOVEL" : "NEVYHOVEL"} – ${r.emailed ? "protokol odoslaný e-mailom." : "protokol je vytvorený (e-mail sa neodoslal, stiahnite ho v školení)."}`);
    after?.();
  });
  if (a.signed_at && a.signature_path) {
    const { data } = await sb.storage.from("learniq").createSignedUrl(a.signature_path, 300);
    const box = $("#sigbox");
    if (box) box.innerHTML = data?.signedUrl ? `Podpis školeného (${fmtDT(a.signed_at)}):<img class="sig-img" src="${esc(data.signedUrl)}" alt="Podpis">` : `Podpísané ${fmtDT(a.signed_at)}.`;
  }
}

/* ======================================================================
   ŠKOLENIA
   ====================================================================== */
async function vSessions() {
  const [ss, custs] = await Promise.all([
    q(sb.from("lq_sessions").select("id,kind,protocol_no,status,due_on,starts_on,created_at,lq_customers(name),lq_enrollments(status)").eq("tenant_id", T.id).order("created_at", { ascending: false }).limit(200)),
    q(sb.from("lq_customers").select("id,name").eq("tenant_id", T.id).order("name")),
  ]);
  let filter = "otvorene";
  const draw = () => {
    const list = ss.filter((s) => filter === "all" || s.status === filter);
    $("#list").innerHTML = list.length ? `<table class="t"><thead><tr><th>Protokol</th><th>Zákazník</th><th>Druh</th><th>Účastníci</th><th>Termín</th><th></th></tr></thead><tbody>${list.map((s) => {
      const en = s.lq_enrollments || [], ok = en.filter((x) => x.status === "vyhovel").length, w = en.filter((x) => x.status === "vyhodnotene").length;
      return `<tr class="click" data-href="#/skolenie/${s.id}"><td><b>${esc(s.protocol_no)}</b></td><td>${esc(s.lq_customers?.name)}</td><td>${s.kind}</td>
        <td>${ok}/${en.length} vyhovelo${w ? ` <span class="pill warn">${w} čaká</span>` : ""}</td><td>${s.due_on ? fmtDate(s.due_on) : "–"}</td><td>${s.status === "uzavrete" ? `<span class="pill">uzavreté</span>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<div class="empty">Žiadne školenia.</div>`;
    $$("[data-href]").forEach((r) => r.onclick = () => location.hash = r.dataset.href);
  };
  main(`<div class="hdr"><h1>Školenia</h1><button class="btn pri" id="new">${icon("plus")} Nové školenie</button></div>
    <div class="tabs"><button data-f="otvorene" class="on">Otvorené</button><button data-f="uzavrete">Uzavreté</button><button data-f="all">Všetky</button></div>
    <div class="card pad0 tscroll" id="list"></div>`);
  $$("[data-f]").forEach((b) => b.onclick = () => { filter = b.dataset.f; $$("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  draw();
  $("#new").onclick = () => newSession(custs);
  if (location.hash.includes("nove=1")) newSession(custs);
}

function newSession(custs, preset = {}) {
  if (!custs.length) { toast("Najprv pridajte zákazníka."); location.hash = "#/zakaznici?nove=1"; return; }
  const mine = staff.find((s) => s.tenant_id === T.id);
  modal(`<h2>Nové školenie</h2>
    <label class="f"><span>Zákazník (zamestnávateľ)</span><select name="customer_id" required>${custs.map((c) => `<option value="${c.id}" ${preset.customer_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="f"><span>Druh oboznámenia</span><select name="kind"><option value="B">${KIND.B}</option><option value="A" ${preset.kind === "A" ? "selected" : ""}>${KIND.A}</option></select></label>
    <div class="grid2"><label class="f"><span>Absolvovať do</span><input type="date" name="due_on" value="${esc(preset.due_on || "")}"></label>
    <label class="f"><span>Školiteľ (lektor)</span><input name="lektor_name" value="${esc(mine?.full_name || T.rep_name || "")}"></label></div>
    <label class="f"><span>Vnútorné predpisy a riziká zamestnávateľa (nepovinné – zobrazia sa v téme 10)</span><textarea name="rules_text" maxlength="20000" placeholder="Napr. pracovisko, riziká, osobné ochranné pracovné prostriedky, únikové cesty…"></textarea></label>
    ${acts("Vytvoriť")}`,
  async (fd) => {
    const row = Object.fromEntries(fd);
    const s = await q(sb.from("lq_sessions").insert({ tenant_id: T.id, customer_id: row.customer_id, kind: row.kind, due_on: row.due_on || null, lektor_name: row.lektor_name || null, rules_text: row.rules_text || null, place: "e-learning", starts_on: today(), created_by: me.id }).select("id").single());
    if (preset.employees?.length) await addEnrollments(s.id, preset.employees);
    location.hash = `#/skolenie/${s.id}`;
  });
}

async function addEnrollments(sid, emps) {
  const rows = emps.filter((e) => e.email).map((e) => ({ tenant_id: T.id, session_id: sid, employee_id: e.id || null, email: e.email.trim().toLowerCase(), first_name: e.first_name, last_name: e.last_name, position: e.position || null }));
  if (!rows.length) return 0;
  const existing = await q(sb.from("lq_enrollments").select("email").eq("session_id", sid));
  const have = new Set(existing.map((x) => x.email));
  const fresh = rows.filter((r) => !have.has(r.email));
  if (fresh.length) await q(sb.from("lq_enrollments").insert(fresh));
  return fresh.length;
}

async function vSession(id) {
  const s = await q(sb.from("lq_sessions").select("*,lq_customers(id,name,email)").eq("id", id).single());
  const ens = await q(sb.from("lq_enrollments").select("*").eq("session_id", id).order("last_name"));
  const atts = ens.length ? await q(sb.from("lq_attempts").select("id,enrollment_id,no,submitted_at,correct,total,percent,passed,confirmed_at").in("enrollment_id", ens.map((x) => x.id))) : [];
  const base = location.origin;
  const openLink = `${base}/kurz.html#s=${s.open_token}`;
  const open = s.status === "otvorene";
  main(`<a class="back" href="#/skolenia">${icon("back")} Školenia</a>
    <div class="hdr"><h1>Školenie ${esc(s.protocol_no)}</h1>${open ? `<button class="btn" id="close">Uzavrieť</button>` : `<span class="pill">uzavreté</span><button class="btn sm" id="reopen">Znova otvoriť</button>`}</div>
    <div class="card"><div class="grid2">
      <div><span class="small mut">Zákazník</span><br><a href="#/zakaznik/${s.customer_id}"><b>${esc(s.lq_customers?.name)}</b></a></div>
      <div><span class="small mut">Druh</span><br><b>${KIND[s.kind]}</b></div>
      <div><span class="small mut">Absolvovať do</span><br>${s.due_on ? fmtDate(s.due_on) : "–"}</div>
      <div><span class="small mut">Školiteľ</span><br>${esc(s.lektor_name || "–")}</div></div>
      <p class="small mut" style="margin:12px 0 0">Podmienky: ${T.study_time_limit ? "časový limit štúdia zapnutý" : "bez limitu štúdia"} · ${T.test_time_limit ? `test ${T.test_minutes} min` : "test bez časového limitu"} · úspešnosť ${T.pass_percent} % · ${T.require_confirm ? "výsledok potvrdzujete vy" : "výsledok potvrdzuje aplikácia automaticky"} · <a href="#/nastavenia">zmeniť</a></p>
      <button class="btn sm" id="edit" style="margin-top:10px">Upraviť školenie</button>
    </div>
    <div class="card"><div class="row between"><h2 style="margin:0">Spoločný odkaz</h2>
      <label class="row small"><input type="checkbox" id="openlink" ${s.open_link_enabled ? "checked" : ""}> povolený</label></div>
      <p class="small mut">Jeden odkaz pre všetkých zamestnancov zákazníka (napr. poslať vedúcemu). Každý sa overí vlastným e-mailom a údajmi a zaradí sa automaticky. Bezpečnejšie sú osobné pozvánky nižšie.</p>
      ${s.open_link_enabled ? copyBox(openLink) : ""}</div>
    <div class="card pad0"><div class="row between" style="padding:14px 16px"><h2 style="margin:0">Účastníci (${ens.length})</h2>
      <div class="row">${open ? `<button class="btn sm" id="add">${icon("plus")} Pridať</button><button class="btn sm pri" id="inv">${icon("mail")} Poslať pozvánky</button>` : ""}</div></div>
      <div class="tscroll"><table class="t"><thead><tr><th>Meno</th><th>Stav</th><th>Test</th><th></th></tr></thead><tbody>
      ${ens.length ? ens.map((e) => {
        const my = atts.filter((a) => a.enrollment_id === e.id).sort((a, b) => b.no - a.no), la = my[0];
        return `<tr><td><b>${esc(e.first_name || "")} ${esc(e.last_name || "")}</b><br><span class="small mut">${esc(e.email)}${e.company ? ` · ${esc(e.company)}` : ""}</span></td>
          <td>${pill(e.status)}${e.invited_at ? `<br><span class="small mut">pozvaný ${fmtDT(e.invited_at)}</span>` : ""}</td>
          <td>${la?.submitted_at ? `${la.correct}/${la.total} (${Math.round(la.percent)} %)${my.length > 1 ? ` · ${my.length}. pokus` : ""}` : la ? "prebieha" : "–"}</td>
          <td style="white-space:nowrap;text-align:right">
            ${la?.submitted_at ? `<button class="btn sm ${la.confirmed_at ? "" : "pri"}" data-att="${la.id}">${la.confirmed_at ? "Test" : "Potvrdiť"}</button>` : ""}
            ${e.protocol_path ? `<button class="btn sm" data-pdf="${e.id}" title="Stiahnuť protokol">${icon("down")}</button><button class="btn sm" data-resend="${e.id}" title="Poslať protokol znova">${icon("mail")}</button>` : ""}
            ${open && !["vyhovel", "nevyhovel", "vyhodnotene"].includes(e.status) ? `<button class="btn sm" data-link="${e.id}" title="Osobný odkaz">${icon("copy")}</button>` : ""}
            ${["pozvany", "overeny"].includes(e.status) ? `<button class="btn sm bad" data-del="${e.id}" title="Odobrať">✕</button>` : ""}
          </td></tr>`;
      }).join("") : `<tr><td colspan="4" class="empty">Zatiaľ nikto. Pridajte zamestnancov zákazníka.</td></tr>`}
      </tbody></table></div></div>`);
  const reload = () => vSession(id);
  $("#close")?.addEventListener("click", async () => { if (!await ask("Uzavrieť školenie? Kto ho nedokončil, už nebude môcť pokračovať.")) return; await q(sb.from("lq_sessions").update({ status: "uzavrete" }).eq("id", id)); reload(); });
  $("#reopen")?.addEventListener("click", async () => { await q(sb.from("lq_sessions").update({ status: "otvorene" }).eq("id", id)); reload(); });
  $("#openlink").onchange = async (e) => { await q(sb.from("lq_sessions").update({ open_link_enabled: e.target.checked }).eq("id", id)); reload(); };
  $("#edit").onclick = () => modal(`<h2>Upraviť školenie</h2>
    <div class="grid2"><label class="f"><span>Absolvovať do</span><input type="date" name="due_on" value="${esc(s.due_on || "")}"></label>
    <label class="f"><span>Školiteľ (lektor)</span><input name="lektor_name" value="${esc(s.lektor_name || "")}"></label></div>
    <label class="f"><span>Vnútorné predpisy a riziká zamestnávateľa</span><textarea name="rules_text" maxlength="20000">${esc(s.rules_text || "")}</textarea></label>${acts()}`,
  async (fd) => { await q(sb.from("lq_sessions").update({ due_on: fd.get("due_on") || null, lektor_name: fd.get("lektor_name") || null, rules_text: fd.get("rules_text") || null }).eq("id", id)); reload(); });
  $("#add")?.addEventListener("click", () => addParticipants(s, ens, reload));
  $("#inv")?.addEventListener("click", async (e) => {
    const pending = ens.filter((x) => ["pozvany", "overeny", "studuje", "test"].includes(x.status));
    if (!pending.length) return toast("Nie je komu poslať pozvánku.");
    if (!await ask(`Poslať pozvánku e-mailom ${pending.length} ${plural(pending.length, "účastníkovi", "účastníkom", "účastníkom")}?`)) return;
    e.target.disabled = true;
    try {
      const r = await fn("a_invites", { session: id });
      if (!r.email_ready) showLinks(r.links, "E-maily sa zatiaľ neposielajú – pošlite osobné odkazy sami:");
      else toast(`Odoslané pozvánky: ${r.sent}.`);
      reload();
    } catch (er) { toast(er.message, true); e.target.disabled = false; }
  });
  $$("[data-link]").forEach((b) => b.onclick = () => { const e = ens.find((x) => x.id === b.dataset.link); showLinks([{ email: e.email, link: `${base}/kurz.html#i=${e.invite_token}` }], "Osobný odkaz – neposielajte ho nikomu inému:"); });
  $$("[data-att]").forEach((b) => b.onclick = () => attemptDialog(b.dataset.att, reload));
  $$("[data-pdf]").forEach((b) => b.onclick = async () => { try { const r = await fn("a_protocol", { enrollment: b.dataset.pdf }); location.href = r.url; } catch (e) { toast(e.message, true); } });
  $$("[data-resend]").forEach((b) => b.onclick = async () => { b.disabled = true; try { const r = await fn("a_protocol", { enrollment: b.dataset.resend, resend: true }); toast(r.emailed ? "Protokol odoslaný." : "Protokol obnovený, e-mail sa neodoslal."); } catch (e) { toast(e.message, true); } b.disabled = false; });
  $$("[data-del]").forEach((b) => b.onclick = async () => { if (!await ask("Odobrať účastníka zo školenia?")) return; await q(sb.from("lq_enrollments").delete().eq("id", b.dataset.del)); reload(); });
}
function showLinks(links, title) {
  modal(`<h2>Odkazy na školenie</h2><p class="mut">${esc(title)}</p>${links.map((l) => `<label class="f"><span>${esc(l.email)}</span>${copyBox(l.link)}</label>`).join("")}<div class="acts"><button class="btn pri" data-close>Hotovo</button></div>`);
}
async function addParticipants(s, ens, after) {
  const emps = await q(sb.from("lq_employees").select("*").eq("customer_id", s.customer_id).eq("active", true).order("last_name"));
  const have = new Set(ens.map((e) => e.email));
  const avail = emps.filter((e) => !e.email || !have.has(e.email.toLowerCase()));
  modal(`<h2>Pridať účastníkov</h2>
    ${avail.length ? `<p class="small mut">Zamestnanci zákazníka ${esc(s.lq_customers?.name)}:</p><div style="max-height:40vh;overflow:auto">${avail.map((e) => { const v = validity(e); return `<label class="switch"><input type="checkbox" name="emp" value="${e.id}" ${e.email ? "" : "disabled"} ${e.email && v.sort <= 1 ? "checked" : ""}>
      <span><b>${esc(e.first_name)} ${esc(e.last_name)}</b><small>${e.email ? esc(e.email) : "chýba e-mail – doplňte ho v karte zákazníka"} · <span class="dot ${v.cls}"></span> ${v.txt}</small></span></label>`; }).join("")}</div>` : `<p class="mut">Všetci zamestnanci s e-mailom sú už pridaní.</p>`}
    <h3 style="margin-top:14px">Nový zamestnanec</h3>
    <div class="grid2"><label class="f"><span>Meno</span><input name="fn"></label><label class="f"><span>Priezvisko</span><input name="ln"></label></div>
    <label class="f"><span>E-mail</span><input name="em" type="email"></label>${acts("Pridať")}`,
  async (fd) => {
    const pick = emps.filter((e) => fd.getAll("emp").includes(e.id));
    if (fd.get("em")) {
      if (!fd.get("fn") || !fd.get("ln")) throw new Error("Zadajte meno aj priezvisko nového zamestnanca.");
      const ne = await q(sb.from("lq_employees").insert({ tenant_id: T.id, customer_id: s.customer_id, first_name: fd.get("fn").trim(), last_name: fd.get("ln").trim(), email: fd.get("em").trim().toLowerCase() }).select("*").single());
      pick.push(ne);
    }
    const n = await addEnrollments(s.id, pick);
    toast(`Pridaní: ${n}.`); after();
  });
}

/* ======================================================================
   ZÁKAZNÍCI A ZAMESTNANCI
   ====================================================================== */
async function vCustomers() {
  const [cs, emps] = await Promise.all([
    q(sb.from("lq_customers").select("id,name,ico,email,contact_name").eq("tenant_id", T.id).order("name")),
    q(sb.from("lq_employees").select("customer_id,valid_until").eq("tenant_id", T.id).eq("active", true)),
  ]);
  main(`<div class="hdr"><h1>Zákazníci</h1><button class="btn pri" id="new">${icon("plus")} Nový zákazník</button></div>
    <input id="srch" placeholder="Hľadať…" style="margin-bottom:12px">
    <div class="card pad0"><div class="list" id="list"></div></div>`);
  const draw = (f = "") => {
    const list = cs.filter((c) => !f || `${c.name} ${c.ico || ""}`.toLowerCase().includes(f.toLowerCase()));
    $("#list").innerHTML = list.length ? list.map((c) => {
      const e = emps.filter((x) => x.customer_id === c.id), v = e.map(validity);
      const bad = v.filter((x) => x.cls === "bad").length, warn = v.filter((x) => x.cls === "warn").length;
      return `<a href="#/zakaznik/${c.id}"><div class="grow"><b>${esc(c.name)}</b><span class="small mut">${c.ico ? `IČO ${esc(c.ico)} · ` : ""}${e.length} ${plural(e.length, "zamestnanec", "zamestnanci", "zamestnancov")}</span></div>
        ${bad ? `<span class="pill bad">${bad} vypršalo</span>` : ""}${warn ? `<span class="pill warn">${warn} končí</span>` : ""}</a>`;
    }).join("") : `<div class="empty">Žiadni zákazníci.</div>`;
  };
  draw();
  $("#srch").oninput = (e) => draw(e.target.value);
  $("#new").onclick = () => customerDialog(null);
  if (location.hash.includes("nove=1")) customerDialog(null);
}
function customerDialog(c) {
  modal(`<h2>${c ? "Upraviť zákazníka" : "Nový zákazník"}</h2>
    <label class="f"><span>Obchodné meno</span><input name="name" required maxlength="200" value="${esc(c?.name || "")}"></label>
    <div class="grid2"><label class="f"><span>IČO</span><input name="ico" value="${esc(c?.ico || "")}"></label><label class="f"><span>DIČ / IČ DPH</span><input name="dic" value="${esc(c?.dic || "")}"></label></div>
    <label class="f"><span>Adresa</span><input name="address" value="${esc(c?.address || "")}"></label>
    <div class="grid2"><label class="f"><span>Kontaktná osoba</span><input name="contact_name" value="${esc(c?.contact_name || "")}"></label><label class="f"><span>Telefón</span><input name="phone" value="${esc(c?.phone || "")}"></label></div>
    <label class="f"><span>E-mail (ponuky a kópie protokolov)</span><input name="email" type="email" value="${esc(c?.email || "")}"></label>
    <label class="f"><span>Poznámka</span><textarea name="note">${esc(c?.note || "")}</textarea></label>${acts()}`,
  async (fd) => {
    const row = Object.fromEntries([...fd].map(([k, v]) => [k, String(v).trim() || null]));
    if (row.email) row.email = row.email.toLowerCase();
    if (c) { await q(sb.from("lq_customers").update(row).eq("id", c.id)); route(); }
    else { const n = await q(sb.from("lq_customers").insert({ ...row, tenant_id: T.id }).select("id").single()); location.hash = `#/zakaznik/${n.id}`; }
  });
}
async function vCustomer(id) {
  const [c, emps, ss] = await Promise.all([
    q(sb.from("lq_customers").select("*").eq("id", id).single()),
    q(sb.from("lq_employees").select("*").eq("customer_id", id).order("last_name")),
    q(sb.from("lq_sessions").select("id,protocol_no,kind,status,created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(20)),
  ]);
  const active = emps.filter((e) => e.active);
  main(`<a class="back" href="#/zakaznici">${icon("back")} Zákazníci</a>
    <div class="hdr"><h1>${esc(c.name)}</h1><button class="btn" id="edit">Upraviť</button></div>
    <div class="card small">${[c.ico && `IČO ${esc(c.ico)}`, c.dic && esc(c.dic), c.address && esc(c.address), c.contact_name && esc(c.contact_name), c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, c.phone && esc(c.phone)].filter(Boolean).join(" · ") || `<span class="mut">Bez kontaktných údajov.</span>`}
      ${!c.email ? `<p class="note warn" style="margin:10px 0 0">Doplňte e-mail – bez neho nemožno poslať cenovú ponuku.</p>` : ""}</div>
    <div class="card pad0"><div class="row between" style="padding:14px 16px"><h2 style="margin:0">Zamestnanci (${active.length})</h2>
      <div class="row"><button class="btn sm" id="csv">Vložiť zoznam</button><button class="btn sm" id="addE">${icon("plus")} Pridať</button><button class="btn sm pri" id="plan">Naplánovať školenie</button></div></div>
      <div class="tscroll"><table class="t"><thead><tr><th><input type="checkbox" id="all"></th><th>Meno</th><th>Pracovisko</th><th>Posledné školenie</th><th>Platnosť</th><th></th></tr></thead><tbody>
      ${active.length ? active.sort((a, b) => validity(a).sort - validity(b).sort || (a.valid_until || "").localeCompare(b.valid_until || "")).map((e) => { const v = validity(e); return `<tr>
        <td><input type="checkbox" class="sel" value="${e.id}" ${v.sort <= 1 && e.email ? "checked" : ""}></td>
        <td><b>${esc(e.first_name)} ${esc(e.last_name)}</b><br><span class="small mut">${esc(e.email || "bez e-mailu")}</span></td>
        <td>${esc(e.position || "–")}</td><td>${e.last_training_on ? `${fmtDate(e.last_training_on)}${e.last_kind ? ` (${e.last_kind})` : ""}` : "–"}</td>
        <td><span class="dot ${v.cls}"></span> ${v.txt}${e.offered_for && e.offered_for === e.valid_until ? `<br><span class="pill acc">ponuka pripravená</span>` : ""}</td>
        <td><button class="btn sm" data-e="${e.id}">Upraviť</button></td></tr>`; }).join("") : `<tr><td colspan="6" class="empty">Zatiaľ žiadni zamestnanci.</td></tr>`}
      </tbody></table></div></div>
    ${emps.length > active.length ? `<p class="small mut">${emps.length - active.length} vyradených zamestnancov sa nezobrazuje.</p>` : ""}
    <div class="card pad0"><div style="padding:14px 16px 4px"><h2>Školenia</h2></div><div class="list">${ss.length ? ss.map((s) => `<a href="#/skolenie/${s.id}"><div class="grow"><b>${esc(s.protocol_no)}</b><span class="small mut">${KIND[s.kind]} · ${fmtDate(s.created_at)}</span></div>${s.status === "uzavrete" ? `<span class="pill">uzavreté</span>` : `<span class="pill acc">otvorené</span>`}</a>`).join("") : `<div class="empty">Žiadne.</div>`}</div></div>`);
  $("#edit").onclick = () => customerDialog(c);
  $("#all").onchange = (e) => $$(".sel").forEach((x) => x.checked = e.target.checked);
  $("#addE").onclick = () => employeeDialog(c, null);
  $$("[data-e]").forEach((b) => b.onclick = () => employeeDialog(c, emps.find((x) => x.id === b.dataset.e)));
  $("#csv").onclick = () => csvDialog(c);
  $("#plan").onclick = async () => {
    const ids = $$(".sel").filter((x) => x.checked).map((x) => x.value);
    const pick = emps.filter((e) => ids.includes(e.id));
    if (!pick.length) return toast("Označte zamestnancov.");
    const noMail = pick.filter((e) => !e.email);
    if (noMail.length) toast(`${noMail.length} bez e-mailu sa nepridá.`, true);
    const due = pick.map((e) => e.valid_until).filter(Boolean).sort()[0];
    newSession([{ id: c.id, name: c.name }], { customer_id: c.id, kind: pick.every((e) => e.last_training_on) ? "B" : "A", due_on: due && due >= today() ? due : "", employees: pick });
  };
}
function employeeDialog(c, e) {
  modal(`<h2>${e ? "Upraviť zamestnanca" : "Nový zamestnanec"}</h2>
    <div class="grid2"><label class="f"><span>Meno</span><input name="first_name" required value="${esc(e?.first_name || "")}"></label><label class="f"><span>Priezvisko</span><input name="last_name" required value="${esc(e?.last_name || "")}"></label></div>
    <label class="f"><span>E-mail</span><input name="email" type="email" value="${esc(e?.email || "")}"></label>
    <label class="f"><span>Pracovisko / profesia</span><input name="position" value="${esc(e?.position || "")}"></label>
    <div class="grid2"><label class="f"><span>Posledné oboznámenie</span><input name="last_training_on" type="date" value="${esc(e?.last_training_on || "")}"></label>
    <label class="f"><span>Platnosť do</span><input name="valid_until" type="date" value="${esc(e?.valid_until || "")}"></label></div>
    <p class="small mut">Ak zadáte iba dátum posledného oboznámenia, platnosť sa dopočíta (${T.validity_months} mesiacov).</p>
    ${e ? `<label class="switch"><input type="checkbox" name="off" ${e.active ? "" : "checked"}><span><b>Vyradiť</b><small>už u zákazníka nepracuje – nesleduje sa platnosť</small></span></label>` : ""}
    ${acts()}`,
  async (fd) => {
    const r = { first_name: fd.get("first_name").trim(), last_name: fd.get("last_name").trim(), email: fd.get("email").trim().toLowerCase() || null, position: fd.get("position").trim() || null, last_training_on: fd.get("last_training_on") || null, valid_until: fd.get("valid_until") || null };
    if (r.last_training_on && !r.valid_until) r.valid_until = addMonths(r.last_training_on, T.validity_months);
    if (e) { r.active = !fd.get("off"); await q(sb.from("lq_employees").update(r).eq("id", e.id)); }
    else await q(sb.from("lq_employees").insert({ ...r, tenant_id: T.id, customer_id: c.id }));
    route();
  });
}
function addMonths(s, n) {
  const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last)); return dt.toISOString().slice(0, 10);
}
function parseDate(s) {
  s = String(s || "").trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function csvDialog(c) {
  modal(`<h2>Vložiť zoznam zamestnancov</h2>
    <p class="small mut">Skopírujte riadky z Excelu alebo napíšte jeden zamestnanec na riadok: <b>meno; priezvisko; e-mail; pracovisko; dátum posledného oboznámenia</b>. Stĺpce oddeľte bodkočiarkou, čiarkou alebo tabulátorom. Pracovisko a dátum sú nepovinné.</p>
    <textarea name="t" rows="10" placeholder="Ján;Novák;jan.novak@firma.sk;sklad;15.3.2024"></textarea>${acts("Importovať")}`,
  async (fd) => {
    const existing = await q(sb.from("lq_employees").select("email").eq("customer_id", c.id));
    const have = new Set(existing.map((e) => (e.email || "").toLowerCase()).filter(Boolean));
    const rows = [], bad = [];
    for (const line of String(fd.get("t")).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const p = line.split(/\t|;|,/).map((x) => x.trim());
      if (/^meno$/i.test(p[0])) continue;
      if (p.length < 2 || !p[0] || !p[1]) { bad.push(line); continue; }
      const email = (p[2] || "").toLowerCase();
      if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || have.has(email))) { if (!have.has(email)) bad.push(line); continue; }
      const lt = parseDate(p[4]);
      rows.push({ tenant_id: T.id, customer_id: c.id, first_name: p[0], last_name: p[1], email: email || null, position: p[3] || null, last_training_on: lt, valid_until: lt ? addMonths(lt, T.validity_months) : null });
      if (email) have.add(email);
    }
    if (rows.length) await q(sb.from("lq_employees").insert(rows));
    toast(`Pridaných ${rows.length}${bad.length ? `, ${bad.length} riadkov sa nepodarilo načítať` : ""}.`, !!bad.length);
    route();
  });
}

/* ======================================================================
   CENOVÉ PONUKY
   ====================================================================== */
async function vOffers() {
  const os = await q(sb.from("lq_offers").select("*,lq_customers(name,email)").eq("tenant_id", T.id).order("created_at", { ascending: false }).limit(200));
  let f = "navrh";
  const ST = { navrh: ["návrh – čaká", "warn"], odoslana: ["odoslaná", "ok"], zamietnuta: ["zamietnutá", ""] };
  const draw = () => {
    const list = os.filter((o) => f === "all" || o.status === f);
    $("#list").innerHTML = list.length ? list.map((o) => `<a href="#" data-o="${o.id}"><span class="pill ${ST[o.status][1]}">${ST[o.status][0]}</span>
      <div class="grow"><b>${esc(o.lq_customers?.name)}</b><span class="small mut">${esc(o.number)} · ${o.count} ${plural(o.count, "osoba", "osoby", "osôb")} · platnosť najskôr do ${fmtDate(o.earliest_due)}</span></div><b>${eur(o.total)}</b></a>`).join("") : `<div class="empty">Žiadne ponuky.</div>`;
    $$("[data-o]").forEach((a) => a.onclick = (e) => { e.preventDefault(); offerDialog(os.find((x) => x.id === a.dataset.o)); });
  };
  main(`<div class="hdr"><h1>Cenové ponuky</h1>${isAdmin() ? `<button class="btn" id="run">Skontrolovať termíny teraz</button>` : ""}</div>
    <p class="mut small">Aplikácia každé ráno skontroluje platnosť oboznámení. ${T.notice_workdays} pracovných dní pred koncom pripraví pre zákazníka návrh ponuky. Ponuka odíde až po vašom schválení.</p>
    ${T.price_b == null ? `<div class="note warn">Nastavte <a href="#/nastavenia">cenu za účastníka</a> – inak budú návrhy bez ceny.</div>` : ""}
    <div class="tabs"><button data-f="navrh" class="on">Na schválenie</button><button data-f="odoslana">Odoslané</button><button data-f="zamietnuta">Zamietnuté</button><button data-f="all">Všetky</button></div>
    <div class="card pad0"><div class="list" id="list"></div></div>`);
  $$("[data-f]").forEach((b) => b.onclick = () => { f = b.dataset.f; $$("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  draw();
  $("#run")?.addEventListener("click", async (e) => { e.target.disabled = true; try { const r = await fn("a_daily", { tenant: T.id }); toast(r.created ? `Nové návrhy: ${r.created}.` : "Žiadne nové termíny."); route(); } catch (er) { toast(er.message, true); e.target.disabled = false; } });
  const o = new URLSearchParams(location.hash.split("?")[1] || "").get("o");
  if (o && os.find((x) => x.id === o)) offerDialog(os.find((x) => x.id === o));
}
function offerDialog(o) {
  const edit = o.status === "navrh" && isAdmin();
  const items = o.items || [];
  modal(`<h2>Ponuka ${esc(o.number)}</h2>
    <p class="mut small">${esc(o.lq_customers?.name)} · ${esc(o.lq_customers?.email || "bez e-mailu")} · vytvorená ${fmtDate(o.created_at)}${o.sent_at ? ` · odoslaná ${fmtDT(o.sent_at)}` : ""}</p>
    <div class="card pad0" style="box-shadow:none"><div class="list">${items.map((x, i) => `<label style="cursor:${edit ? "pointer" : "default"}">${edit ? `<input type="checkbox" name="it" value="${i}" checked>` : ""}<div class="grow">${esc(x.name)}</div><span class="small mut">do ${fmtDate(x.valid_until)}</span></label>`).join("")}</div></div>
    <div class="grid2"><label class="f"><span>Druh</span><select name="kind" ${edit ? "" : "disabled"}><option value="B">${KIND.B}</option><option value="A" ${o.kind === "A" ? "selected" : ""}>${KIND.A}</option></select></label>
    <label class="f"><span>Cena za účastníka${Number(o.vat_rate) ? " bez DPH" : ""} (€)</span><input name="unit_price" type="number" step="0.01" min="0" value="${o.unit_price ?? ""}" ${edit ? "" : "disabled"}></label></div>
    <div class="grid2"><label class="f"><span>Ponuka platí do</span><input name="valid_until" type="date" value="${esc(o.valid_until || "")}" ${edit ? "" : "disabled"}></label>
    <div class="f"><span class="small mut">Spolu</span><br><b style="font-size:1.3rem">${eur(o.total)}</b>${Number(o.vat_rate) ? `<br><span class="small mut">z toho DPH ${eur(o.total_vat)}</span>` : ""}</div></div>
    <label class="f"><span>Poznámka v ponuke</span><textarea name="note" ${edit ? "" : "disabled"}>${esc(o.note || "")}</textarea></label>
    <div class="acts">
      <button class="btn" type="button" id="pdf">${icon("doc")} Náhľad PDF</button>
      ${edit ? `<button class="btn bad" type="button" id="rej">Zamietnuť</button><button class="btn" type="submit" value="save">Uložiť</button><button class="btn pri" type="submit" value="send">${icon("mail")} Schváliť a odoslať</button>` : `<button class="btn pri" data-close>Zavrieť</button>`}
    </div>`,
  edit ? async (fd, form, btn) => {
    const keep = fd.getAll("it").map(Number);
    if (!keep.length) throw new Error("V ponuke musí zostať aspoň jeden zamestnanec.");
    await q(sb.from("lq_offers").update({ items: items.filter((_, i) => keep.includes(i)), kind: fd.get("kind"), unit_price: fd.get("unit_price") === "" ? null : Number(fd.get("unit_price")), valid_until: fd.get("valid_until") || null, note: fd.get("note") || null }).eq("id", o.id));
    if (btn?.value === "send") {
      if (!await ask(`Odoslať ponuku zákazníkovi ${o.lq_customers?.name} na ${o.lq_customers?.email || "–"}?`)) return false;
      await fn("a_offer", { offer: o.id, send: true });
      toast("Ponuka odoslaná.");
    } else toast("Uložené.");
    route();
  } : null);
  $("#pdf").onclick = async () => { const w = window.open("", "_blank"); try { const r = await fn("a_offer", { offer: o.id }); if (w) w.location = r.url; else location.href = r.url; } catch (e) { w?.close(); toast(e.message, true); } };
  $("#rej")?.addEventListener("click", async () => { if (!await ask("Zamietnuť návrh? Pre týchto zamestnancov sa nový návrh už nevytvorí, kým sa im nezmení platnosť.")) return; await q(sb.from("lq_offers").update({ status: "zamietnuta" }).eq("id", o.id)); dlg.close(); route(); });
}

/* ======================================================================
   OBSAH KURZU
   ====================================================================== */
async function vCourse() {
  const [tops, qs] = await Promise.all([
    q(sb.from("lq_topics").select("id,position,title,min_a,min_b,updated_at").eq("tenant_id", T.id).order("position")),
    q(sb.from("lq_questions").select("slot,active").eq("tenant_id", T.id)),
  ]);
  const sumA = tops.reduce((n, t) => n + t.min_a, 0), sumB = tops.reduce((n, t) => n + t.min_b, 0);
  main(`<div class="hdr"><h1>Obsah kurzu</h1></div>
    <p class="mut">Činnosť 01.1 – oboznamovanie zamestnancov a vedúcich zamestnancov v oblasti BOZP podľa projektu výchovy a vzdelávania. Obsah môžete upraviť (napr. vlastné príklady); rozsah musí zodpovedať schválenému projektu.</p>
    <div class="card pad0 tscroll"><table class="t"><thead><tr><th>#</th><th>Téma</th><th>A (min)</th><th>B (min)</th><th></th></tr></thead><tbody>
    ${tops.map((t) => `<tr><td>${t.position}</td><td><b>${esc(t.title)}</b></td><td>${t.min_a}</td><td>${t.min_b}</td><td><button class="btn sm" data-t="${t.id}">Upraviť</button></td></tr>`).join("")}
    <tr><td></td><td><b>Spolu</b></td><td><b>${sumA}</b></td><td><b>${sumB}</b></td><td></td></tr></tbody></table></div>
    <div class="card"><h2>Banka otázok</h2><p>${qs.filter((x) => x.active).length} aktívnych otázok v ${new Set(qs.map((x) => x.slot)).size} okruhoch. Každý školený dostane náhodný test – z každého okruhu jednu otázku (spolu 20), s premiešaným poradím odpovedí. Pri opakovanom pokuse dostane iné otázky.</p>
      <button class="btn" id="reset">Doplniť chýbajúce témy a otázky zo šablóny</button></div>`);
  $$("[data-t]").forEach((b) => b.onclick = async () => {
    const t = await q(sb.from("lq_topics").select("*").eq("id", b.dataset.t).single());
    modal(`<h2>Téma ${t.position}</h2>
      <label class="f"><span>Názov</span><input name="title" required value="${esc(t.title)}"></label>
      <div class="grid2"><label class="f"><span>Minúty pri vstupnom (A)</span><input name="min_a" type="number" min="0" max="600" value="${t.min_a}"></label>
      <label class="f"><span>Minúty pri opakovanom (B)</span><input name="min_b" type="number" min="0" max="600" value="${t.min_b}"></label></div>
      <label class="f"><span>Obsah (HTML – nadpisy h3, odseky p, zoznamy ul/li, tabuľky)</span><textarea name="html" rows="16" style="font-family:ui-monospace,monospace;font-size:.8rem">${esc(t.html || "")}</textarea></label>
      <p class="small mut">Žlté miesta &lt;mark&gt; s textom „doplniť…“ sa školenému nezobrazia. Skripty a vložené rámce sa odstránia.</p>${acts()}`,
    async (fd) => { await q(sb.from("lq_topics").update({ title: fd.get("title"), min_a: Number(fd.get("min_a")), min_b: Number(fd.get("min_b")), html: fd.get("html"), updated_at: new Date().toISOString() }).eq("id", t.id)); route(); });
  });
  $("#reset").onclick = async () => { await q(sb.rpc("lq_reset_course", { t: T.id })); toast("Hotovo."); route(); };
}

/* ======================================================================
   NASTAVENIA
   ====================================================================== */
async function vSettings() {
  const team = await q(sb.from("lq_staff").select("user_id,role,full_name,email,cert_no").eq("tenant_id", T.id).order("full_name"));
  const ro = isAdmin() ? "" : "disabled";
  const chk = (n, title, desc) => `<label class="switch"><input type="checkbox" name="${n}" ${T[n] ? "checked" : ""} ${ro}><span><b>${title}</b><small>${desc}</small></span></label>`;
  const inp = (n, label, type = "text", extra = "") => `<label class="f"><span>${label}</span><input name="${n}" type="${type}" value="${esc(T[n] ?? "")}" ${extra} ${ro}></label>`;
  main(`<div class="hdr"><h1>Nastavenia</h1></div>
    ${!isAdmin() ? `<div class="note">Nastavenia mení správca školiteľa.</div>` : ""}
    <form id="f">
    <div class="card"><h2>Podmienky školenia a testu</h2>
      ${chk("study_time_limit", "Časový limit štúdia", "Každú tému musí školený študovať aspoň plánovaný čas (A 4 h / B 3 h spolu). Vypnuté = môže postupovať ľubovoľne rýchlo.")}
      ${chk("test_time_limit", "Časový limit testu", "Po uplynutí času sa test odovzdá automaticky.")}
      ${inp("test_minutes", "Čas na test (minúty)", "number", 'min="5" max="180"')}
      ${chk("require_confirm", "Vyhodnotenie potvrdzujem ja", "Aplikácia test vyhodnotí, protokol sa vytvorí až po potvrdení osobou s osvedčením. Vypnuté = potvrdí sa automaticky.")}
      ${chk("otp_required", "Overenie e-mailu kódom", "Školený musí zadať jednorazový kód z e-mailu. Odporúčame nechať zapnuté.")}
      <div class="grid2">${inp("pass_percent", "Úspešnosť testu najmenej (%)", "number", 'min="75" max="100"')}${inp("max_attempts", "Počet pokusov", "number", 'min="1" max="10"')}</div>
      <div class="grid2">${inp("validity_months", "Platnosť oboznámenia (mesiace)", "number", 'min="6" max="60"')}${inp("notice_workdays", "Upozorniť vopred (pracovné dni)", "number", 'min="5" max="90"')}</div>
    </div>
    <div class="card"><h2>Ceny pre ponuky</h2>
      <div class="grid2">${inp("price_a", "Cena za účastníka – vstupné A (€)", "number", 'step="0.01" min="0"')}${inp("price_b", "Cena za účastníka – opakované B (€)", "number", 'step="0.01" min="0"')}</div>
      ${chk("vat_payer", "Som platiteľ DPH", "Ceny sú bez DPH, v ponuke sa pripočíta DPH.")}
      <div class="grid2">${inp("vat_rate", "Sadzba DPH (%)", "number", 'step="0.01" min="0" max="30"')}${inp("offer_valid_days", "Platnosť ponuky (dni)", "number", 'min="1" max="180"')}</div>
      <label class="f"><span>Text v ponuke</span><textarea name="offer_note" ${ro}>${esc(T.offer_note || "")}</textarea></label>
    </div>
    <div class="card"><h2>Firma školiteľa</h2><p class="small mut">Údaje sa zobrazujú školeným, v e-mailoch, protokoloch a ponukách – pod vašou hlavičkou.</p>
      ${inp("name", "Obchodné meno", "text", "required")}
      <div class="grid2">${inp("ico", "IČO")}${inp("dic", "DIČ")}</div><div class="grid2">${inp("ic_dph", "IČ DPH")}${inp("nip_number", "Číslo oprávnenia NIP (výchova a vzdelávanie)")}</div>
      ${inp("address", "Sídlo")}
      <div class="grid2">${inp("email", "E-mail (odpovede)", "email")}${inp("phone", "Telefón")}</div>
      <div class="grid2">${inp("web", "Web")}<label class="f"><span>Farba</span><input name="color" type="color" value="${esc(T.color)}" ${ro} style="padding:4px;height:42px"></label></div>
      <div class="grid2">${inp("rep_name", "Odborný zástupca (meno)")}${inp("rep_cert", "Číslo osvedčenia odborného zástupcu")}</div>
    </div>
    ${isAdmin() ? `<div class="sticky-bar" style="margin:0 0 14px;border-radius:12px;border:1px solid var(--line)"><span class="sp" style="flex:1"></span><button class="btn pri">Uložiť nastavenia</button></div>` : ""}
    </form>
    <div class="card pad0"><div class="row between" style="padding:14px 16px"><h2 style="margin:0">Tím</h2>${isAdmin() ? `<button class="btn sm pri" id="inv">${icon("plus")} Pozvať</button>` : ""}</div>
      <div class="list">${team.map((m) => `<div><div class="grow"><b>${esc(m.full_name || m.email)}</b><span class="small mut">${esc(m.email || "")}${m.cert_no ? ` · osvedčenie ${esc(m.cert_no)}` : ""}</span></div>
        <span class="pill ${m.role === "spravca" ? "acc" : ""}">${m.role === "spravca" ? "správca" : "školiteľ"}</span>
        ${isAdmin() && m.user_id !== me.id ? `<button class="btn sm" data-link="${m.user_id}" title="Nový odkaz na prihlásenie">${icon("mail")}</button><button class="btn sm bad" data-rm="${m.user_id}">✕</button>` : ""}</div>`).join("")}</div></div>
    <p class="small mut">Odkaz na prihlásenie posiela iba správca školiteľa alebo správca aplikácie. Samoregistrácia nie je možná.</p>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), r = {};
    for (const k of ["study_time_limit", "test_time_limit", "require_confirm", "otp_required", "vat_payer"]) r[k] = fd.get(k) === "on";
    for (const k of ["test_minutes", "pass_percent", "max_attempts", "validity_months", "notice_workdays", "offer_valid_days"]) r[k] = Number(fd.get(k));
    for (const k of ["price_a", "price_b", "vat_rate"]) r[k] = fd.get(k) === "" ? (k === "vat_rate" ? 23 : null) : Number(fd.get(k));
    for (const k of ["name", "ico", "dic", "ic_dph", "nip_number", "address", "email", "phone", "web", "rep_name", "rep_cert", "offer_note"]) r[k] = String(fd.get(k) || "").trim() || null;
    r.color = fd.get("color");
    if (!r.name) return toast("Zadajte obchodné meno.", true);
    if (!r.otp_required && !await ask("Bez overovacieho kódu sa totožnosť školeného overí iba zadanými údajmi. Naozaj vypnúť?")) return;
    try { await q(sb.from("lq_tenants").update(r).eq("id", T.id)); await pickTenant(T.id); toast("Uložené."); route(); } catch (er) { toast(er.message, true); }
  };
  $("#inv")?.addEventListener("click", () => inviteDialog(T.id));
  $$("[data-link]").forEach((b) => b.onclick = async () => {
    const m = team.find((x) => x.user_id === b.dataset.link);
    try { const r = await fn("a_invite_staff", { tenant: T.id, email: m.email, name: m.full_name || m.email, role: m.role }); showInvite(r, m.email); } catch (e) { toast(e.message, true); }
  });
  $$("[data-rm]").forEach((b) => b.onclick = async () => { if (!await ask("Odobrať člena tímu? Stratí prístup k tomuto školiteľovi.")) return; await q(sb.from("lq_staff").delete().eq("tenant_id", T.id).eq("user_id", b.dataset.rm)); route(); });
}
function inviteDialog(tenantId, after) {
  modal(`<h2>Pozvať do tímu</h2>
    <label class="f"><span>Meno a priezvisko</span><input name="name" required></label>
    <label class="f"><span>E-mail (prihlasovacie meno)</span><input name="email" type="email" required></label>
    <div class="grid2"><label class="f"><span>Rola</span><select name="role"><option value="skolitel">školiteľ</option><option value="spravca">správca</option></select></label>
    <label class="f"><span>Číslo osvedčenia (nepovinné)</span><input name="cert"></label></div>
    <p class="small mut">Správca mení nastavenia, ceny a tím a schvaľuje ponuky. Školiteľ vedie školenia a potvrdzuje výsledky.</p>${acts("Vytvoriť pozvánku")}`,
  async (fd) => { const r = await fn("a_invite_staff", { tenant: tenantId, ...Object.fromEntries(fd) }); setTimeout(() => showInvite(r, fd.get("email")), 50); after?.(); });
}
function showInvite(r, email) {
  modal(`<h2>Pozvánka je pripravená</h2>
    <p>${r.emailed ? `Odkaz sme poslali na <b>${esc(email)}</b>.` : `E-mail sa neodoslal – pošlite odkaz <b>${esc(email)}</b> sami (napr. SMS).`} Odkaz je jednorazový a platí obmedzený čas.</p>
    ${copyBox(r.link)}<div class="acts"><button class="btn pri" data-close>Hotovo</button></div>`);
}

/* ---------------- upozornenia (web push) ---------------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function b64ToU8(s) { const p = "=".repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
const b64urlOf = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function deviceName() {
  const u = navigator.userAgent;
  const os = /android/i.test(u) ? "Android" : isIOS ? "iPhone/iPad" : /windows/i.test(u) ? "Windows" : /mac/i.test(u) ? "Mac" : "zariadenie";
  const br = /edg\//i.test(u) ? "Edge" : /firefox/i.test(u) ? "Firefox" : /chrome/i.test(u) ? "Chrome" : /safari/i.test(u) ? "Safari" : "prehliadač";
  return `${br} · ${os}`;
}
async function pushKey() {
  const k = store.get("lq_vapid") || (await fn("a_push_key")).publicKey;
  if (k) store.set("lq_vapid", k);
  return k;
}
async function pushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}
/** Zapíše odber zariadenia na server; ak patrí inému účtu na tom istom zariadení, vytvorí nový. */
async function saveSub(reg, key, sub) {
  const put = async (x) => { const j = x.toJSON(); return (await sb.from("lq_push_subs").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() }, { onConflict: "endpoint" })).error; };
  if (!(await put(sub))) return;
  await sub.unsubscribe().catch(() => {});
  const err = await put(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }));
  if (err) throw new Error(dbErr(err));
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Upozornenia ste v prehliadači nepovolili.");
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const key = await pushKey();
  if (!key) throw new Error("Server upozornení neodpovedá. Skúste to neskôr.");
  let sub = await reg.pushManager.getSubscription();
  const cur = sub?.options?.applicationServerKey;
  if (sub && cur && b64urlOf(new Uint8Array(cur)) !== key) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  await saveSub(reg, key, sub);
  store.set("lq_push_off", "0");
}
async function disablePush() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) { await sb.from("lq_push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  store.set("lq_push_off", "1");
}
/* Pri každom otvorení: odber, ktorý server nepozná (odhlásenie, iný účet, obnovený odber), sa potichu zapíše znova. */
let pushSynced = false;
async function syncPush() {
  if (pushSynced || !me || !pushSupported() || Notification.permission !== "granted" || store.get("lq_push_off") === "1") return;
  pushSynced = true;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const key = await pushKey();
    let sub = await reg.pushManager.getSubscription();
    const cur = sub?.options?.applicationServerKey;
    if (sub && cur && b64urlOf(new Uint8Array(cur)) !== key) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await saveSub(reg, key, sub);
  } catch (e) { pushSynced = false; console.warn("push sync", e); }
}
/* Otvorenie aplikácie = upozornenia prečítané → číslo na ikone zmizne */
async function markSeen() {
  if (!me) return;
  await sb.rpc("lq_mark_seen").then(() => {}, () => {});
  navigator.clearAppBadge?.().catch(() => {});
  (await navigator.serviceWorker?.getRegistration())?.getNotifications?.().then((l) => l.forEach((n) => n.close())).catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markSeen(); });

const PUSH_INFO = `<ul class="small" style="margin:8px 0;padding-left:18px;line-height:1.7">
  <li><b>Test čaká na potvrdenie</b> – hneď, keď zamestnanec odovzdá test (ostane na obrazovke, kým ho neotvoríte)</li>
  <li><b>Výsledok bez potvrdzovania</b> – vyhovel / nevyhovel a odoslanie protokolu</li>
  <li><b>Nové cenové ponuky</b> na schválenie pred koncom platnosti (správcom)</li></ul>
  <p class="small mut">Upozornenia sa zobrazia aj na zamknutej obrazovke pri zhasnutom displeji a na ikone aplikácie uvidíte počet nových.${isIOS ? " Na iPhone ešte skontrolujte Nastavenia → Upozornenia → LearnIQ: Povoliť upozornenia, Zamknutá obrazovka, Bannery a Odznaky." : " V Androide nechajte pre LearnIQ zapnuté upozornenia na zamknutej obrazovke a bodku / číslo na ikone."}</p>`;
async function renderPushCard(box) {
  if (!box) return;
  const st = await pushState();
  pushOn = st === "on";
  $("#bell")?.classList.toggle("warn", !pushOn);
  const set = (h) => { box.innerHTML = `<h2>${icon("bell")} Upozornenia</h2>${h}`; };
  if (st === "unsupported") {
    return set(isIOS && !standalone()
      ? `<p><b>Na iPhone najprv pridajte aplikáciu na plochu.</b></p><p class="small mut">V Safari ťuknite na <b>Zdieľať</b> → <b>Pridať na plochu</b>, otvorte LearnIQ z plochy a tu zapnite upozornenia (v Safari ich Apple nepovoľuje).</p>${installBtn()}`
      : `<p class="small mut">Tento prehliadač upozornenia nepodporuje. Použite Chrome, Edge, Firefox alebo nainštalovanú aplikáciu.</p>`);
  }
  if (st === "denied") return set(`<p><b>Upozornenia sú pre LearnIQ zablokované.</b></p><p class="small mut">${isIOS ? "Nastavenia → Upozornenia → LearnIQ → Povoliť upozornenia." : "Ťuknite na ikonu zámku vedľa adresy (alebo v nastaveniach aplikácie) → Upozornenia → Povoliť. Potom stránku obnovte."}</p>`);
  if (st === "off") {
    set(`<p><b>Na tomto zariadení sú vypnuté.</b></p>${PUSH_INFO}<button class="btn pri" id="pOn" type="button">Zapnúť upozornenia</button>`);
    box.querySelector("#pOn").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Zapínam…";
      try { await enablePush(); toast("Upozornenia sú zapnuté."); } catch (er) { toast(er.message, true); }
      renderPushCard(box);
    };
    return;
  }
  try { // zariadenie má odber – overiť, že ho pozná aj server
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    const { data: known } = await sb.from("lq_push_subs").select("id").eq("endpoint", sub?.endpoint || "").maybeSingle();
    if (!known) await enablePush();
  } catch (er) {
    set(`<p class="note bad">Upozornenia sa nepodarilo zapísať na server: ${esc(er.message)}</p><button class="btn" id="pRetry" type="button">Skúsiť znova</button>`);
    box.querySelector("#pRetry").onclick = () => renderPushCard(box);
    return;
  }
  set(`<p><span class="pill ok">zapnuté</span> na tomto zariadení</p>${PUSH_INFO}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="pTest" type="button">Poslať skúšobné upozornenie</button><button class="btn bad" id="pOff" type="button">Vypnúť</button></div>`);
  box.querySelector("#pTest").onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await fn("a_push_test"); toast(r.sent ? "Odoslané – o chvíľu príde (skúste aj zhasnúť displej)." : "Nepodarilo sa doručiť – vypnite a znova zapnite upozornenia.", !r.sent); }
    catch (er) { toast(er.message, true); }
    e.target.disabled = false;
  };
  box.querySelector("#pOff").onclick = async () => { await disablePush().catch(() => {}); toast("Upozornenia sú na tomto zariadení vypnuté."); renderPushCard(box); };
}

/* ---------------- môj profil ---------------- */
async function vProfile() {
  const mine = staff.find((s) => s.tenant_id === T?.id);
  main(`<div class="hdr"><h1>Môj profil</h1></div>
    <div class="card"><p class="mut">${esc(me.email)}</p>
    ${mine ? `<form id="f"><label class="f"><span>Meno a priezvisko (uvádza sa v protokoloch)</span><input name="full_name" required value="${esc(mine.full_name || "")}"></label>
      <label class="f"><span>Číslo osvedčenia (bezpečnostný technik / autorizovaný BT)</span><input name="cert_no" value="${esc(mine.cert_no || "")}"></label>
      <button class="btn pri">Uložiť</button></form>` : ""}
    <p style="margin-top:16px"><a class="btn" href="#/heslo">Zmeniť heslo</a></p></div>
    <div class="card" id="pushbox"><h2>${icon("bell")} Upozornenia</h2><div class="spin"></div></div>
    ${mine ? `<div class="card"><h2>Môj podpis</h2>
      <p class="small mut">Váš podpis sa vloží do protokolu pri každom potvrdení výsledku testu („Test vyhodnotil a výsledok potvrdil“).</p>
      <div id="cur" class="small mut" style="margin-bottom:10px">${mine.signature_path ? "Načítavam…" : "Zatiaľ nemáte uložený podpis."}</div>
      <canvas class="sig" id="sig"></canvas>
      <div class="row" style="margin-top:10px"><button class="btn" id="clr" type="button">Vymazať pole</button>${mine.signature_path ? `<button class="btn bad" id="rm" type="button">Odstrániť podpis</button>` : ""}<span style="flex:1"></span><button class="btn pri" id="save" type="button">Uložiť podpis</button></div>
    </div>` : ""}`);
  renderPushCard($("#pushbox"));
  if (mine) {
    const pad = sigPad($("#sig"));
    $("#clr").onclick = () => pad.clear();
    if (mine.signature_path) {
      const { data } = await sb.storage.from("learniq").createSignedUrl(mine.signature_path, 300);
      $("#cur").innerHTML = data?.signedUrl ? `Uložený podpis:<img class="sig-img" src="${esc(data.signedUrl)}&t=${Date.now()}" alt="Podpis">` : "Podpis je uložený.";
    }
    $("#save").onclick = async (e) => {
      const png = !pad.empty() && pad.png();
      if (!png) return toast("Najprv sa podpíšte do poľa.", true);
      e.target.disabled = true;
      try { const r = await fn("a_signature", { tenant: T.id, png }); mine.signature_path = r.path; toast("Podpis je uložený."); vProfile(); }
      catch (er) { toast(er.message, true); e.target.disabled = false; }
    };
    $("#rm")?.addEventListener("click", async () => {
      if (!await ask("Odstrániť uložený podpis?")) return;
      try { await fn("a_signature", { tenant: T.id, remove: true }); mine.signature_path = null; toast("Podpis je odstránený."); vProfile(); } catch (er) { toast(er.message, true); }
    });
  }
  $("#f")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try { await q(sb.from("lq_staff").update({ full_name: fd.get("full_name").trim(), cert_no: fd.get("cert_no").trim() || null }).eq("tenant_id", T.id).eq("user_id", me.id)); mine.full_name = fd.get("full_name").trim(); mine.cert_no = fd.get("cert_no").trim() || null; toast("Uložené."); route(); }
    catch (er) { toast(er.message, true); }
  });
}

/* ---------------- správa platformy ---------------- */
async function vPlatform() {
  if (!platform) { location.hash = "#/"; return; }
  const ts = await q(sb.from("lq_tenants").select("id,name,email,active,created_at,lq_staff(full_name,email,role)").order("created_at"));
  main(`<div class="hdr"><h1>Platforma LearnIQ</h1><button class="btn pri" id="new">${icon("plus")} Nový školiteľ</button></div>
    <p class="mut">Školitelia používajú LearnIQ pod vlastnou firmou a s vlastným tímom. Ich údaje sú navzájom oddelené. Prístup vzniká iba pozvánkou od vás alebo od ich správcu.</p>
    <div class="card pad0"><div class="list">${ts.map((t) => `<div><span class="dot ${t.active ? "ok" : "bad"}"></span><div class="grow"><b>${esc(t.name)}</b>
      <span class="small mut">${(t.lq_staff || []).filter((s) => s.role === "spravca").map((s) => esc(s.full_name || s.email)).join(", ") || "bez správcu"} · od ${fmtDate(t.created_at)}</span></div>
      <button class="btn sm" data-inv="${t.id}">Pozvať</button><button class="btn sm" data-open="${t.id}">Otvoriť</button><button class="btn sm ${t.active ? "bad" : ""}" data-act="${t.id}" data-v="${t.active ? 0 : 1}">${t.active ? "Pozastaviť" : "Aktivovať"}</button></div>`).join("")}</div></div>`);
  $("#new").onclick = () => modal(`<h2>Nový školiteľ</h2>
    <label class="f"><span>Obchodné meno firmy</span><input name="name" required></label>
    <h3>Správca školiteľa</h3><label class="f"><span>Meno a priezvisko</span><input name="admin_name" required></label>
    <label class="f"><span>E-mail (prihlasovacie meno)</span><input name="admin_email" type="email" required></label>
    <p class="small mut">Vytvorí sa firma s kópiou obsahu kurzu a banky otázok a správcovi sa pripraví odkaz na nastavenie hesla.</p>${acts("Založiť")}`,
  async (fd) => { const r = await fn("a_create_tenant", Object.fromEntries(fd)); if (r.invite) setTimeout(() => showInvite(r.invite, fd.get("admin_email")), 50); vPlatform(); });
  $$("[data-inv]").forEach((b) => b.onclick = () => inviteDialog(b.dataset.inv, () => {}));
  $$("[data-open]").forEach((b) => b.onclick = async () => { await pickTenant(b.dataset.open); location.hash = "#/"; route(); });
  $$("[data-act]").forEach((b) => b.onclick = async () => { await q(sb.from("lq_tenants").update({ active: b.dataset.v === "1" }).eq("id", b.dataset.act)); vPlatform(); });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
