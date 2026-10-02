import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => ({
  list: [] as { model: string; messages: { role: string; content: string }[]; opts: Record<string, unknown> }[],
  lanes: [] as { id: string; lane: string }[],
}))
const plan = vi.hoisted(() => ({
  chunks: [] as string[],
  throws: null as Error | null,
  provider: 'lu-cloud' as string,
  lane: 'cloud' as 'cloud' | 'local',
  queued: false,
  thinkCompatible: true,
}))

vi.mock('../../../api/providers', () => ({
  getProviderIdFromModel: () => plan.provider,
  getProviderForModel: (name: string) => ({
    modelId: name.replace(/^[a-z-]+::/, ''),
    provider: {
      async *chatStream(model: string, messages: { role: string; content: string }[], opts: Record<string, unknown>) {
        calls.list.push({ model, messages, opts })
        if (plan.throws) throw plan.throws
        for (const c of plan.chunks) yield { content: c, done: false }
        yield { content: '', done: true }
      },
    },
  }),
}))
vi.mock('../../model-compatibility', () => ({ isThinkingCompatible: () => plan.thinkCompatible }))
vi.mock('../../agent-num-ctx', () => ({ resolveAgentNumCtx: async () => 16384 }))
vi.mock('../../run-lane-of-model', () => ({ laneOf: () => plan.lane, currentLaneFacts: () => ({}) }))
vi.mock('../../run-slot', () => ({
  runInLane: async (o: { conversationId: string; lane: string }, body: () => Promise<void>) => {
    calls.lanes.push({ id: o.conversationId, lane: o.lane })
    if (plan.queued) return 'cancelled-while-queued'
    await body()
    return 'ran'
  },
}))

import { useModelStore } from '../../../stores/modelStore'
import { improveAvailabilityFor, improvePrompt } from '../improve-prompt-run'

beforeEach(() => {
  calls.list.length = 0
  calls.lanes.length = 0
  plan.chunks = ['A red fox ', 'in deep snow.']
  plan.throws = null
  plan.provider = 'lu-cloud'
  plan.lane = 'cloud'
  plan.queued = false
  plan.thinkCompatible = true
  useModelStore.setState({ activeModel: 'lu-cloud::chat-model', models: [] })
})

describe('Improve my prompt: Lauf (Desktop)', () => {
  it('schreibt mit dem gewaehlten Chatmodell um und liefert die neue Fassung', async () => {
    const out = await improvePrompt('fox in snow', { kind: 'image' })
    expect(out).toEqual({ status: 'improved', prompt: 'A red fox in deep snow.' })
    expect(calls.list).toHaveLength(1)
    expect(calls.list[0].model).toBe('chat-model')
    expect(calls.list[0].messages[1].content).toBe('fox in snow')
  })

  it('bucht seinen Platz auf der Spur des Chatmodells, lokal wie in der Cloud', async () => {
    await improvePrompt('x', { kind: 'video' })
    plan.lane = 'local'
    plan.provider = 'ollama'
    useModelStore.setState({ activeModel: 'qwen3:8b' })
    await improvePrompt('x', { kind: 'video' })
    expect(calls.lanes.map((l) => l.lane)).toEqual(['cloud', 'local'])
    expect(new Set(calls.lanes.map((l) => l.id))).toEqual(new Set(['create::improve-prompt']))
  })

  it('nutzt die Kontextgroesse des Chats, damit ein lokales Modell nicht neu geladen wird', async () => {
    await improvePrompt('x', { kind: 'image' })
    expect(calls.list[0].opts.contextWindow).toBe(16384)
  })

  it('schaltet das Denken aus, wo das Modell es kann, sonst nur die kleinste Stufe', async () => {
    await improvePrompt('x', { kind: 'image' })
    expect(calls.list[0].opts.thinking).toBe(false)
    expect(calls.list[0].opts.reasoningEffort).toBe('low')
    plan.thinkCompatible = false
    await improvePrompt('x', { kind: 'image' })
    expect(calls.list[1].opts.thinking).toBeUndefined()
    useModelStore.setState({ models: [{ name: 'lu-cloud::chat-model', thinkMode: 'always' } as never] })
    plan.thinkCompatible = true
    await improvePrompt('x', { kind: 'image' })
    expect(calls.list[2].opts.thinking).toBeUndefined()
  })

  it('ein Fehler des Aufrufs wirft nicht, er heisst failed', async () => {
    plan.throws = new Error('402 credits')
    expect(await improvePrompt('x', { kind: 'video' })).toEqual({ status: 'failed' })
  })

  it('eine Absage, eine leere Antwort oder eine ausgereihte Spur heisst failed', async () => {
    plan.chunks = ["I'm sorry, I can't do that."]
    expect(await improvePrompt('x', { kind: 'image' })).toEqual({ status: 'failed' })
    plan.chunks = []
    expect(await improvePrompt('x', { kind: 'image' })).toEqual({ status: 'failed' })
    plan.chunks = ['fine']
    plan.queued = true
    expect(await improvePrompt('x', { kind: 'image' })).toEqual({ status: 'failed' })
  })

  it('kommt derselbe Text zurueck, ist nichts umgeschrieben', async () => {
    plan.chunks = ['same words']
    expect(await improvePrompt('same words', { kind: 'music' })).toEqual({ status: 'unchanged' })
  })

  it('ein Abbruch von aussen bricht den Aufruf ab', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await improvePrompt('x', { kind: 'image' }, ac.signal)).toEqual({ status: 'failed' })
    expect(calls.list).toHaveLength(0)
  })

  it('ohne Chatmodell geht gar kein Aufruf hinaus', async () => {
    useModelStore.setState({ activeModel: null })
    expect(await improvePrompt('x', { kind: 'image' })).toEqual({ status: 'failed' })
    expect(calls.list).toHaveLength(0)
  })
})

describe('Improve my prompt: Verfuegbarkeit (Desktop)', () => {
  it('ohne Chatmodell steht der Grund im Schalter', () => {
    const a = improveAvailabilityFor(null)
    expect(a.available).toBe(false)
    expect(a.hint).toMatch(/chat model/i)
  })

  it('LU Cloud: wie eine kurze Chatnachricht gebucht', () => {
    const a = improveAvailabilityFor('lu-cloud::chat-model')
    expect(a.available).toBe(true)
    expect(a.hint).toMatch(/billed like a short chat message/i)
  })

  it('lokal: laeuft auf dem eigenen Rechner und wird nicht gebucht', () => {
    plan.provider = 'ollama'
    const a = improveAvailabilityFor('qwen3:8b')
    expect(a.available).toBe(true)
    expect(a.hint).toMatch(/your machine/i)
    expect(a.hint).not.toMatch(/billed/i)
  })
})
