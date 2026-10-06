/**
 * Will a GGUF run fully on the graphics card? The hint on Discover's text tiles.
 *
 * It used to read the file size alone (<= 85 % of VRAM was "fits"), while the
 * LU Engine decides by weights PLUS the KV cache of the context it starts
 * with (`plan_offload` in src-tauri/src/commands/engine.rs). At a long context
 * the two disagreed: a 12B Q4 on a 12 GB card read "Runs on your PC" at 32K,
 * where the cache alone is about 5 GB and the engine keeps layers in RAM
 * (FINDINGS 13 / 14).
 *
 * "fits" now uses the engine's own sum: weights + 4 MiB of cache per layer per
 * 1K tokens + a reserve. Before a download there is no GGUF header, so the
 * layer count is estimated from the size (estimateLayers).
 *
 * Pure; the caller passes the context the engine will actually start with.
 */

/** KV cache per layer per 1024 tokens, the engine's KV_BYTES_PER_LAYER_PER_1K_CTX. */
export const KV_MIB_PER_LAYER_PER_1K = 4

/**
 * Held back for the driver, the desktop and the compute buffers, in GiB.
 *
 * The engine takes 0.5 GiB out of a MEASURED free reading and 2 GiB out of a
 * total one. Discover only knows the card's total, and what the desktop uses
 * sits in between those two, so the hint takes 1 GiB.
 */
export const FIT_RESERVE_GB = 1

/** The engine's default --ctx-size (lib/builtin-ctx.ts ENGINE_DEFAULT_CTX). */
export const DEFAULT_FIT_CTX = 8192

/** Q4_K_M bytes per parameter (api/discover-trending.ts Q4_BYTES_PER_PARAM). */
const Q4_BYTES_PER_PARAM = 0.61

/**
 * Transformer layers of a model whose Q4 GGUF is `sizeGB` GiB.
 *
 * 12 · B^0.45 with B the parameters in billions, fitted on the common chat
 * models: 1B ~12 (Llama 3.2 1B: 16), 7-8B ~30 (Qwen 2.5 7B: 28, Llama 3.1 8B:
 * 32), 12B ~37 (Mistral Nemo: 40), 27B ~53 (Gemma 3: 62), 70B ~81 (Llama: 80).
 * A lower quant makes the size read as fewer parameters and so fewer layers;
 * for the hint that errs by a fraction of the cache, never of the weights.
 */
export function estimateLayers(sizeGB: number): number {
  const paramsB = (sizeGB * 1_073_741_824) / Q4_BYTES_PER_PARAM / 1e9
  return Math.max(8, Math.round(12 * Math.pow(Math.max(paramsB, 0.1), 0.45)))
}

/** KV cache in GiB at `ctx` tokens, rounded up to whole 1K like the engine. */
export function kvCacheGb(sizeGB: number, ctx: number): number {
  const ctxK = Math.ceil(Math.max(ctx, 1) / 1024)
  return (estimateLayers(sizeGB) * ctxK * KV_MIB_PER_LAYER_PER_1K) / 1024
}

export type Fit = 'fits' | 'tight' | 'big' | 'unknown'

/**
 * - fits:  weights + cache + reserve fit the card, so the engine puts every
 *          layer on it.
 * - tight: the weights alone are at most 115 % of the card; it loads, with
 *          some layers in RAM.
 * - big:   most of it runs on the CPU.
 * Never used to block a download, only to describe it.
 */
export function computeFit(sizeGB: number | undefined, vramGb: number | null, ctx: number = DEFAULT_FIT_CTX): Fit {
  if (!sizeGB || !vramGb) return 'unknown'
  if (sizeGB + kvCacheGb(sizeGB, ctx) + FIT_RESERVE_GB <= vramGb) return 'fits'
  if (sizeGB <= vramGb * 1.15) return 'tight'
  return 'big'
}

/** The context the LU Engine starts with: the tuned value, else its default. */
export function engineCtx(tunedCtx: number | null | undefined): number {
  return typeof tunedCtx === 'number' && tunedCtx > 0 ? tunedCtx : DEFAULT_FIT_CTX
}

/*
 * Upstream 3.0.5: catalogue-based verdicts for the media model bundles
 * (api/model-bundles), beside the engine-based one for the GGUF chat models.
 */

/**
 * How a local media model compares with the user's graphics card.
 *
 * The owner's test box (RTX 3060, 12 GB, October 2026) sat more than 300 s in
 * "Loading the model into memory" on Z-Image: an 11.5 GB diffusion model next
 * to a 7.5 GB text encoder. The catalogue said "10-16 GB" and the card was
 * inside that span, so nothing warned him. The span was honest, it just was not
 * read: its lower end is where the model starts to run at all, its upper end is
 * where it runs without moving weights out of graphics memory.
 *
 * This file is that reading, once, for every bundle:
 *
 *   - `vramMinGB` is the lower end of the catalogue's own text.
 *   - `vramComfortGB` is its upper end, and never less than the largest single
 *     weight plus working memory. Text encoder and diffusion model load one
 *     after the other, so the largest one is what has to fit, and a sampler
 *     needs room next to its weights.
 *   - A card below the minimum needs more, a card from the comfortable value
 *     up fits, everything between is tight: it runs, and loading can be slow.
 *
 * This file measures nothing. Every number comes out of the catalogue's
 * `vramRequired` text and its file sizes; where that text is a measurement,
 * the bundle says so beside it (api/model-bundles.ts). A text that names no
 * number at all ("depends on the checkpoint") gets no verdict instead of a
 * guessed one.
 *
 * The tight line names no duration. Measured on the same 12 GB card on
 * 03.10.2026, Z-Image (tight) loaded cold in 65 to 76 s and once in 19
 * minutes, so "loading takes minutes" was wrong most of the time and too
 * kind once.
 *
 * Pure and without imports, so api/model-bundles can stamp its entries with it
 * and no import cycle can form.
 */

/** Room a model needs in graphics memory beside its largest weight, in GB. */
export const VRAM_WORKING_GB = 1.5

/** How long a load may run before a tight model gets its own sentence. */
export const SLOW_LOAD_HINT_AFTER_MS = 60_000

export interface VramNeed {
  /** From this much graphics memory the model runs at all. 0: the catalogue names no floor. */
  vramMinGB: number
  /** From this much it runs without moving weights out of graphics memory. */
  vramComfortGB: number
}

/** The two fields as a bundle carries them. Null: the catalogue's text names no number. */
export interface VramNeedFields {
  vramMinGB: number | null
  vramComfortGB: number | null
}

export type VramFit = 'fits' | 'tight' | 'big' | 'unknown'

interface NeedSource {
  vramRequired?: string
  files?: readonly { sizeGB?: number }[]
  /**
   * The comfortable value as the model's authors state it, for a model that is
   * built to run with most of its weights outside graphics memory. It replaces
   * the largest-weight rule, which would call such a model tight on every card
   * smaller than its file. Only beside a source that says so.
   */
  vramComfortStatedGB?: number
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** The largest single file of a bundle in GB, 0 when it lists none. */
export function largestWeightGb(files: readonly { sizeGB?: number }[] = []): number {
  return files.reduce((max, f) => Math.max(max, f.sizeGB ?? 0), 0)
}

/**
 * What the catalogue's text and file sizes say a bundle needs.
 *
 *   "10-16 GB"                      from 10, comfortable from 16
 *   "12+ GB", "16 GB"               from that number, comfortable from it too
 *   "16 GB best, offloads on less"  no floor, comfortable from 16
 *   "any"                           no floor, comfortable from the file size up
 *   anything without a number       null, no verdict
 *
 * In every case the comfortable value is raised to the largest weight plus
 * working memory, so a span whose upper end is below its own diffusion model
 * (FLUX.1 FP8: "8-10 GB" beside a 16.1 GB file) cannot call a 12 GB card a fit.
 * The one exception is a bundle that states its comfortable value itself
 * (`vramComfortStatedGB`): that number stands as written.
 */
export function deriveVramNeed(source: NeedSource): VramNeed | null {
  const text = (source.vramRequired ?? '').trim()
  let min: number
  let top: number
  const span = text.match(/(\d+)\s*-\s*(\d+)/)
  const best = text.match(/(\d+)\s*GB\s+best/i)
  const single = text.match(/(\d+)/)
  if (span) {
    min = parseInt(span[1], 10)
    top = parseInt(span[2], 10)
  } else if (best) {
    min = 0
    top = parseInt(best[1], 10)
  } else if (single) {
    min = parseInt(single[1], 10)
    top = min
  } else if (/^any$/i.test(text)) {
    min = 0
    top = 0
  } else {
    return null
  }
  if (typeof source.vramComfortStatedGB === 'number') {
    return { vramMinGB: min, vramComfortGB: source.vramComfortStatedGB }
  }
  const largest = largestWeightGb(source.files)
  const weight = largest > 0 ? round1(largest + VRAM_WORKING_GB) : 0
  return { vramMinGB: min, vramComfortGB: Math.max(top, weight) }
}

/** Stamps a list of catalogue entries with the two fields. */
export function withVramNeed<T extends NeedSource>(bundles: readonly T[]): (T & VramNeedFields)[] {
  return bundles.map((b) => {
    const need = deriveVramNeed(b)
    return { ...b, vramMinGB: need?.vramMinGB ?? null, vramComfortGB: need?.vramComfortGB ?? null }
  })
}

/** The card size the verdict and the wording use: whole GB, null when none was detected. */
export function cardGb(vramGb: number | null | undefined): number | null {
  if (typeof vramGb !== 'number' || !Number.isFinite(vramGb) || vramGb <= 0) return null
  return Math.max(1, Math.round(vramGb))
}

/** Where a bundle stands on a card. Unknown without a card or without a stated need. */
export function vramFit(need: Partial<VramNeedFields>, vramGb: number | null | undefined): VramFit {
  const card = cardGb(vramGb)
  if (card === null) return 'unknown'
  if (typeof need.vramMinGB !== 'number' || typeof need.vramComfortGB !== 'number') return 'unknown'
  if (card < need.vramMinGB) return 'big'
  if (card < need.vramComfortGB) return 'tight'
  return 'fits'
}

/**
 * The same question for a file no bundle names (a CivitAI download): only its
 * size is known, so the answer is fit or tight and never "needs more". A file
 * size states no minimum.
 */
export function fileVramFit(sizeGB: number | null | undefined, vramGb: number | null | undefined): VramFit {
  const card = cardGb(vramGb)
  if (card === null || typeof sizeGB !== 'number' || !Number.isFinite(sizeGB) || sizeGB <= 0) return 'unknown'
  return sizeGB + VRAM_WORKING_GB > card ? 'tight' : 'fits'
}

/** The short line: on a Model Manager card and on a row of the model picker. */
export function vramFitLabel(fit: VramFit, vramGb: number | null | undefined): string {
  const card = cardGb(vramGb)
  if (card === null) return ''
  if (fit === 'fits') return `Fits your ${card} GB card`
  if (fit === 'tight') return `Tight on your ${card} GB card`
  if (fit === 'big') return `Needs more than your ${card} GB card`
  return ''
}

/** The line on a Model Manager card, where there is room to say what tight means. */
export function vramFitLine(fit: VramFit, vramGb: number | null | undefined): string {
  const label = vramFitLabel(fit, vramGb)
  return fit === 'tight' && label ? `${label}: runs, loading can be slow` : label
}

/**
 * What the card's verdict rests on, for the tooltip. Always both halves: from
 * where it runs, and from where it loads fully. A catalogue text without a
 * floor ("16 GB best, offloads on less", "any") says the first half in words.
 * It used to drop it, and a card reading "Tight: runs" had a tooltip that did
 * not say it runs (the box, 04.10.2026: Wan 2.2 S2V FP8, the Qwen cards).
 */
export function vramNeedTitle(need: Partial<VramNeedFields>): string {
  if (typeof need.vramMinGB !== 'number' || typeof need.vramComfortGB !== 'number') return ''
  const runs = need.vramMinGB > 0
    ? `Runs from ${need.vramMinGB} GB.`
    : 'Runs on smaller cards too, with part of the model kept outside graphics memory.'
  return `${runs} Loads fully into graphics memory from ${need.vramComfortGB} GB.`
}

/**
 * The sentence the waiting area adds once a load has run for a minute on a
 * model that does not sit comfortably on the card. '' in every other case, so
 * a model that fits, an undetected card and a short load all stay silent.
 */
export function slowLoadHint(fit: VramFit, elapsedMs: number, afterMs: number = SLOW_LOAD_HINT_AFTER_MS): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < afterMs) return ''
  if (fit === 'big') return 'This model is larger than your graphics memory, so loading is slow.'
  if (fit === 'tight') return 'This model is a tight fit for your graphics memory, so loading is slow.'
  return ''
}

interface CatalogueEntry extends VramNeedFields {
  files: readonly { filename?: string }[]
}

/**
 * What the catalogue says about a file on the disk, or null when it cannot say.
 *
 * An installed model is a file name, and the catalogue knows a file name only
 * when a bundle lists it. Null when no bundle does (a CivitAI download), when
 * the bundle names no number, or when two bundles list the file and disagree:
 * in each of those cases the caller falls back to the file's own size.
 */
export function needForInstalledFile(filename: string, bundles: readonly CatalogueEntry[]): VramNeed | null {
  const base = (filename.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (!base) return null
  let found: VramNeed | null = null
  for (const b of bundles) {
    if (!b.files.some((f) => f.filename?.toLowerCase() === base)) continue
    if (typeof b.vramMinGB !== 'number' || typeof b.vramComfortGB !== 'number') return null
    if (found && (found.vramMinGB !== b.vramMinGB || found.vramComfortGB !== b.vramComfortGB)) return null
    found = { vramMinGB: b.vramMinGB, vramComfortGB: b.vramComfortGB }
  }
  return found
}
