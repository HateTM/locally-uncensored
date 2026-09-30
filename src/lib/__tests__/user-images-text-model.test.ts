import { describe, it, expect } from 'vitest'
import { stripUserImagesForToolUse, stripVisionFeedbackMessages, USER_IMAGE_TOOL_NOTE, type HealableMessage } from '../vision-heal'

describe('stripUserImagesForToolUse (agent on a text-only model)', () => {
  it('drops the user\'s attachment from the request and says how the tools reach it', () => {
    const msgs: HealableMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'remove the bikini', images: [{ data: 'AAA', mimeType: 'image/png' }] },
    ]
    expect(stripUserImagesForToolUse(msgs)).toBe(true)
    expect(msgs[1].images).toBeUndefined()
    expect(msgs[1].content).toContain('remove the bikini')
    expect(msgs[1].content).toContain('attached a picture')
    expect(msgs[1].content).toContain(USER_IMAGE_TOOL_NOTE)
    expect(msgs[1].content).toContain('inputImage "attached"')
  })

  it('counts several pictures, and leaves messages without images alone', () => {
    const msgs: HealableMessage[] = [
      { role: 'user', content: 'a', images: [1, 2] },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]
    expect(stripUserImagesForToolUse(msgs)).toBe(true)
    expect(msgs[0].content).toContain('2 pictures')
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'b' })
    expect(msgs[2]).toEqual({ role: 'user', content: 'c' })
  })

  it('does not touch the loop\'s own fed-back render (that is stripVisionFeedbackMessages\' job)', () => {
    const msgs: HealableMessage[] = [{ role: 'user', content: 'render', images: [1], visionFeedback: true, fallbackText: 'fb' }]
    expect(stripUserImagesForToolUse(msgs)).toBe(false)
    expect(stripVisionFeedbackMessages(msgs)).toBe(true)
    expect(msgs[0]).toEqual({ role: 'user', content: 'fb' })
  })

  it('nothing to strip: false, so the caller reports the error instead of retrying forever', () => {
    expect(stripUserImagesForToolUse([{ role: 'user', content: 'x' }])).toBe(false)
  })
})
