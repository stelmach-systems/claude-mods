// Testy modu kanon-pasek-budzetu: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: rzeczowniki ($.session.usage, $.settings.read, $.fs.*, …) odpowiadają
// `{ value }`, zdarzenia rdzenia (turn.complete, turn.step, session.measure, command.run, ui.render, session.compact) zwracają
// wynik jak silnik.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, SessionRateLimit, TurnStepResult, TurnUsage } from 'claude-code'

const PLUGIN = 'kanon-pasek-budzetu'
const TERAZ = Date.parse('2026-10-10T10:00:00Z')
const HOME = '/tmp/dom-testu'
const usage = (tokens: number | undefined, window = 1_000_000, rateLimits: SessionRateLimit[] = [], usd?: number) => ({
  startedAt: 0,
  context: tokens === undefined ? { window } : { tokens, window, percent: Math.round((tokens / window) * 100) },
  rateLimits,
  ...(usd === undefined ? {} : { cost: { usd } }),
})
const limity = (p5h: number, p7d: number): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: p5h, resetsAt: new Date(TERAZ + (2 * 60 + 10) * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: p7d, resetsAt: new Date(TERAZ + (3 * 24 + 4) * 3_600_000).toISOString() },
]
const uzycie = (model: string, input = 3000, cache = 58_000, output = 1200): TurnUsage => ({
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cache,
  cache_creation_input_tokens: 0,
})
const tura = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }
const props = { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = { command: 'budzet', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
type Dolar = Parameters<TestBody>[0]

type Silnik = {
  env?: Record<string, string>
  settings?: Record<string, unknown>
  tokens: () => number | undefined
  window?: number
  rateLimits?: () => SessionRateLimit[]
  usd?: number
  /** Zawartość dysku na starcie (ścieżka → tekst). */
  pliki?: Record<string, string>
  /** Każdy `fs.read` odmawia (EACCES, błąd I/O) — plik istnieje, ale nie da się go przeczytać. */
  czytajBlad?: boolean
  /** Napis, który rysuje plugin NIŻEJ w łańcuchu AbovePrompt: dno `ui.render` zwraca wtedy Text z nim zamiast pustego Box (rdzeń). */
  dno?: string
  /** Dno `ui.render` rzuca (plugin niżej się wysypał) — pasek ma zostać (fail-open na `next`). */
  dnoRzuca?: boolean
}

/** Dno pod modem: liczby z „silnika”, dysk w pamięci, puste odpowiedzi zdarzeń rdzenia. Zwraca rejestr do asercji. */
function silnik(on: On, s: Silnik) {
  const log = { toasty: [] as string[], pliki: new Map<string, string>(Object.entries(s.pliki ?? {})), odczytyUsage: 0 }
  mock.clock(on, { now: TERAZ })
  mock.env(on, { HOME, ...(s.env ?? {}) })
  on('settings.read', () => ({ value: s.settings ?? {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'test-sid' }))
  on('session.usage', () => {
    log.odczytyUsage += 1
    return { value: usage(s.tokens(), s.window, s.rateLimits ? s.rateLimits() : [], s.usd) }
  })
  on('ui.toast', (_$, e) => {
    log.toasty.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: log.pliki.has(e.path) }))
  on('fs.stat', (_$, e) => {
    const t = log.pliki.get(e.path)
    if (t === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, size: t.length, mtimeMs: TERAZ, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    const t = log.pliki.get(e.path)
    if (t === undefined || s.czytajBlad) throw new Error(`${t === undefined ? 'ENOENT' : 'EACCES'}: ${e.path}`)
    return { value: t }
  })
  on('fs.write', (_$, e) => {
    log.pliki.set(e.path, e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e): AsyncGenerator<never, TurnStepResult> {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: uzycie(e.model) }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.run', () => ({}))
  on('session.compact', () => ({ skip: 'test' }))
  // Dno łańcucha ui.render: pusty Box jak rdzeń silnika, albo — z `dno` — Text ze strażnikiem, jak plugin niżej w łańcuchu.
  on('ui.render', ($, e) => {
    if (s.dnoRzuca) throw new Error('dno ui.render padło (test)')
    return s.dno === undefined ? $.ui.resolve(e).Box({}) : $.ui.resolve(e).Text({ children: s.dno })
  })
  return log
}

async function krok($: Dolar, model: string, agentId?: string) {
  const s = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) {
    // liczy się wynik
  }
  return s.result
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pasek po turn.complete: okno z env, progi kanonu, limity 5h/7d, „Ukryj” chowa (${surface})`, async ($, on) => {
    silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, rateLimits: () => limity(37, 61), usd: 0.42 })

    await $.turn.complete(tura)
    const pasek = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })
    expect(await pasek.find({ text: /142k \/ 300k \(47 %\)/ }), 'liczby z okna budżetu, nie z okna modelu').toBeDefined()
    expect(await pasek.find({ text: /WARN 220k · kompaktacja ~280k/ }), 'progi jak hook kanon-budzet').toBeDefined()
    expect(await pasek.find({ text: /5h 37 % · 7d 61 %/ }), 'okna limitu konta').toBeDefined()
    expect(await pasek.find({ text: /\$0\.42/ }), 'koszt sesji').toBeDefined()
    expect(await pasek.find({ type: 'Button', key: 'ukryj' })).toBeDefined()

    await pasek.press({ key: 'ukryj' })
    expect(await pasek.find({ text: /142k/ }), 'po Ukryj pasek znika').toBeUndefined()
    await pasek.unmount()
  })
}

test('bez odczytu tokenów i przy ankiecie pasek milczy', async ($, on) => {
  silnik(on, { tokens: () => undefined })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.find({ type: 'Button', key: 'ukryj' }), 'brak tokens i percent → nic do pokazania').toBeUndefined()
  await pasek.unmount()
})

test('przy ankiecie (hasSurvey) pasek ustępuje miejsca', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000 })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...props, hasSurvey: true } })
  expect(await pasek.find({ type: 'Button', key: 'ukryj' })).toBeUndefined()
  await pasek.unmount()
})

test('wąski terminal: bez progów i kosztu, limity zostają', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, rateLimits: () => limity(37, 61), usd: 0.42 })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...props, bodyColumns: 90 } })
  expect(await pasek.find({ text: /142k \/ 300k/ })).toBeDefined()
  expect(await pasek.find({ text: /WARN 220k/ })).toBeUndefined()
  expect(await pasek.find({ text: /\$0\.42/ })).toBeUndefined()
  expect(await pasek.find({ text: /5h 37 % · 7d 61 %/ })).toBeDefined()
  await pasek.unmount()
})

test('toast raz po przekroczeniu WARN, ponownie dopiero po kompaktacji', async ($, on) => {
  let tokens = 100_000
  const { toasty } = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => tokens })

  await $.turn.complete(tura)
  expect(toasty).toHaveLength(0)

  tokens = 225_000
  await $.turn.complete({ ...tura, turnId: 't2' })
  await $.turn.complete({ ...tura, turnId: 't3' })
  expect(toasty, 'jeden toast na cykl, nie co turę').toHaveLength(1)
  expect(toasty[0]).toContain('225k ≥ WARN 220k')
  expect(toasty[0]).toContain('kanon/stan/test-sid.md')

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'dalej', toolUses: [] }] })
  tokens = 230_000
  await $.turn.complete({ ...tura, turnId: 't4' })
  expect(toasty, 'po kompaktacji flaga zresetowana').toHaveLength(2)
})

test('/budzet: trzy linie — kontekst (okno z settings), limity z czasem do resetu, ostatnie żądanie', async ($, on) => {
  silnik(on, { settings: { autoCompactWindow: 200_000 }, tokens: () => 50_000, rateLimits: () => limity(37, 61), usd: 0.42 })
  await krok($, 'claude-opus-5-5')

  const r = await $.command.run(komenda)
  expect(r.text).toContain('50k / 200k (25 %)')
  expect(r.text, 'okno 200k → WARN okno − 80k').toContain('WARN 120k')
  expect(r.text).toContain('okno budżetu z: settings')
  expect(r.text).toContain('Limity: 5h 37 % (reset za 2 h 10 min) · 7d 61 % (reset za 3 d 4 h) · koszt sesji $0.42')
  expect(r.text, 'model z usage odpowiedzi, udział cache').toContain('Ostatnie żądanie: claude-opus-5-5 · 61k in (58k z cache = 95 %) · 1k out')
})

test('/budzet bez subskrypcji i przed pierwszym krokiem: limity i żądanie mówią „brak”', async ($, on) => {
  silnik(on, { settings: { autoCompactWindow: 200_000 }, tokens: () => 50_000 })

  const r = await $.command.run(komenda)
  expect(r.text).toContain('Limity: brak odczytu')
  expect(r.text).toContain('Ostatnie żądanie: brak kroku')
})

test('krok agenta nie nadpisuje ostatniego żądania głównego wątku', async ($, on) => {
  silnik(on, { settings: { autoCompactWindow: 200_000 }, tokens: () => 50_000 })
  await krok($, 'claude-opus-5-5')
  await krok($, 'claude-sonnet-5-5', 'agent-1')

  const r = await $.command.run(komenda)
  expect(r.text).toContain('Ostatnie żądanie: claude-opus-5-5')
})

test('/budzet: okno per model z modelSettings i próg KANON_CTX_WARN z env', async ($, on) => {
  silnik(on, {
    env: { KANON_CTX_WARN: '150000' },
    settings: { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 300_000 } } },
    tokens: () => 60_000,
  })

  const r = await $.command.run(komenda)
  expect(r.text).toContain('60k / 300k')
  expect(r.text, 'KANON_CTX_WARN wygrywa z regułą okno − 80k').toContain('WARN 150k')
})

test('/budzet: bez env i settings okno = okno modelu z silnika, próg okno − 40k poniżej 200k', async ($, on) => {
  silnik(on, { tokens: () => 30_000, window: 150_000 })

  const r = await $.command.run(komenda)
  expect(r.text).toContain('30k / 150k (20 %)')
  expect(r.text).toContain('WARN 110k')
  expect(r.text).toContain('okno budżetu z: silnik')
})

test('/budzet ukryj i pokaz sterują paskiem', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 90_000 })

  const ukryj = await $.command.run({ ...komenda, args: 'ukryj' })
  expect(ukryj.text).toContain('ukryty')
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.find({ type: 'Button', key: 'ukryj' })).toBeUndefined()

  const pokaz = await $.command.run({ ...komenda, args: 'pokaz' })
  expect(pokaz.text).toContain('90k / 300k')
  await pasek.redraw()
  expect(await pasek.find({ type: 'Button', key: 'ukryj' })).toBeDefined()
  await pasek.unmount()
})

test('session.measure: liczby pchane przez silnik bez wywołania session.usage; toast raz przy czerwonym 7d, reset po spadku', async ($, on) => {
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 90_000 })
  const pomiar = (p7d: number) => ({ ...usage(95_000, 1_000_000, limity(40, p7d), 1.5), changed: ['rateLimits' as const] })

  await $.session.measure(pomiar(85))
  expect(log.odczytyUsage, 'pomiar przyszedł ze zdarzenia').toBe(0)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.find({ text: /95k \/ 300k/ }), 'kontekst z pomiaru').toBeDefined()
  expect(await pasek.find({ text: /5h 40 % · 7d 85 %/ })).toBeDefined()
  expect(log.toasty).toHaveLength(1)
  expect(log.toasty[0]).toContain('7d 85 %')

  await $.session.measure(pomiar(86))
  expect(log.toasty, 'drugi czerwony pomiar bez nowego toastu').toHaveLength(1)
  await $.session.measure(pomiar(30))
  await $.session.measure(pomiar(81))
  expect(log.toasty, 'po spadku poniżej progu flaga wraca').toHaveLength(2)
  await pasek.unmount()
})

test('log JSONL: po turze głównego wątku jedna linia z liczbami i modelem, bez treści; kolejna tura dopisuje', async ($, on) => {
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, rateLimits: () => limity(37, 61), usd: 0.42 })

  await $.turn.complete({ ...tura, answer: 'TAJNA TREŚĆ ODPOWIEDZI', usage: uzycie('claude-opus-5-5') })
  const sciezka = `${HOME}/.claude/kanon/usage/sesje/sesja-test-sid.jsonl`
  expect([...log.pliki.keys()]).toEqual([sciezka])
  const linie = (log.pliki.get(sciezka) ?? '').trimEnd().split('\n')
  expect(linie).toHaveLength(1)
  const w = JSON.parse(linie[0] ?? '')
  expect(w).toEqual({
    t: '2026-10-10T10:00:00.000Z',
    sid: 'test-sid',
    turn: 't1',
    reason: 'answer',
    ms: 10,
    model: 'claude-opus-5-5',
    in: 3000,
    cache_write: 0,
    cache_read: 58_000,
    out: 1200,
    ctx: 142_000,
    p5h: 37,
    p7d: 61,
    usd: 0.42,
  })
  expect(log.pliki.get(sciezka)).not.toContain('TAJNA')

  await $.turn.complete({ ...tura, turnId: 't2', usage: uzycie('claude-sonnet-5-5') })
  expect((log.pliki.get(sciezka) ?? '').trimEnd().split('\n')).toHaveLength(2)
})

test('log JSONL milczy przy KANON_USAGE_LOG=0', async ($, on) => {
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000', KANON_USAGE_LOG: '0' }, tokens: () => 142_000 })
  await $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') })
  expect(log.pliki.size, 'wyłączony zmienną').toBe(0)
})

test('log JSONL milczy przy turze agenta i turze bez usage (przerwanej)', async ($, on) => {
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000 })
  await $.turn.complete({ ...tura, agentId: 'a1', usage: uzycie('claude-sonnet-5-5') })
  await $.turn.complete({ ...tura, turnId: 't2', reason: 'aborted', isAborted: true })
  expect(log.pliki.size).toBe(0)
})

const SCIEZKA = `${HOME}/.claude/kanon/usage/sesje/sesja-test-sid.jsonl`

test('log JSONL: plik istnieje, ale read odmawia (EACCES) → nic nie jest pisane, historia zostaje', async ($, on) => {
  const stara = '{"t":"2026-10-09T00:00:00.000Z","sid":"test-sid"}\n'
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, pliki: { [SCIEZKA]: stara }, czytajBlad: true })
  const r = await $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') })
  expect(r.text, 'tura kończy się normalnie').toBe('')
  expect(log.pliki.get(SCIEZKA), 'błąd odczytu nie może nadpisać historii').toBe(stara)
})

test('log JSONL: historia bez końcowego \\n dostaje go przed nową linią — oba rekordy parsują się osobno', async ($, on) => {
  const stara = '{"t":"2026-10-09T00:00:00.000Z","sid":"test-sid"}'
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, pliki: { [SCIEZKA]: stara } })
  await $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') })
  const linie = (log.pliki.get(SCIEZKA) ?? '').trimEnd().split('\n')
  expect(linie).toHaveLength(2)
  expect(JSON.parse(linie[0] ?? '').t).toBe('2026-10-09T00:00:00.000Z')
  expect(JSON.parse(linie[1] ?? '').turn).toBe('t1')
})

test('log JSONL: plik powyżej 2 MiB → brak dopisania i JEDEN toast, historia nietknięta', async ($, on) => {
  const stara = `${'x'.repeat(2 * 1024 * 1024)}\n`
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, pliki: { [SCIEZKA]: stara } })
  await $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') })
  await $.turn.complete({ ...tura, turnId: 't2', usage: uzycie('claude-opus-5-5') })
  expect(log.pliki.get(SCIEZKA)).toBe(stara)
  expect(log.toasty.filter(t => t.includes('Log zużycia przekroczył'))).toHaveLength(1)
})

test('log JSONL: gdy odświeżenie padło, kontekst i limity w linii są null, nie z poprzedniej tury', async ($, on) => {
  let padnij = false
  const log = silnik(on, {
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' },
    tokens: () => {
      if (padnij) throw new Error('silnik nie odpowiada') // $.session.usage() odrzuca
      return 142_000
    },
    rateLimits: () => limity(37, 61),
    usd: 0.42,
  })
  await $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') })
  padnij = true
  await $.turn.complete({ ...tura, turnId: 't2', usage: uzycie('claude-opus-5-5') })
  const linie = (log.pliki.get(SCIEZKA) ?? '').trimEnd().split('\n').map(l => JSON.parse(l))
  expect(linie[0].ctx).toBe(142_000)
  expect([linie[1].ctx, linie[1].p5h, linie[1].p7d, linie[1].usd]).toEqual([null, null, null, null])
})

test('session.measure i turn.complete równocześnie → jeden toast limitu, nie dwa', async ($, on) => {
  const log = silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 90_000, rateLimits: () => limity(40, 85), usd: 1.5 })
  await Promise.all([
    $.session.measure({ ...usage(95_000, 1_000_000, limity(40, 85), 1.5), changed: ['rateLimits' as const] }),
    $.turn.complete({ ...tura, usage: uzycie('claude-opus-5-5') }),
  ])
  expect(log.toasty.filter(t => t.startsWith('Limit konta'))).toHaveLength(1)
})

test('łańcuch AbovePrompt: pasek składa pod sobą rysunek pluginu niżej (next(e)); gdy milczy (Ukryj), oddaje go bez zmian', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, dno: 'STRAZNIK-PLUGINU-NIZEJ' })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.find({ text: /142k \/ 300k/ }), 'własna linia paska').toBeDefined()
  expect(await pasek.find({ type: 'Text', text: 'STRAZNIK-PLUGINU-NIZEJ' }), 'rysunek pluginu niżej nie zniknął').toBeDefined()
  const teksty = (await pasek.findAll({ type: 'Text' })).map(t => t.text)
  expect(teksty[teksty.length - 1], 'plugin niżej POD paskiem, nie nad nim').toBe('STRAZNIK-PLUGINU-NIZEJ')
  expect(teksty.some(t => t.includes('142k / 300k')), 'linia paska nad nim').toBe(true)
  expect(await pasek.drawn(), 'stos w kolumnie: pasek NAD rysunkiem spod spodu, nie obok').toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })

  const ciasno = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...props, maxRows: 1 } })
  expect(await ciasno.find({ text: /142k \/ 300k/ }), 'jeden wiersz pasma: pasek').toBeDefined()
  expect(await ciasno.find({ type: 'Text', text: 'STRAZNIK-PLUGINU-NIZEJ' }), 'maxRows 1: bez stosu (przewijałby się w zerowym oknie)').toBeUndefined()
  await ciasno.unmount()

  await pasek.press({ key: 'ukryj' })
  expect(await pasek.find({ text: /142k/ }), 'pasek ukryty').toBeUndefined()
  expect(await pasek.find({ type: 'Text', text: 'STRAZNIK-PLUGINU-NIZEJ' }), 'milczący pasek oddaje next(e) bez zmian').toBeDefined()
  await pasek.unmount()
})

test('łańcuch AbovePrompt: dno rdzenia (pusty Box) ląduje pod paskiem bez tekstu — stos nie dodaje wiersza', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000 })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  const boxy = await pasek.findAll({ type: 'Box' })
  expect(boxy, 'kolumna, wiersz paska, pusty Box rdzenia').toHaveLength(3)
  expect(boxy[2]?.children, 'Box rdzenia bez dzieci (w Ink: 0 wierszy)').toHaveLength(0)
  expect((await pasek.findAll({ type: 'Text' })).every(t => t.text.length > 0), 'żadnego pustego tekstu w stosie').toBe(true)
  await pasek.unmount()
})

test('łańcuch AbovePrompt: plugin niżej się wysypuje (dno ui.render rzuca) — pasek rysuje się dalej', async ($, on) => {
  silnik(on, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' }, tokens: () => 142_000, dnoRzuca: true })

  await $.turn.complete(tura)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await pasek.find({ text: /142k \/ 300k/ }), 'fail-open: błąd niżej nie gasi paska').toBeDefined()
  expect(await pasek.find({ type: 'Button', key: 'ukryj' })).toBeDefined()
  await pasek.unmount()
})
