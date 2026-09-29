/**
 * Which LU model family a CivitAI `baseModel` belongs to, and whether LU can
 * run it locally.
 *
 * CivitAI tags every model version with a base model out of a fixed list
 * (GET /api/v1/enums, `BaseModel`, read 2026-09-29). The list below covers the
 * ones LU has a local pipeline for; everything else is "not supported", with
 * the reason where there is a specific one. A checkpoint or LoRA of a family
 * LU cannot run downloads fine and then does nothing: ComfyUI loads a foreign
 * LoRA with "lora key not loaded" warnings and no effect, while its trigger
 * words still land in the prompt (FINDINGS 25).
 *
 * Deliberately conservative. A family is only mapped when LU's graph for it
 * matches ComfyUI's; the families whose local graph does not currently match
 * (FINDINGS 23: Wan 2.2 A14B, LTX, HunyuanVideo) are listed as unsupported
 * with that reason instead of being offered as compatible.
 */
import type { ModelType } from '../api/comfyui'

export type CivitaiFamily =
  | { supported: true; family: ModelType; label: string }
  | { supported: false; reason: string }

const SUPPORTED: Record<string, { family: ModelType; label: string }> = {}
const add = (family: ModelType, label: string, bases: string[]) => {
  for (const b of bases) SUPPORTED[b] = { family, label }
}

add('sd15', 'SD 1.5', ['SD 1.4', 'SD 1.5', 'SD 1.5 LCM', 'SD 1.5 Hyper'])
// Pony, Illustrious and NoobAI are SDXL finetunes: same loader, same LoRA
// shape. Playground v2 ships SDXL-architecture weights as well.
add('sdxl', 'SDXL', ['SDXL 0.9', 'SDXL 1.0', 'SDXL 1.0 LCM', 'SDXL Lightning', 'SDXL Hyper', 'SDXL Turbo', 'SDXL Distilled', 'Playground v2'])
add('sdxl', 'Pony (SDXL)', ['Pony'])
add('sdxl', 'Illustrious (SDXL)', ['Illustrious'])
add('sdxl', 'NoobAI (SDXL)', ['NoobAI'])
add('flux', 'FLUX.1', ['Flux.1 S', 'Flux.1 D', 'Flux.1 Krea'])
add('flux2', 'FLUX.2', ['Flux.2 D', 'Flux.2 Klein 9B', 'Flux.2 Klein 9B-base', 'Flux.2 Klein 4B', 'Flux.2 Klein 4B-base'])
add('krea2', 'Krea 2', ['Krea 2'])
add('zimage', 'Z-Image', ['ZImageTurbo', 'ZImageBase'])
add('qwenimage', 'Qwen-Image 2.1', ['Qwen 2.1'])
add('qwenimage1', 'Qwen-Image', ['Qwen'])
add('ernie_image', 'ERNIE-Image', ['Ernie'])
add('chroma', 'Chroma', ['Chroma'])
add('hidream', 'HiDream', ['HiDream'])
add('sd3', 'SD 3.5', ['SD 3', 'SD 3.5', 'SD 3.5 Large', 'SD 3.5 Large Turbo', 'SD 3.5 Medium'])
add('lumina2', 'Lumina 2', ['Lumina'])
add('wan', 'Wan 2.1', ['Wan Video', 'Wan Video 1.3B t2v', 'Wan Video 14B t2v', 'Wan Video 14B i2v 480p', 'Wan Video 14B i2v 720p'])
add('wan22', 'Wan 2.2 TI2V-5B', ['Wan Video 2.2 TI2V-5B'])
add('svd', 'SVD', ['SVD', 'SVD XT'])
add('mochi', 'Mochi', ['Mochi'])

const REASONS: Record<string, string> = {
  'Wan Video 2.2 I2V-A14B': 'Wan 2.2 A14B (high/low noise) has no local pipeline in LU yet',
  'Wan Video 2.2 T2V-A14B': 'Wan 2.2 A14B (high/low noise) has no local pipeline in LU yet',
  'LTXV': 'LTX Video is not wired correctly in LU yet',
  'LTXV2': 'LTX Video is not wired correctly in LU yet',
  'LTXV 2.3': 'LTX Video is not wired correctly in LU yet',
  'LTXV 2.5': 'LTX Video is not wired correctly in LU yet',
  'Hunyuan Video': 'HunyuanVideo is not wired correctly in LU yet',
  'CogVideoX': 'CogVideoX is switched off in LU',
  'Pony V7': 'Pony V7 is AuraFlow-based, not SDXL, and LU has no AuraFlow pipeline',
  'Flux.1 Kontext': 'FLUX Kontext editing has no local pipeline in LU',
}

/** The LU family of a CivitAI base model, or why LU cannot run it. */
export function civitaiFamily(baseModel: string | undefined): CivitaiFamily {
  const b = (baseModel ?? '').trim()
  if (!b) return { supported: false, reason: 'CivitAI names no base model for it' }
  const hit = SUPPORTED[b]
  if (hit) return { supported: true, ...hit }
  return { supported: false, reason: REASONS[b] ?? `LU has no local pipeline for ${b}` }
}

/**
 * Whether a LoRA trained for `baseModel` (CivitAI's tag) fits a model of LU
 * family `modelType`. Only a CERTAIN mismatch says no: both sides known, the
 * LoRA's base mapped to a supported family, and that family not the model's.
 *
 * Everything else says yes, because refusing it would be a guess:
 *   - no model family ('unknown', or none passed): nothing to compare with;
 *   - no base model recorded (a LoRA LU did not download from CivitAI);
 *   - a base LU has no pipeline for. Wan 2.2 A14B LoRAs are the case that
 *     matters: the "Rapid AIO" merges classify as 'wan' and run exactly
 *     those LoRAs, so "unsupported" must not read as "does not fit".
 */
export function loraFitsModel(baseModel: string | undefined, modelType: ModelType | undefined): boolean {
  if (!modelType || modelType === 'unknown') return true
  const family = civitaiFamily(baseModel)
  if (!family.supported) return true
  return family.family === modelType
}
