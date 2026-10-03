// "Save character from this video" (Discord, applejames): pause the clip on a
// clear view of the figure, add that frame, repeat for a few angles, name the
// character. The frames are saved as photos on this machine
// (lib/saved-characters) and can go straight on to the reference strip or to
// Character Studio.
import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, UserRound, Images, X } from 'lucide-react'
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'
import { isMlxImageHost } from '../../../api/mlx-image'
import { MAX_CHARACTER_NAME, MAX_CHARACTER_PHOTOS, saveCharacter, type SaveResult } from '../../../lib/saved-characters'
import { grabFrame } from '../../../lib/video-frames'
import { MIN_TRAIN_IMAGES } from '../../../lib/train-image-cap'
import { Modal } from '../../ui/Modal'
import { Button } from '../ui/Button'
import { fetchGalleryItemBlob, proxiedComfyBlobUrl } from './galleryUrl'
import { isIntentAvailable } from './intents'
import { loadPhotosAsReferences, sendPhotosToStudio } from './characterPhotos'

interface Frame { url: string; blob: Blob }

/** The clip as a blob: URL of the app's own origin, the only kind of video a
 *  canvas may read a frame back from. */
async function playableUrl(item: GalleryItem): Promise<string> {
  if (item.dataUrl?.startsWith('blob:')) {
    // A local MLX clip is one already. Copy it, so closing this window never
    // revokes the URL the gallery still plays.
    return URL.createObjectURL(await (await fetch(item.dataUrl)).blob())
  }
  try {
    return URL.createObjectURL(await fetchGalleryItemBlob(item))
  } catch (err) {
    // A ComfyUI that refuses the direct load still answers through the proxy.
    const proxied = await proxiedComfyBlobUrl(item)
    if (proxied) return proxied
    throw err
  }
}

export function SaveCharacterModal({ item, onClose }: { item: GalleryItem | null; onClose: () => void }) {
  return (
    <Modal open={!!item} onClose={onClose} title="Save character from this video" maxWidth="max-w-2xl">
      {item && <SaveCharacterBody key={item.id} item={item} onClose={onClose} />}
    </Modal>
  )
}

function SaveCharacterBody({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const backend = useCreateStore((s) => s.backend)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SaveResult | null>(null)
  // Every preview URL this window minted, given back when it closes.
  const minted = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    const urls = minted.current
    void playableUrl(item).then((url) => {
      if (!alive) { URL.revokeObjectURL(url); return }
      urls.push(url)
      setSrc(url)
    }).catch((err: unknown) => {
      if (alive) setLoadError(`Could not load this video: ${err instanceof Error ? err.message : String(err)}`)
    })
    return () => {
      alive = false
      for (const u of urls) URL.revokeObjectURL(u)
      urls.length = 0
    }
  }, [item])

  const full = frames.length >= MAX_CHARACTER_PHOTOS
  const addFrame = async () => {
    const video = videoRef.current
    if (!video || full) return
    video.pause()
    setNote(null)
    try {
      const blob = await grabFrame(video)
      const url = URL.createObjectURL(blob)
      minted.current.push(url)
      setFrames((f) => [...f, { url, blob }])
      setSaved(null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async () => {
    setBusy(true)
    setNote(null)
    try {
      setSaved(await saveCharacter(name, frames.map((f) => f.blob)))
      setFrames([])
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const mlx = isMlxImageHost()
  const canReference = isIntentAvailable('edit', backend, mlx)
  const canTrain = isIntentAvailable('character', backend, mlx)
  const asReferences = async () => {
    if (!saved) return
    setBusy(true)
    try {
      await loadPhotosAsReferences(saved.character.name, saved.character.photos)
      onClose()
    } catch (err) {
      setNote(`Could not load the photos: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  const toStudio = () => {
    if (!saved) return
    sendPhotosToStudio(saved.character.name, saved.character.photos)
    onClose()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="save-character">
      {loadError ? (
        <p className="t-body text-red-300">{loadError}</p>
      ) : !src ? (
        <div className="h-48 flex items-center justify-center t-control text-gray-400 gap-2"><Loader2 size={14} className="animate-spin" /> Loading the video…</div>
      ) : (
        <video ref={videoRef} src={src} controls loop muted playsInline className="w-full max-h-[44vh] rounded-lg bg-black object-contain" />
      )}

      <div className="flex items-center gap-3">
        <div className="shrink-0 whitespace-nowrap">
          <Button variant="secondary" icon={Camera} disabled={!src || full || busy} onClick={() => { void addFrame() }}>Add this frame</Button>
        </div>
        <span className="t-body text-gray-500">
          {full
            ? `That is the most a character keeps (${MAX_CHARACTER_PHOTOS}).`
            : 'Pause on a clear view of the figure and add it. A few different angles work best.'}
        </span>
      </div>

      {frames.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="character-frames">
          {frames.map((f, i) => (
            <div key={f.url} className="relative w-16 h-16">
              <img src={f.url} alt={`frame ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-white/[0.06]" />
              <button
                onClick={() => setFrames((list) => list.filter((x) => x.url !== f.url))}
                className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md bg-black/60 text-gray-300 hover:text-white"
                title={`Remove frame ${i + 1}`}
                aria-label={`Remove frame ${i + 1}`}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_CHARACTER_NAME))}
          placeholder="Character name"
          aria-label="Character name"
          className="flex-1 min-w-0 h-[var(--control-h-md)] px-2.5 rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] focus:border-white/20 outline-none t-control text-gray-100"
        />
        <Button variant="primary" loading={busy} disabled={frames.length === 0 || name.trim().length === 0} onClick={() => { void save() }}>
          Save character
        </Button>
      </div>

      {note && <p className="t-body text-red-300" data-testid="save-character-note">{note}</p>}

      {saved && (
        <div className="flex flex-col gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3" data-testid="character-saved">
          <p className="t-body text-gray-200">
            {saved.merged
              ? `Added ${saved.added} ${saved.added === 1 ? 'photo' : 'photos'} to ${saved.character.name}, ${saved.character.photos.length} in all.`
              : `Saved ${saved.character.name} with ${saved.added} ${saved.added === 1 ? 'photo' : 'photos'}.`}
            {saved.dropped > 0 ? ` ${saved.dropped} did not fit, a character keeps up to ${MAX_CHARACTER_PHOTOS}.` : ''}
            {' '}It is kept on this computer.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canReference && (
              <Button variant="secondary" icon={Images} disabled={busy} onClick={() => { void asReferences() }}>Use as reference photos</Button>
            )}
            {canTrain && (
              <Button variant="secondary" icon={UserRound} disabled={busy} onClick={toStudio}>Train in Character Studio</Button>
            )}
          </div>
          {canTrain && saved.character.photos.length < MIN_TRAIN_IMAGES && (
            <p className="t-body text-gray-500">Training needs at least {MIN_TRAIN_IMAGES} photos. Add more frames or more photos there.</p>
          )}
        </div>
      )}
    </div>
  )
}
