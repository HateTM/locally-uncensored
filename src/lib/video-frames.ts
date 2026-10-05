// A still out of a playing video: the frame on screen, drawn onto a canvas.
// No decoder, no dependency. The video has to come from a blob: URL (or the
// app's own origin), a frame of a foreign URL cannot be read back.

/** The frame the video shows right now, as a JPEG. */
export function grabFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return Promise.reject(new Error('The video has no picture yet. Let it load, then try again.'))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not read this frame.'))
  return new Promise<Blob>((resolve, reject) => {
    try {
      ctx.drawImage(video, 0, 0, width, height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read this frame.'))), 'image/jpeg', quality)
    } catch {
      reject(new Error('Could not read this frame.'))
    }
  })
}

/** The file name of the n-th frame of a character. */
export function frameFileName(name: string, index: number): string {
  const base = name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'character'
  return `${base}-${String(index + 1).padStart(2, '0')}.jpg`
}
