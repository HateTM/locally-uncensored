import { create } from 'zustand'
import type { ToolCallProgress } from '../api/providers/types'

/**
 * What a running turn is doing right now, when the run knows more than
 * "Working". Read by WorkingAnchor; an explicit label there (an approval wait,
 * a model load) still wins.
 *
 * Realtime pass 01.10.2026 (R1): while a model writes a tool call, the
 * arguments stream in for seconds (a 4 kB file_write took ~11 s on Mistral
 * Small, measured live) and the run said only "Working". The provider knows
 * the call's name from the first delta, so the anchor says it.
 *
 * Not persisted: a label from a crashed run must not survive a restart.
 */
export interface RunActivity {
  /** Announced to screen readers when it changes. */
  label: string
  /** A count that grows while the label stands (the call's size); shown, not announced. */
  detail?: string
}

interface RunActivityState {
  activity: Record<string, RunActivity>
  setActivity: (conversationId: string | null | undefined, activity: RunActivity | null) => void
}

export const useRunActivityStore = create<RunActivityState>((set) => ({
  activity: {},
  setActivity: (conversationId, activity) => {
    if (!conversationId) return
    set((state) => {
      const now = state.activity[conversationId]
      if (now?.label === activity?.label && now?.detail === activity?.detail) return state
      const next = { ...state.activity }
      if (activity) next[conversationId] = activity
      else delete next[conversationId]
      return { activity: next }
    })
  },
}))

/** "Preparing file_write", plus the size once a kilobyte has arrived. Whole kB, so the store changes at most once per kB. */
export function toolProgressActivity(progress: ToolCallProgress): RunActivity {
  const kb = Math.floor(progress.argsChars / 1024)
  return kb > 0 ? { label: `Preparing ${progress.name}`, detail: `${kb} kB` } : { label: `Preparing ${progress.name}` }
}
