/**
 * "attached" in inputImage / mask means the photo the user attached in the
 * chat (lib/media-input-ref.ts).
 *
 * Run: npx vitest run src/lib/__tests__/media-input-ref.test.ts
 */
import { describe, it, expect } from 'vitest'
import { parseAttachmentRef, pickAttachment, holdPendingInput, pendingInputFile, isPendingInput } from '../media-input-ref'

const img = (name: string) => ({ name, mimeType: 'image/png', data: 'x' })
const chat = [
  { role: 'user', images: [img('cat.png')] },
  { role: 'assistant' },
  { role: 'user', images: [img('beach.jpg'), img('Mask.PNG')] },
  { role: 'user', content: 'now edit it' },
]

describe('parseAttachmentRef', () => {
  it.each([
    ['attached', { kind: 'latest' }],
    ['Attached', { kind: 'latest' }],
    ['user_image', { kind: 'latest' }],
    ['attached:2', { kind: 'index', n: 2 }],
    ['attached_2', { kind: 'index', n: 2 }],
    ['attachment#1', { kind: 'index', n: 1 }],
  ])('%s', (ref, want) => {
    expect(parseAttachmentRef(ref)).toEqual(want)
  })

  it('anything else is a name, without its folder', () => {
    expect(parseAttachmentRef('C:\\\\pics\\\\beach.jpg')).toEqual({ kind: 'name', name: 'beach.jpg' })
    expect(parseAttachmentRef('ComfyUI_00012_.png')).toEqual({ kind: 'name', name: 'ComfyUI_00012_.png' })
  })
})

describe('pickAttachment', () => {
  it('"attached" is the last image of the last message that had images', () => {
    expect(pickAttachment(chat, 'attached')?.name).toBe('Mask.PNG')
  })
  it('"attached:N" counts inside that message', () => {
    expect(pickAttachment(chat, 'attached:1')?.name).toBe('beach.jpg')
    expect(pickAttachment(chat, 'attached:3')).toBeNull()
  })
  it('a name finds an older attachment, case-insensitively', () => {
    expect(pickAttachment(chat, 'CAT.png')?.name).toBe('cat.png')
    expect(pickAttachment(chat, 'mask.png')?.name).toBe('Mask.PNG')
  })
  it('a generated filename is not an attachment, so it stays with the generator', () => {
    expect(pickAttachment(chat, 'ComfyUI_00012_.png')).toBeNull()
  })
  it('a chat without images has nothing to pick', () => {
    expect(pickAttachment([{ role: 'user' }], 'attached')).toBeNull()
  })
})

describe('the parked file', () => {
  it('survives until the generator asks for it, and more than once', () => {
    const file = new File(['abc'], 'photo.png', { type: 'image/png' })
    const ref = holdPendingInput(file)
    expect(isPendingInput(ref)).toBe(true)
    expect(pendingInputFile(ref)).toBe(file)
    expect(pendingInputFile(ref)).toBe(file)
  })
  it('keeps only the newest eight', () => {
    const first = holdPendingInput(new File(['a'], 'first.png'))
    for (let i = 0; i < 8; i++) holdPendingInput(new File(['b'], `n${i}.png`))
    expect(pendingInputFile(first)).toBeNull()
  })
})
