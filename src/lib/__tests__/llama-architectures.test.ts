import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LLAMA_ARCHITECTURES, LLAMA_ARCH_COMMIT, LLAMA_ARCH_TAG } from '../llama-architectures'
import { parsePinnedLlamaTag } from '../../api/gguf-arch'

const buildScript = readFileSync(join(__dirname, '../../../scripts/build-llama.sh'), 'utf8')

describe('the generated llama.cpp architecture list', () => {
  it('belongs to the llama.cpp revision build-llama.sh pins', () => {
    // A bump of LLAMA_TAG / LLAMA_COMMIT without regenerating the list would
    // let Discover offer (or hide) models by the OLD engine's abilities.
    // Fix: node scripts/gen-llama-architectures.mjs
    expect(LLAMA_ARCH_TAG).toBe(parsePinnedLlamaTag(buildScript))
    expect(buildScript).toContain(`LLAMA_COMMIT="\${LLAMA_COMMIT:-${LLAMA_ARCH_COMMIT}}"`)
  })

  it('is a real list, not an empty or truncated parse', () => {
    expect(LLAMA_ARCHITECTURES.size).toBeGreaterThan(50)
    for (const arch of ['llama', 'qwen2', 'qwen3', 'gemma3']) expect(LLAMA_ARCHITECTURES.has(arch)).toBe(true)
  })

  it('does not know glm5next, the architecture gguf-arch.ts was written about', () => {
    expect(LLAMA_ARCHITECTURES.has('glm5next')).toBe(false)
  })
})
