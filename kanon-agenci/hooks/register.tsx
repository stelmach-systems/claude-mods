// kanon-agenci — panel „co robią agenci” (mod Claude Code, API function hooks 2.1.293; early access). v0.1.1 po recenzji sceptyka.
// Dane z silnika, nie z deklaracji: `agent.spawn` (start, opis, typ, model rozstrzygnięty), `turn.step` (KAŻDE żądanie do modelu
// z `agentId`, model który odpowiedział i tokeny z `usage`), `turn.complete` (koniec pętli agenta), `$.agent.list()` (status na żywo
// przy rysowaniu). Zamyka lukę kanonu: tag `[S5.5MD]` w opisie subagenta jest deklaracją, a prawdę niesie `message.model`
// transkryptu — tu widać ją w trakcie pracy (wiersz z `⚠ tag≠model`).
// Licznik „spawny (mod)” to spawny, które DOTARŁY do hooka `agent.spawn` (także odrzucone przez `{ deny }` niżej, także z wnętrza
// subagentów i z `$.agent.spawn` innych pluginów). To NIE jest licznik hooka `kanon-agent-limit`, który liczy PRÓBY użycia narzędzia
// Agent w transkrypcie głównej pętli (odmowy PreToolUse/uprawnień nie docierają do modu) — próg hooka (10) pokazujemy jako punkt odniesienia.
// Mod wyłącznie obserwuje: nie zmienia modelu ani promptu agentów, nie wstrzymuje spawnów, nie pisze plików, nie używa sieci,
// nie wywołuje modelu, nie zatwierdza niczego. Hooki na zdarzeniach bramkujących mają try/catch po `next` i `.catch` → `next(e)`.
// Czego NIE widać (typy 2.1.293): agentów workflow (bez wiersza i bez licznika — także zdalnych, bez lokalnej pętli) i forków silnika
// (kompaktacja, pamięć): ich kroki liczy `pominiete`; teammate’a w osobnym panelu terminala. Krok bez odpowiedzi (`usage: null`:
// przerwanie, błąd API) nie liczy się jako żądanie i nie ustawia modelu. Panel otwiera `/agenci` albo przycisk — nie timer.
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, TurnStepResult } from 'claude-code'

import type { Glowny, Wiersz, Zakladka } from '../types'

const PANE = 'agenci'
const LIMIT_AGENT = 10 // próg hooka kanon-agent-limit (PreToolUse Agent) — punkt odniesienia, nie ten sam licznik

// Skaner walidatora wymaga literałów plugin/key w każdym atomie — stąd powtórzona nazwa.
const wiersze = atom({ plugin: 'kanon-agenci', key: 'wiersze' } as const, [] as Wiersz[])
const glowny = atom({ plugin: 'kanon-agenci', key: 'glowny' } as const, {
  kroki: 0,
  narzedzia: 0,
  wejscie: 0,
  wyjscie: 0,
  cache: 0,
  model: null,
} as Glowny)
const spawny = atom({ plugin: 'kanon-agenci', key: 'spawny' } as const, 0)
const pominiete = atom({ plugin: 'kanon-agenci', key: 'pominiete' } as const, 0)
const zakladka = atom({ plugin: 'kanon-agenci', key: 'zakladka' } as const, 'aktywni' as Zakladka)

// Kod modelu jak tag kanonu `[<MODEL><EFFORT>]` (kanon-tag.sh): rodzina + wersja z id modelu, Z GRANICĄ — dozwolona data `-YYYYMMDD`
// i sufiks dostawcy `-v1:0`, prefiks dostawcy (`us.anthropic.`) ignorowany. `claude-opus-5-6` → OP5.6 (nie OP5), id spoza wzorca → null.
const ID_MODELU = /claude-(opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d+(?::\d+)?)?$/
const RODZINA: Record<string, string> = { opus: 'OP', sonnet: 'S', haiku: 'H', fable: 'F' }
const TAG = /\[(OP5\.5|OP5|OP4\.8|F5\.1|F5|S5\.5|S5|H5\.5|H4\.5)(LO|MD|HI|XH|MX)?\]/
const NAZWY: Record<Zakladka, string> = { aktywni: 'Aktywni', wszyscy: 'Wszyscy', suma: 'Suma' }
const AKTYWNE = new Set(['pending', 'running', 'waiting', 'idle'])

const kod = (model: string | null): string | null => {
  const m = model ? ID_MODELU.exec(model) : null
  return m ? `${RODZINA[m[1]]}${m[2]}${m[3] ? `.${m[3]}` : ''}` : null
}
const kodLubId = (model: string | null): string => (model ? (kod(model) ?? model) : '?')
const tagZ = (opis: string): string | null => TAG.exec(opis)?.[1] ?? null
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
const czas = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`)
const skroc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

type Liczniki = { model: string | null; kroki: number; narzedzia: number; wejscie: number; wyjscie: number; cache: number }
type Krok = { model: string; narzedzia: number; wejscie: number; wyjscie: number; cache: number }

const PUSTE: Liczniki = { model: null, kroki: 0, narzedzia: 0, wejscie: 0, wyjscie: 0, cache: 0 }

/** Liczby z jednego kroku; null, gdy żadna odpowiedź nie przyszła (`usage: null`) — takiego kroku nie liczymy. */
const krokZ = (r: TurnStepResult): Krok | null => {
  const u = r.usage
  if (!u) return null
  return {
    model: u.model,
    narzedzia: r.toolUses.length,
    wejscie: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
    wyjscie: u.output_tokens,
    cache: u.cache_read_input_tokens,
  }
}
const dolicz = <T extends Liczniki>(w: T, s: Krok): T => ({
  ...w,
  model: s.model,
  kroki: w.kroki + 1,
  narzedzia: w.narzedzia + s.narzedzia,
  wejscie: w.wejscie + s.wejscie,
  wyjscie: w.wyjscie + s.wyjscie,
  cache: w.cache + s.cache,
})

const nowyWiersz = (id: string, opis: string, typ: string, start: number | null, zrodlo: Wiersz['zrodlo'], modelZadany: string | null): Wiersz => ({
  id,
  opis,
  typ,
  tag: tagZ(opis),
  modelZadany,
  ...PUSTE,
  start,
  koniec: null,
  zrodlo,
})

const statusWiersza = (w: Wiersz, zListy: AgentInfo | undefined): string => zListy?.status ?? (w.koniec !== null ? 'completed' : 'running')

const rozjazd = (w: Wiersz): string | null => {
  if (!w.tag || !w.model) return null
  const realny = kod(w.model)
  if (!realny) return null // id spoza wzorca — nie zgadujemy
  return realny === w.tag ? null : `${w.tag}→${realny}`
}

const liniaAgenta = (w: Wiersz, status: string, teraz: number): string => {
  const r = rozjazd(w)
  const liczniki = w.kroki
    ? `${w.kroki} żądań · ${w.narzedzia} narzędzi · ${k(w.wejscie)} in (${k(w.cache)} cache) · ${k(w.wyjscie)} out`
    : 'bez kroków widzianych przez mod'
  const trwanie = w.start === null ? '—' : czas((w.koniec ?? teraz) - w.start)
  return `[${kodLubId(w.model ?? w.modelZadany)}] ${w.typ} — „${skroc(w.opis, 44)}” · ${status} · ${liczniki} · ${trwanie}` + (r ? ` · ⚠ tag≠model (${r})` : '')
}
const liniaGlownego = (g: Glowny): string =>
  `główny wątek [${kodLubId(g.model)}]: ${g.kroki} żądań · ${g.narzedzia} narzędzi · ${k(g.wejscie)} in (${k(g.cache)} cache) · ${k(g.wyjscie)} out`
const licznikSpawnow = (n: number) => `spawny (mod): ${n} · próg hooka kanon-agent-limit: ${LIMIT_AGENT} prób Agent`

// Kroki z id bez wiersza i bez wpisu na liście, zebrane per id (lista pytana raz na id). Zwykle forki silnika i agenci workflow —
// liczone w `pominiete`. Gdy jednak nadejdzie `agent.spawn` tego id (kolejność spawn/krok nie jest gwarantowana), bufor wchodzi
// do wiersza, a `pominiete` oddaje te kroki. Pamięć modułu: po reloadzie startuje od nowa.
const nieznane = new Map<string, Liczniki>()

/** Wiersze do pokazania: stan modu + agenci z listy, których spawnu mod nie widział (np. załadowany po ich starcie). */
async function zebrane($: EngineInterface): Promise<{ wiersze: Wiersz[]; statusy: Map<string, AgentInfo>; teraz: number }> {
  const zapisane = await read($, wiersze)
  let lista: AgentInfo[] = []
  try {
    lista = await $.agent.list()
  } catch {
    lista = []
  }
  const teraz = await $.clock.now()
  const statusy = new Map(lista.map(a => [a.id, a] as const))
  const znane = new Set(zapisane.map(w => w.id))
  const zListy = lista.filter(a => !znane.has(a.id)).map(a => nowyWiersz(a.id, a.description, a.type, null, 'lista', null))
  return { wiersze: [...zapisane, ...zListy], statusy, teraz }
}

async function zapiszKrok($: EngineInterface, e: { agentId?: string }, r: TurnStepResult): Promise<void> {
  const s = krokZ(r)
  if (!s) return

  if (!e.agentId) {
    await update($, glowny, g => dolicz(g, s))
    return
  }

  const id = e.agentId
  let nowy: Wiersz | null = null
  if (!(await read($, wiersze)).some(w => w.id === id)) {
    const buf = nieznane.get(id)
    if (buf) {
      nieznane.set(id, dolicz(buf, s))
      await update($, pominiete, n => n + 1)
      return
    }
    const info = (await $.agent.list()).find(a => a.id === id)
    if (!info) {
      nieznane.set(id, dolicz(PUSTE, s))
      await update($, pominiete, n => n + 1)
      return
    }
    nowy = nowyWiersz(id, info.description, info.type, await $.clock.now(), 'lista', null) // start = pierwszy widziany krok
  }
  // Jedno `update`: dopisanie wiersza (jeśli spawn go tymczasem nie założył) i doliczenie kroku. Krok po `turn.complete`
  // (agent wznowiony wiadomością, teammate) znów otwiera wiersz — `koniec: null`.
  const l = await update($, wiersze, l => {
    const baza = l.some(w => w.id === id) ? l : nowy ? [...l, nowy] : l
    return baza.map(w => (w.id === id ? { ...dolicz(w, s), koniec: null } : w))
  })
  pasekStanu($, l)
}

/** Wpis w linii statusu: `agenci 2▶ 1✓` (▶ = wiersz bez `koniec`); znika, gdy nie ma żadnego. Liczy z wartości, którą właśnie zapisano. */
function pasekStanu($: EngineInterface, l: Wiersz[]): void {
  if (l.length === 0) {
    void $.ui.status(undefined)
    return
  }
  const biegna = l.filter(w => w.koniec === null).length
  void $.ui.status(`agenci ${biegna}▶ ${l.length - biegna}✓`)
}

async function podsumowanie($: EngineInterface): Promise<string> {
  const { wiersze: l, statusy, teraz } = await zebrane($)
  const [n, pom, g] = await Promise.all([read($, spawny), read($, pominiete), read($, glowny)])
  const ze = l.map(w => ({ w, status: statusWiersza(w, statusy.get(w.id)) }))
  const biegna = ze.filter(x => AKTYWNE.has(x.status)).length
  const naglowek =
    `agenci: ${l.length} (${biegna} aktywnych · ${l.length - biegna} zakończonych) · ${licznikSpawnow(n)}` +
    (pom ? ` · pominięte kroki (workflow, forki silnika): ${pom}` : '')
  const linie = ze.map(x => `- ${liniaAgenta(x.w, x.status, teraz)}`)
  return [naglowek, ...(l.length ? linie : ['Brak agentów w tej sesji.']), ...(g.kroki ? [liniaGlownego(g)] : [])].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agenci',
      description: 'Panel „co robią agenci”: status, realny model, tokeny, narzędzia; „tekst” = tylko podsumowanie, „zamknij” = zamknij panel',
      argumentHint: '[tekst|zamknij]',
    })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      // Agenci workflow: bez wiersza i bez licznika (zdalny nie ma lokalnej pętli ani wpisu na liście — wiersz wisiałby „running” na zawsze);
      // ich kroki, jeśli przyjdą, trafiają do `pominiete`.
      if (!e.workflow) {
        await update($, spawny, n => n + 1)
        if (!('deny' in r && r.deny) && 'agentId' in r && r.agentId) {
          const id = r.agentId
          const teraz = await $.clock.now()
          const modelZadany = 'model' in r && typeof r.model === 'string' ? r.model : null
          const buf = nieznane.get(id) // kroki, które wyprzedziły ten hook
          if (buf) {
            nieznane.delete(id)
            await update($, pominiete, n => Math.max(0, n - buf.kroki))
          }
          const l = await update($, wiersze, l => {
            const i = l.findIndex(w => w.id === id)
            if (i >= 0) {
              // wiersz założony z listy przez krok, który wyprzedził spawn — dane spawnu dochodzą, liczniki zostają
              const w = { ...l[i], opis: e.description, typ: e.subagentType, tag: tagZ(e.description), modelZadany, zrodlo: 'spawn' as const }
              return l.map((x, j) => (j === i ? w : x))
            }
            const w = nowyWiersz(id, e.description, e.subagentType, teraz, 'spawn', modelZadany)
            return [...l, buf ? { ...w, ...buf } : w]
          })
          pasekStanu($, l)
        }
      }
    } catch {
      // obserwator: błąd zapisu nie dotyka spawnu
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      await zapiszKrok($, e, r)
    } catch {
      // obserwator: błąd zapisu nie dotyka kroku
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.agentId) {
        const id = e.agentId
        const teraz = await $.clock.now()
        const l = await update($, wiersze, l => l.map(w => (w.id === id ? { ...w, koniec: teraz, model: e.usage?.model ?? w.model } : w)))
        pasekStanu($, l)
      }
    } catch {
      // obserwator
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'agenci' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'zamknij') {
      await $.ui.close({ id: PANE })
      return { text: 'Panel agentów zamknięty.' }
    }
    const tekst = await podsumowanie($)
    if (arg === 'tekst') return { text: tekst }
    const o = await $.ui.open({ id: PANE, title: 'Agenci', closeOnEscape: true })
    return { text: o.isPlaced ? tekst : `${tekst}\nPanel czeka na szersze okno: ${o.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { wiersze: l, statusy, teraz } = await zebrane($)
    const [n, pom, g, zak] = await Promise.all([read($, spawny), read($, pominiete), read($, glowny), read($, zakladka)])
    const ze = l.map(w => ({ w, status: statusWiersza(w, statusy.get(w.id)) }))
    const biegna = ze.filter(x => AKTYWNE.has(x.status)).length
    const widoczne = zak === 'aktywni' ? ze.filter(x => AKTYWNE.has(x.status)) : ze

    const kolor = (status: string) => (status === 'running' ? 'success' : status === 'failed' || status === 'killed' ? 'error' : 'warning')

    const suma = new Map<string, { agentow: number; wejscie: number; wyjscie: number; cache: number }>()
    for (const { w } of ze) {
      const kk = kodLubId(w.model ?? w.modelZadany)
      const s = suma.get(kk) ?? { agentow: 0, wejscie: 0, wyjscie: 0, cache: 0 }
      suma.set(kk, { agentow: s.agentow + 1, wejscie: s.wejscie + w.wejscie, wyjscie: s.wyjscie + w.wyjscie, cache: s.cache + w.cache })
    }

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {(['aktywni', 'wszyscy', 'suma'] as const).map(z => (
            <Button key={`zak-${z}`} plain label={z === zak ? `[${NAZWY[z]}]` : ` ${NAZWY[z]} `} onPress={() => update($, zakladka, () => z)} />
          ))}
          <Button key="zamknij" plain dimColor label="Zamknij" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text bold={n >= LIMIT_AGENT - 1} color={n >= LIMIT_AGENT ? 'warning' : undefined}>
          {`agenci: ${l.length} (${biegna} aktywnych · ${l.length - biegna} zakończonych) · ${licznikSpawnow(n)}`}
        </Text>
        {pom > 0 && <Text dimColor>{`pominięte kroki (workflow, forki silnika — kompaktacja, pamięć): ${pom}`}</Text>}
        {zak !== 'suma' && widoczne.length === 0 && <Text dimColor>{l.length === 0 ? 'Brak agentów w tej sesji.' : 'Żaden agent nie biegnie.'}</Text>}
        {zak !== 'suma' &&
          widoczne.map(({ w, status }) => (
            <Text key={w.id} wrap="truncate-end" color={rozjazd(w) ? 'warning' : kolor(status)} dimColor={!AKTYWNE.has(status) && !rozjazd(w)}>
              {`${AKTYWNE.has(status) ? '●' : '○'} ${liniaAgenta(w, status, teraz)}`}
            </Text>
          ))}
        {zak === 'suma' &&
          [...suma.entries()].map(([kk, s]) => (
            <Text key={`suma-${kk}`}>{`${kk}: ${s.agentow} agentów · ${k(s.wejscie)} in (${k(s.cache)} cache) · ${k(s.wyjscie)} out`}</Text>
          ))}
        {zak === 'suma' && <Text dimColor>{g.kroki ? liniaGlownego(g) : 'główny wątek: brak kroków od załadowania modu'}</Text>}
      </Box>
    )
  })
}
