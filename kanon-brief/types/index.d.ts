// Kontrakt stanu modu kanon-brief ($.state sesji; po reloadzie modułu wartości zostają, zmienne modułu startują od nowa).
// Między sesjami żyje tylko $.store (klucz `brief:<cwd>`): ramy folderu bez tekstu polecenia i bez „gotowe, gdy”.
export type Stawka = 'niska' | 'istotna' | 'wysoka'
export type Tryb = 'sam' | 'subagent' | 'workflow'
/** Granice zadania — każda to jedna linia bloku ram, gdy zaznaczona. */
export type Granice = { produkcja: boolean; pii: boolean; push: boolean }
/** Pola formularza poza tekstem polecenia. Pole puste (''/null/false) nie trafia do bloku ram. */
export type Ramy = {
  /** Repo albo folder zadania; domyślnie `$.session.cwd()`, przyciski podkatalogów podstawiają `<cwd>/<nazwa>`. */
  repo: string
  stawka: Stawka | null
  tryb: Tryb | null
  /** Kryterium „gotowe, gdy” — treść zadania, nie folderu: nie idzie do $.store. */
  gotowe: string
  /** Dopisek „najpierw /ops-recall”. */
  recall: boolean
  granice: Granice
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-brief': {
      /** Pola formularza; przy `/brief` start z $.store[`brief:<cwd>`] (gdy jest) nad pustymi. */
      ramy: Ramy
      /** Tekst polecenia z pola formularza albo z argumentu `/brief <tekst>`; nigdy do $.store. */
      polecenie: string
      /** Folder sesji przy ostatnim `/brief` — klucz pamięci i baza dla podkatalogów. */
      cwd: string
      /** Podkatalogi pierwszego poziomu cwd (`$.fs.list`, bez ukrytych, najwyżej 12) — przyciski „Repo/folder”. */
      podkatalogi: string[]
      /** Toast o krótkim poleceniu startowym już pokazany w tej sesji (raz na sesję, także po reloadzie modu). */
      toast: boolean
    }
  }
}
