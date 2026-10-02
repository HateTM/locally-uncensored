// Wie die Cloud-Waehler Modelle ordnen und kennzeichnen (02.10.2026, David).
//
// Die Stufe ordnet, sie versteckt nichts: 'best' steht oben und traegt eine
// kleine Marke, 'older' steht gesammelt unten unter einer Zwischenzeile, alles
// dazwischen behaelt seine Reihenfolge. Die Herkunft steht dezent daneben,
// sobald die Familie offene Gewichte hat. Diese Datei ist rein und kennt keine
// Oberflaeche, damit ModelChip und PresetWorkshop dieselbe Regel benutzen und
// ein Test sie festhalten kann.
//
// Desktop-Unterschied zum Web: dort tragen alle Modelle beide Felder, weil der
// Katalog im selben Repo liegt. Der Desktop liest den Katalog vom Server, und
// ein aelterer Server liefert die Felder nicht. Ein Modell ohne `tier` gilt
// darum als 'standard' und eines ohne `weights` als 'closed' ohne Marke: es
// steht in seiner gewohnten Reihenfolge und traegt nichts. Lokale ComfyUI-
// Modelle haben noch keine Stufe und laufen durch dieselben Regeln.

import type { ModelTier, ModelWeights } from './studio-contract'

export type { ModelTier, ModelWeights }

/** Die Zwischenzeile ueber den aelteren Modellen. */
export const OLDER_GROUP = 'Older models'

const RANK: Record<ModelTier, number> = { best: 0, standard: 1, older: 2 }

const TIERS: readonly string[] = ['best', 'standard', 'older']
const WEIGHTS: readonly string[] = ['open', 'open-family', 'closed']

/** Die Felder, die ein Modell tragen KANN. Fehlt eines, gilt es als neutral. */
export interface TierFields { tier?: ModelTier; weights?: ModelWeights }

/** Jedes Modell darf in diese Funktionen, auch eines, das die Felder gar nicht
 *  kennt (ein lokales ComfyUI-Modell): `object` statt `TierFields`, weil TypeScript
 *  einen Typ aus lauter optionalen Feldern fuer Objekte ohne eines davon ablehnt. */
type Tiered = object

function fields(m: Tiered): TierFields {
  return m as TierFields
}

/** Die Stufe, mit der ein Modell sortiert wird. Unbekannt oder fehlend: 'standard'. */
export function tierOf(m: Tiered): ModelTier {
  const tier = fields(m).tier
  return typeof tier === 'string' && TIERS.includes(tier) ? tier : 'standard'
}

/** Die Herkunft eines Modells. Unbekannt oder fehlend: 'closed', also keine Marke. */
export function weightsOf(m: Tiered): ModelWeights {
  const weights = fields(m).weights
  return typeof weights === 'string' && WEIGHTS.includes(weights) ? weights : 'closed'
}

/** Stabil: Modelle gleicher Stufe behalten ihre Reihenfolge, damit eine
 *  gewohnte Liste nicht durcheinanderfaellt. Die Eingabe bleibt unberuehrt. */
export function sortByTier<T extends Tiered>(list: readonly T[]): T[] {
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => RANK[tierOf(a.m)] - RANK[tierOf(b.m)] || a.i - b.i)
    .map(({ m }) => m)
}

/** Die Zwischenzeile, unter der ein Modell steht. Nur 'older' hat eine. */
export function tierGroup(m: Tiered): string | undefined {
  return tierOf(m) === 'older' ? OLDER_GROUP : undefined
}

export interface TierMark { label: string; color: string }

/** Die Marken eines Modells, in der Reihenfolge, in der sie stehen.
 *  'open' sagt "Open weights": genau diese Version hat offene Gewichte.
 *  'open-family' sagt "Open family": die Familie hat welche, diese Version nicht.
 *  Beides ehrlich getrennt, damit "Open weights" nie mehr verspricht, als stimmt.
 *  Ohne Felder gibt es keine Marke. */
export function tierMarks(m: Tiered): TierMark[] {
  const marks: TierMark[] = []
  if (tierOf(m) === 'best') marks.push({ label: 'Best', color: 'bg-lu-accent/15 text-lu-accent' })
  if (weightsOf(m) === 'open') marks.push({ label: 'Open weights', color: 'text-gray-500 dark:text-gray-600' })
  if (weightsOf(m) === 'open-family') marks.push({ label: 'Open family', color: 'text-gray-500 dark:text-gray-600' })
  return marks
}
