import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Images, Loader2 } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { Modal } from '../../ui/Modal'
import { Button } from '../ui/Button'
import { cn } from '../ui/cn'
import { useCreateExp } from './CreateContext'
import {
  EXAMPLE_NSFW, EXAMPLE_PERIODS, EXAMPLE_SORTS,
  applyExample, applyExampleToStore, examplePageUrl, examplesMediaFor, findInstalledLora, fitsModelFamily,
  type CivitaiExample, type ExampleMedia, type ExampleNsfw, type ExamplePeriod, type ExampleSort,
} from '../../../lib/civitai-examples'
import { civitaiSettings, civitaiTileBlobUrl, downloadExampleLora, fetchCivitaiExamples } from '../../../api/civitai-examples'
import type { ModelType } from '../../../api/comfyui'

/**
 * "Examples" next to the prompt field of every Create section that takes a
 * prompt (lib/civitai-examples.ts examplesMediaFor): a grid of CivitAI images
 * or videos with their generation data; picking one copies its prompt and
 * settings into the section.
 */
export function CivitaiExamplesButton() {
  const intent = useCreateStore((s) => s.intent())
  const [open, setOpen] = useState(false)
  const media = examplesMediaFor(intent)
  if (!media) return null
  return (
    <>
      <Button variant="ghost" size="sm" icon={Images} onClick={() => setOpen(true)} title="Pick an example from CivitAI and use its prompt and settings">
        Examples
      </Button>
      <CivitaiExamplesModal open={open} onClose={() => setOpen(false)} media={media} />
    </>
  )
}

/** Family of the selected LOCAL model; a cloud render has none to filter by. */
function useSelectedModelType(media: ExampleMedia): ModelType | undefined {
  const backend = useCreateStore((s) => s.backend)
  const imageModelType = useCreateStore((s) => s.imageModelType)
  const videoModel = useCreateStore((s) => s.videoModel)
  const videoModelList = useCreateStore((s) => s.videoModelList)
  if (backend === 'cloud') return undefined
  if (media === 'image') return imageModelType
  return videoModelList.find((m) => m.name === videoModel)?.type
}

function CivitaiExamplesModal({ open, onClose, media }: { open: boolean; onClose: () => void; media: ExampleMedia }) {
  const modelType = useSelectedModelType(media)
  const [sort, setSort] = useState<ExampleSort>('Most Reactions')
  const [period, setPeriod] = useState<ExamplePeriod>('Week')
  const [nsfw, setNsfw] = useState<ExampleNsfw>('X')
  const [onlyFamily, setOnlyFamily] = useState(true)
  const [items, setItems] = useState<CivitaiExample[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<CivitaiExample | null>(null)
  const [host, setHost] = useState('civitai.com')
  const req = useRef(0)

  const load = useCallback(async (from?: string) => {
    const id = ++req.current
    setLoading(true)
    setError(null)
    try {
      const page = await fetchCivitaiExamples({ sort, period, nsfw, ...(from ? { cursor: from } : {}) }, media)
      if (id !== req.current) return
      setItems((prev) => {
        const merged = from ? [...prev, ...page.items] : page.items
        const seen = new Set<number>()
        return merged.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
      })
      setCursor(page.nextCursor)
    } catch (e) {
      if (id === req.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [sort, period, nsfw, media])

  useEffect(() => {
    if (!open) return
    setPicked(null)
    void civitaiSettings().then((s) => setHost(s.host))
    void load()
  }, [open, load])

  const familyKnown = !!modelType && modelType !== 'unknown'
  const shown = onlyFamily && familyKnown ? items.filter((x) => fitsModelFamily(x, modelType)) : items

  return (
    <Modal open={open} onClose={onClose} title={media === 'video' ? 'Video examples from CivitAI' : 'Image examples from CivitAI'} maxWidth="max-w-5xl">
      <div className="space-y-3 text-sm text-gray-200">
        <div className="flex flex-wrap items-center gap-2 t-control">
          <Choice label="Sort" value={sort} options={EXAMPLE_SORTS} onChange={setSort} />
          <Choice label="Period" value={period} options={EXAMPLE_PERIODS} onChange={setPeriod} />
          <Choice label="Content" value={nsfw} options={EXAMPLE_NSFW} onChange={setNsfw} />
          {familyKnown && (
            <label className="inline-flex items-center gap-1.5 text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={onlyFamily} onChange={(e) => setOnlyFamily(e.target.checked)} />
              Only my model's family
            </label>
          )}
          <span className="flex-1" />
          <span className="t-micro text-gray-500 font-mono">{host}</span>
        </div>

        <div className="flex flex-col md:flex-row gap-3 min-h-[320px]">
          <div className="flex-1 min-w-0">
            {error && (
              <p className="t-body text-red-300 mb-2">CivitAI did not answer: {error}</p>
            )}
            {!loading && !error && shown.length === 0 && (
              <p className="t-body text-gray-400 py-8 text-center">
                {items.length > 0
                  ? 'Nothing on this page was made with your model\'s family. Load more, or untick "Only my model\'s family".'
                  : 'No examples with generation data on this page. Try another period or sort.'}
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {shown.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setPicked(x)}
                  className={cn(
                    'relative aspect-square rounded-md overflow-hidden bg-white/[0.04] border transition-colors',
                    picked?.id === x.id ? 'border-white/60' : 'border-transparent hover:border-white/20',
                  )}
                  title={x.recipe.prompt.slice(0, 200)}
                >
                  <Tile example={x} />
                  {x.baseModel && (
                    <span className="absolute left-1 bottom-1 px-1 rounded bg-black/60 t-micro text-gray-200">{x.baseModel}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-center pt-2">
              {loading ? (
                <Loader2 size={16} className="animate-spin text-gray-400" />
              ) : cursor ? (
                <Button variant="secondary" size="sm" onClick={() => void load(cursor)}>Load more</Button>
              ) : null}
            </div>
          </div>
          {picked && (
            <ExampleDetail example={picked} host={host} media={media} modelType={modelType} onUsed={onClose} />
          )}
        </div>
      </div>
    </Modal>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="inline-flex items-center gap-1 text-gray-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-white/[0.05] border border-white/10 rounded px-1.5 py-0.5 text-gray-200"
      >
        {options.map((o) => <option key={o} value={o}>{o === 'AllTime' ? 'All time' : o}</option>)}
      </select>
    </label>
  )
}

/** The tile image: straight from the CDN, or through the backend if the page may not load it. */
function Tile({ example }: { example: CivitaiExample }) {
  const [src, setSrc] = useState(example.thumbUrl)
  const [failed, setFailed] = useState(false)
  const blob = useRef<string | null>(null)
  useEffect(() => () => { if (blob.current) URL.revokeObjectURL(blob.current) }, [])
  const onError = () => {
    if (blob.current || failed) { setFailed(true); return }
    civitaiTileBlobUrl(example.thumbUrl)
      .then((u) => { blob.current = u; setSrc(u) })
      .catch(() => setFailed(true))
  }
  if (failed) return <span className="absolute inset-0 grid place-items-center t-micro text-gray-500">no preview</span>
  return <img src={src} alt="" loading="lazy" onError={onError} className="absolute inset-0 w-full h-full object-cover" />
}

function ExampleDetail({ example, host, media, modelType, onUsed }: {
  example: CivitaiExample; host: string; media: ExampleMedia; modelType?: ModelType; onUsed: () => void
}) {
  const { samplerList, schedulerList, loraList, refreshModelLists } = useCreateExp()
  const intent = useCreateStore((s) => s.intent())
  const [dl, setDl] = useState<Record<number, 'busy' | 'queued' | string>>({})
  const r = example.recipe
  const applied = applyExample(r, { intent, samplers: samplerList, schedulers: schedulerList, installedLoras: loraList, modelType })

  const use = () => {
    applyExampleToStore(applied, useCreateStore.getState(), media === 'image' && r.loras.length > 0)
    onUsed()
  }
  const download = async (versionId: number) => {
    setDl((d) => ({ ...d, [versionId]: 'busy' }))
    try {
      await downloadExampleLora(versionId)
      setDl((d) => ({ ...d, [versionId]: 'queued' }))
      void refreshModelLists()
    } catch (e) {
      setDl((d) => ({ ...d, [versionId]: e instanceof Error ? e.message : String(e) }))
    }
  }

  const settings = [
    r.samplerLabel && `sampler ${r.samplerLabel}`,
    r.steps !== undefined && `${r.steps} steps`,
    r.cfg !== undefined && `CFG ${r.cfg}`,
    r.seed !== undefined && `seed ${r.seed}`,
    r.width && r.height && `${r.width}×${r.height}`,
    r.clipSkip !== undefined && `clip skip ${r.clipSkip}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="md:w-80 shrink-0 space-y-2 t-body max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <span className="t-label text-gray-400">{r.checkpoint ?? 'Unknown model'}{example.baseModel ? ` · ${example.baseModel}` : ''}</span>
        <a href={examplePageUrl(example.id, host)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-200" title="Open on CivitAI">
          <ExternalLink size={13} />
        </a>
      </div>
      <p className="text-gray-200 whitespace-pre-wrap break-words">{r.prompt}</p>
      {r.negativePrompt && (
        <p className="text-gray-500 whitespace-pre-wrap break-words"><span className="text-gray-400">Negative: </span>{r.negativePrompt}</p>
      )}
      {settings && <p className="text-gray-400">{settings}</p>}
      {r.loras.length > 0 && (
        <div className="space-y-1">
          <span className="t-label text-gray-400">LoRAs</span>
          {r.loras.map((l) => {
            const file = findInstalledLora(l.name, loraList)
            const state = l.versionId ? dl[l.versionId] : undefined
            return (
              <div key={l.versionId ?? l.name} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-gray-300" title={l.name}>{l.name} · {l.weight}</span>
                {file ? (
                  <span className="text-gray-500">installed</span>
                ) : state === 'queued' ? (
                  <span className="text-gray-400">downloading</span>
                ) : l.versionId && media === 'image' ? (
                  <Button variant="ghost" size="sm" icon={Download} loading={state === 'busy'} onClick={() => void download(l.versionId!)} title="Download this LoRA from CivitAI">
                    Get
                  </Button>
                ) : (
                  <span className="text-gray-500">not installed</span>
                )}
                {state && state !== 'busy' && state !== 'queued' && <span className="text-red-300 truncate" title={state}>failed</span>}
              </div>
            )
          })}
        </div>
      )}
      {applied.skipped.length > 0 && (
        <ul className="text-gray-500 list-disc pl-4 space-y-0.5">
          {applied.skipped.map((s) => <li key={s}>Not copied: {s}</li>)}
        </ul>
      )}
      {applied.notes.map((n) => <p key={n} className="text-gray-400">{n}</p>)}
      <Button variant="primary" size="sm" fullWidth onClick={use}>Use this example</Button>
    </div>
  )
}
