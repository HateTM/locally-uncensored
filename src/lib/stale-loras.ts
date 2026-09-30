/**
 * LoRAs the Create tab still has selected but ComfyUI no longer lists.
 *
 * The selection is persisted; the LoRA stack only draws the installed files.
 * A LoRA that left models/loras (deleted, a Character Studio character trained
 * on another install, a ComfyUI reinstall) therefore stayed "1 active" with no
 * row to switch it off, and every render failed with "LoRA … is not installed
 * in ComfyUI" until the browser storage was cleared.
 *
 * Only while ComfyUI answers: with ComfyUI down the installed list is empty
 * and every selected LoRA would read as missing.
 */
export function staleSelectedLoras(
  selected: readonly { name: string }[],
  installed: readonly string[],
  comfyReachable: boolean,
): string[] {
  if (!comfyReachable && installed.length === 0) return []
  const have = new Set(installed)
  return selected.map((l) => l.name).filter((n) => !have.has(n))
}
