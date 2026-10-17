// kanon-warsztat — warsztat modów (mod Claude Code, API function hooks 2.1.299; early access). v0.1.
// Plan: ~/Developer/claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md §6.2. Dowód z logów jednej sesji: 54× `claude plugin
// test/validate`, 53× tsc, 26 grepów po d.ts — każdy grep to polecenie i kilkaset linii wyniku w kontekście modelu.
// (a) Narzędzie modelu `mcp__kanon-warsztat__szukaj { nazwa }`: JSDoc i sygnatura zdarzenia (`tool.call`), metody (`$.fs.list`, też bez
//     `$.`), rzeczownika (`$.fs` → lista składników) albo typu (`SessionUsage`) z lokalnego pliku typów. Indeks budowany leniwie przy
//     pierwszym wywołaniu: `$.fs.read` całego pliku (~640 KB; `$.fs.read` nie czyta fragmentu), parsowanie po wcięciach bez parsera TS;
//     wpisy (nazwa, rodzaj, blok, linie) w `$.state` `indeks`, tekst w pamięci modułu (po reloadzie czytany ponownie, indeks z `$.state`
//     zostaje, gdy ścieżka, mtime i liczba linii się zgadzają). Plik: `<$.plugin.root>/.claude-plugin/types/claude-code/index.d.ts`
//     (silnik kładzie go przy załadowaniu modu); gdy go tam nie ma — najnowszy (mtime) spośród `~/.claude/dev-mods/*/*/…` i
//     `~/Developer/claude-mods/*/…`. Wynik ≤ 2048 znaków: nagłówek (nazwa, rodzaj, blok, linie, plik), JSDoc, sygnatura (bez
//     zagnieżdżonych komentarzy), inne wystąpienia nazwy; podciąg → lista nazw z numerami linii; brak → komunikat z przykładami.
// (b) `/warsztat [ścieżka|wynik|zamknij]`: katalog z argumentu (`~` i ścieżka względna od cwd; `..` odrzucone) albo cwd sesji — musi
//     mieć `.claude-plugin/plugin.json` i leżeć w ~/Developer/claude-mods, ~/Developer/claude-mods-stabilne albo `$.session.root()`.
//     Kroki kolejno, w tle (polecenie wraca od razu, panel rysuje się po każdym kroku z `$.state`), przez `$.process.run` (argv bez
//     shella, cwd = katalog modu, timeout 120 s, env CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 dla claude): CLI `~/.local/bin/claude`
//     validate + test, binarka desktopu (najwyższa wersja semver w ~/Library/Application Support/Claude/claude-code/, podkatalog z
//     claude.app) validate + test, `node tsc.js --noEmit -p .` (TypeScript z ~/Developer/stelmach/wishlist/node_modules; node z
//     ~/.local/bin, /opt/homebrew/bin albo /usr/local/bin). Brak binarki = wiersz „brak”, nie błąd. Lista argv jest ZAMKNIĘTA
//     (`argvDozwolone` sprawdza każde argv tuż przed uruchomieniem; README `calls:`). Panel: binarka × krok → OK / FAIL / TIMEOUT / brak,
//     czas, `Validation passed` / `N pass` / `N pass, M fail`; „Powtórz”, „Kopiuj błędy” (`$.ui.copy` ze stdout+stderr kroków, które
//     padły), „Zamknij”; `/warsztat wynik` daje tę tabelę tekstem (terminal bez miejsca na panel).
// Bramki: zero `$.model`, zero `$.http`, zero `tool.check`, żadnego zapisu plików ani `$.store` (jedyny stan: `$.state`); jeden bieg
// naraz; każdy hook z `.catch` (fail-open: błąd modu nie zatrzymuje startu sesji, polecenia, wywołania narzędzia ani rysowania).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, McpToolResult, ProcessRunResult, Register, RenderSurface } from 'claude-code'

import type { Binarka, Indeks, Krok, RodzajKroku, StanKroku, Warsztat, Wpis } from '../types'

const PANE = 'warsztat'
const OD_WLASCICIELA: ReadonlySet<string> = new Set(['composer', 'bridge'])
// Matcher jako RegExp: unia nazw narzędzi w typach jest zamknięta na te, które silnik znał przy kładzeniu typów (nie obejmuje
// narzędzia rejestrowanego przez sam mod), a RegExp przechodzi bez poszerzania unii.
const NARZEDZIE = /^mcp__kanon-warsztat__szukaj$/
export const TIMEOUT_MS = 120_000 // na jeden krok (`claude plugin test` z bunem to kilka sekund; tsc na d.ts 16 tys. linii kilkanaście)
export const LIMIT_WYNIKU = 2048 // znaków odpowiedzi narzędzia (≈ 2 KB; znaki spoza ASCII liczą się po jednym)
export const WERSJA_INDEKSU = 1 // podbij przy zmianie regexów indeksera: wpisy w $.state z inną wersją są budowane od nowa
const LIMIT_WYJSCIA = 4000 // znaków stdout+stderr kroku, który padł (pamięć modułu: 2400 początku + 1500 końca + znacznik)
const MAX_LISTY = 40 // pozycji listy przy wielu trafieniach
export const TYPY = '.claude-plugin/types/claude-code/index.d.ts'
export const TSC_JS = 'Developer/stelmach/wishlist/node_modules/typescript/lib/tsc.js'
export const NODE_KANDYDACI = ['.local/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node'] // względne od HOME; pierwszy istniejący
const ENV_CLAUDE = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }

// Skaner walidatora wymaga literałów plugin/key w każdym atomie (nie stałej) — stąd powtórzona nazwa.
const PUSTY: Warsztat = { katalog: null, kroki: [], start: null, koniec: null, blad: null, wToku: false }
const warsztat = atom({ plugin: 'kanon-warsztat', key: 'warsztat' } as const, PUSTY)
const indeks = atom({ plugin: 'kanon-warsztat', key: 'indeks' } as const, null as Indeks | null)

const opisBledu = (err: unknown) => (err instanceof Error ? err.message : String(err))
const uciekaj = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- indeks d.ts (czyste funkcje, bez $; testy importują je stąd) ----------
// Kształt pliku (2.1.299): `declare module 'claude-code' {` → deklaracje na 2 spacjach (`export type X = {` … `};`, `export interface X {`
// … `}`, jednoliniowe kończą się `;`); zdarzenia jako klucze `'a.b': Typ;` na 6 spacjach w blokach EngineEventOf (wejście hooka),
// EngineResultOf (wynik), OpEventOf (argument wywołania `$`), OpValueOf (wartość), ChunkOf (strumień); rzeczowniki `$` jako `fs: {`
// na 6 spacjach w CoreEngineInterface, ich metody na 10 spacjach; JSDoc `/** … */` bezpośrednio nad deklaracją.
export const BLOKI_ZDARZEN = new Map<string, string>([
  ['EngineEventOf', 'wejście hooka `e`'],
  ['EngineResultOf', 'wynik hooka'],
  ['OpEventOf', 'argument wywołania `$`'],
  ['OpValueOf', 'wartość wywołania `$`'],
  ['ChunkOf', 'porcja strumienia'],
])
const BLOKI_SILNIKA = new Set(['CoreEngineInterface', 'EngineInterface'])
const MODUL = /^declare module '([^']+)'/
const TOP = /^ {2}(?:export )?(?:declare )?(type|interface|const|function|class|enum|namespace|let|var) ([A-Za-z_$][\w$]*)/
const ZDARZENIE = /^ {6}'([^']+)'\??: /
const RZECZOWNIK = /^ {6}([A-Za-z_$][\w$]*)\??: \{$/
const METODA = /^ {10}([A-Za-z_$][\w$]*)\??: /

const wciecie = (l: string) => l.length - l.trimStart().length

/** Czy linia (bez wcięcia) zaczyna nową deklarację na tym poziomie: słowo kluczowe top-level (wcięcie 2) albo `nazwa:` / `'a.b':` głębiej. */
const nowaDeklaracja = (t: string, w: number) =>
  w <= 2 ? /^(?:export |declare )*(?:type|interface|const|function|class|enum|namespace|let|var|global)\b/.test(t) : /^(?:readonly )?(?:'[^']+'|[A-Za-z_$][\w$]*)\??:/.test(t)
/** Ostatnia linia (0-based) wpisu zaczętego w linii `i` o wcięciu `w`: ta sama, gdy kończy się `;`; inaczej pierwsza linia na tym wcięciu,
 *  która domyka (`};`, `}`, `);`) — `} | {` ciągnie wpis dalej; nowa deklaracja, komentarz albo płytsze wcięcie kończą go na poprzedniej
 *  niepustej; linia na tym samym wcięciu, która nie jest żadnym z tych (płaskie `[`/`infer P extends …`/`N`), to kontynuacja. */
function koniecWpisu(linie: readonly string[], i: number, w: number): number {
  if (/;\s*$/.test(linie[i] ?? '')) return i
  let ostatnia = i
  for (let j = i + 1; j < linie.length; j++) {
    const l = linie[j] ?? ''
    if (!l.trim()) continue
    const wj = wciecie(l)
    if (wj < w) return ostatnia
    if (wj === w) {
      const t = l.trim()
      if (/^[}\])|]/.test(t)) {
        if (/;\s*$/.test(l) || t === '}') return j
      } else if (nowaDeklaracja(t, w) || /^(?:\/\*|\*|\/\/)/.test(t)) return ostatnia
    }
    ostatnia = j
  }
  return ostatnia
}

/** Pierwsza linia (0-based) JSDoc stojącego bezpośrednio nad linią `i`; null, gdy linia nad nią nie kończy komentarza. */
function poczatekDoc(linie: readonly string[], i: number): number | null {
  if (!(linie[i - 1] ?? '').trim().endsWith('*/')) return null
  for (let j = i - 1; j >= 0 && i - j <= 400; j--) {
    const t = (linie[j] ?? '').trim()
    if (t.startsWith('/**')) return j
    if (j < i - 1 && !t.startsWith('*')) return null
  }
  return null
}

/** Indeks pliku typów: zdarzenia, rzeczowniki i metody `$`, deklaracje najwyższego poziomu (z obu modułów). Linie 1-based. */
export function zbudujIndeks(tekst: string): Wpis[] {
  const linie = tekst.split('\n')
  const wpisy: Wpis[] = []
  let modul = 'claude-code'
  let blok: { nazwa: string; do: number } | null = null
  let rzeczownik: { nazwa: string; do: number } | null = null
  const dodaj = (nazwa: string, rodzaj: Wpis['rodzaj'], gdzie: string, i: number, w: number) => {
    const d = koniecWpisu(linie, i, w)
    const doc = poczatekDoc(linie, i)
    wpisy.push({ nazwa, rodzaj, blok: gdzie, od: i + 1, do: d + 1, docOd: doc === null ? null : doc + 1 })
    return d
  }
  for (let i = 0; i < linie.length; i++) {
    const l = linie[i] ?? ''
    if (!l.trim()) continue
    const m0 = MODUL.exec(l)
    if (m0?.[1]) {
      modul = m0[1]
      blok = null
      rzeczownik = null
      continue
    }
    if (blok && i > blok.do) blok = null
    if (rzeczownik && i > rzeczownik.do) rzeczownik = null
    if (blok) {
      if (BLOKI_ZDARZEN.has(blok.nazwa)) {
        const m = ZDARZENIE.exec(l)
        if (m?.[1]) dodaj(m[1], 'zdarzenie', blok.nazwa, i, 6)
      } else if (BLOKI_SILNIKA.has(blok.nazwa)) {
        const mr = RZECZOWNIK.exec(l)
        if (mr?.[1]) {
          rzeczownik = { nazwa: mr[1], do: dodaj(`$.${mr[1]}`, 'rzeczownik', blok.nazwa, i, 6) }
          continue
        }
        const mm = rzeczownik ? METODA.exec(l) : null
        if (mm?.[1] && rzeczownik) dodaj(`$.${rzeczownik.nazwa}.${mm[1]}`, 'metoda', blok.nazwa, i, 10)
      }
      continue
    }
    const mt = TOP.exec(l)
    if (mt?.[1] && mt[2]) {
      const d = dodaj(mt[2], 'typ', `${mt[1]} · ${modul}`, i, 2)
      if (d > i) blok = { nazwa: mt[2], do: d }
    }
  }
  return wpisy
}

/** Kolejność trafień o tej samej nazwie: zdarzenie wejścia hooka, metoda `$`, rzeczownik, wynik hooka, argument i wartość wywołania `$`,
 *  porcja strumienia, typ — `tool.call` to przede wszystkim zdarzenie, a `fs.list` przede wszystkim metoda `$.fs.list` (zdarzenia `OpEventOf`
 *  i `OpValueOf` o tej nazwie opisują tylko jej argument i wartość). */
const RANGA_BLOKU: Record<string, number> = { EngineEventOf: 0, EngineResultOf: 3, OpEventOf: 4, OpValueOf: 5, ChunkOf: 6 }
const ranga = (w: Wpis) => (w.rodzaj === 'zdarzenie' ? (RANGA_BLOKU[w.blok] ?? 6) : w.rodzaj === 'metoda' ? 1 : w.rodzaj === 'rzeczownik' ? 2 : 7)
const porzadek = (a: Wpis, b: Wpis) => ranga(a) - ranga(b) || a.od - b.od

/** Linie bez komentarzy JSDoc/`//` i bez pustych, z zdjętym wspólnym wcięciem. */
function bezKomentarzy(linie: readonly string[]): string[] {
  const out: string[] = []
  let wDoc = false
  for (const l of linie) {
    const t = l.trim()
    if (wDoc) {
      if (t.endsWith('*/')) wDoc = false
      continue
    }
    if (t.startsWith('/**') || t.startsWith('/*')) {
      if (!t.endsWith('*/')) wDoc = true
      continue
    }
    if (!t || t.startsWith('//')) continue
    out.push(l)
  }
  const w = Math.min(...out.map(wciecie))
  return out.map(l => l.slice(Number.isFinite(w) ? w : 0))
}
/** Sygnatura wpisu: linie od–do (1-based, włącznie) bez zagnieżdżonych komentarzy. */
export const sygnatura = (linie: readonly string[], od: number, koniec: number) => bezKomentarzy(linie.slice(od - 1, koniec)).join('\n')
/** Treść JSDoc z linii docOd–(od−1) bez `/**`, `*` i `*\/`; puste linie zbite do jednej. */
export function jsdoc(linie: readonly string[], docOd: number, od: number): string {
  const t = linie
    .slice(docOd - 1, od - 1)
    .map(l => l.trim().replace(/^\/\*\*\s?/, '').replace(/\s?\*\/$/, '').replace(/^\*\s?/, '').trimEnd())
    .join('\n')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

const gdzie = (w: Wpis) => (BLOKI_ZDARZEN.has(w.blok) ? `${w.blok} — ${BLOKI_ZDARZEN.get(w.blok)}` : w.blok)

function opisWpisu(w: Wpis, inne: readonly Wpis[], ind: readonly Wpis[], linie: readonly string[], zrodlo: string): string {
  const czesci = [`${w.nazwa} — ${w.rodzaj} (${gdzie(w)}; linie ${w.od}–${w.do} w ${zrodlo})`]
  if (w.docOd !== null) czesci.push(jsdoc(linie, w.docOd, w.od))
  const skladniki = w.rodzaj === 'rzeczownik' ? ind.filter(x => x.rodzaj === 'metoda' && x.nazwa.startsWith(`${w.nazwa}.`)) : []
  czesci.push(skladniki.length ? `Składniki: ${skladniki.map(m => `${m.nazwa} (linia ${m.od})`).join(', ')}` : sygnatura(linie, w.od, w.do))
  if (inne.length) czesci.push(`Inne wystąpienia:\n${inne.map(x => `- ${x.rodzaj} w ${gdzie(x)}, linia ${x.od}: ${(linie[x.od - 1] ?? '').trim()}`).join('\n')}`)
  return czesci.join('\n\n')
}

/** Przycięcie do `limit` znaków z dopiskiem, gdzie jest reszta. */
export function przytnij(tekst: string, dopisek: string, limit = LIMIT_WYNIKU): string {
  if (tekst.length <= limit) return tekst
  const ogon = `… [przycięte do ${limit} znaków; ${dopisek}]`
  return tekst.slice(0, Math.max(0, limit - ogon.length)) + ogon
}

/** Odpowiedź narzędzia: dokładna nazwa (z `$.` i bez — to samo pytanie), potem bez rozróżniania wielkości liter, potem podciąg → lista. */
export function szukaj(ind: readonly Wpis[], linie: readonly string[], zapytanie: string, zrodlo: string): string {
  const q = zapytanie.trim()
  if (!q) return 'szukaj: podaj nazwę — zdarzenia (tool.call), metody ($.fs.list) albo typu (SessionUsage).'
  const qPokaz = q.length > 80 ? `${q.slice(0, 80)}…` : q // echo zapytania modelu w komunikatach ograniczone, odpowiedź zawsze ≤ limit
  const warianty = q.startsWith('$.') ? [q, q.slice(2)] : [q, `$.${q}`] // `fs.list` i `$.fs.list` to to samo pytanie: metoda + zdarzenia o tej nazwie
  let trafione = ind.filter(w => warianty.includes(w.nazwa))
  if (!trafione.length) {
    const male = warianty.map(v => v.toLowerCase())
    trafione = ind.filter(w => male.includes(w.nazwa.toLowerCase()))
  }
  const [glowny, ...inne] = [...trafione].sort(porzadek)
  if (glowny) return przytnij(opisWpisu(glowny, inne, ind, linie, zrodlo), `pełny tekst: ${zrodlo}:${glowny.od}`)
  const czesciowe = ind.filter(w => w.nazwa.toLowerCase().includes(q.toLowerCase())).sort(porzadek)
  if (!czesciowe.length) {
    return przytnij(`szukaj: brak „${qPokaz}” wśród ${ind.length} wpisów ${zrodlo}. Nazwy: zdarzenie „tool.call”, metoda „$.fs.list” (albo „fs.list”), rzeczownik „$.fs”, typ „SessionUsage”; podciąg daje listę.`, 'skróć zapytanie')
  }
  const lista = czesciowe.slice(0, MAX_LISTY).map(w => `- ${w.nazwa} (${w.rodzaj}, linia ${w.od})`)
  const reszta = czesciowe.length - lista.length
  return przytnij([`szukaj: ${czesciowe.length} trafień dla „${qPokaz}” — podaj pełną nazwę:`, ...lista, ...(reszta > 0 ? [`… +${reszta} więcej`] : [])].join('\n'), `grep '${qPokaz}' ${zrodlo}`)
}

// ---------- ładowanie indeksu ($) ----------
type Zaladowany = { ind: Wpis[]; linie: string[]; sciezka: string }
let zaladowany: Zaladowany | null = null
let ladowanie: Promise<Zaladowany> | null = null

const istnieje = ($: EngineInterface, p: string) => $.fs.exists(p).catch(() => false)
async function wpisyKatalogu($: EngineInterface, p: string): Promise<FsEntry[]> {
  try {
    return await $.fs.list(p)
  } catch {
    return []
  }
}
async function plik($: EngineInterface, p: string): Promise<{ sciezka: string; mtimeMs: number } | null> {
  try {
    const s = await $.fs.stat(p)
    return s.kind === 'file' ? { sciezka: p, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}

/** Plik typów: własny katalog modu; gdy go tam nie ma — najnowszy (mtime) z kopii modów w ~/.claude/dev-mods/<sid>/<mod> i ~/Developer/claude-mods/<mod>. */
async function plikTypow($: EngineInterface): Promise<{ sciezka: string; mtimeMs: number } | null> {
  let root: string | null = null
  try {
    root = $.plugin.root
  } catch {
    root = null
  }
  const wlasny = root ? await plik($, `${root}/${TYPY}`) : null
  if (wlasny) return wlasny
  const home = (await $.env.get('HOME')) ?? ''
  const kandydaci: string[] = []
  const devMods = `${home}/.claude/dev-mods`
  for (const sid of await wpisyKatalogu($, devMods)) {
    if (sid.kind !== 'dir') continue
    for (const mod of await wpisyKatalogu($, `${devMods}/${sid.name}`)) if (mod.kind === 'dir') kandydaci.push(`${devMods}/${sid.name}/${mod.name}/${TYPY}`)
  }
  const mods = `${home}/Developer/claude-mods`
  for (const mod of await wpisyKatalogu($, mods)) if (mod.kind === 'dir') kandydaci.push(`${mods}/${mod.name}/${TYPY}`)
  let najnowszy: { sciezka: string; mtimeMs: number } | null = null
  for (const k of kandydaci) {
    const p = await plik($, k)
    if (p && (!najnowszy || p.mtimeMs > najnowszy.mtimeMs)) najnowszy = p
  }
  return najnowszy
}

/** Indeks i tekst d.ts: raz na życie modułu (równoległe wywołania dołączają do trwającego); wpisy z `$.state`, gdy plik się nie zmienił. */
function zaladujIndeks($: EngineInterface): Promise<Zaladowany> {
  if (zaladowany) return Promise.resolve(zaladowany)
  return (ladowanie ??= (async () => {
    const p = await plikTypow($)
    if (!p) throw new Error(`brak pliku typów ${TYPY}: ani w katalogu modu, ani w ~/.claude/dev-mods/*/*/, ani w ~/Developer/claude-mods/*/`)
    const tekst = String(await $.fs.read(p.sciezka))
    const linie = tekst.split('\n')
    const zapisany = await read($, indeks).catch((): Indeks | null => null)
    let wpisy: Wpis[]
    if (zapisany && zapisany.wersja === WERSJA_INDEKSU && zapisany.sciezka === p.sciezka && zapisany.mtimeMs === p.mtimeMs && zapisany.linii === linie.length) wpisy = zapisany.wpisy
    else {
      wpisy = zbudujIndeks(tekst)
      await update($, indeks, () => ({ wersja: WERSJA_INDEKSU, sciezka: p.sciezka, mtimeMs: p.mtimeMs, linii: linie.length, wpisy })).catch(() => undefined)
    }
    zaladowany = { ind: wpisy, linie, sciezka: p.sciezka }
    return zaladowany
  })().finally(() => (ladowanie = null)))
}

const wynik = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })

// ---------- /warsztat: brama katalogu i zamknięta lista argv (czyste funkcje) ----------
const bezKoncowego = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
/** Dozwolone bazy katalogu modu: repo modów, repo stabilne i katalog główny sesji — ten ostatni tylko, gdy jest projektem, nie całym domem:
 *  root równy HOME, jego przodkowi albo `/` odpada (sesja zaczęta w `~` nie czyni modem każdego katalogu z plugin.json). */
export const BAZY = (home: string, root: string) => {
  const r = bezKoncowego(root)
  const domowy = !r || r === '/' || r === home || home.startsWith(`${r}/`)
  return [`${home}/Developer/claude-mods`, `${home}/Developer/claude-mods-stabilne`, ...(domowy ? [] : [r])]
}
/** Ścieżka bezwzględna z argumentu: `~` → HOME, względna → od cwd, `/./` i podwójne `/` zbite; segment `..` → null (odrzucona). */
export function rozwin(arg: string, home: string, cwd: string): string | null {
  let p = arg.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1)
  if (!p.startsWith('/')) p = `${cwd}/${p}`
  if (p.split('/').includes('..')) return null
  return bezKoncowego(p.replace(/\/\.(?=\/|$)/g, '').replace(/\/{2,}/g, '/'))
}
export const wBazie = (p: string, bazy: readonly string[]) =>
  bazy.some(b => {
    const x = bezKoncowego(b)
    return p === x || p.startsWith(`${x}/`)
  })

const DESKTOP_BAZA = (home: string) => `${home}/Library/Application Support/Claude/claude-code`
const sciezkaNode = (home: string, n: string) => (n.startsWith('/') ? n : `${home}/${n}`)
/** Zamknięta lista argv modu (README `calls:`): `<claude> plugin validate|test .` dla CLI ~/.local/bin/claude albo binarki desktopu
 *  pod ~/Library/Application Support/Claude/claude-code/<semver>/<hash>/claude.app/Contents/MacOS/claude oraz `<node> <tsc.js> --noEmit -p .`. */
export function argvDozwolone(argv: readonly string[], home: string): boolean {
  const [bin, ...reszta] = argv
  if (!bin || !home) return false
  const desktop = new RegExp(`^${uciekaj(DESKTOP_BAZA(home))}/\\d+\\.\\d+\\.\\d+/[0-9a-f]+/claude\\.app/Contents/MacOS/claude$`)
  if (bin === `${home}/.local/bin/claude` || desktop.test(bin)) {
    return reszta.length === 3 && reszta[0] === 'plugin' && (reszta[1] === 'validate' || reszta[1] === 'test') && reszta[2] === '.'
  }
  if (NODE_KANDYDACI.some(n => sciezkaNode(home, n) === bin)) {
    return reszta.length === 4 && reszta[0] === `${home}/${TSC_JS}` && reszta[1] === '--noEmit' && reszta[2] === '-p' && reszta[3] === '.'
  }
  return false
}

/** Ocena wyniku kroku z kodu wyjścia i wyjścia: test → ` N pass` / ` N fail`; validate → `Validation passed|failed`; tsc → liczba `error TS`. */
export function ocen(krok: RodzajKroku, r: ProcessRunResult): { stan: StanKroku; testy: Krok['testy']; szczegoly: string } {
  const out = `${r.stdout}\n${r.stderr}`
  if (krok === 'test') {
    const pass = /^\s*(\d+) pass\b/m.exec(out)?.[1]
    const fail = /^\s*(\d+) fail\b/m.exec(out)?.[1]
    const testy = pass !== undefined || fail !== undefined ? { pass: Number(pass ?? 0), fail: Number(fail ?? 0) } : null
    const ok = r.exitCode === 0 && (testy?.fail ?? 0) === 0
    const opis = testy ? `${testy.pass} pass${testy.fail ? `, ${testy.fail} fail` : ''}` : 'bez podsumowania testów'
    return { stan: ok ? 'ok' : 'fail', testy, szczegoly: ok ? opis : `${opis} (kod ${r.exitCode})` }
  }
  if (krok === 'validate') {
    if (r.exitCode === 0) return { stan: 'ok', testy: null, szczegoly: /Validation passed/.test(out) ? 'Validation passed' : 'kod 0' }
    return { stan: 'fail', testy: null, szczegoly: `${/Validation failed/.test(out) ? 'Validation failed' : 'błąd'} (kod ${r.exitCode})` }
  }
  if (r.exitCode === 0) return { stan: 'ok', testy: null, szczegoly: 'bez błędów' }
  const bledow = (out.match(/error TS\d+/g) ?? []).length
  return { stan: 'fail', testy: null, szczegoly: `${bledow} błędów TS (kod ${r.exitCode})` }
}

const przytnijWyjscie = (s: string) => (s.length <= LIMIT_WYJSCIA ? s : `${s.slice(0, 2400)}\n… [przycięte ${s.length - 3900} znaków] …\n${s.slice(-1500)}`)

// ---------- binarki i plan kroków ----------
type Binarki = { cli: string | null; desktop: { sciezka: string; wersja: string } | null; node: string | null; tsc: string | null }
const semver = (s: string) => s.split('.').map(Number)
/** Malejąco po składnikach semver (2.1.299 przed 2.1.30 — porównanie liczbowe, nie tekstowe). */
export const porownajWersje = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d) return d
  }
  return 0
}

async function znajdzBinarki($: EngineInterface, home: string): Promise<Binarki> {
  const cli = `${home}/.local/bin/claude`
  const baza = DESKTOP_BAZA(home)
  let desktop: Binarki['desktop'] = null
  const wersje = (await wpisyKatalogu($, baza))
    .filter(e => e.kind === 'dir' && /^\d+\.\d+\.\d+$/.test(e.name))
    .map(e => e.name)
    .sort(porownajWersje)
  for (const w of wersje) {
    for (const h of await wpisyKatalogu($, `${baza}/${w}`)) {
      if (h.kind !== 'dir' || !/^[0-9a-f]+$/.test(h.name)) continue
      const p = `${baza}/${w}/${h.name}/claude.app/Contents/MacOS/claude`
      if (await istnieje($, p)) {
        desktop = { sciezka: p, wersja: w }
        break
      }
    }
    if (desktop) break
  }
  let node: string | null = null
  for (const n of NODE_KANDYDACI) {
    const p = sciezkaNode(home, n)
    if (await istnieje($, p)) {
      node = p
      break
    }
  }
  const tsc = `${home}/${TSC_JS}`
  return { cli: (await istnieje($, cli)) ? cli : null, desktop, node, tsc: (await istnieje($, tsc)) ? tsc : null }
}

function zaplanuj(b: Binarki, home: string): Krok[] {
  const krok = (id: string, binarka: Binarka, etykieta: string, rodzaj: RodzajKroku, argv: string[] | null, brak: string): Krok => ({
    id,
    binarka,
    etykieta,
    krok: rodzaj,
    argv: argv ?? [],
    stan: argv ? 'czeka' : 'brak',
    ms: null,
    testy: null,
    szczegoly: argv ? '' : brak,
  })
  const claude = (binarka: Binarka, etykieta: string, bin: string | null, brak: string) =>
    (['validate', 'test'] as const).map(r => krok(`${binarka}-${r}`, binarka, etykieta, r, bin ? [bin, 'plugin', r, '.'] : null, brak))
  return [
    ...claude('cli', 'CLI', b.cli, `brak binarki ${home}/.local/bin/claude`),
    ...claude('desktop', b.desktop ? `desktop ${b.desktop.wersja}` : 'desktop', b.desktop?.sciezka ?? null, `brak binarki desktopu w ${DESKTOP_BAZA(home)}/<wersja>/<hash>/claude.app`),
    krok(
      'tsc',
      'tsc',
      'tsc',
      'tsc',
      b.node && b.tsc ? [b.node, b.tsc, '--noEmit', '-p', '.'] : null,
      b.tsc ? `tsc: brak — nie ma node w ${NODE_KANDYDACI.map(n => sciezkaNode('~', n)).join(', ')}` : `tsc: brak — nie ma ~/${TSC_JS}`,
    ),
  ]
}

// ---------- bieg ----------
let bieg: object | null = null // znacznik żywego biegu, ustawiany SYNCHRONICZNIE przed pierwszym await: drugi `/warsztat` i „Powtórz” w trakcie dostają odmowę
/** stdout/stderr kroków, które padły (id kroku → tekst): pamięć modułu, nie `$.state` — stan sesji czyta każdy plugin, a logi testów bywają gadatliwe. */
const WYJSCIA = new Map<string, string>()
const PRZERWANO = 'przerwano — moduł przeładowany w trakcie biegu'
const ustawKrok = ($: EngineInterface, id: string, zmiana: Partial<Krok>) =>
  update($, warsztat, s => ({ ...s, kroki: s.kroki.map(k => (k.id === id ? { ...k, ...zmiana } : k)) }))
/** Stan „w toku” bez żywego biegu (hot-reload w trakcie: `bieg` startuje od nowa, `$.state` zostaje) → kroki nieskończone jako FAIL „przerwano”. */
async function naprawPrzerwany($: EngineInterface): Promise<void> {
  if (!(await read($, warsztat)).wToku) return
  await update($, warsztat, s =>
    s.wToku ? { ...s, wToku: false, blad: PRZERWANO, kroki: s.kroki.map(k => (k.stan === 'czeka' || k.stan === 'biegnie' ? { ...k, stan: 'fail' as const, szczegoly: PRZERWANO } : k)) } : s,
  )
}
/** Dokąd ścieżka katalogu naprawdę prowadzi (`realPath`, dowiązania rozwiązane); null, gdy to nie katalog albo nie da się rozwiązać. */
async function realna($: EngineInterface, p: string): Promise<string | null> {
  try {
    const s = await $.fs.stat(p, { resolve: true })
    return s.kind === 'dir' && s.realPath ? bezKoncowego(s.realPath) : null
  } catch {
    return null
  }
}

async function biegnij($: EngineInterface, katalog: string, home: string): Promise<void> {
  const s0 = await read($, warsztat)
  for (const k of s0.kroki) {
    if (k.stan !== 'czeka') continue
    if (!argvDozwolone(k.argv, home)) {
      await ustawKrok($, k.id, { stan: 'fail', szczegoly: 'argv poza zamkniętą listą modu — nie uruchomiono' })
      continue
    }
    await ustawKrok($, k.id, { stan: 'biegnie' })
    const t0 = await $.clock.now()
    try {
      const r = await $.process.run(k.argv, { cwd: katalog, timeoutMs: TIMEOUT_MS, ...(k.binarka === 'tsc' ? {} : { env: ENV_CLAUDE }) })
      const o = ocen(k.krok, r)
      if (o.stan !== 'ok') WYJSCIA.set(k.id, przytnijWyjscie(`${r.stdout.trimEnd()}${r.stderr.trim() ? `\n--- stderr ---\n${r.stderr.trimEnd()}` : ''}`))
      await ustawKrok($, k.id, { ...o, ms: (await $.clock.now()) - t0 })
    } catch (err) {
      // `$.process.run` odrzuca, gdy proces nie startuje (ENOENT) albo przekroczy timeout; d.ts nie podaje brzmienia komunikatu, więc timeout
      // poznajemy po zmierzonym czasie (≥ limit − 1 s) albo po słowie w komunikacie; cokolwiek innego = fail z tekstem błędu
      const ms = (await $.clock.now()) - t0
      const msg = opisBledu(err)
      const stan: StanKroku = /ENOENT|not found|no such file/i.test(msg) ? 'brak' : ms >= TIMEOUT_MS - 1000 || /timed?\s*out|timeout|SIGKILL|SIGTERM|killed/i.test(msg) ? 'timeout' : 'fail'
      const szczegoly = stan === 'brak' ? `brak binarki: ${msg}` : stan === 'timeout' ? `przekroczone ${TIMEOUT_MS / 1000} s` : msg
      WYJSCIA.set(k.id, msg)
      await ustawKrok($, k.id, { stan, ms, szczegoly })
    }
  }
  const koniec = await $.clock.now()
  await update($, warsztat, s => ({ ...s, wToku: false, koniec }))
}

/** Brama katalogu: leksykalnie w bazach, z plugin.json, a jego `realPath` (dowiązania rozwiązane) też w bazach rozwiązanych tak samo
 *  (d.ts `FsStat.realPath`: „an allow-list on realPath under a root resolved the same way is the robust guard”). Zwraca katalog rozwiązany. */
async function brama($: EngineInterface, arg: string, home: string, cwd: string, root: string): Promise<{ katalog: string } | { odmowa: string }> {
  const katalog = arg ? rozwin(arg, home, cwd) : bezKoncowego(cwd)
  if (!katalog) return { odmowa: `Warsztat: ścieżka z „..” odrzucona: ${arg}` }
  const bazy = BAZY(home, root)
  const podpowiedz = arg ? '' : ' — podaj ścieżkę: /warsztat <katalog modu>'
  if (!wBazie(katalog, bazy)) return { odmowa: `Warsztat: ${katalog} leży poza dozwolonymi katalogami (${bazy.join(', ')})${podpowiedz}.` }
  if (!(await istnieje($, `${katalog}/.claude-plugin/plugin.json`))) return { odmowa: `Warsztat: ${katalog} nie jest katalogiem modu (brak .claude-plugin/plugin.json)${podpowiedz}.` }
  const real = await realna($, katalog)
  if (!real) return { odmowa: `Warsztat: nie da się rozwiązać ścieżki ${katalog} (realPath) — odmowa.` }
  const bazyReal = await Promise.all(bazy.map(b => realna($, b).then(r => r ?? b)))
  if (!wBazie(real, bazyReal)) return { odmowa: `Warsztat: ${katalog} prowadzi (dowiązanie) do ${real}, poza dozwolonymi katalogami (${bazyReal.join(', ')}).` }
  return { katalog: real }
}

/** `/warsztat [ścieżka]` i „Powtórz”: strażnik jednego biegu, brama katalogu, plan kroków, start biegu w tle, panel. */
async function uruchom($: EngineInterface, arg: string): Promise<string> {
  if (bieg) return 'Warsztat: poprzedni bieg jeszcze trwa — wynik w panelu albo /warsztat wynik.'
  const moj = {}
  bieg = moj // przed pierwszym await: równoległe wywołanie (podwójne „p”, dwa /warsztat) już widzi bieg
  const zwolnij = () => {
    if (bieg === moj) bieg = null
  }
  let wystartowal = false
  try {
    await naprawPrzerwany($)
    const [home, cwd, root] = await Promise.all([$.env.get('HOME'), $.session.cwd(), $.session.root()])
    if (!home) return 'Warsztat: brak HOME w środowisku.'
    const b = await brama($, arg, home, cwd, root)
    if ('odmowa' in b) return b.odmowa
    const { katalog } = b
    const kroki = zaplanuj(await znajdzBinarki($, home), home)
    const start = await $.clock.now()
    WYJSCIA.clear()
    await update($, warsztat, () => ({ katalog, kroki, start, koniec: null, blad: null, wToku: true }))
    // Bez await: polecenie wraca od razu, kroki trwają do kilku minut; panel przerysowuje się po każdym zapisie $.state.
    wystartowal = true
    void biegnij($, katalog, home)
      .catch(err => update($, warsztat, s => ({ ...s, wToku: false, blad: opisBledu(err) })).then(() => undefined, () => undefined))
      .finally(zwolnij)
    const o = await $.ui.open({ id: PANE, title: 'Warsztat', focus: true, closeOnEscape: true, rows: kroki.length + 6 })
    const doZrobienia = kroki.filter(k => k.stan === 'czeka').length
    const brak = kroki.length - doZrobienia
    const liczby = `${doZrobienia} kroków${brak ? ` (+${brak} brak binarki)` : ''} dla ${katalog}`
    return o.isPlaced ? `Warsztat: ${liczby} — wyniki w panelu.` : `Warsztat: ${liczby}; panel czeka (${o.reason}) — wynik: /warsztat wynik.`
  } finally {
    if (!wystartowal) zwolnij()
  }
}

// ---------- tekst i panel ----------
export const SYMBOL: Record<StanKroku, string> = { czeka: '·', biegnie: 'biegnie', ok: 'OK', fail: 'FAIL', timeout: 'TIMEOUT', brak: 'brak' }
const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s.padEnd(n))
const sekundy = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`
const czas = (k: Krok) => (k.ms === null ? '' : sekundy(k.ms))
/** Wiersz tabeli bez kolumny stanu (stan idzie osobno, bo ma kolor). */
export const wiersz = (k: Krok) => `${pad(k.etykieta, 15)}${pad(k.krok, 9)}${pad(czas(k), 8)}${k.szczegoly}`
const licz = (s: Warsztat, stan: StanKroku) => s.kroki.filter(k => k.stan === stan).length
export function stopka(s: Warsztat): string {
  if (!s.kroki.length) return 'Jeszcze nic nie uruchomiono: /warsztat [katalog modu].'
  const czasBiegu = s.start !== null && s.koniec !== null ? ` · ${sekundy(s.koniec - s.start)} łącznie` : s.wToku ? ' · w toku…' : ''
  return `${licz(s, 'ok')} OK · ${licz(s, 'fail')} FAIL · ${licz(s, 'timeout')} timeout · ${licz(s, 'brak')} brak${czasBiegu}${s.blad ? ` · błąd modu: ${s.blad}` : ''}`
}
/** `/warsztat wynik`: tabela tekstem. */
export const tabela = (s: Warsztat) =>
  [`Warsztat: ${s.katalog ?? '—'}`, ...s.kroki.map(k => `${pad(SYMBOL[k.stan], 8)}${wiersz(k)}`), stopka(s)].join('\n')

const padle = (s: Warsztat) => s.kroki.filter(k => k.stan === 'fail' || k.stan === 'timeout')
/** „Kopiuj błędy”: argv i wyjście każdego kroku, który padł (OK i brak pominięte); schowek powierzchni, z której naciśnięto. */
async function kopiujBledy($: EngineInterface, surface: RenderSurface): Promise<void> {
  try {
    const s = await read($, warsztat)
    const zle = padle(s)
    if (!zle.length) {
      $.ui.toast(s.wToku ? 'Warsztat: bieg jeszcze trwa — nic nie padło (na razie).' : 'Warsztat: nic do skopiowania — żaden krok nie padł.')
      return
    }
    const text = zle.map(k => `## ${k.etykieta} ${k.krok} — ${SYMBOL[k.stan]} (${k.szczegoly})\n$ ${k.argv.join(' ')}\n${WYJSCIA.get(k.id) ?? '(wyjście niedostępne — moduł przeładowany po biegu; naciśnij Powtórz)'}`).join('\n\n')
    const c = await $.ui.copy({ text, surface })
    $.ui.toast(c.isCopied ? `Warsztat: skopiowano wyjście ${zle.length} kroków (${text.length} znaków).` : `Warsztat: schowek niedostępny (${c.reason}) — użyj /warsztat wynik.`)
  } catch (err) {
    $.ui.toast(`Warsztat: błąd kopiowania — ${opisBledu(err)}`)
  }
}

const powtorz = async ($: EngineInterface) => {
  try {
    const s = await read($, warsztat)
    $.ui.toast(s.katalog ? await uruchom($, s.katalog) : 'Warsztat: nie ma czego powtórzyć — /warsztat [katalog modu].')
  } catch (err) {
    $.ui.toast(`Warsztat: błąd — ${opisBledu(err)}`)
  }
}

const kolor = (k: Krok) => (k.stan === 'ok' ? 'success' : k.stan === 'fail' || k.stan === 'timeout' ? 'error' : k.stan === 'biegnie' ? 'warning' : undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Każda rejestracja osobno (fail-open): padnięta komenda nie wyłącza narzędzia i odwrotnie.
    const brakujace: string[] = []
    try {
      await $.command.register({
        name: 'warsztat',
        description: 'Warsztat modu: claude plugin validate + test na CLI i binarce desktopu oraz tsc dla katalogu modu (argument albo cwd); tabela w panelu, „wynik” daje ją tekstem, „zamknij” zamyka panel',
        argumentHint: '[katalog modu|wynik|zamknij]',
      })
    } catch {
      brakujace.push('/warsztat')
    }
    try {
      await $.tool.register({
        name: 'szukaj',
        description:
          'JSDoc i sygnatura z lokalnego API modów Claude Code (claude-code/index.d.ts) po nazwie: zdarzenie (tool.call), metoda ($.fs.list albo fs.list), rzeczownik ($.fs — lista składników) albo typ (SessionUsage). Podciąg daje listę nazw z numerami linii. Zamiast grep po 16 tys. linii d.ts; wynik ≤ 2048 znaków.',
        inputSchema: {
          type: 'object',
          properties: { nazwa: { type: 'string', description: 'Nazwa zdarzenia (tool.call), metody ($.fs.list), rzeczownika ($.fs) albo typu (SessionUsage); może być podciągiem (ToolCall → lista typów).' } },
          required: ['nazwa'],
        },
      })
    } catch {
      brakujace.push('szukaj')
    }
    if (brakujace.length) $.ui.toast(`Warsztat: nie udało się zarejestrować: ${brakujace.join(', ')}.`)
    // session.start odpala się też po przeładowaniu modułu: bieg sprzed reloadu nie żyje, więc „w toku” w $.state jest nieprawdziwe.
    if (!bieg) void naprawPrzerwany($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Hook odpowiada za własne narzędzie (bez `next`: pod spodem nie ma nic, co by je obsłużyło); błąd → wynik z isError, nie wyjątek.
  on('tool.call', { tool: NARZEDZIE }, async ($, e) => {
    try {
      const arg = (e as unknown as Record<string, unknown>).nazwa
      const nazwa = typeof arg === 'string' ? arg : arg === undefined || arg === null ? '' : String(arg)
      const z = await zaladujIndeks($)
      return { result: wynik(szukaj(z.ind, z.linie, nazwa, z.sciezka)) }
    } catch (err) {
      return { result: wynik(`szukaj: błąd — ${opisBledu(err)}`, true) }
    }
  }).catch(() => ({ result: wynik('szukaj: błąd modu — hook odrzucony', true) }))

  // Hook odpowiada za własną komendę; try/catch, bo hook, który się wysypie, silnik pomija (komenda bez odpowiedzi).
  on('command.run', { command: 'warsztat' }, async ($, e) => {
    try {
      const a = e.args.trim()
      if (a === 'wynik') {
        if (!bieg) await naprawPrzerwany($)
        return { text: tabela(await read($, warsztat)) }
      }
      if (a === 'zamknij') {
        await $.ui.close({ id: PANE })
        return { text: 'Warsztat zamknięty.' }
      }
      // Bieg wykonuje kod z katalogu modu (testy), więc tylko polecenie właściciela: prompt (composer) albo Remote Control (bridge) —
      // nie plugin, harmonogram, SDK, peer ani notyfikacja zadania (PromptOrigin w d.ts).
      if (!OD_WLASCICIELA.has(e.origin.kind)) return { text: `Warsztat: /warsztat uruchamia kod z katalogu modu, więc przyjmuję je tylko od właściciela (prompt albo Remote Control), nie z „${e.origin.kind}”.` }
      return { text: await uruchom($, a) }
    } catch (err) {
      return { text: `Warsztat: błąd modu — ${opisBledu(err)}` }
    }
  }).catch(() => ({ text: 'Warsztat: błąd modu — hook odrzucony' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, warsztat)
    const nazwa = s.katalog?.split('/').pop() ?? '—'
    return (
      <Box flexDirection="column">
        <Text bold>{`Warsztat — ${nazwa}${s.wToku ? ' (w toku…)' : ''}`}</Text>
        <Text dimColor wrap="truncate-end">
          {s.katalog ?? 'bez katalogu'}
        </Text>
        {s.kroki.map(k => (
          <Box key={k.id} gap={1}>
            <Text bold color={kolor(k)} dimColor={k.stan === 'brak' || k.stan === 'czeka'}>
              {pad(SYMBOL[k.stan], 8)}
            </Text>
            <Text wrap="truncate-end">{wiersz(k)}</Text>
          </Box>
        ))}
        <Box gap={1}>
          <Button key="powtorz" variant="primary" hotkey="p" label="Powtórz" onPress={() => void powtorz($)} />
          <Button key="kopiuj" hotkey="k" label="Kopiuj błędy" onPress={press => void kopiujBledy($, press.surface)} />
          <Button key="zamknij" role="dismiss" label="Zamknij" onPress={() => void $.ui.close({ id: PANE }).catch(() => undefined)} />
        </Box>
        <Text dimColor wrap="truncate-end">
          {stopka(s)}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
