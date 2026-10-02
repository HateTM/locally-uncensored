// "Improve my prompt": the runner. One small chat call on the chat model the
// user has picked, local or cloud, through the same provider a chat turn uses.
// On LU Cloud it is metered and billed like chat; on a local model it costs
// nothing. It never throws: any failure answers `failed`, and the run goes on
// with the user's own prompt.
//
// Unlike the silent calls (memory extraction), this one is asked for: the user
// switched it on in Create, so it runs on the picked chat model as it is and
// needs no second opt-in.

import { getProviderForModel, getProviderIdFromModel } from '../../api/providers'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { isThinkingCompatible } from '../model-compatibility'
import { resolveAgentNumCtx } from '../agent-num-ctx'
import { runInLane } from '../run-slot'
import { laneOf, currentLaneFacts } from '../run-lane-of-model'
import {
  IMPROVE_MAX_TOKENS, buildImproveMessages, cleanImproved,
  type ImproveOutcome, type ImproveTarget,
} from './improve-prompt'

export interface ImproveAvailability {
  available: boolean
  /** What the switch's tooltip says: what it does, or why it cannot be used. */
  hint: string
}

const HINT_LOCAL = 'Your chat model rewrites your prompt for the model you picked. It runs on your machine.'
const HINT_CLOUD = 'Your chat model rewrites your prompt for the model you picked. Billed like a short chat message.'

/** Can a rewrite run with this chat model? It needs one to write with. */
export function improveAvailabilityFor(activeModel: string | null): ImproveAvailability {
  if (!activeModel) return { available: false, hint: 'Pick a chat model in Chat first.' }
  const cloud = getProviderIdFromModel(activeModel) === 'lu-cloud'
  return { available: true, hint: cloud ? HINT_CLOUD : HINT_LOCAL }
}

/** The same answer, kept current while the user picks another chat model. */
export function useImproveAvailability(): ImproveAvailability {
  return improveAvailabilityFor(useModelStore((s) => s.activeModel))
}

/** The turn id the rewrite books its place under. Its own, so it queues behind
 *  a chat turn on the local card instead of racing it. */
const IMPROVE_TURN = 'create::improve-prompt'

/** Rewrite `prompt` for `target` with the user's chat model. */
export async function improvePrompt(
  prompt: string,
  target: ImproveTarget,
  signal?: AbortSignal,
): Promise<ImproveOutcome> {
  const { activeModel, models } = useModelStore.getState()
  if (!activeModel || signal?.aborted) return { status: 'failed' }
  try {
    const { provider, modelId } = getProviderForModel(activeModel)
    const providerId = getProviderIdFromModel(activeModel)
    const meta = models.find((m) => m.name === activeModel)
    const thinkMode = meta && 'thinkMode' in meta ? meta.thinkMode : undefined
    const canThink = thinkMode ? thinkMode === 'toggle' : isThinkingCompatible(activeModel)
    const effortLevels = meta && 'effortLevels' in meta ? meta.effortLevels : undefined
    const effortDefault = meta && 'effortDefault' in meta ? meta.effortDefault : undefined
    const own = new AbortController()
    const onAbort = () => own.abort()
    signal?.addEventListener('abort', onAbort)
    let text = ''
    let ran = false
    try {
      const outcome = await runInLane(
        { conversationId: IMPROVE_TURN, lane: laneOf(activeModel, currentLaneFacts()), abort: () => own.abort() },
        async () => {
          if (own.signal.aborted) return
          // The num_ctx the chat runs with, so a local model is not reloaded
          // for this call.
          const numCtx = await resolveAgentNumCtx(
            modelId, providerId, useSettingsStore.getState().settings.contextWindowOverride, activeModel,
          )
          const stream = provider.chatStream(modelId, buildImproveMessages(target, prompt), {
            temperature: 0.4,
            maxTokens: IMPROVE_MAX_TOKENS,
            contextWindow: numCtx,
            // A model that can switch its reasoning off gets it off, one that
            // cannot gets the lowest rung. A rewrite has no use for a long think.
            thinking: canThink ? false : undefined,
            reasoningEffort: 'low',
            effortLevels,
            effortDefault,
            signal: own.signal,
          })
          for await (const chunk of stream) {
            if (chunk.content) text += chunk.content
            if (chunk.done) break
          }
          ran = true
        },
      )
      if (outcome !== 'ran' || !ran) return { status: 'failed' }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    const cleaned = cleanImproved(text)
    if (!cleaned) return { status: 'failed' }
    if (cleaned === prompt.trim()) return { status: 'unchanged' }
    return { status: 'improved', prompt: cleaned }
  } catch {
    return { status: 'failed' }
  }
}
