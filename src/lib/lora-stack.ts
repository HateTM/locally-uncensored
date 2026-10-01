// GH #146 (joshmichael, 2026-10-01): two LoRAs deleted from models/loras stayed
// in the persisted stack. The picker showed "2 active" with nothing ticked,
// every run sent them, and ComfyUI refused the graph with "Value not in list".
// One of them was a Z-Image character LoRA riding into the Animate lane.
// This file decides, from the one list ComfyUI reports, which picks a run uses.
import { parseLocalCharacterLora } from '../api/trainer'
import type { ModelType } from '../api/comfyui'

export interface LoraPick {
  name: string
  strength: number
}

/** A character from Character Studio is a Z-Image LoRA (trainer naming
 *  `char_<name>_zimage`), so any other model would only get noise from it. */
export function loraFitsModel(name: string, modelType: ModelType): boolean {
  return !parseLocalCharacterLora(name) || modelType === 'zimage'
}

/**
 * What a run sends. `listed` is ComfyUI's live loras list, or null when it
 * could not be read; then nothing counts as missing, because "not reachable"
 * is no proof a file is gone.
 */
export function lorasForRun(
  picks: LoraPick[],
  listed: string[] | null,
  modelType: ModelType,
): { use: LoraPick[]; missing: string[]; otherModel: string[] } {
  const missing: string[] = []
  const otherModel: string[] = []
  const use: LoraPick[] = []
  for (const p of picks) {
    if (listed && !listed.includes(p.name)) missing.push(p.name)
    else if (!loraFitsModel(p.name, modelType)) otherModel.push(p.name)
    else use.push(p)
  }
  return { use, missing, otherModel }
}

/** The progress line for picks a run leaves out, or null when it uses all. */
export function skippedLorasLine(missing: string[], otherModel: string[]): string | null {
  const base = (n: string) => n.replace(/^.*[\\/]/, '').replace(/\.safetensors$/i, '')
  const parts: string[] = []
  if (missing.length) parts.push(`no longer in models/loras: ${missing.map(base).join(', ')}`)
  if (otherModel.length) parts.push(`Z-Image characters only: ${otherModel.map(base).join(', ')}`)
  return parts.length ? `Skipping LoRA ${parts.join('; ')}` : null
}
