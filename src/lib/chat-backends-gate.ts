/**
 * The way a chat request asks for the chat backends a render moved out.
 *
 * A Create render takes the local chat model off the graphics card
 * (api/vram-handoff) and no longer loads it straight back, because the next
 * thing on the Create view is usually another render. The model comes back
 * when a chat needs it. The providers cannot import the hand-off module
 * (it sits on top of half the api layer), so the hand-off leaves its restore
 * here while a haul is parked, and a local provider waits for it before it
 * sends. Nothing parked: nothing to wait for.
 *
 * Why not let the backends load lazily: Ollama would, but the built-in engine
 * comes back without its saved KV slot and LM Studio without the context
 * length it was loaded with, or not at all with its own load on demand
 * switched off. The restore knows all three.
 */
let restore: (() => Promise<void>) | null = null

/** Set by the hand-off while a haul is parked, null once it is back or taken over. */
export function setChatBackendsRestore(fn: (() => Promise<void>) | null): void {
  restore = fn
}

/** Resolves when the chat backends a render moved out are loaded again. */
export async function chatBackendsBack(): Promise<void> {
  const run = restore
  if (!run) return
  try { await run() } catch { /* the request goes out either way */ }
}
