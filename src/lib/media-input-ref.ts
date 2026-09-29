/**
 * Which picture an agent means when it passes `inputImage` / `mask`.
 *
 * Until now the only valid value was the filename of an image LU itself had
 * generated (it sits in ComfyUI's output folder). A photo the user ATTACHED to
 * their message never reached ComfyUI, so "here is my photo, make the
 * background snowy" could only be answered by the vision model looking at it,
 * never by the generator editing it.
 *
 * The agent cannot know an attachment's storage id, and a small local model
 * will not reliably repeat a filename it never saw. So the contract is a word:
 *
 *   "attached"            the last image the user attached in this chat
 *   "attached:2"          the 2nd image of the most recent message with images
 *   "<attachment name>"   an attached file by its name (case-insensitive)
 *
 * Reading the attachment out of the chat lives in api/chat-media-input.ts; the
 * upload into ComfyUI's input folder happens in vram-handoff's resolver, once
 * ComfyUI is known to be up.
 */

/**
 * A chat attachment read out of the chat store, parked until the generator
 * has made sure ComfyUI is up (a cold start happens INSIDE the generation, so
 * uploading from the tool executor would fail exactly when ComfyUI was not
 * running yet). The ref travels through `inputImage` as a plain string.
 */
export const PENDING_INPUT_PREFIX = 'chat-attachment:'
const PENDING_LIMIT = 8
const pending = new Map<string, File>()
let pendingSeq = 0

export function isPendingInput(ref: string): boolean {
  return ref.startsWith(PENDING_INPUT_PREFIX)
}

/** Park a file and get the ref that stands for it. The oldest entry goes first
 *  once the limit is reached; a ref is kept after use so a follow-up call
 *  ("now animate it") can still resolve it. */
export function holdPendingInput(file: File): string {
  pendingSeq += 1
  const ref = `${PENDING_INPUT_PREFIX}${pendingSeq}:${file.name}`
  pending.set(ref, file)
  while (pending.size > PENDING_LIMIT) pending.delete(pending.keys().next().value as string)
  return ref
}

export function pendingInputFile(ref: string): File | null {
  return pending.get(ref) ?? null
}

/** The words a model uses for "the picture the user gave me". */
const ATTACHMENT_WORDS = new Set([
  'attached', 'attachment', 'attached_image', 'attachment_image',
  'user', 'user_image', 'user_photo', 'upload', 'uploaded', 'photo', 'my_photo',
])

export type AttachmentRef =
  | { kind: 'latest' }
  | { kind: 'index'; n: number }
  | { kind: 'name'; name: string }

/**
 * Read a model-supplied reference. Returns `{ kind: 'name' }` for anything
 * that is not one of the keywords: whether that name is an attachment or a
 * generated file is decided by the caller, who can see the chat.
 */
export function parseAttachmentRef(raw: string): AttachmentRef | null {
  const ref = raw.trim()
  if (!ref) return null
  const lower = ref.toLowerCase().replace(/[\s-]+/g, '_')
  const indexed = /^([a-z_]+?)[:#_]?(\d+)$/.exec(lower)
  if (indexed && ATTACHMENT_WORDS.has(indexed[1])) {
    const n = Number(indexed[2])
    return n >= 1 ? { kind: 'index', n } : { kind: 'latest' }
  }
  if (ATTACHMENT_WORDS.has(lower)) return { kind: 'latest' }
  return { kind: 'name', name: ref.replace(/^.*[\\/]/, '') }
}

interface MessageLike {
  role: string
  images?: readonly { name: string }[]
}

/**
 * Pick the attachment a reference points at, or null when it names none.
 * `messages` is the conversation in chronological order.
 */
export function pickAttachment<M extends MessageLike>(
  messages: readonly M[],
  raw: string,
): NonNullable<M['images']>[number] | null {
  const ref = parseAttachmentRef(raw)
  if (!ref) return null
  const withImages = messages.filter((m) => m.role === 'user' && m.images && m.images.length > 0)
  if (withImages.length === 0) return null
  if (ref.kind === 'latest') {
    const imgs = withImages[withImages.length - 1].images!
    return imgs[imgs.length - 1]
  }
  if (ref.kind === 'index') {
    const imgs = withImages[withImages.length - 1].images!
    return imgs[ref.n - 1] ?? null
  }
  const wanted = ref.name.toLowerCase()
  for (let i = withImages.length - 1; i >= 0; i--) {
    const hit = withImages[i].images!.find((img) => img.name.toLowerCase() === wanted)
    if (hit) return hit
  }
  return null
}
