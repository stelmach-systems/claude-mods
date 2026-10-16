// Kontrakt stanu modu kanon-skrzynka ($.state sesji; po reloadzie modułu wartości zostają, zmienne modułu startują od nowa).
// Między sesjami żyje tylko $.store (klucz `skrzynka:<pełna ścieżka>` → `{ kiedy, sid }`): oznaczenie „przeczytane”, bez treści.
export type Zrodlo = 'watch' | 'usage' | 'stan'

/** Jedna pozycja „do przeczytania”. Nigdy nie niesie treści pliku — tylko nazwę, ścieżkę, datę i linię nagłówka. */
export type Pozycja = {
  zrodlo: Zrodlo
  /** Klucz elementów panelu (litery, cyfry, `-`): `watch-2026-10-16`, `usage-2026-10-15`, `stan-9f9dcef8`. */
  id: string
  /** Pełna ścieżka pliku — klucz `$.store` `skrzynka:<sciezka>` i tekst „wczytaj <sciezka>” do pola promptu. */
  sciezka: string
  /** Nazwa pliku bez `.md` — po niej obserwator `prompt.submit` poznaje polecenie „wczytaj …”. */
  plik: string
  /** Krótka nazwa: `WATCH-10-16`, `USAGE-10-15`, `stan 9f9dcef8`. */
  nazwa: string
  /** Tekst pozycji na pasku: `WATCH-10-16 (ROZWAŻ)`, `🔴 USAGE-10-09 (2 dni 45 %)`, `stan 9f9dcef8 (16.10)`. */
  etykieta: string
  /** Nagłówek do panelu: linia WERDYKT bez gwiazdek, podsumowanie USAGE, linia `## Stan …` bez `## ` — nigdy treść. */
  naglowek: string
  /** mtime pliku z `$.fs.list` (ms). */
  mtimeMs: number
  /** USAGE z udziałem ostatnich 2 dni > 40 % okna 7 dni. */
  alarm: boolean
}

export type Skrzynka = {
  /** Nieprzeczytane, w kolejności źródeł watch → usage → stan, w źródle od najnowszego. */
  pozycje: Pozycja[]
  /** Czas ostatniego skanu (`$.clock.now()`); null przed pierwszym. */
  odczyt: number | null
  /** Błąd ostatniego skanu (brak HOME, odrzucony zapis stanu); null po udanym. Brak katalogu albo pliku to nie błąd. */
  blad: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-skrzynka': {
      skrzynka: Skrzynka
    }
  }
}
