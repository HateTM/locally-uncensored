/**
 * "Make it like this CivitAI image": the recipe from /api/v1/images.
 *
 * The answers below follow the documented shape of CivitAI's public API
 * (items[].meta with prompt, negativePrompt, sampler, cfgScale, steps, seed,
 * Size, civitaiResources / resources). They were written by hand, not
 * recorded from a live call.
 *
 * Run: npx vitest run src/lib/__tests__/civitai-image-meta.test.ts
 */
import { describe, it, expect } from 'vitest'
import { civitaiImageId, civitaiHostOf, translateSampler, parseCivitaiImage } from '../civitai-image-meta'

describe('the link', () => {
  it('finds the id on either host, or takes a bare number', () => {
    expect(civitaiImageId('https://civitai.red/images/143926964')).toBe(143926964)
    expect(civitaiImageId('civitai.com/images/42?postId=1')).toBe(42)
    expect(civitaiImageId('143926964')).toBe(143926964)
    expect(civitaiImageId('https://civitai.com/models/5')).toBeNull()
  })
  it('keeps the mirror the link names', () => {
    expect(civitaiHostOf('https://civitai.red/images/1')).toBe('civitai.red')
    expect(civitaiHostOf('143')).toBeNull()
  })
})

describe('translateSampler', () => {
  it.each([
    ['DPM++ 2M Karras', undefined, { sampler: 'dpmpp_2m', scheduler: 'karras' }],
    ['Euler a', undefined, { sampler: 'euler_ancestral' }],
    ['DPM++ 2M SDE', 'Exponential', { sampler: 'dpmpp_2m_sde', scheduler: 'exponential' }],
    ['euler_ancestral', undefined, { sampler: 'euler_ancestral' }],
    ['Some Future Sampler', undefined, {}],
  ])('%s', (label, sched, want) => {
    expect(translateSampler(label, sched)).toEqual(want)
  })
})

describe('parseCivitaiImage', () => {
  const answer = {
    items: [{
      id: 143926964,
      meta: {
        prompt: 'masterpiece, 1girl, <lora:detail_tweaker:0.6>, neon city, rain',
        negativePrompt: 'lowres, bad hands',
        sampler: 'DPM++ 2M Karras',
        cfgScale: 5.5,
        steps: 30,
        seed: 123456789,
        Size: '832x1216',
        'Clip skip': 2,
        Model: 'ponyDiffusionV6XL',
        civitaiResources: [
          { type: 'checkpoint', modelVersionId: 290640, modelVersionName: 'V6 (start with this one)' },
          { type: 'lora', modelVersionId: 62833, modelVersionName: 'Neon Style', weight: 0.8 },
        ],
      },
    }],
  }

  it('reads every setting and translates the sampler', () => {
    expect(parseCivitaiImage(answer)).toEqual({
      imageId: 143926964,
      prompt: 'masterpiece, 1girl, neon city, rain',
      negativePrompt: 'lowres, bad hands',
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      samplerLabel: 'DPM++ 2M Karras',
      steps: 30,
      cfg: 5.5,
      seed: 123456789,
      width: 832,
      height: 1216,
      clipSkip: 2,
      checkpoint: 'ponyDiffusionV6XL',
      checkpointVersionId: 290640,
      loras: [
        { name: 'Neon Style', weight: 0.8, versionId: 62833 },
        { name: 'detail_tweaker', weight: 0.6 },
      ],
    })
  })

  it('takes the LoRAs from the A1111 resources list when there are no civitaiResources', () => {
    const r = parseCivitaiImage({ items: [{ id: 1, meta: { prompt: 'a cat', resources: [{ type: 'lora', name: 'catstyle', weight: 0.7 }, { type: 'model', name: 'sdxl_base' }] } }] })
    expect(r?.loras).toEqual([{ name: 'catstyle', weight: 0.7 }])
    expect(r?.checkpoint).toBe('sdxl_base')
  })

  it('reads a meta block nested one level deeper', () => {
    expect(parseCivitaiImage({ items: [{ id: 2, meta: { meta: { prompt: 'x', steps: '20' } } }] })?.steps).toBe(20)
  })

  it('an image without generation data is null, not an empty recipe', () => {
    expect(parseCivitaiImage({ items: [{ id: 3, meta: null }] })).toBeNull()
    expect(parseCivitaiImage({ items: [] })).toBeNull()
    expect(parseCivitaiImage({ items: [{ id: 4, meta: { steps: 20 } }] })).toBeNull()
  })
})
