/**
 * Turn a model's reference to a photo the user attached in the chat into a
 * parked file the generator can upload into ComfyUI, so image_generate /
 * video_generate can edit or animate it.
 *
 * The reference grammar is in lib/media-input-ref.ts. A reference that names
 * no attachment comes back unchanged: it is then the filename of an image LU
 * generated earlier, which vram-handoff's resolver already knows how to find.
 */
import { pickAttachment, holdPendingInput, isPendingInput } from '../lib/media-input-ref'

export async function stageChatImageRef(ref: unknown, conversationId: string | null): Promise<string | undefined> {
  if (typeof ref !== 'string' || !ref.trim()) return undefined
  if (isPendingInput(ref) || /^https?:\/\//i.test(ref)) return ref
  if (!conversationId) return ref
  const { useChatStore } = await import('../stores/chatStore')
  const conv = useChatStore.getState().conversations.find((c) => c.id === conversationId)
  const hit = conv ? pickAttachment(conv.messages, ref) : null
  if (!hit) return ref
  const { originalAttachment, attachmentBlob } = await import('../lib/chat-attachments')
  const original = await originalAttachment(hit)
  // A composing message can still carry a data URL; the store keeps bare base64.
  const base64 = original.data.replace(/^data:[^,]*,/, '')
  const blob = attachmentBlob(base64, hit.mimeType || 'image/png')
  return holdPendingInput(new File([blob], hit.name || 'attached.png', { type: blob.type }))
}
