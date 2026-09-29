/**
 * Background removal and video output on ComfyUI's own nodes (FINDINGS 23).
 *
 * - Cutout: the official utility_birefnet_remove_background graph
 *   (LoadImage → LoadBackgroundRemovalModel → RemoveBackground → InvertMask →
 *   JoinImageWithAlpha → SaveImage) when the core nodes and a model are there,
 *   RMBG only as the fallback, and an error that names the one missing piece.
 * - Video: CreateVideo + SaveVideo (mp4) first, then VHS, animated WEBP and
 *   single frames for older cores.
 *
 * Run: npx vitest run src/api/__tests__/core-bg-removal-and-video.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})

import { buildDynamicWorkflow, checkVideoOutputCapability, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { addVideoSaveNodes } from '../comfyui-graph'
import { BIREFNET, bgRemovalReady, bgRemovalStatus, coreBgRemovalModel, hasCoreBgRemoval } from '../bg-removal'
import type { ComfyApiGraph } from '../../types/comfy-graph'
import { classTypes, nodeOf } from './graph-test-support'

/** The core nodes as /object_info lists them, with `models` in the dropdown. */
function coreNodes(models: string[], legacyCombo = false) {
  const combo = legacyCombo ? [models] : ['COMBO', { options: models }]
  return {
    LoadImage: { input: { required: { image: [[]] } } },
    SaveImage: { input: { required: {} } },
    LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: combo } } },
    RemoveBackground: { input: { required: { bg_removal_model: ['BG_REMOVAL_MODEL'], image: ['IMAGE'] } } },
    InvertMask: { input: { required: { mask: ['MASK'] } } },
    JoinImageWithAlpha: { input: { required: { image: ['IMAGE'], alpha: ['MASK'] } } },
  }
}

const RMBG = { RMBG: { input: { required: { image: ['IMAGE'] } }, output: ['IMAGE', 'MASK'] } }

const removebgParams = {
  model: 'sdxl.safetensors',
  prompt: 'a portrait', negativePrompt: '',
  width: 1024, height: 1024, steps: 20, cfgScale: 7, seed: 1, batchSize: 1,
  removebg: true,
  inputImage: 'photo.png',
} as never

describe('bg-removal: what counts as ready', () => {
  it('core nodes need both classes', () => {
    expect(hasCoreBgRemoval(coreNodes([]))).toBe(true)
    const { RemoveBackground: _drop, ...half } = coreNodes([])
    expect(hasCoreBgRemoval(half)).toBe(false)
  })

  it('prefers BiRefNet over other listed models, in either combo shape', () => {
    expect(coreBgRemovalModel(coreNodes(['other.safetensors', 'birefnet.safetensors']))).toBe('birefnet.safetensors')
    expect(coreBgRemovalModel(coreNodes(['other.safetensors', 'BiRefNet-HR.safetensors'], true))).toBe('BiRefNet-HR.safetensors')
    expect(coreBgRemovalModel(coreNodes(['other.safetensors']))).toBe('other.safetensors')
    expect(coreBgRemovalModel(coreNodes([]))).toBeNull()
  })

  it('ready = core nodes with a model, or the RMBG pack', () => {
    expect(bgRemovalReady(coreNodes([BIREFNET.filename]))).toBe(true)
    expect(bgRemovalReady(coreNodes([]))).toBe(false)
    expect(bgRemovalReady({ ...coreNodes([]), ...RMBG })).toBe(true)
    expect(bgRemovalReady(RMBG)).toBe(true)
    expect(bgRemovalReady({})).toBe(false)
  })

  it('the agent line names the path and never asks for RMBG when the core can do it', () => {
    expect(bgRemovalStatus(coreNodes([BIREFNET.filename]))).toMatch(/^ready \(ComfyUI core, birefnet/)
    expect(bgRemovalStatus(RMBG)).toBe('ready (ComfyUI-RMBG)')
    expect(bgRemovalStatus(coreNodes([]))).toMatch(/needs its model \(birefnet\.safetensors/)
    expect(bgRemovalStatus(coreNodes([]))).not.toMatch(/RMBG/)
    expect(bgRemovalStatus({})).toMatch(/^not available/)
  })
})

describe('buildDynamicWorkflow: core background removal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the official BiRefNet template graph, wired end to end', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(coreNodes([BIREFNET.filename]) as never)
    const wf = await buildDynamicWorkflow(removebgParams)
    expect(classTypes(wf).sort()).toEqual(
      ['InvertMask', 'JoinImageWithAlpha', 'LoadBackgroundRemovalModel', 'LoadImage', 'RemoveBackground', 'SaveImage'],
    )
    const [loadId, load] = nodeOf(wf, 'LoadImage')!
    const [modelId, model] = nodeOf(wf, 'LoadBackgroundRemovalModel')!
    const [removeId, remove] = nodeOf(wf, 'RemoveBackground')!
    const [invertId, invert] = nodeOf(wf, 'InvertMask')!
    const [joinId, join] = nodeOf(wf, 'JoinImageWithAlpha')!
    const [, save] = nodeOf(wf, 'SaveImage')!

    expect(load.inputs.image).toBe('photo.png')
    expect(model.inputs.bg_removal_name).toBe(BIREFNET.filename)
    expect(remove.inputs).toEqual({ bg_removal_model: [modelId, 0], image: [loadId, 0] })
    // JoinImageWithAlpha uses 1 - alpha, so the foreground mask goes in inverted.
    expect(invert.inputs.mask).toEqual([removeId, 0])
    expect(join.inputs).toEqual({ image: [loadId, 0], alpha: [invertId, 0] })
    expect(save.inputs.images).toEqual([joinId, 0])
  })

  it('the core path wins over RMBG when both are there', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ ...coreNodes([BIREFNET.filename]), ...RMBG } as never)
    const wf = await buildDynamicWorkflow(removebgParams)
    expect(classTypes(wf)).toContain('RemoveBackground')
    expect(classTypes(wf)).not.toContain('RMBG')
  })

  it('core nodes without a model fall back to RMBG when it is installed', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ ...coreNodes([]), ...RMBG } as never)
    const wf = await buildDynamicWorkflow(removebgParams)
    expect(classTypes(wf)).toContain('RMBG')
  })

  it('core nodes without a model and without RMBG: the error asks for the model, not the pack', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(coreNodes([]) as never)
    const err = await buildDynamicWorkflow(removebgParams).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    expect((err as Error).message).toMatch(/birefnet\.safetensors/)
    expect((err as Error).message).not.toMatch(/ComfyUI-RMBG/)
  })

  it('no nodes at all: update ComfyUI or install RMBG', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ LoadImage: {}, SaveImage: {} } as never)
    const err = await buildDynamicWorkflow(removebgParams).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    expect((err as Error).message).toMatch(/Update ComfyUI/)
  })
})

describe('addVideoSaveNodes: core mp4 first, older savers as fallbacks', () => {
  const run = (present: string[]) => {
    const wf: ComfyApiGraph = {}
    const next = addVideoSaveNodes(wf, 20, ['19', 0], 16, 'clip', (c) => present.includes(c))
    return { wf, next }
  }

  it('CreateVideo + SaveVideo, linked, when the core has both', () => {
    const { wf, next } = run(['CreateVideo', 'SaveVideo', 'VHS_VideoCombine', 'SaveAnimatedWEBP'])
    expect(wf['20']).toEqual({ class_type: 'CreateVideo', inputs: { images: ['19', 0], fps: 16 } })
    expect(wf['21'].class_type).toBe('SaveVideo')
    expect(wf['21'].inputs).toMatchObject({ video: ['20', 0], filename_prefix: 'clip' })
    expect(next).toBe(22)
  })

  it('VHS when the core cannot write video (one of the two nodes missing)', () => {
    const { wf, next } = run(['CreateVideo', 'VHS_VideoCombine'])
    expect(classTypes(wf)).toEqual(['VHS_VideoCombine'])
    expect(wf['20'].inputs).toMatchObject({ images: ['19', 0], frame_rate: 16, format: 'video/h264-mp4' })
    expect(next).toBe(21)
  })

  it('animated WEBP, then single frames', () => {
    expect(classTypes(run(['SaveAnimatedWEBP']).wf)).toEqual(['SaveAnimatedWEBP'])
    expect(classTypes(run([]).wf)).toEqual(['SaveImage'])
  })
})

describe('checkVideoOutputCapability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a core with CreateVideo + SaveVideo is mp4-capable without VHS, so no VHS prompt', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ CreateVideo: {}, SaveVideo: {}, SaveAnimatedWEBP: {} } as never)
    expect(await checkVideoOutputCapability()).toEqual({ mp4Capable: true, webpOnly: false, missingNodes: [] })
  })

  it('an old core with only animated WEBP still gets the offer', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ SaveAnimatedWEBP: {} } as never)
    const cap = await checkVideoOutputCapability()
    expect(cap.mp4Capable).toBe(false)
    expect(cap.webpOnly).toBe(true)
    expect(cap.missingNodes[0]).toMatch(/CreateVideo \+ SaveVideo/)
  })
})
