/**
 * Token estimate that follows how a BPE tokenizer cuts text, instead of a flat
 * chars / 4.
 *
 * chars / 4 is English prose. Against the Qwen 2.5 tokenizer it under-read
 * Russian prose by 29 %, pretty-printed JSON by up to 36 % and TypeScript by
 * 10 % (FINDINGS 15). The mechanical context trim fires at 0.92 of the window
 * AS ESTIMATED, so a Russian chat reached about 1.27 × the real window before
 * anything was trimmed: llama-server refused the request and Ollama silently
 * cut the prompt at num_ctx.
 *
 * The text is walked once, in the pieces a BPE pre-tokenizer makes, and each
 * piece is priced:
 *   - a Latin word            1 token per 4 letters, at least 1
 *   - a word in another script (Cyrillic, Greek, CJK, …)
 *                             1 token per 2.8 letters, at least 1
 *   - a digit                 1 token (Qwen and Llama 2 split every digit)
 *   - a run of punctuation    1 token per 6 characters, at least 1; a lone
 *                             symbol right before a word rides with it
 *   - a whitespace run        1.5 tokens, except the single space in front of a
 *                             word or symbol, which rides with it for free
 *
 * Calibrated with the Qwen 2.5 tokenizer on English, German, Russian, TypeScript,
 * Rust, compact and pretty-printed JSON and the agent's tool catalog: every
 * sample within -8 % … +15 % (old formula: -36 % … +9 %). German prose is the
 * low end: its long compounds cost more per letter than English words do.
 * The error leans high on purpose: an estimate over the truth trims a little
 * early, one under it sends past the window.
 *
 * Pure, no imports: agent-tasks.ts and friends take it without pulling the
 * provider tree along. No regex either: a hand-written scan is several times
 * faster, and the meter runs this over the whole history.
 */

const LATIN_CHARS_PER_TOKEN = 4
const OTHER_CHARS_PER_TOKEN = 2.8
const PUNCT_CHARS_PER_TOKEN = 6
const WHITESPACE_RUN_TOKENS = 1.5

// Character classes. Plain numbers, not an enum: erasableSyntaxOnly.
const SPACE = 0
const NEWLINE = 1
const LATIN = 2
const OTHER = 3
const DIGIT = 4
const PUNCT = 5
type Kind = typeof SPACE | typeof NEWLINE | typeof LATIN | typeof OTHER | typeof DIGIT | typeof PUNCT

function kind(c: number): Kind {
  if (c < 0x80) {
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) return LATIN
    if (c >= 0x30 && c <= 0x39) return DIGIT
    if (c === 0x20 || c === 0x09) return SPACE
    if (c === 0x0a || c === 0x0d) return NEWLINE
    return PUNCT
  }
  // Latin-1 letters and Latin Extended (ä ö ü ß é ł …), minus × and ÷
  if (c >= 0x00c0 && c <= 0x024f && c !== 0xd7 && c !== 0xf7) return LATIN
  if (c === 0xa0 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a)) return SPACE
  // General punctuation, symbols, arrows, box drawing … (— “ ” • → ✓)
  if ((c >= 0x2010 && c <= 0x2bff) || (c >= 0x3001 && c <= 0x303f) || (c >= 0xa1 && c <= 0xbf) || c === 0xd7 || c === 0xf7) {
    return PUNCT
  }
  // Everything else is a letter of some script, or an emoji half; both are
  // priced like the denser non-Latin words.
  return OTHER
}

/** Estimated tokens for `text`, never below 1. */
export function estimateTokens(text: string): number {
  let sum = 0
  let i = 0
  const n = text.length
  // The last whitespace char was a space that became the leading char of
  // the piece starting here (the pre-tokenizer takes at most one).
  let spaceLed = false
  while (i < n) {
    const k = kind(text.charCodeAt(i))
    const led = spaceLed
    spaceLed = false
    if (k === DIGIT) {
      sum += 1
      i++
      continue
    }
    if (k === LATIN || k === OTHER) {
      // One word; a change of script inside it (e.g. "GPUшка") just prices
      // each letter at its own rate.
      let latin = 0
      let other = 0
      while (i < n) {
        const kk = kind(text.charCodeAt(i))
        if (kk === LATIN) latin++
        else if (kk === OTHER) other++
        else break
        i++
      }
      sum += Math.max(1, latin / LATIN_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN)
      continue
    }
    if (k === PUNCT) {
      let len = 0
      while (i < n && kind(text.charCodeAt(i)) === PUNCT) {
        len++
        i++
      }
      // A lone symbol in front of a word ("(x", ".foo", '"name') is one
      // piece with that word, as in the pre-tokenizer, unless a space
      // already leads it (' "name' is ' "' + 'name').
      const nextKind = i < n ? kind(text.charCodeAt(i)) : SPACE
      if (len === 1 && !led && (nextKind === LATIN || nextKind === OTHER)) continue
      sum += Math.max(1, len / PUNCT_CHARS_PER_TOKEN)
      continue
    }
    // Whitespace: a space right before something visible leads that piece;
    // the rest of the run (indentation, newlines) is a piece of its own.
    const start = i
    while (i < n) {
      const kk = kind(text.charCodeAt(i))
      if (kk !== SPACE && kk !== NEWLINE) break
      i++
    }
    spaceLed = i < n && kind(text.charCodeAt(i - 1)) === SPACE
    if (i - start > (spaceLed ? 1 : 0)) sum += WHITESPACE_RUN_TOKENS
  }
  return Math.ceil(sum) + 1
}
