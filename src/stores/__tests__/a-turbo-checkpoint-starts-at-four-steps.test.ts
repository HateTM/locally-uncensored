/**
 * 3.0.4 Gegenprobe on the Windows box (02.10.2026): sd_turbo started at the SD
 * family's 25 steps. Distilled checkpoints run at a few steps and CFG 1.
 *
 * Run: npx vitest run src/stores/__tests__/a-turbo-checkpoint-starts-at-four-steps.test.ts
 */
import { describe, it, expect } from 'vitest'
import { useCreateStore, distilledImageCheckpoint, MODEL_TYPE_DEFAULTS } from '../createStore'

describe('distilled image checkpoints', () => {
  it('Turbo, Lightning, Hyper and LCM files of the SD families are recognised', () => {
    for (const n of ['sd_turbo.safetensors', 'sdxl_turbo_1.0_fp16.safetensors', 'juggernautXL_v9Rdphoto2Lightning.safetensors', 'Hyper-SDXL-8steps.safetensors', 'dreamshaper_8_LCM.safetensors']) {
      expect(distilledImageCheckpoint(n, 'sdxl')).toBe(true)
    }
  })

  it('leaves ordinary checkpoints and other families alone', () => {
    expect(distilledImageCheckpoint('juggernautXL_v9.safetensors', 'sdxl')).toBe(false)
    expect(distilledImageCheckpoint('turbovision_xl.safetensors', 'sdxl')).toBe(false)
    expect(distilledImageCheckpoint('z_image_turbo_bf16.safetensors', 'zimage')).toBe(false)
  })

  it('picking sd_turbo sets 4 steps at CFG 1, a plain checkpoint keeps the family defaults', () => {
    useCreateStore.getState().setImageModel('sd_turbo.safetensors', 'sd15')
    expect(useCreateStore.getState()).toMatchObject({ steps: 4, cfgScale: 1 })
    useCreateStore.getState().setImageModel('juggernautXL_v9.safetensors', 'sdxl')
    expect(useCreateStore.getState()).toMatchObject({ steps: MODEL_TYPE_DEFAULTS.sdxl.steps, cfgScale: MODEL_TYPE_DEFAULTS.sdxl.cfgScale })
  })
})
