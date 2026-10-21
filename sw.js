/* ========================================================================
 * NutriDex Service Worker (PWA Offline Engine v4.0.0)
 * 文部科学省「八訂食品データベース（約1.7MB）」の完全ローカルキャッシュ＆オフライン動作
 * ======================================================================== */

const CACHE_NAME = 'nutridex-cache-v4.0.0';

// プリキャッシュ対象の重要アセット
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './mext_foods.json',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// インストール時: コアアセット＆八訂データベースをプリキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[NutriDex SW] Pre-caching core assets and MEXT food database...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[NutriDex SW] Precache partial error (ignored for non-critical):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// アクティベート時: 古いバージョンのキャッシュを自動パージ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[NutriDex SW] Removing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチ時: キャッシュ優先 (Stale-While-Revalidate & Cache-First)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // POST や 外部API(Gemini API等) はキャッシュせず素通し
  if (req.method !== 'GET' || url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // 1. mext_foods.json または ローカルアセットのリクエスト: Cache-First + Background Update
  if (url.origin === location.origin && (url.pathname.endsWith('.json') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png'))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          const fetchPromise = fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(req, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => null);

          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 2. HTML ドキュメント: Stale-While-Revalidate（即座にキャッシュから返しつつ裏で最新取得）
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match('./index.html').then((cachedIndex) => {
          const fetchPromise = fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put('./index.html', networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => cachedIndex);

          return cachedIndex || fetchPromise;
        });
      })
    );
    return;
  }

  // 3. その他のリクエスト (CDN script, font等): Network first with Cache fallback
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // オフライン時のフォールバック
        return cachedResponse || new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
