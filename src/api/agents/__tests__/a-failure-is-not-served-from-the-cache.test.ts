import { describe, it, expect, beforeEach } from 'vitest'
import { makeInTurnCacheLookup } from '../in-turn-cache'
import { useToolAuditStore } from '../../../stores/toolAuditStore'
import { stableArgsHash } from '../block-helpers'

/**
 * Bug hunt 01.10.2026, A5: tools report most failures as text with status
 * 'completed'. The in-turn cache kept such a failure as a hit, so a retry in
 * the same turn got the old error back and the call never ran again.
 */

function prior(toolName: string, args: Record<string, unknown>, result: string): void {
  const s = useToolAuditStore.getState()
  const id = s.record({ convId: 'c1', toolCallId: `p-${toolName}`, toolName, args, startedAt: 1000 })
  s.complete(id, { status: 'completed', completedAt: 1100, resultPreview: result })
}

describe('the in-turn cache does not serve a failure', () => {
  beforeEach(() => useToolAuditStore.getState().clearAll())

  it('a failed web_fetch runs again on the retry', () => {
    const args = { url: 'https://example.com' }
    prior('web_fetch', args, 'Error: fetch timed out after 30s')
    const lookup = makeInTurnCacheLookup({ convId: 'c1', turnStartMs: 500 })
    expect(lookup({ id: 'n', toolName: 'web_fetch', args }, stableArgsHash(args))).toBeUndefined()
  })

  it('a successful web_fetch is still served from the cache', () => {
    const args = { url: 'https://example.com' }
    prior('web_fetch', args, '<h1>Example Domain</h1>')
    const lookup = makeInTurnCacheLookup({ convId: 'c1', turnStartMs: 500 })
    expect(lookup({ id: 'n', toolName: 'web_fetch', args }, stableArgsHash(args))).toBe('<h1>Example Domain</h1>')
  })
})
