// kanon-sztafeta — przekazanie pałeczki do nowej sesji (mod Claude Code, API function hooks 2.1.299; early access). v0.1.
// Plan: ~/Developer/claude-kanon/claude-code/mods/PLAN-mody-2026-10-16-z-logow.md §3.1 (decyzja D1: z przyciskiem start_session).
// Pasek nad promptem (AbovePrompt) pojawia się dopiero, gdy sesja spełnia co najmniej jeden warunek: ≥ 1 kompaktacja głównego wątku
// (session.compact), wiek ≥ 8 h ($.session.usage().startedAt, w odwodzie zegar przy session.start), kontekst ≥ WARN (ta sama formuła
// co kanon-pasek-budzetu: KANON_CTX_WARN albo okno budżetu − 80k; okno z env → settings → modelSettings → silnik; różnica wobec
// hooka Stop kanon-budzet: mod nie czyta transkryptu, więc nie obniża WARN do mediany realnych punktów kompaktacji sesji — hook
// pozostaje bramką). W świeżej sesji paska nie ma; /clear i resume zerują liczniki (session.end).
// /sztafeta → pane z OSTATNIĄ sekcją „## Stan” pliku ~/.claude/kanon/stan/<sid>.md (nie całym plikiem) i briefem dla nowej sesji
// wyciętym deterministycznie z podsekcji „### Dalej…” i „### Decyzje…” (bez modelu). /sztafeta skrot → <sid>-skrot.md: ostatnia
// sekcja „## Stan” + ostatni blok kompaktacji hooka kanon-stan („## Kompaktacja N” / „## Podsumowanie kompaktacji”), razem ≤ 8 KB
// (przycięcie od końca bloku kompaktacji z adnotacją „przycięto”). Przycisk „Przekaż do nowej sesji” → zapis skrótu +
// $.mcp.call('ccd_session', 'start_session', { initiation: 'own_initiative', … }) — karta w aplikacji, którą właściciel sam uruchamia;
// WYŁĄCZNIE na klik. Gdy serwer nie odpowie: $.prompt.fill (append) + $.ui.copy — właściciel wkleja brief sam. Bez `cwd`: nowa sesja
// dziedziczy folder bieżącej.
// Bramki: zero $.model, $.http, $.process; jedyny zapis na dysk = <sid>-skrot.md w ~/.claude/kanon/stan/; stan modu w $.state;
// tool.check nieużywany; hooki zdarzeń tylko obserwują (każdy z .catch). Mod nie zastępuje hooka kanon-budzet — blok tury zostaje bramką.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, UiPressArgument } from 'claude-code'

import type { Widok } from '../types'

// Skaner walidatora wymaga literałów plugin/key w każdym atomie (nie stałej) — stąd powtórzona nazwa.
const kompaktacje = atom({ plugin: 'kanon-sztafeta', key: 'kompaktacje' } as const, 0)
const start = atom({ plugin: 'kanon-sztafeta', key: 'start' } as const, null)
const kontekst = atom({ plugin: 'kanon-sztafeta', key: 'kontekst' } as const, null)
const plik = atom({ plugin: 'kanon-sztafeta', key: 'plik' } as const, null)
const widok = atom({ plugin: 'kanon-sztafeta', key: 'widok' } as const, null)
const tyk = atom({ plugin: 'kanon-sztafeta', key: 'tyk' } as const, 0)

export const PROG_WIEKU = 8 * 3_600_000
export const LIMIT_SKROTU = 8 * 1024 // bajtów UTF-8, razem z nagłówkiem i adnotacją
const CO_ILE_TYK = 5 * 60_000 // odświeżenie wieku sesji na pasku
const PANE = 'sztafeta'
const PUNKTOW = 15 // najwyżej tyle punktów z „Dalej” i z „Decyzje” w briefie
const DL_PUNKTU = 400
const DL_SEKCJI = 1500 // brief z całej sekcji, gdy nie ma podsekcji

// ---------- parser pliku stanu (czyste funkcje, bez $; testy importują je stąd) ----------
const NAGLOWEK_STAN = /^## Stan\b/
const NAGLOWEK_KOMPAKTACJI = /^## (Kompaktacja \d|Podsumowanie kompaktacji\b)/

export type Podzial = {
  /** Liczba sekcji „## Stan”. */
  stany: number
  /** Ostatnia sekcja „## Stan” z nagłówkiem (do następnego „## ”); null, gdy żadnej nie ma. */
  stan: string | null
  /** Ostatni blok hooka kanon-stan: „## Kompaktacja N — …” albo „## Podsumowanie kompaktacji — …”. */
  kompaktacja: string | null
}

/** Dzieli plik stanu po liniach „## ” (sekcje „## Stan” pisze asystent, bloki kompaktacji hook kanon-stan; bywają inne H2). */
export function podziel(tekst: string): Podzial {
  const linie = tekst.split('\n')
  const od: number[] = []
  linie.forEach((l, i) => {
    if (l.startsWith('## ')) od.push(i)
  })
  const blok = (k: number) => linie.slice(od[k], od[k + 1] ?? linie.length).join('\n').trimEnd()
  const p: Podzial = { stany: 0, stan: null, kompaktacja: null }
  od.forEach((i, k) => {
    const l = linie[i] ?? ''
    if (NAGLOWEK_STAN.test(l)) {
      p.stany += 1
      p.stan = blok(k)
    } else if (NAGLOWEK_KOMPAKTACJI.test(l)) p.kompaktacja = blok(k)
  })
  return p
}

export const naglowek = (sekcja: string): string => sekcja.split('\n', 1)[0] ?? ''
const bezNaglowka = (sekcja: string): string => sekcja.split('\n').slice(1).join('\n').trim()
const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
/** Godzina z nagłówka: przy dacie („## Stan 2026-10-16 23:37 (asystent)” → „23:37”; „…2026-10-10T10:16Z…” → jak hhmm, czyli w strefie
 *  silnika, tej samej co zapas z mtime), inaczej pierwsze HH:MM nieprzyklejone do cyfr ani dwukropka; null bez godziny. */
export const godzinaZ = (linia: string): string | null => {
  const m = /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(Z?)/.exec(linia)
  if (m) return m[4] ? hhmm(Date.parse(`${m[1]}T${(m[2] ?? '').padStart(2, '0')}:${m[3]}:00Z`)) : `${m[2]}:${m[3]}`
  return /(?<![\d:])(\d{2}:\d{2})(?![\d:])/.exec(linia)?.[1] ?? null // dwie cyfry godziny: „po 1:30 h pracy” to czas trwania, nie godzina
}
export const skroc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Treść podsekcji „### <prefiks…>” (do następnego „### ”), bez nagłówka; null, gdy jej nie ma. Prefiks bez względu na wielkość liter. */
export function podsekcja(sekcja: string, prefiks: RegExp): string | null {
  const linie = sekcja.split('\n')
  const od = linie.findIndex(l => l.startsWith('### ') && prefiks.test(l.slice(4).trim()))
  if (od < 0) return null
  const koniec = linie.findIndex((l, i) => i > od && l.startsWith('### '))
  return linie.slice(od + 1, koniec < 0 ? linie.length : koniec).join('\n').trim()
}

/** Punkty listy („- ”, „* ”, „1. ”); bez listy — niepuste linie. Najwyżej PUNKTOW, każdy ≤ DL_PUNKTU znaków. */
export function punkty(tresc: string): string[] {
  const linie = tresc.split('\n').map(l => l.trim()).filter(l => l !== '')
  const lista = linie.filter(l => /^([-*•]|\d+[.)])\s/.test(l))
  return (lista.length ? lista : linie).slice(0, PUNKTOW).map(l => skroc(l, DL_PUNKTU))
}

/** Brief dla nowej sesji: „wczytaj <skrót>; dalej: …; decyzje: …; repo: <cwd>” — z nagłówków, bez modelu. */
export function brief(stan: string | null, skrot: string, cwd: string): string {
  const linie: string[] = []
  if (stan === null) linie.push('stan: brak sekcji „## Stan” w pliku stanu tej sesji — ustal z właścicielem, co było robione')
  else {
    linie.push(`wczytaj ${skrot}`)
    const dalej = podsekcja(stan, /^dalej/i)
    const decyzje = podsekcja(stan, /^decyzje/i)
    if (dalej) linie.push('dalej:', ...punkty(dalej))
    if (decyzje) linie.push('decyzje:', ...punkty(decyzje))
    if (!dalej && !decyzje) linie.push('stan (sekcja bez podsekcji „Dalej” i „Decyzje”):', skroc(bezNaglowka(stan), DL_SEKCJI))
  }
  linie.push(`repo: ${cwd}`)
  return linie.join('\n')
}

const bajtyZnaku = (c: number): number => (c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xd800 || c >= 0xe000 ? 3 : c < 0xdc00 ? 4 : 0)
/** Długość w bajtach UTF-8 (para zastępcza liczona przy pierwszej połówce). Środowisko modu nie ma TextEncoder. */
export function bajty(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) n += bajtyZnaku(s.charCodeAt(i))
  return n
}
/** Przycina od końca do najwyżej `max` bajtów UTF-8, nie rozcinając pary zastępczej. */
export function utnij(s: string, max: number): string {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    n += bajtyZnaku(s.charCodeAt(i))
    if (n > max) return s.slice(0, i)
  }
  return s
}

/** Skrót ≤ LIMIT_SKROTU: nagłówek + ostatnia sekcja „## Stan” + ostatni blok kompaktacji; za dużo → blok przycięty od końca z adnotacją. */
export function zbudujSkrot(p: Podzial, glowa: string, sciezkaPelna: string): { tekst: string; przycieto: boolean } {
  const stan = `${glowa}\n\n${p.stan ?? ''}`
  const caly = p.kompaktacja ? `${stan}\n\n${p.kompaktacja}` : stan
  if (bajty(caly) < LIMIT_SKROTU) return { tekst: `${caly}\n`, przycieto: false }
  const adnotacja = `\n\n_(przycięto do ${LIMIT_SKROTU / 1024} KB; pełny plik: ${sciezkaPelna})_\n`
  const budzet = LIMIT_SKROTU - bajty(adnotacja)
  const naKompaktacje = budzet - bajty(`${stan}\n\n`)
  const tekst = p.kompaktacja && naKompaktacje >= 200 ? `${stan}\n\n${utnij(p.kompaktacja, naKompaktacje)}` : utnij(stan, budzet)
  return { tekst: `${tekst}${adnotacja}`, przycieto: true }
}

// ---------- liczby i teksty paska ----------
const k = (n: number) => `${Math.round(n / 1000)}k`
const liczba = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
/** Odmiana po liczebniku: 1 kompaktacja, 2–4 kompaktacje, 5+ kompaktacji (22–24 znów kompaktacje). */
export const odmiana = (n: number, jeden: string, kilka: string, wiele: string): string => {
  const r10 = n % 10
  const r100 = n % 100
  return n === 1 ? jeden : r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? kilka : wiele
}
export const czasTrwania = (ms: number): string => {
  const min = Math.max(0, Math.floor(ms / 60_000))
  return min >= 60 ? `${Math.floor(min / 60)} h` : `${min} min`
}
const temu = (ms: number): string => {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'przed chwilą'
  if (min < 60) return `${min} min temu`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h temu` : `${Math.floor(h / 24)} d temu`
}
// ---------- plik stanu i kontekst ($) ----------
async function sciezki($: EngineInterface): Promise<{ sid: string; stan: string; skrot: string }> {
  const [home, sid] = await Promise.all([$.env.get('HOME'), $.session.id()])
  if (!home) throw new Error('brak HOME w środowisku')
  return { sid, stan: `${home}/.claude/kanon/stan/${sid}.md`, skrot: `${home}/.claude/kanon/stan/${sid}-skrot.md` }
}

/** Pełny odczyt i podział pliku stanu; null, gdy pliku nie ma. ($.fs.read odmawia od 4 MiB — największy plik stanu ma 448 KB.) */
async function czytaj($: EngineInterface, sciezka: string): Promise<Podzial | null> {
  if (!(await $.fs.exists(sciezka))) return null
  return podziel(String(await $.fs.read(sciezka)))
}

/** Metadane pliku do paska; czyta plik tylko, gdy mtime się zmienił (po kompaktacji i po turze głównego wątku). */
async function odswiezPlik($: EngineInterface): Promise<void> {
  const { stan } = await sciezki($)
  if (!(await $.fs.exists(stan))) {
    await update($, plik, () => null)
    return
  }
  const st = await $.fs.stat(stan)
  if ((await read($, plik))?.mtimeMs === st.mtimeMs) return
  const p = podziel(String(await $.fs.read(stan)))
  const czas = (p.stan ? godzinaZ(naglowek(p.stan)) : null) ?? hhmm(st.mtimeMs)
  await update($, plik, () => ({ mtimeMs: st.mtimeMs, sekcje: p.stany, czas }))
}

async function oknoBudzetu($: EngineInterface, oknoModelu: number): Promise<number> {
  const zEnv = liczba(await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'))
  if (zEnv) return zEnv
  const ustawienia = await $.settings.read()
  const zSettings = liczba(ustawienia.autoCompactWindow)
  if (zSettings) return zSettings
  const model = await $.session.model()
  const perModel = ustawienia.modelSettings as Record<string, { autoCompactWindow?: unknown } | undefined> | undefined
  return liczba(perModel?.[model]?.autoCompactWindow) ?? oknoModelu
}

/** Kontekst głównego wątku i próg WARN — formuła hooka kanon-budzet (jak w kanon-pasek-budzetu). */
async function zastosujKontekst($: EngineInterface, c: SessionContextUsage): Promise<void> {
  const tokens = c.tokens ?? (c.percent != null ? Math.round((c.percent / 100) * c.window) : null)
  if (tokens === null) return
  const okno = await oknoBudzetu($, c.window)
  const warn = liczba(await $.env.get('KANON_CTX_WARN')) ?? (okno >= 200_000 ? okno - 80_000 : okno - 40_000)
  await update($, kontekst, () => ({ tokens, warn }))
}

async function zbudujWidok($: EngineInterface): Promise<Widok> {
  const [s, cwd] = await Promise.all([sciezki($), $.session.cwd()])
  const p = await czytaj($, s.stan)
  const stan = p?.stan ?? null
  const w: Widok = {
    naglowek: stan ? naglowek(stan) : null,
    sekcja: stan
      ? bezNaglowka(stan)
      : p
        ? `Plik ${s.stan} nie ma żadnej sekcji „## Stan”.`
        : `Brak pliku stanu ${s.stan} — ta sesja nie zostawiła jeszcze sekcji „## Stan”.`,
    brief: brief(stan, s.skrot, cwd),
    sekcje: p?.stany ?? 0,
    sciezka: s.stan,
  }
  await update($, widok, () => w)
  return w
}

/** Jedyny zapis modu na dysk: <sid>-skrot.md obok pliku stanu. null, gdy nie ma czego skracać. */
async function zapiszSkrot($: EngineInterface): Promise<{ sciezka: string; bajty: number; przycieto: boolean } | null> {
  const s = await sciezki($)
  const p = await czytaj($, s.stan)
  if (!p?.stan) return null
  const teraz = await $.clock.now()
  const { tekst, przycieto } = zbudujSkrot(p, `# Skrót stanu sesji ${s.sid} — zapisany ${new Date(teraz).toISOString()}`, s.stan)
  await $.fs.write(s.skrot, tekst)
  return { sciezka: s.skrot, bajty: bajty(tekst), przycieto }
}

/** Klik „Przekaż do nowej sesji”: skrót na dysk, karta start_session; gdy serwer nie odpowie — brief do promptu i schowka. */
async function przekaz($: EngineInterface, press: UiPressArgument): Promise<void> {
  const w = await zbudujWidok($)
  const skrot = await zapiszSkrot($).catch(() => null) // odmowa zapisu nie blokuje karty ani zapasu
  const [sid, cwd, n, s, teraz] = await Promise.all([$.session.id(), $.session.cwd(), read($, kompaktacje), read($, start), $.clock.now()])
  const ile = `${n} ${odmiana(n, 'kompaktacja', 'kompaktacje', 'kompaktacji')}`
  const background =
    `Przekazanie pałeczki (mod kanon-sztafeta) z sesji ${sid} w ${cwd}: ${ile}, wiek ${s === null ? 'nieznany' : czasTrwania(teraz - s)}. ` +
    `Plik stanu ${w.sciezka} ma ${w.sekcje} sekcji „## Stan”; ${skrot ? `skrót (≤ 8 KB): ${skrot.sciezka}` : 'skrótu nie ma (brak sekcji „## Stan” albo zapis się nie powiódł)'}. ` +
    'Zacznij od wczytania skrótu, potem realizuj punkty „dalej” z briefu; decyzje właściciela z briefu obowiązują.'
  try {
    const r = await $.mcp.call('ccd_session', 'start_session', {
      initiation: 'own_initiative',
      title: skroc(`Sztafeta z sesji ${sid.slice(0, 8)} (${ile})`, 59),
      prompt: w.brief,
      background,
      context: 'fresh',
    })
    const tekst = r.content.map(c => c.text ?? '').join('')
    if (r.isError || /^Error\b/.test(tekst)) throw new Error(skroc(tekst, 160))
    $.ui.toast('Sztafeta: karta nowej sesji gotowa — uruchom ją w aplikacji (brief i skrót już w niej są)', { timeoutMs: 10_000 })
  } catch (err) {
    const powod = err instanceof Error ? err.message : String(err)
    const [f, c] = await Promise.all([
      $.prompt.fill({ text: w.brief, mode: 'append' }).catch(() => ({ isFilled: false })),
      $.ui.copy({ text: w.brief, surface: press.surface }).catch(() => ({ isCopied: false })),
    ])
    const gdzie = [f.isFilled ? 'w oknie promptu' : '', c.isCopied ? 'w schowku' : ''].filter(Boolean).join(' i ') || 'tylko w panelu /sztafeta'
    $.ui.toast(`Sztafeta: start_session nie zadziałał (${skroc(powod, 100)}) — brief ${gdzie}; wklej go do nowej sesji`, { timeoutMs: 15_000 })
  }
}

async function pokaz($: EngineInterface): Promise<void> {
  await zbudujWidok($)
  const o = await $.ui.open({ id: PANE, title: 'Sztafeta', focus: true })
  if (!o.isPlaced) $.ui.toast(`Sztafeta: panel czeka na miejsce (${o.reason}) — /sztafeta pokaże treść w transkrypcie`, { timeoutMs: 8_000 })
}

const zglos = ($: EngineInterface, co: string) => (err: unknown) =>
  $.ui.toast(`Sztafeta: ${co} nie powiodło się (${skroc(err instanceof Error ? err.message : String(err), 120)})`, { timeoutMs: 10_000 })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sztafeta',
      description: 'Sztafeta: ostatnia sekcja „## Stan” tej sesji i brief dla nowej; „skrot” zapisuje ~/.claude/kanon/stan/<sid>-skrot.md (≤ 8 KB)',
      argumentHint: '[skrot]',
    })
    const r = await next(e)
    if ((await read($, start)) === null) {
      const z = await $.session.usage().then(u => liczba(u.startedAt), () => null)
      const teraz = z ?? (await $.clock.now())
      await update($, start, () => teraz)
    }
    await odswiezPlik($).catch(() => undefined)
    $.clock.every(CO_ILE_TYK, () => {
      update($, tyk, t => t + 1).catch(() => undefined)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      // Proces trwa pod nowym id bez session.start — liczniki tej rozmowy nie mogą przejść na świeżą.
      await Promise.all([
        update($, kompaktacje, () => 0),
        update($, start, () => null),
        update($, kontekst, () => null),
        update($, plik, () => null),
        update($, widok, () => null),
      ]).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && r.skip === undefined) await update($, kompaktacje, n => n + 1).catch(() => undefined)
    await odswiezPlik($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // pasek dotyczy głównego wątku
    await $.session
      .usage()
      .then(u => zastosujKontekst($, u.context))
      .catch(() => undefined)
    await odswiezPlik($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await zastosujKontekst($, e.context).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sztafeta' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'skrot') {
      const r = await zapiszSkrot($)
      return {
        text: r
          ? `Skrót zapisany: ${r.sciezka} (${r.bajty} B${r.przycieto ? ', przycięto do 8 KB' : ''}). Nowa sesja: „wczytaj ${r.sciezka}”.`
          : `Brak sekcji „## Stan” w pliku stanu tej sesji — nie ma czego skracać.`,
      }
    }
    const w = await zbudujWidok($)
    const o = await $.ui.open({ id: PANE, title: 'Sztafeta', focus: true }).catch(() => ({ isPlaced: false as const, reason: 'błąd otwarcia' }))
    const linia = w.naglowek ? `Sztafeta: „${w.naglowek}” (ostatnia z ${w.sekcje}); brief w panelu, skrót zapisze przycisk albo /sztafeta skrot.` : `Sztafeta: ${w.sekcja}`
    return { text: o.isPlaced ? linia : `${linia}\n\n${w.sekcja}\n\n— brief dla nowej sesji —\n${w.brief}` }
  }).catch((_$, _e, next) => ({ text: `Sztafeta: /sztafeta nie powiodło się (${next.error.kind}${next.error.message ? `: ${skroc(next.error.message, 120)}` : ''})` }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows < 1) return next(e)
    const [n, s, c, p, teraz] = await Promise.all([read($, kompaktacje), read($, start), read($, kontekst), read($, plik), $.clock.now()])
    await read($, tyk) // sam odczyt wiąże pasek z timerem: co 5 min wiek sesji rysuje się na nowo
    const wiek = s === null ? 0 : teraz - s
    const zaWarn = c !== null && c.tokens >= c.warn
    if (n < 1 && wiek < PROG_WIEKU && !zaWarn) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const stan =
      p === null ? 'stan: brak pliku' : p.sekcje === 0 ? `stan: plik bez „## Stan” (${temu(teraz - p.mtimeMs)})` : `stan: ${p.czas} (${temu(teraz - p.mtimeMs)}, „## Stan” #${p.sekcje})`
    const czesci = [`${n} ${odmiana(n, 'kompaktacja', 'kompaktacje', 'kompaktacji')}`, `sesja ${czasTrwania(wiek)}`, stan]
    if (zaWarn && c) czesci.push(`kontekst ${k(c.tokens)} ≥ WARN ${k(c.warn)}`)
    return (
      <Box gap={1}>
        <Text color="warning">⟳ sztafeta:</Text>
        <Text>{czesci.join(' · ')}</Text>
        <Button key="przekaz" label="Przekaż do nowej sesji" variant="primary" onPress={press => void przekaz($, press).catch(zglos($, 'przekazanie'))} />
        <Button key="pokaz" label="Pokaż „dalej”" onPress={() => void pokaz($).catch(zglos($, 'panel'))} />
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const w = await read($, widok)
    if (w === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{w.naglowek ?? 'Brak sekcji „## Stan”'}</Text>
        <Text>{w.sekcja}</Text>
        <Text bold>Brief dla nowej sesji</Text>
        <Text>{w.brief}</Text>
        <Box gap={1}>
          <Button key="przekaz" label="Przekaż do nowej sesji" variant="primary" onPress={press => void przekaz($, press).catch(zglos($, 'przekazanie'))} />
          <Button key="zamknij" label="Zamknij" role="dismiss" onPress={() => void $.ui.close({ id: PANE }).catch(() => undefined)} />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
