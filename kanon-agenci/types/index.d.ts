// Kontrakt stanu modu kanon-agenci ($.state sesji; po reloadzie modułu wartości zostają, zmienne modułu startują od nowa).
export type Wiersz = {
  /** Id pętli agenta: `agent.spawn` → `agentId`, to samo niosą `turn.step`/`tool.call`/`turn.complete` i `$.agent.list()`. */
  id: string
  /** Opis zadania z wywołania Agent (`description`) — tu siedzi deklarowany tag `[S5.5MD]`. Z listy, póki spawn nie dopisze swojego. */
  opis: string
  /** Typ agenta (`subagentType`): czytelnik, sceptyk, general-purpose, Explore… */
  typ: string
  /** Kod modelu z tagu w opisie (S5.5, OP5.5, F5.1…) albo null, gdy opis tagu nie ma. */
  tag: string | null
  /** Model, jaki silnik rozstrzygnął przy starcie (`AgentSpawnResult.model`); null, póki spawnu mod nie widział. */
  modelZadany: string | null
  /** Model, który ODPOWIEDZIAŁ w ostatnim policzonym kroku (`TurnStepResult.usage.model`); null bez żadnej odpowiedzi. */
  model: string | null
  /** Liczba żądań do modelu widzianych przez mod — tylko kroki z odpowiedzią (`usage` nie-null). */
  kroki: number
  /** Liczba wywołań narzędzi, o które poprosiły odpowiedzi (`toolUses.length` policzonych kroków). */
  narzedzia: number
  /** Tokeny wejścia razem: niecache + zapis cache + odczyt cache. */
  wejscie: number
  /** Tokeny wyjścia. */
  wyjscie: number
  /** Tokeny wejścia podane z cache (`cache_read_input_tokens`). */
  cache: number
  /**
   * `$.clock.now()` przy `agent.spawn` (zrodlo `spawn`) albo przy PIERWSZYM widzianym kroku (zrodlo `lista`) — nie start agenta;
   * null dla wiersza rysowanego prosto z listy (czas pokazuje się jako „—”).
   */
  start: number | null
  /** `$.clock.now()` przy `turn.complete` pętli agenta; null, póki biegnie — kolejny krok (agent wznowiony, teammate) znów zeruje. */
  koniec: number | null
  /** Skąd wiersz: `spawn` = hook `agent.spawn` (także dopisany później do wiersza z listy), `lista` = pierwszy krok agenta, którego spawnu mod nie widział. */
  zrodlo: 'spawn' | 'lista'
}

export type Glowny = { kroki: number; narzedzia: number; wejscie: number; wyjscie: number; cache: number; model: string | null }

export type Zakladka = 'aktywni' | 'wszyscy' | 'suma'

declare module 'claude-code' {
  interface PluginState {
    'kanon-agenci': {
      wiersze: Wiersz[]
      glowny: Glowny
      /**
       * Spawny, które dotarły do hooka `agent.spawn` (bez workflow; z odmowami `{ deny }` niżej). Inny licznik niż hook
       * `kanon-agent-limit` (próby narzędzia Agent w transkrypcie głównej pętli) — próg hooka (10) służy za punkt odniesienia.
       */
      spawny: number
      /** Kroki z `agentId`, którego nie zna ani spawn, ani `$.agent.list()` (workflow, forki silnika: kompaktacja, pamięć) — liczone, nie rysowane. */
      pominiete: number
      zakladka: Zakladka
    }
  }
}
