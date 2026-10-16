// Testy modu kanon-skrzynka: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: dysk w pamięci (katalog /tmp/dom-testu ze ZMYŚLONYMI raportami i wymyślonymi
// identyfikatorami sesji — bez nazw klientów), zegar `mock.clock` (timer modu rusza tylko na `advance`; `settle` domyka to, co mod zaczął
// bez await: skan ze startu, oznaczenie z obserwatora), store jako Mapa widoczna dla asercji, `session.id`, `ui.*`, `prompt.fill`, dno
// `prompt.submit` (co weszło do sesji). Odmowy nounów dno oddaje przez `{ deny }`, jak silnik (rzucający hook dna silnik pomija).
// Słowo TAJNE-SLOWO w treści zmyślonego stanu nie może pojawić się nigdzie poza plikiem: ani w panelu, ani na pasku, ani w store,
// ani w toastach, ani w odpowiedzi komendy, ani w `$.state` — test główny sprawdza wszystkie te wyjścia naraz.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, PromptOrigin, PromptSubmitInput } from 'claude-code'

import { liniaPaska, naglowekStanu, podsumowanie, werdykt } from '../hooks/register'
import type { Pozycja } from '../types'

const PLUGIN = 'kanon-skrzynka'
const PANE = { component: 'Pane' as const, requestId: 'skrzynka' }
const paneProps = { title: 'Skrzynka', isFocused: true, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND = { component: 'AbovePrompt' as const }
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 2, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = (args = '') => ({ command: 'skrzynka', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })

const HOME = '/tmp/dom-testu'
const WATCH_DIR = `${HOME}/.claude/kanon/watch`
const USAGE_DIR = `${HOME}/.claude/kanon/usage`
const STAN_DIR = `${HOME}/.claude/kanon/stan`
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0) // 2026-10-17 12:00 UTC — w strefach ±11 h ten sam dzień
const GODZ = 3_600_000
const DOBA = 24 * GODZ
// Wymyślone identyfikatory sesji (poprawne UUID v4, żadnej realnej sesji na tym Macu).
const JA = 'aaaaaaaa-0000-4000-8000-000000000001'
const INNA = 'aabbccdd-0000-4000-8000-000000000002'
const STARA = 'bbccddee-0000-4000-8000-000000000003'
const BEZ_STANU = 'ccddeeff-0000-4000-8000-000000000004'
const dd = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

type Dolar = Parameters<TestBody>[0]
type Plik = { tekst: string; mtimeMs: number }

// ---------- zmyślone raporty (bez nazw klientów) ----------
const raportWatch = (data: string, werdykt: string | null) =>
  [
    `# kanon-watch ${data}`,
    '',
    'Źródła: 19, zmienione: 3, baseline: 0, błędy: 0. Ocena LLM: tak (claude-sonnet-5-5, wejście 1 tok, wyjście 1).',
    '',
    werdykt === null ? '## Zmiany' : `**WERDYKT: aktualizacja kanonu ${werdykt} — zmyślona zmiana w docs do odnotowania przy najbliższym update, bez pilności.**`,
    '',
    '## Zmiany',
    '- zmyślona pozycja',
  ].join('\n')
const raportUsage = (data: string, procent: string | null, koszt = '$1,234', dwaDni = '$234') =>
  [
    `# Zużycie Claude Code — tydzień do ${data}`,
    '',
    'Skala: koszt po cenniku list API (nie rozliczenie planu). Alarm, gdy ostatnie 2 dni > 40% okna 7 dni.',
    '',
    '```',
    procent === null ? 'brak danych' : `okno 7 dni od 2026-10-08 00:00; plików 123; koszt-list ${koszt}; ostatnie 2 dni ${dwaDni} = ${procent}%`,
    '```',
  ].join('\n')
const plikStanu = (naglowki: string[]) =>
  [
    '# Stan sesji (zmyślony)',
    '',
    ...naglowki.flatMap(n => [`## ${n}`, '### Zrobione', '- treść, której panel nie pokazuje: TAJNE-SLOWO', '### Dalej', '- krok']),
    '',
    '## Kompaktacja 1 — zapis hooka',
    '- polecenia verbatim: TAJNE-SLOWO',
  ].join('\n')

type Silnik = {
  /** Dysk: ścieżka → plik. Katalogi istnieją, gdy mają choć jeden plik (albo są w `katalogi`). */
  pliki?: Record<string, Plik>
  /** Podkatalogi (kind dir) w katalogach źródeł, np. watch/snap, usage/sesje. */
  katalogi?: string[]
  store?: Record<string, unknown>
  sid?: string
  /** `fs.read` tych ścieżek odmawia (EACCES) — dno odpowiada `{ deny }`, jak silnik przy odmowie nouna. */
  nieczytelne?: string[]
  /** `$.session.id` odmawia (`{ deny }`). */
  sidRzuca?: boolean
  /** `$.store.set` odmawia (`{ deny }`). */
  storeOdmawia?: boolean
  /** Pole promptu nie przyjmuje tekstu. */
  nieWypelnia?: boolean
  /** Panel otwarty, ale nie narysowany (wąski terminal). */
  isPlaced?: boolean
}

/** Dno pod modem. Zwraca rejestr wywołań, dysk, zegar i `start` (session.start + settle skanu, który mod zaczyna bez await). */
function silnik($: Dolar, on: On, s: Silnik = {}) {
  const dysk = new Map<string, Plik>(Object.entries(s.pliki ?? {}))
  const katalogi = new Set(s.katalogi ?? [])
  const store = new Map<string, unknown>(Object.entries(s.store ?? {}))
  const log = {
    toasty: [] as string[],
    fill: [] as { text: string; mode: string }[],
    open: [] as string[],
    close: [] as string[],
    odczyty: [] as string[],
    /** Teksty, które doszły do dna `prompt.submit` — czyli weszły do sesji. */
    przeszlo: [] as string[],
    zdarzenia: [] as PromptSubmitInput[],
    /** Każda wartość zapisana do `$.state` (inne pluginy mogą ją czytać) — pod strażnika treści. */
    stany: [] as unknown[],
    store,
    dysk,
  }
  const zegar = mock.clock(on, { now: T0 })
  mock.env(on, { HOME })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    if (s.storeOdmawia) return { deny: 'store pełny (zmyślona odmowa)' }
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => {
    if (s.sidRzuca) return { deny: 'session.id odmówiło: id padło' }
    return { value: s.sid ?? JA }
  })
  on('fs.list', (_$, e) => {
    const dir = e.path.replace(/\/$/, '')
    const wpisy = [...dysk.entries()]
      .filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file' as const, size: f.tekst.length, mtimeMs: f.mtimeMs, isLink: false }))
    const pod = [...katalogi].filter(k => k.startsWith(`${dir}/`)).map(k => ({ name: k.slice(dir.length + 1), kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
    if (!wpisy.length && !pod.length) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: [...wpisy, ...pod] }
  })
  on('fs.exists', (_$, e) => ({ value: dysk.has(e.path) }))
  on('fs.stat', (_$, e) => {
    const f = dysk.get(e.path)
    if (!f) return { deny: `ENOENT: ${e.path}` }
    return { value: { kind: 'file' as const, size: f.tekst.length, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    log.odczyty.push(e.path)
    const f = dysk.get(e.path)
    if (!f) return { deny: `ENOENT: ${e.path}` }
    if (s.nieczytelne?.includes(e.path)) return { deny: `EACCES: permission denied, open '${e.path}'` }
    return { value: f.tekst }
  })
  on('ui.toast', (_$, e) => {
    log.toasty.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    log.open.push(e.id)
    return { value: s.isPlaced === false ? { isPlaced: false as const, reason: 'terminal ma 100 kolumn, próg 144' } : { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    log.close.push(e.id)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    log.fill.push({ text: e.text, mode: e.mode })
    return { isFilled: !s.nieWypelnia }
  })
  on('prompt.submit', (_$, e) => {
    log.przeszlo.push(e.text)
    log.zdarzenia.push(e)
    return { text: e.text, origin: e.origin }
  })
  on('state.set', (_$, e, next) => {
    log.stany.push(e.value)
    return next(e)
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const start = async () => {
    const r = await $.session.start({ cwd: `${HOME}/Developer`, surface: 'terminal', isInteractive: true })
    await zegar.settle() // skan ze startu biegnie bez await (nie wstrzymuje sesji)
    return r
  }
  return { log, zegar, start }
}

/** Polecenie jak z Entera osoby (kit bierze pełne wejście zdarzenia: `wait`, `origin`, które w sesji stempluje silnik). */
const wpisz = ($: Dolar, text: string, origin: PromptOrigin = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin })

/** Standardowy dysk: 3 WATCH (1 za stary), 3 USAGE (1 za stary, 1 z 🔴), 4 pliki stanu (własny, stary, bez „## Stan”, skrót) + podkatalogi. */
const dysk = (): Record<string, Plik> => ({
  [`${WATCH_DIR}/WATCH-2026-10-16.md`]: { tekst: raportWatch('2026-10-16', 'ROZWAŻ'), mtimeMs: T0 - DOBA },
  [`${WATCH_DIR}/WATCH-2026-10-10.md`]: { tekst: raportWatch('2026-10-10', 'NIE'), mtimeMs: T0 - 7 * DOBA },
  [`${WATCH_DIR}/WATCH-2026-09-30.md`]: { tekst: raportWatch('2026-09-30', 'ROZWAŻ'), mtimeMs: T0 - 17 * DOBA },
  [`${WATCH_DIR}/notatka.txt`]: { tekst: 'nie raport', mtimeMs: T0 },
  [`${USAGE_DIR}/USAGE-tydzien-2026-10-15.md`]: { tekst: raportUsage('2026-10-15', '19'), mtimeMs: T0 - 2 * DOBA },
  [`${USAGE_DIR}/USAGE-tydzien-2026-10-09.md`]: { tekst: raportUsage('2026-10-09', '45', '$2,000', '$900'), mtimeMs: T0 - 8 * DOBA },
  [`${USAGE_DIR}/USAGE-tydzien-2026-09-27.md`]: { tekst: raportUsage('2026-09-27', '60'), mtimeMs: T0 - 20 * DOBA },
  [`${STAN_DIR}/${JA}.md`]: { tekst: plikStanu(['Stan 2026-10-17 11:00 (asystent) — własna sesja']), mtimeMs: T0 - GODZ },
  [`${STAN_DIR}/${INNA}.md`]: { tekst: plikStanu(['Stan 2026-10-16 23:37 (asystent)', 'Stan 2026-10-17 00:05 (asystent) — ostatnia sekcja']), mtimeMs: T0 - DOBA },
  [`${STAN_DIR}/${STARA}.md`]: { tekst: plikStanu(['Stan 2026-10-07 10:00 (asystent)']), mtimeMs: T0 - 10 * DOBA },
  [`${STAN_DIR}/${BEZ_STANU}.md`]: { tekst: '# tylko zapis hooka\n\n## Kompaktacja 1 — zapis hooka\n- TAJNE-SLOWO\n', mtimeMs: T0 - GODZ },
  [`${STAN_DIR}/${INNA}-skrot.md`]: { tekst: '## Stan skrót — TAJNE-SLOWO', mtimeMs: T0 - GODZ },
})
const KATALOGI = [`${WATCH_DIR}/snap`, `${USAGE_DIR}/sesje`]
// 🔴 idzie na początek paska (sort stabilny), reszta w kolejności watch → usage → stan, każde źródło od najnowszego.
const PASEK_120 = '📬 5 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-16 (ROZWAŻ) · WATCH-10-10 (NIE) +2'

const pozycja = (etykieta: string, alarm = false): Pozycja => ({ zrodlo: 'watch', id: 'x', sciezka: '/x', plik: 'x', nazwa: 'x', etykieta, naglowek: '', mtimeMs: 0, alarm })

test('parsery nagłówków: werdykt (słowo bez gwiazdek), podsumowanie USAGE (koszt, 2 dni, %), ostatni nagłówek „## Stan” bez treści', async () => {
  expect(werdykt(raportWatch('2026-10-16', 'ROZWAŻ'))).toEqual({
    slowo: 'ROZWAŻ',
    linia: 'WERDYKT: aktualizacja kanonu ROZWAŻ — zmyślona zmiana w docs do odnotowania przy najbliższym update, bez pilności.',
  })
  expect(werdykt('x\n\n\n\n**WERDYKT: aktualizacja kanonu NIE**')?.slowo).toBe('NIE')
  expect(werdykt(raportWatch('2026-10-08', null)), 'raport bez oceny LLM').toBeNull()
  expect(werdykt('\n'.repeat(20) + '**WERDYKT: aktualizacja kanonu TAK**'), 'WERDYKT poza pierwszymi 12 liniami nie jest nagłówkiem').toBeNull()
  expect(podsumowanie(raportUsage('2026-10-15', '19'))).toEqual({ koszt: '$1,234', dwaDni: '$234', procent: 19 })
  expect(podsumowanie('okno 7 dni od 2026-10-08 00:00; plików 5; koszt-list $1 597; ostatnie 2 dni $297.5 = 40,5 %')).toEqual({ koszt: '$1 597', dwaDni: '$297.5', procent: 40.5 })
  expect(podsumowanie(raportUsage('2026-10-15', null))).toBeNull()
  expect(naglowekStanu(plikStanu(['Stan A', 'Stan B — ostatnia']))).toBe('Stan B — ostatnia')
  expect(naglowekStanu('## Stanowisko\n## Stan\ntreść'), '„## Stan” jako słowo, nie prefiks').toBe('Stan')
  expect(naglowekStanu('# tylko hook\n## Kompaktacja 1')).toBeNull()
})

test('liniaPaska(): 3 pozycje + „+N”, 🔴 na początek, przycięcie do szerokości (1 pozycja, sam nagłówek), pusto → ""', async () => {
  const p = [pozycja('WATCH-10-16 (ROZWAŻ)'), pozycja('WATCH-10-10 (NIE)'), pozycja('USAGE-10-15 (2 dni 19 %)'), pozycja('🔴 USAGE-10-09 (2 dni 45 %)', true), pozycja('stan aabbccdd (16.10)')]
  expect(liniaPaska(p, 200)).toBe(PASEK_120)
  expect(liniaPaska(p.map(x => ({ ...x, alarm: false })), 200), 'bez alarmu kolejność listy').toBe('📬 5 do przeczytania: WATCH-10-16 (ROZWAŻ) · WATCH-10-10 (NIE) · USAGE-10-15 (2 dni 19 %) +2')
  expect(liniaPaska(p, 54), 'druga pozycja nie mieści się w 54 komórkach (emoji = 2)').toBe('📬 5 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) +4')
  expect(liniaPaska(p, 30), 'żadna pozycja się nie mieści — sam nagłówek z liczbą').toBe('📬 5 do przeczytania')
  expect(liniaPaska(p.slice(0, 2), 200), 'bez „+0”').toBe('📬 2 do przeczytania: WATCH-10-16 (ROZWAŻ) · WATCH-10-10 (NIE)')
  expect(liniaPaska([], 200)).toBe('')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`session.start liczy pozycje z trzech źródeł (progi 14/7 dni, własny sid, skrót i plik bez „## Stan” pominięte); żadne wyjście bez treści stanu (${surface})`, async ($, on) => {
    const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
    const r = await start()
    expect(r.cwd).toBe(`${HOME}/Developer`)

    const pasek = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND, props: bandProps })
    expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe(PASEK_120)
    expect(await pasek.find({ type: 'Button', key: 'otworz' })).toBeDefined()
    const pasekDrzewo = await pasek.drawn()
    await pasek.unmount()

    const t = await $.command.run(komenda())
    expect(t.text).toBe('Skrzynka: 5 do przeczytania.')
    expect(log.open).toEqual(['skrzynka'])
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: paneProps })
    expect((await pane.find({ type: 'Text', text: /^Skrzynka — / }))?.text).toBe('Skrzynka — 5 do przeczytania')
    expect(await pane.find({ type: 'Button', key: 'wczytaj-watch-2026-10-16' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'przeczytane-watch-2026-10-10' })).toBeDefined()
    expect(await pane.find({ key: 'wczytaj-watch-2026-09-30' }), 'WATCH sprzed 17 dni').toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /\[watch\] WATCH-10-16/ }))?.text).toContain('· WERDYKT: aktualizacja kanonu ROZWAŻ — zmyślona zmiana')
    expect((await pane.find({ type: 'Text', text: /\[usage\] USAGE-10-09/ }))?.text).toContain('koszt-list $2,000 · ostatnie 2 dni $900 = 45 %')
    expect(await pane.find({ key: 'wczytaj-usage-2026-09-27' }), 'USAGE sprzed 20 dni').toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /\[stan\] stan aabbccdd/ }))?.text).toBe(`[stan] stan aabbccdd · ${dd(T0 - DOBA)} ${hhmm(T0 - DOBA)} · Stan 2026-10-17 00:05 (asystent) — ostatnia sekcja`)
    expect(await pane.find({ key: 'wczytaj-stan-aaaaaaaa' }), 'własny sid pominięty').toBeUndefined()
    expect(await pane.find({ key: 'wczytaj-stan-bbccddee' }), 'stan sprzed 10 dni (próg 7)').toBeUndefined()
    expect(await pane.find({ key: 'wczytaj-stan-ccddeeff' }), 'plik bez sekcji „## Stan”').toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'wszystkie' })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /do przeczytania · skan/ }))?.text).toContain('5 do przeczytania · skan')
    const panelDrzewo = await pane.drawn()
    expect(JSON.stringify(panelDrzewo).includes('Zrobione'), 'podsekcje stanu nie trafiają do panelu').toBe(false)
    await pane.unmount()

    expect(log.odczyty, 'czytane tylko pliki w progu wieku i z wzorca nazwy; własny sid i skrót nie').toEqual([
      `${WATCH_DIR}/WATCH-2026-10-16.md`,
      `${WATCH_DIR}/WATCH-2026-10-10.md`,
      `${USAGE_DIR}/USAGE-tydzien-2026-10-15.md`,
      `${USAGE_DIR}/USAGE-tydzien-2026-10-09.md`,
      `${STAN_DIR}/${BEZ_STANU}.md`,
      `${STAN_DIR}/${INNA}.md`,
      // drugi skan: /skrzynka
      `${WATCH_DIR}/WATCH-2026-10-16.md`,
      `${WATCH_DIR}/WATCH-2026-10-10.md`,
      `${USAGE_DIR}/USAGE-tydzien-2026-10-15.md`,
      `${USAGE_DIR}/USAGE-tydzien-2026-10-09.md`,
      `${STAN_DIR}/${BEZ_STANU}.md`,
      `${STAN_DIR}/${INNA}.md`,
    ])
    expect(log.store.size, 'skan nic nie zapisuje').toBe(0)

    // Strażnik: treść pliku stanu (TAJNE-SLOWO) nie wychodzi z modułu żadnym wyjściem — pasek, panel, toasty, fill, odpowiedzi komend,
    // store ani $.state (który inne pluginy mogą czytać).
    expect(log.stany.length, 'zapisy $.state widoczne dla strażnika').toBeGreaterThan(0)
    const wyjscia = JSON.stringify({ pasekDrzewo, panelDrzewo, toasty: log.toasty, fill: log.fill, odpowiedzi: [t.text, (await $.command.run(komenda('zamknij'))).text], store: [...log.store.entries()], stany: log.stany })
    expect(wyjscia.includes('TAJNE-SLOWO'), 'treść stanu nie wychodzi z modułu').toBe(false)
    expect(wyjscia.includes('Stan 2026-10-17 00:05 (asystent) — ostatnia sekcja'), 'strażnik widzi to, co wolno: nagłówek').toBe(true)
  })
}

test('🔴 tylko powyżej 40 %: 40 → bez, 40,5 → 🔴, 41 → 🔴, alarmy na początku paska; raport bez podsumowania → „bez podsumowania”; WATCH bez werdyktu → „bez werdyktu”', async ($, on) => {
  const { start } = silnik($, on, {
    pliki: {
      [`${USAGE_DIR}/USAGE-tydzien-2026-10-15.md`]: { tekst: raportUsage('2026-10-15', '40'), mtimeMs: T0 - DOBA },
      [`${USAGE_DIR}/USAGE-tydzien-2026-10-14.md`]: { tekst: raportUsage('2026-10-14', '40,5'), mtimeMs: T0 - 2 * DOBA },
      [`${USAGE_DIR}/USAGE-tydzien-2026-10-13.md`]: { tekst: raportUsage('2026-10-13', '41'), mtimeMs: T0 - 3 * DOBA },
      [`${USAGE_DIR}/USAGE-tydzien-2026-10-12.md`]: { tekst: raportUsage('2026-10-12', null), mtimeMs: T0 - 4 * DOBA },
      [`${WATCH_DIR}/WATCH-2026-10-08.md`]: { tekst: raportWatch('2026-10-08', null), mtimeMs: T0 - 5 * DOBA },
    },
  })
  await start()
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...bandProps, bodyColumns: 300 } })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 5 do przeczytania: 🔴 USAGE-10-14 (2 dni 40,5 %) · 🔴 USAGE-10-13 (2 dni 41 %) · WATCH-10-08 (bez werdyktu) +2')
  await pasek.unmount()
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect((await pane.find({ type: 'Text', text: /USAGE-10-15/ }))?.text).toContain('= 40 %')
  expect((await pane.find({ type: 'Text', text: /USAGE-10-13/ }))?.text).toContain('= 41 %')
  expect((await pane.find({ type: 'Text', text: /USAGE-10-12/ }))?.text).toContain('bez linii podsumowania')
  expect((await pane.find({ type: 'Text', text: /WATCH-10-08/ }))?.text).toContain('bez linii WERDYKT')
  await pane.unmount()
})

test('progi wieku na granicy: raport 13,9 dnia tak, 14,1 nie; stan 6,9 dnia tak, 7,1 nie; mtime 0 (katalog, dowiązanie) nie', async ($, on) => {
  const { start } = silnik($, on, {
    pliki: {
      [`${WATCH_DIR}/WATCH-2026-10-03.md`]: { tekst: raportWatch('2026-10-03', 'NIE'), mtimeMs: T0 - 13.9 * DOBA },
      [`${WATCH_DIR}/WATCH-2026-10-02.md`]: { tekst: raportWatch('2026-10-02', 'NIE'), mtimeMs: T0 - 14.1 * DOBA },
      [`${STAN_DIR}/${INNA}.md`]: { tekst: plikStanu(['Stan 6,9 dnia']), mtimeMs: T0 - 6.9 * DOBA },
      [`${STAN_DIR}/${STARA}.md`]: { tekst: plikStanu(['Stan 7,1 dnia']), mtimeMs: T0 - 7.1 * DOBA },
      [`${STAN_DIR}/${BEZ_STANU}.md`]: { tekst: plikStanu(['Stan bez mtime']), mtimeMs: 0 },
    },
  })
  await start()
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe(`📬 2 do przeczytania: WATCH-10-03 (NIE) · stan aabbccdd (${dd(T0 - 6.9 * DOBA)})`)
  await pasek.unmount()
})

test('„Przeczytane”: klucz skrzynka:<ścieżka> = { kiedy, sid }, pozycja znika z panelu i paska, skan z timera (10 min) jej nie przywraca; plik zmieniony PO oznaczeniu wraca; /skrzynka wyczysc przywraca wszystko', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: paneProps })
  await pane.press({ key: 'przeczytane-watch-2026-10-16' })
  expect(log.store.get(`skrzynka:${WATCH_DIR}/WATCH-2026-10-16.md`)).toEqual({ kiedy: new Date(T0).toISOString(), sid: JA })
  expect(log.store.size).toBe(1)
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^Skrzynka — / }))?.text).toBe('Skrzynka — 4 do przeczytania')
  await pane.press({ key: 'przeczytane-stan-aabbccdd' })
  expect(log.store.get(`skrzynka:${STAN_DIR}/${INNA}.md`)).toEqual({ kiedy: new Date(T0).toISOString(), sid: JA })
  expect(JSON.stringify([...log.store.values()]).includes('TAJNE-SLOWO'), 'store bez treści').toBe(false)

  await zegar.advance(10 * 60_000) // skan z timera
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' }), 'oznaczone nie wraca po skanie').toBeUndefined()
  expect(await pane.find({ key: 'wczytaj-stan-aabbccdd' })).toBeUndefined()
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-10' })).toBeDefined()
  expect(log.odczyty.filter(p => p.endsWith('WATCH-2026-10-16.md')), 'plik oznaczony nie jest już czytany').toHaveLength(2)
  let pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 3 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-10 (NIE) · USAGE-10-15 (2 dni 19 %)')
  await pasek.unmount()

  // plik stanu zmieniony PO oznaczeniu (sesja dopisała sekcję: mtime > kiedy) wraca z nowym nagłówkiem; WATCH bez zmiany zostaje przeczytany
  log.dysk.set(`${STAN_DIR}/${INNA}.md`, { tekst: plikStanu(['Stan 2026-10-17 00:05 (asystent)', 'Stan 2026-10-17 12:20 (asystent) — nowa sekcja']), mtimeMs: zegar.now() + 1000 })
  await zegar.advance(10 * 60_000)
  expect(await pane.find({ key: 'wczytaj-stan-aabbccdd' }), 'stan zmieniony po oznaczeniu wraca').toBeDefined()
  expect((await pane.find({ type: 'Text', text: /\[stan\] stan aabbccdd/ }))?.text).toContain('— nowa sekcja')
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' }), 'WATCH bez zmiany zostaje przeczytany').toBeUndefined()
  expect(log.store.size, 'powrót nie kasuje oznaczenia').toBe(2)
  pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 4 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-10 (NIE) · USAGE-10-15 (2 dni 19 %) +1')
  await pasek.unmount()

  const w = await $.command.run(komenda('wyczysc'))
  expect(w.text).toBe('Skrzynka: skasowano 2 oznaczeń „przeczytane”; 5 do przeczytania.')
  expect(log.store.size).toBe(0)
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' })).toBeDefined()
  expect(await pane.find({ key: 'wczytaj-stan-aabbccdd' })).toBeDefined()
  await pane.unmount()
})

test('D6: „wczytaj <ścieżka pozycji>” w prompt.submit oznacza pozycję (pełna ścieżka, ~, sama nazwa, z przecinkiem po); polecenie przechodzi niezmienione; obca ścieżka, własny stan, bez „wczytaj” — nic', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  const r = await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(r.text).toBe(`wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(r.origin).toEqual({ kind: 'composer' })
  expect(log.zdarzenia[0], 'do dna dochodzi wejście bez dopisków (context, drop)').toEqual({ text: `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`, wait: false, origin: { kind: 'composer' } })
  await zegar.settle() // oznaczenie biegnie bez await (Enter nie czeka na kolejkę skanów)
  expect(log.store.get(`skrzynka:${WATCH_DIR}/WATCH-2026-10-16.md`)).toEqual({ kiedy: new Date(T0).toISOString(), sid: JA })

  await wpisz($, `Wczytaj ~/.claude/kanon/stan/${INNA}.md i streść`)
  await zegar.settle()
  expect(log.store.get(`skrzynka:${STAN_DIR}/${INNA}.md`), 'ścieżka z ~ — po nazwie pliku').toBeDefined()
  await wpisz($, 'wczytaj USAGE-tydzien-2026-10-15, potem USAGE-tydzien-2026-10-09')
  await zegar.settle()
  expect(log.store.size, 'tylko plik tuż po „wczytaj” (drugi: osobne polecenie albo przycisk)').toBe(3)

  await wpisz($, `przejrzyj ${WATCH_DIR}/WATCH-2026-10-10.md`) // bez „wczytaj”
  await wpisz($, `wczytaj ${STAN_DIR}/${STARA}.md`) // pozycja spoza listy (za stara)
  await wpisz($, `wczytaj ${STAN_DIR}/${JA}.md`) // własny stan — nie pozycja
  await zegar.settle()
  expect(log.store.size).toBe(3)
  expect(log.przeszlo).toHaveLength(6)
  expect(log.toasty).toEqual([])

  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 2 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-10 (NIE)')
  await pasek.unmount()
})

test('D6 negatywy: nazwa dalej w zdaniu, `<sid>-skrot.md`, origin peer/sdk, isMeta — nic nie oznaczone, polecenia przechodzą; origin bridge (Remote Control) oznacza', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  await wpisz($, 'wczytaj plan i porównaj z WATCH-2026-10-16')
  await wpisz($, `wczytaj ~/.claude/kanon/stan/${INNA}-skrot.md`)
  await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`, { kind: 'peer' })
  await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`, { kind: 'sdk' })
  await $.prompt.submit({ text: `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`, wait: false, origin: { kind: 'composer' }, isMeta: true })
  await zegar.settle()
  expect(log.store.size).toBe(0)
  expect(log.przeszlo).toHaveLength(5)
  await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`, { kind: 'bridge' })
  await zegar.settle()
  expect([...log.store.keys()]).toEqual([`skrzynka:${WATCH_DIR}/WATCH-2026-10-16.md`])
})

test('„Wczytaj”: panel zamknięty, prompt.fill replace „wczytaj <pełna ścieżka>”, bez zapisu store i bez wysłania; pozycja zostaje', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  await pane.press({ key: 'wczytaj-stan-aabbccdd' })
  expect(log.fill).toEqual([{ text: `wczytaj ${STAN_DIR}/${INNA}.md`, mode: 'replace' }])
  expect(log.close).toEqual(['skrzynka'])
  expect(log.open).toEqual(['skrzynka'])
  expect(log.toasty.at(-1)).toBe('Skrzynka: „wczytaj stan aabbccdd” w polu promptu — Enter wysyła')
  expect(log.store.size, 'Wczytaj nie oznacza — oznacza dopiero polecenie właściciela').toBe(0)
  expect(log.przeszlo, 'Enter naciska właściciel').toEqual([])
  expect(await pane.find({ key: 'wczytaj-stan-aabbccdd' }), 'pozycja zostaje do czasu polecenia').toBeDefined()
  await pane.unmount()
})

test('„Wczytaj” przy odmowie pola promptu: panel otwarty ponownie, toast z pełnym tekstem do wpisania', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, nieWypelnia: true })
  await start()
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: paneProps })
  await pane.press({ key: 'wczytaj-watch-2026-10-16' })
  expect(log.fill).toHaveLength(1)
  expect(log.close).toEqual(['skrzynka'])
  expect(log.open).toEqual(['skrzynka', 'skrzynka'])
  expect(log.toasty.at(-1)).toBe(`Skrzynka: pole promptu nie przyjęło tekstu — wpisz sam: wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  await pane.unmount()
})

test('„Wszystkie przeczytane”: klucz dla każdej pozycji, panel pusty, pasek znika; /skrzynka zamknij', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  await pane.press({ key: 'wszystkie' })
  expect([...log.store.keys()].sort()).toEqual(
    [
      `skrzynka:${WATCH_DIR}/WATCH-2026-10-16.md`,
      `skrzynka:${WATCH_DIR}/WATCH-2026-10-10.md`,
      `skrzynka:${USAGE_DIR}/USAGE-tydzien-2026-10-15.md`,
      `skrzynka:${USAGE_DIR}/USAGE-tydzien-2026-10-09.md`,
      `skrzynka:${STAN_DIR}/${INNA}.md`,
    ].sort(),
  )
  expect((await pane.find({ type: 'Text', text: /^Skrzynka — / }))?.text).toBe('Skrzynka — 0 do przeczytania')
  expect(await pane.find({ type: 'Text', text: /Nic do przeczytania/ })).toBeDefined()
  expect(await pane.find({ key: 'wszystkie' })).toBeUndefined()
  await pane.unmount()
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect(await pasek.find({ type: 'Text', text: /📬/ }), 'pasek tylko, gdy są pozycje').toBeUndefined()
  await pasek.unmount()
  expect((await $.command.run(komenda('zamknij'))).text).toBe('Skrzynka zamknięta.')
  expect(log.close).toEqual(['skrzynka'])
})

test('brak katalogów ~/.claude/kanon/*: start sesji przechodzi, bez paska, bez toastów; /skrzynka odpowiada zerem; sam własny stan → też pusto', async ($, on) => {
  const { log, start } = silnik($, on)
  const r = await start()
  expect(r.cwd).toBe(`${HOME}/Developer`)
  expect(log.toasty).toEqual([])
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect(await pasek.find({ type: 'Text', text: /📬/ })).toBeUndefined()
  await pasek.unmount()
  expect((await $.command.run(komenda())).text).toBe('Skrzynka: 0 do przeczytania.')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect(await pane.find({ type: 'Text', text: /Nic do przeczytania/ })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /do przeczytania · skan/ }))?.text).not.toContain('błąd')
  await pane.unmount()

  log.dysk.set(`${STAN_DIR}/${JA}.md`, { tekst: plikStanu(['Stan własny']), mtimeMs: T0 })
  expect((await $.command.run(komenda())).text, 'własny sid to nie pozycja').toBe('Skrzynka: 0 do przeczytania.')
})

test('przycięcie paska do szerokości: 66 kolumn → 1 pozycja i „+4”, 40 → sam nagłówek; ankieta i maxRows 0 → cisza', async ($, on) => {
  const { start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  let pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...bandProps, bodyColumns: 66 } }) // 66 − 12 na przycisk = 54
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 5 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) +4')
  await pasek.unmount()
  pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...bandProps, bodyColumns: 40 } })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 5 do przeczytania')
  await pasek.unmount()
  pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...bandProps, hasSurvey: true } })
  expect(await pasek.find({ type: 'Text', text: /📬/ })).toBeUndefined()
  await pasek.unmount()
  pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...bandProps, maxRows: 0 } })
  expect(await pasek.find({ type: 'Text', text: /📬/ })).toBeUndefined()
  await pasek.unmount()
})

test('fail-open: nieczytelny plik (EACCES) pomijany, reszta liczona, bez toasta', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, nieczytelne: [`${WATCH_DIR}/WATCH-2026-10-16.md`, `${STAN_DIR}/${INNA}.md`] })
  await start()
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 3 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-10 (NIE) · USAGE-10-15 (2 dni 19 %)')
  await pasek.unmount()
  expect(log.toasty).toEqual([])
})

test('fail-open: $.session.id odmawia → session.start przechodzi, pasek milczy, polecenie „wczytaj” przechodzi niezmienione, /skrzynka pokazuje błąd skanu', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, sidRzuca: true })
  const r = await start()
  expect(r.cwd).toBe(`${HOME}/Developer`)
  const pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect(await pasek.find({ type: 'Text', text: /📬/ })).toBeUndefined()
  await pasek.unmount()
  const p = await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(p.text).toBe(`wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(log.przeszlo).toHaveLength(1)
  expect((await $.command.run(komenda())).text).toMatch(/^Skrzynka: 0 do przeczytania \(błąd skanu: .*id padło\)\.$/)
})

test('fail-open: $.store.set odmawia → „wczytaj” trafionej pozycji przechodzi niezmienione, nic nie oznaczone, bez toasta; przycisk „Przeczytane” → toast, pozycja zostaje', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, storeOdmawia: true })
  await start()
  const r = await wpisz($, `wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(r.text).toBe(`wczytaj ${WATCH_DIR}/WATCH-2026-10-16.md`)
  expect(log.przeszlo).toHaveLength(1)
  await zegar.settle()
  expect(log.store.size).toBe(0)
  expect(log.toasty, 'obserwator nie hałasuje').toEqual([])
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' }), 'nieoznaczona zostaje').toBeDefined()
  await pane.press({ key: 'przeczytane-watch-2026-10-16' })
  expect(log.toasty.at(-1)).toMatch(/^Skrzynka: nie udało się oznaczyć — .*store pełny/)
  expect(await pane.find({ key: 'wczytaj-watch-2026-10-16' }), 'po odmowie store pozycja zostaje').toBeDefined()
  await pane.unmount()
})

test('timer co 10 min: nowy raport pojawia się po advance; panel bez miejsca → odpowiedź komendy z listą (nagłówki, bez treści)', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, isPlaced: false })
  await start()
  log.dysk.set(`${WATCH_DIR}/WATCH-2026-10-17.md`, { tekst: raportWatch('2026-10-17', 'TAK'), mtimeMs: T0 })
  await zegar.advance(9 * 60_000)
  let pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text, 'przed 10. minutą stara lista').toBe(PASEK_120)
  await pasek.unmount()
  await zegar.advance(60_000)
  pasek = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: bandProps })
  expect((await pasek.find({ type: 'Text', text: /📬/ }))?.text).toBe('📬 6 do przeczytania: 🔴 USAGE-10-09 (2 dni 45 %) · WATCH-10-17 (TAK) · WATCH-10-16 (ROZWAŻ) +3')
  await pasek.unmount()

  const t = (await $.command.run(komenda())).text ?? ''
  expect(t.split('\n')[0]).toBe('Skrzynka (panel czeka: terminal ma 100 kolumn, próg 144): 6 do przeczytania')
  expect(t).toContain(`- [watch] WATCH-10-17 · ${dd(T0)}`)
  expect(t).toContain('- [stan] stan aabbccdd ·')
  expect(t).toContain('Stan 2026-10-17 00:05 (asystent) — ostatnia sekcja')
  expect(t.includes('TAJNE-SLOWO'), 'odpowiedź komendy bez treści stanu').toBe(false)
})
