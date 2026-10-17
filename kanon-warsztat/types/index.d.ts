// Kontrakt stanu modu kanon-warsztat ($.state sesji; po reloadzie modułu wartości zostają, zmienne modułu startują od nowa).
// Między sesjami nic nie żyje: mod nie używa $.store ani plików.

/** Binarka kroku: CLI `~/.local/bin/claude`, binarka desktopu z ~/Library/Application Support/Claude/claude-code/, `node tsc.js`. */
export type Binarka = 'cli' | 'desktop' | 'tsc'
export type RodzajKroku = 'validate' | 'test' | 'tsc'
/** `czeka` → `biegnie` → `ok` | `fail` | `timeout`; `brak` od razu, gdy binarki nie ma (nie jest błędem). */
export type StanKroku = 'czeka' | 'biegnie' | 'ok' | 'fail' | 'timeout' | 'brak'

export type Krok = {
  /** Klucz elementów panelu: `cli-validate`, `cli-test`, `desktop-validate`, `desktop-test`, `tsc`. */
  id: string
  binarka: Binarka
  /** Etykieta kolumny binarki: `CLI`, `desktop 2.1.299`, `tsc`. */
  etykieta: string
  krok: RodzajKroku
  /** Pełne argv przekazane do `$.process.run` (bez shella); `[]` gdy binarki brak. */
  argv: string[]
  stan: StanKroku
  /** Czas kroku w ms (`$.clock.now()` przed i po); null, dopóki nie skończył. */
  ms: number | null
  /** Z wyjścia `claude plugin test`: ` N pass` / ` N fail`; null dla validate, tsc i gdy podsumowania nie ma. */
  testy: { pass: number; fail: number } | null
  /** Jedna linia do tabeli: `Validation passed`, `12 pass`, `10 pass, 2 fail (kod 1)`, `przekroczone 120 s`, `brak binarki …`. */
  szczegoly: string
}

export type Warsztat = {
  /** Katalog modu ostatniego biegu (bezwzględny, bez końcowego `/`); null przed pierwszym. */
  katalog: string | null
  kroki: Krok[]
  /** `$.clock.now()` startu i końca biegu; `koniec` null w trakcie. */
  start: number | null
  koniec: number | null
  /** Błąd modu poza krokami (odrzucony zapis stanu, wyjątek pętli); null, gdy go nie było. */
  blad: string | null
  wToku: boolean
}

/** Jeden wpis indeksu d.ts: nazwa (`tool.call`, `$.fs.list`, `$.fs`, `SessionUsage`), rodzaj, blok i linie (1-based, włącznie). */
export type Wpis = {
  nazwa: string
  rodzaj: 'zdarzenie' | 'metoda' | 'rzeczownik' | 'typ'
  /** Zdarzenie: nazwa bloku (`EngineEventOf`, `EngineResultOf`, `OpEventOf`, `OpValueOf`, `ChunkOf`); metoda/rzeczownik: `CoreEngineInterface`;
   *  typ: `<słowo> · <moduł>` (np. `type · claude-code`, `const · claude-code/testing`). */
  blok: string
  od: number
  do: number
  /** Pierwsza linia JSDoc stojącego bezpośrednio nad deklaracją; null, gdy go nie ma. */
  docOd: number | null
}

/** Indeks pliku typów; ważny, dopóki wersja parsera, ścieżka, mtime i liczba linii się zgadzają (tekst pliku żyje tylko w pamięci modułu). */
export type Indeks = {
  /** `WERSJA_INDEKSU` modułu, który go zbudował — po zmianie regexów stary indeks z `$.state` nie przeżywa hot-reloadu. */
  wersja: number
  sciezka: string
  mtimeMs: number
  linii: number
  wpisy: Wpis[]
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-warsztat': {
      warsztat: Warsztat
      indeks: Indeks | null
    }
  }
}
