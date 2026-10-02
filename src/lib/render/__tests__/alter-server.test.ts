// Der Desktop gegen den Server von HEUTE (Produktion vor dem 02.10.2026).
//
// Der Desktop liest den Cloud-Katalog vom Server (`/api/jobs/catalog?v=2`) und
// bringt eine eigene Studio-Registrierung mit. Der Server von heute kennt die 39
// neuen Modelle nicht und liefert weder `tier` noch `weights`. Dann gilt:
//  1. Kein Modell, das der Server nicht fuehrt, steht in irgendeinem Waehler,
//     in keiner Rolle und in keiner Unterkategorie, denn ein Start dort
//     scheiterte.
//  2. Jedes Modell ohne Stufe ist neutral: standard, keine Marke, keine
//     Zwischenzeile, die gewohnte Reihenfolge.
//  3. Nichts bricht: jeder Waehler hat Eintraege, jede Rolle einen Wert.
//
// Der alte Katalog ist aus den Ids gebaut, die der Web-Stand 293578b2 geliefert
// hat (fixtures/katalog-vor-02-10-2026.json), also keine ausgedachte Liste.

import { beforeEach, describe, expect, it } from 'vitest'
import { alterServer, neueIds, neuerServer } from './fixtures/test-catalogs'
import { intentPickerModels, resolveIntentPick, startImageCount, studioPickFor } from '../create-studio'
import { ALL_ROLES, presetModels } from '../preset-models'
import { sortByTier, tierGroup, tierMarks } from '../model-tier'
import {
  animatePickerModels, cloudModelsFor, editCapableModels, modelForOp, studioOnlyImageModels, useCloudCatalogStore,
  videoPickerModels,
} from '../../../stores/cloudCatalogStore'

describe('der alte Katalog ist wirklich der alte', () => {
  it('kein Eintrag traegt tier oder weights, und die neuen Modelle fehlen', () => {
    const alt = alterServer()
    expect(alt.length).toBe(104)
    for (const m of alt) {
      expect(m.tier, m.id).toBeUndefined()
      expect(m.weights, m.id).toBeUndefined()
    }
    const ids = new Set(alt.map((m) => m.id))
    expect(neueIds()).toHaveLength(39)
    for (const id of neueIds()) expect(ids.has(id), id).toBe(false)
    // Der neue Katalog hat dagegen alles.
    expect(neuerServer().length).toBeGreaterThanOrEqual(alt.length + 39)
  })
})

describe('mit dem Katalog des alten Servers', () => {
  beforeEach(() => { useCloudCatalogStore.setState({ models: alterServer() }) })

  it('kennt der Katalog Studio (quote_required), nur eben ohne die neuen Modelle', () => {
    expect(useCloudCatalogStore.getState().models.some((m) => m.quote_required)).toBe(true)
  })

  it('bietet kein Waehler ein Modell an, das der Server nicht fuehrt', () => {
    const bekannt = new Set(alterServer().map((m) => m.id))
    const waehler: Record<string, { id: string }[]> = {
      image: [...cloudModelsFor('image'), ...studioOnlyImageModels()],
      edit: editCapableModels(),
      video: videoPickerModels(),
      animate: animatePickerModels(),
    }
    for (const intent of ['lipsync', 'music', 'extend', 'motion', 'video_upscale', 'upscale'] as const) {
      waehler[intent] = intentPickerModels(intent).filter((m) => m.id !== 'upscale-standard')
    }
    for (const role of ALL_ROLES) waehler[`rolle ${role}`] = presetModels(role)
    for (const [name, liste] of Object.entries(waehler)) {
      for (const m of liste) expect(bekannt.has(m.id), `${name}/${m.id}`).toBe(true)
      for (const id of neueIds()) expect(liste.map((m) => m.id), `${name}/${id}`).not.toContain(id)
    }
  })

  it('jeder Waehler hat Eintraege, und die klassischen Modelle stehen weiter vorn', () => {
    expect(cloudModelsFor('image').length).toBeGreaterThan(5)
    expect(editCapableModels().map((m) => m.id).slice(0, 2)).toEqual(['flux-dev', 'qwen-image-edit'])
    expect(videoPickerModels()[0].id).toBe('wan-2.2-720p')
    expect(animatePickerModels()[0].id).toBe('wan-2.2-720p')
    for (const intent of ['lipsync', 'music', 'extend', 'motion', 'video_upscale'] as const) {
      expect(intentPickerModels(intent).length, intent).toBeGreaterThan(0)
    }
    // Enhance Image hat nur den Standard: kein Waehler noetig, der Composer zeigt keinen.
    expect(intentPickerModels('upscale').map((m) => m.id)).toEqual(['upscale-standard'])
  })

  it('jede Rolle liefert eine Wahl, die zum alten Server passt', () => {
    for (const intent of ['lipsync', 'music', 'extend', 'motion', 'video_upscale'] as const) {
      const pick = resolveIntentPick(intent, 'flux-3-extend')
      expect(alterServer().some((m) => m.id === pick), `${intent}/${pick}`).toBe(true)
    }
  })

  it('stellt jedes Modell neutral dar: keine Marke, keine Zwischenzeile, Reihenfolge wie bisher', () => {
    const listen = [
      cloudModelsFor('image'), editCapableModels(), videoPickerModels(), animatePickerModels(),
      intentPickerModels('music'), intentPickerModels('extend'), intentPickerModels('motion'),
    ]
    for (const liste of listen) {
      expect(liste.length).toBeGreaterThan(0)
      for (const m of liste) {
        expect(tierMarks(m), m.id).toEqual([])
        expect(tierGroup(m), m.id).toBeUndefined()
      }
      expect(sortByTier(liste).map((m) => m.id)).toEqual(liste.map((m) => m.id))
    }
  })

  it('keine Studio-Wahl fuer ein Modell, das der Server nicht kennt, auch nicht aus einer gespeicherten Wahl', () => {
    const state = { cloudImageModel: 'flux-3', cloudVideoModel: 'minimax-h3-t2v', cloudOpModel: 'yue2' }
    expect(studioPickFor('image', state)).toBeUndefined()
    expect(studioPickFor('video', state)).toBeUndefined()
    expect(studioPickFor('music', state)).toBeUndefined()
    expect(modelForOp('image', 'generate', 'flux-3')).not.toBe('flux-3')
    expect(modelForOp('video', 'generate', 'minimax-h3-t2v')).not.toBe('minimax-h3-t2v')
  })

  it('ein Studio-Modell, das der Server schon hatte, bleibt waehlbar', () => {
    expect(animatePickerModels().map((m) => m.id)).toContain('minimax-h3')
    expect(studioPickFor('animate', { cloudImageModel: '', cloudVideoModel: 'minimax-h3', cloudOpModel: '' })).toBe('minimax-h3')
    expect(editCapableModels().map((m) => m.id)).toContain('minimax-h3-edit')
  })
})

describe('mit dem Katalog des neuen Servers und der Studio-Wahl', () => {
  beforeEach(() => { useCloudCatalogStore.setState({ models: neuerServer() }) })

  it('studioPickFor erkennt Studio-Modelle in Image, Edit, Video, Animate und Enhance Image', () => {
    const leer = { cloudImageModel: '', cloudVideoModel: '', cloudOpModel: '' }
    expect(studioPickFor('image', { ...leer, cloudImageModel: 'flux-3' })).toBe('flux-3')
    expect(studioPickFor('edit', { ...leer, cloudImageModel: 'flux-3-edit' })).toBe('flux-3-edit')
    expect(studioPickFor('video', { ...leer, cloudVideoModel: 'ltx-2.5-t2v' })).toBe('ltx-2.5-t2v')
    expect(studioPickFor('animate', { ...leer, cloudVideoModel: 'ltx-2.5-i2v' })).toBe('ltx-2.5-i2v')
    expect(studioPickFor('upscale', { ...leer, cloudOpModel: 'seedvr2-image' })).toBe('seedvr2-image')
    expect(studioPickFor('upscale', { ...leer, cloudOpModel: 'upscale-standard' })).toBeUndefined()
    // Ein klassisches Modell ist keine Studio-Wahl, der Character-Weg nie.
    expect(studioPickFor('image', { ...leer, cloudImageModel: 'flux-schnell' })).toBeUndefined()
    expect(studioPickFor('character', { ...leer, cloudOpModel: 'flux-3' })).toBeUndefined()
    // Ein Editor aus dem Edit-Tab ist im Bild-Tab keine Wahl.
    expect(studioPickFor('image', { ...leer, cloudImageModel: 'flux-3-edit' })).toBeUndefined()
  })

  it('die Bildzahl des Starts: ein Bild bei Modellen, die nur Bilder lesen, sonst keine', () => {
    expect(startImageCount('minimax-h3-ref')).toBe(1)
    expect(startImageCount('flux-3-edit')).toBe(1)
    expect(startImageCount('minimax-h3-t2v')).toBeUndefined()
    expect(startImageCount('flux-3-video-edit')).toBeUndefined()
    expect(startImageCount('gibt-es-nicht')).toBeUndefined()
  })
})
