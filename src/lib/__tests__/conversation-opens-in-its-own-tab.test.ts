import { describe, it, expect } from 'vitest'
import { activeConversationAtStart, latestConversationOfMode } from '../conversation-mode'

// Gegenprobe on the real build, 30.09.2026: after a restart the last Code
// conversation opened in the Chat tab with Agent off, and "continue" went out
// without tools. And the Code button always landed on the empty start page,
// even with a run in flight.

const convs = [
  { id: 'chat-old', mode: 'lu' as const, updatedAt: 1 },
  { id: 'legacy', updatedAt: 2 },
  { id: 'code-old', mode: 'codex' as const, updatedAt: 3 },
  { id: 'code-new', mode: 'codex' as const, updatedAt: 5 },
  { id: 'remote', mode: 'remote' as const, updatedAt: 6 },
]

describe('activeConversationAtStart', () => {
  it('drops a Code conversation, the app starts in the Chat tab', () => {
    expect(activeConversationAtStart(convs, 'code-new')).toBeNull()
  })
  it('drops any conversation of another tab', () => {
    expect(activeConversationAtStart(convs, 'remote')).toBeNull()
  })
  it('keeps a chat, also one saved before conversations had a mode', () => {
    expect(activeConversationAtStart(convs, 'chat-old')).toBe('chat-old')
    expect(activeConversationAtStart(convs, 'legacy')).toBe('legacy')
  })
  it('drops an id that no longer exists', () => {
    expect(activeConversationAtStart(convs, 'gone')).toBeNull()
    expect(activeConversationAtStart(convs, null)).toBeNull()
  })
})

describe('latestConversationOfMode', () => {
  it('returns the Code conversation worked on last', () => {
    expect(latestConversationOfMode(convs, 'codex')).toBe('code-new')
  })
  it('counts a conversation without a mode as a chat', () => {
    expect(latestConversationOfMode(convs, 'lu')).toBe('legacy')
  })
  it('is null when there is none', () => {
    expect(latestConversationOfMode([{ id: 'a', mode: 'lu', updatedAt: 1 }], 'codex')).toBeNull()
  })
})
