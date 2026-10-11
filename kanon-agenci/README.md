# kanon-agenci — panel „co robią agenci”

Mod Claude Code (API „function hooks”, early access; pisany pod 2.1.293, testy zielone też na CLI 2.1.289). M1 z planu
modów (2026-10-10). Zamyka lukę kanonu:
tag `[S5.5MD]` w opisie subagenta jest deklaracją, a prawdę niesie `message.model` w transkrypcie — tu widać ją W TRAKCIE pracy,
razem z tokenami, liczbą narzędzi i licznikiem spawnów widzianych przez mod (obok progu hooka `kanon-agent-limit`, który pyta od 10.
próby narzędzia Agent). v0.1.1 = poprawki po recenzji sceptyka [OP5.5HI] 2026-10-10 (5 🟡, 4 🟢, 0 🔴).

```
[Aktywni]  Wszyscy   Suma   Zamknij
agenci: 3 (2 aktywnych · 1 zakończonych) · spawny (mod): 3 · próg hooka kanon-agent-limit: 10 prób Agent
● [S5.5] czytelnik — „[S5.5MD] Rekonesans katalogu src” · running · 4 żądań · 12 narzędzi · 38k in (31k cache) · 1k out · 2 min
● [OP5.5] recenzent — „[S5.5HI] Recenzja diffu” · running · 1 żądań · 0 narzędzi · 9k in (0k cache) · 0k out · 10 s · ⚠ tag≠model (S5.5→OP5.5)
```

- **Źródła danych** (silnik, nie deklaracje): `agent.spawn` → start wiersza (opis, typ, model rozstrzygnięty przez silnik);
  `turn.step` z `agentId` → KAŻDE żądanie agenta: model, który odpowiedział (`usage.model`), tokeny in/out/cache, liczba narzędzi,
  o które poprosiła odpowiedź (`toolUses`); `turn.complete` z `agentId` → koniec pętli; `$.agent.list()` → status na żywo przy
  rysowaniu (`pending|running|waiting|idle|completed|failed|killed`). Kroki bez `agentId` liczy osobno jako „główny wątek” (zakładka Suma).
- **Rozjazd tagu**: kod modelu z tagu w opisie (`OP5.5|OP5|OP4.8|F5.1|F5|S5.5|S5|H5.5|H4.5`) porównany z kodem z id modelu z `usage`
  (rodzina + wersja Z GRANICĄ: `claude-opus-5-5-20260101` → OP5.5, `us.anthropic.claude-sonnet-5-5-…-v1:0` → S5.5, `claude-opus-5-6` → OP5.6,
  nie OP5) → `⚠ tag≠model (S5.5→OP5.5)` na żółto. Wiersz bez tagu, bez odpowiedzi albo z id spoza wzorca nie ostrzega.
- **Licznik spawnów** to spawny, które DOTARŁY do hooka `agent.spawn` (także odrzucone `{ deny }` niżej, także z wnętrza subagentów
  i z `$.agent.spawn` innych pluginów). Hook `kanon-agent-limit` liczy co innego: PRÓBY narzędzia Agent w transkrypcie głównej pętli
  (odmowy PreToolUse/uprawnień nie docierają do modu). Próg hooka (10) jest w etykiecie jako punkt odniesienia, nie jako wspólny licznik.
- **Krok bez odpowiedzi** (`usage: null` — przerwanie, błąd API) nie liczy się jako żądanie i nie ustawia modelu; wiersz bez policzonych
  kroków pokazuje „bez kroków widzianych przez mod” zamiast zer, wiersz prosto z listy czas „—” (mod nie zna startu agenta).
- **Kolejność spawn/krok** nie jest gwarantowana: krok, który wyprzedzi hook spawnu, czeka w buforze modułu (per id) i wchodzi do
  wiersza, gdy spawn nadejdzie; wiersz założony z listy dostaje od spawnu opis, typ i model, liczniki zostają.
- **Agent wznowiony** (wiadomość, teammate): kolejny krok po `turn.complete` znów otwiera wiersz — linia statusu (`▶` = bez `koniec`)
  i panel (status z listy) liczą zgodnie.
- **Czego nie widać** (typy 2.1.293): agentów workflow — hook spawnu pomija je (bez wiersza, bez licznika; zdalny agent workflow nie ma
  lokalnej pętli ani wpisu na liście, więc wiersz wisiałby „running” na zawsze) — i forków silnika (kompaktacja, pamięć): nie ma ich na
  liście, każdy ich krok trafia do licznika „pominięte kroki (workflow, forki silnika)”. Mod załadowany po starcie agenta zakłada wiersz
  z listy przy pierwszym kroku. Po reloadzie modułu stan (`$.state`) zostaje, bufor nieznanych id startuje od nowa.
- **Komenda** `/agenci` — otwiera panel (poproszony przez człowieka seatuje się przy dowolnej szerokości) i daje podsumowanie
  tekstowe; `/agenci tekst` — tylko tekst; `/agenci zamknij` — zamyka. Linia statusu: `agenci 2▶ 1✓`.
- **Zakładki**: Aktywni (`pending|running|waiting|idle`), Wszyscy, Suma (tokeny per kod modelu + główny wątek).
- Mod wyłącznie obserwuje: nie zmienia modelu ani promptu agenta, nie odrzuca spawnów, nie dotyka `tool.check`, nie pisze plików,
  nie używa sieci ani modelu. Hooki na zdarzeniach bramkujących mają try/catch po `next` — błąd modu nie dotyka tury.

Linie walidatora (`claude plugin validate`, 2.1.289 i 2.1.293):

```
hooks: session.start, agent.spawn, turn.step, turn.complete, command.run{command=agenci}, ui.render{component=Pane, requestId=agenci}
calls: $.agent.list, $.clock.now, $.command.register, $.state.get, $.state.set, $.ui.close, $.ui.open, $.ui.resolve, $.ui.status
```

Brak `$.fs`, `$.http`, `$.process`, `$.model`, `tool.call`, `tool.check` — to kryterium „gotowe” z planu. Walidator nie dowodzi
zasad sam z siebie (nie pokazuje decyzji `tool.check` ani ścieżek zapisu) — dowodem są testy i recenzja kodu.

## Uruchomienie

Na stałe: ścieżka modu w `env.CLAUDE_CODE_PLUGIN_DIRS` w `~/.claude/settings.json` (z backupem) — działa od NOWEJ sesji (także desktop); folder jest obserwowany, zapis pliku przeładowuje mod.
Jedna sesja z terminala bez env:

```bash
claude --plugin-dir ~/Developer/claude-mods/kanon-agenci
```

Panel otwiera `/agenci` (nie timer — pane otwarty bez prośby czeka do 144 kolumn). Rysuje się w terminalu i w zakładce Code aplikacji
desktop; panel czatu VS Code wykonuje tylko hooki (komenda `tekst` działa wszędzie).

## Sprawdzenie

```bash
claude plugin validate ~/Developer/claude-mods/kanon-agenci
claude plugin test     ~/Developer/claude-mods/kanon-agenci
```

16 testów (`tests/agenci.test.ts`): wiersz po spawn + 2 krokach (terminal i desktop), rozjazd tag≠model, kod modelu z granicą
(data, prefiks dostawcy, opus-5-6 → OP5.6, id spoza wzorca bez ⚠), krok bez odpowiedzi → nie liczony, bez ⚠, krok forka poza listą →
każdy krok pominięty i jedno pytanie listy na id, krok agenta z listy bez spawnu → wiersz, krok wyprzedza spawn (lista pusta → bufor
→ wiersz; lista zna → scalenie danych spawnu), agent z listy bez kroków widoczny (status z listy wygrywa; czas „—”; zakładki),
`turn.complete` → completed + linia statusu, agent wznowiony po `turn.complete` → panel i linia statusu zgodne, Suma per model +
główny wątek, `/agenci` open/close (`isPlaced:false` → powód w tekście), pusty stan, spawn odrzucony (`{ deny }`) → licznik rośnie,
wiersza brak. Bez testu (driver `$.agent.spawn` kitu nie niesie `workflow`): pominięcie agentów workflow — wyjątek jest w kodzie.
Cisza na powierzchniach bez panelu: linia walidatora `hooks:` nie zawiera `AbovePrompt` ani `StatusLine` — mod rysuje tylko własny Pane
i wpis `$.ui.status`. Kryteria planu (c)(d)(e) — ręczny przegląd w terminalu i desktopie ze zrzutem — czekają na właściciela.

Lekcje (2026-10-10): hook `turn.step` to generator — `const r = yield* next(e)` i `return r`; w teście hook dna też jest generatorem
(`async function* (_$, e) { return wynik }`), a driver `$.turn.step(input)` trzeba skonsumować (`for await`) przed `await s.result`;
`on(...)` testu nie przyjmuje drugiej rejestracji tego samego zdarzenia („registered twice”) — warianty dna przez parametr;
driver `$.agent.spawn` nie niesie `workflow`, więc wyjątek dla agentów workflow jest w kodzie, ale bez testu; krok „z dna” spawnu
(`$.turn.step` wywołany w hooku dna `agent.spawn`, zanim odda wynik) odgrywa wyścig spawn/krok; `update($, …)` zwraca zapisaną wartość —
linia statusu liczy z niej, nie z ponownego `read` (d.ts: „Every `get` of one dispatch reads one moment”).

## Rollback

`git revert` commitu modu, usunięcie ścieżki z `CLAUDE_CODE_PLUGIN_DIRS` (albo `cp` backupu
`~/.claude/settings.json.bak-<ts>`), `rm -rf ~/.claude/dev-mods/<session_id>/kanon-agenci`.
