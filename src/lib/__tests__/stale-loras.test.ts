import { describe, it, expect } from 'vitest'
import { staleSelectedLoras } from '../stale-loras'

describe('staleSelectedLoras', () => {
  it('names a selected LoRA ComfyUI no longer lists (a Character Studio LoRA from another install)', () => {
    expect(staleSelectedLoras(
      [{ name: 'char_angel_zimage.safetensors' }, { name: 'undressing_flux_v3.safetensors' }],
      ['undressing_flux_v3.safetensors'],
      true,
    )).toEqual(['char_angel_zimage.safetensors'])
  })
  it('an empty install with ComfyUI up: every selected LoRA is missing', () => {
    expect(staleSelectedLoras([{ name: 'a.safetensors' }], [], true)).toEqual(['a.safetensors'])
  })
  it('ComfyUI down and no list: nothing is flagged, the list is simply unknown', () => {
    expect(staleSelectedLoras([{ name: 'a.safetensors' }], [], false)).toEqual([])
  })
  it('nothing selected, nothing missing', () => {
    expect(staleSelectedLoras([], ['a.safetensors'], true)).toEqual([])
  })
})
