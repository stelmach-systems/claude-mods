// Testy modu kanon-agenci: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: rzeczowniki ($.agent.list, $.ui.open, …) odpowiadają `{ value }`,
// zdarzenia rdzenia (agent.spawn, turn.step, turn.complete, command.run, ui.render) zwracają wynik jak silnik.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, TurnStepResult, TurnUsage } from 'claude-code'

const PLUGIN = 'kanon-agenci'
const PANE = { component: 'Pane' as const, requestId: 'agenci' }
const props = { title: 'Agenci', isFocused: false, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = { command: 'agenci', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const tura = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }

type Dolar = Parameters<Parameters<typeof test>[1]>[0]

const uzycie = (model: string, input = 1000, cache = 30_000, output = 200): TurnUsage => ({
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cache,
  cache_creation_input_tokens: 0,
})
const agent = (id: string, description: string, type = 'czytelnik', status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, description, type, status })

type Silnik = {
  lista?: () => AgentInfo[]
  /** Model, który „odpowiada” w kroku; narzędzia, o które prosi; `bezOdpowiedzi` = krok bez `usage` (przerwanie, błąd API). */
  krok?: (e: { agentId?: string; model: string }) => { model: string; narzedzia?: number; bezOdpowiedzi?: boolean }
  spawn?: { model: string; agentId?: string }
  /** Silnik (albo plugin niżej) odrzuca każdy spawn tym tekstem. */
  deny?: string
  /** Pierwszy krok agenta wpada z dna spawnu, ZANIM spawn odda wynik (kolejność spawn/krok nie jest gwarantowana) — podaj `$` testu (driver). */
  krokPrzedSpawnem?: Dolar
  isPlaced?: boolean
}

/** Dno pod modem. Zwraca rejestr wywołań rzeczowników, które test sprawdza. */
function silnik(on: On, s: Silnik = {}) {
  const log = { list: 0, open: [] as string[], close: [] as string[], status: [] as (string | undefined)[] }
  let n = 0
  mock.clock(on)
  mock.env(on, {})
  on('session.id', () => ({ value: 'test-sid' }))
  on('agent.list', () => {
    log.list += 1
    return { value: s.lista ? s.lista() : [] }
  })
  on('agent.spawn', async () => {
    if (s.deny) return { deny: s.deny }
    const agentId = s.spawn?.agentId ?? `a${++n}`
    if (s.krokPrzedSpawnem) await krok(s.krokPrzedSpawnem, agentId) // `$` hooka dna nie ma driverów — krok jedzie przez `$` testu
    return { model: s.spawn?.model ?? 'claude-sonnet-5-5', agentId }
  })
  on('turn.step', async function* (_$, e): AsyncGenerator<never, TurnStepResult> {
    const w = s.krok ? s.krok(e) : { model: e.model, narzedzia: 0 }
    const toolUses = Array.from({ length: w.narzedzia ?? 0 }, () => ({ name: 'Read', input: {} }))
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses,
      stopReason: toolUses.length ? 'tool_use' : 'end_turn',
      usage: w.bezOdpowiedzi ? null : uzycie(w.model),
    }
  })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({}))
  on('ui.open', (_$, e) => {
    log.open.push(e.id)
    return { value: s.isPlaced === false ? { isPlaced: false as const, reason: 'terminal ma 100 kolumn, próg 144' } : { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    log.close.push(e.id)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    log.status.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  return log
}

/** Jeden krok pętli (żądanie do modelu) widziany przez mod. */
async function krok($: Dolar, agentId: string | undefined, model = 'claude-sonnet-5-5', index = 0) {
  const s = $.turn.step({ turnId: `t-${agentId ?? 'main'}`, index, model, messageCount: 3, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) {
    // chunki nie są potrzebne — liczy się wynik
  }
  return s.result
}

async function spawn($: Dolar, description: string, subagentType = 'czytelnik') {
  return $.agent.spawn({ prompt: 'zadanie', description, subagentType })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`spawn + 2 kroki: wiersz z realnym modelem, licznikiem żądań i narzędzi, licznik spawnów (${surface})`, async ($, on) => {
    silnik(on, { krok: () => ({ model: 'claude-sonnet-5-5', narzedzia: 2 }) })
    const r = await spawn($, '[S5.5MD] Rekonesans katalogu src')
    expect(r.agentId).toBe('a1')
    await krok($, 'a1', 'claude-sonnet-5-5', 0)
    await krok($, 'a1', 'claude-sonnet-5-5', 1)

    const t = await $.command.run({ ...komenda, args: 'tekst' })
    expect(t.text).toContain('spawny (mod): 1 · próg hooka kanon-agent-limit: 10 prób Agent')
    expect(t.text).toContain('[S5.5] czytelnik — „[S5.5MD] Rekonesans katalogu src” · running · 2 żądań · 4 narzędzi')
    expect(t.text, 'tokeny: 2 × (1000 + 30k cache) in, 2 × 200 out').toContain('62k in (60k cache) · 0k out')
    expect(t.text, 'tag S5.5 zgodny z modelem → bez ostrzeżenia').not.toContain('tag≠model')

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props })
    expect(await pane.find({ text: /agenci: 1 \(1 aktywnych · 0 zakończonych\)/ })).toBeDefined()
    expect(await pane.find({ text: /● \[S5\.5\] czytelnik/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'zak-suma' })).toBeDefined()
    await pane.unmount()
  })
}

test('rozjazd tagu z modelem: opis mówi S5.5, odpowiada Opus 5.5 → ⚠ tag≠model', async ($, on) => {
  silnik(on, { krok: () => ({ model: 'claude-opus-5-5' }) })
  await spawn($, '[S5.5MD] Recenzja diffu', 'recenzent')
  await krok($, 'a1', 'claude-opus-5-5')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('[OP5.5] recenzent')
  expect(t.text).toContain('⚠ tag≠model (S5.5→OP5.5)')
})

test('kod modelu z granicą: data i prefiks dostawcy przechodzą, opus-5-6 to OP5.6 (nie OP5), id spoza wzorca nie ostrzega', async ($, on) => {
  const modele: Record<string, string> = {
    a1: 'claude-opus-5-5-20260101',
    a2: 'us.anthropic.claude-sonnet-5-5-20260101-v1:0',
    a3: 'claude-opus-5-6',
    a4: 'model-spoza-rodziny',
  }
  silnik(on, { krok: e => ({ model: modele[e.agentId ?? ''] }) })
  await spawn($, '[OP5.5HI] z datą')
  await spawn($, '[S5.5MD] przez dostawcę')
  await spawn($, '[OP5.5HI] nowsza wersja')
  await spawn($, '[S5.5MD] obcy model')
  for (const id of Object.keys(modele)) await krok($, id, modele[id])

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('[OP5.5] czytelnik — „[OP5.5HI] z datą” · running')
  expect(t.text).toContain('[S5.5] czytelnik — „[S5.5MD] przez dostawcę” · running')
  expect(t.text).toContain('⚠ tag≠model (OP5.5→OP5.6)')
  expect(t.text).toContain('[model-spoza-rodziny] czytelnik — „[S5.5MD] obcy model” · running')
  expect((t.text.match(/tag≠model/g) ?? []).length, 'ostrzega tylko opus-5-6').toBe(1)
})

test('krok bez odpowiedzi (usage: null) nie liczy się jako żądanie i nie ustawia modelu — bez fałszywego ⚠', async ($, on) => {
  silnik(on, { krok: () => ({ model: 'claude-opus-5-5', bezOdpowiedzi: true }) })
  await spawn($, '[S5.5MD] Przerwany')
  await krok($, 'a1', 'claude-opus-5-5')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text, 'model z spawnu, nie z żądania bez odpowiedzi').toContain('[S5.5] czytelnik — „[S5.5MD] Przerwany” · running · bez kroków widzianych przez mod')
  expect(t.text).not.toContain('tag≠model')
})

test('krok z agentId spoza listy i bez spawnu (fork silnika): każdy krok liczony jako pominięty, lista pytana raz na id', async ($, on) => {
  const log = silnik(on, { lista: () => [] })
  await krok($, 'fork-kompaktacja', 'claude-opus-5-5', 0)
  await krok($, 'fork-kompaktacja', 'claude-opus-5-5', 1)

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('pominięte kroki (workflow, forki silnika): 2')
  expect(t.text).toContain('Brak agentów w tej sesji.')
  expect(log.list, 'agent.list: raz dla nieznanego id (drugi krok z pamięci modułu) + raz przy podsumowaniu').toBe(2)
})

test('krok agenta, którego spawnu mod nie widział, ale lista go zna → wiersz z listy', async ($, on) => {
  silnik(on, { lista: () => [agent('x9', 'Czytanie logów', 'Explore')] })
  await krok($, 'x9', 'claude-sonnet-5-5')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('[S5.5] Explore — „Czytanie logów” · running · 1 żądań')
  expect(t.text).toContain('spawny (mod): 0')
})

test('krok wyprzedza spawn (lista pusta): krok czeka w buforze, spawn zabiera go do wiersza, „pominięte” nie zostaje', async ($, on) => {
  silnik(on, { krokPrzedSpawnem: $ })
  await spawn($, '[S5.5MD] Wyścig')
  await krok($, 'a1')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('[S5.5] czytelnik — „[S5.5MD] Wyścig” · running · 2 żądań')
  expect(t.text).not.toContain('pominięte')
  expect(t.text).toContain('spawny (mod): 1')
})

test('krok wyprzedza spawn (lista zna agenta): wiersz z listy dostaje opis, typ i model ze spawnu, liczniki zostają', async ($, on) => {
  silnik(on, { krokPrzedSpawnem: $, lista: () => [agent('a1', 'opis z listy', 'Explore')], spawn: { model: 'claude-opus-5-5', agentId: 'a1' } })
  await spawn($, '[S5.5MD] Właściwy opis', 'czytelnik')
  await krok($, 'a1')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('[S5.5] czytelnik — „[S5.5MD] Właściwy opis” · running · 2 żądań')
  expect(t.text).not.toContain('opis z listy')
})

test('agent na liście bez żadnego kroku też jest widoczny; status z listy wygrywa; czas „—”, nie zera', async ($, on) => {
  silnik(on, { lista: () => [agent('t1', 'Teammate czeka', 'teammate', 'idle'), agent('t2', 'Padł', 'general-purpose', 'failed')] })

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect(await pane.find({ text: /agenci: 2 \(1 aktywnych · 1 zakończonych\)/ })).toBeDefined()
  expect(await pane.find({ text: /● \[\?\] teammate — „Teammate czeka” · idle · bez kroków widzianych przez mod · —/ }), 'zakładka Aktywni: idle jest aktywny').toBeDefined()
  expect(await pane.find({ text: /Padł/ }), 'failed nie jest aktywny — nie na zakładce Aktywni').toBeUndefined()

  await pane.press({ key: 'zak-wszyscy' })
  expect(await pane.find({ text: /○ \[\?\] general-purpose — „Padł” · failed/ })).toBeDefined()
  await pane.unmount()
})

test('turn.complete pętli agenta zamyka wiersz: status completed, znika z Aktywnych; linia statusu liczy ▶/✓', async ($, on) => {
  const log = silnik(on)
  await spawn($, '[S5.5MD] Krótkie zadanie')
  await krok($, 'a1')
  await $.turn.complete({ ...tura, agentId: 'a1', usage: uzycie('claude-sonnet-5-5') })

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('agenci: 1 (0 aktywnych · 1 zakończonych)')
  expect(t.text).toContain('· completed ·')
  expect(log.status.at(-1)).toBe('agenci 0▶ 1✓')

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  expect(await pane.find({ text: /Żaden agent nie biegnie\./ })).toBeDefined()
  await pane.unmount()
})

test('agent wznowiony po turn.complete (wiadomość, teammate): kolejny krok znów otwiera wiersz — panel i linia statusu zgodne', async ($, on) => {
  const log = silnik(on, { lista: () => [agent('a1', '[S5.5MD] Teammate', 'teammate', 'running')] })
  await spawn($, '[S5.5MD] Teammate', 'teammate')
  await krok($, 'a1', 'claude-sonnet-5-5', 0)
  await $.turn.complete({ ...tura, agentId: 'a1', usage: uzycie('claude-sonnet-5-5') })
  expect(log.status.at(-1)).toBe('agenci 0▶ 1✓')
  await krok($, 'a1', 'claude-sonnet-5-5', 1)

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text).toContain('agenci: 1 (1 aktywnych · 0 zakończonych)')
  expect(t.text).toContain('· running · 2 żądań')
  expect(log.status.at(-1), 'pasek zgodny z panelem').toBe('agenci 1▶ 0✓')
})

test('zakładka Suma: tokeny per model agentów + główny wątek z kroków bez agentId', async ($, on) => {
  silnik(on, { krok: e => ({ model: e.agentId ? 'claude-sonnet-5-5' : 'claude-fable-5-1', narzedzia: 1 }) })
  await spawn($, '[S5.5MD] A')
  await spawn($, '[S5.5MD] B')
  await krok($, 'a1')
  await krok($, 'a2')
  await krok($, undefined, 'claude-fable-5-1', 0)
  await krok($, undefined, 'claude-fable-5-1', 1)

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  await pane.press({ key: 'zak-suma' })
  expect(await pane.find({ text: /S5\.5: 2 agentów · 62k in \(60k cache\) · 0k out/ })).toBeDefined()
  expect(await pane.find({ text: /główny wątek \[F5\.1\]: 2 żądań · 2 narzędzi · 62k in \(60k cache\)/ })).toBeDefined()
  await pane.unmount()
})

test('/agenci otwiera panel (asked → dowolna szerokość); bez miejsca dopisuje powód; „zamknij” zamyka', async ($, on) => {
  const log = silnik(on, { isPlaced: false })
  const r = await $.command.run(komenda)
  expect(log.open).toEqual(['agenci'])
  expect(r.text).toContain('Brak agentów w tej sesji.')
  expect(r.text).toContain('Panel czeka na szersze okno: terminal ma 100 kolumn')

  const z = await $.command.run({ ...komenda, args: 'zamknij' })
  expect(log.close).toEqual(['agenci'])
  expect(z.text).toContain('zamknięty')
})

test('pusty stan: panel bez agentów mówi to wprost, licznik spawnów 0', async ($, on) => {
  silnik(on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  expect(await pane.find({ text: /Brak agentów w tej sesji\./ })).toBeDefined()
  expect(await pane.find({ text: /spawny \(mod\): 0/ })).toBeDefined()
  await pane.unmount()
})

test('spawn odrzucony przez silnik lub inny plugin ({ deny }): licznik spawnów rośnie, wiersza nie ma', async ($, on) => {
  silnik(on, { deny: 'limit testu' })
  const r = await $.agent.spawn({ prompt: 'zadanie', description: '[S5.5MD] Odrzucony', subagentType: 'czytelnik' })
  expect(r.deny).toBe('limit testu')

  const t = await $.command.run({ ...komenda, args: 'tekst' })
  expect(t.text, 'spawn dotarł do hooka — liczy się jak próba').toContain('spawny (mod): 1')
  expect(t.text).toContain('Brak agentów w tej sesji.')
})
