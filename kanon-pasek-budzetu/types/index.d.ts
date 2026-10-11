// Kontrakt stanu modu kanon-pasek-budzetu (odczyt w $.state sesji; po reloadzie modułu wartości zostają).
export type Odczyt = {
  /** Tokeny kontekstu z $.session.usage() (context.tokens, w odwodzie percent × okno modelu). */
  tokens: number
  /** Okno BUDŻETU (próg auto-kompaktacji): env CLAUDE_CODE_AUTO_COMPACT_WINDOW → settings → okno modelu z silnika. */
  okno: number
  /** Okno modelu, jakie podał silnik (context.window) — do porównania, gdy budżet jest mniejszy. */
  oknoModelu: number
  /** Próg ostrzeżenia hooka kanon-budzet: KANON_CTX_WARN albo okno − 80k (okno ≥ 200k; poniżej − 40k). */
  warn: number
  /** Spodziewany punkt auto-kompaktacji ≈ okno − 20k (mediana pomiaru 78 kompaktacji, 2026-09-25). */
  kompaktacja: number
  zrodlo: 'env' | 'settings' | 'silnik'
}

/** Okna limitów konta i koszt sesji — z `rateLimits`/`cost` w $.session.usage() albo w zdarzeniu session.measure. */
export type Limity = {
  /** Okno 5 h: procent zużycia (0–100, jedno miejsce po przecinku) z ostatniej odpowiedzi API; null poza subskrypcją albo przed 1. odczytem. */
  p5h: number | null
  /** Reset okna 5 h, ISO 8601; null, gdy silnik go nie podał. */
  reset5h: string | null
  /** Okno 7 dni (limit tygodniowy — ten z raportu usage-report-weekly). */
  p7d: number | null
  reset7d: string | null
  /** Koszt sesji w USD, jak liczy /cost; null, gdy host nie prowadzi księgi. */
  usd: number | null
}

/** Ostatnie żądanie głównego wątku (turn.step bez agentId) — model, który ODPOWIEDZIAŁ, i jego tokeny. */
export type Krok = {
  model: string
  /** Tokeny wejścia razem: niecache + zapis cache + odczyt cache. */
  wejscie: number
  /** Z tego odczyt z cache (cache_read_input_tokens). */
  cache: number
  wyjscie: number
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-pasek-budzetu': {
      odczyt: Odczyt | null
      limity: Limity | null
      krok: Krok | null
      ukryty: boolean
      /** Toast WARN kontekstu już pokazany w tym cyklu kompaktacji. */
      ostrzezono: boolean
      /** Toast o limicie konta (5h/7d ≥ próg czerwony) już pokazany; zeruje się, gdy odczyt spadnie poniżej. */
      ostrzezonoLimit: boolean
    }
  }
}
