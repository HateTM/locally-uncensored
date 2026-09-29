/**
 * A data URL turned into a Blob without fetch().
 *
 * Shared by the cloud Create path (useCloudCreate) and the local one (useCreate),
 * which both stage Stage images that only exist as data URLs.
 */
// Decoded by hand instead of fetch(dataUrl): the webview CSP's connect-src
// (rightly) has no data: entry, so fetching a data URL throws "Load failed"
// and killed every source-needing op before the upload even started.
export function dataUrlToBlob(dataUrl: string): Blob {
  // A blob:/http(s) url here means an ImageRef broke the "url is always a data
  // url" invariant. Parsing it as a data url silently yields a text blob the
  // server 415s ("unsupported image format") — fail loudly at the source.
  if (!dataUrl.startsWith('data:')) {
    throw new Error(`dataUrlToBlob expects a data: URL, got "${dataUrl.slice(0, 16)}…"`)
  }
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)
  const data = dataUrl.slice(comma + 1)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  if (meta.includes('base64')) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(data)], { type: mime })
}
