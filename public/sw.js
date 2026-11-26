// Service worker do Mapa de ciclismo: guarda a "casca" do app para abrir rápido e funcionar como aplicativo.
// A página sempre tenta a versão nova primeiro (para receber as atualizações), e usa a cópia guardada só sem internet.
const CACHE = 'cyclemap-v1';
const LEAFLET = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
];
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...LEAFLET];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Página: rede primeiro, cópia guardada se estiver sem conexão
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }

  // Leaflet e arquivos do app: cópia guardada primeiro
  if (LEAFLET.includes(req.url) || (url.origin === location.origin && SHELL.includes(url.pathname))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
  // Todo o resto (mapas, rotas, clima, grupo) vai direto à rede
});
