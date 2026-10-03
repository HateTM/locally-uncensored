// The reference strip under the Edit source (GH #144, Discord s3aldra and
// tbjdrw, 2026-09-23 to 09-27): Edit took one image, so "put the person from
// this photo into that scene" could not be asked. Layout picked by David on
// 2026-10-01: the source stays large, the further images sit as small tiles
// below it with a "+ Reference" tile, and the prompt names them image 2,
// image 3. Shown for a local model that takes more than one image, and (02.10.2026,
// figure from photos without training) in the cloud for the Studio models that
// read a list of images: the multi-image editors and the reference-to-video
// models. The photos go to the user's own storage at the start, never as a URL.
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { useReferenceSlots } from './referenceSlots'
import { SavedCharacterChips } from './SavedCharacters'
import { loadPhotosAsReferences } from './characterPhotos'
import { loadImageRef } from './loadImage'
import { GALLERY_DRAG_TYPE, fetchGalleryItemBlob } from './galleryUrl'
import { cn } from '../ui/cn'

const TILE = 'w-16 h-16 rounded-lg shrink-0'

export function ReferenceStrip() {
  const references = useCreateStore((s) => s.references)
  const addReference = useCreateStore((s) => s.addReference)
  const removeReference = useCreateStore((s) => s.removeReference)
  const setError = useCreateStore((s) => s.setError)
  const gallery = useCreateStore((s) => s.gallery)
  const backend = useCreateStore((s) => s.backend)
  const intent = useCreateStore((s) => s.intent())
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)

  const cloud = backend === 'cloud'
  const slots = useReferenceSlots()
  if (slots === 0) return null
  const shown = references.slice(0, slots)
  const canAdd = shown.length < slots

  const add = async (load: () => Promise<File>) => {
    setLoading(true)
    setError(null)
    try {
      addReference(await loadImageRef(await load()))
    } catch (err) {
      setError(`Could not load the image: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // Mehrere Dateien auf einmal, soweit Platz ist (die Cloud-Modelle lesen bis zu
  // vier weitere Fotos). Jede Datei geht durch dieselbe Pruefung wie eine einzelne.
  const addFiles = async (files: File[]) => {
    let room = slots - shown.length
    for (const file of files) {
      if (room <= 0) break
      if (!file.type.startsWith('image/')) {
        setError('That file type is not supported. Use PNG, JPG or WebP.')
        continue
      }
      await add(async () => file)
      room--
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-2" data-testid="reference-strip">
      <div
        className={cn('flex items-center gap-2 rounded-xl p-1 transition-colors', drag && 'bg-blue-500/10')}
        onDragOver={(e) => { if (canAdd) { e.preventDefault(); setDrag(true) } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (!canAdd || loading) return
          if (e.dataTransfer.files.length) { void addFiles(Array.from(e.dataTransfer.files)); return }
          const item = gallery.find((g) => g.id === e.dataTransfer.getData(GALLERY_DRAG_TYPE))
          if (item) {
            void add(async () => {
              const blob = await fetchGalleryItemBlob(item)
              return new File([blob], item.filename || 'reference.png', { type: blob.type || 'image/png' })
            })
          }
        }}
      >
        {shown.map((ref, i) => (
          <div key={`${ref.url.slice(-24)}-${i}`} className={cn(TILE, 'relative')}>
            <img
              src={ref.url}
              alt={`${cloud ? 'photo' : 'image'} ${i + 2}`}
              className={cn(TILE, 'object-cover border border-white/[0.06]')}
            />
            <span className="absolute bottom-1 left-1 t-micro text-gray-200 bg-black/60 px-1 rounded">{i + 2}</span>
            <button
              onClick={() => removeReference(i)}
              className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md bg-black/60 text-gray-300 hover:text-white"
              title={`Remove ${cloud ? 'photo' : 'image'} ${i + 2}`}
              aria-label={`Remove ${cloud ? 'photo' : 'image'} ${i + 2}`}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {canAdd && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className={cn(TILE, 'border-2 border-dashed border-white/10 hover:border-white/25 text-gray-500 hover:text-gray-300 flex flex-col items-center justify-center gap-0.5 transition-colors')}
            title={cloud ? 'Add another photo of your character' : 'Add another image the edit can use'}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            <span className="t-micro">{cloud ? 'Photo' : 'Reference'}</span>
          </button>
        )}
      </div>
      <p className="t-label text-gray-600 text-center max-w-sm">
        {cloud
          ? `Add up to ${slots + 1} photos of your character.${intent === 'edit' && shown.length > 0 ? ` Name them in the prompt as ${shown.map((_, i) => `image ${i + 2}`).join(', ')}.` : ''}`
          : shown.length === 0
            ? `Add up to ${slots} more images, for example a person or an outfit to bring into this one.`
            : `Name them in the prompt as ${shown.map((_, i) => `image ${i + 2}`).join(', ')}.`}
      </p>
      {/* A character saved from a video (lib/saved-characters) loads its photos
          here with one click: they join the strip, and the first becomes the
          source only when none is loaded. */}
      <SavedCharacterChips
        label="Saved characters"
        disabled={loading}
        title={(c) => `Load the photos of ${c.name}`}
        onPick={(c) => {
          setLoading(true)
          setError(null)
          void loadPhotosAsReferences(c.name, c.photos)
            .catch((err: unknown) => setError(`Could not load the photos: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => setLoading(false))
        }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void addFiles(files)
        }}
      />
    </div>
  )
}
