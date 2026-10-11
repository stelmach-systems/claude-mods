// Kontrakt modu kanon-flota: `$.state` sesji (pane i liczniki) oraz wpis w `$.store` (wspólny dla sesji na maszynie, klucz `flota:<sid>`).

/** Liczniki wiadomości między sesjami tej sesji — bez treści, tylko liczby, rodzaje, adresy i czasy (`$.clock.now()`). */
export type Liczniki = {
  /** Dostarczenia do głównej rozmowy z `session.receive` o `origin.kind` `peer` (bez `teammate`) albo `peer-send-message`. */
  msgIn: number
  /** Doręczone (`isDelivered`) wysyłki głównej rozmowy z `session.send` — model (SendMessage) albo plugin (`$.session.send`). */
  msgOut: number
  /** Rodzaj ostatniej przychodzącej: `peer`, `peer:<plugin>` albo `peer-send-message`. Adresu nadawcy `session.receive` nie niesie. */
  lastInKind: string | null
  lastInAt: number | null
  /** Adres ostatniej wysyłki, jak go pisze silnik (`e.to`). */
  lastOutTo: string | null
  lastOutAt: number | null
}

/** Wpis sesji z modem w `$.store` pod `flota:<sid>`; pisze go wyłącznie ta sesja. */
export type Wpis = Liczniki & {
  sid: string
  cwd: string
  model: string
  /** `$.session.usage().context.percent`; null, gdy silnik go nie ma (przed pierwszą odpowiedzią). */
  ctx: number | null
  /** `$.session.usage().cost.usd`; null, gdy host nie prowadzi kosztu. */
  usd: number | null
  updatedAt: number
}

/** Wiersz pane: sesja z `claude agents --json`, uzupełniona wpisem z `$.store`, gdy sesja ma mod. */
export type Wiersz = {
  sid: string
  /** Ostatni segment `cwd`. */
  projekt: string
  nazwa: string
  /** `busy` | `idle` | `waiting` (albo inne słowo przyszłego CLI — pokazywane surowo). */
  status: string
  waitingFor: string | null
  /** Od kiedy widzimy ten status (`$.clock.now()`); `claude agents --json` nie podaje czasu zmiany. */
  od: number
  /** false: status był już taki przy pierwszym odczycie albo po przerwie w odczytach — czas to dolna granica („≥”). */
  odPewne: boolean
  wlasna: boolean
  /** null dla sesji bez modu (brak wpisu w store). */
  wpis: Wpis | null
}

export type Flota = {
  wiersze: Wiersz[]
  /** Czas ostatniego udanego odczytu `claude agents --json`; null przed pierwszym. */
  odczyt: number | null
  /** Ostatni błąd odczytu (start procesu, kod wyjścia, JSON); null po udanym. */
  blad: string | null
  /** true: ostatni odczyt się nie udał i wiersze pochodzą z poprzedniego. */
  stare: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'kanon-flota': {
      flota: Flota
      liczniki: Liczniki
    }
  }
}
