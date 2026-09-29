import { describe, it, expect } from "vitest"
import { bm25Scores, tokenize } from "../bm25"

/** The pre-FINDINGS-8 scorer, verbatim, as the reference for plain text. */
function oldBm25(query: string, document: string, allDocs: string[]): number {
  const queryTerms = query.toLowerCase().split(/\s+/)
  const docTerms = document.toLowerCase().split(/\s+/)
  const docLen = docTerms.length
  const numDocs = allDocs.length || 1
  const avgDl = allDocs.reduce((sum, d) => sum + d.split(/\s+/).length, 0) / numDocs || 200
  const k1 = 1.2
  const b = 0.75
  let score = 0
  for (const term of queryTerms) {
    const tf = docTerms.filter((t) => t === term).length
    const docsWithTerm = allDocs.filter((d) => d.toLowerCase().includes(term)).length
    const idf = Math.log((numDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1)
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / avgDl)))
  }
  return score
}

describe("tokenize", () => {
  it("splits on anything that is not a letter or digit, in any script", () => {
    expect(tokenize("Hello, World! v2")).toEqual(["hello", "world", "v2"])
    expect(tokenize("Привет, мир.")).toEqual(["привет", "мир"])
    expect(tokenize("  ")).toEqual([])
  })
})

describe("bm25Scores", () => {
  it("matches the old scorer on punctuation-free text with no substring overlaps", () => {
    const docs = [
      "the quick brown fox jumps over the lazy dog",
      "a lazy afternoon in the sun",
      "wolves and dogs are not friends",
      "nothing relevant here at all",
    ]
    const query = "lazy fox"
    const got = bm25Scores(query, docs)
    docs.forEach((d, i) => expect(got[i]).toBeCloseTo(oldBm25(query, d, docs), 10))
  })

  it("counts a word next to punctuation as the word", () => {
    const [withComma, without] = bm25Scores("cat", ["my cat, the best", "a dog"])
    expect(withComma).toBeGreaterThan(0)
    expect(without).toBe(0)
  })

  it("does not count a substring as a document containing the term", () => {
    // "category" must not lower the idf of "cat": with the old substring df
    // both docs "contained" cat.
    const [a] = bm25Scores("cat", ["cat here", "category there"])
    const [b] = bm25Scores("cat", ["cat here", "dog there"])
    expect(a).toBeCloseTo(b, 12)
  })

  it("ranks Cyrillic the same way as Latin", () => {
    const s = bm25Scores("кошка", ["моя кошка, спит", "собака гуляет", "кошка кошка кошка"])
    expect(s[1]).toBe(0)
    expect(s[2]).toBeGreaterThan(s[0])
    expect(s[0]).toBeGreaterThan(0)
  })

  it("handles empty inputs", () => {
    expect(bm25Scores("x", [])).toEqual([])
    expect(bm25Scores("", ["a", "b"])).toEqual([0, 0])
    expect(bm25Scores("!!", ["a"])).toEqual([0])
    expect(bm25Scores("a", ["", ""])).toEqual([0, 0])
  })

  it("scores 3000 chunks fast (was ~50 s)", () => {
    const words = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu".split(" ")
    const docs = Array.from({ length: 3000 }, (_, i) =>
      Array.from({ length: 80 }, (_, j) => words[(i * 7 + j * 3) % words.length] + (j % 5)).join(" "),
    )
    const t0 = performance.now()
    const s = bm25Scores("alpha1 gamma2 kappa3 mu4 beta0 delta1 iota2 zeta3", docs)
    const ms = performance.now() - t0
    expect(s).toHaveLength(3000)
    expect(s.every(Number.isFinite)).toBe(true)
    expect(ms).toBeLessThan(1000)
  })
})
