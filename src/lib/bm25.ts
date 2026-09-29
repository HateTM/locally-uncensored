/**
 * BM25 keyword scores for a whole corpus in one pass.
 *
 * The old `bm25Score(query, doc, allDocs)` was called once per chunk and redid
 * all the corpus work every time: re-split every document for the average
 * length, and scanned every document for each term's document frequency. That
 * is O(N² · Q) per message, on the renderer thread. Measured with the old code
 * copied verbatim (~500-char chunks, 8-word query): 0.25 s at 200 chunks,
 * 5.9 s at 1000 (a ~150-page PDF), 52 s at 3000 (FINDINGS 8).
 *
 * Here the corpus is tokenized once, lengths, the average and the document
 * frequencies are counted once, and every document is scored in one sweep:
 * O(N · L + N · Q).
 *
 * Two inconsistencies of the old code are gone with it:
 *   - term frequency counted exact whitespace tokens while document frequency
 *     counted substrings, so "cat," never counted as "cat" but "category" did
 *     count for the document frequency. Both count tokens now;
 *   - the tokenizer is letters and digits in any script (\p{L}\p{N}), so
 *     punctuation no longer sticks to a word and Cyrillic tokenizes the same
 *     way Latin does.
 *
 * Pure, no DOM.
 */

const K1 = 1.2
const B = 0.75
/** The average length the old code fell back to for an empty corpus. */
const FALLBACK_AVG_DL = 200

/** Lower-cased runs of letters and digits, in any script. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** BM25 of `query` against every document of `docs`, in the order given. */
export function bm25Scores(query: string, docs: readonly string[]): number[] {
  const queryTerms = tokenize(query)
  if (docs.length === 0) return []
  if (queryTerms.length === 0) return docs.map(() => 0)

  const wanted = new Set(queryTerms)
  const n = docs.length
  const lengths = new Array<number>(n)
  // Per document, the frequency of each QUERY term only: nothing else is ever
  // looked up, so nothing else is counted.
  const tfs = new Array<Map<string, number>>(n)
  const df = new Map<string, number>()
  let total = 0
  for (let i = 0; i < n; i++) {
    const tokens = tokenize(docs[i])
    lengths[i] = tokens.length
    total += tokens.length
    const tf = new Map<string, number>()
    for (const t of tokens) if (wanted.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1)
    tfs[i] = tf
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const avgDl = total / n || FALLBACK_AVG_DL
  const idf = new Map<string, number>()
  for (const t of wanted) {
    const d = df.get(t) ?? 0
    idf.set(t, Math.log((n - d + 0.5) / (d + 0.5) + 1))
  }

  const scores = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const tf = tfs[i]
    const norm = K1 * (1 - B + (B * lengths[i]) / avgDl)
    let score = 0
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0
      if (f === 0) continue
      score += idf.get(term)! * ((f * (K1 + 1)) / (f + norm))
    }
    scores[i] = score
  }
  return scores
}
