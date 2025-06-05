
const CACHE_NAME = 'route-optimizer-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Retorna cache se disponível, senão busca na rede
                if (response) {
                    return response;
                }
                
                // Para requisições de API externa, sempre tenta a rede primeiro
                if (event.request.url.includes('nominatim.openstreetmap.org') || 
                    event.request.url.includes('google.com/maps')) {
                    return fetch(event.request);
                }
                
                return fetch(event.request);
            }
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
