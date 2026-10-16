// Kontrakt stanu modu kanon-sztafeta (odczyt w $.state sesji; po reloadzie modułu wartości zostają).

/** Ostatni odczyt kontekstu głównego wątku i próg WARN hooka kanon-budzet (ta sama formuła co kanon-pasek-budzetu). */
export type Kontekst = {
  tokens: number
  /** KANON_CTX_WARN albo okno budżetu − 80k (okno ≥ 200k; poniżej − 40k). */
  warn: number
}

/** Plik stanu `~/.claude/kanon/stan/<session_id>.md` — tylko metadane do paska, bez treści. */
export type Plik = {
  mtimeMs: number
  /** Liczba sekcji „## Stan” w pliku. */
  sekcje: number
  /** Godzina z nagłówka ostatniej sekcji („23:37”), a gdy nagłówek jej nie ma — z mtime. */
  czas: string
}

/** Treść panelu /sztafeta: ostatnia sekcja „## Stan” i brief dla nowej sesji (budowane na żądanie, nie co turę). */
export type Widok = {
  /** Linia nagłówka ostatniej sekcji „## Stan”; null, gdy pliku albo sekcji nie ma. */
  naglowek: string | null
  /** Treść sekcji bez nagłówka albo komunikat, czemu jej nie ma. */
  sekcja: string
  brief: string
  sekcje: number
  sciezka: string
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-sztafeta': {
      /** Kompaktacje głównego wątku w tej sesji (bez `precompute`, bez pominiętych). */
      kompaktacje: number
      /** Początek sesji w ms (`$.session.usage().startedAt`, w odwodzie zegar przy session.start); null przed pierwszym startem. */
      start: number | null
      kontekst: Kontekst | null
      plik: Plik | null
      widok: Widok | null
      /** Licznik timera (co 5 min) — sam odczyt przy rysowaniu odświeża wiek sesji na pasku. */
      tyk: number
    }
  }
}
