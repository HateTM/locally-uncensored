// Die Modelle aus offenen Familien, aufgenommen am 02.10.2026, im Desktop.
//
// Regel von David: neu aufgenommen wird nur, was aus einer Familie stammt, die
// je offene Gewichte veroeffentlicht hat. Bestehende Modelle bleiben, auch
// geschlossene. Dieser Fall haelt fest, dass jedes neue Modell im Cloud-Modus
// des Desktops wirklich ankommt: mit Schema, mit einem Preis, der nie unter dem
// Einkaufspreis liegt, in genau einer Rolle und an der Stelle, an der der Kunde
// es waehlen kann. Der Desktop liest den Katalog vom Server: alle Waehler-Faelle
// laufen darum gegen den Katalog des neuen Servers (neuerServer), und der
// Gegenfall gegen den alten steht in alter-server.test.ts.
//
// Aus dem Web uebernommen (apps/web/lib/render/__tests__/sota-models.test.ts)
// ohne die Faelle, die Serverdateien lesen (WS_PRICE_BASELINE, ownStudioPaths).

import { beforeEach, describe, expect, it } from 'vitest'
import { STUDIO_MODELS, studioCredits, studioOptions, studioSchema, studioFields } from '../studio-contract'
import { editNeedsMask } from '../../../stores/cloudCatalogStore'
import {
  animatePickerModels, cloudModelById, editCapableModels, modelForOp, studioOnlyImageModels, useCloudCatalogStore,
  utilityOpModel, videoPickerModels, cloudModelsFor,
} from '../../../stores/cloudCatalogStore'
import { ALL_ROLES, presetModels, roleForModel } from '../preset-models'
import { intentPickerModels, STANDARD_UPSCALE } from '../create-studio'
import { neuerServer } from './fixtures/test-catalogs'
import prices from './fixtures/studio-prices-2026-10-02.json'

/** Ein Credit kostet uns 0,00001 Dollar (Web: CREDIT_USD). */
const CREDIT_USD = 1e-5

/** Jedes Modell dieser Aufnahme, mit dem Endpunkt, den der Anbieter listet. */
const NEU: Record<string, string> = {
  'qwen-image-3-pro': 'alibaba/qwen-image-3.0-pro/text-to-image',
  'qwen-image-3-pro-edit': 'alibaba/qwen-image-3.0-pro/edit',
  'qwen-image-3': 'alibaba/qwen-image-3.0/text-to-image',
  'qwen-image-2.1': 'wavespeed-ai/qwen-image-2.1/text-to-image',
  'qwen-image-2.1-edit': 'wavespeed-ai/qwen-image-2.1/edit',
  'flux-3': 'black-forest-labs/flux-3/text-to-image',
  'flux-3-edit': 'black-forest-labs/flux-3/edit',
  'flux-2-klein-9b': 'wavespeed-ai/flux-2-klein-9b/text-to-image',
  'krea-2-large': 'wavespeed-ai/krea-v2-large/text-to-image',
  'cosmos-3-super': 'nvidia/cosmos-3-super/text-to-image',
  'ideogram-4.5': 'ideogram-ai/ideogram-v4.5',
  'ideogram-4.5-edit': 'ideogram-ai/ideogram-v4.5/edit',
  'hidream-o1': 'wavespeed-ai/hidream-o1-image/text-to-image',
  'hidream-o1-edit': 'wavespeed-ai/hidream-o1-image/edit',
  'hunyuan-image-3': 'wavespeed-ai/hunyuan-image-3-instruct/text-to-image',
  'hunyuan-image-3-edit': 'wavespeed-ai/hunyuan-image-3-instruct/edit',
  'ernie-image-turbo': 'wavespeed-ai/ernie-image/text-to-image-turbo',
  'seedvr2-image': 'wavespeed-ai/seedvr2/image',
  'ltx-2.5-t2v': 'wavespeed-ai/ltx-2.5/text-to-video',
  'ltx-2.5-i2v': 'wavespeed-ai/ltx-2.5/image-to-video',
  'flux-3-t2v': 'black-forest-labs/flux-3/text-to-video',
  'flux-3-i2v': 'black-forest-labs/flux-3/image-to-video',
  'flux-3-start-end': 'black-forest-labs/flux-3/start-end-to-video',
  'flux-3-extend': 'black-forest-labs/flux-3/video-extend',
  'flux-3-video-edit': 'black-forest-labs/flux-3/video-edit',
  'cosmos-3-super-i2v': 'nvidia/cosmos-3-super/image-to-video',
  'skyreels-v4-t2v': 'skywork-ai/skyreels-v4/text-to-video',
  'skyreels-v4-i2v': 'skywork-ai/skyreels-v4/image-to-video',
  'skyreels-v4-ref': 'skywork-ai/skyreels-v4/reference-to-video',
  'kandinsky-5-pro-t2v': 'wavespeed-ai/kandinsky5-pro/text-to-video',
  'kandinsky-5-pro-i2v': 'wavespeed-ai/kandinsky5-pro/image-to-video',
  'minimax-h3-t2v': 'wavespeed-ai/minimax-h3/text-to-video',
  'minimax-h3-ref': 'wavespeed-ai/minimax-h3/reference-to-video',
  'minimax-h3-video-edit': 'wavespeed-ai/minimax-h3/video-edit',
  'wan-3.0-ref': 'alibaba/wan-3.0/reference-to-video',
  'wan-3.0-video-edit': 'alibaba/wan-3.0/video-edit',
  'seedvr2-video': 'wavespeed-ai/seedvr2/video',
  'davinci-magihuman': 'wavespeed-ai/davinci-magihuman/image-to-video',
  yue2: 'wavespeed-ai/yue2-3b/text-to-music',
}

beforeEach(() => {
  useCloudCatalogStore.setState({ models: neuerServer() })
})

describe('die neuen Modelle aus offenen Familien', () => {
  it('sind alle in der Registrierung und im Katalog des neuen Servers, mit dem Endpunkt des Anbieters', () => {
    expect(Object.keys(NEU)).toHaveLength(39)
    for (const [id, endpoint] of Object.entries(NEU)) {
      expect(STUDIO_MODELS[id], id).toBeDefined()
      expect(STUDIO_MODELS[id].endpoint, id).toBe(endpoint)
      expect(cloudModelById(id), id).toBeDefined()
    }
  })

  it('stehen nicht doppelt: kein Endpunkt zweimal, auch nicht unter altem Namen', () => {
    const endpoints = Object.values(STUDIO_MODELS).map((m) => m.endpoint)
    expect(new Set(endpoints).size).toBe(endpoints.length)
    expect(STUDIO_MODELS['qwen-image-3-edit'].endpoint).toBe('alibaba/qwen-image-3.0/edit')
    expect(Object.values(NEU)).not.toContain('alibaba/qwen-image-3.0/edit')
    expect(Object.values(NEU)).not.toContain('wavespeed-ai/minimax-h3/image-to-video')
    expect(Object.values(NEU)).not.toContain('alibaba/wan-3.0/image-to-video')
    expect(Object.values(NEU)).not.toContain('black-forest-labs/flux-3/video-upscale')
  })

  it('haben ein Schema, einen Grundpreis und tragen keine Freigabe-Marke', () => {
    for (const id of Object.keys(NEU)) {
      const m = STUDIO_MODELS[id]
      expect(studioSchema(id).properties, id).toBeTruthy()
      expect(m.baselineUsd, id).toBeGreaterThan(0)
      // Die Familien sind offen, die Endpunkte gefiltert: kein No-refusals-Flag.
      expect(m.adult, id).toBe(false)
      // Mit den Vorgaben allein ist das Modell startbereit.
      expect(() => studioOptions(id, 'a test prompt', {}), id).not.toThrow()
      expect(studioCredits(id, studioOptions(id, 'a test prompt', {}), 5, 1, 100), id).toBeGreaterThan(0)
    }
  })

  it('geben jedem Eingabefeld ein echtes Feld des Anbieterschemas', () => {
    for (const id of Object.keys(NEU)) {
      for (const field of Object.keys(STUDIO_MODELS[id].inputs)) {
        expect(studioSchema(id).properties, `${id}.${field}`).toHaveProperty(field)
      }
      for (const field of Object.keys(STUDIO_MODELS[id].defaults)) {
        expect(studioSchema(id).properties, `${id}.${field}`).toHaveProperty(field)
      }
    }
  })

  it('bepreisen jeden Wert des Preisfeldes, sonst bliebe ein Wert ohne Preis', () => {
    for (const id of Object.keys(STUDIO_MODELS)) {
      const m = STUDIO_MODELS[id]
      const field = m.price.resolutionField ?? 'resolution'
      const values = studioSchema(id).properties?.[field]?.enum
      if (!values || m.price.rates.default !== undefined) continue
      for (const v of values) expect(m.price.rates[String(v)], `${id}: ${field}=${String(v)}`).toBeGreaterThan(0)
    }
  })

  it('gehoeren zu genau einer Rolle, und jede Rolle kennt sie', () => {
    for (const id of Object.keys(NEU)) {
      const rollen = ALL_ROLES.filter((r) => presetModels(r).some((m) => m.id === id))
      expect(rollen, id).toHaveLength(1)
      expect(roleForModel(id), id).toBe(rollen[0])
    }
  })
})

describe('der Preis liegt nie unter dem Einkaufspreis', () => {
  const EXAKT_AUSNAHME = new Set(['qwen-image-2.1-edit', 'minimax-h3-ref'])
  it.each(prices)('$model $options: Credits >= was der Anbieter berechnet', (row) => {
    const options = studioOptions(row.model, '', row.options, false)
    const credits = studioCredits(row.model, options, (row as { seconds?: number }).seconds, (row as { imageCount?: number }).imageCount ?? 1, row.promptLength)
    const einkauf = Math.round(row.usd / CREDIT_USD)
    expect(credits).toBeGreaterThanOrEqual(einkauf)
    const opts = row.options as { mode?: string; duration?: number }
    const fast = opts.mode === 'fast'
    if (fast || EXAKT_AUSNAHME.has(row.model)) expect(credits).toBeLessThanOrEqual(Math.ceil(einkauf * 1.6))
    else expect(credits).toBe(einkauf)
  })

  it('bucht dieselbe Creditzahl wie bei vergleichbaren Modellen: eins zu eins zum Einkauf', () => {
    const alt = studioCredits('minimax-h3', studioOptions('minimax-h3', 'x', { duration: 5, resolution: '480p' }))
    const neu = studioCredits('minimax-h3-t2v', studioOptions('minimax-h3-t2v', 'x', { duration: 5, resolution: '480p' }))
    expect(alt).toBe(Math.round(0.2 / CREDIT_USD))
    expect(neu).toBe(alt)
    expect(studioCredits('wan-3.0', studioOptions('wan-3.0', 'x', { duration: 5, resolution: '720p' })))
      .toBe(studioCredits('wan-3.0-ref', studioOptions('wan-3.0-ref', 'x', { duration: 5, resolution: '720p' })))
  })
})

describe('der Kunde kann sie dort waehlen, wo sie hingehoeren', () => {
  const ids = (list: { id: string }[]) => list.map((m) => m.id)

  it('Text zu Bild: alle elf im Bildwaehler', () => {
    const bild = ids(studioOnlyImageModels())
    for (const id of ['qwen-image-3-pro', 'qwen-image-3', 'qwen-image-2.1', 'flux-3', 'flux-2-klein-9b', 'krea-2-large', 'cosmos-3-super', 'ideogram-4.5', 'hidream-o1', 'hunyuan-image-3', 'ernie-image-turbo']) {
      expect(bild, id).toContain(id)
    }
  })

  it('Bearbeiten: die Editoren stehen im Edit-Waehler und laufen ohne Maske', () => {
    const edit = ids(editCapableModels())
    for (const id of ['qwen-image-3-pro-edit', 'qwen-image-2.1-edit', 'flux-3-edit', 'ideogram-4.5-edit', 'hidream-o1-edit', 'hunyuan-image-3-edit']) {
      expect(edit, id).toContain(id)
      expect(modelForOp('image', 'edit', id), id).toBe(id)
    }
    expect(modelForOp('image', 'edit', 'nonsense')).toBe('qwen-image-2.1-edit')
  })

  it('Text zu Video: im Video-Waehler, und eine Wahl bleibt beim Start bestehen', () => {
    const video = ids(videoPickerModels())
    for (const id of ['ltx-2.5-t2v', 'flux-3-t2v', 'skyreels-v4-t2v', 'kandinsky-5-pro-t2v', 'minimax-h3-t2v']) {
      expect(video, id).toContain(id)
      expect(modelForOp('video', 'generate', id), id).toBe(id)
    }
    // Die klassischen Modelle stehen weiter vorn und haben ihre Wahl behalten.
    expect(video[0]).toBe('wan-2.2-720p')
    expect(modelForOp('video', 'generate', 'wan-2.2-fast')).toBe('wan-2.2-fast')
  })

  it('Bild zu Video: im Animate-Waehler, samt der Referenzmodelle', () => {
    const animate = ids(animatePickerModels())
    for (const id of ['ltx-2.5-i2v', 'flux-3-i2v', 'cosmos-3-super-i2v', 'skyreels-v4-i2v', 'kandinsky-5-pro-i2v', 'davinci-magihuman', 'skyreels-v4-ref', 'minimax-h3-ref', 'wan-3.0-ref']) {
      expect(animate, id).toContain(id)
      expect(modelForOp('video', 'animate', id), id).toBe(id)
    }
    expect(animate).not.toContain('ltx-2.5-t2v')
  })

  it('Verlaengern, Restyle, Upscale und Musik: in der Rolle, die ihre Unterkategorie fuehrt', () => {
    expect(ids(intentPickerModels('extend'))).toContain('flux-3-extend')
    expect(ids(intentPickerModels('video_upscale'))).toContain('seedvr2-video')
    expect(ids(intentPickerModels('music'))).toContain('yue2')
    expect(ids(presetModels('restyle'))).toEqual(expect.arrayContaining(['wan-ditto', 'flux-3-video-edit', 'minimax-h3-video-edit', 'wan-3.0-video-edit']))
    expect(ids(presetModels('startend'))).toEqual(['flux-3-start-end'])
  })

  it('Bild-Upscale: Standard bleibt vorn, SeedVR2 steht daneben und laeuft als Studio-Modell', () => {
    const liste = ids(intentPickerModels('upscale'))
    expect(liste).toEqual([STANDARD_UPSCALE, 'seedvr2-image'])
    expect(utilityOpModel('image', 'upscale', 'seedvr2-image')).toBe('seedvr2-image')
    expect(utilityOpModel('image', 'upscale', 'flux-3')).not.toBe('flux-3')
    expect(utilityOpModel('image', 'removebg', 'seedvr2-image')).not.toBe('seedvr2-image')
  })

  it('jedes Eingabefeld, das die Oberflaeche nicht fuellt, ist ein Feld mit Vorgabe oder ohne Pflicht', () => {
    // In Create faellt nur ein Bild an. Jedes Modell der Waehler Bild, Bearbeiten,
    // Video und Animate muss damit startbereit sein.
    for (const id of [...ids(animatePickerModels()), ...ids(videoPickerModels()), ...ids(editCapableModels())]) {
      const m = STUDIO_MODELS[id]
      if (!m) continue
      const pflicht = studioSchema(id).required ?? []
      const gelesen = new Set(Object.values(m.inputs))
      for (const field of Object.keys(m.inputs)) {
        if (pflicht.includes(field)) expect(['source_path', 'image_paths'], `${id}.${field}`).toContain(m.inputs[field])
      }
      expect(gelesen.has('video_path'), id).toBe(false)
      expect(gelesen.has('last_image_path') && pflicht.some((f) => m.inputs[f] === 'last_image_path'), id).toBe(false)
    }
  })

  it('zeigt im Schema jedes neuen Modells keine Liste als Eingabefeld, die die Oberflaeche nicht fuellt', () => {
    for (const id of Object.keys(NEU)) {
      for (const [field, schema] of Object.entries(studioFields(id))) {
        if (schema.type === 'array') expect(studioSchema(id).required ?? [], `${id}.${field}`).not.toContain(field)
      }
    }
  })

  it('der Katalog nennt die neuen Modelle mit ops studio, nie im klassischen Waehler', () => {
    for (const id of Object.keys(NEU)) {
      expect(cloudModelById(id)?.ops, id).toEqual(['studio'])
      expect(cloudModelsFor(STUDIO_MODELS[id].kind).map((m) => m.id), id).not.toContain(id)
    }
  })
})

describe('Maske und Groesse', () => {
  it('ein Editor per Anweisung braucht keine Maske, flux-dev braucht eine', () => {
    for (const id of ['flux-3-edit', 'qwen-image-3-pro-edit', 'hidream-o1-edit', 'minimax-h3-edit', 'qwen-image-edit']) expect(editNeedsMask(id), id).toBe(false)
    expect(editNeedsMask('flux-dev')).toBe(true)
  })

  it('akzeptiert die Seitenverhaeltnisse von Cosmos 3 Super als size, und prueft width*height sonst weiter', () => {
    expect(studioOptions('cosmos-3-super', 'x', { size: '16:9' }).size).toBe('16:9')
    expect(() => studioOptions('cosmos-3-super', 'x', { size: '9:9' })).toThrow()
    expect(studioOptions('hidream-o1', 'x', { size: '1024*2048' }).size).toBe('1024*2048')
    expect(() => studioOptions('hidream-o1', 'x', { size: '16:9' })).toThrow('width*height')
  })
})

describe('eine Wahl aus einem anderen Tab startet keinen Lauf ohne Bild', () => {
  it('Text zu Bild laesst ein Studio-Bildmodell stehen und biegt Editoren und Upscaler um', () => {
    expect(modelForOp('image', 'generate', 'flux-3')).toBe('flux-3')
    expect(modelForOp('image', 'generate', 'z-image')).toBe('z-image')
    expect(modelForOp('image', 'generate', 'chroma')).toBe('chroma')
    // Character-Studio: der LoRA-Endpunkt bleibt, was er ist.
    expect(modelForOp('image', 'generate', 'flux-schnell-lora')).toBe('flux-schnell-lora')
    for (const edit of ['flux-3-edit', 'qwen-image-edit', 'seedvr2-image', 'minimax-h3-edit']) {
      expect(modelForOp('image', 'generate', edit), edit).toBe('z-image-turbo')
    }
  })
})
