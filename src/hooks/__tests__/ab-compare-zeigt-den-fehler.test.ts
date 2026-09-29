// @vitest-environment jsdom
/**
 * Eine Seite des A/B-Vergleichs, die scheitert, sagt das (FINDINGS 17).
 *
 * Beide Streams endeten in `catch { /* aborted or error *\/ }`. Fehlte das
 * Modell einer Seite oder lehnte ihr Backend ab, zeigte der Bereich eine leere
 * Antwort mit normal aussehenden Zahlen, und nichts sagte, warum.
 *
 * Run: npx vitest run src/hooks/__tests__/ab-compare-zeigt-den-fehler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

vi.mock('../../api/providers', () => ({
  getProviderForModel: (model: string) => ({
    provider: {
      chatStream: () => (async function* () {
        if (model === 'broken') throw new Error('model "broken" not found')
        yield { content: 'fine answer', done: false }
        yield { content: '', done: true, evalCount: 42, evalDurationMs: 2_000 }
      })(),
    },
    modelId: model,
  }),
  getProviderIdFromModel: () => 'lu-cloud',
}))

import { useABCompare } from '../useABCompare'
import { useCompareStore } from '../../stores/compareStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const lastAnswer = (side: 'A' | 'B') => {
  const msgs = side === 'A' ? useCompareStore.getState().messagesA : useCompareStore.getState().messagesB
  return msgs[msgs.length - 1]?.content ?? ''
}

beforeEach(() => {
  __resetRunLanesForTests()
  useCompareStore.setState({
    isComparing: true, modelA: 'broken', modelB: 'good',
    messagesA: [], messagesB: [], statsA: null, statsB: null,
    isStreamingA: false, isStreamingB: false,
  })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, contextDecay: false } })
})

describe('A/B-Vergleich zeigt den Fehler einer Seite', () => {
  it('die gescheiterte Seite nennt den Fehler, die andere antwortet normal', async () => {
    const { result } = renderHook(() => useABCompare())
    await act(async () => { await result.current.sendCompare('same prompt') })

    expect(lastAnswer('A')).toBe('Error: model "broken" not found')
    expect(lastAnswer('B')).toBe('fine answer')
    // B's numbers come from the backend's own counters.
    expect(useCompareStore.getState().statsB).toMatchObject({ tokens: 42, source: 'server' })
    expect(useCompareStore.getState().statsB?.tokensPerSec).toBeCloseTo(21, 5)
  })
})
