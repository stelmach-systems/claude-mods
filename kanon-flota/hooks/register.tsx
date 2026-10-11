// kanon-flota — pane „flota sesji” (mod Claude Code, API function hooks 2.1.295; early access). v0.1.
// Wszystkie żywe sesje Claude Code na tym Macu z `claude agents --json` (docs agent-view: wspierana droga odczytu stanu sesji z zewnątrz),
// scalone po `sessionId` z wpisami `flota:<sid>`, które ten mod zapisuje w `$.store` (wspólny dla sesji na maszynie) w każdej sesji, gdzie
// jest załadowany: ctx %, koszt, liczniki wiadomości między sesjami. Sesja bez modu też jest na liście — bez ctx i kosztu.
// Bramki: zero wywołań modelu, zero sieci, nie zatwierdza narzędzi, zapis tylko do `$.store`/`$.state`; w store żadnej treści wiadomości
// ani rozmów — liczby, rodzaje, adresy, czasy. Hooki `session.receive`/`session.send` tylko liczą po `next` (nigdy `consumed`), `.catch` → `next(e)`.
// Czego NIE wiadomo: od kiedy sesja ma dany status (`--json` nie podaje czasu zmiany) — liczymy od pierwszego odczytu, z „≥”, gdy to dolna granica;
// kto przysłał wiadomość (`session.receive` nie niesie adresu nadawcy) — zapisujemy rodzaj, adres widać u nadawcy z modem (`lastOutTo`).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flota, Liczniki, Wiersz, Wpis } from '../types'

const PANE = 'kanon-flota'
const PING = 'Status? Jedna linia.'
const KLUCZ = 'flota:'
const ODSWIEZ = 10_000
const DOBA = 86_400_000

// Skaner walidatora wymaga literałów plugin/key w każdym atomie — stąd powtórzona nazwa.
const flota = atom({ plugin: 'kanon-flota', key: 'flota' } as const, { wiersze: [], odczyt: null, blad: null, stare: false } as Flota)
const ZERO: Liczniki = { msgIn: 0, msgOut: 0, lastInKind: null, lastInAt: null, lastOutTo: null, lastOutAt: null }
const liczniki = atom({ plugin: 'kanon-flota', key: 'liczniki' } as const, ZERO)

type Agent = { sessionId: string; cwd?: string; name?: string; status?: string; waitingFor?: string }

const IKONA: Record<string, string> = { busy: '●', waiting: '◐', idle: '○' }
const skroc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const projekt = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd
const czas = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const blad = (err: unknown) => skroc(err instanceof Error ? err.message : String(err), 160)

/**
 * Wpis tej sesji do `$.store` — liczniki z `$.state` (prawda sesji), ctx i koszt z `$.session.usage()` (wywołanie bez breakdown jest darmowe).
 * Po `update` podaj zapisane liczniki: odczyt `$.state` w tym samym dispatchu może widzieć stan sprzed zapisu.
 */
async function zapisz($: EngineInterface, swieze?: Liczniki): Promise<void> {
  const [sid, cwd, model, u, l, teraz] = await Promise.all([
    $.session.id(),
    $.session.cwd(),
    $.session.model(),
    $.session.usage(),
    swieze ?? read($, liczniki),
    $.clock.now(),
  ])
  const wpis: Wpis = { sid, cwd, model, ctx: u.context.percent ?? null, usd: u.cost?.usd ?? null, ...l, updatedAt: teraz }
  await $.store.set(KLUCZ + sid, wpis)
}
const zapiszCicho = ($: EngineInterface) => zapisz($).catch(() => {})

/**
 * `claude agents --json`; `claude` spoza PATH → `$HOME/.local/bin/claude`. Rzuca z opisem błędu (start, kod wyjścia, JSON).
 * Env: CLI 2.1.289 bez niego łączy się przy KAŻDYM wywołaniu z api.anthropic.com (proxy-log, recenzja 2026-10-11) — mod ma być bez sieci.
 * Timeout 5 s (odczyt ~0,35 s): z fallbackiem najwyżej 10 s, czyli nie dłużej niż okres timera.
 */
async function agenci($: EngineInterface): Promise<Agent[]> {
  const argv = ['agents', '--json']
  const init = { timeoutMs: 5_000, env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } }
  let r
  try {
    r = await $.process.run(['claude', ...argv], init)
  } catch {
    r = await $.process.run([`${(await $.env.get('HOME')) ?? ''}/.local/bin/claude`, ...argv], init)
  }
  if (r.exitCode !== 0) throw new Error(`claude agents: kod ${r.exitCode}${r.stderr.trim() ? ` — ${r.stderr.trim()}` : ''}`)
  const d: unknown = JSON.parse(r.stdout)
  if (!Array.isArray(d)) throw new Error('claude agents: odpowiedź nie jest tablicą')
  return d.filter((a): a is Agent => typeof a?.sessionId === 'string')
}

// Jeden odczyt naraz: timer, `/flota` i „odśwież” dołączają do trwającego (starszy wynik nie nadpisze nowszego).
let trwa: Promise<Flota> | null = null
const odczyt = ($: EngineInterface): Promise<Flota> => (trwa ??= czytaj($).finally(() => (trwa = null)))

/** Odczyt floty do `$.state`; błąd → poprzednie wiersze + „stare dane”. Zwraca zapisaną wartość (odczyt `$.state` w tym samym dispatchu widzi stan sprzed zapisu). */
async function czytaj($: EngineInterface): Promise<Flota> {
  const [teraz, sid] = await Promise.all([$.clock.now(), $.session.id()])
  let lista: Agent[] | null = null
  let err: string | null = null
  try {
    lista = await agenci($)
  } catch (e) {
    err = blad(e)
  }

  const wpisy = new Map<string, Wpis>()
  try {
    for (const k of await $.store.keys()) {
      if (!k.startsWith(KLUCZ)) continue
      const w = (await $.store.get(k)) as Wpis | undefined
      if (!w) continue
      // Sprzątanie: sesja nieobecna w `claude agents` i bez zapisu od doby. Tylko po udanym odczycie listy.
      if (lista && !lista.some(a => a.sessionId === w.sid) && teraz - w.updatedAt > DOBA) await $.store.delete(k)
      else wpisy.set(w.sid, w)
    }
  } catch (e) {
    err ??= `store: ${blad(e)}`
  }

  return update($, flota, f => {
    if (!lista) return { ...f, blad: err, stare: true }
    // Czas stanu = ciągła obserwacja. Po przerwie w odczytach (pane zamknięty, odczyt się nie udał) status mógł się zmienić
    // i wrócić niewidziany — wtedy liczymy od nowa z „≥” (jedyna pewna dolna granica), także przy tym samym statusie.
    const ciagly = f.odczyt !== null && !f.stare && teraz - f.odczyt <= 1.5 * ODSWIEZ
    const przed = new Map(f.wiersze.map(w => [w.sid, w] as const))
    const wiersze = lista.map((a): Wiersz => {
      const p = ciagly ? przed.get(a.sessionId) : undefined
      const status = a.status ?? '?'
      const ten = p?.status === status
      return {
        sid: a.sessionId,
        projekt: projekt(a.cwd ?? ''),
        nazwa: a.name ?? '',
        status,
        waitingFor: a.waitingFor ?? null,
        od: ten && p ? p.od : teraz,
        odPewne: ten && p ? p.odPewne : p !== undefined,
        wlasna: a.sessionId === sid,
        wpis: wpisy.get(a.sessionId) ?? null,
      }
    })
    return { wiersze, odczyt: teraz, blad: err, stare: false }
  })
}

async function liczWyslane($: EngineInterface, do_: string): Promise<void> {
  const teraz = await $.clock.now()
  await zapisz($, await update($, liczniki, l => ({ ...l, msgOut: l.msgOut + 1, lastOutTo: do_, lastOutAt: teraz })))
}

const stan = (w: Wiersz, teraz: number) => {
  const t = `${w.odPewne ? '' : '≥ '}${czas(teraz - w.od)}`
  if (w.status === 'busy') return `pracuje ${t}`
  if (w.status === 'waiting') return `czeka na Ciebie${w.waitingFor ? ` (${w.waitingFor})` : ''} od ${t}`
  if (w.status === 'idle') return `bezczynna od ${t}`
  return `${w.status} od ${t}`
}
const linia = (w: Wiersz, teraz: number) => {
  const m = w.wpis
  const zModu = m ? `ctx ${m.ctx ?? '?'}% · ${m.usd === null ? '$?' : `$${m.usd.toFixed(2)}`} · ↓${m.msgIn} ↑${m.msgOut}` : 'bez modu'
  // Nazwa na końcu: `truncate-end` w wąskim docku (od 110 kolumn) obcina ją, a nie liczby.
  return `${IKONA[w.status] ?? '?'} ${stan(w, teraz)} · ${w.projekt} · ${zModu}${w.wlasna ? ' · (ta sesja)' : ''} · ${skroc(w.nazwa, 40)}`
}
const godzina = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
const stopka = (f: Flota) =>
  `${f.wiersze.length} sesji (${f.wiersze.filter(w => w.wpis).length} z modem) · odczyt ${f.odczyt === null ? '—' : godzina(f.odczyt)} co ${ODSWIEZ / 1000} s` +
  (f.stare ? ' · STARE DANE' : '') +
  (f.blad ? ` · błąd: ${f.blad}` : '')

/** Własny `$.session.send` nie przechodzi przez własny hook `session.send` (test kitu 2.1.295) — ping liczy się tutaj, hook go pomija. */
async function ping($: EngineInterface, w: Wiersz): Promise<void> {
  const r = await $.session.send({ to: { sessionId: w.sid }, text: PING })
  if (r.isDelivered) await liczWyslane($, w.sid).catch(() => {})
  void $.ui.toast(r.isDelivered ? `ping → ${w.projekt} · ${skroc(w.nazwa, 30)}: doręczony` : `ping → ${w.projekt}: nie doręczony — ${r.reason}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'flota', description: 'Flota sesji Claude Code na tym Macu: stan, projekt, ctx, koszt, wiadomości, ping', immediate: true })
    try {
      // Po restarcie procesu `$.state` startuje od zera — liczniki wracają z własnego wpisu w store (po hot reloadzie zostają w `$.state`).
      const { version } = await $.state.get({ plugin: 'kanon-flota', key: 'liczniki' })
      const w = version === 0 ? ((await $.store.get(KLUCZ + (await $.session.id()))) as Wpis | undefined) : undefined
      const l = w
        ? await update($, liczniki, () => ({ msgIn: w.msgIn, msgOut: w.msgOut, lastInKind: w.lastInKind, lastInAt: w.lastInAt, lastOutTo: w.lastOutTo, lastOutAt: w.lastOutAt }))
        : undefined
      await zapisz($, l)
    } catch {
      // zbieracz: błąd nie dotyka startu sesji
    }
    // Timery żyją do reloadu modułu; `session.start` po reloadzie zakłada je od nowa. Odczyt floty tylko przy otwartym pane.
    $.clock.every(30_000, () => void zapiszCicho($))
    $.clock.every(ODSWIEZ, () => {
      void $.ui
        .panes()
        .then(p => (p.some(x => x.id === PANE) ? odczyt($) : undefined))
        .catch(() => {})
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await zapiszCicho($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await zapiszCicho($)
    return r
  })

  // `/clear`: proces idzie dalej pod nowym id, bez `session.start` — liczniki starej rozmowy nie przechodzą na nową.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear') await update($, liczniki, () => ZERO).catch(() => {})
    return r
  })

  on('session.receive', async ($, e, next) => {
    const r = await next(e)
    try {
      const o = e.origin
      // Wiadomość innej sesji do głównej rozmowy: `peer` (model albo plugin innej sesji; bez `teammate` = nie skrzynka zespołu) lub `peer-send-message`.
      if (!e.agentId && !r.consumed && (o.kind === 'peer-send-message' || (o.kind === 'peer' && !('teammate' in o)))) {
        const rodzaj = 'plugin' in o && o.plugin ? `${o.kind}:${skroc(o.plugin, 40)}` : o.kind // nazwa pluginu = deklaracja nadawcy
        const teraz = await $.clock.now()
        await zapisz($, await update($, liczniki, l => ({ ...l, msgIn: l.msgIn + 1, lastInKind: rodzaj, lastInAt: teraz })))
      }
    } catch {
      // obserwator: błąd liczenia nie dotyka dostarczenia
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    const r = await next(e)
    try {
      // Główna rozmowa (bez `agentId`), doręczone, nie ping tego modu (liczy go `ping`), nie do własnego subagenta/teammate’a.
      const wlasny = e.origin.kind === 'plugin' && e.origin.name === 'kanon-flota'
      if (r.isDelivered && !e.agentId && !wlasny && !(await $.agent.list()).some(a => a.id === e.to || a.teammateId === e.to || a.name === e.to)) {
        await liczWyslane($, e.to)
      }
    } catch {
      // obserwator: błąd liczenia nie dotyka wysyłki
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'flota' }, async $ => {
    const o = await $.ui.open({ id: PANE, title: 'Flota', focus: true, closeOnEscape: true })
    const f = await odczyt($)
    if (o.isPlaced) return { text: `Flota: ${stopka(f)}` }
    const teraz = await $.clock.now()
    return { text: [`Flota (pane czeka: ${o.reason}): ${stopka(f)}`, ...f.wiersze.map(w => `- ${linia(w, teraz)}`)].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [f, teraz] = await Promise.all([read($, flota), $.clock.now()])
    const kolor = (s: string) => (s === 'waiting' ? 'warning' : s === 'busy' ? 'success' : undefined)

    return (
      <Box flexDirection="column">
        {f.wiersze.length === 0 && <Text dimColor>{f.odczyt === null ? 'Odczyt…' : 'Brak żywych sesji.'}</Text>}
        {f.wiersze.map(w => (
          <Box key={w.sid} gap={1}>
            {w.wlasna ? <Text dimColor>{' ta '}</Text> : <Button key={`ping-${w.sid}`} plain label="ping" onPress={() => ping($, w)} />}
            <Text wrap="truncate-end" color={kolor(w.status)} dimColor={w.status === 'idle'}>
              {linia(w, teraz)}
            </Text>
          </Box>
        ))}
        <Box gap={1}>
          <Button key="odswiez" plain hotkey="o" label="odśwież" onPress={() => odczyt($)} />
          <Text wrap="truncate-end" dimColor={!f.stare && !f.blad} color={f.stare || f.blad ? 'warning' : undefined}>
            {stopka(f)}
          </Text>
        </Box>
      </Box>
    )
  })
}
