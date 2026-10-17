# claude-mods — mody Claude Code (macOS)

Kod modów Claude Code (API „function hooks”, early access). Decyzje — które mody ładuje każda sesja, plany, bramki i rollback —
trzyma prywatny kanon właściciela; tu jest sam kod z testami. Historia sprzed 2026-10-11 zostaje w prywatnym repo.

## Dwa katalogi, jedno repo

| katalog | gałąź | po co |
|---|---|---|
| `~/Developer/claude-mods` | `dev` (+ gałęzie robocze) | tu powstają i są testowane mody; nic stąd nie jest w env |
| `~/Developer/claude-mods-stabilne` | `main` (`git worktree`) | jedyne źródło `CLAUDE_CODE_PLUGIN_DIRS`; nie edytuj tu plików |

Dlaczego: sesja interaktywna obserwuje folder z `CLAUDE_CODE_PLUGIN_DIRS` i przeładowuje mod przy każdym zapisie (docs
plugin-authoring, `reference.md`) — praca w folderze ładowanym to test na wszystkich otwartych sesjach naraz, a zmiana gałęzi
w nim zabiera mody sesjom. Nie usuwaj `~/Developer/claude-mods`: worktree stabilny trzyma metadane w jego `.git`.

## Cykl moda

1. Praca w `~/Developer/claude-mods/<mod>` na `dev`. Próba w jednej sesji: `claude --plugin-dir ~/Developer/claude-mods/<mod>`
   (terminal) albo kopia w `~/.claude/dev-mods/<session_id>/` (jedna sesja desktop).
2. `claude plugin validate .` + `claude plugin test .` na binarce CLI i desktop, `tsc` strict, recenzja `sceptyk`; commit na `dev`.
3. Awans: `git -C ~/Developer/claude-mods-stabilne merge --ff-only dev` — otwarte sesje, które ładują mod, przeładowują go od razu.
4. Nowy mod w każdej sesji: ścieżka `~/Developer/claude-mods-stabilne/<mod>` w `env.CLAUDE_CODE_PLUGIN_DIRS` (`~/.claude/settings.json`,
   z backupem i planem rollbacku; działa od nowej sesji). Eksperyment nigdy nie trafia do env.

## Mody (w env: trzy od 2026-10-11, `kanon-na-biegu` od 2026-10-16, `kanon-brief`, `kanon-sztafeta`, `kanon-skrzynka` i `kanon-warsztat` od 2026-10-17)

- `kanon-agenci/` (v0.1.1) — panel `/agenci`: subagenci sesji z realnym modelem każdego żądania, tokenami, `⚠ tag≠model`.
- `kanon-pasek-budzetu/` (v0.2.1) — pasek nad promptem: kontekst / okno auto-kompaktacji, limity konta 5h/7d, koszt; log zużycia JSONL.
  Od v0.2.1 składa łańcuch AbovePrompt (`next(e)`): paski modów rysują się jeden nad drugim w kolejności `CLAUDE_CODE_PLUGIN_DIRS`.
- `kanon-flota/` (v0.1) — pane `/flota`: wszystkie żywe sesje na Macu z `claude agents --json`, stan z czasem, ctx/koszt/liczniki
  wiadomości między sesjami, ping.
- `kanon-na-biegu/` (v0.1) — sekcja „⚡ Na biegu” w pasku bocznym desktopu: sesja z turą sama się do niej
  wkłada, po dobie bezczynności wraca do grupy pochodzenia; `/na-biegu`. Jedyny mod z `tool.check` (zgoda tylko na własne `move_sessions`).
- `kanon-brief/` (v0.1) — formularz `/brief` na start zadania: repo/folder, stawka, tryb, „gotowe, gdy”, recall,
  granice → polecenie po polsku w polu promptu (Enter naciska właściciel); toast raz w turze 1 przy poleceniu < 200 znaków.
- `kanon-sztafeta/` (v0.1.1) — pasek „⟳ sztafeta” po kompaktacji / 8 h sesji / kontekście ≥ WARN; `/sztafeta` z ostatnią sekcją
  „## Stan” i briefem do nowej sesji, `/sztafeta skrot` (≤ 8 KB do `~/.claude/kanon/stan/<sid>-skrot.md`), przycisk `start_session`
  z zapasem prompt + schowek. Składa `next(e)`.
- `kanon-skrzynka/` (v0.1) — linia „📬 n do przeczytania” nad promptem: nieprzeczytane raporty WATCH i USAGE-tydzien oraz pliki stanu
  innych sesji spod `~/.claude/kanon/` (tylko nagłówki, nigdy treść); `/skrzynka` z „Wczytaj” (`prompt.fill`) i „Przeczytane”
  (`$.store`); polecenie „wczytaj <ścieżka>” liczy się jako przeczytane (D6).
- `kanon-warsztat/` (v0.1) — narzędzie modelu `szukaj` (JSDoc i sygnatura zdarzenia, metody `$.…` albo typu z lokalnego d.ts po nazwie;
  indeks leniwy w `$.state`, wynik ≤ 2048 znaków) i `/warsztat [katalog modu]`: `claude plugin validate/test` na CLI i na binarce
  desktopu oraz `tsc --noEmit` przez `$.process.run` z zamkniętej listy argv; panel binarka × krok, „Powtórz”, „Kopiuj błędy”.

Bramki wspólne: zero `$.model`, zero `$.http`; dane modów bez treści rozmów. Szczegóły i odstępstwa — README każdego modu.
`$.process.run` / `$.process.spawn` (decyzja właściciela 2026-10-17, D5 w planie 10-16 §6.6): tylko argv wymienione w `calls:`
README modu, bez shella, zawsze z `timeoutMs`, `cwd` w `~/Developer/claude-mods`, `~/Developer/claude-mods-stabilne` (dopisane
2026-10-17 przy awansie kanon-warsztat — testy po awansie biegną w stabilne) albo `$.session.root()`; wyłącznie komendy odczytowe
lub testowe (`claude agents --json`, `claude plugin validate/test`, `git status/log`, `tsc --noEmit`); nigdy `ssh`, `lftp`, `curl`,
`launchctl`, `rm`, `git push`. Precedensy: `kanon-flota` (`claude agents --json`, timeout 5 s), `kanon-warsztat` (`claude plugin
validate/test` na obu binarkach i `tsc.js`, timeout 120 s, strażnik argv sprawdzany tuż przed uruchomieniem).
