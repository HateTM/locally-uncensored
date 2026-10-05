// @vitest-environment jsdom
/**
 * A still out of a video (lib/video-frames): the frame is drawn at the video's
 * own size and comes back as a JPEG, and a video without a picture says so.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { frameFileName, grabFrame } from '../video-frames'

afterEach(() => vi.restoreAllMocks())

function fakeCanvas(toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => void, draw = vi.fn()) {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob }
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : real(tag))) as typeof document.createElement)
  return { canvas, draw }
}

describe('grabFrame', () => {
  it('draws the frame at the size of the video and returns a JPEG', async () => {
    const seen: { type: string; q: number }[] = []
    const { canvas, draw } = fakeCanvas((cb, type, q) => { seen.push({ type, q }); cb(new Blob(['jpg'], { type })) })
    const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
    const blob = await grabFrame(video)
    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(seen).toEqual([{ type: 'image/jpeg', q: 0.92 }])
    expect(blob.type).toBe('image/jpeg')
  })

  it('a video that has not loaded says so', async () => {
    await expect(grabFrame({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).rejects.toThrow('The video has no picture yet. Let it load, then try again.')
  })

  it('a frame the browser will not hand out is an error, not a broken photo', async () => {
    fakeCanvas((cb) => cb(null))
    await expect(grabFrame({ videoWidth: 64, videoHeight: 64 } as HTMLVideoElement)).rejects.toThrow('Could not read this frame.')
    fakeCanvas(() => { throw new Error('SecurityError') })
    await expect(grabFrame({ videoWidth: 64, videoHeight: 64 } as HTMLVideoElement)).rejects.toThrow('Could not read this frame.')
  })
})

describe('frameFileName', () => {
  it('numbers the frames under the character name', () => {
    expect(frameFileName('Mira Vale', 0)).toBe('mira-vale-01.jpg')
    expect(frameFileName('Zoë / 2', 11)).toBe('zoë-2-12.jpg')
    expect(frameFileName('  ', 0)).toBe('character-01.jpg')
  })
})
