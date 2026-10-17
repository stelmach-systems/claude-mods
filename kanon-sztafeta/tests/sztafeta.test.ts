// Testy modu kanon-sztafeta: `claude plugin test <folder modu>` (CLI 2.1.289 i desktop 2.1.299).
// Hooki `on` testu stoją POD modem i odgrywają silnik oraz aplikację desktop (serwer MCP `ccd_session`): rzeczowniki ($.session.usage,
// $.fs.*, $.mcp.call, $.prompt.fill, $.ui.copy, …) odpowiadają `{ value }`, zdarzenia rdzenia (session.start, session.compact, turn.complete,
// session.measure, command.run, ui.render) zwracają wynik jak silnik. Pliki stanu w testach to syntetyczne fixtures (./fixtures.ts).
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LIMIT_SKROTU, bajty, brief, godzinaZ, podziel, utnij, zbudujSkrot } from '../hooks/register'
import { DOPISEK, DUZY, KOMPAKTACJA, MALY, STAN_NAGLOWEK, STAN_PELNY, Z_DOPISKIEM } from './fixtures'

const PLUGIN = 'kanon-sztafeta'
const TERAZ = Date.parse('2026-10-16T22:00:00Z')
const H = 3_600_000
const HOME = '/tmp/dom-testu'
const SID = 'ccb20c0d-0000-4000-8000-000000000000'
const CWD = `${HOME}/Developer/claude-mods`
const STAN = `${HOME}/.claude/kanon/stan/${SID}.md`
const SKROT = `${HOME}/.claude/kanon/stan/${SID}-skrot.md`
const PASEK = { component: 'AbovePrompt' as const }
const pasekProps = { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 160, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const PANE = { component: 'Pane' as const, requestId: 'sztafeta' }
const paneProps = { title: 'Sztafeta', isFocused: true, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = { command: 'sztafeta', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const tura = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }
const POWIERZCHNIE = ['terminal', 'desktop'] as const
type Dolar = Parameters<TestBody>[0]

type Silnik = {
  env?: Record<string, string>
  /** `$.session.usage().startedAt`; 0 = silnik nie zna początku → mod bierze zegar przy session.start. */
  startedAt?: number
  tokens?: number
  window?: number
  /** Treść pliku stanu tej sesji na starcie; brak = pliku nie ma. */
  plik?: string
  /** Serwer ccd_session: 'ok' (karta zaproponowana), 'isError' (odpowiedź isError bez prefiksu „Error”), 'prefiks' (tekst „Error: …”
   *  bez isError — jak silnik przy przekroczeniu limitu wyniku), 'deny' (serwer niepodłączony — $.mcp.call rzuca). */
  mcp?: 'ok' | 'isError' | 'prefiks' | 'deny'
  /** Dno odpowiada na session.compact pominięciem (`{ skip }`) — kompaktacja zawetowana. */
  kompaktacjaPominieta?: boolean
  /** Żadna powierzchnia nie sadza panelu ($.ui.open → isPlaced: false). */
  panelBezMiejsca?: boolean
  /** Każdy `fs.read` odmawia (EACCES) — plik istnieje, ale nie da się go przeczytać. */
  czytajBlad?: boolean
  /** Napis, który rysuje plugin NIŻEJ w łańcuchu AbovePrompt: dno `ui.render` zwraca wtedy Text z nim zamiast pustego Box (rdzeń). */
  dno?: string
  /** Dno `ui.render` rzuca (plugin niżej się wysypał) — pasek ma zostać (fail-open na `next`). */
  dnoRzuca?: boolean
}

/** Dno pod modem: liczby z „silnika”, dysk w pamięci, aplikacja desktop jako serwer MCP. Zwraca rejestr do asercji i zegar. */
function silnik(on: On, s: Silnik = {}) {
  const log = {
    toasty: [] as string[],
    pliki: new Map<string, string>(),
    mcp: [] as { server: string; tool: string; args: Record<string, unknown> }[],
    fill: [] as string[],
    copy: [] as string[],
    otwarcia: 0,
    zamkniecia: 0,
  }
  if (s.plik !== undefined) log.pliki.set(STAN, s.plik)
  const zegar = mock.clock(on, { now: TERAZ })
  mock.env(on, { HOME, ...(s.env ?? {}) })
  on('settings.read', () => ({ value: {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => {
    const window = s.window ?? 1_000_000
    const context = s.tokens === undefined ? { window } : { tokens: s.tokens, window, percent: Math.round((s.tokens / window) * 100) }
    return { value: { startedAt: s.startedAt ?? 0, context, rateLimits: [] } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.compact', (_$, e) => (s.kompaktacjaPominieta ? { skip: 'test' } : { messages: e.messages, tokensBefore: 250_000, tokensAfter: 40_000 }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.run', () => ({}))
  // Dno łańcucha ui.render: pusty Box jak rdzeń silnika, albo — z `dno` — Text ze strażnikiem, jak plugin niżej w łańcuchu.
  on('ui.render', ($, e) => {
    if (s.dnoRzuca) throw new Error('dno ui.render padło (test)')
    return s.dno === undefined ? $.ui.resolve(e).Box({}) : $.ui.resolve(e).Text({ children: s.dno })
  })
  on('ui.toast', (_$, e) => {
    log.toasty.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => {
    log.otwarcia += 1
    return { value: s.panelBezMiejsca ? { isPlaced: false as const, reason: 'brak powierzchni' } : { isPlaced: true as const } }
  })
  on('ui.close', () => {
    log.zamkniecia += 1
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    log.copy.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.fill', (_$, e) => {
    log.fill.push(e.text)
    return { isFilled: true }
  })
  on('fs.exists', (_$, e) => ({ value: log.pliki.has(e.path) }))
  on('fs.stat', (_$, e) => {
    const t = log.pliki.get(e.path)
    if (t === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, size: t.length, mtimeMs: TERAZ - 12 * 60_000, isLink: false } }
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
  on('mcp.call', (_$, e) => {
    log.mcp.push({ server: e.server, tool: e.tool, args: { ...e.args } })
    if (s.mcp === 'deny') return { deny: `MCP server "${e.server}" is not connected` }
    if (s.mcp === 'isError') return { value: { content: [{ type: 'text', text: 'start_session refused: not while working on a message from another session' }], isError: true } }
    if (s.mcp === 'prefiks') return { value: { content: [{ type: 'text', text: 'Error: result (90,203 characters) exceeds maximum allowed tokens.' }], isError: false } }
    return { value: { content: [{ type: 'text', text: 'Proposed task task_ab12cd34; the user can start it from the card.' }], isError: false } }
  })
  return { log, zegar }
}

const start = ($: Dolar) => $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
const kompaktuj = ($: Dolar, extra: { agentId?: string; trigger?: 'auto' | 'precompute' } = {}) =>
  $.session.compact({ trigger: extra.trigger ?? 'auto', messages: [{ role: 'user', text: 'dalej', toolUses: [] }], ...(extra.agentId ? { agentId: extra.agentId } : {}) })
const pomiar = (tokens: number) => ({ startedAt: 0, context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) }, rateLimits: [], changed: ['context' as const] })

for (const surface of POWIERZCHNIE) {
  test(`świeża sesja: bez kompaktacji, młodsza niż 8 h, poniżej WARN → paska nie ma (${surface})`, async ($, on) => {
    silnik(on, { plik: MALY, tokens: 50_000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } })
    await start($)
    await $.turn.complete(tura)
    const pasek = await $.ui.mount({ plugin: PLUGIN, surface, ...PASEK, props: pasekProps })
    expect(await pasek.find({ type: 'Button', key: 'przekaz' })).toBeUndefined()
    expect(await pasek.find({ text: /sztafeta/ })).toBeUndefined()
    await pasek.unmount()
  })

  test(`pasek po kompaktacji głównego wątku; kompaktacja agenta i precompute się nie liczą (${surface})`, async ($, on) => {
    silnik(on, { plik: MALY })
    await start($)
    await kompaktuj($, { agentId: 'a1' })
    await kompaktuj($, { trigger: 'precompute' })
    const pasek = await $.ui.mount({ plugin: PLUGIN, surface, ...PASEK, props: pasekProps })
    expect(await pasek.find({ type: 'Button', key: 'przekaz' }), 'agent i precompute nie liczą się').toBeUndefined()

    await kompaktuj($)
    await pasek.redraw()
    expect(await pasek.find({ text: /^1 kompaktacja · sesja 0 min · stan: 23:37 \(12 min temu, „## Stan” #2\)$/ }), 'godzina z nagłówka ostatniej sekcji, liczba sekcji z pliku').toBeDefined()
    expect(await pasek.find({ type: 'Button', key: 'przekaz' })).toBeDefined()
    expect(await pasek.find({ type: 'Button', key: 'pokaz' })).toBeDefined()

    await kompaktuj($)
    await pasek.redraw()
    expect(await pasek.find({ text: /^2 kompaktacje · / })).toBeDefined()
    await pasek.unmount()
  })
}

test('kompaktacja zawetowana (skip) nie liczy się; /clear zeruje liczniki, bo session.start wtedy nie odpala', async ($, on) => {
  const { zegar } = silnik(on, { plik: MALY, kompaktacjaPominieta: true, startedAt: TERAZ - 9 * H })
  await start($)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /^0 kompaktacji · sesja 9 h · stan: 23:37/ }), 'pominięta kompaktacja = 0, pasek z wieku').toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } })
  await zegar.advance(5 * 60_000)
  expect(await pasek.find({ type: 'Button', key: 'przekaz' }), 'po /clear świeża rozmowa bez paska').toBeUndefined()
  await pasek.unmount()
})

test('pasek po 8 h: wiek z $.session.usage().startedAt; 7 h 59 min jeszcze nie, timer co 5 min odświeża bez tury', async ($, on) => {
  const { zegar } = silnik(on, { plik: MALY, startedAt: TERAZ - 8 * H + 60_000 })
  await start($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ type: 'Button', key: 'przekaz' }), '7 h 59 min < próg').toBeUndefined()

  await zegar.advance(5 * 60_000)
  expect(await pasek.find({ text: /^0 kompaktacji · sesja 8 h · stan: 23:37/ }), 'po tyknięciu timera pasek rysuje się na nowo z nowym wiekiem').toBeDefined()
  await pasek.unmount()
})

test('początek sesji nieznany silnikowi (startedAt 0) → zegar przy session.start; po 8 h pasek', async ($, on) => {
  const { zegar } = silnik(on, { plik: MALY })
  await start($)
  await zegar.advance(8 * H)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /sesja 8 h/ })).toBeDefined()
  await pasek.unmount()
})

test('pasek przy kontekście ≥ WARN (okno z env, próg okno − 80k): tura agenta nie liczy się, tura główna i session.measure tak; znika po spadku', async ($, on) => {
  silnik(on, { plik: MALY, tokens: 225_000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } })
  await start($)
  await $.turn.complete({ ...tura, agentId: 'a1' })
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ type: 'Button', key: 'przekaz' }), 'kontekst z tury agenta nie jest kontekstem głównego wątku').toBeUndefined()

  await $.turn.complete(tura)
  await pasek.redraw()
  expect(await pasek.find({ text: /^0 kompaktacji · sesja 0 min · stan: 23:37 \(12 min temu, „## Stan” #2\) · kontekst 225k ≥ WARN 220k$/ })).toBeDefined()
  await $.session.measure(pomiar(226_000))
  await pasek.redraw()
  expect(await pasek.find({ text: /kontekst 226k ≥ WARN 220k/ }), 'pomiar pchany przez silnik nadpisuje').toBeDefined()

  await $.session.measure(pomiar(100_000))
  await pasek.redraw()
  expect(await pasek.find({ type: 'Button', key: 'przekaz' }), 'poniżej WARN bez innych warunków pasek milczy').toBeUndefined()
  await pasek.unmount()
})

test('parser: ostatnia sekcja „## Stan” i ostatni blok kompaktacji z pliku ≥ 300 KB; H2 „Kompaktacja-odporne” to nie blok; utnij nie rozcina pary zastępczej', () => {
  expect(bajty(DUZY) >= 300 * 1024, 'fixture ma rozmiar realnego dużego pliku').toBe(true)
  const p = podziel(DUZY)
  expect(p.stan?.startsWith(STAN_NAGLOWEK), 'ostatnia sekcja, nie pierwsza').toBe(true)
  expect(p.stan).toContain('### Pliki i commity')
  expect(p.stan).not.toContain('STARA-SEKCJA-ZNACZNIK')
  expect(p.stan).not.toContain('## Kompaktacja')
  expect(p.stany).toBe((DUZY.match(/^## Stan\b/gm) ?? []).length)
  expect(p.kompaktacja?.startsWith('## Kompaktacja 100 —'), 'ostatni blok hooka, nie ostatnie podsumowanie').toBe(true)
  expect(p.kompaktacja).toContain('(blok 100)')

  expect(podziel('')).toEqual({ stany: 0, stan: null, kompaktacja: null })
  expect(podziel('## Kompaktacja-odporne notatki\n- tekst\n## Standard pracy\n- x').kompaktacja).toBe(null)
  expect(podziel('## Kompaktacja-odporne notatki\n- tekst\n## Standard pracy\n- x').stany, '„## Standard” to nie „## Stan”').toBe(0)
  expect(podziel('## Stan — 2026-10-10T10:16Z (asystent, po kompaktacji 4)\n- a\n\n## Podsumowanie kompaktacji — 2026-10-10 10:20\ntekst').stan).toBe('## Stan — 2026-10-10T10:16Z (asystent, po kompaktacji 4)\n- a')

  const lokalnie = (iso: string) => {
    const d = new Date(Date.parse(iso))
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  expect(godzinaZ('## Stan 2026-10-16 23:37 (asystent)')).toBe('23:37')
  expect(godzinaZ('## Stan — 2026-10-10T10:16Z (asystent, po kompaktacji 4)'), 'Z → strefa silnika, jak zapas z mtime').toBe(lokalnie('2026-10-10T10:16:00Z'))
  expect(godzinaZ('## Stan 2026-09-27 (asystent) — PAUZA po 1:30 h pracy, zapis 22:10'), 'czas trwania to nie godzina').toBe('22:10')
  expect(godzinaZ('## Stan 2026-10-12 00:xx (asystent, po kompaktacji 3)')).toBe(null)
  expect(godzinaZ('## Stan (asystent, 04.10.2026, po konwersji 123:45)')).toBe(null)

  expect(bajty('aé😀')).toBe(7)
  expect(utnij('aé😀', 6)).toBe('aé')
  expect(utnij('aé😀', 7)).toBe('aé😀')
})

test('brief: „dalej” i „decyzje” z ostatniej sekcji bez „Zrobione”; dopisek bez podsekcji → cała sekcja; brak sekcji → komunikat', () => {
  const b = brief(STAN_PELNY, SKROT, CWD)
  const linie = b.split('\n')
  expect(linie[0]).toBe(`wczytaj ${SKROT}`)
  expect(linie[linie.length - 1]).toBe(`repo: ${CWD}`)
  expect(b).toContain('dalej:\n- Czekam na notatkę z sesji budującej drugi mod')
  expect(b).toContain('decyzje:\n- Właściciel (23:35): „Zacznij od drugiego modu; sztafetę potem.”')
  expect(b).not.toContain('Analiza 42 transkryptów')
  expect(b).not.toContain('### ')

  const d = brief(DOPISEK, SKROT, CWD)
  expect(d).toContain('stan (sekcja bez podsekcji „Dalej” i „Decyzje”):')
  expect(d).toContain('- Faza 6a (pełny zestaw testów)')
  expect(d).not.toContain('## Stan')

  const n = brief(null, SKROT, CWD)
  expect(n).toContain('brak sekcji „## Stan”')
  expect(n).not.toContain('wczytaj')
  expect(n).toContain(`repo: ${CWD}`)
})

test('/sztafeta skrot na małym pliku: ostatnia sekcja + ostatni blok kompaktacji, bez przycięcia; jedyny zapis modu = <sid>-skrot.md', async ($, on) => {
  const { log } = silnik(on, { plik: MALY })
  await start($)
  const r = await $.command.run({ ...komenda, args: 'skrot' })
  expect(r.text).toContain(`Skrót zapisany: ${SKROT}`)
  expect(r.text).not.toContain('przycięto')
  expect([...log.pliki.keys()]).toEqual([STAN, SKROT])
  const t = log.pliki.get(SKROT) ?? ''
  expect(t.startsWith(`# Skrót stanu sesji ${SID} — zapisany 2026-10-16T22:00:00.000Z`)).toBe(true)
  expect(t).toContain(STAN_NAGLOWEK)
  expect(t).toContain('## Kompaktacja 2 —')
  expect(t).not.toContain('STARA-SEKCJA-ZNACZNIK')
  expect(t).not.toContain('## Kompaktacja 1 —')
  expect(bajty(t) < LIMIT_SKROTU).toBe(true)
})

test('/sztafeta skrot: blok kompaktacji 20 KB → skrót ≤ 8 KB, przycięty od końca bloku, z adnotacją i ścieżką pełnego pliku', async ($, on) => {
  const { log } = silnik(on, { plik: Z_DOPISKIEM })
  await start($)
  const r = await $.command.run({ ...komenda, args: 'skrot' })
  expect(r.text).toContain('przycięto do 8 KB')
  const t = log.pliki.get(SKROT) ?? ''
  expect(bajty(t) <= LIMIT_SKROTU, `${bajty(t)} B`).toBe(true)
  expect(t).toContain('## Stan 2026-10-15 22:48 (asystent) — dopisek: faza 6a bramki odebrana')
  expect(t).toContain('- Fazy 6b i 7 biegną; commit po ich odbiorze.')
  expect(t).toContain('## Podsumowanie kompaktacji — 2026-10-16 22:12')
  expect(t).toContain('3. Files and Code Sections:')
  expect(t.trimEnd().endsWith(`_(przycięto do 8 KB; pełny plik: ${STAN})_`)).toBe(true)
  expect(t).not.toContain(STAN_NAGLOWEK)

  // Sekcja „## Stan” sama większa niż limit: blok kompaktacji wypada, przycina się sekcja.
  const duzyStan = { stany: 1, stan: `## Stan x\n${'y'.repeat(20_000)}`, kompaktacja: '## Kompaktacja 1 — a\n- b' }
  const s = zbudujSkrot(duzyStan, '# głowa', STAN)
  expect(s.przycieto).toBe(true)
  expect(bajty(s.tekst) <= LIMIT_SKROTU).toBe(true)
  expect(s.tekst).not.toContain('## Kompaktacja 1')
  expect(s.tekst.startsWith('# głowa\n\n## Stan x\nyyyy')).toBe(true)

  // Granica: całość 8191 B → bez przycięcia (plus końcowy \n = 8192 B); 8192 B → przycięcie, nigdy 8193.
  const naGranicy = (n: number) => zbudujSkrot({ stany: 1, stan: `## Stan x\n${'y'.repeat(n)}`, kompaktacja: null }, '# g', STAN)
  const tuzPod = naGranicy(8176)
  expect([tuzPod.przycieto, bajty(tuzPod.tekst)]).toEqual([false, 8192])
  const naLimicie = naGranicy(8177)
  expect(naLimicie.przycieto).toBe(true)
  expect(bajty(naLimicie.tekst) <= LIMIT_SKROTU, `${bajty(naLimicie.tekst)} B`).toBe(true)
})

for (const surface of POWIERZCHNIE) {
  test(`klik „Przekaż do nowej sesji” → start_session z briefem (own_initiative, fresh, background ≥ 80 znaków), skrót na dysku, bez promptu i schowka (${surface})`, async ($, on) => {
    const { log } = silnik(on, { plik: MALY, mcp: 'ok' })
    await start($)
    await kompaktuj($)
    const pasek = await $.ui.mount({ plugin: PLUGIN, surface, ...PASEK, props: pasekProps })
    await pasek.press({ key: 'przekaz' })

    expect(log.mcp).toHaveLength(1)
    const w = log.mcp[0]!
    expect([w.server, w.tool]).toEqual(['ccd_session', 'start_session'])
    expect(w.args.initiation).toBe('own_initiative')
    expect(w.args.context).toBe('fresh')
    expect(w.args.title).toBe('Sztafeta z sesji ccb20c0d (1 kompaktacja)')
    expect(w.args.prompt, 'prompt = brief z ostatniej sekcji').toBe(brief(STAN_PELNY, SKROT, CWD))
    const background = String(w.args.background)
    expect(background.length >= 80, `background ${background.length} znaków`).toBe(true)
    expect(background).toContain(`z sesji ${SID} w ${CWD}: 1 kompaktacja, wiek 0 min`)
    expect(background).toContain(`skrót (≤ 8 KB): ${SKROT}`)
    expect(log.pliki.has(SKROT), 'skrót zapisany przed kartą').toBe(true)
    expect(log.toasty[log.toasty.length - 1]).toContain('karta nowej sesji gotowa')
    expect(log.fill, 'bez zapasu, gdy serwer odpowiedział').toHaveLength(0)
    expect(log.copy).toHaveLength(0)
    await pasek.unmount()
  })
}

const POWODY = {
  deny: ['$.mcp.call rzuca — serwer niepodłączony', 'is not connected'],
  isError: ['odpowiedź isError bez prefiksu „Error”', 'start_session refused'],
  prefiks: ['tekst „Error: …” bez isError', 'exceeds maximum allowed tokens'],
} as const
for (const tryb of ['deny', 'isError', 'prefiks'] as const) {
  test(`zapas, gdy start_session nie zadziała (${POWODY[tryb][0]}): brief do promptu i schowka, toast z powodem`, async ($, on) => {
    const { log } = silnik(on, { plik: MALY, mcp: tryb })
    await start($)
    await kompaktuj($)
    const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PASEK, props: pasekProps })
    await pasek.press({ key: 'przekaz' })

    expect(log.mcp, 'jedna próba, bez ponawiania').toHaveLength(1)
    const oczekiwany = brief(STAN_PELNY, SKROT, CWD)
    expect(log.fill).toEqual([oczekiwany])
    expect(log.copy).toEqual([oczekiwany])
    const toast = log.toasty[log.toasty.length - 1] ?? ''
    expect(toast).toContain('start_session nie zadziałał')
    expect(toast).toContain(POWODY[tryb][1])
    expect(toast).toContain('brief w oknie promptu i w schowku')
    expect(log.pliki.has(SKROT), 'skrót i tak zapisany').toBe(true)
    await pasek.unmount()
  })
}

test('/sztafeta: panel z ostatnią sekcją pliku ≥ 300 KB i briefem; „Pokaż „dalej”” otwiera ten sam panel; „Zamknij” zamyka', async ($, on) => {
  const { log } = silnik(on, { plik: DUZY })
  await start($)
  const r = await $.command.run(komenda)
  expect(r.text).toBe(`Sztafeta: „${STAN_NAGLOWEK}” (ostatnia z ${podziel(DUZY).stany}); brief w panelu, skrót zapisze przycisk albo /sztafeta skrot.`)
  expect(log.otwarcia).toBe(1)

  const panel = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect(await panel.find({ text: STAN_NAGLOWEK })).toBeDefined()
  expect(await panel.find({ text: /### Dalej\n- Czekam na notatkę/ }), 'treść sekcji bez nagłówka').toBeDefined()
  expect(await panel.find({ text: /STARA-SEKCJA-ZNACZNIK/ })).toBeUndefined()
  expect(await panel.find({ text: /^wczytaj .*-skrot\.md\ndalej:\n- Czekam/ }), 'brief pod sekcją').toBeDefined()
  expect(await panel.find({ type: 'Button', key: 'przekaz' })).toBeDefined()
  await panel.press({ key: 'zamknij' })
  expect(log.zamkniecia).toBe(1)
  await panel.unmount()

  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  await pasek.press({ key: 'pokaz' })
  expect(log.otwarcia, '„Pokaż „dalej”” = ten sam panel').toBe(2)
  expect(log.mcp, 'bez start_session').toHaveLength(0)
  await pasek.unmount()
})

test('bez pliku stanu: pasek „stan: brak pliku”, /sztafeta mówi (panel bez miejsca → treść w transkrypcie), skrot nie pisze, klik przekazuje brief „brak sekcji”', async ($, on) => {
  const { log } = silnik(on, { mcp: 'ok', panelBezMiejsca: true })
  await start($)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /^1 kompaktacja · sesja 0 min · stan: brak pliku$/ })).toBeDefined()

  const r = await $.command.run(komenda)
  expect(r.text).toContain(`Sztafeta: Brak pliku stanu ${STAN}`)
  expect(r.text, 'panel nieposadzony → sekcja i brief w odpowiedzi komendy').toContain('— brief dla nowej sesji —\nstan: brak sekcji „## Stan”')
  expect(log.toasty.some(t => t.includes('panel czeka na miejsce')), 'komenda nie straszy toastem, gdy treść i tak idzie do transkryptu').toBe(false)

  const s = await $.command.run({ ...komenda, args: 'skrot' })
  expect(s.text).toContain('nie ma czego skracać')
  expect(log.pliki.size).toBe(0)

  await pasek.press({ key: 'przekaz' })
  expect(log.mcp).toHaveLength(1)
  expect(String(log.mcp[0]!.args.prompt)).toContain('brak sekcji „## Stan”')
  expect(String(log.mcp[0]!.args.background)).toContain('skrótu nie ma')
  expect(log.pliki.size, 'bez sekcji nic nie jest pisane').toBe(0)
  await pasek.unmount()
})

test('plik bez sekcji „## Stan” (same bloki hooka): pasek to mówi, brief bez „wczytaj”', async ($, on) => {
  silnik(on, { plik: `${KOMPAKTACJA(1)}\n\n${KOMPAKTACJA(2)}` })
  await start($)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /stan: plik bez „## Stan” \(12 min temu\)/ })).toBeDefined()
  const r = await $.command.run(komenda)
  expect(r.text).toContain('nie ma żadnej sekcji „## Stan”')
  await pasek.unmount()
})

test('plik stanu istnieje, ale fs.read odmawia: /sztafeta odpowiada tekstem z powodem (nie oddaje błędu silnikowi — tamten daje pustą odpowiedź); pasek bez meta pliku', async ($, on) => {
  const { log } = silnik(on, { plik: MALY, czytajBlad: true })
  await start($)
  const r = await $.command.run(komenda)
  // W kicie hook testu, który rzuca, jest pomijany, a błąd brzmi „no implementation for fs.read”; w sesji niesie komunikat odmowy odczytu.
  expect(r.text).toContain('Sztafeta: /sztafeta nie powiodło się (throw: ')
  expect(log.otwarcia, 'panel nie otwarty na pustym widoku').toBe(0)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /^1 kompaktacja · sesja 0 min · stan: brak pliku$/ }), 'nieczytelny plik = brak metadanych, pasek żyje').toBeDefined()
  await pasek.unmount()
})

test('łańcuch AbovePrompt: świeża sesja oddaje rysunek pluginu niżej bez zmian; po kompaktacji pasek składa go pod sobą (next(e))', async ($, on) => {
  silnik(on, { plik: MALY, dno: 'STRAZNIK-PLUGINU-NIZEJ' })
  await start($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ type: 'Button', key: 'przekaz' }), 'świeża sesja: paska nie ma').toBeUndefined()
  expect(await pasek.find({ type: 'Text', text: 'STRAZNIK-PLUGINU-NIZEJ' }), 'milczący pasek oddaje next(e) bez zmian').toBeDefined()

  await kompaktuj($)
  await pasek.redraw()
  expect(await pasek.find({ text: /^1 kompaktacja · / }), 'własna linia paska').toBeDefined()
  expect(await pasek.find({ type: 'Button', key: 'przekaz' })).toBeDefined()
  const teksty = (await pasek.findAll({ type: 'Text' })).map(t => t.text)
  expect(teksty[teksty.length - 1], 'plugin niżej POD paskiem, nie nad nim').toBe('STRAZNIK-PLUGINU-NIZEJ')
  expect(teksty.some(t => t.startsWith('1 kompaktacja')), 'linia paska nad nim').toBe(true)
  expect(await pasek.drawn(), 'stos w kolumnie: pasek NAD rysunkiem spod spodu, nie obok').toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })

  const ciasno = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: { ...pasekProps, maxRows: 1 } })
  expect(await ciasno.find({ text: /^1 kompaktacja · / }), 'jeden wiersz pasma: pasek').toBeDefined()
  expect(await ciasno.find({ type: 'Text', text: 'STRAZNIK-PLUGINU-NIZEJ' }), 'maxRows 1: bez stosu (przewijałby się w zerowym oknie)').toBeUndefined()
  await ciasno.unmount()
  await pasek.unmount()
})

test('łańcuch AbovePrompt: dno rdzenia (pusty Box) ląduje pod paskiem bez tekstu — stos nie dodaje wiersza', async ($, on) => {
  silnik(on, { plik: MALY })
  await start($)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  const boxy = await pasek.findAll({ type: 'Box' })
  expect(boxy, 'kolumna, wiersz paska, pusty Box rdzenia').toHaveLength(3)
  expect(boxy[2]?.children, 'Box rdzenia bez dzieci (w Ink: 0 wierszy)').toHaveLength(0)
  expect((await pasek.findAll({ type: 'Text' })).every(t => t.text.length > 0), 'żadnego pustego tekstu w stosie').toBe(true)
  await pasek.unmount()
})

test('łańcuch AbovePrompt: plugin niżej się wysypuje (dno ui.render rzuca) — pasek rysuje się dalej', async ($, on) => {
  silnik(on, { plik: MALY, dnoRzuca: true })
  await start($)
  await kompaktuj($)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PASEK, props: pasekProps })
  expect(await pasek.find({ text: /^1 kompaktacja · / }), 'fail-open: błąd niżej nie gasi paska').toBeDefined()
  expect(await pasek.find({ type: 'Button', key: 'przekaz' })).toBeDefined()
  await pasek.unmount()
})
