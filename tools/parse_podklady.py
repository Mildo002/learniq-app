"""Z podkladov (Word) vyrobí seed: témy kurzu 01.1 a 300 otázok s kľúčom (supabase/seed/kurz_01_1.json)."""
import re, json, sys, html
from bs4 import BeautifulSoup

src = sys.argv[1]
# ---------- testy ----------
lines = open(f"{src}/Testy_BOZP_Keylo_01-1_15_variantov.txt", encoding="utf-8").read().splitlines()
variants, cur, q = {}, None, None
for ln in lines:
    m = re.search(r"VARIANT č\. (\d+)", ln)
    if m:
        cur = int(m.group(1)); variants[cur] = []; continue
    m = re.match(r"^(\d+)\. (.+)$", ln)
    if m and cur is not None and 1 <= int(m.group(1)) <= 20:
        q = {"slot": int(m.group(1)), "text": m.group(2).strip(), "options": []}
        variants[cur].append(q); continue
    m = re.match(r"^  ([abc])\) (.+)$", ln)
    if m and q is not None:
        q["options"].append(m.group(2).strip())
key = {}
for ln in open(f"{src}/Kluc_testov_BOZP_Keylo_01-1.txt", encoding="utf-8"):
    m = re.match(r"^\s*č\. (\d+)\s+(.+)$", ln)
    if m: key[int(m.group(1))] = m.group(2).split()
questions = []
for v, qs in sorted(variants.items()):
    assert len(qs) == 20, (v, len(qs))
    for qq in qs:
        assert len(qq["options"]) == 3, qq
        qq["correct"] = "abc".index(key[v][qq["slot"] - 1])
        qq["variant"] = v
        questions.append(qq)
# rovnaká otázka sa môže vyskytnúť vo viacerých variantoch – pri náhodnom výbere nesmie byť dvakrát
seen = {}
for qq in questions:
    seen.setdefault(qq["text"], []).append(qq["variant"])
dups = sum(1 for k, v in seen.items() if len(v) > 1)

# ---------- obsah tém ----------
soup = BeautifulSoup(open(f"{src}/obsah.html", encoding="utf-8").read(), "html.parser")
for s in soup.find_all("span"):
    s.unwrap()
topics, buf, title = [], [], None
def flush():
    if title:
        topics.append({"title": title, "html": "".join(str(x) for x in buf).strip()})
for el in list(soup.children):
    if getattr(el, "name", None) is None:
        continue
    txt = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
    m = re.match(r"^Téma (\d+) – (.+)$", txt) if el.name == "p" else None
    if m:
        flush(); title = m.group(2).strip(); buf = []; continue
    if txt.startswith("Záverečné overenie vedomostí") and el.name == "p":
        flush(); title = None; break
    if title:
        buf.append(el)
flush()
# Rozsah z prvého odseku, tučné medzititulky
for t in topics:
    m = re.search(r"Rozsah: ([^.]+)\.", BeautifulSoup(t["html"], "html.parser").get_text(" "))
    t["rozsah"] = m.group(1) if m else ""
    # e-learning: záverečné overenie je online test
    t["html"] = re.sub(r"\s+", " ", t["html"])
    t["html"] = re.sub(r"Záverečné overenie: písomný test s 20 otázkami pred trojčlennou skúšobnou komisiou\.",
                       "Záverečné overenie: test s 20 otázkami, ktorý vyplníte online v tejto aplikácii.", t["html"])
    t["html"] = t["html"].replace("Účasť sa potvrdzuje podpisom v prezenčnej listine (pri e-learningu záznamom v platforme).",
                                  "Účasť sa pri e-learningu potvrdzuje záznamom v aplikácii (čas štúdia každej témy).")
json.dump({"topics": topics, "questions": questions}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("témy:", len(topics), [t["title"][:30] for t in topics])
print("otázky:", len(questions), "duplicitné texty:", dups)
print("komisia v texte:", [i + 1 for i, t in enumerate(topics) if "komisi" in t["html"]])
