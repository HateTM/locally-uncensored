/**
 * The live "Trending on Hugging Face" feed for text models in Discover.
 *
 * The curated catalogue (getUncensoredTextModels / getMainstreamTextModels) is
 * compiled into the app, so a model released after the last app release never
 * shows up there. This feed asks Hugging Face what is trending right now, and
 * keeps only what the LU Engine can actually run.
 *
 * The filter that matters is the architecture. Hugging Face reports
 * `gguf.architecture` for every GGUF repo (`expand[]=gguf`), and the engine
 * only opens the architectures its pinned llama.cpp knows
 * (lib/llama-architectures.ts). A repo whose architecture is not on that list
 * would download tens of gigabytes and then fail to load; api/gguf-arch.ts
 * tells the GLM 5.3 Flash story. Such repos are dropped and counted, so the UI
 * can say how many were left out and why.
 *
 * Also dropped: gated repos (the download would need a Hugging Face token the
 * app does not ask for) and repos below a small popularity floor (trending
 * lists carry a long tail of fresh re-uploads).
 *
 * The file itself is not resolved here. Each entry carries the same guessed
 * Q4_K_M name the HF search uses; handleTextDownload in DiscoverModels
 * resolves the real file tree (quant, subfolder, split parts, sha256) before
 * anything is downloaded.
 */
import type { DiscoverModel } from './model-bundles'
import { deriveQ4FilenameFromRepo } from './discover'
import { LLAMA_ARCHITECTURES } from '../lib/llama-architectures'
import { asNumber, asRecordArray, asString, prop } from '../types/json-guards'
import { log } from '../lib/logger'

/** How many repos to ask for. Filtering removes a good share of them. */
export const TRENDING_FETCH_LIMIT = 60

/** Below both of these a trending repo is noise: a fresh re-upload nobody uses yet. */
export const MIN_DOWNLOADS = 1000
export const MIN_LIKES = 20

/** How long one answer is reused. Trending moves over hours, not seconds. */
export const TRENDING_TTL_MS = 60 * 60 * 1000

/**
 * Bytes per parameter of a Q4_K_M file, for the size estimate before the file
 * tree is known. Q4_K_M averages about 4.85 bits per weight; measured on the
 * catalogue's own Qwen 2.5 7B Q4_K_M (4 683 074 240 bytes for 7.62 B params)
 * that is 0.61 bytes per parameter.
 */
export const Q4_BYTES_PER_PARAM = 0.61

const UNFILTERED_RE = /uncensor|abliterat|heretic|unfilter|nsfw|decensor/i

export const TRENDING_URL =
  'https://huggingface.co/api/models?filter=gguf&pipeline_tag=text-generation&sort=trendingScore&direction=-1'
  + `&limit=${TRENDING_FETCH_LIMIT}`
  + '&expand[]=gguf&expand[]=downloads&expand[]=likes&expand[]=lastModified&expand[]=gated'

export interface TrendingResult {
  models: DiscoverModel[]
  /** Architectures the engine cannot load, with how many trending repos use each. */
  unsupported: Record<string, number>
  /** Repos left out because they are gated. */
  gated: number
}

function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

/** "27B", "7.6B", "600M" from a parameter count. */
export function paramsLabel(total: number): string {
  if (total >= 1e9) {
    const b = total / 1e9
    return `${b >= 10 ? Math.round(b) : Number(b.toFixed(1))}B`
  }
  return `${Math.round(total / 1e6)}M`
}

/**
 * Turn Hugging Face's answer into Discover entries. Pure, so the filter rules
 * are tested without a network.
 */
export function toTrendingModels(raw: unknown, architectures: ReadonlySet<string> = LLAMA_ARCHITECTURES): TrendingResult {
  const models: DiscoverModel[] = []
  const unsupported: Record<string, number> = {}
  let gated = 0

  for (const repo of asRecordArray(raw)) {
    const id = asString(prop(repo, 'id'))
    if (!id || !id.includes('/')) continue
    // `gated` is false, or "auto" / "manual" when access has to be requested.
    const gate = prop(repo, 'gated')
    if (gate !== undefined && gate !== false && gate !== null) { gated++; continue }

    const gguf = prop(repo, 'gguf')
    const arch = asString(prop(gguf, 'architecture'))
    if (!arch) continue
    if (!architectures.has(arch)) {
      unsupported[arch] = (unsupported[arch] ?? 0) + 1
      continue
    }

    const downloads = asNumber(prop(repo, 'downloads')) ?? 0
    const likes = asNumber(prop(repo, 'likes')) ?? 0
    if (downloads < MIN_DOWNLOADS && likes < MIN_LIKES) continue

    const repoName = id.split('/').pop() ?? id
    const displayName = repoName.replace(/-gguf$/i, '')
    const total = asNumber(prop(gguf, 'total'))
    const ctx = asNumber(prop(gguf, 'context_length'))
    const lastModified = asString(prop(repo, 'lastModified')) ?? ''
    const q4File = deriveQ4FilenameFromRepo(repoName)

    const tags = [
      ...(total ? [paramsLabel(total)] : []),
      'Q4_K_M',
      'GGUF',
      ...(UNFILTERED_RE.test(id) ? ['Unfiltered'] : []),
      ...(ctx ? [`${Math.round(ctx / 1024)}K ctx`] : []),
    ]

    models.push({
      name: displayName,
      description: `${id} · ${arch}${lastModified ? ` · updated ${lastModified.slice(0, 10)}` : ''} · live from Hugging Face, not tested by LU`,
      pulls: compactCount(downloads),
      tags,
      updated: lastModified.slice(0, 10),
      released: lastModified.slice(0, 7),
      downloadUrl: `https://huggingface.co/${id}/resolve/main/${q4File}`,
      filename: q4File,
      url: `https://huggingface.co/${id}`,
      ...(total ? { sizeGB: Math.round(((total * Q4_BYTES_PER_PARAM) / 1_073_741_824) * 10) / 10 } : {}),
    })
  }
  return { models, unsupported, gated }
}

let cache: { at: number; result: TrendingResult } | null = null

/** Test-only: forget the cached answer. */
export function __resetTrendingCache(): void {
  cache = null
}

/**
 * The trending feed, cached for TRENDING_TTL_MS. Never throws: an empty
 * result is what the section renders as "nothing to show", and the curated
 * catalogue above it is unaffected.
 */
export async function fetchTrendingTextModels(now: number = Date.now()): Promise<TrendingResult> {
  if (cache && now - cache.at < TRENDING_TTL_MS) return cache.result
  try {
    const { isTauri, fetchExternal } = await import('./backend')
    const json = isTauri() ? await fetchExternal(TRENDING_URL) : await (await fetch(TRENDING_URL)).text()
    const result = toTrendingModels(JSON.parse(json))
    cache = { at: now, result }
    return result
  } catch (err) {
    log.warn('[discover] Hugging Face trending feed failed', { err })
    return { models: [], unsupported: {}, gated: 0 }
  }
}
