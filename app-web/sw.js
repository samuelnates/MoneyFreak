// Service Worker de Money Freak -- da soporte offline básico: la app abre
// sin internet y muestra la última versión del "cascarón" (HTML/CSS/JS/
// librerías/ícono) que se haya cargado con conexión, en vez de una pantalla
// en blanco o un error de red. NO guarda datos del usuario ni respuestas de
// Supabase -- eso sigue viviendo solo en la base, nunca en este caché, así
// que sin internet se puede ABRIR la app pero no se ven datos nuevos ni se
// pueden guardar cambios reales (ver CONTEXTO_PROYECTO.md, "offline-first
// de verdad" quedó fuera de alcance a propósito, es un cambio mucho más
// grande).
//
// Subir este número solo cuando cambie la LISTA de archivos precacheados
// (ARCHIVOS_SHELL) -- el contenido de esos archivos se revisa fresco en
// cada visita con internet sin necesidad de tocar esto (ver
// estrategiaRedPrimero).
const CACHE_VERSION = 'v1';
const CACHE_SHELL = `moneyfreak-shell-${CACHE_VERSION}`;
const CACHE_RUNTIME = 'moneyfreak-runtime';

const ARCHIVOS_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/config.js',
  '/app-icon/icon-1024.png',
  '/app-icon/icon-1024.svg',
];

// Librerías de terceros de las que depende la app para funcionar (sin
// supabase-js ni Chart.js la app ni siquiera termina de cargar) -- se
// precachean aparte de ARCHIVOS_SHELL porque si un CDN externo falla justo
// en el momento de instalar, no debe tumbar TODO el precache (cache.addAll
// es todo-o-nada); si una falla aquí, se cachea sola más adelante en el
// primer uso normal vía estrategiaCacheConRevalidacion.
const ARCHIVOS_CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4',
  'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cacheShell = await caches.open(CACHE_SHELL);
      await cacheShell.addAll(ARCHIVOS_SHELL); // mismo origen -- si esto falla, sí queremos que falle el install completo
      // Se guardan en CACHE_RUNTIME (no en CACHE_SHELL) porque es ese caché
      // el que consulta estrategiaCacheConRevalidacion en cada request --
      // así lo precacheado aquí y lo cacheado después en uso normal viven
      // en el mismo lugar.
      const cacheRuntime = await caches.open(CACHE_RUNTIME);
      await Promise.all(ARCHIVOS_CDN.map((url) =>
        fetch(url).then((r) => cacheRuntime.put(url, r)).catch(() => {})
      ));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres
          .filter((n) => n.startsWith('moneyfreak-shell-') && n !== CACHE_SHELL)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Nunca cachear esto -- son datos en vivo o autenticación, no "cascarón".
const DOMINIOS_SIN_CACHE = ['supabase.co', 'supabase.com', 'challenges.cloudflare.com'];

function esApiEnVivo(url) {
  return DOMINIOS_SIN_CACHE.some((dominio) => url.hostname === dominio || url.hostname.endsWith('.' + dominio));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca interceptar POST/PATCH/DELETE (Supabase, Edge Functions)

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // ignora chrome-extension:, etc.
  if (esApiEnVivo(url)) return; // deja pasar directo a la red, sin tocar caché

  // El detector de "hay una versión nueva" (chequearNuevaVersion, en
  // index.html) pide "/" con fetch() a mano -- no es una navegación real,
  // así que req.mode/destination no la distinguen de cualquier otro fetch.
  // Se detecta por ruta para que también vaya siempre a la red primero,
  // igual que antes de que existiera este Service Worker.
  const esDocumentoPrincipal = url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html');
  if (req.mode === 'navigate' || req.destination === 'document' || esDocumentoPrincipal) {
    event.respondWith(estrategiaRedPrimero(req));
    return;
  }

  event.respondWith(estrategiaCacheConRevalidacion(req));
});

// HTML: siempre se intenta traer la versión más nueva de la red primero
// (así el detector de "hay una versión nueva" de index.html sigue viendo
// contenido fresco igual que sin Service Worker) -- el caché solo entra
// como respaldo si de verdad no hay conexión.
async function estrategiaRedPrimero(req) {
  try {
    const respuestaRed = await fetch(req);
    const cache = await caches.open(CACHE_SHELL);
    cache.put(req, respuestaRed.clone()).catch(() => {});
    return respuestaRed;
  } catch (e) {
    const cache = await caches.open(CACHE_SHELL);
    const cacheada = (await cache.match(req)) || (await cache.match('/index.html')) || (await cache.match('/'));
    if (cacheada) return cacheada;
    throw e;
  }
}

// Todo lo demás (librerías de CDN, tipografías, íconos, avatares de
// Freaky): responde de inmediato con lo que ya haya en caché si existe
// (rápido, funciona offline) y de todos modos pide la versión de red en
// segundo plano para que la próxima visita ya tenga lo último.
async function estrategiaCacheConRevalidacion(req) {
  const cache = await caches.open(CACHE_RUNTIME);
  const cacheada = await cache.match(req);
  const promesaRed = fetch(req)
    .then((respuestaRed) => {
      cache.put(req, respuestaRed.clone()).catch(() => {});
      return respuestaRed;
    })
    .catch(() => null);
  return cacheada || (await promesaRed) || Response.error();
}
