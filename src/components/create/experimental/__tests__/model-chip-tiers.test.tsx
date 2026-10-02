// @vitest-environment jsdom
/**
 * Die Modellwaehler der Cloud ordnen nach Stufe und nennen die Herkunft.
 *
 * 02.10.2026, Entscheid von David: "Best" steht oben und traegt eine kleine
 * Marke, aeltere Modelle stehen gesammelt unten unter "Older models", nichts
 * wird versteckt. Die Herkunft steht dezent daneben ("Open weights"), sobald
 * die Familie offene Gewichte hat.
 *
 * Desktop: der Katalog kommt vom Server. Die Faelle laufen gegen den Katalog
 * des neuen Servers (mit Stufe, Herkunft und den neuen Modellen) und gegen den
 * des alten (ohne beides): dort steht jede Zeile neutral da, ohne Marke und
 * ohne Zwischenzeile, in der gewohnten Reihenfolge.
 *
 * Harte Regel: KEIN Hinweis, keine Marke, kein Text im oder ueber dem
 * Prompt-Eingabefeld. Die Marken gehoeren in die aufgeklappten Modellwaehler
 * und nirgends sonst hin; die letzten Faelle halten das am Quelltext fest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../../../../hooks/useContentPolicy', () => ({
  useContentPolicy: () => 'soft' as const,
  primeContentPolicyCache: vi.fn(),
}))

import { ModelChip } from '../ModelChip'
import { useCreateStore, type CreateIntent } from '../../../../stores/createStore'
import {
  animatePickerModels, cloudModelsFor, editCapableModels, studioOnlyImageModels, useCloudCatalogStore, videoPickerModels,
} from '../../../../stores/cloudCatalogStore'
import { sortByTier, OLDER_GROUP } from '../../../../lib/render/model-tier'
import { alterServer, neuerServer } from '../../../../lib/render/__tests__/fixtures/test-catalogs'

beforeEach(() => {
  cleanup()
  // jsdom kennt kein ResizeObserver, das die aufgeklappte Liste beobachtet.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  useCreateStore.setState({ backend: 'cloud', cloudImageModel: '', cloudVideoModel: '', cloudOpModel: '' })
  useCloudCatalogStore.setState({ models: neuerServer() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Oeffnet den Waehler und liest die Liste so, wie ein Kunde sie sieht. */
function lies(intent: CreateIntent) {
  useCreateStore.getState().setIntent(intent)
  render(<ModelChip />)
  fireEvent.click(screen.getByRole('button'))
  const liste = document.querySelector('.lu-elevated') as HTMLElement | null
  if (!liste) throw new Error('Liste nicht offen')
  const zeilen = Array.from(liste.querySelectorAll('button')).map((b) => ({
    name: (b.querySelector('.truncate')?.textContent ?? '').trim(),
    best: Array.from(b.querySelectorAll('span')).some((s) => s.textContent === 'Best'),
    offen: Array.from(b.querySelectorAll('span')).some((s) => s.textContent === 'Open weights'),
    familie: Array.from(b.querySelectorAll('span')).some((s) => s.textContent === 'Open family'),
  }))
  const kopf = Array.from(liste.querySelectorAll('div')).find((d) => d.textContent === OLDER_GROUP)
  return { liste, zeilen, kopf }
}

describe('der Bildwaehler (neuer Server)', () => {
  it('fuehrt die Besten oben, markiert sie und sammelt die Aelteren unter einer Zwischenzeile', () => {
    const erwartet = sortByTier([...cloudModelsFor('image'), ...studioOnlyImageModels()])
    const { zeilen, kopf } = lies('image')
    expect(zeilen.map((z) => z.name)).toEqual(erwartet.map((m) => m.label))
    const nBest = erwartet.filter((m) => m.tier === 'best').length
    expect(nBest).toBeGreaterThan(3)
    for (const z of zeilen.slice(0, nBest)) expect(z.best, z.name).toBe(true)
    for (const z of zeilen.slice(nBest)) expect(z.best, z.name).toBe(false)
    const vorn = zeilen.slice(0, nBest).map((z) => z.name)
    expect(vorn).toEqual(expect.arrayContaining(['Z-Image Turbo (fast)', 'Qwen Image 3.0 Pro', 'FLUX 3']))
    const aelter = erwartet.filter((m) => m.tier === 'older').map((m) => m.label)
    expect(aelter).toEqual(expect.arrayContaining(['Flux Schnell (fast)', 'Flux Dev (quality)', 'Qwen Image', 'HiDream', 'HunyuanImage 2.1']))
    expect(zeilen.slice(-aelter.length).map((z) => z.name)).toEqual(aelter)
    expect(kopf).toBeTruthy()
    const ersteAlte = zeilen[zeilen.length - aelter.length].name
    const knoepfe = Array.from(document.querySelectorAll('.lu-elevated button'))
    const mitKopf = knoepfe.filter((b) => b.previousElementSibling?.textContent === OLDER_GROUP)
    expect(mitKopf).toHaveLength(1)
    expect(mitKopf[0].querySelector('.truncate')?.textContent).toBe(ersteAlte)
  })

  it('nennt die Herkunft nur dort, wo die Familie offene Gewichte hat', () => {
    const { zeilen } = lies('image')
    const von = (name: string) => zeilen.find((z) => z.name === name)!
    expect(von('FLUX 3').familie).toBe(true)
    expect(von('FLUX 3').offen).toBe(false)
    expect(von('Cosmos 3 Super').offen).toBe(true)
    expect(von('Cosmos 3 Super').familie).toBe(false)
    expect(von('Z-Image Base').offen).toBe(true)
    expect(von('Flux Schnell (fast)').offen).toBe(true)
  })

  it('der geschlossene Waehler zeigt keine Marke: sie stehen nur in der aufgeklappten Liste', () => {
    useCreateStore.getState().setIntent('image')
    useCreateStore.setState({ cloudImageModel: 'z-image-turbo' })
    render(<ModelChip />)
    expect(screen.queryByText('Best')).toBeNull()
    expect(screen.queryByText('Open weights')).toBeNull()
    expect(screen.queryByText(OLDER_GROUP)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByText('Best').length).toBeGreaterThan(0)
  })
})

describe('die anderen Waehler (neuer Server)', () => {
  it('Bearbeiten: Beste oben, geschlossene tragen nur "Best" und keine Herkunft', () => {
    const erwartet = sortByTier(editCapableModels())
    const { zeilen } = lies('edit')
    expect(zeilen.map((z) => z.name)).toEqual(erwartet.map((m) => m.label))
    const seedream = zeilen.find((z) => z.name === 'Seedream 5 Pro')!
    expect(seedream.best).toBe(true)
    expect(seedream.offen).toBe(false)
    expect(zeilen.at(-1)!.name).toBe('Qwen Image Edit (no mask needed)')
  })

  it('Video: die neuen Modelle stehen im Waehler, die alten Wan, LTX und Hunyuan unten', () => {
    const erwartet = sortByTier(videoPickerModels())
    const { zeilen } = lies('video')
    expect(zeilen.map((z) => z.name)).toEqual(erwartet.map((m) => m.label))
    expect(zeilen.slice(0, 3).every((z) => z.best)).toBe(true)
    const unten = zeilen.slice(-5).map((z) => z.name)
    expect(unten).toEqual(expect.arrayContaining(['Wan 2.2 720p', 'Wan 2.2 Fast', 'LTX 2.3']))
  })

  it('Animate: Referenzmodelle und die neuen Bild-zu-Video-Modelle sind waehlbar', () => {
    const erwartet = sortByTier(animatePickerModels())
    const { zeilen } = lies('animate')
    expect(zeilen.map((z) => z.name)).toEqual(erwartet.map((m) => m.label))
    for (const name of ['LTX 2.5', 'FLUX 3 Video', 'MiniMax H3 • Reference', 'Wan 3.0 • Reference', 'daVinci MagiHuman']) {
      expect(zeilen.map((z) => z.name), name).toContain(name)
    }
  })

  it('Enhance Image bekommt einen Waehler: Standard und SeedVR2', () => {
    const { zeilen } = lies('upscale')
    expect(zeilen.map((z) => z.name)).toEqual(['Standard', 'SeedVR2'])
    expect(zeilen[1].offen).toBe(true)
  })

  it('Musik: YuE2 steht neben den anderen', () => {
    const { zeilen } = lies('music')
    expect(zeilen.map((z) => z.name)).toContain('YuE2 (song from lyrics)')
  })
})

describe('gegen den Server von heute (ohne Stufe, ohne die neuen Modelle)', () => {
  beforeEach(() => { useCloudCatalogStore.setState({ models: alterServer() }) })

  it('der Bildwaehler steht neutral da: keine Marke, keine Zwischenzeile, Reihenfolge wie bisher', () => {
    const erwartet = [...cloudModelsFor('image'), ...studioOnlyImageModels()].map((m) => m.label)
    const { zeilen, kopf } = lies('image')
    expect(zeilen.map((z) => z.name)).toEqual(erwartet)
    expect(zeilen.length).toBeGreaterThan(5)
    for (const z of zeilen) {
      expect(z.best, z.name).toBe(false)
      expect(z.offen, z.name).toBe(false)
      expect(z.familie, z.name).toBe(false)
    }
    expect(kopf).toBeUndefined()
    expect(zeilen.map((z) => z.name)).not.toContain('FLUX 3')
  })

  it('Video, Animate und Bearbeiten stehen ebenso neutral, ohne ein neues Modell', () => {
    for (const intent of ['video', 'animate', 'edit'] as const) {
      cleanup()
      const { zeilen, kopf } = lies(intent)
      expect(zeilen.length, intent).toBeGreaterThan(1)
      for (const z of zeilen) expect(z.best || z.offen || z.familie, `${intent}/${z.name}`).toBe(false)
      expect(kopf, intent).toBeUndefined()
      expect(zeilen.map((z) => z.name), intent).not.toContain('LTX 2.5')
      expect(zeilen.map((z) => z.name), intent).not.toContain('Qwen Image 2.1 Edit')
    }
  })

  it('Enhance Image zeigt keinen Waehler, der nur den Standard enthielte', () => {
    // Der Waehler selbst listet "Standard" allein; der Composer blendet ihn dann aus
    // (Composer.tsx, showUpscalePicker). Hier: die Liste hat genau diesen einen Eintrag.
    const { zeilen } = lies('upscale')
    expect(zeilen.map((z) => z.name)).toEqual(['Standard'])
  })
})

describe('im und ueber dem Prompt-Feld steht nichts davon', () => {
  const lese = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('weder das Promptfeld noch der Composer kennen die Marken', () => {
    for (const rel of ['src/components/create/ui/PromptField.tsx', 'src/components/create/experimental/Composer.tsx']) {
      const src = lese(rel)
      expect(src, rel).not.toMatch(/tierMarks|model-tier|Open weights|Older models/)
      expect(src, rel).not.toMatch(/['"`>]Best['"`<]/)
    }
  })

  it('die Marken kommen nur aus dem Waehler und aus dem Modellfeld des Presets', () => {
    const treffer = ['src/components/create/experimental/ModelChip.tsx', 'src/components/create/experimental/PresetWorkshop.tsx']
    for (const rel of treffer) expect(lese(rel), rel).toMatch(/tierMarks/)
  })
})
