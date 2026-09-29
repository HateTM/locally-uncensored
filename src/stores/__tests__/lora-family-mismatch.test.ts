/**
 * A LoRA CivitAI says was trained for another model family adds nothing to
 * the prompt and is named instead (FINDINGS 25): ComfyUI loads it with
 * "lora key not loaded" and no effect, so its trigger words would only steer
 * the prompt.
 *
 * Run: npx vitest run src/stores/__tests__/lora-family-mismatch.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useLoraInfoStore, applyLoraPrompts, loraMismatchNote } from '../loraInfoStore'
import { isLightningMerge, LIGHTNING_SAMPLING } from '../../api/comfyui'

beforeEach(() => {
  useLoraInfoStore.setState({
    known: {
      'sd15_style.safetensors': { triggers: ['sd15style'], baseModel: 'SD 1.5', file: 'sd15_style.safetensors' },
      'pony_style.safetensors': { triggers: ['ponystyle'], baseModel: 'Pony', file: 'pony_style.safetensors' },
      'a14b_motion.safetensors': { triggers: ['a14bmotion'], baseModel: 'Wan Video 2.2 I2V-A14B', file: 'a14b_motion.safetensors' },
    },
    prompts: { 'sd15_style.safetensors': { prompt: '', negative: 'sd15neg' } },
  })
})

describe('applyLoraPrompts with the model family', () => {
  it('leaves out the prompt words and negative of a LoRA for another family, and names it', () => {
    const r = applyLoraPrompts('a cat', 'lowres', ['sd15_style', 'pony_style'], 'sdxl')
    expect(r.prompt).toBe('ponystyle, a cat')
    expect(r.negative).toBe('lowres')
    expect(r.mismatched).toEqual([{ lora: 'sd15_style', baseModel: 'SD 1.5' }])
  })

  it('keeps a Wan 2.2 A14B LoRA on a Rapid AIO merge (family wan)', () => {
    const r = applyLoraPrompts('she turns', '', ['a14b_motion'], 'wan')
    expect(r.prompt).toBe('a14bmotion, she turns')
    expect(r.mismatched).toEqual([])
  })

  it('without a family nothing is filtered, as before', () => {
    const r = applyLoraPrompts('a cat', 'lowres', ['sd15_style'])
    expect(r.prompt).toBe('sd15style, a cat')
    expect(r.negative).toBe('lowres, sd15neg')
    expect(r.mismatched).toEqual([])
  })

  it('a LoRA LU knows nothing about is applied, not refused', () => {
    expect(applyLoraPrompts('x', '', ['mystery'], 'sdxl').mismatched).toEqual([])
  })
})

describe('loraMismatchNote', () => {
  it('is empty without a mismatch and names each LoRA with its base otherwise', () => {
    expect(loraMismatchNote([], 'juggernaut.safetensors')).toBe('')
    const note = loraMismatchNote([{ lora: 'sd15_style', baseModel: 'SD 1.5' }], 'juggernaut.safetensors')
    expect(note).toContain('juggernaut.safetensors')
    expect(note).toContain('sd15_style (SD 1.5)')
  })
})

describe('isLightningMerge', () => {
  it('knows the rapid / lightning / lightx2v merges and nothing else', () => {
    for (const m of ['wan2.2-i2v-rapid-aio-v10.safetensors', 'Wan2.2_Lightning_I2V.gguf', 'wan_lightx2v_4step.safetensors']) {
      expect(isLightningMerge(m), m).toBe(true)
    }
    for (const m of ['wan2.2_ti2v_5B_fp16.safetensors', 'wan2.1_t2v_14B_fp8.safetensors']) {
      expect(isLightningMerge(m), m).toBe(false)
    }
    expect(LIGHTNING_SAMPLING).toEqual({ steps: 6, cfg: 1 })
  })
})
