import { describe, expect, it } from 'vitest'
import { civitaiFamily, loraFitsModel } from '../civitai-base-models'

const fam = (b: string | undefined) => {
  const f = civitaiFamily(b)
  return f.supported ? f.family : null
}

describe('civitaiFamily', () => {
  it('maps the SDXL finetunes onto SDXL', () => {
    for (const b of ['SDXL 1.0', 'Pony', 'Illustrious', 'NoobAI', 'SDXL Lightning']) expect(fam(b)).toBe('sdxl')
  })

  it('maps the image families LU runs locally', () => {
    expect(fam('SD 1.5')).toBe('sd15')
    expect(fam('Flux.1 D')).toBe('flux')
    expect(fam('Flux.2 Klein 4B')).toBe('flux2')
    expect(fam('Krea 2')).toBe('krea2')
    expect(fam('ZImageTurbo')).toBe('zimage')
    expect(fam('Qwen 2.1')).toBe('qwenimage')
    expect(fam('Chroma')).toBe('chroma')
    expect(fam('SD 3.5 Large')).toBe('sd3')
  })

  it('maps the video families LU runs locally', () => {
    expect(fam('Wan Video 14B i2v 480p')).toBe('wan')
    expect(fam('Wan Video 2.2 TI2V-5B')).toBe('wan22')
    expect(fam('SVD XT')).toBe('svd')
  })

  it('says why the families that do not run locally are left out', () => {
    // FINDINGS 23: the local graphs for these do not match ComfyUI yet.
    for (const b of ['LTXV', 'LTXV 2.5', 'Hunyuan Video']) {
      const f = civitaiFamily(b)
      expect(f.supported).toBe(false)
      if (!f.supported) expect(f.reason).toMatch(/not|no local/i)
    }
    // Pony V7 is AuraFlow, not SDXL, although it is called Pony.
    expect(fam('Pony V7')).toBeNull()
  })

  it('names the base model it does not know, and handles none at all', () => {
    const f = civitaiFamily('Kling')
    expect(f).toEqual({ supported: false, reason: 'LU has no local pipeline for Kling' })
    expect(civitaiFamily(undefined).supported).toBe(false)
    expect(civitaiFamily('  ').supported).toBe(false)
  })
})

describe('loraFitsModel: only a certain mismatch refuses', () => {
  it('a LoRA of another supported family does not fit', () => {
    expect(loraFitsModel('SD 1.5', 'sdxl')).toBe(false)
    expect(loraFitsModel('Flux.1 D', 'sdxl')).toBe(false)
    expect(loraFitsModel('Wan Video 14B i2v 720p', 'wan22')).toBe(false)
  })

  it('the same family fits, SDXL finetunes included', () => {
    expect(loraFitsModel('Pony', 'sdxl')).toBe(true)
    expect(loraFitsModel('Illustrious', 'sdxl')).toBe(true)
    expect(loraFitsModel('Flux.1 D', 'flux')).toBe(true)
  })

  it('Wan 2.2 A14B LoRAs still fit a Rapid AIO merge, which classifies as wan', () => {
    expect(loraFitsModel('Wan Video 2.2 I2V-A14B', 'wan')).toBe(true)
    expect(loraFitsModel('Wan Video 2.2 T2V-A14B', 'wan')).toBe(true)
  })

  it('an unknown side is never a reason to refuse', () => {
    expect(loraFitsModel(undefined, 'sdxl')).toBe(true)
    expect(loraFitsModel('', 'sdxl')).toBe(true)
    expect(loraFitsModel('Some Future Base', 'sdxl')).toBe(true)
    expect(loraFitsModel('SD 1.5', undefined)).toBe(true)
    expect(loraFitsModel('SD 1.5', 'unknown')).toBe(true)
  })
})
