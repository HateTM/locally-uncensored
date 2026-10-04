// The line under a finished result: what it is, in the few facts that are true
// of it.
//
// The box, 04.10.2026: a cutout read "512×512 · seed 697334996 · sd turbo".
// A cutout has no seed and never touched sd turbo; the line repeated the Image
// tab's picker. A tool that runs without the picker's model (Cutout, Enhance,
// Erase) says its size and, where it is known, the model the tool itself ran
// on, nothing else.
import type { GalleryItem } from '../../stores/createStore'
import { STUDIO_IMAGE_UPSCALERS } from './studio-roles'
import { modelLabel } from './preset-models'

/** Runs that take no seed and no model from the picker. */
const TOOL_INTENTS: ReadonlySet<string> = new Set(['removebg', 'upscale', 'eraser'])

function prettyModel(file: string): string {
  return file.replace(/\.(safetensors|ckpt|pt)$/i, '').replace(/[_]+/g, ' ')
}

/** The model a tool run really used, when the entry knows it. */
function toolModelName(item: GalleryItem): string | undefined {
  if (item.toolModel) return item.toolModel
  // Enhance on a studio upscaler: the entry's model is that upscaler itself.
  if (item.intent === 'upscale' && STUDIO_IMAGE_UPSCALERS.includes(item.model)) return modelLabel(item.model)
  return undefined
}

export function resultFacts(item: GalleryItem): string[] {
  if (item.type === 'audio') return [prettyModel(item.model)]
  const size = `${item.width}×${item.height}`
  if (item.intent && TOOL_INTENTS.has(item.intent)) {
    const model = toolModelName(item)
    return model ? [size, model] : [size]
  }
  return [size, `seed ${item.seed}`, prettyModel(item.model)]
}
