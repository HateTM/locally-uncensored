/**
 * nomic-embed-text v1.5 bekommt seine Aufgaben-Praefixe (FINDINGS 9).
 *
 * Die Modellkarte verlangt `search_document: ` vor indiziertem Text und
 * `search_query: ` vor der Frage; roh gesendet sucht das Modell unter seiner
 * Qualitaet. Ein Index von vorher liegt in einem anderen Vektorraum als eine
 * Frage mit Praefix. Sein Text ist gespeichert, also wird er beim ersten
 * Abruf einmal als Dokument neu eingebettet, statt den Nutzer die Dateien neu
 * ziehen zu lassen. Andere Embedding-Modelle (bge, e5) bekommen den Text
 * unveraendert.
 *
 * Run: npx vitest run src/api/__tests__/rag-nomic-task-prefixes.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let builtinActive = false
let embedStatus: { running: boolean; healthy: boolean; model_path?: string | null } = { running: false, healthy: false }
vi.mock('../engine', () => ({
  isManagedBuiltinActive: () => builtinActive,
  embedBaseUrl: () => 'http://127.0.0.1:8128/v1',
  ensureBundledEmbedAlive: async () => {},
  bundledEmbedStatus: async () => embedStatus,
}))

const localFetch = vi.fn()
vi.mock('../backend', () => ({
  localFetch: (...args: unknown[]) => localFetch(...args),
  ollamaUrl: (path: string) => `http://localhost:11434/api${path}`,
}))

import { indexDocument, retrieveContext, NOMIC_TASK_PREFIX } from '../rag'
import type { TextChunk } from '../../types/rag'

/** Ollama /api/embed: one vector per input, whatever was sent. */
function ollamaEcho() {
  localFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(String(init.body)) as { input: string[] }
    return new Response(JSON.stringify({ embeddings: input.map(() => [1, 0, 0]) }), { status: 200 })
  })
}
const sentInputs = () => localFetch.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { input: string[] }).input)

const doc = () => new File(['The key rotation runs every ninety days. Old keys stay valid for one week after that.'], 'ops.txt', { type: 'text/plain' })
const legacy = (id: string, content: string): TextChunk => ({ id, documentId: 'd1', content, embedding: [0, 1, 0], index: Number(id) })

describe('nomic task prefixes', () => {
  beforeEach(() => {
    localFetch.mockReset()
    builtinActive = false
    embedStatus = { running: false, healthy: false }
    ollamaEcho()
  })

  it('indexed text carries search_document:, the question search_query:', async () => {
    const { chunks } = await indexDocument(doc(), 'nomic-embed-text')
    expect(sentInputs()[0].every((t) => t.startsWith(NOMIC_TASK_PREFIX.document))).toBe(true)
    expect(chunks.every((c) => c.taskPrefixed === true)).toBe(true)
    // The stored text stays clean: the prefix is for the model, not the prompt.
    expect(chunks[0].content.startsWith('search_')).toBe(false)

    localFetch.mockClear()
    const { reembedded } = await retrieveContext('how often are keys rotated', chunks, 'nomic-embed-text')
    expect(sentInputs()).toEqual([[NOMIC_TASK_PREFIX.query + 'how often are keys rotated']])
    expect(reembedded).toEqual([])
  })

  it('a pre-prefix index is re-embedded once as documents and handed back to store', async () => {
    const old = [legacy('0', 'gardening tools and soil'), legacy('1', 'key rotation every ninety days')]
    const { reembedded, scoredChunks } = await retrieveContext('key rotation', old, 'nomic-embed-text', 2)
    expect(sentInputs()).toEqual([
      [NOMIC_TASK_PREFIX.query + 'key rotation'],
      old.map((c) => NOMIC_TASK_PREFIX.document + c.content),
    ])
    expect(reembedded.map((c) => [c.id, c.taskPrefixed, c.embedding])).toEqual([['0', true, [1, 0, 0]], ['1', true, [1, 0, 0]]])
    // Ranked on the new vectors, not the stale ones.
    expect(scoredChunks.every((r) => r.chunk.taskPrefixed)).toBe(true)
  })

  it('another Ollama embedding model gets the raw text and no migration', async () => {
    const { chunks } = await indexDocument(doc(), 'bge-m3')
    expect(sentInputs()[0].some((t) => t.startsWith('search_'))).toBe(false)
    expect(chunks.every((c) => !c.taskPrefixed)).toBe(true)
    localFetch.mockClear()
    const { reembedded } = await retrieveContext('key rotation', [legacy('0', 'key rotation')], 'bge-m3')
    expect(sentInputs()).toEqual([['key rotation']])
    expect(reembedded).toEqual([])
  })

  it('the LU Engine follows the GGUF it runs: nomic gets prefixes, bge does not', async () => {
    builtinActive = true
    const openAiEcho = async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body)) as { input: string[] }
      return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) }), { status: 200 })
    }
    localFetch.mockImplementation(openAiEcho)
    embedStatus = { running: true, healthy: true, model_path: 'C:/models/nomic-embed-text-v1.5.Q4_K_M.gguf' }
    await retrieveContext('q', [], 'nomic-embed-text')
    expect(sentInputs().at(-1)).toEqual([NOMIC_TASK_PREFIX.query + 'q'])
    embedStatus = { running: true, healthy: true, model_path: 'C:/models/bge-m3-Q8_0.gguf' }
    await retrieveContext('q', [], 'nomic-embed-text')
    expect(sentInputs().at(-1)).toEqual(['q'])
  })
})
