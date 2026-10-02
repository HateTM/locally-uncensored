import type { GalleryItem } from '../../../stores/createStore'
import { cn } from '../ui/cn'

// "Improve my prompt": what the customer wrote next to what actually ran, so
// they can see it. Shows nothing for a run that was not rewritten.
export function PromptDetails({ item, className }: { item: GalleryItem; className?: string }) {
  if (!item.promptOriginal && !item.improveFailed) return null
  return (
    <details
      className={cn('w-full max-w-xl rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-left', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="t-control cursor-pointer select-none text-gray-400 hover:text-gray-200">Prompt details</summary>
      {item.promptOriginal ? (
        <div className="mt-2 space-y-2">
          <div>
            <div className="t-label text-gray-500">You wrote</div>
            <p className="t-body whitespace-pre-wrap break-words text-gray-300">{item.promptOriginal}</p>
          </div>
          <div>
            <div className="t-label text-gray-500">Sent to the model</div>
            <p className="t-body whitespace-pre-wrap break-words text-gray-300">{item.prompt}</p>
          </div>
        </div>
      ) : (
        <p className="t-body mt-2 text-gray-400">
          Improve my prompt was on, but the rewrite did not work. This run used your own prompt.
        </p>
      )}
    </details>
  )
}
