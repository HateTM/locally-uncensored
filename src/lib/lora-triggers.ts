/**
 * What LU remembers about a downloaded LoRA: CivitAI's trigger words.
 *
 * Most LoRAs only switch on when their trigger word is in the prompt. CivitAI
 * lists those words per version ("trainedWords"), and LU learns them when it
 * downloads the LoRA (lora_download, the Models LoRA tab). lib/lora-auto.ts
 * puts them in front of the prompt of every render that uses the LoRA.
 */

export interface LoraInfo {
  /** CivitAI's trigger words, in its order. */
  triggers: string[]
  /** Base model it was trained for ("SDXL 1.0", "Wan Video 2.2 I2V-A14B"). */
  baseModel?: string
  /** Display name on CivitAI. */
  name?: string
  /** The file name as downloaded (the key is its lower-cased form). */
  file?: string
}

/** At most this many words per LoRA: lists past a handful are tag dumps,
 *  and the first entries are the activators. */
export const MAX_TRIGGERS_PER_LORA = 3

/** The key a LoRA is remembered under: its file name, no folder, lower case. */
export function loraKey(filename: string): string {
  return filename.replace(/^.*[\\/]/, '').toLowerCase()
}

/** Find the remembered entry for a requested LoRA name. Names reach this from
 *  a model, so the extension may be missing ("pixel_art" for pixel_art.safetensors). */
export function findLoraInfo(requested: string, known: Record<string, LoraInfo>): LoraInfo | null {
  const key = loraKey(requested)
  if (known[key]) return known[key]
  const stem = key.replace(/\.(safetensors|ckpt|pt|pth|bin)$/, '')
  for (const [k, info] of Object.entries(known)) {
    if (k.replace(/\.(safetensors|ckpt|pt|pth|bin)$/, '') === stem) return info
  }
  return null
}
