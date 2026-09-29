/**
 * The A/B Compare numbers measure generation, not model loading (FINDINGS 17).
 *
 * Run: npx vitest run src/lib/__tests__/compare-stats.test.ts
 */
import { describe, expect, it } from 'vitest'
import { compareStats } from '../compare-stats'

describe('compareStats', () => {
  it('leaves a model load out of the speed', () => {
    // 8 s of load, then 100 chunks over 5 s. The old formula said 100 / 13 s.
    const s = compareStats({ startedAt: 0, firstChunkAt: 8_000, endedAt: 13_000, chunks: 100 })
    expect(s.tokensPerSec).toBeCloseTo(20, 5)
    expect(s.timeMs).toBe(13_000)
    expect(s.firstTokenMs).toBe(8_000)
    expect(s.source).toBe('estimate')
  })

  it('trusts the backend counters when there are any (Ollama)', () => {
    const s = compareStats({ startedAt: 0, firstChunkAt: 8_000, endedAt: 13_000, chunks: 40, evalCount: 120, evalDurationMs: 4_000 })
    expect(s.tokens).toBe(120)
    expect(s.tokensPerSec).toBeCloseTo(30, 5)
    expect(s.source).toBe('server')
  })

  it('uses a server token count without a duration, timing from the first chunk (Anthropic)', () => {
    // A cloud stream batches tokens: 20 chunks, 200 tokens.
    const s = compareStats({ startedAt: 0, firstChunkAt: 1_000, endedAt: 5_000, chunks: 20, evalCount: 200 })
    expect(s.tokens).toBe(200)
    expect(s.tokensPerSec).toBeCloseTo(50, 5)
    expect(s.source).toBe('estimate')
  })

  it('reports no speed for a side that produced nothing', () => {
    const s = compareStats({ startedAt: 0, firstChunkAt: null, endedAt: 3_000, chunks: 0 })
    expect(s.tokensPerSec).toBe(0)
    expect(s.firstTokenMs).toBeUndefined()
    expect(s.tokens).toBe(0)
  })
})
