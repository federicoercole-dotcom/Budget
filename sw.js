/* Service worker: l'app si apre anche senza rete. I dati restano su Supabase; qui solo i file dell'app. */
const VERSION='2026.11.26-2';
const CACHE='budget-'+VERSION;
const ASSETS=["./index.html", "style.css?v=2026.11.26-2", "vendor/supabase.js?v=2026.11.26-2", "config.js?v=2026.11.26-2", "app.js?v=2026.11.26-2", "manifest.webmanifest", "icon.svg", "icon-192.png", "apple-touch-icon.png", "fonts/fraunces-latin-500-normal.woff2", "fonts/fraunces-latin-600-normal.woff2", "fonts/manrope-latin-400-normal.woff2", "fonts/manrope-latin-500-normal.woff2", "fonts/manrope-latin-600-normal.woff2", "fonts/manrope-latin-700-normal.woff2", "fonts/manrope-latin-800-normal.woff2"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('budget-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(u.pathname.endsWith('version.json'))return; /* sempre dalla rete */
  if(r.mode==='navigate'||u.pathname.endsWith('/')||u.pathname.endsWith('index.html')){
    e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));return res}).catch(()=>caches.match('./index.html')));return}
  e.respondWith(caches.match(r).then(m=>m||fetch(r)))});
