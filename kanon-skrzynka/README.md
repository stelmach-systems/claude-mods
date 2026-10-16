# kanon-skrzynka v0.1

Skrzynka nieprzeczytanych raportów i stanów. Na starcie sesji (i co 10 min) liczy, czego właściciel jeszcze nie przeczytał spod
`~/.claude/kanon/`, i rysuje JEDNĄ linię nad promptem tylko wtedy, gdy coś jest:

```
📬 3 do przeczytania: WATCH-10-16 (ROZWAŻ) · USAGE-10-15 (2 dni 19 %) · stan 9f9dcef8 (16.10)   /skrzynka
```

Karta: `~/Developer/claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md` §6.1 (dowód z logów: raporty WATCH z werdyktem
„ROZWAŻ”, USAGE i pliki stanu, których żadna sesja nie czyta). Zero modelu, zero sieci, zero zapisu plików — liczenie jest
deterministyczne i darmowe, a wynik idzie do właściciela, nie do kontekstu modelu.

## Źródła (czytane tylko po nagłówki)

| Źródło | Plik | Co pokazuje | Próg wieku (mtime) |
| --- | --- | --- | --- |
| watch | `watch/WATCH-<data>.md` | słowo po „aktualizacja kanonu” z linii `**WERDYKT: …**` (ROZWAŻ / NIE / TAK); raport bez tej linii → „bez werdyktu” | 14 dni |
| usage | `usage/USAGE-tydzien-<data>.md` | z linii `okno 7 dni od …; koszt-list $X; ostatnie 2 dni $Y = Z%`: koszt, 2 dni i Z; `🔴` gdy Z > 40 | 14 dni |
| stan | `stan/<sid>.md` innych sesji (własny sid z `$.session.id()` pominięty) z sekcją `## Stan` | sid (8 znaków), data mtime i SAMA linia nagłówka ostatniej sekcji `## Stan` | 7 dni |

Treść pliku stanu zawiera nazwy klientów — nie trafia do panelu, paska, `$.store` ani odpowiedzi komendy (test sprawdza to
strażnikiem `TAJNE-SLOWO` w zmyślonym pliku). `$.fs.read` nie czyta fragmentu: cały tekst wchodzi do pamięci modułu na czas
parsowania i wychodzi z niej sam nagłówek.

## Użycie

- `/skrzynka` — skan i panel z listą: `[źródło] nazwa · DD.MM HH:MM · nagłówek`, przy każdej pozycji **Wczytaj** i **Przeczytane**,
  w stopce **Wszystkie przeczytane**, **odśwież** (hotkey `o`), **Zamknij** (Esc). Gdy terminal jest za wąski na panel, odpowiedź
  komendy niesie listę (nagłówki, bez treści).
- **Wczytaj** zamyka panel i wstawia `wczytaj <pełna ścieżka>` do pola promptu (`$.prompt.fill`, tryb replace). Enter naciska
  właściciel — mod nigdy nie wysyła polecenia. Odmowa pola (np. prompt zajęty) → panel wraca, toast z tekstem do wpisania.
- **Przeczytane** / **Wszystkie przeczytane** → `$.store` `skrzynka:<pełna ścieżka>` = `{ kiedy, sid }`. `$.store` jest trwały między
  sesjami (d.ts: „kept between sessions”); czy sesje biegnące równolegle widzą cudze oznaczenie od razu — niesprawdzone. Plik zmieniony
  PO oznaczeniu (mtime > `kiedy`: sesja dopisała sekcję `## Stan`, kanon-watch nadpisał raport dnia) wraca do skrzynki; oznaczenie
  zostaje w store (kasuje je `/skrzynka wyczysc`). Klucze nie są przycinane (v0.1): ~100 B na plik, limit store 4 MiB jest daleko.
- Decyzja D6 (2026-10-17): polecenie `wczytaj <ścieżka pozycji>` zaobserwowane przez `prompt.submit` liczy się jako przeczytane (obok
  przycisku). Obserwator zawsze przepuszcza `next(e)` bez zmian (nigdy `drop`), oznacza bez await (Enter nie czeka na kolejkę skanów)
  i bierze tylko polecenia właściciela: origin `composer` (Enter przy prompcie) albo `bridge` (Remote Control), bez `isMeta` — nie
  notyfikacje, peer, harmonogram, SDK ani inne pluginy. Wzorzec: nazwa pliku pozycji jako koniec członu tuż po „wczytaj” (pełna
  ścieżka, z `~` albo sama nazwa, z `.md` lub bez, przecinek po dozwolony); „wczytaj plan i porównaj z WATCH-…” nie oznacza,
  `<sid>-skrot.md` nie oznacza, `wczytaj A i B` oznacza tylko A. Poza tym promptów nie czyta.
- `/skrzynka wyczysc` kasuje klucze `skrzynka:*` (wszystko wraca do skrzynki), `/skrzynka zamknij` zamyka panel.
- Pasek: nagłówek z liczbą, potem najwyżej 3 pozycje i „+N”, przycięte do szerokości (`bodyColumns` minus 12 komórek na przycisk
  `/skrzynka`); 🔴 idzie na początek paska (sort stabilny; w panelu kolejność watch → usage → stan, każde od najnowszego); milczy przy
  ankiecie (`hasSurvey`) i `maxRows < 1`. Kolor `warning`, gdy któraś pozycja USAGE ma 🔴.
- Pasmo AbovePrompt rysuje JEDEN hook (d.ts: „draws a tree, or passes; one instance”). Skrzynka składa pod swoją linią to, co narysowałby
  plugin niżej w łańcuchu (`next(e)`), bo kanon-pasek-budzetu i kanon-sztafeta rysują własne drzewa bez `next`. Gdy skrzynka jest
  w łańcuchu NIŻEJ niż one, nie narysuje się wcale — kolejność ładowania do sprawdzenia na żywo (Niesprawdzone).

## Odstępstwa od karty §6.1

- Karta: „USAGE — linia 5”. Realne raporty mają w linii 5 „```”, a podsumowanie w linii 6; starsze raporty WATCH (bez oceny LLM)
  mają w linii 5 „## Zmiany” zamiast WERDYKT. Parsery szukają w pierwszych 12 liniach; brak linii → etykieta „bez werdyktu” /
  „bez podsumowania” zamiast pominięcia raportu (raport nadal jest do przeczytania).
- Plik stanu = tylko pełny UUID `<sid>.md`; `<sid>-skrot.md` (zapis kanon-sztafety) i pliki bez sekcji `## Stan` (sam zapis hooka
  kanon-stan) nie są pozycjami.
- Wiek z `mtimeMs` wpisu `$.fs.list` (bez `$.fs.stat`); data WATCH/USAGE z nazwy pliku, data stanu z mtime.
- Oznaczenie „przeczytane” nie jest wieczne: plik zmieniony po oznaczeniu (mtime > `kiedy`) wraca (karta mówi tylko o kluczu
  `skrzynka:<ścieżka>`; bez tej reguły stan żywej sesji z nową sekcją `## Stan` już by nie wrócił).
- D6 zawężone do poleceń właściciela i wzorca „wczytaj <ścieżka kończąca się nazwą pliku>” (karta: „tekst zawiera wczytaj i ścieżkę”).
- Skan ze startu biegnie bez await (pierwszy `session.start` silnik awaituje; zawieszony odczyt nie może wstrzymać sesji) — pasek
  pojawia się po zapisie `$.state`, ułamek sekundy po starcie.
- Na tym Macu pierwszy skan pokaże kilkadziesiąt pozycji (13 WATCH, 3 USAGE i ~30 stanów z ostatnich 7 dni — stan z 2026-10-17):
  „Wszystkie przeczytane” zeruje skrzynkę jednym przyciskiem; zawężenie progów to decyzja właściciela po próbie na żywo.

## Bramki

Z `claude plugin validate .` (2.1.302 i 2.1.299):

```
./register.tsx hooks: session.start, prompt.submit, command.run{command=skrzynka}, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=skrzynka}
./register.tsx answers its own command: command.run{command=skrzynka}
./register.tsx gating hook with .catch: prompt.submit
./register.tsx calls: $.clock.every, $.clock.now (via oznaczTeraz, skanujTeraz), $.command.register, $.env.get (via skanujTeraz), $.fs.list (via listuj), $.fs.read (via czytaj), $.prompt.fill (via wczytaj), $.session.id (via oznaczTeraz, skanujTeraz), $.state.get, $.state.set, $.store.delete, $.store.get (via zmienionyPoOznaczeniu), $.store.keys, $.store.set (via oznaczTeraz), $.ui.close, $.ui.open (via otworzPanel), $.ui.resolve, $.ui.toast (via oznaczToastem, wczytaj)
./register.tsx env writes: nothing
./register.tsx env reads: HOME
./register.tsx state writes: kanon-skrzynka.skrzynka
./register.tsx state reads: kanon-skrzynka.skrzynka
```

- Zero `$.model`, `$.http`, `$.process.*`, `$.fs.write`, `tool.check`. Jedyny stan trwały: `$.store` (klucze `skrzynka:<ścieżka>`,
  wartość `{ kiedy: ISO, sid }`); stan sesji: `$.state` `kanon-skrzynka.skrzynka` (`types/index.d.ts`).
- Każdy hook ma `.catch` (fail-open): błąd modu nie zatrzymuje startu sesji, polecenia ani rysowania; `command.run` odpowiada
  tekstem błędu. Każdy odczyt katalogu/pliku w try/catch: brak katalogu, odmowa, plik > 4 MiB = brak pozycji, bez toasta.
- Dno testów odgrywa odmowy nounów silnika przez `{ deny }` (ENOENT katalogu/pliku, EACCES, `session.id`), nie przez `throw` —
  rzucający hook testu silnik pomija i raportuje jako „skipped”, co nie jest tym samym, co odmowa.
- Skany i oznaczenia idą przez jedną kolejkę modułu, więc skan nie przywróci pozycji oznaczonej w jego trakcie. Jeden timer modułu:
  `session.start` (odpala się też przy enable i respawnie workera) kasuje poprzedni `$.clock.every` przed założeniem nowego.

## Testy

`tests/skrzynka.test.ts` — 18 testów, dysk w pamięci pod `HOME=/tmp/dom-testu` ze ZMYŚLONYMI raportami i wymyślonymi UUID sesji
(bez nazw klientów, bez identyfikatorów realnych sesji):
parsery (werdykt, podsumowanie, nagłówek stanu), `liniaPaska` (3 pozycje + „+N”, przycięcie), skan z trzech źródeł z progami
14/7 dni, własny sid, skrót i plik bez `## Stan` pominięte, panel i pasek bez treści stanu; 🔴 na granicy 40 %; progi wieku na
granicy; „Przeczytane” → store, skan z timera nie przywraca, `wyczysc` przywraca; D6 w `prompt.submit` (pełna ścieżka, `~`, sama
nazwa; polecenie przechodzi niezmienione; bez „wczytaj” nic); „Wczytaj” → fill replace bez store i bez wysłania, odmowa → panel
wraca; D6 negatywy (nazwa dalej w zdaniu, `<sid>-skrot.md`, origin peer/sdk, `isMeta`; `bridge` oznacza); plik zmieniony po
oznaczeniu wraca; „Wszystkie przeczytane” i `zamknij`; brak katalogów → bez paska, bez toastów; przycięcie paska na 66/40 kolumnach,
ankieta i `maxRows 0`; fail-open (EACCES jednego pliku; `$.session.id` odmawia; `$.store.set` odmawia — polecenie przechodzi, przycisk
daje toast); timer 10 min i odpowiedź z listą, gdy panel bez miejsca. Strażnik `TAJNE-SLOWO` w teście głównym obejmuje wszystkie wyjścia:
drzewo paska i panelu, toasty, `prompt.fill`, odpowiedzi komend, wartości `$.store` i każdy zapis `$.state` (hook dna `state.set`).

| Binarka | validate | test | tsc strict |
| --- | --- | --- | --- |
| CLI `~/.local/bin/claude` 2.1.302 | ✔ | 18/18 | ✔ (`node ~/Developer/stelmach/wishlist/node_modules/typescript/bin/tsc -p .`) |
| desktop 2.1.299 (`…/claude.app/Contents/MacOS/claude`) | ✔ | 18/18 | — |

## Recenzja

Jedna runda `recenzent` [S5.5HI] (2026-10-17): 0 🔴, 7 🟡, 2 🔵, 3 ❓ — wszystkie zamknięte w kodzie/testach/README:
- 🟡 🔴 USAGE tonęło w „+N” za WATCH → alarm na początek paska (sort stabilny).
- 🟡 `await skanuj` wstrzymywał `session.start` → skan bez await; 🟡 obserwator `await oznacz` wstrzymywał Enter → bez await.
- 🟡 matcher D6 za luźny (zdanie z nazwą dalej, `-skrot.md`, origin pluginu) → wzorzec „wczytaj <ścieżka…nazwa>”, origin
  `composer`/`bridge`, bez `isMeta`; test negatywów.
- 🟡 AbovePrompt bez `next(e)` zasłaniał pasek budżetu/sztafety → złożenie w kolumnę; kolejność łańcucha do sprawdzenia na żywo.
- 🟡 strażnik treści tylko na panelu/store/liście → wszystkie wyjścia + zapisy `$.state`; 🟡 ścieżka błędu obserwatora nietestowana →
  test z odmową `$.store.set`.
- ❓ oznaczenie wieczne mimo nowych sekcji → reguła mtime > `kiedy`; ❓ timer bez `cancel` przy ponownym `session.start` → jeden timer
  modułu; ❓ „znika w pozostałych sesjach” nieudowodnione → przeniesione do Niesprawdzone.
- 🔵 fikstury z realnymi UUID sesji → wymyślone; 🔵 tytuł testu obiecywał więcej niż asercje → skrócony.

## Sprawdzone na żywo / niesprawdzone

- Niesprawdzone (wymaga sesji desktop z hot-reloadem albo `--plugin-dir`): rysowanie paska i panelu w prawdziwym terminalu,
  `$.prompt.fill` z zamkniętego panelu, hotkey `o`, kolory `warning`/`error`, panel przy kilkudziesięciu pozycjach (`rows` =
  min(14, n + 4); przewijanie dłuższego drzewa jest po stronie silnika — `SiteScroll` w d.ts — ale na żywo niesprawdzone).
- Widoczność oznaczeń między sesjami biegnącymi równolegle (`$.store` trwały, ale czy odświeżany między procesami — nie wiadomo).
- Kolejność łańcucha hooków AbovePrompt (skrzynka vs kanon-pasek-budzetu vs kanon-sztafeta): skrzynka składa `next(e)`, tamte nie.
- Timer `$.clock.every` żyje do reloadu modułu; `session.start` po reloadzie zakłada go od nowa (poprzedni kasowany).

## Uruchomienie i rollback

- Próba: kopia do `~/.claude/dev-mods/<session_id>/kanon-skrzynka/` (hot-reload za zgodą właściciela) albo
  `claude --plugin-dir ~/Developer/claude-mods/kanon-skrzynka`.
- Stabilnie: awans ff-only do `claude-mods-stabilne` i wpis w `CLAUDE_CODE_PLUGIN_DIRS` — decyzja właściciela (README repo).
- Rollback: usunąć wpis z `CLAUDE_CODE_PLUGIN_DIRS` (albo folder z dev-mods); klucze `skrzynka:*` w `$.store` zostają — kasuje je
  `/skrzynka wyczysc` przed wyłączeniem albo zostają bez skutku (nikt ich nie czyta).
