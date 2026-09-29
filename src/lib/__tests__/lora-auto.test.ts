/**
 * A LoRA's saved prompt, or its CivitAI trigger words, go in front of every
 * prompt that uses it; its saved negative goes after the negative
 * (lib/lora-auto.ts).
 *
 * Run: npx vitest run src/lib/__tests__/lora-auto.test.ts
 */
import { describe, it, expect } from 'vitest'
import { withLoraPrompts, withLoraNegatives, triggerClause, parseLoraPrompts, loraAddition, type LoraPrompt } from '../lora-auto'
import type { LoraInfo } from '../lora-triggers'

const saved: Record<string, LoraPrompt> = {
  'reverse_cowgirl_high.safetensors': { prompt: 'reverse cowgirl, a woman facing away', negative: 'extra limbs' },
  'fov_slider.safetensors': { prompt: 'the camera zooms out, then pushes in', keepFullPrompt: true },
  'neg_only.safetensors': { prompt: '', negative: 'blurry hands' },
}
const known: Record<string, LoraInfo> = {
  'pixel_art_xl.safetensors': { triggers: ['pixel art', 'pixelated', '8bit', 'retro', 'sprite'] },
  'neg_only.safetensors': { triggers: ['negonly'] },
}

describe('triggerClause', () => {
  it('is the text before the first comma or semicolon', () => {
    expect(triggerClause('softcore photoshoot, a woman on a bed')).toBe('softcore photoshoot')
    expect(triggerClause('a; b, c')).toBe('a')
    expect(triggerClause('just one')).toBe('just one')
  })
})

describe('withLoraPrompts', () => {
  it('a saved prompt contributes its first clause', () => {
    expect(withLoraPrompts('a beach at dusk', ['reverse_cowgirl_high.safetensors'], saved, known))
      .toBe('reverse cowgirl, a beach at dusk')
  })
  it('keepFullPrompt keeps the whole text', () => {
    expect(withLoraPrompts('x', ['fov_slider'], saved, known)).toBe('the camera zooms out, then pushes in, x')
  })
  it('without a saved prompt the first three trigger words are used', () => {
    expect(withLoraPrompts('a castle', ['pixel_art_xl'], saved, known)).toBe('pixel art, pixelated, 8bit, a castle')
  })
  it('a saved entry with only a negative falls back to the trigger words', () => {
    expect(loraAddition('neg_only.safetensors', saved, known)).toBe('negonly')
  })
  it('several LoRAs join with "; "', () => {
    expect(withLoraPrompts('x', ['reverse_cowgirl_high', 'pixel_art_xl'], saved, known))
      .toBe('reverse cowgirl; pixel art, pixelated, 8bit, x')
  })
  it('does not add what the prompt already says', () => {
    expect(withLoraPrompts('Reverse-Cowgirl on a bed', ['reverse_cowgirl_high'], saved, known)).toBe('Reverse-Cowgirl on a bed')
  })
  it('an unknown LoRA changes nothing', () => {
    expect(withLoraPrompts('x', ['nobody_knows'], saved, known)).toBe('x')
  })
  it('an empty prompt becomes just the additions', () => {
    expect(withLoraPrompts('', ['reverse_cowgirl_high'], saved, known)).toBe('reverse cowgirl')
  })
})

describe('withLoraNegatives', () => {
  it('appends each saved negative once', () => {
    expect(withLoraNegatives('lowres', ['reverse_cowgirl_high', 'neg_only'], saved)).toBe('lowres, extra limbs, blurry hands')
    expect(withLoraNegatives('', ['neg_only'], saved)).toBe('blurry hands')
    expect(withLoraNegatives('blurry hands, text', ['neg_only'], saved)).toBe('blurry hands, text')
  })
})

describe('parseLoraPrompts', () => {
  it('reads the {file: prompt} shape', () => {
    const r = parseLoraPrompts({ 'A.safetensors': 'alpha, beta', 'b.safetensors': 7 })
    expect(r).toEqual({ prompts: { 'a.safetensors': { prompt: 'alpha, beta' } }, dropped: 1 })
  })
  it('reads the entry-list shape with negatives', () => {
    const r = parseLoraPrompts({ entries: [
      { file: 'x.safetensors', prompt: 'p', negative: 'n', keepFullPrompt: true },
      { file: 'y.safetensors' },
    ] })
    expect(r).toEqual({ prompts: { 'x.safetensors': { prompt: 'p', negative: 'n', keepFullPrompt: true } }, dropped: 1 })
  })
  it('refuses something that is neither', () => {
    expect(typeof parseLoraPrompts('nope')).toBe('string')
  })
})
