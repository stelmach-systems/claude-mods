# kanon-brief — formularz ram polecenia na start (`/brief`, v0.1)

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.299, testy zielone na desktop 2.1.299 i CLI 2.1.289).
Plan: `claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md` §3.2. Z logów 42 transkryptów: 23 z 74 poleceń poniżej 80 znaków,
6 z 17 startów nazywa repo, 9 dopytań `AskUserQuestion` i 7 odpowiedzi „numerami” w osobnych turach, `ops-recall` 3 razy na 17 startów.
Odpowiednik modu „Prompt Upgrade” z filmu O'Briena, ale bez modelu: formularz jest deterministyczny i darmowy.

- **`/brief [tekst]`**: panel z formularzem — Polecenie (tekst z argumentu komendy), Repo/folder (domyślnie `cwd` sesji, pod nim
  przyciski podkatalogów pierwszego poziomu: bez ukrytych i `node_modules`, posortowane, 12 przycisków, reszta jako „+N więcej —
  wpisz ścieżkę”; dowiązanie symboliczne ma `kind: 'other'` i przycisku nie dostaje), Stawka `niska / istotna / wysoka` (wysoka
  dopisuje „analizę oddziel od mutacji, zgoda na każdy zapis”), Tryb `sam / subagent / workflow`, „Gotowe, gdy”, Recall
  (`[ ] najpierw /ops-recall`), Granice (`bez zapisu na produkcję`, `bez PII do gita`, `bez pusha`). Drugie naciśnięcie radia zdejmuje wybór.
- **Uruchom**: wymaga tekstu polecenia (same ramy — repo domyślnie = cwd — to nie zadanie; toast). Składa polecenie = tekst + blok
  „Ramy:” tylko z wypełnionych pól, zapisuje pamięć folderu, zamyka panel (panel z fokusem trzyma klawiaturę) i wkłada tekst do pola
  promptu (`$.prompt.fill`, tryb `replace` — kasuje szkic w polu) — Enter naciska właściciel. Odmowa `no_composer` (powierzchnia bez
  pola promptu: headless albo rysująca własny composer) → od razu schowek i toast „wklej”; `dialog` albo przyczyna nieznana → panel
  wraca wypełniony, toast kieruje do „Kopiuj”. Błąd w trakcie (np. `$.ui.close` odrzucone) → toast z błędem, panel wraca, jeśli zdążył
  się zamknąć.
- **Kopiuj**: to samo polecenie do schowka (`$.ui.copy`); pole promptu nietknięte, panel zostaje.
- **Pomiń**: zamyka panel bez dotykania pola promptu i bez zapisu pamięci. Esc robi to samo.
- **Toast tury 1**: przy pierwszym poleceniu sesji (`$.session.turns()` = 0), krótszym niż 200 znaków, wpisanym przez osobę:
  „Krótkie polecenie na start — /brief doda repo, stawkę i kryterium „gotowe””. Raz na sesję (flaga w `$.state`); polecenie przechodzi
  niezmienione — `prompt.submit` tylko obserwuje (decyzja właściciela 2026-10-16; `{ drop }` i przechwycenie Enter dopiero w v0.2, po
  dwóch tygodniach użycia). Bez toastu: komenda slash, `isMeta`, sesja wznowiona (turns > 0), polecenie pluginu, peera, notyfikacji
  zadania, harmonogramu, kanału (lista wykluczeń `NIE_OSOBA`), a także po `/brief` w tej sesji — więc i dla polecenia, które mod sam
  złożył (krótkie z ramami bywa poniżej 200 znaków).
- **Pamięć per folder**: `$.store` klucz `brief:<cwd>` → `{ repo, stawka, tryb, recall, granice }`; następny `/brief` w tym folderze
  wypełnia formularz tymi polami (puste repo z pamięci → cwd). `/brief wyczysc` (też `wyczyść`) kasuje wpis bieżącego folderu
  i zamyka formularz (otwarty zapisałby wpis z powrotem przy „Uruchom”); `/brief zamknij` zamyka panel. Wpis spoza wzorca (ręczna
  edycja pliku store) — pola nieznane pominięte, formularz działa.
- **Pola tekstowe**: każdy klawisz idzie do szkicu w zmiennej modułu (bez przerysowania panelu), Enter w polu zapisuje do `$.state`
  i odświeża podgląd `ramy:`; przyciski czytają szkic nad stanem, więc tekst bez Entera też trafia do polecenia. Przeładowanie modu
  gubi tylko szkice.

## Przykład złożonego polecenia

```
napraw test brief.test.ts

Ramy:
- Repo/folder: /Users/ksdevit/Developer/claude-mods/kanon-brief
- Stawka: wysoka — analizę oddziel od mutacji, zgoda na każdy zapis
- Tryb: sam
- Gotowe, gdy: claude plugin test . zielone na obu binarkach
- Recall: najpierw /ops-recall
- Granice: bez zapisu na produkcję, bez pusha
```

Sam tekst bez zaznaczeń → polecenie bez bloku „Ramy:”; same ramy bez tekstu → sam blok.

## Odstępstwa od planu §3.2 (do decyzji właściciela)

- Pamięć folderu bez tekstu polecenia i bez „gotowe, gdy” — to treść zadania, nie folderu (dane modów bez treści rozmów). Plan mówił
  o „ostatnich wartościach pól”.
- Origin polecenia: lista wykluczeń (`NIE_OSOBA`) zamiast listy osób. Typy 2.1.299 wymieniają `composer`, `bridge`, `sdk`, `unclassified`…,
  a transkrypty desktopu (2.1.299) stemplują polecenie osoby jako `"kind":"human"`, którego w typach nie ma; nowy albo niestemplowany origin
  liczy się jak osoba (toast u nikogo nie szkodzi, brak toastu u osoby psuje sens modu).
- Aplikacja mobilna: jej tabela elementów nie ma `Input` → zamiast formularza jedna linia z wyjaśnieniem (desktop albo terminal).

## Sprawdzone na żywo (binarka desktop 2.1.299 w terminalu, `--plugin-dir`, 2026-10-16/17)

1. `/brief napraw test` → panel jako kolumna boczna ~50 znaków (zrzut niżej). Pierwszy rysunek ucinał wiersz „Granice:” do „G” i gubił
   trzeci przełącznik, a `gap` dokładał pusty wiersz między zawiniętymi rzędami podkatalogów → wiersze mają `flexWrap="wrap"` i `columnGap`.
   Etykietę `Gotowe, gdy` wąski panel łamie na dwie linie (rysuje to `Input` silnika).
2. Sonda (osobny mod w scratchpadzie, nie w repo; `$.ui.log` przy `prompt.submit`): pierwsze polecenie sesji → `turns=0`,
   `origin={"kind":"composer"}`, `wait=false`, `command` i `isMeta` undefined — warunki toastu zachodzą. Toast narysowany (zrzut niżej).
3. Edycja pliku modu → `kanon-brief: reloaded (4 hooks: session.start, prompt.submit, command.run, ui.render)`, otwarty panel
   przerysowany nowym kodem; silnik położył `.claude-plugin/types/` (z własnym `.gitignore`), więc `tsc -p kanon-brief` działa.

Zrzut panelu (tekst z panelu terminala aplikacji):

```
│Brief — ramy polecenia na start
│Polecenie: napraw test
│Repo/folder: /Users/ksdevit/Developer
│podkatalogi: _kopie BrandSignal
│chase-ai-materialy claude-canon claude-figma
│claude-kanon claude-masterclass-ola claude-mods
│claude-mods-stabilne claude-remotion clients
│cv-2026
│Stawka: ( ) niska ( ) istotna ( ) wysoka
│Tryb: ( ) sam ( ) subagent ( ) workflow
│Gotowe,    kryterium sprawdzalne komendą albo w …
│gdy:
│[ ] najpierw /ops-recall
│Granice: [ ] bez zapisu na produkcję
│[ ] bez PII do gita [ ] bez pusha
│[ Uruchom ] [ Kopiuj ] [ Pomiń ]
│ramy: Repo/folder: /Users/ksdevit/Developer
```

Zrzut toastu (po `claude … "odpowiedz jednym slowem: tak"` jako pierwszym poleceniu sesji):

```
╭──────────────────────────────────────────╮
│ kanon-brief                              │
│ Krótkie polecenie na start — /brief doda │
│  repo, stawkę i kryterium „gotowe”       │
╰──────────────────────────────────────────╯
```

## Niesprawdzone

- Sesja desktop: kopia w `~/.claude/dev-mods/<session_id>/kanon-brief/` czeka na zgodę właściciela na hot reload (pytanie przy końcu
  tury). Do zobaczenia tam: rysunek `Pane` na desktopie, `$.prompt.fill` po zamknięciu panelu z fokusem (w kicie: tak), schowek
  `$.ui.copy`, naciśnięcia przycisków i zapis `$.store` po „Uruchom” (w kicie: tak; w terminalu panelu model nie wciska klawiszy).
- Origin polecenia osoby na desktopie (`human` z transkryptów) — lista wykluczeń przepuszcza go bez sprawdzenia na żywo; sonda
  `sonda-brief` w `dev-mods` tej sesji zapisuje do swojego `$.store`, co hook widzi przy kolejnych poleceniach właściciela.
- Czy `$.prompt.fill` działa na desktopie: typy opisują `no_composer` jako „a surface that draws its own composer” — jeśli to desktop,
  „Uruchom” kończy się schowkiem (toast mówi, że trzeba wkleić), a głównym przyciskiem desktopu jest w praktyce „Kopiuj”.

## Bramki

Zero `$.model`, `$.http`, `$.process`, `$.fs.write`, bez `tool.check`; `$.fs.list` czyta tylko nazwy wpisów `cwd`. Jedyny stan między
sesjami: `$.store` `brief:<cwd>` bez tekstu polecenia i bez „gotowe”. Hooki `session.start` i `prompt.submit`: try/catch w środku
i `.catch` → `next(e)` (fail-open — błąd modu nie zatrzymuje polecenia ani startu sesji); `command.run` odpowiada za własną komendę
bez `next` i ma try/catch (błąd = tekst `Brief: błąd modu — …` w odpowiedzi komendy; walidator i tak wypisuje go jako `gating hook
without .catch` — fakt, nie ostrzeżenie). Mod nie pisze plików i nie wysyła nic poza sesję.

Linie walidatora (`claude plugin validate`, 2.1.299):

```
hooks: session.start, prompt.submit, command.run{command=brief}, ui.render{component=Pane, requestId=brief}
gating hook with .catch: prompt.submit
gating hook without .catch: command.run{command=brief}
calls: $.command.register, $.fs.list (via otworz), $.prompt.fill (via uruchom), $.session.cwd, $.session.turns, $.state.get, $.state.set, $.store.delete, $.store.get (via otworz), $.store.set (via zapamietaj), $.ui.close, $.ui.copy (via kopiuj, uruchom), $.ui.open (via otworzPanel), $.ui.resolve, $.ui.toast
state writes: kanon-brief.cwd, kanon-brief.podkatalogi, kanon-brief.polecenie, kanon-brief.ramy, kanon-brief.toast
```

## Testy

`claude plugin test .` — 25 testów, zielone na desktop 2.1.299 i CLI 2.1.289 (silnik odegrany hookami testu: store jako Mapa,
`cwd`/`turns`, `fs.list`, `ui.*`, `prompt.fill`; brzmienia ze spec jako literały w asercjach): `zloz()` (tylko wypełnione pola, sam
tekst, sam blok, nic, białe znaki); toast raz w turze 1 i cisza przy drugim krótkim, wejście dochodzi do dna bez dopisków; bez
toastu przy ≥ 200 znakach (granica 199/200), komendzie slash i `command`, `isMeta`, pustym tekście, `turns = 3`, originach nie-osoby
(`task-notification`, `plugin`, `peer`, `peer-send-message`, `scheduled-trigger`, `auto-continuation`, `coordinator`, `channel`);
toast dla `human` (spoza typów), `undefined`, `bridge`, `sdk`; brak toastu na poleceniu złożonym przez mod i po `/brief`; formularz na
`terminal` i `desktop` (podkatalogi, złożenie, `prompt.fill` replace, panel zamknięty, dokładna treść wpisu store); Enter w polu →
stan i podgląd, szkic bez Entera wygrywa, wyczyszczenie Enterem zeruje; Kopiuj (schowek z `surface`, prompt nietknięty, pamięć
zapisana, odmowa schowka → toast z powodem); Pomiń (bez fill, bez schowka, bez zapisu); Uruchom bez tekstu → toast, Kopiuj bez
niczego → toast; pamięć per folder, inny folder pusty, puste repo → cwd, `/brief wyczysc` kasuje i zamyka, alias `wyczyść`,
`/brief zamknij`; wpis store spoza wzorca; odmowa `prompt.fill` (panel wraca, toast do „Kopiuj”); `$.ui.close` rzuca (toast z błędem,
bez fill, bez ponownego otwarcia); fail-open (`$.session.turns` rzuca → polecenie przechodzi; `$.session.cwd` rzuca → `/brief`
odpowiada tekstem błędu); `$.fs.list` pada (formularz bez podkatalogów) i panel bez miejsca (`isPlaced: false` → odpowiedź z powodem);
> 12 podkatalogów („+3 więcej”, `node_modules` pominięte); aplikacja mobilna. Type-check: `tsc` 6.0.3 strict (`tsc -p kanon-brief`
po pierwszym załadowaniu modu; wcześniej tsconfig z nagłówka pliku typów skilla, trzymany poza folderem modu).

Luki kitu: `$.prompt.submit` z `$` testu bierze pełne wejście zdarzenia (`wait`, `origin`), które w sesji stempluje silnik — helper
`wpisz` w teście; `refusal` z odpowiedzi hooka `prompt.fill` silnik zdejmuje (typy: „a hook's own refusal carries none”) — gałęzie
`dialog` i `no_composer` poza zasięgiem kitu (testowana gałąź „przyczyna nieznana”); rzucające dno kit zgłasza jako „no implementation
for <noun.method>”, nie treścią błędu.

## Recenzja (recenzent [S5.5HI], 1 runda, 2026-10-17)

Naprawione (🟡): toast odpalał się na poleceniu złożonym przez sam mod → flaga toastu ustawiana przy `/brief`; `uruchom`/`kopiuj`
bez try/catch (odrzucone `$.ui.close`/`$.prompt.fill`/`$.ui.copy` = cisza) → try/catch z toastem, panel wraca; strażnik „nic do
złożenia” martwy przy domyślnym repo = cwd → „Uruchom” wymaga tekstu; `no_composer` → od razu schowek; `.slice(0, 12)` ucinało listę
bez śladu → „+N więcej”, `node_modules` pominięte; testy importowały brzmienia z kodu → literały; brak granicy 199/200, `isMeta`,
`command`, pozostałych originów, fail-open, Entera w polu, pamięci przy Kopiuj, odmowy schowka, `zamknij`, aliasu → dodane (15 → 25).
🟢: surowy kod odmowy w toaście → po polsku; puste repo z pamięci nadpisywało cwd → `zapis.repo || folder`; `wyczysc` przy otwartym
panelu → zamyka panel; mock `refusal` mylił → usunięty.

Zostawione — decyzje właściciela:
1. `$.store` rośnie o wpis (~150 B) na folder bez limitu; limit sklepu 4 MiB ≈ 25 000 folderów. Bez sprzątania w v0.1 (`/brief wyczysc`
   per folder). Jeśli chcieć limitu: liczba kluczy `brief:*` + usuwanie najstarszych (wpis musiałby dostać znacznik czasu).
2. „Pomiń” po `/brief <tekst>` gubi tekst z linii komendy (komenda zjadła prompt). Plan §3.2: „Pomiń → oryginał z powrotem”; zakres
   v0.1 z briefu: „Pomiń bez dotykania promptu” — zostaje v0.1. Alternatywa: Pomiń wkłada sam tekst (bez ram) do pola promptu.
3. `unclassified` (turn bez rozpoznanego pochodzenia, w tym harmonogram i /loop) liczy się jak osoba — toast w nieobserwowanej sesji
   nie szkodzi; do zmiany, gdy sonda pokaże, że desktop stempluje polecenie osoby jako `composer`/`sdk`.
4. Dowiązania symboliczne do repo (`kind: 'other'`) bez przycisku — ścieżkę wpisuje się ręcznie.
Odrzucone: `szkice` jako zmienna modułu nie przeciekają między sesjami — każda sesja to osobny proces `claude` (zmienna modułu = per
proces); `append` zamiast `replace` — tryb `replace` jest w zakresie v0.1, skutek opisany wyżej.

## Uruchomienie i rollback

Próba w jednej sesji: `claude --plugin-dir ~/Developer/claude-mods/kanon-brief` (terminal) albo kopia w `~/.claude/dev-mods/<session_id>/`
(desktop, hot reload za zgodą). Na stałe: `~/Developer/claude-mods-stabilne/kanon-brief` w `env.CLAUDE_CODE_PLUGIN_DIRS`
(`~/.claude/settings.json`, z backupem), od NOWEJ sesji. Rollback: usunięcie ścieżki z env (od nowej sesji); dane modu:
`rm -f ~/.claude/plugins/store/kanon-brief*`.
