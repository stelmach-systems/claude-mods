// Testy modu kanon-brief: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: rzeczowniki ($.session.cwd/turns, $.fs.list, $.store.*, $.ui.open/close/toast/copy)
// odpowiadają `{ value }`, zdarzenia rdzenia (prompt.submit, prompt.fill, command.run, ui.render) zwracają wynik jak silnik.
// Store to Mapa widoczna dla asercji (co dokładnie mod zapamiętał per folder).
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin, PromptSubmitInput } from 'claude-code'
import { zloz } from '../hooks/register'

const PLUGIN = 'kanon-brief'
const PANE = { component: 'Pane' as const, requestId: 'brief' }
const props = { title: 'Brief', isFocused: true, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FOLDER = '/Users/test/Developer/claude-mods'

/** Polecenie jak z Entera osoby. Zestaw testowy bierze pełne wejście zdarzenia (`wait`, `origin`), które w sesji stempluje silnik. */
const wpisz = ($: Engine, text: string, origin: PromptOrigin = { kind: 'composer' }, extra: Partial<PromptSubmitInput> = {}) =>
  $.prompt.submit({ text, wait: false, origin, ...extra })
const KLUCZ = `brief:${FOLDER}`
const komenda = (args = '') => ({ command: 'brief', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })
const PUSTE_GRANICE = { produkcja: false, pii: false, push: false }
// Brzmienia ze spec (plan §3.2) — literały, żeby zmiana tekstu w kodzie łamała test.
const TOAST = 'Krótkie polecenie na start — /brief doda repo, stawkę i kryterium „gotowe”'

type Silnik = {
  /** Ile promptów właściciel już wysłał ($.session.turns); 0 = tura 1 nowej sesji. */
  turns?: number
  cwd?: string
  /** Wpisy katalogu cwd (wszystkie jako katalogi). */
  katalogi?: string[]
  store?: Record<string, unknown>
  /** `$.fs.list` rzuca (folder nieczytelny). */
  listaPada?: boolean
  /** Panel otwarty, ale nie narysowany (wąski terminal). */
  isPlaced?: boolean
  /** Pole promptu nie przyjmuje tekstu (dialog trzyma klawiaturę). */
  nieWypelnia?: boolean
  /** `$.ui.close` rzuca (hook innego pluginu odmówił). */
  zamkniecieRzuca?: boolean
  /** `$.ui.copy` odmawia z powodem. */
  schowekOdmawia?: boolean
  /** `$.session.turns` i `$.session.cwd` rzucają (awaria silnika) — mod ma przepuścić polecenie. */
  sesjaRzuca?: boolean
}

/** Dno pod modem. Zwraca rejestr wywołań, które test sprawdza. */
function silnik(on: On, s: Silnik = {}) {
  const store = new Map<string, unknown>(Object.entries(s.store ?? {}))
  const log = {
    toasty: [] as string[],
    fill: [] as { text: string; mode: string }[],
    copy: [] as { text: string; surface: string | undefined }[],
    open: [] as string[],
    close: [] as string[],
    /** Teksty, które doszły do dna `prompt.submit` — czyli weszły do sesji. */
    przeszlo: [] as string[],
    /** Całe wejścia `prompt.submit`, które doszły do dna (czy mod czegoś nie dopisał). */
    zdarzenia: [] as PromptSubmitInput[],
    store,
  }
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
  on('session.cwd', () => {
    if (s.sesjaRzuca) throw new Error('cwd padło')
    return { value: s.cwd ?? FOLDER }
  })
  on('session.turns', () => {
    if (s.sesjaRzuca) throw new Error('turns padło')
    return { value: s.turns ?? 0 }
  })
  on('fs.list', () => {
    if (s.listaPada) throw new Error('EACCES: permission denied')
    return { value: (s.katalogi ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('ui.toast', (_$, e) => {
    log.toasty.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    log.copy.push({ text: e.text, surface: e.surface })
    return { value: s.schowekOdmawia ? { isCopied: false as const, reason: 'no-clipboard' as const } : { isCopied: true as const } }
  })
  on('ui.open', (_$, e) => {
    log.open.push(e.id)
    return { value: s.isPlaced === false ? { isPlaced: false as const, reason: 'terminal ma 100 kolumn, próg 144' } : { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    if (s.zamkniecieRzuca) throw new Error('close padło')
    log.close.push(e.id)
    return { value: undefined }
  })
  // `refusal` z odpowiedzi hooka silnik zdejmuje (typy: „a hook's own refusal carries none”) — gałęzie `dialog`/`no_composer`
  // są poza zasięgiem kitu; test sprawdza gałąź „przyczyna nieznana”.
  on('prompt.fill', (_$, e) => {
    log.fill.push({ text: e.text, mode: e.mode })
    return { isFilled: !s.nieWypelnia }
  })
  on('prompt.submit', (_$, e) => {
    log.przeszlo.push(e.text)
    log.zdarzenia.push(e)
    return { text: e.text, origin: e.origin }
  })
  on('command.run', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  return log
}

const ramy = (zmiany: Partial<Parameters<typeof zloz>[1]> = {}) => ({ repo: '', stawka: null, tryb: null, gotowe: '', recall: false, granice: PUSTE_GRANICE, ...zmiany })

test('zloz(): tylko wypełnione pola; sam tekst bez ram, sam blok bez tekstu, nic → ""; białe znaki przycięte', async () => {
  expect(zloz('  napraw test  ', ramy())).toBe('napraw test')
  expect(zloz('', ramy())).toBe('')
  expect(zloz('', ramy({ tryb: 'sam' }))).toBe('Ramy:\n- Tryb: sam')
  const pelne = ramy({ repo: ' ~/Developer/x ', stawka: 'wysoka', tryb: 'workflow', gotowe: ' testy zielone ', recall: true, granice: { produkcja: true, pii: true, push: true } })
  expect(zloz('zrób', pelne)).toBe(
    [
      'zrób',
      '',
      'Ramy:',
      '- Repo/folder: ~/Developer/x',
      `- Stawka: wysoka — analizę oddziel od mutacji, zgoda na każdy zapis`,
      '- Tryb: workflow',
      '- Gotowe, gdy: testy zielone',
      `- Recall: najpierw /ops-recall`,
      '- Granice: bez zapisu na produkcję, bez PII do gita, bez pusha',
    ].join('\n'),
  )
  expect(zloz('x', ramy({ stawka: 'niska' })), 'tylko wysoka ma dopisek').toBe('x\n\nRamy:\n- Stawka: niska')
})

test('toast raz w turze 1 przy poleceniu < 200 znaków; polecenie przechodzi niezmienione; drugie krótkie w tej sesji — cisza', async ($, on) => {
  const log = silnik(on, { turns: 0 })
  const r = await wpisz($, 'napraw test')
  expect(r.text).toBe('napraw test')
  expect(r.origin).toEqual({ kind: 'composer' })
  expect(log.zdarzenia[0], 'do dna dochodzi wejście bez dopisków (context, drop)').toEqual({ text: 'napraw test', wait: false, origin: { kind: 'composer' } })
  expect(log.przeszlo).toEqual(['napraw test'])
  expect(log.toasty).toEqual([TOAST])
  await wpisz($, 'jeszcze raz krótko')
  expect(log.przeszlo).toEqual(['napraw test', 'jeszcze raz krótko'])
  expect(log.toasty, 'flaga w $.state: raz na sesję, choć dno nadal mówi turns = 0').toHaveLength(1)
})

test('bez toastu: 200 znaków i więcej, komenda slash — wszystko przechodzi niezmienione', async ($, on) => {
  const log = silnik(on, { turns: 0 })
  const dlugi = 'zbuduj '.repeat(40).trim() // 279 znaków
  expect(dlugi.length).toBeGreaterThanOrEqual(200)
  await wpisz($, dlugi)
  await wpisz($, '/brief')
  await wpisz($, '   ')
  expect(log.toasty).toEqual([])
  expect(log.przeszlo).toEqual([dlugi, '/brief', '   '])
})

test('sesja wznowiona albo kolejna tura (turns = 3): krótkie polecenie bez toastu, przechodzi niezmienione', async ($, on) => {
  const log = silnik(on, { turns: 3 })
  const r = await wpisz($, 'krótko')
  expect(r.text).toBe('krótko')
  expect(log.toasty).toEqual([])
})

test('origin nie-osoby (notyfikacja zadania, plugin) w turze 1: bez toastu; origin `human` (desktop stempluje tak w transkryptach, poza typami) — toast', async ($, on) => {
  const log = silnik(on, { turns: 0 })
  await wpisz($, 'krótko', { kind: 'task-notification' })
  await wpisz($, 'krótko', { kind: 'plugin', name: 'inny-mod' })
  expect(log.toasty, 'lista wykluczeń: nie-osoba nie dostaje toastu').toEqual([])
  await wpisz($, 'krótko', { kind: 'human' } as unknown as PromptOrigin)
  expect(log.toasty, 'origin spoza typów liczy się jak osoba').toEqual([TOAST])
  expect(log.przeszlo).toEqual(['krótko', 'krótko', 'krótko'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/brief <tekst> + formularz: podkatalogi, złożenie z wypełnionych pól (puste pominięte), prompt.fill replace, panel zamknięty, pamięć folderu (${surface})`, async ($, on) => {
    const log = silnik(on, { katalogi: ['kanon-agenci', 'kanon-brief', '.git'] })
    const t = await $.command.run(komenda('zbuduj mod kanon-brief'))
    expect(t.text).toContain(`Formularz ram otwarty (${FOLDER})`)
    expect(log.open).toEqual(['brief'])

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props })
    expect((await pane.find({ type: 'Input', key: 'polecenie' }))?.text).toBe('zbuduj mod kanon-brief')
    expect((await pane.find({ type: 'Input', key: 'repo' }))?.text).toBe(FOLDER)
    expect(await pane.find({ type: 'Button', key: 'kat-kanon-agenci' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'kat-.git' }), 'ukryte katalogi bez przycisku').toBeUndefined()
    expect((await pane.find({ text: /^ramy:/ }))?.text).toContain(`Repo/folder: ${FOLDER}`)

    await pane.press({ key: 'kat-kanon-brief' })
    expect((await pane.find({ type: 'Input', key: 'repo' }))?.text).toBe(`${FOLDER}/kanon-brief`)
    await pane.press({ key: 'stawka-wysoka' })
    expect((await pane.find({ key: 'stawka-wysoka' }))?.text).toContain('(•) wysoka')
    expect((await pane.find({ key: 'stawka-niska' }))?.text).toContain('( ) niska')
    await pane.input({ key: 'gotowe', text: 'validate czysty i 6 testów', kind: 'change' }) // bez Entera — szkic
    await pane.press({ key: 'recall' })
    await pane.press({ key: 'granica-push' })
    await pane.press({ key: 'uruchom' })

    expect(log.fill).toEqual([
      {
        text: [
          'zbuduj mod kanon-brief',
          '',
          'Ramy:',
          `- Repo/folder: ${FOLDER}/kanon-brief`,
          `- Stawka: wysoka — analizę oddziel od mutacji, zgoda na każdy zapis`,
          '- Gotowe, gdy: validate czysty i 6 testów',
          `- Recall: najpierw /ops-recall`,
          '- Granice: bez pusha',
        ].join('\n'),
        mode: 'replace',
      },
    ])
    expect(log.close).toEqual(['brief'])
    expect(log.toasty.at(-1)).toBe('Brief: polecenie w polu promptu — Enter wysyła')
    expect(log.store.get(KLUCZ), 'pamięć folderu bez tekstu polecenia i bez „gotowe”').toEqual({
      repo: `${FOLDER}/kanon-brief`,
      stawka: 'wysoka',
      tryb: null,
      recall: true,
      granice: { produkcja: false, pii: false, push: true },
    })
    expect(log.przeszlo, 'Uruchom nie wysyła polecenia — Enter naciska właściciel').toEqual([])
    await pane.unmount()
  })
}

test('Kopiuj: schowek dostaje złożone polecenie (tekst ze szkicu, tryb z przycisku), pole promptu nietknięte, panel zostaje', async ($, on) => {
  const log = silnik(on)
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  expect((await pane.find({ type: 'Input', key: 'polecenie' }))?.text).toBe('')
  await pane.input({ key: 'polecenie', text: 'przejrzyj README', kind: 'change' })
  await pane.press({ key: 'tryb-sam' })
  await pane.press({ key: 'kopiuj' })
  expect(log.copy.map(c => c.text)).toEqual([`przejrzyj README\n\nRamy:\n- Repo/folder: ${FOLDER}\n- Tryb: sam`])
  expect(log.fill).toEqual([])
  expect(log.close).toEqual([])
  expect(log.toasty.at(-1)).toBe('Brief: polecenie w schowku')
  await pane.unmount()
})

test('Pomiń: zamyka panel bez fill, bez kopiowania i bez zapisu pamięci', async ($, on) => {
  const log = silnik(on)
  await $.command.run(komenda('coś'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  await pane.press({ key: 'stawka-istotna' })
  await pane.press({ key: 'pomin' })
  expect(log.close).toEqual(['brief'])
  expect(log.fill).toEqual([])
  expect(log.copy).toEqual([])
  expect(log.store.size).toBe(0)
  await pane.unmount()
})

test('nic do złożenia (puste polecenie, repo wyczyszczone, nic nie zaznaczone): Uruchom nie wypełnia promptu, tylko toast', async ($, on) => {
  const log = silnik(on)
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  await pane.press({ key: 'stawka-wysoka' })
  await pane.press({ key: 'uruchom' })
  expect(log.fill, 'same ramy (repo = cwd, stawka) bez tekstu to nie zadanie').toEqual([])
  expect(log.close).toEqual([])
  expect(log.toasty).toEqual(['Brief: wpisz polecenie — same ramy to nie zadanie'])
  await pane.input({ key: 'repo', text: '', kind: 'change' })
  await pane.press({ key: 'stawka-wysoka' }) // zdejmuje
  await pane.press({ key: 'kopiuj' })
  expect(log.copy, 'Kopiuj: nic do złożenia dopiero, gdy pusto wszędzie').toEqual([])
  expect(log.toasty.at(-1)).toBe('Brief: nic do skopiowania — wpisz polecenie albo zaznacz pola')
  await pane.unmount()
})

test('pamięć per folder: /brief w folderze z wpisem wypełnia formularz (bez „gotowe”); inny folder startuje pusto; /brief wyczysc kasuje wpis', async ($, on) => {
  const wpis = { repo: `${FOLDER}/kanon-flota`, stawka: 'istotna', tryb: 'subagent', recall: true, granice: { produkcja: true, pii: false, push: true } }
  const log = silnik(on, { store: { [KLUCZ]: wpis, 'brief:/inny': { stawka: 'wysoka' } } })
  const t = await $.command.run(komenda())
  expect(t.text).toContain('pola z pamięci folderu')
  let pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect((await pane.find({ type: 'Input', key: 'repo' }))?.text).toBe(`${FOLDER}/kanon-flota`)
  expect((await pane.find({ key: 'stawka-istotna' }))?.text).toContain('(•) istotna')
  expect((await pane.find({ key: 'tryb-subagent' }))?.text).toContain('(•) subagent')
  expect((await pane.find({ key: 'recall' }))?.text).toContain('[x]')
  expect((await pane.find({ key: 'granica-produkcja' }))?.text).toContain('[x]')
  expect((await pane.find({ key: 'granica-pii' }))?.text).toContain('[ ]')
  expect((await pane.find({ type: 'Input', key: 'gotowe' }))?.text).toBe('')
  await pane.unmount()

  const w = await $.command.run(komenda('wyczysc'))
  expect(w.text).toBe(`Pamięć ram folderu ${FOLDER} wyczyszczona.`)
  expect(log.close, 'wyczysc zamyka formularz — otwarty zapisałby wpis z powrotem').toEqual(['brief'])
  expect(log.store.has(KLUCZ)).toBe(false)
  expect(log.store.has('brief:/inny'), 'wpis innego folderu zostaje').toBe(true)

  const t2 = await $.command.run(komenda())
  expect(t2.text).not.toContain('pola z pamięci')
  pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect((await pane.find({ type: 'Input', key: 'repo' }))?.text).toBe(FOLDER)
  expect((await pane.find({ key: 'stawka-istotna' }))?.text).toContain('( ) istotna')
  expect((await pane.find({ key: 'recall' }))?.text).toContain('[ ]')
  await pane.unmount()
})

test('wpis pamięci spoza wzorca (ręczna edycja): pola nieznane pominięte, formularz działa', async ($, on) => {
  silnik(on, { store: { [KLUCZ]: { stawka: 'ogromna', tryb: 'sam', repo: 42, granice: 'tak' } } })
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  expect((await pane.find({ key: 'tryb-sam' }))?.text).toContain('(•) sam')
  expect((await pane.find({ key: 'stawka-wysoka' }))?.text).toContain('( ) wysoka')
  expect((await pane.find({ type: 'Input', key: 'repo' }))?.text).toBe(FOLDER)
  await pane.unmount()
})

test('prompt.fill odmawia (dialog trzyma klawiaturę): panel wraca wypełniony, toast kieruje do „Kopiuj”', async ($, on) => {
  const log = silnik(on, { nieWypelnia: true })
  await $.command.run(komenda('coś'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  await pane.press({ key: 'uruchom' })
  expect(log.fill).toHaveLength(1)
  expect(log.close).toEqual(['brief'])
  expect(log.open).toEqual(['brief', 'brief'])
  // `refusal` z odpowiedzi hooka silnik zdejmuje (typy: „a hook's own refusal carries none”) — toast bez przyczyny.
  expect(log.toasty.at(-1)).toBe('Brief: pole promptu nie przyjęło tekstu — użyj „Kopiuj”')
  expect((await pane.find({ type: 'Input', key: 'polecenie' }))?.text).toBe('coś')
  await pane.unmount()
})

test('$.fs.list pada: formularz bez przycisków podkatalogów, komenda nie pada; panel bez miejsca → odpowiedź z powodem', async ($, on) => {
  silnik(on, { listaPada: true, isPlaced: false })
  const t = await $.command.run(komenda())
  expect(t.text).toBe('Formularz ram czeka na szersze okno: terminal ma 100 kolumn, próg 144')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect(await pane.find({ text: 'podkatalogi:' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'uruchom' })).toBeDefined()
  await pane.unmount()
})

test('aplikacja mobilna (bez Input w tabeli): zamiast formularza jedna linia z wyjaśnieniem', async ($, on) => {
  silnik(on)
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', ...PANE, props })
  expect(await pane.find({ text: /aplikacja mobilna nie rysuje/ })).toBeDefined()
  await pane.unmount()
})

test('próg 200 znaków, isMeta, command, origin pusty/bridge/sdk, pozostałe originy nie-osoby', async ($, on) => {
  const log = silnik(on, { turns: 0 })
  await wpisz($, 'a'.repeat(200))
  await wpisz($, 'krótko', { kind: 'composer' }, { isMeta: true })
  await wpisz($, 'brief x', { kind: 'composer' }, { command: { name: 'brief', args: 'x' } })
  for (const kind of ['peer', 'peer-send-message', 'scheduled-trigger', 'auto-continuation', 'coordinator', 'channel'] as const) {
    await wpisz($, 'krótko', { kind } as unknown as PromptOrigin)
  }
  expect(log.toasty, '200 znaków, meta, komenda i originy nie-osoby — cisza').toEqual([])
  await wpisz($, 'a'.repeat(199))
  expect(log.toasty, '199 znaków — toast').toEqual([TOAST])
})

for (const origin of [undefined, { kind: 'bridge' }, { kind: 'sdk' }] as unknown as PromptOrigin[]) {
  test(`origin ${JSON.stringify(origin)} liczy się jak osoba — toast`, async ($, on) => {
    const log = silnik(on, { turns: 0 })
    await wpisz($, 'krótko', origin)
    expect(log.toasty).toEqual([TOAST])
  })
}

test('toast nie odpala na poleceniu, które złożył sam mod, ani po otwarciu /brief', async ($, on) => {
  const log = silnik(on, { turns: 0 })
  await $.command.run(komenda('napraw test'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  await pane.press({ key: 'uruchom' })
  const zlozone = log.fill[0]?.text ?? ''
  expect(zlozone.length, 'krótkie polecenie z ramami nadal poniżej progu').toBeLessThan(200)
  await wpisz($, zlozone) // Enter właściciela na wyniku „Uruchom”
  await wpisz($, 'jeszcze krócej')
  expect(log.toasty).not.toContain(TOAST)
  await pane.unmount()
})

test('fail-open: $.session.turns rzuca → polecenie przechodzi bez toastu; $.session.cwd rzuca → /brief odpowiada tekstem błędu', async ($, on) => {
  const log = silnik(on, { sesjaRzuca: true })
  const r = await wpisz($, 'krótko')
  expect(r.text).toBe('krótko')
  expect(log.przeszlo).toEqual(['krótko'])
  expect(log.toasty).toEqual([])
  const t = await $.command.run(komenda('x'))
  expect(t.text, 'kit zgłasza rzucające dno jako „no implementation for …”').toMatch(/^Brief: błąd modu — .*session\.cwd/)
})

test('Enter w polu zapisuje do stanu i odświeża podgląd; szkic bez Entera wygrywa przy Uruchom; wyczyszczenie Enterem zeruje stan', async ($, on) => {
  const log = silnik(on)
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  await pane.input({ key: 'polecenie', text: 'zbuduj X' }) // Enter
  expect((await pane.find({ type: 'Input', key: 'polecenie' }))?.text).toBe('zbuduj X')
  await pane.input({ key: 'gotowe', text: 'testy zielone' })
  expect((await pane.find({ text: /^ramy:/ }))?.text).toContain('Gotowe, gdy: testy zielone')
  await pane.input({ key: 'polecenie', text: 'zbuduj Y', kind: 'change' }) // szkic nad stanem
  await pane.press({ key: 'uruchom' })
  expect(log.fill[0]?.text).toBe(`zbuduj Y\n\nRamy:\n- Repo/folder: ${FOLDER}\n- Gotowe, gdy: testy zielone`)
  await pane.input({ key: 'gotowe', text: '' })
  expect((await pane.find({ text: /^ramy:/ }))?.text).not.toContain('Gotowe')
  await pane.unmount()
})

test('Kopiuj zapisuje pamięć folderu i podaje surface; schowek odmawia → toast z powodem', async ($, on) => {
  const log = silnik(on, { schowekOdmawia: true })
  await $.command.run(komenda('coś'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  await pane.press({ key: 'tryb-workflow' })
  await pane.press({ key: 'kopiuj' })
  expect(log.copy).toEqual([{ text: `coś\n\nRamy:\n- Repo/folder: ${FOLDER}\n- Tryb: workflow`, surface: 'terminal' }])
  expect(log.store.get(KLUCZ)).toEqual({ repo: FOLDER, stawka: null, tryb: 'workflow', recall: false, granice: PUSTE_GRANICE })
  expect(log.toasty.at(-1)).toBe('Brief: schowek nie przyjął tekstu (no-clipboard)')
  await pane.unmount()
})

test('$.ui.close rzuca przy Uruchom: toast z błędem, bez fill, panel nie jest otwierany ponownie', async ($, on) => {
  const log = silnik(on, { zamkniecieRzuca: true })
  await $.command.run(komenda('coś'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props })
  await pane.press({ key: 'uruchom' })
  expect(log.fill).toEqual([])
  expect(log.open).toEqual(['brief'])
  expect(log.toasty.at(-1)).toMatch(/^Brief: błąd — .*ui\.close.*; użyj „Kopiuj”$/)
  await pane.unmount()
})

test('/brief zamknij zamyka panel; alias wyczyść; pusty repo z pamięci → cwd; >12 podkatalogów → „+N więcej”, node_modules pominięte', async ($, on) => {
  const katalogi = [...Array.from({ length: 15 }, (_, i) => `repo-${String(i).padStart(2, '0')}`), 'node_modules']
  const log = silnik(on, { katalogi, store: { [KLUCZ]: { repo: '', stawka: 'niska' } } })
  await $.command.run(komenda())
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props })
  expect((await pane.find({ type: 'Input', key: 'repo' }))?.text, 'puste repo z pamięci nie nadpisuje cwd').toBe(FOLDER)
  expect((await pane.find({ key: 'stawka-niska' }))?.text).toContain('(•) niska')
  expect(await pane.find({ key: 'kat-repo-11' })).toBeDefined()
  expect(await pane.find({ key: 'kat-repo-12' }), '13. przycisk nie istnieje').toBeUndefined()
  expect(await pane.find({ key: 'kat-node_modules' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /więcej/ }))?.text).toBe('+3 więcej — wpisz ścieżkę')
  await pane.unmount()
  expect((await $.command.run(komenda('zamknij'))).text).toBe('Formularz ram zamknięty.')
  expect(log.close).toEqual(['brief'])
  await $.command.run(komenda('wyczyść'))
  expect(log.store.has(KLUCZ)).toBe(false)
})
