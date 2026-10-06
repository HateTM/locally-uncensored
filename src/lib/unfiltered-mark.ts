import type { CloudModel } from '../types/models'

/**
 * Wer die Marke "No refusals" traegt, an genau einer Stelle.
 *
 * Streng: nur ein Modell, das der Server als `full` gemessen meldet, traegt
 * die Marke. Der Messwert `partial` reist weiter im Katalog, aber keine
 * Flaeche macht daraus eine Marke: eine Marke, die manchmal stimmt, ist im
 * Kaufmoment schlimmer als keine, weil der Kunde sie als Zusage liest.
 *
 * Die Messung selbst steht in `no-refusals-measurement.md` neben dieser Datei.
 */
export function traegtDieMarke(unfiltered: CloudModel['unfiltered'] | null | undefined): boolean {
  return unfiltered === 'full'
}

/** Der Wortlaut der Marke und ihr Hovertext, an genau einer Stelle: die Zeile
 *  der Modellauswahl, die Eingabezeile und der Filter im Waehler lesen ihn
 *  hier. Zeichengleich mit dem Web. */
export const UNFILTERED_MARK_LABEL = 'No refusals'
export const UNFILTERED_MARK_TITLE =
  "Measured: this model answers without refusing. Your account's content policy still applies."
