/**
 * LTX-2.3 und Wan 2.2 A14B laufen auf den Graphen der offiziellen Templates
 * (Comfy-Org/workflow_templates dd9769b: video_ltx2_3_t2v/_i2v,
 * video_wan2_2_14B_t2v/_i2v), FINDINGS 23.
 *
 * Vorher: LTX-2 ging durch UNETLoader, VAEDecode bekam den MODEL-Ausgang, und
 * die Gemma-Projektion aus dem Checkpoint wurde nie geladen. Ein A14B-Experte
 * landete im TI2V-5B-Graphen mit Wan-2.2-VAE (48 Kanaele), den ein 14B-Modell
 * nicht fahren kann. Beide Graphen sind gegen die Knoten-Schemas von ComfyUI
 * 0.37 gebaut, nicht gerendert (die Modelle sind 29 und 2x14 GB).
 *
 * Run: npx vitest run src/api/__tests__/ltx2-und-wan22-a14b-nach-offiziellem-template.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})
vi.mock('../backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend')>()
  return { ...actual, localFetch: vi.fn(), comfyuiUrl: (p: string) => `http://test${p}` }
})
vi.mock('../comfyui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui')>()
  return {
    ...actual,
    findMatchingCLIP: vi.fn(async () => 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'),
    findMatchingVAE: vi.fn(async () => 'wan_2.1_vae.safetensors'),
  }
})

import { buildDynamicWorkflow, LTX2_SIGMAS, LTX2_REFINE_SIGMAS } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import {
  classifyModel, isI2VModel, isT2VCapable, isLtx2, wan22Expert, videoSamplingOverride,
  LTX2_SAMPLING, WAN22_A14B_SAMPLING,
} from '../comfyui'
import { useCreateStore } from '../../stores/createStore'
import { nodeOf, nodesOf } from './graph-test-support'

const LTX = 'ltx-2.3-22b-distilled-fp8.safetensors'
const LTX_DEV = 'ltx-2.3-22b-dev-fp8.safetensors'
const T2V_HIGH = 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors'
const T2V_LOW = 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'
const I2V_HIGH = 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'
const I2V_LOW = 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'

const node = (required: Record<string, unknown> = {}) => ({ input: { required } })
const LTX_NODES = {
  CheckpointLoaderSimple: node({ ckpt_name: [[LTX, LTX_DEV]] }),
  UNETLoader: node({ unet_name: [[]] }),
  CLIPLoader: node({ clip_name: [[]] }),
  LTXAVTextEncoderLoader: node({ text_encoder: [['gemma_3_12B_it_fp8_scaled.safetensors']] }),
  LTXVAudioVAELoader: node(), LTXVEmptyLatentAudio: node(), LTXVConcatAVLatent: node(),
  LTXVSeparateAVLatent: node(), LTXVAudioVAEDecode: node(), LTXVConditioning: node(),
  EmptyLTXVLatentVideo: node(), CFGGuider: node(), SamplerCustomAdvanced: node(),
  ManualSigmas: node(), KSamplerSelect: node(), RandomNoise: node(),
  LTXVPreprocess: node(), LTXVImgToVideoInplace: node(), VAEDecodeTiled: node(),
  CLIPTextEncode: node(), LoadImage: node({ image: [[]] }), CreateVideo: node(), SaveVideo: node(),
  LoraLoaderModelOnly: node({ lora_name: [[]] }),
}
const UPSCALER = {
  LTXVLatentUpsampler: node(), LTXVCropGuides: node(),
  LatentUpscaleModelLoader: node({ model_name: [['ltx-2.3-spatial-upscaler-x2-1.1.safetensors']] }),
}
const WAN_NODES = (unets: string[]) => ({
  UNETLoader: node({ unet_name: [unets] }),
  CLIPLoader: node({ clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']] }),
  VAELoader: node({ vae_name: [['wan_2.1_vae.safetensors', 'wan2.2_vae.safetensors']] }),
  KSamplerAdvanced: node(), ModelSamplingSD3: node(), EmptyHunyuanLatentVideo: node(),
  WanImageToVideo: node(), Wan22ImageToVideoLatent: node(), CLIPTextEncode: node(), VAEDecode: node(),
  LoadImage: node({ image: [[]] }), VHS_VideoCombine: node(), KSampler: node(),
})

const vid = (model: string, extra: Record<string, unknown> = {}) => ({
  model, prompt: 'a fox runs through snow', negativePrompt: '',
  sampler: 'euler', scheduler: 'simple', steps: 20, cfgScale: 3.5,
  width: 1280, height: 720, seed: 7, batchSize: 1, frames: 100, fps: 25, ...extra,
})

describe('Erkennung', () => {
  it('LTX-2 am Namen, LTX-Video 0.9 nicht', () => {
    for (const f of [LTX, LTX_DEV, 'ltx-2-19b-distilled.safetensors', 'LTX2_fp8.safetensors']) expect(isLtx2(f)).toBe(true)
    for (const f of ['ltx-video-2b-v0.9.5.safetensors', 'ltxv-13b-0.9.7-dev.safetensors']) expect(isLtx2(f)).toBe(false)
  })

  it('ein A14B-Experte ist Wan-2.1-Architektur, t2v oder i2v laut Name', () => {
    expect(wan22Expert(T2V_HIGH)).toBe('high')
    expect(wan22Expert(I2V_LOW)).toBe('low')
    expect(wan22Expert('wan2.2_ti2v_5B_fp16.safetensors')).toBeNull()
    expect(classifyModel(T2V_HIGH)).toBe('wan')
    expect(classifyModel('wan2.2_ti2v_5B_fp16.safetensors')).toBe('wan22')
    expect([isT2VCapable(T2V_HIGH), isI2VModel(T2V_HIGH)]).toEqual([true, false])
    expect([isT2VCapable(I2V_HIGH), isI2VModel(I2V_HIGH)]).toEqual([false, true])
  })

  it('die Create-Auswahl uebernimmt die Template-Werte', () => {
    expect(videoSamplingOverride(LTX)).toEqual(LTX2_SAMPLING)
    useCreateStore.getState().setVideoModel(T2V_HIGH)
    expect(useCreateStore.getState()).toMatchObject({ steps: WAN22_A14B_SAMPLING.steps, cfgScale: WAN22_A14B_SAMPLING.cfg })
  })
})

describe('LTX-2.3 nach video_ltx2_3_t2v / _i2v', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ein Durchgang ohne Upscaler: ein Checkpoint speist Modell, Video-VAE, Audio-VAE und Gemma, Ton im Video', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(LTX_NODES as never)
    const wf = await buildDynamicWorkflow(vid(LTX) as never, 'ltx')
    const [ckptId, ckpt] = nodeOf(wf, 'CheckpointLoaderSimple')!
    expect(ckpt.inputs.ckpt_name).toBe(LTX)
    expect(nodeOf(wf, 'UNETLoader')).toBeUndefined()
    expect(nodeOf(wf, 'LTXVAudioVAELoader')![1].inputs.ckpt_name).toBe(LTX)
    expect(nodeOf(wf, 'LTXAVTextEncoderLoader')![1].inputs).toMatchObject({ text_encoder: 'gemma_3_12B_it_fp8_scaled.safetensors', ckpt_name: LTX })
    // Voller destillierter Plan bei cfg 1, keine KSampler-Schritte.
    expect(nodesOf(wf, 'ManualSigmas').map(([, n]) => n.inputs.sigmas)).toEqual([LTX2_SIGMAS])
    expect(nodeOf(wf, 'CFGGuider')![1].inputs.cfg).toBe(1)
    expect(nodeOf(wf, 'KSampler')).toBeUndefined()
    // 1280x720 auf das 32er-Raster, 100 Frames auf 8k+1.
    expect(nodeOf(wf, 'EmptyLTXVLatentVideo')![1].inputs).toMatchObject({ width: 1280, height: 736, length: 97 })
    expect(nodeOf(wf, 'LTXVEmptyLatentAudio')![1].inputs).toMatchObject({ frames_number: 97, frame_rate: 25 })
    // Dekodiert mit der Video-VAE des Checkpoints (Ausgang 2), nicht mit MODEL.
    expect(nodeOf(wf, 'VAEDecodeTiled')![1].inputs.vae).toEqual([ckptId, 2])
    const [audioId] = nodeOf(wf, 'LTXVAudioVAEDecode')!
    expect(nodeOf(wf, 'CreateVideo')![1].inputs.audio).toEqual([audioId, 0])
    expect(nodeOf(wf, 'SaveVideo')).toBeDefined()
  })

  it('mit Upscaler die zwei Durchgaenge des Templates: halbe Groesse, x2, kurzer Plan mit CropGuides', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ ...LTX_NODES, ...UPSCALER } as never)
    const wf = await buildDynamicWorkflow(vid(LTX) as never, 'ltx')
    expect(nodeOf(wf, 'EmptyLTXVLatentVideo')![1].inputs).toMatchObject({ width: 640, height: 352 })
    expect(nodesOf(wf, 'ManualSigmas').map(([, n]) => n.inputs.sigmas)).toEqual([LTX2_SIGMAS, LTX2_REFINE_SIGMAS])
    expect(nodeOf(wf, 'LatentUpscaleModelLoader')![1].inputs.model_name).toBe('ltx-2.3-spatial-upscaler-x2-1.1.safetensors')
    const [cropId] = nodeOf(wf, 'LTXVCropGuides')!
    const guiders = nodesOf(wf, 'CFGGuider')
    expect(guiders[1][1].inputs.positive).toEqual([cropId, 0])
  })

  it('i2v: vorverarbeitetes Bild in beide Durchgaenge, Staerke 0.7 dann 1.0', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({ ...LTX_NODES, ...UPSCALER } as never)
    const wf = await buildDynamicWorkflow(vid(LTX, { inputImage: 'still.png' }) as never, 'ltx')
    const [prepId, prep] = nodeOf(wf, 'LTXVPreprocess')!
    expect(prep.inputs.img_compression).toBe(18)
    const inplace = nodesOf(wf, 'LTXVImgToVideoInplace').map(([, n]) => n.inputs)
    expect(inplace.map((i) => i.strength)).toEqual([0.7, 1.0])
    expect(inplace.every((i) => JSON.stringify(i.image) === JSON.stringify([prepId, 0]))).toBe(true)
  })

  it('eine Datei in diffusion_models wird mit Anweisung abgelehnt statt falsch geladen', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue({
      ...LTX_NODES,
      CheckpointLoaderSimple: node({ ckpt_name: [['sd_xl_base_1.0.safetensors']] }),
      UNETLoader: node({ unet_name: [[LTX]] }),
    } as never)
    await expect(buildDynamicWorkflow(vid(LTX) as never, 'ltx')).rejects.toThrow(/Move it to models\/checkpoints/)
  })

  it('der dev-Checkpoint braucht die destillierte LoRA des Templates bei 0.5', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(LTX_NODES as never)
    await expect(buildDynamicWorkflow(vid(LTX_DEV) as never, 'ltx')).rejects.toThrow(/distilled LoRA/)
    const lora = 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors'
    vi.mocked(getAllNodeInfo).mockResolvedValue({ ...LTX_NODES, LoraLoaderModelOnly: node({ lora_name: [[lora]] }) } as never)
    const wf = await buildDynamicWorkflow(vid(LTX_DEV) as never, 'ltx')
    expect(nodeOf(wf, 'LoraLoaderModelOnly')![1].inputs).toMatchObject({ lora_name: lora, strength_model: 0.5 })
  })
})

describe('Wan 2.2 A14B nach video_wan2_2_14B_t2v / _i2v', () => {
  beforeEach(() => vi.clearAllMocks())

  it('t2v: beide Experten, Uebergabe nach der Haelfte der Schritte, Wan-2.1-VAE, shift 5', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(WAN_NODES([T2V_HIGH, T2V_LOW]) as never)
    // Gewaehlt ist der low-noise-Experte: der Partner wird am Namen gefunden.
    const wf = await buildDynamicWorkflow(vid(T2V_LOW) as never, 'wan')
    const unets = nodesOf(wf, 'UNETLoader').map(([id, n]) => [id, n.inputs.unet_name])
    expect(unets.map(([, u]) => u)).toEqual([T2V_HIGH, T2V_LOW])
    expect(nodeOf(wf, 'VAELoader')![1].inputs.vae_name).toBe('wan_2.1_vae.safetensors')
    expect(nodesOf(wf, 'ModelSamplingSD3').map(([, n]) => n.inputs.shift)).toEqual([5, 5])
    expect(nodeOf(wf, 'EmptyHunyuanLatentVideo')![1].inputs).toMatchObject({ width: 1280, height: 720, length: 101 })
    expect(nodeOf(wf, 'Wan22ImageToVideoLatent')).toBeUndefined()
    const [[firstId, first], [, second]] = nodesOf(wf, 'KSamplerAdvanced')
    expect(first.inputs).toMatchObject({ add_noise: 'enable', start_at_step: 0, end_at_step: 10, return_with_leftover_noise: 'enable', steps: 20, cfg: 3.5, noise_seed: 7 })
    expect(second.inputs).toMatchObject({ add_noise: 'disable', start_at_step: 10, end_at_step: 10000, return_with_leftover_noise: 'disable', latent_image: [firstId, 0] })
    // Der erste Sampler laeuft auf dem high-noise-Experten.
    const highShift = nodesOf(wf, 'ModelSamplingSD3').find(([, n]) => JSON.stringify(n.inputs.model) === JSON.stringify([unets[0][0], 0]))!
    expect(first.inputs.model).toEqual([highShift[0], 0])
  })

  it('i2v: WanImageToVideo liefert Konditionierung und Latent fuer beide Sampler', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(WAN_NODES([I2V_HIGH, I2V_LOW]) as never)
    const wf = await buildDynamicWorkflow(vid(I2V_HIGH, { inputImage: 'still.png' }) as never, 'wan')
    const [i2vId, i2v] = nodeOf(wf, 'WanImageToVideo')!
    expect(i2v.inputs).toMatchObject({ width: 1280, height: 720, length: 101, batch_size: 1 })
    for (const [, s] of nodesOf(wf, 'KSamplerAdvanced')) {
      expect(s.inputs.positive).toEqual([i2vId, 0])
      expect(s.inputs.negative).toEqual([i2vId, 1])
    }
    expect(nodesOf(wf, 'KSamplerAdvanced')[0][1].inputs.latent_image).toEqual([i2vId, 2])
  })

  it('ohne Partner, oder mit dem falschen Modus, eine klare Absage', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(WAN_NODES([T2V_HIGH]) as never)
    await expect(buildDynamicWorkflow(vid(T2V_HIGH) as never, 'wan')).rejects.toThrow(/needs both experts/)
    vi.mocked(getAllNodeInfo).mockResolvedValue(WAN_NODES([T2V_HIGH, T2V_LOW]) as never)
    await expect(buildDynamicWorkflow(vid(T2V_HIGH, { inputImage: 'still.png' }) as never, 'wan')).rejects.toThrow(/cannot animate/)
    vi.mocked(getAllNodeInfo).mockResolvedValue(WAN_NODES([I2V_HIGH, I2V_LOW]) as never)
    await expect(buildDynamicWorkflow(vid(I2V_LOW) as never, 'wan')).rejects.toThrow(/needs a source image/)
  })
})
