// kanon-na-biegu — sekcja „⚡ Na biegu” w pasku bocznym desktopu (mod Claude Code, API function hooks 2.1.299; early access). v0.1.
// Pasek boczny należy do aplikacji desktop — mod go nie rysuje, tylko przekłada sesje narzędziami MCP `ccd_sidebar` (te same, co ma model).
// Tura w głównej rozmowie (nowa sesja albo wznowiona stara) → sesja sama wkłada się do sekcji („self” — bez pytania) i zapisuje w `$.store`,
// skąd przyszła. Przy starcie tury (najwyżej co 15 min na sesję) mod odkłada sesje bezczynne > 24 h do sekcji, z której przyszły (Ungrouped,
// gdy tej już nie ma). Bez timerów: ruch z timera silnik daje klasyfikatorowi trybu auto z pominięciem hooka `tool.check` modu → odmowa
// (sprawdzone na żywo 2026-10-16); ze startu tury i z `/na-biegu` hook działa.
// Czego NIE wiadomo: niebieskiej kropki „nieprzeczytane” — narzędzia ccd ją tylko ustawiają, nie podają. Zastępczo sesja zostaje w sekcji
// 24 h od ostatniej aktywności, więc nieprzeczytany wynik z ostatniej doby w niej jest.
// Uszanowanie ręcznych ruchów: przypiętej sesji mod nie rusza (przeniesienie do grupy zdjęłoby pin); sesji, którą właściciel wyjął z sekcji,
// nie wkłada ponownie, dopóki nie minie doba bez tury (wpis w store = „już obsłużona w tym okresie aktywności”; każda tura go odświeża).
// Grupy nieznane (okno aplikacji ich jeszcze nie zgłosiło: brak klucza `group` w `get_session`) → mod w tej turze nic nie robi.
// Wyłącznik: usunąć sekcję — mod szuka jej po nazwie, sam jej nie tworzy i bez niej nic nie robi.
// Zgoda: w trybie auto silnik daje `move_sessions` modu klasyfikatorowi, który wywołań spoza transkryptu nie ocenia („gave no verdict”
// → odmowa). Mod przepuszcza więc przy `tool.check` WYŁĄCZNIE własne przeniesienia (`next.origin.plugin` = ten mod, ustawia go silnik):
// „ask” → „allow”; „deny” z reguł właściciela i sufit organizacji zostają. Wywołania modelu i innych pluginów idą jak dotąd
// (decyzja właściciela 2026-10-16, wariant A, zatwierdzony w oknie zgody).
// Bramki: zero modelu, zero sieci; w store tylko id sesji, id grupy i czas — żadnej treści rozmów.
import type { EngineInterface, Register, ToolCheckDecision, ToolCheckResult } from 'claude-code'

const SEKCJA = '⚡ Na biegu'
const SERWER = 'ccd_sidebar'
const SESJE = 'ccd_session_mgmt'
const KLUCZ = 'na-biegu:'
const NAZWA = 'kanon-na-biegu' // = "name" z plugin.json; tak `next.origin.plugin` nazywa wywołania tego modu
const PRZENIES = 'mcp__ccd_sidebar__move_sessions'
const DOBA = 86_400_000
const SPRZATANIE = 15 * 60_000
const LIMIT = 100 // sesji z sekcji na jedno sprzątanie

type Sekcja = { id: string; kind: string; name: string }
type Sesja = { sessionId: string; lastActivityAt?: string; group?: { id: string } | null; pinned?: boolean }
/** Wpis sesji obsłużonej w bieżącym okresie aktywności: grupa, z której przyszła (null = Ungrouped), i ostatnia tura (ms). */
type Wpis = { origin: string | null; at: number }

const skroc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const blad = (err: unknown) => skroc(err instanceof Error ? err.message : String(err), 160)

/** Wywołanie narzędzia aplikacji desktop; błąd → wyjątek z tekstem serwera. Zwraca tekst wyniku.
 *  Silnik podmienia wynik ponad swój limit tokenów na tekst „Error: result … exceeds maximum allowed tokens” BEZ `isError` — stąd test prefiksu. */
async function wolaj($: EngineInterface, serwer: string, narzedzie: string, args: Record<string, unknown>): Promise<string> {
  const r = await $.mcp.call(serwer, narzedzie, args)
  const tekst = r.content.map(c => c.text ?? '').join('')
  if (r.isError || /^Error\b/.test(tekst)) throw new Error(`${narzedzie}: ${skroc(tekst, 120)}`)
  return tekst
}

/** Sekcje paska i id „⚡ Na biegu” (null, gdy właściciel ją usunął). */
async function sekcje($: EngineInterface): Promise<{ nasza: string | null; wszystkie: Set<string> }> {
  const l = JSON.parse(await wolaj($, SERWER, 'list_sections', {})) as Sekcja[]
  return { nasza: l.find(s => s.kind === 'manual' && s.name === SEKCJA)?.id ?? null, wszystkie: new Set(l.map(s => s.id)) }
}

const ja = async ($: EngineInterface) => JSON.parse(await wolaj($, SESJE, 'get_session', { session_id: 'self' })) as Sesja

// Diagnostyka dla `/na-biegu`: pamięć modułu (po reloadzie od zera).
let ostatni: { co: string; at: number } | null = null
let bladOstatni: string | null = null
let sprzatanieOstatnie = 0 // po reloadzie pierwsza tura sprząta od razu
const zanotuj = async ($: EngineInterface, co: string) => {
  ostatni = { co, at: await $.clock.now() }
}
/** Błąd pracy w tle: nowy (inny niż poprzedni) — jedna szara linia w transkrypcie; powtórki co 15 min widać tylko w `/na-biegu`. */
const zapiszBlad = ($: EngineInterface) => (e: unknown) => {
  const b = blad(e)
  if (b !== bladOstatni) $.ui.log(`Na biegu: ${b}`)
  bladOstatni = b
}

/** Tura w głównej rozmowie: włóż tę sesję do sekcji, chyba że jest przypięta, już w niej jest albo była obsłużona w tym okresie aktywności.
 *  Okres kończy doba bez tury: wpis odświeża każda tura, a starszy niż doba nie blokuje — sesja wyjęta ręcznie, wznowiona po przerwie,
 *  wraca do sekcji (sprzątanie wpisu bieżącej sesji nie rusza, więc bez tego czekałaby na sprzątanie innej sesji). */
async function wloz($: EngineInterface, nasza: string, s: Sesja): Promise<void> {
  if (s.pinned) return
  const klucz = KLUCZ + s.sessionId
  const [stary, teraz] = await Promise.all([$.store.get(klucz) as Promise<Wpis | undefined>, $.clock.now()])
  if (s.group?.id === nasza || (stary && teraz - stary.at <= DOBA)) {
    if (stary) await $.store.set(klucz, { ...stary, at: teraz })
    return
  }
  // Najpierw ruch: po nieudanym następna tura spróbuje znowu (wpis przed ruchem zablokowałby to na dobę).
  await wolaj($, SERWER, 'move_sessions', { session_ids: ['self'], section_id: nasza })
  await $.store.set(klucz, { origin: s.group?.id ?? null, at: teraz } satisfies Wpis)
  await zanotuj($, 'ta sesja → sekcja')
}

/** Sesje bezczynne > 24 h: z sekcji z powrotem tam, skąd przyszły; wpisy zakończonych okresów aktywności — do kosza. Zwraca liczbę odłożonych. */
async function sprzataj($: EngineInterface, nasza: string, wszystkie: Set<string>, s: Sesja): Promise<number> {
  // Tylko sesje z sekcji (filtr `group`): pełna lista (setki sesji, ~90 tys. znaków) przekracza limit wyniku MCP silnika.
  const [lista, teraz, klucze] = await Promise.all([
    wolaj($, SESJE, 'list_sessions', { group: nasza, limit: LIMIT }),
    $.clock.now(),
    $.store.keys(),
  ])
  // Bieżącej sesji sprzątanie nie rusza: ona właśnie pracuje (jej `lastActivityAt` bywa jeszcze sprzed tej tury). list_sessions jej nie podaje.
  const sesje = JSON.parse(lista) as Sesja[]
  const wpisy = new Map<string, Wpis>()
  for (const k of klucze) {
    if (!k.startsWith(KLUCZ)) continue
    const w = (await $.store.get(k)) as Wpis | undefined
    if (w) wpisy.set(k.slice(KLUCZ.length), w)
  }

  // Brak albo zły czas aktywności (NaN) → nie ruszamy.
  const bezczynna = (x: Sesja) => teraz - Date.parse(x.lastActivityAt ?? '') > DOBA

  const cele = new Map<string, string[]>() // sekcja docelowa → id sesji
  const doKosza: string[] = []
  for (const x of sesje) {
    // Przypięta w sekcji: przeniesienie do grupy zdjęłoby pin — czeka, aż właściciel ją odepnie (wpis zostaje).
    if (!bezczynna(x) || x.pinned) continue
    const origin = wpisy.get(x.sessionId)?.origin
    const cel = origin && wszystkie.has(origin) ? origin : 'sessions'
    cele.set(cel, [...(cele.get(cel) ?? []), x.sessionId])
  }
  // Wpisy sesji spoza sekcji (wyjęte ręcznie, zarchiwizowane, usunięte) — po dobie bezczynności do kosza. Po jednej: takich jest kilka.
  // Lista ucięta limitem nie mówi, kto jest poza sekcją — wtedy wpisów nie ruszamy (zgubiłyby grupę pochodzenia).
  const wSekcji = new Set(sesje.map(x => x.sessionId))
  for (const [sid, w] of sesje.length < LIMIT ? wpisy : []) {
    if (wSekcji.has(sid) || sid === s.sessionId) continue
    const x = await wolaj($, SESJE, 'get_session', { session_id: sid }).then(
      t => JSON.parse(t) as Sesja,
      (err: unknown) => (/not found/i.test(blad(err)) ? null : undefined),
    )
    if (x === undefined) continue // błąd chwilowy — wpis czeka do następnego sprzątania
    if (x ? bezczynna(x) : teraz - w.at > DOBA) doKosza.push(sid)
  }

  for (const sid of doKosza) await $.store.delete(KLUCZ + sid)
  let odlozone = 0
  for (const [cel, ids] of cele) {
    // Najpierw ruch, zaraz po nim wpisy tych sesji: po nieudanym ruchu wpis (i grupa pochodzenia) zostaje do następnej próby,
    // a odmowa przy kolejnym celu nie zostawia wpisów sesji, które już wróciły.
    await wolaj($, SERWER, 'move_sessions', { session_ids: ids, section_id: cel })
    for (const sid of ids) await $.store.delete(KLUCZ + sid)
    odlozone += ids.length
  }
  if (odlozone) await zanotuj($, `odłożone po dobie: ${odlozone}`)
  return odlozone
}

/** Start tury w głównej rozmowie: ta sesja do sekcji, a najwyżej co 15 min sprzątanie. Czas zapisany przed sprzątaniem: nieudane
 *  nie powtarza się co turę (każda odmowa to osobne wywołanie), tylko po kwadransie. */
async function naTurze($: EngineInterface): Promise<void> {
  const [{ nasza, wszystkie }, s] = await Promise.all([sekcje($), ja($)])
  if (!nasza || s.group === undefined) return
  await wloz($, nasza, s)
  const teraz = await $.clock.now()
  if (teraz - sprzatanieOstatnie < SPRZATANIE) return
  sprzatanieOstatnie = teraz
  await sprzataj($, nasza, wszystkie, s)
}

/** Werdykt `tool.check` dla `move_sessions`: „allow” tylko dla wywołań, które silnik przypisał temu modowi, i tylko w miejsce „ask”;
 *  „deny” (reguły właściciela) i sufit organizacji zostają, a wywołania modelu i innych pluginów dostają werdykt silnika bez zmian. */
export function zgoda(werdykt: ToolCheckResult, plugin: string | undefined, sufit: ToolCheckDecision | undefined): ToolCheckResult {
  if (plugin !== NAZWA || werdykt.decision !== 'ask' || (sufit && sufit !== 'allow')) return werdykt
  return { decision: 'allow', reason: `${NAZWA}: własne przeniesienie sesji w pasku bocznym` }
}

const godzina = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'na-biegu', description: 'Sekcja „⚡ Na biegu” w pasku bocznym: stan i sprzątanie teraz', immediate: true })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    // Subagent (agentId) to nie aktywność sesji w pasku. Czekamy najwyżej 3 s: pasek to lokalne IPC aplikacji (milisekundy), a zawieszony
    // serwer nie może trzymać startu tury (wywołanie `$` w locie nie liczy się do budżetu hooka) — dłuższe kończy się w tle.
    if (!e.agentId) {
      const stop = new AbortController()
      await Promise.race([naTurze($).catch(zapiszBlad($)), $.clock.sleep(3_000, { signal: stop.signal }).catch(() => {})])
      stop.abort()
    }
    return r
  })

  // Tylko własne przeniesienia modu; błąd tego hooka = werdykt silnika (ask → klasyfikator), czyli bezpieczny kierunek.
  on('tool.check', { tool: PRZENIES }, async (_$, e, next) => zgoda(await next(e), next.origin.plugin, e.ceiling))

  on('command.run', { command: 'na-biegu' }, async $ => {
    let wynik: string
    try {
      const [{ nasza, wszystkie }, s] = await Promise.all([sekcje($), ja($)])
      if (!nasza) return { text: `Na biegu: brak sekcji „${SEKCJA}” w pasku — mod nic nie robi (utwórz ją, żeby włączyć).` }
      if (s.group === undefined) return { text: 'Na biegu: okno aplikacji nie zgłosiło jeszcze grup paska — spróbuj za chwilę.' }
      const odlozone = await sprzataj($, nasza, wszystkie, s)
      const tu = s.pinned ? 'przypięta (mod jej nie rusza)' : s.group?.id === nasza ? 'w sekcji' : 'poza sekcją'
      wynik = `Na biegu: ta sesja ${tu} · sprzątanie teraz: odłożone ${odlozone}`
    } catch (err) {
      wynik = `Na biegu: błąd — ${blad(err)}`
    }
    const ost = ostatni ? ` · ostatnio ${godzina(ostatni.at)}: ${ostatni.co}` : ''
    return { text: `${wynik}${ost}${bladOstatni ? ` · ostatni błąd w tle: ${bladOstatni}` : ''}` }
  })
}
