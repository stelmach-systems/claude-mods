// Fixtures testów kanon-sztafeta: SYNTETYCZNE fragmenty o kształcie realnych plików ~/.claude/kanon/stan/<sid>.md (przegląd 50 plików,
// 2026-10-16) — bez danych klientów, bez nazwisk, bez treści sesji. Warianty nagłówków skopiowane z przeglądu (same formy, nie treść):
// „## Stan 2026-10-16 23:37 (asystent)”, „## Stan … (asystent) — dopisek: …”, „## Stan — 2026-10-10T10:16Z (asystent, po kompaktacji 4; …)”,
// „## Stan — 2026-10-13 (asystent, po kompaktacji 1)”; bloki hooka kanon-stan: „## Kompaktacja N — … (auto; …)”, „## Podsumowanie
// kompaktacji — …”. Podsekcje: „### Zrobione”, „### Dalej …”, „### Decyzje właściciela i przyjęte założenia …”, „### Pliki i commity”.

/** Starsza sekcja — jej treść NIE może trafić do briefu ani skrótu (znacznik do asercji). */
export const STAN_STARY = `## Stan 2026-10-16 21:05 (asystent)

### Zrobione
- STARA-SEKCJA-ZNACZNIK: przegląd czterech istniejących modów i hooków settings.

### Dalej
- STARA-SEKCJA-ZNACZNIK: policzyć kompaktacje w transkryptach.

### Decyzje właściciela i przyjęte założenia
- STARA-SEKCJA-ZNACZNIK: żadnych.`

/** Docelowy kształt sekcji (jak plik 2f421ff7, 29 linii): cztery podsekcje, punkty listy. */
export const STAN_NAGLOWEK = '## Stan 2026-10-16 23:37 (asystent)'
export const STAN_PELNY = `${STAN_NAGLOWEK}

### Zrobione
- Analiza 42 transkryptów skryptami w scratchpadzie sesji (tylko odczyt); liczby w planie pochodzą ze skryptów.
- Deliverable: plan trzech modów (191 linii, NIEZACOMMITOWANY): §0 streszczenie, §3 trzy mody, §5 decyzje D1–D4.
- Uruchomiona osobna sesja budująca drugi mod (brief wg §3.2 planu).

### Dalej
- Czekam na notatkę z sesji budującej drugi mod; po niej sprawdzić pliki, wyjście validate/test i commit na dev.
- Potem trzeci mod w osobnej sesji wg §3.3 planu (rekomendacja: zakładka w istniejącym modzie).
- Plik planu do commitu (właściciel nie prosił o commit).

### Decyzje właściciela i przyjęte założenia (z uzasadnieniem)
- Właściciel (23:35): „Zacznij od drugiego modu; sztafetę potem.” → kolejność zmieniona.
- Założenia moje: mody tylko podglądem/wygodą, hook settings zostaje bramką; zero $.model/$.http.

### Pliki i commity
- Nowy: plan modów (untracked, bez commitu).
- Commity: żadnych. Push: żaden.`

/** Jednolinijkowy dopisek bez podsekcji (jak ostatnia sekcja pliku 3d1a820a, 448 KB). */
export const DOPISEK = `## Stan 2026-10-15 22:48 (asystent) — dopisek: faza 6a bramki odebrana
- Faza 6a (pełny zestaw testów): 2 failed, 7056 passed, 2 skipped, exit 1. Porażki: dwa testy kontraktu release.
- Fazy 6b i 7 biegną; commit po ich odbiorze.`

export const KOMPAKTACJA = (n: number) => `## Kompaktacja ${n} — 2026-10-16 2${n % 4}:1${n % 10} (auto; granic kompaktacji w transkrypcie: ${n})
tytuł sesji: Budowa modu z planu

### Polecenia właściciela w tym odcinku (1 nowych, 0 już zapisanych wyżej, verbatim)
- „Zbuduj mod wg planu, testy na obu binarkach.”

### Pliki zmienione (Edit/Write) — 2 nowych
- ~/Developer/projekt-x/hooks/register.tsx
- ~/Developer/projekt-x/README.md

### Subagenci — 0 nowych
- (brak)

### Git
- branch: dev, niezacommitowane zmiany: 2
- 0000000 poprzedni commit (nr ${n})

### Ostatnia odpowiedź asystenta
Testy przechodzą; piszę README. (blok ${n})`

const PODSUMOWANIE_GLOWA = `## Podsumowanie kompaktacji — 2026-10-16 22:12
<!-- podsumowanie:00000000-0000-0000-0000-000000000000 -->
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   - Build the mod from the plan; tests on both binaries.
2. Key Technical Concepts:
   - function hooks API, AbovePrompt band, Pane.`

/** Podsumowanie kompaktacji dopełnione syntetyczną listą plików — ~`kb` KB. */
export const PODSUMOWANIE = (kb: number) => {
  const linie: string[] = ['3. Files and Code Sections:']
  for (let i = 0; linie.join('\n').length < kb * 1024; i++) linie.push(`   - plik_${i}.ts: ${'x'.repeat(90)}`)
  return `${PODSUMOWANIE_GLOWA}\n${linie.join('\n')}`
}

/** Mały plik o realnym układzie: starsza sekcja, dwa bloki hooka, ostatnia sekcja Stan, po niej jeszcze blok kompaktacji. */
export const MALY = [STAN_STARY, KOMPAKTACJA(1), PODSUMOWANIE(1), STAN_PELNY, KOMPAKTACJA(2)].join('\n\n')

/** Duży plik (≥ 300 KB, jak 313 KB z logów): dziesiątki bloków hooka, ostatnia sekcja Stan głęboko w środku, potem bloki kompaktacji. */
export const DUZY = (() => {
  const bloki: string[] = [STAN_STARY]
  for (let n = 1; bloki.join('\n\n').length < 300 * 1024; n++) bloki.push(KOMPAKTACJA(n), PODSUMOWANIE(4), n % 7 === 0 ? `## Stan 2026-10-16 2${n % 4}:${10 + (n % 50)} (asystent)\n- STARA-SEKCJA-ZNACZNIK (${n})` : '')
  bloki.push(STAN_PELNY, KOMPAKTACJA(99), PODSUMOWANIE(20), KOMPAKTACJA(100))
  return bloki.filter(Boolean).join('\n\n')
})()

/** Plik, którego ostatnia sekcja Stan to dopisek bez podsekcji, a ostatni blok hooka to długie podsumowanie (do testu przycięcia). */
export const Z_DOPISKIEM = [STAN_STARY, KOMPAKTACJA(1), STAN_PELNY, KOMPAKTACJA(2), DOPISEK, KOMPAKTACJA(3), PODSUMOWANIE(20)].join('\n\n')
