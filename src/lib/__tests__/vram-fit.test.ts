/**
 * The Discover fit hint counts the KV cache the way the LU Engine does
 * (plan_offload in src-tauri/src/commands/engine.rs).
 *
 * Run: npx vitest run src/lib/__tests__/vram-fit.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { estimateLayers, kvCacheGb, engineCtx, KV_MIB_PER_LAYER_PER_1K, DEFAULT_FIT_CTX } from '../vram-fit'
import { ENGINE_DEFAULT_CTX } from '../builtin-ctx'

describe('estimateLayers', () => {
  it('lands near the real layer counts of the common Q4 chat models', () => {
    const near = (sizeGB: number, real: number) =>
      expect(Math.abs(estimateLayers(sizeGB) - real), `${sizeGB} GB`).toBeLessThanOrEqual(real * 0.2)
    near(4.4, 28)   // Qwen 2.5 7B Q4_K_M
    near(4.9, 32)   // Llama 3.1 8B
    near(7.1, 40)   // Mistral Nemo 12B
    near(40, 80)    // Llama 3.x 70B
  })
})

describe('kvCacheGb', () => {
  it('is 4 MiB per layer per started 1K tokens', () => {
    const layers = estimateLayers(5)
    expect(kvCacheGb(5, 8192)).toBeCloseTo((layers * 8 * 4) / 1024)
    // 8193 tokens pay for 9K, as in the engine.
    expect(kvCacheGb(5, 8193)).toBeCloseTo((layers * 9 * 4) / 1024)
    expect(kvCacheGb(5, 32768)).toBeCloseTo(kvCacheGb(5, 8192) * 4)
  })
})

describe('the numbers are the engine\'s', () => {
  const engine = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/engine.rs'), 'utf8')

  it('the cache rate matches KV_BYTES_PER_LAYER_PER_1K_CTX', () => {
    const m = /const KV_BYTES_PER_LAYER_PER_1K_CTX: u64 = (\d+) \* MIB;/.exec(engine)
    expect(m, 'KV_BYTES_PER_LAYER_PER_1K_CTX not found in engine.rs').not.toBeNull()
    expect(Number(m![1])).toBe(KV_MIB_PER_LAYER_PER_1K)
  })

  it('the default context matches the engine default', () => {
    expect(DEFAULT_FIT_CTX).toBe(ENGINE_DEFAULT_CTX)
  })
})

describe('engineCtx', () => {
  it('is the tuned context, or the engine default when none is set', () => {
    expect(engineCtx(32768)).toBe(32768)
    expect(engineCtx(0)).toBe(ENGINE_DEFAULT_CTX)
    expect(engineCtx(undefined)).toBe(ENGINE_DEFAULT_CTX)
    expect(engineCtx(null)).toBe(ENGINE_DEFAULT_CTX)
  })
})
