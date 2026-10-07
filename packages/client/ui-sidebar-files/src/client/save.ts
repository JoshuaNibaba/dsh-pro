/**
 * The browser half of a download: an object URL clicked through a `download`
 * anchor, which the browser — or an embedding WebView's download delegate —
 * saves under the suggested name instead of navigating to it.
 */

/** How long a saved object URL stays valid: the browser reads it after the click returns. */
const OBJECT_URL_LIFETIME_MS = 60_000

/**
 * Hand bytes to the browser's download manager.
 * @param data - the file's bytes.
 * @param filename - the suggested saved file name.
 */
export function saveBlob(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, OBJECT_URL_LIFETIME_MS)
}
