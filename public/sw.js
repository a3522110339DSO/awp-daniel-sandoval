const STATIC_CACHE = 'awp-static-v3';
const DYNAMIC_CACHE = 'awp-dynamic-v1';
const IMAGE_CACHE = 'awp-images-v1';
const DATA_CACHE = 'awp-data-v1';

const OFFLINE_PAGE = '/offline.html';
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  OFFLINE_PAGE,
  '/manifest.json',
  '/src/App.css',
  '/src/index.css',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico',
  '/icons/masked-icon.svg',
  '/icons/pwa-192x192.png',
  '/icons/pwa-512x512.png'
];

const DB_NAME = 'awp-offline-db';
const DB_VERSION = 3;
const STORE_NAME = 'tasks';
const SYNC_TAG = 'sync-entries';
const SYNC_ENDPOINT = 'https://httpbin.org/post';

let dbPromise = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (![STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE, DATA_CACHE].includes(cacheName)) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  const acceptHeader = request.headers.get('accept') ?? '';

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (url.origin === self.location.origin && APP_SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/') || acceptHeader.includes('application/json')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
});

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
};

const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cachedPromise = cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedPromise);

  const cached = await cachedPromise;
  return cached ?? networkPromise;
};

const networkFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
};

const handleNavigationRequest = async (request) => {
  try {
    const response = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    const offline = await caches.match(OFFLINE_PAGE);
    if (offline) {
      return offline;
    }
    throw error;
  }
};

const openDatabase = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const { transaction } = request;
        let store = null;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        } else {
          store = transaction.objectStore(STORE_NAME);
        }

        if (!store.indexNames.contains('by-createdAt')) {
          store.createIndex('by-createdAt', 'createdAt');
        }

        if (!store.indexNames.contains('by-syncStatus')) {
          store.createIndex('by-syncStatus', 'syncStatus');
        }

        const existingRequest = store.getAll();
        existingRequest.onsuccess = () => {
          const records = existingRequest.result;
          records.forEach((task) => {
            if (!task.syncStatus) {
              store.put({ ...task, syncStatus: 'pending' });
            }
          });
        };
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
};

const getPendingTasks = async () => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const index = transaction.objectStore(STORE_NAME).index('by-syncStatus');
    const request = index.getAll('pending');
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

const deleteTasksByIds = async (ids) => {
  if (!ids.length) {
    return;
  }

  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
};

const notifyClients = async (type, payload) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type, payload }));
};

const syncEntries = async () => {
  const pendingTasks = await getPendingTasks();
  if (!pendingTasks.length) {
    return;
  }

  try {
    const response = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tasks: pendingTasks })
    });

    if (!response.ok) {
      throw new Error(`Error del servidor: ${response.status}`);
    }

    const ids = pendingTasks.map((task) => task.id);
    await deleteTasksByIds(ids);
    await notifyClients('SYNC_COMPLETED', { ids });
  } catch (error) {
    await notifyClients('SYNC_ERROR', { message: error.message ?? 'Fallo desconocido.' });
    throw error;
  }
};

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncEntries());
  }
});

self.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') {
    return;
  }

  if (event.data.type === 'MANUAL_SYNC') {
    event.waitUntil(syncEntries());
  }

  if (event.data.type === 'SHOW_TEST_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification('Notificación de prueba', {
        body: 'Este es un aviso local generado desde la app.',
        icon: '/icons/pwa-192x192.png',
        badge: '/icons/pwa-192x192.png',
        data: {
          url: '/',
        },
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  const defaultPayload = {
    title: 'Nueva notificación',
    body: 'Tienes una actualización disponible.',
    data: {
      url: '/',
    },
  };

  let payload = defaultPayload;
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title ?? defaultPayload.title,
        body: parsed.body ?? defaultPayload.body,
        data: {
          url: parsed.url ?? defaultPayload.data.url,
        },
        icon: parsed.icon,
        badge: parsed.badge,
      };
    } catch (error) {
      payload = {
        ...defaultPayload,
        body: event.data.text(),
      };
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon ?? '/icons/pwa-192x192.png',
    badge: payload.badge ?? '/icons/pwa-192x192.png',
    data: payload.data,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const focusedClient = windowClients.find((client) => client.url === targetUrl);
      if (focusedClient) {
        return focusedClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
