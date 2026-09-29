import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { loraKey, type LoraInfo } from '../lib/lora-triggers'
import { withLoraPrompts, withLoraNegatives, type LoraPrompt } from '../lib/lora-auto'

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

/** Both prompts with the saved/learned additions of these LoRAs applied. */
export function applyLoraPrompts(
  prompt: string,
  negative: string,
  loras: readonly string[],
): { prompt: string; negative: string } {
  if (loras.length === 0) return { prompt, negative }
  const { prompts, known } = useLoraInfoStore.getState()
  return { prompt: withLoraPrompts(prompt, loras, prompts, known), negative: withLoraNegatives(negative, loras, prompts) }
}
