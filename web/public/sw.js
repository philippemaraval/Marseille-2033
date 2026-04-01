const APP_CACHE = 'marseille2033-app-v1'
const TILE_CACHE = 'marseille2033-tiles-v1'
const DATA_CACHE = 'marseille2033-data-v1'

const APP_SHELL = ['/', '/index.html', '/favicon.svg', '/icons.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function isTileRequest(requestUrl) {
  return (
    requestUrl.includes('/tile/') ||
    requestUrl.includes('/MapServer/tile/') ||
    requestUrl.includes('/light_all/') ||
    requestUrl.includes('/dark_all/')
  )
}

function isDataRequest(request) {
  const url = new URL(request.url)
  return (
    url.pathname.includes('/rest/v1/') ||
    url.pathname.endsWith('.json') ||
    request.headers.get('accept')?.includes('application/json')
  )
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  const response = await fetch(request)
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => undefined)
  }
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => undefined)
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    networkPromise.catch(() => null)
    return cached
  }

  const network = await networkPromise
  if (network) {
    return network
  }

  return Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_CACHE))
    return
  }

  if (isTileRequest(url.href)) {
    event.respondWith(cacheFirst(request, TILE_CACHE))
    return
  }

  if (isDataRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE))
  }
})

self.addEventListener('message', (event) => {
  const payload = event.data
  if (!payload || payload.type !== 'PREFETCH_URLS' || !Array.isArray(payload.urls)) {
    return
  }

  event.waitUntil(
    caches.open(TILE_CACHE).then(async (cache) => {
      await Promise.all(
        payload.urls
          .filter((entry) => typeof entry === 'string' && entry.length > 0)
          .map(async (url) => {
            const request = new Request(url, { mode: 'no-cors' })
            const cached = await cache.match(request)
            if (cached) {
              return
            }
            try {
              const response = await fetch(request)
              if (response && (response.ok || response.type === 'opaque')) {
                await cache.put(request, response.clone())
              }
            } catch {
              // Ignore prefetch failures.
            }
          }),
      )
    }),
  )
})
