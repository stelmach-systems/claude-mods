# kanon-pasek-budzetu — pasek budżetu nad promptem (v0.2.1)

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.293, testy zielone też na CLI 2.1.289). Nice-to-have
z planu modów 2026-10-10; v0.2 = M2 planu (limity konta, koszt, model i cache ostatniego
żądania, `session.measure`, log JSONL — D4); v0.2.1 (2026-10-17) = złożenie łańcucha AbovePrompt (`next(e)`). Nad promptem jedna linia:

```
████████░░░░░░░░░░░░░░░░░░░░░░ 142k / 300k (47 %)  WARN 220k · kompaktacja ~280k  5h 37 % · 7d 61 %  $0.42  [ Ukryj ]
```

- **Liczby:** `$.session.usage()` (tokeny kontekstu, `rateLimits` 5h/7d z czasem resetu, `cost.usd`; wywołanie bez breakdown nic
  nie kosztuje) oraz zdarzenie `session.measure` — te same liczby PCHANE przez silnik po każdej turze głównego wątku i gdy okno limitu
  ruszy o cały punkt (bez dodatkowego wywołania).
- **Okno budżetu** (mianownik): env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` → `settings.autoCompactWindow` →
  `settings.modelSettings[<model sesji>].autoCompactWindow` → okno modelu z silnika (ta sama kolejność co w kanonie: env wygrywa).
- **Progi kontekstu** jak hook Stop `kanon-budzet`: WARN = `KANON_CTX_WARN` albo okno − 80k (okno ≥ 200k; poniżej − 40k); kompaktacja
  ≈ okno − 20k. Kolor paska: zielony → żółty od WARN → czerwony od progu kompaktacji. Toast przy pierwszym przekroczeniu WARN w cyklu
  (reset po `session.compact`) z przypomnieniem o sekcji „## Stan” w `~/.claude/kanon/stan/<session_id>.md`.
- **Limity konta** (`5h 37 % · 7d 61 %`): kolor wg progów DOMYŚLNYCH, bez pomiaru — 5h żółty ≥ 70 %, czerwony ≥ 90 %; 7d żółty ≥ 50 %,
  czerwony ≥ 80 % (raport tygodniowy daje 🔴, gdy 2 dni > 40 % okna 7 dni). Toast raz po wejściu
  w czerwień, ponownie dopiero po spadku poniżej progu. Poza subskrypcją i przed pierwszą odpowiedzią API segmentu nie ma.
- **Komenda** `/budzet` — trzy linie: kontekst (ze źródłem okna), limity z czasem do resetu i kosztem sesji, ostatnie żądanie głównego
  wątku (model z `usage` odpowiedzi, nie alias; udział cache). `/budzet ukryj` / `/budzet pokaz` — pasek on/off (przycisk „Ukryj” to samo).
  Poniżej 110 kolumn pasek chowa progi i koszt, limity zostają.
- **Różnica wobec hooka:** mod nie czyta transkryptu, więc nie obniża WARN do mediany realnych punktów kompaktacji.
  Pasek jest podglądem; blok tury i próg obowiązujący pozostają w hooku.
- Odświeżenie: po każdej turze głównego wątku, po pomiarze silnika, po kompaktacji i co 5 wywołań narzędzi w trakcie tury.
- **Łańcuch AbovePrompt:** pasmo rysuje JEDEN hook (d.ts: „draws a tree, or passes; one instance”). Pasek składa pod sobą to, co narysowałby
  plugin niżej w łańcuchu (`next(e)`: kanon-sztafeta, a po dodaniu do env kanon-skrzynka), a gdy milczy (brak odczytu, ankieta, `ukryj`),
  oddaje `next(e)` bez zmian. Błąd pluginu niżej nie gasi paska (`.catch(() => undefined)` na `next`). Przy `maxRows < 2` pasek zostaje sam
  (d.ts: drzewo wyższe niż `maxRows` przewija się w oknie `bodyRows` = `maxRows` − wiersz „n more” — stos w jednym wierszu byłby
  niewidoczny). Do 2026-10-17 zwracał własne drzewo bez `next` i zasłaniał pluginy niżej (patrz „Odstępstwa / kolejność łańcucha”).

## Log zużycia (D4)

Po każdej turze głównego wątku (nie agentów) mod dopisuje JEDNĄ linię do `~/.claude/kanon/usage/sesje/sesja-<session_id>.jsonl`
(`$.fs.write` zakłada katalog; brak append w API → odczyt + zapis całości; powyżej 2 MiB przestaje dopisywać):

```json
{"t":"2026-10-10T10:00:00.000Z","sid":"…","turn":"…","reason":"answer","ms":8123,"model":"claude-opus-5-5","in":3000,"cache_write":0,"cache_read":58000,"out":1200,"ctx":142000,"p5h":37,"p7d":61,"usd":0.42}
```

Same liczby i model — bez treści promptów, odpowiedzi i narzędzi: test porównuje DOKŁADNY zestaw 14 kluczy (`toEqual`), więc żadne
pole poza wymienionymi nie przejdzie niezauważone. `usd` to koszt sesji NARASTAJĄCO (`cost.usd` silnika), nie koszt tury — konsument
liczy różnicę kolejnych linii. `ctx`/`p5h`/`p7d`/`usd` pochodzą z odświeżenia TEJ tury; gdy `$.session.usage()` padło, są `null`
(nie stare liczby). Tura bez `usage` (przerwana, błąd API) nie zostawia linii. `KANON_USAGE_LOG=0` w env wyłącza.
Zapis chroni historię: `exists` → `stat` (rozmiar > 2 MiB = stop + jeden toast) → `read` → `write`; każdy błąd stat/read poza brakiem
pliku przerywa zapis BEZ dotykania pliku (EACCES nie może nadpisać logu pustą historią); historia bez końcowego `\n` dostaje go przed
nową linią. To jedyny zapis modu na dysk (walidator: `$.fs.exists`, `$.fs.read`, `$.fs.stat`, `$.fs.write` via `dopiszLog`; ścieżki
walidator nie pokazuje — dowodem jest test). Odbiorca: raport tygodniowy `usage-report-weekly.sh` może z tego liczyć koszt per model
i udział cache bez parsowania transkryptów (do zrobienia osobno).

## Uruchomienie

Na stałe: ścieżka modu w `env.CLAUDE_CODE_PLUGIN_DIRS` w `~/.claude/settings.json` (z backupem) — działa od NOWEJ sesji (także desktop); folder jest obserwowany, zapis pliku przeładowuje mod.
Jedna sesja z terminala bez env:

```bash
claude --plugin-dir ~/Developer/claude-mods/kanon-pasek-budzetu
```

## Sprawdzenie

```bash
claude plugin validate ~/Developer/claude-mods/kanon-pasek-budzetu
claude plugin test     ~/Developer/claude-mods/kanon-pasek-budzetu
```

24 testy (`tests/pasek.test.ts`, zielone na CLI 2.1.302 i desktop 2.1.299): pasek po `turn.complete` z limitami i kosztem na terminalu i desktopie, wąski terminal, cisza bez
odczytu i przy ankiecie, toast WARN raz na cykl i reset po kompaktacji, `/budzet` z oknem z env / settings / modelSettings / silnika
i trzema liniami (reset „za 2 h 10 min” / „za 3 d 4 h”), brak limitów i kroku, krok agenta nie nadpisuje głównego wątku, próg
`KANON_CTX_WARN`, `ukryj`/`pokaz`, `session.measure` bez wywołania `session.usage` + toast czerwonego 7d z resetem flagi, log JSONL
(dokładna linia, dopisywanie, brak treści), jego cisza (`KANON_USAGE_LOG=0`; tura agenta i tura bez `usage`), ochrona historii
(read odmawia → plik nietknięty; brak końcowego `\n`; plik > 2 MiB → stop + jeden toast; odświeżenie padło → `null` zamiast starych
liczb), współbieżność `session.measure` + `turn.complete` → jeden toast limitu (kolejka modułu) i łańcuch AbovePrompt (3 testy: dno
`ui.render` rysuje Text-strażnik → po turze POD linią paska w kolumnie `flexDirection`, przy `maxRows` 1 pasek sam, po `Ukryj` sam
strażnik — `next(e)` bez zmian; dno rdzenia = pusty Box bez dzieci pod paskiem, bez pustego tekstu; dno rzuca → pasek zostaje).
Recenzja v0.2.1: `recenzent` [S5.5HI], 1 runda (2026-10-17): 0 🔴, 5 🟡 — wszystkie wdrożone (strażnik `maxRows ≥ 2`, testy pustego Box,
rzucającego dna i kolumny, `.gitignore` w commicie).

`tsc -p .` strict (TypeScript 6.0.3 z `stelmach/wishlist/node_modules`): czysto wobec typów 2.1.299. `tsconfig.json` rozszerza ten, który
silnik kładzie w `.claude-plugin/types/` przy ładowaniu (gitignored od 2026-10-17); `validate`/`test` go nie kładą — przed `tsc` skopiuj
katalog `types` z innego modu (np. kanon-sztafeta). 2026-10-17 poprawione 4 stare błędy typów w testach (`Parameters<TestBody>[0]`
zamiast `Parameters<typeof test>[1]`, `linie[0] ?? ''` przy `noUncheckedIndexedAccess`) — bez zmiany asercji.

Lekcje z zestawu testowego (2026-10-10): referencja atomu musi mieć literały `plugin`/`key` (stała nie przechodzi skanu walidatora);
hooki testu pod modem odpowiadają rzeczownikom (`session.usage`, `settings.read`, `ui.toast`, `fs.stat`/`fs.read`/`fs.write`…) obiektem
`{ value }` — brak pliku odgrywa się rzuceniem w hooku `fs.stat` — a zdarzeniom rdzenia (`turn.complete`, `turn.step` jako generator,
`session.measure` → `{ changed }`, `command.run`, `session.compact`, `ui.render`) wynikiem jak silnik; `session.compact` w teście
wymaga co najmniej jednej wiadomości w `messages`; `mock.clock(on, { now })` ustala czas dla ISO w logu i „reset za”.

## Odstępstwa / kolejność łańcucha

Pasmo AbovePrompt rysuje JEDEN hook (d.ts: „draws a tree, or passes; one instance”), więc liczy się, kto w łańcuchu stoi wyżej. Sonda
2026-10-17 (jednorazowy plugin z `--plugin-dir` zapisujący `next.trace` po `next(e)` na `session.start` i `turn.complete`; `claude -p`,
Sonnet 5.5, 2 × $0,22; wynik IDENTYCZNY na CLI 2.1.302 i desktop 2.1.299): kolejność ogniw = kolejność ścieżek w `CLAUDE_CODE_PLUGIN_DIRS`,
wszystkie w tierze `user`, plugin z `--plugin-dir` przed nimi (index 0), rdzeń silnika na dnie:

```
0 sonda (--plugin-dir) · 1 kanon-agenci · 2 kanon-pasek-budzetu · 3 kanon-flota · 4 kanon-na-biegu · 5 kanon-brief · 6 kanon-sztafeta · 7 engine (core)
```

Wniosek dla pasma: pierwszy rysuje **kanon-pasek-budzetu**, jego `next(e)` trafia do **kanon-sztafety**, a **kanon-skrzynka** dopisana na
KOŃCU env będzie ostatnia, nad pustym rdzeniem — na ekranie od góry: budżet → sztafeta → skrzynka. Przed tą zmianą pasek budżetu (odczyt
kontekstu jest prawie zawsze po pierwszej turze) zwracał własne drzewo bez `next(e)` i zasłaniał sztafetę całkowicie, a sztafeta — skrzynkę.
Inna kolejność linii = inna kolejność ścieżek w env (od nowej sesji), nie zmiana kodu. Dokumentacja (skill `plugin-authoring`, d.ts) mówi
tylko o tierach (`prepend, user, append, builtin, core`) i o kolejności rejestracji w JEDNYM pluginie — kolejność w tierze `user` znamy
wyłącznie z sondy. Niesprawdzone na żywo: wygląd dwóch–trzech linii naraz w pasmie (wysokość, `[-]` zwija cały stos, limit `maxRows`
= połowa wierszy terminala, hotkeye przycisków z kilku modów w jednym pasmie).

## Rollback

`git revert` commitu v0.2.1 (wraca v0.2: pasek znów zasłania pluginy niżej) albo v0.2 (wraca v0.1 bez logu i limitów), `rm -rf ~/.claude/kanon/usage/sesje`, usunięcie ścieżki
z `CLAUDE_CODE_PLUGIN_DIRS` albo `cp` backupu `~/.claude/settings.json.bak-<ts>`.
