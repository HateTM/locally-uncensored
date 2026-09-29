import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { findLoraInfo, loraKey, type LoraInfo } from '../lib/lora-triggers'
import { withLoraPrompts, withLoraNegatives, type LoraPrompt } from '../lib/lora-auto'
import { loraFitsModel } from '../lib/civitai-base-models'
import type { ModelType } from '../api/comfyui'

/**
 * The automatic prompt side of LoRAs (lib/lora-auto.ts), keyed by file name:
 *
 *   - `known`: CivitAI trigger words of the LoRAs LU downloaded;
 *   - `prompts`: prompts the user saved per LoRA (lora_prompt tool), which win.
 */
interface LoraInfoState {
  known: Record<string, LoraInfo>
  prompts: Record<string, LoraPrompt>
  remember: (filename: string, info: LoraInfo) => void
  setPrompt: (filename: string, prompt: LoraPrompt | null) => void
  mergePrompts: (prompts: Record<string, LoraPrompt>) => void
}

export const useLoraInfoStore = create<LoraInfoState>()(
  persist(
    (set) => ({
      known: {},
      prompts: {},
      remember: (filename, info) => set((s) => ({ known: { ...s.known, [loraKey(filename)]: info } })),
      setPrompt: (filename, prompt) => set((s) => {
        const next = { ...s.prompts }
        if (prompt) next[loraKey(filename)] = prompt
        else delete next[loraKey(filename)]
        return { prompts: next }
      }),
      mergePrompts: (prompts) => set((s) => ({ prompts: { ...s.prompts, ...prompts } })),
    }),
    {
      name: 'locally-uncensored-lora-info',
      storage: safeJSONStorage(),
      partialize: (s) => ({ known: s.known, prompts: s.prompts }) as LoraInfoState,
    },
  ),
)

/** Remember a CivitAI hit's words; a hit without any is not worth an entry. */
export function rememberLoraHit(hit: { filename?: string; trainedWords?: string[]; baseModel?: string; name?: string }): void {
  if (!hit.filename || !hit.trainedWords?.length) return
  useLoraInfoStore.getState().remember(hit.filename, {
    triggers: hit.trainedWords,
    file: hit.filename,
    ...(hit.baseModel ? { baseModel: hit.baseModel } : {}),
    ...(hit.name ? { name: hit.name } : {}),
  })
}

/** A LoRA CivitAI says was trained for another model family. */
export interface LoraMismatch {
  lora: string
  baseModel: string
}

/**
 * Both prompts with the saved/learned additions of these LoRAs applied.
 *
 * With `modelType`, a LoRA whose CivitAI base model belongs to another family
 * contributes nothing and is reported in `mismatched`: ComfyUI loads such a
 * LoRA with "lora key not loaded" warnings and no effect, and its trigger words
 * would only steer the prompt (FINDINGS 25). LoRAs LU knows nothing about are
 * applied as before.
 */
export function applyLoraPrompts(
  prompt: string,
  negative: string,
  loras: readonly string[],
  modelType?: ModelType,
): { prompt: string; negative: string; mismatched: LoraMismatch[] } {
  if (loras.length === 0) return { prompt, negative, mismatched: [] }
  const { prompts, known } = useLoraInfoStore.getState()
  const mismatched: LoraMismatch[] = []
  const fitting = loras.filter((lora) => {
    const baseModel = findLoraInfo(lora, known)?.baseModel
    if (loraFitsModel(baseModel, modelType)) return true
    mismatched.push({ lora, baseModel: baseModel ?? '' })
    return false
  })
  return {
    prompt: withLoraPrompts(prompt, fitting, prompts, known),
    negative: withLoraNegatives(negative, fitting, prompts),
    mismatched,
  }
}

/** One English line for mismatched LoRAs, '' when there are none. */
export function loraMismatchNote(mismatched: readonly LoraMismatch[], modelLabel: string): string {
  if (mismatched.length === 0) return ''
  const list = mismatched.map((m) => `${m.lora} (${m.baseModel})`).join(', ')
  return `LoRA not made for ${modelLabel}, its prompt words were left out and it will likely have no effect: ${list}.`
}
