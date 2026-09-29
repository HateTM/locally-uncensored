/**
 * Automatic LoRA prompts.
 *
 * Most LoRAs only work when their trigger words, or a prompt written for them,
 * are in the prompt. LU keeps one prompt per LoRA file and puts it in front of
 * the user's prompt whenever that LoRA is used, the way the Wan 2.2 I2V
 * "lora_loader" spaces do it:
 *
 *   - a prompt the user saved for the LoRA (lora_prompt tool, JSON import)
 *     wins; otherwise the trigger words CivitAI lists for it, remembered when
 *     LU downloaded it (lib/lora-triggers.ts);
 *   - of a saved prompt only the leading concept clause (up to the first comma
 *     or semicolon) is used, so the LoRA's example scene never overrides the
 *     user's own; `keepFullPrompt` keeps all of it, for LoRAs whose prompt IS
 *     the effect (a camera move, a quality booster);
 *   - several LoRAs join with "; ", and a clause already in the prompt is not
 *     added twice;
 *   - a saved `negative` is appended to the negative prompt the same way.
 *
 * Pure; the saved prompts live in stores/loraInfoStore.ts.
 */
import { findLoraInfo, loraKey, MAX_TRIGGERS_PER_LORA, type LoraInfo } from './lora-triggers'

export interface LoraPrompt {
  /** Goes in front of the positive prompt. May be '' when only `negative` is set. */
  prompt: string
  keepFullPrompt?: boolean
  /** Appended to the negative prompt, in full. */
  negative?: string
}

/** The leading concept clause of a LoRA prompt. */
export function triggerClause(prompt: string): string {
  const t = prompt.trim()
  const cut = [t.indexOf(','), t.indexOf(';')].filter((i) => i >= 0)
  return cut.length ? t.slice(0, Math.min(...cut)).trim() : t
}

/** Lower case, every non-alphanumeric run one space, padded: "face-off" and
 *  "face off" compare equal, and a match respects word edges. */
export function normalizeForMatch(text: string): string {
  const t = (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return ` ${t} `
}

const stem = (name: string) => loraKey(name).replace(/\.(safetensors|ckpt|pt|pth|bin)$/, '')

/** The saved prompt for a requested LoRA name (extension and case optional). */
export function findLoraPrompt(requested: string, saved: Record<string, LoraPrompt>): LoraPrompt | null {
  const key = loraKey(requested)
  if (saved[key]) return saved[key]
  const s = stem(requested)
  for (const [k, v] of Object.entries(saved)) if (stem(k) === s) return v
  return null
}

/** The text one LoRA contributes, or '' when LU knows nothing for it. */
export function loraAddition(lora: string, saved: Record<string, LoraPrompt>, known: Record<string, LoraInfo>): string {
  const own = findLoraPrompt(lora, saved)
  if (own?.prompt.trim()) return own.keepFullPrompt ? own.prompt.trim() : triggerClause(own.prompt)
  const info = findLoraInfo(lora, known)
  return info ? info.triggers.slice(0, MAX_TRIGGERS_PER_LORA).map((w) => w.trim()).filter(Boolean).join(', ') : ''
}

/** The prompt with every used LoRA's addition in front of it. */
export function withLoraPrompts(
  prompt: string,
  loras: readonly string[],
  saved: Record<string, LoraPrompt>,
  known: Record<string, LoraInfo>,
): string {
  const have = normalizeForMatch(prompt)
  const add: string[] = []
  for (const lora of loras) {
    const a = loraAddition(lora, saved, known)
    const n = normalizeForMatch(a).trim()
    if (!n || have.includes(` ${n} `) || add.some((x) => normalizeForMatch(x).trim() === n)) continue
    add.push(a)
  }
  if (add.length === 0) return prompt
  return prompt.trim() ? `${add.join('; ')}, ${prompt}` : add.join('; ')
}

/** The negative prompt with every used LoRA's saved negative appended. */
export function withLoraNegatives(
  negative: string,
  loras: readonly string[],
  saved: Record<string, LoraPrompt>,
): string {
  const have = normalizeForMatch(negative)
  const add: string[] = []
  for (const lora of loras) {
    const neg = findLoraPrompt(lora, saved)?.negative?.trim() ?? ''
    const n = normalizeForMatch(neg).trim()
    if (!n || have.includes(` ${n} `) || add.some((x) => normalizeForMatch(x).trim() === n)) continue
    add.push(neg)
  }
  if (add.length === 0) return negative
  return negative.trim() ? `${negative}, ${add.join(', ')}` : add.join(', ')
}

/**
 * Read saved prompts from JSON. Accepted shapes:
 *   { "file.safetensors": "prompt", ... }
 *   [ { "file": "...", "prompt": "...", "negative": "...", "keepFullPrompt": true }, ... ]
 *   { "entries": [ ...same... ] }
 * Entries without a file, or with neither prompt nor negative, are dropped
 * and counted.
 */
export function parseLoraPrompts(json: unknown): { prompts: Record<string, LoraPrompt>; dropped: number } | string {
  const prompts: Record<string, LoraPrompt> = {}
  let dropped = 0
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null
  const list = Array.isArray(json) ? json : Array.isArray(obj?.entries) ? obj!.entries as unknown[] : null
  if (list) {
    for (const raw of list) {
      const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
      const file = typeof r?.file === 'string' ? r.file.trim() : ''
      const prompt = typeof r?.prompt === 'string' ? r.prompt.trim() : ''
      const negative = typeof r?.negative === 'string' ? r.negative.trim() : ''
      if (!file || (!prompt && !negative)) { dropped++; continue }
      prompts[loraKey(file)] = {
        prompt,
        ...(negative ? { negative } : {}),
        ...(r!.keepFullPrompt === true ? { keepFullPrompt: true } : {}),
      }
    }
    return { prompts, dropped }
  }
  if (!obj) return 'Expected a JSON object {"file.safetensors": "prompt"} or an array of {file, prompt} entries.'
  for (const [file, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim() && file.trim()) prompts[loraKey(file)] = { prompt: v.trim() }
    else dropped++
  }
  return { prompts, dropped }
}
