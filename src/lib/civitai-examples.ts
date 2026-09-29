/**
 * "Pick an example from CivitAI" for every Create section that takes a prompt.
 *
 * CivitAI's public /api/v1/images feed lists images and videos with the
 * generation data their creators' tools embedded. A section shows that feed as
 * a grid; picking a tile copies its prompt, negative prompt and settings into
 * the section, and marks its LoRAs installed or not. civitai.red is the mirror
 * LU already offers (Settings, CivitAI host), so the feed comes from whichever
 * host is set.
 *
 * Only query parameters the public endpoint documents are sent (limit, cursor,
 * sort, period, nsfw). Media type and model family are filtered here, on the
 * items, because an unknown parameter is a 400 and an ignored one is a lie.
 *
 * Pure. The fetch is in api/civitai-examples.ts, the grid in
 * components/create/experimental/CivitaiExamples.tsx.
 */
import type { ModelType } from '../api/comfyui'
import type { CreateIntent } from '../stores/createStore'
import { civitaiFamily } from './civitai-base-models'
import { parseCivitaiImage, type CivitaiRecipe, type CivitaiRecipeLora } from './civitai-image-meta'

export type ExampleMedia = 'image' | 'video'

/** Which kind of example a Create section wants, or null when it takes none. */
export function examplesMediaFor(intent: CreateIntent): ExampleMedia | null {
  switch (intent) {
    case 'image':
    case 'edit':
      return 'image'
    case 'video':
    case 'animate':
    case 'extend':
      return 'video'
    default:
      return null
  }
}

export const EXAMPLE_SORTS = ['Most Reactions', 'Most Comments', 'Most Collected', 'Newest'] as const
export type ExampleSort = (typeof EXAMPLE_SORTS)[number]
export const EXAMPLE_PERIODS = ['Day', 'Week', 'Month', 'Year', 'AllTime'] as const
export type ExamplePeriod = (typeof EXAMPLE_PERIODS)[number]
/** CivitAI's browsing levels; each includes the ones before it. */
export const EXAMPLE_NSFW = ['None', 'Soft', 'Mature', 'X'] as const
export type ExampleNsfw = (typeof EXAMPLE_NSFW)[number]

export interface ExampleQuery {
  host: string
  sort: ExampleSort
  period: ExamplePeriod
  nsfw: ExampleNsfw
  cursor?: string
  /** Page size; the endpoint allows up to 200. Filtering happens here, so ask for plenty. */
  limit?: number
}

export function examplesUrl(q: ExampleQuery): string {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, Math.floor(q.limit ?? 100)))),
    sort: q.sort,
    period: q.period,
    nsfw: q.nsfw,
  })
  if (q.cursor) params.set('cursor', q.cursor)
  const host = /^civitai\.(com|red)$/i.test(q.host) ? q.host.toLowerCase() : 'civitai.com'
  return `https://${host}/api/v1/images?${params}`
}

export interface CivitaiExample {
  id: number
  media: ExampleMedia
  /** A small still for the grid (videos: their first frame). */
  thumbUrl: string
  url: string
  width?: number
  height?: number
  nsfwLevel?: string
  baseModel?: string
  username?: string
  recipe: CivitaiRecipe
}

export interface ExamplesPage {
  items: CivitaiExample[]
  nextCursor?: string
  /** How many items the page had before filtering, to tell "nothing here" from "nothing fits". */
  rawCount: number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * CivitAI's image CDN takes the transform in one path segment
 * (`/width=1024/`, `/original=true/`). A 450 px still is enough for a tile and
 * a fraction of the bytes; `anim=false` makes a video's tile its first frame,
 * so the grid needs no <video> at all. A URL without such a segment is left
 * alone: guessing a path is how a tile breaks.
 */
export function thumbnailUrl(url: string, media: ExampleMedia): string {
  const seg = media === 'video' ? 'anim=false,width=450' : 'width=450'
  const re = /\/((?:[a-z]+=[^/,]+,)*(?:width|original|height)=[^/]+)\/(?=[^/]+$)/i
  return re.test(url) ? url.replace(re, `/${seg}/`) : url
}

/** Parse one feed page. Items without generation data, or of the other media type, are dropped. */
export function parseExamplesPage(json: unknown, media: ExampleMedia): ExamplesPage {
  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const raw = Array.isArray(root.items) ? root.items : []
  const items: CivitaiExample[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const item = it as Record<string, unknown>
    const type = str(item.type).toLowerCase() || 'image'
    if ((type === 'video') !== (media === 'video')) continue
    const url = str(item.url)
    const id = num(item.id)
    if (!url || !id) continue
    const recipe = parseCivitaiImage(item)
    if (!recipe) continue
    const baseModel = recipe.baseModel || str(item.baseModel) || undefined
    items.push({
      id,
      media,
      url,
      thumbUrl: thumbnailUrl(url, media),
      ...(num(item.width) ? { width: num(item.width) } : {}),
      ...(num(item.height) ? { height: num(item.height) } : {}),
      ...(str(item.nsfwLevel) ? { nsfwLevel: str(item.nsfwLevel) } : {}),
      ...(baseModel ? { baseModel } : {}),
      ...(str(item.username) ? { username: str(item.username) } : {}),
      recipe: { ...recipe, ...(baseModel ? { baseModel } : {}) },
    })
  }
  const meta = root.metadata && typeof root.metadata === 'object' ? root.metadata as Record<string, unknown> : {}
  const next = meta.nextCursor
  const nextCursor = typeof next === 'string' && next ? next : typeof next === 'number' ? String(next) : undefined
  return { items, rawCount: raw.length, ...(nextCursor ? { nextCursor } : {}) }
}

/**
 * Keep the examples made with the family of the selected model. An unknown
 * model family keeps everything: there is nothing to compare with.
 */
export function fitsModelFamily(example: CivitaiExample, modelType: ModelType | undefined): boolean {
  if (!modelType || modelType === 'unknown') return true
  const fam = civitaiFamily(example.baseModel)
  return fam.supported && fam.family === modelType
}

/** The CivitAI page of an example, on the host the feed came from. */
export function examplePageUrl(id: number, host: string): string {
  const h = /^civitai\.(com|red)$/i.test(host) ? host.toLowerCase() : 'civitai.com'
  return `https://${h}/images/${id}`
}

/** File-name stem for matching a LoRA name against installed files. */
export function loraStem(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The installed LoRA file a recipe names, if any. An empty stem never matches. */
export function findInstalledLora(name: string, installed: readonly string[]): string | undefined {
  const s = loraStem(name)
  if (!s) return undefined
  return installed.find((f) => loraStem(f) === s) ?? installed.find((f) => loraStem(f).includes(s))
}

export interface AppliedExample {
  prompt: string
  negativePrompt: string
  sampler?: string
  scheduler?: string
  steps?: number
  cfg?: number
  seed?: number
  /** A1111 numbering, as the Create store keeps it (dynamic-workflow passes -clipSkip). */
  clipSkip?: number
  size?: { width: number; height: number }
  /** Installed LoRA files with the example's weight. */
  loras: { name: string; strength: number }[]
  /** LoRAs the example used that are not installed. */
  missingLoras: CivitaiRecipeLora[]
  /** Settings of the example that were NOT copied, and why. */
  skipped: string[]
  /** Things to know before rendering (e.g. the example used another model family). */
  notes: string[]
}

export interface ApplyContext {
  intent: CreateIntent
  /** ComfyUI's sampler and scheduler lists; empty when ComfyUI is not reachable. */
  samplers: readonly string[]
  schedulers: readonly string[]
  installedLoras: readonly string[]
  /** Family of the selected model, for the "made with another family" note. */
  modelType?: ModelType
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * What picking `recipe` changes in a Create section.
 *
 * - Prompt and negative always.
 * - Image sections also get sampler, scheduler (only names this ComfyUI lists:
 *   an unknown one is a 400), steps, CFG, seed, clip skip and LoRAs (weights
 *   clamped to the store's 0…2). Size only in the
 *   Image section: Edit keeps the size of its source picture.
 * - Video sections get prompt, negative and seed. Steps, CFG and samplers of a
 *   video model are tied to that model and its sampling scheme, and CivitAI's
 *   video metadata rarely says which scheme was used.
 */
export function applyExample(recipe: CivitaiRecipe, ctx: ApplyContext): AppliedExample {
  const out: AppliedExample = {
    prompt: recipe.prompt,
    negativePrompt: recipe.negativePrompt,
    loras: [],
    missingLoras: [],
    skipped: [],
    notes: [],
  }
  if (recipe.seed !== undefined && recipe.seed >= 0) out.seed = Math.floor(recipe.seed)
  const media = examplesMediaFor(ctx.intent)
  if (media === 'video') {
    if (recipe.steps !== undefined || recipe.cfg !== undefined || recipe.sampler) {
      out.skipped.push('steps, CFG and sampler: they belong to the video model the example used')
    }
    return out
  }

  if (recipe.sampler) {
    if (ctx.samplers.includes(recipe.sampler)) out.sampler = recipe.sampler
    else out.skipped.push(ctx.samplers.length
      ? `sampler ${recipe.samplerLabel ?? recipe.sampler}: this ComfyUI does not have it`
      : `sampler ${recipe.samplerLabel ?? recipe.sampler}: ComfyUI is not running, so it could not be checked`)
  }
  if (recipe.scheduler) {
    if (ctx.schedulers.includes(recipe.scheduler)) out.scheduler = recipe.scheduler
    else if (ctx.schedulers.length) out.skipped.push(`scheduler ${recipe.scheduler}: this ComfyUI does not have it`)
  }
  if (recipe.steps !== undefined) out.steps = clamp(Math.floor(recipe.steps), 1, 200)
  if (recipe.cfg !== undefined) out.cfg = clamp(recipe.cfg, 0, 30)
  if (recipe.width && recipe.height) {
    if (ctx.intent === 'image') out.size = { width: recipe.width, height: recipe.height }
    else out.skipped.push(`size ${recipe.width}×${recipe.height}: Edit keeps the size of its source picture`)
  }
  if (recipe.clipSkip !== undefined && recipe.clipSkip >= 1) out.clipSkip = clamp(Math.floor(recipe.clipSkip), 1, 12)

  for (const l of recipe.loras) {
    const file = findInstalledLora(l.name, ctx.installedLoras)
    if (file) {
      if (!out.loras.some((x) => x.name === file)) out.loras.push({ name: file, strength: clamp(l.weight, 0, 2) })
    } else {
      out.missingLoras.push(l)
    }
  }
  if (ctx.modelType && ctx.modelType !== 'unknown' && recipe.baseModel) {
    const fam = civitaiFamily(recipe.baseModel)
    if (fam.supported && fam.family !== ctx.modelType) {
      out.notes.push(`Made with ${fam.label}; the selected model is another family, so the result will look different.`)
    }
  }
  return out
}

/** The Create store setters applyExampleToStore uses (a subset of CreateState). */
export interface ExampleStoreSetters {
  showNegative: boolean
  setPrompt: (p: string) => void
  setNegativePrompt: (p: string) => void
  toggleNegative: () => void
  setSampler: (s: string) => void
  setScheduler: (s: string) => void
  setSteps: (n: number) => void
  setCfgScale: (n: number) => void
  setSeed: (n: number) => void
  setClipSkip: (n: number) => void
  setSize: (w: number, h: number) => void
  clearLoras: () => void
  toggleLora: (name: string) => void
  setLoraStrengthFor: (name: string, strength: number) => void
}

/**
 * Write an applied example into the Create store. The example's LoRAs replace
 * the current pick only when it used any: an example without LoRAs leaves the
 * user's own selection alone.
 */
export function applyExampleToStore(a: AppliedExample, st: ExampleStoreSetters, usedLoras: boolean): void {
  st.setPrompt(a.prompt)
  st.setNegativePrompt(a.negativePrompt)
  if (a.negativePrompt && !st.showNegative) st.toggleNegative()
  if (a.sampler) st.setSampler(a.sampler)
  if (a.scheduler) st.setScheduler(a.scheduler)
  if (a.steps !== undefined) st.setSteps(a.steps)
  if (a.cfg !== undefined) st.setCfgScale(a.cfg)
  if (a.seed !== undefined) st.setSeed(a.seed)
  if (a.clipSkip !== undefined) st.setClipSkip(a.clipSkip)
  if (a.size) st.setSize(a.size.width, a.size.height)
  if (usedLoras) {
    st.clearLoras()
    for (const l of a.loras) {
      st.toggleLora(l.name)
      st.setLoraStrengthFor(l.name, l.strength)
    }
  }
}
