import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileFormat } from '../model-file-format'

describe('the model card names the real file format', () => {
  it('reads the ending of a .ckpt motion module', () => {
    expect(fileFormat({ name: 'v3_sd15_mm.ckpt' })).toBe('ckpt')
    expect(fileFormat({ name: 'animatediff/v3_sd15_mm.CKPT' })).toBe('ckpt')
  })

  it('keeps a format someone already set', () => {
    expect(fileFormat({ name: 'flux1-dev-Q4_K_S.gguf', format: 'GGUF Q4' })).toBe('GGUF Q4')
  })

  it('shows nothing rather than a guess when the name has no ending', () => {
    expect(fileFormat({ name: 'some-model' })).toBe('')
  })

  it('the card no longer falls back to the word safetensors', () => {
    const card = readFileSync('src/components/models/ModelCard.tsx', 'utf8')
    expect(card).not.toMatch(/\|\|\s*'safetensors'/)
    expect(card).toContain('fileFormat(model)')
  })
})
