# kanon-warsztat v0.1

Warsztat modów: dwie rzeczy dla sesji, która pisze mod.

(a) Narzędzie `mcp__kanon-warsztat__szukaj { nazwa }` — JSDoc i sygnatura z lokalnego `claude-code/index.d.ts` po nazwie zdarzenia
(`tool.call`), metody (`$.fs.list` albo `fs.list`), rzeczownika (`$.fs` → lista składników) albo typu (`SessionUsage`). Zamiast grepa po
16 tys. linii d.ts: wynik ≤ 2048 znaków, wiele trafień → lista nazw z numerami linii.

(b) `/warsztat [katalog modu]` — dla katalogu modu kolejno `claude plugin validate .` i `claude plugin test .` na CLI `~/.local/bin/claude`
i na najnowszej binarce desktopu oraz `tsc --noEmit -p .`; panel z tabelą binarka × krok → OK / FAIL / TIMEOUT / brak, czas i liczba
testów; przyciski **Powtórz** i **Kopiuj błędy**.

Karta: `~/Developer/claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md` §6.2. Zero modelu, zero sieci, zero zapisu plików,
zero `tool.check`; jedyny stan — `$.state` (indeks i wynik ostatniego biegu). `$.process.run` tylko z zamkniętej listy argv (niżej),
bez shella, zawsze z `timeoutMs`, `cwd` wyłącznie w `~/Developer/claude-mods`, `~/Developer/claude-mods-stabilne` albo pod
`$.session.root()` (reguła D5 z README repo; rozszerzenie o `-stabilne` — patrz Odstępstwa).

## Skąd d.ts

1. `<$.plugin.root>/.claude-plugin/types/claude-code/index.d.ts` — silnik kładzie go przy pierwszym załadowaniu modu (plugin-authoring:
   „holds the same for the editor”). To jest źródło w normalnej pracy.
2. Gdy go tam nie ma (mod uruchomiony z `--plugin-dir` przed położeniem typów): najnowszy wg mtime spośród
   `~/.claude/dev-mods/<sid>/<mod>/.claude-plugin/types/claude-code/index.d.ts` i `~/Developer/claude-mods/<mod>/.claude-plugin/types/claude-code/index.d.ts`.
3. Nic → odpowiedź narzędzia z `isError` i opisem (bez wyjątku); następne wywołanie szuka od nowa.

Indeks (`zbudujIndeks`) powstaje przy pierwszym wywołaniu `szukaj` z jednego `$.fs.read` (cały plik w pamięci modułu), raz na życie modułu;
równoległe wywołania dołączają do trwającego ładowania. Wpisy idą do `$.state` `kanon-warsztat.indeks` razem z wersją parsera
(`WERSJA_INDEKSU`), ścieżką, mtime i liczbą linii — po reloadzie modułu (ta sama wersja, ten sam plik, ten sam mtime) tekst jest czytany
ponownie, ale nie parsowany; inna wersja parsera (po zmianie regexów) = budowa od nowa. Nagłówek odpowiedzi podaje źródło i linie
(`tool.call — zdarzenie (EngineEventOf — wejście hooka `e`; linie 4030–4030 w …/index.d.ts)`).

Co indeks obejmuje (regexy na wcięciu, bez parsera TS): deklaracje top-level `export type|interface|const|function|class` obu modułów
(`claude-code`, `claude-code/testing`), także „płaskie” (kontynuacja na tym samym wcięciu, np. `NextResultFor` — domykane po `;`/`}`,
kolejna deklaracja albo komentarz kończy wpis); zdarzenia `'a.b': …` w blokach `EngineEventOf` (wejście hooka `e`), `EngineResultOf`
(wynik hooka), `OpEventOf` (argument wywołania `$`), `OpValueOf` (wartość wywołania `$`), `ChunkOf` (porcja strumienia); rzeczowniki `$.x`
i metody `$.x.y` z `CoreEngineInterface`. Poza indeksem: blok `global {}` (`h`, `crypto`, `performance` — nie API `$`) i pola zwykłych typów
(np. `rows` w `UiOpenArgs`) — do nich prowadzi wynik dla typu. JSDoc to blok komentarza bezpośrednio nad deklaracją; sygnatura bez
komentarzy wewnętrznych, z usuniętym wspólnym wcięciem.

Na prawdziwym d.ts tej sesji (2.1.299, 16 467 linii) skrypt `skrypty/sanity-dts.ts` (Node 22 `--experimental-strip-types`, czysta część
modułu bez silnika; nie jest testem kitu, bo kit nie ma dysku) daje 2026-10-17: 956 wpisów — 220 zdarzeń, 84 metody, 21 rzeczowników,
631 typów; budowa 8 ms; wpisy w `$.state` ≈ 99 KB JSON — i sprawdza kotwice: `tool.call` jako zdarzenie z JSDoc, `fs.list` jako metodę,
`$.process` ze składnikiem `$.process.run`, `$.fs.stat`, `SessionUsage` ze `startedAt`, `NextResultFor` w całości, `ToolCall` jako listę,
każdy wpis `do ≥ od` i < 1500 linii.

```
node --experimental-strip-types --no-warnings skrypty/sanity-dts.ts [ścieżka d.ts]      # --pokaz drukuje 4 odpowiedzi
```

## Użycie

- `szukaj { nazwa }` (narzędzie modelu; zarejestrowane w `session.start`, dostępne przez ToolSearch jak każde narzędzie modu):
  - dokładna nazwa (`tool.call`, `fs.list` = `$.fs.list`, `$.process`, `SessionUsage`) → nagłówek `nazwa — rodzaj (blok; linie a–b w plik)`,
    JSDoc, sygnatura (dla rzeczownika zamiast sygnatury `Składniki: $.process.run (linia 3574), …`), potem `Inne wystąpienia:` — ten sam
    klucz w innych blokach. Kolejność przy kilku wystąpieniach: zdarzenie silnika (`EngineEventOf`) → metoda `$` → rzeczownik → wynik hooka
    → zdarzenia operacji `$` (`OpEventOf`, `OpValueOf`, `ChunkOf`) → typ; dlatego `fs.list` pokazuje metodę `$.fs.list`, a zdarzenie
    `'fs.list'` z `OpEventOf` ląduje w „Inne wystąpienia”. Zapytanie z `$.` i bez daje to samo;
  - wielkość liter nie gra roli, gdy dokładne dopasowanie zawodzi (`sessionusage`);
  - podciąg (`ToolCall`) → `szukaj: N trafień dla „ToolCall” — podaj pełną nazwę:` i lista `- nazwa (rodzaj, linia N)`, najwyżej 40 pozycji
    i `… +N więcej`;
  - brak → `szukaj: brak „x” wśród 956 wpisów …` z przykładami nazw (echo zapytania przycięte do 80 znaków); pusta nazwa → podpowiedź
    (bez `isError`);
  - każda odpowiedź dłuższa niż 2048 znaków (także lista i „brak”) jest przycinana z dopiskiem `… [przycięte do 2048 znaków; …]`;
  - kształt odpowiedzi hooka: `{ result: tekst }` (string). Silnik waliduje `result` wg schematu narzędzia — dla narzędzia
    z `$.tool.register` to `string | bloki treści | undefined`; obiekt MCP `{ content, isError }` odrzuca (`does not match its output
    shape`, próba na żywo 2026-10-17 — v0.1 z commita 747446e tak odpowiadał i narzędzie nie działało). Błąd (brak d.ts, plik
    nieczytelny, wyjątek) → `{ deny: tekst }`: d.ts `ToolCallResult` — „the model receives the text as an error result”.
- `/warsztat` — katalog modu z argumentu (`~`, ścieżka względna od cwd sesji, bezwzględna) albo cwd sesji. Brama (odmowa = tekst komendy,
  bez procesu i bez panelu): ścieżka bez `..`; leksykalnie w `~/Developer/claude-mods`, `~/Developer/claude-mods-stabilne` albo pod
  `$.session.root()` (root pomijany, gdy jest HOME, przodkiem HOME albo `/` — sesja zaczęta w `~` nie otwiera całego dysku); jest
  `.claude-plugin/plugin.json`; `realPath` katalogu (`$.fs.stat(…, { resolve: true })`) też leży w bazach rozwiązanych tak samo —
  dowiązanie `claude-mods/x → /gdzie-indziej` dostaje odmowę, a kroki biegną z `cwd` = ścieżka rozwiązana. Komendę przyjmuje tylko
  od właściciela: origin `composer` (prompt) albo `bridge` (Remote Control); z `sdk`, harmonogramu, powiadomienia zadania, peera itd.
  odpowiada odmową, bo `claude plugin test` wykonuje kod z katalogu. Bieg jest jeden naraz: strażnik ustawiany synchronicznie przed
  pierwszym `await`, więc dwa `/warsztat` albo podwójne **Powtórz** w tej samej chwili dają jeden bieg i `poprzedni bieg jeszcze trwa`.
- Kroki (w tej kolejności, każdy osobnym `$.process.run`, `cwd` = katalog modu, `timeoutMs` 120 000; po timeoucie bieg idzie dalej):
  1. `CLI` validate, 2. `CLI` test, 3. `desktop <wersja>` validate, 4. `desktop <wersja>` test, 5. `tsc`. Binarka desktopu = najwyższy
  semver (liczbowo) spośród `~/Library/Application Support/Claude/claude-code/<wersja>/<hash>/claude.app/Contents/MacOS/claude`, które
  istnieją na dysku — katalog wersji bez binarki jest pomijany. Brak binarki / node / tsc.js → wiersz `brak` bez uruchamiania.
- Panel `Warsztat — <nazwa modu>` (tytuł z `(w toku…)` w trakcie): wiersz na krok `OK|FAIL|TIMEOUT|brak  <binarka> <krok> <czas> <szczegóły>`
  (test: `18 pass, 0 fail`; validate: `Validation passed` / `Validation failed (kod 1)`; tsc: `bez błędów` / `N błędów TS (kod 2)`), stopka
  `N OK · N FAIL · N timeout · N brak · X s łącznie`. **Powtórz** (hotkey `p`) uruchamia ten sam katalog od nowa; **Kopiuj błędy** (`k`)
  kopiuje przez `$.ui.copy` na powierzchni przycisku argv + stdout/stderr kroków FAIL i TIMEOUT; **Zamknij** (Esc). Schowek odmawia → toast
  z powodem. Wyjście padniętych kroków żyje w pamięci modułu (nie w `$.state`, który czyta każdy plugin sesji): do 4000 znaków — 2400
  początku, znacznik `… [przycięte N znaków] …`, 1500 końca; w `$.state` zostaje jednolinijkowe `szczegoly`. Po hot-reloadzie modułu
  **Kopiuj błędy** mówi `wyjście niedostępne — moduł przeładowany po biegu; naciśnij Powtórz`.
- Hot-reload w trakcie biegu: `bieg` modułu startuje od nowa, a `$.state` zostaje z `wToku: true` — `session.start` (i następna komenda)
  oznacza taki stan jako przerwany: kroki `czeka`/`biegnie` → FAIL `przerwano — moduł przeładowany w trakcie biegu`, stopka bez „w toku”.
- `/warsztat wynik` — ta sama tabela tekstem (gdy panel nie ma miejsca: odpowiedź komendy mówi `panel czeka (<powód>) — wynik:
  /warsztat wynik`); `/warsztat zamknij` zamyka panel.

## Odstępstwa od karty §6.2

- Karta: `tsc --noEmit -p .`. Bez shella nie ma PATH, a `node_modules/.bin/tsc` ma shebang `/usr/bin/env node`, więc mod woła
  `<node> ~/Developer/stelmach/wishlist/node_modules/typescript/lib/tsc.js --noEmit -p .`; node = pierwszy istniejący z
  `~/.local/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`. Brak node albo tsc.js → `tsc: brak — …` z powodem.
- Matcher `tool.call` to RegExp `/^mcp__kanon-warsztat__szukaj$/`, nie string: unia nazw narzędzi w `claude-code-mcp/index.d.ts` jest
  zamknięta i nie zna narzędzia, które mod dopiero rejestruje (string nie przechodzi tsc). W teście `$.tool.call` z tego samego powodu
  idzie przez rzutowanie.
- „≤ 2 KB” = 2048 znaków JS (znaki spoza ASCII liczone po jednym); lista podciągów ≤ 40 pozycji.
- Kroki `claude` dostają `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (jak kanon-flota) — validate i test nie potrzebują sieci.
- Katalog modu musi mieć `plugin.json` (karta mówi tylko o cwd) — chroni przed uruchomieniem `claude plugin test` na dowolnym katalogu.
- Komenda tylko z origin `composer`/`bridge` (karta o tym milczy) — jak D6 w kanon-skrzynka.
- Baza `~/Developer/claude-mods-stabilne`: zlecenie mówiło `~/Developer/claude-mods*`, a D5 w README repo wymienia tylko `claude-mods`
  i `$.session.root()`. Zostawione jako jawna nazwa (bez globa); dopisanie do D5 albo wycięcie = decyzja właściciela.

## Bramki

Z `claude plugin validate .` (2.1.302 i 2.1.299, identycznie):

```
./register.tsx hooks: session.start, tool.call{tool=/"^mcp__kanon-warsztat__szukaj$"/}, command.run{command=warsztat}, ui.render{component=Pane, requestId=warsztat}
./register.tsx answers its own command: command.run{command=warsztat}
./register.tsx gating hook with .catch: tool.call{tool=/"^mcp__kanon-warsztat__szukaj$"/}
./register.tsx calls: $.clock.now (via biegnij, uruchom), $.command.register, $.env.get (via plikTypow, uruchom), $.fs.exists (via istnieje), $.fs.list (via wpisyKatalogu), $.fs.read (via zaladujIndeks), $.fs.stat (via plik, realna), $.process.run (via biegnij), $.session.cwd (via uruchom), $.session.root (via uruchom), $.state.get, $.state.set, $.tool.register, $.ui.close, $.ui.copy (via kopiujBledy), $.ui.open (via uruchom), $.ui.resolve, $.ui.toast
./register.tsx env writes: nothing
./register.tsx env reads: HOME
./register.tsx state writes: kanon-warsztat.indeks, kanon-warsztat.warsztat
./register.tsx state reads: kanon-warsztat.indeks, kanon-warsztat.warsztat
```

`$.process.run` — zamknięta lista argv (strażnik `argvDozwolone` sprawdza każde argv tuż przed uruchomieniem; argv spoza listy = wiersz
FAIL `argv poza zamkniętą listą modu — nie uruchomiono` bez procesu; test „strażnik argv” sprawdza oba kierunki):

```
~/.local/bin/claude plugin validate .
~/.local/bin/claude plugin test .
~/Library/Application Support/Claude/claude-code/<semver>/<hash>/claude.app/Contents/MacOS/claude plugin validate .
~/Library/Application Support/Claude/claude-code/<semver>/<hash>/claude.app/Contents/MacOS/claude plugin test .
<node> ~/Developer/stelmach/wishlist/node_modules/typescript/lib/tsc.js --noEmit -p .
   node ∈ { ~/.local/bin/node, /opt/homebrew/bin/node, /usr/local/bin/node }
```

`~` = `HOME` z `$.env.get`; `<semver>` = `\d+.\d+.\d+`, `<hash>` = `[0-9a-f]+` (dokładnie jeden segment każdy, więc `..` nie przejdzie).
Zawsze `{ cwd: <katalog modu rozwiązany>, timeoutMs: 120000 }`, dla `claude` dodatkowo `env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }`
(nakłada się na env hosta). `cwd` przechodzi bramę katalogu (leksykalną i po `realPath`) przed pierwszym krokiem.

- Zero `$.model`, `$.http`, `$.fs.write`, `$.store`, `tool.check`; zapisy tylko do `$.state` (`kanon-warsztat.warsztat`,
  `kanon-warsztat.indeks` — kontrakt w `types/index.d.ts`); wyjścia procesów nie trafiają do `$.state` (pamięć modułu).
- Każdy hook z `.catch` (fail-open): `session.start` przepuszcza `next(e)` (rejestracje komendy i narzędzia osobno — padnięta jedna nie
  wyłącza drugiej, toast mówi, czego brakuje), `tool.call` odpowiada `{ deny: opis }` (błąd narzędzia dla modelu, bez wyjątku),
  `command.run` tekstem błędu, `ui.render` przepuszcza `next(e)`. Odczyty katalogów i plików w try/catch (brak = brak kandydata, bez toasta).
- Odrzucenie `$.process.run` klasyfikowane po czasie i komunikacie (d.ts nie podaje brzmienia): `ENOENT|not found|no such file` → `brak
  binarki: …`; zmierzony czas ≥ 119 s albo `timed out|timeout|SIGKILL|SIGTERM|killed` → `TIMEOUT przekroczone 120 s`; inne → FAIL
  z komunikatem. Realne brzmienie komunikatów silnika — Niesprawdzone.
- Dno testów odgrywa odmowy nounów przez `{ deny }` (jak kanon-skrzynka), proces przez scenariusz `(argv, numer) → ok|fail|timeout|brak|obiekt`.

## Testy

`tests/warsztat.test.ts` — 18 testów (17 wpisów `test(`, jeden z nich w pętli po powierzchniach `terminal`/`desktop`), dysk w pamięci pod
zmyślonym `HOME` z mini-d.ts (34 wpisy, dwa moduły, zdarzenie `'fs.list'` w `OpEventOf` obok metody, długi JSDoc do przycięcia),
zmyślonymi binarkami (CLI, desktop 2.1.295/2.1.299, katalog 2.1.300 bez binarki, 2.1.30 do semver) i dowiązaniami (`link-ok` → katalog
w bazie, `link-poza` → `/tmp/poza/mod`):
indekser (4 bloki zdarzeń, rzeczowniki, metody, typy jedno- i wieloliniowe, JSDoc, oba moduły); `szukaj` (dokładne, symetria `$.`,
metoda przed zdarzeniem Op*, rzeczownik → składniki, wielkość liter, podciąg → lista, brak z echem ≤ 80 znaków, przycięcie do 2048);
narzędzie przez silnik (`session.start` rejestruje komendę i narzędzie, `tool.call` odpowiada tekstem MCP, indeks budowany raz — jeden
odczyt, jeden zapis `$.state`, równoległe `tool.call` dołączają do jednego ładowania); plik typów spoza katalogu (najnowszy mtime),
nieczytelny → `isError`; indeks zastany w `$.state` (ta sama wersja/ścieżka/mtime/linie → bez parsowania; inny mtime albo starsza wersja
parsera → od nowa i zapis); `/warsztat` bez argumentu ×2 powierzchnie (5 argv w kolejności, cwd, timeout, env, panel, `wynik`, `zamknij`);
FAIL (`10 pass, 2 fail`, 2 błędy TS, validate failed, stdout 10 000+ znaków → 2400/1500 ze znacznikiem) + **Kopiuj błędy** tylko
z padniętych kroków na powierzchni przycisku, żaden zapis `$.state` nie niesie wyjścia; schowek odmawia → toast; timeout + brak desktopu
i node; ENOENT, brak tsc.js, semver 2.1.30 < 2.1.299; strażnik argv (18 odrzuconych: shell, inne podkomendy, inne ścieżki, brak
`--noEmit`, `env node`, desktop z `..`); brama katalogu (poza bazami, poza rootem sesji, root = HOME/`/`, `..`, bez plugin.json,
dowiązanie poza bazy → odmowa bez procesu i panelu; `~`, względna, końcowy `/`, repo stabilne, root sesji, dowiązanie do bazy przechodzą
— to ostatnie z `cwd` rozwiązanym; origin `sdk`/`scheduled-trigger`/`task-notification`/`peer` → odmowa, `bridge` przechodzi);
**Powtórz** bez biegu; stan „w toku” bez żywego biegu → „przerwano”; jeden bieg naraz (dwa `/warsztat` w `Promise.all` → jeden bieg)
+ **Powtórz** po końcu + panel bez miejsca.

| Binarka | validate | test | tsc strict |
| --- | --- | --- | --- |
| CLI `~/.local/bin/claude` 2.1.302 | ✔ | 18/18 (1,2 s) | ✔ (`node …/typescript/lib/tsc.js --noEmit -p .`, TS 6.0.3) |
| desktop 2.1.299 (`…/claude.app/Contents/MacOS/claude`) | ✔ | 18/18 (1,2 s) | — |

Czego kit nie pokaże (zegar `mock.clock` stoi, dysku brak): czas kroków (wszędzie 0 s), prawdziwy d.ts (→ `skrypty/sanity-dts.ts`),
ważność `$.process.run`/`$.state` po powrocie hooka `command.run` (→ próba na żywo), kształt wyniku `tool.call` — kit oddaje odpowiedź
hooka bez walidacji wg schematu narzędzia (18/18 przechodziło z obiektem MCP, który silnik odrzuca; wykryte dopiero na żywo). Zapis `$.state` przerysowuje zamontowany panel
„at the redraw rate” (d.ts `ui.render` @remarks), więc test montuje panel po `zegar.settle()`, nie przed.

## Recenzja

Jedna runda `recenzent` [S5.5HI] (2026-10-17): 1 🔴, 11 🟡, 7 🔵, 2 ❓. Naprawione w kodzie/testach:
- 🔴 `if (bieg)` sprawdzane przed pięcioma `await`, `bieg =` dopiero po nich → strażnik synchroniczny (`bieg = moj` przed pierwszym
  `await`, `finally` zeruje tylko własny); test z `Promise.all` dwóch `/warsztat`.
- 🟡 komenda od każdego origin → tylko `composer`/`bridge`; 🟡 brama leksykalna (dowiązanie wyprowadza `cwd` poza bazy) → `realPath`
  katalogu i baz; 🟡 `$.session.root()` = HOME otwierał cały dysk → root pomijany, gdy HOME, przodek HOME albo `/`.
- 🟡 wyjście procesów (do 4000 znaków) w `$.state`, który czyta każdy plugin → pamięć modułu, w stanie tylko `szczegoly`; 🟡 indeks z `$.state`
  bez wersji parsera → `WERSJA_INDEKSU`; 🟡 timeout po regexie `/time|…/` (łapał „runtime”) → czas ≥ limit − 1 s albo węższy regex.
- 🟡 po reloadzie w trakcie biegu `wToku: true` na zawsze → `naprawPrzerwany` w `session.start` i przed komendą; 🟡 `fs.list` trafiało
  w zdarzenie `OpEventOf` zamiast metody → ranking: metoda przed zdarzeniami operacji; 🟡 gałąź „brak” bez `przytnij` i z pełnym echem → echo
  ≤ 80 znaków, `przytnij` wszędzie.
- 🟡 brak pokrycia (a)–(g) → dodane (a) wyścig, (b) równoległe `tool.call`, (c) reużycie indeksu po reloadzie, (d) wyjście > 4000, (e) **Powtórz**
  bez stanu, (g) reload w trakcie biegu; (f) czas kroków — nie, patrz niżej.
- 🔵 trzy typy „płaskie” kończyły się w pierwszej linii → `koniecWpisu` domyka po `;`/`}` (kotwica `NextResultFor` w sanity); 🔵 przykład
  podciągu „Session” trafiał dokładnie w `$.session` → „ToolCall”; 🔵 `przytnijWyjscie` 2500+1500 > 4000 → 2400+1500 ≤ 4000; 🔵 `onPress`
  **Zamknij** bez `.catch` → `void …catch`; 🔵 obie rejestracje w jednym `try` → osobno z toastem; 🔵 asercja `SYMBOL.length` → usunięta;
  🔵 README (liczba testów, puste sekcje, `claude-mods*` jako glob) → ten plik.

Nienaprawione, z uzasadnieniem:
- 🔵 blok `global {}` poza indeksem — trzy deklaracje globalne (`h`, `crypto`, `performance`), nie API `$`; `szukaj` ma odpowiadać o hooki,
  nie o globalia. Do rozważenia przy v0.2, jeśli ktoś o nie zapyta.
- 🟡 test złoty na prawdziwym d.ts w kicie — niemożliwy: kit nie ma dysku (`$.fs` tylko z hooków dna testu, 16 tys. linii nie wchodzi do
  fikstury). Zastąpiony skryptem `skrypty/sanity-dts.ts` (kotwice z recenzji: liczności, `tool.call` 4030, `$.process`, `NextResultFor`),
  uruchamianym ręcznie — nie przez `claude plugin test`.
- 🟡 (f) czas kroków — zegar kitu stoi, a przesuwanie go z wnętrza hooka dna `process.run` (`advance` podczas dispatchu) nie jest
  udokumentowane; czas pokazuje próba na żywo.
- ❓ ważność `$.process.run` i `$.state` z `biegnij` po powrocie hooka `command.run` (bez `await`, do 10 min) — d.ts tego nie opisuje;
  rozstrzyga próba na żywo (sekcja niżej). Gdyby `$` gasło, pierwszy krok padłby z komunikatem silnika w wierszu FAIL.
- ❓ `claude-mods-stabilne` w D5 — decyzja właściciela (Odstępstwa).

## Sprawdzone na żywo / niesprawdzone

- 2026-10-17, sesja 75062a34 (desktop 2.1.299): kopia w `~/.claude/dev-mods/<sid>/kanon-warsztat/` (bez `.claude-plugin/types`), właściciel
  włączył hot-reload ok. 12:08 — mod załadował się bez linii o błędzie w transkrypcie, silnik położył `.claude-plugin/types/` (claude-code,
  claude-code-mcp, claude-code-tools, tsconfig), narzędzie `mcp__kanon-warsztat__szukaj` pojawiło się w ToolSearch z opisem i schematem
  z `$.tool.register`.
- Sprawdzone: `szukaj { nazwa: "tool.call" }` z modelu → silnik odrzucił odpowiedź v0.1 (`tool.call step resolved mcp__kanon-warsztat__szukaj
  with a result that does not match its output shape: expected string | array | undefined, received object`) — hook zwracał `{ result: { content,
  isError } }`. Poprawione na `{ result: tekst }` / `{ deny: tekst }` (commit 2341e22); ponowne wywołanie po przeładowaniu — do dopisania.
- `/warsztat ~/Developer/claude-mods/kanon-skrzynka` uruchomił właściciel z promptu (origin `composer` przeszedł — komenda nie odmówiła).
  Panel i wynik widzi tylko właściciel: sesja nie czyta własnego terminala ani `$.state` modu, odpowiedź komendy nie trafia do transkryptu,
  procesy `plugin validate/test` nie zostawiają plików. Relacja właściciela (wiersze OK/FAIL, czasy) — do dopisania.
- Niesprawdzone do czasu relacji: rysowanie panelu w prawdziwym terminalu (kolory `warning`/`error`, hotkeye `p`/`k`, Esc), `$.ui.copy` na
  żywo, ważność `$` po powrocie hooka (❓ wyżej), realne komunikaty odrzucenia `$.process.run` (ENOENT/timeout), czas kroków, kształt
  wyniku `szukaj` w odpowiedzi narzędzia, `realPath` na prawdziwym dysku (macOS: `/tmp` → `/private/tmp` — bazy też są rozwiązywane,
  więc różnica prefiksu nie powinna odrzucać), zachowanie `$.state` i panelu po prawdziwym hot-reloadzie w trakcie biegu.

## Uruchomienie i rollback

- Próba: kopia do `~/.claude/dev-mods/<session_id>/kanon-warsztat/` (hot-reload za zgodą właściciela) albo
  `claude --plugin-dir ~/Developer/claude-mods/kanon-warsztat`. `.claude-plugin/types/` jest w `.gitignore` — silnik kładzie je sam.
- Stabilnie: awans ff-only do `claude-mods-stabilne` i wpis w `CLAUDE_CODE_PLUGIN_DIRS` — decyzja właściciela (README repo).
- Rollback: usunąć wpis z `CLAUDE_CODE_PLUGIN_DIRS` (albo folder z dev-mods). Mod nie zostawia nic poza `$.state` sesji — po restarcie
  nie ma śladu.
