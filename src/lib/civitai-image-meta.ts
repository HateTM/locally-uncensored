/**
 * Read the generation recipe of a CivitAI image ("make it like this one").
 *
 * CivitAI's public API answers /api/v1/images?imageId=<id> with the image and
 * the metadata its creator's tool embedded: prompt, negative prompt, sampler,
 * steps, CFG, seed, size, clip skip, the checkpoint and the LoRAs with their
 * weights. The metadata is whatever the generator wrote (A1111, ComfyUI,
 * CivitAI's own), so every field is optional and read defensively.
 *
 * Pure. The fetch is in api/mcp/media-tools.ts.
 */

export interface CivitaiRecipeLora {
  name: string
  weight: number
  /** CivitAI model VERSION id, when the metadata links one (lora_download versionId). */
  versionId?: number
}

export interface CivitaiRecipe {
  imageId: number
  prompt: string
  negativePrompt: string
  /** ComfyUI names, translated from A1111's ("DPM++ 2M Karras"). */
  sampler?: string
  scheduler?: string
  /** As the metadata spelled it, for the report. */
  samplerLabel?: string
  steps?: number
  cfg?: number
  seed?: number
  width?: number
  height?: number
  clipSkip?: number
  checkpoint?: string
  checkpointVersionId?: number
  baseModel?: string
  loras: CivitaiRecipeLora[]
}

/** The image id in a civitai.com / civitai.red image link, or a bare number. */
export function civitaiImageId(ref: string): number | null {
  const t = ref.trim()
  if (/^\d+$/.test(t)) return Number(t)
  const m = /civitai\.(?:com|red)\/images\/(\d+)/i.exec(t)
  return m ? Number(m[1]) : null
}

/** The CivitAI host a link points at, so a civitai.red link is fetched there. */
export function civitaiHostOf(ref: string): string | null {
  const m = /\b(civitai\.(?:com|red))\b/i.exec(ref)
  return m ? m[1].toLowerCase() : null
}

const SAMPLERS: Record<string, string> = {
  'euler a': 'euler_ancestral',
  'euler': 'euler',
  'lms': 'lms',
  'heun': 'heun',
  'dpm2': 'dpm_2',
  'dpm2 a': 'dpm_2_ancestral',
  'dpm++ 2s a': 'dpmpp_2s_ancestral',
  'dpm++ 2m': 'dpmpp_2m',
  'dpm++ sde': 'dpmpp_sde',
  'dpm++ 2m sde': 'dpmpp_2m_sde',
  'dpm++ 2m sde gpu': 'dpmpp_2m_sde_gpu',
  'dpm++ 3m sde': 'dpmpp_3m_sde',
  'dpm fast': 'dpm_fast',
  'dpm adaptive': 'dpm_adaptive',
  'ddim': 'ddim',
  'unipc': 'uni_pc',
  'lcm': 'lcm',
  'deis': 'deis',
  'restart': 'restart',
}

const SCHEDULER_SUFFIXES: [RegExp, string][] = [
  [/\s+karras$/i, 'karras'],
  [/\s+exponential$/i, 'exponential'],
  [/\s+sgm\s+uniform$/i, 'sgm_uniform'],
  [/\s+simple$/i, 'simple'],
  [/\s+beta$/i, 'beta'],
]

/**
 * A1111 / CivitAI sampler label to ComfyUI sampler + scheduler. A label that
 * is already a ComfyUI name passes through. Unknown labels give nothing: the
 * model default is better than a guess ComfyUI would reject.
 */
export function translateSampler(label: string, schedulerLabel?: string): { sampler?: string; scheduler?: string } {
  let l = label.trim()
  let scheduler: string | undefined
  for (const [re, name] of SCHEDULER_SUFFIXES) {
    if (re.test(l)) { scheduler = name; l = l.replace(re, ''); break }
  }
  const sched = schedulerLabel?.trim().toLowerCase().replace(/\s+/g, '_')
  if (sched && /^[a-z_]+$/.test(sched) && sched !== 'automatic') scheduler = sched
  const key = l.toLowerCase()
  if (SAMPLERS[key]) return { sampler: SAMPLERS[key], ...(scheduler ? { scheduler } : {}) }
  if (/^[a-z0-9_]+$/.test(l)) return { sampler: l, ...(scheduler ? { scheduler } : {}) }
  return scheduler ? { scheduler } : {}
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

/** `<lora:name:0.8>` tags an A1111 prompt carries; ComfyUI would read them as words. */
const LORA_TAG = /<lora:([^:>]+)(?::([\d.]+))?(?::[^>]*)?>/gi

/**
 * The recipe from an /api/v1/images answer (or one item of it). Null when the
 * answer has no image, or the image carries no prompt at all (CivitAI hides
 * the metadata of some images, and then there is nothing to reproduce).
 */
export function parseCivitaiImage(json: unknown): CivitaiRecipe | null {
  const root = rec(json)
  const items = Array.isArray(root?.items) ? root!.items as unknown[] : root ? [root] : []
  const item = rec(items[0])
  if (!item) return null
  let meta = rec(item.meta)
  // Some answers nest the generator's block one level deeper.
  if (meta && !str(meta.prompt) && rec(meta.meta)) meta = rec(meta.meta)
  if (!meta) return null

  const loras: CivitaiRecipeLora[] = []
  const seen = new Set<string>()
  const add = (l: CivitaiRecipeLora) => {
    const key = l.versionId ? `v${l.versionId}` : l.name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    loras.push(l)
  }
  let checkpoint = str(meta.Model) || undefined
  let checkpointVersionId: number | undefined
  for (const raw of Array.isArray(meta.civitaiResources) ? meta.civitaiResources : []) {
    const r = rec(raw)
    if (!r) continue
    const type = str(r.type).toLowerCase()
    const versionId = num(r.modelVersionId)
    if (type === 'checkpoint') {
      checkpointVersionId = versionId
      if (!checkpoint) checkpoint = str(r.modelVersionName) || undefined
    } else if (type === 'lora' || type === 'locon' || type === 'dora') {
      add({ name: str(r.modelVersionName) || str(r.modelName) || `version ${versionId}`, weight: num(r.weight) ?? 1, ...(versionId ? { versionId } : {}) })
    }
  }
  for (const raw of Array.isArray(meta.resources) ? meta.resources : []) {
    const r = rec(raw)
    if (!r) continue
    const type = str(r.type).toLowerCase()
    if (type === 'model' && !checkpoint) checkpoint = str(r.name) || undefined
    if ((type === 'lora' || type === 'locon') && str(r.name)) {
      if (!loras.some((l) => l.name.toLowerCase() === str(r.name).toLowerCase())) add({ name: str(r.name), weight: num(r.weight) ?? 1 })
    }
  }

  let prompt = str(meta.prompt)
  for (const m of prompt.matchAll(LORA_TAG)) {
    if (!loras.some((l) => l.name.toLowerCase() === m[1].toLowerCase())) add({ name: m[1], weight: num(m[2]) ?? 1 })
  }
  prompt = prompt.replace(LORA_TAG, '').replace(/\s*,\s*,+/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '')
  if (!prompt) return null

  const size = /^(\d+)\s*x\s*(\d+)$/i.exec(str(meta.Size))
  const samplerLabel = str(meta.sampler) || undefined
  const translated = samplerLabel ? translateSampler(samplerLabel, str(meta.scheduler) || str(meta['Schedule type']) || undefined) : {}
  return {
    imageId: num(item.id) ?? 0,
    prompt,
    negativePrompt: str(meta.negativePrompt).replace(LORA_TAG, '').trim(),
    ...translated,
    ...(samplerLabel ? { samplerLabel } : {}),
    ...(num(meta.steps) !== undefined ? { steps: num(meta.steps) } : {}),
    ...(num(meta.cfgScale) !== undefined ? { cfg: num(meta.cfgScale) } : {}),
    ...(num(meta.seed) !== undefined ? { seed: num(meta.seed) } : {}),
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    ...(num(meta.clipSkip ?? meta['Clip skip']) !== undefined ? { clipSkip: num(meta.clipSkip ?? meta['Clip skip']) } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(checkpointVersionId ? { checkpointVersionId } : {}),
    ...(str(meta.baseModel) ? { baseModel: str(meta.baseModel) } : {}),
    loras,
  }
}
