/**
 * A Lightning / Rapid AIO merge keeps its 6 steps / cfg 1 when the Create tab
 * changes, not only when the model is picked. setIntent('video' | 'animate' |
 * 'extend'), setMode('video') and the Quality reset used the bare family
 * defaults (Wan 2.2: 30 steps, cfg 5), which burns a distilled merge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = ls
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  g.window = Object.assign(g.window ?? {}, { localStorage: ls })
})
vi.mock('../../api/mlx-image', () => ({ isMlxImageHost: () => false, MLX_MODEL_PREFIX: 'MLX ' }))

import { useCreateStore, videoDefaultsFor, MODEL_TYPE_DEFAULTS } from '../createStore'
import { LIGHTNING_SAMPLING } from '../../api/comfyui'

const FAST = 'wan2.2-ti2v-5B-rapid-aio-v10.safetensors'
const PLAIN = 'wan2.2_ti2v_5B_fp16.safetensors'

describe('video defaults keep a distilled model\'s sampling', () => {
  beforeEach(() => {
    useCreateStore.getState().setVideoModel(FAST)
    useCreateStore.getState().setSteps(40)
    useCreateStore.getState().setCfgScale(7.5)
  })

  it('videoDefaultsFor applies the override, and leaves a plain model on its family numbers', () => {
    expect(videoDefaultsFor(FAST)).toMatchObject({ steps: LIGHTNING_SAMPLING.steps, cfgScale: LIGHTNING_SAMPLING.cfg })
    expect(videoDefaultsFor(PLAIN)).toMatchObject({ steps: MODEL_TYPE_DEFAULTS.wan22.steps, cfgScale: MODEL_TYPE_DEFAULTS.wan22.cfgScale })
  })

  for (const intent of ['video', 'animate', 'extend'] as const) {
    it(`switching to ${intent} keeps 6 steps / cfg 1`, () => {
      useCreateStore.getState().setIntent(intent)
      const s = useCreateStore.getState()
      expect([s.steps, s.cfgScale]).toEqual([LIGHTNING_SAMPLING.steps, LIGHTNING_SAMPLING.cfg])
    })
  }

  it('setMode(video) keeps it too', () => {
    useCreateStore.getState().setMode('video')
    const s = useCreateStore.getState()
    expect([s.steps, s.cfgScale]).toEqual([LIGHTNING_SAMPLING.steps, LIGHTNING_SAMPLING.cfg])
  })

  it('the Quality reset in video mode returns to 6 / 1, not 30 / 5', () => {
    useCreateStore.getState().setIntent('video')
    useCreateStore.getState().setSteps(40)
    useCreateStore.getState().resetParamsToModelDefaults()
    const s = useCreateStore.getState()
    expect([s.steps, s.cfgScale]).toEqual([LIGHTNING_SAMPLING.steps, LIGHTNING_SAMPLING.cfg])
  })
})
