// kanon-skrzynka — nieprzeczytane raporty i stany na start sesji (mod Claude Code, API function hooks 2.1.299; early access). v0.1.
// Plan: ~/Developer/claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md §6.1. Dowód z logów: 7 raportów WATCH z werdyktem
// „ROZWAŻ”, 4 raporty USAGE i 51 plików stanu, których żadna sesja nie czyta (0 wystąpień „WATCH-” w 190 poleceniach). Odpowiednik modu
// „You Should Know” z filmu O'Briena, ale BEZ modelu: liczenie jest deterministyczne i darmowe, a wynik idzie do właściciela
// (jedna linia nad promptem), nie do kontekstu modelu (hook SessionStart z additionalContext kosztowałby ~0,5k tokenów w każdym żądaniu).
// Trzy źródła spod ~/.claude/kanon/ (HOME z `$.env.get`), czytane TYLKO po nagłówki:
//   watch/WATCH-<data>.md — linia „**WERDYKT: aktualizacja kanonu <SŁOWO> — …**” (linia 5 raportu; starsze raporty bez oceny LLM
//     mają tam „## Zmiany” → „bez werdyktu”); pasek: `WATCH-10-16 (ROZWAŻ)`; próg 14 dni (mtime);
//   usage/USAGE-tydzien-<data>.md — linia „okno 7 dni od …; plików N; koszt-list $X; ostatnie 2 dni $Y = Z%” (linia 6, pod ```);
//     pasek: `USAGE-10-15 (2 dni 19 %)`, `🔴` gdy Z > 40 (próg raportu tygodniowego); próg 14 dni;
//   stan/<sid>.md — pliki stanu INNYCH sesji (własny sid z `$.session.id()` pominięty; `<sid>-skrot.md` kanon-sztafety nie jest
//     plikiem stanu) z sekcją „## Stan” i mtime ≤ 7 dni; pasek: `stan 9f9dcef8 (16.10)`; w panelu TYLKO linia nagłówka ostatniej
//     sekcji „## Stan” — treść stanu zawiera nazwy klientów i NIE trafia ani do panelu, ani do `$.store`, ani do odpowiedzi komendy.
// `$.fs.read` nie czyta fragmentu pliku: cały tekst wchodzi do pamięci modułu na czas parsowania i wychodzi z niej sam nagłówek.
// Skan: `session.start`, co 10 min (`$.clock.every`), `/skrzynka`, „odśwież”. Pasek (AbovePrompt) tylko, gdy są pozycje: najwyżej
// 3 pozycje + „+N”, przycięte do szerokości. `/skrzynka` → pane z listą (źródło, nazwa, data, nagłówek) i przyciskami: „Wczytaj” →
// `$.prompt.fill` (replace) z „wczytaj <pełna ścieżka>” — Enter naciska właściciel; „Przeczytane” → `$.store` `skrzynka:<ścieżka>`
// = `{ kiedy, sid }`; „Wszystkie przeczytane”. Plik zmieniony PO oznaczeniu (mtime > kiedy: sesja dopisała sekcję, kanon-watch nadpisał
// raport dnia) wraca do skrzynki. `/skrzynka wyczysc` kasuje klucze `skrzynka:*`. Decyzja D6 (2026-10-17): polecenie
// „wczytaj <ścieżka pozycji>” zaobserwowane przez `prompt.submit` (zawsze `next(e)` bez zmian, nigdy `drop`) oznacza pozycję jako
// przeczytaną — obserwator bierze tylko polecenia właściciela (origin `composer`/`bridge`, bez `isMeta`) i sprawdza wzorzec „wczytaj
// <ścieżka kończąca się nazwą pliku pozycji z bieżącej listy>”; poza tym promptów nie czyta. Na pasku 🔴 idzie na początek.
// Bramki: zero `$.model`, `$.http`, `$.process`, `tool.check`, bez zapisu plików; jedyny stan to `$.store` (klucze `skrzynka:*`,
// wspólne dla sesji na Macu) i `$.state`. Każdy odczyt pliku w try/catch (brak katalogu lub pliku = brak pozycji, bez błędu);
// każdy hook z `.catch` (fail-open: błąd modu nie zatrzymuje startu sesji, polecenia ani rysowania).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, PromptSubmitInput, Register, Timer } from 'claude-code'

import type { Pozycja, Skrzynka } from '../types'

const PANE = 'skrzynka'
const KLUCZ = 'skrzynka:'
const CO_ILE = 10 * 60_000 // skan co 10 min
const DOBA = 86_400_000
export const PROG_RAPORTOW = 14 * DOBA // WATCH i USAGE starsze niż 14 dni (mtime) pomijane
export const PROG_STANOW = 7 * DOBA // pliki stanu starsze niż 7 dni pomijane
export const PROG_ALARMU = 40 // %; 🔴 gdy ostatnie 2 dni > 40 % okna 7 dni (próg raportu tygodniowego)
export const MAX_NA_PASKU = 3 // pozycji na pasku; reszta jako „+N”
const LINII_NAGLOWKA = 12 // tyle pierwszych linii raportu przeszukuje parser (WERDYKT = linia 5, podsumowanie USAGE = linia 6)
const SZER_PRZYCISKU = 12 // miejsce na przycisk „/skrzynka” i odstęp obok linii paska
const MAX_WIERSZY_PANELU = 14

// Skaner walidatora wymaga literałów plugin/key w każdym atomie (nie stałej) — stąd powtórzona nazwa.
const PUSTA: Skrzynka = { pozycje: [], odczyt: null, blad: null }
const skrzynka = atom({ plugin: 'kanon-skrzynka', key: 'skrzynka' } as const, PUSTA)

// ---------- parsery nagłówków (czyste funkcje, bez $; testy importują je stąd) ----------
const WATCH = /^WATCH-(\d{4})-(\d{2})-(\d{2})\.md$/
const USAGE = /^USAGE-tydzien-(\d{4})-(\d{2})-(\d{2})\.md$/
const STAN = /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i
const WERDYKT = /^\*{0,2}WERDYKT:\s*aktualizacja kanonu\s+(\S+)(.*)$/
const PODSUMOWANIE = /^okno 7 dni od .*?koszt-list\s+(\$[\d\s,.]*\d);\s*ostatnie 2 dni\s+(\$[\d\s,.]*\d)\s*=\s*(\d+(?:[.,]\d+)?)\s*%/
const NAGLOWEK_STAN = /^## Stan\b/

const naglowki = (tekst: string) => tekst.split('\n', LINII_NAGLOWKA)
const bezGwiazdek = (l: string) => l.replace(/^\*+|\*+$/g, '').trim()

/** Linia WERDYKT raportu WATCH: słowo po „kanonu” (ROZWAŻ / NIE / TAK, bez gwiazdek i interpunkcji) i cała linia bez gwiazdek; null, gdy jej nie ma. */
export function werdykt(tekst: string): { slowo: string; linia: string } | null {
  for (const l of naglowki(tekst)) {
    const m = WERDYKT.exec(l.trim())
    if (m?.[1]) return { slowo: m[1].replace(/[*.,:;]+$/, ''), linia: bezGwiazdek(l) }
  }
  return null
}

/** Linia podsumowania raportu USAGE: koszt-list, koszt 2 dni i udział Z (%); null, gdy jej nie ma. */
export function podsumowanie(tekst: string): { koszt: string; dwaDni: string; procent: number } | null {
  for (const l of naglowki(tekst)) {
    const m = PODSUMOWANIE.exec(l.trim())
    if (m?.[1] && m[2] && m[3]) return { koszt: m[1], dwaDni: m[2], procent: Number(m[3].replace(',', '.')) }
  }
  return null
}

/** Nagłówek OSTATNIEJ sekcji „## Stan” pliku stanu (bez „## ”); null, gdy pliku nie dzieli żadna. Treści sekcji nie zwraca. */
export function naglowekStanu(tekst: string): string | null {
  let ostatni: string | null = null
  for (const l of tekst.split('\n')) if (NAGLOWEK_STAN.test(l)) ostatni = l.slice(3).trim()
  return ostatni
}

// ---------- tekst ----------
const pad2 = (n: number) => String(n).padStart(2, '0')
const dzienMiesiac = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`
}
const dataCzas = (ms: number) => {
  const d = new Date(ms)
  return `${dzienMiesiac(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const procent = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1).replace('.', ',')} %`
/** Szerokość w komórkach terminala: emoji liczy się za 2. */
const szer = (s: string) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0)
const opisBledu = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Jedna linia paska: nagłówek z liczbą, potem najwyżej MAX_NA_PASKU pozycji i „+N”, ile zmieści się w `szerokosc` komórek. */
export function liniaPaska(pozycje: readonly Pozycja[], szerokosc: number): string {
  if (!pozycje.length) return ''
  const naglowek = `📬 ${pozycje.length} do przeczytania`
  // 🔴 na początek (sort stabilny): pasek ma najwyżej MAX_NA_PASKU pozycji, a alarm USAGE nie może utonąć w „+N” za starszymi WATCH
  const lista = [...pozycje].sort((a, b) => Number(b.alarm) - Number(a.alarm))
  let linia = naglowek
  for (let n = 1; n <= Math.min(MAX_NA_PASKU, lista.length); n++) {
    const reszta = lista.length - n
    const kandydat = `${naglowek}: ${lista
      .slice(0, n)
      .map(p => p.etykieta)
      .join(' · ')}${reszta > 0 ? ` +${reszta}` : ''}`
    if (szer(kandydat) > szerokosc) break
    linia = kandydat
  }
  return linia
}

const ZRODLO: Record<Pozycja['zrodlo'], string> = { watch: 'watch', usage: 'usage', stan: 'stan' }
/** Wiersz panelu: źródło · nazwa · data · nagłówek (nagłówek, nigdy treść). */
export const opis = (p: Pozycja) => `[${ZRODLO[p.zrodlo]}] ${p.nazwa} · ${dataCzas(p.mtimeMs)} · ${p.naglowek}`

// ---------- skan ----------
const sciezki = (home: string) => ({
  watch: `${home}/.claude/kanon/watch`,
  usage: `${home}/.claude/kanon/usage`,
  stan: `${home}/.claude/kanon/stan`,
})

/** Wpisy katalogu; brak katalogu albo odmowa = pusto (bez błędu). */
async function listuj($: EngineInterface, katalog: string): Promise<FsEntry[]> {
  try {
    return await $.fs.list(katalog)
  } catch {
    return []
  }
}
/** Tekst pliku; brak, odmowa albo > 4 MiB (`$.fs.read` odmawia) = null — pozycja bez czytelnego nagłówka jest pomijana. */
async function czytaj($: EngineInterface, sciezka: string): Promise<string | null> {
  try {
    return String(await $.fs.read(sciezka))
  } catch {
    return null
  }
}

// Kolejka modułu: skany (start, timer, komenda) i oznaczenia idą po kolei — skan nie przywróci pozycji oznaczonej w jego trakcie.
let kolejka: Promise<unknown> = Promise.resolve()
const szereguj = <T,>(f: () => Promise<T>): Promise<T> => {
  const p = kolejka.then(f, f)
  kolejka = p.catch(() => undefined)
  return p
}

const skanuj = ($: EngineInterface): Promise<Skrzynka> => szereguj(() => skanujTeraz($))

/** Oznaczenie „przeczytane” trzyma się ścieżki; plik zmieniony PO oznaczeniu (mtime > `kiedy`) wraca do skrzynki.
 *  Wartość nieczytelna albo bez `kiedy` = zostaje przeczytany (nie wracają hurtem przy błędzie store). */
async function zmienionyPoOznaczeniu($: EngineInterface, sciezka: string, mtimeMs: number): Promise<boolean> {
  try {
    const z = await $.store.get(KLUCZ + sciezka)
    const kiedy = typeof z === 'object' && z !== null && 'kiedy' in z && typeof z.kiedy === 'string' ? Date.parse(z.kiedy) : NaN
    return Number.isFinite(kiedy) && mtimeMs > kiedy
  } catch {
    return false
  }
}

async function skanujTeraz($: EngineInterface): Promise<Skrzynka> {
  const teraz = await $.clock.now()
  try {
    const [home, sid] = await Promise.all([$.env.get('HOME'), $.session.id()])
    if (!home) return await update($, skrzynka, s => ({ ...s, odczyt: teraz, blad: 'brak HOME w środowisku' }))
    const klucze = await $.store.keys().catch((): string[] => [])
    const przeczytane = new Set(klucze.filter(k => k.startsWith(KLUCZ)).map(k => k.slice(KLUCZ.length)))
    const d = sciezki(home)
    const pozycje: Pozycja[] = []
    const swieze = (wpisy: FsEntry[], wzorzec: RegExp, prog: number) =>
      wpisy.filter(e => e.kind === 'file' && wzorzec.test(e.name) && e.mtimeMs > 0 && teraz - e.mtimeMs <= prog).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const przeczytany = async (sciezka: string, mtimeMs: number) => przeczytane.has(sciezka) && !(await zmienionyPoOznaczeniu($, sciezka, mtimeMs))

    for (const e of swieze(await listuj($, d.watch), WATCH, PROG_RAPORTOW)) {
      const sciezka = `${d.watch}/${e.name}`
      if (await przeczytany(sciezka, e.mtimeMs)) continue
      const t = await czytaj($, sciezka)
      const m = WATCH.exec(e.name)
      if (t === null || !m) continue
      const w = werdykt(t)
      const nazwa = `WATCH-${m[2]}-${m[3]}`
      pozycje.push({
        zrodlo: 'watch',
        id: `watch-${m[1]}-${m[2]}-${m[3]}`,
        sciezka,
        plik: e.name.slice(0, -3),
        nazwa,
        etykieta: `${nazwa} (${w?.slowo ?? 'bez werdyktu'})`,
        naglowek: w?.linia ?? 'bez linii WERDYKT (raport bez oceny)',
        mtimeMs: e.mtimeMs,
        alarm: false,
      })
    }
    for (const e of swieze(await listuj($, d.usage), USAGE, PROG_RAPORTOW)) {
      const sciezka = `${d.usage}/${e.name}`
      if (await przeczytany(sciezka, e.mtimeMs)) continue
      const t = await czytaj($, sciezka)
      const m = USAGE.exec(e.name)
      if (t === null || !m) continue
      const u = podsumowanie(t)
      const alarm = u !== null && u.procent > PROG_ALARMU
      const nazwa = `USAGE-${m[2]}-${m[3]}`
      pozycje.push({
        zrodlo: 'usage',
        id: `usage-${m[1]}-${m[2]}-${m[3]}`,
        sciezka,
        plik: e.name.slice(0, -3),
        nazwa,
        etykieta: `${alarm ? '🔴 ' : ''}${nazwa} (${u ? `2 dni ${procent(u.procent)}` : 'bez podsumowania'})`,
        naglowek: u ? `koszt-list ${u.koszt} · ostatnie 2 dni ${u.dwaDni} = ${procent(u.procent)}` : 'bez linii podsumowania',
        mtimeMs: e.mtimeMs,
        alarm,
      })
    }
    for (const e of swieze(await listuj($, d.stan), STAN, PROG_STANOW)) {
      const m = STAN.exec(e.name)
      const sciezka = `${d.stan}/${e.name}`
      if (!m?.[1] || e.name === `${sid}.md` || (await przeczytany(sciezka, e.mtimeMs))) continue
      const t = await czytaj($, sciezka)
      if (t === null) continue
      const naglowek = naglowekStanu(t)
      if (naglowek === null) continue // plik bez sekcji „## Stan” (sam zapis hooka kanon-stan) to nie pozycja
      const nazwa = `stan ${m[1]}`
      pozycje.push({
        zrodlo: 'stan',
        id: `stan-${m[1]}`,
        sciezka,
        plik: e.name.slice(0, -3),
        nazwa,
        etykieta: `${nazwa} (${dzienMiesiac(e.mtimeMs)})`,
        naglowek,
        mtimeMs: e.mtimeMs,
        alarm: false,
      })
    }
    return await update($, skrzynka, () => ({ pozycje, odczyt: teraz, blad: null }))
  } catch (err) {
    // $.state odrzucone albo awaria rzeczownika: poprzednie pozycje zostają, stopka panelu pokazuje błąd
    return update($, skrzynka, s => ({ ...s, odczyt: teraz, blad: opisBledu(err) })).catch(() => ({ ...PUSTA, odczyt: teraz, blad: opisBledu(err) }))
  }
}

// ---------- oznaczanie ----------
const oznacz = ($: EngineInterface, lista: readonly Pozycja[]): Promise<void> => szereguj(() => oznaczTeraz($, lista))

/** `skrzynka:<ścieżka>` = `{ kiedy, sid }` dla każdej pozycji; z listy w `$.state` znikają od razu (bez ponownego skanu). */
async function oznaczTeraz($: EngineInterface, lista: readonly Pozycja[]): Promise<void> {
  if (!lista.length) return
  const [sid, teraz] = await Promise.all([$.session.id(), $.clock.now()])
  const kiedy = new Date(teraz).toISOString()
  for (const p of lista) await $.store.set(KLUCZ + p.sciezka, { kiedy, sid })
  const zdjete = new Set(lista.map(p => p.sciezka))
  await update($, skrzynka, s => ({ ...s, pozycje: s.pozycje.filter(p => !zdjete.has(p.sciezka)) }))
}

const oznaczToastem = ($: EngineInterface, lista: readonly Pozycja[]) =>
  oznacz($, lista).catch(err => $.ui.toast(`Skrzynka: nie udało się oznaczyć — ${opisBledu(err)}`, { timeoutMs: 8000 }))

// ---------- panel ----------
const otworzPanel = async ($: EngineInterface) => {
  const s = await read($, skrzynka)
  return $.ui.open({ id: PANE, title: 'Skrzynka', focus: true, closeOnEscape: true, rows: Math.min(MAX_WIERSZY_PANELU, s.pozycje.length + 4) })
}

/** „Wczytaj”: panel zamknięty PRZED fill (otwarty z `focus` trzyma klawiaturę), potem „wczytaj <ścieżka>” do pola promptu — Enter
 *  naciska właściciel; dopiero jego polecenie (obserwator `prompt.submit`) oznaczy pozycję. Odmowa → panel wraca, toast z tekstem. */
async function wczytaj($: EngineInterface, p: Pozycja): Promise<void> {
  const tekst = `wczytaj ${p.sciezka}`
  try {
    await $.ui.close({ id: PANE })
    const f = await $.prompt.fill({ text: tekst, mode: 'replace' })
    if (f.isFilled) {
      $.ui.toast(`Skrzynka: „wczytaj ${p.nazwa}” w polu promptu — Enter wysyła`)
      return
    }
    await otworzPanel($)
    $.ui.toast(`Skrzynka: pole promptu nie przyjęło tekstu — wpisz sam: ${tekst}`, { timeoutMs: 10_000 })
  } catch (err) {
    $.ui.toast(`Skrzynka: błąd — ${opisBledu(err)}; wpisz sam: ${tekst}`, { timeoutMs: 10_000 })
  }
}

const godzina = (ms: number) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`
const stopka = (s: Skrzynka) =>
  `${s.pozycje.length} do przeczytania · skan ${s.odczyt === null ? '—' : godzina(s.odczyt)}, co ${CO_ILE / 60_000} min · raporty ≤ 14 dni, stany innych sesji ≤ 7 dni` +
  (s.blad ? ` · błąd: ${s.blad}` : '')

// D6: tylko polecenie właściciela (Enter przy prompcie albo Remote Control), nie notyfikacja, peer, harmonogram ani inny plugin.
const odWlasciciela = (e: PromptSubmitInput) => !e.isMeta && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')
const uciekaj = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** „wczytaj <ścieżka kończąca się nazwą pliku pozycji>[.md]”: nazwa to koniec członu tuż po „wczytaj” (nie gdziekolwiek w zdaniu;
 *  `<sid>-skrot.md` nie trafia, bo po sid idzie „-skrot”). Wielkość liter bez znaczenia. */
const wczytany = (tekst: string, p: Pozycja) => new RegExp(`wczytaj\\s+\\S*?${uciekaj(p.plik)}(?:\\.md)?(?=[^\\w-]|$)`, 'i').test(tekst)

// Jeden timer modułu: `session.start` odpala się też przy enable i respawnie workera, więc poprzedni kasujemy przed nowym.
let timer: Timer | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skrzynka',
      description: 'Skrzynka nieprzeczytanych raportów WATCH/USAGE i stanów innych sesji: Wczytaj → „wczytaj <ścieżka>” w polu promptu, Przeczytane → $.store; „wyczysc” kasuje oznaczenia',
      argumentHint: '[wyczysc|zamknij]',
    })
    const r = await next(e)
    // Bez await: pierwszy session.start jest awaitowany przez silnik, a skan to kilkadziesiąt odczytów — zawieszony odczyt nie może
    // wstrzymać startu sesji. Pasek przerysuje się sam po zapisie $.state.
    void skanuj($).catch(() => undefined)
    timer?.cancel()
    timer = $.clock.every(CO_ILE, () => void skanuj($).catch(() => undefined))
    return r
  }).catch(($, e, next) => next(e))

  // D6: „wczytaj <ścieżka pozycji>” = przeczytane. Obserwator: `next(e)` zawsze z niezmienionym `e`, nigdy `drop`; nie czyta promptów
  // poza sprawdzeniem słowa „wczytaj” i nazw plików z bieżącej listy.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (odWlasciciela(e) && /wczytaj/i.test(e.text)) {
        const s = await read($, skrzynka)
        const trafione = s.pozycje.filter(p => wczytany(e.text, p))
        // bez await: oznaczenie czeka w kolejce za skanem, a Enter właściciela nie może czekać na nie
        if (trafione.length) void oznacz($, trafione).catch(() => undefined)
      }
    } catch {
      // obserwator: błąd oznaczenia nie dotyka polecenia
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Hook odpowiada za własną komendę; try/catch, bo hook, który się wysypie, silnik pomija (komenda bez odpowiedzi).
  on('command.run', { command: 'skrzynka' }, async ($, e) => {
    try {
      const a = e.args.trim().toLowerCase()
      if (a === 'wyczysc' || a === 'wyczyść') {
        const klucze = (await $.store.keys()).filter(k => k.startsWith(KLUCZ))
        for (const k of klucze) await $.store.delete(k)
        const s = await skanuj($)
        return { text: `Skrzynka: skasowano ${klucze.length} oznaczeń „przeczytane”; ${s.pozycje.length} do przeczytania.` }
      }
      if (a === 'zamknij') {
        await $.ui.close({ id: PANE })
        return { text: 'Skrzynka zamknięta.' }
      }
      const s = await skanuj($)
      const o = await otworzPanel($)
      if (o.isPlaced) return { text: `Skrzynka: ${s.pozycje.length} do przeczytania${s.blad ? ` (błąd skanu: ${s.blad})` : ''}.` }
      return { text: [`Skrzynka (panel czeka: ${o.reason}): ${s.pozycje.length} do przeczytania`, ...s.pozycje.map(p => `- ${opis(p)}`)].join('\n') }
    } catch (err) {
      return { text: `Skrzynka: błąd modu — ${opisBledu(err)}` }
    }
  }).catch(() => ({ text: 'Skrzynka: błąd modu — hook odrzucony' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, skrzynka)
    if (e.props.hasSurvey || e.props.maxRows < 1 || s.pozycje.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const linia = liniaPaska(s.pozycje, e.props.bodyColumns - SZER_PRZYCISKU)
    // Pasmo rysuje JEDEN hook (d.ts: „draws a tree, or passes; one instance”): co narysowałby plugin niżej w łańcuchu (kanon-pasek-budzetu,
    // kanon-sztafeta rysują własne drzewa bez `next`), idzie pod linią skrzynki zamiast zniknąć. Błąd niżej nie gasi skrzynki.
    const nizej = await next(e).catch(() => undefined)
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text wrap="truncate-end" color={s.pozycje.some(p => p.alarm) ? 'warning' : undefined}>
            {linia}
          </Text>
          <Button key="otworz" plain label="/skrzynka" onPress={() => otworzPanel($)} />
        </Box>
        {nizej}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, skrzynka)
    return (
      <Box flexDirection="column">
        <Text bold>{`Skrzynka — ${s.pozycje.length} do przeczytania`}</Text>
        {s.pozycje.length === 0 && (
          <Text dimColor>{s.odczyt === null ? 'Skan…' : 'Nic do przeczytania: raporty z 14 dni i stany innych sesji z 7 dni są przeczytane albo ich nie ma.'}</Text>
        )}
        {s.pozycje.map(p => (
          <Box key={p.id} gap={1}>
            <Button key={`wczytaj-${p.id}`} plain label="Wczytaj" onPress={() => wczytaj($, p)} />
            <Button key={`przeczytane-${p.id}`} plain label="Przeczytane" onPress={() => oznaczToastem($, [p])} />
            <Text wrap="truncate-end" color={p.alarm ? 'error' : undefined}>
              {opis(p)}
            </Text>
          </Box>
        ))}
        <Box gap={1}>
          {s.pozycje.length > 0 && <Button key="wszystkie" label="Wszystkie przeczytane" onPress={() => oznaczToastem($, s.pozycje)} />}
          <Button key="odswiez" plain hotkey="o" label="odśwież" onPress={() => skanuj($).catch(() => undefined)} />
          <Button key="zamknij" role="dismiss" label="Zamknij" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor wrap="truncate-end">
          {stopka(s)}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
