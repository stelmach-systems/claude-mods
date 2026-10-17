# kanon-sztafeta — przekazanie pałeczki do nowej sesji

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.299, testy zielone na desktop 2.1.299 i CLI 2.1.302).
v0.1.1 (2026-10-17): pasek składa łańcuch AbovePrompt (`next(e)`) zamiast zasłaniać pluginy niżej.
Z planu `claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md` §3.1 (decyzja D1 2026-10-16: z przyciskiem `start_session`).
Problem z logów: sesje żyją po kilkanaście godzin i kilkadziesiąt kompaktacji, a stan do wznowienia leży w pliku hooka `kanon-stan`
(`~/.claude/kanon/stan/<session_id>.md`), który rośnie do setek KB — nowa sesja nie ma czego „wczytać” w rozsądnym rozmiarze.

## Co robi (v0.1)

- **Pasek nad promptem** — pojawia się dopiero, gdy sesja spełnia co najmniej jeden warunek; w świeżej sesji paska nie ma:
  1. ≥ 1 kompaktacja głównego wątku w tej sesji (`session.compact`; kompaktacje subagentów i `precompute` się nie liczą),
  2. wiek sesji ≥ 8 h (`$.session.usage().startedAt`; gdy silnik go nie zna — zegar przy `session.start`, odświeżany timerem co 5 min),
  3. kontekst głównego wątku ≥ WARN — formuła jak w modzie `kanon-pasek-budzetu`: `KANON_CTX_WARN` albo okno budżetu − 80k
     (okno ≥ 200k; poniżej − 40k); okno z `CLAUDE_CODE_AUTO_COMPACT_WINDOW` → `settings.autoCompactWindow`
     → `modelSettings[model].autoCompactWindow` → okno modelu z silnika. Różnica wobec hooka Stop `kanon-budzet`: mod nie czyta
     transkryptu, więc nie obniża WARN do mediany realnych punktów kompaktacji sesji (− 40k) ani nie zna jego podłogi i wartości
     domyślnej bez okna — pasek jest podglądem, hook pozostaje bramką (po pierwszej kompaktacji pasek i tak już jest z warunku 1).
  Treść: `⟳ sztafeta: 3 kompaktacje · sesja 6 h · stan: 22:23 (12 min temu, „## Stan” #4) · [Przekaż do nowej sesji] [Pokaż „dalej”]`
  (+ `kontekst 225k ≥ WARN 220k`, gdy to warunek 3). „stan” to godzina z nagłówka OSTATNIEJ sekcji `## Stan` pliku stanu (bez godziny
  w nagłówku — z mtime), wiek pliku i liczba sekcji; bez pliku — `stan: brak pliku`; plik z samymi blokami hooka — `stan: plik bez „## Stan”`.
  Pasek ustępuje ankiecie (`hasSurvey`) i milczy przy `maxRows < 1`. Pasmo AbovePrompt rysuje JEDEN hook (d.ts: „draws a tree, or passes;
  one instance”): pasek składa pod sobą to, co narysowałby plugin niżej w łańcuchu (`next(e)`, np. kanon-skrzynka), a gdy milczy, oddaje
  `next(e)` bez zmian; błąd pluginu niżej nie gasi paska; przy `maxRows < 2` pasek zostaje sam (stos w jednym wierszu przewijałby się
  w zerowym oknie `bodyRows`) (v0.1.1). Liczniki żyją w `$.state` bieżącego procesu: `/clear` i `resume`
  zerują je (hook `session.end`, bo `session.start` wtedy nie odpala), a sesja wznowiona w NOWYM procesie (`claude --resume`) zaczyna
  od „0 kompaktacji” i wieku od wznowienia — mod nie liczy bloków `## Kompaktacja N` z pliku (v0.1).
- **`/sztafeta`** — panel „Sztafeta” z OSTATNIĄ sekcją `## Stan` (nie całym plikiem) i briefem dla nowej sesji. Brief jest wycinany
  deterministycznie, bez modelu: `wczytaj <ścieżka skrótu>` / `dalej:` + punkty z podsekcji `### Dalej…` / `decyzje:` + punkty
  z `### Decyzje…` / `repo: <cwd>`. Sekcja bez tych podsekcji → cała sekcja przycięta do 1500 znaków; plik bez sekcji `## Stan` albo
  brak pliku → komunikat w panelu i w briefie (bez błędu). Gdy żadna powierzchnia nie sadza panelu, sekcja i brief idą w odpowiedzi komendy.
- **`/sztafeta skrot`** — zapis `~/.claude/kanon/stan/<session_id>-skrot.md`: nagłówek, ostatnia sekcja `## Stan` i ostatni blok hooka
  `kanon-stan` (`## Kompaktacja N — …` albo `## Podsumowanie kompaktacji — …`), razem ≤ 8 KB. Za dużo → blok kompaktacji przycięty
  od końca z adnotacją `_(przycięto do 8 KB; pełny plik: …)_`; gdy sama sekcja `## Stan` nie mieści się w limicie, blok wypada i przycina
  się sekcja. Komenda mówi, ile bajtów zapisała i czy przycięła.
- **„Przekaż do nowej sesji”** (pasek i panel) — WYŁĄCZNIE na klik: zapis skrótu, potem jedno wywołanie
  `$.mcp.call('ccd_session', 'start_session', { initiation: 'own_initiative', title, prompt: <brief>, background, context: 'fresh' })`
  → karta „Nowe zadanie” w aplikacji, którą właściciel sam uruchamia (nic nie startuje samo). Bez `cwd` — nowa sesja dziedziczy folder.
  Odstępstwo od §3.1 planu (tam `offer` + `cwd`), ustalone w zleceniu sesji nadrzędnej: typ MCP mówi, że `offer` to sam tytuł bez briefu
  (karta czeka na odpowiedź w rozmowie), a `cwd` służy tylko do innego folderu niż bieżący. Zapis skrótu, który się nie powiedzie,
  nie blokuje karty ani zapasu (background mówi wtedy „skrótu nie ma”).
  Gdy serwera nie ma, wywołanie rzuca albo odpowiedź ma `isError` / zaczyna się od `Error` → zapas: `$.prompt.fill(brief, append)` +
  `$.ui.copy(brief)` + toast z powodem i miejscem, gdzie brief wylądował (okno promptu / schowek / tylko panel).
- **„Pokaż „dalej””** — ten sam panel co `/sztafeta`.

## Bramki i odstępstwa

- Zero `$.model`, `$.http`, `$.process` (linia `calls:` walidatora niżej). Jedyny zapis na dysk: `<session_id>-skrot.md` w
  `~/.claude/kanon/stan/`. Stan modu w `$.state` (kontrakt `types/index.d.ts`: kompaktacje, start, kontekst, plik, widok, tyk).
- `tool.check` nieużywany. Hooki zdarzeń (`session.start`, `session.compact`, `turn.complete`, `session.measure`) tylko obserwują —
  każdy z `.catch` oddającym `next(e)`. Hook `command.run{sztafeta}` odpowiada za siebie; jego `.catch` zwraca tekst z powodem
  (bez `next`). Walidator wypisuje `session.compact` jako `gating hook with .catch` — to fakt, nie ostrzeżenie; a także: hooki
  `session.compact` nie biegną w pluginie instalowanym tam, gdzie organizacja zarządza Claude Code (tu: Mac właściciela, bez zarządzania).
- Mod nie zastępuje hooka `kanon-budzet`: blok tury przy WARN i żądanie sekcji `## Stan` zostają bramką w `settings.json`; mod jest podglądem
  i wygodą (pasek, skrót, karta).
- Plik stanu czytany w całości tylko, gdy zmienił się jego mtime (po kompaktacji i po turze głównego wątku) oraz na żądanie (`/sztafeta`,
  klik). Największy plik stanu na tym Macu ma 429 KB (`$.fs.read` odmawia od 4 MiB).
- Parser dzieli po liniach `## ` bez śledzenia bloków kodu: niedomknięty płot ``` w cudzym tekście wklejonym do „Ostatnia odpowiedź”
  nie ukryje późniejszych sekcji. H2 inne niż `## Stan…`, `## Kompaktacja <cyfra>…`, `## Podsumowanie kompaktacji…` są pomijane
  (`## Kompaktacja-odporne…` to nie blok, `## Standard…` to nie stan).
- **Kolejność łańcucha AbovePrompt.** Pasmo AbovePrompt rysuje JEDEN hook (d.ts: „draws a tree, or passes; one instance”), więc liczy się, kto w łańcuchu stoi wyżej. Sonda
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
  Dla sztafety znaczy to: jej pasek stoi POD paskiem budżetu i nad skrzynką; do 2026-10-17 pasek budżetu zasłaniał go w każdej sesji
  z odczytem kontekstu (od pierwszej tury) — także dlatego próba na żywo (wyżej) nie mogła go pokazać po pierwszej turze, dopóki
  kanon-pasek-budzetu nie składał `next(e)` (v0.2.1).

## Jak wypróbować

- `claude --plugin-dir ~/Developer/claude-mods/kanon-sztafeta` (CLI) albo kopia do `~/.claude/dev-mods/<session_id>/kanon-sztafeta/`
  (desktop; silnik pyta raz o hot reload, mod ładuje się po końcu tury). W świeżej sesji paska nie będzie — `/sztafeta` działa od razu.
  Pasek wymusza: `/compact` (warunek 1) albo `KANON_CTX_WARN=1` w env nowej sesji (warunek 3 od pierwszej tury).
- Próba na żywo 2026-10-17 (desktop 2.1.299, sesja `ccb20c0d` z 1 kompaktacją): kopia w `~/.claude/dev-mods/ccb20c0d-…/kanon-sztafeta/`
  położona; załadowanie zależy od odpowiedzi właściciela na pytanie o hot reload po końcu tury — pasek, `/sztafeta` i przycisk
  NIEZWERYFIKOWANE na żywo w tej sesji (patrz „Czy `start_session` z modu działa”).

## Czy `start_session` z modu działa

Niezweryfikowane na żywo (2026-10-17). Co wiadomo:
- Serwer `ccd_session` z narzędziem `start_session` jest podłączony do sesji desktop i typowany dla modów (`.claude-plugin/types/claude-code-mcp/index.d.ts`,
  który silnik położył przy ładowaniu `kanon-na-biegu` 2026-10-16) — wywołanie `$.mcp.call('ccd_session', 'start_session', …)` przechodzi
  walidator i `tsc`. Testy pokazują obie gałęzie na mocku: karta (odpowiedź bez `isError`) i zapas (`deny` serwera / `isError`).
- Ryzyko z lekcji `kanon-na-biegu` (README, „Sprawdzone na żywo”, pkt 3): w trybie auto wywołanie MCP spoza żądania modelu (timer) dostało
  odmowę klasyfikatora „the request that produced this action did not ask for one”; na-biegu obeszło to hookiem `tool.check` na własny origin.
  Klik przycisku też jest poza żądaniem modelu, a `tool.check` jest tu zabroniony — PRAWDOPODOBNE, że w trybie auto karta nie powstanie
  i zadziała zapas (brief w oknie promptu i w schowku; na desktopie, który rysuje własny composer, `prompt.fill` może odpowiedzieć
  `no_composer` — wtedy tylko schowek). Toast mówi, co się stało. Rozstrzygnięcie: jeden klik na żywo po załadowaniu modu.
- Serwer może też odmówić, gdy sesja pracuje nad wiadomością z innej sesji (reguła aplikacji dla `start_session`) — zapas ten sam.

## Walidator, typy, testy

- `claude plugin validate .` (2.1.299 i 2.1.302): `✔ Validation passed`; hooki: `session.start, session.compact, turn.complete,
  session.measure, command.run{command=sztafeta}, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=sztafeta}`;
  `calls: $.clock.every, $.clock.now, $.command.register, $.env.get, $.fs.exists, $.fs.read, $.fs.stat, $.fs.write, $.mcp.call,
  $.prompt.fill, $.session.cwd, $.session.id, $.session.model, $.session.usage, $.settings.read, $.state.get, $.state.set, $.ui.close,
  $.ui.copy, $.ui.open, $.ui.resolve, $.ui.toast`; env reads: `CLAUDE_CODE_AUTO_COMPACT_WINDOW, HOME, KANON_CTX_WARN`; env writes: nic.
- `tsc -p .` strict (TypeScript 6.0.3 z `stelmach/wishlist/node_modules`): czysto. `tsconfig.json` rozszerza ten, który silnik kładzie
  w `.claude-plugin/types/` przy ładowaniu (gitignored); `validate`/`test` go nie kładą — przed załadowaniem skopiuj z innej kopii dev-mods.
- `claude plugin test .`: 24 testy zielone na CLI 2.1.302 i desktop 2.1.299 (`tests/sztafeta.test.ts`): pasek po kompaktacji (agent,
  `precompute` i zawetowana `skip` nie liczą się), po 8 h (z `startedAt` i z zegara, timer co 5 min), przy WARN (tura agenta nie liczy się),
  brak w świeżej sesji i po `/clear`; parser na syntetycznym
  pliku ≥ 300 KB i `godzinaZ` (data, „Z”, czas trwania to nie godzina); brief z „dalej”/„decyzje”, z dopisku bez podsekcji, bez sekcji;
  skrót bez i z przycięciem (≤ 8 KB, adnotacja, granica 8191/8192 B); klik → `start_session` z briefem (terminal i desktop); zapas przy
  `deny`, przy `isError` i przy tekście „Error: …”; panel, „Pokaż „dalej””, „Zamknij”;
  brak pliku; plik bez `## Stan`; `fs.read` odmawia (komenda odpowiada tekstem z powodem); łańcuch AbovePrompt (3 testy: dno `ui.render`
  rysuje Text-strażnik → w świeżej sesji sam, po kompaktacji POD linią paska w kolumnie `flexDirection`, przy `maxRows` 1 pasek sam; dno
  rdzenia = pusty Box bez dzieci; dno rzuca → pasek zostaje). Fixtures (`tests/fixtures.ts`) są syntetyczne —
  kształt realnych plików, bez treści sesji.
- Sonda parsera na 51 realnych plikach `~/.claude/kanon/stan/*.md` (transpilowany `register.tsx`, tylko liczby na wyjściu, 2026-10-17):
  45 z sekcją `## Stan`, 46 z blokiem kompaktacji, 32 briefy z „dalej” i 32 z „decyzje”, 23 skróty przycięte, największy skrót
  8192 B (limit 8192), 4 nagłówki bez godziny (→ mtime).

## Recenzja (sceptyk, 1 runda, 2026-10-17)

Twierdzenia (validate, testy, tsc, bramki, parser) nieobalone; 10 mutacji na kopii: 6 złapanych, 4 przeżyte → dopisane testy (`skip`,
`turn.complete` agenta, `isError` bez prefiksu / prefiks bez `isError`, granica 8192 B). Wdrożone: hook `session.end` (`/clear`, `resume`
zerują liczniki), `godzinaZ` kotwiczone do daty (+ „Z” w strefie silnika), zapas przy błędzie zapisu skrótu, README (różnica wobec
hooka, wznowienie, odstępstwo od §3.1). Otwarte: próba na żywo (patrz wyżej).
v0.1.1 (2026-10-17): `recenzent` [S5.5HI], 1 runda: 0 🔴, 5 🟡 — wszystkie wdrożone (strażnik `maxRows ≥ 2`, testy pustego Box, rzucającego
dna i kolumny; `.gitignore` dotyczył kanon-pasek-budzetu).

## Wycofanie

Usunąć folder z `CLAUDE_CODE_PLUGIN_DIRS` / dev-mods; mod nie zostawia nic poza `<session_id>-skrot.md` w `~/.claude/kanon/stan/`
(do skasowania ręcznie) i stanem w `$.state` sesji.
