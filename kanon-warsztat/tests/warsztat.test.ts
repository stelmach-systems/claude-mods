// Testy modu kanon-warsztat: `claude plugin test <folder modu>`.
// Hooki `on` testu stoją POD modem i odgrywają silnik: dysk w pamięci (katalog /tmp/dom-testu ze ZMYŚLONYM mini-d.ts, zmyślonymi
// binarkami i katalogiem modu `kanon-proba`), zegar `mock.clock`, `process.run` zafałszowane scenariuszem (OK / FAIL / timeout / brak
// binarki) z rejestrem każdego argv, cwd, timeoutu i env — po nim strażnik sprawdza, że mod nie woła niczego spoza zamkniętej listy.
// Odmowy nounów dno oddaje przez `{ deny }`, jak silnik (rzucający hook dna silnik pomija).
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { BAZY, LIMIT_WYNIKU, TIMEOUT_MS, TSC_JS, TYPY, WERSJA_INDEKSU, argvDozwolone, jsdoc, ocen, porownajWersje, przytnij, rozwin, sygnatura, szukaj, wBazie, zbudujIndeks } from '../hooks/register'
import type { Indeks, Warsztat, Wpis } from '../types'

const PLUGIN = 'kanon-warsztat'
const NARZEDZIE = 'mcp__kanon-warsztat__szukaj'
const PANE = { component: 'Pane' as const, requestId: 'warsztat' }
const paneProps = { title: 'Warsztat', isFocused: true, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const komenda = (args = '') => ({ command: 'warsztat', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })

const HOME = '/tmp/dom-testu'
const MODY = `${HOME}/Developer/claude-mods`
const PROBA = `${MODY}/kanon-proba`
const CLI = `${HOME}/.local/bin/claude`
const NODE = `${HOME}/.local/bin/node`
const TSC = `${HOME}/${TSC_JS}`
const DESK_BAZA = `${HOME}/Library/Application Support/Claude/claude-code`
const DESK = `${DESK_BAZA}/2.1.299/4fa9694b7975/claude.app/Contents/MacOS/claude`
const T0 = Date.UTC(2026, 9, 17, 12, 0, 0)

type Dolar = Parameters<TestBody>[0]
type Plik = { tekst: string; mtimeMs: number }

// ---------- zmyślony mini-d.ts w kształcie prawdziwego (wcięcia 2/6/10, JSDoc nad deklaracją, dwa moduły) ----------
const MINI = [
  "declare module 'claude-code' {",
  '  /**',
  '   * Porcja strumienia.',
  '   */',
  '  export type ChunkOf = {',
  "      'process.spawn': ProcessSpawnChunk;",
  '  };',
  '',
  '  export interface CoreEngineInterface {',
  '      plugin: {',
  '          name: string;',
  '          root: string;',
  '      };',
  '      /**',
  '       * Pliki hosta.',
  '       */',
  '      fs: {',
  '          /**',
  '           * Lists a directory.',
  '           *',
  '           * @example',
  '           * const entries = await $.fs.list("src")',
  '           */',
  '          list: (path: string) => Promise<FsEntry[]>;',
  '          read: (path: string, options?: { encoding?: string }) => Promise<string>;',
  '      };',
  '      tool: {',
  "          call: EventCalls['tool']['call'];",
  "          register: (tool: ToolSpec) => Promise<OpValueOf['tool.register']>;",
  '      };',
  '  }',
  '',
  '  export interface EngineInterface extends CoreEngineInterface {',
  '  }',
  '',
  '  export type EngineEventOf = {',
  '      /**',
  '       * Fires when the engine is about to run a tool.',
  '       *',
  '       * @remarks A guard that fails is skipped.',
  '       */',
  "      'tool.call': ToolCallInput;",
  "      'session.start': SessionStartInput;",
  '  };',
  '  export type EngineResultOf = {',
  "      'tool.call': ToolCallResult;",
  "      'session.start': SessionStartResult;",
  '  };',
  '  export type OpEventOf = {',
  '      /**',
  '       * The argument of `$.fs.list(path)`.',
  '       */',
  "      'fs.list': {",
  '          path: string;',
  '      };',
  "      'process.run': {",
  '          argv: readonly string[];',
  '          init?: ProcessRunInit;',
  '      };',
  "      'tool.register': RegisteredToolSpec;",
  '  };',
  '  export type OpValueOf = {',
  "      'process.run': ProcessRunResult;",
  "      'tool.register': {",
  '          tool: string;',
  '      };',
  '  };',
  '',
  '  /**',
  '   * What `$.session.usage()` answers.',
  '   */',
  '  export type SessionUsage = {',
  '      /**',
  '       * When the session began.',
  '       */',
  '      startedAt: number;',
  '      context: {',
  '          used: number;',
  '      };',
  '  };',
  '  export type ToolDeferral = boolean;',
  '  export type ToolCallResult<Name extends string = string> = {',
  '      deny: string;',
  '  } | {',
  '      result: ToolResultOf<Name>;',
  '  };',
  '  type McpToolCallInputFallback = {',
  '      tool: McpToolName;',
  '  };',
  '  export const atom: <T>(ref: AtomRef, initial: T) => Atom<T>;',
  '  /**',
  ...Array.from({ length: 30 }, (_, i) => `   * Akapit ${i + 1}: ${'zmyślony opis '.repeat(6)}`),
  '   */',
  '  export type Dlugi = {',
  '      a: number;',
  '  };',
  '}',
  "declare module 'claude-code/testing' {",
  '  export const test: (name: string, ...rest: TestRest) => void;',
  '  export type TestBody = ($: Engine, on: On) => unknown;',
  '}',
].join('\n')
const LINIE = MINI.split('\n')
/** Numer (1-based) pierwszej linii zawierającej fragment. */
const L = (fragment: string) => {
  const i = LINIE.findIndex(l => l.includes(fragment))
  if (i < 0) throw new Error(`brak w MINI: ${fragment}`)
  return i + 1
}
const IND = zbudujIndeks(MINI)
const wpis = (nazwa: string, blok?: string) => IND.find(w => w.nazwa === nazwa && (blok === undefined || w.blok === blok))

// ---------- wyjścia zmyślonych komend ----------
const OK: Record<string, ProcessRunResult> = {
  validate: { exitCode: 0, stdout: 'Validating plugin…\n✔ Validation passed\n./register.tsx calls: $.fs.list\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  test: { exitCode: 0, stdout: '(pass) a [3ms]\n(pass) b [1ms]\n\n 12 pass\nRan 12 tests across 1 file. [0.40s]\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  tsc: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
}
const FAIL: Record<string, ProcessRunResult> = {
  validate: { exitCode: 1, stdout: '✘ Validation failed\n  hooks/register.tsx: $.state key "x" not in contract\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  test: { exitCode: 1, stdout: '(pass) a [3ms]\n(fail) b [2ms]\n  expected 1 to be 2\n(fail) c\n\n 10 pass\n 2 fail\nRan 12 tests across 1 file. [0.41s]\n', stderr: 'error: 2 tests failed', isStdoutTruncated: false, isStderrTruncated: false },
  tsc: { exitCode: 2, stdout: "hooks/register.tsx(10,5): error TS2322: Type 'string' is not assignable to type 'number'.\nhooks/register.tsx(20,1): error TS2345: Argument of type…\n", stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
}
const rodzaj = (argv: readonly string[]) => (argv.includes('validate') ? 'validate' : argv.includes('test') ? 'test' : 'tsc')

type Wynik = 'ok' | 'fail' | 'timeout' | 'brak' | ProcessRunResult
type Silnik = {
  /** Dysk: ścieżka → plik; katalogi istnieją, gdy mają plik albo są w `katalogi`. */
  pliki?: Record<string, Plik>
  katalogi?: string[]
  cwd?: string
  root?: string
  /** Wynik zmyślonego `process.run` dla argv (domyślnie wszystko OK). */
  proces?: (argv: readonly string[], numer: number) => Wynik
  /** Gdy ustawione, pierwszy `process.run` czeka na `zwolnij()`. */
  wstrzymajPierwszy?: boolean
  /** Odczyt pliku typów odmawia (EACCES). */
  typyNieczytelne?: boolean
  schowekOdmawia?: boolean
  isPlaced?: boolean
  /** Dowiązania: ścieżka (albo jej prefiks) → dokąd prowadzi; `fs.stat` z `resolve` oddaje to jako `realPath`. */
  dowiazania?: Record<string, string>
  /** Wartości zastane w `$.state` (jak po hot-reloadzie modułu): oddawane przez dno `state.get`, dopóki mod sam nie zapisze klucza. */
  zastane?: { indeks?: Indeks; warsztat?: Warsztat }
}

/** Dno pod modem. Zwraca rejestr wywołań, dysk, zegar, `start` (session.start) i `zwolnij` (puszcza wstrzymany proces). */
function silnik($: Dolar, on: On, s: Silnik = {}) {
  const dysk = new Map<string, Plik>(Object.entries(s.pliki ?? {}))
  const katalogi = new Set(s.katalogi ?? [])
  let zwolnij: () => void = () => undefined
  const log = {
    procesy: [] as { argv: string[]; cwd: string | undefined; timeoutMs: number | undefined; env: Record<string, string> | undefined }[],
    narzedzia: [] as { name: string; required: unknown }[],
    komendy: [] as string[],
    odczyty: [] as string[],
    toasty: [] as string[],
    copy: [] as { text: string; surface: string | undefined }[],
    open: [] as string[],
    close: [] as string[],
    /** Każdy zapis `$.state` (klucz, wartość). */
    stany: [] as { key: string; value: unknown }[],
    dysk,
  }
  const zegar = mock.clock(on, { now: T0 })
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: s.cwd ?? PROBA }))
  on('session.root', () => ({ value: s.root ?? MODY }))
  on('fs.exists', (_$, e) => ({ value: dysk.has(e.path) || katalogi.has(e.path) }))
  const jestKatalogiem = (p: string) => katalogi.has(p) || [...dysk.keys(), ...katalogi].some(k => k.startsWith(`${p}/`))
  const realna = (p: string) => {
    for (const [od, dokad] of Object.entries(s.dowiazania ?? {})) if (p === od || p.startsWith(`${od}/`)) return dokad + p.slice(od.length)
    return p
  }
  on('fs.stat', (_$, e) => {
    const f = dysk.get(e.path)
    const real = e.resolve ? { realPath: realna(e.path) } : {}
    if (f) return { value: { kind: 'file' as const, size: f.tekst.length, mtimeMs: f.mtimeMs, isLink: false, ...real } }
    if (jestKatalogiem(e.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...real } }
    return { deny: `ENOENT: no such file or directory, stat '${e.path}'` }
  })
  on('fs.list', (_$, e) => {
    const dir = e.path.replace(/\/$/, '')
    const bezposredni = (p: string) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')
    const pliki = [...dysk.entries()].filter(([p]) => bezposredni(p)).map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file' as const, size: f.tekst.length, mtimeMs: f.mtimeMs, isLink: false }))
    // podkatalogi: jawne z `katalogi` i wynikające z głębszych ścieżek
    const pod = new Set<string>()
    for (const p of [...dysk.keys(), ...katalogi]) if (p.startsWith(`${dir}/`) && p.slice(dir.length + 1).includes('/')) pod.add(p.slice(dir.length + 1).split('/')[0] ?? '')
    for (const k of katalogi) if (bezposredni(k)) pod.add(k.slice(dir.length + 1))
    const dirs = [...pod].filter(Boolean).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
    if (!pliki.length && !dirs.length) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: [...pliki, ...dirs] }
  })
  on('fs.read', (_$, e) => {
    log.odczyty.push(e.path)
    const f = dysk.get(e.path)
    if (!f) return { deny: `ENOENT: ${e.path}` }
    if (s.typyNieczytelne) return { deny: `EACCES: permission denied, open '${e.path}'` }
    return { value: f.tekst }
  })
  on('process.run', async (_$, e) => {
    const numer = log.procesy.length + 1
    log.procesy.push({ argv: [...e.argv], cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs, env: e.init?.env })
    if (s.wstrzymajPierwszy && numer === 1) await new Promise<void>(r => (zwolnij = r))
    const w = s.proces?.(e.argv, numer) ?? 'ok'
    if (w === 'brak') return { deny: `spawn ${e.argv[0]} ENOENT` }
    if (w === 'timeout') return { deny: `process.run: timed out after ${e.init?.timeoutMs ?? 30_000} ms` }
    if (typeof w === 'object') return { value: w }
    const r = (w === 'ok' ? OK : FAIL)[rodzaj(e.argv)]
    if (!r) throw new Error('scenariusz bez wyniku')
    return { value: r }
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
    log.close.push(e.id)
    return { value: undefined }
  })
  const zapisane = new Set<string>()
  on('state.set', (_$, e, next) => {
    log.stany.push({ key: e.key, value: e.value })
    zapisane.add(e.key)
    return next(e)
  })
  on('state.get', (_$, e, next) => {
    // Bez zastanych wartości czyste przepuszczenie (synchroniczne — dodatkowe mikrotaski zmieniałyby kolejność zdarzeń w testach).
    const zastane = (s.zastane as Record<string, unknown> | undefined)?.[e.key]
    if (zastane === undefined || zapisane.has(e.key)) return next(e)
    type Odp = Awaited<ReturnType<typeof next>>
    return Promise.resolve(next(e)).then(r => {
      const odp = r as Odp & { value?: { value: unknown; version: number } }
      return (odp.value && odp.value.value === undefined ? { value: { ...odp.value, value: zastane } } : odp) as unknown as Odp
    })
  })
  on('command.register', (_$, e) => {
    log.komendy.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => {
    log.narzedzia.push({ name: e.name, required: e.inputSchema.required })
    return { value: { tool: `mcp__${PLUGIN}__${e.name}` } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const start = () => $.session.start({ cwd: s.cwd ?? PROBA, surface: 'terminal', isInteractive: true })
  return { log, zegar, start, zwolnij: () => zwolnij() }
}

/** Standardowy dysk: katalog modu z plugin.json, CLI, node, tsc.js, desktop 2.1.295 + 2.1.299 (+ 2.1.30 bez binarki i 2.1.300 pusty), mini-d.ts w katalogu modu. */
const dysk = (): Record<string, Plik> => ({
  [`${PROBA}/.claude-plugin/plugin.json`]: { tekst: '{"name":"kanon-proba"}', mtimeMs: T0 },
  [`${PROBA}/${TYPY}`]: { tekst: MINI, mtimeMs: T0 - 1000 },
  [CLI]: { tekst: 'bin', mtimeMs: T0 },
  [NODE]: { tekst: 'bin', mtimeMs: T0 },
  [TSC]: { tekst: 'js', mtimeMs: T0 },
  [`${DESK_BAZA}/2.1.295/9d6405864fdc/claude.app/Contents/MacOS/claude`]: { tekst: 'bin', mtimeMs: T0 },
  [DESK]: { tekst: 'bin', mtimeMs: T0 },
  [`${DESK_BAZA}/2.1.30/abc123/claude.app/Contents/Info.plist`]: { tekst: 'bez binarki', mtimeMs: T0 },
})
const KATALOGI = [`${DESK_BAZA}/2.1.300`, `${MODY}/pusty`, `${HOME}/Developer/claude-mods-stabilne/kanon-proba`]
const ARGV_OK = [
  [CLI, 'plugin', 'validate', '.'],
  [CLI, 'plugin', 'test', '.'],
  [DESK, 'plugin', 'validate', '.'],
  [DESK, 'plugin', 'test', '.'],
  [NODE, TSC, '--noEmit', '-p', '.'],
]
/** Odpowiedź hooka: `{ result: tekst }` (string — silnik waliduje `result` wg schematu narzędzia) albo `{ deny: tekst }` = błąd narzędzia dla modelu. */
const tekst = (r: { result?: unknown; deny?: string }) => ({ text: r.deny ?? (typeof r.result === 'string' ? r.result : `NIE-STRING: ${JSON.stringify(r.result)}`), isError: r.deny !== undefined })
/** `$.tool.call` na narzędziu modu: unia nazw narzędzi w typach jest zamknięta na te, które silnik znał przy kładzeniu typów
 *  (narzędzia rejestrowanego przez mod tam nie ma), więc wywołanie idzie przez `unknown`; silnik i tak kieruje je do hooka modu. */
const szukajPrzezSilnik = ($: Dolar, args: Record<string, unknown>) =>
  ($.tool.call as unknown as (input: unknown) => Promise<{ result?: unknown; deny?: string }>)({ tool: NARZEDZIE, ...args })

test('zbudujIndeks(): zdarzenia w 4 blokach, rzeczowniki i metody $, typy jedno- i wieloliniowe (`} | {`), JSDoc nad deklaracją, oba moduły, pola zwykłych typów pominięte', async () => {
  expect(wpis('tool.call', 'EngineEventOf')).toEqual({ nazwa: 'tool.call', rodzaj: 'zdarzenie', blok: 'EngineEventOf', od: L("'tool.call': ToolCallInput"), do: L("'tool.call': ToolCallInput"), docOd: L('Fires when the engine') - 1 })
  expect(IND.filter(w => w.nazwa === 'tool.call').map(w => `${w.rodzaj}:${w.blok}`)).toEqual(['zdarzenie:EngineEventOf', 'zdarzenie:EngineResultOf'])
  expect(wpis('process.run', 'OpEventOf'), 'zdarzenie wieloliniowe kończy się na `};` na swoim wcięciu').toEqual({ nazwa: 'process.run', rodzaj: 'zdarzenie', blok: 'OpEventOf', od: L("'process.run': {"), do: L("'process.run': {") + 3, docOd: null })
  expect(wpis('tool.register', 'OpValueOf')?.do).toBe(L("'tool.register': {") + 2)
  expect(wpis('process.spawn')?.blok).toBe('ChunkOf')
  expect(wpis('$.fs')).toEqual({ nazwa: '$.fs', rodzaj: 'rzeczownik', blok: 'CoreEngineInterface', od: L('      fs: {'), do: L('read: (path') + 1, docOd: L('* Pliki hosta') - 1 })
  expect(wpis('$.fs.list')).toEqual({ nazwa: '$.fs.list', rodzaj: 'metoda', blok: 'CoreEngineInterface', od: L('list: (path'), do: L('list: (path'), docOd: L('* Lists a directory') - 1 })
  expect(IND.filter(w => w.rodzaj === 'metoda').map(w => w.nazwa)).toEqual(['$.plugin.name', '$.plugin.root', '$.fs.list', '$.fs.read', '$.tool.call', '$.tool.register'])
  expect(IND.filter(w => w.rodzaj === 'rzeczownik').map(w => w.nazwa)).toEqual(['$.plugin', '$.fs', '$.tool'])
  expect(wpis('CoreEngineInterface')).toEqual({ nazwa: 'CoreEngineInterface', rodzaj: 'typ', blok: 'interface · claude-code', od: L('export interface CoreEngineInterface'), do: L('export interface EngineInterface') - 2, docOd: null })
  expect(wpis('EngineInterface')?.do, 'interfejs pusty kończy się na `}`').toBe(L('export interface EngineInterface') + 1)
  expect(wpis('SessionUsage')).toEqual({ nazwa: 'SessionUsage', rodzaj: 'typ', blok: 'type · claude-code', od: L('export type SessionUsage'), do: L('          used: number;') + 2, docOd: L('* What `$.session.usage()`') - 1 })
  expect(wpis('ToolDeferral')?.do, 'jednoliniowy').toBe(wpis('ToolDeferral')?.od)
  expect(wpis('ToolCallResult')?.do, '`} | {` ciągnie typ dalej').toBe(L('      result: ToolResultOf') + 1)
  expect(wpis('McpToolCallInputFallback')?.blok, 'typ bez export też').toBe('type · claude-code')
  expect(wpis('atom')?.blok).toBe('const · claude-code')
  expect(wpis('test')?.blok).toBe('const · claude-code/testing')
  expect(wpis('TestBody')?.blok).toBe('type · claude-code/testing')
  expect(wpis('Dlugi')?.docOd).toBe(L('* Akapit 1:') - 1)
  for (const n of ['startedAt', 'used', 'deny', 'argv', 'init', 'context', 'name', 'root']) expect(wpis(n), `pole „${n}” zwykłego typu to nie wpis`).toBeUndefined()
  expect(IND.length).toBe(34)
})

test('szukaj(): dokładna nazwa z JSDoc i sygnaturą, inne wystąpienia, metoda bez `$.`, rzeczownik → składniki, typ bez zagnieżdżonych komentarzy, wielkość liter, podciąg → lista, brak, przycięcie do 2048', async () => {
  const sz = (q: string) => szukaj(IND, LINIE, q, 'index.d.ts')
  const tc = sz('tool.call')
  expect(tc.split('\n')[0]).toBe(`tool.call — zdarzenie (EngineEventOf — wejście hooka \`e\`; linie ${L("'tool.call': ToolCallInput")}–${L("'tool.call': ToolCallInput")} w index.d.ts)`)
  expect(tc).toContain('Fires when the engine is about to run a tool.\n\n@remarks A guard that fails is skipped.')
  expect(tc).toContain("\n'tool.call': ToolCallInput;")
  expect(tc, 'po zdarzeniu wejścia: metoda $, potem wynik hooka').toContain(`Inne wystąpienia:\n- metoda w CoreEngineInterface, linia ${L("call: EventCalls")}: call: EventCalls['tool']['call'];\n- zdarzenie w EngineResultOf — wynik hooka, linia ${L("'tool.call': ToolCallResult")}: 'tool.call': ToolCallResult;`)
  expect(tc.includes('/**') || tc.includes(' * '), 'JSDoc bez ramki komentarza').toBe(false)

  const fl = sz('fs.list')
  expect(fl.split('\n')[0]).toBe(`$.fs.list — metoda (CoreEngineInterface; linie ${L('list: (path')}–${L('list: (path')} w index.d.ts)`)
  expect(fl).toContain('Lists a directory.\n\n@example\nconst entries = await $.fs.list("src")')
  expect(fl).toContain('\nlist: (path: string) => Promise<FsEntry[]>;')
  expect(fl, 'zdarzenie OpEventOf o tej nazwie schodzi do innych wystąpień, metoda jest pierwsza').toContain(`Inne wystąpienia:\n- zdarzenie w OpEventOf — argument wywołania \`$\`, linia ${L("'fs.list': {")}: 'fs.list': {`)
  expect(sz('$.fs.list')).toBe(fl)

  const fs = sz('$.fs')
  expect(fs).toContain('Pliki hosta.')
  expect(fs).toContain(`Składniki: $.fs.list (linia ${L('list: (path')}), $.fs.read (linia ${L('read: (path')})`)

  const su = sz('SessionUsage')
  expect(su).toContain('What `$.session.usage()` answers.')
  expect(su).toContain('export type SessionUsage = {\n    startedAt: number;\n    context: {\n        used: number;\n    };\n};')
  expect(su.includes('When the session began'), 'komentarze pól nie wchodzą do sygnatury').toBe(false)
  expect(sz('sessionusage').split('\n')[0], 'bez rozróżniania wielkości liter').toBe(su.split('\n')[0])

  const pr = sz('process.run')
  expect(pr.split('\n')[0]).toBe(`process.run — zdarzenie (OpEventOf — argument wywołania \`$\`; linie ${L("'process.run': {")}–${L("'process.run': {") + 3} w index.d.ts)`)
  expect(pr).toContain("'process.run': {\n    argv: readonly string[];\n    init?: ProcessRunInit;\n};")
  expect(pr).toContain(`- zdarzenie w OpValueOf — wartość wywołania \`$\`, linia ${L("'process.run': ProcessRunResult")}`)

  expect(sz('Result')).toBe(`szukaj: 2 trafień dla „Result” — podaj pełną nazwę:\n- EngineResultOf (typ, linia ${L('export type EngineResultOf')})\n- ToolCallResult (typ, linia ${L('export type ToolCallResult')})`)
  expect(sz('NieMaTakiego').startsWith('szukaj: brak „NieMaTakiego” wśród 34 wpisów index.d.ts.')).toBe(true)
  const dlugie = sz('x'.repeat(5000))
  expect(dlugie.length <= LIMIT_WYNIKU, 'echo zapytania nie rozsadza limitu').toBe(true)
  expect(dlugie.startsWith(`szukaj: brak „${'x'.repeat(80)}…” wśród 34 wpisów`)).toBe(true)
  expect(sz('   ')).toBe('szukaj: podaj nazwę — zdarzenia (tool.call), metody ($.fs.list) albo typu (SessionUsage).')

  const dl = sz('Dlugi')
  expect(dl.length <= LIMIT_WYNIKU, `przycięte: ${dl.length}`).toBe(true)
  expect(dl.endsWith(`… [przycięte do 2048 znaków; pełny tekst: index.d.ts:${L('export type Dlugi')}]`)).toBe(true)
  expect(dl.startsWith('Dlugi — typ (type · claude-code;')).toBe(true)
  expect(przytnij('abc', 'x')).toBe('abc')
  expect(przytnij('a'.repeat(100), 'tu', 60).length, 'limit obejmuje dopisek').toBe(60)
  expect(przytnij('a'.repeat(100), 'tu', 60).endsWith('… [przycięte do 60 znaków; tu]')).toBe(true)
  expect(sygnatura(LINIE, L('export type SessionUsage'), L('          used: number;') + 2).split('\n').length).toBe(6)
  expect(jsdoc(LINIE, L('* Pliki hosta') - 1, L('      fs: {'))).toBe('Pliki hosta.')
})

test('narzędzie szukaj przez silnik: session.start rejestruje komendę i narzędzie, tool.call odpowiada { result: string } (błąd → { deny }), indeks budowany raz (jeden odczyt pliku, jeden zapis $.state), pusta nazwa → podpowiedź bez isError', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  expect(log.komendy).toEqual(['warsztat'])
  expect(log.narzedzia).toEqual([{ name: 'szukaj', required: ['nazwa'] }])
  expect(log.odczyty, 'indeks leniwy: start nic nie czyta').toEqual([])

  const [r1, r1b] = (await Promise.all([szukajPrzezSilnik($, { nazwa: 'tool.call' }), szukajPrzezSilnik($, { nazwa: 'SessionUsage' })])).map(tekst)
  expect(r1!.isError).toBe(false)
  expect(r1b!.text.startsWith('SessionUsage — typ'), 'drugie równoległe wywołanie dołącza do trwającego ładowania').toBe(true)
  expect(r1!.text.startsWith(`tool.call — zdarzenie (EngineEventOf — wejście hooka \`e\`; linie ${L("'tool.call': ToolCallInput")}–`)).toBe(true)
  expect(r1!.text).toContain(`w ${PROBA}/${TYPY})`)
  const r2 = tekst(await szukajPrzezSilnik($, { nazwa: 'fs.list' }))
  expect(r2.text.startsWith('$.fs.list — metoda')).toBe(true)
  const r3 = tekst(await szukajPrzezSilnik($, { nazwa: '' }))
  expect(r3).toEqual({ text: 'szukaj: podaj nazwę — zdarzenia (tool.call), metody ($.fs.list) albo typu (SessionUsage).', isError: false })
  const r4 = tekst(await szukajPrzezSilnik($, {}))
  expect(r4.text.startsWith('szukaj: podaj nazwę'), 'bez argumentu jak z pustym').toBe(true)
  expect(log.odczyty, 'plik czytany raz na życie modułu').toEqual([`${PROBA}/${TYPY}`])
  const zapisy = log.stany.filter(z => z.key === 'indeks')
  expect(zapisy.length, 'indeks zapisany do $.state raz').toBe(1)
  const ind = zapisy[0]?.value as Indeks
  expect(ind.sciezka).toBe(`${PROBA}/${TYPY}`)
  expect(ind.linii).toBe(LINIE.length)
  expect(ind.wersja).toBe(WERSJA_INDEKSU)
  expect(ind.wpisy.length).toBe(34)
  expect(log.procesy, 'narzędzie niczego nie uruchamia').toEqual([])
})

test('plik typów poza katalogiem modu: najnowszy (mtime) z ~/.claude/dev-mods/*/* i ~/Developer/claude-mods/*; nieczytelny → odpowiedź z isError, bez wyjątku', async ($, on) => {
  const DEV = `${HOME}/.claude/dev-mods/aaaaaaaa-0000-4000-8000-000000000001/kanon-inny/${TYPY}`
  const STARY = `${MODY}/kanon-stary/${TYPY}`
  const pliki = dysk()
  delete pliki[`${PROBA}/${TYPY}`]
  pliki[DEV] = { tekst: MINI, mtimeMs: T0 - 1000 }
  pliki[STARY] = { tekst: MINI.replace('Pliki hosta.', 'Stara kopia.'), mtimeMs: T0 - 50_000 }
  const { log, start } = silnik($, on, { pliki, katalogi: KATALOGI })
  await start()
  const r = tekst(await szukajPrzezSilnik($, { nazwa: '$.fs' }))
  expect(r.isError).toBe(false)
  expect(r.text).toContain('Pliki hosta.')
  expect(r.text).toContain(`w ${DEV})`)
  expect(log.odczyty).toEqual([DEV])
})

test('plik typów nieczytelny albo nieobecny → odpowiedź narzędzia z isError i opisem, bez wyjątku; następna próba czyta ponownie', async ($, on) => {
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, typyNieczytelne: true })
  await start()
  const r = tekst(await szukajPrzezSilnik($, { nazwa: 'tool.call' }))
  expect(r.isError).toBe(true)
  expect(r.text.startsWith('szukaj: błąd — ')).toBe(true)
  expect(r.text).toContain('EACCES')
  const r2 = tekst(await szukajPrzezSilnik($, { nazwa: 'tool.call' }))
  expect(r2.isError).toBe(true)
  expect(log.odczyty.length, 'nieudane ładowanie nie zostaje w pamięci').toBe(2)
  expect(log.stany.filter(z => z.key === 'indeks').length).toBe(0)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/warsztat bez argumentu w katalogu modu: 5 kroków w kolejności CLI → desktop (najwyższa wersja z binarką, semver liczbowo) → tsc, każdy z cwd modu, timeoutem 120 s i env bez ruchu sieciowego; panel i /warsztat wynik (${surface})`, async ($, on) => {
    const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
    await start()
    const t = await $.command.run(komenda())
    expect(t.text).toBe(`Warsztat: 5 kroków dla ${PROBA} — wyniki w panelu.`)
    expect(log.open).toEqual(['warsztat'])
    await zegar.settle()
    expect(log.procesy.map(p => p.argv)).toEqual(ARGV_OK)
    expect(log.procesy.every(p => p.cwd === PROBA && p.timeoutMs === TIMEOUT_MS)).toBe(true)
    expect(log.procesy.slice(0, 4).every(p => p.env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1')).toBe(true)
    expect(log.procesy[4]?.env, 'tsc bez env claude').toBeUndefined()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: paneProps })
    expect((await pane.find({ type: 'Text', text: /^Warsztat — / }))?.text).toBe('Warsztat — kanon-proba')
    expect((await pane.find({ type: 'Text', text: /^CLI\s+validate/ }))?.text).toContain('Validation passed')
    expect((await pane.find({ type: 'Text', text: /^CLI\s+test/ }))?.text).toContain('12 pass')
    expect((await pane.find({ type: 'Text', text: /^desktop 2\.1\.299\s+test/ }))?.text).toContain('12 pass')
    expect((await pane.find({ type: 'Text', text: /^tsc\s+tsc/ }))?.text).toContain('bez błędów')
    expect((await pane.findAll({ type: 'Text', text: /^OK\s*$/ })).length, 'pięć wierszy OK').toBe(5)
    expect(await pane.find({ type: 'Text', text: /^(FAIL|TIMEOUT|brak)\s*$/ })).toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /OK · / }))?.text).toBe('5 OK · 0 FAIL · 0 timeout · 0 brak · 0,0 s łącznie')
    expect(await pane.find({ type: 'Button', key: 'powtorz' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'kopiuj' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'zamknij' })).toBeDefined()
    await pane.press({ key: 'kopiuj' })
    expect(log.copy, 'nic nie padło — schowek nietknięty').toEqual([])
    expect(log.toasty).toEqual(['Warsztat: nic do skopiowania — żaden krok nie padł.'])
    await pane.unmount()

    const w = await $.command.run(komenda('wynik'))
    const linie = (w.text ?? '').split('\n')
    expect(linie[0]).toBe(`Warsztat: ${PROBA}`)
    expect(linie[1]?.startsWith('OK      CLI            validate 0,0 s   Validation passed')).toBe(true)
    expect(linie[2]).toContain('12 pass')
    expect(linie[5]?.startsWith('OK      tsc            tsc      0,0 s   bez błędów')).toBe(true)
    expect(linie[6]).toBe('5 OK · 0 FAIL · 0 timeout · 0 brak · 0,0 s łącznie')
    expect((await $.command.run(komenda('zamknij'))).text).toBe('Warsztat zamknięty.')
    expect(log.close).toEqual(['warsztat'])
  })
}

test('kroki, które padły: test z `10 pass, 2 fail`, tsc z 2 błędami TS, validate desktopu „Validation failed”; „Kopiuj błędy” kopiuje argv + stdout/stderr tylko tych kroków, na powierzchni przycisku; schowek odmawia → toast', async ($, on) => {
  const scenariusz = (argv: readonly string[]): Wynik =>
    argv[0] === NODE ? { ...FAIL.tsc!, stdout: FAIL.tsc!.stdout + 'x'.repeat(10_000) } : (argv[0] === CLI && argv[2] === 'test') || (argv[0] === DESK && argv[2] === 'validate') ? 'fail' : 'ok'
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, proces: scenariusz })
  await start()
  await $.command.run(komenda())
  await zegar.settle()
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: paneProps })
  expect((await pane.find({ type: 'Text', text: /^CLI\s+test/ }))?.text).toContain('10 pass, 2 fail (kod 1)')
  expect((await pane.find({ type: 'Text', text: /^desktop 2\.1\.299\s+validate/ }))?.text).toContain('Validation failed (kod 1)')
  expect((await pane.find({ type: 'Text', text: /^desktop 2\.1\.299\s+test/ }))?.text).toContain('12 pass')
  expect((await pane.find({ type: 'Text', text: /^tsc\s+tsc/ }))?.text).toContain('2 błędów TS (kod 2)')
  expect((await pane.findAll({ type: 'Text', text: /^FAIL\s*$/ })).length).toBe(3)
  expect((await pane.findAll({ type: 'Text', text: /^OK\s*$/ })).length).toBe(2)
  expect((await pane.find({ type: 'Text', text: /OK · / }))?.text).toBe('2 OK · 3 FAIL · 0 timeout · 0 brak · 0,0 s łącznie')
  await pane.press({ key: 'kopiuj' })
  expect(log.copy.length).toBe(1)
  expect(log.copy[0]?.surface).toBe('desktop')
  const skopiowane = log.copy[0]?.text ?? ''
  expect(skopiowane).toContain(`## CLI test — FAIL (10 pass, 2 fail (kod 1))\n$ ${CLI} plugin test .\n(pass) a [3ms]\n(fail) b [2ms]`)
  expect(skopiowane).toContain('--- stderr ---\nerror: 2 tests failed')
  expect(skopiowane).toContain(`## desktop 2.1.299 validate — FAIL (Validation failed (kod 1))\n$ ${DESK} plugin validate .`)
  expect(skopiowane).toContain(`## tsc tsc — FAIL (2 błędów TS (kod 2))\n$ ${NODE} ${TSC} --noEmit -p .\nhooks/register.tsx(10,5): error TS2322`)
  const sekcjaTsc = skopiowane.slice(skopiowane.indexOf('## tsc tsc'))
  expect(sekcjaTsc).toContain(`\n… [przycięte ${FAIL.tsc!.stdout.length + 10_000 - 3900} znaków] …\n`)
  expect(sekcjaTsc.length < 4100, `wyjście kroku przycięte do ~4000 znaków: ${sekcjaTsc.length}`).toBe(true)
  expect(sekcjaTsc.endsWith('x'.repeat(1500)), 'koniec wyjścia zachowany').toBe(true)
  expect(log.stany.some(z => z.key === 'warsztat' && JSON.stringify(z.value).includes('error TS2322')), 'wyjście kroku nie trafia do $.state').toBe(false)
  expect(skopiowane.includes('Validation passed'), 'wyjście udanych kroków nie trafia do schowka').toBe(false)
  expect(skopiowane.includes('## CLI validate'), 'udane kroki pominięte').toBe(false)
  expect(log.toasty).toEqual([`Warsztat: skopiowano wyjście 3 kroków (${skopiowane.length} znaków).`])
  await pane.unmount()
  expect(ocen('test', { ...OK.test!, exitCode: 1 }).szczegoly, 'kod ≠ 0 bez linii fail = fail').toBe('12 pass (kod 1)')
  expect(ocen('test', { ...OK.tsc!, exitCode: 0 })).toEqual({ stan: 'ok', testy: null, szczegoly: 'bez podsumowania testów' })
  expect(ocen('validate', { ...OK.tsc!, exitCode: 0 }).szczegoly).toBe('kod 0')
})

test('schowek odmawia → toast z powodem; bieg z samymi FAIL liczy się w stopce', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, proces: () => 'fail', schowekOdmawia: true })
  await start()
  await $.command.run(komenda())
  await zegar.settle()
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect((await pane.find({ type: 'Text', text: /OK · / }))?.text).toBe('0 OK · 5 FAIL · 0 timeout · 0 brak · 0,0 s łącznie')
  await pane.press({ key: 'kopiuj' })
  expect(log.copy.length).toBe(1)
  expect(log.toasty).toEqual(['Warsztat: schowek niedostępny (no-clipboard) — użyj /warsztat wynik.'])
  await pane.unmount()
})

test('timeout kroku → TIMEOUT „przekroczone 120 s” i bieg idzie dalej; brak binarki desktopu i node → wiersze „brak” bez uruchamiania; „Kopiuj błędy” bierze timeout, pomija brak', async ($, on) => {
  const pliki = dysk()
  for (const p of Object.keys(pliki)) if (p.startsWith(DESK_BAZA) || p === NODE) delete pliki[p]
  const { log, zegar, start } = silnik($, on, { pliki, katalogi: KATALOGI.filter(k => !k.startsWith(DESK_BAZA)), proces: argv => (argv[2] === 'test' ? 'timeout' : 'ok') })
  await start()
  const t = await $.command.run(komenda())
  expect(t.text).toBe(`Warsztat: 2 kroków (+3 brak binarki) dla ${PROBA} — wyniki w panelu.`)
  await zegar.settle()
  expect(log.procesy.map(p => p.argv)).toEqual(ARGV_OK.slice(0, 2))
  const w = (await $.command.run(komenda('wynik'))).text ?? ''
  expect(w).toContain('OK      CLI            validate')
  expect(w).toContain('TIMEOUT CLI            test     0,0 s   przekroczone 120 s')
  expect(w).toContain(`brak    desktop        validate         brak binarki desktopu w ${DESK_BAZA}/<wersja>/<hash>/claude.app`)
  expect(w).toContain('brak    desktop        test')
  expect(w).toContain('brak    tsc            tsc              tsc: brak — nie ma node w ~/.local/bin/node, /opt/homebrew/bin/node, /usr/local/bin/node')
  expect(w.split('\n').at(-1)).toBe('1 OK · 0 FAIL · 1 timeout · 3 brak · 0,0 s łącznie')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  await pane.press({ key: 'kopiuj' })
  const skopiowane = log.copy[0]?.text ?? ''
  expect(skopiowane.startsWith(`## CLI test — TIMEOUT (przekroczone 120 s)\n$ ${CLI} plugin test .\n`)).toBe(true)
  expect(skopiowane).toContain('timed out after 120000 ms')
  expect(skopiowane.includes('## desktop'), 'brak to nie błąd').toBe(false)
  expect(log.toasty).toEqual([`Warsztat: skopiowano wyjście 1 kroków (${skopiowane.length} znaków).`])
  await pane.unmount()
})

test('binarka jest na dysku, ale proces nie startuje (ENOENT) → „brak binarki: …”; tsc.js nie ma → „tsc: brak”; desktop 2.1.300 bez binarki → bierze 2.1.299', async ($, on) => {
  const pliki = dysk()
  delete pliki[TSC]
  const { log, zegar, start } = silnik($, on, { pliki, katalogi: KATALOGI, proces: argv => (argv[0] === CLI ? 'brak' : 'ok') })
  await start()
  await $.command.run(komenda())
  await zegar.settle()
  expect(log.procesy.map(p => p.argv)).toEqual(ARGV_OK.slice(0, 4))
  const w = (await $.command.run(komenda('wynik'))).text ?? ''
  expect(w).toContain(`brak    CLI            validate 0,0 s   brak binarki: `)
  expect(w).toContain('ENOENT')
  expect(w).toContain('OK      desktop 2.1.299 validate')
  expect(w).toContain(`brak    tsc            tsc              tsc: brak — nie ma ~/${TSC_JS}`)
  expect(w.split('\n').at(-1)).toBe('2 OK · 0 FAIL · 0 timeout · 3 brak · 0,0 s łącznie')
  expect(porownajWersje('2.1.299', '2.1.30'), '2.1.299 > 2.1.30 liczbowo').toBeLessThan(0)
  expect(['2.1.30', '2.1.295', '2.1.299', '2.1.300'].sort(porownajWersje)).toEqual(['2.1.300', '2.1.299', '2.1.295', '2.1.30'])
})

test('strażnik argv: każde argv z biegu pasuje do zamkniętej listy; argvDozwolone odrzuca shell, inne podkomendy, inne ścieżki, brak --noEmit, env node i ścieżki desktopu z `..`', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  await $.command.run(komenda())
  await zegar.settle()
  expect(log.procesy.length).toBe(5)
  for (const p of log.procesy) expect(argvDozwolone(p.argv, HOME), p.argv.join(' ')).toBe(true)
  for (const a of ARGV_OK) expect(argvDozwolone(a, HOME)).toBe(true)
  expect(argvDozwolone([`${DESK_BAZA}/2.1.295/9d6405864fdc/claude.app/Contents/MacOS/claude`, 'plugin', 'test', '.'], HOME)).toBe(true)
  const odrzucone: string[][] = [
    ['bash', '-c', 'claude plugin test .'],
    ['claude', 'plugin', 'validate', '.'],
    ['/usr/local/bin/claude', 'plugin', 'validate', '.'],
    [CLI, 'plugin', 'install', '.'],
    [CLI, 'plugin', 'validate', '/etc'],
    [CLI, 'plugin', 'validate', '.', '--json'],
    [CLI, 'plugin', 'validate'],
    [CLI, '--version'],
    [CLI, 'agents', '--json'],
    [`${DESK_BAZA}/2.1.299/../../x/claude.app/Contents/MacOS/claude`, 'plugin', 'test', '.'],
    [`${DESK_BAZA}/2.1.299/4fa9694b7975/claude.app/Contents/MacOS/claude2`, 'plugin', 'test', '.'],
    ['/usr/bin/env', 'node', TSC, '--noEmit', '-p', '.'],
    [NODE, TSC, '-p', '.'],
    [NODE, TSC, '--noEmit', '-p', '/etc'],
    [NODE, '/tmp/x/tsc.js', '--noEmit', '-p', '.'],
    [NODE, '-e', 'process.exit(1)'],
    ['/opt/homebrew/bin/node', TSC, '--noEmit', '-p', '.', '--watch'],
    [],
  ]
  for (const a of odrzucone) expect(argvDozwolone(a, HOME), a.join(' ') || '(puste)').toBe(false)
  expect(argvDozwolone(['/opt/homebrew/bin/node', TSC, '--noEmit', '-p', '.'], HOME), 'node z homebrew jest na liście').toBe(true)
  expect(argvDozwolone(ARGV_OK[0]!, ''), 'bez HOME nic nie przechodzi').toBe(false)
})

test('brama katalogu: poza ~/Developer/claude-mods*, poza katalogiem sesji, z `..`, bez plugin.json → odmowa tekstem, zero procesów i zero panelu; `~`, ścieżka względna od cwd, końcowy `/`, repo stabilne i katalog sesji przechodzą', async ($, on) => {
  const pliki = dysk()
  pliki[`${HOME}/Developer/claude-mods-stabilne/kanon-proba/.claude-plugin/plugin.json`] = { tekst: '{}', mtimeMs: T0 }
  pliki[`${HOME}/Developer/claude-mods-inne/kanon-proba/.claude-plugin/plugin.json`] = { tekst: '{}', mtimeMs: T0 }
  pliki['/tmp/repo/modx/.claude-plugin/plugin.json'] = { tekst: '{}', mtimeMs: T0 }
  // dowiązania: `exists` pliku pod ścieżką dowiązania przechodzi (tak zachowuje się dysk), decyduje realPath katalogu
  pliki[`${MODY}/link-poza/.claude-plugin/plugin.json`] = { tekst: '{}', mtimeMs: T0 }
  pliki[`${MODY}/link-ok/.claude-plugin/plugin.json`] = { tekst: '{}', mtimeMs: T0 }
  const dowiazania = { [`${MODY}/link-poza`]: '/tmp/poza/mod', [`${MODY}/link-ok`]: PROBA }
  const { log, zegar, start } = silnik($, on, { pliki, katalogi: KATALOGI, cwd: `${HOME}/Developer`, root: '/tmp/repo', dowiazania })
  await start()
  const odmowy = [
    ['/etc', `Warsztat: /etc leży poza dozwolonymi katalogami (${MODY}, ${HOME}/Developer/claude-mods-stabilne, /tmp/repo).`],
    ['~/Developer/claude-mods-inne/kanon-proba', `Warsztat: ${HOME}/Developer/claude-mods-inne/kanon-proba leży poza dozwolonymi katalogami (${MODY}, ${HOME}/Developer/claude-mods-stabilne, /tmp/repo).`],
    ['~/Developer/claude-mods/kanon-proba/../../..', 'Warsztat: ścieżka z „..” odrzucona: ~/Developer/claude-mods/kanon-proba/../../..'],
    ['~/Developer/claude-mods/pusty', `Warsztat: ${MODY}/pusty nie jest katalogiem modu (brak .claude-plugin/plugin.json).`],
    ['~/Developer/claude-mods/nie-ma', `Warsztat: ${MODY}/nie-ma nie jest katalogiem modu (brak .claude-plugin/plugin.json).`],
    ['', `Warsztat: ${HOME}/Developer leży poza dozwolonymi katalogami (${MODY}, ${HOME}/Developer/claude-mods-stabilne, /tmp/repo) — podaj ścieżkę: /warsztat <katalog modu>.`],
    ['kanon-inny', `Warsztat: ${HOME}/Developer/kanon-inny leży poza dozwolonymi katalogami (${MODY}, ${HOME}/Developer/claude-mods-stabilne, /tmp/repo).`],
    ['~/Developer/claude-mods/link-poza', `Warsztat: ${MODY}/link-poza prowadzi (dowiązanie) do /tmp/poza/mod, poza dozwolonymi katalogami (${MODY}, ${HOME}/Developer/claude-mods-stabilne, /tmp/repo).`],
  ] as const
  for (const [arg, tekstOdmowy] of odmowy) expect((await $.command.run(komenda(arg))).text, arg).toBe(tekstOdmowy)
  // polecenie spoza prompta/Remote Control (plugin, harmonogram, SDK, notyfikacja zadania) nie uruchamia kodu z katalogu
  for (const kind of ['sdk', 'scheduled-trigger', 'task-notification', 'peer'] as const) {
    const obce = await $.command.run({ ...komenda('~/Developer/claude-mods/kanon-proba'), origin: { kind } as unknown as ReturnType<typeof komenda>['origin'] })
    expect(obce.text, kind).toBe(`Warsztat: /warsztat uruchamia kod z katalogu modu, więc przyjmuję je tylko od właściciela (prompt albo Remote Control), nie z „${kind}”.`)
  }
  await zegar.settle()
  expect(log.procesy).toEqual([])
  expect(log.open).toEqual([])

  expect((await $.command.run(komenda('claude-mods/kanon-proba/'))).text, 'względna od cwd + końcowy /').toBe(`Warsztat: 5 kroków dla ${PROBA} — wyniki w panelu.`)
  await zegar.settle()
  expect((await $.command.run(komenda('"~/Developer/claude-mods-stabilne/kanon-proba"'))).text).toBe(`Warsztat: 5 kroków dla ${HOME}/Developer/claude-mods-stabilne/kanon-proba — wyniki w panelu.`)
  await zegar.settle()
  expect((await $.command.run(komenda('/tmp/repo//modx/./'))).text, 'katalog sesji ($.session.root)').toBe('Warsztat: 5 kroków dla /tmp/repo/modx — wyniki w panelu.')
  await zegar.settle()
  expect((await $.command.run(komenda('~/Developer/claude-mods/link-ok'))).text, 'dowiązanie do katalogu w bazie: bieg na realPath').toBe(`Warsztat: 5 kroków dla ${PROBA} — wyniki w panelu.`)
  await zegar.settle()
  expect((await $.command.run({ ...komenda('~/Developer/claude-mods/kanon-proba'), origin: { kind: 'bridge' } as unknown as ReturnType<typeof komenda>['origin'] })).text, 'Remote Control = właściciel').toBe(`Warsztat: 5 kroków dla ${PROBA} — wyniki w panelu.`)
  await zegar.settle()
  expect(log.procesy.length).toBe(25)
  expect(new Set(log.procesy.map(p => p.cwd))).toEqual(new Set([PROBA, `${HOME}/Developer/claude-mods-stabilne/kanon-proba`, '/tmp/repo/modx']))

  expect(rozwin('~', HOME, '/x')).toBe(HOME)
  expect(rozwin('a/b', HOME, '/x/')).toBe('/x/a/b')
  expect(rozwin('/a/./b//c/', HOME, '/x')).toBe('/a/b/c')
  expect(rozwin('/a/..b', HOME, '/x'), '„..b” to nazwa, nie skok wyżej').toBe('/a/..b')
  expect(rozwin('/', HOME, '/x')).toBe('/')
  expect(wBazie(`${MODY}x`, BAZY(HOME, '/r')), 'prefiks bez separatora nie jest w bazie').toBe(false)
  expect(wBazie(MODY, BAZY(HOME, '/r'))).toBe(true)
  expect(BAZY(HOME, '')).toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`])
  expect(BAZY(HOME, HOME), 'sesja zaczęta w ~ nie czyni bazą całego domu').toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`])
  expect(BAZY(HOME, '/tmp'), 'przodek HOME też nie').toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`])
  expect(BAZY(HOME, '/')).toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`])
  expect(BAZY(HOME, '/tmp/repo/')).toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`, '/tmp/repo'])
  expect(BAZY(HOME, `${HOME}/Developer`)).toEqual([MODY, `${HOME}/Developer/claude-mods-stabilne`, `${HOME}/Developer`])
})

test('„Powtórz” bez wcześniejszego biegu → toast z podpowiedzią i zero procesów; panel przed pierwszym biegiem mówi, że nic nie uruchomiono', async ($, on) => {
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI })
  await start()
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect((await pane.find({ type: 'Text', text: /Jeszcze nic/ }))?.text).toBe('Jeszcze nic nie uruchomiono: /warsztat [katalog modu].')
  await pane.press({ key: 'powtorz' })
  await zegar.settle()
  expect(log.toasty).toEqual(['Warsztat: nie ma czego powtórzyć — /warsztat [katalog modu].'])
  expect(log.procesy).toEqual([])
  await pane.unmount()
})

test('indeks zastany w $.state (po hot-reloadzie): ta sama wersja, ścieżka, mtime i liczba linii → wpisy z $.state bez parsowania; inna wersja parsera → zbudowany od nowa i nadpisany', async ($, on) => {
  const zmyslony: Wpis = { nazwa: 'ZastanyZeStanu', rodzaj: 'typ', blok: 'type · claude-code', od: L('export type ToolDeferral'), do: L('export type ToolDeferral'), docOd: null }
  const zastany: Indeks = { wersja: WERSJA_INDEKSU, sciezka: `${PROBA}/${TYPY}`, mtimeMs: T0 - 1000, linii: LINIE.length, wpisy: [zmyslony] }
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, zastane: { indeks: zastany } })
  await start()
  const r = tekst(await szukajPrzezSilnik($, { nazwa: 'ZastanyZeStanu' }))
  expect(r.text.startsWith('ZastanyZeStanu — typ'), 'wpis istnieje tylko w zastanym indeksie — mod go użył zamiast parsować').toBe(true)
  expect(log.odczyty, 'tekst pliku czytany mimo to (linie do sygnatur żyją tylko w pamięci modułu)').toEqual([`${PROBA}/${TYPY}`])
  expect(log.stany.filter(z => z.key === 'indeks'), 'nic do zapisania').toEqual([])
})

test('indeks zastany ze starszą wersją parsera jest odrzucony: wpisy budowane od nowa i zapisane z bieżącą wersją', async ($, on) => {
  const zmyslony: Wpis = { nazwa: 'ZastanyZeStanu', rodzaj: 'typ', blok: 'type · claude-code', od: 1, do: 1, docOd: null }
  const zastany: Indeks = { wersja: WERSJA_INDEKSU - 1, sciezka: `${PROBA}/${TYPY}`, mtimeMs: T0 - 1000, linii: LINIE.length, wpisy: [zmyslony] }
  const { log, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, zastane: { indeks: zastany } })
  await start()
  const r = tekst(await szukajPrzezSilnik($, { nazwa: 'ZastanyZeStanu' }))
  expect(r.text.startsWith('szukaj: brak „ZastanyZeStanu” wśród 34 wpisów')).toBe(true)
  const zapis = log.stany.find(z => z.key === 'indeks')?.value as Indeks | undefined
  expect(zapis?.wersja).toBe(WERSJA_INDEKSU)
  expect(zapis?.wpisy.length).toBe(34)
})

test('stan „w toku” zastany bez żywego biegu (hot-reload w trakcie): kroki nieskończone → FAIL „przerwano”, stopka bez „w toku”, nowy /warsztat startuje normalnie', async ($, on) => {
  const krok = (id: string, stan: Warsztat['kroki'][number]['stan'], szczegoly = ''): Warsztat['kroki'][number] => ({ id, binarka: 'cli', etykieta: 'CLI', krok: 'validate', argv: [CLI, 'plugin', 'validate', '.'], stan, ms: stan === 'ok' ? 1200 : null, testy: null, szczegoly })
  const zastany: Warsztat = { katalog: PROBA, kroki: [krok('cli-validate', 'ok', 'Validation passed'), krok('cli-test', 'biegnie'), krok('tsc', 'czeka')], start: T0 - 60_000, koniec: null, blad: null, wToku: true }
  const { log, zegar, start } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, zastane: { warsztat: zastany } })
  await start()
  await zegar.settle()
  const w = (await $.command.run(komenda('wynik'))).text ?? ''
  expect(w).toContain('OK      CLI            validate 1,2 s   Validation passed')
  expect(w).toContain('FAIL    CLI            validate         przerwano — moduł przeładowany w trakcie biegu')
  expect(w.split('\n').filter(l => l.startsWith('FAIL')).length, 'biegnie i czeka → FAIL').toBe(2)
  expect(w.split('\n').at(-1)).toBe('1 OK · 2 FAIL · 0 timeout · 0 brak · błąd modu: przerwano — moduł przeładowany w trakcie biegu')
  expect(log.procesy, 'naprawa niczego nie uruchamia').toEqual([])
  expect((await $.command.run(komenda())).text, 'po naprawie nowy bieg przechodzi (strażnik nie widzi starego)').toBe(`Warsztat: 5 kroków dla ${PROBA} — wyniki w panelu.`)
  await zegar.settle()
  expect(log.procesy.length).toBe(5)
})

test('jeden bieg naraz: drugi /warsztat w trakcie dostaje odmowę, panel pokazuje „biegnie” i „w toku…”; „Powtórz” po końcu uruchamia ten sam katalog od nowa; panel bez miejsca → tekst z /warsztat wynik', async ($, on) => {
  const { log, zegar, start, zwolnij } = silnik($, on, { pliki: dysk(), katalogi: KATALOGI, wstrzymajPierwszy: true, isPlaced: false })
  await start()
  const [t, t2] = await Promise.all([$.command.run(komenda()), $.command.run(komenda())])
  expect(t.text, 'pierwsze startuje').toBe(`Warsztat: 5 kroków dla ${PROBA}; panel czeka (terminal ma 100 kolumn, próg 144) — wynik: /warsztat wynik.`)
  expect(t2.text, 'równoległe drugie: strażnik ustawiony przed pierwszym await').toBe('Warsztat: poprzedni bieg jeszcze trwa — wynik w panelu albo /warsztat wynik.')
  expect((await $.command.run(komenda())).text).toBe('Warsztat: poprzedni bieg jeszcze trwa — wynik w panelu albo /warsztat wynik.')
  // Bieg w tle zapisuje „biegnie” tuż po powrocie /warsztat; zapis `$.state` przerysowuje zamontowany panel „at the redraw rate” (d.ts
  // ui.render @remarks), a zegar kitu stoi — więc najpierw przepuść zapis, potem montuj, żeby panel rysował się ze świeżego stanu.
  await zegar.settle()
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: paneProps })
  expect((await pane.find({ type: 'Text', text: /^Warsztat — / }))?.text).toBe('Warsztat — kanon-proba (w toku…)')
  expect((await pane.findAll({ type: 'Text', text: /^biegnie/ })).length).toBe(1)
  expect((await pane.findAll({ type: 'Text', text: /^·\s*$/ })).length, 'cztery czekają').toBe(4)
  expect((await pane.find({ type: 'Text', text: /OK · / }))?.text).toBe('0 OK · 0 FAIL · 0 timeout · 0 brak · w toku…')
  await pane.press({ key: 'powtorz' })
  expect(log.toasty.at(-1)).toBe('Warsztat: poprzedni bieg jeszcze trwa — wynik w panelu albo /warsztat wynik.')
  await pane.press({ key: 'kopiuj' })
  expect(log.toasty.at(-1)).toBe('Warsztat: bieg jeszcze trwa — nic nie padło (na razie).')
  zwolnij()
  await zegar.settle()
  expect(log.procesy.length).toBe(5)
  expect((await pane.findAll({ type: 'Text', text: /^OK\s*$/ })).length).toBe(5)
  expect((await pane.find({ type: 'Text', text: /^Warsztat — / }))?.text).toBe('Warsztat — kanon-proba')
  await pane.press({ key: 'powtorz' })
  await zegar.settle()
  expect(log.procesy.length, 'Powtórz = pełny bieg od nowa').toBe(10)
  expect(log.procesy[5]?.cwd).toBe(PROBA)
  expect(log.toasty.at(-1)).toBe(`Warsztat: 5 kroków dla ${PROBA}; panel czeka (terminal ma 100 kolumn, próg 144) — wynik: /warsztat wynik.`)
  expect(log.open).toEqual(['warsztat', 'warsztat'])
  await pane.unmount()
  const w = (await $.command.run(komenda('wynik'))).text ?? ''
  expect(w.split('\n').length).toBe(7)
  expect(log.open.length, 'wyścig nie otworzył drugiego panelu').toBe(2)
})
