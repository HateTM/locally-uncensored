import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { estimateTokens } from '../token-estimate'
import { estimateTokens as reExported } from '../context-compaction'

/**
 * Real token counts of the fixtures, from the Qwen 2.5 tokenizer
 * (@lenml/tokenizer-qwen2_5 3.7.2, encode() without special tokens), measured
 * 2026-09-29 when the estimator stopped being chars / 4 (FINDINGS 15). The
 * fixtures are ~3000 chars each: English and German prose from this repo,
 * Russian prose from docs/blog, TypeScript, pretty and compact JSON.
 */
const QWEN_TOKENS: Record<string, number> = {
  'en.txt': 789,
  'de.txt': 896,
  'ru.txt': 1144,
  'ts.txt': 908,
  'json-pretty.txt': 1214,
  'json-compact.txt': 921,
}

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures', 'token-estimate', name), 'utf8')

const oldEstimate = (t: string) => Math.ceil(t.length / 4) + 1

describe('estimateTokens against a real tokenizer', () => {
  for (const [name, real] of Object.entries(QWEN_TOKENS)) {
    it(`${name}: within -10 % … +20 % of Qwen 2.5`, () => {
      const ratio = estimateTokens(fixture(name)) / real
      expect(ratio).toBeGreaterThanOrEqual(0.9)
      expect(ratio).toBeLessThanOrEqual(1.2)
    })
  }

  it('Russian prose and JSON were the texts chars / 4 under-read by a third', () => {
    // The reason the trim fired past the window (FINDINGS 15). Pinned so a
    // revert to chars / 4 is a red test that names what it breaks.
    for (const name of ['ru.txt', 'json-pretty.txt']) {
      expect(oldEstimate(fixture(name)) / QWEN_TOKENS[name]).toBeLessThan(0.7)
      expect(estimateTokens(fixture(name)) / QWEN_TOKENS[name]).toBeGreaterThan(0.9)
    }
  })
})

describe('estimateTokens pieces', () => {
  it('never returns less than 1', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('   ')).toBeGreaterThanOrEqual(1)
  })

  it('prices a digit as a token of its own', () => {
    expect(estimateTokens('1234567890')).toBe(11)
  })

  it('a Cyrillic word costs more than a Latin word of the same length', () => {
    expect(estimateTokens('программирование')).toBeGreaterThan(estimateTokens('programmierungen'))
  })

  it('indentation is one piece, not one token per space', () => {
    const indented = estimateTokens('a\n' + ' '.repeat(40) + 'b')
    expect(indented).toBeLessThan(estimateTokens('a b') + 3)
  })

  it('handles emoji and mixed scripts without throwing', () => {
    expect(estimateTokens('GPUшка 🚀 → ok')).toBeGreaterThan(3)
  })

  it('grows with the text', () => {
    expect(estimateTokens('hello '.repeat(100))).toBeGreaterThan(estimateTokens('hello'))
  })

  it('is fast enough for the meter over a whole history', () => {
    const big = fixture('ts.txt').repeat(300) // ~900 000 chars
    const t0 = performance.now()
    estimateTokens(big)
    expect(performance.now() - t0).toBeLessThan(500)
  })

  it('context-compaction re-exports the same function', () => {
    expect(reExported).toBe(estimateTokens)
  })
})
