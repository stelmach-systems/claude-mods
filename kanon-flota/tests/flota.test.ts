// Testy modu kanon-flota: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: `process.run` = `claude agents --json`, `store.*` = wspólny store w Mapie (test go czyta), `session.send`
// = doręczenie (albo odmowa), `ui.panes` = czy pane jest otwarty. Zegar w pamięci: timery modu ruszają tylko na `advance`.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Wpis } from '../types'

const PLUGIN = 'kanon-flota'
const PANE = { component: 'Pane' as const, requestId: 'kanon-flota' }
const props = { title: 'Flota', isFocused: true, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = { command: 'flota', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const T0 = 1_791_670_000_000
const DOBA = 86_400_000
const PING = 'Status? Jedna linia.'

type Dolar = Parameters<TestBody>[0]
type Agent = { sessionId: string; cwd: string; name: string; status: string; waitingFor?: string; pid: number; kind: string; startedAt: number }

const sesja = (sessionId: string, cwd: string, name: string, status: string, waitingFor?: string): Agent => ({
  pid: 1,
  kind: 'interactive',
  startedAt: T0 - 3_600_000,
  sessionId,
  cwd,
  name,
  status,
  ...(waitingFor ? { waitingFor } : {}),
})
const JA = sesja('sid-ja', '/tmp/dom/Developer/mody', 'Nowy mod z planu', 'busy')
const INNA = sesja('sid-inna', '/tmp/dom/Developer/raporty', 'Raport kwartalny etap 2', 'waiting', 'input needed')
const OBCA = sesja('sid-obca', '/tmp/dom/Developer/strona-www', 'Poprawki formularza zgłoszeń', 'idle')

const wpis = (sid: string, w: Partial<Wpis> = {}): Wpis => ({
  sid,
  cwd: '/x',
  model: 'claude-opus-5-5',
  ctx: 40,
  usd: 2.5,
  msgIn: 1,
  msgOut: 0,
  lastInKind: 'peer',
  lastInAt: T0 - 60_000,
  lastOutTo: null,
  lastOutAt: null,
  updatedAt: T0,
  ...w,
})

type Silnik = {
  lista: () => Agent[] | 'zepsuty' | 'blad'
  store?: Record<string, unknown>
  /** `claude` nie startuje z PATH (rzuca jak przy ENOENT) — mod ma spróbować `$HOME/.local/bin/claude`. */
  brakPath?: boolean
  niedoreczony?: string
  otwarty?: () => boolean
}

/** Dno pod modem. Zwraca rejestr wywołań do asercji. */
function silnik(on: On, s: Silnik) {
  const store = new Map<string, unknown>(Object.entries(s.store ?? {}))
  const log = { argv: [] as string[][], env: [] as (Record<string, string> | undefined)[], wyslane: [] as { to: string; text: string }[], toasty: [] as string[], store }
  const zegar = mock.clock(on, { now: T0 })
  mock.env(on, { HOME: '/tmp/dom' })
  // Store jak silnik: wartości po JSON (jak `$.store.set`), Mapa widoczna dla asercji (`$` testu nie ma `store`).
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
  on('session.id', () => ({ value: 'sid-ja' }))
  on('session.cwd', () => ({ value: JA.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: T0 - 3_600_000, context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'rekonesans', type: 'czytelnik', status: 'running' as const }] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    log.argv.push([...e.argv])
    log.env.push(e.init?.env)
    if (s.brakPath && e.argv[0] === 'claude') throw new Error('spawn claude ENOENT')
    const l = s.lista()
    if (l === 'blad') return { value: { exitCode: 1, stdout: '', stderr: 'agent registry unavailable', isStdoutTruncated: false, isStderrTruncated: false } }
    const stdout = l === 'zepsuty' ? '{"niedokończony' : JSON.stringify(l)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: (s.otwarty?.() ?? true) ? [{ id: 'kanon-flota', title: 'Flota', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.toast', (_$, e) => {
    log.toasty.push(e.text)
    return { value: undefined }
  })
  on('session.send', (_$, e) => {
    log.wyslane.push({ to: e.to, text: e.text })
    return s.niedoreczony ? { isDelivered: false as const, reason: s.niedoreczony } : { isDelivered: true as const }
  })
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  return { log, zegar }
}

const start = ($: Dolar) => $.session.start({ cwd: JA.cwd, surface: 'terminal', isInteractive: true })
const mojWpis = (store: Map<string, unknown>) => store.get('flota:sid-ja') as Wpis | undefined

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane: wszystkie sesje z claude agents, stan, projekt, ctx/$ tylko z modem, bez pingu do siebie (${surface})`, async ($, on) => {
    silnik(on, { lista: () => [JA, INNA, OBCA], store: { 'flota:sid-inna': wpis('sid-inna') } })
    await start($)
    const t = await $.command.run(komenda)
    expect(t.text).toContain('Flota: 3 sesji (2 z modem)')

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props })
    expect(await pane.find({ text: /● pracuje ≥ 0 s · mody · ctx 25% · \$1\.50 · ↓0 ↑0 · \(ta sesja\) · Nowy mod z planu/ })).toBeDefined()
    expect(await pane.find({ text: /◐ czeka na Ciebie \(input needed\) od ≥ 0 s · raporty · ctx 40% · \$2\.50 · ↓1 ↑0 · Raport kwartalny etap 2/ })).toBeDefined()
    expect(await pane.find({ text: /○ bezczynna od ≥ 0 s · strona-www · bez modu · Poprawki formularza zgłoszeń/ }), 'sesja bez modu: z listy, bez ctx/$').toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'ping-sid-inna' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'ping-sid-obca' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'ping-sid-ja' }), 'ping do siebie wyłączony').toBeUndefined()
    expect(await pane.find({ text: /3 sesji \(2 z modem\) · odczyt \d\d:\d\d:\d\d co 10 s/ })).toBeDefined()
    await pane.unmount()
  })
}

test('timer co 10 s przy otwartym pane: czas stanu rośnie, zmiana statusu zeruje czas (pewny), start/koniec innej sesji widać', async ($, on) => {
  let lista = [JA, INNA]
  let otwarty = true
  const { log, zegar } = silnik(on, { lista: () => lista, otwarty: () => otwarty })
  await start($)
  await $.command.run(komenda)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })

  await zegar.advance(10_000)
  expect(await pane.find({ text: /czeka na Ciebie \(input needed\) od ≥ 10 s/ }), 'status od pierwszego odczytu — dolna granica').toBeDefined()

  lista = [JA, { ...INNA, status: 'busy', waitingFor: undefined }, OBCA]
  await zegar.advance(10_000)
  expect(await pane.find({ text: /● pracuje 0 s · raporty/ }), 'zmiana widziana między odczytami → czas pewny, bez ≥').toBeDefined()
  expect(await pane.find({ text: /strona-www/ }), 'nowa sesja w ≤ 10 s').toBeDefined()

  lista = [JA, { ...INNA, status: 'busy' }]
  await zegar.advance(70_000)
  expect(await pane.find({ text: /● pracuje 1 min · raporty/ })).toBeDefined()
  expect(await pane.find({ text: /strona-www/ }), 'zamknięta sesja znika w ≤ 10 s').toBeUndefined()

  const odczyty = log.argv.length
  otwarty = false
  await zegar.advance(60_000)
  expect(log.argv.length, 'zamknięty pane → zero wywołań claude agents').toBe(odczyty)
  await pane.unmount()
})

test('ping: wysyłka do sesji po sessionId, toast, msgOut w store — bez treści wiadomości w store', async ($, on) => {
  const { log } = silnik(on, { lista: () => [JA, INNA] })
  await start($)
  await $.command.run(komenda)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  await pane.press({ key: 'ping-sid-inna' })

  expect(log.wyslane.length).toBe(1)
  expect(log.wyslane[0]?.text).toBe(PING)
  expect(log.wyslane[0]?.to).toContain('sid-inna')
  expect(log.toasty[0]).toContain('ping → raporty · Raport kwartalny etap 2: doręczony')
  const w = mojWpis(log.store)
  expect(w?.msgOut).toBe(1)
  expect(w?.lastOutTo).toContain('sid-inna')
  expect(w?.lastOutAt).toBe(T0)
  expect(JSON.stringify([...log.store.values()]), 'w store adres i czas, nie tekst').not.toContain('Status?')
  await pane.unmount()
})

test('ping niedoręczony: toast z powodem, msgOut bez zmian', async ($, on) => {
  const { log } = silnik(on, { lista: () => [JA, INNA], niedoreczony: 'session sid-inna is not running' })
  await start($)
  await $.command.run(komenda)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  await pane.press({ key: 'ping-sid-inna' })
  expect(log.toasty[0]).toContain('nie doręczony — session sid-inna is not running')
  expect(mojWpis(log.store)?.msgOut).toBe(0)
  await pane.unmount()
})

test('session.receive: liczy wiadomości innych sesji do głównej rozmowy, nie skrzynkę zespołu ani agentów; nie zatrzymuje dostarczenia', async ($, on) => {
  const { log } = silnik(on, { lista: () => [JA] })
  await start($)

  const r = await $.session.receive({ origin: { kind: 'peer', plugin: 'kanon-flota' }, text: PING })
  expect(r.text, 'dostarczenie idzie dalej bez zmian').toBe(PING)
  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'raport z sesji B' })
  await $.session.receive({ origin: { kind: 'peer', teammate: 'researcher', isVerified: true }, text: 'teammate' })
  await $.session.receive({ origin: { kind: 'peer' }, text: 'do subagenta', agentId: 'a1' })
  await $.session.receive({ origin: { kind: 'bridge' }, text: 'z telefonu' })

  const w = mojWpis(log.store)
  expect(w?.msgIn).toBe(2)
  expect(w?.lastInKind).toBe('peer-send-message')
  expect(JSON.stringify(w)).not.toContain('raport')
  expect(JSON.stringify(w)).not.toContain('Status?')
})

test('claude spoza PATH → $HOME/.local/bin/claude; błąd i zły JSON → poprzednie wiersze + STARE DANE, pane żyje', async ($, on) => {
  let lista: Agent[] | 'zepsuty' | 'blad' = [JA, INNA]
  const { log, zegar } = silnik(on, { lista: () => lista, brakPath: true })
  await start($)
  await $.command.run(komenda)
  expect(log.argv[1]?.[0]).toBe('/tmp/dom/.local/bin/claude')
  expect(log.env.every(v => v?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1'), 'bez env CLI łączy się z api.anthropic.com').toBe(true)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect(await pane.find({ text: /raporty/ })).toBeDefined()

  lista = 'zepsuty'
  await zegar.advance(10_000)
  expect(await pane.find({ text: /raporty/ }), 'poprzednia lista zostaje').toBeDefined()
  expect(await pane.find({ text: /STARE DANE · błąd: / })).toBeDefined()

  lista = 'blad'
  await zegar.advance(10_000)
  expect(await pane.find({ text: /błąd: claude agents: kod 1 — agent registry unavailable/ })).toBeDefined()

  lista = [JA]
  await zegar.advance(10_000)
  expect(await pane.find({ text: /STARE DANE/ }), 'udany odczyt czyści znacznik').toBeUndefined()
  await pane.unmount()
})

test('sprzątanie store: wpis sesji spoza listy starszy niż doba znika, młodszy zostaje; liczniki wracają ze store po restarcie', async ($, on) => {
  const { log } = silnik(on, {
    lista: () => [JA],
    store: {
      'flota:sid-ja': wpis('sid-ja', { msgIn: 3, msgOut: 2 }),
      'flota:stara': wpis('stara', { updatedAt: T0 - 2 * DOBA }),
      'flota:swieza': wpis('swieza', { updatedAt: T0 - 3_600_000 }),
    },
  })
  await start($)
  const w = mojWpis(log.store)
  expect([w?.msgIn, w?.msgOut], 'liczniki ze store, nie od zera').toEqual([3, 2])
  expect(w?.ctx).toBe(25)

  await $.command.run(komenda)
  const klucze = [...log.store.keys()]
  expect(klucze).not.toContain('flota:stara')
  expect(klucze).toContain('flota:swieza')
})

test('przerwa w odczytach: ten sam status po ponownym otwarciu to NIE ciągła obserwacja → czas od nowa z ≥', async ($, on) => {
  let lista = [JA, { ...INNA, status: 'busy', waitingFor: undefined }]
  let otwarty = true
  const { zegar } = silnik(on, { lista: () => lista, otwarty: () => otwarty })
  await start($)
  await $.command.run(komenda)
  lista = [JA, { ...INNA, status: 'idle' }]
  await zegar.advance(10_000)
  lista = [JA, { ...INNA, status: 'busy', waitingFor: undefined }]
  await zegar.advance(10_000) // busy widziany od zmiany → pewny
  otwarty = false
  await zegar.advance(59 * 60_000) // w przerwie mogło być idle → busy
  otwarty = true
  await $.command.run(komenda)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect(await pane.find({ text: /● pracuje ≥ 0 s · raporty/ }), 'nie „pracuje 59 min” bez ≥').toBeDefined()
  await pane.unmount()
})

test('session.send: SendMessage modelu do innej sesji liczy ↑, do własnego subagenta i z subagenta nie; /clear zeruje liczniki', async ($, on) => {
  const { log } = silnik(on, { lista: () => [JA] })
  await start($)
  await $.session.send({ to: 'sid-inna', text: 'raport', origin: { kind: 'model' } })
  await $.session.send({ to: 'a1', text: 'dalej', origin: { kind: 'model' } })
  expect(mojWpis(log.store)?.msgOut).toBe(1)
  expect(mojWpis(log.store)?.lastOutTo).toBe('sid-inna')
  expect(JSON.stringify(mojWpis(log.store))).not.toContain('raport')

  await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'x' })
  await $.session.end({ reason: 'clear', sessionId: 'sid-ja', resume: { id: 'sid-ja' } })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect([mojWpis(log.store)?.msgIn, mojWpis(log.store)?.msgOut], 'po /clear liczniki od zera').toEqual([0, 0])
})

test('odczyty się nie nakładają: równoległe /flota i timer dołączają do jednego claude agents', async ($, on) => {
  const { log } = silnik(on, { lista: () => [JA, INNA] })
  await start($)
  await Promise.all([$.command.run(komenda), $.command.run(komenda), $.command.run(komenda)])
  expect(log.argv.length).toBe(1)
})
