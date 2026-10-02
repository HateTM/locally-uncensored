// Saving a gallery item, one path for every surface that offers Download
// (the result view and the gallery strip). The strip had its own copy built on
// fetch plus an <a download> blob, which WebView2 does not save, so it did
// nothing on Windows (Discord 2026-10-01, theitalianstallion92).
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'
import { backendCall, downloadComfyFile, isTauri } from '../../../api/backend'
import { isMlxImageHost } from '../../../api/mlx-image'
import { refreshResultUrl } from '../../../api/cloud/jobs'

function extFor(contentType: string, kind: 'image' | 'video' | 'audio'): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('mp4')) return 'mp4'
  if (contentType.includes('webm')) return 'webm'
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3'
  if (contentType.includes('wav')) return 'wav'
  if (contentType.includes('ogg')) return 'ogg'
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png'
}

// Save a gallery item. Local ComfyUI outputs (non-empty filename) go through
// downloadComfyFile's proxy + native dialog. Cloud items have filename '' —
// fetch their bytes directly (re-signed first: the stored URL expires ~1 h
// after the last read); dataUrl items decode in place. Tauri gets the native
// Save-As dialog (WebView2 blob-anchors are unreliable); failures surface via
// setError instead of a silent no-op.
/** Hand bytes to the user. Tauri gets the native Save-As dialog (WebView2
 *  blob-anchors are unreliable); the browser build gets an anchor click. */
async function saveBytes(bytes: Uint8Array, name: string, ext: string): Promise<void> {
  if (!isTauri()) {
    const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]))
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
    return
  }
  const { invoke } = await import('@tauri-apps/api/core')
  // Returns the chosen path, or null if the user cancelled — nothing to do then.
  await invoke('save_binary_file_dialog', {
    bytes: Array.from(bytes),
    defaultName: name,
    extension: ext,
    extLabel: ext.toUpperCase(),
  })
}

export async function downloadGalleryItem(item: GalleryItem): Promise<void> {
  // A local MLX render (Mac) carries BOTH a filename and a real file on disk.
  // The filename is ours, not a ComfyUI output name — routing on its mere
  // presence sent every Mac render into the ComfyUI proxy below, which cannot
  // answer here, and downloadComfyFile swallows the failure. Disk first.
  if (item.localPath) {
    try {
      const b64 = await backendCall<string>('read_media_file', { path: item.localPath })
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const ext = item.localPath.toLowerCase().endsWith('.mp4') ? 'mp4' : 'png'
      await saveBytes(bytes, `lu-${item.id}.${ext}`, ext)
    } catch (err) {
      useCreateStore
        .getState()
        .setError(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return
  }
  if (item.filename && item.unavailable) {
    // The item's media already failed to load — the ComfyUI fetch would only
    // fail again (and downloadComfyFile swallows its errors). Be honest.
    // Only reachable for a ComfyUI-backed item. On a Mac that can only be a
    // pre-2.6.0 leftover whose file was never written — there is no engine to
    // start there, so "start it" would be the last piece of advice a Mac user
    // could still be given about software they never had.
    useCreateStore.getState().setError(
      isMlxImageHost()
        ? 'This render is not on disk any more, so there is nothing to save.'
        : 'Download needs the local engine. Start it and try again.',
    )
    return
  }
  try {
    if (item.filename) {
      await downloadComfyFile(item.filename, item.subfolder)
      return
    }
    let url = item.dataUrl ?? item.remoteUrl
    if (!item.dataUrl && item.jobId) {
      url = (await refreshResultUrl(item.jobId)) ?? url
    }
    if (!url) throw new Error('no source available for this item')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch failed (${res.status})`)
    const ext = extFor(res.headers.get('content-type') ?? '', item.type)
    const bytes = new Uint8Array(await res.arrayBuffer())
    await saveBytes(bytes, `lu-${item.id}.${ext}`, ext)
  } catch (err) {
    useCreateStore
      .getState()
      .setError(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
