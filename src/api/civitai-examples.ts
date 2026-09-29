/**
 * The network half of "pick an example from CivitAI" (lib/civitai-examples.ts
 * has the rules): the feed page, the tile images and the LoRA download.
 */
import { fetchExternal, fetchExternalBytes } from './backend'
import {
  examplesUrl, parseExamplesPage,
  type ExampleMedia, type ExampleQuery, type ExamplesPage,
} from '../lib/civitai-examples'

/** Host and key from Settings (the same ones the Model Manager's CivitAI search uses). */
export async function civitaiSettings(): Promise<{ host: string; apiKey?: string }> {
  const { useWorkflowStore } = await import('../stores/workflowStore')
  const st = useWorkflowStore.getState()
  return { host: st.civitaiHost || 'civitai.com', ...(st.civitaiApiKey ? { apiKey: st.civitaiApiKey } : {}) }
}

export async function fetchCivitaiExamples(
  q: Omit<ExampleQuery, 'host'>,
  media: ExampleMedia,
): Promise<ExamplesPage> {
  const { host, apiKey } = await civitaiSettings()
  const text = await fetchExternal(examplesUrl({ ...q, host }), apiKey ?? null)
  return parseExamplesPage(JSON.parse(text), media)
}

/**
 * A tile image as a blob: URL. The page's CSP allows *.civitai.com images, but
 * a mirror can serve its CDN from another host; the backend fetch reaches any
 * public host and blob: is always allowed.
 */
export async function civitaiTileBlobUrl(url: string): Promise<string> {
  const bytes = await fetchExternalBytes(url)
  return URL.createObjectURL(new Blob([bytes]))
}

/**
 * Start the download of a LoRA an example used, by its CivitAI version id.
 * Resolves once the download is queued; progress shows in the downloads tray.
 */
export async function downloadExampleLora(versionId: number): Promise<{ filename: string; name: string }> {
  const discover = await import('./discover')
  const { host, apiKey } = await civitaiSettings()
  const hit = await discover.getCivitaiModelVersion(versionId, apiKey, host)
  if (!hit?.downloadUrl || !hit.filename) throw new Error(`CivitAI has no downloadable file for version ${versionId}`)
  if (hit.subfolder !== 'loras') throw new Error(`CivitAI version ${versionId} is a ${hit.type || 'non-LoRA'} file, not a LoRA`)
  // Its trigger words go into every later prompt that uses it (lib/lora-auto.ts).
  const { rememberLoraHit } = await import('../stores/loraInfoStore')
  rememberLoraHit(hit)
  const { useDownloadStore } = await import('../stores/downloadStore')
  const dl = useDownloadStore.getState()
  dl.setMeta(hit.filename, hit.downloadUrl, 'loras')
  const started = await discover.startModelDownload(hit.downloadUrl, 'loras', hit.filename)
  if (started.error || started.status === 'error') throw new Error(started.error ?? `the download of ${hit.filename} did not start`)
  dl.startPolling()
  return { filename: hit.filename, name: hit.name }
}
