/**
 * The numbers under each side of A/B Compare.
 *
 * FINDINGS 17: the old stats ran from before `chatStream` to the last chunk and
 * divided stream CHUNKS by that time. For two local models the round swaps the
 * engine between them, so the time was mostly a model load and the "t/s" said
 * which model loaded faster. Chunks are not tokens either: Ollama and
 * llama-server send about one token per chunk, cloud providers batch several.
 *
 * Now, in order of trust:
 *   - tokens: the server's own count (`evalCount`, Ollama and Anthropic), else
 *     the chunk count, marked as an estimate;
 *   - speed: the server's generation time (`evalDurationMs`, Ollama: excludes
 *     load and prompt processing), else tokens over the time from the first
 *     chunk to the last, which leaves the load out;
 *   - the wait before the first chunk is its own number, so a load still shows.
 */
export interface CompareStats {
  tokens: number
  /** Whole round for this side, request to last chunk, load included. */
  timeMs: number
  tokensPerSec: number
  /** Request to first content chunk: load plus prompt processing. */
  firstTokenMs?: number
  /** 'server' when tokens and speed come from the backend's own counters;
   *  missing means estimate. */
  source?: 'server' | 'estimate'
}

export interface CompareTiming {
  startedAt: number
  firstChunkAt: number | null
  endedAt: number
  chunks: number
  evalCount?: number
  evalDurationMs?: number
}

export function compareStats(t: CompareTiming): CompareStats {
  const timeMs = Math.max(0, t.endedAt - t.startedAt)
  const firstTokenMs = t.firstChunkAt === null ? undefined : Math.max(0, t.firstChunkAt - t.startedAt)
  const serverTokens = t.evalCount && t.evalCount > 0 ? t.evalCount : undefined
  const tokens = serverTokens ?? t.chunks

  let tokensPerSec = 0
  if (serverTokens && t.evalDurationMs && t.evalDurationMs > 0) {
    tokensPerSec = serverTokens / (t.evalDurationMs / 1000)
  } else if (t.firstChunkAt !== null && t.endedAt > t.firstChunkAt) {
    tokensPerSec = tokens / ((t.endedAt - t.firstChunkAt) / 1000)
  }

  return {
    tokens,
    timeMs,
    tokensPerSec,
    ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    source: serverTokens && t.evalDurationMs && t.evalDurationMs > 0 ? 'server' : 'estimate',
  }
}
