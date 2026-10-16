// kanon-brief — formularz ram polecenia na start (mod Claude Code, API function hooks 2.1.299; early access). v0.1.
// Z logów 42 transkryptów (plan modów 2026-10-16, §1 i §3.2): 23 z 74 poleceń poniżej 80 znaków, 6 z 17 startów nazywa repo,
// 9 dopytań AskUserQuestion i 7 odpowiedzi „numerami” w osobnych turach, `ops-recall` 3 razy na 17 startów. Odpowiednik modu
// „Prompt Upgrade” z filmu O'Briena, ale BEZ modelu: formularz jest deterministyczny i darmowy — składa polecenie po polsku
// z pól, które właściciel wypełnił (tekst + blok „Ramy:”), i wkłada je do pola promptu (`$.prompt.fill`, tryb `replace`);
// Enter naciska właściciel. „Kopiuj” → schowek (`$.ui.copy`), „Pomiń” → zamyka formularz bez dotykania pola promptu.
// v0.1 (decyzja właściciela 2026-10-16): `prompt.submit` tylko OBSERWUJE — jeden toast na sesję, w turze 1, gdy polecenie z klawiatury
// ma mniej niż 200 znaków; polecenie przechodzi niezmienione. `{ drop }` i przechwycenie Enter dopiero w v0.2 po dwóch tygodniach użycia.
// Pamięć ram per folder w `$.store` (klucz `brief:<cwd>`): repo, stawka, tryb, recall, granice — BEZ tekstu polecenia i bez
// „gotowe, gdy” (to treść zadania, nie folderu; dane modów bez treści rozmów). `/brief wyczysc` kasuje wpis bieżącego folderu.
// Pola tekstowe: każde naciśnięcie klawisza idzie do szkicu w zmiennej modułu (bez przerysowania panelu), Enter w polu zapisuje do
// `$.state` (przerysowanie, podgląd ram); przyciski czytają szkic nad stanem, więc tekst bez Entera też trafia do polecenia.
// Bramki: zero `$.model`, zero `$.http`, bez `tool.check`, bez zapisu plików (`$.fs.list` tylko czyta cwd); jedyny stan między
// sesjami to `$.store`. Hooki zdarzeń mają try/catch i `.catch` → `next(e)`: błąd modu nie zatrzymuje polecenia ani startu sesji.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderSurface } from 'claude-code'

import type { Granice, Ramy, Stawka, Tryb } from '../types'

const PANE = 'brief'
const PROG_TOASTU = 200 // znaków; poniżej — toast w turze 1 (plan §3.2)
const MAX_PODKATALOGOW = 12 // przycisków; dłuższa lista = więcej rzędów niż wart jest formularz (reszta: „+N więcej”)
const POMIJANE_KATALOGI: ReadonlySet<string> = new Set(['node_modules']) // nigdy nie jest „repo”
const WIERSZE_PANELU = 14 // prośba o wysokość inline (silnik i właściciel mogą dać inną)
/** Originy, które NIE są poleceniem wpisanym przez osobę (typy 2.1.299: PromptOrigin). Lista wykluczeń, nie dopuszczeń: nowy albo
 *  niestemplowany origin (starsza binarka, zestaw testowy, kanał bez stempla) liczy się jak osoba — toast u nikogo nie szkodzi,
 *  a brak toastu u osoby psuje sens moda. `sdk` zostaje dopuszczony: tak może przychodzić prompt z aplikacji desktop. */
const NIE_OSOBA: ReadonlySet<string> = new Set([
  'plugin', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel',
  'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'slack-ping',
])

// Skaner walidatora wymaga literałów plugin/key w każdym atomie (nie stałej) — stąd powtórzona nazwa.
const PUSTE_RAMY: Ramy = { repo: '', stawka: null, tryb: null, gotowe: '', recall: false, granice: { produkcja: false, pii: false, push: false } }
const ramy = atom({ plugin: 'kanon-brief', key: 'ramy' } as const, PUSTE_RAMY)
const polecenie = atom({ plugin: 'kanon-brief', key: 'polecenie' } as const, '')
const cwd = atom({ plugin: 'kanon-brief', key: 'cwd' } as const, '')
const podkatalogi = atom({ plugin: 'kanon-brief', key: 'podkatalogi' } as const, [] as string[])
const toast = atom({ plugin: 'kanon-brief', key: 'toast' } as const, false)

const STAWKI: readonly Stawka[] = ['niska', 'istotna', 'wysoka']
const TRYBY: readonly Tryb[] = ['sam', 'subagent', 'workflow']
const GRANICE: readonly { klucz: keyof Granice; opis: string }[] = [
  { klucz: 'produkcja', opis: 'bez zapisu na produkcję' },
  { klucz: 'pii', opis: 'bez PII do gita' },
  { klucz: 'push', opis: 'bez pusha' },
]
export const DOPISEK_WYSOKIEJ = 'analizę oddziel od mutacji, zgoda na każdy zapis'
export const DOPISEK_RECALL = 'najpierw /ops-recall'
export const TOAST_STARTU = 'Krótkie polecenie na start — /brief doda repo, stawkę i kryterium „gotowe”'

export const kluczPamieci = (folder: string) => `brief:${folder}`

/** Linie bloku „Ramy:” — tylko pola wypełnione, w stałej kolejności formularza. */
export const linieRam = (r: Ramy): string[] => {
  const l: string[] = []
  if (r.repo.trim()) l.push(`Repo/folder: ${r.repo.trim()}`)
  if (r.stawka) l.push(`Stawka: ${r.stawka}${r.stawka === 'wysoka' ? ` — ${DOPISEK_WYSOKIEJ}` : ''}`)
  if (r.tryb) l.push(`Tryb: ${r.tryb}`)
  if (r.gotowe.trim()) l.push(`Gotowe, gdy: ${r.gotowe.trim()}`)
  if (r.recall) l.push(`Recall: ${DOPISEK_RECALL}`)
  const g = GRANICE.filter(x => r.granice[x.klucz]).map(x => x.opis)
  if (g.length) l.push(`Granice: ${g.join(', ')}`)
  return l
}

/** Złożone polecenie: tekst, pusta linia, blok ram (tylko wypełnione pola). Sam tekst bez ram, sam blok bez tekstu; '' gdy nic nie ma. */
export const zloz = (tekst: string, r: Ramy): string => {
  const t = tekst.trim()
  const l = linieRam(r)
  if (!l.length) return t
  const blok = ['Ramy:', ...l.map(x => `- ${x}`)].join('\n')
  return t ? `${t}\n\n${blok}` : blok
}

/** Wpis $.store → pola ram; wartości spoza wzorca (ręczna edycja, starsza wersja modu) są pomijane, nie psują formularza. */
const zPamieci = (v: unknown): Partial<Ramy> => {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const r: Partial<Ramy> = {}
  if (typeof o.repo === 'string') r.repo = o.repo
  if (STAWKI.includes(o.stawka as Stawka)) r.stawka = o.stawka as Stawka
  if (TRYBY.includes(o.tryb as Tryb)) r.tryb = o.tryb as Tryb
  if (typeof o.recall === 'boolean') r.recall = o.recall
  const g = o.granice
  if (g && typeof g === 'object') {
    const gg = g as Record<string, unknown>
    r.granice = { produkcja: gg.produkcja === true, pii: gg.pii === true, push: gg.push === true }
  }
  return r
}
/** Co idzie do $.store: ramy folderu bez tekstu polecenia i bez „gotowe, gdy”. */
const doPamieci = (r: Ramy) => ({ repo: r.repo, stawka: r.stawka, tryb: r.tryb, recall: r.recall, granice: r.granice })

// Szkice pól tekstowych między naciśnięciem klawisza a Enterem/przyciskiem (zmienna modułu: reload modu je gubi, stan nie).
type Pole = 'polecenie' | 'repo' | 'gotowe'
// Zmienna modułu = per proces; każda sesja (także desktop) to osobny proces `claude`, więc szkice nie przeciekają między sesjami.
const szkice = new Map<Pole, string>()

/** Wartości pól do złożenia: szkic (tekst wpisany bez Entera) nad stanem. */
async function zebrane($: EngineInterface): Promise<{ tekst: string; r: Ramy }> {
  const [r, p] = await Promise.all([read($, ramy), read($, polecenie)])
  return { tekst: szkice.get('polecenie') ?? p, r: { ...r, repo: szkice.get('repo') ?? r.repo, gotowe: szkice.get('gotowe') ?? r.gotowe } }
}

const otworzPanel = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Brief', focus: true, closeOnEscape: true, rows: WIERSZE_PANELU })

/** `/brief [tekst]`: pola z pamięci folderu (gdy jest) nad pustymi, repo = cwd, podkatalogi z `$.fs.list`; otwiera panel. */
async function otworz($: EngineInterface, tekst: string): Promise<string> {
  const folder = await $.session.cwd()
  let lista: string[] = []
  try {
    // `kind: 'dir'` — dowiązanie symboliczne do katalogu ma `kind: 'other'` i przycisku nie dostaje (ścieżkę wpisuje się ręcznie).
    lista = (await $.fs.list(folder))
      .filter(e => e.kind === 'dir' && !e.name.startsWith('.') && !POMIJANE_KATALOGI.has(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    lista = [] // folder nieczytelny albo zdalny — formularz bez przycisków, repo wpisuje się ręcznie
  }
  const zapis = zPamieci(await $.store.get(kluczPamieci(folder)).catch(() => undefined))
  szkice.clear()
  await update($, cwd, () => folder)
  await update($, podkatalogi, () => lista)
  await update($, ramy, () => ({ ...PUSTE_RAMY, ...zapis, repo: zapis.repo || folder })) // puste repo z pamięci → cwd
  await update($, polecenie, () => tekst)
  await update($, toast, () => true) // kto otworzył /brief, podpowiedzi o /brief nie potrzebuje (także dla polecenia, które mod złoży)
  const o = await otworzPanel($)
  const skad = Object.keys(zapis).length ? ', pola z pamięci folderu' : ''
  return o.isPlaced ? `Formularz ram otwarty (${folder}${skad}).` : `Formularz ram czeka na szersze okno: ${o.reason}`
}

async function zapamietaj($: EngineInterface, r: Ramy): Promise<void> {
  const folder = await read($, cwd)
  if (folder) await $.store.set(kluczPamieci(folder), doPamieci(r))
}

const opisBledu = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** „Uruchom”: złożone polecenie do pola promptu (replace); panel zamknięty PRZED fill, bo otwarty z `focus` trzyma klawiaturę.
 *  Wymaga tekstu polecenia — same ramy (repo domyślnie = cwd) to nie zadanie. `no_composer` (powierzchnia bez pola promptu:
 *  headless albo rysująca własny composer) → od razu schowek; `dialog` albo przyczyna nieznana → panel wraca, „Kopiuj”. */
async function uruchom($: EngineInterface, surface: RenderSurface): Promise<void> {
  let zamkniety = false
  try {
    const { tekst, r } = await zebrane($)
    if (!tekst.trim()) {
      $.ui.toast('Brief: wpisz polecenie — same ramy to nie zadanie')
      return
    }
    const calosc = zloz(tekst, r)
    await zapamietaj($, r)
    await $.ui.close({ id: PANE })
    zamkniety = true
    const f = await $.prompt.fill({ text: calosc, mode: 'replace' })
    if (f.isFilled) {
      $.ui.toast('Brief: polecenie w polu promptu — Enter wysyła')
      return
    }
    if (f.refusal === 'no_composer') {
      const c = await $.ui.copy({ text: calosc, surface })
      $.ui.toast(
        c.isCopied
          ? 'Brief: ta powierzchnia nie ma pola promptu — polecenie w schowku, wklej je'
          : `Brief: ta powierzchnia nie ma pola promptu, a schowek odmówił (${c.reason})`,
        { timeoutMs: 8000 },
      )
      return
    }
    await otworzPanel($) // stan został, formularz wraca wypełniony
    $.ui.toast(
      f.refusal === 'dialog'
        ? 'Brief: okno dialogowe trzyma klawiaturę — zamknij je albo użyj „Kopiuj”'
        : 'Brief: pole promptu nie przyjęło tekstu — użyj „Kopiuj”',
      { timeoutMs: 8000 },
    )
  } catch (err) {
    $.ui.toast(`Brief: błąd — ${opisBledu(err)}; użyj „Kopiuj”`, { timeoutMs: 8000 })
    if (zamkniety) await otworzPanel($).catch(() => undefined)
  }
}

async function kopiuj($: EngineInterface, surface: RenderSurface): Promise<void> {
  try {
    const { tekst, r } = await zebrane($)
    const calosc = zloz(tekst, r)
    if (!calosc) {
      $.ui.toast('Brief: nic do skopiowania — wpisz polecenie albo zaznacz pola')
      return
    }
    await zapamietaj($, r)
    const c = await $.ui.copy({ text: calosc, surface })
    $.ui.toast(c.isCopied ? 'Brief: polecenie w schowku' : `Brief: schowek nie przyjął tekstu (${c.reason})`)
  } catch (err) {
    $.ui.toast(`Brief: błąd kopiowania — ${opisBledu(err)}`, { timeoutMs: 8000 })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brief',
      description: 'Formularz ram polecenia: repo/folder, stawka, tryb, „gotowe, gdy”, recall, granice → składa polecenie i wkłada do pola promptu; „wyczysc” kasuje pamięć folderu',
      argumentHint: '[tekst polecenia|wyczysc|zamknij]',
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // v0.1: obserwacja. Toast raz na sesję, gdy pierwsze polecenie osoby (origin spoza NIE_OSOBA) jest krótkie; komendy slash,
  // prompty meta, pluginów, peerów i sesja wznowiona (turns > 0) — cisza. `next(e)` zawsze z niezmienionym `e`.
  on('prompt.submit', async ($, e, next) => {
    try {
      // Czyje polecenie: plugin, peer, notyfikacja zadania, harmonogram, kanał — nie osoba (NIE_OSOBA); reszta tak.
      const kind = (e.origin as PromptOrigin | undefined)?.kind
      const zKlawiatury = kind === undefined || !NIE_OSOBA.has(kind)
      const t = e.text.trim()
      if (zKlawiatury && !e.command && !e.isMeta && t.length > 0 && t.length < PROG_TOASTU && !t.startsWith('/')) {
        if (!(await read($, toast)) && (await $.session.turns()) === 0) {
          await update($, toast, () => true)
          $.ui.toast(TOAST_STARTU, { timeoutMs: 8000 })
        }
      }
    } catch {
      // obserwator: błąd odczytu nie dotyka polecenia
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Hook odpowiada za własną komendę; try/catch, bo hook, który się wysypie, silnik pomija (komenda bez odpowiedzi).
  on('command.run', { command: 'brief' }, async ($, e) => {
    try {
      const arg = e.args.trim()
      const a = arg.toLowerCase()
      if (a === 'wyczysc' || a === 'wyczyść') {
        const folder = await $.session.cwd()
        await $.store.delete(kluczPamieci(folder))
        await $.ui.close({ id: PANE }) // otwarty formularz zapisałby wpis z powrotem przy „Uruchom”
        return { text: `Pamięć ram folderu ${folder} wyczyszczona.` }
      }
      if (a === 'zamknij') {
        await $.ui.close({ id: PANE })
        return { text: 'Formularz ram zamknięty.' }
      }
      return { text: await otworz($, arg) }
    } catch (err) {
      return { text: `Brief: błąd modu — ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      // Tabela elementów aplikacji mobilnej nie ma `Input` (typy 2.1.299) — formularz bez pól tekstowych nie ma sensu.
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text dimColor>Formularz /brief wymaga pól tekstowych, których aplikacja mobilna nie rysuje — użyj go na desktopie albo w terminalu.</Text>
        </Box>
      )
    }
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const [r, p, folder, lista] = await Promise.all([read($, ramy), read($, polecenie), read($, cwd), read($, podkatalogi)])
    const tekst = szkice.get('polecenie') ?? p
    const repo = szkice.get('repo') ?? r.repo
    const gotowe = szkice.get('gotowe') ?? r.gotowe
    const podglad = linieRam({ ...r, repo, gotowe })
    const radio = (wl: boolean) => (wl ? '(•)' : '( )')
    const krzyzyk = (wl: boolean) => (wl ? '[x]' : '[ ]')
    const zapiszTekst = (v: string) => {
      szkice.delete('polecenie')
      void update($, polecenie, () => v)
    }
    const zapiszPole = (pole: 'repo' | 'gotowe') => (v: string) => {
      szkice.delete(pole)
      void update($, ramy, x => ({ ...x, [pole]: v }))
    }

    // Wiersze zawijają się (`flexWrap`), bo w terminalu panel bywa wąską kolumną (~50 znaków, próba 2026-10-16); `columnGap`
    // zamiast `gap`, bo `gap` dokłada pusty wiersz między zawiniętymi rzędami.
    return (
      <Box flexDirection="column">
        <Text bold>Brief — ramy polecenia na start</Text>
        <Input
          key="polecenie"
          label="Polecenie"
          placeholder="co ma być zrobione"
          value={tekst}
          submitLabel="zapisz"
          onInput={v => szkice.set('polecenie', v)}
          onSubmit={zapiszTekst}
        />
        <Input key="repo" label="Repo/folder" value={repo} submitLabel="zapisz" onInput={v => szkice.set('repo', v)} onSubmit={zapiszPole('repo')} />
        {lista.length > 0 && (
          <Box columnGap={1} flexWrap="wrap">
            <Text dimColor>podkatalogi:</Text>
            {lista.slice(0, MAX_PODKATALOGOW).map(n => (
              <Button
                key={`kat-${n}`}
                plain
                dimColor
                label={n}
                onPress={() => {
                  szkice.delete('repo')
                  void update($, ramy, x => ({ ...x, repo: `${folder}/${n}` }))
                }}
              />
            ))}
            {lista.length > MAX_PODKATALOGOW && <Text dimColor>{`+${lista.length - MAX_PODKATALOGOW} więcej — wpisz ścieżkę`}</Text>}
          </Box>
        )}
        <Box columnGap={1} flexWrap="wrap">
          <Text>Stawka:</Text>
          {STAWKI.map(s => (
            <Button key={`stawka-${s}`} plain label={`${radio(r.stawka === s)} ${s}`} onPress={() => update($, ramy, x => ({ ...x, stawka: x.stawka === s ? null : s }))} />
          ))}
          {r.stawka === 'wysoka' && <Text dimColor>{`→ ${DOPISEK_WYSOKIEJ}`}</Text>}
        </Box>
        <Box columnGap={1} flexWrap="wrap">
          <Text>Tryb:</Text>
          {TRYBY.map(t => (
            <Button key={`tryb-${t}`} plain label={`${radio(r.tryb === t)} ${t}`} onPress={() => update($, ramy, x => ({ ...x, tryb: x.tryb === t ? null : t }))} />
          ))}
        </Box>
        <Input
          key="gotowe"
          label="Gotowe, gdy"
          placeholder="kryterium sprawdzalne komendą albo w aplikacji"
          value={gotowe}
          submitLabel="zapisz"
          onInput={v => szkice.set('gotowe', v)}
          onSubmit={zapiszPole('gotowe')}
        />
        <Box columnGap={1} flexWrap="wrap">
          <Button key="recall" plain label={`${krzyzyk(r.recall)} ${DOPISEK_RECALL}`} onPress={() => update($, ramy, x => ({ ...x, recall: !x.recall }))} />
        </Box>
        <Box columnGap={1} flexWrap="wrap">
          <Text>Granice:</Text>
          {GRANICE.map(g => (
            <Button
              key={`granica-${g.klucz}`}
              plain
              label={`${krzyzyk(r.granice[g.klucz])} ${g.opis}`}
              onPress={() => update($, ramy, x => ({ ...x, granice: { ...x.granice, [g.klucz]: !x.granice[g.klucz] } }))}
            />
          ))}
        </Box>
        <Box columnGap={1} flexWrap="wrap">
          <Button key="uruchom" variant="primary" label="Uruchom" onPress={press => uruchom($, press.surface)} />
          <Button key="kopiuj" label="Kopiuj" onPress={press => kopiuj($, press.surface)} />
          <Button key="pomin" role="dismiss" label="Pomiń" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor>{podglad.length ? `ramy: ${podglad.join(' · ')}` : 'ramy: nic nie zaznaczono — Enter w polu tekstowym odświeża podgląd'}</Text>
      </Box>
    )
  })
}
