import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTrendingCache,
  fetchTrendingTextModels,
  MIN_DOWNLOADS,
  paramsLabel,
  toTrendingModels,
  TRENDING_TTL_MS,
} from '../discover-trending'

const ARCHS = new Set(['qwen35', 'llama'])

// The shape /api/models answers with `expand[]=gguf,downloads,likes,lastModified,gated`,
// trimmed to what the feed reads (measured 2026-09-29).
function repo(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    downloads: 2_250_567,
    likes: 1325,
    lastModified: '2026-08-29T10:00:00.000Z',
    gated: false,
    gguf: { architecture: 'qwen35', context_length: 262144, total: 27_320_697_856 },
    ...over,
  }
}

describe('toTrendingModels', () => {
  it('keeps a loadable repo and describes it', () => {
    const { models } = toTrendingModels([repo('JonathanColetti/Qwen3.8-27B-Uncensored-GGUF')], ARCHS)
    expect(models).toHaveLength(1)
    const m = models[0]
    expect(m.name).toBe('Qwen3.8-27B-Uncensored')
    expect(m.url).toBe('https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF')
    expect(m.filename).toBe('Qwen3.8-27B-Uncensored-Q4_K_M.gguf')
    expect(m.tags).toEqual(['27B', 'Q4_K_M', 'GGUF', 'Unfiltered', '256K ctx'])
    expect(m.pulls).toBe('2.3M')
    expect(m.released).toBe('2026-08')
    expect(m.description).toContain('not tested by LU')
    // 27.3 B params at 0.61 bytes each, about 15.5 GiB.
    expect(m.sizeGB).toBeCloseTo(15.5, 1)
  })

  it('leaves out an architecture the engine cannot load, and counts it', () => {
    const r = toTrendingModels([
      repo('a/GLM-5.3-Flash-GGUF', { gguf: { architecture: 'glm5next', total: 1e10 } }),
      repo('b/Other-GLM-GGUF', { gguf: { architecture: 'glm5next', total: 1e10 } }),
      repo('c/Llama-GGUF', { gguf: { architecture: 'llama', total: 8e9 } }),
    ], ARCHS)
    expect(r.models.map((m) => m.name)).toEqual(['Llama'])
    expect(r.unsupported).toEqual({ glm5next: 2 })
  })

  it('leaves out gated repos, whatever kind of gate', () => {
    const r = toTrendingModels([repo('a/X-GGUF', { gated: 'auto' }), repo('b/Y-GGUF', { gated: 'manual' })], ARCHS)
    expect(r.models).toEqual([])
    expect(r.gated).toBe(2)
  })

  it('leaves out the fresh re-upload tail, keeps a liked or a downloaded one', () => {
    const r = toTrendingModels([
      repo('a/Nobody-GGUF', { downloads: MIN_DOWNLOADS - 1, likes: 3 }),
      repo('b/Liked-GGUF', { downloads: 10, likes: 200 }),
      repo('c/Pulled-GGUF', { downloads: 50_000, likes: 0 }),
    ], ARCHS)
    expect(r.models.map((m) => m.name)).toEqual(['Liked', 'Pulled'])
  })

  it('skips entries it cannot judge instead of guessing', () => {
    const r = toTrendingModels([{ id: 'noslash' }, repo('a/NoArch-GGUF', { gguf: {} }), 'junk', null], ARCHS)
    expect(r.models).toEqual([])
    expect(r.unsupported).toEqual({})
  })

  it('answers an unexpected payload with an empty feed', () => {
    expect(toTrendingModels({ error: 'rate limited' }, ARCHS).models).toEqual([])
  })
})

describe('paramsLabel', () => {
  it('rounds like the catalogue tags', () => {
    expect(paramsLabel(27_320_697_856)).toBe('27B')
    expect(paramsLabel(7_615_616_512)).toBe('7.6B')
    expect(paramsLabel(600_000_000)).toBe('600M')
  })
})

describe('fetchTrendingTextModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetTrendingCache()
  })

  it('asks Hugging Face once per hour, and says nothing on a failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([repo('a/Llama-GGUF', { gguf: { architecture: 'llama', total: 8e9 } })])))
    vi.stubGlobal('fetch', fetchMock)
    const first = await fetchTrendingTextModels(1_000)
    const second = await fetchTrendingTextModels(1_000 + TRENDING_TTL_MS - 1)
    expect(first.models).toHaveLength(1)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    __resetTrendingCache()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchTrendingTextModels(5_000)).toEqual({ models: [], unsupported: {}, gated: 0 })
  })
})
