// kanon-pasek-budzetu — pasek budżetu nad promptem (mod Claude Code, API function hooks 2.1.293; early access). v0.2.
// Liczby: $.session.usage() (context.tokens / percent / window, rateLimits 5h/7d, cost.usd — wywołanie bez breakdown jest darmowe)
// oraz zdarzenie session.measure (te same liczby PCHANE przez silnik po każdej turze głównego wątku i gdy okno limitu ruszy o punkt).
// Okno BUDŻETU = env CLAUDE_CODE_AUTO_COMPACT_WINDOW (ma pierwszeństwo, jak w kanonie) → settings.autoCompactWindow →
// settings.modelSettings[<model sesji>].autoCompactWindow → okno modelu z silnika. Progi jak hook Stop `kanon-budzet`:
// WARN = KANON_CTX_WARN albo okno − 80k (okno ≥ 200k; poniżej − 40k); kompaktacja ≈ okno − 20k (mediana pomiaru 2026-09-25).
// Różnica wobec hooka: mod nie czyta transkryptu, więc nie obniża WARN do mediany realnych punktów kompaktacji sesji —
// pasek jest podglądem, hook Stop pozostaje źródłem bloku i progu obowiązującego.
// Ostatnie żądanie głównego wątku (turn.step bez agentId): model, który odpowiedział, i udział cache — prawda z usage, nie z aliasu.
// Log zużycia (D4 planu modów 2026-10-10): po każdej turze głównego wątku jedna linia JSONL z SAMYMI LICZBAMI (model, tokeny,
// kontekst, limity, koszt) do ~/.claude/kanon/usage/sesje/sesja-<session_id>.jsonl — bez treści promptów ani odpowiedzi.
// KANON_USAGE_LOG=0 wyłącza. To jedyny zapis na dysk; poza nim mod trzyma tylko stan sesji ($.state), nie używa sieci, nie zmienia
// ani nie zatwierdza wywołań narzędzi (tool.call służy wyłącznie do odświeżenia odczytu PO `next`). /budzet [ukryj|pokaz].
// Pomiary z session.measure i z turn.complete mogą biec równocześnie — `zastosuj` idzie przez kolejkę modułu, żeby flagi toastów
// i para odczyt/limity nie przeplatały się (recenzja 2026-10-10).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCost, SessionRateLimit, SessionUsage, TurnCompleteInput } from 'claude-code'

import type { Krok, Limity, Odczyt } from '../types'

// Skaner walidatora wymaga literałów plugin/key w każdym atomie (nie stałej) — stąd powtórzona nazwa.
const odczyt = atom({ plugin: 'kanon-pasek-budzetu', key: 'odczyt' } as const, null)
const limity = atom({ plugin: 'kanon-pasek-budzetu', key: 'limity' } as const, null)
const krok = atom({ plugin: 'kanon-pasek-budzetu', key: 'krok' } as const, null)
const ukryty = atom({ plugin: 'kanon-pasek-budzetu', key: 'ukryty' } as const, false)
const ostrzezono = atom({ plugin: 'kanon-pasek-budzetu', key: 'ostrzezono' } as const, false)
const ostrzezonoLimit = atom({ plugin: 'kanon-pasek-budzetu', key: 'ostrzezonoLimit' } as const, false)

const CO_ILE_NARZEDZI = 5 // odświeżenie w trakcie tury co tyle wywołań narzędzi (poza tym po każdej turze, pomiarze i kompaktacji)
// Progi kolorów okien limitu — DOMYŚLNE, bez pomiaru (raport tygodniowy: 🔴 gdy 2 dni > 40 % okna 7 dni).
const PROGI = { p5h: { warn: 70, error: 90 }, p7d: { warn: 50, error: 80 } }
const LIMIT_LOGU = 2 * 1024 * 1024 // bajtów; powyżej mod przestaje dopisywać (jeden toast) — $.fs.read odmawia od 4 MiB

const k = (n: number) => `${Math.round(n / 1000)}k`
const liczba = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

// Kolejka modułu: pomiary (measure / turn.complete / tool.call) wykonują się po kolei, nie przeplatają flag ani atomów.
let kolejka: Promise<unknown> = Promise.resolve()
const szereguj = <T,>(f: () => Promise<T>): Promise<T> => {
  const p = kolejka.then(f, f)
  kolejka = p.catch(() => undefined)
  return p
}

async function oknoBudzetu($: EngineInterface, oknoModelu: number): Promise<Pick<Odczyt, 'okno' | 'zrodlo'>> {
  const zEnv = liczba(await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'))
  if (zEnv) return { okno: zEnv, zrodlo: 'env' }
  const ustawienia = await $.settings.read()
  const zSettings = liczba(ustawienia.autoCompactWindow)
  if (zSettings) return { okno: zSettings, zrodlo: 'settings' }
  const model = await $.session.model()
  const perModel = ustawienia.modelSettings as Record<string, { autoCompactWindow?: unknown } | undefined> | undefined
  const zModelu = liczba(perModel?.[model]?.autoCompactWindow)
  if (zModelu) return { okno: zModelu, zrodlo: 'settings' }
  return { okno: oknoModelu, zrodlo: 'silnik' }
}

type Pomiar = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>
type Wynik = { o: Odczyt | null; l: Limity | null }

const okno = (r: SessionRateLimit[], kind: string) => r.find(x => x.kind === kind)
const limityZ = (r: SessionRateLimit[], cost: SessionCost | undefined): Limity => {
  const a = okno(r, 'five_hour')
  const b = okno(r, 'seven_day')
  return { p5h: a?.percentUsed ?? null, reset5h: a?.resetsAt ?? null, p7d: b?.percentUsed ?? null, reset7d: b?.resetsAt ?? null, usd: cost?.usd ?? null }
}
const poziom = (p: number | null, progi: { warn: number; error: number }) => (p === null ? 'brak' : p >= progi.error ? 'error' : p >= progi.warn ? 'warning' : 'ok')
const kolorLimitow = (l: Limity): 'error' | 'warning' | 'success' => {
  const a = poziom(l.p5h, PROGI.p5h)
  const b = poziom(l.p7d, PROGI.p7d)
  return a === 'error' || b === 'error' ? 'error' : a === 'warning' || b === 'warning' ? 'warning' : 'success'
}
const resetZa = (iso: string | null, teraz: number): string => {
  const ms = iso ? Date.parse(iso) - teraz : NaN
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const min = Math.ceil(ms / 60_000)
  const h = Math.floor(min / 60)
  const m = min % 60
  return h >= 48 ? `reset za ${Math.floor(h / 24)} d ${h % 24} h` : h >= 1 ? `reset za ${h} h ${m} min` : `reset za ${m} min`
}
const procent = (p: number | null) => (p === null ? '—' : `${p} %`)

/** Zastosuj pomiar (z $.session.usage() albo z session.measure): limity, koszt, kontekst; toasty przy pierwszym przekroczeniu. */
const zastosuj = ($: EngineInterface, u: Pomiar): Promise<Wynik> => szereguj(() => zastosujTeraz($, u))

async function zastosujTeraz($: EngineInterface, u: Pomiar): Promise<Wynik> {
  const l = limityZ(u.rateLimits, u.cost)
  await update($, limity, () => l)
  const czerwone = poziom(l.p5h, PROGI.p5h) === 'error' || poziom(l.p7d, PROGI.p7d) === 'error'
  if (czerwone) {
    if (!(await read($, ostrzezonoLimit))) {
      await update($, ostrzezonoLimit, () => true)
      $.ui.toast(`Limit konta: 5h ${procent(l.p5h)} · 7d ${procent(l.p7d)} — ciężkie zadania (fan-out, Fable) odłóż za reset okna`, { timeoutMs: 15_000 })
    }
  } else if (await read($, ostrzezonoLimit)) {
    await update($, ostrzezonoLimit, () => false)
  }

  const { tokens: zSilnika, percent, window: oknoModelu } = u.context
  const tokens = zSilnika ?? (percent != null ? Math.round((percent / 100) * oknoModelu) : null)
  if (tokens === null) return { o: null, l }
  const { okno: oknoB, zrodlo } = await oknoBudzetu($, oknoModelu)
  const warn = liczba(await $.env.get('KANON_CTX_WARN')) ?? (oknoB >= 200_000 ? oknoB - 80_000 : oknoB - 40_000)
  const o: Odczyt = { tokens, okno: oknoB, oknoModelu, warn, kompaktacja: oknoB - 20_000, zrodlo }
  await update($, odczyt, () => o)

  if (tokens >= warn) {
    if (!(await read($, ostrzezono))) {
      await update($, ostrzezono, () => true)
      const sid = await $.session.id()
      $.ui.toast(`Kontekst ${k(tokens)} ≥ WARN ${k(warn)} — dopisz „## Stan” (zrobione / dalej / decyzje) do ~/.claude/kanon/stan/${sid}.md`, {
        timeoutMs: 15_000,
      })
    }
  } else if (await read($, ostrzezono)) {
    await update($, ostrzezono, () => false) // kontekst spadł bez session.compact (/clear, wznowienie) — następne WARN znów ostrzeże
  }
  return { o, l }
}

const odswiez = async ($: EngineInterface): Promise<Wynik> => zastosuj($, await $.session.usage())

// Hooki bramkujące nie mogą paść przez odczyt budżetu — błąd = brak odświeżenia, a log dostaje null zamiast starych liczb.
const odswiezBezpiecznie = ($: EngineInterface): Promise<Wynik> => odswiez($).catch(() => ({ o: null, l: null }))

let logPelny = false // toast o pełnym logu raz na życie modułu

/** D4: jedna linia JSONL na turę głównego wątku — same liczby i model, bez treści. Liczby z TEGO odświeżenia (null, gdy padło). */
async function dopiszLog($: EngineInterface, e: TurnCompleteInput, { o, l }: Wynik): Promise<void> {
  if ((await $.env.get('KANON_USAGE_LOG')) === '0') return
  const home = await $.env.get('HOME')
  const u = e.usage
  if (!home || !u) return // bez HOME nie ma gdzie; bez usage nic nie policzono (przerwanie, błąd API)
  const [sid, teraz] = await Promise.all([$.session.id(), $.clock.now()])
  const sciezka = `${home}/.claude/kanon/usage/sesje/sesja-${sid}.jsonl`
  const linia = JSON.stringify({
    t: new Date(teraz).toISOString(),
    sid,
    turn: e.turnId,
    reason: e.reason,
    ms: e.durationMs,
    model: u.model,
    in: u.input_tokens,
    cache_write: u.cache_creation_input_tokens,
    cache_read: u.cache_read_input_tokens,
    out: u.output_tokens,
    ctx: o?.tokens ?? null,
    p5h: l?.p5h ?? null,
    p7d: l?.p7d ?? null,
    usd: l?.usd ?? null, // koszt sesji NARASTAJĄCO (cost.usd), nie koszt tury — różnica kolejnych linii = koszt tury
  })
  // Brak pliku = pusta historia; KAŻDY inny błąd stat/read leci wyżej i nic nie jest pisane — historia nie może zostać nadpisana.
  let stare = ''
  if (await $.fs.exists(sciezka)) {
    const st = await $.fs.stat(sciezka)
    if (st.size > LIMIT_LOGU) {
      if (!logPelny) {
        logPelny = true
        $.ui.toast(`Log zużycia przekroczył ${k(LIMIT_LOGU)} B — mod przestał dopisywać: ${sciezka}`, { timeoutMs: 15_000 })
      }
      return
    }
    stare = String(await $.fs.read(sciezka))
    if (stare && !stare.endsWith('\n')) stare += '\n' // ręczna edycja / przerwany zapis nie skleja dwóch rekordów
  }
  await $.fs.write(sciezka, `${stare}${linia}\n`)
}

const opisKontekstu = (o: Odczyt) =>
  `Kontekst: ${k(o.tokens)} / ${k(o.okno)} (${Math.round((o.tokens / o.okno) * 100)} %) · WARN ${k(o.warn)} · kompaktacja ~${k(o.kompaktacja)}` +
  ` · okno budżetu z: ${o.zrodlo}${o.okno !== o.oknoModelu ? ` (okno modelu ${k(o.oknoModelu)})` : ''}`
const opisLimitow = (l: Limity | null, teraz: number) => {
  if (!l || (l.p5h === null && l.p7d === null && l.usd === null)) return 'Limity: brak odczytu (poza subskrypcją albo przed pierwszą odpowiedzią API)'
  const r5 = resetZa(l.reset5h, teraz)
  const r7 = resetZa(l.reset7d, teraz)
  return (
    `Limity: 5h ${procent(l.p5h)}${r5 ? ` (${r5})` : ''} · 7d ${procent(l.p7d)}${r7 ? ` (${r7})` : ''}` +
    (l.usd !== null ? ` · koszt sesji $${l.usd.toFixed(2)}` : '')
  )
}
const opisKroku = (s: Krok | null) =>
  s
    ? `Ostatnie żądanie: ${s.model} · ${k(s.wejscie)} in (${k(s.cache)} z cache = ${s.wejscie ? Math.round((s.cache / s.wejscie) * 100) : 0} %) · ${k(s.wyjscie)} out`
    : 'Ostatnie żądanie: brak kroku głównego wątku od załadowania modu'

export const register: Register = on => {
  let narzedzia = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'budzet',
      description: 'Budżet: kontekst, limity 5h/7d, koszt sesji, model i cache ostatniego żądania; „ukryj” / „pokaz” steruje paskiem',
      argumentHint: '[ukryj|pokaz]',
    })
    const r = await next(e)
    await odswiezBezpiecznie($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // tury agentów liczy kanon-agenci; pasek i log dotyczą głównego wątku
    narzedzia = 0
    const w = await odswiezBezpiecznie($)
    try {
      await dopiszLog($, e, w)
    } catch {
      // log jest pomocniczy: błąd dysku nie dotyka tury i nie nadpisuje historii
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (!e.agentId && r.usage) {
      const u = r.usage
      try {
        await update($, krok, () => ({
          model: u.model,
          wejscie: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
          cache: u.cache_read_input_tokens,
          wyjscie: u.output_tokens,
        }))
      } catch {
        // obserwator
      }
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await zastosuj($, e).catch(() => null)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    narzedzia += 1
    if (narzedzia % CO_ILE_NARZEDZI === 0) await odswiezBezpiecznie($)
    return r
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    await update($, ostrzezono, () => false).catch(() => undefined)
    await odswiezBezpiecznie($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'budzet' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'ukryj') {
      await update($, ukryty, () => true)
      return { text: 'Pasek budżetu ukryty do końca sesji („/budzet pokaz” przywraca).' }
    }
    if (arg === 'pokaz') await update($, ukryty, () => false)
    const { o } = await odswiezBezpiecznie($)
    const [l, s, teraz] = await Promise.all([read($, limity), read($, krok), $.clock.now()])
    return {
      text: [o ? opisKontekstu(o) : 'Kontekst: brak odczytu (silnik nie podał liczby tokenów ani procentu).', opisLimitow(l, teraz), opisKroku(s)].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const o = await read($, odczyt)
    const cicho = e.props.hasSurvey || e.props.maxRows < 1 || o === null || (await read($, ukryty))
    if (cicho) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, limity)
    const szerokie = e.props.bodyColumns >= 110
    const szerokosc = Math.max(10, Math.min(szerokie ? 30 : 16, Math.floor(e.props.bodyColumns / 5)))
    const pelne = Math.max(0, Math.min(szerokosc, Math.round((o.tokens / o.okno) * szerokosc)))
    const pasek = '█'.repeat(pelne) + '░'.repeat(szerokosc - pelne)
    const kolor = o.tokens >= o.kompaktacja ? 'error' : o.tokens >= o.warn ? 'warning' : 'success'
    const liczby = `${k(o.tokens)} / ${k(o.okno)} (${Math.round((o.tokens / o.okno) * 100)} %)`
    const progi = `WARN ${k(o.warn)} · kompaktacja ~${k(o.kompaktacja)}`
    const maLimity = l !== null && (l.p5h !== null || l.p7d !== null)

    return (
      <Box gap={1}>
        <Text color={kolor}>{pasek}</Text>
        <Text bold={o.tokens >= o.warn}>{liczby}</Text>
        {szerokie && <Text dimColor>{progi}</Text>}
        {maLimity && <Text color={kolorLimitow(l)}>{`5h ${procent(l.p5h)} · 7d ${procent(l.p7d)}`}</Text>}
        {szerokie && l?.usd != null && <Text dimColor>{`$${l.usd.toFixed(2)}`}</Text>}
        <Button key="ukryj" label="Ukryj" onPress={() => update($, ukryty, () => true)} />
      </Box>
    )
  })
}
