/**
 * Background removal on ComfyUI's own nodes (FINDINGS 23).
 *
 * LU cut out backgrounds with the ComfyUI-RMBG custom pack. The core now has
 * LoadBackgroundRemovalModel + RemoveBackground (comfy_extras/nodes_bg_removal),
 * and the official utility_birefnet_remove_background template runs them on
 * BiRefNet from Comfy-Org. That is one model file instead of a cloned node pack
 * with its own pip requirements. RMBG stays as the fallback for a core too old
 * to have the nodes.
 */
import { nodeComboOptions } from './comfyui-enum'

type NodePresence = Record<string, unknown>

/** The template's model: Comfy-Org/BiRefNet, 424 MB, models/background_removal. */
export const BIREFNET = {
  filename: 'birefnet.safetensors',
  subfolder: 'background_removal',
  downloadUrl: 'https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors',
  sizeGB: 0.44,
} as const

/** The core nodes are there (whether or not a model is). */
export function hasCoreBgRemoval(allNodes: NodePresence): boolean {
  return !!allNodes['LoadBackgroundRemovalModel'] && !!allNodes['RemoveBackground']
}

/** The model the core path loads: BiRefNet when present, else any listed one. */
export function coreBgRemovalModel(allNodes: NodePresence): string | null {
  const models = nodeComboOptions(allNodes, 'LoadBackgroundRemovalModel', 'bg_removal_name')
  return models.find((m) => /birefnet/i.test(m)) ?? models[0] ?? null
}

/**
 * One line for the agent's media_list. It used to ask only for RMBG, so a core
 * with BiRefNet read as "not installed" and the agent told the user to install
 * a pack the app no longer needs.
 */
export function bgRemovalStatus(allNodes: NodePresence): string {
  const model = hasCoreBgRemoval(allNodes) ? coreBgRemovalModel(allNodes) : null
  if (model) return `ready (ComfyUI core, ${model})`
  if (allNodes['RMBG']) return 'ready (ComfyUI-RMBG)'
  if (hasCoreBgRemoval(allNodes)) {
    return `needs its model (${BIREFNET.filename}, 424 MB), downloaded from the Remove Background tab`
  }
  return 'not available (update ComfyUI, or install ComfyUI-RMBG from the Remove Background tab)'
}

/** A cutout can run now: core nodes with a model, or the RMBG pack. */
export function bgRemovalReady(allNodes: NodePresence): boolean {
  return (hasCoreBgRemoval(allNodes) && coreBgRemovalModel(allNodes) !== null) || !!allNodes['RMBG']
}
