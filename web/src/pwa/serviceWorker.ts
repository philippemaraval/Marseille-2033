const PREFETCH_BATCH_LIMIT = 80

export async function registerMarseilleServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const register = async () => {
    try {
      await navigator.serviceWorker.register('/sw.js')
    } catch {
      // Ignore registration failures in development and unsupported browsers.
    }
  }

  if (document.readyState === 'complete') {
    await register()
    return
  }

  window.addEventListener(
    'load',
    () => {
      void register()
    },
    { once: true },
  )
}

export function prefetchTileUrls(urls: string[]) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const nextUrls = Array.from(
    new Set(urls.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ).slice(0, PREFETCH_BATCH_LIMIT)

  if (nextUrls.length === 0) {
    return
  }

  navigator.serviceWorker.controller?.postMessage({
    type: 'PREFETCH_URLS',
    urls: nextUrls,
  })
}
