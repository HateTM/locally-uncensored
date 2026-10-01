// The reference strip under the Edit source (GH #144, Discord s3aldra and
// tbjdrw, 2026-09-23 to 09-27): Edit took one image, so "put the person from
// this photo into that scene" could not be asked. Layout picked by David on
// 2026-10-01: the source stays large, the further images sit as small tiles
// below it with a "+ Reference" tile, and the prompt names them image 2,
// image 3. Shown only for a local model that takes more than one image.
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { classifyModel } from '../../../api/comfyui'
import { extraReferenceSlots } from '../../../lib/edit-references'
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
  const imageModel = useCreateStore((s) => s.imageModel)
  const listedType = useCreateStore((s) => s.imageModelList.find((m) => m.name === s.imageModel)?.type)
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)

  // The type from the fetched list carries the header sniff; the name is the
  // fallback, exactly as useCreate decides the pipeline.
  const slots = extraReferenceSlots(listedType ?? classifyModel(imageModel), imageModel)
  if (intent !== 'edit' || backend !== 'local' || slots === 0) return null
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

  const addFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That file type is not supported. Use PNG, JPG or WebP.')
      return
    }
    void add(async () => file)
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
          const f = e.dataTransfer.files[0]
          if (f) { addFile(f); return }
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
              alt={`image ${i + 2}`}
              className={cn(TILE, 'object-cover border border-white/[0.06]')}
            />
            <span className="absolute bottom-1 left-1 t-micro text-gray-200 bg-black/60 px-1 rounded">{i + 2}</span>
            <button
              onClick={() => removeReference(i)}
              className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md bg-black/60 text-gray-300 hover:text-white"
              title={`Remove image ${i + 2}`}
              aria-label={`Remove image ${i + 2}`}
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
            title="Add another image the edit can use"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            <span className="t-micro">Reference</span>
          </button>
        )}
      </div>
      <p className="t-label text-gray-600 text-center max-w-sm">
        {shown.length === 0
          ? `Add up to ${slots} more images, for example a person or an outfit to bring into this one.`
          : `Name them in the prompt as ${shown.map((_, i) => `image ${i + 2}`).join(', ')}.`}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) addFile(f)
        }}
      />
    </div>
  )
}
