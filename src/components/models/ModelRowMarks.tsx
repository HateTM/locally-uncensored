import type { CloudModel } from '../../types/models'
import { FLASH_MARK_LABEL, flashMarkTitle, useFlashEntitlement } from '../../lib/flash-entitlement'
import { traegtDieMarke, UNFILTERED_MARK_LABEL, UNFILTERED_MARK_TITLE } from '../../lib/unfiltered-mark'

/**
 * Die Marken an einer Zeile der Modellauswahl.
 *
 * Beide kommen aus dem Server-Katalog und nie aus dem Modellnamen:
 * `unfiltered` ist gemessen, `flash` ist die Klasse, die keine Credits kostet.
 * Eine Marke beschreibt das Modell, sie erlaubt nichts. Was eine Anfrage
 * enthalten darf, entscheidet der Server bei jedem Aufruf neu.
 *
 * Nur `full` wird markiert. Ein Modell, das teilweise mitgeht, bekommt keine
 * Marke: eine Marke, die manchmal stimmt, ist im Kaufmoment schlimmer als
 * keine, weil der Kunde sie als Zusage liest.
 *
 * Die Freimengenmarke sagt etwas ueber das KONTO und nicht nur ueber das
 * Modell, also fragt die Zeile das Konto (lib/flash-entitlement, dieselbe
 * Regel, nach der der Chat-Vermittler abrechnet). Der Server liefert `flash`
 * an jedes Konto mit Cloud; ein Konto ohne bezahlten Plan zahlt fuer genau
 * diese Modelle und darf die Marke nicht sehen. Eine noch unbeantwortete
 * Abfrage verspricht nichts.
 *
 * `row` ist die Zeile des Cloud-Waehlers: sie zeigt nur die gemessene Marke,
 * denn was ein Modell dieses Konto kostet, steht dort hinter dem Fragezeichen
 * der Zeile.
 *
 * Das Aussehen ist das Etikett der Waehler (index.css, .lu-picker-tag): eine
 * Haarlinie, der eine Akzent fuer "No refusals", Helligkeit und keine Farbe
 * fuer "No credits". K12 (3.0.1, die Marke war nicht auffindbar) ist damit
 * anders geloest als frueher mit Icon und Fettung: die Marke hat einen eigenen
 * Rahmen, und der Waehler hat einen Filter, der nur markierte Modelle zeigt.
 */
export function ModelRowMarks({ model, row = false }: {
  model: { flash?: CloudModel['flash']; unfiltered?: CloudModel['unfiltered'] }
  row?: boolean
}) {
  const paidPlan = useFlashEntitlement()
  const freeFlash = !row && model.flash && paidPlan === true ? model.flash : undefined
  return (
    <>
      {traegtDieMarke(model.unfiltered) && (
        <span className="t-micro lu-picker-tag is-accent" title={UNFILTERED_MARK_TITLE} data-mark="unfiltered">
          {UNFILTERED_MARK_LABEL}
        </span>
      )}
      {freeFlash && (
        <span
          className="t-micro lu-picker-tag is-bright"
          title={flashMarkTitle(freeFlash.dailyTokens)}
          data-mark="unlimited"
        >
          {FLASH_MARK_LABEL}
        </span>
      )}
    </>
  )
}
