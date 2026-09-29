/**
 * HunyuanVideo 1.5 wird am Dateinamen erkannt, und die CFG-destillierte
 * Variante aus dem Katalog sampelt bei cfg 1 (FINDINGS 23).
 *
 * Am 29.09.2026 gegen ComfyUI 0.35 gerendert: der alte Graph (CLIPLoader
 * type 'wan', EmptyHunyuanLatentVideo) lieferte farbiges Rauschen, der neue
 * (DualCLIPLoader hunyuan_video_15, EmptyHunyuanVideo15Latent, shift 7) bei
 * 12 Schritten und cfg 1 einen sauberen Clip. Der Typ-Default cfg 6 ueberkocht
 * die destillierte Datei.
 *
 * Run: npx vitest run src/api/__tests__/hunyuan15-erkennung-und-cfg.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  isHunyuanVideo15, isCfgDistilledHunyuan15, HUNYUAN15_CATALOG_FILE, HUNYUAN15_DISTILLED_SAMPLING,
} from '../comfyui'
import { useCreateStore } from '../../stores/createStore'

describe('HunyuanVideo 1.5', () => {
  it('wird an den ueblichen Dateinamen erkannt, HunyuanVideo 1 nicht', () => {
    for (const f of ['hunyuanvideo1.5_480p_t2v_fp8.safetensors', 'hunyuanvideo1.5_720p_i2v_fp16.safetensors', 'HunyuanVideo-1.5-t2v.gguf', 'hunyuan_video_1_5_x.safetensors']) {
      expect(isHunyuanVideo15(f)).toBe(true)
    }
    for (const f of ['hunyuan_video_t2v_720p_bf16.safetensors', 'hunyuan_video_i2v_720_fp8.safetensors']) {
      expect(isHunyuanVideo15(f)).toBe(false)
    }
  })

  it('die destillierte Katalogdatei sampelt bei cfg 1, eine nicht destillierte nicht', () => {
    expect(isCfgDistilledHunyuan15(HUNYUAN15_CATALOG_FILE)).toBe(true)
    expect(isCfgDistilledHunyuan15('hunyuanvideo1.5_480p_t2v_cfg_distilled_fp8_scaled.safetensors')).toBe(true)
    expect(isCfgDistilledHunyuan15('hunyuanvideo1.5_720p_t2v_fp16.safetensors')).toBe(false)
    expect(HUNYUAN15_DISTILLED_SAMPLING.cfg).toBe(1)
  })

  it('die Create-Auswahl setzt fuer die Katalogdatei cfg 1 statt des Typ-Defaults 6', () => {
    useCreateStore.getState().setVideoModel(HUNYUAN15_CATALOG_FILE)
    expect(useCreateStore.getState().cfgScale).toBe(1)
    expect(useCreateStore.getState().steps).toBe(HUNYUAN15_DISTILLED_SAMPLING.steps)
    useCreateStore.getState().setVideoModel('hunyuanvideo1.5_720p_t2v_fp16.safetensors')
    expect(useCreateStore.getState().cfgScale).toBe(6)
  })
})
