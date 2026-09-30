/**
 * G22 (R20, 2026-08-07): a generated image fed back to a text-only model must
 * not end the agent run.
 *
 * The vision feedback path guesses for non-Ollama providers (strict name
 * family), and the guess can be wrong in exactly one direction that hurts: a
 * text-only conversion of a vision family (gemma-3-4b-it-abliterated on LM
 * Studio) accepts the attachment request and the server answers with the
 * multimodal error, which used to surface as an app-authored "This model
 * can't read images" and killed the run two steps before the finish. The
 * model had done everything right; OUR attachment was the poison.
 *
 * The heal: strip only the messages WE attached (marked `visionFeedback`),
 * replace them with their text fallback, and let the caller retry the turn.
 * A user-attached image is left alone by this function; in agent mode
 * stripUserImagesForToolUse below degrades it too, because there the model
 * does not need to see the picture to act on it.
 */

export interface HealableMessage {
  role: string
  content: string
  images?: unknown[]
  /** Set by buildVisionFeedback: this attachment came from the loop itself. */
  visionFeedback?: boolean
  /** Text the message degrades to when the model turns out to be text-only. */
  fallbackText?: string
}

export const VISION_FALLBACK_TEXT =
  'The image was generated successfully and is already shown to the user in the chat. ' +
  'You cannot view images, so do not ask for them. Continue with the remaining steps.'

/**
 * Replace every loop-attached image message with its text fallback, in place.
 * Returns true when at least one message was healed — the caller retries the
 * model turn in that case instead of ending the run.
 */
export function stripVisionFeedbackMessages(messages: HealableMessage[]): boolean {
  let healed = false
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m?.visionFeedback && m.images?.length) {
      messages[i] = {
        role: 'user',
        content: m.fallbackText || VISION_FALLBACK_TEXT,
      }
      healed = true
    }
  }
  return healed
}

export const USER_IMAGE_TOOL_NOTE =
  'You cannot see pictures, but the tools can use them: to edit, change or animate the attached picture, '
  + 'call image_generate or video_generate with inputImage "attached". Do not ask the user to describe it.'

/**
 * Agent mode on a text-only model: drop the images the USER attached from the
 * request and say in their place that they exist and how to use them.
 *
 * Every user attachment went to the model as an image, so a model without
 * vision (a 9B or 12B text model, the usual local agent) refused the request
 * and the run ended, although editing the attached photo never needs the
 * model to look at it: image_generate takes it by reference ("attached",
 * lib/media-input-ref.ts) straight from the chat store, which this does not
 * touch. Only the request copy changes, in place. Returns true when a message
 * was changed, so the caller retries the turn.
 */
export function stripUserImagesForToolUse(messages: HealableMessage[]): boolean {
  let healed = false
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m && m.role === 'user' && !m.visionFeedback && m.images?.length) {
      const n = m.images.length
      const { images: _dropped, ...rest } = m
      messages[i] = {
        ...rest,
        content: `${m.content}\n\n[The user attached ${n === 1 ? 'a picture' : `${n} pictures`}. ${USER_IMAGE_TOOL_NOTE}]`,
      }
      healed = true
    }
  }
  return healed
}

/**
 * Does the multimodal-unsupported error that ended a turn belong on screen?
 *
 * Nebenbefund N3 of the D1 counter-check (Windows build, 2026-08-29): every
 * successful picture was followed by a red "This model can't read images" line
 * as the last thing in the chat, because the run fed its own render back to a
 * model that could not look at it. The render worked. Blaming the user for OUR
 * attachment turns a finished job into what reads as a failure.
 *
 * So: the error is reported only when the picture in the request was NOT ours.
 * A user-attached image keeps the honest error and the actionable advice,
 * because their question depends on that picture.
 */
export function reportMultimodalRefusal(visionFeedbackGiven: boolean): boolean {
  return !visionFeedbackGiven
}
