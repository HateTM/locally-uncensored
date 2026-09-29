/**
 * The CivitAI half of the live catalogue: the file a hit names is the file its
 * download serves, adult content is recognised, and "popular" is cached.
 *
 * The first case is the live finding of 2026-09-29 (FINDINGS 25): for three of
 * the top 100 LoRAs `files[0]` was a zip ("Training Data" / "Other"), and the
 * primary `.safetensors` was saved under the zip's name, invisible to ComfyUI.
 *
 * Run: npx vitest run src/api/__tests__/civitai-popular-and-primary-file.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchExternal = vi.fn()

vi.mock('../backend', () => ({
  backendCall: vi.fn(),
  fetchExternal: (...args: unknown[]) => fetchExternal(...args),
}))

import {
  __resetCivitaiPopularCache,
  CIVITAI_POPULAR_TTL_MS,
  fetchCivitaiPopular,
  primaryCivitaiFile,
  searchCivitaiModels,
} from '../discover'

// Shape of the real answer for "Wan 2.2/2.1 POV Missionary" (2026-09-29), trimmed.
const zipFirst = {
  id: 1,
  name: 'Wan 2.2/2.1 POV Missionary',
  nsfw: true,
  nsfwLevel: 60,
  stats: { downloadCount: 50_000, thumbsUpCount: 900 },
  modelVersions: [{
    baseModel: 'Wan Video 2.2 I2V-A14B',
    downloadUrl: 'https://civitai.com/api/download/models/111',
    files: [
      { name: 'wan2.2_i2v_pov_missionary_v1.0_workflow.zip', type: 'Training Data', sizeKB: 12 },
      { name: 'wan2.2_i2v_highnoise_pov_missionary_v1.0.safetensors', type: 'Model', primary: true, sizeKB: 300 * 1024 },
    ],
    images: [],
  }],
}

const rRated = {
  id: 2,
  name: 'Swimsuit',
  nsfw: false,
  nsfwLevel: 4,
  modelVersions: [{ baseModel: 'Pony', files: [{ name: 's.safetensors', primary: true, sizeKB: 1 }], images: [] }],
}

const safe = {
  id: 3,
  name: 'Micro Details',
  nsfw: false,
  nsfwLevel: 3,
  modelVersions: [{ baseModel: 'Illustrious', files: [{ name: 'd.safetensors', primary: true, sizeKB: 1 }], images: [] }],
}

beforeEach(() => {
  fetchExternal.mockReset()
  __resetCivitaiPopularCache()
})
afterEach(() => vi.clearAllMocks())

describe('primaryCivitaiFile', () => {
  it('takes the primary file, then the first model file, then whatever is first', () => {
    const zip = { name: 'a.zip', type: 'Training Data' }
    const model = { name: 'b.safetensors', type: 'Model' }
    const primary = { name: 'c.safetensors', type: 'Model', primary: true }
    expect(primaryCivitaiFile([zip, model, primary])).toBe(primary)
    expect(primaryCivitaiFile([zip, model])).toBe(model)
    expect(primaryCivitaiFile([zip])).toBe(zip)
    expect(primaryCivitaiFile([])).toBeUndefined()
  })
})

describe('a CivitAI hit', () => {
  it('names the file its download serves, not a zip listed before it', async () => {
    fetchExternal.mockResolvedValue(JSON.stringify({ items: [zipFirst] }))
    const [hit] = await searchCivitaiModels('pov', 'LORA')
    expect(hit.filename).toBe('wan2.2_i2v_highnoise_pov_missionary_v1.0.safetensors')
    expect(hit.sizeGB).toBe(0.3)
    expect(hit.subfolder).toBe('loras')
    expect(hit.baseModel).toBe('Wan Video 2.2 I2V-A14B')
  })

  it('is adult by the nsfw flag or by an R / X / XXX rating bit', async () => {
    fetchExternal.mockResolvedValue(JSON.stringify({ items: [zipFirst, rRated, safe] }))
    const hits = await searchCivitaiModels('x', 'LORA')
    expect(hits.map((h) => h.nsfw ?? false)).toEqual([true, true, false])
  })
})

describe('fetchCivitaiPopular', () => {
  it('asks for the most downloaded of the period, with nsfw on and the key as a header', async () => {
    fetchExternal.mockResolvedValue(JSON.stringify({ items: [safe] }))
    const hits = await fetchCivitaiPopular('LORA', 'Week', 'KEY', 'civitai.red', 1_000)
    expect(hits).toHaveLength(1)
    const [url, key] = fetchExternal.mock.calls[0]
    expect(url).toMatch(/^https:\/\/civitai\.red\/api\/v1\/models\?/)
    const q = new URL(url).searchParams
    expect(q.get('types')).toBe('LORA')
    expect(q.get('sort')).toBe('Most Downloaded')
    expect(q.get('period')).toBe('Week')
    expect(q.get('nsfw')).toBe('true')
    expect(url).not.toContain('KEY')
    expect(key).toBe('KEY')
  })

  it('reuses an answer for an hour, per type and period', async () => {
    fetchExternal.mockResolvedValue(JSON.stringify({ items: [safe] }))
    await fetchCivitaiPopular('LORA', 'Week', undefined, 'civitai.com', 1_000)
    await fetchCivitaiPopular('LORA', 'Week', undefined, 'civitai.com', 1_000 + CIVITAI_POPULAR_TTL_MS - 1)
    expect(fetchExternal).toHaveBeenCalledTimes(1)
    await fetchCivitaiPopular('LORA', 'Month', undefined, 'civitai.com', 1_000)
    await fetchCivitaiPopular('Checkpoint', 'Week', undefined, 'civitai.com', 1_000)
    expect(fetchExternal).toHaveBeenCalledTimes(3)
  })

  it('answers a failure with an empty list', async () => {
    fetchExternal.mockRejectedValue(new Error('HTTP 429'))
    expect(await fetchCivitaiPopular('LORA', 'Week')).toEqual([])
  })
})
