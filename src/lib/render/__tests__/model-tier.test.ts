// Wie die Waehler Modelle ordnen und kennzeichnen (02.10.2026, David), und was
// sie mit einem Modell tun, das keine Stufe traegt.
//
// Der Desktop liest seinen Katalog vom Server, und ein aelterer Server liefert
// `tier` und `weights` nicht. Ein lokales ComfyUI-Modell hat noch keine Stufe.
// Beides muss neutral aussehen: Reihenfolge wie bisher, keine Marke, keine
// Zwischenzeile.

import { describe, expect, it } from 'vitest'
import { OLDER_GROUP, sortByTier, tierGroup, tierMarks, tierOf, weightsOf } from '../model-tier'

describe('Stufe und Herkunft', () => {
  it('sortByTier stellt best nach oben und older nach unten, sonst bleibt die Reihenfolge', () => {
    const liste = [
      { id: 'a', tier: 'older' as const }, { id: 'b', tier: 'standard' as const }, { id: 'c', tier: 'best' as const },
      { id: 'd', tier: 'standard' as const }, { id: 'e', tier: 'older' as const }, { id: 'f', tier: 'best' as const },
    ]
    const kopie = [...liste]
    expect(sortByTier(liste).map((m) => m.id)).toEqual(['c', 'f', 'b', 'd', 'a', 'e'])
    expect(liste).toEqual(kopie)
    expect(sortByTier(liste)).toHaveLength(liste.length)
  })

  it('nur die aelteren stehen unter einer Zwischenzeile', () => {
    expect(tierGroup({ tier: 'older' })).toBe(OLDER_GROUP)
    expect(OLDER_GROUP).toBe('Older models')
    expect(tierGroup({ tier: 'best' })).toBeUndefined()
    expect(tierGroup({ tier: 'standard' })).toBeUndefined()
  })

  it('die Marken: Best fuer best, Open weights nur fuer open, Open family fuer open-family, sonst nichts', () => {
    expect(tierMarks({ tier: 'best', weights: 'open' }).map((m) => m.label)).toEqual(['Best', 'Open weights'])
    expect(tierMarks({ tier: 'best', weights: 'open-family' }).map((m) => m.label)).toEqual(['Best', 'Open family'])
    expect(tierMarks({ tier: 'standard', weights: 'open-family' }).map((m) => m.label)).toEqual(['Open family'])
    expect(tierMarks({ tier: 'best', weights: 'closed' }).map((m) => m.label)).toEqual(['Best'])
    expect(tierMarks({ tier: 'older', weights: 'open' }).map((m) => m.label)).toEqual(['Open weights'])
    expect(tierMarks({ tier: 'standard', weights: 'closed' })).toEqual([])
  })
})

describe('ein Modell ohne Stufe und Herkunft ist neutral (alter Server, lokales Modell)', () => {
  it('gilt als standard und closed', () => {
    expect(tierOf({})).toBe('standard')
    expect(weightsOf({})).toBe('closed')
  })

  it('traegt keine Marke und steht unter keiner Zwischenzeile', () => {
    expect(tierMarks({})).toEqual([])
    expect(tierGroup({})).toBeUndefined()
  })

  it('behaelt seine Reihenfolge, auch gemischt mit Modellen, die eine Stufe haben', () => {
    const liste: { id: string; tier?: 'best' | 'standard' | 'older' }[] = [
      { id: 'a' }, { id: 'b', tier: 'older' }, { id: 'c' }, { id: 'd', tier: 'best' }, { id: 'e' },
    ]
    expect(sortByTier(liste).map((m) => m.id)).toEqual(['d', 'a', 'c', 'e', 'b'])
    // Ganz ohne Stufen aendert sich nichts.
    const ohne = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    expect(sortByTier(ohne).map((m) => m.id)).toEqual(['x', 'y', 'z'])
  })

  it('ein Wert, den es nicht gibt, gilt wie ein fehlender (ein kuenftiger Server mit neuer Stufe)', () => {
    const fremd = { tier: 'legendary' as never, weights: 'secret' as never }
    expect(tierOf(fremd)).toBe('standard')
    expect(weightsOf(fremd)).toBe('closed')
    expect(tierMarks(fremd)).toEqual([])
  })
})
