import { Wand2 } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { improveKindForIntent } from '../../../lib/render/improve-prompt'
import { useImproveAvailability } from '../../../lib/render/improve-prompt-run'
import { QWEN_ENHANCER_HINT, activeWriter, improveWriters } from '../../../lib/render/qwen-enhancer'
import { isMlxImageHost } from '../../../api/mlx-image'
import { classifyModel } from '../../../api/comfyui'
import { Tooltip } from '../ui/Tooltip'
import { cn } from '../ui/cn'

// "Improve my prompt": a switch in the advanced settings. It never sits in or
// above the prompt field. Off by default and remembered. Shown only on the
// tools that write a prompt for an image, a clip or a track.
//
// On a local Qwen-Image 2.1 with a prompt enhancer installed the enhancer
// writes instead of the chat model, for a new picture and for an edit, and a
// row under the switch lets the user pick who writes. Same switch, same place.
export function ImproveToggle() {
  const intent = useCreateStore((s) => s.intent())
  const kind = improveKindForIntent(intent)
  const on = useCreateStore((s) => s.improvePrompt)
  const setOn = useCreateStore((s) => s.setImprovePrompt)
  const choice = useCreateStore((s) => s.improveWith)
  const setChoice = useCreateStore((s) => s.setImproveWith)
  const backend = useCreateStore((s) => s.backend)
  const imageModel = useCreateStore((s) => s.imageModel)
  const imageModelList = useCreateStore((s) => s.imageModelList)
  const textEncoders = useCreateStore((s) => s.textEncoderList)
  const chat = useImproveAvailability()

  // The model the run really uses: the first of the list when the stored pick
  // is not in it, the same rule the run applies.
  const model = imageModelList.find((m) => m.name === imageModel) ?? imageModelList[0]
  const situation = {
    local: backend === 'local' && !isMlxImageHost(),
    intent,
    modelType: model ? model.type : classifyModel(imageModel),
    textEncoders,
  }
  const writers = improveWriters(situation)
  const writer = activeWriter(situation, choice)
  const byEnhancer = writer !== null && writer !== 'chat'

  if (!kind && !byEnhancer) return null
  const { available, hint } = byEnhancer ? { available: true, hint: QWEN_ENHANCER_HINT } : chat
  const active = on && available
  return (
    <div className="space-y-2 py-3">
      <Tooltip content={hint} side="bottom" className="flex w-full">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-disabled={!available}
          disabled={!available}
          onClick={() => setOn(!on)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
            active ? 'border-white/15 bg-white/[0.05]' : 'border-white/[0.07]',
            !available && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="flex items-center gap-2">
            <Wand2 size={12} className="shrink-0 text-gray-500" />
            <span className="t-control text-gray-300">Improve my prompt</span>
          </span>
          <span className={cn('t-mono text-xs', active ? 'text-emerald-400' : 'text-gray-600')}>{active ? 'on' : 'off'}</span>
        </button>
      </Tooltip>
      {on && writers.length > 1 && (
        <div role="radiogroup" aria-label="Rewritten by" className="flex flex-wrap items-center gap-1.5">
          <span className="w-full t-label text-gray-500">Rewritten by</span>
          {writers.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === writer}
              onClick={() => setChoice(w.id)}
              className={cn(
                'rounded-md border px-2 py-1 t-control transition-colors',
                w.id === writer ? 'border-white/20 bg-white/[0.07] text-gray-200' : 'border-white/[0.07] text-gray-500 hover:text-gray-300',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
