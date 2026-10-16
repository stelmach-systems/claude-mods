// Testy modu kanon-na-biegu: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik oraz aplikację desktop: `mcp.call` = serwery `ccd_sidebar` i `ccd_session_mgmt`
// nad sesjami w pamięci (ruchy zmieniają grupę, ruch do grupy zdejmuje pin — jak w opisie narzędzia), `store.*` = Mapa widoczna dla asercji.
// Zegar w pamięci: czas modu płynie tylko na `advance`.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { zgoda } from '../hooks/register'

const T0 = 1_791_700_000_000
const DOBA = 86_400_000
const NASZA = 'cg-na-biegu'
const SKLEP = 'cg-sklep'
const JA = 'local_ja'

type Dolar = Parameters<TestBody>[0]
type S = { group: string | null; pinned?: boolean; last: number }
type Pasek = {
  sesje: Record<string, S>
  /** Sekcje własne właściciela (bez wbudowanych); domyślnie nasza i sklep. */
  sekcje?: string[]
  store?: Record<string, unknown>
  /** Serwery MCP aplikacji nie są połączone (sesja z terminala). */
  bezDesktopu?: boolean
  /** Aplikacja odmawia ruchu (np. właściciel nie zgodził się na przeniesienie cudzej sesji). */
  odmowa?: boolean
  /** Odmowa tylko ruchów do tej sekcji. */
  odmowaDo?: string
  /** Okno aplikacji nie zgłosiło jeszcze grup: wiersze sesji bez klucza `group`. */
  bezGrup?: boolean
}

function pasek(on: On, p: Pasek) {
  const { sesje } = p
  const store = new Map<string, unknown>(Object.entries(p.store ?? {}))
  const log = { ruchy: [] as { ids: string[]; cel: string }[], wywolania: [] as string[], linie: [] as string[], store }
  const zegar = mock.clock(on, { now: T0 })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('command.run', () => ({}))
  on('tool.check', () => ({ decision: 'ask' as const })) // tryb auto: narzędzie zapisu bez reguły → „ask”
  on('ui.log', (_$, e) => {
    log.linie.push(e.text)
    return { value: undefined }
  })

  const wynik = (x: unknown, isError = false) => ({
    value: { content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x) }], isError },
  })
  const wiersz = (id: string) => {
    const s = sesje[id]!
    const group = s.group ? { id: s.group, name: s.group } : null
    return { sessionId: id, title: 'tytuł', lastActivityAt: new Date(s.last).toISOString(), ...(p.bezGrup ? {} : { group }), pinned: !!s.pinned }
  }
  on('mcp.call', (_$, e) => {
    log.wywolania.push(`${e.server}/${e.tool}`)
    if (p.bezDesktopu) return { deny: `MCP server "${e.server}" is not connected` }
    if (e.tool === 'list_sections') {
      const wlasne = (p.sekcje ?? [NASZA, SKLEP]).map(id => ({ id, kind: 'manual', name: id === NASZA ? '⚡ Na biegu' : 'Sklep (paluszki)' }))
      return wynik([{ id: 'pinned', kind: 'pinned', name: '' }, ...wlasne, { id: 'sessions', kind: 'sessions', name: '' }])
    }
    if (e.tool === 'get_session') {
      const id = e.args.session_id === 'self' ? JA : (e.args.session_id as string)
      return sesje[id] ? wynik(wiersz(id)) : wynik(`Session ${id} not found.`, true)
    }
    if (e.tool === 'list_sessions') {
      // Jak silnik: pełna lista setek sesji przekracza limit wyniku — tekst błędu BEZ isError.
      if (!e.args.group) return wynik('Error: result (90,203 characters across 2,417 lines) exceeds maximum allowed tokens.')
      return wynik(Object.keys(sesje).filter(id => id !== JA && sesje[id]!.group === e.args.group).map(wiersz))
    }
    if (e.tool === 'move_sessions') {
      if (p.odmowa || e.args.section_id === p.odmowaDo) return wynik('The user declined this move.', true)
      const ids = (e.args.session_ids as string[]).map(id => (id === 'self' ? JA : id))
      const cel = e.args.section_id as string
      log.ruchy.push({ ids, cel })
      for (const id of ids) {
        sesje[id]!.group = cel === 'sessions' ? null : cel
        if (cel !== 'sessions') sesje[id]!.pinned = false
      }
      return wynik({ moved: ids.length })
    }
    return wynik(`unknown tool ${e.tool}`, true)
  })
  return { log, zegar }
}

const start = ($: Dolar) => $.session.start({ cwd: '/tmp/dom/Developer', surface: 'desktop', isInteractive: true })
const tura = ($: Dolar, agentId?: string) => $.turn.start({ text: 'zrób X', turnId: `t-${Math.random()}`, ...(agentId ? { agentId } : {}) })
const komenda = { command: 'na-biegu', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

test('nowa sesja: pierwsza tura wkłada ją do sekcji (self), wpis z grupą pochodzenia; kolejne tury nic nie ruszają', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: null, last: T0 } } })
  await start($)
  await tura($)
  expect(log.ruchy).toEqual([{ ids: [JA], cel: NASZA }])
  expect(log.store.get(`na-biegu:${JA}`)).toEqual({ origin: null, at: T0 })

  await tura($)
  await tura($)
  expect(log.ruchy.length, 'już w sekcji — bez kolejnych ruchów').toBe(1)
})

test('wznowiona sesja z sekcji projektu trafia do „Na biegu” z zapamiętaną grupą', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: SKLEP, last: T0 - 5 * DOBA } } })
  await start($)
  await tura($)
  expect(log.ruchy).toEqual([{ ids: [JA], cel: NASZA }])
  expect(log.store.get(`na-biegu:${JA}`)).toEqual({ origin: SKLEP, at: T0 })
})

test('przypięta sesja: zero ruchów i zero wpisów (ruch do grupy zdjąłby pin)', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: SKLEP, pinned: true, last: T0 } } })
  await start($)
  await tura($)
  expect(log.ruchy).toEqual([])
  expect([...log.store.keys()]).toEqual([])
})

test('sesja wyjęta ręcznie z sekcji nie wraca, dopóki pracuje (każda tura odświeża wpis); po dobie bez tury wraca', async ($, on) => {
  const sesje: Record<string, S> = { [JA]: { group: null, last: T0 } }
  const { log, zegar } = pasek(on, { sesje })
  await start($)
  await tura($)
  sesje[JA]!.group = SKLEP // właściciel przeciągnął ją do „Sklep (paluszki)”
  await tura($)
  expect(log.ruchy.length, 'wpis = już obsłużona — mod nie walczy z ręcznym ruchem').toBe(1)
  await zegar.advance(20 * 3_600_000)
  await tura($)
  await zegar.advance(20 * 3_600_000)
  await tura($)
  expect(log.ruchy.length, '40 h pracy z turami co 20 h — nadal ten sam okres aktywności').toBe(1)
  expect(sesje[JA]!.group).toBe(SKLEP)

  await zegar.advance(DOBA + 1)
  await tura($)
  expect(log.ruchy.at(-1), 'wznowiona po dobie bez tury').toEqual({ ids: [JA], cel: NASZA })
  expect(log.store.get(`na-biegu:${JA}`)).toEqual({ origin: SKLEP, at: T0 + 2 * 20 * 3_600_000 + DOBA + 1 })
})

test('wyjęta ręcznie, a potem bezczynna > doba bez sprzątania w międzyczasie: pierwsza tura wkłada ją z powrotem', async ($, on) => {
  const { log } = pasek(on, {
    sesje: { [JA]: { group: SKLEP, last: T0 - 2 * DOBA } },
    store: { [`na-biegu:${JA}`]: { origin: null, at: T0 - 3 * DOBA } },
  })
  await start($)
  await tura($)
  expect(log.ruchy).toEqual([{ ids: [JA], cel: NASZA }])
  expect(log.store.get(`na-biegu:${JA}`)).toEqual({ origin: SKLEP, at: T0 })
})

test('grupy paska jeszcze niezgłoszone (brak klucza `group`): zero ruchów i wpisów — nieznana grupa to nie Ungrouped', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: SKLEP, last: T0 }, 'local_stara': { group: NASZA, last: T0 - 2 * DOBA } }, bezGrup: true })
  await start($)
  await tura($)
  expect(log.ruchy).toEqual([])
  expect([...log.store.keys()]).toEqual([])
  expect((await $.command.run(komenda)).text).toContain('nie zgłosiło jeszcze grup')
  expect(log.ruchy).toEqual([])
})

test('tura subagenta (agentId) nie rusza paska', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: null, last: T0 } } })
  await start($)
  await tura($, 'agent-1')
  expect(log.wywolania).toEqual([])
})

test('bez sekcji „⚡ Na biegu” (wyłącznik): tylko odczyt sekcji i tej sesji, zero ruchów i wpisów; /na-biegu mówi, jak włączyć', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: null, last: T0 } }, sekcje: [SKLEP] })
  await start($)
  await tura($)
  expect(log.wywolania.sort()).toEqual(['ccd_session_mgmt/get_session', 'ccd_sidebar/list_sections'])
  expect(log.ruchy).toEqual([])
  expect([...log.store.keys()]).toEqual([])
  const t = await $.command.run(komenda)
  expect(t.text).toContain('brak sekcji „⚡ Na biegu”')
})

test('sesja bez aplikacji desktop (terminal): błąd MCP nie psuje tury, /na-biegu podaje powód', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: null, last: T0 } }, bezDesktopu: true })
  await start($)
  const r = await tura($)
  expect(r.turnId).toBeDefined()
  expect(log.ruchy).toEqual([])
  const t = await $.command.run(komenda)
  expect(t.text).toMatch(/Na biegu: błąd — .*not connected/)
})

test('odmowa ruchu: bez wpisu, następna tura próbuje znowu', async ($, on) => {
  const sesje: Record<string, S> = { [JA]: { group: null, last: T0 } }
  const p: Pasek = { sesje, odmowa: true }
  const { log } = pasek(on, p)
  await start($)
  await tura($)
  expect([...log.store.keys()], 'nieudany ruch nie blokuje sesji na dobę').toEqual([])
  await tura($)
  expect(log.linie, 'nowy błąd w tle — jedna linia w transkrypcie, powtórka już nie').toEqual(['Na biegu: move_sessions: The user declined this move.'])
  p.odmowa = false
  await tura($)
  expect(log.ruchy).toEqual([{ ids: [JA], cel: NASZA }])
})

test('sprzątanie po dobie bezczynności: do grupy pochodzenia, do Ungrouped bez wpisu lub gdy grupy już nie ma; przypięta i świeża zostają', async ($, on) => {
  const sesje: Record<string, S> = {
    [JA]: { group: null, last: T0 },
    'local_sklep': { group: NASZA, last: T0 - DOBA - 1 }, // przyszła ze „Sklep (paluszki)”
    'local_nowa': { group: NASZA, last: T0 - 2 * DOBA }, // nowa sesja — przyszła z Ungrouped
    'local_bez-wpisu': { group: NASZA, last: T0 - 3 * DOBA }, // włożona ręcznie
    'local_znikla-grupa': { group: NASZA, last: T0 - 2 * DOBA }, // jej sekcję właściciel usunął
    'local_przypieta': { group: NASZA, pinned: true, last: T0 - 2 * DOBA },
    'local_swieza': { group: NASZA, last: T0 - DOBA + 60_000 },
    'local_wyjeta': { group: SKLEP, last: T0 - 2 * DOBA }, // wyjęta ręcznie, okres aktywności minął
    'local_wyjeta-aktywna': { group: SKLEP, last: T0 - 60_000 }, // wyjęta ręcznie, nadal pracuje
  }
  const { log } = pasek(on, {
    sesje,
    store: {
      'na-biegu:local_sklep': { origin: SKLEP, at: T0 - 2 * DOBA },
      'na-biegu:local_nowa': { origin: null, at: T0 - 3 * DOBA },
      'na-biegu:local_znikla-grupa': { origin: 'cg-usunieta', at: T0 - 3 * DOBA },
      'na-biegu:local_przypieta': { origin: SKLEP, at: T0 - 3 * DOBA },
      'na-biegu:local_swieza': { origin: null, at: T0 - DOBA },
      'na-biegu:local_wyjeta': { origin: null, at: T0 - 3 * DOBA },
      'na-biegu:local_wyjeta-aktywna': { origin: null, at: T0 - 3 * DOBA },
      'na-biegu:local_zarchiwizowana': { origin: null, at: T0 - 2 * DOBA }, // nie ma jej na liście
      'na-biegu:local_zarch-swiezo': { origin: null, at: T0 - 60_000 },
    },
  })
  await start($)
  const t = await $.command.run(komenda)
  expect(t.text).toContain('odłożone 4')

  expect(sesje['local_sklep']!.group).toBe(SKLEP)
  expect(sesje['local_nowa']!.group).toBe(null)
  expect(sesje['local_bez-wpisu']!.group).toBe(null)
  expect(sesje['local_znikla-grupa']!.group).toBe(null)
  expect(sesje['local_przypieta']!, 'przypięta: bez ruchu, pin zostaje').toEqual({ group: NASZA, pinned: true, last: T0 - 2 * DOBA })
  expect(sesje['local_swieza']!.group).toBe(NASZA)
  expect(log.ruchy.length, 'jeden ruch na sekcję docelową').toBe(2)

  expect([...log.store.keys()].sort()).toEqual([
    'na-biegu:local_przypieta',
    'na-biegu:local_swieza',
    'na-biegu:local_wyjeta-aktywna',
    'na-biegu:local_zarch-swiezo',
  ])
})

test('nieudany powrót zostawia wpis z grupą pochodzenia do następnej próby', async ($, on) => {
  const sesje: Record<string, S> = { [JA]: { group: null, last: T0 }, 'local_sklep': { group: NASZA, last: T0 - 2 * DOBA } }
  const p: Pasek = { sesje, odmowa: true, store: { 'na-biegu:local_sklep': { origin: SKLEP, at: T0 - 3 * DOBA } } }
  const { log } = pasek(on, p)
  await start($)
  const t = await $.command.run(komenda)
  expect(t.text).toMatch(/błąd — move_sessions: The user declined/)
  expect(log.store.get('na-biegu:local_sklep')).toEqual({ origin: SKLEP, at: T0 - 3 * DOBA })
  p.odmowa = false
  await $.command.run(komenda)
  expect(sesje['local_sklep']!.group).toBe(SKLEP)
  expect(log.store.has('na-biegu:local_sklep')).toBe(false)
})

test('odmowa przy drugim celu sprzątania: wpisy sesji, które już wróciły, znikają; wpis odmówionej zostaje', async ($, on) => {
  const sesje: Record<string, S> = {
    [JA]: { group: null, last: T0 },
    'local_a': { group: NASZA, last: T0 - 2 * DOBA }, // wraca do „Sklep (paluszki)” — pierwszy cel
    'local_b': { group: NASZA, last: T0 - 2 * DOBA }, // wraca do Ungrouped — drugi cel, odmowa
  }
  const { log } = pasek(on, {
    sesje,
    odmowaDo: 'sessions',
    store: { 'na-biegu:local_a': { origin: SKLEP, at: T0 - 3 * DOBA }, 'na-biegu:local_b': { origin: null, at: T0 - 3 * DOBA } },
  })
  await start($)
  await $.command.run(komenda)
  expect(sesje['local_a']!.group).toBe(SKLEP)
  expect([...log.store.keys()]).toEqual(['na-biegu:local_b'])
})

test('sekcja pełniejsza niż limit listy: wpisy spoza widocznej części zostają (grupa pochodzenia się nie gubi)', async ($, on) => {
  const sesje: Record<string, S> = { [JA]: { group: null, last: T0 } }
  for (let i = 0; i < 100; i++) sesje[`local_${i}`] = { group: NASZA, last: T0 } // świeże — zostają w sekcji
  const { log } = pasek(on, { sesje, store: { 'na-biegu:local_poza-lista': { origin: SKLEP, at: T0 - 3 * DOBA } } })
  await start($)
  await $.command.run(komenda)
  expect(log.store.get('na-biegu:local_poza-lista')).toEqual({ origin: SKLEP, at: T0 - 3 * DOBA })
  expect(log.wywolania.filter(w => w.endsWith('/get_session')).length, 'bez dopytywania o wpisy przy uciętej liście').toBe(1)
})

test('store bez treści rozmów: tylko grupa pochodzenia i czas', async ($, on) => {
  const { log } = pasek(on, { sesje: { [JA]: { group: SKLEP, last: T0 } } })
  await start($)
  await tura($)
  for (const v of log.store.values()) expect(Object.keys(v as object).sort()).toEqual(['at', 'origin'])
  expect(JSON.stringify([...log.store])).not.toContain('zrób X')
})

test('zgoda przy tool.check tylko dla własnych wywołań modu: model i inne pluginy dostają werdykt silnika („ask”)', async ($, on) => {
  pasek(on, { sesje: { [JA]: { group: null, last: T0 } } })
  await start($)
  const input = { session_ids: ['local_cudza'], section_id: 'sessions' }
  expect((await $.tool.check({ tool: 'mcp__ccd_sidebar__move_sessions', input })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'mcp__ccd_sidebar__delete_section', input: { section_id: NASZA } })).decision).toBe('ask')
})

// Własne `$.mcp.call` modu w kicie nie przechodzi przez `tool.check`, a `$` testu ma origin silnika — gałąź „allow” hooka sprawdzona
// na żywo (2026-10-16); tu decyzja wprost, wszystkie gałęzie.
test('zgoda(): allow tylko dla „ask” z originem tego modu; deny, sufit organizacji i cudze originy bez zmian', () => {
  const ask = { decision: 'ask' as const }
  expect(zgoda(ask, 'kanon-na-biegu', undefined).decision).toBe('allow')
  expect(zgoda(ask, 'kanon-na-biegu', 'allow').decision).toBe('allow')
  expect(zgoda(ask, 'inny-plugin', undefined)).toEqual(ask)
  expect(zgoda(ask, undefined, undefined)).toEqual(ask)
  expect(zgoda(ask, 'kanon-na-biegu', 'ask')).toEqual(ask)
  expect(zgoda(ask, 'kanon-na-biegu', 'deny')).toEqual(ask)
  const deny = { decision: 'deny' as const, reason: 'reguła właściciela' }
  expect(zgoda(deny, 'kanon-na-biegu', undefined)).toEqual(deny)
})

// Ostatni w pliku celowo: wcześniejsze testy robią tury w tej samej chwili T0 — gdyby pamięć modułu przechodziła między testami,
// pierwsze sprzątanie tutaj by się nie odbyło.
test('sprzątanie przy starcie tury w głównej rozmowie, najwyżej co 15 min; tura subagenta nie sprząta; bieżącej sesji nie rusza', async ($, on) => {
  const sesje: Record<string, S> = { [JA]: { group: NASZA, last: T0 - 2 * DOBA }, 'local_stara': { group: NASZA, last: T0 - 2 * DOBA } }
  const { log, zegar } = pasek(on, { sesje, store: { [`na-biegu:${JA}`]: { origin: SKLEP, at: T0 - 3 * DOBA } } })
  await start($)
  await tura($, 'agent-1')
  expect(log.ruchy).toEqual([])
  await tura($)
  expect(log.ruchy, 'bieżąca sesja zostaje, choć jej lastActivityAt jest sprzed tury').toEqual([{ ids: ['local_stara'], cel: 'sessions' }])
  expect(log.store.has(`na-biegu:${JA}`)).toBe(true)

  sesje['local_druga'] = { group: NASZA, last: T0 - 2 * DOBA }
  await zegar.advance(14 * 60_000)
  await tura($)
  expect(log.ruchy.length, 'przed upływem 15 min bez sprzątania').toBe(1)
  await zegar.advance(60_000)
  await tura($)
  expect(log.ruchy.at(-1)).toEqual({ ids: ['local_druga'], cel: 'sessions' })
})
