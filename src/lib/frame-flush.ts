/**
 * At most one store write per animation frame while a reply streams in, and
 * none after the stream has ended.
 *
 * Bug hunt 01.10.2026 (H2). The chat wrote the streamed text from a
 * requestAnimationFrame callback and never took a pending one back. The end of
 * a stream (the empty-answer explanation) and every error path (the stall
 * message included) write the bubble directly, and a frame still pending then
 * landed on top of that line with the partial text. In a hidden tab frames do
 * not fire at all until the tab is shown again, so the one message written
 * while nobody was looking was the one the late frame overwrote.
 */
export interface FrameFlush {
  /** Run `write` on the next frame, once, unless a frame is already pending or the flush is closed. */
  schedule(write: () => void): void
  /** The stream is over: drop a pending frame and refuse every later one. */
  close(): void
}

export function frameFlush(): FrameFlush {
  let id: number | null = null
  let closed = false
  return {
    schedule(write) {
      if (closed || id !== null) return
      id = requestAnimationFrame(() => {
        id = null
        if (!closed) write()
      })
    },
    close() {
      closed = true
      if (id !== null) cancelAnimationFrame(id)
      id = null
    },
  }
}
