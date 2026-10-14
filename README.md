# LearnIQ

E-learning BOZP (oboznamovanie zamestnancov – činnosť 01.1) so záverečným testom, protokolmi v PDF a sledovaním termínov.
Súčasť aplikácií **Keylo**. Školiteľ ju používa pod vlastnou firmou (white-label).

- **Školiteľ** (`/`): školenia, pozvánky, potvrdenie výsledkov, protokoly, zákazníci a zamestnanci s platnosťou, cenové ponuky, nastavenia podmienok.
- **Školený** (`/kurz.html#i=…`): overenie e-mailom (kód) + meno, priezvisko, firma → štúdium tém → náhodný test → protokol e-mailom.
- **Platforma** (`/#/platforma`): správca aplikácie zakladá ďalších školiteľov a posiela im prístup.

Statické súbory (bez buildu) na Verceli, dáta a logika v Supabase (RLS + edge funkcia `learniq`). Podrobnosti v `CLAUDE.md`.
