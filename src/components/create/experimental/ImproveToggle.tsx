import { Wand2 } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { improveKindForIntent } from '../../../lib/render/improve-prompt'
import { useImproveAvailability } from '../../../lib/render/improve-prompt-run'
import { Tooltip } from '../ui/Tooltip'
import { cn } from '../ui/cn'

// "Improve my prompt": a switch in the advanced settings. It never sits in or
// above the prompt field. Off by default and remembered. Shown only on the
// tools that write a prompt for an image, a clip or a track.
export function ImproveToggle() {
  const kind = improveKindForIntent(useCreateStore((s) => s.intent()))
  const on = useCreateStore((s) => s.improvePrompt)
  const setOn = useCreateStore((s) => s.setImprovePrompt)
  const { available, hint } = useImproveAvailability()
  if (!kind) return null
  const active = on && available
  return (
    <div className="py-3">
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
    </div>
  )
}
