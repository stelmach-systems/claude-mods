// Sanity indeksera na PRAWDZIWYM d.ts — kit `claude plugin test` nie ma dysku (nouny `$` istnieją tylko tam, gdzie odpowiada dno testu),
// więc to osobna komenda (Node ≥ 22.6, bez instalacji):
//   node --experimental-strip-types --no-warnings skrypty/sanity-dts.ts [ścieżka do claude-code/index.d.ts]
// Czyta hooks/register.tsx do znacznika „ładowanie indeksu” (część czysta: bez JSX, bez `$`), podstawia importy i uruchamia
// zbudujIndeks/szukaj. Kotwice po TREŚCI, nie po numerach linii (d.ts zmienia się z wersją binarki). Kod wyjścia 1 = coś nie gra.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Wpis = { nazwa: string; rodzaj: string; blok: string; od: number; do: number; docOd: number | null }
const mod = join(dirname(fileURLToPath(import.meta.url)), '..')
const dts = process.argv[2] ?? join(mod, '.claude-plugin/types/claude-code/index.d.ts')
const zrodlo = readFileSync(join(mod, 'hooks/register.tsx'), 'utf8')
const znacznik = '// ---------- ładowanie indeksu'
const ciecie = zrodlo.indexOf(znacznik)
if (ciecie < 0) throw new Error(`brak znacznika „${znacznik}” w hooks/register.tsx`)
const czysta = zrodlo
  .slice(0, ciecie)
  .replace(/^import \{ atom, read, update \} from 'claude-code'$/m, 'const atom = (ref: unknown, initial: unknown) => ({ ref, initial })')
  .replace(/^import type \{[^}]*\} from 'claude-code'$/m, 'type EngineInterface = any; type FsEntry = any; type McpToolResult = any; type ProcessRunResult = any; type Register = any; type RenderSurface = any')
  .replace(/^import type \{[^}]*\} from '\.\.\/types'$/m, 'type Binarka = any; type Indeks = any; type Krok = any; type RodzajKroku = any; type StanKroku = any; type Warsztat = any; type Wpis = any')
if (/^import /m.test(czysta)) throw new Error('w części czystej został import — dostosuj podstawienia w skrypcie')
const tmp = join(mkdtempSync(join(tmpdir(), 'kanon-warsztat-')), 'czysta.ts')
writeFileSync(tmp, czysta)
const { zbudujIndeks, szukaj, LIMIT_WYNIKU } = (await import(pathToFileURL(tmp).href)) as {
  zbudujIndeks: (t: string) => Wpis[]
  szukaj: (ind: Wpis[], linie: string[], q: string, zrodlo: string) => string
  LIMIT_WYNIKU: number
}

const tekst = readFileSync(dts, 'utf8')
const linie = tekst.split('\n')
const t0 = performance.now()
const ind = zbudujIndeks(tekst)
const ms = performance.now() - t0
const bledy: string[] = []
const spr = (ok: boolean, co: string) => {
  if (!ok) bledy.push(co)
}
const licz = (r: string) => ind.filter(w => w.rodzaj === r).length
const wpis = (nazwa: string, blok?: string) => ind.find(w => w.nazwa === nazwa && (blok === undefined || w.blok === blok))
const sz = (q: string) => szukaj(ind, linie, q, 'index.d.ts')

spr(licz('zdarzenie') >= 200, `za mało zdarzeń: ${licz('zdarzenie')}`)
spr(licz('metoda') >= 80, `za mało metod: ${licz('metoda')}`)
spr(licz('rzeczownik') >= 20, `za mało rzeczowników: ${licz('rzeczownik')}`)
spr(licz('typ') >= 600, `za mało typów: ${licz('typ')}`)
const tc = wpis('tool.call', 'EngineEventOf')
spr(!!tc && (linie[tc.od - 1] ?? '').includes("'tool.call': ToolCallInput") && tc.docOd !== null, 'tool.call: zdarzenie EngineEventOf z JSDoc na właściwej linii')
const pr = wpis('$.process')
spr(!!pr && ind.some(w => w.nazwa === '$.process.run' && w.rodzaj === 'metoda' && w.od > pr.od && w.od <= pr.do), '$.process: rzeczownik obejmujący metodę $.process.run')
const st = wpis('$.fs.stat')
spr(!!st && /^\s*stat: \(path/.test(linie[st.od - 1] ?? ''), '$.fs.stat: metoda na linii `stat: (path…`')
const su = wpis('SessionUsage')
spr(!!su && linie.slice(su.od - 1, su.do).some(l => l.includes('startedAt')), 'SessionUsage: typ obejmujący pole startedAt')
for (const w of ind) {
  spr(w.do >= w.od, `${w.nazwa}: do < od`)
  spr(w.do - w.od < 1500, `${w.nazwa}: wpis ${w.do - w.od} linii — regex nie znalazł końca`)
  // jednoliniowe `export const atom: AtomFunction` w d.ts nie mają średnika — wieloliniowy wpis musi kończyć się domknięciem
  if (w.rodzaj === 'typ' && w.do > w.od) spr(/[;}]\s*$/.test(linie[w.do - 1] ?? ''), `${w.nazwa}: ostatnia linia ${w.do} nie domyka deklaracji: ${(linie[w.do - 1] ?? '').trim()}`)
}
spr(sz('fs.list').startsWith('$.fs.list — metoda'), 'szukaj(fs.list) → najpierw metoda $.fs.list')
spr(sz('tool.call').startsWith('tool.call — zdarzenie (EngineEventOf'), 'szukaj(tool.call) → najpierw zdarzenie wejścia hooka')
spr(/^szukaj: \d+ trafień/.test(sz('ToolCall')), 'szukaj(ToolCall) → lista podciągu')
spr(sz('x'.repeat(5000)).length <= LIMIT_WYNIKU, 'długie zapytanie mieści się w limicie')
spr(sz('NextResultFor').includes("extends ['tool.call']"), 'płaski typ NextResultFor w całości (kontynuacja na tym samym wcięciu)')
for (const q of ['tool.call', 'fs.list', '$.process', 'SessionUsage', 'ui.copy', 'ToolCall']) spr(sz(q).length <= LIMIT_WYNIKU, `szukaj(${q}) ≤ ${LIMIT_WYNIKU}`)

console.log(
  `${dts}: ${linie.length} linii → ${ind.length} wpisów (zdarzeń ${licz('zdarzenie')}, metod ${licz('metoda')}, rzeczowników ${licz('rzeczownik')}, typów ${licz('typ')}); budowa ${ms.toFixed(0)} ms; JSON ${JSON.stringify(ind).length} B`,
)
if (process.argv.includes('--pokaz')) for (const q of ['tool.call', 'fs.list', '$.process', 'SessionUsage']) console.log(`\n===== ${q} =====\n${sz(q)}`)
if (bledy.length) {
  console.error(`✘ ${bledy.length} problemów:\n- ${bledy.join('\n- ')}`)
  process.exit(1)
}
console.log('✔ indekser zgodny z prawdziwym d.ts')
