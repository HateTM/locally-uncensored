/**
 * Z36 finding 1 (W3 run 2026-08-16): a Create-tab render freed VRAM with one
 * bare `offload_local_models` call. Both llama processes died with no KV
 * save, nobody reloaded them, and the next chat turn paid a measured 62 s
 * cold start. evictChatBackendsForRender / restoreChatBackendsAfterRender
 * give that path the agent hand-off's manners: capture, KV-save, evict,
 * restore. These tests pin the capture list, the save-before-kill order, the
 * restore calls, the exclusiveVramMode 'never' opt-out (negative control)
 * and the grace-window takeover for back-to-back renders.
 *
 * Run: npx vitest run src/api/__tests__/create-render-handoff.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const localFetch = vi.fn()
const listRunningModels = vi.fn()
const loadModel = vi.fn()
const unloadModel = vi.fn()
const freeMemory = vi.fn()
const backendCall = vi.fn()
const getActiveAgentModel = vi.fn()
let isOllamaLocalReturn = true

vi.mock('../backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  localFetch: (...a: unknown[]) => localFetch(...a),
  ollamaUrl: (p: string) => `http://localhost:11434/api${p.startsWith('/') ? p : '/' + p}`,
  comfyuiUrl: (p: string) => `http://localhost:8188${p}`,
  isOllamaLocal: () => isOllamaLocalReturn,
}))

vi.mock('../ollama', () => ({
  listRunningModels: (...a: unknown[]) => listRunningModels(...a),
  loadModel: (...a: unknown[]) => loadModel(...a),
  unloadModel: (...a: unknown[]) => unloadModel(...a),
}))

vi.mock('../comfyui', async () => {
  const actual = await vi.importActual<typeof import('../comfyui')>('../comfyui')
  return {
    ...actual,
    freeMemory: (...a: unknown[]) => freeMemory(...a),
  }
})

vi.mock('../agent-context', () => ({
  getActiveAgentModel: () => getActiveAgentModel(),
}))

vi.mock('../comfyui-ws', () => ({
  comfyWS: { on: () => () => {}, connect: () => Promise.resolve(), connected: false },
  CLIENT_ID: 'lu-test-client',
}))

import {
  evictChatBackendsForRender,
  restoreChatBackendsAfterRender,
  holdRenderRestore,
  __resetRenderJuggleForTests,
  type RenderEviction,
} from '../vram-handoff'
import { useSettingsStore } from '../../stores/settingsStore'

const GB = 1024 * 1024 * 1024

/** backendCall programmed like the live box: engine up, save works. */
function mockBackends(opts?: { engineRunning?: boolean; saveOk?: boolean }) {
  backendCall.mockImplementation(async (cmd: unknown, args?: unknown) => {
    if (cmd === 'bundled_engine_status') {
      return (opts?.engineRunning ?? true)
        ? { running: true, port: 8127, model_path: 'C:/models/qwen3-8b.gguf', modelBytes: 5 * GB }
        : { running: false }
    }
    if (cmd === 'kv_slot_action') {
      const a = args as { action?: string } | undefined
      if (a?.action === 'save') return { ok: opts?.saveOk ?? true }
      return { ok: true }
    }
    if (cmd === 'lmstudio_list_loaded') return { loaded: [] }
    return {}
  })
}

const callsTo = (cmd: string) =>
  backendCall.mock.calls.filter((c) => c[0] === cmd)
const callIndex = (cmd: string, pred?: (args: unknown) => boolean) =>
  backendCall.mock.calls.findIndex((c) => c[0] === cmd && (!pred || pred(c[1])))

beforeEach(() => {
  localFetch.mockReset()
  listRunningModels.mockReset()
  loadModel.mockReset()
  unloadModel.mockReset()
  freeMemory.mockReset()
  backendCall.mockReset()
  getActiveAgentModel.mockReset()
  __resetRenderJuggleForTests()
  isOllamaLocalReturn = true
  getActiveAgentModel.mockReturnValue(null)
  loadModel.mockResolvedValue(undefined)
  freeMemory.mockResolvedValue(undefined)
  // One Ollama model resident in VRAM.
  localFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ models: [{ name: 'qwen:14b', size_vram: 9 * GB }] }),
  })
  mockBackends()
  useSettingsStore.getState().updateSettings({ exclusiveVramMode: 'auto' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('evictChatBackendsForRender', () => {
  it('captures the resident backends and saves the KV slot BEFORE the kill', async () => {
    const haul = await evictChatBackendsForRender()
    expect(haul.ollamaModel).toBe('qwen:14b')
    expect(haul.bundled?.modelPath).toBe('C:/models/qwen3-8b.gguf')
    expect(haul.bundled?.slotSaved).toBe(true)
    // The save must land before offload_local_models stops the engine, or
    // there is nothing left to save.
    const saveIdx = callIndex('kv_slot_action', (a) => (a as { action?: string })?.action === 'save')
    const killIdx = callIndex('offload_local_models')
    expect(saveIdx).toBeGreaterThanOrEqual(0)
    expect(killIdx).toBeGreaterThanOrEqual(0)
    expect(saveIdx).toBeLessThan(killIdx)
    // The eviction pair still fires exactly as the Create tab always did.
    expect(callsTo('offload_local_models')[0][1]).toEqual({ includeComfyui: false })
    expect(callsTo('lmstudio_unload_model')).toHaveLength(1)
  })

  it('NEGATIVE: exclusiveVramMode never means no eviction at all', async () => {
    useSettingsStore.getState().updateSettings({ exclusiveVramMode: 'never' })
    const haul = await evictChatBackendsForRender()
    expect(haul).toEqual({ ollamaModel: null, lms: null, bundled: null })
    expect(callsTo('offload_local_models')).toHaveLength(0)
    expect(callsTo('lmstudio_unload_model')).toHaveLength(0)
    expect(callsTo('kv_slot_action')).toHaveLength(0)
  })

  it('a failed KV save is honest: slotSaved false, eviction still happens', async () => {
    mockBackends({ saveOk: false })
    const haul = await evictChatBackendsForRender()
    expect(haul.bundled?.slotSaved).toBe(false)
    expect(callsTo('offload_local_models')).toHaveLength(1)
  })
})

describe('restoreChatBackendsAfterRender', () => {
  const fullHaul = (): RenderEviction => ({
    ollamaModel: 'qwen:14b',
    lms: { id: 'lms-model', contextLength: 16384 },
    bundled: { port: 8127, modelPath: 'C:/models/qwen3-8b.gguf', modelBytes: 5 * GB, slotSaved: true },
  })

  it('brings every evicted backend back and restores the KV slot', async () => {
    await restoreChatBackendsAfterRender(fullHaul(), 0)
    expect(freeMemory).toHaveBeenCalledTimes(1)
    // Engine restart rides through the real engine client (start_bundled_engine).
    const starts = callsTo('start_bundled_engine')
    expect(starts).toHaveLength(1)
    expect(starts[0][1]).toMatchObject({ modelPath: 'C:/models/qwen3-8b.gguf' })
    const restoreIdx = callIndex('kv_slot_action', (a) => (a as { action?: string })?.action === 'restore')
    expect(restoreIdx).toBeGreaterThanOrEqual(0)
    expect(loadModel).toHaveBeenCalledWith('qwen:14b')
    const lmsLoads = callsTo('lmstudio_load_model')
    expect(lmsLoads).toHaveLength(1)
    expect(lmsLoads[0][1]).toMatchObject({ model: 'lms-model', contextLength: 16384 })
  })

  it('NEGATIVE: an unsaved slot is not restored (engine still restarts)', async () => {
    const haul = fullHaul()
    haul.bundled = { ...haul.bundled!, slotSaved: false }
    await restoreChatBackendsAfterRender(haul, 0)
    expect(callsTo('start_bundled_engine')).toHaveLength(1)
    const restoreIdx = callIndex('kv_slot_action', (a) => (a as { action?: string })?.action === 'restore')
    expect(restoreIdx).toBe(-1)
  })

  it('NEGATIVE: an empty haul touches nothing', async () => {
    await restoreChatBackendsAfterRender({ ollamaModel: null, lms: null, bundled: null }, 0)
    expect(freeMemory).not.toHaveBeenCalled()
    expect(backendCall).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
  })

  it('a render starting inside the grace window inherits the haul instead of a reload', async () => {
    vi.useFakeTimers()
    // The follow-up render finds the engine already stopped and no Ollama
    // resident (everything is still evicted from render #1).
    mockBackends({ engineRunning: false })
    localFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })

    const pRestore = restoreChatBackendsAfterRender(fullHaul())
    const pEvict = evictChatBackendsForRender() // arrives inside the grace window
    await vi.advanceTimersByTimeAsync(5_000)
    await pRestore
    const second = await pEvict

    // The restore skipped: nothing was reloaded just to be evicted again.
    expect(callsTo('start_bundled_engine')).toHaveLength(0)
    expect(loadModel).not.toHaveBeenCalled()
    // The second render's haul carries the inherited backends.
    expect(second.bundled?.modelPath).toBe('C:/models/qwen3-8b.gguf')
    expect(second.ollamaModel).toBe('qwen:14b')
    expect(second.lms?.id).toBe('lms-model')
  })

  it('with no follow-up render the grace window elapses and the reload happens', async () => {
    vi.useFakeTimers()
    const pRestore = restoreChatBackendsAfterRender(fullHaul())
    await vi.advanceTimersByTimeAsync(5_000)
    await pRestore
    expect(callsTo('start_bundled_engine')).toHaveLength(1)
    expect(loadModel).toHaveBeenCalledWith('qwen:14b')
  })
})

// Box run, 03.10.2026: a batch edit of three pictures loaded the image model
// anew before each one. Every picture of a batch ended with its own restore,
// and a picture that took longer than the grace window to start paid for it:
// /free dropped the image model and the chat model was loaded just to be
// evicted again. A batch holds the restore until its last picture is done.
describe('holdRenderRestore: a run of several renders restores once, at its end', () => {
  const haulOf = (ollamaModel: string): RenderEviction => ({ ollamaModel, lms: null, bundled: null })

  it('no /free and no reload between the pictures, however long the next one takes to start', async () => {
    vi.useFakeTimers()
    mockBackends({ engineRunning: false })
    const release = holdRenderRestore()
    for (let i = 0; i < 3; i++) {
      const haul = await evictChatBackendsForRender()
      const restored = restoreChatBackendsAfterRender(i === 0 ? haulOf('qwen:14b') : haul)
      // Far past the grace window before the next picture starts.
      await vi.advanceTimersByTimeAsync(30_000)
      await restored
    }
    expect(freeMemory).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()

    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(freeMemory).toHaveBeenCalledTimes(1)
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(loadModel).toHaveBeenCalledWith('qwen:14b')
  })

  it('a hold released with nothing evicted touches nothing', async () => {
    vi.useFakeTimers()
    const release = holdRenderRestore()
    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(freeMemory).not.toHaveBeenCalled()
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('releasing twice restores once', async () => {
    vi.useFakeTimers()
    const release = holdRenderRestore()
    const restored = restoreChatBackendsAfterRender(haulOf('qwen:14b'))
    await vi.advanceTimersByTimeAsync(5_000)
    await restored
    release()
    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('a render that starts right after the release still inherits the haul', async () => {
    vi.useFakeTimers()
    mockBackends({ engineRunning: false })
    localFetch.mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })
    const release = holdRenderRestore()
    const restored = restoreChatBackendsAfterRender(haulOf('qwen:14b'))
    await vi.advanceTimersByTimeAsync(5_000)
    await restored
    release()
    const next = evictChatBackendsForRender()
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await next).ollamaModel).toBe('qwen:14b')
    expect(loadModel).not.toHaveBeenCalled()
  })
})

describe('wiring: useCreate uses the hand-off helpers', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

  it('evicts via the helper, restores in its finally, bare offload pair is gone', () => {
    const src = read('../../hooks/useCreate.ts')
    expect(src).toContain('evictChatBackendsForRender()')
    expect(src).toContain('restoreChatBackendsAfterRender(renderEviction)')
    // The exact uncaptured kill Z36 flagged must not come back.
    expect(src).not.toContain("backendCall('offload_local_models'")
    expect(src).not.toContain("backendCall('lmstudio_unload_model'")
  })
})
