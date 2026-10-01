/**
 * Bug hunt 01.10.2026 (H9). Regenerate and Edit delete the turn and then call
 * sendMessage. resend checked for a model, but sendMessage also refuses a
 * model from the other mode (Local/Cloud switch) and a second send while this
 * conversation's run is in flight. Either way the question was gone and
 * nothing went out. resend now asks all three before it deletes.
 */
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const chat = readFileSync(resolve(__dirname, '..', 'useChat.ts'), 'utf8')

it('resend refuses what sendMessage refuses, before deleteMessagesAfter', () => {
  const at = chat.indexOf('const resend = useCallback(')
  const body = chat.slice(at, chat.indexOf('}, [sendMessage])', at))
  const del = body.indexOf('deleteMessagesAfter')
  const mode = body.indexOf('modelOutOfMode(activeModel, useSettingsStore.getState().settings.appMode)) return')
  const run = body.indexOf('if (activeChatRuns.has(conversationId)) return')
  expect(mode).toBeGreaterThan(0)
  expect(run).toBeGreaterThan(0)
  expect(mode).toBeLessThan(del)
  expect(run).toBeLessThan(del)
  // The same two refusals sendMessage applies.
  expect(chat).toContain('if (modelOutOfMode(activeModel, settings.appMode)) {')
  expect(chat).toContain('if (activeChatRuns.has(convId)) {')
})
