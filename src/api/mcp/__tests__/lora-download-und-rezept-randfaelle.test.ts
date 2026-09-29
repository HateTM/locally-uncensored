/**
 * Zwei Randfaelle beim LoRA-Holen (FINDINGS "Minor").
 *
 * 1. lora_download: ein Fortschritts-Abruf, der wirft, liess den ganzen
 *    Werkzeugaufruf scheitern, obwohl der Download weiterlief. Jetzt ist er
 *    ein verpasster Abruf; der naechste zaehlt.
 * 2. media_list civitaiImage: ein LoRA-Name ohne Buchstaben und Ziffern hat
 *    einen leeren Stamm, und jeder Dateiname "enthaelt" den leeren String. Das
 *    Rezept meldete ihn als installiert.
 *
 * Run: npx vitest run src/api/mcp/__tests__/lora-download-und-rezept-randfaelle.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getDownloadProgress = vi.fn()
vi.mock('../../discover', () => ({
  getCivitaiModel: vi.fn(async () => ({
    id: 1, name: 'Film Grain', type: 'LORA', subfolder: 'loras',
    downloadUrl: 'https://civitai.com/api/download/models/9', filename: 'film_grain.safetensors',
  })),
  startModelDownload: vi.fn(async () => ({ status: 'started', id: 'dl-1' })),
  getDownloadProgress: (...a: unknown[]) => getDownloadProgress(...a),
}))
vi.mock('../../comfyui', () => ({
  getLoraModels: vi.fn(async () => ['detail_tweaker.safetensors']),
  checkComfyConnection: vi.fn(async () => true),
  getImageModels: vi.fn(async () => []),
}))
vi.mock('../../comfyui-nodes', () => ({ clearNodeCache: vi.fn() }))
vi.mock('../../../stores/loraInfoStore', () => ({ rememberLoraHit: vi.fn() }))
vi.mock('../../../stores/downloadStore', () => ({ useDownloadStore: { getState: () => ({ setMeta: vi.fn() }) } }))
vi.mock('../../../stores/workflowStore', () => ({ useWorkflowStore: { getState: () => ({ civitaiApiKey: '', civitaiHost: 'civitai.com' }) } }))
vi.mock('../../backend', () => ({
  fetchExternal: vi.fn(async () => JSON.stringify({ items: [{ id: 5, meta: { prompt: 'a cat', resources: [{ type: 'lora', name: '!!!', weight: 0.8 }] } }] })),
}))
vi.mock('../../vram-handoff', () => ({ resolveModelName: () => null }))
vi.mock('../../../lib/civitai-image-meta', () => ({
  civitaiImageId: () => 5,
  civitaiHostOf: () => null,
  parseCivitaiImage: () => ({ prompt: 'a cat', loras: [{ name: '!!!', weight: 0.8 }] }),
}))

import { executeLoraDownload, executeMediaList } from '../media-tools'

describe('lora_download', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getDownloadProgress.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('ein Abruf, der wirft, ist ein verpasster Abruf, nicht ein gescheiterter Download', async () => {
    getDownloadProgress
      .mockRejectedValueOnce(new Error('backend busy'))
      .mockResolvedValue({ 'dl-1': { status: 'complete', filename: 'film_grain.safetensors' } })
    const run = executeLoraDownload({ id: 1 })
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(run).resolves.toMatch(/^Downloaded Film Grain into models\/loras as film_grain\.safetensors/)
  })

  it('bleibt der Fortschritt bis zum Ende unlesbar, sagt die Antwort das', async () => {
    getDownloadProgress.mockRejectedValue(new Error('backend busy'))
    const run = executeLoraDownload({ id: 1 })
    await vi.advanceTimersByTimeAsync(21 * 60_000)
    await expect(run).resolves.toMatch(/progress could not be read \(backend busy\)/)
  })
})

describe('media_list civitaiImage', () => {
  it('ein LoRA-Name ohne Buchstaben und Ziffern gilt nicht als installiert', async () => {
    const out = await executeMediaList({ civitaiImage: 'https://civitai.com/images/5' })
    expect(out).toContain('- !!! weight 0.8: NOT installed')
    expect(out).not.toContain('installed as detail_tweaker')
  })
})
