# kanon-flota — pane „flota sesji”

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.295, testy zielone na desktop 2.1.295 i CLI 2.1.289).
Z briefu modu (2026-10-11, opcja B). `/flota` otwiera pane z WSZYSTKIMI żywymi sesjami
Claude Code na tym Macu — także desktopowymi i tymi bez modu.

```
ping ● pracuje 2 min · api-serwis · ctx 41% · $3.12 · ↓0 ↑1 · Migracja bazy
ping ◐ czeka na Ciebie (input needed) od ≥ 4 min · raporty · bez modu · Raport kwartalny etap 2
ping ○ bezczynna od 1 h 12 min · strona-www · bez modu · Poprawki formularza zgłoszeń
 ta  ● pracuje ≥ 0 s · mody · ctx 22% · $4.80 · ↓1 ↑0 · (ta sesja) · Nowy mod z planu
odśwież 4 sesji (2 z modem) · odczyt 12:03:10 co 10 s
```

- **Lista sesji**: `claude agents --json` (docs agent-view: wspierana droga odczytu stanu sesji z zewnątrz; ~0,35 s), co 10 s, TYLKO
  gdy pane jest otwarty (`$.ui.panes()`), z `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (bez tej zmiennej każde wywołanie łączy się
  z `api.anthropic.com` — zmierzone proxy: 2× CONNECT bez, 0× z). Odczyty się nie nakładają: `/flota`, `o` i timer w trakcie odczytu
  dołączają do bieżącego. `claude` spoza PATH → `$HOME/.local/bin/claude`. Błąd startu, kod ≠ 0 albo zły JSON →
  poprzednia lista + „STARE DANE · błąd: …” w stopce; pane żyje. `o` (albo przycisk) = odśwież teraz.
- **Stan z czasem**: `●` pracuje, `◐` czeka na Ciebie (z `waitingFor`), `○` bezczynna. `--json` nie podaje czasu zmiany statusu, więc
  pane liczy go sam od chwili, gdy zmianę zobaczył; `≥` = dolna granica (status był już taki przy pierwszym odczycie albo poprzedni
  odczyt był nieudany lub starszy niż 15 s — np. pane był zamknięty — więc zmiana mogła zajść w przerwie). Nazwa sesji stoi na końcu
  wiersza: przy wąskim pane obcina się ona, a nie ctx/koszt/liczniki.
- **ctx %, koszt, `↓in ↑out`**: tylko dla sesji z tym modem — każda zapisuje swój wpis `flota:<sid>` w `$.store` (jeden plik JSON modu,
  wspólny dla sesji na maszynie; pisze tylko właściciel klucza) przy starcie, początku i końcu tury, wiadomości i co 30 s. Sesja bez
  modu: „bez modu”. Po restarcie procesu liczniki wracają z własnego wpisu; `/clear` (nowa rozmowa, nowe id) zeruje je.
- **Wiadomości między sesjami**: `↓` = dostarczenia do głównej rozmowy z `session.receive` o `origin.kind` `peer` (bez `teammate`)
  lub `peer-send-message`; `↑` = doręczone wysyłki głównej rozmowy (SendMessage modelu poza własnymi agentami + ping z pane). Hooki
  tylko liczą po `next` — nie zatrzymują ani nie zmieniają wiadomości.
- **Ping**: przycisk przy wierszu (nie przy własnej sesji) → `$.session.send({ to: { sessionId }, text: "Status? Jedna linia." })`;
  toast „doręczony” albo powód odmowy. Ping to TURA w sesji odbiorcy (koszt jej kontekstu). Wejście do sesji = klik w pasku bocznym
  desktopu (`Link` w desktopie nie otwiera `claude://`).
- **Sprzątanie**: wpis `flota:*` sesji nieobecnej w `claude agents` i bez zapisu od doby → `$.store.delete` (tylko po udanym odczycie).

## Odstępstwa od briefu (sprawdzone na d.ts 2.1.295 i w kicie testowym)

1. `lastInFrom` → `lastInKind` (`peer`, `peer:<plugin>`, `peer-send-message`): `SessionReceiveInput` nie niesie adresu nadawcy;
   adres widać u nadawcy z modem (`lastOutTo`).
2. `msgIn` liczy też `peer`, nie tylko `peer-send-message`: wiadomość z `$.session.send` innej sesji przychodzi jako `peer` z `plugin`
   (d.ts `SessionReceiveOrigin`) — bez tego ping z pane nie podbiłby `↓` u odbiorcy.
3. Własny `$.session.send` modu nie przechodzi przez jego własny hook `session.send` (kit 2.1.295) — `↑` za ping liczy `ping()`,
   a hook pomija wysyłki z `origin.name === 'kanon-flota'` (brak podwójnego liczenia, gdyby żywy silnik jednak wołał hook).
4. Jeden timer 10 s od `session.start` zamiast timera start/stop przy pane: odczyt i tak tylko przy otwartym pane, a po hot reloadzie
   `session.start` zakłada timer od nowa (timer z `/flota` zginąłby razem z modułem).
5. `msgOut` liczy wysyłki doręczone (`isDelivered`), nie próby.

## Bramki

Zero `$.model`, zero `$.http`, zero `$.fs`, zero `tool.call`/`tool.check`; zapis tylko do `$.store` i `$.state`. W store: id sesji, `cwd`,
id modelu, ctx %, koszt, liczniki, rodzaj ostatniej przychodzącej, adres ostatniej wysyłki, czasy — bez treści wiadomości i rozmów
(test: po pingu i dwóch wiadomościach store nie zawiera ich tekstu). Nazwy sesji i `cwd` innych sesji pokazuje tylko pane (`$.state`);
`/flota` wpisuje do rozmowy tylko stopkę (liczba sesji, czas), pełną listę — gdy pane nie może się otworzyć.

Linie walidatora (`claude plugin validate`, 2.1.289 i 2.1.295):

```
hooks: session.start, turn.start, turn.complete, session.end, session.receive, session.send, command.run{command=flota}, ui.render{component=Pane, requestId=kanon-flota}
calls: $.agent.list, $.clock.every, $.clock.now, $.command.register, $.env.get (via agenci), $.process.run (via agenci), $.session.cwd (via zapisz), $.session.id, $.session.model (via zapisz), $.session.send (via ping), $.session.usage (via zapisz), $.state.get, $.state.set, $.store.delete (via czytaj), $.store.get, $.store.keys (via czytaj), $.store.set (via zapisz), $.ui.open, $.ui.panes, $.ui.resolve, $.ui.toast (via ping)
env reads: HOME
```

`$.process.run` uruchamia wyłącznie `claude agents --json` (argv bez shella, timeout 5 s, env jak wyżej).

## Testy

`claude plugin test .` — 11 testów, zielone na CLI 2.1.289 i desktop 2.1.295 (pane na terminalu i desktopie, timer i czasy stanu,
ping doręczony/niedoręczony bez tekstu w store, liczenie `session.receive`, fallback PATH + błędy + zły JSON + env bez ruchu sieciowego,
sprzątanie store i powrót liczników, przerwa w odczytach → `≥`, SendMessage modelu liczony poza własnymi agentami + `/clear`, brak
nakładania odczytów). Każdy z 5 testów poprawek po recenzji pada po cofnięciu swojej poprawki (mutacje sprawdzone na kopii). Type-check: `tsc` 5.9.3 strict
z tsconfig z nagłówka d.ts (silnik kładzie typy w `.claude-plugin/types/` przy pierwszym załadowaniu, z własnym `.gitignore` `*`).

## Recenzja (sceptyk [OP5.5HI], 1 runda, 2026-10-11)

Naprawione: 🔴 `claude agents` łączył się z `api.anthropic.com` co 10 s (wbrew „zero sieci”) → env w `process.run`; 🟡 czas stanu
po przerwie w odczytach podawany jako pewny → próg ciągłości 15 s; 🟡 nakładające się odczyty przy wolnym CLI → wspólna obietnica,
timeout 10 → 5 s; 🟡 nazwa przed ctx/kosztem obcinała liczby → nazwa na końcu; 🟢 długa nazwa pluginu w `lastInKind` → `skroc`;
🟢 liczniki przeżywały `/clear` → zerowanie w `session.end`.

Nierozstrzygnięte w kicie (kontrola na żywo w dwóch sesjach):
- `$.store` między procesami: czy sesja widzi wpisy innych i czy zapis całego pliku jednej sesji nie gubi wpisów pozostałych;
- czy ping z pane przychodzi u odbiorcy jako `peer` z `plugin` (`lastInKind` = `peer:kanon-flota`) i czy żywy silnik woła własny
  hook `session.send` dla `$.session.send` modu (filtr `origin.name` — w kicie origin stempluje silnik);
- czy `peer` bez `teammate` przychodzi też od własnych agentów sesji (zawyżyłby `↓`);
- render przy ~110 kolumnach terminala i w pane desktopu; `$.state` po `/clear`.
Odczyty biegną także, gdy pane jest ukryty za kartą (świadomie: ciągłość czasów stanu).

## Uruchomienie i rollback

Na stałe: ścieżka modu w `env.CLAUDE_CODE_PLUGIN_DIRS` w `~/.claude/settings.json` (z backupem),
działa od NOWEJ sesji. Jedna sesja z terminala: `claude --plugin-dir ~/Developer/claude-mods/kanon-flota`.
Rollback: usunięcie ścieżki z `CLAUDE_CODE_PLUGIN_DIRS` (od nowej sesji) + `rm -f ~/.claude/plugins/store/kanon-flota*` (dane modu: liczniki i czasy).
