// LearnIQ – stránka školeného: overenie totožnosti → štúdium tém → náhodný test → výsledok
import { FN_URL, SUPABASE_KEY, APP_VERSION } from "./config.js";
import { esc, $, $$, toast, fmtDate, safeHtml, plural } from "./util.js";

const app = $("#app");
const params = new URLSearchParams(location.hash.slice(1));
const link = params.get("i") ? { inv: params.get("i") } : params.get("s") ? { ses: params.get("s") } : null;
const TKEY = link ? `lq_pt:${link.inv || link.ses}` : "";
let token = "";
try { token = localStorage.getItem(TKEY) || ""; } catch { /* súkromné okno */ }
let state = null;
let beatTimer = null, clockTimer = null, testTimer = null;

async function call(a, body = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, ...(token ? { "x-lq-token": token } : {}) },
    body: JSON.stringify({ a, ...link, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Spojenie zlyhalo. Skúste to znova."); e.status = res.status; throw e; }
  return data;
}
function saveToken(t) { token = t; try { localStorage.setItem(TKEY, t); } catch { /* */ } }
function stopTimers() { clearInterval(beatTimer); clearInterval(clockTimer); clearInterval(testTimer); beatTimer = clockTimer = testTimer = null; }

function applyBrand(t) {
  if (!t) return;
  document.documentElement.style.setProperty("--accent", t.color || "#8b5cf6");
  document.title = `Školenie BOZP – ${t.name}`;
}
const head = (t) => `<div class="tenant-head"><img src="img/icon-192.png" alt="" width="34" height="34" style="border-radius:8px">
  <div><b>${esc(t?.name || "LearnIQ")}</b><div class="small mut">E-learning BOZP${t?.nip_number ? ` · oprávnenie NIP č. ${esc(t.nip_number)}` : ""}</div></div></div>`;
const foot = (t) => `<p class="small mut" style="text-align:center;margin-top:30px">${t?.email ? `Otázky: <a href="mailto:${esc(t.email)}">${esc(t.email)}</a>${t.phone ? ` · ${esc(t.phone)}` : ""}<br>` : ""}LearnIQ ${APP_VERSION}</p>`;
function page(t, inner) { stopTimers(); app.innerHTML = `${head(t)}<div class="wrap">${inner}${foot(t)}</div>`; window.scrollTo(0, 0); }
function fail(msg) { page(state?.tenant, `<div class="card result"><h2>Školenie nie je dostupné</h2><p>${esc(msg)}</p></div>`); }

/* ---------------- 1. overenie totožnosti ---------------- */
async function identityScreen() {
  let info;
  try { info = await call("p_open"); } catch (e) { return fail(e.message); }
  applyBrand(info.tenant);
  const p = info.prefill || {};
  const kind = info.session.kind === "A" ? "vstupné oboznámenie (4 hodiny)" : "opakované oboznámenie (3 hodiny)";
  page(info.tenant, `
    <h1>Oboznámenie v oblasti BOZP</h1>
    <p class="mut">${esc(kind)} · zamestnávateľ ${esc(info.session.customer || "")}${info.session.due_on ? ` · absolvujte do ${fmtDate(info.session.due_on)}` : ""}</p>
    <div class="card">
      <h2>Overenie totožnosti</h2>
      <p class="small mut">Zadajte svoje údaje. ${info.otp ? "Na e-mail vám pošleme jednorazový kód." : ""} Údaje sa uvedú v protokole o oboznámení.</p>
      <form id="f">
        <label class="f"><span>E-mail</span><input name="email" type="email" required autocomplete="email" value="${esc(p.email || "")}" ${link.inv && p.email ? "readonly" : ""}></label>
        <div class="grid2">
          <label class="f"><span>Meno</span><input name="first_name" required autocomplete="given-name" value="${esc(p.first_name || "")}"></label>
          <label class="f"><span>Priezvisko</span><input name="last_name" required autocomplete="family-name" value="${esc(p.last_name || "")}"></label>
        </div>
        <label class="f"><span>Firma, v ktorej pracujete</span><input name="company" required autocomplete="organization" value="${esc(p.company || "")}"></label>
        <label class="switch" style="border:0"><input type="checkbox" name="ok" required>
          <span><b>Potvrdzujem</b><small>že údaje sú pravdivé, školenie absolvujem osobne a test vyplním samostatne bez pomoci iných osôb.</small></span></label>
        <button class="btn pri big" type="submit">${info.otp ? "Poslať overovací kód" : "Pokračovať"}</button>
      </form>
    </div>
    <p class="small mut">Osobné údaje spracúva ${esc(info.tenant.name)} na účel vedenia záznamov o oboznámení podľa zákona č. 124/2006 Z. z. o BOZP.</p>`);
  $("#f").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const btn = ev.target.querySelector("button"); btn.disabled = true;
    try {
      const r = await call("p_code", fd);
      if (r.token) { saveToken(r.token); return overview(); }
      codeScreen(info, fd);
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

function codeScreen(info, fd) {
  page(info.tenant, `
    <div class="card">
      <h2>Zadajte kód z e-mailu</h2>
      <p class="mut">Kód sme poslali na <b>${esc(fd.email)}</b>. Platí 15 minút. Ak e-mail nevidíte, pozrite priečinok nevyžiadanej pošty.</p>
      <form id="f">
        <input class="code-in" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus>
        <p></p><button class="btn pri big" type="submit">Overiť</button>
      </form>
      <p style="margin-top:14px"><button class="btn sm" id="again">Poslať nový kód</button> <button class="btn sm" id="change">Zmeniť údaje</button></p>
    </div>`);
  $("#f").onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button"); btn.disabled = true;
    try { const r = await call("p_verify", { ...fd, code: ev.target.code.value }); saveToken(r.token); overview(); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  $("#again").onclick = async () => { try { await call("p_code", fd); toast("Nový kód je na ceste."); } catch (e) { toast(e.message, true); } };
  $("#change").onclick = identityScreen;
}

/* ---------------- 2. prehľad ---------------- */
async function overview() {
  try { state = await call("p_state"); }
  catch (e) { if (e.status === 401) { saveToken(""); return identityScreen(); } return fail(e.message); }
  applyBrand(state.tenant);
  if (state.open_attempt) return testScreen();
  const s = state, r = s.rules;
  const done = s.topics.filter((t) => t.done).length, total = s.topics.length;
  const next = s.topics.find((t) => !t.done);
  const last = s.attempts.at(-1);
  let top = "";
  if (last && last.submitted && !last.confirmed) {
    top = `<div class="card result"><div class="pill acc">Test odovzdaný</div><div class="big">${Math.round(last.percent)} %</div>
      <p>${last.correct} z ${last.total} správne. Vyhodnotenie aplikácie: <b>${last.passed ? "vyhovel" : "nevyhovel"}</b>.</p>
      <p class="mut">Výsledok teraz overí a potvrdí odborne spôsobilá osoba. Protokol vám príde e-mailom.</p></div>`;
  } else if (last && last.confirmed) {
    top = last.passed
      ? `<div class="card result"><div class="pill ok">VYHOVEL</div><div class="big">${Math.round(last.percent)} %</div><p>Gratulujeme, oboznámenie ste úspešne absolvovali.</p><p class="mut">${s.protocol_sent ? "Protokol vo formáte PDF sme vám poslali e-mailom." : "Protokol vám pošle školiteľ."}</p></div>`
      : `<div class="card result"><div class="pill bad">NEVYHOVEL</div><div class="big">${Math.round(last.percent)} %</div><p>Potrebných je najmenej ${r.pass_percent} %.</p>
         <p class="mut">${s.can_test ? "Môžete sa pokúsiť znova – dostanete nový test." : "Ozve sa vám školiteľ s náhradným termínom."}</p></div>`;
  }
  page(s.tenant, `
    <h1>Dobrý deň, ${esc(s.me.first_name)}</h1>
    <p class="mut">${s.session.kind === "A" ? "Vstupné" : "Opakované"} oboznámenie BOZP · ${esc(s.session.customer || "")}${s.session.due_on ? ` · do ${fmtDate(s.session.due_on)}` : ""}</p>
    ${top}
    <div class="card">
      <div class="row between"><b>Priebeh štúdia</b><span class="mut small">${done} / ${total} ${plural(total, "téma", "témy", "tém")}</span></div>
      <div class="progress" style="margin:10px 0 4px"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
      ${r.study_time_limit ? `<p class="small mut" style="margin:6px 0 0">Každú tému treba študovať aspoň určený čas. Počíta sa iba čas, keď máte stránku otvorenú.</p>` : ""}
    </div>
    <div class="card pad0">
      ${s.topics.map((t, i) => {
        const lock = !t.done && next && t.id !== next.id;
        return `<a class="topic ${t.done ? "done" : t.id === next?.id ? "cur" : ""} ${lock ? "lock" : ""}" href="#" data-t="${t.id}">
          <span class="n">${t.done ? "✓" : i + 1}</span>
          <span style="flex:1;min-width:0"><b>${esc(t.title)}</b><br><span class="small mut">${t.minutes} min${t.seconds ? ` · študované ${Math.floor(t.seconds / 60)} min` : ""}</span></span>
        </a>`;
      }).join("")}
    </div>
    ${s.can_test ? `<div class="card"><h2>Záverečný test</h2>
        <p>20 otázok, ku každej 3 možnosti, správna je vždy jedna. Na úspech treba najmenej ${r.pass_percent} % správnych odpovedí.
        ${r.test_time_limit ? `Na test máte <b>${r.test_minutes} minút</b> – po uplynutí sa odovzdá automaticky.` : "Test nemá časový limit."}
        Test je pre vás vygenerovaný náhodne.</p>
        <button class="btn pri big" id="go">Začať test</button></div>`
      : next ? `<button class="btn pri big" id="cont">${done ? "Pokračovať v štúdiu" : "Začať štúdium"}</button>` : ""}
  `);
  $$("[data-t]").forEach((a) => a.onclick = (e) => { e.preventDefault(); topicScreen(a.dataset.t); });
  $("#cont")?.addEventListener("click", () => topicScreen(next.id));
  $("#go")?.addEventListener("click", async (e) => {
    if (r.test_time_limit && !confirm(`Po spustení beží čas ${r.test_minutes} minút. Začať test?`)) return;
    e.target.disabled = true;
    try { await call("p_test"); testScreen(); } catch (er) { toast(er.message, true); e.target.disabled = false; }
  });
}

/* ---------------- 3. štúdium témy ---------------- */
async function topicScreen(id) {
  let t;
  try { t = await call("p_topic", { topic: id }); } catch (e) { toast(e.message, true); return overview(); }
  const limit = state.rules.study_time_limit;
  const need = t.minutes * 60;
  let seconds = t.seconds, lastAct = Date.now(), lastBeat = Date.now();
  page(state.tenant, `
    <a class="back" href="#" id="back">← Prehľad tém</a>
    <div class="small mut">Téma ${t.position}</div>
    <h1>${esc(t.title)}</h1>
    <article class="card study">${safeHtml(t.html)}</article>
    <div class="sticky-bar">
      <div style="flex:1;min-width:0">${limit && !t.done ? `<div class="small mut">Čas štúdia</div><div class="timer" id="clk"></div>` : `<div class="small mut">${t.done ? "Téma je dokončená" : "Plánovaný čas " + t.minutes + " min"}</div>`}</div>
      <button class="btn pri" id="done">${t.last ? "Dokončiť štúdium" : "Ďalšia téma →"}</button>
    </div>`);
  const btn = $("#done"), clk = $("#clk");
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const render = () => {
    if (!clk) return;
    const left = Math.max(0, need - seconds);
    clk.textContent = left > 0 ? `${mmss(seconds)} / ${mmss(need)} · zostáva ${Math.ceil(left / 60)} min` : `${mmss(seconds)} – splnené`;
    btn.disabled = left > 10;
  };
  render();
  ["pointermove", "keydown", "scroll", "touchstart", "click"].forEach((ev) => window.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
  const active = () => document.visibilityState === "visible" && Date.now() - lastAct < 5 * 60_000;
  if (!t.done) {
    // lokálny čas pre zobrazenie; skutočný čas počíta server zo signálov každých 30 s
    clockTimer = setInterval(() => { if (active()) { seconds += 1; render(); } }, 1000);
    beatTimer = setInterval(async () => {
      if (!active()) return;
      try { const r = await call("p_beat", { topic: id }); seconds = Math.max(r.seconds, Math.min(seconds, r.seconds + 40)); lastBeat = Date.now(); render(); } catch { /* skúsi znova */ }
    }, 30_000);
    call("p_beat", { topic: id }).catch(() => {});
  }
  $("#back").onclick = (e) => { e.preventDefault(); overview(); };
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (!t.done && Date.now() - lastBeat > 14_000) await call("p_beat", { topic: id }).catch(() => {});
      const r = await call("p_done", { topic: id });
      if (r.all || !t.next) return overview();
      topicScreen(t.next);
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

/* ---------------- 4. test ---------------- */
async function testScreen() {
  let T;
  try { T = await call("p_test"); } catch (e) { toast(e.message, true); return overview(); }
  const answers = T.answers.slice();
  page(state.tenant, `
    <h1>Záverečný test</h1>
    <div class="card">
      <div class="row between"><span class="mut small" id="cnt"></span>${T.deadline_at ? `<span class="timer" id="tmr"></span>` : ""}</div>
      <div class="progress" style="margin-top:8px"><i id="bar"></i></div>
    </div>
    <div class="card">${T.questions.map((q, i) => `
      <div class="q"><b>${i + 1}. ${esc(q.text)}</b>
        ${q.options.map((o, k) => `<label class="opt"><input type="radio" name="q${i}" value="${k}" ${answers[i] === k ? "checked" : ""}><span>${"abc"[k]}) ${esc(o)}</span></label>`).join("")}
      </div>`).join("")}
    </div>
    <div class="sticky-bar"><span class="small mut" style="flex:1">Odpovede sa ukladajú priebežne.</span><button class="btn pri" id="sub">Odovzdať test</button></div>`);
  const upd = () => {
    const n = answers.filter((a) => a !== null).length;
    $("#cnt").textContent = `Zodpovedané ${n} z ${answers.length}`;
    $("#bar").style.width = `${(n / answers.length) * 100}%`;
  };
  upd();
  $$(".q input").forEach((inp) => inp.onchange = async () => {
    const i = Number(inp.name.slice(1)), c = Number(inp.value);
    answers[i] = c; upd();
    try { await call("p_answer", { attempt: T.attempt, i, choice: c }); } catch (e) { toast(e.message, true); if (e.status === 409) submit(true); }
  });
  let sending = false;
  async function submit(force = false) {
    if (sending) return;
    const miss = answers.filter((a) => a === null).length;
    if (!force && !confirm(miss ? `Nezodpovedali ste ${miss} ${plural(miss, "otázku", "otázky", "otázok")}. Naozaj odovzdať?` : "Odovzdať test? Odpovede už nebude možné zmeniť.")) return;
    sending = true; $("#sub").disabled = true;
    try { await call("p_submit", { attempt: T.attempt }); overview(); }
    catch (e) { toast(e.message, true); sending = false; $("#sub").disabled = false; }
  }
  $("#sub").onclick = () => submit(false);
  if (T.deadline_at) {
    const end = new Date(T.deadline_at).getTime(), tmr = $("#tmr");
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      tmr.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      tmr.style.color = left < 120 ? "var(--bad)" : "";
      if (left <= 0) { clearInterval(testTimer); toast("Čas na test uplynul – test sa odovzdáva."); submit(true); }
    };
    tick(); testTimer = setInterval(tick, 1000);
  }
}

/* ---------------- štart ---------------- */
if (!link) fail("Odkaz na školenie je neúplný. Otvorte ho znova z e-mailu alebo požiadajte školiteľa o nový.");
else if (token) overview();
else identityScreen();
