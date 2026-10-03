/**
 * The catalog's own LoRAs on Models, LoRAs, Get new: one click each, no search.
 *
 * Discord 2026-10-03 (boromirofgeo): 3.0.4 said "put the turbo lora in the
 * lora stack" and nobody said where the file comes from. The tiles are the
 * same ones the Image and Video tabs show for these add-ons, with the same
 * install path (size, sha256, models/loras), so there is one answer about
 * what is installed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getLoraAddonBundles, type ModelBundle } from '../../api/model-bundles'
import { checkBundlesInstalled, installBundleComplete, remoteBundleNotice } from '../../api/discover'
import { openExternal } from '../../api/backend'
import { bundleHasErrors, bundleIsComplete, bundleIsDownloading } from '../../lib/bundle-state'
import { useDownloadStore } from '../../stores/downloadStore'
import { BundleTile } from './ModelTiles'

const GIB = 1_073_741_824

export function LoraAddons({ search = '' }: { search?: string }) {
  const bundles = useMemo(() => getLoraAddonBundles(), [])
  const downloads = useDownloadStore((s) => s.downloads)
  const [onDisk, setOnDisk] = useState<Record<string, boolean>>({})
  const [starting, setStarting] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)

  const refresh = useCallback(() => {
    void checkBundlesInstalled(bundles).then(setOnDisk)
  }, [bundles])
  useEffect(() => {
    refresh()
    window.addEventListener('comfyui-model-downloaded', refresh)
    return () => window.removeEventListener('comfyui-model-downloaded', refresh)
  }, [refresh])

  const install = async (bundle: ModelBundle) => {
    if (starting) return
    setStarting(bundle.name)
    setMessage(null)
    const store = useDownloadStore.getState()
    const names: string[] = []
    for (const f of bundle.files) {
      if (!f.downloadUrl || !f.filename || !f.subfolder) continue
      store.setMeta(f.filename, f.downloadUrl, f.subfolder, undefined, {
        expectedBytes: f.sizeGB ? Math.round(f.sizeGB * GIB) : undefined,
        sha256: f.sha256,
      })
      names.push(f.filename)
    }
    store.setBundleGroup(bundle.name, names)
    store.startPolling()
    try {
      const report = await installBundleComplete(bundle)
      if (report.remote) setMessage({ text: remoteBundleNotice(bundle.name, report.remote), failed: false })
    } catch (err) {
      setMessage({ text: `${bundle.name}: ${err instanceof Error ? err.message : String(err)}`, failed: true })
    }
    // The tile stays on "Installing" until the download row is in the store,
    // so it never flips back to Get for the length of one poll.
    await useDownloadStore.getState().refresh().catch(() => {})
    setStarting(null)
  }

  /** A failed row has to be cleared on the Rust side first, which the store's
   *  retry does; anything else is a fresh start. */
  const retry = (bundle: ModelBundle) => {
    const failed = bundle.files.filter((f) => f.filename && downloads[f.filename]?.status === 'error')
    if (failed.length === 0) { void install(bundle); return }
    for (const f of failed) void useDownloadStore.getState().retry(f.filename!)
  }

  const q = search.trim().toLowerCase()
  const shown = q
    ? bundles.filter((b) => b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q))
    : bundles
  if (shown.length === 0) return null

  return (
    <section className="space-y-1.5" data-testid="lora-addons">
      <h3 className="px-1 t-micro font-semibold uppercase tracking-[0.12em] text-gray-700 dark:text-gray-300">Ready to install</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {shown.map((bundle) => (
          <BundleTile
            key={bundle.name}
            bundle={bundle}
            vramGb={null}
            complete={bundleIsComplete(bundle.files, downloads, onDisk[bundle.name] === true)}
            downloading={bundleIsDownloading(bundle.files, downloads) || starting === bundle.name}
            hasErrors={bundleHasErrors(bundle.files, downloads, onDisk[bundle.name] === true)}
            onInstall={() => { void install(bundle) }}
            onRetry={() => retry(bundle)}
            onClear={() => { for (const f of bundle.files) if (f.filename) useDownloadStore.getState().dismiss(f.filename) }}
            onOpenUrl={(u) => { void openExternal(u) }}
          />
        ))}
      </div>
      {message && (
        <p className={`px-1 t-micro ${message.failed ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>{message.text}</p>
      )}
    </section>
  )
}
