# kanon-na-biegu — sekcja „⚡ Na biegu” w pasku bocznym desktopu

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.299, testy zielone na desktop 2.1.299 i CLI 2.1.289).
Z prośby właściciela (2026-10-16): świeże sesje (ostatnia doba) i nieprzeczytane mają być widać po lewej, zamiast ginąć w głębi listy.

Pasek boczny należy do aplikacji desktop — mod go nie rysuje, tylko przekłada sesje narzędziami MCP `ccd_sidebar` / `ccd_session_mgmt`
(tymi samymi, które ma model). Sekcję tworzy i ustawia właściciel; mod szuka jej po nazwie.

- **Włączenie**: w pasku bocznym grupa o nazwie dokładnie `⚡ Na biegu` (przeciągnięta tam, gdzie ma być). Bez niej mod nic nie robi —
  usunięcie sekcji to wyłącznik.
- **Wkładanie**: start tury w głównej rozmowie (nowa sesja albo wznowiona stara; tura subagenta się nie liczy) → sesja przenosi samą
  siebie (`self`) do sekcji i zapisuje w `$.store`, z której grupy przyszła (`null` = Ungrouped). Nie rusza: przypiętej (przeniesienie
  do grupy zdjęłoby pin), już będącej w sekcji, ani takiej, która ma wpis z bieżącego okresu aktywności — czyli sesji, którą właściciel
  ręcznie wyjął z sekcji, mod ponownie nie wkłada, dopóki pracuje. Każda tura odświeża czas wpisu; okres kończy doba bez tury — wtedy
  wznowiona sesja wraca do sekcji (z jej obecną grupą jako grupą pochodzenia).
- **Grupy nieznane**: gdy okno aplikacji nie zgłosiło jeszcze grup (`get_session` bez klucza `group` — opis narzędzia: „unknown, not
  ungrouped”), mod w tej turze nic nie przekłada ani nie zapisuje.
- **Sprzątanie**: przy starcie tury, najwyżej co 15 min na sesję (pierwsza tura po starcie lub przeładowaniu modu — od razu): sesje
  z sekcji bezczynne > 24 h (`lastActivityAt`) wracają do grupy pochodzenia; bez wpisu (np. wrzucone do sekcji ręcznie) albo gdy
  tamtej grupy już nie ma — do Ungrouped. Przypięte i bieżąca sesja zostają. Wpisy sesji spoza sekcji (wyjęte, zarchiwizowane,
  usunięte) po dobie bezczynności idą do kosza. Wpisy sesji, które wróciły, znikają zaraz po ich ruchu; nieudany ruch zostawia wpis
  (z grupą pochodzenia) do następnej próby. Sprzątanie czyta najwyżej 100 sesji z sekcji — przy pełnej liście wpisów spoza niej nie rusza.
- **`/na-biegu`**: stan tej sesji (w sekcji / poza / przypięta), sprzątanie teraz z liczbą odłożonych, ostatnia akcja i ostatni błąd w tle.
- **Czas tury**: praca modu przy starcie tury czeka najwyżej 3 s (pasek to lokalne IPC aplikacji, milisekundy); dłuższa kończy się w tle.
  Błąd w tle → jedna szara linia `Na biegu: …` w transkrypcie (powtórki tylko w `/na-biegu`).

## Czego mod nie umie

- **„Nieprzeczytane”**: narzędzia `ccd_sidebar` niebieską kropkę tylko ustawiają (`set_unread`), nie podają. Zastępczo sesja zostaje
  w sekcji dobę od ostatniej aktywności, więc nieprzeczytany wynik z ostatniej doby w niej jest.
- **Sesje bez modu** same się nie wkładają: mod działa w sesji, która go ładuje (po wpisie do `CLAUDE_CODE_PLUGIN_DIRS` — każda nowa).
  Sprzątanie obejmuje całą sekcję, także sesje bez modu.
- **Sprzątanie bez tur**: gdy żadna sesja z modem nie zaczyna tury, nic się nie przekłada — przeterminowane czekają do najbliższej tury.
- **Terminal / bez aplikacji desktop**: narzędzi `ccd_*` nie ma → jedna linia błędu, tura idzie dalej.
- **Grupa pochodzenia** sesji wrzuconej do sekcji ręcznie jest nieznana — wraca do Ungrouped (na żywo 2026-10-16: „Notyfikacje
  monitorowania aktywności sklepu” — tak było).

## Zgoda na przeniesienia (decyzja właściciela 2026-10-16, wariant A)

W trybie auto silnik daje `move_sessions` wywołane przez mod klasyfikatorowi, który wywołań spoza transkryptu nie ocenia
(„server-side auto mode classifier gave no verdict” → odmowa). Mod ma więc hook `tool.check` na `mcp__ccd_sidebar__move_sessions`:
przepuszcza („ask” → „allow”) WYŁĄCZNIE wywołania, które silnik przypisał temu modowi (`next.origin.plugin === 'kanon-na-biegu'` — pole
ustawia silnik, nie wołający). Bez zmian zostają: werdykt „deny” z reguł właściciela, sufit organizacji (`e.ceiling`), wywołania modelu
i innych pluginów (test: dostają werdykt silnika). Hook, który się wysypie, silnik pomija (docs `reference.md`: „gating hook … skipped”) —
zostaje werdykt silnika, czyli odmowa, nie zgoda. Walidator wypisuje go jako `gating hook without .catch` — to fakt, nie ostrzeżenie.

## Sprawdzone na żywo (desktop 2.1.299, tryb auto, 2026-10-16)

1. `list_sessions` bez filtra (setki sesji, ~90 tys. znaków) silnik podmienia na tekst „Error: result … exceeds maximum allowed tokens”
   z `isError: false` → mod czyta tylko sekcję (`group`), a `wolaj` traktuje prefiks `Error` jako błąd.
2. Ruch bez hooka `tool.check` → odmowa klasyfikatora; z hookiem, ze startu tury → origin `{plugin: kanon-na-biegu}`, werdykt silnika
   `ask` → `allow`, ruch wykonany.
3. Wywołanie z callbacku `$.clock` (timer) omija hook `tool.check` modu i dostaje odmowę („the request that produced this action did not
   ask for one”) → mod nie ma timerów; sprzątanie przy starcie tury.
4. Po przebudowie: przy starcie tury „Flota” i „Notyfikacje…” (bezczynne od 2026-10-11) wróciły do Ungrouped; bieżąca sesja i dwie
   aktywne zostały w sekcji.
5. `$.ui.log` w sesji desktop nie trafia do pliku transkryptu (diagnostyka na żywo szła sondą `$.fs.write` w kopii dev, nie w repo).

## Bramki

Zero `$.model`, `$.http`, `$.fs`, `$.process`; `tool.check` tylko na `move_sessions` i tylko dla własnych wywołań. W `$.store` wyłącznie
`na-biegu:<id sesji>` → `{ origin: <id grupy> | null, at: <ms ostatniej tury> }` — bez tytułów, `cwd` i treści rozmów (test). Mod nie tworzy, nie
usuwa ani nie zmienia nazw sekcji; nie archiwizuje sesji, nie zmienia pinów ani kropek.

Linie walidatora (`claude plugin validate`, 2.1.299):

```
hooks: session.start, turn.start, tool.check{tool=mcp__ccd_sidebar__move_sessions}, command.run{command=na-biegu}
answers its own command: command.run{command=na-biegu}
gating hook without .catch: tool.check{tool=mcp__ccd_sidebar__move_sessions}
calls: $.clock.now (via naTurze, sprzataj, wloz, zanotuj), $.clock.sleep, $.command.register, $.mcp.call (via wolaj), $.store.delete (via sprzataj), $.store.get (via sprzataj, wloz), $.store.keys (via sprzataj), $.store.set (via wloz), $.ui.log (via zapiszBlad)
```

## Testy

`claude plugin test .` — 18 testów, zielone na desktop 2.1.299 i CLI 2.1.289 (pasek i serwery `ccd_*` zamockowane w teście, łącznie
z limitem wyniku `list_sessions`): nowa i wznowiona sesja, przypięta, wyjęta ręcznie (pracuje 40 h — nie wraca; po dobie bez tury —
wraca; wraca też bez sprzątania w międzyczasie), grupy niezgłoszone, tura subagenta, brak sekcji, brak desktopu, odmowa ruchu,
sprzątanie (grupa pochodzenia / Ungrouped / grupa usunięta / przypięta / świeża / wpisy do kosza), odmowa przy drugim celu, lista
ucięta limitem, nieudany powrót, store bez treści, werdykt silnika dla wywołań spoza modu, `zgoda()` we wszystkich gałęziach (origin
modu / inny / brak, „ask” / „deny”, sufit), sprzątanie co 15 min przy turze bez ruszania bieżącej sesji. Mutacje na kopii (każda łapana
przez ≥ 1 test): bez filtra `group`, bez pomijania bieżącej sesji, bez dławika 15 min, sprzątanie w turze subagenta, wpis bez
sprawdzania wieku, bez odświeżania wpisu, kasowanie wpisów dopiero po wszystkich ruchach, nieznane grupy jak Ungrouped, bez strażnika
limitu, `zgoda()` bez origin / bez sufitu / zamieniająca „deny”, hook ze stałym originem. Bez pokrycia w kicie: czy hook woła `zgoda()`
dla własnych wywołań — własne `$.mcp.call` modu w kicie nie przechodzi przez `tool.check`, a `$` testu ma origin silnika; ta gałąź
sprawdzona na żywo (pkt 2 i 4 wyżej). Type-check: `tsc` 7.0.2 strict (tsconfig modu rozszerza ten, który silnik kładzie w `.claude-plugin/types/`).

## Recenzja (sceptyk [OP5.5HI], 2 rundy, 2026-10-16)

Runda 1 — naprawione: 🔴 sesja wyjęta ręcznie i wznowiona po > dobie nie wracała do sekcji (wpis bez sprawdzania wieku, a sprzątanie
pomija bieżącą sesję) → wiek wpisu + odświeżanie co turę; 🟡 odmowa przy drugim celu sprzątania zostawiała wpisy sesji, które już
wróciły → kasowanie zaraz po ruchu; 🟡 brak klucza `group` brany za Ungrouped (gubił grupę pochodzenia) → mod czeka; 🟡 gałęzie
allow / deny / sufit bez testu → `zgoda()` z testem wszystkich gałęzi; 🟢 lista ucięta limitem kasowała wpisy → strażnik limitu.
Runda 2: wszystkie zamknięte (scenariusze rundy 1 na nowym kodzie, 10 mutantów łapanych; `hook_passthru` przeżywa — luka kitu jak wyżej).

Znane ograniczenie (🟢 z rundy 2, wyścig, symulowany kitem): gdy sprzątanie innej sesji przenosi sesję X z sekcji w tej samej
milisekundowej chwili, w której X odświeża swój wpis przy starcie tury, wpis X wraca — X zostaje poza sekcją do doby bez tury
(przeciągnięcie ręczne naprawia od razu). Okno: odczyt → zapis wpisu w X (ms) × sprzątanie innej sesji najwyżej co 15 min.

## Uruchomienie i rollback

Próba w jednej sesji: kopia w `~/.claude/dev-mods/<session_id>/` (desktop, hot reload) albo `claude --plugin-dir …/kanon-na-biegu`.
Na stałe: `~/Developer/claude-mods-stabilne/kanon-na-biegu` w `env.CLAUDE_CODE_PLUGIN_DIRS` (z backupem), od NOWEJ sesji.
Rollback: usunięcie ścieżki z env (od nowej sesji) albo od razu — usunięcie sekcji `⚡ Na biegu` (aplikacja przenosi jej sesje do
Ungrouped i nic nie kasuje — opis `delete_section`); dane modu: `rm -f ~/.claude/plugins/store/kanon-na-biegu*`.
