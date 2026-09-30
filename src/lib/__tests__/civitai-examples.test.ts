import { describe, it, expect, vi } from 'vitest'
import {
  applyExample, applyExampleToStore, examplePageUrl, examplesMediaFor, examplesUrl, findInstalledLora,
  fitsModelFamily, parseExamplesPage, thumbnailUrl,
  type ExampleStoreSetters,
} from '../civitai-examples'
import type { CivitaiRecipe } from '../civitai-image-meta'

/** Two images and a video as /api/v1/images lists them, plus one without generation data. */
const FEED = {
  items: [
    {
      id: 101, type: 'image', url: 'https://image.civitai.com/abc/uuid-1/width=1216/101.jpeg',
      width: 832, height: 1216, nsfwLevel: 'X', baseModel: 'Pony', username: 'maker',
      meta: {
        prompt: 'score_9, a knight <lora:armor_v2:0.7>', negativePrompt: 'blurry', sampler: 'DPM++ 2M Karras',
        steps: 28, cfgScale: 6.5, seed: 42, Size: '832x1216', 'Clip skip': 2,
        civitaiResources: [{ type: 'lora', modelVersionName: 'armor_v2', modelVersionId: 555, weight: 0.7 }],
      },
    },
    { id: 102, type: 'image', url: 'https://image.civitai.com/abc/uuid-2/original=true/102.png', meta: null },
    {
      id: 103, type: 'image', url: 'https://image.civitai.com/abc/uuid-3/width=1024/103.jpeg', baseModel: 'Flux.1 D',
      meta: { prompt: 'a lighthouse at dusk', steps: 20, cfgScale: 1 },
    },
    {
      id: 104, type: 'video', url: 'https://image.civitai.com/abc/uuid-4/original=true/104.mp4', baseModel: 'Wan Video 14B t2v',
      meta: { prompt: 'a cat running', negativePrompt: 'static', steps: 30, cfgScale: 5, seed: 7 },
    },
  ],
  metadata: { nextCursor: '0|1727600000' },
}

describe('examplesMediaFor', () => {
  it('every Create section with a prompt gets examples of its media', () => {
    expect(examplesMediaFor('image')).toBe('image')
    expect(examplesMediaFor('edit')).toBe('image')
    expect(examplesMediaFor('video')).toBe('video')
    expect(examplesMediaFor('animate')).toBe('video')
    expect(examplesMediaFor('extend')).toBe('video')
  })
  it('sections without a prompt, or without CivitAI examples, get none', () => {
    for (const i of ['removebg', 'upscale', 'eraser', 'music', 'character', 'lipsync', 'motion'] as const) {
      expect(examplesMediaFor(i)).toBeNull()
    }
  })
})

describe('examplesUrl', () => {
  it('asks for the generation data (withMeta) and sends only known parameters, on the configured mirror', () => {
    const u = new URL(examplesUrl({ host: 'civitai.red', sort: 'Most Reactions', period: 'Week', nsfw: 'X', cursor: '0|1' }))
    expect(u.host).toBe('civitai.red')
    expect(u.pathname).toBe('/api/v1/images')
    expect(Object.fromEntries(u.searchParams)).toEqual({ limit: '100', sort: 'Most Reactions', period: 'Week', nsfw: 'X', withMeta: 'true', cursor: '0|1' })
  })
  it('any other host falls back to civitai.com, and limit stays in 1…200', () => {
    const u = new URL(examplesUrl({ host: 'evil.example', sort: 'Newest', period: 'Day', nsfw: 'None', limit: 999 }))
    expect(u.host).toBe('civitai.com')
    expect(u.searchParams.get('limit')).toBe('200')
  })
})

describe('thumbnailUrl', () => {
  it('asks the CDN for a 450 px still; videos get their first frame', () => {
    expect(thumbnailUrl('https://image.civitai.com/a/u/width=1216/1.jpeg', 'image')).toBe('https://image.civitai.com/a/u/width=450/1.jpeg')
    expect(thumbnailUrl('https://image.civitai.com/a/u/original=true/2.mp4', 'video')).toBe('https://image.civitai.com/a/u/anim=false,width=450/2.mp4')
    expect(thumbnailUrl('https://image.civitai.com/a/u/anim=true,width=720/2.mp4', 'video')).toBe('https://image.civitai.com/a/u/anim=false,width=450/2.mp4')
  })
  it('leaves a URL without a transform segment alone', () => {
    expect(thumbnailUrl('https://cdn.example/pics/3.jpeg', 'image')).toBe('https://cdn.example/pics/3.jpeg')
  })
})

describe('parseExamplesPage', () => {
  it('keeps images with generation data, drops the rest, reads the cursor', () => {
    const page = parseExamplesPage(FEED, 'image')
    expect(page.items.map((x) => x.id)).toEqual([101, 103])
    expect(page.rawCount).toBe(4)
    expect(page.nextCursor).toBe('0|1727600000')
    const knight = page.items[0]
    expect(knight.baseModel).toBe('Pony')
    expect(knight.recipe.baseModel).toBe('Pony')
    expect(knight.thumbUrl).toContain('/width=450/')
    expect(knight.recipe.prompt).toBe('score_9, a knight')
    expect(knight.recipe.loras).toEqual([{ name: 'armor_v2', weight: 0.7, versionId: 555 }])
  })
  it('a video section gets only the videos', () => {
    const page = parseExamplesPage(FEED, 'video')
    expect(page.items.map((x) => x.id)).toEqual([104])
    expect(page.items[0].thumbUrl).toContain('/anim=false,width=450/')
  })
  it('survives a broken answer', () => {
    expect(parseExamplesPage(null, 'image')).toEqual({ items: [], rawCount: 0 })
    expect(parseExamplesPage({ items: 'x' }, 'image')).toEqual({ items: [], rawCount: 0 })
  })
})

describe('fitsModelFamily', () => {
  const [knight, lighthouse] = parseExamplesPage(FEED, 'image').items
  it('Pony is SDXL, FLUX.1 is flux', () => {
    expect(fitsModelFamily(knight, 'sdxl')).toBe(true)
    expect(fitsModelFamily(knight, 'flux')).toBe(false)
    expect(fitsModelFamily(lighthouse, 'flux')).toBe(true)
  })
  it('an unknown model family keeps everything', () => {
    expect(fitsModelFamily(knight, 'unknown')).toBe(true)
    expect(fitsModelFamily(knight, undefined)).toBe(true)
  })
})

describe('findInstalledLora', () => {
  it('matches by file-name stem, exact first', () => {
    expect(findInstalledLora('armor_v2', ['loras/Armor-V2.safetensors'])).toBe('loras/Armor-V2.safetensors')
    expect(findInstalledLora('armor', ['armor_v2.safetensors', 'armor.safetensors'])).toBe('armor.safetensors')
  })
  it('a name without letters or digits matches nothing', () => {
    expect(findInstalledLora('★★', ['anything.safetensors'])).toBeUndefined()
  })
})

const RECIPE: CivitaiRecipe = {
  imageId: 101, prompt: 'a knight', negativePrompt: 'blurry',
  sampler: 'dpmpp_2m', scheduler: 'karras', samplerLabel: 'DPM++ 2M Karras',
  steps: 28, cfg: 6.5, seed: 42, width: 832, height: 1216, clipSkip: 2, baseModel: 'Pony',
  loras: [{ name: 'armor_v2', weight: 0.7, versionId: 555 }, { name: 'missing_one', weight: 3 }],
}
const CTX = { samplers: ['euler', 'dpmpp_2m'], schedulers: ['normal', 'karras'], installedLoras: ['armor_v2.safetensors'] }

describe('applyExample', () => {
  it('Image section: prompt, settings, size, clip skip and installed LoRAs', () => {
    const a = applyExample(RECIPE, { ...CTX, intent: 'image', modelType: 'sdxl' })
    expect(a).toMatchObject({
      prompt: 'a knight', negativePrompt: 'blurry', sampler: 'dpmpp_2m', scheduler: 'karras',
      steps: 28, cfg: 6.5, seed: 42, clipSkip: 2, size: { width: 832, height: 1216 },
      loras: [{ name: 'armor_v2.safetensors', strength: 0.7 }],
    })
    expect(a.missingLoras.map((l) => l.name)).toEqual(['missing_one'])
    expect(a.skipped).toEqual([])
    expect(a.notes).toEqual([])
  })
  it('Edit keeps the size of its source', () => {
    const a = applyExample(RECIPE, { ...CTX, intent: 'edit' })
    expect(a.size).toBeUndefined()
    expect(a.skipped.join()).toMatch(/size 832×1216/)
  })
  it('a sampler this ComfyUI does not list is not copied (it would be a 400)', () => {
    const a = applyExample(RECIPE, { ...CTX, intent: 'image', samplers: ['euler'], schedulers: ['normal'] })
    expect(a.sampler).toBeUndefined()
    expect(a.scheduler).toBeUndefined()
    expect(a.skipped.join()).toMatch(/does not have it/)
    const off = applyExample(RECIPE, { ...CTX, intent: 'image', samplers: [], schedulers: [] })
    expect(off.skipped.join()).toMatch(/not running/)
  })
  it('video sections take prompt, negative and seed only', () => {
    const a = applyExample(RECIPE, { ...CTX, intent: 'video' })
    expect(a).toMatchObject({ prompt: 'a knight', negativePrompt: 'blurry', seed: 42 })
    expect(a.steps).toBeUndefined()
    expect(a.sampler).toBeUndefined()
    expect(a.loras).toEqual([])
    expect(a.skipped.join()).toMatch(/video model/)
  })
  it('another family is a note, not a refusal', () => {
    const a = applyExample(RECIPE, { ...CTX, intent: 'image', modelType: 'flux' })
    expect(a.prompt).toBe('a knight')
    expect(a.notes.join()).toMatch(/Pony \(SDXL\)/)
  })
  it('clamps to what the store accepts', () => {
    const a = applyExample({ ...RECIPE, steps: 900, cfg: 99, clipSkip: 40, loras: [{ name: 'armor_v2', weight: 5 }] }, { ...CTX, intent: 'image' })
    expect(a.steps).toBe(200)
    expect(a.cfg).toBe(30)
    expect(a.clipSkip).toBe(12)
    expect(a.loras[0].strength).toBe(2)
  })
})

describe('applyExampleToStore', () => {
  const setters = (showNegative = false): ExampleStoreSetters => ({
    showNegative,
    setPrompt: vi.fn(), setNegativePrompt: vi.fn(), toggleNegative: vi.fn(),
    setSampler: vi.fn(), setScheduler: vi.fn(), setSteps: vi.fn(), setCfgScale: vi.fn(),
    setSeed: vi.fn(), setClipSkip: vi.fn(), setSize: vi.fn(),
    clearLoras: vi.fn(), toggleLora: vi.fn(), setLoraStrengthFor: vi.fn(),
  })

  it('writes every copied field and opens the negative field when there is one', () => {
    const st = setters()
    applyExampleToStore(applyExample(RECIPE, { ...CTX, intent: 'image' }), st, true)
    expect(st.setPrompt).toHaveBeenCalledWith('a knight')
    expect(st.setNegativePrompt).toHaveBeenCalledWith('blurry')
    expect(st.toggleNegative).toHaveBeenCalledOnce()
    expect(st.setSize).toHaveBeenCalledWith(832, 1216)
    expect(st.setClipSkip).toHaveBeenCalledWith(2)
    expect(st.clearLoras).toHaveBeenCalledOnce()
    expect(st.toggleLora).toHaveBeenCalledWith('armor_v2.safetensors')
    expect(st.setLoraStrengthFor).toHaveBeenCalledWith('armor_v2.safetensors', 0.7)
  })
  it('an example without LoRAs leaves the user\'s LoRA pick alone; an open negative stays open', () => {
    const st = setters(true)
    applyExampleToStore(applyExample({ ...RECIPE, loras: [] }, { ...CTX, intent: 'image' }), st, false)
    expect(st.clearLoras).not.toHaveBeenCalled()
    expect(st.toggleNegative).not.toHaveBeenCalled()
  })
})

describe('examplePageUrl', () => {
  it('links the example on the mirror it came from', () => {
    expect(examplePageUrl(101, 'civitai.red')).toBe('https://civitai.red/images/101')
    expect(examplePageUrl(101, 'x.example')).toBe('https://civitai.com/images/101')
  })
})
