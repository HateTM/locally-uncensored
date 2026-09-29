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
