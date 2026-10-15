// LearnIQ – PDF dokumenty: protokol školeného (záznam o oboznámení, test s vyhodnotením, výpis z platformy)
// a cenová ponuka. Písmo DejaVu Sans (slovenská diakritika), pdf-lib + fontkit.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const FONT_URLS = [
  ["https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf", "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf"],
  ["https://cdn.jsdelivr.net/gh/dejavu-fonts/dejavu-fonts@version_2_37/ttf/DejaVuSans.ttf", "https://cdn.jsdelivr.net/gh/dejavu-fonts/dejavu-fonts@version_2_37/ttf/DejaVuSans-Bold.ttf"],
];
let fontCache: [Uint8Array, Uint8Array] | null = null;
async function fonts(): Promise<[Uint8Array, Uint8Array]> {
  if (fontCache) return fontCache;
  for (const [r, b] of FONT_URLS) {
    try {
      const [x, y] = await Promise.all([fetch(r), fetch(b)]);
      if (x.ok && y.ok) {
        fontCache = [new Uint8Array(await x.arrayBuffer()), new Uint8Array(await y.arrayBuffer())];
        return fontCache;
      }
    } catch { /* ďalší zdroj */ }
  }
  throw new Error("Nepodarilo sa načítať písmo pre PDF");
}

export type Tenant = {
  id: string; name: string; ico?: string | null; dic?: string | null; ic_dph?: string | null; address?: string | null;
  email?: string | null; phone?: string | null; web?: string | null; nip_number?: string | null;
  rep_name?: string | null; rep_cert?: string | null; color: string;
  vat_payer?: boolean; pass_percent: number;
};

const A4: [number, number] = [595.28, 841.89];
const M = 48; // okraj
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = rgb(0.11, 0.11, 0.14), MUT = rgb(0.42, 0.42, 0.48), LINE = rgb(0.84, 0.84, 0.88), OK = rgb(0.13, 0.55, 0.3), BAD = rgb(0.78, 0.2, 0.17);

export function fmtDate(s?: string | null) {
  if (!s) return "–";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("sk-SK", { timeZone: "Europe/Bratislava", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
export const eur = (n?: number | null) => (n == null ? "–" : `${Number(n).toFixed(2).replace(".", ",")} €`);

/** Jednoduchý sádzač: odseky so zalamovaním, tabuľky, nové strany, päta. */
class Doc {
  pdf!: PDFDocument; f!: PDFFont; b!: PDFFont; page!: PDFPage; y = 0; accent = INK; tenant!: Tenant; footer = "";
  static async create(tenant: Tenant, footer: string) {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.pdf.registerFontkit(fontkit);
    const [r, b] = await fonts();
    d.f = await d.pdf.embedFont(r, { subset: true });
    d.b = await d.pdf.embedFont(b, { subset: true });
    d.tenant = tenant; d.footer = footer;
    try { d.accent = hex(tenant.color); } catch { /* */ }
    d.pdf.setTitle(footer); d.pdf.setCreator("LearnIQ"); d.pdf.setProducer("LearnIQ (Keylo)");
    return d;
  }
  newPage() {
    this.page = this.pdf.addPage(A4);
    this.y = A4[1] - M;
    // hlavička školiteľa
    const t = this.tenant;
    this.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: this.accent });
    this.text(t.name, { size: 11, bold: true });
    const line2 = [t.address, t.ico ? `IČO ${t.ico}` : "", t.dic ? `DIČ ${t.dic}` : "", t.ic_dph ? `IČ DPH ${t.ic_dph}` : ""].filter(Boolean).join(" · ");
    if (line2) this.text(line2, { size: 8, color: MUT });
    const line3 = [t.nip_number ? `Oprávnenie NIP na výchovu a vzdelávanie č. ${t.nip_number}` : "", t.email, t.phone, t.web].filter(Boolean).join(" · ");
    if (line3) this.text(line3, { size: 8, color: MUT });
    this.y -= 4;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 14;
  }
  ensure(h: number) { if (this.y - h < M + 20) this.newPage(); }
  wrap(s: string, size: number, width: number, bold = false) {
    const font = bold ? this.b : this.f;
    const out: string[] = [];
    for (const para of String(s ?? "").split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const cand = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(cand, size) <= width) line = cand;
        else {
          if (line) out.push(line);
          // príliš dlhé slovo rozdeliť
          let rest = w;
          while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
            let i = rest.length;
            while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
            out.push(rest.slice(0, i)); rest = rest.slice(i);
          }
          line = rest;
        }
      }
      out.push(line);
    }
    return out;
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10, x = o.x ?? M, width = o.width ?? A4[0] - M - x;
    const lines = this.wrap(s, size, width, o.bold);
    for (const ln of lines) {
      this.ensure(size + 4);
      this.page.drawText(ln, { x, y: this.y - size, size, font: o.bold ? this.b : this.f, color: o.color ?? INK });
      this.y -= size * 1.35;
    }
    this.y -= o.gap ?? 0;
  }
  title(s: string, sub?: string) {
    this.ensure(60);
    this.text(s, { size: 16, bold: true, color: this.accent });
    if (sub) this.text(sub, { size: 9, color: MUT });
    this.y -= 8;
  }
  h(s: string) { this.ensure(40); this.y -= 6; this.text(s, { size: 11, bold: true }); this.y -= 2; }
  /** Tabuľka: šírky stĺpcov v bodoch, prvý riadok môže byť hlavička. */
  table(rows: string[][], widths: number[], o: { head?: boolean; size?: number; boldFirstCol?: boolean; colors?: (ReturnType<typeof rgb> | undefined)[][] } = {}) {
    const size = o.size ?? 9, pad = 4;
    rows.forEach((r, ri) => {
      const head = o.head && ri === 0;
      const cells = r.map((c, ci) => this.wrap(c ?? "", size, widths[ci] - 2 * pad, head || (o.boldFirstCol && ci === 0)));
      const h = Math.max(...cells.map((c) => c.length)) * size * 1.3 + 2 * pad;
      if (this.y - h < M + 20) {
        this.newPage();
      }
      let x = M;
      if (head) this.page.drawRectangle({ x: M, y: this.y - h, width: widths.reduce((a, b) => a + b, 0), height: h, color: rgb(0.95, 0.95, 0.97) });
      cells.forEach((lines, ci) => {
        lines.forEach((ln, li) => this.page.drawText(ln, {
          x: x + pad, y: this.y - pad - size - li * size * 1.3, size,
          font: head || (o.boldFirstCol && ci === 0) ? this.b : this.f, color: o.colors?.[ri]?.[ci] ?? (head ? MUT : INK),
        }));
        x += widths[ci];
      });
      this.page.drawLine({ start: { x: M, y: this.y - h }, end: { x: M + widths.reduce((a, b) => a + b, 0), y: this.y - h }, thickness: 0.5, color: LINE });
      this.y -= h;
    });
    this.y -= 8;
  }
  /** Podpisové polia vedľa seba: popis, obrázok podpisu (PNG), čiara, meno a poznámka. */
  async signBlock(items: { label: string; name: string; img?: Uint8Array | null; note?: string }[]) {
    const h = 92, gap = 14, w = (A4[0] - 2 * M - gap * (items.length - 1)) / items.length;
    this.ensure(h + 10);
    const top = this.y;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], x = M + i * (w + gap);
      this.page.drawText(it.label, { x, y: top - 9, size: 8, font: this.f, color: MUT });
      if (it.img) {
        try {
          const png = await this.pdf.embedPng(it.img);
          const sc = Math.min((w - 4) / png.width, 52 / png.height);
          this.page.drawImage(png, { x: x + 2, y: top - 14 - png.height * sc, width: png.width * sc, height: png.height * sc });
        } catch { /* poškodený obrázok – pole ostane prázdne */ }
      } else {
        this.page.drawText("bez podpisu", { x: x + 2, y: top - 44, size: 8, font: this.f, color: LINE });
      }
      this.page.drawLine({ start: { x, y: top - 70 }, end: { x: x + w, y: top - 70 }, thickness: 0.6, color: MUT });
      for (const [k, ln] of this.wrap(it.name, 8.5, w).slice(0, 1).entries()) this.page.drawText(ln, { x, y: top - 80 - k * 10, size: 8.5, font: this.b, color: INK });
      if (it.note) this.page.drawText(this.wrap(it.note, 7, w)[0], { x, y: top - 90, size: 7, font: this.f, color: MUT });
    }
    this.y = top - h - 8;
  }
  kv(rows: [string, string][], w1 = 170) { this.table(rows.map(([k, v]) => [k, v]), [w1, A4[0] - 2 * M - w1], { boldFirstCol: false, colors: rows.map(() => [MUT, INK]) }); }
  async finish() {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      p.drawText(`${this.footer} · strana ${i + 1} / ${pages.length}`, { x: M, y: 24, size: 7, font: this.f, color: MUT });
      p.drawText("Vytvorené v aplikácii LearnIQ", { x: A4[0] - M - this.f.widthOfTextAtSize("Vytvorené v aplikácii LearnIQ", 7), y: 24, size: 7, font: this.f, color: MUT });
    });
    return await this.pdf.save();
  }
}

export type ProtocolData = {
  tenant: Tenant;
  session: { kind: "A" | "B"; protocol_no: string; place: string; starts_on: string; lektor_name?: string | null };
  customer: { name: string; ico?: string | null; address?: string | null };
  enrollment: { id: string; first_name: string; last_name: string; email: string; company?: string | null; position?: string | null;
    verified_at?: string | null; study_started_at?: string | null; study_done_at?: string | null };
  topics: { position: number; title: string; minutes: number; seconds: number; started_at?: string | null; done_at?: string | null }[];
  attempt: { no: number; questions: { text: string; options: string[]; correct: number }[]; answers: (number | null)[];
    started_at: string; submitted_at: string; correct: number; total: number; percent: number; passed: boolean;
    app_passed?: boolean | null; note?: string | null;
    confirmed_name?: string | null; confirmed_cert?: string | null; confirmed_at?: string | null };
  attempts: { no: number; submitted_at: string | null; correct: number | null; total: number | null; passed: boolean | null; app_passed?: boolean | null }[];
  valid_until?: string | null;
  signatures?: { employee?: Uint8Array | null; employee_at?: string | null; evaluator?: Uint8Array | null };
};

export async function protocolPdf(d: ProtocolData) {
  const t = d.tenant, e = d.enrollment, a = d.attempt, s = d.session;
  const name = `${e.first_name} ${e.last_name}`.trim();
  const kind = s.kind === "A" ? "A – vstupné oboznamovanie (4 hodiny)" : "B – opakované oboznamovanie (3 hodiny)";
  const doc = await Doc.create(t, `Protokol ${s.protocol_no} · ${name}`);
  const result = a.passed ? "VYHOVEL" : "NEVYHOVEL";
  const appPassed = a.app_passed ?? a.passed;
  const changed = appPassed !== a.passed;
  const decision: [string, string][] = [
    ["Vyhodnotenie aplikáciou", appPassed ? "vyhovel" : "nevyhovel"],
    ["Rozhodnutie hodnotiteľa", a.confirmed_at ? `${result}${changed ? " (výsledok aplikácie zmenený)" : " (potvrdené)"}` : "–"],
    ...(a.note ? [["Poznámka hodnotiteľa", a.note] as [string, string]] : []),
  ];
  const evaluated = a.confirmed_name
    ? `${a.confirmed_name}${a.confirmed_cert ? `, osvedčenie č. ${a.confirmed_cert}` : ""} – potvrdené elektronicky ${fmtDateTime(a.confirmed_at)}`
    : "–";

  // 1. Záznam o oboznámení (iba pri úspešnom overení) alebo oznámenie o výsledku
  doc.newPage();
  if (a.passed) {
    doc.title("ZÁZNAM O OBOZNÁMENÍ ZAMESTNANCA", "o vykonaní výchovy a vzdelávania v oblasti bezpečnosti a ochrany zdravia pri práci podľa § 7 a § 27 zákona č. 124/2006 Z. z. a vyhlášky č. 356/2007 Z. z. – činnosť 01.1");
  } else {
    doc.title("VÝSLEDOK ZÁVEREČNÉHO OVERENIA VEDOMOSTÍ", "výchova a vzdelávanie v oblasti BOZP – činnosť 01.1 zamestnanci a vedúci zamestnanci");
  }
  doc.kv([
    ["Zamestnanec", name],
    ["E-mail (overený kódom)", e.email],
    ["Zamestnávateľ (objednávateľ)", [d.customer.name, d.customer.ico ? `IČO ${d.customer.ico}` : "", d.customer.address].filter(Boolean).join(", ")],
    ["Firma uvedená školeným", e.company || "–"],
    ["Pracovisko / profesia", e.position || "–"],
    ["Druh a rozsah", kind],
    ["Forma", "e-learning (vzdelávanie formou e-learningu podľa schváleného projektu)"],
    ["Číslo školiaceho protokolu", s.protocol_no],
    ["Záverečný test", `${fmtDateTime(a.submitted_at)} · ${a.correct} z ${a.total} (${a.percent.toFixed(0)} %), potrebných najmenej ${t.pass_percent} %`],
    ["Výsledok", result],
    ...(changed || a.note ? decision.slice(0, 1).concat(decision.slice(2)) : []),
    ["Test vyhodnotil", evaluated],
    ...(a.passed && d.valid_until ? [["Ďalšie oboznámenie najneskôr do", fmtDate(d.valid_until)] as [string, string]] : []),
  ]);
  doc.h("Prebraté témy podľa učebného plánu");
  doc.table([["Č.", "Téma", "Plán (min)"],
    ...d.topics.map((x) => [String(x.position), x.title, String(x.minutes)])],
    [26, A4[0] - 2 * M - 26 - 70, 70], { head: true });
  if (a.passed) {
    doc.text(`Potvrdzujeme, že zamestnanec bol oboznámený s právnymi predpismi a ostatnými predpismi na zaistenie bezpečnosti a ochrany zdravia pri práci, s vnútornými predpismi zamestnávateľa, s rizikami a opatreniami v rozsahu uvedenom vyššie, a úspešne absolvoval záverečné overenie vedomostí. Oboznámenie sa vykonalo v rozsahu a obsahu podľa schváleného projektu výchovy a vzdelávania ${t.name}.`, { size: 9, gap: 6 });
  } else {
    doc.text("Zamestnanec v záverečnom teste nevyhovel. Overenie vedomostí zopakuje v náhradnom termíne a dovtedy nesmie samostatne vykonávať prácu, na ktorú sa oboznámenie vzťahuje.", { size: 9, gap: 6, color: BAD });
  }
  doc.h("Potvrdenie");
  doc.table([["Odborný zástupca", "Test vyhodnotil a výsledok potvrdil", "Školiteľ"],
    [t.rep_name ? `${t.rep_name}${t.rep_cert ? `\nosvedčenie č. ${t.rep_cert}` : ""}` : "–", evaluated, s.lektor_name || "–"]],
    [166, 166, A4[0] - 2 * M - 332], { head: true });
  const sig = d.signatures || {};
  await doc.signBlock([
    { label: "Podpis zamestnanca", name, img: sig.employee, note: sig.employee_at ? `podpísané elektronicky ${fmtDateTime(sig.employee_at)}` : "nepodpísané" },
    { label: "Test vyhodnotil a výsledok potvrdil", name: a.confirmed_name || "–", img: sig.evaluator, note: a.confirmed_at ? `potvrdené ${fmtDateTime(a.confirmed_at)}` : "" },
  ]);
  doc.text("Dokument bol vytvorený elektronicky na základe záznamov e-learningovej platformy. Overenie totožnosti, priebeh štúdia a výsledok testu sú uložené v elektronickej záznamovej knihe a uchovávajú sa 10 rokov (§ 4 vyhlášky č. 356/2007 Z. z.).", { size: 8, color: MUT });

  // 2. Test s vyhodnotením
  doc.newPage();
  doc.title("TEST – ZÁVEREČNÉ OVERENIE VEDOMOSTÍ BOZP", `činnosť 01.1 · ${name} · protokol ${s.protocol_no} · pokus č. ${a.no} · ${fmtDateTime(a.submitted_at)}`);
  doc.text("Legenda: ● odpoveď školeného, ✓ správna odpoveď.", { size: 8, color: MUT, gap: 4 });
  a.questions.forEach((q, i) => {
    const ans = a.answers[i];
    const good = ans === q.correct;
    doc.ensure(64);
    doc.text(`${i + 1}. ${q.text}`, { size: 9.5, bold: true, color: good ? INK : BAD });
    q.options.forEach((o, k) => {
      const mark = `${ans === k ? "●" : "○"} ${k === q.correct ? "✓" : "  "}`;
      doc.text(`${mark}  ${"abc"[k]}) ${o}`, { size: 9, x: M + 12, color: k === q.correct ? OK : ans === k ? BAD : INK });
    });
    if (ans == null) doc.text("bez odpovede", { size: 8, x: M + 12, color: BAD });
    doc.y -= 3;
  });
  doc.h("Vyhodnotenie");
  doc.kv([
    ["Počet správnych odpovedí", `${a.correct} / ${a.total}`],
    ["Úspešnosť", `${a.percent.toFixed(0)} % (potrebných najmenej ${t.pass_percent} %)`],
    ["Výsledok", result],
    ...decision,
    ["Test vyhodnotil", evaluated],
  ]);
  await doc.signBlock([
    { label: "Podpis zamestnanca", name, img: sig.employee, note: sig.employee_at ? `podpísané elektronicky ${fmtDateTime(sig.employee_at)}` : "nepodpísané" },
    { label: "Vyhodnotil", name: a.confirmed_name || "–", img: sig.evaluator, note: a.confirmed_at ? `potvrdené ${fmtDateTime(a.confirmed_at)}` : "" },
  ]);

  // 3. Výpis z e-learningovej platformy
  doc.newPage();
  doc.title("VÝPIS Z E-LEARNINGOVEJ PLATFORMY", `${name} · ${e.email} · protokol ${s.protocol_no}`);
  doc.kv([
    ["Overenie totožnosti", e.verified_at ? `${fmtDateTime(e.verified_at)} – jednorazovým kódom zaslaným na ${e.email}, meno a firma zadané školeným` : "–"],
    ["Začiatok štúdia", fmtDateTime(e.study_started_at)],
    ["Ukončenie štúdia", fmtDateTime(e.study_done_at)],
    ["Vlastnoručný podpis po teste", sig.employee_at ? `${fmtDateTime(sig.employee_at)} – nakreslený školeným v aplikácii, uložený k pokusu č. ${a.no}` : "–"],
  ]);
  doc.h("Priebeh štúdia podľa tém");
  doc.table([["Č.", "Téma", "Začiatok", "Dokončené"],
    ...d.topics.map((x) => [String(x.position), x.title, fmtDateTime(x.started_at), fmtDateTime(x.done_at)])],
    [24, A4[0] - 2 * M - 24 - 92 - 92, 92, 92], { head: true, size: 8 });
  doc.h("Pokusy o záverečný test");
  doc.table([["Pokus", "Odovzdané", "Správne", "Výsledok"],
    ...d.attempts.map((x) => [String(x.no), fmtDateTime(x.submitted_at), x.correct == null ? "–" : `${x.correct} / ${x.total}`, x.passed == null ? "–" : `${x.passed ? "vyhovel" : "nevyhovel"}${x.app_passed != null && x.app_passed !== x.passed ? " (rozhodnutie hodnotiteľa)" : ""}`])],
    [60, 180, 100, A4[0] - 2 * M - 340], { head: true });
  return await doc.finish();
}

export type OfferData = {
  tenant: Tenant & { offer_note?: string | null };
  customer: { name: string; ico?: string | null; address?: string | null; contact_name?: string | null; email?: string | null };
  offer: { number: string; kind: "A" | "B"; items: { name: string; valid_until?: string | null }[]; count: number;
    unit_price: number | null; vat_rate: number | null; total_net: number | null; total_vat: number | null; total: number | null;
    earliest_due?: string | null; valid_until?: string | null; note?: string | null; created_at: string };
};

export async function offerPdf(d: OfferData) {
  const t = d.tenant, o = d.offer, c = d.customer;
  const doc = await Doc.create(t, `Cenová ponuka ${o.number}`);
  doc.newPage();
  doc.title(`CENOVÁ PONUKA č. ${o.number}`, `zo dňa ${fmtDate(o.created_at)} · platná do ${fmtDate(o.valid_until)}`);
  doc.kv([
    ["Odberateľ", [c.name, c.ico ? `IČO ${c.ico}` : "", c.address].filter(Boolean).join(", ")],
    ["Kontaktná osoba", [c.contact_name, c.email].filter(Boolean).join(", ") || "–"],
    ["Predmet", `${o.kind === "A" ? "Vstupné" : "Opakované"} oboznamovanie zamestnancov v oblasti BOZP (činnosť 01.1) formou e-learningu vrátane záverečného testu, protokolov a záznamov o oboznámení`],
    ["Termín", o.earliest_due ? `platnosť oboznámenia prvého zamestnanca končí ${fmtDate(o.earliest_due)} – odporúčame absolvovať do tohto dátumu` : "podľa dohody"],
  ]);
  doc.h("Zamestnanci, ktorým končí platnosť oboznámenia");
  doc.table([["Č.", "Meno a priezvisko", "Platnosť do"], ...o.items.map((x, i) => [String(i + 1), x.name, fmtDate(x.valid_until)])],
    [30, A4[0] - 2 * M - 130, 100], { head: true });
  doc.h("Cena");
  const vat = Number(o.vat_rate || 0);
  doc.kv([
    ["Počet účastníkov", String(o.count)],
    ["Cena za účastníka", `${eur(o.unit_price)}${vat ? " bez DPH" : ""}`],
    ["Spolu bez DPH", eur(o.total_net)],
    ...(vat ? [[`DPH ${vat.toFixed(0)} %`, eur(o.total_vat)] as [string, string]] : []),
    ["Spolu na úhradu", eur(o.total)],
  ]);
  if (!vat) doc.text(t.vat_payer ? "" : "Dodávateľ nie je platiteľom DPH.", { size: 8, color: MUT });
  if (o.note || t.offer_note) doc.text(o.note || t.offer_note || "", { size: 9, gap: 4 });
  doc.text("Po potvrdení ponuky pošleme zamestnancom osobné odkazy na školenie. Každý zamestnanec po absolvovaní dostane protokol vo formáte PDF.", { size: 9, gap: 10 });
  doc.text(`S pozdravom\n${t.rep_name || t.name}\n${t.name}${t.phone ? ` · ${t.phone}` : ""}${t.email ? ` · ${t.email}` : ""}`, { size: 9 });
  return await doc.finish();
}
