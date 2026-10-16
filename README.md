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

## Mody (w env: trzy od 2026-10-11, `kanon-na-biegu` od 2026-10-16)

- `kanon-agenci/` (v0.1.1) — panel `/agenci`: subagenci sesji z realnym modelem każdego żądania, tokenami, `⚠ tag≠model`.
- `kanon-pasek-budzetu/` (v0.2) — pasek nad promptem: kontekst / okno auto-kompaktacji, limity konta 5h/7d, koszt; log zużycia JSONL.
- `kanon-flota/` (v0.1) — pane `/flota`: wszystkie żywe sesje na Macu z `claude agents --json`, stan z czasem, ctx/koszt/liczniki
  wiadomości między sesjami, ping.
- `kanon-na-biegu/` (v0.1) — sekcja „⚡ Na biegu” w pasku bocznym desktopu: sesja z turą sama się do niej
  wkłada, po dobie bezczynności wraca do grupy pochodzenia; `/na-biegu`. Jedyny mod z `tool.check` (zgoda tylko na własne `move_sessions`).
- `kanon-brief/` (v0.1, nie w env — próba) — formularz `/brief` na start zadania: repo/folder, stawka, tryb, „gotowe, gdy”, recall,
  granice → polecenie po polsku w polu promptu (Enter naciska właściciel); toast raz w turze 1 przy poleceniu < 200 znaków.

Bramki wspólne: zero `$.model`, zero `$.http`; dane modów bez treści rozmów. Szczegóły i odstępstwa — README każdego modu.
